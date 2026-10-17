"""Per-state AUROC (Mann-Whitney) of cell activity, in vs. out of state."""

from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor
from typing import ClassVar, Literal

import numpy as np
from pydantic import Field
from scipy.stats import rankdata

from .._models import StateSpace
from .._registry import Metric, register
from .._results import Tail
from .._shuffle import in_shuffle_worker, shifted_sums

_MAX_WORKERS = 8
_MEM_BUDGET = 1_500_000_000  # bytes of per-shift scratch across worker threads


def _auroc_from_rank_sums(
    r1: np.ndarray, n1: np.ndarray, n0: np.ndarray, min_frames: int
) -> np.ndarray:
    """``r1`` (..., n_cells, n_states); ``n1``/``n0`` (n_states,)."""
    ok = (n1 >= min_frames) & (n0 >= min_frames)
    with np.errstate(invalid="ignore", divide="ignore"):
        auc = (r1 - n1 * (n1 + 1) / 2.0) / (n1 * n0)
    return np.where(ok, auc, np.nan)


def _masked_shifted_rank_sums(
    x: np.ndarray, onehot_masked: np.ndarray, mask: np.ndarray, shifts: np.ndarray
) -> np.ndarray:
    """Exact in-state rank sums ``R1`` of rolled, masked series, shape ``(n_shifts, n_cells, n_states)``.

    Rolling permutes frames, so dense ranks ``G`` of each full series are
    computed once and rolled.  For a shift, the masked rolled series has dense
    ranks ``g``; with ``F(i) = #{j < i} + 0.5 #{j == i}`` (self counted as 0.5)
    taken from a per-cell histogram of ``g``, ``R1 = sum_{i in state} F(i) + n1/2``.
    No sorting happens inside the shift loop.
    """
    n_cells, n_time = x.shape
    idx = np.flatnonzero(mask)
    m = onehot_masked.astype(np.float64)
    half_n1 = 0.5 * m.sum(axis=0)
    dense = np.empty((n_cells, n_time), dtype=np.intp)
    n_distinct = np.empty(n_cells, dtype=np.intp)
    for c in range(n_cells):
        u, inv = np.unique(x[c], return_inverse=True)
        dense[c] = inv.reshape(-1)
        n_distinct[c] = u.size
    width = int(n_distinct.max())
    offs = (np.arange(n_cells, dtype=np.intp) * width)[:, None]
    out = np.empty((shifts.size, n_cells, m.shape[1]), dtype=np.float64)

    def one(i: int) -> None:
        cols = (idx - int(shifts[i])) % n_time  # roll(x, k)[t] = x[t - k]
        flat = dense[:, cols]
        flat += offs
        h = np.bincount(flat.ravel(), minlength=n_cells * width)
        f_table = np.cumsum(h.reshape(n_cells, width), axis=1) - 0.5 * h.reshape(n_cells, width)
        out[i] = np.take(f_table.ravel(), flat) @ m + half_n1  # strictly-below + 0.5 * equal

    # numpy releases the GIL in take / cumsum / matmul; each shift is independent.
    per_shift_bytes = 3 * 8 * n_cells * max(idx.size, width)
    workers = max(
        1,
        min(_MAX_WORKERS, os.cpu_count() or 1, shifts.size, _MEM_BUDGET // max(per_shift_bytes, 1)),
    )
    if in_shuffle_worker():  # outer shuffle pool (n_jobs > 1) already uses the cores
        workers = 1
    if workers == 1:
        for i in range(shifts.size):
            one(i)
    else:
        with ThreadPoolExecutor(workers) as ex:
            list(ex.map(one, range(shifts.size)))
    return out


@register("metric")
class AUROC(Metric):
    """Mann-Whitney AUROC of activity on masked frames in a state vs. not in it.

    ``0.5`` is chance, ``> 0.5`` means higher activity in the state.  Works for
    exclusive and overlapping state spaces: "not in the state" is simply every
    other masked frame (including frames in no state, as long as they are in the
    mask).  Ties get average ranks.  Activity may be of any kind (rank-based).

    Parameters
    ----------
    min_frames : int, default 20
        A state needs at least this many masked frames both in and out of it;
        otherwise its AUROC is NaN.

    Returns
    -------
    numpy.ndarray
        ``compute`` returns shape ``(n_cells, n_states)``; NaN for a cell whose
        masked activity contains NaN, or for under-sampled states.

    Notes
    -----
    **Tail.**  Default ``"two"``: a cell can be excited (AUROC > 0.5) or
    suppressed (< 0.5) by a state, and both are findings.

    **State space.**  Any (exclusive, overlapping, any topology); nothing is
    required of the space.  Frames outside the mask are ignored, not treated as
    "out of state".

    Extras: ``n_in_state`` ``(n_states,)`` int, number of masked frames in each
    state (the ``n1`` of the Mann-Whitney statistic).
    """

    name: ClassVar[str] = "auroc"
    level: ClassVar[Literal["cell", "population"]] = "cell"
    default_tail: ClassVar[Tail] = "two"
    default_plots: ClassVar[tuple[str, ...]] = ("tuning_heatmap", "shuffle_distribution")

    min_frames: int = Field(
        20, ge=1, description="Minimum masked frames in and out of a state; otherwise NaN."
    )

    def _counts(self, states: StateSpace, mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        m = states.onehot[mask].astype(np.float64)
        n1 = m.sum(axis=0)
        return n1, mask.sum() - n1

    def compute(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray, fs: float
    ) -> np.ndarray:
        mask = np.asarray(mask, dtype=bool)
        x = np.asarray(activity, dtype=np.float64)[:, mask]
        m = states.onehot[mask].astype(np.float64)
        ranks = rankdata(x, axis=1)
        n1 = m.sum(axis=0)
        n0 = mask.sum() - n1
        return _auroc_from_rank_sums(ranks @ m, n1, n0, self.min_frames)

    def compute_shifted(
        self,
        activity: np.ndarray,
        states: StateSpace,
        mask: np.ndarray,
        fs: float,
        shifts: np.ndarray,
    ) -> np.ndarray | None:
        """AUROC for each circular shift, shape ``(n_shifts, n_cells, n_states)``.

        Shifts are applied over the full session before masking.  When
        ``mask.all()`` the rolled activity is a permutation of frames, so the
        ranks of the rolled data are the rolled ranks: ranking once and using
        :func:`shifted_sums` is exact.  Otherwise each shifted, masked series is
        handled by :func:`_masked_shifted_rank_sums` (dense ranks rolled, per-shift
        histogram + cumulative counts; exact with ties, no per-shift sorting).
        """
        mask = np.asarray(mask, dtype=bool)
        shifts = np.asarray(shifts, dtype=np.int64)
        x = np.asarray(activity, dtype=np.float64)
        n_cells, n_time = x.shape
        n1, n0 = self._counts(states, mask)
        if mask.all():
            ranks = rankdata(x, axis=1)
            r1 = shifted_sums(ranks, states.masked(mask), shifts)
        else:
            r1 = _masked_shifted_rank_sums(x, states.onehot[mask], mask, shifts)
        auc = _auroc_from_rank_sums(r1, n1, n0, self.min_frames)
        # Non-finite activity: ``compute`` returns NaN for a cell whose masked values
        # contain NaN/inf, so the null must too (the dense-rank fast path would rank
        # NaN highest).  Only cells with any non-finite sample need the per-shift check.
        bad = ~np.isfinite(x)
        for c in np.flatnonzero(bad.any(axis=1)):
            if mask.all():
                auc[:, c, :] = np.nan
                continue
            idx = np.flatnonzero(mask)
            for i, k in enumerate(shifts):
                if bad[c, (idx - int(k)) % n_time].any():
                    auc[i, c, :] = np.nan
        return auc

    def extras(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray, fs: float
    ) -> dict[str, np.ndarray]:
        n1, _ = self._counts(states, np.asarray(mask, dtype=bool))
        return {"n_in_state": n1.astype(np.int64)}


__all__ = ["AUROC"]
