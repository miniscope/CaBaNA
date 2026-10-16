"""Plots for event-aligned (PETH) results.  Every function returns a ``Figure``."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.figure import Figure

from ._metrics._events import PETH
from ._models import Session
from ._results import MetricResult

__all__ = ["plot_event_raster", "plot_peth"]


def _peth_from_params(result: MetricResult) -> PETH:
    params = {k: v for k, v in result.params.items() if k != "name"}
    return PETH(**params)


def _state_index(result: MetricResult, state: int | str) -> int:
    if isinstance(state, str):
        names = result.state_names or []
        if state not in names:
            raise KeyError(f"state {state!r} not in {names}")
        return names.index(state)
    return int(state)


def _shade(ax: Any, peth: PETH) -> None:
    ax.axvspan(*peth.baseline_s, color="0.5", alpha=0.15, lw=0)
    ax.axvspan(*peth.response_s, color="tab:orange", alpha=0.15, lw=0)
    ax.axvline(0.0, color="k", lw=0.8, ls="--")


def plot_peth(
    result: MetricResult,
    session: Session,
    cells: Sequence[int] | None = None,
    states: Sequence[int | str] | None = None,
    ncols: int = 4,
    sort_by: str = "response",
) -> Figure:
    """Cells x time heatmap of the event-averaged response per state, with a mean trace below.

    Rows are sorted by response (descending) or by peak time (``sort_by="peak"``).
    Cells significant under the shuffle test (if one was run) are marked with a
    dot at the right edge of the heatmap; the lower panel shows the mean trace
    over all shown cells (grey) and over significant cells (orange, if any).
    Shaded bands: baseline (grey) and response (orange) windows.
    """
    if sort_by not in ("response", "peak"):
        raise ValueError("sort_by must be 'response' or 'peak'")
    for k in ("peth", "time_s", "n_events"):
        if k not in result.extras:
            raise ValueError(f"result has no extras[{k!r}]; is it a PETH result?")
    peth = _peth_from_params(result)
    arr, t = result.extras["peth"], result.extras["time_s"]
    n_events = result.extras["n_events"]
    n_cells, n_states, _ = arr.shape
    cell_idx = np.arange(n_cells) if cells is None else np.asarray(list(cells), dtype=int)
    names = result.state_names or [str(i) for i in range(n_states)]
    state_idx = (
        list(range(n_states)) if states is None else [_state_index(result, s) for s in states]
    )
    sig = None if result.shuffle is None else np.asarray(result.shuffle.significant, bool)
    ids = result.cell_ids or session.cell_ids

    ncols = max(1, min(ncols, len(state_idx)))
    nrows = int(np.ceil(len(state_idx) / ncols))
    fig = plt.figure(figsize=(3.6 * ncols, 5.2 * nrows), layout="constrained")
    outer = fig.add_gridspec(nrows, ncols)
    for k, s in enumerate(state_idx):
        sub = outer[k // ncols, k % ncols].subgridspec(2, 1, height_ratios=[3, 1.3])
        ax = fig.add_subplot(sub[0])
        ax_m = fig.add_subplot(sub[1], sharex=ax)
        data = arr[cell_idx, s]
        ax.set_title(f"{names[s]} (n={int(n_events[s])})", fontsize=9)
        if not np.isfinite(data).any():
            for a in (ax, ax_m):
                a.text(0.5, 0.5, "too few events", ha="center", va="center", transform=a.transAxes)
            continue
        resp = np.nan_to_num(result.values[cell_idx, s], nan=-np.inf)
        if sort_by == "response":
            order = np.argsort(-resp, kind="stable")
        else:
            order = np.argsort(np.nanargmax(np.nan_to_num(data, nan=-np.inf), axis=1), kind="stable")
        data = data[order]
        lim = np.nanmax(np.abs(data)) or 1.0
        dt = np.median(np.diff(t)) if t.size > 1 else 1.0
        ax.imshow(
            data, aspect="auto", cmap="RdBu_r", vmin=-lim, vmax=lim, interpolation="nearest",
            extent=(t[0] - dt / 2, t[-1] + dt / 2, len(order) - 0.5, -0.5),
        )
        ax.axvline(0.0, color="k", lw=0.8, ls="--")
        ax.set_ylabel("cell" if k % ncols == 0 else "")
        if len(order) <= 40:
            ax.set_yticks(range(len(order)))
            ax.set_yticklabels([str(ids[cell_idx[o]]) if ids else str(cell_idx[o]) for o in order], fontsize=6)
        plt.setp(ax.get_xticklabels(), visible=False)
        s_sig = None if sig is None else sig[cell_idx, s][order]
        if s_sig is not None and s_sig.any():
            ax.scatter(
                np.full(int(s_sig.sum()), t[-1] + dt), np.flatnonzero(s_sig),
                marker="*", s=14, color="k", clip_on=False,
            )
        _shade(ax_m, peth)
        ax_m.plot(t, np.nanmean(data, axis=0), color="0.3", lw=1.2, label="all")
        if s_sig is not None and s_sig.any():
            ax_m.plot(t, np.nanmean(data[s_sig], axis=0), color="tab:orange", lw=1.2, label="sig.")
            if k == 0:
                ax_m.legend(fontsize=6, frameon=False)
        ax_m.set_xlabel("time from onset (s)")
        ax_m.set_ylabel("activity" if k % ncols == 0 else "")
    return fig


def plot_event_raster(
    session: Session,
    result: MetricResult,
    cell: int,
    state: int | str,
    mask: np.ndarray | None = None,
) -> Figure:
    """Per-event traces of one cell as an image (events x time) plus the mean trace.

    Events are recomputed from ``session.activity`` and the state space named by
    ``result.target`` using the PETH parameters stored in ``result.params``.
    ``mask`` defaults to ``session.valid_mask()``; pass the mask used for the
    analysis if it differed.
    """
    peth = _peth_from_params(result)
    s = _state_index(result, state)
    states = session.states[result.target]
    m = session.valid_mask() if mask is None else np.asarray(mask, bool)
    ons = peth.valid_onsets(states, m, session.fs)[s]
    pre, post, _, _ = peth._geometry(session.fs)
    t = np.arange(-pre, post) / session.fs
    fig, (ax, ax_m) = plt.subplots(
        2, 1, figsize=(5.5, 5.5), sharex=True, height_ratios=[3, 1.3], layout="constrained"
    )
    names = result.state_names or [str(i) for i in range(states.onehot.shape[1])]
    label = result.cell_ids[cell] if result.cell_ids else str(cell)
    ax.set_title(f"cell {label}, {names[s]} (n={ons.size} events)", fontsize=9)
    if ons.size == 0:
        ax.text(0.5, 0.5, "no events", ha="center", va="center", transform=ax.transAxes)
        return fig
    win = peth.event_windows(session.activity[[cell]], ons, session.fs)[0]
    ax.imshow(
        win, aspect="auto", cmap="viridis", interpolation="nearest",
        extent=(t[0], t[-1] + 1 / session.fs, ons.size + 0.5, 0.5),
    )
    ax.axvline(0.0, color="w", lw=0.8, ls="--")
    ax.set_ylabel("event")
    _shade(ax_m, peth)
    mean = win.mean(axis=0)
    sem = win.std(axis=0, ddof=1) / np.sqrt(ons.size) if ons.size > 1 else np.zeros_like(mean)
    ax_m.plot(t, mean, color="0.2", lw=1.2)
    ax_m.fill_between(t, mean - sem, mean + sem, color="0.2", alpha=0.25, lw=0)
    ax_m.set_xlabel("time from onset (s)")
    ax_m.set_ylabel("activity")
    return fig
