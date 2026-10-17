"""``cabana.sweep``: run a pipeline over a grid of parameter values and read the result.

A sweep is the Cartesian product of candidate values for one or more parameter
paths (the :meth:`Pipeline.set_param` grammar).  :class:`SweepResult` keeps one
:class:`ResultSet` per grid point and offers a tidy table, a per-point summary, a
stability readout (how often cells change classification between neighbouring
settings) and :meth:`SweepResult.pick`, which turns a sweep into
:class:`Selection` records, refusing to choose by significance.
"""

from __future__ import annotations

import itertools
import json
import time
from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Literal, NamedTuple

import numpy as np
import pandas as pd

from ._pipeline import Pipeline, ProgressEvent, RunContext
from ._results import ResultSet
from ._selection import Selection, _jsonable

__all__ = ["StabilityReport", "SweepResult", "sweep"]

_SIGNIFICANCE_NAMES = frozenset(
    {"p_value", "p_adj", "significant", "significant_adj", "n_significant", "frac_significant"}
)
_RELIABILITY_NAMES = frozenset({"stability", "reliability", "loglik"})
_INDEX_FORMAT = 1


def _is_reliability_key(key: str) -> bool:
    """Extras keys aggregated into the summary: ``*_r``, ``stability``, ``reliability``, ``loglik``."""
    return key.endswith("_r") or key in _RELIABILITY_NAMES


def _is_significance_column(name: str) -> bool:
    """True for columns that encode a null-test outcome (the guard rail of ``pick``)."""
    n = str(name).lower()
    return n in _SIGNIFICANCE_NAMES or "sig" in n or n.startswith("p_")


def _wilson(k: float, n: float, z: float = 1.959964) -> tuple[float, float]:
    """Wilson score interval for a binomial proportion ``k / n``."""
    if n <= 0:
        return (float("nan"), float("nan"))
    p = k / n
    den = 1.0 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (float(max(centre - half, 0.0)), float(min(centre + half, 1.0)))


def _scalar_col(df: pd.DataFrame, name: str, value: Any) -> None:
    """Add a constant column that may hold a list or other non-scalar value."""
    df[name] = pd.Series([value] * len(df), index=df.index, dtype=object)
    try:
        df[name] = df[name].infer_objects()
    except Exception:  # pragma: no cover
        pass


class StabilityReport(NamedTuple):
    """``cells`` (per cell/state DataFrame) and ``overall`` (dict); unpacks as a pair."""

    cells: pd.DataFrame
    overall: dict[str, Any]


