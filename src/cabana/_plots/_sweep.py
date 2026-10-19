"""Sweep plots and their matplotlib-free ``*_data`` companions.

Each ``plot_x(...)`` calls ``plot_x_data(...)``, which returns a plain dict of
arrays and labels, and only renders that dict.  The data functions import no
matplotlib, so the same dicts can feed another front end.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.figure import Figure
from matplotlib.lines import Line2D

from .._kernels import rate_map
from ._data import PLOT_DATA_VERSION
from ._style import fmt_p
from .._sweep import SweepResult, _wilson

__all__ = [
    "plot_sweep",
    "plot_sweep_data",
    "plot_sweep_gallery",
    "plot_sweep_gallery_data",
    "plot_sweep_stability",
    "plot_sweep_stability_data",
]

_STYLES = ["-", "--", ":", "-."]


def _py(v: Any) -> Any:
    """Plain Python value for a numpy / pandas scalar (``None`` and str pass through)."""
    if isinstance(v, np.generic):
        return v.item()
    return v


# --------------------------------------------------------------------------- #
# generic facet plot
# --------------------------------------------------------------------------- #


def plot_sweep_data(
    df: pd.DataFrame,
    *,
    x: str,
    hue: str | None = None,
    panels: Sequence[str] = ("frac_significant",),
    style: str | None = None,
) -> dict[str, Any]:
    """Lines for :func:`plot_sweep`: ``{"kind", "version", "x", "hue", "style", "panels", ...}``.

    ``lines`` is a list of ``{"hue", "style", "x", "y": {panel: array}}`` sorted by
    ``x``; one line per (style, hue) combination.
    """
    missing = {x, *panels, *(c for c in (hue, style) if c)} - set(df.columns)
    if missing:
        raise ValueError(f"df is missing columns {sorted(missing)}")
    styles = [_py(v) for v in dict.fromkeys(df[style])] if style else [None]
    hues = [_py(v) for v in sorted(df[hue].unique())] if hue else [None]
    lines = []
    for sv in styles:
        sub_s = df if style is None else df[df[style] == sv]
        for hv in hues:
            sub = sub_s if hue is None else sub_s[sub_s[hue] == hv]
            if sub.empty:
                continue
            sub = sub.sort_values(x)
            lines.append(
                {
                    "hue": _py(hv),
                    "style": _py(sv),
                    "x": sub[x].to_numpy(),
                    "y": {c: sub[c].to_numpy(float) for c in panels},
                }
            )
    return {
        "kind": "sweep",
        "version": PLOT_DATA_VERSION,
        "x": x,
        "hue": hue,
        "style": style,
        "panels": list(panels),
        "hue_values": hues,
        "style_values": styles,
        "x_values": [_py(v) for v in np.sort(df[x].unique())],
        "lines": lines,
    }


def plot_sweep(
    df: pd.DataFrame,
    *,
    x: str,
    hue: str | None = None,
    panels: Sequence[str] = ("frac_significant",),
    alpha_line: float | None = None,
    log_x: bool = False,
    style: str | None = None,
    ax: Any = None,
    xlabel: str | None = None,
    ylabels: dict[str, str] | Sequence[str] | None = None,
    hue_label: Callable[[Any], str] | None = None,
    alpha_panels: Sequence[str] | None = None,
    sharey: bool = False,
) -> Figure:
    """Facet plot over a tidy sweep table: one panel per column in ``panels``.

    Draws ``panels[i]`` against ``x`` with one line per ``hue`` value (colour)
    and, if ``style`` is given, per ``style`` value (line style).  Works on
    :meth:`SweepResult.summary` or any hand-built table (for example detection
    and false-positive rates per setting).  Panels whose values all lie in
    [0, 1] get a 0 to 1.05 y-axis.  Look for: the setting where the curves
    flatten (a plateau), and hue curves that diverge (a parameter interaction).

    Parameters
    ----------
    df : pandas.DataFrame
        Table with columns ``x``, ``hue``/``style`` (if given) and every panel.
    x, hue, style : str
        Column names; ``hue`` colours lines, ``style`` varies the line style.
    panels : sequence of str, default ("frac_significant",)
        Columns drawn, one axes each.
    alpha_line : float, optional
        Dashed horizontal reference (e.g. 0.05), drawn on ``alpha_panels``
        (default: the last panel only).
    log_x : bool, default False
        Logarithmic x axis.
    ax : Axes or sequence of Axes, optional
        One axes per panel; a new figure is made if omitted.
    xlabel : str, optional
        Defaults to ``x``.
    ylabels : dict or sequence of str, optional
        Axis labels per panel (dict keyed by column or one per panel).
    hue_label : callable, optional
        Legend text for a hue value; default ``f"{hue}={value:g}"``-style.
    sharey : bool, default False
        Share the y axis across panels (only when the figure is created here).

    Returns
    -------
    matplotlib.figure.Figure

    Raises
    ------
    ValueError
        If columns are missing or ``ax`` has the wrong number of axes.
    """
    d = plot_sweep_data(df, x=x, hue=hue, panels=panels, style=style)
    n = len(panels)
    if ax is None:
        fig, axes_ = plt.subplots(
            1, n, figsize=(4.4 * n + 0.6, 3.8), sharey=sharey, layout="constrained", squeeze=False
        )
        axes = axes_.ravel()
    else:
        axes = np.asarray(ax).ravel()
        if axes.size != n:
            raise ValueError(f"ax must hold {n} axes (one per panel)")
        fig = axes[0].figure
    cmap = plt.get_cmap("viridis")
    hv = d["hue_values"]
    colors = {
        h: cmap(i / max(len(hv) - 1, 1) * 0.85) if len(hv) > 1 else "C0" for i, h in enumerate(hv)
    }
    sv = d["style_values"]
    sty = {s: _STYLES[i % len(_STYLES)] for i, s in enumerate(sv)}
    labs: dict[str, str] = {}
    if isinstance(ylabels, dict):
        labs = dict(ylabels)
    elif ylabels is not None:
        labs = dict(zip(panels, ylabels, strict=False))
    xs = d["x_values"]
    for a, col in zip(axes, panels, strict=True):
        ys = []
        for ln in d["lines"]:
            a.plot(
                ln["x"],
                ln["y"][col],
                marker="o",
                ms=4,
                color=colors[ln["hue"]],
                ls=sty[ln["style"]],
            )
            ys.append(ln["y"][col])
        a.set_xlabel(xlabel or x)
        a.set_ylabel(labs.get(col, col))
        if log_x:
            a.set_xscale("log")
        allv = np.concatenate(ys) if ys else np.array([])
        allv = allv[np.isfinite(allv)]
        if allv.size and allv.min() >= 0 and allv.max() <= 1:
            a.set_ylim(0, 1.05)
        if not log_x and len(xs) <= 12 and np.issubdtype(np.asarray(xs).dtype, np.number):
            a.set_xticks(xs)
    ref = list(alpha_panels) if alpha_panels is not None else [panels[-1]]
    if alpha_line is not None:
        for a, col in zip(axes, panels, strict=True):
            if col in ref:
                a.axhline(alpha_line, color="k", ls="--", lw=1)
    handles = []
    if hue is not None:
        fmt = hue_label or (
            lambda v: f"{hue}={v:g}" if isinstance(v, (int, float, np.number)) else f"{hue}={v}"
        )
        handles += [Line2D([], [], color=colors[h], marker="o", ms=4, label=fmt(h)) for h in hv]
    if style is not None and len(sv) > 1:
        handles += [Line2D([], [], color="0.3", ls=sty[s], label=str(s)) for s in sv]
    if alpha_line is not None:
        handles.append(Line2D([], [], color="k", ls="--", lw=1, label=f"alpha = {alpha_line:g}"))
    if handles:
        axes[-1].legend(
            handles=handles, fontsize=8, frameon=False, loc="upper left", bbox_to_anchor=(1.01, 1.0)
        )
    return fig


# --------------------------------------------------------------------------- #
# gallery
# --------------------------------------------------------------------------- #


def _resolve_analysis(sweep: SweepResult, analysis: str | None) -> str:
    if not sweep.points:
        raise ValueError("sweep has no points")
    rs = sweep.points[0][1]
    if analysis is not None:
        rs[analysis]  # KeyError lists the available names
        return analysis
    for r in rs:
        if r.level == "cell":
            return str(r.name)
    raise ValueError("sweep has no cell-level analysis")


def _layout_for(sweep: SweepResult, k: int, session: Any, target: str) -> dict[str, Any] | None:
    if k < len(sweep.layouts) and target in sweep.layouts[k]:
        return sweep.layouts[k][target]
    if session is not None and target in session.states:
        sp = session.states[target]
        topo = sp.topology
        return {
            "kind": sp.kind,
            "state_names": [str(s) for s in sp.state_names],
            "shape": None if topo is None else [int(n) for n in topo.shape],
            "edges": None if topo is None else [np.asarray(e, float).tolist() for e in topo.edges],
            "axis_names": None if topo is None else [str(a) for a in topo.axis_names],
        }
    return None


def _recompute_rate(session: Any, res: Any, ci: int, layout: dict[str, Any]) -> np.ndarray:
    """Rate map of one cell from the session for a result without a ``rate_map`` extra."""
    from .._statesums import masked_counts, state_sums

    space = session.states[res.target]
    if space.n_states != len(layout["state_names"]):
        raise ValueError(
            f"session state space {res.target!r} has {space.n_states} states but the sweep "
            f"point used {len(layout['state_names'])}: pass the prepared session for this point"
        )
    mask = session.valid_mask(list(res.provenance.get("masks") or []))
    if space.support is not None:
        mask = mask & space.support
    occ = masked_counts(space, mask)
    sums = state_sums(np.asarray(session.activity[ci : ci + 1], np.float64), space, mask)
    shape = None if layout["shape"] is None else tuple(layout["shape"])
    rate, _ = rate_map(
        sums,
        occ,
        session.fs,
        float(res.params.get("min_occupancy_s", 0.05)),
        shape,
        float(res.params.get("smooth_sigma_bins", 0.0)) if shape is not None else 0.0,
    )
    return rate[0]


def plot_sweep_gallery_data(
    session: Any,
    sweep: SweepResult,
    cell: int | str,
    *,
    param: str,
    analysis: str | None = None,
    shared_scale: bool = True,
    fixed: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Per-candidate panels for one cell (see :func:`plot_sweep_gallery`).

    Returns ``{"kind", "version", "param", "analysis", "cell_id", "metric", "shared_scale", "vmin",
    "vmax", "panels"}``; each panel is ``{"param_value", "kind"
    ("grid2d"|"grid1d"|"bar"|"none"), "map" (array or None), "shape", "edges",
    "state_names", "value", "p_value", "significant"}``.
    """
    name = _resolve_analysis(sweep, analysis)
    line = sweep._line(param, fixed)
    panels: list[dict[str, Any]] = []
    cell_id: str | None = None
    metric = ""
    for cv, k in line:
        res = sweep.points[k][1][name]
        metric = res.metric
        if res.level != "cell":
            raise ValueError(f"{name!r} is not a cell-level result")
        ids = res.cell_ids
        if isinstance(cell, str):
            if ids is None or cell not in ids:
                raise KeyError(f"cell {cell!r} not in result cell_ids")
            ci = ids.index(cell)
        else:
            ci = int(cell)
        cell_id = str(ids[ci]) if ids is not None else str(ci)
        values = np.asarray(res.values)
        layout = _layout_for(sweep, k, session, res.target) if res.target_kind == "states" else None
        rate = None
        if "rate_map" in res.extras:
            rate = np.asarray(res.extras["rate_map"], float)[ci]
        elif layout is not None and values.ndim == 2:
            rate = values[ci].astype(float)
        elif layout is not None and session is not None:
            try:
                rate = _recompute_rate(session, res, ci, layout)
            except (KeyError, ValueError):
                rate = None
        value = float(values[ci]) if values.ndim == 1 else None
        sh = res.shuffle
        p = sig = None
        if sh is not None and np.ndim(sh.p_value) == 1:
            p, sig = float(sh.p_value[ci]), bool(sh.significant[ci])
        kind = "none"
        shape = edges = None
        if rate is not None and layout is not None:
            if layout["shape"] is not None and len(layout["shape"]) == 2:
                kind, shape, edges = "grid2d", layout["shape"], layout["edges"]
            elif layout["shape"] is not None and len(layout["shape"]) == 1:
                kind, edges = "grid1d", layout["edges"]
            else:
                kind = "bar"
        panels.append(
            {
                "param_value": _py(cv),
                "kind": kind,
                "map": rate,
                "shape": shape,
                "edges": edges,
                "state_names": None if layout is None else layout["state_names"],
                "value": value,
                "p_value": p,
                "significant": sig,
            }
        )
    fin = [m["map"][np.isfinite(m["map"])] for m in panels if m["map"] is not None]
    fin = [f for f in fin if f.size]
    vmin = float(min(f.min() for f in fin)) if fin else 0.0
    vmax = float(max(f.max() for f in fin)) if fin else 1.0
    return {
        "kind": "sweep_gallery",
        "version": PLOT_DATA_VERSION,
        "param": param,
        "analysis": name,
        "cell_id": cell_id,
        "metric": metric,
        "shared_scale": shared_scale,
        "vmin": vmin,
        "vmax": vmax,
        "panels": panels,
    }


