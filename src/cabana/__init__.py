"""CaBaNA: Calcium Behavioral and Neural Analysis.

A pipeline for asking how neural activity relates to behavioral states.  See
``docs/DESIGN.md`` for the design and ``examples/demo.py`` for an end-to-end run.
"""

from __future__ import annotations

from . import plots
from ._cohort import (
    BootstrapResult,
    cohort_table,
    compare_states_across_animals,
    fraction_significant_by_animal,
    hierarchical_bootstrap,
    per_animal_summary,
)
from ._cohort_models import CellMatch, SessionSet
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
    DecodeStates,
    GLMEncoding,
    InformationContent,
    MeanPerState,
    PCAPopulation,
    PopulationDistance,
    PopulationVectorOverlap,
    PopulationVectorStability,
    SignalCorrelation,
    SignalTuning,
    SplitHalfStability,
    event_onsets,
)
from ._models import (
    BoutTable,
    ContinuousSignal,
    GridTopology,
    LabelSeries,
    Session,
    StateSpace,
)
from ._pipeline import AnalysisSpec, Pipeline
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
from ._nulls import BoutShuffle, CircularShift, LabelShuffle
from ._registry import Metric, Null, PreprocessStep, Transform, available, build, register
from ._results import MetricResult, ResultSet, ShuffleResult
from ._shuffle import ShuffleConfig, shifted_sums, shuffle_test
from ._simulate import SimulationConfig, simulate_session
from ._transform import BinGrid, BoutsToStates, LabelsToStates, ResampleSignal, Speed

__version__ = "0.0.1"

__all__ = [
    # data model
    "BoutTable",
    "ContinuousSignal",
    "GridTopology",
    "LabelSeries",
    "Session",
    "StateSpace",
    # plugin system
    "Metric",
    "Null",
    "PreprocessStep",
    "Transform",
    "available",
    "build",
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
    "DecodeStates",
    "GLMEncoding",
    "InformationContent",
    "MeanPerState",
    "PCAPopulation",
    "PETH",
    "PopulationDistance",
    "PopulationVectorOverlap",
    "PopulationVectorStability",
    "SignalCorrelation",
    "SignalTuning",
    "SplitHalfStability",
    "event_onsets",
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
    "CircularShift",
    "LabelShuffle",
    "ShuffleConfig",
    "shifted_sums",
    "shuffle_test",
    # pipeline & results
    "AnalysisSpec",
    "MetricResult",
    "Pipeline",
    "ResultSet",
    "ShuffleResult",
    # simulation & plots
    "SimulationConfig",
    "plots",
    "simulate_session",
]
