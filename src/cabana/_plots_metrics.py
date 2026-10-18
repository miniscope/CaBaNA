"""Figures for the Phase E metrics: place fields, circular tuning, signal decoding, pairwise.

Each ``plot_<x>`` has a ``plot_<x>_data`` companion returning everything the figure shows
(see :mod:`cabana._plot_data`); the renderer draws from that dict only.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import TwoSlopeNorm
from matplotlib.figure import Figure

from ._models import Session
from ._plot_registry import register_plot
from ._plot_style import (
    NULL_COLOR,
    OBSERVED_COLOR,
    UNVISITED_COLOR,
    heatmap_cmap,
    mark_significant,
    p_label,
)
from ._plots import (
    FLOOR_NOTE,
    _base,
    _cell_label,
    _grid_ticks,
    _ordered_cells,
    _page,
    _per_cell,
    _shape_maps,
    _significant,
    plot_rate_maps_data,
    rate_maps_defaults,
)
from ._results import MetricResult
from ._util import order_session_first

__all__ = [
    "plot_circular_tuning",
    "plot_circular_tuning_data",
    "plot_decode_signal",
    "plot_decode_signal_data",
    "plot_pairwise_matrix",
    "plot_pairwise_matrix_data",
    "plot_participation_ratio",
    "plot_participation_ratio_data",
    "plot_place_fields",
    "plot_place_fields_data",
]


def _p_text(result: MetricResult, idx: int, stat_default: str) -> tuple[str, bool]:
    """p text of cell ``idx`` (prefixed by the statistic when it is not the default)."""
    sh = result.shuffle
    if sh is None or np.ndim(sh.p_value) != 1:
        return "", False
    txt = p_label(sh, idx)
    stat = result.params.get("statistic", stat_default)
    if stat != stat_default:
        txt = f"{stat} {txt}"
    return txt, "(floor)" in txt


# --------------------------------------------------------------------------- #
# place fields
# --------------------------------------------------------------------------- #


def plot_place_fields_data(
    session: Session | MetricResult,
    result: MetricResult | Session,
    cells: Sequence[int] | None = None,
    max_cells: int | None = 24,
    page: int = 0,
) -> dict[str, Any]:
    """Data behind :func:`plot_place_fields`.

    Returns
    -------
    dict
        Everything of :func:`~cabana._plots.plot_rate_maps_data` (``rate_maps``,
        axes, edges, ``vmin``/``vmax``, paging; ``titles`` replaced by the field
        titles) plus ``field_labels`` (same layout as ``rate_maps``, int, 0 = no
        field), ``centroids`` ``(n, ndim)``, ``n_fields``, ``in_out_ratio`` and
        ``field_area`` per shown cell.  ``kind`` is ``"place_fields"``.
    """
    session, result = order_session_first(session, result)
    for key in ("field_labels", "centroid", "n_fields", "in_out_ratio", "field_area"):
        if key not in result.extras:
            raise ValueError(
                f"result for metric {result.metric!r} has no {key!r} in extras; "
                f"available keys: {sorted(result.extras)}"
            )
    d = plot_rate_maps_data(session, result, cells, max_cells, page, show_occupancy=False)
    if d["layout"] == "categorical":
        raise ValueError("plot_place_fields needs a 1-D or 2-D grid state space")
    shown = [int(c) for c in d["cells"]]
    lay = {"layout": d["layout"], "grid_shape": d.get("grid_shape")}
    lab = np.asarray(result.extras["field_labels"])[shown].astype(int)
    d["field_labels"] = _shape_maps(lab, lay) if shown else lab
    ex = result.extras
    d["centroids"] = np.asarray(ex["centroid"], float)[shown].reshape(len(shown), -1)
    d["n_fields"] = np.asarray(ex["n_fields"], float)[shown]
    d["in_out_ratio"] = np.asarray(ex["in_out_ratio"], float)[shown]
    d["field_area"] = np.asarray(ex["field_area"], float)[shown]
    titles, floors, ptexts = [], [], []
    for k, c in enumerate(shown):
        txt, floor = _p_text(result, c, "in_out_ratio")
        nf = int(d["n_fields"][k])
        ratio = d["in_out_ratio"][k]
        title = f"{_cell_label(result, c)}\n{nf} field{'s' if nf != 1 else ''}"
        title += f" · in/out {ratio:.2f}" if np.isfinite(ratio) else " · in/out –"
        if txt:
            title += ("\n" if txt.startswith("p_adj") else " · ") + txt
        titles.append(title)
        floors.append(floor)
        ptexts.append(txt)
    d["titles"], d["p_texts"], d["p_floor"] = titles, ptexts, np.asarray(floors, bool)
    d["notes"] = [n for n in d["notes"] if "floor" not in n] + ([FLOOR_NOTE] if any(floors) else [])
    d["notes"].append("Outline: place field(s); marker: centroid of the largest field")
    d["kind"] = "place_fields"
    return d


def _outline(ax: Any, mask: np.ndarray, xc: np.ndarray, yc: np.ndarray) -> None:
    """White contour of a 0/1 mask on bin centres (padded so border fields close)."""
    if not mask.any():
        return
    dx, dy = xc[1] - xc[0], yc[1] - yc[0]
    pad = np.pad(mask.astype(float), 1)
    xs = np.r_[xc[0] - dx, xc, xc[-1] + dx]
    ys = np.r_[yc[0] - dy, yc, yc[-1] + dy]
    lim = (ax.get_xlim(), ax.get_ylim())
    cs = ax.contour(xs, ys, pad.T, levels=[0.5], colors="white", linewidths=1.0)
    cs.set_gid("field_outline")
    ax.set_xlim(*lim[0])
    ax.set_ylim(*lim[1])


@register_plot(
    "place_fields",
    data=plot_place_fields_data,
    needs_session=True,
    level="cell",
    requires=("extras:rate_map", "extras:field_labels", "target", "topology"),
    defaults=rate_maps_defaults,
)
def plot_place_fields(
    session: Session | MetricResult,
    result: MetricResult | Session,
    cells: Sequence[int] | None = None,
    *,
    max_cells: int | None = 24,
    page: int = 0,
    ncols: int = 6,
    show_centroid: bool = True,
) -> Figure:
    """Rate maps with the detected place field(s) outlined and the centroid marked.

    ``session`` and ``result`` may be given in either order.  Look for: one compact
    outline around the bright patch of the map (a clean place field), several outlines
    or a large outlined area (a diffuse or multi-peaked cell), and a centroid that sits
    inside the outline; light-grey bins were never visited and are not zero.

    Parameters
    ----------
    session : Session
        Supplies the grid, axis units and activity kind.
    result : MetricResult
        A ``place_fields`` result (extras ``rate_map``, ``field_labels``, ``centroid``...).
    cells : sequence of int, optional
        Row indices to draw; ``None`` picks significant cells first, then by value.
    max_cells : int, default 24
        Panels per figure (paging).
    page : int, default 0
        Which block of ``max_cells`` cells to draw.
    ncols : int, default 6
        Maximum panels per row.
    show_centroid : bool, default True
        Mark the centroid of the largest field.

    Returns
    -------
    matplotlib.figure.Figure
        One panel per cell with a shared colourbar (2-D) or a shared rate axis (1-D).
    """
    d = plot_place_fields_data(session, result, cells, max_cells=max_cells, page=page)
    n = len(d["cells"])
    ncols = max(1, min(ncols, max(n, 1)))
    nrows = int(np.ceil(max(n, 1) / ncols))
    fig, axes = plt.subplots(
        nrows, ncols, figsize=(2.6 * ncols, 2.6 * nrows + 0.5), squeeze=False, layout="constrained"
    )
    titles, notes = list(d["titles"]), list(d["notes"])
    cm = heatmap_cmap("viridis", d["unvisited_color"])
    maps, labs, cen = d["rate_maps"], d["field_labels"], d["centroids"]
    grid2d = d["layout"] == "grid2d"
    last_im, drawn = None, []
    for k, ax in enumerate(axes.ravel()):
        if k >= n:
            ax.axis("off")
            continue
        drawn.append(ax)
        ax.set_title(titles[k], fontsize=7)
        m, lab = maps[k], labs[k]
        if grid2d:
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
            _outline(ax, lab > 0, d["centers"][0], d["centers"][1])
            if show_centroid and np.isfinite(cen[k]).all():
                ax.plot(*cen[k][:2], "o", ms=4, mfc="white", mec="k", mew=0.8)
        else:
            xe, xc = d["edges"][0], d["centers"][0]
            ax.plot(xc, m, color="C0")
            for i in np.flatnonzero(np.isnan(m)):
                ax.axvspan(xe[i], xe[i + 1], color=d["unvisited_color"], lw=0, zorder=0)
            for i in np.flatnonzero(lab > 0):
                ax.axvspan(xe[i], xe[i + 1], color=OBSERVED_COLOR, alpha=0.25, lw=0, zorder=0)
            ax.set_ylim(min(d["vmin"], 0.0), d["vmax"] * 1.05)
            ax.tick_params(labelsize=7)
            if show_centroid and np.isfinite(cen[k]).all():
                ax.plot(cen[k][0], d["vmax"] * 1.02, "v", ms=4, mfc="white", mec="k", mew=0.8)
        if d["significant"][k]:
            mark_significant(
                ax, [0.93], [0.9], transform=ax.transAxes, clip_on=False, label="significant"
            )
    if grid2d and last_im is not None:
        fig.colorbar(last_im, ax=drawn, label=d["rate_label"], fraction=0.04, pad=0.02)
    elif drawn:
        drawn[0].set_ylabel(d["rate_label"], fontsize=7)
        drawn[0].set_xlabel(d["axis_labels"][0], fontsize=7)
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


# --------------------------------------------------------------------------- #
# circular tuning
# --------------------------------------------------------------------------- #


def plot_circular_tuning_data(
    result: MetricResult,
    cells: Sequence[int] | None = None,
    max_cells: int | None = 16,
    page: int = 0,
) -> dict[str, Any]:
    """Data behind :func:`plot_circular_tuning`.

    Returns
    -------
    dict
        ``cells``, ``cell_labels``, ``tuning_curve`` ``(n, n_bins)`` (NaN = invalid bin),
        ``bin_centers`` (input units), ``bin_centers_rad``, ``preferred_direction``
        (input units), ``preferred_direction_rad``, ``mvl``, ``significant``, ``titles``,
        ``p_texts``, ``units`` (``"deg"`` or ``"rad"``), ``period`` (one turn in input
        units), ``notes`` and ``paging``.
    """
    ex = result.extras
    for key in ("tuning_curve", "bin_centers"):
        if key not in ex:
            raise ValueError(f"result has no {key!r} in extras; available keys: {sorted(ex)}")
    units = str(result.params.get("units", "deg"))
    period = 360.0 if units == "deg" else 2.0 * np.pi
    all_cells = _ordered_cells(result) if cells is None else [int(c) for c in cells]
    shown, page, n_pages = _page(all_cells, max_cells, page)
    curve = np.asarray(ex["tuning_curve"], float)[shown]
    bc = np.asarray(ex["bin_centers"], float)
    n_all = np.asarray(ex["tuning_curve"]).shape[0]
    mvl_all = np.asarray(ex.get("mvl", np.full(n_all, np.nan)), float)
    pref_all = np.asarray(ex.get("preferred_direction", np.full(n_all, np.nan)), float)
    sig = _significant(result)
    sig_c = _per_cell(sig) if sig is not None and sig.shape[:1] == (n_all,) else None
    titles, ptexts, sigs, floors = [], [], [], []
    for c in shown:
        txt, floor = _p_text(result, c, "mvl")
        t = (
            f"{_cell_label(result, c)}\nMVL {mvl_all[c]:.2f}"
            if np.isfinite(mvl_all[c])
            else (f"{_cell_label(result, c)}\nMVL –")
        )
        if txt:
            t += ("\n" if txt.startswith("p_adj") else " · ") + txt
        titles.append(t)
        ptexts.append(txt)
        floors.append(floor)
        sigs.append(bool(sig_c[c]) if sig_c is not None else False)
    notes = [FLOOR_NOTE] if any(floors) else []
    return _base(
        "circular_tuning",
        cells=np.asarray(shown, int),
        cell_labels=[_cell_label(result, c) for c in shown],
        tuning_curve=curve,
        bin_centers=bc,
        bin_centers_rad=bc * (2.0 * np.pi / period),
        preferred_direction=pref_all[shown],
        preferred_direction_rad=pref_all[shown] * (2.0 * np.pi / period),
        mvl=mvl_all[shown],
        significant=np.asarray(sigs, bool),
        titles=titles,
        p_texts=ptexts,
        units=units,
        period=period,
        notes=notes,
        paging={
            "page": page,
            "n_pages": n_pages,
            "max_cells": max_cells,
            "n_total": len(all_cells),
        },
    )


@register_plot(
    "circular_tuning",
    data=plot_circular_tuning_data,
    level="cell",
    requires=("extras:tuning_curve", "extras:bin_centers"),
    defaults=rate_maps_defaults,
)
def plot_circular_tuning(
    result: MetricResult,
    cells: Sequence[int] | None = None,
    *,
    max_cells: int | None = 16,
    page: int = 0,
    ncols: int = 4,
    polar: bool = True,
) -> Figure:
    """Per-cell circular tuning curves with the preferred direction.

    Look for: a single lobe pointing along a long arrow (strongly direction-tuned, high
    MVL), versus a near-circular curve with a short arrow (untuned); gaps in the curve
    are directions never sampled.  Angle zero is at the right and increases
    counter-clockwise (the polar default).

    Parameters
    ----------
    result : MetricResult
        A ``circular_tuning`` result (extras ``tuning_curve``, ``bin_centers``...).
    cells : sequence of int, optional
        Rows to draw; ``None`` is significant cells first, then by descending value.
    max_cells : int, default 16
        Panels per figure (paging).
    page : int, default 0
        Which block of ``max_cells`` cells.
    ncols : int, default 4
        Maximum panels per row.
    polar : bool, default True
        Polar axes with an arrow (length = MVL times the curve maximum) at the preferred
        direction; ``False`` gives a linear curve over the bin centres in the input units
        with a vertical line at the preferred direction.

    Returns
    -------
    matplotlib.figure.Figure
    """
    d = plot_circular_tuning_data(result, cells, max_cells=max_cells, page=page)
    n = len(d["cells"])
    ncols = max(1, min(ncols, max(n, 1)))
    nrows = int(np.ceil(max(n, 1) / ncols))
    fig, axes = plt.subplots(
        nrows,
        ncols,
        figsize=(2.5 * ncols, 2.5 * nrows + 0.4),
        squeeze=False,
        layout="constrained",
        subplot_kw={"projection": "polar"} if polar else None,
    )
    rad = d["units"] == "rad"
    th = d["bin_centers_rad"]
    for k, ax in enumerate(axes.ravel()):
        if k >= n:
            ax.axis("off")
            continue
        ax.set_title(d["titles"][k], fontsize=7)
        r = d["tuning_curve"][k]
        finite = r[np.isfinite(r)]
        rmax = float(finite.max()) if finite.size else 1.0
        rmax = rmax if rmax > 0 else 1.0
        pref, mvl = d["preferred_direction_rad"][k], d["mvl"][k]
        if polar:
            ax.plot(np.r_[th, th[0] + 2 * np.pi], np.r_[r, r[0]], color="C0", lw=1.2)
            ax.set_ylim(0, rmax * 1.05)
            ax.set_yticks([])
            ax.set_xticks(np.deg2rad([0, 90, 180, 270]))
            ax.set_xticklabels(
                ["0", "π/2", "π", "3π/2"] if rad else ["0°", "90°", "180°", "270°"], fontsize=6
            )
            if np.isfinite(pref) and np.isfinite(mvl):
                ax.annotate(
                    "",
                    xy=(pref, mvl * rmax),
                    xytext=(0, 0),
                    arrowprops={"arrowstyle": "-|>", "color": OBSERVED_COLOR, "lw": 1.4},
                )
        else:
            ax.plot(d["bin_centers"], r, color="C0", lw=1.2)
            ax.set_xlim(0, d["period"])
            ax.set_ylim(0, rmax * 1.05)
            ax.tick_params(labelsize=7)
            if np.isfinite(d["preferred_direction"][k]):
                ax.axvline(d["preferred_direction"][k], color=OBSERVED_COLOR, lw=1.2)
            if k // ncols == nrows - 1 or k + ncols >= n:
                ax.set_xlabel(f"direction ({d['units']})", fontsize=7)
        if d["significant"][k]:
            mark_significant(
                ax, [0.93], [0.93], transform=ax.transAxes, clip_on=False, label="significant"
            )
    paging = d["paging"]
    if paging["n_pages"] > 1:
        fig.suptitle(
            f"cells page {paging['page'] + 1}/{paging['n_pages']} "
            f"({paging['n_total']} cells, {paging['max_cells']} per page)",
            fontsize=8,
        )
    notes = list(d["notes"]) + ["Radius / height: mean activity per bin (own scale per cell)"]
    fig.supxlabel("\n".join(notes), fontsize=7, x=0.01, ha="left")
    return fig


# --------------------------------------------------------------------------- #
# decode signal
# --------------------------------------------------------------------------- #

_MAX_SCATTER = 5000


def plot_decode_signal_data(
    result: MetricResult,
    session: Session | MetricResult,
    t_range: tuple[float, float] | None = None,
    channels: Sequence[int | str] | None = None,
) -> dict[str, Any]:
    """Data behind :func:`plot_decode_signal`.

    The true signal is aligned to the prediction: the prediction at frame ``t`` estimates
    the signal at ``t + lag_s``, so ``true`` is the signal shifted by that lag.

    Returns
    -------
    dict
        ``t`` ``(n_win,)``, ``true`` and ``prediction`` ``(n_win, n_channels)`` (NaN on
        frames the decoder did not use), ``scatter_true`` / ``scatter_prediction``
        ``(n_pts, n_channels)`` (all used frames, subsampled to at most 5000),
        ``channel_names``, ``channels`` (indices), ``r2``, ``corr``, ``mae``,
        ``chance_mae`` ``(n_channels,)``, ``fold_scores`` ``(n_folds, n_channels)``,
        ``statistic``, ``units`` (per channel), ``t_range``, ``lag_s``.
    """
    result, session = (
        (result, session) if isinstance(session, Session) else (session, result)
    )  # either order
    ex = result.extras
    if "prediction" not in ex:
        raise ValueError(f"result has no 'prediction' in extras; available keys: {sorted(ex)}")
    pred = np.asarray(ex["prediction"], float)
    if pred.ndim == 1:
        pred = pred[:, None]
    if result.target not in session.signals:
        raise ValueError(f"signal {result.target!r} not in session.signals")
    sig = np.asarray(session.signals[result.target], float)
    sig = sig[:, None] if sig.ndim == 1 else sig.reshape(sig.shape[0], -1)
    n_time, dim = pred.shape
    lag = int(round(float(result.params.get("lag_s", 0.0)) * session.fs))
    true = np.full_like(pred, np.nan)
    if abs(lag) < n_time:
        if lag >= 0:
            true[: n_time - lag] = sig[lag:]
        else:
            true[-lag:] = sig[: n_time + lag]
    names = [str(s) for s in ex.get("group_names", [str(i) for i in range(dim)])]
    if channels is None:
        idx = list(range(min(dim, 4)))
    else:
        idx = [names.index(c) if isinstance(c, str) else int(c) for c in channels]
    t = np.asarray(session.t, float)
    valid = np.isfinite(pred).all(axis=1)
    if t_range is None:
        t0 = float(t[np.flatnonzero(valid)[0]]) if valid.any() else float(t[0])
        t_range = (t0, t0 + 60.0)
    win = (t >= t_range[0]) & (t <= t_range[1])
    ok = valid & np.isfinite(true).all(axis=1)
    pts = np.flatnonzero(ok)
    if pts.size > _MAX_SCATTER:
        pts = pts[np.linspace(0, pts.size - 1, _MAX_SCATTER).astype(int)]
    scalars = {
        k: np.asarray(ex[k], float).reshape(-1)[idx] if k in ex else np.full(len(idx), np.nan)
        for k in ("r2", "corr", "mae", "chance_mae")
    }
    folds = np.asarray(ex.get("fold_scores", np.empty((0, dim))), float)
    folds = folds.reshape(folds.shape[0], -1)[:, idx] if folds.size else folds
    su = session.meta.get("signal_units", {}) or {}
    units = [str(su.get(result.target if dim == 1 else names[i], "") or "") for i in idx]
    return _base(
        "decode_signal",
        t=t[win],
        true=true[win][:, idx],
        prediction=pred[win][:, idx],
        scatter_true=true[pts][:, idx],
        scatter_prediction=pred[pts][:, idx],
        channel_names=[names[i] for i in idx],
        channels=np.asarray(idx, int),
        fold_scores=folds,
        statistic=str(result.params.get("statistic", "r2")),
        units=units,
        t_range=np.asarray(t_range, float),
        lag_s=float(result.params.get("lag_s", 0.0)),
        **scalars,
    )


@register_plot(
    "decode_signal",
    data=plot_decode_signal_data,
    needs_session=True,
    level="population",
    requires=("extras:prediction",),
)
def plot_decode_signal(
    result: MetricResult,
    session: Session | MetricResult,
    *,
    t_range: tuple[float, float] | None = None,
    channels: Sequence[int | str] | None = None,
) -> Figure:
    """Held-out prediction of a continuous signal from the population, per channel.

    Look for: the coloured prediction following the grey true trace (not just its slow
    drift), a scatter that hugs the identity line, and a mean absolute error well below
    the chance error (the error of always predicting the training mean).

    Parameters
    ----------
    result : MetricResult
        A ``decode_signal`` result (extras ``prediction``, ``r2``, ``corr``, ``mae``...).
    session : Session
        Supplies the true signal ``session.signals[result.target]``, the time axis and
        optional ``meta["signal_units"]``.  Either argument order works.
    t_range : (float, float), optional
        Time window (s) of the trace panels; default the first 60 s from the first frame
        the decoder used.
    channels : sequence of int or str, optional
        Channels to draw (indices or names); default the first four.

    Returns
    -------
    matplotlib.figure.Figure
        One row per channel: trace (left) and true-vs-predicted scatter (right).
    """
    d = plot_decode_signal_data(result, session, t_range=t_range, channels=channels)
    n = len(d["channel_names"])
    fig, axes = plt.subplots(
        max(n, 1),
        2,
        figsize=(9.0, 2.2 * max(n, 1) + 0.6),
        squeeze=False,
        layout="constrained",
        gridspec_kw={"width_ratios": [3, 1]},
    )
    stat_names = {"r2": "R²", "corr": "r", "mae": "MAE"}
    for k in range(n):
        ax, sx = axes[k]
        unit = f" ({d['units'][k]})" if d["units"][k] else ""
        ax.plot(d["t"], d["true"][:, k], color="0.45", lw=1.0, label="true")
        ax.plot(d["t"], d["prediction"][:, k], color=OBSERVED_COLOR, lw=1.0, label="predicted")
        ax.set_ylabel(d["channel_names"][k] + unit, fontsize=8)
        ax.set_xlim(*d["t_range"])
        if k == 0:
            ax.legend(loc="upper right", ncols=2, fontsize=7)
        if k == n - 1:
            ax.set_xlabel("time (s)")
        if d["fold_scores"].size and k == 0:
            fs_txt = " ".join(f"{v:.2f}" for v in d["fold_scores"][:, k])
            ax.text(
                0.01,
                0.97,
                f"{stat_names.get(d['statistic'], d['statistic'])} per fold: {fs_txt}",
                transform=ax.transAxes,
                fontsize=6.5,
                va="top",
                color="0.3",
            )
        a, b = d["scatter_true"][:, k], d["scatter_prediction"][:, k]
        sx.scatter(a, b, s=3, alpha=0.25, color=OBSERVED_COLOR, lw=0, rasterized=True)
        both = np.r_[a, b]
        both = both[np.isfinite(both)]
        if both.size:
            lo, hi = float(both.min()), float(both.max())
            sx.plot([lo, hi], [lo, hi], color="k", lw=0.8, ls="--")
        sx.set_aspect("equal", adjustable="datalim")
        sx.set_xlabel("true" + unit, fontsize=7)
        sx.set_ylabel("predicted", fontsize=7)
        sx.tick_params(labelsize=7)
        sx.set_title(
            f"R² {d['r2'][k]:.2f} · r {d['corr'][k]:.2f}\n"
            f"MAE {d['mae'][k]:.3g} (chance {d['chance_mae'][k]:.3g})",
            fontsize=7.5,
        )
    return fig


# --------------------------------------------------------------------------- #
# pairwise correlation matrix
# --------------------------------------------------------------------------- #


def _cluster_order(m: np.ndarray) -> np.ndarray:
    """Spectral ordering: angle of the loadings on the first two eigenvectors.

    NaN entries count as 0 and the diagonal as 1.  Cells are sorted by the angle of
    their (PC1, PC2) loadings, cutting the circle at its largest empty gap, so cells that
    covary strongly end up adjacent.  Pure numpy, ``O(n^3)`` in the number of cells only
    through one eigendecomposition.
    """
    n = m.shape[0]
    if n < 3:
        return np.arange(n)
    a = np.nan_to_num(m.copy())
    np.fill_diagonal(a, 1.0)
    a = (a + a.T) / 2.0
    w, v = np.linalg.eigh(a)
    x, y = v[:, -1], v[:, -2]
    ang = np.mod(np.arctan2(y, x), 2 * np.pi)
    order = np.argsort(ang, kind="stable")
    gaps = np.diff(np.r_[ang[order], ang[order][0] + 2 * np.pi])
    start = (int(np.argmax(gaps)) + 1) % n
    return np.roll(order, -start)


def _state_order(result: MetricResult, n: int) -> np.ndarray:
    sm = result.extras.get("state_means")
    if sm is None or np.ndim(sm) != 2 or np.asarray(sm).shape[0] != n:
        return np.arange(n)
    sm = np.asarray(sm, float)
    has = np.isfinite(sm).any(axis=1)
    pref = np.where(has, np.argmax(np.where(np.isfinite(sm), sm, -np.inf), axis=1), sm.shape[1])
    return np.argsort(pref, kind="stable")


def plot_pairwise_matrix_data(
    result: MetricResult,
    order: str = "cluster",
    vmin: float = -1.0,
    vmax: float = 1.0,
    show_ids: bool = True,
) -> dict[str, Any]:
    """Data behind :func:`plot_pairwise_matrix`.

    Returns
    -------
    dict
        ``matrix`` ``(n, n)`` reordered, diagonal NaN; ``order`` (permutation of
        original indices), ``cell_ids`` (reordered), ``significant`` (reordered bool
        matrix, adjusted when a correction was applied, or ``None``), ``corr_kind``
        (``"total"``/``"signal"``/``"noise"``; ``kind`` is the plot name),
        ``mean_offdiag``, ``frac_significant`` (of off-diagonal pairs, NaN without a
        shuffle), ``vmin``, ``vmax``, ``show_ids`` (False above 60 cells), ``title``.
    """
    if order not in ("cluster", "none", "state"):
        raise ValueError(f"order must be 'cluster', 'none' or 'state', got {order!r}")
    m = np.asarray(result.values, float)
    if m.ndim != 2 or m.shape[0] != m.shape[1]:
        raise ValueError(f"expected a square matrix, got values of shape {m.shape}")
    n = m.shape[0]
    ids = result.state_names or result.cell_ids or [str(i) for i in range(n)]
    ids = [str(s) for s in ids] if len(ids) == n else [str(i) for i in range(n)]
    perm = {"cluster": _cluster_order, "none": lambda a: np.arange(n)}.get(order)
    perm = _state_order(result, n) if order == "state" else perm(m)
    mat = m[np.ix_(perm, perm)].copy()
    np.fill_diagonal(mat, np.nan)
    sig = _significant(result)
    sig_o, frac = None, float("nan")
    if sig is not None and sig.shape == (n, n):
        sig_o = np.asarray(sig, bool)[np.ix_(perm, perm)]
        off = ~np.eye(n, dtype=bool) & np.isfinite(mat)
        frac = float(sig_o[off].mean()) if off.any() else float("nan")
    kind = str(result.params.get("kind", "total"))
    mo = result.extras.get("mean_offdiag")
    mean_off = float(np.asarray(mo).reshape(-1)[0]) if mo is not None else float("nan")
    adj = result.shuffle is not None and result.shuffle.correction != "none"
    title = f"{kind} correlation · mean off-diagonal {mean_off:.3f}"
    if np.isfinite(frac):
        title += f"\n{100 * frac:.0f}% of pairs significant" + (" (adjusted)" if adj else "")
    return _base(
        "pairwise_matrix",
        matrix=mat,
        order=np.asarray(perm, int),
        cell_ids=[ids[i] for i in perm],
        significant=sig_o,
        corr_kind=kind,
        mean_offdiag=mean_off,
        frac_significant=frac,
        vmin=float(vmin),
        vmax=float(vmax),
        show_ids=bool(show_ids and n <= 60),
        title=title,
    )


@register_plot(
    "pairwise_matrix",
    data=plot_pairwise_matrix_data,
    level="population",
    requires=("extras:mean_offdiag",),
)
def plot_pairwise_matrix(
    result: MetricResult,
    *,
    order: str = "cluster",
    vmin: float = -1.0,
    vmax: float = 1.0,
    show_ids: bool = True,
) -> Figure:
    """Cell-by-cell correlation matrix, optionally reordered so correlated cells are adjacent.

    Look for: blocks of red along the diagonal (assemblies of co-active cells) rather than
    a uniform wash; a near-zero mean off-diagonal with scattered pairs is weak coupling.
    The diagonal is left grey (self-correlation carries no information).

    Parameters
    ----------
    result : MetricResult
        A ``pairwise_correlation`` result with a square ``values`` matrix.
    order : {"cluster", "none", "state"}, default "cluster"
        ``"cluster"``: spectral ordering, cells sorted by the angle of their loadings on
        the first two eigenvectors of the matrix (cut at the largest gap); ``"none"``: as
        stored; ``"state"``: by preferred state (argmax of ``extras["state_means"]``, as
        stored when it is absent).
    vmin, vmax : float, default -1, 1
        Colour limits of the diverging map (centred on 0).
    show_ids : bool, default True
        Cell ids on the axes (only for 60 cells or fewer; every second one above 30).

    Returns
    -------
    matplotlib.figure.Figure
    """
    d = plot_pairwise_matrix_data(result, order, vmin, vmax, show_ids)
    n = d["matrix"].shape[0]
    fig, ax = plt.subplots(figsize=(5.8, 5.0), layout="constrained")
    cm = heatmap_cmap("RdBu_r", UNVISITED_COLOR)
    norm = TwoSlopeNorm(0.0, d["vmin"], d["vmax"]) if d["vmin"] < 0 < d["vmax"] else None
    im = ax.imshow(
        np.ma.masked_invalid(d["matrix"]),
        cmap=cm,
        norm=norm,
        vmin=None if norm else d["vmin"],
        vmax=None if norm else d["vmax"],
        interpolation="nearest",
        aspect="equal",
    )
    if d["show_ids"]:
        step = int(np.ceil(n / 30))  # every label up to 30 cells, thinned above
        pos = np.arange(0, n, step)
        ax.set_xticks(pos, [d["cell_ids"][i] for i in pos], rotation=90, fontsize=6)
        ax.set_yticks(pos, [d["cell_ids"][i] for i in pos], fontsize=6)
    else:
        ax.set_xlabel("cells")
        ax.set_ylabel("cells")
    ax.set_title(d["title"], fontsize=9)
    fig.colorbar(im, ax=ax, label=f"{d['corr_kind']} correlation", fraction=0.046, pad=0.02)
    return fig


# --------------------------------------------------------------------------- #
# participation ratio
# --------------------------------------------------------------------------- #


def plot_participation_ratio_data(result: MetricResult) -> dict[str, Any]:
    """Data behind :func:`plot_participation_ratio`.

    Returns
    -------
    dict
        ``eigenvalues`` and ``variance_explained`` (cumulative) per component, ``pr``
        (``(sum lambda)^2 / sum lambda^2`` of the overall spectrum), ``null_lo`` /
        ``null_hi`` (the shuffle's significance band for the overall PR, NaN otherwise),
        ``p_text`` (empty without a test), ``alpha``, ``title``.
    """
    ex = result.extras
    if "eigenvalues" not in ex:
        raise ValueError(f"result has no 'eigenvalues' in extras; available keys: {sorted(ex)}")
    lam = np.asarray(ex["eigenvalues"], float)
    cum = np.asarray(ex.get("variance_explained", np.full(lam.shape, np.nan)), float)
    s2 = float(np.sum(lam**2))
    pr = float(np.sum(lam) ** 2 / s2) if np.isfinite(lam).all() and s2 > 0 else float("nan")
    sh = result.shuffle
    lo = hi = float("nan")
    p_text, alpha = "", float("nan")
    if sh is not None and np.size(sh.p_value) == 1:
        lo, hi = (
            float(np.asarray(sh.null_lo).reshape(-1)[0]),
            float(np.asarray(sh.null_hi).reshape(-1)[0]),
        )
        p_text, alpha = p_label(sh, 0 if np.ndim(sh.p_value) == 1 else ()), float(sh.alpha)
    title = f"participation ratio {pr:.2f} of {lam.size}"
    if np.isfinite(lo):
        title += f" · null {100 * (1 - alpha):.0f}% band [{lo:.2f}, {hi:.2f}]"
    if p_text:
        title += f" · {p_text}"
    return _base(
        "participation_ratio",
        eigenvalues=lam,
        variance_explained=cum,
        pr=pr,
        null_lo=lo,
        null_hi=hi,
        p_text=p_text,
        alpha=alpha,
        title=title,
    )


@register_plot(
    "participation_ratio",
    data=plot_participation_ratio_data,
    level="population",
    requires=("extras:eigenvalues",),
)
def plot_participation_ratio(result: MetricResult) -> Figure:
    """Eigen-spectrum of the population covariance with cumulative variance explained.

    Look for: a spectrum dominated by a few components with the cumulative line rising
    steeply (low-dimensional activity, small participation ratio) versus a flat spectrum
    and a slowly rising line (activity spread over many dimensions); compare the value
    with the null band in the title.

    Parameters
    ----------
    result : MetricResult
        A ``participation_ratio`` result (extras ``eigenvalues``, ``variance_explained``).

    Returns
    -------
    matplotlib.figure.Figure
        Bars: eigenvalue per component (left axis); line: cumulative variance explained
        (right axis).
    """
    d = plot_participation_ratio_data(result)
    lam = d["eigenvalues"]
    x = np.arange(1, lam.size + 1)
    fig, ax = plt.subplots(figsize=(5.8, 3.6), layout="constrained")
    ax.bar(x, np.nan_to_num(lam), color=NULL_COLOR, width=0.8)
    ax.set_xlabel("component")
    ax.set_ylabel("eigenvalue")
    ax2 = ax.twinx()
    ax2.spines["right"].set_visible(True)
    ax2.plot(x, d["variance_explained"], color=OBSERVED_COLOR, marker="o", ms=2.5, lw=1.2)
    ax2.set_ylim(0, 1.02)
    ax2.set_ylabel("cumulative variance explained")
    ax.set_title(d["title"], fontsize=8.5)
    return fig