@dataclass
class SweepResult:
    """Results of :func:`sweep`: one :class:`ResultSet` per grid point.

    Attributes
    ----------
    params : list[str]
        Swept parameter paths, in the order of ``over``.
    over : dict[str, list]
        Candidate values per path (the grid axes).
    points : list[(dict, ResultSet)]
        Parameter values and results per grid point, in ``itertools.product``
        order over ``over`` (the first path varies slowest).  A cancelled sweep
        holds only the points that finished.
    layouts : list[dict]
        Per point, the state-space layout of each analysed target (kind, state
        names, grid shape and edges); lets plots lay out rate maps when a
        transform parameter (bin size) is swept.
    status : {"ok", "cancelled"}
    shuffle : bool or None
        The ``shuffle`` mode the sweep was run with.
    last_picks : list[Selection]
        Result of the most recent :meth:`pick` (used by :meth:`apply`).
    """

    params: list[str]
    over: dict[str, list[Any]]
    points: list[tuple[dict[str, Any], ResultSet]] = field(default_factory=list)
    layouts: list[dict[str, Any]] = field(default_factory=list)
    status: Literal["ok", "cancelled"] = "ok"
    shuffle: bool | None = None
    last_picks: list[Selection] = field(default_factory=list)

    # ------------------------------------------------------------------ grid
    @property
    def shape(self) -> tuple[int, ...]:
        """Grid shape: number of candidates per swept path."""
        return tuple(len(self.over[p]) for p in self.params)

    def _cand_index(self, k: int) -> tuple[int, ...]:
        return tuple(int(i) for i in np.unravel_index(k, self.shape))

    def _line(self, param: str, fixed: dict[str, Any] | None = None) -> list[tuple[Any, int]]:
        """``(candidate value, point index)`` along ``param`` with the other paths held fixed.

        Held values default to each other path's first candidate; ``fixed`` overrides.
        """
        if param not in self.params:
            raise ValueError(f"{param!r} is not a swept parameter; swept: {self.params}")
        hold: dict[str, int] = {}
        for p in self.params:
            if p == param:
                continue
            if fixed is not None and p in fixed:
                try:
                    hold[p] = list(self.over[p]).index(fixed[p])
                except ValueError:
                    raise ValueError(f"fixed[{p!r}]={fixed[p]!r} is not a candidate") from None
            else:
                hold[p] = 0
        j = self.params.index(param)
        out = []
        for k in range(len(self.points)):
            idx = self._cand_index(k)
            if all(idx[self.params.index(p)] == i for p, i in hold.items()):
                out.append((self.over[param][idx[j]], k))
        return out

    # ----------------------------------------------------------------- table
    @property
    def table(self) -> pd.DataFrame:
        """Tidy long table: one row per grid point x result x cell x state.

        Columns: ``point`` (grid index), one column per swept path (its value at
        that point), ``analysis``, ``cell_id``, ``state`` (None without a state
        axis), ``value``, ``p_value``, ``p_adj``, ``significant``,
        ``significant_adj``.  Without shuffles ``p_value`` / ``p_adj`` are NaN and
        the significance columns False.  Population results with a 1-D value
        axis appear with ``cell_id`` None.
        """
        cols = ["analysis", "cell_id", "state", "value", "p_value", "p_adj"]
        cols += ["significant", "significant_adj"]
        frames = []
        for k, (vals, rs) in enumerate(self.points):
            df = rs.to_dataframe().rename(columns={"cell": "cell_id"})
            if df.empty:
                continue
            df = df[cols].copy()
            df.insert(0, "point", k)
            for i, p in enumerate(self.params):
                _scalar_col(df, p, vals[p])
                df.insert(1 + i, p, df.pop(p))
            frames.append(df)
        if not frames:
            return pd.DataFrame(columns=["point", *self.params, *cols])
        return pd.concat(frames, ignore_index=True)

    # --------------------------------------------------------------- summary
    def summary(self, by: Literal["analysis", "state"] = "analysis") -> pd.DataFrame:
        """Per grid point and analysis (or analysis and state) summary.

        Columns: ``point``, the swept paths, ``analysis``, (``state`` when
        ``by="state"``), ``n_cells``, ``n_significant`` (cells significant in at
        least one state), ``frac_significant`` (NaN when the analysis has no
        shuffle), the same two for adjusted p (``n_significant_adj``,
        ``frac_significant_adj``), ``median_value`` and ``se_value`` (median over
        cell/state rows and its approximate standard error, ``1.2533 sd /
        sqrt(n)``).  With ``by="analysis"`` every per-cell scalar extra whose key
        ends in ``_r`` or is ``stability``, ``reliability`` or ``loglik`` adds
        ``median_<key>`` and ``se_<key>``.  Rows without a cell (population
        results) are not summarised.
        """
        if by not in ("analysis", "state"):
            raise ValueError("by must be 'analysis' or 'state'")
        t = self.table
        t = t[t["cell_id"].notna()] if len(t) else t
        rows: list[dict[str, Any]] = []
        for k, (vals, rs) in enumerate(self.points):
            tk = t[t["point"] == k] if len(t) else t
            for analysis, ga in tk.groupby("analysis", sort=False):
                if by == "state":
                    groups = [(s, g) for s, g in ga.groupby(ga["state"].fillna(""), sort=False)]
                else:
                    groups = [(None, ga)]
                for state, g in groups:
                    row: dict[str, Any] = {"point": k, **{p: vals[p] for p in self.params}}
                    row["analysis"] = analysis
                    if by == "state":
                        row["state"] = state if state != "" else None
                    row.update(_sig_counts(g))
                    row.update(_med_se("value", g["value"].to_numpy(float)))
                    if by == "analysis":
                        res = rs[str(analysis)]
                        n = res.values.shape[0] if res.level == "cell" else -1
                        for key, arr in res.extras.items():
                            a = np.asarray(arr)
                            if _is_reliability_key(key) and a.ndim == 1 and a.shape[0] == n:
                                row.update(_med_se(key, a.astype(float)))
                    rows.append(row)
        return pd.DataFrame(rows)

    # ------------------------------------------------------------- stability
    def _pivot(self, column: str, analysis: str | None) -> pd.DataFrame:
        """Units (analysis, cell_id, state) x grid points matrix of ``column``."""
        t = self.table
        t = t[t["cell_id"].notna()] if len(t) else t
        if analysis is not None:
            t = t[t["analysis"] == analysis]
        if t.empty:
            return pd.DataFrame()
        t = t.assign(state=t["state"].fillna(""))
        if column == "significant":
            finite = t["p_value"].notna().to_numpy()
            t = t.assign(significant=np.where(finite, t["significant"].astype(float), np.nan))
        return t.pivot(index=["analysis", "cell_id", "state"], columns="point", values=column)

    def _adjacent_pairs(self) -> list[tuple[str, int, int]]:
        """``(param, point_a, point_b)`` for grid points one step apart along one path."""
        pairs = []
        n = len(self.points)
        for k in range(n):
            idx = self._cand_index(k)
            for j, p in enumerate(self.params):
                if idx[j] + 1 < self.shape[j]:
                    nxt = list(idx)
                    nxt[j] += 1
                    k2 = int(np.ravel_multi_index(nxt, self.shape))
                    if k2 < n:
                        pairs.append((p, k, k2))
        return pairs

    def stability(self, analysis: str | None = None, *, min_flips: int = 1) -> StabilityReport:
        """How often cells change classification between adjacent grid points.

        Adjacent means one step along one swept path with the others held fixed.
        Returns ``(cells, overall)``.

        ``cells`` has one row per (analysis, cell, state): ``analysis``,
        ``cell_id``, ``state`` (None without a state axis), ``n_flips`` (changes
        of ``significant`` summed over all adjacent pairs; NaN when the unit has
        no p-value, e.g. no shuffle), ``flips[<path>]`` per swept path,
        ``frac_points_significant``, ``modal_significant`` (significant at more
        than half of the points) and ``unstable`` (``n_flips >= min_flips``).

        ``overall`` holds ``n_units``, ``n_unstable``, ``frac_unstable`` (NaN
        without shuffles), ``spearman_mean`` (mean Spearman rank correlation of
        ``value`` between adjacent points, over units finite at both) and
        ``spearman_by_pair`` (list of ``{"analysis", "param", "from", "to", "rho", "n"}``, ranks within each analysis).
        ``analysis=None`` pools all analyses.
        """
        sig = self._pivot("significant", analysis)
        val = self._pivot("value", analysis)
        pairs = self._adjacent_pairs()
        if sig.empty:
            empty = pd.DataFrame(
                columns=["analysis", "cell_id", "state", "n_flips", "frac_points_significant"]
            )
            return StabilityReport(
                empty,
                {
                    "n_units": 0,
                    "n_unstable": 0,
                    "frac_unstable": float("nan"),
                    "spearman_mean": float("nan"),
                    "spearman_by_pair": [],
                },
            )
        flips = {p: np.zeros(len(sig)) for p in self.params}
        seen = {p: np.zeros(len(sig), bool) for p in self.params}
        for p, a, b in pairs:
            sa, sb = sig[a].to_numpy(float), sig[b].to_numpy(float)
            ok = np.isfinite(sa) & np.isfinite(sb)
            flips[p] += np.where(ok & (sa != sb), 1.0, 0.0)
            seen[p] |= ok
        n_flips = np.sum([flips[p] for p in self.params], axis=0)
        any_seen = np.any([seen[p] for p in self.params], axis=0)
        n_flips = np.where(any_seen, n_flips, np.nan)
        sig_arr = sig.to_numpy(float)
        n_fin = np.isfinite(sig_arr).sum(axis=1)
        frac_pts = np.where(n_fin > 0, np.nansum(sig_arr, axis=1) / np.maximum(n_fin, 1), np.nan)
        idx = sig.index.to_frame(index=False)
        cells = pd.DataFrame(
            {
                "analysis": idx["analysis"],
                "cell_id": idx["cell_id"],
                "state": idx["state"].replace("", None),
                "n_flips": n_flips,
                **{f"flips[{p}]": np.where(seen[p], flips[p], np.nan) for p in self.params},
                "frac_points_significant": frac_pts,
                "modal_significant": np.nan_to_num(frac_pts, nan=0.0) > 0.5,
                "unstable": np.nan_to_num(n_flips, nan=0.0) >= min_flips,
            }
        ).reset_index(drop=True)
        has_p = bool(np.isfinite(sig.to_numpy(float)).any())
        n_unst = int(cells["unstable"].sum())
        by_pair = []
        an_level = val.index.get_level_values("analysis") if not val.empty else []
        for p, a, b in pairs:
            if val.empty or a not in val or b not in val:
                continue
            for an in dict.fromkeys(an_level):
                m = np.asarray(an_level == an)
                va, vb = val[a][m], val[b][m]
                ok = va.notna() & vb.notna()
                rho = float(va[ok].rank().corr(vb[ok].rank())) if ok.sum() > 2 else float("nan")
                by_pair.append(
                    {
                        "analysis": an,
                        "param": p,
                        "from": self.points[a][0][p],
                        "to": self.points[b][0][p],
                        "rho": rho,
                        "n": int(ok.sum()),
                    }
                )
        rhos = [r["rho"] for r in by_pair if np.isfinite(r["rho"])]
        overall = {
            "n_units": len(cells),
            "n_unstable": n_unst,
            "frac_unstable": n_unst / len(cells) if has_p else float("nan"),
            "spearman_mean": float(np.mean(rhos)) if rhos else float("nan"),
            "spearman_by_pair": by_pair,
        }
        return StabilityReport(cells, overall)

    # ------------------------------------------------------------------ pick
    def pick(
        self,
        criterion: str,
        *,
        analysis: str | None = None,
        rule: Literal["max", "min", "one_se", "plateau"] = "max",
        allow_significance: bool = False,
        higher_is_better: bool = True,
    ) -> list[Selection]:
        """Choose one value per swept parameter from a non-significance criterion.

        ``criterion`` names a column of :meth:`summary` (``median_value``,
        ``median_<reliability extra>``, ...).  For every swept path the
        criterion is averaged over the other swept paths, giving one score per
        candidate (and a standard error combined from ``se_<...>``).

        Rules: ``"max"`` / ``"min"`` take the best score (method ``auto_rule``).
        ``"one_se"`` takes the first candidate, in the order given in ``over``
        (list simplest first), whose score is within one SE of the best.
        ``"plateau"`` finds the longest run of adjacent candidates all within
        one SE of the best and takes the middle one (lower middle for an even
        run; a run holding the best wins ties).  Both use method
        ``sweep_stability`` and read ``higher_is_better`` for the direction.

        Raises
        ------
        ValueError
            If ``criterion`` is a p-value, a significance flag or count, or any
            column containing ``sig`` or starting with ``p_`` (unless
            ``allow_significance=True``, which sets ``informed_by_significance``
            on the Selections), or if it is not a summary column.  Choosing a
            parameter by how many cells it makes significant is a researcher
            degree of freedom: the null test then favours the chosen value.
        """
        sig = _is_significance_column(criterion)
        if sig and not allow_significance:
            raise ValueError(
                f"refusing to pick by {criterion!r}: choosing a parameter by p-values or by "
                "how many cells come out significant is a researcher degree of freedom "
                "(it biases the null test in favour of the chosen value). Use a value-based "
                "or reliability criterion such as 'median_value' or a held-out score, or pass "
                "allow_significance=True to record the pick with informed_by_significance=True."
            )
        if rule not in ("max", "min", "one_se", "plateau"):
            raise ValueError(f"unknown rule {rule!r}")
        summ = self.summary()
        if summ.empty:
            raise ValueError("sweep has no results to pick from")
        names = list(dict.fromkeys(summ["analysis"]))
        if analysis is None:
            if len(names) != 1:
                raise ValueError(f"several analyses {names}: pass analysis=")
            analysis = names[0]
        elif analysis not in names:
            raise ValueError(f"no analysis {analysis!r}; available: {names}")
        summ = summ[summ["analysis"] == analysis]
        if criterion not in summ.columns:
            avail = [c for c in summ.columns if c.startswith("median_")]
            raise ValueError(f"{criterion!r} is not a summary column; criteria: {avail}")
        se_col = "se_" + criterion[len("median_") :] if criterion.startswith("median_") else None
        score = summ[criterion].to_numpy(float)
        se = (
            summ[se_col].to_numpy(float)
            if se_col is not None and se_col in summ.columns
            else np.zeros(len(summ))
        )
        pts = summ["point"].to_numpy(int)
        cand = np.array([self._cand_index(int(k)) for k in pts])
        out: list[Selection] = []
        for j, p in enumerate(self.params):
            cs, ss, es = [], [], []
            for ci in range(len(self.over[p])):
                m = (cand[:, j] == ci) & np.isfinite(score)
                if m.any():
                    cs.append(ci)
                    ss.append(float(score[m].mean()))
                    es.append(float(np.sqrt(np.nansum(se[m] ** 2)) / m.sum()))
            if not cs:
                raise ValueError(f"criterion {criterion!r} is not finite for any {p!r} candidate")
            s_arr, e_arr = np.array(ss), np.array(es)
            chosen = _apply_rule(s_arr, e_arr, rule, higher_is_better)
            note = f"rule={rule}; analysis={analysis}; criterion={criterion}" + (
                "; averaged over other swept parameters" if len(self.params) > 1 else ""
            )
            out.append(
                Selection(
                    path=p,
                    value=self.over[p][cs[chosen]],
                    method="sweep_stability" if rule in ("one_se", "plateau") else "auto_rule",
                    criterion=criterion,
                    candidates=[self.over[p][ci] for ci in cs],
                    scores=ss,
                    informed_by_significance=bool(sig),
                    note=note,
                )
            )
        self.last_picks = out
        return out

    def apply(self, pipeline: Pipeline, selections: Sequence[Selection] | None = None) -> Pipeline:
        """Return ``pipeline`` with the picks applied via ``set_param`` (recording each Selection).

        ``selections=None`` uses the result of the latest :meth:`pick`.
        """
        sels = list(self.last_picks if selections is None else selections)
        if not sels:
            raise ValueError("no selections: call pick() first or pass selections=")
        for s in sels:
            pipeline = pipeline.set_param(s.path, s.value, selection=s)
        return pipeline

    # ------------------------------------------------------------------ I/O
    def save(self, path: str | Path) -> None:
        """Write a directory: ``index.json`` plus one ResultSet ``.zip`` per grid point."""
        d = Path(path)
        d.mkdir(parents=True, exist_ok=True)
        entries = []
        for k, (vals, rs) in enumerate(self.points):
            fn = f"point_{k:04d}.zip"
            rs.save(d / fn)
            entries.append({"params": _jsonable(vals), "file": fn})
        index = {
            "format": _INDEX_FORMAT,
            "kind": "cabana.SweepResult",
            "params": self.params,
            "over": _jsonable(self.over),
            "status": self.status,
            "shuffle": self.shuffle,
            "points": entries,
            "layouts": _jsonable(self.layouts),
            "last_picks": [s.model_dump(mode="json") for s in self.last_picks],
        }
        (d / "index.json").write_text(json.dumps(index, indent=1, allow_nan=False))

    @classmethod
    def load(cls, path: str | Path) -> SweepResult:
        """Read a sweep written by :meth:`save`."""
        d = Path(path)
        idx_file = d / "index.json"
        if not idx_file.exists():
            raise ValueError(f"{d} holds no index.json: not a saved SweepResult")
        idx = json.loads(idx_file.read_text())
        if idx.get("kind") != "cabana.SweepResult":
            raise ValueError(f"{d} is not a saved SweepResult")
        if idx.get("format", 0) > _INDEX_FORMAT:
            raise ValueError(f"sweep format {idx['format']} is newer than this cabana supports")
        points = [(e["params"], ResultSet.load(d / e["file"])) for e in idx["points"]]
        return cls(
            params=list(idx["params"]),
            over={k: list(v) for k, v in idx["over"].items()},
            points=points,
            layouts=list(idx.get("layouts", [])),
            status=idx.get("status", "ok"),
            shuffle=idx.get("shuffle"),
            last_picks=[Selection.model_validate(s) for s in idx.get("last_picks", [])],
        )


