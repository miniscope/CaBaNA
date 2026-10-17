"""Plots for information-theoretic analyses, with matplotlib-free ``*_data`` companions.

Each ``plot_x(...)`` calls ``plot_x_data(...)`` and draws from the returned dict only.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import matplotlib as mpl
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.collections import LineCollection
from matplotlib.figure import Figure
from scipy.stats import spearmanr

from ._models import Session, StateSpace
from ._plot_data import PLOT_DATA_VERSION
from ._plot_registry import register_plot
from ._plot_style import (
    NULL_COLOR,
    OBSERVED_COLOR,
    UNVISITED_COLOR,
    axis_label,
    mark_significant,
    p_label,
    ordered_names,
    state_colors,
)
from ._plots import _cell_label, _get_ax, _significant
from ._plots_sweep import plot_sweep, plot_sweep_data
from ._results import MetricResult
from ._util import order_session_first

__all__ = [
    "plot_decoded_trajectory",
    "plot_decoded_trajectory_data",
    "plot_information_comparison",
    "plot_information_comparison_data",
    "plot_joint_histogram",
    "plot_joint_histogram_data",
    "plot_level_sweep",
    "plot_level_sweep_data",
]


def _level_labels(edges: np.ndarray) -> list[str]:
    """Tick labels for activity levels from one cell's ``(n_levels + 1,)`` edges."""
    n = len(edges) - 1
    labels = []
    for k in range(n):
        lo, hi = edges[k], edges[k + 1]
        if k == n - 1:
            labels.append(f"≥{lo:.2g}")
        elif k == 0 and hi > 0 and lo <= 0:
            labels.append("0")
        else:
            labels.append(f"{lo:.2g}–{hi:.2g}")
    return labels


def _normalized(
    result: MetricResult, normalize: str, cells: Sequence[int] | None = None
) -> tuple[np.ndarray, str, dict[str, Any]]:
    """Return ``(n_cells, n_states, n_levels)`` array, colourbar label and colour limits."""
    ex = result.extras
    for key in ("joint", "conditional", "edges"):
        if key not in ex:
            raise ValueError(
                f"result for metric {result.metric!r} has no {key!r} in extras; "
                f"available keys: {sorted(ex)}"
            )
    sel = slice(None) if cells is None else list(cells)
    joint = np.asarray(ex["joint"], float)[sel]
    cond = np.asarray(ex["conditional"], float)[sel]
    valid = np.asarray(ex["valid"], bool) if "valid" in ex else np.ones(joint.shape[1], bool)
    if normalize == "conditional":
        return cond, "p(level | state)", {"cmap": "viridis"}
    with np.errstate(divide="ignore", invalid="ignore"):
        total = joint.sum(axis=(1, 2), keepdims=True)
        if normalize == "joint":
            arr = joint / total
            arr[:, ~valid, :] = np.nan
            return arr, "p(state, level)", {"cmap": "viridis"}
        if normalize == "lift":
            p_level = joint.sum(axis=1, keepdims=True) / total  # (cells, 1, levels)
            lift = np.where(p_level > 0, cond / p_level, np.nan)
            log_lift = np.log2(np.where(lift > 0, lift, np.nan))
            # zero lift is -inf in log space; clip so the map stays finite
            log_lift = np.where(lift == 0, -np.inf, log_lift)
            fin = log_lift[np.isfinite(log_lift)]
            half = max(float(np.abs(fin).max()) if fin.size else 1.0, 0.5)
            log_lift = np.where(np.isneginf(log_lift), -half, log_lift)
            return (
                log_lift,
                "log2 lift = log2[p(level | state) / p(level)]",
                {"cmap": "RdBu_r", "vmin": -half, "vmax": half},
            )
    raise ValueError(f"normalize must be 'conditional', 'joint' or 'lift', got {normalize!r}")


