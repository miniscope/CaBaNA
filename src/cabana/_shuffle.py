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

import os
import threading
import warnings
from collections.abc import Callable
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from typing import Any, Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from scipy.stats import false_discovery_control, rankdata

from ._kernels import shifted_sums
from ._nulls import CircularShift, draw_shifts
from ._registry import Metric, Null, Target, build
from ._results import ShuffleResult, Tail


class RunCancelled(Exception):  # noqa: N818
    """Raised (by ``should_cancel`` returning True) to stop a shuffle test or pipeline run."""


_worker = threading.local()


def in_shuffle_worker() -> bool:
    """True inside a ``shuffle_test`` worker thread (``n_jobs > 1``).

    Metrics that run their own thread pool (AUROC) check this and stay serial,
    so the outer pool is the only source of parallelism (no oversubscription).
    """
    return bool(getattr(_worker, "active", False))


def resolve_n_jobs(n_jobs: int) -> int:
    """``-1`` means all cores; otherwise the value itself (at least 1)."""
    return max(1, (os.cpu_count() or 1) if n_jobs == -1 else int(n_jobs))


class ShuffleConfig(BaseModel):
    """Parameters of a null-distribution test.

    Attributes
    ----------
    n_shuffles : int, default 1000
        Number of surrogates (1 to 100000).  The smallest attainable one-sided
        p-value is ``1 / (n_shuffles + 1)`` (about 0.001 for 1000); two-tailed
        p-values have a floor of ``2 / (n_shuffles + 1)``.
    null : Null | dict | None, default None
        How to break the activity-behavior link (a ``Null`` or
        ``{"name": ..., **params}``).  ``None`` means ``circular_shift`` with
        ``min_shift_s`` below.
    min_shift_s : float, default 20.0
        Convenience for the default null: smallest allowed |shift| in seconds.
        Ignored when ``null`` is given explicitly.
    seed : int | None, default 0
        Base RNG seed for reproducibility; ``None`` draws fresh entropy.  In a
        ``Pipeline`` the stream actually used is derived per analysis from this
        base and the analysis name (see ``derive_seeds``); a direct
        ``shuffle_test`` call uses it as is.
    derive_seeds : bool, default True
        Pipeline only.  ``True`` gives every analysis its own stream,
        ``SeedSequence([seed, crc32(name)])``, so nulls are independent across
        analyses.  ``False`` restores the old behaviour in which all analyses
        sharing a seed draw identical shifts (correlated nulls).  Wanted never,
        except to reproduce results produced before per-analysis seeding.
    alpha : float, default 0.05
        Significance level, in (0, 1); ``significant`` means ``p_value < alpha``
        and the null bounds are percentiles at ``alpha`` (or ``alpha / 2``).
    tail : {"upper", "lower", "two"} | None, default None
        Which tail counts as "extreme".  ``None`` uses the metric's
        ``resolve_tail(target)``: ``upper`` for most metrics (e.g. information
        content), ``two`` for AUROC / mean_per_state / signal_correlation / peth,
        and ``lower`` for ``bayesian_decoder`` on a grid (where the statistic is a
        decoding error, so smaller is better; categorical targets use ``upper``).
    batch_size : int, default 100
        How many shifts to evaluate per call to ``compute_shifted`` (bounds
        memory for ``(batch, n_cells, n_states)`` intermediates).
    n_jobs : int, default 1
        Worker threads over batches of shuffles (``-1`` = all cores).  Results
        are bit-identical for every value (shifts and per-surrogate child seeds
        are fixed up front), so this is purely a speed knob.  Parallelism is
        across batches: it needs ``n_shuffles / batch_size >= n_jobs``.  Nulls
        that only implement ``surrogates`` (no per-draw ``surrogate``) run serially.
    keep_null : {"full", "none"}, default "full"
        ``"full"`` keeps the ``(n_shuffles, ...)`` null draws in
        ``ShuffleResult.null`` (needed by plots that draw the null).  ``"none"``
        sets ``null=None`` once p-values, bounds, ``null_median`` and
        ``null_mean`` are computed, saving memory and disk for large runs.
    max_null_bytes : int, default 2**30
        With ``keep_null="none"``, a cell-level, cell-separable metric under a
        cell-separable null whose full null (``n_shuffles * output size * 8`` bytes)
        would exceed this is evaluated in chunks of cells, each chunk's null fitting
        the budget.  Results are identical to the unchunked path up to floating-point
        round-off (exact for p-values except at ties within one ulp);
        ``ShuffleResult.null_info["chunks"]`` records the number of chunks.  Cost:
        per-surrogate nulls redraw their surrogates once per chunk.
    null_dtype : {"float64", "float32"}, default "float64"
        Storage dtype of the null draws when ``keep_null="full"``.  ``"float32"``
        halves memory; the observed value is rounded to float32 too, so p-values and
        ``max_stat`` correction decide ties in float32 precision (exact ties stay
        ties, near-ties within float32 round-off become ties).
    """

    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    n_shuffles: int = Field(
        1000,
        ge=1,
        le=100_000,
        description="Number of surrogates; one-sided p-value floor is 1/(n_shuffles+1).",
    )
    null: Null | None = Field(
        None, description="Null plugin or dict; None = circular_shift with min_shift_s."
    )
    min_shift_s: float = Field(
        20.0, ge=0, description="Smallest |shift| (s) of the default circular_shift null."
    )
    seed: int | None = Field(0, description="Base RNG seed; None = non-reproducible.")
    derive_seeds: bool = Field(
        True,
        description="Pipeline: derive a per-analysis seed from (seed, analysis name).",
    )
    alpha: float = Field(0.05, gt=0, lt=1, description="Significance level (p < alpha).")
    tail: Tail | None = Field(
        None,
        description=(
            "'upper', 'lower' or 'two'; None = the metric's default (upper for most, two for "
            "AUROC/mean/correlation/peth, lower for bayesian_decoder on a grid). p-value "
            "floor is 1/(n_shuffles+1) (two-tailed: 2/(n_shuffles+1))."
        ),
    )
    batch_size: int = Field(
        100, ge=1, description="Shifts evaluated per compute_shifted call (bounds memory)."
    )
    n_jobs: int = Field(
        1,
        ge=-1,
        description="Worker threads over batches of shuffles; -1 = all cores. Results do not depend on it.",
    )
    keep_null: Literal["full", "none"] = Field(
        "full",
        description="'full' keeps ShuffleResult.null draws; 'none' drops them (null=None).",
    )
    max_null_bytes: int = Field(
        1 << 30,
        ge=1,
        description=(
            "When keep_null='none', a cell-level, cell-separable metric whose full null would "
            "exceed this is evaluated in chunks of cells; results are identical up to "
            "floating-point round-off (exact for p-values except at ties within one ulp)."
        ),
    )
    null_dtype: Literal["float64", "float32"] = Field(
        "float64",
        description=(
            "dtype of the stored null draws when keep_null='full'; float32 halves memory. The "
            "observed value is rounded to float32 as well, so ties (p-values, max_stat) are "
            "decided in float32 precision."
        ),
    )
    correction: Literal["none", "bh", "bonferroni", "max_stat"] = Field(
        "none",
        description=(
            "Multiple-comparison correction filling p_adj/significant_adj: 'bh' (FDR), "
            "'bonferroni' (FWER), 'max_stat' (Westfall-Young single-step min-p across states, "
            "exact under the permutation null; states scope only)."
        ),
    )
    correction_scope: Literal["states", "cells", "all"] = Field(
        "states",
        description=(
            "Family of tests corrected together: across states within a cell, across cells "
            "within a state, or all tests of the result. For 'bh'/'bonferroni' on a result "
            "without a state axis, 'states' falls back to correcting across cells "
            "(noted in correction_note); 'max_stat' is then a no-op."
        ),
    )

    @model_validator(mode="after")
    def _check_correction(self) -> ShuffleConfig:
        if self.correction == "max_stat" and self.correction_scope != "states":
            raise ValueError(
                "correction='max_stat' is only defined for correction_scope='states' "
                f"(got {self.correction_scope!r}); use 'bh' or 'bonferroni' to correct across "
                "cells or all tests"
            )
        return self

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


