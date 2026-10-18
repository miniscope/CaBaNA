"""Built-in metrics. Importing this package registers them."""

from __future__ import annotations

from ._auroc import AUROC
from ._bayes import BayesianDecoder
from ._circular import CircularTuning
from ._continuous import SignalCorrelation, SignalTuning
from ._decode import DecodeStates, contiguous_folds
from ._decode_signal import DecodeSignal
from ._events import PETH, bouts, event_onsets
from ._fields import PlaceFields, TuningSelectivity
from ._glm import GLMEncoding
from ._information import InformationContent
from ._mean import MeanPerState
from ._mutual_information import MutualInformation, mutual_information_from_counts
from ._pairwise import PairwiseCorrelation, ParticipationRatio
from ._pca import PCAPopulation, PopulationDistance
from ._population import PopulationVectorOverlap, PopulationVectorStability
from ._ratemap import rate_maps_from_sums, split_half_columns
from ._stability import SplitHalfStability

__all__ = [
    "AUROC",
    "BayesianDecoder",
    "CircularTuning",
    "DecodeSignal",
    "DecodeStates",
    "GLMEncoding",
    "InformationContent",
    "MeanPerState",
    "MutualInformation",
    "PCAPopulation",
    "PairwiseCorrelation",
    "ParticipationRatio",
    "PlaceFields",
    "PETH",
    "PopulationDistance",
    "PopulationVectorOverlap",
    "PopulationVectorStability",
    "SignalCorrelation",
    "SignalTuning",
    "SplitHalfStability",
    "TuningSelectivity",
    "bouts",
    "contiguous_folds",
    "event_onsets",
    "mutual_information_from_counts",
    "rate_maps_from_sums",
    "split_half_columns",
]
