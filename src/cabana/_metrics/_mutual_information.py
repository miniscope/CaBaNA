"""Mutual information between a cell's activity level and a discrete state."""

from __future__ import annotations

from typing import ClassVar, Literal

import numpy as np
from pydantic import Field

from .._models import StateSpace
from .._registry import Metric, register
from .._results import Tail
from .._shuffle import shifted_sums
from ._discretize import activity_levels, joint_counts, level_edges, level_indicator
from ._ratemap import valid_states

_LN2 = float(np.log(2.0))


def mutual_information_from_counts(
    counts: np.ndarray, bias_correction: Literal["none", "miller_madow"] = "none"
) -> np.ndarray:
    """Plug-in mutual information (bits) over the last two axes.

    Parameters
    ----------
    counts : (..., n_states, n_levels) float
        Joint counts ``n(s, l)``.
    bias_correction : {"none", "miller_madow"}
        ``"miller_madow"`` adds ``[(Ks - 1) + (Kl - 1) - (Kj - 1)] / (2 N ln 2)``
        where ``Ks``, ``Kl``, ``Kj`` are the numbers of non-empty state, level and
        joint cells (the Miller-Madow entropy correction applied to
        ``H(S) + H(L) - H(S, L)``); it lowers the estimate.

    Returns
    -------
    (...) float
        ``sum p(s,l) log2[p(s,l) / (p(s) p(l))]`` with ``0 log 0 = 0``; NaN
        where the total count is zero.
    """
    n = np.asarray(counts, dtype=np.float64)
    total = n.sum(axis=(-2, -1))
    ns = n.sum(axis=-1, keepdims=True)
    nl = n.sum(axis=-2, keepdims=True)
    with np.errstate(divide="ignore", invalid="ignore"):
        ratio = n * total[..., None, None] / (ns * nl)
        mi = np.where(n > 0, n * np.log2(ratio), 0.0).sum(axis=(-2, -1)) / total
        if bias_correction == "miller_madow":
            ks = (ns[..., 0] > 0).sum(axis=-1)
            kl = (nl[..., 0, :] > 0).sum(axis=-1)
            kj = (n > 0).sum(axis=(-2, -1))
            mi = mi + (ks + kl - kj - 1) / (2.0 * total * _LN2)
    return np.where(total > 0, mi, np.nan)