def plot_joint_histogram_data(
    result: MetricResult,
    cells: int | Sequence[int],
    states: StateSpace | None = None,
    normalize: str = "lift",
) -> dict[str, Any]:
    """Everything :func:`plot_joint_histogram` draws, as plain arrays.

    Keys: ``panels`` ``(n_cells, n_states, n_levels)`` in the normalised quantity
    (NaN for states never visited / below minimum occupancy -- drawn as unvisited,
    never as zero), ``cells``, ``cell_ids``, ``titles``, ``level_labels`` (one list
    per cell, from that cell's edges), ``edges``, ``vmin``, ``vmax``, ``cmap``,
    ``cbar_label`` (the quantity), ``normalize``, and ``layout`` (``"grid2d"`` with
    ``grid_shape``, ``extent`` and ``axis_names``; ``"grid1d"`` with ``x_extent`` and
    ``x_label``; or ``"categorical"`` with ``state_names``).  ``kind="joint_histogram"``.

    Parameters
    ----------
    result : MetricResult
        Needs ``extras`` ``joint``, ``conditional`` and ``edges``.
    cells : int or sequence of int
        Cell indices (rows of ``result.values``).
    states : StateSpace, optional
        The space the result was computed on; supplies the grid layout.
    normalize : {"lift", "conditional", "joint"}, default "lift"
        ``"lift"`` is log2 of p(level | state) / p(level), the per-cell quantity that
        mutual information averages; ``"conditional"`` is p(level | state);
        ``"joint"`` is p(state, level).
    """
    cells_l = [int(cells)] if np.isscalar(cells) else [int(c) for c in cells]  # type: ignore[arg-type]
    if not cells_l:
        raise ValueError("cells must not be empty")
    arr, cbar_label, kw = _normalized(result, normalize, cells_l)
    edges = np.asarray(result.extras["edges"], float)
    values = np.asarray(result.values, float)
    sh = result.shuffle
    unit = "bits/event" if result.params.get("units") == "bits_per_event" else "bits"

    def title(c: int) -> str:
        t = f"cell {_cell_label(result, c)}: MI = {values[c]:.3f} {unit}"
        if sh is not None and np.ndim(sh.p_value) == 1:
            t += f", {p_label(sh, c)}"
        return t

    panels = arr
    if "vmin" in kw:
        vmin, vmax = float(kw["vmin"]), float(kw["vmax"])
    else:
        fin = panels[np.isfinite(panels)]
        vmin, vmax = 0.0, float(fin.max()) if fin.size and fin.max() > 0 else 1.0
    topo = states.topology if states is not None else None
    out: dict[str, Any] = {
        "kind": "joint_histogram",
        "version": PLOT_DATA_VERSION,
        "normalize": normalize,
        "panels": panels,
        "cells": cells_l,
        "cell_ids": [_cell_label(result, c) for c in cells_l],
        "titles": [title(c) for c in cells_l],
        "level_labels": [_level_labels(edges[c]) for c in cells_l],
        "edges": edges[cells_l],
        "vmin": vmin,
        "vmax": vmax,
        "cmap": kw["cmap"],
        "cbar_label": cbar_label,
        "ylabel": "activity level",
    }
    if topo is not None and topo.ndim == 2:
        out.update(
            layout="grid2d",
            grid_shape=list(topo.shape),
            extent=[float(topo.edges[0][0]), float(topo.edges[0][-1])]
            + [float(topo.edges[1][0]), float(topo.edges[1][-1])],
            axis_names=list(topo.axis_names),
        )
    elif topo is not None and topo.ndim == 1:
        cen = np.asarray(topo.centers()[0], float)
        half = np.diff(topo.edges[0]) / 2
        out.update(
            layout="grid1d",
            x_extent=[float(cen[0] - half[0]), float(cen[-1] + half[-1])],
            x_label=topo.axis_names[0],
        )
    else:
        names = result.state_names or (list(states.state_names) if states is not None else None)
        out.update(
            layout="categorical", state_names=ordered_names(names, arr.shape[1]), x_label="state"
        )
    return out


def _joint_defaults(result: MetricResult, session: Any) -> dict[str, Any]:
    """The most significant cell (lowest p, else largest MI) and the target's state space."""
    vals = np.asarray(result.values, float)
    if result.shuffle is not None and np.ndim(result.shuffle.p_value) == 1:
        sh = result.shuffle
        adj = getattr(sh, "correction", "none") not in (None, "none") and sh.p_adj is not None
        p = np.nan_to_num(np.asarray(sh.p_adj if adj else sh.p_value, float), nan=np.inf)
        c = int(np.lexsort((-np.nan_to_num(vals, nan=-np.inf), p))[0])
    else:
        c = int(np.argmax(np.nan_to_num(vals, nan=-np.inf)))
    out: dict[str, Any] = {"cells": [c]}
    space = getattr(session, "states", {}).get(result.target) if session is not None else None
    if space is not None:
        out["states"] = space
    return out


