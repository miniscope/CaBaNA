"""Plots for cross-session and cohort analyses."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.figure import Figure

from .._cohort._stats import BootstrapResult, compare_states_across_animals
from .._cohort._cross_session import CrossSessionResult
from ._data import PLOT_DATA_VERSION
from ._style import fmt_p, mark_significant

__all__ = [
    "plot_cohort_fractions",
    "plot_cohort_fractions_data",
    "plot_cross_session",
    "plot_cross_session_data",
    "plot_hierarchical_bootstrap",
    "plot_hierarchical_bootstrap_data",
]


def plot_cross_session_data(cs: CrossSessionResult) -> dict[str, Any]:
    """Everything :func:`plot_cross_session` shows: histograms, medians, per-pair r."""
    observed = np.asarray(cs.observed, float)
    obs = observed[np.isfinite(observed)]
    bins = np.linspace(-1, 1, 31)
    nm = np.asarray(cs.null_median, float)
    nm = nm[np.isfinite(nm)]
    obs_counts, _ = np.histogram(obs, bins=bins)
    null_counts = (
        np.histogram(nm, bins=bins, weights=np.full(nm.size, max(len(obs), 1) / nm.size))[0]
        if nm.size
        else None
    )
    return {
        "kind": "cross_session",
        "version": PLOT_DATA_VERSION,
        "pair_kind": str(cs.kind),
        "bins": bins,
        "observed_counts": obs_counts,
        "null_counts": null_counts,
        "median_observed": float(cs.median_observed),
        "p_population": float(cs.p_population),
        "title": f"{fmt_p(cs.p_population)} (population)",
        "observed": observed,
        "significant": np.asarray(cs.significant, bool),
        "xlabel_scatter": "matched pair" if cs.kind == "map" else "state",
        "ylabel": "Pearson r",
        "xlabel": "Pearson r",
    }


def plot_cross_session(cs: CrossSessionResult) -> Figure:
    """Observed r (histogram) with the null-median distribution, and r per pair/state.

    Look for: the observed median r (red line) to the right of the grey null
    distribution (title gives the population p-value), and the number of marked
    (significant) points in the right panel.

    Parameters
    ----------
    cs : CrossSessionResult
        Result of ``cross_session_map_correlation`` (per matched cell) or
        ``cross_session_pv_correlation`` (per state).

    Returns
    -------
    matplotlib.figure.Figure
        Two panels: histogram of ``observed`` vs ``null_median``; ``observed`` per
        pair or state marked where ``significant``.
    """
    d = plot_cross_session_data(cs)
    fig, (ax, ax2) = plt.subplots(1, 2, figsize=(9, 3.6), layout="constrained")
    bins = d["bins"]
    centers = 0.5 * (bins[1:] + bins[:-1])
    width = np.diff(bins)
    ax.bar(centers, d["observed_counts"], width=width, color="C0", alpha=0.7, label="observed r")
    if d["null_counts"] is not None:
        ax.bar(
            centers,
            d["null_counts"],
            width=width,
            color="0.5",
            alpha=0.6,
            label="null median r (scaled)",
        )
    if np.isfinite(d["median_observed"]):
        ax.axvline(
            d["median_observed"], color="C3", lw=2, label=f"median {d['median_observed']:.2f}"
        )
    ax.set_xlabel(d["xlabel"])
    ax.set_ylabel("count")
    ax.set_title(d["title"])
    ax.legend(fontsize=8)
    x = np.arange(d["observed"].shape[0])
    sig = d["significant"]
    ax2.scatter(x, d["observed"], c="0.6", s=14)
    if sig.any():
        mark_significant(ax2, x[sig], d["observed"][sig])
    ax2.axhline(0, color="k", lw=0.5)
    ax2.set_xlabel(d["xlabel_scatter"])
    ax2.set_ylabel(d["ylabel"])
    ax2.set_title("significant marked")
    return fig


def plot_cohort_fractions_data(
    fractions: pd.DataFrame,
    states: Sequence[str] | None = None,
    control_state: str | None = None,
) -> dict[str, Any]:
    """Everything :func:`plot_cohort_fractions` shows: per-animal matrix, mean/SEM, tests."""
    wide = fractions.pivot(index="animal", columns="state", values="fraction_significant")
    states = list(states) if states is not None else list(wide.columns)
    if control_state is not None and control_state not in states:
        states.append(control_state)
    wide = wide[states]
    mat = wide.to_numpy(float)
    mean = wide.mean().to_numpy(float)
    sem = (
        wide.std(ddof=1).to_numpy(float) / np.sqrt(max(len(wide), 1))
        if len(wide) > 1
        else np.zeros(len(states))
    )
    finite = mat[np.isfinite(mat)]
    top = max(float(finite.max()), 0.05) if finite.size else 0.05
    comparisons: list[dict[str, Any]] = []
    if control_state is not None:
        ci = states.index(control_state)
        for i, s in enumerate(states):
            if s == control_state:
                continue
            res = compare_states_across_animals(fractions, s, control_state)
            comparisons.append(
                {
                    "state": str(s),
                    "x0": i,
                    "x1": ci,
                    "y": top * (1.05 + 0.08 * i),
                    "p_value": float(res["p_value"]),
                    "p_floor": float(res["p_floor"]),
                    "text": f"{fmt_p(res['p_value'])} (floor {res['p_floor']:.3g})",
                }
            )
    return {
        "kind": "cohort_fractions",
        "version": PLOT_DATA_VERSION,
        "animals": [str(a) for a in wide.index],
        "states": [str(s) for s in states],
        "fractions": mat,
        "mean": mean,
        "sem": sem,
        "top": top,
        "control_state": control_state,
        "comparisons": comparisons,
        "ylim_top": top * (1.2 + 0.08 * len(states)) if control_state is not None else None,
        "ylabel": "fraction of cells significant",
        "title": f"n = {len(wide)} animals",
    }


def plot_cohort_fractions(
    fractions: pd.DataFrame,
    states: Sequence[str] | None = None,
    control_state: str | None = None,
) -> Figure:
    """Per-animal fractions connected across states, with mean +/- SEM bars.

    Look for: consistent slopes across animals (grey lines) rather than a mean
    driven by one animal; with ``control_state`` the paired test p-value and its
    attainable floor are printed above each comparison.

    Parameters
    ----------
    fractions : pandas.DataFrame
        Output of ``fraction_significant_by_animal(..., by_state=True)`` for a single
        analysis.
    states : sequence of str, optional
        States to show on the x axis, in order; ``None`` uses all.
    control_state : str, optional
        State every other state is compared with using
        ``compare_states_across_animals``; appended to the axis if missing.

    Returns
    -------
    matplotlib.figure.Figure
    """
    d = plot_cohort_fractions_data(fractions, states, control_state)
    states = d["states"]
    x = np.arange(len(states))
    fig, ax = plt.subplots(figsize=(1.6 + 1.2 * len(states), 4), layout="constrained")
    for row in d["fractions"]:
        ax.plot(x, row, "-o", color="0.6", lw=1, ms=4, zorder=1)
    ax.errorbar(x, d["mean"], yerr=d["sem"], fmt="s", color="C0", capsize=5, ms=8, lw=2, zorder=3)
    for c in d["comparisons"]:
        ax.plot([c["x0"], c["x1"]], [c["y"], c["y"]], color="k", lw=1)
        ax.text((c["x0"] + c["x1"]) / 2, c["y"], c["text"], ha="center", va="bottom", fontsize=8)
    if d["ylim_top"] is not None:
        ax.set_ylim(0, d["ylim_top"])
    ax.set_xticks(x, states)
    ax.set_ylabel(d["ylabel"])
    ax.set_title(d["title"])
    return fig


def plot_hierarchical_bootstrap_data(boot: BootstrapResult) -> dict[str, Any]:
    """Everything :func:`plot_hierarchical_bootstrap` shows: CIs, means, estimate."""
    return {
        "kind": "hierarchical_bootstrap",
        "version": PLOT_DATA_VERSION,
        "rows": ["hierarchical\n(animal > cell)", "pooled cells\n(naive)"],
        "ci": [[float(v) for v in boot.ci], [float(v) for v in boot.naive_ci]],
        "mean": [float(boot.mean), float(boot.naive_mean)],
        "estimate": float(boot.estimate),
        "n_boot": int(boot.n_boot),
        "xlabel": "statistic (95% percentile CI)",
    }


def plot_hierarchical_bootstrap(boot: BootstrapResult) -> Figure:
    """Hierarchical vs naive pooled-cell bootstrap confidence intervals.

    Look for: the naive interval (orange) being narrower than the hierarchical one
    (blue), which shows how much animal-to-animal variability pooling cells hides.

    Parameters
    ----------
    boot : BootstrapResult
        Result of ``hierarchical_bootstrap``.

    Returns
    -------
    matplotlib.figure.Figure
        95 % percentile intervals with bootstrap means (dots) and the original
        estimate (dashed line).
    """
    d = plot_hierarchical_bootstrap_data(boot)
    fig, ax = plt.subplots(figsize=(5, 3), layout="constrained")
    for y, (ci, m, c) in enumerate(zip(d["ci"], d["mean"], ("C0", "C1"), strict=True)):
        ax.plot(ci, [y, y], color=c, lw=3)
        ax.plot([m], [y], "o", color=c)
    ax.axvline(d["estimate"], color="k", ls="--", lw=1, label="estimate")
    ax.set_yticks([0, 1], d["rows"])
    ax.set_ylim(-0.5, 1.5)
    ax.set_xlabel(d["xlabel"])
    ax.legend(fontsize=8)
    return fig