def plot_sweep_gallery(
    session: Any,
    sweep: SweepResult,
    cell: int | str,
    *,
    param: str,
    analysis: str | None = None,
    shared_scale: bool = True,
    fixed: dict[str, Any] | None = None,
    cmap: str = "viridis",
) -> Figure:
    """One cell across the candidates of one swept parameter.

    One column per candidate of ``param``: the rate map (2-D grid image, 1-D
    tuning curve, or bars for categorical states) from that grid point, drawn
    on one colour / y scale when ``shared_scale`` is True.  The title gives the
    parameter value, the metric value and, with a shuffle, its p-value.  Rate
    maps come from the result's ``extras["rate_map"]``; if absent they are
    recomputed from ``session`` (activity, masks, smoothing from the result's
    params).  Look for: a field that appears or dissolves as the value changes,
    and whether the cell's classification tracks the visible structure.

    Parameters
    ----------
    session : Session
        Prepared session (used only when a rate map must be recomputed).
    sweep : SweepResult
    cell : int or str
        Row index or cell id.
    param : str
        Swept path to vary across columns; other paths are held at their first
        candidate unless given in ``fixed``.
    analysis : str, optional
        Analysis name; default the first cell-level analysis.
    shared_scale : bool, default True
        Common colour (y) limits across the row.
    fixed : dict, optional
        Values of the other swept paths.
    cmap : str, default "viridis"

    Returns
    -------
    matplotlib.figure.Figure
    """
    d = plot_sweep_gallery_data(
        session, sweep, cell, param=param, analysis=analysis, shared_scale=shared_scale, fixed=fixed
    )
    panels = d["panels"]
    n = max(len(panels), 1)
    fig, axes = plt.subplots(
        1, n, figsize=(2.6 * n + 0.8, 2.9), squeeze=False, layout="constrained"
    )
    last_img = None
    short = param.split(".")[-1]
    for ax, pn in zip(axes.ravel(), panels, strict=False):
        title = f"{short}={pn['param_value']}"
        cap = []
        if pn["value"] is not None:
            cap.append(f"{d['metric']}={pn['value']:.3g}")
        if pn["p_value"] is not None:
            cap.append(fmt_p(pn["p_value"]))
        if cap:
            title += "\n" + ", ".join(cap)
        ax.set_title(title, fontsize=8)
        m = pn["map"]
        lim = (d["vmin"], d["vmax"]) if shared_scale else (None, None)
        if pn["kind"] == "grid2d":
            img = np.ma.masked_invalid(np.asarray(m, float).reshape(pn["shape"]).T)
            cm = plt.get_cmap(cmap).with_extremes(bad=(0, 0, 0, 0))
            xe, ye = pn["edges"]
            last_img = ax.imshow(
                img,
                origin="lower",
                cmap=cm,
                aspect="auto",
                extent=(xe[0], xe[-1], ye[0], ye[-1]),
                vmin=lim[0],
                vmax=lim[1],
            )
            ax.set_xticks([])
            ax.set_yticks([])
        elif pn["kind"] == "grid1d":
            e = np.asarray(pn["edges"][0], float)
            ax.plot(0.5 * (e[1:] + e[:-1]), m, color="C0")
            if lim[0] is not None:
                ax.set_ylim(lim[0], lim[1])
            ax.tick_params(labelsize=7)
        elif pn["kind"] == "bar":
            ax.bar(range(len(m)), np.nan_to_num(np.asarray(m, float)), color="C0")
            ax.set_xticks(range(len(m)), pn["state_names"], rotation=60, ha="right", fontsize=7)
            if lim[0] is not None:
                ax.set_ylim(min(lim[0], 0), lim[1])
            ax.tick_params(axis="y", labelsize=7)
        else:
            ax.text(0.5, 0.5, "no map", ha="center", va="center", transform=ax.transAxes)
            ax.set_xticks([])
            ax.set_yticks([])
    if last_img is not None and shared_scale:
        fig.colorbar(last_img, ax=list(axes.ravel()), shrink=0.8, label="rate")
    fig.suptitle(f"{d['analysis']}: cell {d['cell_id']}", fontsize=9)
    return fig