@register_plot(
    "joint_histogram",
    data=plot_joint_histogram_data,
    level="cell",
    requires=("extras:joint",),
    defaults=_joint_defaults,
)
def plot_joint_histogram(
    result: MetricResult,
    cells: int | Sequence[int],
    states: StateSpace | None = None,
    ax: Any = None,
    normalize: str = "lift",
) -> Figure:
    """State x activity-level map per cell from a ``mutual_information`` result.

    Answers "does the amplitude carry information beyond where the cell
    fires?": each column is the distribution of activity levels in one state,
    expressed by default as lift over the cell's overall level distribution.
    Never-visited states are drawn in the unvisited grey, not as zero.

    Parameters
    ----------
    result : MetricResult
        Needs ``extras`` ``joint``, ``conditional`` and ``edges``.
    cells : int or sequence of int
        Cell indices (rows of ``result.values``).
    states : StateSpace, optional
        The space the result was computed on.  A 1-D ``GridTopology`` puts
        physical bin centres on the x axis; a 2-D one draws one spatial map
        per level (one row per cell); otherwise state names are used.
    ax : matplotlib Axes, optional
        Only for a single cell and a non-2-D layout.
    normalize : {"lift", "conditional", "joint"}, default "lift"
        ``"lift"`` is log2 of p(level | state) / p(level), the per-cell
        quantity that mutual information averages (``MI = sum p(s, l) *
        log2 lift``): red means a level is over-represented in that state,
        blue under-represented.  ``"conditional"`` (the former default) is
        p(level | state); ``"joint"`` is p(state, level).

    Returns
    -------
    matplotlib.figure.Figure
        Look for: a cell whose level distribution changes with state (a column
        that differs from its neighbours) even where mean activity is flat.
    """
    d = plot_joint_histogram_data(result, cells, states, normalize)
    n_cells, _, n_levels = d["panels"].shape
    cmap = plt.get_cmap(d["cmap"]).with_extremes(bad=UNVISITED_COLOR)
    kw = {"vmin": d["vmin"], "vmax": d["vmax"], "cmap": cmap}

    if d["layout"] == "grid2d":
        if ax is not None:
            raise ValueError("ax is not supported for 2-D state spaces (one row of maps per cell)")
        fig, axes = plt.subplots(
            n_cells,
            n_levels,
            figsize=(1.9 * n_levels + 1.2, 2.0 * n_cells + 0.4),
            squeeze=False,
            layout="constrained",
        )
        im = None
        for r in range(n_cells):
            for k in range(n_levels):
                a = axes[r, k]
                img = np.ma.masked_invalid(d["panels"][r, :, k].reshape(d["grid_shape"]).T)
                im = a.imshow(img, origin="lower", aspect="auto", extent=tuple(d["extent"]), **kw)
                a.set_xticks([])
                a.set_yticks([])
                a.set_title(d["level_labels"][r][k], fontsize=8)
            axes[r, 0].set_ylabel(d["titles"][r], fontsize=7)
        fig.colorbar(im, ax=axes, label=d["cbar_label"], fraction=0.04, pad=0.02)
        return fig

    if ax is not None:
        if n_cells != 1:
            raise ValueError("ax can only be given for a single cell")
        fig, axes_list = ax.figure, [ax]
    else:
        ncols = min(n_cells, 4)
        nrows = int(np.ceil(n_cells / ncols))
        fig, axs = plt.subplots(
            nrows,
            ncols,
            figsize=(4.2 * ncols + 0.8, 3.2 * nrows),
            squeeze=False,
            layout="constrained",
        )
        axes_list = list(axs.ravel())
        for extra in axes_list[n_cells:]:
            extra.axis("off")
    im = None
    for r, a in enumerate(axes_list[:n_cells]):
        img = np.ma.masked_invalid(d["panels"][r].T)  # (levels, states)
        if d["layout"] == "grid1d":
            im = a.imshow(
                img,
                origin="lower",
                aspect="auto",
                interpolation="nearest",
                extent=(*d["x_extent"], -0.5, n_levels - 0.5),
                **kw,
            )
            a.set_xlabel(d["x_label"])
        else:
            im = a.imshow(img, origin="lower", aspect="auto", interpolation="nearest", **kw)
            a.set_xticks(
                range(len(d["state_names"])), d["state_names"], rotation=60, ha="right", fontsize=7
            )
        a.set_yticks(range(n_levels), d["level_labels"][r], fontsize=7)
        a.set_ylabel(d["ylabel"])
        a.set_title(d["titles"][r], fontsize=9)
    fig.colorbar(im, ax=axes_list[:n_cells], label=d["cbar_label"], fraction=0.04, pad=0.02)
    return fig


