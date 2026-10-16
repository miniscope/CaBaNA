"""Null distributions for any metric.

The idea, shared by place-cell, syllable and social-behavior analyses: break
the relationship between neural activity and behavior while keeping the
temporal statistics of both, recompute the metric many times, and compare
the observed value against that null distribution.

*How* the link is broken is a plugin (``Null``, see ``_nulls.py``).  The
default, ``circular_shift``, slides each cell's activity in time by a random
offset.  ``label_shuffle`` permutes the behavior in time blocks instead;
``bout_shuffle`` re-places scored bouts at random times.

Shift semantics (``circular_shift``)
------------------------------------
A shift ``k`` means ``np.roll(activity, k, axis=1)`` over the *full* session,
*before* the validity mask is applied.  Shifts are drawn uniformly from
``[min_shift, n_time - min_shift]`` so that no shuffle is nearly aligned
with the real data.

Fast path
---------
Most metrics are functions of per-state sums of some per-cell time series:
rate maps are ``sum(activity) / occupancy``, split-half maps are the same
over two subsets of frames, AUROC needs the rank sum within each state.
:func:`shifted_sums` computes those sums for a batch of shifts with one
matrix multiply per shift, and metrics expose ``compute_shifted`` built on it.
Metrics without a fast path, and all non-shift nulls, fall back to a Python
loop over ``compute``.
"""

from __future__ import annotations

import warnings
from typing import Any, Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import _nulls as _nulls  # noqa: F401  (registers the built-in nulls)
from ._nulls import CircularShift, draw_shifts
from ._registry import Metric, Null, Target, build
from ._results import ShuffleResult

Tail = Literal["upper", "lower", "two"]


class ShuffleConfig(BaseModel):
    """Parameters of a null-distribution test.

    Attributes
    ----------
    n_shuffles : int
        Number of surrogates.  1000 gives a p-value floor of ~0.001.
    null : Null | dict | None
        How to break the activity–behavior link.  ``None`` means
        ``circular_shift`` with ``min_shift_s`` below.
    min_shift_s : float
        Convenience for the default null: smallest allowed |shift| in seconds.
        Ignored when ``null`` is given explicitly.
    seed : int | None
        RNG seed for reproducibility.
    alpha : float
        Significance level.
    tail : {"upper", "lower", "two"} | None
        Which tail counts as "extreme".  ``None`` uses the metric's
        ``default_tail`` (upper for information content, two for AUROC).
    batch_size : int
        How many shifts to evaluate per call to ``compute_shifted`` (bounds
        memory for ``(batch, n_cells, n_states)`` intermediates).
    """

    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    n_shuffles: int = Field(1000, ge=1, le=100_000)
    null: Null | None = None
    min_shift_s: float = Field(20.0, ge=0)
    seed: int | None = 0
    alpha: float = Field(0.05, gt=0, lt=1)
    tail: Tail | None = None
    batch_size: int = Field(100, ge=1)

    @field_validator("null", mode="before")
    @classmethod
    def _build_null(cls, v: Any) -> Any:
        return build("null", v) if isinstance(v, dict) else v

    def resolved_null(self) -> Null:
        return self.null if self.null is not None else CircularShift(min_shift_s=self.min_shift_s)

    def model_dump(self, **kw: Any) -> dict[str, Any]:  # type: ignore[override]
        d = super().model_dump(**kw)
        d["null"] = None if self.null is None else self.null.to_dict()
        return d


def shifted_sums(
    x: np.ndarray,
    columns: np.ndarray,
    shifts: np.ndarray,
) -> np.ndarray:
    """Per-column sums of ``x`` after each circular shift.

    Parameters
    ----------
    x : (n_cells, n_time) float
        Per-cell time series (activity, ranks, ...).
    columns : (n_time, n_cols) float
        Indicator / weight matrix, typically ``states.masked(mask)`` or a
        concatenation of such matrices (e.g. first-half and second-half
        indicators side by side).  Frames outside the mask must already be
        zero here.
    shifts : (n_shifts,) int
        Frame offsets; ``0`` reproduces the unshifted sums.

    Returns
    -------
    (n_shifts, n_cells, n_cols) float
        ``out[i, c, j] = sum_t roll(x[c], shifts[i])[t] * columns[t, j]``.

    Notes
    -----
    Implemented as one ``(n_cells, n_time) @ (n_time, n_cols)`` product per
    shift.  Rolling the (small) column matrix the opposite way is equivalent
    to rolling every row of ``x`` and is cheaper when ``n_cols < n_cells``.
    """
    x = np.asarray(x, dtype=np.float64)
    columns = np.asarray(columns, dtype=np.float64)
    shifts = np.asarray(shifts, dtype=np.int64)
    n_cells, n_time = x.shape
    if columns.shape[0] != n_time:
        raise ValueError(f"columns has {columns.shape[0]} rows but x has {n_time} frames")
    out = np.empty((shifts.size, n_cells, columns.shape[1]), dtype=np.float64)
    for i, k in enumerate(shifts):
        # roll(x, k)[t] = x[t - k]  ==>  sum_t x[t-k] M[t] = sum_u x[u] M[u+k] = x @ roll(M, -k)
        out[i] = x @ np.roll(columns, -int(k), axis=0)
    return out


