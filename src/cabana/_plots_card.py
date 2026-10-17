"""Cell card: one figure that says what a cell is tuned to and how strong the evidence is.

``plot_cell_card(session, results, cell)`` composes the existing plot-data functions
(rate maps, split-half maps, PETH, joint histogram, shuffle distribution, activity
raster ribbon) for a single cell across *all* of the cell-level analyses of a
``ResultSet``.  Layout, top to bottom:

1. a header strip (identity, activity summary, per-cell metadata, footprint centroid);
2. the activity trace over the whole session with behaviour ribbons and hatched
   excluded frames;
3. an evidence row, one panel per analysis (significant analyses first);
4. a null row beneath it (null histogram with the observed value, or the numbers as
   text when the null draws were not kept);
5. a metric strip: one table row per analysis with value, p, adjusted p and the rank of
   this cell among all cells.

:func:`plot_cell_cards` makes many cards (the significant cells, a list, ...) and can
write them to disk.  Nothing here is registered with the plot registry because a card
takes a whole ``ResultSet`` rather than one result.
"""

from __future__ import annotations

import warnings
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import to_hex, to_rgba
from matplotlib.figure import Figure
from matplotlib.patches import Patch

from ._models import EVENT_KINDS, Session
from ._plot_data import PLOT_DATA_VERSION
from ._plot_registry import save_figures
from ._plot_style import (
    BASELINE_SHADE,
    NULL_COLOR,
    OBSERVED_COLOR,
    RESPONSE_SHADE,
    UNVISITED_COLOR,
    fmt_p,
    heatmap_cmap,
    mark_significant,
    metric_label,
    state_colors,
    use_style,
)
from ._plots import plot_rate_maps_data, plot_shuffle_distribution_data, plot_split_half_maps_data
from ._plots_events import plot_peth_data
from ._plots_information import plot_joint_histogram_data
from ._plots_views import plot_activity_raster_data
from ._results import MetricResult, ResultSet

__all__ = ["plot_cell_card", "plot_cell_card_data", "plot_cell_cards"]

_MAX_META = 6
_GREY = (0.75, 0.75, 0.75, 1.0)


# --------------------------------------------------------------------------- #
# resolving inputs
# --------------------------------------------------------------------------- #


def _cell_results(session: Session, results: ResultSet | Sequence[MetricResult]) -> list[Any]:
    """The cell-level results (leading axis = cells of ``session``), in the given order."""
    items = list(results.results if isinstance(results, ResultSet) else results)
    out = [
        r
        for r in items
        if r.level == "cell" and np.ndim(r.values) >= 1 and np.shape(r.values)[0] == session.n_cells
    ]
    if not out:
        raise ValueError(
            "no cell-level results (leading axis = session cells) to build a card from"
        )
    return out


def _resolve_cell(session: Session, results: Sequence[MetricResult], cell: int | str) -> int:
    if isinstance(cell, (int, np.integer)) and not isinstance(cell, bool):
        idx = int(cell)
        if not 0 <= idx < session.n_cells:
            raise IndexError(f"cell index {idx} out of range for {session.n_cells} cells")
        return idx
    key = str(cell)
    for ids in [session.cell_ids, *[r.cell_ids for r in results]]:
        if ids is not None and key in [str(i) for i in ids]:
            return [str(i) for i in ids].index(key)
    raise KeyError(f"no cell with id {key!r}")


def _cell_id(session: Session, c: int) -> str:
    return str(session.cell_ids[c]) if session.cell_ids else str(c)


def _py(x: Any) -> Any:
    """Plain Python scalar (JSON-friendly) from a numpy scalar; strings stay strings."""
    if isinstance(x, np.generic):
        x = x.item()
    if isinstance(x, bytes):
        x = x.decode(errors="replace")
    return x


# --------------------------------------------------------------------------- #
# per-analysis statistics of one cell
# --------------------------------------------------------------------------- #


def _baseline(result: MetricResult) -> float | None:
    return 0.5 if result.metric == "auroc" else None


def _tail(result: MetricResult) -> str | None:
    return result.shuffle.tail if result.shuffle is not None else None


def _effect(result: MetricResult) -> np.ndarray:
    """Per-element 'how strong' (larger = stronger evidence of tuning), NaN -> -inf."""
    v = np.asarray(result.values, float)
    base = _baseline(result)
    if base is not None:
        e = np.abs(v - base)
    elif _tail(result) == "lower":
        e = -v
    else:
        e = v
    return np.where(np.isfinite(e), e, -np.inf)


def _corrected(result: MetricResult) -> bool:
    sh = result.shuffle
    return sh is not None and sh.correction != "none" and sh.p_adj is not None


def _sig_and_p(result: MetricResult) -> tuple[np.ndarray | None, np.ndarray | None]:
    """``(significant, p used)``, both ``values``-shaped; adjusted when a correction was applied."""
    sh = result.shuffle
    if sh is None:
        return None, None
    if _corrected(result):
        p = np.asarray(sh.p_adj, float)
        return p < sh.alpha, p
    return np.asarray(sh.significant, bool), np.asarray(sh.p_value, float)