def _like_null(observed: np.ndarray, null: np.ndarray) -> np.ndarray:
    """``observed`` in the null's float32 precision (ties are decided in the null's dtype)."""
    if null.dtype == np.float32:
        with np.errstate(over="ignore"):
            return observed.astype(np.float32)
    return observed


def _count(cmp: np.ndarray, finite: np.ndarray) -> np.ndarray:
    """Per-column count of ``cmp & finite`` over the shuffle axis, in place on ``cmp``."""
    cmp &= finite
    return np.count_nonzero(cmp, axis=0)


def _p_values(observed: np.ndarray, null: np.ndarray, tail: Tail) -> np.ndarray:
    """Permutation p-values; NaN where the observed value or the whole null is undefined.

    Only finite null draws are counted, so a metric that is undefined on some
    shuffles (e.g. too few frames after shifting) is compared against the
    draws where it was defined.
    """
    finite = np.isfinite(null)
    n_valid = np.count_nonzero(finite, axis=0)
    obs = _like_null(observed, null)[None]
    ge = _count(null >= obs, finite)
    le = _count(null <= obs, finite)
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


Correction = Literal["none", "bh", "bonferroni", "max_stat"]
CorrectionScope = Literal["states", "cells", "all"]


def _adjust_1d(p: np.ndarray, method: str) -> np.ndarray:
    out = np.full(p.shape, np.nan)
    fin = np.isfinite(p)
    m = int(fin.sum())
    if m == 0:
        return out
    if method == "bh":
        out[fin] = false_discovery_control(p[fin], method="bh")
    else:
        out[fin] = np.minimum(1.0, p[fin] * m)
    return out


