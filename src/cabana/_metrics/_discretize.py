"""Discretising activity amplitude into levels (shared helper, not a plugin).

Rate-map metrics collapse a cell's activity in a state to its mean.  Metrics
that look at the *distribution* of amplitude per state (mutual information,
empirical-likelihood Bayesian decoding) first map every frame of every cell
to an integer level ``0..n_levels-1``; the joint ``(n_states, n_levels)``
histogram per cell is then one indicator matmul per level, so it rides the
same ``shifted_sums`` fast path as every other metric.

Conventions
-----------
* Edges are computed per cell on the *masked, unshifted* frames and reused
  for every surrogate, so observed and null are binned identically.
* For non-negative activity (deconvolved events, spike counts) level 0 is
  exactly zero ("silent") and the remaining levels split the positive
  values.  Deconvolved traces are mostly zero, so a bin of their own is the
  only way the other levels carry any mass.
* ``quantile`` edges give equal marginal mass per positive level; ``log`` and
  ``linear`` space the edges in amplitude.  ``binary`` is ``activity > 0``.
* Frames whose activity is NaN get level ``-1`` and fall out of every
  indicator, i.e. they are treated as unobserved.
"""

from __future__ import annotations

from typing import Literal

import numpy as np

from .._models import StateSpace
from .._kernels import (
    activity_levels,
    joint_counts,
    level_edges,
    level_indicator,
)
from .._statesums import shifted_sums_for

Binning = Literal["quantile", "log", "linear", "binary"]


def joint_counts_for(
    levels: np.ndarray,
    states: StateSpace,
    mask: np.ndarray,
    n_levels: int,
    *,
    keep: np.ndarray | None = None,
) -> np.ndarray:
    """Unshifted ``(n_cells, n_states_kept, n_levels)`` joint counts for a ``StateSpace``.

    Same values as ``joint_counts(levels, states.masked(mask)[:, keep], n_levels)``
    but exclusive spaces use integer labels instead of a dense float matrix.
    """
    sh = np.zeros(1, dtype=np.int64)
    return np.stack(
        [
            shifted_sums_for(level_indicator(levels, k), states, mask, sh, keep=keep)[0]
            for k in range(n_levels)
        ],
        axis=-1,
    )


__all__ = [
    "Binning",
    "activity_levels",
    "joint_counts",
    "joint_counts_for",
    "level_edges",
    "level_indicator",
]