def _cell_level(result: MetricResult) -> tuple[np.ndarray, np.ndarray]:
    """``(significant, min p used)`` per cell, ``(n_cells,)`` each (all-False / NaN w/o shuffle)."""
    n = np.shape(result.values)[0]
    sig, p = _sig_and_p(result)
    if sig is None or p is None:
        return np.zeros(n, bool), np.full(n, np.nan)
    sig = sig.reshape(n, -1).any(axis=1)
    p = p.reshape(n, -1)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        minp = np.where(
            np.isfinite(p).any(axis=1), np.nanmin(np.where(np.isfinite(p), p, np.inf), 1), np.nan
        )
    return sig, minp


def _best_state(result: MetricResult, c: int) -> int | None:
    """State of cell ``c`` that carries the evidence (lowest p, then strongest effect)."""
    if np.ndim(result.values) != 2:
        return None
    eff = _effect(result)[c]
    _, p = _sig_and_p(result)
    if p is None:
        return int(np.argmax(eff))
    pc = np.where(np.isfinite(p[c]), p[c], np.inf)
    return int(np.lexsort((-eff, pc))[0])


def _cell_stats(result: MetricResult, c: int) -> dict[str, Any]:
    """Value, p, adjusted p, significance and rank of cell ``c`` in one result."""
    values = np.asarray(result.values, float)
    s = _best_state(result, c)
    idx: tuple[int, ...] = (c,) if s is None else (c, s)
    sh = result.shuffle
    names = result.state_names
    out: dict[str, Any] = {
        "state_index": s,
        "state": "" if s is None else (str(names[s]) if names else str(s)),
        "value": float(values[idx]),
        "p": float("nan"),
        "p_adj": float("nan"),
        "significant": False,
        "correction": "none",
    }
    if sh is not None:
        sig, _ = _sig_and_p(result)
        out["p"] = float(np.asarray(sh.p_value, float)[idx])
        padj = sh.p_adj if sh.p_adj is not None else sh.p_value
        out["p_adj"] = float(np.asarray(padj, float)[idx])
        out["significant"] = bool(sig[idx]) if sig is not None else False
        out["correction"] = str(sh.correction)
    eff = _effect(result)
    score = eff if eff.ndim == 1 else eff.max(axis=1)
    finite = np.isfinite(values.reshape(values.shape[0], -1)).any(axis=1)
    out["n_cells"] = int(finite.sum())
    out["rank"] = int(1 + np.sum(score[finite] > score[c])) if finite[c] else -1
    return out


def _p_text(st: dict[str, Any], sh: Any) -> str:
    if sh is None:
        return "no shuffle"
    txt = fmt_p(st["p"], sh.n_shuffles, sh.tail)
    if st["correction"] != "none":
        txt += f", adj {fmt_p(st['p_adj'], sh.n_shuffles, sh.tail)} ({st['correction']})"
    return txt


def _order_results(results: Sequence[MetricResult], c: int) -> list[int]:
    """Indices into ``results``: significant first, then by smallest p, stable otherwise."""
    keys = []
    for i, r in enumerate(results):
        sig, minp = _cell_level(r)
        p = minp[c]
        keys.append((not bool(sig[c]), p if np.isfinite(p) else np.inf, i))
    return [k[2] for k in sorted(keys)]


# --------------------------------------------------------------------------- #
# panel data
# --------------------------------------------------------------------------- #


def _base(kind: str, **kw: Any) -> dict[str, Any]:
    return {"kind": kind, "version": PLOT_DATA_VERSION, **kw}


def _state_bars(result: MetricResult, c: int, st: dict[str, Any]) -> dict[str, Any]:
    values = np.asarray(result.values, float)[c]
    names = [str(n) for n in (result.state_names or range(values.size))]
    sh = result.shuffle
    sig, _ = _sig_and_p(result)
    cols = state_colors(names)
    return _base(
        "state_bars",
        metric=result.metric,
        state_names=names,
        values=values,
        null_lo=None if sh is None else np.asarray(sh.null_lo, float)[c],
        null_hi=None if sh is None else np.asarray(sh.null_hi, float)[c],
        significant=None if sig is None else np.asarray(sig[c], bool),
        selected=st["state_index"],
        baseline=_baseline(result),
        colors=[to_hex(cols[n]) for n in names],
        ylabel=metric_label(result.metric, result.params),
    )


def _metric_bar(result: MetricResult, c: int, st: dict[str, Any]) -> dict[str, Any]:
    sh = result.shuffle
    return _base(
        "metric_bar",
        metric=result.metric,
        value=st["value"],
        null_lo=None if sh is None else float(np.asarray(sh.null_lo, float)[c]),
        null_hi=None if sh is None else float(np.asarray(sh.null_hi, float)[c]),
        significant=st["significant"],
        baseline=_baseline(result),
        ylabel=metric_label(result.metric, result.params),
    )