def _p_values(observed: np.ndarray, null: np.ndarray, tail: Tail) -> np.ndarray:
    """Permutation p-values; NaN where the observed value or the whole null is undefined.

    Only finite null draws are counted, so a metric that is undefined on some
    shuffles (e.g. too few frames after shifting) is compared against the
    draws where it was defined.
    """
    finite = np.isfinite(null)
    n_valid = finite.sum(axis=0)
    ge = (np.where(finite, null, -np.inf) >= observed[None]).sum(axis=0)
    le = (np.where(finite, null, np.inf) <= observed[None]).sum(axis=0)
    with np.errstate(invalid="ignore", divide="ignore"):
        if tail == "upper":
            p = (ge + 1) / (n_valid + 1)
        elif tail == "lower":
            p = (le + 1) / (n_valid + 1)
        else:
            p = 2 * (np.minimum(ge, le) + 1) / (n_valid + 1)
    p = np.clip(p, 0, 1).astype(np.float64)
    p[~np.isfinite(observed) | (n_valid == 0)] = np.nan
    return p


def _null_bounds(null: np.ndarray, alpha: float, tail: Tail) -> tuple[np.ndarray, np.ndarray]:
    if tail == "two":
        q_lo, q_hi = 100 * alpha / 2, 100 * (1 - alpha / 2)
    else:
        q_lo, q_hi = 100 * alpha, 100 * (1 - alpha)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN slices -> NaN bounds
        return np.nanpercentile(null, q_lo, axis=0), np.nanpercentile(null, q_hi, axis=0)


def shuffle_test(
    metric: Metric,
    activity: np.ndarray,
    target: Target,
    mask: np.ndarray,
    config: ShuffleConfig,
    fs: float,
) -> ShuffleResult:
    """Observed metric plus its null distribution under ``config.null``.

    Parameters
    ----------
    metric : Metric
        Any registered metric.  With the ``circular_shift`` null, uses
        ``metric.compute_shifted`` when it returns something, else loops
        over ``metric.compute``.  Other nulls always loop.
    activity : (n_cells, n_time) float
    target : StateSpace or (n_time, ...) signal
    mask : (n_time,) bool
    config : ShuffleConfig
    fs : float
        Sampling rate, to convert seconds to frames.
    """
    metric.check_target(target)
    null_plugin = config.resolved_null()
    null_plugin.check_target(metric, target)
    activity = np.asarray(activity)
    mask = np.asarray(mask, dtype=bool)
    rng = np.random.default_rng(config.seed)
    tail: Tail = config.tail if config.tail is not None else metric.default_tail

    observed = np.asarray(metric.compute(activity, target, mask, fs), dtype=np.float64)
    null = np.empty((config.n_shuffles, *observed.shape), dtype=np.float64)
    shifts: np.ndarray | None = None

    if isinstance(null_plugin, CircularShift):
        shifts = null_plugin.draw(activity.shape[1], fs, config.n_shuffles, rng)
        for start in range(0, config.n_shuffles, config.batch_size):
            batch = shifts[start : start + config.batch_size]
            fast = metric.compute_shifted(activity, target, mask, fs, batch)
            if fast is not None:
                null[start : start + batch.size] = fast
            else:
                for i, k in enumerate(batch):
                    null[start + i] = metric.compute(np.roll(activity, int(k), axis=1), target, mask, fs)
    else:
        surrogates = null_plugin.surrogates(activity, target, mask, fs, config.n_shuffles, rng)
        for i, (act_s, target_s) in enumerate(surrogates):
            null[i] = metric.compute(act_s, target_s, mask, fs)

    p = _p_values(observed, null, tail)
    lo, hi = _null_bounds(null, config.alpha, tail)
    return ShuffleResult(
        observed=observed,
        null=null,
        shifts=shifts,
        p_value=p,
        null_lo=lo,
        null_hi=hi,
        significant=np.where(np.isfinite(p), p < config.alpha, False),
        alpha=config.alpha,
        tail=tail,
        n_shuffles=config.n_shuffles,
        null_name=null_plugin.name,
    )


__all__ = ["ShuffleConfig", "Tail", "draw_shifts", "shifted_sums", "shuffle_test"]