@register("metric")
class MutualInformation(Metric):
    """Mutual information (bits) between activity level and state, per cell.

    Each cell's activity is discretised into ``n_levels`` levels (see
    :mod:`cabana._metrics._discretize`); for non-negative activity level 0 is
    exactly "silent" and the other levels split the positive values.  With
    ``n(s, l)`` the number of masked frames in valid state ``s`` at level
    ``l`` and ``N`` their total,

    ``I = sum_{s,l} p(s,l) log2[ p(s,l) / (p(s) p(l)) ]``.

    Unlike Skaggs information it sees the whole amplitude distribution per
    state, not just its mean.  Bin edges are fitted once on the observed
    (unshifted) masked activity and reused for every circular shift, so the
    null is binned identically.  States with less than ``min_occupancy_s``
    seconds of masked occupancy are dropped from the computation.  A cell with
    no positive activity in the masked frames, or a session with no valid
    state, gives NaN.  Requires an exclusive state space and finite activity.

    ``bias_correction="miller_madow"`` removes the leading ``O(1/N)``
    plug-in bias.  The default is ``"none"`` because the shuffle null carries
    the same bias as the observed value, so the comparison is already fair.
    ``units="bits_per_event"`` divides by the fraction of masked, valid-state
    frames with positive activity (NaN if zero).

    Parameters
    ----------
    n_levels : int, default 5
        Number of activity levels (>= 2); ignored for ``binning="binary"``.
    binning : {"quantile", "log", "linear", "binary"}, default "quantile"
        How level edges are chosen from the observed masked activity;
        ``"binary"`` gives two levels (zero / positive).
    units : {"bits", "bits_per_event"}, default "bits"
        ``"bits_per_event"`` divides by the fraction of masked, valid-state frames
        with positive activity.
    min_occupancy_s : float, default 0.05
        States with less masked occupancy (s) are dropped.
    bias_correction : {"none", "miller_madow"}, default "none"
        Plug-in estimate, or with the Miller-Madow correction.

    Returns
    -------
    numpy.ndarray
        ``compute`` returns shape ``(n_cells,)`` in bits (or bits per event); NaN
        for silent cells or when no state is valid.

    Notes
    -----
    **Tail.**  ``"upper"``: mutual information is non-negative, so only values
    above the shuffled null indicate coupling.

    **State space.**  Requires an *exclusive* state space (``ValueError``
    otherwise); no topology needed.  Activity must be finite (``ValueError`` on
    NaN/inf) and may be of any kind, since levels are discretised from the data.

    Everything derived from the data (level edges, the silent-cell flag and the
    ``bits_per_event`` divisor) is fixed from the observed, unshifted, masked
    data and reused for every surrogate.  With a gappy mask
    ``compute_shifted(k)`` is therefore *not* ``compute(np.roll(activity, k))``
    by design (the latter would refit edges and scale on the rolled data): the
    null compares the same discretisation and the same scale.

    Memory: each level of ``compute_shifted`` holds a few
    ``(batch, n_cells, n_valid_states)`` float temporaries;
    ``ShuffleConfig.batch_size`` bounds this at about
    ``4 * batch * cells * states * 8`` bytes.

    ``extras`` returns ``joint`` ``(n_cells, n_states, n_levels)`` counts
    (zero for invalid states), ``conditional`` ``p(level | state)`` of the same
    shape (NaN for invalid states), ``edges`` ``(n_cells, n_levels + 1)``,
    ``occupancy_s`` ``(n_states,)`` and ``valid`` ``(n_states,)`` bool.
    """

    name: ClassVar[str] = "mutual_information"
    default_tail: ClassVar[Tail] = "upper"

    n_levels: int = Field(5, ge=2, description="Number of activity levels (ignored for 'binary').")
    binning: Literal["quantile", "log", "linear", "binary"] = Field(
        "quantile", description="How activity level edges are chosen."
    )
    units: Literal["bits", "bits_per_event"] = Field(
        "bits", description="bits, or bits per event (divided by fraction of positive frames)."
    )
    min_occupancy_s: float = Field(
        0.05, ge=0, description="Minimum masked occupancy (s) for a state to be used."
    )
    bias_correction: Literal["none", "miller_madow"] = Field(
        "none", description="Plug-in estimate, or Miller-Madow bias correction."
    )

    def check_target(self, target: StateSpace) -> None:
        super().check_target(target)
        self.require_exclusive(target)

    @property
    def _n_eff(self) -> int:
        return 2 if self.binning == "binary" else self.n_levels

    def _prepare(self, activity, states, mask, fs):
        """Common setup: masked indicators, valid states, edges, levels, per-cell scale."""
        self.check_target(states)
        a = np.asarray(activity, dtype=np.float64)
        if not np.isfinite(a).all():
            raise ValueError("metric 'mutual_information': needs finite activity (found NaN/inf)")
        mask = np.asarray(mask, dtype=bool)
        m = states.masked(mask)
        occ = m.sum(axis=0)
        valid = valid_states(occ, fs, self.min_occupancy_s)
        edges = level_edges(a, mask, self._n_eff, self.binning)
        levels = activity_levels(a, edges)
        used = m[:, valid].any(axis=1) if valid.any() else np.zeros(a.shape[1], bool)
        pos = a[:, used] > 0
        silent = ~pos.any(axis=1)
        scale = np.ones(a.shape[0])
        if self.units == "bits_per_event":
            with np.errstate(invalid="ignore", divide="ignore"):
                scale = 1.0 / pos.mean(axis=1) if pos.shape[1] else np.full(a.shape[0], np.nan)
        return m, occ, valid, edges, levels, silent, scale

    def _finish(self, mi, silent, scale):
        mi = np.where(silent, np.nan, mi * scale)
        return np.where(np.isfinite(scale), mi, np.nan)

    def compute(self, activity, states, mask, fs):
        m, occ, valid, _, levels, silent, scale = self._prepare(activity, states, mask, fs)
        if not valid.any():
            return np.full(levels.shape[0], np.nan)
        counts = joint_counts(levels, m[:, valid], self._n_eff)
        mi = mutual_information_from_counts(counts, self.bias_correction)
        return self._finish(mi, silent, scale)

    def compute_shifted(self, activity, states, mask, fs, shifts):
        m, occ, valid, _, levels, silent, scale = self._prepare(activity, states, mask, fs)
        shifts = np.asarray(shifts, dtype=np.int64)
        n_cells = levels.shape[0]
        if not valid.any():
            return np.full((shifts.size, n_cells), np.nan)
        cols = m[:, valid]
        occ_v = occ[valid].astype(np.float64)
        total = occ_v.sum()
        acc = np.zeros((shifts.size, n_cells))
        k_joint = np.zeros((shifts.size, n_cells))
        k_level = np.zeros((shifts.size, n_cells))
        with np.errstate(divide="ignore", invalid="ignore"):
            for k in range(self._n_eff):
                n_k = shifted_sums(level_indicator(levels, k), cols, shifts)  # (S, C, V)
                n_l = n_k.sum(axis=-1, keepdims=True)
                pos = n_k > 0
                k_joint += pos.sum(axis=-1)
                k_level += n_l[..., 0] > 0
                n_l = n_l * occ_v  # (S, C, V): n(l) * n(s)
                r = n_k * total
                np.divide(r, n_l, out=r, where=pos)
                r[~pos] = 1.0  # log2(1) = 0 makes empty cells drop out
                np.log2(r, out=r)
                r *= n_k
                acc += r.sum(axis=-1)
        mi = acc / total
        if self.bias_correction == "miller_madow":
            mi = mi + (valid.sum() + k_level - k_joint - 1) / (2.0 * total * _LN2)
        return self._finish(mi, silent[None], scale[None])

    def extras(self, activity, states, mask, fs):
        m, occ, valid, edges, levels, _, _ = self._prepare(activity, states, mask, fs)
        joint = joint_counts(levels, m, self._n_eff)
        joint[:, ~valid, :] = 0.0
        tot = joint.sum(axis=-1, keepdims=True)
        with np.errstate(divide="ignore", invalid="ignore"):
            cond = np.where(tot > 0, joint / tot, np.nan)
        cond[:, ~valid, :] = np.nan
        return {
            "joint": joint,
            "conditional": cond,
            "edges": edges,
            "occupancy_s": occ / fs,
            "valid": valid,
        }