def _panel_data(
    session: Session, result: MetricResult, c: int, st: dict[str, Any]
) -> tuple[str, dict[str, Any]]:
    ex = result.extras
    if "rate_map" in ex:
        return "rate_map", plot_rate_maps_data(session, result, cells=[c], show_occupancy=False)
    if "rate_map_a" in ex and "rate_map_b" in ex:
        return "split_half", plot_split_half_maps_data(session, result, cells=[c])
    if result.metric == "peth" and "peth" in ex and st["state_index"] is not None:
        return "peth", plot_peth_data(result, session, cells=[c], states=[st["state_index"]])
    if "joint" in ex and "conditional" in ex and "edges" in ex:
        return "joint_histogram", plot_joint_histogram_data(
            result, c, states=session.states.get(result.target)
        )
    if np.ndim(result.values) == 2:
        return "state_bars", _state_bars(result, c, st)
    return "metric_bar", _metric_bar(result, c, st)


def _null_data(result: MetricResult, c: int, st: dict[str, Any]) -> dict[str, Any] | None:
    sh = result.shuffle
    if sh is None or sh.null is None:
        return None
    return plot_shuffle_distribution_data(result, c, state=st["state_index"])


def _null_text(result: MetricResult, c: int, st: dict[str, Any]) -> str:
    """Text shown instead of a null histogram (no shuffle, or the null draws were dropped)."""
    sh = result.shuffle
    if sh is None:
        return "no shuffle test run"
    idx: tuple[int, ...] = (c,) if st["state_index"] is None else (c, st["state_index"])
    lo = float(np.asarray(sh.null_lo, float)[idx])
    hi = float(np.asarray(sh.null_hi, float)[idx])
    lines = [
        f"observed {st['value']:.3g}",
        f"null [{lo:.3g}, {hi:.3g}]",
        _p_text(st, sh).replace(", adj", "\nadj"),
    ]
    if sh.null is None:
        lines.append("(null draws not kept)")
    return "\n".join(lines)


def _header(session: Session, c: int, n_total: int) -> dict[str, Any]:
    act = np.asarray(session.activity, float)[c]
    kind = str(session.activity_kind)
    dur = float(session.duration_s)
    h: dict[str, Any] = {
        "cell_id": _cell_id(session, c),
        "cell_index": c,
        "n_cells": int(session.n_cells),
        "activity_kind": kind,
        "duration_s": dur,
        "fs": float(session.fs),
        "n_events": None,
        "mean_rate_hz": None,
        "mean_activity": float(np.nanmean(act)) if np.isfinite(act).any() else float("nan"),
    }
    if kind in EVENT_KINDS:
        if kind in ("spike_counts", "binary"):
            n_ev = float(np.nansum(act))
        else:
            n_ev = float(np.sum(act > 0))
        h["n_events"] = int(round(n_ev))
        h["mean_rate_hz"] = n_ev / dur if dur > 0 else float("nan")
    meta = {}
    for k, v in session.cell_meta.items():
        if k in ("centroid_x", "centroid_y", "n_events", "mean_rate_hz"):
            continue
        meta[str(k)] = _py(np.asarray(v)[c])
        if len(meta) >= _MAX_META:
            break
    h["meta"] = meta
    cen = session.footprint_centroids()
    if cen is not None and np.all(np.isfinite(cen[c])):
        h["centroid_x"] = float(cen[c, 0])
        h["centroid_y"] = float(cen[c, 1])
    h["n_analyses_total"] = n_total
    return h


def _trace(session: Session, c: int, t_range: tuple[float, float] | None) -> dict[str, Any]:
    spaces = [n for n, sp in session.states.items() if sp.kind != "grid"][:2]
    rd = plot_activity_raster_data(
        session, cells=[c], max_cells=1, t_range=t_range, states=spaces, show_masks=False
    )
    t_all = np.asarray(session.t, float)
    fr = (
        np.arange(t_all.size)
        if t_range is None
        else np.flatnonzero((t_all >= t_range[0]) & (t_all <= t_range[1]))
    )
    return {
        "t": rd["t"],
        "activity": np.asarray(rd["activity"][0], float),
        "ribbon": rd["ribbon"],
        "excluded": ~session.valid_mask()[fr],
        "units": rd["units"],
    }


