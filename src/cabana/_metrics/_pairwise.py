"""Population-level pairwise structure: cell-cell correlations and participation ratio.

Both metrics work on the frames x cells matrix of the *masked* frames.  Neither
has a ``compute_shifted`` fast path, and neither is meaningfully tested with a
*common* circular shift (see each class's **Null** note): rolling all cells
together leaves every pairwise statistic and the covariance spectrum unchanged
(exactly so when the mask keeps every frame).  Use the independent per-cell
shift null (``cell_shift``) to ask whether the structure exceeds what
independently time-shifted cells (same autocorrelation, no coordination) give.
"""

from __future__ import annotations

from typing import ClassVar, Literal

import numpy as np
from pydantic import Field, PrivateAttr
from scipy.stats import rankdata

from .._models import Session, StateSpace
from .._registry import Metric, register
from .._results import Tail
from .._statesums import masked_counts, state_sums

_FLAT_TOL = 1e-20


def _zscore_frames(activity: np.ndarray, mask: np.ndarray, zscore: bool) -> np.ndarray:
    """``(n_masked, n_cells)`` float64 frames matrix, optionally z-scored per cell."""
    x = np.asarray(activity, dtype=np.float64)[:, np.asarray(mask, dtype=bool)].T
    if zscore and x.shape[0] > 0:
        sd = x.std(axis=0)
        x = (x - x.mean(axis=0)) / np.where(sd > 1e-12, sd, 1.0)
    return x


def _corr(x: np.ndarray) -> np.ndarray:
    """Pearson correlation between the columns of ``x`` (diagonal and flat columns NaN)."""
    n, c = x.shape
    out = np.full((c, c), np.nan)
    if n < 2 or c == 0:
        return out
    xc = x - x.mean(axis=0, keepdims=True)
    ss = (xc * xc).sum(axis=0)
    scale = max(float(np.abs(x).max(initial=0.0)), 1e-300)
    ok = ss > _FLAT_TOL * n * scale * scale
    if ok.sum() >= 1:
        xo = xc[:, ok] / np.sqrt(ss[ok])
        r = np.clip(xo.T @ xo, -1.0, 1.0)
        out[np.ix_(ok, ok)] = r
    np.fill_diagonal(out, np.nan)
    return out


def _group_means(x: np.ndarray, lab: np.ndarray, n_states: int) -> np.ndarray:
    """Mean of rows of ``x`` per label ``(n_states, c)`` (NaN for empty); ``lab >= 0``."""
    out = np.full((n_states, x.shape[1]), np.nan)
    if lab.size == 0:
        return out
    order = np.argsort(lab, kind="stable")
    sl = lab[order]
    starts = np.flatnonzero(np.r_[True, sl[1:] != sl[:-1]])
    sums = np.add.reduceat(x[order], starts, axis=0)
    counts = np.diff(np.r_[starts, sl.size])
    out[sl[starts]] = sums / counts[:, None]
    return out


def _upper_mean(r: np.ndarray) -> float:
    iu = np.triu_indices(r.shape[-1], k=1)
    v = r[iu]
    return float(np.nanmean(v)) if np.isfinite(v).any() else float("nan")


