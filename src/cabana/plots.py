"""All plotting functions in one namespace: ``cabana.plots.plot_rate_maps(...)``.

Every function returns a matplotlib ``Figure`` and never calls ``plt.show``.
"""

from __future__ import annotations

from ._plots import (
    plot_behavior_overview,
    plot_ground_truth_recovery,
    plot_metric_scatter,
    plot_population_matrix,
    plot_rate_maps,
    plot_shuffle_distribution,
    plot_tuning_heatmap,
)
from ._plots_cohort import plot_cohort_fractions, plot_cross_session, plot_hierarchical_bootstrap
from ._plots_events import plot_event_raster, plot_peth
from ._plots_information import (
    plot_decoded_trajectory,
    plot_information_comparison,
    plot_joint_histogram,
    plot_level_sweep,
)
from ._plots_posthoc import (
    plot_classification,
    plot_clusters,
    plot_overlap,
    plot_overlap_matrix,
)

__all__ = [
    "plot_behavior_overview",
    "plot_classification",
    "plot_clusters",
    "plot_cohort_fractions",
    "plot_cross_session",
    "plot_decoded_trajectory",
    "plot_event_raster",
    "plot_ground_truth_recovery",
    "plot_hierarchical_bootstrap",
    "plot_information_comparison",
    "plot_joint_histogram",
    "plot_level_sweep",
    "plot_metric_scatter",
    "plot_overlap",
    "plot_overlap_matrix",
    "plot_peth",
    "plot_population_matrix",
    "plot_rate_maps",
    "plot_shuffle_distribution",
    "plot_tuning_heatmap",
]
