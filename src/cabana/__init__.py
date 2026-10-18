"""CaBaNA: Calcium Behavioral and Neural Analysis.

A pipeline for asking how neural activity relates to behavioral states.  See
``docs/DESIGN.md`` for the design and ``examples/demo.py`` for an end-to-end run.
"""

from __future__ import annotations

from . import loaders, plots
from ._cohort import (
    BootstrapResult,
    cohort_table,
    compare_states_across_animals,
    fraction_significant_by_animal,
    hierarchical_bootstrap,
    per_animal_summary,
)
from ._cohort_models import CellMatch, SessionSet
from ._criteria import (
    ClassificationResult,
    Clause,
    Criteria,
    classification_table,
    classify,
    fraction_classified_by_animal,
    place_cell_criteria,
    responsive_cell_criteria,
)
from ._design import DesignMatrix, design_columns, raised_cosine_basis
from ._cross_session import (
    CrossSessionResult,
    cross_session_map_correlation,
    cross_session_pv_correlation,
    remapping_summary,
)
from ._metrics import (
    AUROC,
    PETH,
    BayesianDecoder,
    CircularTuning,
    DecodeSignal,
    DecodeStates,
    GLMEncoding,
    InformationContent,
    MeanPerState,
    MutualInformation,
    PCAPopulation,
    PairwiseCorrelation,
    ParticipationRatio,
    PlaceFields,
    PopulationDistance,
    PopulationVectorOverlap,
    PopulationVectorStability,
    SignalCorrelation,
    SignalTuning,
    SplitHalfStability,
    TuningSelectivity,
    event_onsets,
    mutual_information_from_counts,
)
from ._models import (
    BoutTable,
    ContinuousSignal,
    GridTopology,
    LabelSeries,
    Session,
    SessionInfo,
    StateSpace,
)
from ._pipeline import (
    AnalysisSpec,
    Pipeline,
    ProgressEvent,
    RunContext,
    RunSetResult,
    describe,
    run_set,
)
from ._selection import Selection
from ._preprocess_cells import SelectCells, cell_qc_table
from ._selectors import grid_bin_size, heldout_smoothing_scores
from ._sweep import StabilityReport, SweepResult, sweep
from ._posthoc import (
    ClusterResult,
    OverlapResult,
    overlap_matrix,
    overlap_vs_chance,
    response_clusters,
    response_features,
    significant_cells,
)
from ._preprocess import (
    BinarizeActivity,
    RebinTime,
    SmoothActivity,
    SpeedThreshold,
    TimeRange,
    ZscoreActivity,
)
from ._nulls import (
    BoutShuffle,
    CellShift,
    CircularShift,
    CovariateMatchedShift,
    LabelShuffle,
    WithinStateShuffle,
)
from ._plugin_check import PluginReport, check_plugin
from ._registry import (
    Metric,
    Null,
    PreprocessStep,
    Selector,
    Transform,
    available,
    build,
    register,
)
from ._results import MetricResult, ResultSet, RunError, RunWarning, ShuffleResult
from ._shuffle import RunCancelled, ShuffleConfig, adjust_p_values, shifted_sums, shuffle_test
from ._simulate import SimulationConfig, simulate_session
from ._transform import BinGrid, BoutsToStates, LabelsToStates, ResampleSignal, Speed
from ._transform_behavior import states_to_bouts

try:
    from importlib.metadata import PackageNotFoundError, version as _version

    __version__ = _version("cabana")
except PackageNotFoundError:  # pragma: no cover - not installed
    __version__ = "0.0.0+unknown"

__all__ = [
    "states_to_bouts",
    # cell classification
    "ClassificationResult",
    "Clause",
    "Criteria",
    "classification_table",
    "classify",
    "fraction_classified_by_animal",
    "place_cell_criteria",
    "responsive_cell_criteria",
    # data model
    "BoutTable",
    "ContinuousSignal",
    "GridTopology",
    "LabelSeries",
    "Session",
    "SelectCells",
    "SessionInfo",
    "StateSpace",
    # plugin system
    "Metric",
    "PluginReport",
    "Selector",
    "Null",
    "PreprocessStep",
    "Transform",
    "available",
    "build",
    "check_plugin",
    "register",
    # transforms
    "BinGrid",
    "DesignMatrix",
    "design_columns",
    "raised_cosine_basis",
    "BoutsToStates",
    "LabelsToStates",
    "ResampleSignal",
    "Speed",
    # preprocessing
    "BinarizeActivity",
    "RebinTime",
    "SmoothActivity",
    "SpeedThreshold",
    "TimeRange",
    "ZscoreActivity",
    # metrics
    "AUROC",
    "BayesianDecoder",
    "CircularTuning",
    "DecodeSignal",
    "PairwiseCorrelation",
    "ParticipationRatio",
    "PlaceFields",
    "TuningSelectivity",
    "DecodeStates",
    "GLMEncoding",
    "InformationContent",
    "MeanPerState",
    "MutualInformation",
    "PCAPopulation",
    "PETH",
    "PopulationDistance",
    "PopulationVectorOverlap",
    "PopulationVectorStability",
    "SignalCorrelation",
    "SignalTuning",
    "SplitHalfStability",
    "event_onsets",
    "mutual_information_from_counts",
    # results-level analyses
    "ClusterResult",
    "OverlapResult",
    "overlap_matrix",
    "overlap_vs_chance",
    "response_clusters",
    "response_features",
    "significant_cells",
    # across sessions and animals
    "BootstrapResult",
    "CellMatch",
    "CrossSessionResult",
    "SessionSet",
    "cohort_table",
    "compare_states_across_animals",
    "cross_session_map_correlation",
    "cross_session_pv_correlation",
    "fraction_significant_by_animal",
    "hierarchical_bootstrap",
    "per_animal_summary",
    "remapping_summary",
    # shuffling
    "BoutShuffle",
    "CellShift",
    "CovariateMatchedShift",
    "WithinStateShuffle",
    "CircularShift",
    "LabelShuffle",
    "ShuffleConfig",
    "adjust_p_values",
    "shifted_sums",
    "shuffle_test",
    # pipeline & results
    "AnalysisSpec",
    "MetricResult",
    "Pipeline",
    "ProgressEvent",
    "ResultSet",
    "RunCancelled",
    "RunContext",
    "RunError",
    "RunSetResult",
    "Selection",
    "StabilityReport",
    "SweepResult",
    "cell_qc_table",
    "grid_bin_size",
    "heldout_smoothing_scores",
    "sweep",
    "RunWarning",
    "describe",
    "run_set",
    "ShuffleResult",
    # simulation & plots
    "SimulationConfig",
    "loaders",
    "plots",
    "simulate_session",
]
