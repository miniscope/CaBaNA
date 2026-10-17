"""All plotting functions in one namespace: ``cabana.plots.plot_rate_maps(...)``.

Every ``plot_<x>`` function returns a matplotlib ``Figure`` and never calls
``plt.show``.  Each has a companion ``plot_<x>_data(...) -> dict`` holding
everything the figure shows (arrays, labels, units, colours, significance) with
no matplotlib in it; the renderer draws from that dict alone.  ``to_json`` turns
such a dict into strict JSON for other front ends (CaLab).

Dispatch without naming a function: ``plot(result, session)`` / ``result.plot(session)``
draws the metric's first default figure; ``plot_all(resultset, session, out_dir=...)``
writes every default figure of every result.  ``use_style()`` is the shared look.
"""

from __future__ import annotations

from ._plot_data import PLOT_DATA_VERSION, check_plot_data, from_json, to_json
from ._plot_registry import (
    PlotSpec,
    available_plots,
    plot,
    plot_all,
    plot_spec,
    plots_for,
    register_plot,
    save_figures,
)
from ._plot_style import (
    METRIC_LABELS,
    OKABE_ITO,
    SIGNIFICANCE_MARKER,
    axis_label,
    fmt_p,
    mark_significant,
    metric_label,
    state_colors,
    use_style,
)

from ._plots import (
    plot_behavior_overview,
    plot_behavior_overview_data,
    plot_ground_truth_recovery,
    plot_ground_truth_recovery_data,
    plot_metric_scatter,
    plot_metric_scatter_data,
    plot_metric_strip,
    plot_metric_strip_data,
    plot_population_matrix,
    plot_population_matrix_data,
    plot_rate_maps,
    plot_rate_maps_data,
    plot_shuffle_distribution,
    plot_shuffle_distribution_data,
    plot_split_half_maps,
    plot_split_half_maps_data,
    plot_tuning_heatmap,
    plot_tuning_heatmap_data,
)
from ._plots_cohort import (
    plot_cohort_fractions,
    plot_cohort_fractions_data,
    plot_cross_session,
    plot_cross_session_data,
    plot_hierarchical_bootstrap,
    plot_hierarchical_bootstrap_data,
)
from ._plots_events import plot_event_raster, plot_event_raster_data, plot_peth, plot_peth_data
from ._plots_information import (
    plot_decoded_trajectory,
    plot_decoded_trajectory_data,
    plot_information_comparison,
    plot_information_comparison_data,
    plot_joint_histogram,
    plot_joint_histogram_data,
    plot_level_sweep,
    plot_level_sweep_data,
)
from ._plots_posthoc import (
    plot_classification,
    plot_classification_data,
    plot_clusters,
    plot_clusters_data,
    plot_overlap,
    plot_overlap_data,
    plot_overlap_matrix,
    plot_overlap_matrix_data,
)
from ._plots_sweep import (
    plot_sweep,
    plot_sweep_data,
    plot_sweep_gallery,
    plot_sweep_gallery_data,
    plot_sweep_stability,
    plot_sweep_stability_data,
)
from ._plots_views import (
    plot_activity_raster,
    plot_activity_raster_data,
    plot_analysis_agreement,
    plot_analysis_agreement_data,
    plot_population_tuning,
    plot_population_tuning_data,
    plot_session_qa,
    plot_session_qa_data,
)

__all__ = [
    "METRIC_LABELS",
    "OKABE_ITO",
    "PLOT_DATA_VERSION",
    "PlotSpec",
    "SIGNIFICANCE_MARKER",
    "available_plots",
    "axis_label",
    "check_plot_data",
    "fmt_p",
    "from_json",
    "mark_significant",
    "metric_label",
    "plot",
    "plot_all",
    "plot_spec",
    "plots_for",
    "register_plot",
    "save_figures",
    "state_colors",
    "to_json",
    "use_style",
    "plot_activity_raster",
    "plot_activity_raster_data",
    "plot_analysis_agreement",
    "plot_analysis_agreement_data",
    "plot_behavior_overview",
    "plot_behavior_overview_data",
    "plot_classification",
    "plot_classification_data",
    "plot_clusters",
    "plot_clusters_data",
    "plot_cohort_fractions",
    "plot_cohort_fractions_data",
    "plot_cross_session",
    "plot_cross_session_data",
    "plot_decoded_trajectory",
    "plot_decoded_trajectory_data",
    "plot_event_raster",
    "plot_event_raster_data",
    "plot_ground_truth_recovery",
    "plot_ground_truth_recovery_data",
    "plot_hierarchical_bootstrap",
    "plot_hierarchical_bootstrap_data",
    "plot_information_comparison",
    "plot_information_comparison_data",
    "plot_joint_histogram",
    "plot_joint_histogram_data",
    "plot_level_sweep",
    "plot_level_sweep_data",
    "plot_metric_scatter",
    "plot_metric_scatter_data",
    "plot_metric_strip",
    "plot_metric_strip_data",
    "plot_overlap",
    "plot_overlap_data",
    "plot_overlap_matrix",
    "plot_overlap_matrix_data",
    "plot_peth",
    "plot_peth_data",
    "plot_population_matrix",
    "plot_population_matrix_data",
    "plot_population_tuning",
    "plot_population_tuning_data",
    "plot_rate_maps",
    "plot_rate_maps_data",
    "plot_session_qa",
    "plot_session_qa_data",
    "plot_shuffle_distribution",
    "plot_shuffle_distribution_data",
    "plot_split_half_maps",
    "plot_split_half_maps_data",
    "plot_sweep",
    "plot_sweep_data",
    "plot_sweep_gallery",
    "plot_sweep_gallery_data",
    "plot_sweep_stability",
    "plot_sweep_stability_data",
    "plot_tuning_heatmap",
    "plot_tuning_heatmap_data",
]