@register("metric")
class PairwiseCorrelation(Metric):
    """Cell-cell correlation matrix: total, signal (tuning) or noise correlations.

    Output ``(n_cells, n_cells)`` symmetric with a NaN diagonal; pairs involving
    a cell with zero variance are NaN.  ``compute`` always returns this 2-D
    matrix; the per-state stack is an extra.

    Parameters
    ----------
    kind : {"total", "noise", "signal"}, default "total"
        ``"total"``: Pearson/Spearman correlation of the cells' activity across
        all masked frames (state labels are not used).  ``"signal"``: correlation
        between the cells' *per-state mean* vectors across the valid states
        (tuning similarity; needs >= 2 valid states).  ``"noise"``: correlation
        across masked frames *after subtracting each cell's state mean* from
        every frame of that state, i.e. the shared trial-to-trial (frame-to-frame)
        variability once state-locked tuning is removed.  Frames outside any
        state, and frames in states below ``min_frames``, are dropped.
    method : {"pearson", "spearman"}, default "pearson"
        Spearman ranks the data first: ranks of the masked frames (``total``,
        ranked within each state for ``per_state``), ranks of the frames in valid
        states before mean subtraction (``noise``), or ranks of the state-mean
        vectors across states (``signal``).
    min_frames : int, default 50
        A state is valid with at least this many masked frames; the whole
        matrix is NaN when fewer than ``min_frames`` frames (``total``,
        ``noise``) are available.
    states_as : {"all", "per_state"}, default "all"
        ``"per_state"`` additionally puts the within-state correlation matrices
        ``(n_states, n_cells, n_cells)`` in the ``per_state`` extra (NaN for
        invalid states).  Only for ``total`` and ``noise`` (within-state
        correlations are mean-subtracted already); ``signal`` raises.
    zscore : bool, default True
        Z-score every cell over the masked frames first.  It does not change any
        correlation; it puts the ``state_means`` extra in standard units.

    Returns
    -------
    numpy.ndarray
        ``compute`` returns ``(n_cells, n_cells)``.

    Notes
    -----
    **Tail.**  ``"two"``: both strongly positive and strongly negative coupling
    are findings.  The tested statistic is the full matrix, so use a
    per-pair family correction, or test the summary ``mean_offdiag`` extra.

    **State space.**  ``total`` and ``signal`` accept any state space (the former
    ignores it, the latter averages over frames of every state a frame belongs
    to).  ``noise`` needs an *exclusive* one (``ValueError`` otherwise).

    **Null.**  Use ``cell_shift`` (each cell rolled independently).  The
    default ``circular_shift`` rolls all cells together, which preserves
    ``total`` and ``noise`` correlations exactly (the surrogate equals the
    observed matrix when the mask keeps all frames), so its p-values are
    meaningless for them.  ``signal`` is the exception: a common shift breaks
    the alignment to the state labels and so tests the tuning structure.
    ``compute_shifted`` is not implemented (shifts act before masking, so the
    result is not a simple function of precomputed sums).

    Extras: ``n_frames`` (frames used), ``mean_offdiag`` (mean of the upper
    triangle, the usual summary; NaN if undefined), ``state_means``
    ``(n_cells, n_states)`` mean activity per state (``signal``/``noise``; NaN for
    invalid states), ``per_state`` (when requested) and ``group_names`` (cell
    ids, labelling both matrix axes) once the pipeline has called ``configure``.
    """

    name: ClassVar[str] = "pairwise_correlation"
    values_axes: ClassVar[tuple[str | None, ...] | None] = ("cell", "cell")
    extras_axes: ClassVar[dict[str, tuple[str | None, ...]]] = {
        "n_frames": (),
        "mean_offdiag": (),
        "state_means": ("cell", "state"),
        "per_state": ("state", "cell", "cell"),
        "group_names": ("cell",),
    }
    level: ClassVar[Literal["cell", "population"]] = "population"
    default_tail: ClassVar[Tail] = "two"
    default_plots: ClassVar[tuple[str, ...]] = ("pairwise_matrix", "population_matrix")

    kind: Literal["total", "noise", "signal"] = Field(
        "total", description="Total, signal (tuning) or noise correlations."
    )
    method: Literal["pearson", "spearman"] = Field("pearson", description="Correlation type.")
    min_frames: int = Field(50, ge=1, description="Minimum masked frames per state / overall.")
    states_as: Literal["all", "per_state"] = Field(
        "all", description="'per_state' also returns within-state matrices as an extra."
    )
    zscore: bool = Field(True, description="Z-score cells over masked frames (units of extras).")

    _cell_ids: list[str] | None = PrivateAttr(default=None)

    def configure(self, session: Session, target_name: str) -> None:
        self._cell_ids = [str(c) for c in session.cell_ids]

    def check_target(self, target) -> None:
        super().check_target(target)
        if self.kind == "noise":
            self.require_exclusive(target)
        if self.kind == "signal" and self.states_as == "per_state":
            raise ValueError(
                "pairwise_correlation: states_as='per_state' is not defined for 'signal'"
            )

    def _prep(self, x: np.ndarray) -> np.ndarray:
        return rankdata(x, axis=0) if self.method == "spearman" and x.shape[0] else x

    def _valid(self, states: StateSpace, mask: np.ndarray) -> np.ndarray:
        return masked_counts(states, mask) >= self.min_frames

    def _signal_means(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray]:
        """Per-state mean activity ``(n_cells, n_states)`` (NaN invalid) and the valid flags."""
        mask = np.asarray(mask, dtype=bool)
        act = np.asarray(activity, dtype=np.float64)
        if self.zscore and mask.any():
            sub = act[:, mask]
            sd = sub.std(axis=1, keepdims=True)
            act = (act - sub.mean(axis=1, keepdims=True)) / np.where(sd > 1e-12, sd, 1.0)
        counts = masked_counts(states, mask)
        valid = counts >= self.min_frames
        sums = state_sums(act, states, mask)
        with np.errstate(invalid="ignore", divide="ignore"):
            means = sums / np.where(counts > 0, counts, 1.0)
        return np.where(valid, means, np.nan), valid

    def _noise_matrix(
        self, x: np.ndarray, states: StateSpace, mask: np.ndarray, valid: np.ndarray
    ) -> np.ndarray:
        lab = states.labels(np.asarray(mask, dtype=bool))[np.asarray(mask, dtype=bool)]
        keep = (lab >= 0) & valid[np.maximum(lab, 0)]
        n_cells = x.shape[1]
        if keep.sum() < self.min_frames:
            return np.full((n_cells, n_cells), np.nan)
        xs = self._prep(x[keep])
        lk = lab[keep]
        means = _group_means(xs, lk, states.n_states)
        return _corr(xs - means[lk])

    def compute(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray, fs: float
    ) -> np.ndarray:
        mask = np.asarray(mask, dtype=bool)
        n_cells = activity.shape[0]
        nan = np.full((n_cells, n_cells), np.nan)
        if self.kind == "signal":
            means, valid = self._signal_means(activity, states, mask)
            if valid.sum() < 2:
                return nan
            return _corr(self._prep(means[:, valid].T))
        if int(mask.sum()) < self.min_frames:
            if self.kind == "noise":
                self.require_exclusive(states)
            return nan
        x = _zscore_frames(activity, mask, self.zscore)
        if self.kind == "noise":
            self.require_exclusive(states)
            return self._noise_matrix(x, states, mask, self._valid(states, mask))
        return _corr(self._prep(x))

    def _per_state(self, activity: np.ndarray, states: StateSpace, mask: np.ndarray) -> np.ndarray:
        mask = np.asarray(mask, dtype=bool)
        n_cells = activity.shape[0]
        out = np.full((states.n_states, n_cells, n_cells), np.nan)
        x = _zscore_frames(activity, mask, self.zscore)
        for s in np.flatnonzero(self._valid(states, mask)):
            member = states.onehot[:, s][mask]
            out[s] = _corr(self._prep(x[member]))
        return out

    def extras(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray, fs: float
    ) -> dict[str, np.ndarray]:
        mask = np.asarray(mask, dtype=bool)
        r = self.compute(activity, states, mask, fs)
        out: dict[str, np.ndarray] = {
            "n_frames": np.asarray(int(mask.sum())),
            "mean_offdiag": np.asarray(_upper_mean(r)),
        }
        if self.kind in ("signal", "noise"):
            out["state_means"] = self._signal_means(activity, states, mask)[0]
        if self.states_as == "per_state":
            out["per_state"] = self._per_state(activity, states, mask)
        if self._cell_ids is not None:
            out["group_names"] = np.array(self._cell_ids)
        return out