def _bias_corrected(result: MetricResult) -> np.ndarray:
    v = np.asarray(result.values, float)
    if v.ndim != 1:
        raise ValueError("plot_information_comparison needs 1D cell-level results")
    if result.shuffle is not None:
        sh = result.shuffle
        if sh.null_mean is not None:
            v = v - np.asarray(sh.null_mean, float)
        elif sh.null is not None:
            v = v - np.nanmean(np.asarray(sh.null, float), axis=0)
        else:
            raise ValueError("result has no stored null draws or null_mean to bias-correct with")
    return v


def plot_information_comparison_data(
    result_a: MetricResult,
    result_b: MetricResult,
    labels: tuple[str, str] = ("a", "b"),
    highlight: Sequence[int] | None = None,
    identity: bool = False,
) -> dict[str, Any]:
    """Everything :func:`plot_information_comparison` draws.

    Keys: ``x``, ``y`` (each result minus its shuffle-null mean), ``sig_a``,
    ``sig_b`` (bool), ``groups`` (list of ``{"name", "mask", "color", "n"}`` for
    neither / a only / b only / both), ``highlight`` (int array), ``identity_line``
    (``[lo, hi]`` or ``None``), ``rho``, ``n``, ``xlabel``, ``ylabel``, ``title``.
    ``kind="information_comparison"``.
    """
    x, y = _bias_corrected(result_a), _bias_corrected(result_b)
    if x.shape != y.shape:
        raise ValueError(f"result shapes differ: {x.shape} vs {y.shape}")
    sa, sb = _significant(result_a), _significant(result_b)
    sa = np.zeros(x.shape, bool) if sa is None else sa
    sb = np.zeros(x.shape, bool) if sb is None else sb
    names = [f"{labels[0]} only", f"{labels[1]} only", "both"]
    pal = {k: mpl.colors.to_hex(v) for k, v in state_colors(names).items()}
    spec = [
        ("neither", ~sa & ~sb, mpl.colors.to_hex(NULL_COLOR)),
        (names[0], sa & ~sb, pal[names[0]]),
        (names[1], ~sa & sb, pal[names[1]]),
        (names[2], sa & sb, pal[names[2]]),
    ]
    ok = np.isfinite(x) & np.isfinite(y)
    rho = float(spearmanr(x[ok], y[ok]).statistic) if ok.sum() > 2 else float("nan")
    line = None
    if identity and ok.any():
        line = [float(np.nanmin([x, y])), float(np.nanmax([x, y]))]
    elif identity:
        line = [0.0, 1.0]
    return {
        "kind": "information_comparison",
        "version": PLOT_DATA_VERSION,
        "x": x,
        "y": y,
        "sig_a": sa,
        "sig_b": sb,
        "groups": [{"name": n, "mask": m, "color": c, "n": int(m.sum())} for n, m, c in spec],
        "highlight": np.asarray([] if highlight is None else list(highlight), int),
        "identity_line": line,
        "rho": rho,
        "n": int(ok.sum()),
        "xlabel": f"{labels[0]} (null-corrected)",
        "ylabel": f"{labels[1]} (null-corrected)",
        "title": f"Spearman rho = {rho:.2f} (n = {int(ok.sum())})",
    }


