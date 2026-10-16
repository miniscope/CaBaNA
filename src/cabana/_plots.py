"""Matplotlib plotting helpers.

Every function returns a :class:`matplotlib.figure.Figure` and never calls
``plt.show``.  Single-panel functions accept ``ax=None`` and create a figure
when it is omitted.  Plots dispatch on ``StateSpace.kind`` / ``topology``.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.colors import ListedColormap
from matplotlib.figure import Figure
from matplotlib.lines import Line2D
from matplotlib.patches import Patch

from ._models import Session, StateSpace
from ._results import MetricResult, ResultSet
from ._util import order_session_first, runs

__all__ = [
    "plot_behavior_overview",
    "plot_ground_truth_recovery",
    "plot_metric_scatter",
    "plot_population_matrix",
    "plot_rate_maps",
    "plot_shuffle_distribution",
    "plot_tuning_heatmap",
]


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


def _fmt_p(p: float) -> str:
    return "p=nan" if not np.isfinite(p) else (f"p={p:.3g}" if p >= 0.001 else "p<0.001")


def _discrete_cmap(n: int) -> ListedColormap:
    base = plt.get_cmap("tab20" if n > 10 else "tab10")
    return ListedColormap([base(i % base.N) for i in range(max(n, 1))])


def _significant(result: MetricResult, alpha: float | None = None) -> np.ndarray | None:
    sh = result.shuffle
    if sh is None:
        return None
    if alpha is None:
        return np.asarray(sh.significant, bool)
    return np.asarray(sh.p_value) < alpha


# --------------------------------------------------------------------------- #
# behavior overview
# --------------------------------------------------------------------------- #


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
        by time).
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
    t = np.asarray(session.t)
    names = list(session.states) if states is None else list(states)
    spaces = [session.states[n] for n in names if n in session.states]

    panels: list[tuple[str, Any, float]] = []
    px, py = position_signals
    if px in session.signals and py in session.signals:
        panels.append(("traj", None, 3.2))
    if speed_signal in session.signals:
        panels.append(("speed", None, 1.4))
    for s in spaces:
        if s.kind == "bouts":
            panels.append(("ethogram", s, max(1.0, 0.4 * s.n_states + 0.6)))
        elif s.kind == "categorical" and s.exclusive:
            panels.append(("strip", s, 1.0))

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

    fig = plt.figure(figsize=(8, sum(p[2] for p in panels) + 0.5), layout="constrained")
    gs = fig.add_gridspec(len(panels), 1, height_ratios=[p[2] for p in panels])
    time_axes = []
    for i, (kind, s, _) in enumerate(panels):
        ax = fig.add_subplot(gs[i])
        if kind == "traj":
            x = np.asarray(session.signals[px], float)
            y = np.asarray(session.signals[py], float)
            sc = ax.scatter(x, y, c=t, s=4, cmap="viridis")
            ax.plot(x, y, color="0.8", lw=0.5, zorder=0)
            ax.set_xlabel(px)
            ax.set_ylabel(py)
            ax.set_aspect("equal", adjustable="datalim")
            ax.set_title("Trajectory")
            fig.colorbar(sc, ax=ax, label="time (s)", fraction=0.046, pad=0.02)
        elif kind == "speed":
            ax.plot(t, np.asarray(session.signals[speed_signal], float), color="C0", lw=0.8)
            if speed_mask in session.masks:
                for a, n in zip(*runs(~session.masks[speed_mask]), strict=True):
                    ax.axvspan(t[a], t[min(a + n, len(t) - 1)], color="0.5", alpha=0.25, lw=0)
            ax.set_ylabel(speed_signal)
            ax.set_xlabel("time (s)")
            ax.set_xlim(t[0], t[-1])
            time_axes.append(ax)
        elif kind == "ethogram":
            assert isinstance(s, StateSpace)
            dt = float(np.median(np.diff(t))) if len(t) > 1 else 1.0
            for j in range(s.n_states):
                segs = [(t[a], n * dt) for a, n in zip(*runs(s.onehot[:, j]), strict=True)]
                ax.broken_barh(segs, (j - 0.4, 0.8), facecolors=f"C{j % 10}")
            ax.set_yticks(range(s.n_states), s.state_names)
            ax.set_ylim(s.n_states - 0.4, -0.6)
            ax.set_xlim(t[0], t[-1])
            ax.set_xlabel("time (s)")
            ax.set_title(s.name, fontsize=10)
            time_axes.append(ax)
        else:
            assert isinstance(s, StateSpace)
            lab = s.labels()
            img = np.ma.masked_less(lab, 0)[None, :]
            cmap = _discrete_cmap(s.n_states)
            ax.imshow(
                img,
                aspect="auto",
                cmap=cmap,
                vmin=-0.5,
                vmax=s.n_states - 0.5,
                extent=(t[0], t[-1], 0, 1),
                interpolation="nearest",
            )
            ax.set_yticks([])
            ax.set_xlabel("time (s)")
            ax.set_title(s.name, fontsize=10)
            used = np.unique(lab[lab >= 0])
            ax.legend(
                handles=[Patch(color=cmap(int(u)), label=s.state_names[int(u)]) for u in used],
                loc="upper left",
                bbox_to_anchor=(1.01, 1.0),
                fontsize=8,
                frameon=False,
            )
            time_axes.append(ax)
    return fig


# --------------------------------------------------------------------------- #
# rate maps
# --------------------------------------------------------------------------- #


def plot_rate_maps(
    session: Session,
    result: MetricResult,
    cells: Sequence[int],
    ncols: int = 6,
    cmap: str = "viridis",
) -> Figure:
    """Per-cell rate maps from ``result.extras["rate_map"]``.

    ``session`` and ``result`` may be given in either order.  Look for: compact
    single fields (2-D / 1-D grids) or a bar peak at one state (categorical);
    titles give the metric value and, with a shuffle, its p-value.

    Parameters
    ----------
    session : Session
        Supplies the target state space (``session.states[result.target]``) for the
        grid layout and state names.
    result : MetricResult
        Result whose ``extras["rate_map"]`` is ``(n_cells, n_states)`` (e.g.
        ``information_content``); missing key raises ``ValueError``.
    cells : sequence of int
        Row indices of the cells to draw.
    ncols : int, default 6
        Maximum panels per row.
    cmap : str, default "viridis"
        Colormap for 2-D maps (NaN bins are transparent).

    Returns
    -------
    matplotlib.figure.Figure
        One panel per cell: image for a 2-D grid, line for 1-D, bars otherwise.
    """
    session, result = order_session_first(session, result)
    if "rate_map" not in result.extras:
        raise ValueError(
            f"result for metric {result.metric!r} has no 'rate_map' in extras; "
            f"available keys: {sorted(result.extras)}"
        )
    rate = np.asarray(result.extras["rate_map"], float)
    space = session.states[result.target]
    topo = space.topology
    cells = [int(c) for c in cells]
    n = max(len(cells), 1)
    ncols = max(1, min(ncols, n))
    nrows = int(np.ceil(n / ncols))
    fig, axes = plt.subplots(
        nrows, ncols, figsize=(2.6 * ncols, 2.4 * nrows), squeeze=False, layout="constrained"
    )
    values = np.asarray(result.values)
    sh = result.shuffle
    for k, ax in enumerate(axes.ravel()):
        if k >= len(cells):
            ax.axis("off")
            continue
        c = cells[k]
        title = f"{_cell_label(result, c)}"
        if values.ndim == 1:
            title += f"\n{result.metric}={values[c]:.3g}"
            if sh is not None and np.ndim(sh.p_value) == 1:
                title += f", {_fmt_p(float(sh.p_value[c]))}"
        ax.set_title(title, fontsize=8)
        if topo is not None and topo.ndim == 2:
            img = np.ma.masked_invalid(rate[c].reshape(topo.shape).T)
            cm = plt.get_cmap(cmap).with_extremes(bad=(0, 0, 0, 0))
            xe, ye = topo.edges
            ax.imshow(
                img, origin="lower", cmap=cm, aspect="auto", extent=(xe[0], xe[-1], ye[0], ye[-1])
            )
            ax.set_xticks([])
            ax.set_yticks([])
        elif topo is not None and topo.ndim == 1:
            ax.plot(topo.centers()[0], rate[c], color="C0")
            ax.tick_params(labelsize=7)
        else:
            ax.bar(range(rate.shape[1]), np.nan_to_num(rate[c]), color="C0")
            ax.set_xticks(
                range(rate.shape[1]), space.state_names, rotation=60, ha="right", fontsize=7
            )
            ax.tick_params(axis="y", labelsize=7)
    return fig


# --------------------------------------------------------------------------- #
# shuffle distribution
# --------------------------------------------------------------------------- #


def plot_shuffle_distribution(
    result: MetricResult,
    cell: int,
    state: int | str | None = None,
    ax: Any = None,
    bins: int = 40,
) -> Figure:
    """Histogram of the null for one cell (and state) with observed value.

    Look for: the observed value (red line) outside the dashed null bounds means
    significant; the title gives the p-value and tail.

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
    sh = result.shuffle
    if sh is None:
        raise ValueError("result has no shuffle; run the analysis with a ShuffleConfig")
    if sh.null is None:
        raise ValueError(
            "result's null draws were dropped (ShuffleConfig.keep_null='none'); "
            "rerun with keep_null='full' to plot the null histogram"
        )
    fig, ax = _get_ax(ax)
    cell = int(cell)
    obs = np.asarray(sh.observed)
    idx: tuple[int, ...] = (cell,)
    suffix = ""
    if obs.ndim == 2:
        if state is None:
            raise ValueError("result values are 2D; pass `state` (index or name)")
        state_i = result.state_index(state)
        idx = (cell, state_i)
        suffix = f", state={state if isinstance(state, str) else (result.state_names or [state_i])[state_i]}"
    null = np.asarray(sh.null)[(slice(None), *idx)]
    ax.hist(null[np.isfinite(null)], bins=bins, color="0.7", edgecolor="white")
    ax.axvline(float(obs[idx]), color="C3", lw=2, label="observed")
    ax.axvline(float(np.asarray(sh.null_lo)[idx]), color="k", ls="--", lw=1, label="null bounds")
    ax.axvline(float(np.asarray(sh.null_hi)[idx]), color="k", ls="--", lw=1)
    ax.set_xlabel(result.metric)
    ax.set_ylabel("shuffles")
    ax.set_title(
        f"{result.metric}, cell {_cell_label(result, cell)}{suffix}\n"
        f"{_fmt_p(float(np.asarray(sh.p_value)[idx]))} ({sh.tail} tail)",
        fontsize=10,
    )
    ax.legend(fontsize=8, frameon=False)
    return fig


