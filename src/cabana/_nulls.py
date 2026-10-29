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
* ``covariate_matched_shift`` is ``circular_shift`` restricted to shifts under
  which a nuisance covariate (e.g. speed) is distributed as observed within
  every state, so the null cannot be beaten merely by tracking the covariate.
* ``cell_shift`` rolls every cell by its own offset; breaks cell-cell
  co-fluctuation (null for population metrics).
* ``within_state_shuffle`` permutes activity frames inside each state; keeps
  state-mean activity, destroys within-state temporal structure.
"""

from __future__ import annotations

import warnings
from collections.abc import Iterator
from typing import Any, ClassVar, Literal

import numpy as np
from pydantic import Field, PrivateAttr

from ._models import Session, StateSpace
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


def _shift_bounds(n_time: int, min_shift: int) -> tuple[int, int]:
    """Inclusive ``(lo, hi)`` range of allowed shifts (same clamping as :func:`draw_shifts`)."""
    if n_time < 4:
        raise ValueError("need at least 4 frames to shuffle")
    min_shift = int(max(1, min(min_shift, (n_time - 1) // 2)))
    return min_shift, n_time - min_shift


def _ks_stat(sorted_a: np.ndarray, sorted_b: np.ndarray) -> float:
    """Two-sample Kolmogorov-Smirnov statistic of two sorted samples (pure numpy)."""
    pooled = np.concatenate([sorted_a, sorted_b])
    fa = np.searchsorted(sorted_a, pooled, side="right") / sorted_a.size
    fb = np.searchsorted(sorted_b, pooled, side="right") / sorted_b.size
    return float(np.max(np.abs(fa - fb)))


@register("null")
class CovariateMatchedShift(CircularShift):
    """Circular shift restricted to shifts that keep a covariate balanced across states.

    A plain circular shift can look "significant" for a trivial reason: if a
    cell fires with speed and the animal is faster in state A than in state B,
    *any* shift that keeps the speed profile roughly aligned with state labels
    produces different per-state means than a shift that does not.  This null
    keeps only the shifts under which, for every state ``s`` with at least
    ``min_frames`` masked frames, the covariate seen by the shifted activity
    over the frames of ``s`` -- ``covariate[(t - k) mod n]`` for ``t`` in state
    ``s`` and in the mask -- has the same distribution as the observed
    covariate over those frames.  For a signal target (one group) all masked
    frames are matched together.

    The match is measured by ``statistic``: ``"ks"`` is the two-sample
    Kolmogorov-Smirnov statistic (max distance between the CDFs, in [0, 1]);
    ``"mean"`` is ``|difference of means| / pooled std``.  A candidate shift
    is accepted when the statistic is at most ``tolerance`` in *every* state.
    Candidates are drawn exactly like ``circular_shift`` (so ``min_shift_s``
    applies), in random order without replacement, until ``n`` are accepted.

    Preserves both time series' autocorrelation (it is a plain shift) and
    additionally the per-state covariate distribution.  Use when a behavior
    state is confounded with a continuous nuisance variable such as speed.
    Because the surrogate is still ``np.roll(activity, k)``, the **fast path
    (``compute_shifted``) applies** and metrics run as quickly as under
    ``circular_shift``; only the shift draw is more expensive.

    Diagnostics (``ShuffleResult.null_info``): ``acceptance_rate`` (accepted
    over candidates examined), ``n_candidates``, ``balance_max`` (largest
    statistic over all accepted shifts and states; at most ``tolerance``),
    ``balance_mean`` (mean over accepted shifts of the worst-state statistic),
    plus ``covariate``, ``statistic`` and ``tolerance``.  Compare with
    :meth:`balance` applied to unconstrained shifts to see how much the
    constraint matters.  A low acceptance rate means the covariate is strongly
    tied to the state labels; loosen ``tolerance`` or use ``statistic="mean"``.
    If all distinct shifts are examined and fewer than ``n`` pass, the accepted
    shifts are reused (with a warning, as for ``circular_shift``); if
    ``n * max_tries`` candidates are examined first, or none passes, a
    ``ValueError`` is raised.

    The null is bound to the analysis it was configured for: ``Pipeline``
    calls ``configure(session, spec)``, which reads ``session.signals[covariate]``
    and the target's state membership and mask.  Missing (NaN) covariate
    frames are replaced by the covariate median.
    """

    name: ClassVar[str] = "covariate_matched_shift"
    perturbs: ClassVar[Literal["activity", "target"]] = "activity"

    covariate: str = Field("speed", description="Name of the signal in session.signals to match.")
    channel: int | None = Field(
        None,
        description="Column of the covariate when it is 2-D (required then).",
        json_schema_extra={"ui": {"sweepable": False}},
    )
    statistic: Literal["ks", "mean"] = Field(
        "ks", description="Balance statistic: KS distance or |d mean| / pooled std."
    )
    tolerance: float = Field(0.1, gt=0, description="Largest allowed statistic in every state.")
    max_tries: int = Field(
        20, ge=1, description="Candidates examined per requested shift before giving up."
    )
    min_frames: int = Field(
        50, ge=1, description="States with fewer masked frames are not matched."
    )

    _cov: np.ndarray | None = PrivateAttr(None)
    _groups: list[np.ndarray] | None = PrivateAttr(None)
    _stats: dict[str, Any] = PrivateAttr(default_factory=dict)

    def configure(self, session: Session, spec: Any) -> CovariateMatchedShift:
        sigs = session.signals
        if self.covariate not in sigs:
            raise KeyError(
                f"covariate_matched_shift: no signal {self.covariate!r} in the session; "
                f"available signals: {sorted(sigs)}"
            )
        cov = np.asarray(sigs[self.covariate], dtype=np.float64)
        if cov.ndim == 2:
            if self.channel is None:
                raise ValueError(
                    f"covariate {self.covariate!r} has {cov.shape[1]} channels; set channel="
                )
            cov = cov[:, self.channel]
        elif cov.ndim != 1:
            raise ValueError(f"covariate {self.covariate!r} must be 1-D or 2-D")
        bad = ~np.isfinite(cov)
        if bad.all():
            raise ValueError(f"covariate {self.covariate!r} has no finite values")
        if bad.any():
            cov = np.where(bad, np.median(cov[~bad]), cov)
        listed = list(getattr(spec, "masks", None) or [])
        mask = session.valid_mask(listed)
        states = getattr(spec, "states", None)
        groups: list[np.ndarray] = []
        if states is not None:
            target = session.states[states]
            if target.support is not None:
                mask = mask & target.support
            for s in range(target.n_states):
                idx = np.flatnonzero(target.onehot[:, s] & mask)
                if idx.size >= self.min_frames:
                    groups.append(idx)
        else:
            idx = np.flatnonzero(mask)
            if idx.size >= self.min_frames:
                groups.append(idx)
        if not groups:
            raise ValueError(
                f"covariate_matched_shift: no state has at least min_frames={self.min_frames} "
                "masked frames; lower min_frames"
            )
        bound = self.model_copy()
        bound._cov = cov
        bound._groups = groups
        bound._stats = {}
        return bound

    def _bound(self, n_time: int) -> tuple[np.ndarray, list[np.ndarray]]:
        if self._cov is None or self._groups is None:
            raise RuntimeError(
                "covariate_matched_shift needs the session: run it through Pipeline or call "
                ".configure(session, spec)"
            )
        if self._cov.shape[0] != n_time:
            raise ValueError(
                f"covariate has {self._cov.shape[0]} frames but the activity has {n_time}"
            )
        return self._cov, self._groups

    def balance(self, shifts: np.ndarray) -> np.ndarray:
        """Worst-state balance statistic of each shift, shape ``(len(shifts),)``.

        Useful to compare accepted shifts against unconstrained ones.
        """
        if self._cov is None:
            self._bound(0)  # raises the "needs the session" error
        cov, groups = self._bound(self._cov.shape[0])
        return self._stat_matrix(cov, groups, np.asarray(shifts, dtype=np.int64)).max(axis=1)

    def _stat_matrix(
        self, cov: np.ndarray, groups: list[np.ndarray], shifts: np.ndarray
    ) -> np.ndarray:
        """Statistic per (shift, group), shape ``(n_shifts, n_groups)``."""
        n = cov.shape[0]
        out = np.empty((shifts.size, len(groups)))
        for g, idx in enumerate(groups):
            obs = cov[idx]
            so = np.sort(obs)
            if self.statistic == "mean":
                mo, vo = obs.mean(), obs.var()
            if self.statistic == "ks":
                # gather + row-wise sort in chunks (bounded memory); observed side sorted once
                for lo in range(0, shifts.size, 64):
                    ks_ = shifts[lo : lo + 64]
                    sb = np.sort(cov[(idx[None, :] - ks_[:, None]) % n], axis=1)
                    for i in range(ks_.size):
                        out[lo + i, g] = _ks_stat(so, sb[i])
                continue
            for i, k in enumerate(shifts):
                shifted = cov[(idx - int(k)) % n]
                sd = np.sqrt((vo + shifted.var()) / 2)
                diff = abs(shifted.mean() - mo)
                out[i, g] = diff / sd if sd > 0 else (0.0 if diff == 0 else np.inf)
        return out

    def draw(self, n_time: int, fs: float, n: int, rng: np.random.Generator) -> np.ndarray:
        cov, groups = self._bound(n_time)
        lo, hi = _shift_bounds(n_time, int(round(self.min_shift_s * fs)))
        order = rng.permutation(np.arange(lo, hi + 1))
        budget = min(order.size, n * self.max_tries)
        block = 64
        kept: list[np.ndarray] = []
        kept_stat: list[np.ndarray] = []
        n_kept = 0
        examined = 0
        pos = 0
        while n_kept < n and pos < budget:
            cand = order[pos : min(pos + block, budget)]
            stat = self._stat_matrix(cov, groups, cand)
            ok = stat.max(axis=1) <= self.tolerance
            need = n - n_kept
            if ok.sum() >= need:
                last = int(np.flatnonzero(ok)[need - 1])
                examined += last + 1
                ok[last + 1 :] = False
            else:
                examined += cand.size
            kept.append(cand[ok])
            kept_stat.append(stat[ok])
            n_kept += int(ok.sum())
            pos += cand.size
        accepted = np.concatenate(kept) if kept else np.empty(0, dtype=order.dtype)
        astat = np.concatenate(kept_stat) if kept_stat else np.empty((0, len(groups)))
        rate = accepted.size / max(examined, 1)
        if accepted.size < n:
            exhausted = order.size <= n * self.max_tries and accepted.size > 0
            if not exhausted:
                raise ValueError(
                    f"covariate_matched_shift accepted {accepted.size} of {examined} candidate "
                    f"shifts (acceptance rate {rate:.3g}); needed {n} within "
                    f"max_tries={self.max_tries} per shift. Loosen tolerance "
                    f"(currently {self.tolerance} on the {self.statistic!r} statistic)"
                    + (', use statistic="mean"' if self.statistic != "mean" else "")
                    + ", lower min_frames, or raise max_tries. A state that is itself "
                    "defined by the covariate (e.g. speed-based syllables) can never be matched."
                )
            warnings.warn(
                f"covariate_matched_shift: only {accepted.size} distinct shifts pass the "
                f"balance criterion (acceptance rate {rate:.3g}) for n_shuffles={n}; shifts are "
                f"reused and the smallest attainable p-value is 1/({accepted.size}+1) = "
                f"{1.0 / (accepted.size + 1):.4g}; loosen tolerance or use statistic='mean'",
                UserWarning,
                stacklevel=2,
            )
            fill = rng.integers(0, accepted.size, size=n - accepted.size)
            accepted = np.concatenate([accepted, accepted[fill]])
            astat = np.concatenate([astat, astat[fill]])
        worst = astat.max(axis=1)
        self._stats.update(
            acceptance_rate=float(rate),
            n_candidates=int(examined),
            balance_max=float(worst.max()),
            balance_mean=float(worst.mean()),
        )
        return accepted.astype(np.int64)

    def diagnostics(self, activity, target, mask, fs, shifts) -> dict[str, Any]:
        info: dict[str, Any] = {
            "acceptance_rate": float("nan"),
            "n_candidates": 0,
            "balance_max": float("nan"),
            "balance_mean": float("nan"),
        }
        info.update(self._stats)
        if not self._stats and shifts is not None and self._cov is not None:
            worst = self.balance(shifts)
            info["balance_max"], info["balance_mean"] = float(worst.max()), float(worst.mean())
        info.update(covariate=self.covariate, statistic=self.statistic, tolerance=self.tolerance)
        return info


@register("null")
class CellShift(Null):
    """Roll every cell by its own independent random offset.

    Each cell's row of the activity matrix is rolled circularly by a shift
    drawn uniformly from ``[min_shift_s, n_time - min_shift_s]`` (frames),
    independently across cells.  Preserves each cell's own autocorrelation,
    its marginal distribution and its relation to the time axis (and so to the
    mask and to slow drifts shared with nothing); destroys every cell-cell
    co-fluctuation.  The behavior target is untouched.

    Use as the null for population metrics (``pairwise_correlation``,
    ``participation_ratio``, population-vector metrics), where the question is
    whether cells are coordinated beyond what their individual statistics
    imply.  For single-cell tuning prefer ``circular_shift``, which has a fast
    path and shifts the whole population together.  No fast path: the metric is recomputed on every
    surrogate.

    The per-cell shifts are drawn *without replacement*, so no two cells share
    a shift (identical shifts would leave those two cells' co-fluctuation
    intact and bias the null toward the observed value).  Two cells whose
    shifts differ by only a few frames still stay almost aligned; set
    ``min_pair_separation_s > 0`` to require every pair of shifts to differ by
    at least that long (circular distance).  Residual limitation: with many
    cells and a short session the requirement may be unsatisfiable; then, after a
    bounded number of attempts the separation is dropped (distinct shifts only)
    and a ``UserWarning`` is issued.  If there are more cells than distinct allowed shifts, shifts are
    drawn with replacement (with a warning).
    """

    name: ClassVar[str] = "cell_shift"
    perturbs: ClassVar[Literal["activity", "target"]] = "activity"
    cell_separable: ClassVar[bool] = False  # the per-cell shifts are drawn jointly

    min_shift_s: float = Field(
        20.0,
        ge=0,
        description="Smallest allowed |shift| in seconds (clamped below half the session).",
    )
    min_pair_separation_s: float = Field(
        0.0,
        ge=0,
        description="Minimum circular distance (s) between any two cells' shifts; 0 = distinct only.",
    )

    _MAX_REDRAWS: ClassVar[int] = 100

    def surrogate(self, activity, target, mask, fs, rng) -> tuple[np.ndarray, Target]:
        act = np.asarray(activity, dtype=np.float64)
        n_cells, n_time = act.shape
        lo, hi = _shift_bounds(n_time, int(round(self.min_shift_s * fs)))
        pool = np.arange(lo, hi + 1)
        sep = int(round(self.min_pair_separation_s * fs))
        replace = pool.size < n_cells
        if replace:
            warnings.warn(
                f"cell_shift: only {pool.size} distinct shifts for {n_cells} cells; shifts are "
                "drawn with replacement so some cells share a shift; lower min_shift_s or use a "
                "longer recording",
                UserWarning,
                stacklevel=2,
            )
        k = rng.choice(pool, size=n_cells, replace=replace)
        if sep > 0 and n_cells > 1:
            room = pool.size - (n_cells - 1) * sep  # sorted shifts compressed by the gaps
            ok = False
            if room >= n_cells:
                for _ in range(self._MAX_REDRAWS):  # redraw only if the wrap-around gap is short
                    u = np.sort(rng.choice(room, size=n_cells, replace=False))
                    cand = lo + u + np.arange(n_cells) * sep
                    if cand[0] + n_time - cand[-1] >= sep:
                        k = rng.permutation(cand)
                        ok = True
                        break
            if not ok:
                warnings.warn(
                    f"cell_shift: cannot separate {n_cells} cells' shifts by "
                    f"min_pair_separation_s={self.min_pair_separation_s} within the allowed "
                    "range; using distinct shifts without the separation guarantee",
                    UserWarning,
                    stacklevel=2,
                )
        idx = (np.arange(n_time)[None, :] - k[:, None]) % n_time
        return np.take_along_axis(act, idx, axis=1), target


@register("null")
class WithinStateShuffle(Null):
    """Permute activity frames within each state of an exclusive state space.

    For every state the frames that are in the state *and* in the mask are
    permuted among themselves (all cells together, so cell-cell structure at a
    frame is kept); frames outside any state or outside the mask stay in
    place.  With ``block_s > 0`` the in-state frames are cut into contiguous
    blocks (by position among that state's masked frames) and the blocks are
    permuted, which keeps short-timescale autocorrelation.

    Preserves exactly each state's frame set and per-state activity sums, so
    state-mean metrics (``mean_per_state``) equal their observed value on
    every surrogate.  Destroys within-state temporal structure: timing
    relative to bout onsets (PETH), sub-state tuning and anything that depends
    on *when* inside a state activity occurs.  It therefore tests "is the
    within-state structure more than exchangeable?", and is not a test of
    state tuning itself (use ``circular_shift`` or ``label_shuffle`` for
    that).  Needs an exclusive state space; not defined for signal targets.
    No fast path.

    Which metrics it is informative for: a metric that depends only on the
    multiset of activity values within each state (``mean_per_state``,
    ``auroc``, ``information_content``, ``tuning_selectivity``) is exactly
    invariant under this null, so its p-values are meaningless (``check_target``
    warns).  Use it for order-dependent metrics: ``split_half_stability``,
    PETH timing, within-state ``signal_correlation``, ``decode_signal``.

    With ``block_s > 0`` a state whose masked frames fit in a single block (fewer
    than two blocks) cannot be reordered and is left unshuffled; a
    ``UserWarning`` names such states (once per run in ``shuffle_test``).
    """

    _INVARIANT: ClassVar[frozenset[str]] = frozenset(
        {"mean_per_state", "auroc", "information_content", "tuning_selectivity"}
    )

    name: ClassVar[str] = "within_state_shuffle"
    perturbs: ClassVar[Literal["activity", "target"]] = "activity"

    block_s: float = Field(
        0.0, ge=0, description="Block length in seconds; 0 permutes single frames."
    )

    def check_target(self, metric: Metric, target: Target) -> None:
        if not isinstance(target, StateSpace):
            raise ValueError("within_state_shuffle needs a StateSpace target (not a signal)")
        if not target.exclusive:
            raise ValueError(
                "within_state_shuffle needs an exclusive StateSpace (states must not overlap)"
            )
        mname = getattr(metric, "name", None)
        if mname in self._INVARIANT:
            warnings.warn(
                f"within_state_shuffle leaves {mname!r} exactly invariant (it depends only on "
                "the per-state multiset of activity values), so its p-values are meaningless; "
                "use an order-dependent metric or another null",
                UserWarning,
                stacklevel=2,
            )

    def surrogate(self, activity, target, mask, fs, rng) -> tuple[np.ndarray, Target]:
        if not isinstance(target, StateSpace) or not target.exclusive:
            self.check_target(None, target)  # type: ignore[arg-type]
        assert isinstance(target, StateSpace)
        act = np.asarray(activity, dtype=np.float64)
        out = act.copy()
        m = np.ones(act.shape[1], bool) if mask is None else np.asarray(mask, dtype=bool)
        block = int(round(self.block_s * fs))
        stuck: list[str] = []
        for s in range(target.n_states):
            idx = np.flatnonzero(target.onehot[:, s] & m)
            if idx.size < 2:
                continue
            if block > 1 and idx.size <= block:
                stuck.append(str(target.state_names[s]))
                continue
            perm = (
                rng.permutation(idx.size)
                if block <= 1
                else _block_permutation(idx.size, block, rng)
            )
            out[:, idx] = act[:, idx[perm]]
        if stuck:
            warnings.warn(
                f"within_state_shuffle: states {stuck} have fewer than 2 blocks of "
                f"block_s={self.block_s} s among their masked frames and were left unshuffled",
                UserWarning,
                stacklevel=2,
            )
        return out, target


__all__ = [
    "BoutShuffle",
    "CellShift",
    "CircularShift",
    "CovariateMatchedShift",
    "LabelShuffle",
    "WithinStateShuffle",
    "draw_shifts",
]