def _sig_counts(g: pd.DataFrame) -> dict[str, Any]:
    n_cells = int(g["cell_id"].nunique())
    has_p = bool(g["p_value"].notna().any())
    out: dict[str, Any] = {"n_cells": n_cells}
    for col, key in (("significant", ""), ("significant_adj", "_adj")):
        n_sig = int(g.groupby("cell_id")[col].any().sum())
        out[f"n_significant{key}"] = n_sig
        out[f"frac_significant{key}"] = n_sig / n_cells if has_p and n_cells else float("nan")
    return out


def _med_se(key: str, a: np.ndarray) -> dict[str, float]:
    a = a[np.isfinite(a)]
    if a.size == 0:
        return {f"median_{key}": float("nan"), f"se_{key}": float("nan")}
    se = 1.2533 * a.std(ddof=1) / np.sqrt(a.size) if a.size > 1 else float("nan")
    return {f"median_{key}": float(np.median(a)), f"se_{key}": float(se)}


def _apply_rule(score: np.ndarray, se: np.ndarray, rule: str, higher_is_better: bool) -> int:
    """Index into ``score`` chosen by ``rule`` (candidates in given order)."""
    if rule == "max":
        return int(np.argmax(score))
    if rule == "min":
        return int(np.argmin(score))
    best = int(np.argmax(score) if higher_is_better else np.argmin(score))
    tol = float(np.nan_to_num(se[best], nan=0.0))
    ok = score >= score[best] - tol if higher_is_better else score <= score[best] + tol
    if rule == "one_se":
        return int(np.flatnonzero(ok)[0])
    # plateau: longest run of adjacent ok candidates; ties go to the run holding the best
    runs_: list[tuple[int, int]] = []
    start = None
    for i, v in enumerate([*ok, False]):
        if v and start is None:
            start = i
        elif not v and start is not None:
            runs_.append((start, i - 1))
            start = None
    a, b = max(runs_, key=lambda r: (r[1] - r[0], r[0] <= best <= r[1]))
    return (a + b) // 2