# --------------------------------------------------------------------------- #
# tuning heatmap
# --------------------------------------------------------------------------- #


def plot_tuning_heatmap(
    result: MetricResult,
    sort_by: str | None = None,
    ax: Any = None,
    cmap: str | None = None,
) -> Figure:
    """Cells x states heatmap of ``result.values`` with significance markers.

    Look for: blocks of cells lit in one column (state-selective cells); white
    dots mark cells significant under the stored shuffle.  AUROC is drawn on a
    diverging map centred on 0.5.

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
    vals = np.asarray(result.values, float)
    if vals.ndim != 2:
        raise ValueError(f"values must be 2D (n_cells, n_states), got shape {vals.shape}")
    n_cells, n_states = vals.shape
    names = result.state_names or [str(i) for i in range(n_states)]
    order = np.arange(n_cells)
    if sort_by == "peak":
        filled = np.where(np.isfinite(vals), vals, -np.inf)
        order = np.lexsort((-filled.max(axis=1), filled.argmax(axis=1)))
    elif sort_by is not None:
        if sort_by not in names:
            raise ValueError(f"sort_by {sort_by!r} is not 'peak' or one of {names}")
        col = np.nan_to_num(vals[:, names.index(sort_by)], nan=-np.inf)
        order = np.argsort(-col, kind="stable")
    fig, ax = _get_ax(ax, (max(4.0, 0.5 * n_states + 2.5), max(3.5, 0.06 * n_cells + 1.5)))
    is_auroc = result.metric == "auroc"
    kw: dict[str, Any] = {"cmap": cmap or ("RdBu_r" if is_auroc else "viridis")}
    if is_auroc:
        # Centre the diverging map on chance (0.5) and scale to the data so that
        # modest but real effects (AUROC ~0.55-0.6) are visible.
        finite = vals[np.isfinite(vals)]
        half = max(float(np.abs(finite - 0.5).max()) if finite.size else 0.5, 0.05)
        kw.update(vmin=0.5 - half, vmax=0.5 + half)
    im = ax.imshow(vals[order], aspect="auto", interpolation="nearest", **kw)
    sig = _significant(result)
    if sig is not None and sig.shape == vals.shape:
        ys, xs = np.nonzero(sig[order])
        ax.scatter(
            xs, ys, s=8, marker="o", c="white", edgecolors="k", linewidths=0.4, label="significant"
        )
    ax.set_xticks(range(n_states), names, rotation=45, ha="right")
    ax.set_xlabel("state")
    ax.set_ylabel("cell (sorted)" if sort_by else "cell")
    ax.set_title(result.metric)
    ax.figure.colorbar(im, ax=ax, label=result.metric)
    return fig


# --------------------------------------------------------------------------- #
# metric scatter
# --------------------------------------------------------------------------- #


def plot_metric_scatter(
    result_x: MetricResult,
    result_y: MetricResult,
    ax: Any = None,
    log_x: bool = False,
    log_y: bool = False,
) -> Figure:
    """Scatter of two cell-level metrics colored by joint significance.

    Look for: cells significant on only one metric (colored) versus both
    (red), and whether the metrics are correlated.  Without shuffles all points
    are grey.

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
    x = np.asarray(result_x.values, float)
    y = np.asarray(result_y.values, float)
    if x.ndim != 1 or y.ndim != 1:
        raise ValueError("plot_metric_scatter needs 1D cell-level results")
    if x.shape != y.shape:
        raise ValueError(f"result shapes differ: {x.shape} vs {y.shape}")
    fig, ax = _get_ax(ax, (4.8, 4.5))
    sx, sy = _significant(result_x), _significant(result_y)
    if sx is None and sy is None:
        ax.scatter(x, y, s=14, color="0.4")
    else:
        sx = np.zeros_like(x, bool) if sx is None else sx
        sy = np.zeros_like(x, bool) if sy is None else sy
        groups = [
            ("neither", ~sx & ~sy, "0.75"),
            (f"{result_x.metric} only", sx & ~sy, "C1"),
            (f"{result_y.metric} only", ~sx & sy, "C2"),
            ("both", sx & sy, "C3"),
        ]
        for label, m, color in groups:
            ax.scatter(x[m], y[m], s=16, color=color, label=f"{label} ({int(m.sum())})")
        ax.legend(fontsize=8, frameon=False)
    if log_x:
        ax.set_xscale("log")
    if log_y:
        ax.set_yscale("log")
    ax.set_xlabel(result_x.metric)
    ax.set_ylabel(result_y.metric)
    return fig


