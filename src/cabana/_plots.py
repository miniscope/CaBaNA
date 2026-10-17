"""Matplotlib plotting helpers.

Every function returns a :class:`matplotlib.figure.Figure` and never calls
``plt.show``.  Single-panel functions accept ``ax=None`` and create a figure
when it is omitted.  Plots dispatch on ``StateSpace.kind`` / ``topology``.

Each ``plot_<x>`` has a companion ``plot_<x>_data`` that returns everything the
figure shows as a plain dict (see :mod:`cabana._plot_data`); the renderer draws
from that dict only.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.colors import ListedColormap, to_hex
from matplotlib.figure import Figure
from matplotlib.lines import Line2D
from matplotlib.patches import Patch

from ._models import EVENT_KINDS, ContinuousSignal, Session
from ._plot_data import PLOT_DATA_VERSION
from ._plot_registry import register_plot
from ._plot_style import (
    NULL_COLOR,
    OBSERVED_COLOR,
    UNVISITED_COLOR,
    axis_label,
    fmt_p,
    mark_significant,
    metric_label,
    ordered_names,
    state_colors,
)
from ._results import MetricResult, ResultSet
from ._util import order_session_first, runs

__all__ = [
    "plot_behavior_overview",
    "plot_behavior_overview_data",
    "plot_ground_truth_recovery",
    "plot_ground_truth_recovery_data",
    "plot_metric_scatter",
    "plot_metric_scatter_data",
    "plot_metric_strip",
    "plot_metric_strip_data",
    "plot_population_matrix",
    "plot_population_matrix_data",
    "plot_rate_maps",
    "plot_rate_maps_data",
    "plot_shuffle_distribution",
    "plot_shuffle_distribution_data",
    "plot_split_half_maps",
    "plot_split_half_maps_data",
    "plot_tuning_heatmap",
    "plot_tuning_heatmap_data",
]

FLOOR_NOTE = "p at floor: no surrogate reached the observed value; raise n_shuffles for finer p"
UNVISITED_NOTE = "Light grey: unvisited or below minimum occupancy (no estimate, not zero)"


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #


def _get_ax(ax: Any, figsize: tuple[float, float] = (5.5, 4.0)) -> tuple[Figure, Any]:
    if ax is None:
        fig, ax = plt.subplots(figsize=figsize, layout="constrained")
        return fig, ax
    return ax.figure, ax


def _cell_label(result: MetricResult, cell: int) -> str:
    if result.cell_ids is not None and 0 <= cell < len(result.cell_ids):
        return str(result.cell_ids[cell])
    return str(cell)


def _significant(result: MetricResult, alpha: float | None = None) -> np.ndarray | None:
    """Significance mask of ``result`` (adjusted when a correction was applied).

    ``None`` without a shuffle.  An explicit ``alpha`` tests the raw p-values.
    """
    sh = result.shuffle
    if sh is None:
        return None
    if alpha is not None:
        return np.asarray(sh.p_value) < alpha
    if sh.correction != "none" and sh.p_adj is not None:
        return np.asarray(sh.p_adj) < sh.alpha
    return np.asarray(sh.significant, bool)


def _per_cell(mask: np.ndarray) -> np.ndarray:
    """Reduce a ``(n_cells, ...)`` mask to ``(n_cells,)`` (any over the other axes)."""
    mask = np.asarray(mask, bool)
    return mask.reshape(mask.shape[0], -1).any(axis=1) if mask.ndim > 1 else mask


def _cell_scores(result: MetricResult) -> np.ndarray:
    v = np.asarray(result.values, float)
    if v.ndim > 1:
        v = v.reshape(v.shape[0], -1)
        with np.errstate(all="ignore"):
            v = np.where(
                np.isfinite(v).any(axis=1),
                np.nanmax(np.where(np.isfinite(v), v, -np.inf), 1),
                np.nan,
            )
    return v


def _ordered_cells(result: MetricResult) -> list[int]:
    """All cells: significant ones by descending value, then the rest by descending value."""
    score = _cell_scores(result)
    order = np.argsort(-np.where(np.isfinite(score), score, -np.inf), kind="stable")
    sig = _significant(result)
    sig_c = _per_cell(sig) if sig is not None and sig.shape[:1] == score.shape else None
    if sig_c is None:
        return [int(i) for i in order]
    return [int(i) for i in order if sig_c[i]] + [int(i) for i in order if not sig_c[i]]


def _page(cells: Sequence[int], max_cells: int | None, page: int) -> tuple[list[int], int, int]:
    """``(cells on this page, page, n_pages)``."""
    cells = [int(c) for c in cells]
    if not max_cells or max_cells <= 0 or len(cells) <= max_cells:
        if page not in (0,):
            raise ValueError(f"page={page} out of range: only 1 page of cells")
        return cells, 0, 1
    n_pages = int(np.ceil(len(cells) / max_cells))
    if not 0 <= page < n_pages:
        raise ValueError(f"page={page} out of range: {len(cells)} cells make {n_pages} page(s)")
    return cells[page * max_cells : (page + 1) * max_cells], page, n_pages


def _signal_units(session: Session, name: str) -> str:
    """Units of the behavior input called ``name`` (or carrying channel ``name``), else ``""``."""
    b = getattr(session, "behavior", {}) or {}
    sig = b.get(name)
    if isinstance(sig, ContinuousSignal):
        return sig.units or ""
    for s in b.values():
        if isinstance(s, ContinuousSignal) and name in s.channel_names:
            return s.units or ""
    return ""


def _p_text(sh: Any, idx: Any) -> tuple[str, bool]:
    txt = fmt_p(float(np.asarray(sh.p_value)[idx]), sh.n_shuffles, sh.tail)
    return txt, txt.endswith("(floor)")


def _unit_of(label: str) -> str:
    """Unit in the trailing parentheses of an axis label, ``""`` if none."""
    return label[label.rfind("(") + 1 : -1] if label.endswith(")") else ""


def _tick_fmt(v: float) -> str:
    return f"{np.round(float(v), 1):g}"


def _hex(c: Any) -> str:
    return to_hex(c)


def _base(kind: str, **kw: Any) -> dict[str, Any]:
    return {"kind": kind, "version": PLOT_DATA_VERSION, **kw}


# --------------------------------------------------------------------------- #
# behavior overview
# --------------------------------------------------------------------------- #


def plot_behavior_overview_data(
    session: Session,
    *,
    position_signals: tuple[str, str] = ("x", "y"),
    speed_signal: str = "speed",
    speed_mask: str = "speed",
    states: Sequence[str] | None = None,
) -> dict[str, Any]:
    """Data behind :func:`plot_behavior_overview`.

    Returns
    -------
    dict
        ``t`` plus ``panels``: a list of dicts with ``type`` in ``"trajectory"``
        (``x``, ``y``, ``x_label``, ``y_label``), ``"speed"`` (``values``,
        ``label``, ``excluded`` as ``[t0, t1]`` pairs), ``"ethogram"`` (``name``,
        ``state_names``, ``segments`` per state as ``[start, duration]`` pairs,
        ``colors``) or ``"strip"`` (``name``, ``labels`` with -1 for none,
        ``state_names``, ``colors``).  ``panels`` is empty when nothing can be drawn.
    """
    t = np.asarray(session.t, float)
    names = list(session.states) if states is None else list(states)
    spaces = [session.states[n] for n in names if n in session.states]
    panels: list[dict[str, Any]] = []
    px, py = position_signals
    if px in session.signals and py in session.signals:
        panels.append(
            {
                "type": "trajectory",
                "x": np.asarray(session.signals[px], float),
                "y": np.asarray(session.signals[py], float),
                "x_label": axis_label(px, _signal_units(session, px)),
                "y_label": axis_label(py, _signal_units(session, py)),
            }
        )
    if speed_signal in session.signals:
        excluded: list[list[float]] = []
        if speed_mask in session.masks:
            for a, n in zip(*runs(~session.masks[speed_mask]), strict=True):
                excluded.append([float(t[a]), float(t[min(a + n, len(t) - 1)])])
        panels.append(
            {
                "type": "speed",
                "values": np.asarray(session.signals[speed_signal], float),
                "label": axis_label(speed_signal, _signal_units(session, speed_signal)),
                "excluded": excluded,
            }
        )
    dt = float(np.median(np.diff(t))) if len(t) > 1 else 1.0
    for s in spaces:
        if s.kind == "bouts":
            cols = state_colors(s.state_names)
            panels.append(
                {
                    "type": "ethogram",
                    "name": s.name,
                    "state_names": list(s.state_names),
                    "segments": [
                        [
                            [float(t[a]), float(n * dt)]
                            for a, n in zip(*runs(s.onehot[:, j]), strict=True)
                        ]
                        for j in range(s.n_states)
                    ],
                    "colors": [_hex(cols[n]) for n in s.state_names],
                }
            )
        elif s.kind == "categorical" and s.exclusive:
            cols = state_colors(s.state_names)
            panels.append(
                {
                    "type": "strip",
                    "name": s.name,
                    "labels": np.asarray(s.labels(), int),
                    "state_names": list(s.state_names),
                    "colors": [_hex(cols[n]) for n in s.state_names],
                }
            )
    return _base("behavior_overview", t=t, panels=panels)


def plot_behavior_overview(
    session: Session,
    *,
    position_signals: tuple[str, str] = ("x", "y"),
    speed_signal: str = "speed",
    speed_mask: str = "speed",
    states: Sequence[str] | None = None,
) -> Figure:
    """Overview of behavior: trajectory, speed, ethograms and label strips.

    Panels that lack data are skipped.  If nothing can be drawn an empty
    figure with a text note is returned.  Look for: coverage of the arena by the
    trajectory, whether speed gaps (grey bands) fall where the animal paused, and
    whether scored behaviors are spread across the session.

    Parameters
    ----------
    session : Session
        Session whose ``signals``, ``masks`` and ``states`` are drawn.
    position_signals : (str, str), default ("x", "y")
        Names of the two per-frame position signals (trajectory panel, coloured
        by time).  Units come from the session's behavior input of the same name.
    speed_signal : str, default "speed"
        Per-frame speed signal drawn as a time trace.
    speed_mask : str, default "speed"
        Name of the mask whose excluded frames are shaded grey on the speed trace.
    states : sequence of str, optional
        State spaces to draw (``None`` = all): ``"bouts"`` spaces as ethograms,
        exclusive ``"categorical"`` spaces as colour strips; other kinds are skipped.

    Returns
    -------
    matplotlib.figure.Figure
    """
    d = plot_behavior_overview_data(
        session,
        position_signals=position_signals,
        speed_signal=speed_signal,
        speed_mask=speed_mask,
        states=states,
    )
    t = d["t"]
    panels = d["panels"]
    if not panels:
        fig, ax = plt.subplots(figsize=(5, 2), layout="constrained")
        ax.axis("off")
        ax.text(
            0.5,
            0.5,
            "Nothing to plot: no position, speed or\nbouts/categorical states",
            ha="center",
            va="center",
        )
        return fig

    def height(p: dict[str, Any]) -> float:
        return {"trajectory": 3.2, "speed": 1.4, "strip": 1.0}.get(
            p["type"], max(1.0, 0.4 * len(p.get("state_names", [])) + 0.6)
        )

    fig = plt.figure(figsize=(8, sum(height(p) for p in panels) + 0.5), layout="constrained")
    gs = fig.add_gridspec(len(panels), 1, height_ratios=[height(p) for p in panels])
    for i, p in enumerate(panels):
        ax = fig.add_subplot(gs[i])
        kind = p["type"]
        if kind == "trajectory":
            sc = ax.scatter(p["x"], p["y"], c=t, s=4, cmap="viridis")
            ax.plot(p["x"], p["y"], color="0.8", lw=0.5, zorder=0)
            ax.set_xlabel(p["x_label"])
            ax.set_ylabel(p["y_label"])
            ax.set_aspect("equal", adjustable="datalim")
            ax.set_title("Trajectory")
            fig.colorbar(sc, ax=ax, label="time (s)", fraction=0.046, pad=0.02)
        elif kind == "speed":
            ax.plot(t, p["values"], color="C0", lw=0.8)
            for a, b in p["excluded"]:
                ax.axvspan(a, b, color="0.5", alpha=0.25, lw=0)
            ax.set_ylabel(p["label"])
            ax.set_xlabel("time (s)")
            ax.set_xlim(t[0], t[-1])
        elif kind == "ethogram":
            n = len(p["state_names"])
            for j, segs in enumerate(p["segments"]):
                ax.broken_barh([tuple(s) for s in segs], (j - 0.4, 0.8), facecolors=p["colors"][j])
            ax.set_yticks(range(n), p["state_names"])
            ax.set_ylim(n - 0.4, -0.6)
            ax.set_xlim(t[0], t[-1])
            ax.set_xlabel("time (s)")
            ax.set_title(p["name"], fontsize=10)
        else:
            lab = np.asarray(p["labels"])
            cmap = ListedColormap(p["colors"] or ["0.5"])
            ax.imshow(
                np.ma.masked_less(lab, 0)[None, :],
                aspect="auto",
                cmap=cmap,
                vmin=-0.5,
                vmax=len(p["state_names"]) - 0.5,
                extent=(t[0], t[-1], 0, 1),
                interpolation="nearest",
            )
            ax.set_yticks([])
            ax.set_xlabel("time (s)")
            ax.set_title(p["name"], fontsize=10)
            used = np.unique(lab[lab >= 0])
            ax.legend(
                handles=[
                    Patch(color=p["colors"][int(u)], label=p["state_names"][int(u)]) for u in used
                ],
                loc="upper left",
                bbox_to_anchor=(1.01, 1.0),
                fontsize=8,
                frameon=False,
            )
    return fig


# --------------------------------------------------------------------------- #
# rate maps
# --------------------------------------------------------------------------- #


def _rate_label(session: Session) -> str:
    return axis_label("rate", "events/s" if session.activity_kind in EVENT_KINDS else "a.u./s")


def _map_layout(session: Session, result: MetricResult) -> dict[str, Any]:
    space = session.states[result.target]
    topo = space.topology
    if topo is not None and topo.ndim == 2:
        layout = "grid2d"
    elif topo is not None and topo.ndim == 1:
        layout = "grid1d"
    else:
        layout = "categorical"
    out: dict[str, Any] = {"layout": layout, "state_names": list(space.state_names)}
    if layout != "categorical":
        out["axis_names"] = list(topo.axis_names)
        out["axis_units"] = [_signal_units(session, n) for n in topo.axis_names]
        out["axis_labels"] = [
            axis_label(n, u) for n, u in zip(out["axis_names"], out["axis_units"], strict=True)
        ]
        out["edges"] = [np.asarray(e, float) for e in topo.edges]
        out["centers"] = [np.asarray(c, float) for c in topo.centers()]
        out["grid_shape"] = list(topo.shape)
    return out


def _shape_maps(maps: np.ndarray, lay: dict[str, Any]) -> np.ndarray:
    """``(..., n_states)`` -> ``(..., *grid_shape)`` for a 2-D grid, unchanged otherwise."""
    if lay["layout"] == "grid2d":
        return maps.reshape(*maps.shape[:-1], *lay["grid_shape"])
    return maps


def rate_maps_defaults(result: MetricResult, session: Any = None) -> dict[str, Any]:
    """Registry ``defaults`` hook: ``{"cells": ...}`` significant cells first, then the rest.

    The list is ordered by value (descending) and not truncated; ``max_cells`` and
    ``page`` of :func:`plot_rate_maps` pick the block that is drawn.
    """
    return {"cells": _ordered_cells(result)}


def plot_rate_maps_data(
    session: Session,
    result: MetricResult,
    cells: Sequence[int] | None = None,
    max_cells: int | None = 24,
    page: int = 0,
    show_occupancy: bool = True,
) -> dict[str, Any]:
    """Data behind :func:`plot_rate_maps`.

    Returns
    -------
    dict
        ``layout`` (``"grid2d"``, ``"grid1d"`` or ``"categorical"``), ``cells``,
        ``cell_labels``, ``rate_maps`` (``(n, nx, ny)`` for 2-D grids, else
        ``(n, n_states)``; NaN = unvisited, never zero), ``vmin``/``vmax`` (shared),
        ``rate_label``, ``titles``, ``significant``, ``p_floor`` flags, ``notes``
        (floor / unvisited), axis names, units and edges, optional ``occupancy``
        (same layout as one map, seconds) and ``paging``.
    """
    session, result = order_session_first(session, result)
    if "rate_map" not in result.extras:
        raise ValueError(
            f"result for metric {result.metric!r} has no 'rate_map' in extras; "
            f"available keys: {sorted(result.extras)}"
        )
    rate = np.asarray(result.extras["rate_map"], float)
    lay = _map_layout(session, result)
    all_cells = _ordered_cells(result) if cells is None else [int(c) for c in cells]
    shown, page, n_pages = _page(all_cells, max_cells, page)
    values = np.asarray(result.values)
    sh = result.shuffle
    sig = _significant(result)
    titles, floors, sigs, pvals = [], [], [], []
    for c in shown:
        title = _cell_label(result, c)
        floor = False
        p = np.nan
        if values.ndim == 1:
            unit = _unit_of(metric_label(result.metric, result.params))
            title += f"\n{values[c]:.3g}" + (f" {unit}" if unit else "")
            if sh is not None and np.ndim(sh.p_value) == 1:
                txt, floor = _p_text(sh, c)
                title += f" · {txt}"
                p = float(sh.p_value[c])
        titles.append(title)
        floors.append(floor)
        pvals.append(p)
        sigs.append(bool(_per_cell(sig)[c]) if sig is not None and values.ndim == 1 else False)
    maps = _shape_maps(rate[shown], lay) if shown else np.empty((0, *rate.shape[1:]))
    finite = maps[np.isfinite(maps)]
    vmin = float(finite.min()) if finite.size else 0.0
    vmax = float(finite.max()) if finite.size else 1.0
    if vmax <= vmin:
        vmax = vmin + 1.0
    occ = result.extras.get("occupancy_s") if show_occupancy else None
    if occ is not None:
        occ = _shape_maps(np.asarray(occ, float), lay)
    notes: list[str] = []
    if np.isnan(maps).any():
        notes.append(UNVISITED_NOTE)
    if any(floors):
        notes.append(FLOOR_NOTE)
    return _base(
        "rate_maps",
        metric=result.metric,
        cells=np.asarray(shown, int),
        cell_labels=[_cell_label(result, c) for c in shown],
        rate_maps=maps,
        vmin=vmin,
        vmax=vmax,
        rate_label=_rate_label(session),
        titles=titles,
        p_values=np.asarray(pvals, float),
        p_floor=np.asarray(floors, bool),
        significant=np.asarray(sigs, bool),
        occupancy=occ,
        occupancy_label="occupancy (s)",
        unvisited_color=UNVISITED_COLOR,
        notes=notes,
        paging={
            "page": page,
            "n_pages": n_pages,
            "max_cells": max_cells,
            "n_total": len(all_cells),
        },
        **lay,
    )


@register_plot(
    "rate_maps",
    data=plot_rate_maps_data,
    needs_session=True,
    level="cell",
    requires=("extras:rate_map",),
    defaults=rate_maps_defaults,
)
def plot_rate_maps(
    session: Session,
    result: MetricResult,
    cells: Sequence[int] | None = None,
    ncols: int = 6,
    cmap: str = "viridis",
    max_cells: int | None = 24,
    page: int = 0,
    show_occupancy: bool = True,
) -> Figure:
    """Per-cell rate maps from ``result.extras["rate_map"]``.

    ``session`` and ``result`` may be given in either order.  Look for: compact
    single fields (2-D / 1-D grids) or a bar peak at one state (categorical);
    titles give the metric value and, with a shuffle, its p-value; a white dot in
    a panel corner marks a significant cell.  Light-grey bins were never visited
    (or fell below the minimum occupancy): they have no estimate and are not zero.

    Parameters
    ----------
    session : Session
        Supplies the target state space (``session.states[result.target]``) for the
        grid layout and state names, the activity kind (colourbar unit) and the
        axis units of the source signal.
    result : MetricResult
        Result whose ``extras["rate_map"]`` is ``(n_cells, n_states)`` (e.g.
        ``information_content``); missing key raises ``ValueError``.
    cells : sequence of int, optional
        Row indices of the cells to draw.  ``None`` picks the significant cells
        (adjusted when a correction was applied) by descending value, then the
        rest by descending value.
    ncols : int, default 6
        Maximum panels per row.
    cmap : str, default "viridis"
        Colormap for 2-D maps (NaN bins are drawn light grey).
    max_cells : int, default 24
        Panels per figure; longer lists are split into pages (``None`` = all).
    page : int, default 0
        Which block of ``max_cells`` cells to draw.
    show_occupancy : bool, default True
        Add an occupancy panel (seconds per bin) when ``extras["occupancy_s"]`` exists.

    Returns
    -------
    matplotlib.figure.Figure
        One panel per cell: image for a 2-D grid (one shared colourbar), line for
        1-D, bars otherwise.
    """
    d = plot_rate_maps_data(
        session, result, cells, max_cells=max_cells, page=page, show_occupancy=show_occupancy
    )
    lay = d["layout"]
    n = len(d["cells"])
    occ = d["occupancy"]
    n_panels = max(n + (1 if occ is not None else 0), 1)
    ncols = max(1, min(ncols, n_panels))
    nrows = int(np.ceil(n_panels / ncols))
    fig, axes = plt.subplots(
        nrows, ncols, figsize=(2.6 * ncols, 2.4 * nrows + 0.4), squeeze=False, layout="constrained"
    )
    flat = list(axes.ravel())
    titles, notes = list(d["titles"]), list(d["notes"])
    if ncols > 5:  # narrow panels: abbreviate the floor flag, explain it in the footer
        titles = [t.replace(" (floor)", "*") for t in titles]
        notes = [("* " + x if x == FLOOR_NOTE else x) for x in notes]
    maps = d["rate_maps"]
    cm = plt.get_cmap(cmap).with_extremes(bad=d["unvisited_color"])
    state_names = d["state_names"]
    slots = list(flat)
    if occ is not None:
        _draw_occupancy(slots.pop(0), d, occ, cm)
    last_im = None
    rate_axes = []
    for k, ax in enumerate(slots):
        if k >= n:
            ax.axis("off")
            continue
        ax.set_title(titles[k], fontsize=8)
        rate_axes.append(ax)
        m = maps[k]
        if lay == "grid2d":
            xe, ye = d["edges"]
            last_im = ax.imshow(
                np.ma.masked_invalid(m.T),
                origin="lower",
                cmap=cm,
                aspect="auto",
                extent=(xe[0], xe[-1], ye[0], ye[-1]),
                vmin=d["vmin"],
                vmax=d["vmax"],
            )
            _grid_ticks(ax, d)
        elif lay == "grid1d":
            ax.plot(d["centers"][0], m, color="C0")
            _shade_nan(ax, d["edges"][0], np.isnan(m), d)
            ax.set_ylim(min(d["vmin"], 0.0), d["vmax"] * 1.05)
            ax.tick_params(labelsize=7)
        else:
            idx = np.arange(len(m))
            ax.bar(idx, np.nan_to_num(m), color="C0")
            for i in idx[np.isnan(m)]:
                ax.axvspan(i - 0.5, i + 0.5, color=d["unvisited_color"], lw=0, zorder=0)
            ax.set_ylim(min(d["vmin"], 0.0), d["vmax"] * 1.05)
            ax.set_xticks(idx, state_names, rotation=60, ha="right", fontsize=7)
            ax.tick_params(axis="y", labelsize=7)
        if d["significant"][k]:
            mark_significant(
                ax, [0.93], [0.9], transform=ax.transAxes, clip_on=False, label="significant"
            )
    if last_im is not None:
        fig.colorbar(last_im, ax=rate_axes, label=d["rate_label"], fraction=0.04, pad=0.02)
    elif lay != "grid2d":
        for ax in rate_axes[:1]:
            ax.set_ylabel(d["rate_label"], fontsize=7)
    paging = d["paging"]
    if paging["n_pages"] > 1:
        fig.suptitle(
            f"cells page {paging['page'] + 1}/{paging['n_pages']} "
            f"({paging['n_total']} cells, {paging['max_cells']} per page)",
            fontsize=8,
        )
    if notes:
        fig.supxlabel("\n".join(notes), fontsize=7, x=0.01, ha="left")
    return fig


def _grid_ticks(ax: Any, d: dict[str, Any]) -> None:
    xe, ye = d["edges"]
    ax.set_xticks([xe[0], xe[-1]], [_tick_fmt(xe[0]), _tick_fmt(xe[-1])])
    ax.set_yticks([ye[0], ye[-1]], [_tick_fmt(ye[0]), _tick_fmt(ye[-1])])
    ax.tick_params(labelsize=6)
    ax.set_xlabel(d["axis_labels"][0], fontsize=7)
    ax.set_ylabel(d["axis_labels"][1], fontsize=7)


def _shade_nan(ax: Any, edges: np.ndarray, nan: np.ndarray, d: dict[str, Any]) -> None:
    for i in np.flatnonzero(nan):
        ax.axvspan(edges[i], edges[i + 1], color=d["unvisited_color"], lw=0, zorder=0)


def _draw_occupancy(ax: Any, d: dict[str, Any], occ: np.ndarray, cm: Any) -> None:
    ax.set_title(d["occupancy_label"], fontsize=8)
    if d["layout"] == "grid2d":
        xe, ye = d["edges"]
        im = ax.imshow(
            occ.T,
            origin="lower",
            cmap="Greys",
            aspect="auto",
            extent=(xe[0], xe[-1], ye[0], ye[-1]),
        )
        ax.figure.colorbar(im, ax=ax, fraction=0.05, pad=0.02)
        _grid_ticks(ax, d)
    elif d["layout"] == "grid1d":
        ax.fill_between(d["centers"][0], occ, color="0.6", step="mid")
        ax.tick_params(labelsize=7)
    else:
        ax.bar(range(len(occ)), occ, color="0.6")
        ax.set_xticks(range(len(occ)), d["state_names"], rotation=60, ha="right", fontsize=7)
        ax.tick_params(axis="y", labelsize=7)


# --------------------------------------------------------------------------- #
# split-half maps
# --------------------------------------------------------------------------- #


def split_half_defaults(result: MetricResult, session: Any = None) -> dict[str, Any]:
    """Registry ``defaults`` hook for :func:`plot_split_half_maps` (same cell choice as rate maps)."""
    return {"cells": _ordered_cells(result)}


def plot_split_half_maps_data(
    session: Session,
    result: MetricResult,
    cells: Sequence[int] | None = None,
    max_cells: int | None = 8,
    page: int = 0,
) -> dict[str, Any]:
    """Data behind :func:`plot_split_half_maps`.

    Returns
    -------
    dict
        Like :func:`plot_rate_maps_data` but with ``maps_a`` / ``maps_b`` (the two
        halves, NaN = unvisited in that half), per-cell ``vmin`` / ``vmax`` arrays
        (one colour scale per cell shared by both halves), and ``titles`` carrying
        the split-half r and p.
    """
    session, result = order_session_first(session, result)
    for key in ("rate_map_a", "rate_map_b"):
        if key not in result.extras:
            raise ValueError(
                f"result for metric {result.metric!r} has no {key!r} in extras; "
                f"available keys: {sorted(result.extras)}"
            )
    lay = _map_layout(session, result)
    all_cells = _ordered_cells(result) if cells is None else [int(c) for c in cells]
    shown, page, n_pages = _page(all_cells, max_cells, page)
    a = _shape_maps(np.asarray(result.extras["rate_map_a"], float)[shown], lay)
    b = _shape_maps(np.asarray(result.extras["rate_map_b"], float)[shown], lay)
    both = np.concatenate([a, b], axis=-1).reshape(len(shown), -1)
    with np.errstate(all="ignore"):
        vmin = np.where(np.isfinite(both).any(1), np.nanmin(both, 1), 0.0) if len(shown) else both
        vmax = np.where(np.isfinite(both).any(1), np.nanmax(both, 1), 1.0) if len(shown) else both
    vmax = np.where(vmax <= vmin, vmin + 1.0, vmax)
    values = np.asarray(result.values, float)
    sh = result.shuffle
    titles, floors = [], []
    for c in shown:
        t = f"{_cell_label(result, c)}\nr={values[c]:.2f}"
        floor = False
        if sh is not None and np.ndim(sh.p_value) == 1:
            txt, floor = _p_text(sh, c)
            t += f" · {txt}"
        titles.append(t)
        floors.append(floor)
    notes = []
    if np.isnan(a).any() or np.isnan(b).any():
        notes.append(UNVISITED_NOTE)
    if any(floors):
        notes.append(FLOOR_NOTE)
    return _base(
        "split_half_maps",
        metric=result.metric,
        cells=np.asarray(shown, int),
        cell_labels=[_cell_label(result, c) for c in shown],
        maps_a=a,
        maps_b=b,
        half_labels=["half A", "half B"],
        vmin=np.asarray(vmin, float),
        vmax=np.asarray(vmax, float),
        rate_label=_rate_label(session),
        titles=titles,
        unvisited_color=UNVISITED_COLOR,
        notes=notes,
        paging={
            "page": page,
            "n_pages": n_pages,
            "max_cells": max_cells,
            "n_total": len(all_cells),
        },
        **lay,
    )


@register_plot(
    "split_half_maps",
    data=plot_split_half_maps_data,
    needs_session=True,
    level="cell",
    requires=("extras:rate_map_a",),
    defaults=split_half_defaults,
)
def plot_split_half_maps(
    session: Session,
    result: MetricResult,
    cells: Sequence[int] | None = None,
    cmap: str = "viridis",
    max_cells: int | None = 8,
    page: int = 0,
) -> Figure:
    """The two half-session rate maps of ``split_half_stability``, side by side per cell.

    ``session`` and ``result`` may be given in either order.  Look for: the same
    field in both halves (high r) versus a field that moves or vanishes (low r);
    on 2-D grids both halves share one colour scale per cell so brightness is
    comparable; light grey bins were unvisited in that half.

    Parameters
    ----------
    session : Session
        Supplies the state space layout and activity kind.
    result : MetricResult
        ``split_half_stability`` result with ``extras["rate_map_a"]`` / ``["rate_map_b"]``.
    cells : sequence of int, optional
        Cells to draw; ``None`` picks significant cells first, by value.
    cmap : str, default "viridis"
        Colormap for 2-D maps.
    max_cells : int, default 8
        Cells per figure; ``page`` selects the block.
    page : int, default 0
        Which block of ``max_cells`` cells to draw.

    Returns
    -------
    matplotlib.figure.Figure
        2-D grid: one row per cell, two images and a colourbar.  1-D: two lines per
        cell panel.  Categorical: grouped bars per cell panel.
    """
    d = plot_split_half_maps_data(session, result, cells, max_cells=max_cells, page=page)
    lay = d["layout"]
    n = len(d["cells"])
    cm = plt.get_cmap(cmap).with_extremes(bad=d["unvisited_color"])
    if lay == "grid2d":
        fig, axes = plt.subplots(
            max(n, 1), 2, figsize=(5.2, 2.3 * max(n, 1) + 0.4), squeeze=False, layout="constrained"
        )
        xe, ye = d["edges"]
        for k in range(n):
            ims = []
            for j, key in enumerate(("maps_a", "maps_b")):
                ax = axes[k, j]
                ims.append(
                    ax.imshow(
                        np.ma.masked_invalid(d[key][k].T),
                        origin="lower",
                        cmap=cm,
                        aspect="auto",
                        extent=(xe[0], xe[-1], ye[0], ye[-1]),
                        vmin=d["vmin"][k],
                        vmax=d["vmax"][k],
                    )
                )
                _grid_ticks(ax, d)
                ax.set_title(d["titles"][k] if j == 0 else d["half_labels"][1], fontsize=8)
            axes[k, 0].set_title(f"{d['titles'][k]}\n{d['half_labels'][0]}", fontsize=8)
            fig.colorbar(ims[-1], ax=list(axes[k]), label=d["rate_label"], fraction=0.05, pad=0.02)
    else:
        ncols = max(1, min(3, n))
        nrows = int(np.ceil(max(n, 1) / ncols))
        fig, axes = plt.subplots(
            nrows,
            ncols,
            figsize=(3.4 * ncols, 2.5 * nrows + 0.4),
            squeeze=False,
            layout="constrained",
        )
        for k, ax in enumerate(axes.ravel()):
            if k >= n:
                ax.axis("off")
                continue
            ax.set_title(d["titles"][k], fontsize=8)
            ma, mb = d["maps_a"][k], d["maps_b"][k]
            if lay == "grid1d":
                x = d["centers"][0]
                ax.plot(x, ma, color="C0", label=d["half_labels"][0])
                ax.plot(x, mb, color="C1", label=d["half_labels"][1])
                ax.set_xlabel(d["axis_labels"][0], fontsize=7)
            else:
                idx = np.arange(len(ma))
                ax.bar(idx - 0.2, np.nan_to_num(ma), 0.4, color="C0", label=d["half_labels"][0])
                ax.bar(idx + 0.2, np.nan_to_num(mb), 0.4, color="C1", label=d["half_labels"][1])
                for i in idx[np.isnan(ma) | np.isnan(mb)]:
                    ax.axvspan(i - 0.5, i + 0.5, color=d["unvisited_color"], lw=0, zorder=0)
                ax.set_xticks(idx, d["state_names"], rotation=60, ha="right", fontsize=7)
            ax.set_ylabel(d["rate_label"], fontsize=7)
            ax.tick_params(labelsize=7)
            if k == 0:
                ax.legend(fontsize=7, frameon=False)
    paging = d["paging"]
    if paging["n_pages"] > 1:
        fig.suptitle(f"cells page {paging['page'] + 1}/{paging['n_pages']}", fontsize=8)
    if d["notes"]:
        fig.supxlabel("\n".join(d["notes"]), fontsize=7, x=0.01, ha="left")
    return fig


# --------------------------------------------------------------------------- #
# shuffle distribution
# --------------------------------------------------------------------------- #


def shuffle_distribution_defaults(result: MetricResult, session: Any = None) -> dict[str, Any]:
    """Registry ``defaults`` hook: the most significant cell (and its best state when 2-D)."""
    sh = result.shuffle
    if sh is None:
        return {"cell": 0}
    p = np.asarray(sh.p_adj if sh.p_adj is not None and sh.correction != "none" else sh.p_value)
    p = np.where(np.isfinite(p), p, np.inf)
    if p.ndim == 1:
        return {"cell": int(np.argmin(p))}
    c, s = np.unravel_index(int(np.argmin(p.reshape(-1))), p.shape)[:2]
    return {"cell": int(c), "state": int(s)}


def plot_shuffle_distribution_data(
    result: MetricResult,
    cell: int,
    state: int | str | None = None,
    bins: int = 40,
) -> dict[str, Any]:
    """Data behind :func:`plot_shuffle_distribution`.

    Returns
    -------
    dict
        ``null`` (finite surrogate values), ``observed``, ``null_lo``, ``null_hi``,
        ``p_value``, ``p_text`` (with the floor flag), ``tail``, ``n_shuffles``,
        ``bins``, ``xlabel`` and ``title``.

    Raises
    ------
    ValueError
        If the result has no shuffle, the null draws were dropped, or ``state`` is
        missing for 2-D values.
    """
    sh = result.shuffle
    if sh is None:
        raise ValueError("result has no shuffle; run the analysis with a ShuffleConfig")
    if sh.null is None:
        raise ValueError(
            "result's null draws were dropped (ShuffleConfig.keep_null='none'); "
            "rerun with keep_null='full' to plot the null histogram"
        )
    cell = int(cell)
    obs = np.asarray(sh.observed)
    idx: tuple[int, ...] = (cell,)
    suffix = ""
    if obs.ndim == 2:
        if state is None:
            raise ValueError("result values are 2D; pass `state` (index or name)")
        state_i = result.state_index(state)
        idx = (cell, state_i)
        names = result.state_names or [state_i]
        suffix = f", state={state if isinstance(state, str) else names[state_i]}"
    null = np.asarray(sh.null)[(slice(None), *idx)]
    txt, floor = _p_text(sh, idx)
    return _base(
        "shuffle_distribution",
        metric=result.metric,
        cell=_cell_label(result, cell),
        null=null[np.isfinite(null)],
        observed=float(obs[idx]),
        null_lo=float(np.asarray(sh.null_lo)[idx]),
        null_hi=float(np.asarray(sh.null_hi)[idx]),
        p_value=float(np.asarray(sh.p_value)[idx]),
        p_text=txt,
        p_floor=floor,
        tail=sh.tail,
        n_shuffles=int(sh.n_shuffles),
        bins=int(bins),
        xlabel=metric_label(result.metric, result.params),
        ylabel="shuffles",
        title=f"{result.metric}, cell {_cell_label(result, cell)}{suffix}\n{txt} ({sh.tail} tail)",
        note=FLOOR_NOTE if floor else "",
    )


@register_plot(
    "shuffle_distribution",
    data=plot_shuffle_distribution_data,
    level="cell",
    requires=("null",),
    defaults=shuffle_distribution_defaults,
)
def plot_shuffle_distribution(
    result: MetricResult,
    cell: int,
    state: int | str | None = None,
    ax: Any = None,
    bins: int = 40,
) -> Figure:
    """Histogram of the null for one cell (and state) with observed value.

    Look for: the observed value (vermilion line) outside the dashed null bounds
    means significant; the title gives the p-value (labelled "floor" when no
    surrogate reached the observed value) and tail.

    Parameters
    ----------
    result : MetricResult
        Result with a shuffle that kept its null draws (``keep_null="full"``).
    cell : int
        Row index of the cell.
    state : int or str, optional
        State (index or name); required when the values are 2-D.
    ax : matplotlib Axes, optional
        Axes to draw into; a new figure is created if omitted.
    bins : int, default 40
        Histogram bins.

    Returns
    -------
    matplotlib.figure.Figure

    Raises
    ------
    ValueError
        If the result has no shuffle, the null draws were dropped, or ``state`` is
        missing for 2-D values.
    """
    d = plot_shuffle_distribution_data(result, cell, state, bins)
    fig, ax = _get_ax(ax)
    ax.hist(d["null"], bins=d["bins"], color=NULL_COLOR, edgecolor="white", label="null")
    ax.axvline(d["observed"], color=OBSERVED_COLOR, lw=2, label="observed")
    ax.axvline(d["null_lo"], color="k", ls="--", lw=1, label="null bounds")
    ax.axvline(d["null_hi"], color="k", ls="--", lw=1)
    ax.set_xlabel(d["xlabel"])
    ax.set_ylabel(d["ylabel"])
    ax.set_title(d["title"], fontsize=10)
    ax.legend(fontsize=8, frameon=False)
    if d["note"]:
        ax.annotate(
            d["note"], (0, -0.28), xycoords="axes fraction", fontsize=6, annotation_clip=False
        )
    return fig


# --------------------------------------------------------------------------- #
# tuning heatmap
# --------------------------------------------------------------------------- #


def tuning_heatmap_defaults(result: MetricResult, session: Any = None) -> dict[str, Any]:
    """Registry ``defaults`` hook: order cells by preferred state."""
    return {"sort_by": "peak"}


def plot_tuning_heatmap_data(result: MetricResult, sort_by: str | None = None) -> dict[str, Any]:
    """Data behind :func:`plot_tuning_heatmap`.

    Returns
    -------
    dict
        ``values`` (rows already in display order, NaN = untested), ``order``,
        ``cell_labels`` (display order), ``state_names``, ``significant`` (display
        order, or ``None`` without a shuffle), ``vmin``/``vmax`` (``None`` =
        autoscale), ``center`` (0.5 for AUROC), ``label`` and ``title``.

    Raises
    ------
    ValueError
        If values are not 2-D or ``sort_by`` is not ``"peak"`` or a state name.
    """
    vals = np.asarray(result.values, float)
    if vals.ndim != 2:
        raise ValueError(f"values must be 2D (n_cells, n_states), got shape {vals.shape}")
    n_cells, n_states = vals.shape
    names = ordered_names(result.state_names, n_states)
    order = np.arange(n_cells)
    if sort_by == "peak":
        filled = np.where(np.isfinite(vals), vals, -np.inf)
        order = np.lexsort((-filled.max(axis=1), filled.argmax(axis=1)))
    elif sort_by is not None:
        if sort_by not in names:
            raise ValueError(f"sort_by {sort_by!r} is not 'peak' or one of {names}")
        col = np.nan_to_num(vals[:, names.index(sort_by)], nan=-np.inf)
        order = np.argsort(-col, kind="stable")
    is_auroc = result.metric == "auroc"
    vmin = vmax = None
    if is_auroc:
        finite = vals[np.isfinite(vals)]
        half = max(float(np.abs(finite - 0.5).max()) if finite.size else 0.5, 0.05)
        vmin, vmax = 0.5 - half, 0.5 + half
    sig = _significant(result)
    sig_o = sig[order] if sig is not None and sig.shape == vals.shape else None
    return _base(
        "tuning_heatmap",
        metric=result.metric,
        values=vals[order],
        order=order.astype(int),
        cell_labels=[_cell_label(result, int(c)) for c in order],
        state_names=names,
        significant=sig_o,
        vmin=vmin,
        vmax=vmax,
        center=0.5 if is_auroc else None,
        cmap="RdBu_r" if is_auroc else "viridis",
        label=metric_label(result.metric, result.params),
        title=result.metric,
        sorted=sort_by is not None,
        unvisited_color=UNVISITED_COLOR,
    )


@register_plot(
    "tuning_heatmap",
    data=plot_tuning_heatmap_data,
    level="cell",
    requires=("values:2d",),
    defaults=tuning_heatmap_defaults,
)
def plot_tuning_heatmap(
    result: MetricResult,
    sort_by: str | None = None,
    ax: Any = None,
    cmap: str | None = None,
) -> Figure:
    """Cells x states heatmap of ``result.values`` with significance markers.

    Look for: blocks of cells lit in one column (state-selective cells); white
    dots mark cells significant under the stored shuffle (multiplicity-adjusted
    when a correction was applied).  AUROC is drawn on a diverging map centred on
    0.5; untested entries (NaN) are light grey.

    Parameters
    ----------
    result : MetricResult
        Result with 2-D values ``(n_cells, n_states)``.
    sort_by : str, optional
        ``"peak"`` orders cells by their preferred state then peak value; a state
        name orders by that column, descending; ``None`` keeps the cell order.
    ax : matplotlib Axes, optional
        Axes to draw into; a new figure is created if omitted.
    cmap : str, optional
        Colormap; default ``"RdBu_r"`` for AUROC, else ``"viridis"``.

    Returns
    -------
    matplotlib.figure.Figure

    Raises
    ------
    ValueError
        If values are not 2-D or ``sort_by`` is not ``"peak"`` or a state name.
    """
    d = plot_tuning_heatmap_data(result, sort_by)
    vals = d["values"]
    n_cells, n_states = vals.shape
    fig, ax = _get_ax(ax, (max(4.0, 0.5 * n_states + 2.5), max(3.5, 0.06 * n_cells + 1.5)))
    cm = plt.get_cmap(cmap or d["cmap"]).with_extremes(bad=d["unvisited_color"])
    kw: dict[str, Any] = {}
    if d["vmin"] is not None:
        kw.update(vmin=d["vmin"], vmax=d["vmax"])
    im = ax.imshow(
        np.ma.masked_invalid(vals), aspect="auto", interpolation="nearest", cmap=cm, **kw
    )
    sig = d["significant"]
    if sig is not None and np.any(sig):
        ys, xs = np.nonzero(sig)
        mark_significant(ax, xs, ys, s=8, linewidths=0.4)
        ax.legend(loc="upper left", bbox_to_anchor=(1.18, 1.0), fontsize=7, frameon=False)
    ax.set_xticks(range(n_states), d["state_names"], rotation=45, ha="right")
    if n_cells <= 40:
        ax.set_yticks(range(n_cells), d["cell_labels"], fontsize=6)
    ax.set_xlabel("state")
    ax.set_ylabel("cell (sorted)" if d["sorted"] else "cell")
    ax.set_title(d["title"])
    ax.figure.colorbar(im, ax=ax, label=d["label"])
    return fig


# --------------------------------------------------------------------------- #
# metric strip
# --------------------------------------------------------------------------- #


def plot_metric_strip_data(
    result: MetricResult, *, sort: bool = True, max_cells: int | None = None
) -> dict[str, Any]:
    """Data behind :func:`plot_metric_strip`.

    Returns
    -------
    dict
        ``values`` (display order, NaN kept), ``cells`` (row indices), ``cell_labels``,
        ``null_lo``/``null_hi`` (display order; ``None`` without a shuffle),
        ``significant`` (adjusted when a correction was applied; all False without
        a shuffle), ``show_ids`` (True for 40 cells or fewer), ``ylabel``, ``title``.

    Raises
    ------
    ValueError
        If ``result.values`` is not 1-D.
    """
    v = np.asarray(result.values, float)
    if v.ndim != 1:
        raise ValueError(f"metric_strip needs 1-D values (one per cell), got shape {v.shape}")
    order = np.arange(v.size)
    if sort:
        order = np.argsort(-np.where(np.isfinite(v), v, -np.inf), kind="stable")
    n_total = v.size
    if max_cells:
        order = order[: int(max_cells)]
    sh = result.shuffle
    sig = _significant(result)
    sig_o = sig[order] if sig is not None else np.zeros(order.size, bool)
    lo = np.asarray(sh.null_lo, float)[order] if sh is not None else None
    hi = np.asarray(sh.null_hi, float)[order] if sh is not None else None
    n_sig = int(sig_o.sum())
    pop = result.level == "population"
    labels = ordered_names(result.state_names, v.size) if pop else None
    title = f"{result.name or result.metric}"
    if sh is not None:
        title += f": {n_sig}/{order.size} significant"
        if sh.correction != "none":
            title += f" ({sh.correction}-adjusted)"
    return _base(
        "metric_strip",
        metric=result.metric,
        values=v[order],
        cells=order.astype(int),
        cell_labels=(
            [labels[int(c)] for c in order] if pop else [_cell_label(result, int(c)) for c in order]
        ),
        null_lo=lo,
        null_hi=hi,
        significant=np.asarray(sig_o, bool),
        show_ids=bool(order.size <= 40),
        n_total=int(n_total),
        sorted=bool(sort),
        ylabel=metric_label(result.metric, result.params),
        xlabel=("state" if pop else "cell") + (" (sorted by value)" if sort else ""),
        title=title,
    )


@register_plot("metric_strip", data=plot_metric_strip_data, level="any", requires=("values:1d",))
def plot_metric_strip(
    result: MetricResult, *, sort: bool = True, max_cells: int | None = None, ax: Any = None
) -> Figure:
    """Per-cell values of a 1-D result, with the null band and significant cells marked.

    Look for: values rising above the grey null band (what chance would give for
    each cell) and white-dot markers on cells significant under the stored shuffle
    (adjusted when a correction was applied); a long flat run inside the band means
    most cells are not distinguishable from chance.

    Parameters
    ----------
    result : MetricResult
        Cell-level result with 1-D ``values``.
    sort : bool, default True
        Sort cells by descending value; ``False`` keeps the cell order.
    max_cells : int, optional
        Draw only the first ``max_cells`` cells (after sorting).
    ax : matplotlib Axes, optional
        Axes to draw into; a new figure is created if omitted.

    Returns
    -------
    matplotlib.figure.Figure

    Raises
    ------
    ValueError
        If ``result.values`` is not 1-D.
    """
    d = plot_metric_strip_data(result, sort=sort, max_cells=max_cells)
    n = len(d["values"])
    fig, ax = _get_ax(ax, (max(5.0, min(0.25 * n + 2.0, 12.0)), 3.6))
    x = np.arange(n)
    if d["null_lo"] is not None:
        ax.fill_between(
            x, d["null_lo"], d["null_hi"], color=NULL_COLOR, alpha=0.6, lw=0, label="null band"
        )
    ax.plot(x, d["values"], color=OBSERVED_COLOR, marker=".", lw=0.8, label="observed")
    if d["significant"].any():
        mark_significant(ax, x[d["significant"]], d["values"][d["significant"]])
    if d["show_ids"]:
        ax.set_xticks(x, d["cell_labels"], rotation=90, fontsize=6)
    ax.set_xlim(-0.5, max(n - 0.5, 0.5))
    ax.set_xlabel(d["xlabel"])
    ax.set_ylabel(d["ylabel"])
    ax.set_title(d["title"], fontsize=10)
    ax.legend(fontsize=8, frameon=False)
    return fig


# --------------------------------------------------------------------------- #
# metric scatter
# --------------------------------------------------------------------------- #

_SCATTER_COLORS = {"neither": "#BFBFBF", "x": "#E69F00", "y": "#009E73", "both": "#D55E00"}


def plot_metric_scatter_data(
    result_x: MetricResult,
    result_y: MetricResult,
    log_x: bool = False,
    log_y: bool = False,
) -> dict[str, Any]:
    """Data behind :func:`plot_metric_scatter`.

    Returns
    -------
    dict
        ``x``, ``y``, ``groups`` (list of ``{"label", "color", "index"}`` over
        cells; a single grey group without shuffles), axis labels, log flags.

    Raises
    ------
    ValueError
        If either result is not 1-D or the shapes differ.
    """
    x = np.asarray(result_x.values, float)
    y = np.asarray(result_y.values, float)
    if x.ndim != 1 or y.ndim != 1:
        raise ValueError("plot_metric_scatter needs 1D cell-level results")
    if x.shape != y.shape:
        raise ValueError(f"result shapes differ: {x.shape} vs {y.shape}")
    sx, sy = _significant(result_x), _significant(result_y)
    if sx is None and sy is None:
        groups = [{"label": "cells", "color": "#666666", "index": np.arange(x.size)}]
    else:
        sx = np.zeros_like(x, bool) if sx is None else sx
        sy = np.zeros_like(x, bool) if sy is None else sy
        spec = [
            ("neither", ~sx & ~sy, _SCATTER_COLORS["neither"]),
            (f"{result_x.metric} only", sx & ~sy, _SCATTER_COLORS["x"]),
            (f"{result_y.metric} only", ~sx & sy, _SCATTER_COLORS["y"]),
            ("both", sx & sy, _SCATTER_COLORS["both"]),
        ]
        groups = [
            {"label": f"{lab} ({int(m.sum())})", "color": col, "index": np.flatnonzero(m)}
            for lab, m, col in spec
        ]
    return _base(
        "metric_scatter",
        x=x,
        y=y,
        groups=groups,
        has_shuffle=bool(sx is not None or sy is not None),
        xlabel=metric_label(result_x.metric, result_x.params),
        ylabel=metric_label(result_y.metric, result_y.params),
        log_x=bool(log_x),
        log_y=bool(log_y),
    )


def plot_metric_scatter(
    result_x: MetricResult,
    result_y: MetricResult,
    ax: Any = None,
    log_x: bool = False,
    log_y: bool = False,
) -> Figure:
    """Scatter of two cell-level metrics colored by joint significance.

    Look for: cells significant on only one metric (colored) versus both
    (vermilion), and whether the metrics are correlated.  Without shuffles all
    points are grey.

    Parameters
    ----------
    result_x, result_y : MetricResult
        1-D cell-level results with the same number of cells (x and y axes).
    ax : matplotlib Axes, optional
        Axes to draw into; a new figure is created if omitted.
    log_x, log_y : bool, default False
        Log-scale the axis.

    Returns
    -------
    matplotlib.figure.Figure

    Raises
    ------
    ValueError
        If either result is not 1-D or the shapes differ.
    """
    d = plot_metric_scatter_data(result_x, result_y, log_x, log_y)
    fig, ax = _get_ax(ax, (4.8, 4.5))
    for g in d["groups"]:
        i = np.asarray(g["index"], int)
        ax.scatter(d["x"][i], d["y"][i], s=16, color=g["color"], label=g["label"])
    if d["has_shuffle"]:
        ax.legend(fontsize=8, frameon=False)
    if d["log_x"]:
        ax.set_xscale("log")
    if d["log_y"]:
        ax.set_yscale("log")
    ax.set_xlabel(d["xlabel"])
    ax.set_ylabel(d["ylabel"])
    return fig


# --------------------------------------------------------------------------- #
# population matrix
# --------------------------------------------------------------------------- #


def plot_population_matrix_data(
    result: MetricResult, vmin: float | None = None, vmax: float | None = None
) -> dict[str, Any]:
    """Data behind :func:`plot_population_matrix`.

    Returns
    -------
    dict
        ``matrix`` (NaN = under-sampled state), ``state_names``, ``vmin``, ``vmax``,
        ``label`` and ``title``.

    Raises
    ------
    ValueError
        If ``values`` is not a square 2-D array.
    """
    m = np.asarray(result.values, float)
    if m.ndim != 2 or m.shape[0] != m.shape[1]:
        raise ValueError(f"values must be a 2D square matrix, got shape {m.shape}")
    return _base(
        "population_matrix",
        metric=result.metric,
        matrix=m,
        state_names=ordered_names(result.state_names, m.shape[0]),
        vmin=vmin,
        vmax=vmax,
        label=metric_label(result.metric, result.params),
        title=result.metric,
        unvisited_color=UNVISITED_COLOR,
    )


@register_plot(
    "population_matrix",
    data=plot_population_matrix_data,
    level="population",
    requires=("values:2d",),
)
def plot_population_matrix(
    result: MetricResult,
    ax: Any = None,
    cmap: str = "viridis",
    vmin: float | None = None,
    vmax: float | None = None,
) -> Figure:
    """Square state x state matrix (e.g. population vector overlap).

    Look for: block structure (groups of similar states) and a strong diagonal;
    NaN entries (under-sampled states) are drawn light grey.

    Parameters
    ----------
    result : MetricResult
        Result whose ``values`` is a square 2-D matrix over states.
    ax : matplotlib Axes, optional
        Axes to draw into; a new figure is created if omitted.
    cmap : str, default "viridis"
        Colormap.
    vmin, vmax : float, optional
        Colour limits; ``None`` autoscales.

    Returns
    -------
    matplotlib.figure.Figure

    Raises
    ------
    ValueError
        If ``values`` is not a square 2-D array.
    """
    d = plot_population_matrix_data(result, vmin, vmax)
    m = d["matrix"]
    n = m.shape[0]
    fig, ax = _get_ax(ax, (max(4.5, 0.4 * n + 2.5), max(4.0, 0.4 * n + 2.0)))
    cm = plt.get_cmap(cmap).with_extremes(bad=d["unvisited_color"])
    im = ax.imshow(
        np.ma.masked_invalid(m), cmap=cm, vmin=d["vmin"], vmax=d["vmax"], interpolation="nearest"
    )
    ax.set_xticks(range(n), d["state_names"], rotation=90, fontsize=8)
    ax.set_yticks(range(n), d["state_names"], fontsize=8)
    ax.set_title(d["title"])
    ax.figure.colorbar(im, ax=ax, fraction=0.046, pad=0.03, label=d["label"])
    return fig


# --------------------------------------------------------------------------- #
# ground truth recovery
# --------------------------------------------------------------------------- #

_POP_ORDER = ("place", "social", "syllable", "untuned")


def _planted_populations(gt: dict[str, Any]) -> dict[str, list[int]]:
    pops: dict[str, list[int]] = {}
    if "place_cells" in gt:
        pops["place"] = [int(c) for c in gt["place_cells"]]
    if "social_cells" in gt:
        pops["social"] = sorted({int(d["cell"]) for d in gt["social_cells"]})
    if "syllable_cells" in gt:
        pops["syllable"] = sorted({int(d["cell"]) for d in gt["syllable_cells"]})
    if "untuned_cells" in gt:
        pops["untuned"] = [int(c) for c in gt["untuned_cells"]]
    return pops


def plot_ground_truth_recovery_data(
    session: Session,
    resultset: ResultSet | Sequence[MetricResult],
    alpha: float = 0.05,
    adjusted: bool | None = None,
) -> dict[str, Any]:
    """Data behind :func:`plot_ground_truth_recovery`.

    Returns
    -------
    dict
        ``results``, ``labels``, ``populations`` (present ones, canonical order),
        ``colors`` per population, ``alpha`` and ``rows`` (columns ``result``,
        ``population``, ``n``, ``fraction_significant``, ``raw_fraction``,
        ``adjusted_fraction``; the last is NaN where no correction was applied).
        ``bar_fraction`` is the ``(n_populations, n_results)`` height of the solid
        bars (NaN = not available) and ``has_correction`` flags results with a
        correction; the ``untuned`` bar then shows the raw rate and the adjusted
        rate is overlaid hatched.
    """
    session, resultset = order_session_first(session, resultset)
    gt = session.meta.get("ground_truth", {}) or {}
    pops = _planted_populations(gt)
    cols: dict[str, list[Any]] = {
        k: []
        for k in (
            "result",
            "label",
            "population",
            "n",
            "fraction_significant",
            "raw_fraction",
            "adjusted_fraction",
        )
    }
    corrected: dict[str, bool] = {}
    for r in resultset:
        if r.level != "cell" or r.shuffle is None:
            continue
        sh = r.shuffle
        has_corr = sh.correction != "none" and sh.p_adj is not None
        use_adj = (sh.correction != "none") if adjusted is None else adjusted
        p_main = sh.p_adj if use_adj and sh.p_adj is not None else sh.p_value

        def any_sig(p: Any) -> np.ndarray:
            s = np.asarray(p) < alpha
            return s.reshape(s.shape[0], -1).any(axis=1) if s.ndim > 1 else s

        main, raw = any_sig(p_main), any_sig(sh.p_value)
        adj = any_sig(sh.p_adj) if has_corr else None
        name = r.name or f"{r.metric}[{r.target}]"
        corrected[name] = has_corr
        for pop, cells in pops.items():
            cells = [c for c in cells if 0 <= c < main.shape[0]]
            if not cells:
                continue
            cols["result"].append(name)
            cols["label"].append(name.replace("[", "\n[", 1))
            cols["population"].append(pop)
            cols["n"].append(len(cells))
            cols["fraction_significant"].append(float(main[cells].mean()))
            cols["raw_fraction"].append(float(raw[cells].mean()))
            cols["adjusted_fraction"].append(
                float(adj[cells].mean()) if adj is not None else float("nan")
            )
    results = list(dict.fromkeys(cols["result"]))
    labels = [cols["label"][cols["result"].index(r)] for r in results]
    present = set(cols["population"])
    populations = [p for p in _POP_ORDER if p in present]
    bar = np.full((len(populations), len(results)), np.nan)
    for i in range(len(cols["result"])):
        pi = populations.index(cols["population"][i])
        ri = results.index(cols["result"][i])
        is_untuned_corr = cols["population"][i] == "untuned" and corrected[cols["result"][i]]
        bar[pi, ri] = cols["raw_fraction" if is_untuned_corr else "fraction_significant"][i]
    palette = state_colors(list(_POP_ORDER))
    colors = {p: (_hex(NULL_COLOR) if p == "untuned" else _hex(palette[p])) for p in _POP_ORDER}
    return _base(
        "ground_truth_recovery",
        results=results,
        labels=labels,
        populations=populations,
        colors=colors,
        alpha=float(alpha),
        rows=cols,
        bar_fraction=bar if bar.size else [],  # empty arrays do not round-trip
        has_correction=[bool(corrected[r]) for r in results],
    )


def plot_ground_truth_recovery(
    session: Session,
    resultset: ResultSet | Sequence[MetricResult],
    alpha: float = 0.05,
    adjusted: bool | None = None,
) -> Figure:
    """Fraction of each planted population detected, per result.

    The ``untuned`` population gives the false-positive rate.  The summary
    table is attached as ``fig.cabana_summary`` (columns ``result``,
    ``population``, ``n``, ``fraction_significant``, ``adjusted_fraction``).
    Look for: tall bars for the planted populations, and ``untuned`` near the
    dashed alpha line; for results with a multiplicity correction the grey
    ``untuned`` bar is the raw false-positive rate and the hatched bar over it the
    adjusted rate (it should sit at or below alpha).
    ``session`` and ``resultset`` may be given in either order.

    Parameters
    ----------
    session : Session
        Simulated session with ``meta["ground_truth"]`` (from ``simulate_session``);
        without it the figure is an empty note.
    resultset : ResultSet or sequence of MetricResult
        Cell-level results that have a shuffle; others are skipped.
    alpha : float, default 0.05
        A cell counts as detected when ``p_value < alpha`` in any state; also the
        dashed reference line.
    adjusted : bool, optional
        ``None`` uses the multiplicity-adjusted ``p_adj`` for results whose
        ``correction`` is not "none" and the raw ``p_value`` otherwise; ``True``
        forces ``p_adj`` (raw where absent), ``False`` forces ``p_value``.  Governs
        ``fraction_significant``; ``adjusted_fraction`` is always the ``p_adj`` rate.

    Returns
    -------
    matplotlib.figure.Figure
        Grouped bars per result and planted population.
    """
    d = plot_ground_truth_recovery_data(session, resultset, alpha, adjusted)
    rows = d["rows"]
    df = pd.DataFrame(
        {
            k: rows[k]
            for k in (
                "result",
                "population",
                "n",
                "fraction_significant",
                "adjusted_fraction",
            )
        }
    )
    results = d["results"]
    fig, ax = plt.subplots(figsize=(max(5.0, 1.6 * len(results) + 2), 4.0), layout="constrained")
    if not results:
        ax.axis("off")
        ax.text(
            0.5, 0.5, "No ground truth or no shuffled cell-level results", ha="center", va="center"
        )
    else:
        order = d["populations"]
        width = 0.8 / len(order)
        xs = np.arange(len(results))
        hatch_done = False
        for j, pop in enumerate(order):
            h = d["bar_fraction"][j]
            xj = xs + (j - (len(order) - 1) / 2) * width
            label = "untuned (raw)" if pop == "untuned" and any(d["has_correction"]) else pop
            ax.bar(xj, np.nan_to_num(h), width, label=label, color=d["colors"][pop])
            if pop == "untuned":
                sub = df[df["population"] == "untuned"].set_index("result")["adjusted_fraction"]
                adj = np.array([sub.get(r, np.nan) for r in results], float)
                ok = np.isfinite(adj)
                if ok.any():
                    ax.bar(
                        xj[ok],
                        adj[ok],
                        width,
                        fill=False,
                        hatch="////",
                        edgecolor="k",
                        linewidth=0.5,
                        label="untuned (adjusted)",
                    )
                    hatch_done = True
        ax.axhline(alpha, color="k", ls="--", lw=1)
        ax.set_xticks(range(len(results)), d["labels"], fontsize=8)
        ax.set_ylim(0, 1.05)
        ax.set_ylabel("fraction significant")
        handles, labs = ax.get_legend_handles_labels()
        handles.append(Line2D([], [], color="k", ls="--", lw=1))
        labs.append(f"alpha={alpha:g}")
        ax.legend(
            handles, labs, fontsize=8, frameon=False, loc="upper left", bbox_to_anchor=(1.01, 1.0)
        )
        ax.set_title("Ground-truth recovery" + (" (hatched: adjusted)" if hatch_done else ""))
    fig.cabana_summary = df.reset_index(drop=True)  # type: ignore[attr-defined]
    return fig
