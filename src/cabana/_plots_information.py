"""Plots for information-theoretic analyses (mutual information, level sweeps)."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.figure import Figure
from matplotlib.lines import Line2D
from scipy.stats import spearmanr

from ._models import Session, StateSpace
from ._plots import _cell_label, _fmt_p, _get_ax, _significant
from ._results import MetricResult

__all__ = [
    "plot_decoded_trajectory",
    "plot_information_comparison",
    "plot_joint_histogram",
    "plot_level_sweep",
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


def _normalized(result: MetricResult, normalize: str) -> tuple[np.ndarray, str, dict[str, Any]]:
    """Return ``(n_cells, n_states, n_levels)`` array, colourbar label and imshow kwargs."""
    ex = result.extras
    for key in ("joint", "conditional", "edges"):
        if key not in ex:
            raise ValueError(
                f"result for metric {result.metric!r} has no {key!r} in extras; "
                f"available keys: {sorted(ex)}"
            )
    joint = np.asarray(ex["joint"], float)
    cond = np.asarray(ex["conditional"], float)
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
                {
                    "cmap": "RdBu_r",
                    "vmin": -half,
                    "vmax": half,
                },
            )
    raise ValueError(f"normalize must be 'conditional', 'joint' or 'lift', got {normalize!r}")


def plot_joint_histogram(
    result: MetricResult,
    cells: int | Sequence[int],
    states: StateSpace | None = None,
    ax: Any = None,
    normalize: str = "conditional",
) -> Figure:
    """State x activity-level map per cell from a ``mutual_information`` result.

    Answers "does the amplitude carry information beyond where the cell
    fires?": each column is the distribution of activity levels in one state.

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
    normalize : {"conditional", "joint", "lift"}
        ``"conditional"`` is p(level | state); ``"joint"`` is p(state, level);
        ``"lift"`` is log2 of p(level | state) / p(level), the per-cell
        quantity that mutual information averages (``MI = sum p(s, l) *
        log2 lift``): red means a level is over-represented in that state,
        blue under-represented.
    """
    arr, cbar_label, kw = _normalized(result, normalize)
    edges = np.asarray(result.extras["edges"], float)
    n_levels = arr.shape[2]
    cells_l = [int(cells)] if np.isscalar(cells) else [int(c) for c in cells]  # type: ignore[arg-type]
    if not cells_l:
        raise ValueError("cells must not be empty")
    values = np.asarray(result.values, float)
    sh = result.shuffle

    def title(c: int) -> str:
        t = f"cell {_cell_label(result, c)}: MI = {values[c]:.3f} bits"
        if sh is not None and np.ndim(sh.p_value) == 1:
            t += f", {_fmt_p(float(sh.p_value[c]))}"
        return t

    topo = states.topology if states is not None else None
    vmax_auto = None
    if "vmin" not in kw:
        fin = arr[cells_l][np.isfinite(arr[cells_l])]
        vmax_auto = float(fin.max()) if fin.size else 1.0
        kw.update(vmin=0.0, vmax=vmax_auto if vmax_auto > 0 else 1.0)
    cmap = plt.get_cmap(kw.pop("cmap")).with_extremes(bad=(1, 1, 1, 0))

    if topo is not None and topo.ndim == 2:
        if ax is not None:
            raise ValueError("ax is not supported for 2-D state spaces (one row of maps per cell)")
        nrows = len(cells_l)
        fig, axes = plt.subplots(
            nrows,
            n_levels,
            figsize=(1.9 * n_levels + 1.2, 2.0 * nrows + 0.4),
            squeeze=False,
            layout="constrained",
        )
        xe, ye = topo.edges
        im = None
        for r, c in enumerate(cells_l):
            labels = _level_labels(edges[c])
            for k in range(n_levels):
                a = axes[r, k]
                img = np.ma.masked_invalid(arr[c, :, k].reshape(topo.shape).T)
                im = a.imshow(
                    img,
                    origin="lower",
                    cmap=cmap,
                    aspect="auto",
                    extent=(xe[0], xe[-1], ye[0], ye[-1]),
                    **kw,
                )
                a.set_xticks([])
                a.set_yticks([])
                a.set_title(labels[k], fontsize=8)
            axes[r, 0].set_ylabel(title(c), fontsize=7)
        fig.colorbar(im, ax=axes, label=cbar_label, fraction=0.04, pad=0.02)
        return fig

    # 1-D grid or categorical: levels x states image, up to 4 panels per row
    if topo is not None and topo.ndim == 1:
        cen = np.asarray(topo.centers()[0], float)
        half = np.diff(topo.edges[0]) / 2
        extent_x = (float(cen[0] - half[0]), float(cen[-1] + half[-1]))
        xlabel = topo.axis_names[0]
    else:
        cen, extent_x = None, None
        xlabel = "state"
    names = result.state_names or (list(states.state_names) if states is not None else None)
    n = len(cells_l)
    if ax is not None:
        if n != 1:
            raise ValueError("ax can only be given for a single cell")
        fig, axes_list = ax.figure, [ax]
    else:
        ncols = min(n, 4)
        nrows = int(np.ceil(n / ncols))
        fig, axs = plt.subplots(
            nrows,
            ncols,
            figsize=(4.2 * ncols + 0.8, 3.2 * nrows),
            squeeze=False,
            layout="constrained",
        )
        axes_list = list(axs.ravel())
        for extra in axes_list[n:]:
            extra.axis("off")
    im = None
    for a, c in zip(axes_list, cells_l, strict=False):
        img = np.ma.masked_invalid(arr[c].T)  # (levels, states)
        if extent_x is not None:
            im = a.imshow(
                img,
                origin="lower",
                cmap=cmap,
                aspect="auto",
                interpolation="nearest",
                extent=(*extent_x, -0.5, n_levels - 0.5),
                **kw,
            )
            a.set_xlabel(xlabel)
        else:
            im = a.imshow(
                img, origin="lower", cmap=cmap, aspect="auto", interpolation="nearest", **kw
            )
            ns = arr.shape[1]
            a.set_xticks(
                range(ns),
                names if names is not None else [str(i) for i in range(ns)],
                rotation=60,
                ha="right",
                fontsize=7,
            )
        a.set_yticks(range(n_levels), _level_labels(edges[c]), fontsize=7)
        a.set_ylabel("activity level")
        a.set_title(title(c), fontsize=9)
    fig.colorbar(im, ax=axes_list[:n], label=cbar_label, fraction=0.04, pad=0.02)
    return fig


def _bias_corrected(result: MetricResult) -> np.ndarray:
    v = np.asarray(result.values, float)
    if v.ndim != 1:
        raise ValueError("plot_information_comparison needs 1D cell-level results")
    if result.shuffle is not None:
        v = v - np.nanmean(np.asarray(result.shuffle.null, float), axis=0)
    return v


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
    ``highlight`` lists cells (e.g. planted place cells) drawn with a black edge.
    The title gives the Spearman correlation across cells (NaNs omitted).
    """
    x, y = _bias_corrected(result_a), _bias_corrected(result_b)
    if x.shape != y.shape:
        raise ValueError(f"result shapes differ: {x.shape} vs {y.shape}")
    fig, ax = _get_ax(ax, (5.0, 4.6))
    sa, sb = _significant(result_a), _significant(result_b)
    sa = np.zeros(x.shape, bool) if sa is None else sa
    sb = np.zeros(x.shape, bool) if sb is None else sb
    groups = [
        ("neither", ~sa & ~sb, "0.75"),
        (f"{labels[0]} only", sa & ~sb, "C1"),
        (f"{labels[1]} only", ~sa & sb, "C2"),
        ("both", sa & sb, "C3"),
    ]
    for name, m, color in groups:
        ax.scatter(x[m], y[m], s=18, color=color, label=f"{name} ({int(m.sum())})")
    if highlight is not None and len(highlight):
        h = np.asarray(list(highlight), int)
        ax.scatter(
            x[h],
            y[h],
            s=36,
            facecolors="none",
            edgecolors="k",
            linewidths=1.0,
            label=f"highlighted ({h.size})",
        )
    if identity:
        lo = float(np.nanmin([x, y])) if np.isfinite([x, y]).any() else 0.0
        hi = float(np.nanmax([x, y])) if np.isfinite([x, y]).any() else 1.0
        ax.plot([lo, hi], [lo, hi], color="k", ls="--", lw=0.8, zorder=0)
    ok = np.isfinite(x) & np.isfinite(y)
    rho = float(spearmanr(x[ok], y[ok]).statistic) if ok.sum() > 2 else float("nan")
    ax.set_xlabel(f"{labels[0]} (null-corrected)")
    ax.set_ylabel(f"{labels[1]} (null-corrected)")
    ax.set_title(f"Spearman rho = {rho:.2f} (n = {int(ok.sum())})", fontsize=10)
    ax.legend(fontsize=8, frameon=False)
    return fig