def plot_cell_card_data(
    session: Session,
    results: ResultSet | Sequence[MetricResult],
    cell: int | str,
    *,
    max_analyses: int = 6,
    t_range: tuple[float, float] | None = None,
) -> dict[str, Any]:
    """Data behind :func:`plot_cell_card`.

    Parameters
    ----------
    session : Session
        Supplies activity, behaviour ribbons, masks, cell metadata and footprints.
    results : ResultSet or sequence of MetricResult
        Cell-level results (leading axis = the session's cells); population-level
        results are ignored.
    cell : int or str
        Cell index or cell id.
    max_analyses : int, default 6
        Number of evidence panels; analyses are ordered significant first (adjusted
        p when a correction was applied), then by smallest p, then as given.
    t_range : (float, float), optional
        Time window of the trace panel in seconds; default the whole session.

    Returns
    -------
    dict
        ``kind="cell_card"`` with ``cell_id``, ``cell_index``, ``header``, ``trace``
        (``t``, ``activity``, ``ribbon``, ``excluded``, ``units``), ``panels`` (one
        per shown analysis: ``analysis``, ``kind`` in ``"rate_map"``, ``"split_half"``,
        ``"state_bars"``, ``"peth"``, ``"joint_histogram"`` or ``"metric_bar"``,
        ``data`` the composed sub-dict, ``p``, ``p_adj``, ``significant``, ``value``,
        ``rank``, ``n_cells``, ``state`` for per-state results and the texts
        ``title``, ``p_text``, ``null_title``, ``null_text``), ``nulls`` (aligned with
        ``panels``: a shuffle-distribution dict, or ``None`` when the null draws are
        not kept), ``table`` (one row per analysis, shown or not) and
        ``n_analyses_total``.  Look for: panels whose p is small *and* whose evidence
        picture (map, bar, trace) shows the structure the number claims.

    Raises
    ------
    ValueError
        If ``results`` has no cell-level result.
    KeyError, IndexError
        If ``cell`` is an unknown id or out of range.
    """
    res = _cell_results(session, results)
    c = _resolve_cell(session, res, cell)
    order = _order_results(res, c)
    panels: list[dict[str, Any]] = []
    nulls: list[dict[str, Any] | None] = []
    table: list[dict[str, Any]] = []
    n_shown = max(int(max_analyses), 0)
    for rank_pos, i in enumerate(order):
        r = res[i]
        st = _cell_stats(r, c)
        sh = r.shuffle
        name = str(r.name or f"{r.metric}[{r.target}]")
        shown = rank_pos < n_shown
        table.append(
            {
                "analysis": name,
                "metric": r.metric,
                "target": r.target,
                "state": st["state"],
                "value": st["value"],
                "p": st["p"],
                "p_adj": st["p_adj"],
                "significant": st["significant"],
                "rank": st["rank"],
                "n_cells": st["n_cells"],
                "shown": shown,
            }
        )
        if not shown:
            continue
        kind, data = _panel_data(session, r, c, st)
        null = _null_data(r, c, st)
        ptxt = _p_text(st, sh)
        label = metric_label(r.metric, r.params).split(" (")[0]
        state_txt = f" [{st['state']}]" if st["state"] else ""
        panels.append(
            {
                "analysis": name,
                "metric": r.metric,
                "kind": kind,
                "data": data,
                "p": st["p"],
                "p_adj": st["p_adj"],
                "significant": st["significant"],
                "value": st["value"],
                "rank": st["rank"],
                "n_cells": st["n_cells"],
                "state": st["state"],
                "title": f"{name}\n{label}{state_txt} = {st['value']:.3g}",
                "p_text": ptxt,
                "null_title": ""
                if sh is None
                else f"null: {sh.null_name}, n={sh.n_shuffles}"
                + (f", {st['state']}" if st["state"] else ""),
                "null_text": "" if null is not None else _null_text(r, c, st),
            }
        )
        nulls.append(null)
    return {
        "kind": "cell_card",
        "version": PLOT_DATA_VERSION,
        "cell_id": _cell_id(session, c),
        "cell_index": c,
        "header": _header(session, c, len(res)),
        "trace": _trace(session, c, t_range),
        "panels": panels,
        "nulls": nulls,
        "table": table,
        "n_analyses_total": len(res),
    }


# --------------------------------------------------------------------------- #
# drawing
# --------------------------------------------------------------------------- #


def _runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """``(start, length)`` of each run of True in ``mask``."""
    m = np.concatenate([[False], np.asarray(mask, bool), [False]])
    d = np.diff(m.astype(np.int8))
    starts, ends = np.flatnonzero(d == 1), np.flatnonzero(d == -1)
    return [(int(a), int(b - a)) for a, b in zip(starts, ends, strict=True)]


def _header_lines(h: dict[str, Any]) -> tuple[str, list[str]]:
    title = f"{h['cell_id']}   (cell {h['cell_index'] + 1} of {h['n_cells']})"
    bits = [f"activity: {h['activity_kind']}", f"{h['duration_s']:.0f} s at {h['fs']:g} Hz"]
    if h["n_events"] is not None:
        bits.append(f"{h['n_events']} events, {h['mean_rate_hz']:.3g} Hz")
    else:
        bits.append(f"mean {h['mean_activity']:.3g}")
    lines = ["   |   ".join(bits)]
    extra = [
        f"{k} = {v:.3g}" if isinstance(v, float) else f"{k} = {v}" for k, v in h["meta"].items()
    ]
    if "centroid_x" in h:
        extra.append(f"footprint centroid = ({h['centroid_x']:.0f}, {h['centroid_y']:.0f}) px")
    if extra:
        lines.append("   |   ".join(extra))
    return title, lines


def _draw_header(ax: Any, h: dict[str, Any]) -> None:
    ax.axis("off")
    title, lines = _header_lines(h)
    ax.text(0.0, 0.95, title, fontsize=12, fontweight="bold", va="top", transform=ax.transAxes)
    y = 0.50
    for line in lines:
        ax.text(0.0, y, line, fontsize=8, va="top", color="0.25", transform=ax.transAxes)
        y -= 0.28


