"""Plots for cross-session and cohort analyses."""

from __future__ import annotations

from collections.abc import Sequence

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.figure import Figure

from ._cohort import BootstrapResult, compare_states_across_animals
from ._cross_session import CrossSessionResult

__all__ = ["plot_cohort_fractions", "plot_cross_session", "plot_hierarchical_bootstrap"]


def _fmt_p(p: float) -> str:
    return "p=nan" if not np.isfinite(p) else (f"p={p:.3g}" if p >= 0.001 else "p<0.001")


def plot_cross_session(cs: CrossSessionResult) -> Figure:
    """Observed r (histogram) with the null-median distribution, and r per pair/state."""
    fig, (ax, ax2) = plt.subplots(1, 2, figsize=(9, 3.6), layout="constrained")
    obs = cs.observed[np.isfinite(cs.observed)]
    bins = np.linspace(-1, 1, 31)
    ax.hist(obs, bins=bins, color="C0", alpha=0.7, label="observed r")
    nm = cs.null_median[np.isfinite(cs.null_median)]
    if nm.size:
        w = np.full(nm.size, max(len(obs), 1) / nm.size)
        ax.hist(nm, bins=bins, weights=w, color="0.5", alpha=0.6, label="null median r (scaled)")
    if np.isfinite(cs.median_observed):
        ax.axvline(cs.median_observed, color="C3", lw=2, label=f"median {cs.median_observed:.2f}")
    ax.set_xlabel("Pearson r")
    ax.set_ylabel("count")
    ax.set_title(f"{_fmt_p(cs.p_population)} (population)")
    ax.legend(fontsize=8)
    x = np.arange(cs.observed.shape[0])
    ax2.scatter(x, cs.observed, c=np.where(cs.significant, "C0", "0.6"), s=14)
    ax2.axhline(0, color="k", lw=0.5)
    ax2.set_xlabel("matched pair" if cs.kind == "map" else "state")
    ax2.set_ylabel("Pearson r")
    ax2.set_title("significant in blue")
    return fig


def plot_cohort_fractions(
    fractions: pd.DataFrame,
    states: Sequence[str] | None = None,
    control_state: str | None = None,
) -> Figure:
    """Per-animal fractions connected across states, with mean +/- SEM bars."""
    wide = fractions.pivot(index="animal", columns="state", values="fraction_significant")
    states = list(states) if states is not None else list(wide.columns)
    if control_state is not None and control_state not in states:
        states.append(control_state)
    wide = wide[states]
    x = np.arange(len(states))
    fig, ax = plt.subplots(figsize=(1.6 + 1.2 * len(states), 4), layout="constrained")
    for _, row in wide.iterrows():
        ax.plot(x, row.to_numpy(), "-o", color="0.6", lw=1, ms=4, zorder=1)
    mean = wide.mean().to_numpy()
    sem = wide.std(ddof=1).to_numpy() / np.sqrt(max(len(wide), 1)) if len(wide) > 1 else np.zeros(len(x))
    ax.errorbar(x, mean, yerr=sem, fmt="s", color="C0", capsize=5, ms=8, lw=2, zorder=3)
    top = float(np.nanmax(wide.to_numpy())) if wide.size else 1.0
    if control_state is not None:
        ci = states.index(control_state)
        for i, s in enumerate(states):
            if s == control_state:
                continue
            res = compare_states_across_animals(fractions, s, control_state)
            y = top * (1.05 + 0.08 * i)
            ax.plot([i, ci], [y, y], color="k", lw=1)
            ax.text((i + ci) / 2, y, f"{_fmt_p(res['p_value'])} (floor {res['p_floor']:.3g})",
                    ha="center", va="bottom", fontsize=8)
        ax.set_ylim(0, top * (1.2 + 0.08 * len(states)))
    ax.set_xticks(x, states)
    ax.set_ylabel("fraction of cells significant")
    ax.set_title(f"n = {len(wide)} animals")
    return fig


def plot_hierarchical_bootstrap(boot: BootstrapResult) -> Figure:
    """Hierarchical vs naive pooled-cell bootstrap confidence intervals."""
    fig, ax = plt.subplots(figsize=(5, 3), layout="constrained")
    for y, (ci, m, c) in enumerate(
        [(boot.ci, boot.mean, "C0"), (boot.naive_ci, boot.naive_mean, "C1")]
    ):
        ax.plot(ci, [y, y], color=c, lw=3)
        ax.plot([m], [y], "o", color=c)
    ax.axvline(boot.estimate, color="k", ls="--", lw=1, label="estimate")
    ax.set_yticks([0, 1], ["hierarchical\n(animal > cell)", "pooled cells\n(naive)"])
    ax.set_ylim(-0.5, 1.5)
    ax.set_xlabel("statistic (95% percentile CI)")
    ax.legend(fontsize=8)
    return fig