def plot_information_comparison(
    result_a: MetricResult,
    result_b: MetricResult,
    labels: tuple[str, str] = ("a", "b"),
    highlight: Sequence[int] | None = None,
    ax: Any = None,
    identity: bool = False,
) -> Figure:
    """Scatter of two cell-level results, each minus its shuffle-null mean.

    Points are coloured by which result is significant (``shuffle.significant``).
    ``identity=True`` draws y = x (only meaningful when both share units).
    ``highlight`` lists cells (e.g. planted place cells) marked with the shared
    significance marker.  The title gives the Spearman correlation across cells (NaNs
    omitted).  A result without a shuffle is plotted uncorrected.  Look for: cells far
    from zero on one axis only (information that one metric sees and the other
    misses), and whether highlighted planted cells sit in the upper-right.

    Parameters
    ----------
    result_a, result_b : MetricResult
        1-D cell-level results with the same number of cells (x and y axes); each
        is plotted as ``values - shuffle.null_mean``.
    labels : (str, str), default ("a", "b")
        Axis labels for the two results.
    highlight : sequence of int, optional
        Cell indices to mark.
    ax : matplotlib Axes, optional
        Axes to draw into; a new figure is created if omitted.
    identity : bool, default False
        Draw the y = x line (meaningful only when both share units).

    Returns
    -------
    matplotlib.figure.Figure

    Raises
    ------
    ValueError
        If a result is not 1-D, the shapes differ, or a shuffle stores neither
        ``null_mean`` nor null draws.
    """
    d = plot_information_comparison_data(result_a, result_b, labels, highlight, identity)
    fig, ax = _get_ax(ax, (5.0, 4.6))
    x, y = d["x"], d["y"]
    for g in d["groups"]:
        m = g["mask"]
        ax.scatter(x[m], y[m], s=18, color=g["color"], label=f"{g['name']} ({g['n']})")
    h = d["highlight"]
    if h.size:
        mark_significant(ax, x[h], y[h], s=36, label=f"highlighted ({h.size})")
    if d["identity_line"] is not None:
        ax.plot(d["identity_line"], d["identity_line"], color="k", ls="--", lw=0.8, zorder=0)
    ax.set_xlabel(d["xlabel"])
    ax.set_ylabel(d["ylabel"])
    ax.set_title(d["title"], fontsize=10)
    ax.legend(fontsize=8, frameon=False)
    return fig


def plot_level_sweep_data(df: pd.DataFrame) -> dict[str, Any]:
    """Lines and labels for :func:`plot_level_sweep`.

    ``sweep`` is the :func:`plot_sweep_data` dict (hue = ``duration_s``, style =
    ``metric`` when present, panels detection and fpr); the rest are labels.
    ``kind="level_sweep"``.
    """
    missing = {"n_levels", "duration_s", "detection", "fpr"} - set(df.columns)
    if missing:
        raise ValueError(f"df is missing columns {sorted(missing)}")
    sweep = plot_sweep_data(
        df,
        x="n_levels",
        hue="duration_s",
        style="metric" if "metric" in df.columns else None,
        panels=("detection", "fpr"),
    )
    return {
        "kind": "level_sweep",
        "version": PLOT_DATA_VERSION,
        "sweep": sweep,
        "xlabel": "number of activity levels",
        "ylabels": ["detection rate", "false-positive rate"],
        "alpha_line": 0.05,
        "hue_labels": [f"{v:g} s" for v in sweep["hue_values"]],
    }


def plot_level_sweep(df: pd.DataFrame, ax: Any = None) -> Figure:
    """Detection and false-positive rate versus number of activity levels.

    ``df`` needs ``n_levels``, ``duration_s``, ``detection``, ``fpr`` and
    optionally ``metric``.  One line per recording duration (colour) and, if
    several metrics are present, per metric (line style).  The dashed line on
    the FPR panel is alpha = 0.05.  ``ax`` may be a pair of axes.  Look for: the
    number of levels where detection plateaus while the false-positive rate stays
    near alpha.

    Parameters
    ----------
    df : pandas.DataFrame
        Sweep table with columns ``n_levels``, ``duration_s``, ``detection`` and
        ``fpr`` (fractions), optionally ``metric``.
    ax : matplotlib Axes or pair of Axes, optional
        Two axes (detection, false-positive rate); a new figure is made if omitted.

    Returns
    -------
    matplotlib.figure.Figure

    Raises
    ------
    ValueError
        If required columns are missing or ``ax`` is not a pair of axes.
    """
    d = plot_level_sweep_data(df)
    if ax is None:
        _, axes = plt.subplots(1, 2, figsize=(9.0, 3.8), sharey=True, layout="constrained")
    else:
        axes = np.asarray(ax).ravel()
        if axes.size != 2:
            raise ValueError("ax must be a pair of axes")
    return plot_sweep(
        df,
        x="n_levels",
        hue="duration_s",
        style=d["sweep"]["style"],
        panels=("detection", "fpr"),
        alpha_line=d["alpha_line"],
        ax=axes,
        xlabel=d["xlabel"],
        ylabels=d["ylabels"],
        hue_label=lambda v: f"{v:g} s",
    )