def _draw_trace(ax: Any, tr: dict[str, Any]) -> None:
    t, act = tr["t"], tr["activity"]
    ax.plot(t, act, lw=0.6, color="0.15")
    fin = act[np.isfinite(act)]
    lo, hi = (float(fin.min()), float(fin.max())) if fin.size else (0.0, 1.0)
    if hi <= lo:
        hi = lo + 1.0
    rib = tr["ribbon"]
    band = 0.07
    frac = band * len(rib)
    ax.set_ylim(lo - frac / (1 - frac) * (hi - lo), hi + 0.04 * (hi - lo))
    ax.set_yticks([v for v in ax.get_yticks() if lo - 1e-9 <= v <= hi + 1e-9])
    ax.set_xlim(float(t[0]), float(t[-1]))
    xform = ax.get_xaxis_transform()
    handles: list[Patch] = []
    for k, r in enumerate(rib):
        pal = np.array([to_rgba(c) for c in r["colors"]] + [(1, 1, 1, 1)])
        lab = np.asarray(r["labels"])
        img = pal[np.where(lab >= 0, lab, len(r["colors"]))]
        img[~np.asarray(r["support"], bool)] = _GREY
        y0 = k * band
        ax.imshow(
            img[None],
            extent=(float(t[0]), float(t[-1]), y0, y0 + band),
            transform=xform,
            aspect="auto",
            interpolation="nearest",
            zorder=1,
        )
        ax.text(
            float(t[0]), y0 + band / 2, f" {r['name']}", transform=xform, fontsize=6,
            va="center", ha="left", color="0.1", zorder=3,
        )  # fmt: skip
        used = np.unique(lab[lab >= 0])
        handles += [
            Patch(
                facecolor=r["colors"][i],
                edgecolor="none",
                label=f"{r['name']}: {r['state_names'][i]}",
            )
            for i in used[:8]
        ]
    ax.set_xlim(float(t[0]), float(t[-1]))
    exc = _runs(tr["excluded"])
    if exc:
        dt = float(np.median(np.diff(t))) if t.size > 1 else 1.0
        ax.broken_barh(
            [(float(t[a]), n * dt) for a, n in exc],
            (0.0, 1.0),
            transform=xform,
            facecolor="none",
            edgecolor="0.55",
            hatch="////",
            lw=0,
            zorder=2,
        )
        handles.append(Patch(facecolor="none", edgecolor="0.55", hatch="////", label="excluded"))
    if handles:
        ax.legend(
            handles=handles, ncol=min(len(handles), 8), fontsize=6, loc="lower left",
            bbox_to_anchor=(0.0, 1.0), borderaxespad=0.2, handlelength=1.0, columnspacing=1.0,
        )  # fmt: skip
    ax.set_xlabel("time (s)")
    ax.set_ylabel(f"activity\n({tr['units']})", fontsize=8)


def _tick_fmt(v: float) -> str:
    return f"{v:.3g}"


def _draw_rate_map(ax: Any, d: dict[str, Any], *, halves: bool = False) -> None:
    lay = d["layout"]
    cm = heatmap_cmap(bad=d["unvisited_color"])
    if halves:
        a, b = d["maps_a"][0], d["maps_b"][0]
        vmin, vmax = float(d["vmin"][0]), float(d["vmax"][0])
    else:
        a, b = d["rate_maps"][0], None
        vmin, vmax = float(d["vmin"]), float(d["vmax"])
    if lay == "grid2d":
        pieces = [a.T]
        if b is not None:
            pieces = [a.T, np.full((a.T.shape[0], 1), np.nan), b.T]
        img = np.hstack(pieces)
        ax.imshow(
            np.ma.masked_invalid(img), origin="lower", cmap=cm, aspect="auto", vmin=vmin, vmax=vmax
        )
        if b is not None:
            na = a.T.shape[1]
            ax.set_xticks([(na - 1) / 2, na + 1 + (na - 1) / 2], ["half A", "half B"])
        else:
            ax.set_xticks([])
        ax.set_yticks([])
        xe = d["axis_labels"]
        ax.set_xlabel(f"{xe[0]}\n{vmin:.2g} to {vmax:.2g} {d['rate_label']}", fontsize=7)
        ax.set_ylabel(xe[1], fontsize=7)
    elif lay == "grid1d":
        x = d["centers"][0]
        ax.plot(x, a, color="C0", label="half A" if halves else None)
        if b is not None:
            ax.plot(x, b, color="C1", label="half B")
            ax.legend(fontsize=6)
        for i in np.flatnonzero(np.isnan(a)):
            ax.axvspan(
                d["edges"][0][i], d["edges"][0][i + 1], color=UNVISITED_COLOR, lw=0, zorder=0
            )
        ax.set_xlabel(d["axis_labels"][0], fontsize=7)
        ax.set_ylabel(d["rate_label"], fontsize=7)
    else:
        idx = np.arange(len(a))
        w = 0.4 if b is not None else 0.7
        ax.bar(
            idx - (w / 2 if b is not None else 0),
            np.nan_to_num(a),
            w,
            color="C0",
            label="half A" if b is not None else None,
        )
        if b is not None:
            ax.bar(idx + w / 2, np.nan_to_num(b), w, color="C1", label="half B")
            ax.legend(fontsize=6)
        ax.set_xticks(idx, d["state_names"], rotation=45, ha="right", fontsize=6)
        ax.set_ylabel(d["rate_label"], fontsize=7)
    ax.tick_params(labelsize=6)


