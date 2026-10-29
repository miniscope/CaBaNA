"""Plots for results-level analyses (overlap and clustering)."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.figure import Figure
from matplotlib.patches import Circle

from ._data import PLOT_DATA_VERSION
from ._style import fmt_p
from .._posthoc import ClusterResult, OverlapResult

__all__ = [
    "plot_classification",
    "plot_classification_data",
    "plot_clusters",
    "plot_clusters_data",
    "plot_overlap",
    "plot_overlap_data",
    "plot_overlap_matrix",
    "plot_overlap_matrix_data",
]


def _stars(p: float) -> str:
    return "***" if p < 0.001 else "**" if p < 0.01 else "*" if p < 0.05 else ""


def plot_overlap_data(overlap: OverlapResult, labels: Sequence[str] = ("A", "B")) -> dict[str, Any]:
    """Everything :func:`plot_overlap` shows: bar heights, annotation text, Venn geometry."""
    ra, rb = float(np.sqrt(max(overlap.n_a, 1))), float(np.sqrt(max(overlap.n_b, 1)))
    # place centres so the overlap area roughly matches n_both (crude)
    frac = overlap.n_both / max(min(overlap.n_a, overlap.n_b), 1)
    d = (ra + rb) * (1 - 0.85 * frac) if frac > 0 else ra + rb
    return {
        "kind": "overlap",
        "version": PLOT_DATA_VERSION,
        "bar_labels": ["expected", "observed"],
        "bar_values": [float(overlap.expected), float(overlap.n_both)],
        "odds_ratio": float(overlap.odds_ratio),
        "p_value": float(overlap.p_value),
        "annotation": f"OR={overlap.odds_ratio:.2f}, {fmt_p(overlap.p_value)}",
        "ylabel": "cells in both sets",
        "labels": [str(labels[0]), str(labels[1])],
        "n_a": int(overlap.n_a),
        "n_b": int(overlap.n_b),
        "n_both": int(overlap.n_both),
        "venn": {"x_a": -d / 2, "x_b": d / 2, "r_a": ra, "r_b": rb},
    }


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
    d = plot_overlap_data(overlap, labels)
    if ax is None:
        fig, (ax_bar, ax_v) = plt.subplots(1, 2, figsize=(8, 3.6), layout="constrained")
    else:
        fig, ax_bar, ax_v = ax.figure, ax, None
    ax_bar.bar(d["bar_labels"], d["bar_values"], color=["0.7", "C0"])
    top = max(*d["bar_values"], 1)
    ax_bar.text(0.5, 0.97, d["annotation"], transform=ax_bar.transAxes, ha="center", va="top")
    ax_bar.set_ylim(0, top * 1.25)
    ax_bar.set_ylabel(d["ylabel"])
    if ax_v is not None:
        v = d["venn"]
        ra, rb, x_a, x_b = v["r_a"], v["r_b"], v["x_a"], v["x_b"]
        ax_v.add_patch(Circle((x_a, 0), ra, color="C0", alpha=0.4))
        ax_v.add_patch(Circle((x_b, 0), rb, color="C1", alpha=0.4))
        ax_v.text(x_a - ra * 0.5, 0, f"{d['n_a'] - d['n_both']}", ha="center", va="center")
        ax_v.text(x_b + rb * 0.5, 0, f"{d['n_b'] - d['n_both']}", ha="center", va="center")
        ax_v.text(
            (x_a + ra + x_b - rb) / 2,
            0,
            f"{d['n_both']}",
            ha="center",
            va="center",
            weight="bold",
        )
        ax_v.text(x_a, -ra * 1.15, d["labels"][0], ha="center", va="top")
        ax_v.text(x_b, -rb * 1.15, d["labels"][1], ha="center", va="top")
        lim = max(abs(x_a) + ra, abs(x_b) + rb) * 1.2
        ax_v.set_xlim(-lim, lim)
        ax_v.set_ylim(-lim, lim)
        ax_v.set_aspect("equal")
        ax_v.axis("off")
    return fig


def plot_overlap_matrix_data(df: pd.DataFrame) -> dict[str, Any]:
    """Everything :func:`plot_overlap_matrix` shows: names, log2 OR, annotations, p matrix."""
    names = [str(s) for s in dict.fromkeys(list(df["set_a"]) + list(df["set_b"]))]
    n = len(names)
    idx = {s: i for i, s in enumerate(names)}
    lor = np.full((n, n), np.nan)
    pmat = np.full((n, n), np.nan)
    ann = [[""] * n for _ in range(n)]
    for r in df.itertuples():
        i, j = idx[str(r.set_a)], idx[str(r.set_b)]
        orr = float(r.odds_ratio)
        v = np.log2(orr) if np.isfinite(orr) and orr > 0 else np.nan
        for a, b in ((i, j), (j, i)):
            lor[a, b] = v
            pmat[a, b] = float(r.p_value)
            ann[a][b] = f"{orr:.2g}{_stars(float(r.p_value))}"
    finite = lor[np.isfinite(lor)]
    vmax = max(float(np.abs(finite).max()), 1e-6) if finite.size else 1.0
    return {
        "kind": "overlap_matrix",
        "version": PLOT_DATA_VERSION,
        "names": names,
        "log2_odds_ratio": lor,
        "p_value": pmat,
        "annotations": ann,
        "vmax": vmax,
        "colorbar_label": "log2 odds ratio",
    }


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
    d = plot_overlap_matrix_data(df)
    if ax is None:
        fig, ax = plt.subplots(figsize=(5.5, 4.5), layout="constrained")
    else:
        fig = ax.figure
    names, ann = d["names"], d["annotations"]
    n = len(names)
    im = ax.imshow(d["log2_odds_ratio"], cmap="RdBu_r", vmin=-d["vmax"], vmax=d["vmax"])
    for i in range(n):
        for j in range(n):
            if ann[i][j]:
                ax.text(j, i, ann[i][j], ha="center", va="center", fontsize=8)
    ax.set_xticks(range(n), names, rotation=45, ha="right")
    ax.set_yticks(range(n), names)
    fig.colorbar(im, ax=ax, label=d["colorbar_label"])
    return fig


def plot_clusters_data(
    cluster_result: ClusterResult, feature_names: Sequence[str] | None = None
) -> dict[str, Any]:
    """Everything :func:`plot_clusters` shows: cluster means, sizes, labels, score-vs-k."""
    cr = cluster_result
    m = np.asarray(cr.cluster_means, float)
    sizes = [int((cr.labels == c).sum()) for c in range(m.shape[0])]
    ks = sorted(cr.scores)
    use_names = feature_names is not None and len(feature_names) == m.shape[1]
    return {
        "kind": "clusters",
        "version": PLOT_DATA_VERSION,
        "cluster_means": m,
        "vmax": max(float(np.nanmax(np.abs(m))), 1e-6),
        "sizes": sizes,
        "row_labels": [f"C{c} (n={s})" for c, s in enumerate(sizes)],
        "feature_names": [str(f) for f in feature_names] if use_names else None,
        "colorbar_label": "mean feature",
        "k": int(cr.k),
        "ks": [int(k) for k in ks],
        "scores": [float(cr.scores[k]) for k in ks],
        "selection": str(cr.selection),
    }


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
    d = plot_clusters_data(cluster_result, feature_names)
    if ax is None:
        fig, (ax_h, ax_s) = plt.subplots(
            1, 2, figsize=(9, 3.8), layout="constrained", gridspec_kw={"width_ratios": [3, 1.3]}
        )
    else:
        fig, ax_h, ax_s = ax.figure, ax, None
    m = d["cluster_means"]
    im = ax_h.imshow(m, aspect="auto", cmap="RdBu_r", vmin=-d["vmax"], vmax=d["vmax"])
    ax_h.set_yticks(range(m.shape[0]), d["row_labels"])
    if d["feature_names"] is not None:
        ax_h.set_xticks(range(m.shape[1]), d["feature_names"], rotation=60, ha="right", fontsize=7)
    fig.colorbar(im, ax=ax_h, label=d["colorbar_label"])
    if ax_s is not None:
        ax_s.plot(d["ks"], d["scores"], "o-")
        ax_s.axvline(d["k"], color="0.6", ls="--")
        ax_s.set_xlabel("k")
        ax_s.set_ylabel(d["selection"])
    return fig


def plot_classification_data(classification: Any) -> dict[str, Any]:
    """Everything :func:`plot_classification` shows: class names, counts, fractions."""
    counts = classification.counts()
    fr = classification.fractions()
    names = [str(k) for k in counts]
    return {
        "kind": "classification",
        "version": PLOT_DATA_VERSION,
        "names": names,
        "counts": [int(counts[k]) for k in counts],
        "fractions": [float(fr[k]) for k in counts],
        "unclassified": [k == "unclassified" for k in names],
        "n_cells": int(classification.n_cells),
        "xlabel": f"cells (of {classification.n_cells})",
    }


def plot_classification(classification: Any, ax: Any = None) -> Figure:
    """Horizontal bars of cell counts per class, annotated with fractions.

    Parameters
    ----------
    classification : ClassificationResult
        Output of :func:`cabana.classify`; an ``"unclassified"`` bar appears when
        it was run with ``exclusive=True``.
    ax : matplotlib Axes, optional
        Draw on it; otherwise a new figure.

    Returns
    -------
    matplotlib.figure.Figure
        Look for: classes with very few cells (low power) and, when not exclusive,
        bars that sum to more than the cell count (overlapping classes).
    """
    d = plot_classification_data(classification)
    names, counts = d["names"], d["counts"]
    if ax is None:
        _, ax = plt.subplots(figsize=(5, 0.45 * len(names) + 1.2))
    fig = ax.figure
    y = np.arange(len(names))
    colors = ["0.6" if u else "C0" for u in d["unclassified"]]
    ax.barh(y, counts, color=colors)
    for yi, c, f in zip(y, counts, d["fractions"], strict=True):
        ax.text(c, yi, f" {c} ({f:.0%})", va="center")
    ax.set_yticks(y, names)
    ax.invert_yaxis()
    ax.set_xlabel(d["xlabel"])
    ax.set_xlim(0, max(max(counts, default=0), 1) * 1.25)
    return fig
