"""Place-field detection on grid rate maps and generic tuning selectivity."""

from __future__ import annotations

from typing import ClassVar, Literal

import numpy as np
from pydantic import Field

from .._kernels._label import component_stats, label_components
from .._models import GridTopology, StateSpace
from .._registry import Metric, register
from .._results import Tail
from .._statesums import masked_counts, shifted_sums_for, state_sums
from ._ratemap import rate_maps_from_sums

__all__ = ["PlaceFields", "TuningSelectivity"]


def _bin_areas(topology: GridTopology) -> np.ndarray:
    """``(n_states,)`` bin volume in signal units (product of per-axis bin widths)."""
    area = np.ones(1)
    for e in topology.edges:
        area = np.multiply.outer(area, np.diff(np.asarray(e, dtype=np.float64))).reshape(-1)
    return area


@register("metric")
class PlaceFields(Metric):
    """Detect place fields on grid rate maps and summarise them per cell.

    A cell's occupancy-normalised, optionally smoothed rate map is thresholded, the
    surviving bins are split into connected components, and components smaller than
    ``min_field_bins`` are dropped; what remains are the fields.

    Parameters
    ----------
    smooth_sigma_bins : float, default 1.0
        Gaussian sigma (grid bins) applied to sums and occupancy before dividing.
    min_occupancy_s : float, default 0.1
        Minimum occupancy (s) for a bin to be valid; invalid bins are never in a field.
    threshold : float, default 0.5
        Meaning depends on ``threshold_mode``: fraction of the cell's peak rate
        (``"peak_fraction"``), a rate in activity units per second (``"absolute"``), or
        ``k`` in ``mean + k * sd`` of the cell's valid-bin rates (``"mean_sd"``).
    threshold_mode : {"peak_fraction", "absolute", "mean_sd"}, default "peak_fraction"
        Bins need ``rate >= threshold`` and ``rate > 0``.
    min_field_bins : int, default 2
        Smallest component (in bins) that counts as a field.
    connectivity : int, default 1
        ``1`` joins face neighbours, ``2`` also diagonals.
    statistic : {"in_out_ratio", "n_fields", "field_area", "peak_rate"}, default "in_out_ratio"
        What ``compute`` returns and what the shuffle tests.

    Returns
    -------
    numpy.ndarray
        ``compute`` returns ``(n_cells,)``: the chosen statistic.  ``in_out_ratio`` is
        mean rate inside fields over mean rate outside them (valid bins), NaN with no field,
        no outside bin or a zero outside mean; ``n_fields`` and ``field_area`` are 0 when
        there is no field; ``peak_rate`` is the maximum valid-bin rate.

    Notes
    -----
    **Tail.**  ``"upper"``: a cell with a real field has a higher in/out contrast, more
    peaked map or larger field than shifted activity produces.  ``n_fields`` and
    ``field_area`` are threshold-dependent counts; read their shuffle p-values with that
    in mind.

    **State space.**  Needs an exclusive state space with a ``GridTopology`` (``ValueError``
    otherwise); the grid may be 1-D, 2-D or 3-D.  ``field_area`` is in signal units^ndim
    (bin widths from ``topology.edges``) and ``centroid`` (largest field, rate-weighted) in
    signal units, NaN with no field.

    **Null.**  Circular shift of activity (``compute_shifted``): the rate maps for all
    shifts come from one batched sums call, then ``peak_rate`` is fully vectorised and
    ``in_out_ratio`` is vectorised unless ``min_field_bins > 1``; ``n_fields`` and
    ``field_area`` loop over shifts x cells in the component-labelling step.  Maps whose
    candidate bins number fewer than ``min_field_bins`` skip labelling.

    Look for: in ``rate_maps`` a compact bright blob per planted cell; in
    ``shuffle_distribution`` the observed in/out ratio far right of the shifted-null cloud.

    Extras: ``rate_map`` ``(n_cells, n_states)`` (NaN at invalid bins), ``field_labels``
    ``(n_cells, n_states)`` int32 (0 = no field, 1.. in order of first bin), ``n_fields``,
    ``field_area``, ``peak_rate``, ``in_out_ratio`` ``(n_cells,)``, ``centroid``
    ``(n_cells, ndim)``, ``valid_states`` ``(n_states,)``, ``bin_area`` ``(n_states,)``.
    """

    name: ClassVar[str] = "place_fields"
    level: ClassVar = "cell"
    input: ClassVar = "states"
    requires_topology: ClassVar[bool] = True
    default_tail: ClassVar[Tail] = "upper"
    default_plots: ClassVar[tuple[str, ...]] = ("rate_maps", "metric_strip", "shuffle_distribution")

    smooth_sigma_bins: float = Field(1.0, ge=0, description="Gaussian map smoothing in bins.")
    min_occupancy_s: float = Field(0.1, ge=0, description="Minimum occupancy (s) of a valid bin.")
    threshold: float = Field(0.5, description="Field threshold (meaning set by threshold_mode).")
    threshold_mode: Literal["peak_fraction", "absolute", "mean_sd"] = Field(
        "peak_fraction", description="How `threshold` is interpreted."
    )
    min_field_bins: int = Field(2, ge=1, description="Smallest component counted as a field.")
    connectivity: int = Field(1, ge=1, description="1 = faces, 2 = also diagonals.")
    statistic: Literal["in_out_ratio", "n_fields", "field_area", "peak_rate"] = Field(
        "in_out_ratio", description="Statistic returned by compute and tested by the shuffle."
    )

    def check_target(self, target: StateSpace) -> None:
        super().check_target(target)
        self.require_exclusive(target)

    # ---- helpers ------------------------------------------------------------
    def _maps(self, sums, occ, states, fs):
        return rate_maps_from_sums(
            sums, occ, fs, self.min_occupancy_s, states.topology, self.smooth_sigma_bins
        )

    def _candidates(self, rate: np.ndarray) -> np.ndarray:
        """``(..., n_states)`` bool: bins passing the threshold (before size filtering)."""
        ok = np.isfinite(rate)
        r = np.where(ok, rate, np.nan)
        with np.errstate(invalid="ignore"):
            if self.threshold_mode == "peak_fraction":
                thr = self.threshold * np.nanmax(r, axis=-1, initial=-np.inf, where=ok)
            elif self.threshold_mode == "absolute":
                thr = np.full(rate.shape[:-1], float(self.threshold))
            else:
                n = ok.sum(axis=-1)
                mean = np.where(ok, r, 0.0).sum(axis=-1) / np.maximum(n, 1)
                sd = np.sqrt(
                    np.where(ok, (r - mean[..., None]) ** 2, 0.0).sum(axis=-1) / np.maximum(n, 1)
                )
                thr = mean + self.threshold * sd
            return ok & (rate > 0) & (rate >= thr[..., None])

    def _fields_one(self, cand: np.ndarray, shape: tuple[int, ...]) -> tuple[np.ndarray, int]:
        """Field labels (flat int32, 0 = none) of one candidate map, and the field count."""
        if cand.sum() < self.min_field_bins:
            return np.zeros(cand.size, dtype=np.int32), 0
        lab, n = label_components(cand.reshape(shape), self.connectivity)
        flat = lab.reshape(-1)
        size = np.bincount(flat, minlength=n + 1)
        keep = np.flatnonzero(size[1:] >= self.min_field_bins) + 1
        remap = np.zeros(n + 1, dtype=np.int32)
        remap[keep] = np.arange(1, keep.size + 1, dtype=np.int32)
        return remap[flat], int(keep.size)

    @staticmethod
    def _in_out(rate: np.ndarray, field: np.ndarray, valid: np.ndarray) -> np.ndarray:
        """Mean rate inside ``field`` over mean outside among ``valid`` bins, over the last axis."""
        ins = field & valid
        out = ~field & valid
        n_in, n_out = ins.sum(axis=-1), out.sum(axis=-1)
        r = np.where(valid, rate, 0.0)
        with np.errstate(divide="ignore", invalid="ignore"):
            m_in = (r * ins).sum(axis=-1) / n_in
            m_out = (r * out).sum(axis=-1) / n_out
            ratio = m_in / m_out
        return np.where((n_in > 0) & (n_out > 0) & (m_out > 0), ratio, np.nan)

    @staticmethod
    def _peak(rate: np.ndarray, valid: np.ndarray) -> np.ndarray:
        """Maximum valid-bin rate over the last axis (NaN with no valid bin)."""
        if not valid.any():
            return np.full(rate.shape[:-1], np.nan)
        return rate[..., valid].max(axis=-1)

    def _statistic(self, rate: np.ndarray, valid: np.ndarray, states: StateSpace) -> np.ndarray:
        """The configured statistic of rate maps ``(..., n_states)`` -> ``(...)``."""
        shape = tuple(states.topology.shape)
        lead = rate.shape[:-1]
        if self.statistic == "peak_rate":
            return self._peak(rate, valid)
        cand = self._candidates(rate)
        if self.statistic == "in_out_ratio" and self.min_field_bins <= 1:
            return self._in_out(rate, cand, valid)  # every candidate bin is a field: vectorised
        flat_c = cand.reshape(-1, cand.shape[-1])
        flat_r = rate.reshape(-1, rate.shape[-1])
        area = _bin_areas(states.topology)
        out = np.zeros(flat_c.shape[0])
        for i in range(flat_c.shape[0]):  # the labelling step: one component search per map
            lab, n = self._fields_one(flat_c[i], shape)
            if self.statistic == "n_fields":
                out[i] = n
            elif self.statistic == "field_area":
                out[i] = area[lab > 0].sum()
            else:
                out[i] = self._in_out(flat_r[i], lab > 0, valid) if n else np.nan
        return out.reshape(lead)

    # ---- Metric API ---------------------------------------------------------
    def compute(self, activity, states, mask, fs):
        self.check_target(states)
        mask = np.asarray(mask, dtype=bool)
        occ = masked_counts(states, mask)
        sums = state_sums(np.asarray(activity, dtype=np.float64), states, mask)
        rate, valid = self._maps(sums, occ, states, fs)
        return self._statistic(rate, valid, states)

    def compute_shifted(self, activity, states, mask, fs, shifts):
        self.check_target(states)
        mask = np.asarray(mask, dtype=bool)
        occ = masked_counts(states, mask)
        sums = shifted_sums_for(np.asarray(activity, dtype=np.float64), states, mask, shifts)
        rate, valid = self._maps(sums, occ, states, fs)
        return self._statistic(rate, valid, states)

    def extras(self, activity, states, mask, fs):
        self.check_target(states)
        mask = np.asarray(mask, dtype=bool)
        topo = states.topology
        shape = tuple(topo.shape)
        occ = masked_counts(states, mask)
        sums = state_sums(np.asarray(activity, dtype=np.float64), states, mask)
        rate, valid = self._maps(sums, occ, states, fs)
        cand = self._candidates(rate)
        area = _bin_areas(topo)
        centers = topo.centers()
        n_cells, n_states = rate.shape
        labels = np.zeros((n_cells, n_states), dtype=np.int32)
        n_fields = np.zeros(n_cells)
        field_area = np.zeros(n_cells)
        centroid = np.full((n_cells, topo.ndim), np.nan)
        for c in range(n_cells):
            lab, n = self._fields_one(cand[c], shape)
            labels[c], n_fields[c] = lab, n
            if n:
                field_area[c] = area[lab > 0].sum()
                size, cen, _ = component_stats(
                    lab.reshape(shape),
                    np.nan_to_num(rate[c]).reshape(shape),
                    np.nan_to_num(rate[c]).reshape(shape),
                )
                big = int(np.argmax(size))
                for ax in range(topo.ndim):
                    centroid[c, ax] = np.interp(cen[big, ax], np.arange(shape[ax]), centers[ax])
        peak = self._peak(rate, valid)
        return {
            "rate_map": rate,
            "field_labels": labels,
            "n_fields": n_fields,
            "field_area": field_area,
            "centroid": centroid,
            "peak_rate": peak,
            "in_out_ratio": self._in_out(rate, labels > 0, valid),
            "valid_states": valid,
            "bin_area": area,
        }