# --------------------------------------------------------------------------- #
# population matrix
# --------------------------------------------------------------------------- #


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
    m = np.asarray(result.values, float)
    if m.ndim != 2 or m.shape[0] != m.shape[1]:
        raise ValueError(f"values must be a 2D square matrix, got shape {m.shape}")
    n = m.shape[0]
    names = result.state_names or [str(i) for i in range(n)]
    fig, ax = _get_ax(ax, (max(4.5, 0.4 * n + 2.5), max(4.0, 0.4 * n + 2.0)))
    cm = plt.get_cmap(cmap).with_extremes(bad="lightgray")
    im = ax.imshow(np.ma.masked_invalid(m), cmap=cm, vmin=vmin, vmax=vmax, interpolation="nearest")
    ax.set_xticks(range(n), names, rotation=90, fontsize=8)
    ax.set_yticks(range(n), names, fontsize=8)
    ax.set_title(result.metric)
    ax.figure.colorbar(im, ax=ax, fraction=0.046, pad=0.03)
    return fig


# --------------------------------------------------------------------------- #
# ground truth recovery
# --------------------------------------------------------------------------- #


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


def plot_ground_truth_recovery(
    session: Session,
    resultset: ResultSet | Sequence[MetricResult],
    alpha: float = 0.05,
    adjusted: bool | None = None,
) -> Figure:
    """Fraction of each planted population detected, per result.

    The ``untuned`` population gives the false-positive rate.  The summary
    table is attached as ``fig.cabana_summary`` (columns ``result``,
    ``population``, ``n``, ``fraction_significant``).  Look for: tall bars for
    the planted populations, and ``untuned`` near the dashed alpha line.
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
        forces ``p_adj`` (raw where absent), ``False`` forces ``p_value``.

    Returns
    -------
    matplotlib.figure.Figure
        Grouped bars per result and planted population.
    """
    session, resultset = order_session_first(session, resultset)
    gt = session.meta.get("ground_truth", {}) or {}
    pops = _planted_populations(gt)
    rows: list[dict[str, Any]] = []
    for r in resultset:
        if r.level != "cell" or r.shuffle is None:
            continue
        sh = r.shuffle
        use_adj = (sh.correction != "none") if adjusted is None else adjusted
        p = sh.p_adj if use_adj and sh.p_adj is not None else sh.p_value
        sig = np.asarray(p) < alpha
        if sig.ndim > 1:
            sig = sig.reshape(sig.shape[0], -1).any(axis=1)
        name = r.name or f"{r.metric}[{r.target}]"
        label = name.replace("[", "\n[", 1)
        for pop, cells in pops.items():
            cells = [c for c in cells if 0 <= c < sig.shape[0]]
            if not cells:
                continue
            rows.append(
                {
                    "result": name,
                    "_label": label,
                    "population": pop,
                    "n": len(cells),
                    "fraction_significant": float(sig[cells].mean()),
                }
            )
    df = pd.DataFrame(rows, columns=["result", "_label", "population", "n", "fraction_significant"])
    fig, ax = plt.subplots(
        figsize=(max(5.0, 1.6 * df["result"].nunique() + 2), 4.0), layout="constrained"
    )
    if df.empty:
        ax.axis("off")
        ax.text(
            0.5, 0.5, "No ground truth or no shuffled cell-level results", ha="center", va="center"
        )
    else:
        results = list(dict.fromkeys(df["result"]))
        labels = dict(zip(df["result"], df["_label"], strict=True))
        order = [
            p for p in ("place", "social", "syllable", "untuned") if p in set(df["population"])
        ]
        width = 0.8 / len(order)
        for j, pop in enumerate(order):
            sub = df[df["population"] == pop].set_index("result")
            h = [sub["fraction_significant"].get(r, np.nan) for r in results]
            color = "0.6" if pop == "untuned" else f"C{j}"
            ax.bar(
                np.arange(len(results)) + (j - (len(order) - 1) / 2) * width,
                np.nan_to_num(h),
                width,
                label=pop,
                color=color,
            )
        ax.axhline(alpha, color="k", ls="--", lw=1)
        ax.set_xticks(range(len(results)), [labels[r] for r in results], fontsize=8)
        ax.set_ylim(0, 1.05)
        ax.set_ylabel("fraction significant")
        handles, labs = ax.get_legend_handles_labels()
        handles.append(Line2D([], [], color="k", ls="--", lw=1))
        labs.append(f"alpha={alpha:g}")
        ax.legend(
            handles, labs, fontsize=8, frameon=False, loc="upper left", bbox_to_anchor=(1.01, 1.0)
        )
        ax.set_title("Ground-truth recovery")
    fig.cabana_summary = df.drop(columns="_label").reset_index(drop=True)  # type: ignore[attr-defined]
    return fig
