"""Plots for event-aligned (PETH) results, and their matplotlib-free ``*_data`` companions.

Each ``plot_x(...)`` calls ``plot_x_data(...)`` and draws from the returned dict only.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.figure import Figure

from ._metrics._events import PETH
from ._models import Session
from ._plot_data import PLOT_DATA_VERSION
from ._plot_registry import register_plot
from ._plot_style import (
    BASELINE_SHADE,
    NULL_COLOR,
    RESPONSE_SHADE,
    axis_label,
    mark_significant,
    p_label,
    metric_label,
    ordered_names,
)
from ._results import MetricResult
from ._util import order_session_first

__all__ = [
    "plot_event_raster",
    "plot_event_raster_data",
    "plot_peth",
    "plot_peth_data",
]

_SORTS = ("response", "peak", "latency")


def _peth_from_params(result: MetricResult) -> PETH:
    params = {k: v for k, v in result.params.items() if k != "name"}
    return PETH(**params)


def _windows(result: MetricResult) -> tuple[list[float], list[float]]:
    p = _peth_from_params(result)
    return [float(v) for v in p.baseline_s], [float(v) for v in p.response_s]


def _response_label(result: MetricResult) -> str:
    """``"response (a.u.)"``, or ``"z"`` when the params say the baseline is z-scored."""
    if result.params.get("zscore") or result.params.get("baseline") == "zscore":
        return axis_label("response", "z")
    return metric_label("peth", result.params)


def _shade(ax: Any, baseline: Sequence[float], response: Sequence[float]) -> None:
    ax.axvspan(*baseline, color=BASELINE_SHADE, alpha=0.6, lw=0)
    ax.axvspan(*response, color=RESPONSE_SHADE, alpha=0.2, lw=0)
    ax.axvline(0.0, color="k", lw=0.8, ls="--")


def _decision(shuffle: Any) -> tuple[np.ndarray | None, np.ndarray | None]:
    """``(significant, p)`` honouring the multiplicity correction (adjusted when applied)."""
    if shuffle is None:
        return None, None
    adj = getattr(shuffle, "correction", "none") not in (None, "none")
    if adj and getattr(shuffle, "p_adj", None) is not None:
        sig = shuffle.significant_adj
        if sig is None:
            sig = np.asarray(shuffle.p_adj) < shuffle.alpha
        return np.asarray(sig, bool), np.asarray(shuffle.p_adj, float)
    return np.asarray(shuffle.significant, bool), np.asarray(shuffle.p_value, float)


def _two(a: Any, b: Any) -> tuple[Any, Any]:
    """``(session_or_None, result)`` from two arguments in either order."""
    if isinstance(a, MetricResult):
        return b, a
    return a, b


def plot_peth_data(
    result: MetricResult,
    session: Session | None = None,
    cells: Sequence[int] | None = None,
    states: Sequence[int | str] | None = None,
    sort_by: str = "response",
) -> dict[str, Any]:
    """Everything :func:`plot_peth` draws, as plain arrays.

    Per-state arrays are stacked over the shown states, ``(n_states, n_cells, ...)``.
    ``order[s]`` lists positions into ``cell_ids`` (the shown cells, in the order
    given) from top row to bottom row; ``peth``, ``sem``, ``latency_s`` and
    ``significant`` are already in that sorted order, and ``cell_ids_sorted[s]`` names
    the rows.  Cells of a state with too few events are NaN (``valid[s]`` is False
    when the whole state is).

    ``mean`` / ``mean_sem`` are the mean over shown cells and its standard error
    propagated from the per-cell event SEMs (``sqrt(sum sem_i^2) / n``, cells taken
    as fixed); ``sig_mean`` / ``sig_mean_sem`` are the same over significant cells
    (NaN when none).  The SEM arrays are ``None`` when the result has no
    ``extras["peth_sem"]``.

    Parameters
    ----------
    result : MetricResult
        ``peth`` result with extras ``peth``, ``time_s`` and ``n_events``.
    session : Session, optional
        Fallback source of cell ids.
    cells, states : sequence, optional
        Cells (indices) and states (index or name) to show; ``None`` shows all.
    sort_by : {"response", "peak", "latency"}, default "response"
        ``"response"``: descending response value; ``"peak"``: time of the peak of the
        trace over the whole window, ascending; ``"latency"``: time of the peak
        absolute response within the response window, ascending.

    Returns
    -------
    dict
        ``kind="peth"``.  Look for: a block of cells whose latency rises
        monotonically down the heatmap, and ``significant`` rows sitting at the top.

    Raises
    ------
    ValueError
        If ``sort_by`` is invalid or the result lacks PETH extras.
    """
    session, result = _two(session, result)
    if sort_by not in _SORTS:
        raise ValueError("sort_by must be 'response', 'peak' or 'latency'")
    for k in ("peth", "time_s", "n_events"):
        if k not in result.extras:
            raise ValueError(f"result has no extras[{k!r}]; is it a PETH result?")
    arr = np.asarray(result.extras["peth"], float)
    t = np.asarray(result.extras["time_s"], float)
    n_events = np.asarray(result.extras["n_events"])
    sem_all = result.extras.get("peth_sem", result.extras.get("sem"))
    sem_all = None if sem_all is None else np.asarray(sem_all, float)
    lo_all, hi_all = result.extras.get("peth_null_lo"), result.extras.get("peth_null_hi")
    has_band = lo_all is not None and hi_all is not None
    lat_ext = result.extras.get("latency_s")
    lat_ext = None if lat_ext is None else np.asarray(lat_ext, float)
    n_cells, n_states, _ = arr.shape
    cell_idx = np.arange(n_cells) if cells is None else np.asarray(list(cells), dtype=int)
    names = ordered_names(result.state_names, n_states)
    state_idx = list(range(n_states)) if states is None else [result.state_index(s) for s in states]
    ids_all = result.cell_ids or (session.cell_ids if session is not None else None)
    ids = [str(ids_all[c]) if ids_all else str(c) for c in cell_idx]
    sig_all = _decision(result.shuffle)[0]
    base, resp_w = _windows(result)
    in_resp = (t >= resp_w[0]) & (t < resp_w[1])
    if not in_resp.any():
        in_resp = np.ones(t.size, bool)

    S, C, T = len(state_idx), len(cell_idx), t.size
    peth = np.full((S, C, T), np.nan)
    sem = None if sem_all is None else np.full((S, C, T), np.nan)
    order = np.tile(np.arange(C), (S, 1))
    latency = np.full((S, C), np.nan)
    sig = np.zeros((S, C), bool)
    valid = np.zeros(S, bool)
    mean = np.full((S, T), np.nan)
    mean_sem = None if sem is None else np.full((S, T), np.nan)
    sig_mean = np.full((S, T), np.nan)
    sig_mean_sem = None if sem is None else np.full((S, T), np.nan)
    null_lo = np.full((S, C, T), np.nan) if has_band else None
    null_hi = None if null_lo is None else np.full((S, C, T), np.nan)
    mean_null_lo = np.full((S, T), np.nan) if has_band else None
    mean_null_hi = None if mean_null_lo is None else np.full((S, T), np.nan)
    lat_med_sig = np.full(S, np.nan) if has_band else None
    for k, s in enumerate(state_idx):
        d = arr[cell_idx, s]
        valid[k] = bool(np.isfinite(d).any())
        if not valid[k]:
            continue
        lat = np.full(C, np.nan)
        ok = np.isfinite(d[:, in_resp]).any(axis=1)
        if ok.any():
            seg = np.abs(np.nan_to_num(d[:, in_resp], nan=-np.inf))
            lat[ok] = t[in_resp][np.argmax(seg, axis=1)][ok]
        if lat_ext is not None:
            lat = lat_ext[cell_idx, s].copy()
        if sort_by == "response":
            key = -np.nan_to_num(np.asarray(result.values, float)[cell_idx, s], nan=-np.inf)
        elif sort_by == "peak":
            key = t[np.argmax(np.nan_to_num(d, nan=-np.inf), axis=1)].astype(float)
            key[~np.isfinite(d).any(axis=1)] = np.inf
        else:
            key = np.where(np.isfinite(lat), lat, np.inf)
        o = np.argsort(key, kind="stable")
        order[k] = o
        peth[k] = d[o]
        latency[k] = lat[o]
        if sig_all is not None:
            sig[k] = sig_all[cell_idx, s][o]
        if has_band:
            null_lo[k] = np.asarray(lo_all, float)[cell_idx, s][o]
            null_hi[k] = np.asarray(hi_all, float)[cell_idx, s][o]
            if np.isfinite(null_lo[k]).any():
                mean_null_lo[k] = np.nanmean(null_lo[k], axis=0)
                mean_null_hi[k] = np.nanmean(null_hi[k], axis=0)
            if sig[k].any() and np.isfinite(latency[k][sig[k]]).any():
                lat_med_sig[k] = np.nanmedian(latency[k][sig[k]])
        if sem is not None:
            sem[k] = sem_all[cell_idx, s][o]
        mean[k] = np.nanmean(peth[k], axis=0)
        if sem is not None:
            n_ok = np.isfinite(sem[k]).sum(axis=0)
            with np.errstate(invalid="ignore", divide="ignore"):
                mean_sem[k] = np.sqrt(np.nansum(sem[k] ** 2, axis=0)) / np.where(
                    n_ok > 0, n_ok, np.nan
                )
        if sig[k].any():
            sig_mean[k] = np.nanmean(peth[k][sig[k]], axis=0)
            if sem is not None:
                n_ok = np.isfinite(sem[k][sig[k]]).sum(axis=0)
                with np.errstate(invalid="ignore", divide="ignore"):
                    sig_mean_sem[k] = np.sqrt(np.nansum(sem[k][sig[k]] ** 2, axis=0)) / np.where(
                        n_ok > 0, n_ok, np.nan
                    )
    finite = peth[np.isfinite(peth)]
    lim = float(np.abs(finite).max()) if finite.size else 1.0
    return {
        "kind": "peth",
        "version": PLOT_DATA_VERSION,
        "time_s": t,
        "state_names": [names[s] for s in state_idx],
        "n_events": np.asarray([int(n_events[s]) for s in state_idx]),
        "cell_ids": ids,
        "order": order,
        "cell_ids_sorted": [[ids[i] for i in o] for o in order],
        "peth": peth,
        "sem": sem,
        "latency_s": latency,
        "latency_source": "peak" if lat_ext is None else "null_band",
        "null_lo": null_lo,
        "null_hi": null_hi,
        "mean_null_lo": mean_null_lo,
        "mean_null_hi": mean_null_hi,
        "latency_median_sig_s": lat_med_sig,
        "significant": sig,
        "valid": valid,
        "mean": mean,
        "mean_sem": mean_sem,
        "sig_mean": sig_mean,
        "sig_mean_sem": sig_mean_sem,
        "baseline_window_s": base,
        "response_window_s": resp_w,
        "sort_by": sort_by,
        "vlim": lim if lim > 0 else 1.0,
        "units": _response_label(result),
        "time_label": "time from onset (s)",
    }


@register_plot(
    "peth",
    data=plot_peth_data,
    needs_session=True,
    level="cell",
    requires=("extras:peth", "target"),
)
def plot_peth(
    result: MetricResult,
    session: Session,
    cells: Sequence[int] | None = None,
    states: Sequence[int | str] | None = None,
    ncols: int = 4,
    sort_by: str = "response",
) -> Figure:
    """Cells x time heatmap of the event-averaged response per state, with a mean trace below.

    Rows are sorted by response (descending), by peak time (``sort_by="peak"``) or by
    response latency (``sort_by="latency"``: time of the peak absolute response inside
    the response window, ascending).  The heatmap has a colourbar in response units.
    Cells significant under the shuffle test (if one was run) carry the shared
    significance marker at the right edge; the lower panel shows the mean trace over
    all shown cells (grey) and over significant cells (orange), each with a +/- SEM
    band when the result stores ``extras["peth_sem"]`` (see :func:`plot_peth_data` for
    how the SEM is combined).  Shading: baseline (grey) and response (orange)
    windows.  If the PETH was run with ``null_band=True`` the lower panel also shows
    the null band (grey, the mean over shown cells of the per-cell 2.5-97.5 percent
    circular-shift band, an approximation) and a dotted line at the median latency of
    significant cells; ``sort_by="latency"`` then orders by the null-band latency.
    ``result`` and ``session`` may be given in either order.  Look for: a
    band of cells that rise (red) or fall (blue) after the dashed onset line, a
    latency staircase when sorted by latency, and whether significant cells are the
    strongest responders.

    Parameters
    ----------
    result : MetricResult
        ``peth`` result with ``extras`` ``peth``, ``time_s`` and ``n_events``.
    session : Session
        Source of fallback cell ids.
    cells : sequence of int, optional
        Cell indices to show; ``None`` shows all.
    states : sequence of int or str, optional
        States to show (index or name); ``None`` shows all.
    ncols : int, default 4
        Maximum state panels per row.
    sort_by : {"response", "peak", "latency"}, default "response"
        Row order.

    Returns
    -------
    matplotlib.figure.Figure
        One heatmap-plus-trace panel per state (a note when there are too few events).

    Raises
    ------
    ValueError
        If ``sort_by`` is invalid or the result is not a PETH result.
    """
    session, result = order_session_first(session, result)
    d = plot_peth_data(result, session, cells=cells, states=states, sort_by=sort_by)
    t = d["time_s"]
    n_show = len(d["state_names"])
    ncols = max(1, min(ncols, n_show))
    nrows = int(np.ceil(n_show / ncols))
    fig = plt.figure(figsize=(3.6 * ncols + 0.6, 5.2 * nrows), layout="constrained")
    outer = fig.add_gridspec(nrows, ncols + 1, width_ratios=[1.0] * ncols + [0.05])
    dt = float(np.median(np.diff(t))) if t.size > 1 else 1.0
    lim = d["vlim"]
    im = None
    heat_axes = []
    for k in range(n_show):
        sub = outer[k // ncols, k % ncols].subgridspec(2, 1, height_ratios=[3, 1.3])
        ax = fig.add_subplot(sub[0])
        ax_m = fig.add_subplot(sub[1], sharex=ax)
        ax.set_title(f"{d['state_names'][k]} (n={int(d['n_events'][k])})", fontsize=9)
        if not d["valid"][k]:
            for a in (ax, ax_m):
                a.text(0.5, 0.5, "too few events", ha="center", va="center", transform=a.transAxes)
            continue
        heat_axes.append(ax)
        data = d["peth"][k]
        n_rows = data.shape[0]
        im = ax.imshow(
            data,
            aspect="auto",
            cmap="RdBu_r",
            vmin=-lim,
            vmax=lim,
            interpolation="nearest",
            extent=(t[0] - dt / 2, t[-1] + dt / 2, n_rows - 0.5, -0.5),
        )
        ax.axvline(0.0, color="k", lw=0.8, ls="--")
        ax.set_ylabel("cell" if k % ncols == 0 else "")
        if n_rows <= 40:
            ax.set_yticks(range(n_rows))
            ax.set_yticklabels(d["cell_ids_sorted"][k], fontsize=6)
        plt.setp(ax.get_xticklabels(), visible=False)
        s_sig = d["significant"][k]
        if s_sig.any():
            mark_significant(
                ax, np.full(int(s_sig.sum()), t[-1] + dt), np.flatnonzero(s_sig), clip_on=False
            )
        _shade(ax_m, d["baseline_window_s"], d["response_window_s"])
        if d["mean_null_lo"] is not None:
            ax_m.fill_between(
                t,
                d["mean_null_lo"][k],
                d["mean_null_hi"][k],
                color=NULL_COLOR,
                alpha=0.5,
                lw=0,
                zorder=0,
                label="null band",
            )
            lat_med = d["latency_median_sig_s"][k]
            if np.isfinite(lat_med):
                ax_m.axvline(lat_med, color=RESPONSE_SHADE, lw=1.0, ls=":")
                ax_m.text(
                    lat_med,
                    1.0,
                    f" latency {lat_med:.2g} s",
                    transform=ax_m.get_xaxis_transform(),
                    va="top",
                    fontsize=6,
                )
        ax_m.plot(t, d["mean"][k], color="0.3", lw=1.2, label="all")
        if d["mean_sem"] is not None:
            ax_m.fill_between(
                t,
                d["mean"][k] - d["mean_sem"][k],
                d["mean"][k] + d["mean_sem"][k],
                color="0.3",
                alpha=0.2,
                lw=0,
            )
        if s_sig.any():
            ax_m.plot(t, d["sig_mean"][k], color=RESPONSE_SHADE, lw=1.2, label="significant")
            if d["sig_mean_sem"] is not None:
                ax_m.fill_between(
                    t,
                    d["sig_mean"][k] - d["sig_mean_sem"][k],
                    d["sig_mean"][k] + d["sig_mean_sem"][k],
                    color=RESPONSE_SHADE,
                    alpha=0.25,
                    lw=0,
                )
        if k == 0 and (s_sig.any() or d["mean_null_lo"] is not None):
            ax_m.legend(fontsize=6, frameon=False)
        ax_m.set_xlabel(d["time_label"])
        ax_m.set_ylabel(d["units"] if k % ncols == 0 else "")
    if im is not None:
        cax = fig.add_subplot(outer[:, -1])
        fig.colorbar(im, cax=cax, label=d["units"])
    return fig


def _raster_defaults(result: MetricResult, session: Any) -> dict[str, Any]:
    """Most significant cell (lowest p, else largest response) and its best state."""
    vals = np.asarray(result.values, float)
    if result.shuffle is not None:
        score = -np.nan_to_num(_decision(result.shuffle)[1], nan=np.inf)
        tie = np.nan_to_num(vals, nan=-np.inf)
        flat = np.lexsort((tie.ravel(), score.ravel()))[-1]
    else:
        flat = int(np.argmax(np.nan_to_num(vals, nan=-np.inf)))
    c, s = np.unravel_index(int(flat), vals.shape)
    return {"cell": int(c), "state": int(s)}


def plot_event_raster_data(
    session: Session,
    result: MetricResult,
    cell: int,
    state: int | str,
    mask: np.ndarray | None = None,
) -> dict[str, Any]:
    """Everything :func:`plot_event_raster` draws: per-event windows and their mean +/- SEM.

    Events are recomputed from ``session.activity`` and ``session.states[result.target]``
    with the PETH parameters in ``result.params``.  Keys: ``time_s``, ``windows``
    ``(n_events, n_time)``, ``mean``, ``sem`` (zeros for one event), ``n_events``,
    ``cell_id``, ``state_name``, ``baseline_window_s``, ``response_window_s``,
    ``units``.  ``kind="event_raster"``.
    """
    session, result = order_session_first(session, result)
    peth = _peth_from_params(result)
    s = result.state_index(state)
    sp = session.states[result.target]
    m = session.valid_mask() if mask is None else np.asarray(mask, bool)
    ons = peth.valid_onsets(sp, m, session.fs)[s]
    pre, post, _, _ = peth._geometry(session.fs)
    t = np.arange(-pre, post) / session.fs
    names = ordered_names(result.state_names, sp.onehot.shape[1])
    label = str(result.cell_ids[cell]) if result.cell_ids else str(cell)
    base, resp_w = _windows(result)
    if ons.size:
        win = np.asarray(peth.event_windows(session.activity[[cell]], ons, session.fs)[0], float)
        mean = win.mean(axis=0)
        sem = win.std(axis=0, ddof=1) / np.sqrt(ons.size) if ons.size > 1 else np.zeros_like(mean)
    else:
        win, mean, sem = np.zeros((0, t.size)), np.full(t.size, np.nan), np.full(t.size, np.nan)
    p_txt = p_label(result.shuffle, (int(cell), int(s))) if result.shuffle is not None else ""
    title = f"cell {label}, {names[s]} (n={ons.size} events)" + (f", {p_txt}" if p_txt else "")
    return {
        "kind": "event_raster",
        "title": title,
        "version": PLOT_DATA_VERSION,
        "time_s": t,
        "windows": win,
        "mean": mean,
        "sem": sem,
        "n_events": int(ons.size),
        "cell_id": label,
        "state_name": names[s],
        "baseline_window_s": base,
        "response_window_s": resp_w,
        "units": "activity (a.u.)",
        "time_label": "time from onset (s)",
    }


@register_plot(
    "event_raster",
    data=plot_event_raster_data,
    needs_session=True,
    level="cell",
    requires=("extras:peth", "target"),
    defaults=_raster_defaults,
)
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
    analysis if it differed.  ``session`` and ``result`` may be given in either
    order.  Look for: whether the response is present on most single events
    (vertical stripe after the dashed onset line) or driven by a few.

    Parameters
    ----------
    session : Session
        Provides activity, state space (``session.states[result.target]``) and sampling rate.
    result : MetricResult
        ``peth`` result whose ``params`` define windows and event filters.
    cell : int
        Row index of the cell.
    state : int or str
        State (index or name) whose onsets are used.
    mask : (n_time,) bool, optional
        Mask applied to event onsets; defaults to ``session.valid_mask()``.

    Returns
    -------
    matplotlib.figure.Figure
        Events-by-time image above the mean +/- SEM trace.
    """
    d = plot_event_raster_data(session, result, cell, state, mask)
    t = d["time_s"]
    fig, (ax, ax_m) = plt.subplots(
        2, 1, figsize=(5.5, 5.5), sharex=True, height_ratios=[3, 1.3], layout="constrained"
    )
    ax.set_title(d["title"], fontsize=9)
    if d["n_events"] == 0:
        ax.text(0.5, 0.5, "no events", ha="center", va="center", transform=ax.transAxes)
        return fig
    dt = float(np.median(np.diff(t))) if t.size > 1 else 1.0
    im = ax.imshow(
        d["windows"],
        aspect="auto",
        cmap="viridis",
        interpolation="nearest",
        extent=(t[0], t[-1] + dt, d["n_events"] + 0.5, 0.5),
    )
    ax.axvline(0.0, color="w", lw=0.8, ls="--")
    ax.set_ylabel("event")
    fig.colorbar(im, ax=[ax, ax_m], label=d["units"], fraction=0.04, pad=0.02)
    _shade(ax_m, d["baseline_window_s"], d["response_window_s"])
    ax_m.plot(t, d["mean"], color="0.2", lw=1.2)
    ax_m.fill_between(t, d["mean"] - d["sem"], d["mean"] + d["sem"], color="0.2", alpha=0.25, lw=0)
    ax_m.set_xlabel(d["time_label"])
    ax_m.set_ylabel(d["units"])
    return fig