def _layouts(session: Any, rs: ResultSet) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for r in rs:
        if r.target_kind != "states" or r.target in out or r.target not in session.states:
            continue
        sp = session.states[r.target]
        topo = sp.topology
        out[r.target] = {
            "kind": sp.kind,
            "state_names": [str(s) for s in sp.state_names],
            "shape": None if topo is None else [int(n) for n in topo.shape],
            "edges": None if topo is None else [np.asarray(e, float).tolist() for e in topo.edges],
            "axis_names": None if topo is None else [str(a) for a in topo.axis_names],
        }
    return out


def sweep(
    session: Any,
    pipeline: Pipeline,
    over: dict[str, list[Any]],
    *,
    shuffle: bool | None = None,
    context: RunContext | None = None,
    n_jobs: int | None = None,
) -> SweepResult:
    """Run ``pipeline`` at every point of the Cartesian product of ``over``.

    Parameters
    ----------
    session : Session
        Raw or prepared session (the pipeline's transforms run on it).
    pipeline : Pipeline
        Base pipeline; every path in ``over`` must address an existing field.
    over : dict[str, list]
        Parameter path (``Pipeline.set_param`` grammar, e.g.
        ``"transforms.position.bin_size"`` or
        ``"analyses.*.metric.smooth_sigma_bins"``) to candidate values.  List
        candidates simplest first (``pick``'s one-SE and plateau rules use the order).
    shuffle : bool, optional
        ``None`` keeps each analysis's ``ShuffleConfig``; ``False`` removes every
        shuffle (observed values only: fast, for interactive use); ``True``
        requires every analysis to have one.
    context : RunContext, optional
        ``on_progress`` receives one ``ProgressEvent`` per grid point (stage
        ``"analysis"``, ``index`` = point, ``total`` = grid size) and a final
        ``"done"``; ``should_cancel`` is polled before each point and inside each
        run; a cancelled sweep returns the finished points with
        ``status="cancelled"``.  ``on_error`` / ``capture_warnings`` pass through.
    n_jobs : int, optional
        Shuffle threads per run (see ``Pipeline.run``).

    Returns
    -------
    SweepResult

    Notes
    -----
    Fast path: when no swept path starts with ``transforms.`` or ``preprocess.``
    (and the pipeline has no ``selectors``), transforms and preprocess steps run
    once -- the sweep consumes ``iter_run``'s ``("session", ...)`` and
    ``("pipeline", ...)`` events -- and
    each grid point runs an analyses-only pipeline on that prepared session.
    Provenance of those results records the prepared session's hash and an
    analyses-only pipeline hash; ``provenance["transforms"]`` is unchanged.
    Otherwise the full pipeline reruns at every point.
    """
    if not over:
        raise ValueError("over must name at least one parameter path")
    params = list(over)
    cand = {p: list(v) for p, v in over.items()}
    for p, v in cand.items():
        if not v:
            raise ValueError(f"over[{p!r}] is empty")
        pipeline.get_param(p)  # validate the path early
    base = pipeline
    if shuffle is False:
        base = base.model_copy(
            update={"analyses": [a.model_copy(update={"shuffle": None}) for a in base.analyses]}
        )
    elif shuffle is True and any(a.shuffle is None for a in base.analyses):
        raise ValueError("shuffle=True but some analyses have no ShuffleConfig")
    ctx = context if context is not None else RunContext()
    inner = replace(ctx, on_progress=None)
    t0 = time.perf_counter()
    grid = list(itertools.product(*(cand[p] for p in params)))
    total = len(grid)
    result = SweepResult(params=params, over=cand, shuffle=shuffle)

    def emit(stage: str, name: str, k: int, msg: str = "") -> None:
        if ctx.on_progress is not None:
            ctx.on_progress(
                ProgressEvent(
                    stage,  # type: ignore[arg-type]
                    name,
                    k,
                    total,
                    min((k + (stage != "done" and 1 or 0)) / max(total, 1), 1.0),
                    elapsed_s=time.perf_counter() - t0,
                    message=msg,
                )
            )

    fast = all(p.split(".")[0] not in ("transforms", "preprocess") for p in params)
    prepared = None
    run_pipe = base
    if fast:
        # Prepare once: transforms, preprocess and selectors run, then we stop at the
        # ("pipeline", effective) event before any analysis starts.  Analyses stay in
        # the prepared pipeline so selectors can see them; a swept path then overrides
        # whatever a selector chose for it (the sweep explores, the selector proposes).
        effective = None
        for key, val in base.iter_run(session, context=inner):
            if key == "session":
                prepared = val
            elif key == "pipeline":
                effective = val
                break
        if prepared is None or effective is None:
            result.status = "cancelled"
            emit("done", "", 0, "cancelled")
            return result
        run_pipe = effective.model_copy(
            update={"transforms": [], "preprocess": [], "selectors": []}
        )

    for k, vals in enumerate(grid):
        if ctx.should_cancel is not None and ctx.should_cancel():
            result.status = "cancelled"
            break
        pt = run_pipe
        for p, v in zip(params, vals, strict=True):
            pt = pt.set_param(p, v)
        sess_k, rs = pt.run(prepared if fast else session, context=inner, n_jobs=n_jobs)
        if rs.cancelled:
            result.status = "cancelled"
            break
        result.points.append((dict(zip(params, vals, strict=True)), rs))
        result.layouts.append(_layouts(sess_k, rs))
        emit("analysis", ", ".join(f"{p}={v}" for p, v in zip(params, vals, strict=True)), k)
    emit("done", "", len(result.points), result.status)
    return result