def _draw_state_bars(ax: Any, d: dict[str, Any]) -> None:
    vals = np.asarray(d["values"], float)
    x = np.arange(vals.size)
    lo, hi = d["null_lo"], d["null_hi"]
    if lo is not None:
        lo, hi = np.asarray(lo, float), np.asarray(hi, float)
        ok = np.isfinite(lo) & np.isfinite(hi)
        ax.bar(x[ok], (hi - lo)[ok], 0.9, bottom=lo[ok], color=NULL_COLOR, alpha=0.6, lw=0, zorder=1,
               label="null range")  # fmt: skip
    edge = ["black" if i == d["selected"] else "none" for i in x]
    base = d["baseline"] or 0.0
    ax.bar(x, np.nan_to_num(vals, nan=base) - base, 0.55, bottom=base, color=d["colors"],
           edgecolor=edge, lw=1.0, zorder=2)  # fmt: skip
    if d["baseline"] is not None:
        ax.axhline(d["baseline"], color="0.4", lw=0.7, ls="--", zorder=0)
    sig = d["significant"]
    if sig is not None and np.any(sig):
        s = np.asarray(sig, bool)
        mark_significant(ax, x[s], vals[s], zorder=5)
    ax.set_xticks(x, d["state_names"], rotation=45, ha="right", fontsize=6)
    ax.set_ylabel(d["ylabel"], fontsize=7)
    ax.tick_params(axis="y", labelsize=6)


def _draw_metric_bar(ax: Any, d: dict[str, Any]) -> None:
    base = d["baseline"] or 0.0
    ax.bar([0], [d["value"] - base], 0.5, bottom=base, color="C0", zorder=2)
    if d["null_lo"] is not None:
        ax.bar([0], [d["null_hi"] - d["null_lo"]], 0.9, bottom=[d["null_lo"]], color=NULL_COLOR,
               alpha=0.6, lw=0, zorder=1, label="null range")  # fmt: skip
    if d["baseline"] is not None:
        ax.axhline(d["baseline"], color="0.4", lw=0.7, ls="--")
    if d["significant"]:
        mark_significant(ax, [0], [d["value"]], zorder=5)
    ax.set_xticks([])
    ax.set_xlim(-1, 1)
    ax.set_ylabel(d["ylabel"], fontsize=7)
    ax.tick_params(axis="y", labelsize=6)


def _draw_peth(ax: Any, d: dict[str, Any]) -> None:
    t = np.asarray(d["time_s"], float)
    b0, b1 = d["baseline_window_s"]
    r0, r1 = d["response_window_s"]
    ax.axvspan(b0, b1, color=BASELINE_SHADE, lw=0, zorder=0, label="baseline")
    ax.axvspan(r0, r1, color=RESPONSE_SHADE, alpha=0.25, lw=0, zorder=0, label="response")
    ax.axvline(0, color="0.4", lw=0.7, ls=":")
    if not d["valid"][0]:
        ax.text(0.5, 0.5, "too few events", ha="center", va="center", transform=ax.transAxes)
        return
    m = d["peth"][0, 0]
    ax.plot(t, m, color="C0", lw=1.2, zorder=3)
    if d["sem"] is not None:
        s = d["sem"][0, 0]
        ax.fill_between(t, m - s, m + s, color="C0", alpha=0.25, lw=0, zorder=2)
    ax.text(0.98, 0.95, f"n = {int(d['n_events'][0])} events", ha="right", va="top", fontsize=6,
            transform=ax.transAxes)  # fmt: skip
    ax.set_xlabel(d["time_label"], fontsize=7)
    ax.set_ylabel(d["units"], fontsize=7)
    ax.legend(fontsize=6, loc="upper left")
    ax.tick_params(labelsize=6)


def _draw_joint(ax: Any, d: dict[str, Any]) -> None:
    pan = np.asarray(d["panels"][0], float)  # (n_states, n_levels)
    cm = heatmap_cmap(d["cmap"])
    ax.imshow(
        np.ma.masked_invalid(pan.T),
        origin="lower",
        aspect="auto",
        cmap=cm,
        vmin=d["vmin"],
        vmax=d["vmax"],
    )
    names = d.get("state_names")
    if names is not None and len(names) <= 10:
        ax.set_xticks(np.arange(len(names)), names, rotation=45, ha="right", fontsize=6)
        ax.set_xlabel(f"state\ncolour: {d['cbar_label']}", fontsize=6.5)
    else:
        ax.set_xticks([])
        ax.set_xlabel(
            f"state index (0 to {pan.shape[0] - 1})\ncolour: {d['cbar_label']}", fontsize=6.5
        )
    ax.set_ylabel(d["ylabel"], fontsize=7)
    ax.tick_params(axis="y", labelsize=6)