def plot_level_sweep(df: pd.DataFrame, ax: Any = None) -> Figure:
    """Detection and false-positive rate versus number of activity levels.

    ``df`` needs ``n_levels``, ``duration_s``, ``detection``, ``fpr`` and
    optionally ``metric``.  One line per recording duration (colour) and, if
    several metrics are present, per metric (line style).  The dashed line on
    the FPR panel is alpha = 0.05.  ``ax`` may be a pair of axes.
    """
    missing = {"n_levels", "duration_s", "detection", "fpr"} - set(df.columns)
    if missing:
        raise ValueError(f"df is missing columns {sorted(missing)}")
    if ax is None:
        fig, axes = plt.subplots(1, 2, figsize=(9.0, 3.8), sharey=True, layout="constrained")
    else:
        axes = np.asarray(ax).ravel()
        if axes.size != 2:
            raise ValueError("ax must be a pair of axes")
        fig = axes[0].figure
    metrics = list(dict.fromkeys(df["metric"])) if "metric" in df.columns else [None]
    styles = ["-", "--", ":", "-."]
    durations = sorted(df["duration_s"].unique())
    cmap = plt.get_cmap("viridis")
    colors = {d: cmap(i / max(len(durations) - 1, 1) * 0.85) for i, d in enumerate(durations)}
    for a, col, label in (
        (axes[0], "detection", "detection rate"),
        (axes[1], "fpr", "false-positive rate"),
    ):
        for mi, met in enumerate(metrics):
            sub_m = df if met is None else df[df["metric"] == met]
            for d in durations:
                sub = sub_m[sub_m["duration_s"] == d].sort_values("n_levels")
                if sub.empty:
                    continue
                a.plot(
                    sub["n_levels"],
                    sub[col],
                    marker="o",
                    ms=4,
                    color=colors[d],
                    ls=styles[mi % len(styles)],
                )
        a.set_xlabel("number of activity levels")
        a.set_ylabel(label)
        a.set_ylim(0, 1.05)
        a.set_xticks(sorted(df["n_levels"].unique()))
    axes[1].axhline(0.05, color="k", ls="--", lw=1)
    handles = [
        Line2D([], [], color=colors[d], marker="o", ms=4, label=f"{d:g} s") for d in durations
    ]
    if len(metrics) > 1:
        handles += [
            Line2D([], [], color="0.3", ls=styles[i % len(styles)], label=str(m))
            for i, m in enumerate(metrics)
        ]
    handles.append(Line2D([], [], color="k", ls="--", lw=1, label="alpha = 0.05"))
    axes[1].legend(
        handles=handles, fontsize=8, frameon=False, loc="upper left", bbox_to_anchor=(1.01, 1.0)
    )
    return fig


