"""Plots for results-level analyses (overlap and clustering)."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.figure import Figure
from matplotlib.patches import Circle

from ._plots import _fmt_p
from ._posthoc import ClusterResult, OverlapResult

__all__ = ["plot_clusters", "plot_overlap", "plot_overlap_matrix"]


def _stars(p: float) -> str:
    return "***" if p < 0.001 else "**" if p < 0.01 else "*" if p < 0.05 else ""


def plot_overlap(
    overlap: OverlapResult, labels: Sequence[str] = ("A", "B"), ax: Any = None
) -> Figure:
    """Observed vs expected overlap bars plus an approximate two-circle Venn.

    With ``ax`` given only the bar panel is drawn on it.  Look for: observed
    overlap well above the grey expected bar (odds ratio above 1) means the two cell
    sets share more cells than independence predicts.

    Parameters
    ----------
    overlap : OverlapResult
        Result of ``overlap_vs_chance``.
    labels : (str, str), default ("A", "B")
        Names of the two sets, shown under the Venn circles.
    ax : matplotlib Axes, optional
        Draw only the bar panel here; otherwise a two-panel figure is made.

    Returns
    -------
    matplotlib.figure.Figure
    """
    if ax is None:
        fig, (ax_bar, ax_v) = plt.subplots(1, 2, figsize=(8, 3.6), layout="constrained")
    else:
        fig, ax_bar, ax_v = ax.figure, ax, None
    ax_bar.bar(["expected", "observed"], [overlap.expected, overlap.n_both], color=["0.7", "C0"])
    top = max(overlap.expected, overlap.n_both, 1)
    ax_bar.text(
        0.5,
        0.97,
        f"OR={overlap.odds_ratio:.2f}, {_fmt_p(overlap.p_value)}",
        transform=ax_bar.transAxes,
        ha="center",
        va="top",
    )
    ax_bar.set_ylim(0, top * 1.25)
    ax_bar.set_ylabel("cells in both sets")
    if ax_v is not None:
        ra, rb = np.sqrt(max(overlap.n_a, 1)), np.sqrt(max(overlap.n_b, 1))
        # place centres so the overlap area roughly matches n_both (crude)
        frac = overlap.n_both / max(min(overlap.n_a, overlap.n_b), 1)
        d = (ra + rb) * (1 - 0.85 * frac) if frac > 0 else ra + rb
        x_a, x_b = -d / 2, d / 2
        ax_v.add_patch(Circle((x_a, 0), ra, color="C0", alpha=0.4))
        ax_v.add_patch(Circle((x_b, 0), rb, color="C1", alpha=0.4))
        ax_v.text(x_a - ra * 0.5, 0, f"{overlap.n_a - overlap.n_both}", ha="center", va="center")
        ax_v.text(x_b + rb * 0.5, 0, f"{overlap.n_b - overlap.n_both}", ha="center", va="center")
        ax_v.text(
            (x_a + ra + x_b - rb) / 2,
            0,
            f"{overlap.n_both}",
            ha="center",
            va="center",
            weight="bold",
        )
        ax_v.text(x_a, -ra * 1.15, labels[0], ha="center", va="top")
        ax_v.text(x_b, -rb * 1.15, labels[1], ha="center", va="top")
        lim = max(abs(x_a) + ra, abs(x_b) + rb) * 1.2
        ax_v.set_xlim(-lim, lim)
        ax_v.set_ylim(-lim, lim)
        ax_v.set_aspect("equal")
        ax_v.axis("off")
    return fig


def plot_overlap_matrix(df: pd.DataFrame, ax: Any = None) -> Figure:
    """Heatmap of log2 odds ratio (annotated with OR) with significance stars.

    Look for: red cells (more overlap than chance) and blue (less); stars mark
    ``p < 0.05``, ``0.01`` and ``0.001``.  The matrix is symmetric.

    Parameters
    ----------
    df : pandas.DataFrame
        Output of ``overlap_matrix`` (needs ``set_a``, ``set_b``, ``odds_ratio``,
        ``p_value``).
    ax : matplotlib Axes, optional
        Axes to draw into; a new figure is created if omitted.

    Returns
    -------
    matplotlib.figure.Figure
    """
    if ax is None:
        fig, ax = plt.subplots(figsize=(5.5, 4.5), layout="constrained")
    else:
        fig = ax.figure
    names = list(dict.fromkeys(list(df["set_a"]) + list(df["set_b"])))
    n = len(names)
    idx = {s: i for i, s in enumerate(names)}
    lor = np.full((n, n), np.nan)
    ann = [[""] * n for _ in range(n)]
    for r in df.itertuples():
        i, j = idx[r.set_a], idx[r.set_b]
        orr = r.odds_ratio
        v = np.log2(orr) if np.isfinite(orr) and orr > 0 else np.nan
        for a, b in ((i, j), (j, i)):
            lor[a, b] = v
            ann[a][b] = f"{orr:.2g}{_stars(r.p_value)}"
    finite = lor[np.isfinite(lor)]
    vmax = max(float(np.abs(finite).max()), 1e-6) if finite.size else 1.0
    im = ax.imshow(lor, cmap="RdBu_r", vmin=-vmax, vmax=vmax)
    for i in range(n):
        for j in range(n):
            if ann[i][j]:
                ax.text(j, i, ann[i][j], ha="center", va="center", fontsize=8)
    ax.set_xticks(range(n), names, rotation=45, ha="right")
    ax.set_yticks(range(n), names)
    fig.colorbar(im, ax=ax, label="log2 odds ratio")
    return fig


def plot_clusters(
    cluster_result: ClusterResult, feature_names: Sequence[str] | None = None, ax: Any = None
) -> Figure:
    """Heatmap of cluster means (rows labelled with sizes) and score-vs-k panel.

    With ``ax`` given only the heatmap is drawn on it.  Look for: clusters with
    distinct feature patterns (red / blue rows), and a clear optimum of the score
    in the right panel.

    Parameters
    ----------
    cluster_result : ClusterResult
        Result of ``response_clusters``.
    feature_names : sequence of str, optional
        Column labels, e.g. the names returned by ``response_features``; used only
        when their number matches the feature count.
    ax : matplotlib Axes, optional
        Draw only the heatmap here; otherwise a heatmap and score-vs-k figure is made.

    Returns
    -------
    matplotlib.figure.Figure
    """
    cr = cluster_result
    if ax is None:
        fig, (ax_h, ax_s) = plt.subplots(
            1, 2, figsize=(9, 3.8), layout="constrained", gridspec_kw={"width_ratios": [3, 1.3]}
        )
    else:
        fig, ax_h, ax_s = ax.figure, ax, None
    m = cr.cluster_means
    vmax = max(float(np.nanmax(np.abs(m))), 1e-6)
    im = ax_h.imshow(m, aspect="auto", cmap="RdBu_r", vmin=-vmax, vmax=vmax)
    sizes = [int((cr.labels == c).sum()) for c in range(m.shape[0])]
    ax_h.set_yticks(range(m.shape[0]), [f"C{c} (n={s})" for c, s in enumerate(sizes)])
    if feature_names is not None and len(feature_names) == m.shape[1]:
        ax_h.set_xticks(range(m.shape[1]), list(feature_names), rotation=60, ha="right", fontsize=7)
    fig.colorbar(im, ax=ax_h, label="mean feature")
    if ax_s is not None:
        ks = sorted(cr.scores)
        ax_s.plot(ks, [cr.scores[q] for q in ks], "o-")
        ax_s.axvline(cr.k, color="0.6", ls="--")
        ax_s.set_xlabel("k")
        ax_s.set_ylabel(cr.selection)
    return fig
