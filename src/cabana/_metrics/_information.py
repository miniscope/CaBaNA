"""Skaggs spatial/behavioral information content."""

from __future__ import annotations

from typing import ClassVar, Literal

import numpy as np
from pydantic import Field

from .._kernels import skaggs_information as _si
from .._models import StateSpace
from .._registry import Metric, register
from .._results import Tail
from .._statesums import masked_counts, shifted_sums_for, state_sums
from ._ratemap import rate_maps_from_sums


@register("metric")
class InformationContent(Metric):
    """Skaggs information: ``sum_i P_i (l_i/lbar) log2(l_i/lbar)``.

    After Skaggs, McNaughton, Gothard & Markus (1993), "An information-theoretic
    approach to deciphering the hippocampal code", *Advances in Neural
    Information Processing Systems* 5 (REFERENCES.md entry 106).

    ``P_i`` is occupancy probability over valid states (occupancy >=
    ``min_occupancy_s``), ``l_i`` the rate in state ``i`` and ``lbar`` the
    occupancy-weighted mean rate.  A *silent* cell (``lbar <= 0``) or a cell
    with no valid state carries no information that can be defined, so its value
    is NaN (not 0).

    Parameters
    ----------
    units : {"bits_per_event", "bits_per_second"}, default "bits_per_event"
        ``"bits_per_second"`` multiplies the bits-per-event value by ``lbar``.
    weight : {"amplitude", "binary"}, default "amplitude"
        Use the activity values, or ``activity > 0`` as an event indicator.
    min_occupancy_s : float, default 0.05
        A state is valid only when its masked occupancy is at least this many
        seconds (and non-zero); invalid states are excluded from ``P_i``.
    smooth_sigma_bins : float, default 0.0
        Gaussian sigma in grid bins for smoothing the per-state sums and
        occupancy before forming rates (edge-normalised).  ``> 0`` requires a
        state space with a ``GridTopology``; ``0`` disables smoothing.

    Returns
    -------
    numpy.ndarray
        ``compute`` returns shape ``(n_cells,)``; NaN for silent cells.

    Notes
    -----
    **Tail.**  ``"upper"``: information is non-negative, and a cell is
    informative only if it exceeds what shifted activity yields by chance.

    **State space.**  Requires an *exclusive* state space (``ValueError``
    otherwise, since ``P_i`` must sum to one over states); a topology is needed
    only for smoothing.

    **Activity.**  Activity must be non-negative (rates, spikes, deconvolved
    events); negative values raise ``ValueError``.  ``accepts_kinds`` is ``None``
    so the session's ``activity_kind`` is not checked: only the values are.

    Extras: ``rate_map`` ``(n_cells, n_states)`` rate per state (activity units
    per second; NaN for invalid states), ``occupancy_s`` ``(n_states,)`` masked
    seconds in each state, ``valid_states`` ``(n_states,)`` bool.
    """

    name: ClassVar[str] = "information_content"
    default_tail: ClassVar[Tail] = "upper"
    default_plots: ClassVar[tuple[str, ...]] = ("rate_maps", "metric_strip", "shuffle_distribution")

    units: Literal["bits_per_event", "bits_per_second"] = Field(
        "bits_per_event", description="bits per event, or bits per second (times mean rate)."
    )
    weight: Literal["amplitude", "binary"] = Field(
        "amplitude", description="Use activity amplitude, or binary activity > 0."
    )
    min_occupancy_s: float = Field(
        0.05, ge=0, description="Minimum occupancy (s) for a state to be valid."
    )
    smooth_sigma_bins: float = Field(
        0.0, ge=0, description="Gaussian map smoothing in grid bins (needs a grid topology)."
    )

    @staticmethod
    def _check_activity(activity: np.ndarray) -> None:
        if np.nanmin(activity) < 0:
            raise ValueError(
                "metric 'information_content': needs non-negative activity (rates); z-scored or dF/F "
                "traces can go negative. Use weight='binary' after binarize_activity, or skip "
                "zscore_activity for this metric."
            )

    def check_target(self, target: StateSpace) -> None:
        super().check_target(target)
        self.require_exclusive(target)
        self.require_topology_for_smoothing(target)

    def _x(self, activity: np.ndarray) -> np.ndarray:
        a = np.asarray(activity, dtype=np.float64)
        return (a > 0).astype(np.float64) if self.weight == "binary" else a

    def _maps(self, sums, occ, states, fs):
        return rate_maps_from_sums(
            sums, occ, fs, self.min_occupancy_s, states.topology, self.smooth_sigma_bins
        )

    def compute(self, activity, states, mask, fs):
        self.check_target(states)
        self._check_activity(activity)
        mask = np.asarray(mask, dtype=bool)
        occ = masked_counts(states, mask)
        sums = state_sums(self._x(activity), states, mask)
        rate, valid = self._maps(sums, occ, states, fs)
        return _si(rate, occ, valid, self.units == "bits_per_second")

    def compute_shifted(self, activity, states, mask, fs, shifts):
        self.check_target(states)
        self._check_activity(activity)
        mask = np.asarray(mask, dtype=bool)
        occ = masked_counts(states, mask)
        sums = shifted_sums_for(self._x(activity), states, mask, shifts)
        rate, valid = self._maps(sums, occ, states, fs)
        return _si(rate, occ, valid, self.units == "bits_per_second")

    def extras(self, activity, states, mask, fs):
        self.check_target(states)
        self._check_activity(activity)
        mask = np.asarray(mask, dtype=bool)
        occ = masked_counts(states, mask)
        rate, valid = self._maps(state_sums(self._x(activity), states, mask), occ, states, fs)
        return {"rate_map": rate, "occupancy_s": occ / fs, "valid_states": valid}
