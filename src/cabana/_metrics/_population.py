"""Population-level metrics: state population-vector overlap and stability."""

from __future__ import annotations

from typing import ClassVar, Literal

import numpy as np
from pydantic import Field

from .._models import StateSpace
from .._registry import Metric, register
from .._results import Tail
from .._statesums import masked_counts, shifted_sums_multi, state_sums
from ._ratemap import split_half_masks, valid_states


def _rate_maps(
    sums: np.ndarray, occ_frames: np.ndarray, fs: float, min_occupancy_s: float
) -> tuple[np.ndarray, np.ndarray]:
    """Unsmoothed rate maps ``sums / occupancy_s``; invalid states are NaN.

    ``sums`` is ``(..., n_cells, n_states)``, ``occ_frames`` ``(n_states,)``.
    Returns ``(rate_map, valid)`` with ``valid`` of shape ``(n_states,)``.
    """
    occ_s = np.asarray(occ_frames, dtype=np.float64) / fs
    valid = valid_states(occ_frames, fs, min_occupancy_s)
    with np.errstate(invalid="ignore", divide="ignore"):
        rm = sums / np.where(occ_s > 0, occ_s, 1.0)
    return np.where(valid, rm, np.nan), valid


def _pearson_axis(a: np.ndarray, b: np.ndarray, axis: int = -2) -> np.ndarray:
    """Pearson r along ``axis``; zero variance gives NaN."""
    a = a - a.mean(axis=axis, keepdims=True)
    b = b - b.mean(axis=axis, keepdims=True)
    num = (a * b).sum(axis=axis)
    den = np.sqrt((a * a).sum(axis=axis) * (b * b).sum(axis=axis))
    scale = max(
        float(np.nanmax(np.abs(a), initial=0.0)), float(np.nanmax(np.abs(b), initial=0.0)), 1e-300
    )
    with np.errstate(invalid="ignore", divide="ignore"):
        r = num / den
    # den is ~0 for constant vectors; treat anything at round-off level as zero variance
    return np.where(den > 1e-12 * scale * scale, r, np.nan)


@register("metric")
class PopulationVectorOverlap(Metric):
    """Similarity between the population rate vectors of every pair of states.

    Output ``(n_states, n_states)``; rows/columns of states with occupancy below
    ``min_occupancy_s`` are NaN.  No shuffle fast path.

    Parameters
    ----------
    similarity : {"cosine", "pearson"}, default "cosine"
        Cosine of the angle between state rate vectors, or Pearson r across cells
        (vectors centred over cells).  NaN where a vector has zero norm (cosine)
        or zero variance (Pearson).
    min_occupancy_s : float, default 0.05
        States with less masked occupancy (s) are invalid (NaN rows/columns).
    normalize_cells : bool, default True
        Divide each cell's rate map by its maximum over valid states first, so
        every cell contributes comparably (cells whose maximum is 0 are left
        unchanged).

    Returns
    -------
    numpy.ndarray
        ``compute`` returns shape ``(n_states, n_states)``, symmetric.

    Notes
    -----
    **Tail.**  ``"upper"``: high overlap (more similar than chance) is the
    finding; pass ``tail="lower"`` to test for distinct population vectors.

    **State space.**  Any (exclusive or overlapping).

    Extras: ``rate_map`` ``(n_cells, n_states)`` rate per state in activity units
    per second (after ``normalize_cells`` scaling when enabled; NaN for invalid
    states).
    """

    name: ClassVar[str] = "population_vector_overlap"
    extras_axes: ClassVar[dict[str, tuple[str | None, ...]]] = {
        "rate_map": ("cell", "state"),
    }
    level: ClassVar[Literal["cell", "population"]] = "population"
    default_tail: ClassVar[Tail] = "upper"
    default_plots: ClassVar[tuple[str, ...]] = ("population_matrix",)

    similarity: Literal["cosine", "pearson"] = Field(
        "cosine", description="Cosine similarity or Pearson r between state rate vectors."
    )
    min_occupancy_s: float = Field(
        0.05, ge=0, description="Minimum masked occupancy (s) for a state to be valid."
    )
    normalize_cells: bool = Field(
        True, description="Scale each cell's rate map by its maximum over valid states."
    )

    def _maps(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray, fs: float
    ) -> tuple[np.ndarray, np.ndarray]:
        mask = np.asarray(mask, dtype=bool)
        sums = state_sums(np.asarray(activity, dtype=np.float64), states, mask)
        rm, valid = _rate_maps(sums, masked_counts(states, mask), fs, self.min_occupancy_s)
        if self.normalize_cells and valid.any():
            mx = np.nanmax(rm, axis=1, keepdims=True)
            rm = np.where(mx > 0, rm / np.where(mx > 0, mx, 1.0), rm)
        return rm, valid

    def compute(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray, fs: float
    ) -> np.ndarray:
        rm, valid = self._maps(activity, states, mask, fs)
        n_states = rm.shape[1]
        out = np.full((n_states, n_states), np.nan)
        if not valid.any():
            return out
        v = rm[:, valid]
        if self.similarity == "cosine":
            norms = np.linalg.norm(v, axis=0)
            with np.errstate(invalid="ignore", divide="ignore"):
                sim = (v.T @ v) / np.outer(norms, norms)
            sim[norms == 0, :] = np.nan
            sim[:, norms == 0] = np.nan
        else:
            c = v - v.mean(axis=0, keepdims=True)
            ss = (c * c).sum(axis=0)
            with np.errstate(invalid="ignore", divide="ignore"):
                sim = (c.T @ c) / np.sqrt(np.outer(ss, ss))
            flat = ss <= 1e-24 * max(float(ss.max(initial=0.0)), 1.0) + 1e-300
            sim[flat, :] = np.nan
            sim[:, flat] = np.nan
        # A state compared with itself is exactly 1. Rounding would otherwise make the
        # diagonal 1 +/- 1e-16, and its shuffle p-values would depend on the machine.
        defined = ~np.isnan(np.diag(sim))
        sim[np.diag_indices_from(sim)] = np.where(defined, 1.0, np.nan)
        out[np.ix_(valid, valid)] = sim
        return out

    def extras(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray, fs: float
    ) -> dict[str, np.ndarray]:
        rm, _ = self._maps(activity, states, mask, fs)
        return {"rate_map": rm}