@register("metric")
class ParticipationRatio(Metric):
    """Participation ratio of the population covariance spectrum (effective dimension).

    ``PR = (sum_i lambda_i)^2 / sum_i lambda_i^2`` for the eigenvalues of the
    cell x cell covariance of the masked frames: 1 for a rank-1 population,
    ``n_cells`` for isotropic independent activity.

    Parameters
    ----------
    zscore : bool, default True
        Z-score each cell first (eigenvalues of the correlation matrix, so
        high-rate cells do not dominate).
    min_frames : int, default 50
        Minimum masked frames (overall, or per state when ``per_state``);
        below it the value is NaN.
    per_state : bool, default False
        Compute PR within each state (covariance of the frames in the state,
        about the state mean; z-scoring uses the global masked-frame statistics)
        instead of overall.

    Returns
    -------
    numpy.ndarray
        ``compute`` returns shape ``(1,)``, or ``(n_states,)`` with ``per_state``
        (NaN for states below ``min_frames``).

    Notes
    -----
    **Tail.**  ``"two"``: higher (more distributed) and lower (more low-dimensional)
    than chance are both of interest.

    **State space.**  Ignored unless ``per_state``; then any (overlapping states
    allowed, a frame counts in every state it belongs to).

    **Null.**  Use ``cell_shift``: it breaks the cross-cell coordination that
    sets the spectrum.  A common circular shift leaves PR unchanged (exactly,
    when the mask keeps all frames), so ``circular_shift`` is uninformative for
    the overall value.  ``compute_shifted`` is not implemented.

    Extras: ``eigenvalues`` ``(n_cells,)`` descending (overall covariance),
    ``variance_explained`` cumulative fraction ``(n_cells,)``, ``n_frames``, and
    ``group_names`` (``["all"]`` when not ``per_state``).
    """

    name: ClassVar[str] = "participation_ratio"
    extras_axes: ClassVar[dict[str, tuple[str | None, ...]]] = {
        "eigenvalues": ("component",),
        "variance_explained": ("component",),
        "n_frames": (),
        "group_names": ("group",),
    }
    level: ClassVar[Literal["cell", "population"]] = "population"
    default_tail: ClassVar[Tail] = "two"
    default_plots: ClassVar[tuple[str, ...]] = ("participation_ratio", "metric_strip")

    zscore: bool = Field(True, description="Z-score cells over masked frames.")
    min_frames: int = Field(50, ge=1, description="Minimum masked frames (overall / per state).")
    per_state: bool = Field(False, description="Compute PR per state instead of overall.")

    @staticmethod
    def _eig(x: np.ndarray, center: np.ndarray | None = None) -> np.ndarray:
        """Descending covariance eigenvalues of rows of ``x`` (clipped at 0)."""
        n, c = x.shape
        if n < 2 or c == 0:
            return np.full(c, np.nan)
        xc = x - (x.mean(axis=0, keepdims=True) if center is None else center)
        cov = xc.T @ xc / (n - 1)
        return np.clip(np.linalg.eigvalsh(cov)[::-1], 0.0, None)

    @staticmethod
    def _pr(lam: np.ndarray) -> float:
        if not np.isfinite(lam).all():
            return float("nan")
        s2 = float((lam * lam).sum())
        if s2 <= 1e-24 * max(float(lam.sum()) ** 2, 1.0) or s2 <= 0:
            return float("nan")
        return float(lam.sum() ** 2 / s2)

    def compute(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray, fs: float
    ) -> np.ndarray:
        mask = np.asarray(mask, dtype=bool)
        if not self.per_state:
            if int(mask.sum()) < self.min_frames:
                return np.array([np.nan])
            x = _zscore_frames(activity, mask, self.zscore)
            return np.array([self._pr(self._eig(x))])
        out = np.full(states.n_states, np.nan)
        x = _zscore_frames(activity, mask, self.zscore)
        for s in np.flatnonzero(self._valid(states, mask)):
            out[s] = self._pr(self._eig(x[states.onehot[:, s][mask]]))
        return out

    def _valid(self, states: StateSpace, mask: np.ndarray) -> np.ndarray:
        return masked_counts(states, mask) >= self.min_frames

    def extras(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray, fs: float
    ) -> dict[str, np.ndarray]:
        mask = np.asarray(mask, dtype=bool)
        n = int(mask.sum())
        c = activity.shape[0]
        if n >= max(self.min_frames, 2):
            lam = self._eig(_zscore_frames(activity, mask, self.zscore))
            tot = lam.sum()
            cum = np.cumsum(lam) / tot if tot > 0 else np.full(c, np.nan)
        else:
            lam = np.full(c, np.nan)
            cum = np.full(c, np.nan)
        out = {"eigenvalues": lam, "variance_explained": cum, "n_frames": np.asarray(n)}
        if not self.per_state:
            out["group_names"] = np.array(["all"])
        return out


__all__ = ["PairwiseCorrelation", "ParticipationRatio"]