def adjust_p_values(
    p: np.ndarray, method: Literal["none", "bh", "bonferroni"], axis: int | None = None
) -> np.ndarray:
    """Multiple-comparison adjusted p-values; NaN entries stay NaN and are not counted.

    Parameters
    ----------
    p : array
        Raw p-values.
    method : {"none", "bh", "bonferroni"}
        ``"bh"``: Benjamini-Hochberg (``scipy.stats.false_discovery_control``);
        ``"bonferroni"``: ``min(1, p * m)`` with ``m`` the number of finite
        p-values in the family.  (``"max_stat"`` needs the null draws and is
        only available through ``ShuffleConfig.correction``.)
    axis : int, optional
        Axis along which each family lies (one family per remaining index);
        ``None`` treats the whole array as one family.
    """
    p = np.asarray(p, dtype=np.float64)
    if method == "none":
        return p.copy()
    if method not in ("bh", "bonferroni"):
        raise ValueError(f"unknown method {method!r}; use 'none', 'bh' or 'bonferroni'")
    if axis is None:
        return _adjust_1d(p.ravel(), method).reshape(p.shape)
    moved = np.moveaxis(p, axis, -1)
    flat = moved.reshape(-1, moved.shape[-1])
    out = np.stack([_adjust_1d(row, method) for row in flat]) if len(flat) else flat.copy()
    return np.moveaxis(out.reshape(moved.shape), -1, axis)


def _tail_p(ge: np.ndarray, le: np.ndarray, n_valid: np.ndarray, tail: Tail) -> np.ndarray:
    """Unsmoothed tail proportion from counts of draws >= / <= a value."""
    with np.errstate(invalid="ignore", divide="ignore"):
        if tail == "upper":
            p = ge / n_valid
        elif tail == "lower":
            p = le / n_valid
        else:
            p = 2 * np.minimum(ge, le) / n_valid
    return np.minimum(p, 1.0)


