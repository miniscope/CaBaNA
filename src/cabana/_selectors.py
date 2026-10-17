"""Built-in selectors: data-driven choices of analysis parameters (see ``Selector``).

Smoothing / binning selectors live here.  A selector must never look at a shuffle
null or a p-value, so this module deliberately does not import the shuffle engine.
"""

from __future__ import annotations

import warnings
from typing import Any, ClassVar, Literal

import numpy as np
from pydantic import Field, model_validator

from ._kernels import contiguous_folds, masked_counts, rate_map, shifted_label_sums
from ._models import GridTopology, Session, StateSpace
from ._registry import Selector, register
from ._selection import Selection

DEFAULT_CANDIDATES_BINS: tuple[float, ...] = (0.0, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0)
_EPS_REL = 1e-6  # Poisson floor, relative to each cell's mean activity (see _fold_scores)


def _grid_state_space(session: Session, states: str) -> StateSpace:
    if states not in session.states:
        raise KeyError(f"no state space {states!r}; available: {sorted(session.states)}")
    ss = session.states[states]
    if not isinstance(ss.topology, GridTopology):
        raise ValueError(
            f"auto_smooth_sigma: state space {states!r} has no grid topology, so spatial "
            "smoothing is undefined for it (use a binned continuous variable, e.g. bin_grid)"
        )
    if not ss.exclusive:
        raise ValueError(f"auto_smooth_sigma: state space {states!r} must be exclusive")
    return ss


def grid_bin_size(topology: GridTopology) -> tuple[float, bool]:
    """Mean bin width over the grid axes (units of the edges) and whether axes differ (>1%)."""
    sizes = np.array([float(np.median(np.diff(e))) for e in topology.edges])
    mean = float(sizes.mean())
    return mean, bool(np.ptp(sizes) > 0.01 * mean)


def heldout_smoothing_scores(
    session: Session,
    states: str,
    candidates_bins: list[float] | np.ndarray,
    *,
    n_folds: int = 5,
    likelihood: Literal["poisson", "gaussian"] = "poisson",
    mask: np.ndarray | None = None,
    min_occupancy_s: float = 0.05,
) -> tuple[np.ndarray, np.ndarray]:
    """Held-out score of each candidate smoothing sigma (in grid bins).

    The frames in ``mask & support`` are split into ``n_folds`` contiguous blocks.
    For each block the rate maps are estimated on the other blocks (smoothed with
    each candidate sigma) and the block is scored; scores are summed over cells
    (population pooling) and the mean and standard error over folds returned.
    Higher is better.  No shuffles, no p-values.

    Scores
    ------
    ``"poisson"``: ``sum_t [x_t log(lam_s(t) dt + eps) - lam_s(t) dt]`` over held-out
    frames whose state has a valid training rate.  Activity is generally continuous
    and non-negative (deconvolved), so this is a Poisson *scoring rule*, not a
    likelihood proper (the ``log x!`` term is constant across candidates and
    dropped).  ``eps`` is ``1e-6`` times the cell's mean activity.
    ``"gaussian"``: ``-sum_t (x_t - lam_s(t) dt)^2``.

    Returns
    -------
    (scores_mean, scores_se) : each ``(n_candidates,)`` float64
    """
    ss = _grid_state_space(session, states)
    topo = ss.topology
    assert topo is not None
    cands = np.asarray(candidates_bins, dtype=np.float64)
    if cands.ndim != 1 or cands.size == 0 or (cands < 0).any() or not np.isfinite(cands).all():
        raise ValueError("candidate sigmas must be a non-empty 1-D list of finite values >= 0")
    if likelihood not in ("poisson", "gaussian"):
        raise ValueError("likelihood must be 'poisson' or 'gaussian'")
    n_states, fs = ss.n_states, float(session.fs)
    dt = 1.0 / fs
    frames = np.ones(ss.n_time, dtype=bool) if mask is None else np.asarray(mask, dtype=bool)
    if ss.support is not None:
        frames = frames & ss.support
    labels = ss.labels(frames).astype(np.int32)
    idx = np.flatnonzero(labels >= 0)
    if idx.size < n_folds * 2:
        raise ValueError(f"auto_smooth_sigma: only {idx.size} usable frames for {n_folds} folds")
    x = np.asarray(session.activity, dtype=np.float64)
    x = x[np.isfinite(x).all(axis=1)]  # drop cells with any non-finite sample
    if x.shape[0] == 0:
        raise ValueError("auto_smooth_sigma: no cell has finite activity")
    if likelihood == "poisson" and x.min() < 0:
        raise ValueError(
            "auto_smooth_sigma: poisson scoring needs non-negative activity; "
            "use likelihood='gaussian' for z-scored or dF/F traces"
        )
    shape = tuple(topo.shape)
    fold_of = contiguous_folds(idx.size, n_folds)
    zero = np.zeros(1, dtype=np.int64)
    eps = _EPS_REL * np.maximum(x.mean(axis=1), 1e-12)[:, None]  # (cells, 1)

    def sums(lab: np.ndarray, arr: np.ndarray) -> np.ndarray:
        return shifted_label_sums(arr, lab, n_states, zero)[0]

    tot_s, tot_n = sums(labels, x), masked_counts(labels, n_states, frames)
    per_fold = np.empty((n_folds, cands.size))
    for k in range(n_folds):
        lab_k = np.full_like(labels, -1)
        sel = idx[fold_of == k]
        lab_k[sel] = labels[sel]
        te_s, te_n = sums(lab_k, x), masked_counts(lab_k, n_states, frames)
        tr_s, tr_n = tot_s - te_s, tot_n - te_n
        te_q = sums(lab_k, x * x) if likelihood == "gaussian" else None
        for j, sigma in enumerate(cands):
            lam, valid = rate_map(tr_s, tr_n, fs, min_occupancy_s, shape, float(sigma))
            mu = np.where(valid, lam, 0.0) * dt  # (cells, states), 0 where untrained
            if likelihood == "poisson":
                score = te_s * np.log(mu + eps) - te_n * mu
            else:
                score = -(te_q - 2.0 * mu * te_s + te_n * mu * mu)
            per_fold[k, j] = float(score[:, valid].sum())
    mean = per_fold.mean(axis=0)
    se = per_fold.std(axis=0, ddof=1) / np.sqrt(n_folds)
    return mean, se