# --------------------------------------------------------------------------- #
# stability
# --------------------------------------------------------------------------- #


def plot_sweep_stability_data(
    sweep: SweepResult,
    *,
    analysis: str,
    param: str,
    fixed: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Arrays for :func:`plot_sweep_stability`.

    Keys: ``kind``, ``version``, ``candidates``, ``frac_significant``, ``ci_lo``, ``ci_hi`` (Wilson 95%),
    ``n_cells``, ``units`` (row labels), ``matrix`` ``(n_units, n_candidates)``
    float (1 significant, 0 not, NaN missing / no p-value) sorted by first
    flip, ``flip_counts`` per unit, ``spearman`` and ``spearman_n`` per adjacent
    candidate pair, ``pair_labels``, ``has_p``.
    """
    line = sweep._line(param, fixed)
    pts = [k for _, k in line]
    cands = [c for c, _ in line]
    sig = sweep._pivot("significant", analysis)
    val = sweep._pivot("value", analysis)
    if sig.empty:
        raise ValueError(f"no cell-level rows for analysis {analysis!r}")
    m = sig[pts].to_numpy(float)
    finite = np.isfinite(m)
    k_sig = np.nansum(m, axis=0)
    n_fin = finite.sum(axis=0)
    ci = [_wilson(float(k), float(n)) for k, n in zip(k_sig, n_fin, strict=True)]
    frac = np.where(n_fin > 0, k_sig / np.maximum(n_fin, 1), np.nan)
    both = finite[:, :-1] & finite[:, 1:]
    flips_by = both & (m[:, :-1] != m[:, 1:])
    flips = flips_by.sum(axis=1)
    first = np.where(flips_by.any(axis=1), flips_by.argmax(axis=1), m.shape[1])
    order = np.lexsort((-np.nan_to_num(np.nansum(m, axis=1)), first))
    idx = sig.index.to_frame(index=False)
    units = [
        str(r.cell_id) if r.state == "" else f"{r.cell_id}|{r.state}" for r in idx.itertuples()
    ]
    rho, rho_n = [], []
    for a, b in zip(pts[:-1], pts[1:], strict=True):
        va, vb = val[a], val[b]
        ok = va.notna() & vb.notna()
        rho.append(float(va[ok].rank().corr(vb[ok].rank())) if ok.sum() > 2 else float("nan"))
        rho_n.append(int(ok.sum()))
    return {
        "kind": "sweep_stability",
        "version": PLOT_DATA_VERSION,
        "param": param,
        "analysis": analysis,
        "candidates": [_py(c) for c in cands],
        "frac_significant": frac,
        "ci_lo": np.array([c[0] for c in ci]),
        "ci_hi": np.array([c[1] for c in ci]),
        "n_cells": n_fin,
        "units": [units[i] for i in order],
        "matrix": m[order],
        "flip_counts": flips[order].astype(int),
        "pair_labels": [f"{a}->{b}" for a, b in zip(cands[:-1], cands[1:], strict=True)],
        "spearman": np.array(rho),
        "spearman_n": np.array(rho_n),
        "has_p": bool(finite.any()),
    }


def plot_sweep_stability(
    sweep: SweepResult,
    *,
    analysis: str,
    param: str,
    fixed: dict[str, Any] | None = None,
) -> Figure:
    """Three-panel stability readout for one analysis along one swept parameter.

    Left: fraction of cells significant at each candidate with a 95% Wilson
    interval.  Middle: cells (rows, sorted by first change) by candidate
    (columns), dark where significant, with the flip count per cell as a bar
    margin.  Right: Spearman rank correlation of the metric value between
    adjacent candidates.  Look for: a flat left panel hiding a busy middle one
    (cells swapping in and out), rows with several flips, and a correlation
    that drops at one step.  Without shuffles the first two panels say so.

    Parameters
    ----------
    sweep : SweepResult
    analysis : str
        Analysis name (``ResultSet.names()``).
    param : str
        Swept path along which candidates are laid out; other swept paths are
        held at their first candidate unless in ``fixed``.
    fixed : dict, optional

    Returns
    -------
    matplotlib.figure.Figure
    """
    d = plot_sweep_stability_data(sweep, analysis=analysis, param=param, fixed=fixed)
    cands = d["candidates"]
    n = len(cands)
    numeric = all(isinstance(c, (int, float, np.number)) and not isinstance(c, bool) for c in cands)
    xpos = np.array(cands, float) if numeric else np.arange(n, dtype=float)
    fig = plt.figure(figsize=(12.5, 3.9), layout="constrained")
    gs = fig.add_gridspec(1, 3, width_ratios=[1, 1.15, 1])
    a0 = fig.add_subplot(gs[0])
    sub = gs[1].subgridspec(1, 2, width_ratios=[5, 1], wspace=0.05)
    a1, a1m = fig.add_subplot(sub[0]), fig.add_subplot(sub[1])
    a2 = fig.add_subplot(gs[2])
    short = param.split(".")[-1]
    if d["has_p"]:
        yerr = np.vstack([d["frac_significant"] - d["ci_lo"], d["ci_hi"] - d["frac_significant"]])
        a0.errorbar(xpos, d["frac_significant"], yerr=yerr, marker="o", ms=4, capsize=3, color="C0")
        a0.set_ylim(0, 1.05)
        cmat = np.ma.masked_invalid(d["matrix"])
        a1.imshow(cmat, aspect="auto", cmap="Greys", vmin=0, vmax=1.6, interpolation="nearest")
        a1m.barh(np.arange(len(d["flip_counts"])), d["flip_counts"], color="C3", height=1.0)
        a1m.set_ylim(len(d["flip_counts"]) - 0.5, -0.5)
        a1m.set_yticks([])
        a1m.set_xlabel("flips", fontsize=8)
        a1m.set_xlim(0, max(1, int(np.max(d["flip_counts"]))))
    else:
        for a in (a0, a1):
            a.text(
                0.5,
                0.5,
                "no shuffles: no significance",
                ha="center",
                va="center",
                transform=a.transAxes,
            )
        a1m.axis("off")
    a0.set_xlabel(short)
    a0.set_ylabel("fraction significant")
    a0.set_title("classification (Wilson 95%)", fontsize=9)
    a1.set_xticks(range(n), [f"{c:g}" if numeric else str(c) for c in cands], fontsize=8)
    a1.set_xlabel(short)
    a1.set_ylabel(f"{len(d['units'])} cells, sorted by first flip")
    a1.set_yticks([])
    a1.set_title("significant (dark) per cell", fontsize=9)
    mid = 0.5 * (xpos[:-1] + xpos[1:])
    a2.plot(mid, d["spearman"], marker="o", ms=4, color="C2")
    a2.set_ylim(
        min(0.0, float(np.nanmin(d["spearman"])))
        if len(mid) and np.isfinite(d["spearman"]).any()
        else 0,
        1.02,
    )
    a2.set_xlabel(f"{short} (between neighbours)")
    a2.set_ylabel("Spearman rho of value")
    a2.set_title("rank agreement of values", fontsize=9)
    if numeric:
        for a in (a0, a2):
            a.set_xticks(xpos if len(xpos) <= 12 else a.get_xticks())
    fig.suptitle(f"{analysis}", fontsize=9)
    return fig
