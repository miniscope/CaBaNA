"""One-row-per-analysis summaries of a :class:`~cabana.ResultSet`."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import numpy as np
import pandas as pd

if TYPE_CHECKING:  # pragma: no cover
    from ._results import MetricResult, ResultSet

_COLUMNS = [
    "analysis",
    "metric",
    "target",
    "level",
    "null",
    "n_shuffles",
    "correction",
    "n_tested",
    "n_significant",
    "frac_significant",
    "n_significant_adj",
    "frac_significant_adj",
    "median_z",
    "max_z",
    "median_value",
    "n_warnings",
    "error",
]


def _oriented_z(z: np.ndarray, tail: str) -> np.ndarray:
    """z oriented toward the tested tail: ``|z|`` (two), ``-z`` (lower), ``z`` (upper)."""
    if tail == "two":
        return np.abs(z)
    if tail == "lower":
        return -z
    return z


def _tests(arr: np.ndarray | None, per_cell_any: bool) -> np.ndarray | None:
    """Reduce an array over the state axis to one entry per test (cells for 'any state')."""
    if arr is None:
        return None
    a = np.asarray(arr)
    if per_cell_any and a.ndim >= 2:
        return a.reshape(a.shape[0], -1)
    return a.reshape(-1, 1)


def _stats(
    r: MetricResult,
    sl: Any,
    alpha: float | None,
) -> dict[str, Any]:
    """Statistics of ``r`` restricted to the index ``sl`` (a column index or ``slice(None)``)."""
    sh = r.shuffle
    values = np.asarray(r.values, dtype=float)
    cell_any = r.level == "cell"

    def pick(a: np.ndarray | None) -> np.ndarray | None:
        if a is None:
            return None
        a = np.asarray(a)
        if r.level == "population" and a.ndim == 2 and a.shape[0] == a.shape[1]:
            # a square population matrix (state x state, cell x cell) is symmetric with a
            # trivial diagonal: count each pair once
            return a[np.triu_indices(a.shape[0], k=1)]
        return a[(slice(None), sl)] if (a.ndim >= 2 and not isinstance(sl, slice)) else a

    vals = pick(values)
    out: dict[str, Any] = {
        "n_tested": np.nan,
        "n_significant": np.nan,
        "frac_significant": np.nan,
        "n_significant_adj": np.nan,
        "frac_significant_adj": np.nan,
        "median_z": np.nan,
        "max_z": np.nan,
        "median_value": float(np.nanmedian(vals)) if np.isfinite(vals).any() else np.nan,
    }
    if sh is None:
        return out
    p = _tests(pick(sh.p_value), cell_any)
    padj = _tests(pick(sh.p_adj) if sh.p_adj is not None else pick(sh.p_value), cell_any)
    if alpha is None:
        sig = _tests(pick(sh.significant), cell_any)
        sig_adj = (
            _tests(pick(sh.significant_adj), cell_any) if sh.significant_adj is not None else sig
        )
    else:
        with np.errstate(invalid="ignore"):
            sig = p < alpha
            sig_adj = padj < alpha
    z = _tests(pick(sh.z_score), cell_any)
    if z is not None:
        z = _oriented_z(z, sh.tail)
    assert p is not None and sig is not None and sig_adj is not None and z is not None
    tested = np.isfinite(p).any(axis=1)
    n = int(tested.sum())
    n_sig = int((np.asarray(sig, bool) & np.isfinite(p)).any(axis=1).sum())
    n_adj = int((np.asarray(sig_adj, bool) & np.isfinite(padj)).any(axis=1).sum())
    zf = np.where(np.isfinite(z), z, -np.inf).max(axis=1)
    zf = zf[np.isfinite(zf)]
    out.update(
        n_tested=n,
        n_significant=n_sig,
        frac_significant=n_sig / n if n else np.nan,
        n_significant_adj=n_adj,
        frac_significant_adj=n_adj / n if n else np.nan,
        median_z=float(np.median(zf)) if zf.size else np.nan,
        max_z=float(zf.max()) if zf.size else np.nan,
    )
    return out


def _state_slices(r: MetricResult) -> list[tuple[str, Any]]:
    names = r.state_names
    v = np.asarray(r.values)
    if not names:
        return []
    if r.level == "cell" and v.ndim == 2 and v.shape[1] == len(names):
        return [(str(s), j) for j, s in enumerate(names)]
    if r.level == "population" and v.ndim == 1 and v.shape[0] == len(names):
        return [(str(s), j) for j, s in enumerate(names)]
    return []


def _population_state_stats(r: MetricResult, j: int, alpha: float | None) -> dict[str, Any]:
    """Population 1-D per-state entry: a single test (no cell axis)."""
    sh = r.shuffle
    out = _stats_empty(float(r.values[j]))
    if sh is None:
        return out
    p = float(np.asarray(sh.p_value)[j])
    padj = float(np.asarray(sh.p_adj if sh.p_adj is not None else sh.p_value)[j])
    ok = np.isfinite(p)
    sig = bool(p < alpha) if alpha is not None else bool(np.asarray(sh.significant)[j])
    if alpha is not None:
        sig_adj = bool(padj < alpha)
    elif sh.significant_adj is not None:
        sig_adj = bool(np.asarray(sh.significant_adj)[j])
    else:
        sig_adj = sig
    z = float(_oriented_z(np.asarray(sh.z_score)[j], sh.tail))
    out.update(
        n_tested=int(ok),
        n_significant=int(ok and sig),
        frac_significant=float(ok and sig) if ok else np.nan,
        n_significant_adj=int(ok and sig_adj),
        frac_significant_adj=float(ok and sig_adj) if ok else np.nan,
        median_z=z if np.isfinite(z) else np.nan,
        max_z=z if np.isfinite(z) else np.nan,
    )
    return out


def _stats_empty(value: float) -> dict[str, Any]:
    return {
        "n_tested": np.nan,
        "n_significant": np.nan,
        "frac_significant": np.nan,
        "n_significant_adj": np.nan,
        "frac_significant_adj": np.nan,
        "median_z": np.nan,
        "max_z": np.nan,
        "median_value": value,
    }


def summarize(
    results: ResultSet, *, by: str = "analysis", alpha: float | None = None
) -> pd.DataFrame:
    """Summarize a run: one row per analysis (or per analysis and state).

    Parameters
    ----------
    results : ResultSet
        Output of ``Pipeline.run`` / :func:`cabana.analyze`.
    by : {"analysis", "state"}, default "analysis"
        ``"state"`` gives one row per (analysis, state) for results with a state axis (a
        cell-by-state matrix or a per-state population vector) and adds a ``state`` column.
    alpha : float, optional
        Recompute significance as ``p < alpha`` (raw and adjusted) instead of using the level
        each shuffle test was run with.

    Returns
    -------
    pandas.DataFrame
        Columns ``analysis, metric, target, level, null, n_shuffles, correction, n_tested,
        n_significant, frac_significant, n_significant_adj, frac_significant_adj, median_z,
        max_z, median_value, n_warnings, error``.  For a cell-level result with a state axis a
        cell counts as tested / significant when *any* state has a finite / significant
        p-value, and ``median_z`` / ``max_z`` are taken over each cell's largest z across
        states.  Without a shuffle the test columns are NaN.  ``median_value`` is the median of
        all finite observed values.  Failed analyses (``results.errors``) appear as rows with
        NaN counts and the message in ``error``.

        Sign convention: ``median_z`` / ``max_z`` are oriented toward the tail each result was
        tested on, so a large value always means "extreme in the tested direction":
        ``|z|`` for two-tailed tests (inhibited cells count as much as excited ones), ``-z``
        for lower-tail tests, ``z`` for upper-tail tests.  A square population matrix
        (state-by-state or cell-by-cell) counts each pair once: the upper triangle without
        the diagonal, so a 64x64 matrix has ``n_tested = 2016``, not 4096.

        When any result used a multiple-comparison correction, the adjusted columns
        (``n_significant_adj``, ``frac_significant_adj``) come before the raw ones, because
        those are the counts to report.

    Raises
    ------
    ValueError
        If ``by`` is not ``"analysis"`` or ``"state"``.
    """
    if by not in ("analysis", "state"):
        raise ValueError(f"by must be 'analysis' or 'state', got {by!r}")
    n_warn: dict[str, int] = {}
    for w in results.warnings:
        n_warn[w.analysis] = n_warn.get(w.analysis, 0) + 1
    cols = list(_COLUMNS)
    if by == "state":
        cols.insert(1, "state")
    rows: list[dict[str, Any]] = []
    for r in results.results:
        name = r.name or f"{r.metric}[{r.target}]"
        sh = r.shuffle
        head = {
            "analysis": name,
            "metric": r.metric,
            "target": r.target,
            "level": r.level,
            "null": None if sh is None else sh.null_name,
            "n_shuffles": 0 if sh is None else int(sh.n_shuffles),
            "correction": None if sh is None else sh.correction,
            "n_warnings": n_warn.get(name, 0),
            "error": None,
        }
        if by == "analysis":
            rows.append({**head, **_stats(r, slice(None), alpha)})
            continue
        for state, j in _state_slices(r):
            st = (
                _population_state_stats(r, j, alpha)
                if r.level == "population"
                else _stats(r, j, alpha)
            )
            rows.append({**head, "state": state, **st})
    for e in results.errors:
        rows.append(
            {
                "analysis": e.analysis,
                "metric": e.metric,
                "target": e.target,
                "level": None,
                "null": None,
                "n_shuffles": np.nan,
                "correction": None,
                "n_warnings": n_warn.get(e.analysis, 0),
                "error": f"{e.error_type}: {e.message}",
                **({"state": None} if by == "state" else {}),
                **_stats_empty(np.nan),
            }
        )
    if any(r.shuffle is not None and r.shuffle.correction != "none" for r in results.results):
        for c in ("n_significant_adj", "frac_significant_adj"):
            cols.remove(c)
        at = cols.index("n_significant")
        cols[at:at] = ["n_significant_adj", "frac_significant_adj"]
    return pd.DataFrame(rows, columns=cols)


def format_summary(df: pd.DataFrame, max_width: int = 60) -> str:
    """Plain-text table of a :func:`summarize` frame, for the CLI and logs.

    Parameters
    ----------
    df : pandas.DataFrame
        A frame returned by :func:`summarize`.
    max_width : int, default 60
        Longer ``error`` messages are cut with an ellipsis.

    Returns
    -------
    str
    """
    if df.empty:
        return "(no analyses)"
    t = df.copy()
    if "error" in t:
        t["error"] = t["error"].map(
            lambda s: (
                ""
                if s is None or s != s
                else (s if len(s) <= max_width else s[: max_width - 3] + "...")
            )
        )
    if t["error"].eq("").all() if "error" in t else False:
        t = t.drop(columns="error")
    for c in ("n_tested", "n_significant", "n_significant_adj", "n_shuffles"):
        if c in t:
            t[c] = t[c].map(lambda v: "-" if v != v else str(int(v)))
    return t.to_string(
        index=False,
        na_rep="-",
        float_format=lambda v: f"{v:.3g}",
        justify="right",
    )