@register("metric")
class TuningSelectivity(Metric):
    """How concentrated a cell's mean rate is across behavioral states.

    From the per-state mean rate ``r_s`` over valid states (occupancy >=
    ``min_occupancy_s``): ``selectivity_index = (r_max - r_mean) / (r_max + r_mean)``,
    ``sparseness = 1 - (sum r / n)^2 / (sum r^2 / n)`` and
    ``depth = (r_max - r_min) / (r_max + r_min)``.

    Parameters
    ----------
    statistic : {"selectivity_index", "sparseness", "depth"}, default "selectivity_index"
        What ``compute`` returns and what the shuffle tests.
    min_occupancy_s : float, default 0.1
        Minimum occupancy (s) for a state to be valid.
    smooth_sigma_bins : float, default 0.0
        Gaussian map smoothing in grid bins; ``> 0`` requires a ``GridTopology``.

    Returns
    -------
    numpy.ndarray
        ``compute`` returns ``(n_cells,)``; NaN for a silent cell or with no valid state.

    Notes
    -----
    **Tail.**  ``"upper"``: larger means more selective, 0 for a flat cell.
    ``selectivity_index`` and ``depth`` approach 1 when one state carries all the rate;
    ``sparseness`` is 1 minus the Rolls-Tovee activity ratio, so 0 means flat and
    ``1 - 1/n`` means one state (higher is more selective).

    **State space.**  Any exclusive state space; no topology is needed unless smoothing.

    **Null.**  Circular shift of activity (``compute_shifted``, fully vectorised from one
    batched sums call).  Note that these statistics grow with the number of states and
    with noise on short recordings, so judge them against the shifted null, not 0.

    Look for: in ``tuning_heatmap`` one bright column per selective cell; in
    ``shuffle_distribution`` the observed value beyond the shifted-null cloud.

    Extras: ``rate_map`` ``(n_cells, n_states)``, ``preferred_state`` ``(n_cells,)`` int
    (argmax state, -1 when no valid rate), ``selectivity_index``, ``sparseness``, ``depth``
    ``(n_cells,)``, ``valid_states`` ``(n_states,)``.
    """

    name: ClassVar[str] = "tuning_selectivity"
    level: ClassVar = "cell"
    input: ClassVar = "states"
    default_tail: ClassVar[Tail] = "upper"
    default_plots: ClassVar[tuple[str, ...]] = (
        "metric_strip",
        "tuning_heatmap",
        "shuffle_distribution",
    )

    statistic: Literal["selectivity_index", "sparseness", "depth"] = Field(
        "selectivity_index", description="Selectivity statistic."
    )
    min_occupancy_s: float = Field(0.1, ge=0, description="Minimum occupancy (s) of a valid state.")
    smooth_sigma_bins: float = Field(
        0.0, ge=0, description="Gaussian map smoothing in bins (needs a grid topology)."
    )

    def check_target(self, target: StateSpace) -> None:
        super().check_target(target)
        self.require_exclusive(target)
        self.require_topology_for_smoothing(target)

    def _maps(self, sums, occ, states, fs):
        return rate_maps_from_sums(
            sums, occ, fs, self.min_occupancy_s, states.topology, self.smooth_sigma_bins
        )

    @staticmethod
    def _indices(rate: np.ndarray, valid: np.ndarray) -> dict[str, np.ndarray]:
        n = int(valid.sum())
        lead = rate.shape[:-1]
        if n == 0:
            nan = np.full(lead, np.nan)
            return {"selectivity_index": nan, "sparseness": nan, "depth": nan}
        r = rate[..., valid]
        rmax, rmin, mean = r.max(axis=-1), r.min(axis=-1), r.mean(axis=-1)
        sq = (r**2).mean(axis=-1)
        with np.errstate(divide="ignore", invalid="ignore"):
            si = np.where(rmax + mean > 0, (rmax - mean) / (rmax + mean), np.nan)
            depth = np.where(rmax + rmin > 0, (rmax - rmin) / (rmax + rmin), np.nan)
            sparse = np.where(sq > 0, 1.0 - mean**2 / sq, np.nan)
        return {"selectivity_index": si, "sparseness": sparse, "depth": depth}

    def compute(self, activity, states, mask, fs):
        self.check_target(states)
        mask = np.asarray(mask, dtype=bool)
        occ = masked_counts(states, mask)
        sums = state_sums(np.asarray(activity, dtype=np.float64), states, mask)
        rate, valid = self._maps(sums, occ, states, fs)
        return self._indices(rate, valid)[self.statistic]

    def compute_shifted(self, activity, states, mask, fs, shifts):
        self.check_target(states)
        mask = np.asarray(mask, dtype=bool)
        occ = masked_counts(states, mask)
        sums = shifted_sums_for(np.asarray(activity, dtype=np.float64), states, mask, shifts)
        rate, valid = self._maps(sums, occ, states, fs)
        return self._indices(rate, valid)[self.statistic]

    def extras(self, activity, states, mask, fs):
        self.check_target(states)
        mask = np.asarray(mask, dtype=bool)
        occ = masked_counts(states, mask)
        sums = state_sums(np.asarray(activity, dtype=np.float64), states, mask)
        rate, valid = self._maps(sums, occ, states, fs)
        idx = self._indices(rate, valid)
        if valid.any():
            pref = np.argmax(np.where(valid, rate, -np.inf), axis=-1).astype(np.int64)
            pref = np.where(np.isfinite(rate).any(axis=-1), pref, -1)
        else:
            pref = np.full(rate.shape[0], -1, dtype=np.int64)
        return {"rate_map": rate, "preferred_state": pref, "valid_states": valid, **idx}