@register("selector")
class AutoSmoothSigma(Selector):
    """Choose ``smooth_sigma_bins`` by held-out likelihood (cross-validated smoothing).

    For each candidate sigma the frames are split into ``n_folds`` contiguous time
    blocks; rate maps estimated on the training blocks are scored on the held-out
    block (see :func:`heldout_smoothing_scores`), summed over cells, averaged over
    folds.  The argmax wins; with ``one_se`` the smallest sigma within one standard
    error of the best is chosen instead (a parsimony rule toward less smoothing).

    The criterion is deliberately *not* split-half reliability: on the simulator
    reliability rises monotonically with sigma (0.33, 0.87, 0.93, 0.94 for sigma 0-3
    bins), so it always asks for more smoothing.  Held-out likelihood penalises
    over-smoothing.  The selector never sees the shuffle null or a p-value, so the
    chosen sigma is a fixed number as far as the test is concerned.

    Parameters
    ----------
    states : str, default "position"
        State space (needs a ``GridTopology``).
    analyses : "*" or list[str], default "*"
        Which analyses get the value: every analysis on ``states`` whose metric has a
        ``smooth_sigma_bins`` field, or the listed resolved analysis names.
    candidates_mm, candidates_bins : list[float], optional
        Exactly one; sigma grid in mm (converted with the mean grid bin width, assuming
        the grid edges are in mm) or in bins.  Default ``candidates_bins=[0, .5, 1, 1.5, 2, 3, 4]``.
    n_folds : int, default 5
    likelihood : {"poisson", "gaussian"}
        Poisson scoring rule (non-negative activity) or negative squared error.
    one_se : bool, default True
    min_occupancy_s : float, default 0.05
        Same meaning as in the metrics; should match theirs.
    masks : list[str], optional
        Session masks ANDed with the state support when scoring; default the masks of
        the first matching analysis.
    pool : {"population", "per_cell"}
        Only ``"population"`` (one sigma for all cells) is implemented.
    """

    name: ClassVar[str] = "auto_smooth_sigma"

    states: str = "position"
    analyses: str | list[str] = "*"
    candidates_mm: list[float] | None = None
    candidates_bins: list[float] | None = None
    n_folds: int = Field(5, ge=2)
    likelihood: Literal["poisson", "gaussian"] = "poisson"
    one_se: bool = True
    min_occupancy_s: float = Field(0.05, ge=0)
    masks: list[str] | None = None
    pool: Literal["population", "per_cell"] = "population"

    @model_validator(mode="after")
    def _check(self) -> AutoSmoothSigma:
        if self.candidates_mm is not None and self.candidates_bins is not None:
            raise ValueError("give candidates_mm or candidates_bins, not both")
        if self.pool == "per_cell":
            raise NotImplementedError(
                "auto_smooth_sigma: pool='per_cell' is not implemented; smooth_sigma_bins is "
                "one number per analysis, so a per-cell sigma needs a metric-level hook"
            )
        return self

    def _matching(self, pipeline: Any) -> list[tuple[int, str]]:
        names = pipeline.resolved_names()
        if self.analyses == "*":
            return [
                (i, names[i])
                for i, a in enumerate(pipeline.analyses)
                if a.states == self.states and "smooth_sigma_bins" in type(a.metric).model_fields
            ]
        wanted = [self.analyses] if isinstance(self.analyses, str) else list(self.analyses)
        unknown = [w for w in wanted if w not in names]
        if unknown:
            raise KeyError(f"auto_smooth_sigma: unknown analyses {unknown}; have {names}")
        out = []
        for w in wanted:
            i = names.index(w)
            if "smooth_sigma_bins" not in type(pipeline.analyses[i].metric).model_fields:
                raise ValueError(f"analysis {w!r} has no smooth_sigma_bins field")
            out.append((i, w))
        return out

    def select(self, session: Session, pipeline: Any) -> list[Selection]:
        match = self._matching(pipeline)
        ss = _grid_state_space(session, self.states)  # raises for non-grid even if no match
        if not match:
            warnings.warn(
                f"auto_smooth_sigma: no analysis on {self.states!r} has smooth_sigma_bins; "
                "nothing selected",
                stacklevel=2,
            )
            return []
        topo = ss.topology
        assert topo is not None
        bin_size, aniso = grid_bin_size(topo)
        if self.candidates_mm is not None:
            cands = [float(c) / bin_size for c in self.candidates_mm]
        else:
            cands = [float(c) for c in (self.candidates_bins or DEFAULT_CANDIDATES_BINS)]
        cands = sorted(set(cands))
        listed = (
            self.masks
            if self.masks is not None
            else list(pipeline.analyses[match[0][0]].masks or [])
        )
        missing = [m for m in listed if m not in session.masks]
        if missing:
            raise KeyError(f"auto_smooth_sigma: masks {missing} not in session.masks")
        mask = session.valid_mask(list(listed))
        mean, se = heldout_smoothing_scores(
            session,
            self.states,
            cands,
            n_folds=self.n_folds,
            likelihood=self.likelihood,
            mask=mask,
            min_occupancy_s=self.min_occupancy_s,
        )
        best = int(np.argmax(mean))
        pick, rule = best, "argmax"
        if self.one_se:
            ok = np.flatnonzero(mean >= mean[best] - se[best])
            pick, rule = int(ok.min()), "one-SE rule (smallest sigma within 1 SE of the best)"
        sigma = float(cands[pick])
        note = (
            f"sigma={sigma:g} bins = {sigma * bin_size:g} mm (bin {bin_size:g} mm"
            f"{', anisotropic: mean of axes' if aniso else ''}); best sigma "
            f"{cands[best]:g} bins, SE of best {se[best]:.4g}; {rule}; "
            f"{self.n_folds} contiguous folds, population-pooled, min_occupancy_s="
            f"{self.min_occupancy_s:g}, masks={list(listed)}"
        )
        crit = (
            f"heldout_{self.likelihood}_loglik"
            if self.likelihood == "poisson"
            else "heldout_gaussian_sse"
        )
        return [
            Selection(
                path=f"analyses.{name}.metric.smooth_sigma_bins",
                value=sigma,
                method="auto_cv",
                criterion=crit,
                candidates=cands,
                scores=mean.tolist(),
                split=f"contiguous_folds:{self.n_folds}",
                note=note,
            )
            for _, name in match
        ]


__all__ = ["AutoSmoothSigma", "grid_bin_size", "heldout_smoothing_scores"]
