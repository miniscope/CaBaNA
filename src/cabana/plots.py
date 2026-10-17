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
from ._plots_sweep import plot_sweep, plot_sweep_gallery, plot_sweep_stability
from ._plots_posthoc import (
    plot_classification,
    plot_clusters,
    plot_overlap,
    plot_overlap_matrix,
)

__all__ = [
    "METRIC_LABELS",
    "OKABE_ITO",
    "PLOT_DATA_VERSION",
    "SIGNIFICANCE_MARKER",
    "PlotSpec",
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
    "plot_sweep",
    "plot_sweep_gallery",
    "plot_sweep_stability",
    "plot_tuning_heatmap",
]
