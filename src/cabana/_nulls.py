"""Built-in null distributions.

Every null answers the same question -- "what would this metric look like if
activity and behavior were unrelated?" -- by generating surrogate data that
keeps the statistics of each signal but breaks the link between them.  They
differ in *what* they preserve:

* ``circular_shift`` keeps both time series intact and slides activity in
  time.  The default; preserves autocorrelation on both sides.
* ``label_shuffle`` keeps activity intact and permutes the behavior in blocks
  of ``block_s`` seconds.  Used for population analyses (PCA distances,
  decoders) where the question is whether *labels* carry structure.
* ``bout_shuffle`` keeps activity intact and re-places each bout of each state
  at a random time, preserving bout count and durations (CaSA's null).
"""

from __future__ import annotations

import warnings
from collections.abc import Iterator
from typing import ClassVar, Literal

import numpy as np
from pydantic import Field

from ._models import StateSpace
from ._registry import Metric, Null, Target, register
from ._util import runs


def draw_shifts(
    n_time: int, n_shuffles: int, min_shift: int, rng: np.random.Generator
) -> np.ndarray:
    """Draw ``n_shuffles`` distinct-where-possible frame offsets in ``[min_shift, n_time - min_shift]``."""
    if n_time < 4:
        raise ValueError("need at least 4 frames to shuffle")
    min_shift = int(max(1, min(min_shift, (n_time - 1) // 2)))
    lo, hi = min_shift, n_time - min_shift  # inclusive range
    candidates = np.arange(lo, hi + 1)
    if candidates.size >= n_shuffles:
        return rng.choice(candidates, size=n_shuffles, replace=False)
    warnings.warn(
        f"only {candidates.size} distinct circular shifts are available for n_shuffles="
        f"{n_shuffles}; shifts are drawn with replacement and the smallest attainable "
        f"p-value is 1/({candidates.size}+1) = {1.0 / (candidates.size + 1):.4g}; "
        "lower min_shift_s (ShuffleConfig.min_shift_s or CircularShift.min_shift_s) or use a longer "
        "recording to get more distinct shifts",
        UserWarning,
        stacklevel=2,
    )
    return rng.choice(candidates, size=n_shuffles, replace=True)


@register("null")
class CircularShift(Null):
    """Roll activity by a random offset over the full session, then apply the mask.

    Shifting in wall-clock time and *then* masking keeps gaps where they were,
    so the null preserves the real temporal structure of both signals.
    """

    name: ClassVar[str] = "circular_shift"
    perturbs: ClassVar[Literal["activity", "target"]] = "activity"

    min_shift_s: float = Field(
        20.0,
        ge=0,
        description="Smallest allowed |shift| in seconds (clamped below half the session).",
    )

    def draw(self, n_time: int, fs: float, n: int, rng: np.random.Generator) -> np.ndarray:
        return draw_shifts(n_time, n, int(round(self.min_shift_s * fs)), rng)

    def surrogates(self, activity, target, mask, fs, n, rng) -> Iterator[tuple[np.ndarray, Target]]:
        for k in self.draw(activity.shape[1], fs, n, rng):
            yield np.roll(activity, int(k), axis=1), target


def _block_permutation(n_time: int, block: int, rng: np.random.Generator) -> np.ndarray:
    """Index array that permutes contiguous blocks of ``block`` frames."""
    n_blocks = int(np.ceil(n_time / block))
    order = rng.permutation(n_blocks)
    idx = (order[:, None] * block + np.arange(block)[None, :]).ravel()
    return idx[idx < n_time]


@register("null")
class LabelShuffle(Null):
    """Permute the behavior target in contiguous time blocks *within the mask*.

    The masked frames are cut (by position among the masked frames) into
    contiguous blocks of ``block_s`` seconds and the blocks are permuted; the
    surrogate target at masked frame ``idx[i]`` takes the value from
    ``idx[perm[i]]``.  Frames outside the mask keep their original target, so
    the per-state number of masked frames is unchanged.  Blocks preserve the
    short-timescale autocorrelation of the behavior.  Works for state spaces
    and continuous signals.
    """

    name: ClassVar[str] = "label_shuffle"
    perturbs: ClassVar[Literal["activity", "target"]] = "target"

    block_s: float = Field(1.0, gt=0, description="Block length in seconds.")

    def surrogate(self, activity, target, mask, fs, rng) -> tuple[np.ndarray, Target]:
        n_time = activity.shape[1]
        block = max(1, int(round(self.block_s * fs)))
        idx = np.arange(n_time) if mask is None else np.flatnonzero(np.asarray(mask, dtype=bool))
        src = np.arange(n_time)
        if idx.size:
            src[idx] = idx[_block_permutation(idx.size, block, rng)]
        if isinstance(target, StateSpace):
            return activity, target.model_copy(update={"onehot": target.onehot[src]})
        return activity, np.asarray(target)[src]


def _free_starts(free: np.ndarray, length: int) -> np.ndarray:
    """Start positions ``s`` with ``free[s : s + length]`` all True (O(n) via cumsum)."""
    cs = np.concatenate([[0], np.cumsum(free, dtype=np.int64)])
    return np.flatnonzero(cs[length:] - cs[:-length] == length)


def _dilate(occupied: np.ndarray, gap: int) -> np.ndarray:
    """``occupied`` grown by ``gap`` frames on each side."""
    if gap <= 0 or not occupied.any():
        return occupied
    cs = np.concatenate([[0], np.cumsum(occupied, dtype=np.int64)])
    n = occupied.size
    i = np.arange(n)
    return (cs[np.minimum(i + gap + 1, n)] - cs[np.maximum(i - gap, 0)]) > 0


@register("null")
class BoutShuffle(Null):
    """Re-place bouts of every state at random onsets; activity untouched.

    Preserves the number and durations of bouts and keeps them inside the
    mask.  Placement is exact: candidate onsets are all positions where the
    bout fits entirely in free, masked frames, found in O(n) with a cumulative
    sum.  A first pass requires a ``refractory_s`` gap to already placed bouts;
    if no such slot exists the gap is dropped; if the space is still too dense
    the bout is placed at a random onset inside the mask hull *allowing
    overlap* and a single warning is issued per ``surrogates`` call.  Only
    bouts with at least half of their frames inside the mask are re-placed;
    the others stay where they are.

    If the source state space is exclusive, one ``occupied`` array is shared by
    all states so the surrogate stays exclusive (``exclusive=True``; a forced
    overlap overwrites the earlier bout's frames).  For non-exclusive sources
    occupancy is tracked per state and the surrogate is non-exclusive.
    """

    name: ClassVar[str] = "bout_shuffle"
    perturbs: ClassVar[Literal["activity", "target"]] = "target"

    refractory_s: float = Field(
        2.0, ge=0, description="Minimum gap between re-placed bouts of one state."
    )

    def check_target(self, metric: Metric, target: Target) -> None:
        if not isinstance(target, StateSpace):
            raise ValueError("bout_shuffle needs a StateSpace target")

    def _place(self, length, occupied, mask_b, lo, hi, gap, rng) -> tuple[int, bool]:
        """Random onset for a bout of ``length``; returns ``(start, overlapped)``."""
        n_time = occupied.size
        if length <= n_time:
            for g in (gap, 0):
                free = ~_dilate(occupied, g) & mask_b
                starts = _free_starts(free, length)
                if starts.size:
                    return int(starts[rng.integers(starts.size)]), False
        if hi - lo <= length:
            return max(0, min(lo, n_time - length)), True
        return int(rng.integers(lo, hi - length + 1)), True

    def surrogate(self, activity, target, mask, fs, rng) -> tuple[np.ndarray, Target]:
        assert isinstance(target, StateSpace)
        n_time = target.n_time
        mask_b = np.ones(n_time, bool) if mask is None else np.asarray(mask, dtype=bool)
        valid = np.flatnonzero(mask_b)
        lo, hi = (int(valid[0]), int(valid[-1]) + 1) if valid.size else (0, n_time)
        gap = int(round(self.refractory_s * fs))
        runs_per_state = [
            list(zip(*(a.tolist() for a in runs(target.onehot[:, s])), strict=True))
            for s in range(target.n_states)
        ]
        shared = bool(target.exclusive)
        oh = np.zeros_like(target.onehot)
        occ_shared = np.zeros(n_time, dtype=bool)
        occ_state = [np.zeros(n_time, dtype=bool) for _ in runs_per_state]
        movable: list[tuple[int, int]] = []  # (state, length)
        for s, state_runs in enumerate(runs_per_state):
            occ = occ_shared if shared else occ_state[s]
            for start, length in state_runs:
                if 2 * int(mask_b[start : start + length].sum()) >= length:
                    movable.append((s, length))
                else:  # mostly outside the mask: stays where it was
                    oh[start : start + length, s] = True
                    occ[start : start + length] = True
        overlapped = False
        for s, length in sorted(movable, key=lambda m: -m[1]):
            occ = occ_shared if shared else occ_state[s]
            start, over = self._place(length, occ, mask_b, lo, hi, gap, rng)
            overlapped |= over
            if shared:
                oh[start : start + length, :] = False
            occ[start : start + length] = True
            oh[start : start + length, s] = True
        if overlapped:
            # one warning per surrogate; shuffle_test de-duplicates across the run
            warnings.warn(
                "bout_shuffle: the state space is too dense to place every bout without "
                "overlap inside the mask; some bouts were placed overlapping others",
                UserWarning,
                stacklevel=2,
            )
        return activity, target.model_copy(update={"onehot": oh, "exclusive": shared})


__all__ = ["BoutShuffle", "CircularShift", "LabelShuffle", "draw_shifts"]
