"""Mean activity per behavioral state, tested against a circular-shift null."""

from __future__ import annotations

from typing import ClassVar, Literal

import numpy as np
from pydantic import Field

from .._models import StateSpace
from .._registry import Metric, register
from .._results import Tail
from .._shuffle import shifted_sums


@register("metric")
class MeanPerState(Metric):
    """Mean activity in each state, or in-state mean minus out-of-state mean.

    ``statistic="mean"`` is the mean activity over masked frames in the state.
    ``statistic="difference"`` is that minus the mean over every *other* masked
    frame, so ``0`` is "no preference" and the sign says excited/inhibited.
    States with fewer than ``min_frames`` masked frames in (and, for
    ``difference``, out of) the state give NaN.  Works for exclusive and
    overlapping state spaces.

    Frames are autocorrelated, so a frame-wise t-test is anti-conservative;
    pair this metric with the ``circular_shift`` null instead.

    Parameters
    ----------
    statistic : {"mean", "difference"}, default "mean"
        Mean activity in the state, or in-state minus out-of-state mean.
    min_frames : int, default 20
        Minimum masked frames in the state (and, for ``"difference"``, out of
        it); otherwise NaN.

    Returns
    -------
    numpy.ndarray
        ``compute`` returns shape ``(n_cells, n_states)`` in the units of the
        activity.

    Notes
    -----
    **Tail.**  Default ``"two"``: both higher and lower activity than chance are
    meaningful (excitation and inhibition).  With ``statistic="mean"`` on
    non-negative activity you may prefer ``tail="upper"`` explicitly.

    **State space.**  Any (exclusive or overlapping, with or without topology).
    Frames outside the mask are ignored, not treated as out of state.

    Extras: ``n_in_state`` ``(n_states,)`` int, masked frames in each state.
    """

    name: ClassVar[str] = "mean_per_state"
    level: ClassVar[Literal["cell", "population"]] = "cell"
    default_tail: ClassVar[Tail] = "two"

    statistic: Literal["mean", "difference"] = Field(
        "mean",
        description="'mean' in-state activity or 'difference' (in-state minus out-of-state).",
    )
    min_frames: int = Field(
        20, ge=1, description="Minimum masked frames in (and for 'difference', out of) a state."
    )

    def _finish(
        self, sum_in: np.ndarray, sum_mask: np.ndarray, n_in: np.ndarray, n_mask: int
    ) -> np.ndarray:
        """``sum_in`` (..., n_cells, n_states); ``sum_mask`` (..., n_cells, 1)."""
        n_out = n_mask - n_in
        with np.errstate(invalid="ignore", divide="ignore"):
            mean_in = sum_in / n_in
            if self.statistic == "mean":
                out = mean_in
                ok = n_in >= self.min_frames
            else:
                out = mean_in - (sum_mask - sum_in) / n_out
                ok = (n_in >= self.min_frames) & (n_out >= self.min_frames)
        return np.where(ok, out, np.nan)

    def _counts(self, states: StateSpace, mask: np.ndarray) -> np.ndarray:
        return (states.onehot & mask[:, None]).sum(axis=0).astype(np.float64)

    def compute(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray, fs: float
    ) -> np.ndarray:
        mask = np.asarray(mask, dtype=bool)
        x = np.asarray(activity, dtype=np.float64)[:, mask]
        m = states.onehot[mask].astype(np.float64)
        return self._finish(x @ m, x.sum(axis=1, keepdims=True), m.sum(axis=0), int(mask.sum()))

    def compute_shifted(
        self,
        activity: np.ndarray,
        states: StateSpace,
        mask: np.ndarray,
        fs: float,
        shifts: np.ndarray,
    ) -> np.ndarray | None:
        """Exact shifted statistic via :func:`shifted_sums`.

        With a mask the sum over masked frames of the rolled activity changes
        with the shift, so the mask itself is appended as an extra column.
        """
        mask = np.asarray(mask, dtype=bool)
        cols = np.concatenate([states.masked(mask), mask[:, None].astype(np.float64)], axis=1)
        sums = shifted_sums(activity, cols, shifts)
        return self._finish(
            sums[..., :-1], sums[..., -1:], self._counts(states, mask), int(mask.sum())
        )

    def extras(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray, fs: float
    ) -> dict[str, np.ndarray]:
        return {"n_in_state": self._counts(states, np.asarray(mask, dtype=bool)).astype(np.int64)}


__all__ = ["MeanPerState"]