def _signal_units(session: Any, name: str) -> str:
    return str(getattr(session, "meta", {}).get("signal_units", {}).get(name, ""))


def plot_decoded_trajectory_data(
    result: MetricResult,
    session: Session,
    states: StateSpace | None = None,
    t_range: tuple[float, float] | None = None,
) -> dict[str, Any]:
    """Everything :func:`plot_decoded_trajectory` draws, as plain arrays.

    Keys: ``time_s`` (frames in the window), ``true`` and ``decoded``
    ``(n_axes, n_win)`` in arena units (NaN where undecoded), ``axis_names``,
    ``units`` (per axis, from ``session.meta["signal_units"]``; ``""`` when
    unknown), ``error`` (window frames) and ``error_cdf`` (``{"x", "y"}`` over all
    decoded frames), ``median_error``, ``chance_error``, ``t_range``.  For a 2-D
    grid also ``path_true`` / ``path_decoded`` ``(n_win, 2)`` (raw bin centres, no jitter), ``decoded_valid`` ``(n_win,)`` bool
    (False where a frame was not decoded; break the path there), ``bin_width`` ``[dx, dy]``, ``accuracy_map``
    ``(ny, nx)`` -- the fraction of frames whose true bin was decoded exactly, NaN
    for bins never visited -- and its ``extent`` ``[x0, x1, y0, y1]``; for a 1-D
    grid those are ``None``.  ``kind="decoded_trajectory"``.

    Parameters
    ----------
    result : MetricResult
        ``bayesian_decoder`` result with ``extras`` ``decoded``, ``error``,
        ``error_overall`` and ``chance_error`` (and ``confusion`` for the map).
    session : Session
        Supplies the time axis and, when present, the true coordinate signals.
    states : StateSpace, optional
        The grid state space; default ``session.states[result.target]``.
    t_range : (float, float), optional
        Window in seconds; default is 60 s from the first decoded frame.
    """
    session, result = order_session_first(session, result)
    if states is None:
        states = session.states[result.target]
    topo = states.topology
    if topo is None or topo.ndim not in (1, 2):
        raise ValueError("needs a state space with a 1-D or 2-D grid topology")
    ex = result.extras
    for key in ("decoded", "error", "error_overall", "chance_error"):
        if key not in ex:
            raise ValueError(f"result has no {key!r} in extras; is it a bayesian_decoder result?")
    decoded = np.asarray(ex["decoded"], int)
    err = np.asarray(ex["error"], float)
    t = np.asarray(session.t, float)
    ok = decoded >= 0
    if not ok.any():
        raise ValueError("no frames were decoded")
    if t_range is None:
        t0 = float(t[np.argmax(ok)])
        t_range = (t0, t0 + 60.0)
    win = (t >= t_range[0]) & (t <= t_range[1])
    centers = topo.centers()
    n_axes = topo.ndim
    grid_idx = np.unravel_index(np.where(ok, decoded, 0), topo.shape)
    true_state = np.asarray(states.labels(), int)
    ti = np.unravel_index(np.clip(true_state, 0, None), topo.shape)
    truth = np.full((n_axes, len(t)), np.nan)
    dec = np.full((n_axes, len(t)), np.nan)
    names = [str(n) for n in topo.axis_names]
    for k in range(n_axes):
        sig = session.signals.get(names[k])
        if sig is not None and np.ndim(sig) == 1 and len(sig) == len(t):
            truth[k] = np.asarray(sig, float)
        else:
            truth[k] = np.where(true_state >= 0, centers[k][ti[k]], np.nan)
        dec[k] = np.where(ok, centers[k][grid_idx[k]], np.nan)
    e = np.sort(err[np.isfinite(err)])
    out: dict[str, Any] = {
        "kind": "decoded_trajectory",
        "version": PLOT_DATA_VERSION,
        "t_range": [float(t_range[0]), float(t_range[1])],
        "time_s": t[win],
        "true": truth[:, win],
        "decoded": dec[:, win],
        "axis_names": names,
        "units": [_signal_units(session, n) for n in names],
        "error": err[win],
        "error_cdf": {"x": e, "y": np.arange(1, e.size + 1) / max(e.size, 1)},
        "median_error": float(np.asarray(ex["error_overall"]).ravel()[0]),
        "chance_error": float(np.asarray(ex["chance_error"]).ravel()[0]),
        "path_true": None,
        "path_decoded": None,
        "decoded_valid": None,
        "bin_width": None,
        "accuracy_map": None,
        "extent": None,
    }
    if n_axes == 2:
        out["path_true"] = truth[:, win].T
        out["path_decoded"] = dec[:, win].T
        out["decoded_valid"] = ok[win]
        out["bin_width"] = [float(np.median(np.diff(e))) for e in topo.edges]
        xe, ye = topo.edges
        out["extent"] = [float(xe[0]), float(xe[-1]), float(ye[0]), float(ye[-1])]
        conf = ex.get("confusion")
        if conf is not None:
            conf = np.asarray(conf, float)
            with np.errstate(divide="ignore", invalid="ignore"):
                acc = np.diag(conf) / conf.sum(axis=1)
            acc = np.where(conf.sum(axis=1) > 0, acc, np.nan)
            out["accuracy_map"] = acc.reshape(topo.shape).T
    return out


