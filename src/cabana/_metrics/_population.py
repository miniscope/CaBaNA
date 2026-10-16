"""Population-level metrics: state population-vector overlap and stability."""

from __future__ import annotations

from typing import ClassVar, Literal

import numpy as np
from pydantic import Field

from .._models import StateSpace
from .._registry import Metric, register
from .._results import Tail
from .._shuffle import shifted_sums
from ._ratemap import contiguous_folds, valid_states


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
    level: ClassVar[Literal["cell", "population"]] = "population"
    default_tail: ClassVar[Tail] = "upper"

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
        m = states.masked(np.asarray(mask, dtype=bool))
        sums = np.asarray(activity, dtype=np.float64) @ m
        rm, valid = _rate_maps(sums, m.sum(axis=0), fs, self.min_occupancy_s)
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
    level: ClassVar[Literal["cell", "population"]] = "population"
    default_tail: ClassVar[Tail] = "upper"

    n_blocks: int = Field(
        2, ge=2, description="Number of contiguous blocks; even blocks are half A, odd half B."
    )
    min_occupancy_s: float = Field(
        0.05, ge=0, description="Minimum occupancy (s) per half for a state to be valid."
    )

    def _halves(self, states: StateSpace, mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        mask = np.asarray(mask, dtype=bool)
        idx = np.flatnonzero(mask)
        block = contiguous_folds(idx.size, self.n_blocks)
        half_a = np.zeros(mask.size, dtype=bool)
        half_b = np.zeros(mask.size, dtype=bool)
        half_a[idx[block % 2 == 0]] = True
        half_b[idx[block % 2 == 1]] = True
        return states.masked(half_a), states.masked(half_b)

    def _stability(
        self, sums: np.ndarray, m_a: np.ndarray, m_b: np.ndarray, fs: float
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        n_states = m_a.shape[1]
        rm_a, va = _rate_maps(sums[..., :n_states], m_a.sum(axis=0), fs, self.min_occupancy_s)
        rm_b, vb = _rate_maps(sums[..., n_states:], m_b.sum(axis=0), fs, self.min_occupancy_s)
        valid = va & vb
        r = _pearson_axis(rm_a, rm_b, axis=-2)
        if sums.shape[-2] < 2:
            r = np.full_like(r, np.nan)
        return np.where(valid, r, np.nan), rm_a, rm_b, valid

    def compute(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray, fs: float
    ) -> np.ndarray:
        m_a, m_b = self._halves(states, mask)
        sums = np.asarray(activity, dtype=np.float64) @ np.hstack([m_a, m_b])
        return self._stability(sums, m_a, m_b, fs)[0]

    def compute_shifted(
        self,
        activity: np.ndarray,
        states: StateSpace,
        mask: np.ndarray,
        fs: float,
        shifts: np.ndarray,
    ) -> np.ndarray | None:
        m_a, m_b = self._halves(states, mask)
        sums = shifted_sums(activity, np.hstack([m_a, m_b]), shifts)
        return self._stability(sums, m_a, m_b, fs)[0]

    def extras(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray, fs: float
    ) -> dict[str, np.ndarray]:
        m_a, m_b = self._halves(states, mask)
        sums = np.asarray(activity, dtype=np.float64) @ np.hstack([m_a, m_b])
        _, rm_a, rm_b, valid = self._stability(sums, m_a, m_b, fs)
        return {"rate_map_a": rm_a, "rate_map_b": rm_b, "valid_states": valid}


__all__ = ["PopulationVectorOverlap", "PopulationVectorStability"]
