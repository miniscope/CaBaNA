"""Evidence-first "missing views": activity raster, population tuning, session QA, agreement.

Each renderer has a ``plot_<x>_data`` companion (see :mod:`cabana._plot_data`) and draws only
from the dict it returns.  ``population_tuning`` is registered in the plot registry; the
raster, QA and agreement figures are session / resultset level and are not.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import to_rgba
from matplotlib.figure import Figure
from matplotlib.patches import Rectangle

from ._models import Session, StateSpace
from ._plot_data import PLOT_DATA_VERSION
from ._plot_registry import register_plot
from ._plot_style import UNVISITED_COLOR, axis_label, mark_significant, state_colors
from ._results import MetricResult, ResultSet
from ._util import runs

__all__ = [
    "plot_activity_raster",
    "plot_activity_raster_data",
    "plot_analysis_agreement",
    "plot_analysis_agreement_data",
    "plot_population_tuning",
    "plot_population_tuning_data",
    "plot_session_qa",
    "plot_session_qa_data",
]

_EVENT_KINDS = ("spike_counts", "binary")
_GREY = (0.6, 0.6, 0.6, 1.0)


def _get_ax(ax: Any, figsize: tuple[float, float]) -> tuple[Figure, Any]:
    if ax is None:
        fig, ax = plt.subplots(figsize=figsize, layout="constrained")
        return fig, ax
    return ax.figure, ax


def _note(ax: Any, text: str) -> None:
    ax.text(0.5, 0.5, text, ha="center", va="center", transform=ax.transAxes, color="0.4")
    ax.set_xticks([])
    ax.set_yticks([])
    for s in ax.spines.values():
        s.set_visible(False)


def _hex(c: Any) -> str:
    from matplotlib.colors import to_hex

    return to_hex(c, keep_alpha=False)


# --------------------------------------------------------------------------- #
# 1. activity raster with behaviour ribbon
# --------------------------------------------------------------------------- #


def _frame_labels(space: StateSpace) -> np.ndarray:
    """Integer state per frame (first active state for overlapping spaces), -1 for none."""
    if space.exclusive:
        return space.labels()
    lab = np.full(space.n_time, -1, dtype=np.int64)
    has = space.onehot.any(axis=1)
    lab[has] = space.onehot[has].argmax(axis=1)
    return lab


def _resolve_cells(session: Session, cells: Any) -> np.ndarray:
    if cells is None:
        return np.arange(session.n_cells)
    arr = list(cells)
    if arr and isinstance(arr[0], str):
        ids = [str(c) for c in (session.cell_ids or range(session.n_cells))]
        return np.array([ids.index(str(c)) for c in arr], dtype=int)
    return np.asarray(arr, dtype=int)


def plot_activity_raster_data(
    session: Session,
    *,
    cells: Sequence[int] | Sequence[str] | None = None,
    max_cells: int = 60,
    t_range: tuple[float, float] | None = None,
    states: Sequence[str] | None = None,
    sort_by: Any = None,
    show_masks: bool = True,
) -> dict[str, Any]:
    """Everything :func:`plot_activity_raster` draws.

    Returns
    -------
    dict
        ``activity`` (cells, time), ``t`` (s), ``cell_ids``, ``ribbon`` (list of
        ``{name, labels, state_names, colors, support}``), ``masks`` (list of
        ``{name, excluded}``), ``units``, ``vmin``, ``vmax``, ``activity_kind``.
    """
    idx = _resolve_cells(session, cells)
    t = np.asarray(session.t, float)
    if t_range is None:
        fr = np.arange(t.size)
    else:
        fr = np.flatnonzero((t >= t_range[0]) & (t <= t_range[1]))
        if fr.size == 0:
            raise ValueError(f"t_range {t_range} contains no frames")
    if sort_by is not None:
        if isinstance(sort_by, MetricResult):
            v = np.asarray(sort_by.values, float)
            if v.ndim != 1 or v.shape[0] != session.n_cells:
                raise ValueError("sort_by MetricResult must have 1-D per-cell values")
            key = np.where(np.isfinite(v[idx]), v[idx], -np.inf)
        elif isinstance(sort_by, str) and sort_by == "peak":
            sub = np.asarray(session.activity)[idx][:, fr]
            key = np.where(
                np.isfinite(sub).any(1), np.nanargmax(np.nan_to_num(sub, nan=-np.inf), 1), 0
            )
            key = -key.astype(float)  # earliest peak first (descending key)
        else:
            raise ValueError("sort_by must be None, 'peak' or a MetricResult")
        idx = idx[np.argsort(-key, kind="stable")]
    idx = idx[:max_cells]
    act = np.asarray(session.activity, float)[idx][:, fr]
    fin = act[np.isfinite(act)]
    if fin.size:
        vmin, vmax = (float(v) for v in np.percentile(fin, [1, 99]))
        if vmax <= vmin:
            vmin, vmax = float(fin.min()), float(fin.max())
        if vmax <= vmin:
            vmax = vmin + 1.0
    else:
        vmin, vmax = 0.0, 1.0
    ids = [str(c) for c in (session.cell_ids or range(session.n_cells))]
    names = list(session.states) if states is None else list(states)
    if states is None:
        names = [n for n in names if session.states[n].kind != "grid"][:3]
    ribbon = []
    for n in names:
        if n not in session.states:
            raise KeyError(f"no state space {n!r} in session; have {list(session.states)}")
        sp = session.states[n]
        cols = state_colors(sp)
        sup = np.ones(sp.n_time, bool) if sp.support is None else np.asarray(sp.support, bool)
        ribbon.append(
            {
                "name": n,
                "labels": _frame_labels(sp)[fr],
                "state_names": [str(s) for s in sp.state_names],
                "colors": [_hex(cols[str(s)]) for s in sp.state_names],
                "support": sup[fr],
            }
        )
    masks = (
        [{"name": k, "excluded": ~np.asarray(m, bool)[fr]} for k, m in session.masks.items()]
        if show_masks
        else []
    )
    return {
        "kind": "activity_raster",
        "version": PLOT_DATA_VERSION,
        "activity": act,
        "t": t[fr],
        "cell_ids": [ids[i] for i in idx],
        "cell_index": idx,
        "ribbon": ribbon,
        "masks": masks,
        "units": f"{session.activity_kind}",
        "activity_kind": session.activity_kind,
        "vmin": vmin,
        "vmax": vmax,
    }


def _ribbon_image(d: dict[str, Any]) -> tuple[np.ndarray, list[str]]:
    rows, names = [], []
    nt = d["t"].size
    for r in d["ribbon"]:
        pal = np.array([to_rgba(c) for c in r["colors"]] + [(1, 1, 1, 1)])
        img = pal[np.where(r["labels"] >= 0, r["labels"], len(r["colors"]))]
        img[~r["support"]] = _GREY
        rows.append(img)
        names.append(r["name"])
    for m in d["masks"]:
        img = np.ones((nt, 4))
        img[m["excluded"]] = _GREY
        rows.append(img)
        names.append(f"mask: {m['name']}")
    return (np.stack(rows) if rows else np.zeros((0, nt, 4))), names


def plot_activity_raster(
    session: Session,
    *,
    cells: Sequence[int] | Sequence[str] | None = None,
    max_cells: int = 60,
    t_range: tuple[float, float] | None = None,
    states: Sequence[str] | None = None,
    sort_by: Any = None,
    show_masks: bool = True,
    ax: Any = None,
) -> Figure:
    """Cells-by-time activity heatmap with a behaviour ribbon underneath.

    Event-type activity (spike counts, binary) is drawn black on white; continuous
    activity uses a robust colour range (1st to 99th percentile).  Below the raster
    each requested state space is one coloured row (grey where the space is not
    defined) and each session mask is a row with excluded frames in grey.  Look for:
    activity bursts that line up with a behaviour colour, and whether excluded
    (grey) stretches coincide with the activity you are about to interpret.

    Parameters
    ----------
    session : Session
    cells : sequence of int or str, optional
        Cell indices or ids (default all), at most ``max_cells`` shown.
    max_cells : int, default 60
    t_range : (float, float), optional
        Seconds to show.
    states : sequence of str, optional
        State spaces for the ribbon (default: up to 3 non-grid spaces).
    sort_by : MetricResult or "peak", optional
        Sort cells by a 1-D result's values (descending) or by time of peak activity.
    show_masks : bool, default True
        Add one ribbon row per session mask.
    ax : matplotlib Axes, optional
        Draw the raster here; the ribbon is attached below it.

    Returns
    -------
    matplotlib.figure.Figure
    """
    d = plot_activity_raster_data(
        session,
        cells=cells,
        max_cells=max_cells,
        t_range=t_range,
        states=states,
        sort_by=sort_by,
        show_masks=show_masks,
    )
    img, rnames = _ribbon_image(d)
    nr = len(rnames)
    t = d["t"]
    dt = float(np.median(np.diff(t))) if t.size > 1 else 1.0
    ext_x = (t[0] - dt / 2, t[-1] + dt / 2)
    if ax is None:
        fig = plt.figure(figsize=(8.0, 3.2 + 0.22 * nr), layout="constrained")
        gs = fig.add_gridspec(2 if nr else 1, 1, height_ratios=[10, max(nr, 1)] if nr else [1])
        ax = fig.add_subplot(gs[0])
        rax = fig.add_subplot(gs[1], sharex=ax) if nr else None
    else:
        fig = ax.figure
        rax = ax.inset_axes([0, -0.04 - 0.05 * nr, 1, 0.05 * nr], sharex=ax) if nr else None
    event = d["activity_kind"] in _EVENT_KINDS
    n = d["activity"].shape[0]
    im = ax.imshow(
        np.ma.masked_invalid(d["activity"]),
        aspect="auto",
        interpolation="nearest",
        cmap="Greys" if event else "viridis",
        vmin=d["vmin"],
        vmax=d["vmax"],
        extent=(ext_x[0], ext_x[1], n - 0.5, -0.5),
    )
    im.set_cmap(im.cmap.with_extremes(bad=UNVISITED_COLOR))
    ax.set_ylabel("cell")
    if n <= 40:
        ax.set_yticks(range(n), d["cell_ids"])
    ax.set_title(f"Activity ({d['activity_kind']}), {n} cells")
    if rax is not None:
        ax.tick_params(labelbottom=False)
        rax.imshow(
            img, aspect="auto", interpolation="nearest", extent=(ext_x[0], ext_x[1], nr - 0.5, -0.5)
        )
        rax.set_yticks(range(nr), rnames)
        rax.set_xlabel(axis_label("time", "s"))
        for i, m in enumerate(d["masks"]):
            row = len(d["ribbon"]) + i
            s, ln = runs(m["excluded"])
            for a, b in zip(s[:200], ln[:200], strict=False):
                rax.add_patch(
                    Rectangle(
                        (t[a] - dt / 2, row - 0.5),
                        b * dt,
                        1,
                        fill=False,
                        hatch="///",
                        lw=0,
                        ec="0.3",
                    )
                )
        for r_i, r in enumerate(d["ribbon"]):
            used = sorted({int(v) for v in np.unique(r["labels"]) if v >= 0})[:8]
            if used and len(r["state_names"]) <= 8:
                txt = " ".join(r["state_names"][u] for u in used)
                rax.text(
                    1.005,
                    1 - (r_i + 0.5) / nr,
                    txt,
                    transform=rax.transAxes,
                    fontsize=6,
                    va="center",
                )
        for s_ in ("top", "right"):
            rax.spines[s_].set_visible(False)
    else:
        ax.set_xlabel(axis_label("time", "s"))
    return fig


# --------------------------------------------------------------------------- #
# 2. population tuning
# --------------------------------------------------------------------------- #


def _applies(result: MetricResult) -> bool:
    """True when ``result`` is a cell-level result with a (cells, states) matrix to show."""
    return result.level == "cell" and ("rate_map" in result.extras or np.ndim(result.values) == 2)


def _tuning_matrix(result: MetricResult) -> np.ndarray:
    if result.level != "cell":
        raise ValueError(f"population_tuning needs a cell-level result, got {result.level!r}")
    if "rate_map" in result.extras:
        m = np.asarray(result.extras["rate_map"], float)
    elif np.ndim(result.values) == 2:
        m = np.asarray(result.values, float)
    else:
        raise ValueError(
            "population_tuning needs extras['rate_map'] or 2-D values (cells x states); "
            f"{result.name!r} has neither"
        )
    if m.ndim != 2:
        raise ValueError(f"rate_map must be (cells, states), got shape {m.shape}")
    return m


def _significant_cells(result: MetricResult, n: int) -> np.ndarray:
    sh = result.shuffle
    if sh is None:
        return np.zeros(n, bool)
    use_adj = sh.correction != "none" and sh.significant_adj is not None
    sig = np.asarray(sh.significant_adj if use_adj else sh.significant, bool)
    return sig.reshape(sig.shape[0], -1).any(axis=1) if sig.ndim > 1 else sig


def plot_population_tuning_data(
    result: MetricResult,
    session: Session | None = None,
    *,
    sort_by: str | None = "peak",
    normalize: bool = True,
    max_cells: int = 200,
) -> dict[str, Any]:
    """Everything :func:`plot_population_tuning` draws.

    Returns
    -------
    dict
        ``matrix`` (rows already sorted/subsampled, NaN = no data), ``order`` (original
        cell index per row), ``cell_ids``, ``state_names``, ``x`` (bin centres for a 1-D grid,
        else column index), ``x_label``, ``significant`` (per row), ``normalized``,
        ``n_cells_total``.
    """
    raw = _tuning_matrix(result)
    n, ns = raw.shape
    m = raw.copy()
    if normalize:
        with np.errstate(all="ignore"):
            lo = np.nanmin(np.where(np.isfinite(m), m, np.inf), axis=1, keepdims=True)
            hi = np.nanmax(np.where(np.isfinite(m), m, -np.inf), axis=1, keepdims=True)
            rng = hi - lo
            m = np.where(
                rng > 0, (m - lo) / np.where(rng > 0, rng, 1), np.where(np.isfinite(m), 0.0, np.nan)
            )
    if sort_by == "peak":
        filled = np.where(np.isfinite(m), m, -np.inf)
        am = filled.argmax(axis=1)
        mx = filled.max(axis=1)
        mx = np.where(np.isfinite(mx), mx, -np.inf)
        order = np.lexsort((-mx, am))
    elif sort_by is None:
        order = np.arange(n)
    else:
        raise ValueError("sort_by must be 'peak' or None")
    if order.size > max_cells:
        order = order[np.unique(np.linspace(0, order.size - 1, max_cells).round().astype(int))]
    space = session.states.get(result.target) if session is not None else None
    names = result.state_names or (list(space.state_names) if space is not None else None)
    names = (
        [str(s) for s in names]
        if names is not None and len(names) == ns
        else [str(i) for i in range(ns)]
    )
    x: np.ndarray = np.arange(ns, dtype=float)
    x_label = "state"
    topo = space.topology if space is not None else None
    if topo is not None and topo.n_states == ns:
        if topo.ndim == 1:
            x = np.asarray(topo.centers()[0], float)
            nm = topo.axis_names[0]
            beh = session.behavior.get(nm) if session is not None else None
            x_label = axis_label(nm, getattr(beh, "units", "") or None)
        else:
            x_label = "bin"
    ids = result.cell_ids or (
        list(session.cell_ids) if session is not None and session.cell_ids else None
    )
    ids = [str(c) for c in ids] if ids is not None and len(ids) == n else [str(i) for i in range(n)]
    sig = _significant_cells(result, n)
    return {
        "kind": "population_tuning",
        "version": PLOT_DATA_VERSION,
        "matrix": m[order],
        "order": order,
        "cell_ids": [ids[i] for i in order],
        "state_names": names,
        "x": x,
        "x_label": x_label,
        "significant": sig[order],
        "normalized": bool(normalize),
        "n_cells_total": int(n),
        "title": f"{result.name or result.metric}: population tuning",
    }


def _tuning_defaults(result: MetricResult, session: Any) -> dict[str, Any]:
    return {}


@register_plot(
    "population_tuning",
    data=plot_population_tuning_data,
    needs_session=True,
    level="cell",
    requires=(),
    defaults=_tuning_defaults,
)
def plot_population_tuning(
    result: MetricResult,
    session: Session | None = None,
    *,
    sort_by: str | None = "peak",
    normalize: bool = True,
    show_ids: bool = True,
    max_cells: int = 200,
    ax: Any = None,
) -> Figure:
    """Cells-by-states tuning image, rows peak-normalised and sorted by preferred state.

    Needs ``extras["rate_map"]`` or 2-D values.  Rows are min-max scaled to 0..1 when
    ``normalize``; a significant cell (adjusted p when a correction was applied) carries
    the shared marker at the right edge.  Look for: a diagonal ridge (the population
    tiles the state space) versus a smear at one edge (a few preferred states dominate).

    Parameters
    ----------
    result : MetricResult
    session : Session, optional
        Used for grid bin centres and units.
    sort_by : {"peak", None}, default "peak"
        Sort rows by preferred state, then peak value; ``None`` keeps cell order.
    normalize : bool, default True
    show_ids : bool, default True
        Cell ids on the y axis when at most 60 cells are shown.
    max_cells : int, default 200
        Evenly subsample the sorted rows above this count.
    ax : matplotlib Axes, optional

    Returns
    -------
    matplotlib.figure.Figure
    """
    d = plot_population_tuning_data(
        result, session, sort_by=sort_by, normalize=normalize, max_cells=max_cells
    )
    fig, ax = _get_ax(ax, (6.0, 5.0))
    m = d["matrix"]
    n, ns = m.shape
    cmap = plt.get_cmap("magma").with_extremes(bad=UNVISITED_COLOR)
    im = ax.imshow(
        np.ma.masked_invalid(m),
        aspect="auto",
        interpolation="nearest",
        cmap=cmap,
        vmin=0 if d["normalized"] else None,
        vmax=1 if d["normalized"] else None,
    )
    fig.colorbar(
        im, ax=ax, label="normalised response" if d["normalized"] else "response", shrink=0.8
    )
    ax.set_xlabel(d["x_label"])
    ax.set_ylabel("cell")
    numeric = d["x_label"] not in ("state", "bin") and ns > 0
    if numeric:
        k = np.unique(np.linspace(0, ns - 1, min(ns, 6)).round().astype(int))
        ax.set_xticks(k, [f"{d['x'][i]:.3g}" for i in k])
    elif d["x_label"] == "state" and ns <= 20:
        ax.set_xticks(range(ns), d["state_names"], rotation=60, ha="right")
    if show_ids and n <= 60:
        ax.set_yticks(range(n), d["cell_ids"])
    sig = np.flatnonzero(d["significant"])
    if sig.size:
        mark_significant(ax, np.full(sig.size, ns - 0.5 + 0.03 * ns), sig, clip_on=False)
    ax.set_title(d["title"])
    return fig


# --------------------------------------------------------------------------- #
# 3. session QA
# --------------------------------------------------------------------------- #


def _main_space(session: Session, states: Sequence[str] | None) -> StateSpace | None:
    names = [n for n in (states if states is not None else session.states) if n in session.states]
    if not names:
        return None
    for n in names:
        if session.states[n].kind == "grid":
            return session.states[n]
    return session.states[names[0]]


def plot_session_qa_data(
    session: Session, *, states: Sequence[str] | None = None
) -> dict[str, Any]:
    """Everything :func:`plot_session_qa` draws, as one nested dict per panel.

    Panels absent from the session are ``None`` and listed in ``notes``.
    """
    notes: list[str] = []
    fs = float(session.fs)
    sp = _main_space(session, states)
    occ = None
    if sp is not None:
        sec = sp.occupancy().astype(float) / fs
        img = None
        topo = sp.topology
        if topo is not None and topo.ndim == 2:
            img = np.where(sec > 0, sec, np.nan).reshape(topo.shape).T
        occ = {
            "space": sp.name,
            "state_names": [str(s) for s in sp.state_names],
            "seconds": sec,
            "image": img,
            "extent": (
                [
                    float(topo.edges[0][0]),
                    float(topo.edges[0][-1]),
                    float(topo.edges[1][0]),
                    float(topo.edges[1][-1]),
                ]
                if img is not None
                else None
            ),
            "axis_names": list(topo.axis_names) if img is not None else None,
        }
    else:
        notes.append("no state spaces: occupancy and bouts panels empty")
    names = [n for n in (states if states is not None else session.states) if n in session.states]
    bouts = []
    for n in names:
        s = session.states[n]
        if s.kind != "bouts":
            continue
        cnt, med = [], []
        for j in range(s.n_states):
            _, ln = runs(s.onehot[:, j])
            cnt.append(int(ln.size))
            med.append(float(np.median(ln) / fs) if ln.size else np.nan)
        bouts.append(
            {
                "space": n,
                "state_names": [str(x) for x in s.state_names],
                "count": np.array(cnt),
                "median_duration_s": np.array(med),
            }
        )
    masks = None
    if session.masks:
        valid = np.ones(session.n_time, bool)
        for m in session.masks.values():
            valid &= np.asarray(m, bool)
        masks = {
            "names": list(session.masks),
            "excluded_fraction": np.array(
                [float(1 - np.mean(np.asarray(m, bool))) for m in session.masks.values()]
            ),
            "kept_after_all": float(valid.mean()),
        }
    else:
        notes.append("no masks")
    t = np.asarray(session.t, float)
    dt = np.diff(t)
    timing = None
    if dt.size:
        lo, hi = np.percentile(dt, [0.5, 99.5])
        hi = max(hi, lo + 1e-9)
        counts, edges = np.histogram(np.clip(dt, lo, hi) * 1000.0, bins=40)
        rep = session.meta.get("timing") or {}
        timing = {
            "counts": counts,
            "edges_ms": edges,
            "n_dropped_frames": rep.get("n_dropped_frames"),
            "dropped_fraction": rep.get("dropped_fraction"),
            "jitter_sd_s": rep.get("jitter_sd_s", float(np.std(dt))),
            "has_report": bool(rep),
        }
    cells = None
    key = next((k for k in ("snr", "events_per_min") if k in session.cell_meta), None)
    if key is None:
        key = next(
            (
                k
                for k, v in session.cell_meta.items()
                if np.ndim(v) == 1 and np.asarray(v).dtype.kind in "fiu"
            ),
            None,
        )
    if key is not None:
        v = np.asarray(session.cell_meta[key], float)
        fin = v[np.isfinite(v)]
        counts, edges = np.histogram(fin, bins=20) if fin.size else (np.zeros(0), np.zeros(0))
        cells = {"name": key, "values": v, "counts": counts, "edges": edges}
    else:
        notes.append("no cell_meta")
    return {
        "kind": "session_qa",
        "version": PLOT_DATA_VERSION,
        "summary": {
            "n_cells": int(session.n_cells),
            "n_time": int(session.n_time),
            "fs": fs,
            "duration_s": float(session.duration_s),
            "activity_kind": str(session.activity_kind),
        },
        "occupancy": occ,
        "bouts": bouts or None,
        "masks": masks,
        "timing": timing,
        "cells": cells,
        "notes": notes,
    }


def plot_session_qa(session: Session, *, states: Sequence[str] | None = None) -> Figure:
    """Six-panel quality check of one session: occupancy, bouts, masks, timing, cells, summary.

    Panels whose data the session lacks show a short note instead.  Look for: states
    that are barely occupied (too little data for a tuning estimate), bouts that are
    few or very short, masks that remove most frames, and a frame-interval histogram
    with a tail of dropped frames.

    Parameters
    ----------
    session : Session
    states : sequence of str, optional
        State spaces to consider (default all).

    Returns
    -------
    matplotlib.figure.Figure
    """
    d = plot_session_qa_data(session, states=states)
    fig, axs = plt.subplots(2, 3, figsize=(11.0, 6.0), layout="constrained")
    a, b, c, e, f, g = axs.ravel()
    o = d["occupancy"]
    if o is None:
        a.set_title("Occupancy")
        _note(a, "no state spaces")
    elif o["image"] is not None:
        im = a.imshow(
            np.ma.masked_invalid(o["image"]),
            origin="lower",
            aspect="equal",
            extent=o["extent"],
            cmap="viridis",
        )
        im.set_cmap(im.cmap.with_extremes(bad=UNVISITED_COLOR))
        fig.colorbar(im, ax=a, label="seconds", shrink=0.8)
        a.set_xlabel(o["axis_names"][0])
        a.set_ylabel(o["axis_names"][1])
        a.set_title(f"Occupancy: {o['space']}")
    else:
        cols = state_colors(o["state_names"])
        a.bar(range(len(o["seconds"])), o["seconds"], color=[cols[s] for s in o["state_names"]])
        if len(o["state_names"]) <= 20:
            a.set_xticks(range(len(o["state_names"])), o["state_names"], rotation=60, ha="right")
        a.set_ylabel(axis_label("occupancy", "s"))
        a.set_title(f"Occupancy: {o['space']}")
    b.set_title("Bouts")
    if d["bouts"] is None:
        _note(b, "no bouts-kind state spaces")
    else:
        lab, cnt, med = [], [], []
        for bo in d["bouts"]:
            for nm, k, m in zip(
                bo["state_names"], bo["count"], bo["median_duration_s"], strict=True
            ):
                lab.append(nm if len(d["bouts"]) == 1 else f"{bo['space']}:{nm}")
                cnt.append(k)
                med.append(m)
        x = np.arange(len(lab))
        b.bar(x, cnt, color="0.7")
        b.set_ylabel("bout count")
        b.set_xticks(x, lab, rotation=60, ha="right")
        b2 = b.twinx()
        b2.plot(x, med, "D", color="#D55E00", ms=4)
        b2.set_ylabel(axis_label("median duration", "s"), color="#D55E00")
    c.set_title("Masks")
    if d["masks"] is None:
        _note(c, "no masks")
    else:
        mk = d["masks"]
        labels = [*mk["names"], "kept after all"]
        vals = [*mk["excluded_fraction"], 1 - mk["kept_after_all"]]
        c.barh(range(len(labels)), vals, color=["0.6"] * (len(labels) - 1) + ["#0072B2"])
        c.set_yticks(range(len(labels)), labels)
        c.set_xlim(0, 1)
        c.set_xlabel("fraction of frames excluded")
        c.text(0.98, 0.02, f"kept: {mk['kept_after_all']:.1%}", transform=c.transAxes, ha="right")
    e.set_title("Frame timing")
    tm = d["timing"]
    if tm is None:
        _note(e, "fewer than two frames")
    else:
        e.stairs(tm["counts"], tm["edges_ms"], fill=True, color="0.6")
        e.set_xlabel(axis_label("frame interval", "ms"))
        e.set_ylabel("frames")
        txt = f"jitter sd {tm['jitter_sd_s'] * 1000:.2f} ms"
        if tm["n_dropped_frames"] is not None:
            txt = f"{tm['n_dropped_frames']} dropped frames\n" + txt
        e.text(0.98, 0.95, txt, transform=e.transAxes, ha="right", va="top", fontsize=8)
    f.set_title("Cells")
    ce = d["cells"]
    if ce is None or ce["counts"].size == 0:
        _note(f, "no per-cell metadata")
    else:
        f.stairs(ce["counts"], ce["edges"], fill=True, color="0.6")
        f.set_xlabel(ce["name"])
        f.set_ylabel("cells")
    s = d["summary"]
    g.set_title("Session")
    lines = [
        f"{s['n_cells']} cells, {s['n_time']} frames",
        f"{s['duration_s']:.1f} s at {s['fs']:.3g} Hz",
        f"activity: {s['activity_kind']}",
        *[f"note: {n}" for n in d["notes"]],
    ]
    _note(g, "\n".join(lines))
    return fig


# --------------------------------------------------------------------------- #
# 4. analysis agreement
# --------------------------------------------------------------------------- #


def _cell_level_results(resultset: ResultSet | Iterable[MetricResult]) -> list[MetricResult]:
    rs = list(resultset.results) if isinstance(resultset, ResultSet) else list(resultset)
    out = [r for r in rs if r.level == "cell" and r.shuffle is not None]
    if len(out) < 1:
        raise ValueError(
            "plot_analysis_agreement needs cell-level results that include a shuffle test"
        )
    n = {np.asarray(r.shuffle.p_value).shape[0] for r in out}
    if len(n) != 1:
        raise ValueError(f"results have different numbers of cells: {sorted(n)}")
    return out


def plot_analysis_agreement_data(
    resultset: ResultSet | Iterable[MetricResult],
    *,
    adjusted: bool | None = None,
    alpha: float | None = None,
    max_cells: int = 300,
    max_intersections: int = 12,
) -> dict[str, Any]:
    """Everything :func:`plot_analysis_agreement` draws.

    A cell is significant in an analysis when any of its states passes ``alpha`` using
    ``p_adj`` (``adjusted=True``, or ``None`` and that result has ``correction != "none"``)
    or the raw ``p_value``.

    Returns
    -------
    dict
        ``analysis_names``, ``cell_ids``, ``sets`` (bool, cells x analyses), ``jaccard``
        (analyses x analyses; NaN when both sets are empty), ``overlap_counts`` (sizes of
        pairwise intersections), ``n_significant``, ``intersections`` (top patterns as
        ``{pattern, count}``), ``neglog10_p`` (cells x analyses, NaN where no p),
        ``pgrid_order`` (cell rows shown by ``kind="pgrid"``).
    """
    rs = _cell_level_results(resultset)
    n = np.asarray(rs[0].shuffle.p_value).shape[0]
    names = [str(r.name or f"{r.metric}[{r.target}]") for r in rs]
    sets = np.zeros((n, len(rs)), bool)
    nlp = np.full((n, len(rs)), np.nan)
    for j, r in enumerate(rs):
        sh = r.shuffle
        use_adj = adjusted if adjusted is not None else sh.correction != "none"
        p = np.asarray(sh.p_adj if (use_adj and sh.p_adj is not None) else sh.p_value, float)
        p = p.reshape(n, -1)
        a = float(alpha if alpha is not None else sh.alpha)
        with np.errstate(invalid="ignore"):
            sets[:, j] = (p < a).any(axis=1)
            allnan = np.isnan(p).all(axis=1)
            pmin = np.where(allnan, np.nan, np.nanmin(np.where(np.isnan(p), np.inf, p), axis=1))
            nlp[:, j] = -np.log10(np.clip(pmin, 1e-300, 1.0))
    k = len(rs)
    inter = (sets[:, :, None] & sets[:, None, :]).sum(0).astype(int)
    uni = (sets[:, :, None] | sets[:, None, :]).sum(0)
    with np.errstate(invalid="ignore", divide="ignore"):
        jac = np.where(uni > 0, inter / np.where(uni > 0, uni, 1), np.nan)
    pats: dict[tuple[bool, ...], int] = {}
    for row in sets:
        if row.any():
            key = tuple(bool(v) for v in row)
            pats[key] = pats.get(key, 0) + 1
    top = sorted(pats.items(), key=lambda kv: (-kv[1], [-int(v) for v in kv[0]]))[
        :max_intersections
    ]
    nsig = sets.sum(1)
    mx = np.where(np.isfinite(nlp), nlp, -1).max(axis=1) if k else np.zeros(n)
    order = np.lexsort((-mx, -nsig))[:max_cells]
    ids = rs[0].cell_ids
    ids = [str(c) for c in ids] if ids is not None and len(ids) == n else [str(i) for i in range(n)]
    return {
        "kind": "analysis_agreement",
        "version": PLOT_DATA_VERSION,
        "analysis_names": names,
        "cell_ids": ids,
        "sets": sets,
        "jaccard": jac,
        "overlap_counts": inter,
        "n_significant": sets.sum(0).astype(int),
        "intersections": [{"pattern": list(p), "count": int(c)} for p, c in top],
        "neglog10_p": nlp,
        "pgrid_order": order,
    }


def plot_analysis_agreement(
    resultset: ResultSet | Iterable[MetricResult],
    *,
    adjusted: bool | None = None,
    alpha: float | None = None,
    kind: str = "jaccard",
    max_cells: int = 300,
) -> Figure:
    """How much the analyses agree on which cells are significant.

    ``kind="jaccard"`` draws the analysis-by-analysis Jaccard index with the
    intersection sizes annotated; ``"upset"`` the twelve most common significance
    patterns as a dot matrix over bar counts; ``"pgrid"`` the -log10 p of every cell
    (rows, sorted by how many analyses call it significant) in every analysis.  Look
    for: pairs of analyses with a low Jaccard (they flag different cells, so a cell
    called by one is weak evidence), and cells significant in many analyses (the robust
    ones).

    Parameters
    ----------
    resultset : ResultSet or iterable of MetricResult
        Cell-level results with shuffle tests.
    adjusted : bool, optional
        Use adjusted p-values; default follows each result's own ``correction``.
    alpha : float, optional
        Override each result's alpha.
    kind : {"jaccard", "upset", "pgrid"}, default "jaccard"
    max_cells : int, default 300
        Rows shown by ``"pgrid"``.

    Returns
    -------
    matplotlib.figure.Figure
    """
    if kind not in ("jaccard", "upset", "pgrid"):
        raise ValueError("kind must be 'jaccard', 'upset' or 'pgrid'")
    d = plot_analysis_agreement_data(resultset, adjusted=adjusted, alpha=alpha, max_cells=max_cells)
    names = d["analysis_names"]
    k = len(names)
    if kind == "jaccard":
        fig, ax = plt.subplots(figsize=(1.0 + 0.9 * k + 1, 0.8 + 0.8 * k + 1), layout="constrained")
        cmap = plt.get_cmap("viridis").with_extremes(bad=UNVISITED_COLOR)
        im = ax.imshow(np.ma.masked_invalid(d["jaccard"]), vmin=0, vmax=1, cmap=cmap)
        fig.colorbar(im, ax=ax, label="Jaccard index", shrink=0.8)
        for i in range(k):
            for j in range(k):
                v = d["jaccard"][i, j]
                txt = "n/a" if not np.isfinite(v) else f"{v:.2f}\n(n={d['overlap_counts'][i, j]})"
                ax.text(
                    j,
                    i,
                    txt,
                    ha="center",
                    va="center",
                    fontsize=7,
                    color="white" if np.isfinite(v) and v < 0.6 else "black",
                )
        ax.set_xticks(range(k), names, rotation=45, ha="right")
        ax.set_yticks(
            range(k), [f"{nm} ({c})" for nm, c in zip(names, d["n_significant"], strict=True)]
        )
        ax.set_title("Agreement between analyses (significant cells)")
    elif kind == "upset":
        inter = d["intersections"]
        m = len(inter)
        fig = plt.figure(figsize=(max(5.0, 0.55 * m + 3.5), 2.5 + 0.35 * k), layout="constrained")
        gs = fig.add_gridspec(2, 1, height_ratios=[3, max(k * 0.5, 1)])
        top = fig.add_subplot(gs[0])
        bot = fig.add_subplot(gs[1], sharex=top)
        if m == 0:
            _note(top, "no significant cells in any analysis")
            bot.axis("off")
            return fig
        counts = [i["count"] for i in inter]
        top.bar(range(m), counts, color="0.45")
        for x, c in enumerate(counts):
            top.text(x, c, str(c), ha="center", va="bottom", fontsize=7)
        top.set_ylabel("cells")
        top.tick_params(labelbottom=False)
        top.set_title("Significance patterns")
        for x, it in enumerate(inter):
            on = np.flatnonzero(it["pattern"])
            bot.scatter(np.full(k, x), range(k), s=22, color="0.85", zorder=2)
            bot.scatter(np.full(on.size, x), on, s=22, color="black", zorder=3)
            if on.size > 1:
                bot.plot([x, x], [on.min(), on.max()], color="black", zorder=2)
        bot.set_yticks(range(k), names)
        bot.set_ylim(k - 0.5, -0.5)
        bot.set_xticks([])
        for s in ("bottom", "left"):
            bot.spines[s].set_visible(False)
    else:
        order = d["pgrid_order"]
        fig, ax = plt.subplots(figsize=(1.5 + 0.8 * k, 5.0), layout="constrained")
        cmap = plt.get_cmap("magma").with_extremes(bad=UNVISITED_COLOR)
        im = ax.imshow(
            np.ma.masked_invalid(d["neglog10_p"][order]),
            aspect="auto",
            interpolation="nearest",
            cmap=cmap,
        )
        fig.colorbar(im, ax=ax, label="-log10 p (best state)", shrink=0.8)
        ax.set_xticks(range(k), names, rotation=45, ha="right")
        ax.set_ylabel("cell (most analyses first)")
        if order.size <= 60:
            ax.set_yticks(range(order.size), [d["cell_ids"][i] for i in order])
        ax.set_title("Evidence per cell and analysis")
    return fig