def _max_stat_p(
    observed: np.ndarray, null: np.ndarray, tail: Tail, p_raw: np.ndarray
) -> np.ndarray:
    """Westfall-Young single-step min-p across the state axis (axis 1 of the result).

    Exact under the permutation null.  Each null draw is converted to a
    within-null p-value (same tail rule as :func:`_p_values`, ties counted, NaN
    draws ignored); the family statistic of a shuffle is the minimum of these
    over states.  The observed p of ``(cell, state)`` counts itself as one more
    draw (``(ge + 1) / (n_valid + 1)``, i.e. the raw p) and the adjusted p is
    ``(#{shuffles: family min <= observed p} + 1) / (n_valid + 1)``, floored at
    the raw p.  Cells are processed in chunks to bound memory.
    """
    n_shuf, n_cells = null.shape[0], null.shape[1]
    p_adj = np.full(p_raw.shape, np.nan)
    per_cell = max(1, int(np.prod(null.shape[2:])))
    chunk = max(1, int(2e7 // (n_shuf * per_cell)))
    for lo in range(0, n_cells, chunk):
        sl = slice(lo, min(n_cells, lo + chunk))
        x = null[:, sl]
        obs = observed[sl]
        finite = np.isfinite(x)
        n_valid = np.count_nonzero(finite, axis=0)  # (cells, states, ...)
        xf = np.where(finite, x, np.nan)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            lt = rankdata(xf, method="min", axis=0, nan_policy="omit") - 1  # #{null < null_i}
            le_rank = rankdata(xf, method="max", axis=0, nan_policy="omit")  # #{null <= null_i}
            p_null = _tail_p(n_valid[None] - lt, le_rank, n_valid[None], tail)
            minp = np.nanmin(p_null, axis=2)  # (shuffles, cells, ...)
        del p_null, lt, le_rank
        fam_valid = np.isfinite(minp)
        n_fam = fam_valid.sum(axis=0)  # (cells, ...)
        minp = np.where(fam_valid, minp, np.inf)
        obs_c = _like_null(obs, x)[None]
        ge = _count(x >= obs_c, finite)
        le = _count(x <= obs_c, finite)
        p_obs = _tail_p(ge + 1, le + 1, n_valid + 1, tail)  # (cells, states, ...)
        cnt = (minp[:, :, None] <= p_obs[None]).sum(axis=0)
        with np.errstate(invalid="ignore", divide="ignore"):
            adj = (cnt + 1) / (n_fam[:, None] + 1)
        p_adj[sl] = np.clip(adj, 0, 1)
    p_adj = np.where(np.isfinite(observed) & np.isfinite(p_raw), p_adj, np.nan)
    return np.where(np.isfinite(p_adj), np.maximum(p_adj, p_raw), np.nan)


def _correct(
    p: np.ndarray,
    observed: np.ndarray,
    null: np.ndarray,
    tail: Tail,
    correction: str,
    scope: str,
) -> tuple[np.ndarray, str | None]:
    """Return ``(p_adj, note)``; note explains a no-op or a scope fallback.

    ``"max_stat"`` is the Westfall-Young single-step min-p across states (exact under the
    permutation null).
    """
    if correction == "none":
        return p.copy(), None
    if correction == "max_stat":
        if scope != "states":
            raise ValueError(
                "correction='max_stat' is only defined for correction_scope='states' "
                f"(got {scope!r}); use 'bh' or 'bonferroni' to correct across cells or all tests"
            )
        if p.ndim < 2:
            return p.copy(), "no state axis: max_stat correction is a no-op"
        if p.shape[1] == 1:
            return p.copy(), "single state: max_stat correction is a no-op"
        return _max_stat_p(observed, null, tail, p), None
    if scope == "all":
        return adjust_p_values(p, correction), None
    if scope == "states":
        if p.ndim < 2:
            return (
                adjust_p_values(p, correction, axis=0),
                f"no state axis: {correction!r} applied across cells",
            )
        return adjust_p_values(p, correction, axis=1), None
    return adjust_p_values(p, correction, axis=0), None


def _null_bounds(null: np.ndarray, alpha: float, tail: Tail) -> tuple[np.ndarray, np.ndarray]:
    if tail == "two":
        q_lo, q_hi = 100 * alpha / 2, 100 * (1 - alpha / 2)
    else:
        q_lo, q_hi = 100 * alpha, 100 * (1 - alpha)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN slices -> NaN bounds
        return np.nanpercentile(null, q_lo, axis=0), np.nanpercentile(null, q_hi, axis=0)


def _run_batches(
    work: Callable[[int], int],
    starts: list[int],
    n_jobs: int,
    tick: Callable[[int], None],
    check_cancel: Callable[[], None],
    *,
    dedupe_warnings: bool,
) -> None:
    """Run ``work(start)`` for every batch start, serially or on a thread pool.

    ``work`` fills its own disjoint slice of the null array and returns the
    number of surrogates it computed.  ``tick`` and ``check_cancel`` are only
    ever called from the calling thread.  Cancellation is checked before each
    batch is submitted; on cancel nothing more is submitted, in-flight batches
    finish (cancel granularity is one batch) and :class:`RunCancelled` is raised.
    Warnings raised by ``work`` (in any thread) are captured, de-duplicated by
    (category, message) and re-issued once from the calling thread.
    """
    done = 0
    if n_jobs <= 1 or len(starts) <= 1:
        if not dedupe_warnings:
            for start in starts:
                check_cancel()
                done += work(start)
                tick(done)
            return
        with warnings.catch_warnings(record=True) as rec:
            warnings.simplefilter("always")
            try:
                for start in starts:
                    check_cancel()
                    done += work(start)
                    tick(done)
            finally:
                caught = list(rec)
        _reissue(caught)
        return

    def run(start: int) -> int:
        _worker.active = True
        try:
            return work(start)
        finally:
            _worker.active = False

    cancel: RunCancelled | None = None
    caught: list[warnings.WarningMessage] = []
    with warnings.catch_warnings(record=True) as rec:
        warnings.simplefilter("always")
        try:
            with ThreadPoolExecutor(min(n_jobs, len(starts))) as ex:
                pending: set[Future[int]] = set()
                nxt = 0
                try:
                    while nxt < len(starts) or pending:
                        while cancel is None and nxt < len(starts) and len(pending) < n_jobs:
                            try:
                                check_cancel()
                            except RunCancelled as exc:
                                cancel = exc
                                break
                            pending.add(ex.submit(run, starts[nxt]))
                            nxt += 1
                        if not pending:
                            break
                        finished, pending = wait(pending, return_when=FIRST_COMPLETED)
                        for fut in finished:
                            done += fut.result()
                        tick(done)
                except BaseException:
                    for fut in pending:
                        fut.cancel()
                    raise
        finally:
            caught = list(rec)
    _reissue(caught)
    if cancel is not None:
        raise cancel


def _reissue(caught: list[warnings.WarningMessage]) -> None:
    """Re-issue each distinct (category, message) once, through the caller's filters."""
    seen: set[tuple[type, str]] = set()
    for wm in caught:
        key = (wm.category, str(wm.message))
        if key in seen:
            continue
        seen.add(key)
        warnings.warn(wm.message, wm.category, stacklevel=4)


def plan_chunks(
    metric: Metric,
    null_plugin: Null,
    observed_shape: tuple[int, ...],
    config: ShuffleConfig,
) -> tuple[int, int, int, int]:
    """Chunking rule shared by :func:`shuffle_test` and ``memory_estimate``.

    Parameters
    ----------
    metric : Metric
    null_plugin : Null
        ``config.resolved_null()``.
    observed_shape : tuple of int
        Shape of ``metric.compute`` (cells first for cell-level metrics).
    config : ShuffleConfig

    Returns
    -------
    n_chunks : int
        1 when the null is evaluated whole.
    chunk_cells : int
        Cells per chunk (all cells when ``n_chunks == 1``).
    full_bytes : int
        Bytes of the whole ``(n_shuffles, *observed_shape)`` null (``null_dtype`` when
        ``keep_null="full"``, else float64).
    held_bytes : int
        Bytes of the null held at once (one chunk when chunked).
    """
    n_cells = int(observed_shape[0]) if observed_shape else 1
    itemsize = np.dtype(config.null_dtype).itemsize if config.keep_null == "full" else 8
    size = int(np.prod(observed_shape, dtype=np.int64))
    full_bytes = config.n_shuffles * size * itemsize
    if (
        config.keep_null == "none"
        and metric.level == "cell"
        and len(observed_shape) >= 1
        and metric.cell_separable
        and null_plugin.cell_separable
        and (isinstance(null_plugin, CircularShift) or null_plugin.has_surrogate)
        and full_bytes > config.max_null_bytes
    ):
        per_cell = max(1, int(np.prod(observed_shape[1:], dtype=np.int64)))
        chunk_cells = max(1, config.max_null_bytes // (config.n_shuffles * per_cell * 8))
        n_chunks = max(1, -(-n_cells // chunk_cells))
        if n_chunks > 1:
            return n_chunks, chunk_cells, full_bytes, config.n_shuffles * chunk_cells * per_cell * 8
    return 1, n_cells, full_bytes, full_bytes


def shuffle_test(
    metric: Metric,
    activity: np.ndarray,
    target: Target,
    mask: np.ndarray,
    config: ShuffleConfig,
    fs: float,
    on_batch: Callable[[int, int], None] | None = None,
    should_cancel: Callable[[], bool] | None = None,
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
    on_batch : callable (done, total), optional
        Called after each batch of ``config.batch_size`` surrogates (and after
        the last, possibly smaller, one) with the number of surrogates done.
    should_cancel : callable () -> bool, optional
        Polled at the same points as ``on_batch``; when it returns True,
        :class:`RunCancelled` is raised.

    Returns
    -------
    ShuffleResult
        Observed values, null draws (``None`` if ``config.keep_null == "none"``),
        p-values, null bounds, ``significant`` and test parameters; every
        per-metric array has the metric's output shape.

    Notes
    -----
    **NaN semantics.**  A cell/state whose observed value is NaN gets
    ``p_value = NaN`` and ``significant = False``.  Non-finite null draws (a metric
    undefined on some surrogates) are ignored: the p-value uses only the finite
    draws, ``(count + 1) / (n_finite + 1)``, and is NaN if none are finite.  The
    null median, mean and bounds are nan-aware likewise.

    **Shift-then-mask.**  With ``circular_shift`` the activity is rolled over the
    *whole* session first and ``mask`` is applied afterwards, unchanged (the mask
    is not shifted), so gaps stay where they were.  Other nulls perturb the target
    (see ``label_shuffle`` / ``bout_shuffle``) and recompute the metric with the
    same mask.  Tail defaults to ``metric.resolve_tail(target)`` when
    ``config.tail`` is ``None``.
    """
    metric.check_target(target)
    null_plugin = config.resolved_null()
    null_plugin.check_target(metric, target)
    activity = np.asarray(activity)
    mask = np.asarray(mask, dtype=bool)
    rng = np.random.default_rng(np.random.SeedSequence(config.seed))
    tail: Tail = config.tail if config.tail is not None else metric.resolve_tail(target)

    observed = np.asarray(metric.compute(activity, target, mask, fs), dtype=np.float64)
    shifts: np.ndarray | None = None
    total = config.n_shuffles
    n_jobs = resolve_n_jobs(config.n_jobs)
    bs = config.batch_size
    starts = list(range(0, total, bs))
    is_shift = isinstance(null_plugin, CircularShift)

    def check_cancel() -> None:
        # checked BEFORE computing a batch, so a finished shuffle is never discarded
        if should_cancel is not None and should_cancel():
            raise RunCancelled("cancelled during shuffle test")

    n_chunks, chunk_cells, _, _ = plan_chunks(metric, null_plugin, observed.shape, config)

    if is_shift:
        shifts = null_plugin.draw(activity.shape[1], fs, config.n_shuffles, rng)
        children = None
    elif null_plugin.has_surrogate:
        # one independent child stream per surrogate: the draw does not depend on batching or n_jobs
        children = np.random.SeedSequence(config.seed).spawn(total)
    else:  # legacy plugin implementing only ``surrogates``: one shared generator, serial
        children = None

    def fill(act: np.ndarray, null: np.ndarray, tick: Callable[[int], None]) -> None:
        """Fill ``null`` (n_shuffles, *metric output on ``act``) with the surrogate draws."""
        if is_shift:

            def work(start: int) -> int:
                batch = shifts[start : start + bs]
                fast = metric.compute_shifted(act, target, mask, fs, batch)
                if fast is not None:
                    null[start : start + batch.size] = fast
                else:
                    for i, k in enumerate(batch):
                        null[start + i] = metric.compute(
                            np.roll(act, int(k), axis=1), target, mask, fs
                        )
                return batch.size

            _run_batches(work, starts, n_jobs, tick, check_cancel, dedupe_warnings=n_jobs > 1)
        elif children is not None:

            def work(start: int) -> int:
                stop = min(start + bs, total)
                for i in range(start, stop):
                    act_s, target_s = null_plugin.surrogate(
                        act, target, mask, fs, np.random.default_rng(children[i])
                    )
                    null[i] = metric.compute(act_s, target_s, mask, fs)
                return stop - start

            _run_batches(work, starts, n_jobs, tick, check_cancel, dedupe_warnings=True)
        else:
            surrogates = null_plugin.surrogates(act, target, mask, fs, config.n_shuffles, rng)
            for i, (act_s, target_s) in enumerate(surrogates):
                if i % bs == 0:
                    check_cancel()
                null[i] = metric.compute(act_s, target_s, mask, fs)
                if (i + 1) % bs == 0 or i + 1 == total:
                    tick(i + 1)

    def summarize(null: np.ndarray, obs: np.ndarray) -> dict[str, np.ndarray]:
        out: dict[str, np.ndarray] = {"p": _p_values(obs, null, tail)}
        out["lo"], out["hi"] = _null_bounds(null, config.alpha, tail)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            out["median"] = np.nanmedian(null, axis=0)
            out["mean"] = np.nanmean(null, axis=0)
            out["std"] = (
                np.nanstd(null, axis=0, ddof=1) if total > 1 else np.full(obs.shape, np.nan)
            )
        return out

    note: str | None
    null_out: np.ndarray | None
    if n_chunks == 1:

        def tick(done: int) -> None:
            if on_batch is not None:
                on_batch(done, total)

        dtype = np.dtype(config.null_dtype) if config.keep_null == "full" else np.float64
        null = np.empty((config.n_shuffles, *observed.shape), dtype=dtype)
        fill(activity, null, tick)
        st = summarize(null, observed)
        p = st["p"]
        p_adj, note = _correct(p, observed, null, tail, config.correction, config.correction_scope)
        null_out = null if config.keep_null == "full" else None
    else:
        parts: list[dict[str, np.ndarray]] = []
        adj_parts: list[np.ndarray] = []
        note = None
        caught_chunks: list[warnings.WarningMessage] = []
        with warnings.catch_warnings(record=True) as rec_chunks:
            warnings.simplefilter("always")
            try:
                for ci in range(n_chunks):
                    rows = slice(ci * chunk_cells, min((ci + 1) * chunk_cells, observed.shape[0]))
                    obs_c = observed[rows]

                    def tick(done: int, ci: int = ci) -> None:
                        if on_batch is not None:
                            # true shuffle units, monotone, ends at (total, total)
                            on_batch((ci * total + done) // n_chunks, total)

                    null = np.empty((total, *obs_c.shape), dtype=np.float64)
                    fill(activity[rows], null, tick)
                    st_c = summarize(null, obs_c)
                    parts.append(st_c)
                    if config.correction == "max_stat":
                        adj_c, note = _correct(
                            st_c["p"], obs_c, null, tail, config.correction, config.correction_scope
                        )
                        adj_parts.append(adj_c)
                    del null
            finally:
                caught_chunks = list(rec_chunks)
        _reissue(caught_chunks)  # once per run, not once per chunk
        st = {k: np.concatenate([q[k] for q in parts], axis=0) for k in parts[0]}
        p = st["p"]
        if config.correction == "max_stat":
            p_adj = np.concatenate(adj_parts, axis=0)
        else:
            p_adj, note = _correct(
                p, observed, np.empty((0,)), tail, config.correction, config.correction_scope
            )
        null_out = None
    lo, hi = st["lo"], st["hi"]
    null_median, null_mean, null_std = st["median"], st["mean"], st["std"]
    info = null_plugin.diagnostics(activity, target, mask, fs, shifts)
    info = dict(info or {})
    if n_chunks > 1:
        info["chunks"] = n_chunks
    return ShuffleResult(
        observed=observed,
        null=null_out,
        null_median=null_median,
        null_mean=null_mean,
        null_std=null_std,
        null_info=info,
        shifts=shifts,
        p_value=p,
        null_lo=lo,
        null_hi=hi,
        significant=np.where(np.isfinite(p), p < config.alpha, False),
        p_adj=p_adj,
        significant_adj=np.where(np.isfinite(p_adj), p_adj < config.alpha, False),
        correction=config.correction,
        correction_scope=config.correction_scope,
        correction_note=note or "",
        alpha=config.alpha,
        tail=tail,
        n_shuffles=config.n_shuffles,
        null_name=null_plugin.name,
    )


__all__ = [
    "RunCancelled",
    "ShuffleConfig",
    "Tail",
    "adjust_p_values",
    "draw_shifts",
    "plan_chunks",
    "shifted_sums",
    "shuffle_test",
]
