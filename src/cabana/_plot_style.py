"""Shared visual conventions for every CaBaNA figure.

Every renderer in ``cabana.plots`` draws with the same rules so that a figure
from one analysis reads like a figure from another:

* **one palette** -- :data:`OKABE_ITO` (colour-blind safe) for up to eight
  states, ``tab20`` beyond that, and a warning above :data:`MAX_STATE_COLORS`
  states because no categorical palette stays readable there.
* **one significance marker** -- :data:`SIGNIFICANCE_MARKER`, drawn by
  :func:`mark_significant`; nothing else uses a white dot with a black edge.
* **unit-bearing labels** -- :func:`axis_label` and :func:`metric_label` put
  the unit in parentheses after the quantity, or omit it when dimensionless.
* **one p-value format** -- :func:`fmt_p` writes ``p<0.001`` or ``p=0.023`` and
  says when a value sits at the resolution floor of the shuffle test.

``use_style()`` is a context manager around :func:`matplotlib.rc_context`; the
registry dispatcher (``cabana.plots.plot`` / ``plot_all``) wraps every render
in it, and a user can do the same around a direct call.
"""

from __future__ import annotations

import warnings
from collections.abc import Iterable, Sequence
from contextlib import contextmanager
from functools import lru_cache
from typing import Any

import matplotlib as mpl
import matplotlib.pyplot as plt
import numpy as np

__all__ = [
    "MAX_STATE_COLORS",
    "METRIC_LABELS",
    "OKABE_ITO",
    "SIGNIFICANCE_MARKER",
    "axis_label",
    "fmt_p",
    "heatmap_cmap",
    "mark_significant",
    "metric_label",
    "state_colors",
    "use_style",
]

#: Okabe & Ito (2008) colour-blind-safe palette, black excluded.
OKABE_ITO: tuple[str, ...] = (
    "#E69F00",  # orange
    "#56B4E9",  # sky blue
    "#009E73",  # bluish green
    "#F0E442",  # yellow
    "#0072B2",  # blue
    "#D55E00",  # vermilion
    "#CC79A7",  # reddish purple
    "#999999",  # grey
)

#: Above this many states a categorical palette is no longer readable.
MAX_STATE_COLORS = 20

#: The one way a significant cell / state is marked on any CaBaNA figure.
SIGNIFICANCE_MARKER: dict[str, Any] = {
    "marker": "o",
    "s": 10,
    "c": "white",
    "edgecolors": "black",
    "linewidths": 0.5,
    "zorder": 5,
}

#: Colours with a fixed meaning across figures.
OBSERVED_COLOR = "#D55E00"  # the observed statistic (vermilion)
NULL_COLOR = "0.70"  # null distribution / chance
BASELINE_SHADE = "0.85"  # baseline window shading
RESPONSE_SHADE = "#E69F00"  # response window shading
UNVISITED_COLOR = "0.92"  # NaN bins in a rate map (never visited / below min occupancy)

#: Human label and unit for each built-in metric (``None`` = dimensionless).
METRIC_LABELS: dict[str, tuple[str, str | None]] = {
    "information_content": ("spatial information", "bits/event"),
    "mutual_information": ("mutual information", "bits"),
    "auroc": ("auROC", None),
    "mean_per_state": ("mean activity", "a.u."),
    "split_half_stability": ("split-half r", None),
    "signal_correlation": ("correlation r", None),
    "signal_tuning": ("tuning", None),
    "peth": ("response", "a.u."),
    "glm_encoding": ("unique contribution", "ΔLL"),
    "population_vector_overlap": ("PV overlap", None),
    "pv_stability": ("PV correlation", None),
    "pca_population": ("PC distance", None),
    "population_distance": ("distance", None),
    "decode_states": ("accuracy", None),
    "bayesian_decoder": ("decoding error", None),
}

_RC: dict[str, Any] = {
    "figure.dpi": 100,
    "savefig.dpi": 130,
    "font.size": 9,
    "axes.titlesize": 10,
    "axes.labelsize": 9,
    "xtick.labelsize": 8,
    "ytick.labelsize": 8,
    "legend.fontsize": 8,
    "legend.frameon": False,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.prop_cycle": mpl.cycler(color=list(OKABE_ITO)),
    "image.cmap": "viridis",
    "figure.constrained_layout.use": True,
}


@contextmanager
def use_style():
    """Apply the CaBaNA matplotlib style inside a ``with`` block.

    Examples
    --------
    >>> with use_style():
    ...     fig = plot_rate_maps(session, result, cells)  # doctest: +SKIP
    """
    with mpl.rc_context(_RC):
        yield