@register_plot(
    "decoded_trajectory",
    data=plot_decoded_trajectory_data,
    needs_session=True,
    level="population",
    requires=("extras:decoded", "topology"),
)
def plot_decoded_trajectory(
    result: MetricResult,
    session: Session,
    states: StateSpace | None = None,
    t_range: tuple[float, float] | None = None,
    ax: Any = None,
) -> Figure:
    """True versus decoded position over time, in the arena, and the distribution of error.

    ``result`` is a ``bayesian_decoder`` result on a 1-D or 2-D grid.  One time
    panel per grid axis shows the true coordinate (grey; from the session signal of
    the same name when present, otherwise the bin centre) and the decoded bin centre
    (colour; gaps where a frame was not decoded).  For a 2-D grid a path panel draws
    the true path (grey) and the decoded path (coloured by time; a small seeded jitter inside each bin is purely cosmetic) in arena
    coordinates, and a map panel shows, per true bin, the fraction of frames decoded
    to exactly that bin (unvisited bins in grey).  The last panel is the cumulative
    distribution of the per-frame error with the median and the chance level (always
    guessing the most occupied bin).  Axes carry the signal units when the session
    records them.  ``t_range`` is in seconds; the default is the first 60 s of decoded
    frames.  ``ax`` is not supported (several panels).  ``result`` and ``session`` may
    be given in either order.  Look for: the decoded trace following the grey truth,
    the decoded path hugging the true path, accuracy that is high across the arena
    rather than in one corner, and the median error well left of the chance line.

    Parameters
    ----------
    result : MetricResult
        ``bayesian_decoder`` result with ``extras`` ``decoded``, ``error``,
        ``error_overall`` and ``chance_error`` (``confusion`` for the map panel).
    session : Session
        Supplies the time axis and, when present, the true coordinate signals.
    states : StateSpace, optional
        The 1-D or 2-D grid state space the decoder was run on; default
        ``session.states[result.target]``.
    t_range : (float, float), optional
        Time window in seconds; default is 60 s from the first decoded frame.
    ax : None
        Must be ``None``; passing an axes raises ``ValueError``.

    Returns
    -------
    matplotlib.figure.Figure

    Raises
    ------
    ValueError
        If the space has no 1-D / 2-D grid, extras are missing, or no frame was decoded.
    """
    session, result = order_session_first(session, result)
    if ax is not None:
        raise ValueError("plot_decoded_trajectory builds its own panels; ax is not supported")
    d = plot_decoded_trajectory_data(result, session, states, t_range)
    n_axes = len(d["axis_names"])
    t = d["time_s"]
    two_d = n_axes == 2
    if two_d:
        fig = plt.figure(figsize=(12.0, 7.0), layout="constrained")
        gs = fig.add_gridspec(2, 3)
        axes = [fig.add_subplot(gs[0, 0]), fig.add_subplot(gs[0, 1]), fig.add_subplot(gs[0, 2])]
        ax_path, ax_map = fig.add_subplot(gs[1, 0]), fig.add_subplot(gs[1, 1])
    else:
        fig, axs = plt.subplots(1, 2, figsize=(8.0, 3.4), layout="constrained")
        axes = list(axs)
    colors = list(state_colors(["decoded x", "decoded y"]).values())
    for k in range(n_axes):
        a = axes[k]
        a.plot(t, d["true"][k], color="0.65", lw=2.5, label="true")
        a.plot(t, d["decoded"][k], color=colors[k], lw=1.0, label="decoded")
        a.set_xlabel("time (s)")
        a.set_ylabel(axis_label(d["axis_names"][k], d["units"][k]))
        if k == 0:
            a.legend(fontsize=8, frameon=False, loc="upper right")
    a = axes[2] if two_d else axes[1]
    cdf = d["error_cdf"]
    if len(cdf["x"]):
        a.plot(cdf["x"], cdf["y"], color="k")
    a.axvline(
        d["median_error"], color=OBSERVED_COLOR, ls="--", label=f"median {d['median_error']:.3g}"
    )
    a.axvline(d["chance_error"], color=NULL_COLOR, ls="--", label=f"chance {d['chance_error']:.3g}")
    unit = d["units"][0] if len(set(d["units"])) == 1 else ""
    a.set_xlabel(axis_label("decoding error", unit))
    a.set_ylabel("cumulative fraction of frames")
    a.legend(fontsize=8, frameon=False, loc="lower right")
    if two_d:
        pt, pd_ = d["path_true"], d["path_decoded"]
        ax_path.plot(pt[:, 0], pt[:, 1], color="0.7", lw=2.0, label="true")
        # cosmetic: seeded jitter (+/-15% of a bin) so repeat visits to a bin do not collapse
        rng = np.random.default_rng(0)
        jit = rng.uniform(-0.15, 0.15, pd_.shape) * np.asarray(d["bin_width"])
        pj = pd_ + jit
        good = np.asarray(d["decoded_valid"], bool)
        seg_ok = good[:-1] & good[1:]
        segs = np.stack([pj[:-1], pj[1:]], axis=1)[seg_ok]
        lc = LineCollection(segs, cmap="viridis", linewidths=0.8, alpha=0.7)
        lc.set_array(0.5 * (t[:-1] + t[1:])[seg_ok])
        lc.set_clim(t.min(), t.max())
        ax_path.add_collection(lc)
        ax_path.autoscale_view()
        sc = lc
        fig.colorbar(sc, ax=ax_path, label="time (s)", fraction=0.05, pad=0.02)
        ax_path.set_aspect("equal", adjustable="datalim")
        ax_path.set_xlabel(axis_label(d["axis_names"][0], d["units"][0]))
        ax_path.set_ylabel(axis_label(d["axis_names"][1], d["units"][1]))
        ax_path.legend(fontsize=8, frameon=False, loc="upper right")
        if d["accuracy_map"] is not None:
            cmap = plt.get_cmap("viridis").with_extremes(bad=UNVISITED_COLOR)
            im = ax_map.imshow(
                np.ma.masked_invalid(d["accuracy_map"]),
                origin="lower",
                cmap=cmap,
                vmin=0,
                vmax=1,
                aspect="equal",
                extent=tuple(d["extent"]),
            )
            fig.colorbar(
                im, ax=ax_map, label="fraction decoded to true bin", fraction=0.05, pad=0.02
            )
            ax_map.set_xlabel(axis_label(d["axis_names"][0], d["units"][0]))
            ax_map.set_ylabel(axis_label(d["axis_names"][1], d["units"][1]))
            ax_map.set_title("decoding accuracy per true bin", fontsize=9)
        else:
            ax_map.axis("off")
    fig.suptitle(
        f"decoded position: median error {d['median_error']:.3g} vs chance {d['chance_error']:.3g}",
        fontsize=10,
    )
    return fig