def _draw_evidence(ax: Any, p: dict[str, Any]) -> None:
    kind, d = p["kind"], p["data"]
    if kind == "rate_map":
        _draw_rate_map(ax, d)
    elif kind == "split_half":
        _draw_rate_map(ax, d, halves=True)
    elif kind == "state_bars":
        _draw_state_bars(ax, d)
    elif kind == "peth":
        _draw_peth(ax, d)
    elif kind == "joint_histogram":
        _draw_joint(ax, d)
    else:
        _draw_metric_bar(ax, d)
    sig = p["significant"]
    ax.set_title(f"{p['title']}\n{p['p_text']}", fontsize=7.5, color="black" if sig else "0.35",
                 fontweight="bold" if sig else "normal")  # fmt: skip


def _draw_null(ax: Any, p: dict[str, Any], null: dict[str, Any] | None) -> None:
    if null is None:
        ax.axis("off")
        ax.text(0.5, 0.5, p["null_text"], ha="center", va="center", fontsize=7, color="0.25",
                transform=ax.transAxes)  # fmt: skip
        return
    vals = np.asarray(null["null"], float)
    ax.hist(vals, bins=null["bins"], color=NULL_COLOR, lw=0)
    for v in (null["null_lo"], null["null_hi"]):
        ax.axvline(v, color="0.4", lw=0.7, ls="--")
    ax.axvline(null["observed"], color=OBSERVED_COLOR, lw=1.8, label="observed")
    ax.set_xlabel(null["xlabel"], fontsize=7)
    ax.set_ylabel("shuffles", fontsize=7)
    ax.set_title(p["null_title"], fontsize=6.5, color="0.35")
    ax.tick_params(labelsize=6)


def _draw_table(ax: Any, table: list[dict[str, Any]]) -> None:
    ax.axis("off")
    cols = [("analysis", 0.0), ("value", 0.40), ("p", 0.52), ("p adj", 0.64), ("significant", 0.78),
            ("rank", 0.91)]  # fmt: skip
    n = len(table) + 1
    ys = [1 - (i + 0.5) / n for i in range(n)]
    for name, x in cols:
        ax.text(
            x, ys[0], name, fontsize=7.5, fontweight="bold", va="center", transform=ax.transAxes
        )
    ax.plot([0, 1], [1 - 1 / n] * 2, color="0.6", lw=0.6, transform=ax.transAxes, clip_on=False)
    for row, y in zip(table, ys[1:], strict=True):
        shade = "black" if row["shown"] else "0.55"
        name = row["analysis"] + (f" [{row['state']}]" if row["state"] else "")
        corr = row["p"] != row["p_adj"] and np.isfinite(row["p_adj"])
        cells = [
            name,
            f"{row['value']:.3g}",
            fmt_p(row["p"]).replace("p=", "") if np.isfinite(row["p"]) else "-",
            (fmt_p(row["p_adj"]).replace("p=", "") if corr else "-"),
            "yes" if row["significant"] else ("no" if np.isfinite(row["p"]) else "-"),
            f"{row['rank']} / {row['n_cells']}" if row["rank"] > 0 else "-",
        ]
        for (_, x), txt in zip(cols, cells, strict=True):
            ax.text(x, y, txt, fontsize=7, va="center", color=shade, transform=ax.transAxes,
                    fontweight="bold" if (txt == "yes") else "normal")  # fmt: skip