@lru_cache(maxsize=256)
def _palette(names: tuple[str, ...]) -> tuple[tuple[float, float, float, float], ...]:
    n = len(names)
    if n <= len(OKABE_ITO):
        return tuple(mpl.colors.to_rgba(c) for c in OKABE_ITO[:n])
    if n > MAX_STATE_COLORS:
        warnings.warn(
            f"{n} states is more than {MAX_STATE_COLORS}; categorical colours will not be "
            "distinguishable. Prefer a grid/heatmap view for this state space.",
            UserWarning,
            stacklevel=3,
        )
        cm = plt.get_cmap("viridis")
        return tuple(cm(i / max(n - 1, 1)) for i in range(n))
    cm = plt.get_cmap("tab20")
    return tuple(cm(i % cm.N) for i in range(n))


def state_colors(space_or_names: Any) -> dict[str, tuple[float, float, float, float]]:
    """Colour per state name, the same every time for the same names.

    Parameters
    ----------
    space_or_names : StateSpace or sequence of str
        A ``StateSpace`` (its ``state_names`` are used) or the names themselves.

    Returns
    -------
    dict[str, RGBA]
        Okabe-Ito for up to eight states, ``tab20`` up to twenty, a sampled
        ``viridis`` with a warning beyond that.  Memoised on the tuple of names.
    """
    names = getattr(space_or_names, "state_names", space_or_names)
    key = tuple(str(n) for n in names)
    return dict(zip(key, _palette(key), strict=True))


def heatmap_cmap(name: str = "viridis", bad: Any = UNVISITED_COLOR) -> Any:
    """A colormap whose NaN ("bad") colour is :data:`UNVISITED_COLOR`.

    Every image of binned data (rate maps, tuning matrices, confusion maps) uses
    this so that bins with no data look the same everywhere and are never drawn
    as zero.
    """
    return plt.get_cmap(name).with_extremes(bad=bad)


def axis_label(quantity: str, units: str | None = None) -> str:
    """``"speed (cm/s)"`` from ``("speed", "cm/s")``; ``"speed"`` when units are empty."""
    return f"{quantity} ({units})" if units else quantity


def metric_label(metric: str, params: dict[str, Any] | None = None) -> str:
    """Axis label for a metric name, e.g. ``"spatial information (bits/event)"``.

    Unknown (user-plugin) metrics fall back to the registry name.  ``params`` lets
    the label follow a parameter that changes the unit (``information_content`` in
    bits/s when ``per_second`` is set; ``signal_tuning`` with ``statistic``).
    """
    label, units = METRIC_LABELS.get(metric, (metric.replace("_", " "), None))
    params = params or {}
    if metric in ("information_content", "mutual_information"):
        u = params.get("units")
        if u == "bits_per_second":
            units = "bits/s"
        elif u == "bits_per_event":
            units = "bits/event"
    if metric == "signal_tuning" and params.get("statistic"):
        label = f"tuning ({params['statistic']})"
    return axis_label(label, units)


def fmt_p(p: float, n_shuffles: int | None = None, tail: str | None = None) -> str:
    """``"p=0.023"``, ``"p<0.001"``, or ``"p=0.001 (floor)"`` when at the shuffle floor.

    The smallest p a permutation test with ``n`` surrogates can report is
    ``1/(n+1)`` (two-tailed ``2/(n+1)``); a value there means "none of the
    surrogates reached the observed value", not a precise probability.
    """
    if p is None or not np.isfinite(p):
        return "p=nan"
    p = float(p)
    txt = f"p={p:.3g}" if p >= 0.001 else "p<0.001"
    if n_shuffles:
        floor = (2.0 if tail == "two" else 1.0) / (n_shuffles + 1)
        if p <= floor * (1 + 1e-9):
            txt += " (floor)"
    return txt


def mark_significant(ax: Any, x: Iterable[float], y: Iterable[float], **kw: Any) -> Any:
    """Draw the shared significance marker at the given positions.

    Parameters
    ----------
    ax : matplotlib Axes
    x, y : iterable of float
        Positions in data coordinates.
    **kw
        Overrides for :data:`SIGNIFICANCE_MARKER` (e.g. ``s=20``).

    Returns
    -------
    matplotlib PathCollection
    """
    x = np.asarray(list(x), float)
    y = np.asarray(list(y), float)
    opts = {**SIGNIFICANCE_MARKER, **kw}
    if "label" not in opts:
        opts["label"] = "significant"
    return ax.scatter(x, y, **opts)


def ordered_names(names: Sequence[str] | None, n: int) -> list[str]:
    """``names`` as strings, or ``"0".."n-1"`` when ``None``."""
    return [str(s) for s in names] if names is not None else [str(i) for i in range(n)]
