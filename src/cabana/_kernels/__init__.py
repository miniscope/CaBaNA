"""Pure numerical kernels (numpy only), the part of CaBaNA a Rust/WASM port reproduces.

Plain-array signatures, no pydantic, no registry, no RNG: shifts are explicit
``int64 (n_shifts,)`` inputs.  State input is ``labels: int32 (n_time,)`` with
``-1`` = "no state" plus ``n_states`` (or a dense ``onehot (n_time, n_states)``
for non-exclusive spaces, in the ``*_onehot`` / matmul kernels).  Only
``numpy`` may be imported here (``_smooth.py`` additionally ``scipy.ndimage``);
``tests/test_kernels.py`` enforces this.
"""

from __future__ import annotations

from ._label import component_stats, label_components
from ._levels import (
    activity_levels,
    joint_counts,
    level_edges,
    level_indicator,
    mutual_information_from_counts,
)
from ._ratemap import (
    contiguous_folds,
    rate_map,
    skaggs_information,
    split_half_masks,
    valid_states,
)
from ._rank import (
    auroc_from_rank_sums,
    average_ranks,
    dense_ranks,
    masked_rank_sums_one_shift,
)
from ._smooth import smooth_grid
from ._sums import (
    masked_counts,
    masked_counts_onehot,
    shifted_label_sums,
    shifted_sums,
)

__all__ = [
    "activity_levels",
    "auroc_from_rank_sums",
    "average_ranks",
    "component_stats",
    "contiguous_folds",
    "dense_ranks",
    "joint_counts",
    "label_components",
    "level_edges",
    "level_indicator",
    "masked_counts",
    "masked_counts_onehot",
    "masked_rank_sums_one_shift",
    "mutual_information_from_counts",
    "rate_map",
    "shifted_label_sums",
    "shifted_sums",
    "skaggs_information",
    "smooth_grid",
    "split_half_masks",
    "valid_states",
]