@register("metric")
class PopulationVectorStability(Metric):
    """Split-half stability of each state's population vector.

    Masked frames are cut into ``n_blocks`` contiguous equal-count blocks (by
    position among masked frames); even blocks form half A, odd blocks half B.
    For each state the Pearson r across cells between the half-A and half-B
    rate vectors is returned, shape ``(n_states,)``; NaN if the state is
    under-occupied in either half or a vector has zero variance.

    Parameters
    ----------
    n_blocks : int, default 2
        Number of contiguous blocks the masked frames are cut into (>= 2).
    min_occupancy_s : float, default 0.05
        Minimum occupancy (s) of a state *within each half* for it to be valid.

    Returns
    -------
    numpy.ndarray
        ``compute`` returns shape ``(n_states,)``: Pearson r across cells.  NaN
        for every state when there are fewer than two cells.

    Notes
    -----
    **Tail.**  ``"upper"``: a positive correlation means a stable population
    vector.

    **State space.**  Any (exclusive or overlapping).

    Extras: ``rate_map_a`` and ``rate_map_b`` ``(n_cells, n_states)`` rate maps
    of each half (activity units per second; NaN for states under-occupied in
    that half) and ``valid_states`` ``(n_states,)`` bool, valid in both halves.
    """

    name: ClassVar[str] = "pv_stability"
    extras_axes: ClassVar[dict[str, tuple[str | None, ...]]] = {
        "rate_map_a": ("cell", "state"),
        "rate_map_b": ("cell", "state"),
        "valid_states": ("state",),
    }
    level: ClassVar[Literal["cell", "population"]] = "population"
    default_tail: ClassVar[Tail] = "upper"
    default_plots: ClassVar[tuple[str, ...]] = ("metric_strip",)

    n_blocks: int = Field(
        2, ge=2, description="Number of contiguous blocks; even blocks are half A, odd half B."
    )
    min_occupancy_s: float = Field(
        0.05, ge=0, description="Minimum occupancy (s) per half for a state to be valid."
    )

    def _halves(self, states: StateSpace, mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Boolean masks of the two interleaved halves of the masked frames."""
        return split_half_masks(np.asarray(mask, dtype=bool), self.n_blocks)

    def _stability(
        self,
        sums_a: np.ndarray,
        sums_b: np.ndarray,
        occ_a: np.ndarray,
        occ_b: np.ndarray,
        fs: float,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        rm_a, va = _rate_maps(sums_a, occ_a, fs, self.min_occupancy_s)
        rm_b, vb = _rate_maps(sums_b, occ_b, fs, self.min_occupancy_s)
        valid = va & vb
        r = _pearson_axis(rm_a, rm_b, axis=-2)
        if sums_a.shape[-2] < 2:
            r = np.full_like(r, np.nan)
        return np.where(valid, r, np.nan), rm_a, rm_b, valid

    def _run(self, x, states, mask, fs, shifts):
        half_a, half_b = self._halves(states, mask)
        sh = np.zeros(1, dtype=np.int64) if shifts is None else shifts
        s_a, s_b = shifted_sums_multi(x, states, [half_a, half_b], sh)
        if shifts is None:
            s_a, s_b = s_a[0], s_b[0]
        occ_a, occ_b = masked_counts(states, half_a), masked_counts(states, half_b)
        return self._stability(s_a, s_b, occ_a, occ_b, fs)

    def compute(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray, fs: float
    ) -> np.ndarray:
        return self._run(np.asarray(activity, dtype=np.float64), states, mask, fs, None)[0]

    def compute_shifted(
        self,
        activity: np.ndarray,
        states: StateSpace,
        mask: np.ndarray,
        fs: float,
        shifts: np.ndarray,
    ) -> np.ndarray | None:
        return self._run(np.asarray(activity, dtype=np.float64), states, mask, fs, shifts)[0]

    def extras(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray, fs: float
    ) -> dict[str, np.ndarray]:
        _, rm_a, rm_b, valid = self._run(
            np.asarray(activity, dtype=np.float64), states, mask, fs, None
        )
        return {"rate_map_a": rm_a, "rate_map_b": rm_b, "valid_states": valid}


__all__ = ["PopulationVectorOverlap", "PopulationVectorStability"]