def plot_cell_card(
    session: Session,
    results: ResultSet | Sequence[MetricResult],
    cell: int | str,
    *,
    max_analyses: int = 6,
    t_range: tuple[float, float] | None = None,
    figsize: tuple[float, float] | None = None,
) -> Figure:
    """One figure for one cell: what it is tuned to and how strong the evidence is.

    Top to bottom: a header strip (id, activity kind and event count or rate, cell
    metadata, footprint centroid); the activity trace over the session with behaviour
    ribbons (up to two non-grid state spaces) and hatched excluded frames; one evidence
    panel per analysis, significant ones first (rate map, split-half maps, per-state bars
    with the null range, PETH, joint histogram, or a single bar); beneath each the null
    histogram with the observed value (or the numbers as text when the null draws were
    not kept); and a table with one row per analysis giving the value, p, adjusted p and
    the rank of this cell among all cells.

    Look for: a panel whose title is bold (significant after any correction) *and* whose
    picture shows the structure the number claims (a compact field, a bar clearly outside
    the grey null range, a PETH with the response inside the shaded window).  A small p
    with an unremarkable picture, or a rank far from 1, deserves suspicion.  Light-grey
    bins in maps were never visited and are not zero; "(floor)" in a p means no surrogate
    reached the observed value, so the p is limited by the number of shuffles.

    Parameters
    ----------
    session : Session
    results : ResultSet or sequence of MetricResult
        Cell-level results; see :func:`plot_cell_card_data` for how they are ordered.
    cell : int or str
        Cell index or cell id.
    max_analyses : int, default 6
        Evidence panels shown; the table always lists every analysis.
    t_range : (float, float), optional
        Window of the trace in seconds.
    figsize : (float, float), optional
        Default grows with the number of panels.

    Returns
    -------
    matplotlib.figure.Figure
        ``3 + 2 * n_panels`` axes: header, trace, evidence and null per panel, table.
    """
    d = plot_cell_card_data(session, results, cell, max_analyses=max_analyses, t_range=t_range)
    panels, nulls = d["panels"], d["nulls"]
    n = max(len(panels), 1)
    n_rows = len(d["table"])
    if figsize is None:
        figsize = (max(7.5, 2.9 * n + 0.6), 8.6 + 0.2 * n_rows)
    with use_style():
        fig = plt.figure(figsize=figsize)
        gs = fig.add_gridspec(5, n, height_ratios=[0.6, 1.5, 2.6, 1.6, 0.3 * (n_rows + 1)])
        _draw_header(fig.add_subplot(gs[0, :]), d["header"])
        _draw_trace(fig.add_subplot(gs[1, :]), d["trace"])
        for k, (p, null) in enumerate(zip(panels, nulls, strict=True)):
            _draw_evidence(fig.add_subplot(gs[2, k]), p)
            _draw_null(fig.add_subplot(gs[3, k]), p, null)
        _draw_table(fig.add_subplot(gs[4, :]), d["table"])
        if d["n_analyses_total"] > len(panels):
            fig.supxlabel(
                f"{len(panels)} of {d['n_analyses_total']} analyses shown (see table)",
                fontsize=7, x=0.01, ha="left", color="0.4",
            )  # fmt: skip
    return fig


# --------------------------------------------------------------------------- #
# many cards
# --------------------------------------------------------------------------- #


def _cell_ranking(
    session: Session, results: Sequence[MetricResult]
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """``(order, n_sig, min_p)``: cells ordered by analyses significant in, then min p."""
    n = session.n_cells
    n_sig = np.zeros(n, int)
    min_p = np.full(n, np.inf)
    for r in results:
        sig, minp = _cell_level(r)
        n_sig += sig
        min_p = np.minimum(min_p, np.where(np.isfinite(minp), minp, np.inf))
    order = np.lexsort((np.arange(n), min_p, -n_sig))
    return order, n_sig, min_p


def plot_cell_cards(
    session: Session,
    results: ResultSet | Sequence[MetricResult],
    cells: Sequence[int | str] | str | int = "significant",
    *,
    max_cards: int = 12,
    out_dir: str | Path | None = None,
    fmt: str = "png",
    dpi: int = 130,
    **kw: Any,
) -> dict[str, Figure | Path]:
    """Cell cards for several cells, optionally written to disk.

    Parameters
    ----------
    session, results
        As for :func:`plot_cell_card`.
    cells : sequence of int or str, ``"significant"``, ``"all"`` or int, default "significant"
        Which cells.  ``"significant"``: cells significant in any analysis (adjusted
        when a correction was applied), ordered by the number of analyses they are
        significant in, then by smallest p.  ``"all"``: every cell in that order.  An int
        ``k``: the top ``k`` in that order.  A sequence is used as given.
    max_cards : int, default 12
        More requested cells are truncated to this many with a ``UserWarning``.
    out_dir : path, optional
        Save ``out_dir/<cell_id>.<fmt>`` (figures are then closed) and return the paths.
    fmt : str, default "png"
    dpi : int, default 130
    **kw
        Passed to :func:`plot_cell_card` (``max_analyses``, ``t_range``, ``figsize``).

    Returns
    -------
    dict
        ``{cell_id: Figure}`` (open figures; close them when done) or, with
        ``out_dir``, ``{cell_id: Path}``.  Look for: the cards at the top answer
        "what is it tuned to"; compare their picture panels, not just their p-values.
    """
    res = _cell_results(session, results)
    order, n_sig, _ = _cell_ranking(session, res)
    if isinstance(cells, str):
        if cells == "significant":
            idx = [int(i) for i in order if n_sig[i] > 0]
        elif cells == "all":
            idx = [int(i) for i in order]
        else:
            raise ValueError(f"cells must be a list, an int, 'significant' or 'all', got {cells!r}")
    elif isinstance(cells, (int, np.integer)) and not isinstance(cells, bool):
        idx = [int(i) for i in order[: max(int(cells), 0)]]
    else:
        idx = [_resolve_cell(session, res, c) for c in cells]
    if len(idx) > max_cards:
        warnings.warn(
            f"{len(idx)} cell cards requested; drawing the first {max_cards} (max_cards)",
            UserWarning,
            stacklevel=2,
        )
        idx = idx[:max_cards]
    figs = {_cell_id(session, c): plot_cell_card(session, res, c, **kw) for c in idx}
    if out_dir is None:
        return dict(figs)
    paths = save_figures(figs, out_dir, fmt=fmt, dpi=dpi)
    return dict(zip(figs, paths, strict=True))