def plot_decoded_trajectory(
    result: MetricResult,
    session: Session,
    states: StateSpace,
    t_range: tuple[float, float] | None = None,
    ax: Any = None,
) -> Figure:
    """True versus decoded position over time, and the distribution of decoding error.

    ``result`` is a ``bayesian_decoder`` result on a 1-D or 2-D grid.  One
    panel per grid axis shows the true coordinate (grey; taken from the
    session signal of the same name when present, otherwise the bin centre)
    and the decoded bin centre (colour; gaps where a frame was not decoded).
    The last panel is the cumulative distribution of the per-frame error with
    the median and the chance level (always guessing the most occupied bin).
    ``t_range`` is in seconds; the default is the first 60 s of decoded frames.
    ``ax`` is not supported (the figure has several panels).
    """
    if ax is not None:
        raise ValueError("plot_decoded_trajectory builds its own panels; ax is not supported")
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
    fig, axes = plt.subplots(
        1, n_axes + 1, figsize=(4.6 * n_axes + 3.4, 3.4), layout="constrained"
    )
    axes = np.atleast_1d(axes)
    grid_idx = np.unravel_index(np.where(ok, decoded, 0), topo.shape)
    # the state each frame truly occupies, for the fallback when no signal exists
    true_state = np.asarray(states.labels(), int) if hasattr(states, "labels") else None
    for k in range(n_axes):
        a = axes[k]
        name = topo.axis_names[k]
        sig = session.signals.get(name)
        if sig is not None and np.ndim(sig) == 1 and len(sig) == len(t):
            truth = np.asarray(sig, float)
        elif true_state is not None:
            ti = np.unravel_index(np.clip(true_state, 0, None), topo.shape)
            truth = np.where(true_state >= 0, centers[k][ti[k]], np.nan)
        else:
            truth = np.full(len(t), np.nan)
        dec = np.where(ok, centers[k][grid_idx[k]], np.nan)
        a.plot(t[win], truth[win], color="0.65", lw=2.5, label="true")
        a.plot(t[win], dec[win], color=f"C{k}", lw=1.0, label="decoded")
        a.set_xlabel("time (s)")
        a.set_ylabel(name)
        if k == 0:
            a.legend(fontsize=8, frameon=False, loc="upper right")
    a = axes[n_axes]
    e = np.sort(err[np.isfinite(err)])
    if e.size:
        a.plot(e, np.arange(1, e.size + 1) / e.size, color="k")
    med = float(np.asarray(ex["error_overall"]).ravel()[0])
    chance = float(np.asarray(ex["chance_error"]).ravel()[0])
    a.axvline(med, color="C0", ls="--", label=f"median {med:.3g}")
    a.axvline(chance, color="C3", ls="--", label=f"chance {chance:.3g}")
    a.set_xlabel("decoding error")
    a.set_ylabel("cumulative fraction of frames")
    a.legend(fontsize=8, frameon=False, loc="lower right")
    fig.suptitle(f"decoded position: median error {med:.3g} vs chance {chance:.3g}", fontsize=10)
    return fig
