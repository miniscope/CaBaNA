"""Population geometry: PCA of population activity and condition-mean distances.

Both metrics take the frames x cells matrix of the *masked* frames, optionally
z-score each cell over those frames, and summarise each state by the mean
population vector over the frames in that state.  They return the matrix of
pairwise distances between those state means.

Non-exclusive state spaces are fine: a frame counts toward every state it
belongs to.  States with fewer than ``min_frames`` masked frames get NaN
rows/columns.  Run these on a re-binned session (``Session.rebin``, 0.1-1 s).

Which null?
-----------
* ``label_shuffle`` (the natural choice) permutes labels in time blocks while
  activity stays put.  It asks: *do the state labels carry population
  structure beyond what a label sequence with the same autocorrelation would
  give?*
* ``circular_shift`` rolls all cells together, so the population trajectory is
  preserved and only its alignment to behavior is broken.  It asks: *is the
  distance between state means larger than expected when the same neural
  trajectory is paired with the behavior at a random offset?*  Both are valid;
  the circular shift is the stricter test against slow drifts in the
  population state.  Neither metric implements ``compute_shifted``, so the
  shift null loops over ``compute``.
"""

from __future__ import annotations

from typing import ClassVar, Literal

import numpy as np
from pydantic import Field

from .._models import StateSpace
from .._registry import Metric, register
from .._results import Tail


def _frames_matrix(
    activity: np.ndarray, mask: np.ndarray, zscore: bool
) -> tuple[np.ndarray, np.ndarray]:
    """``(X, idx)``: frames x cells matrix of masked frames (optionally z-scored) and frame indices."""
    mask = np.asarray(mask, dtype=bool)
    idx = np.flatnonzero(mask)
    x = np.asarray(activity, dtype=np.float64)[:, idx].T
    if zscore and x.shape[0] > 0:
        sd = x.std(axis=0)
        x = (x - x.mean(axis=0)) / np.where(sd > 1e-12, sd, 1.0)
    return x, idx


def _state_means(
    x: np.ndarray, member: np.ndarray, min_frames: int
) -> tuple[np.ndarray, np.ndarray]:
    """Mean of ``x`` rows per state; ``member`` is ``(n_frames, n_states)`` float 0/1.

    Returns ``(means (n_states, d), n_frames (n_states,))``; states below
    ``min_frames`` have NaN means.
    """
    n = member.sum(axis=0)
    ok = (n >= min_frames) & (n > 0)
    with np.errstate(invalid="ignore", divide="ignore"):
        means = (member.T @ x) / np.where(n > 0, n, 1.0)[:, None]
    means[~ok] = np.nan
    return means, n.astype(np.int64)


def _pooled_within_cov(x: np.ndarray, member: np.ndarray, means: np.ndarray) -> np.ndarray:
    """Pooled within-state covariance of ``x`` over the valid states.

    A frame in several states contributes once per state.  Denominator is
    ``sum(n_s) - n_valid_states``.
    """
    ok = np.isfinite(means[:, 0])
    w = member[:, ok]
    n = w.sum(axis=0)
    wt = w.sum(axis=1)
    ss = x.T @ (x * wt[:, None]) - (means[ok].T * n) @ means[ok]
    dof = max(float(n.sum() - ok.sum()), 1.0)
    return ss / dof


def _pairwise(means: np.ndarray, kind: str, cov: np.ndarray | None = None) -> np.ndarray:
    """Distance matrix between rows of ``means`` (NaN rows give NaN rows/cols)."""
    n_states = means.shape[0]
    out = np.full((n_states, n_states), np.nan)
    ok = np.isfinite(means[:, 0]) if means.shape[1] else np.zeros(n_states, bool)
    if not ok.any():
        return out
    m = means[ok]
    if kind == "euclidean":
        d = np.linalg.norm(m[:, None, :] - m[None, :, :], axis=-1)
    elif kind == "mahalanobis":
        assert cov is not None
        prec = np.linalg.pinv(cov, hermitian=True)
        diff = m[:, None, :] - m[None, :, :]
        d = np.sqrt(np.maximum(np.einsum("abi,ij,abj->ab", diff, prec, diff), 0.0))
    elif kind == "correlation":
        c = m - m.mean(axis=1, keepdims=True)
        nrm = np.linalg.norm(c, axis=1)
        with np.errstate(invalid="ignore", divide="ignore"):
            d = 1.0 - (c @ c.T) / np.outer(nrm, nrm)
        d[nrm < 1e-12, :] = np.nan
        d[:, nrm < 1e-12] = np.nan
    else:  # pragma: no cover - guarded by Literal
        raise ValueError(f"unknown distance {kind!r}")
    np.fill_diagonal(d, np.where(np.isfinite(np.diag(d)), 0.0, np.nan))
    out[np.ix_(ok, ok)] = d
    return out


def _pca_fit(x: np.ndarray, n_components: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """PCA by SVD of the centered matrix: ``(scores, loadings, variance_explained)``.

    ``k = min(n_components, rank)``.  Each loading vector is sign-fixed so its
    largest-magnitude entry is positive (deterministic output).
    """
    n, d = x.shape
    xc = x - x.mean(axis=0, keepdims=True)
    if n < 2 or d == 0:
        return np.zeros((n, 0)), np.zeros((d, 0)), np.zeros(0)
    _, s, vt = np.linalg.svd(xc, full_matrices=False)
    tol = s.max(initial=0.0) * max(n, d) * np.finfo(float).eps
    k = int(min(n_components, (s > tol).sum()))
    if k == 0:
        return np.zeros((n, 0)), np.zeros((d, 0)), np.zeros(0)
    v = vt[:k].T
    sign = np.sign(v[np.abs(v).argmax(axis=0), np.arange(k)])
    v = v * np.where(sign == 0, 1.0, sign)
    var = s**2
    return xc @ v, v, var[:k] / var.sum()


@register("metric")
class PCAPopulation(Metric):
    """Distances between state means in the space of the top principal components.

    Frames x cells (masked frames, optionally z-scored per cell) are reduced
    to ``k = min(n_components, rank)`` PCs.  Values are ``(n_states, n_states)``
    distances between per-state mean scores (diagonal 0, NaN for states with
    fewer than ``min_frames`` frames).  ``mahalanobis`` uses the pooled
    within-state covariance of the scores.  Extras: ``variance_explained``
    ``(k,)``, ``loadings`` ``(n_cells, k)``, ``state_means`` ``(n_states, k)``,
    ``n_frames`` ``(n_states,)``.

    PCA is unsupervised and fitted on all masked frames, so the labels only
    enter through the state means; see the module docstring for null choice
    (``label_shuffle`` or ``circular_shift``).

    Parameters
    ----------
    n_components : int, default 10
        Maximum number of principal components kept (fewer if the rank is lower).
    zscore : bool, default True
        Standardise each cell over the masked frames before PCA.
    distance : {"euclidean", "mahalanobis"}, default "euclidean"
        Metric between state-mean scores; ``"mahalanobis"`` uses the pooled
        within-state covariance of the scores (a frame in several states counts
        once per state).
    min_frames : int, default 20
        States with fewer masked frames are NaN (rows and columns).

    Returns
    -------
    numpy.ndarray
        ``compute`` returns shape ``(n_states, n_states)``, symmetric, diagonal 0.

    Notes
    -----
    **Tail.**  ``"upper"``: distinct state means are far apart, so large
    distances are the finding.

    **State space.**  Any; overlapping states are allowed and a frame counts
    toward every state it belongs to.  Frames in no state still take part in the
    PCA fit but in no state mean.
    """

    name: ClassVar[str] = "pca_population"
    level: ClassVar[Literal["cell", "population"]] = "population"
    default_tail: ClassVar[Tail] = "upper"

    n_components: int = Field(10, ge=1, description="Maximum number of principal components kept.")
    zscore: bool = Field(True, description="Z-score each cell over the masked frames before PCA.")
    distance: Literal["euclidean", "mahalanobis"] = Field(
        "euclidean",
        description="Distance between state-mean scores (pooled within-state cov. for mahalanobis).",
    )
    min_frames: int = Field(20, ge=1, description="States with fewer masked frames are NaN.")

    def _fit(self, activity: np.ndarray, states: StateSpace, mask: np.ndarray):
        mask = np.asarray(mask, dtype=bool)
        x, idx = _frames_matrix(activity, mask, self.zscore)
        member = states.onehot[idx].astype(np.float64)
        scores, loadings, var = _pca_fit(x, self.n_components)
        means, n = _state_means(scores, member, self.min_frames)
        return scores, member, loadings, var, means, n

    def compute(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray, fs: float
    ) -> np.ndarray:
        scores, member, _, _, means, _ = self._fit(activity, states, mask)
        cov = None
        if self.distance == "mahalanobis" and np.isfinite(means[:, :1]).any():
            cov = _pooled_within_cov(scores, member, means)
        return _pairwise(means, self.distance, cov)

    def extras(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray, fs: float
    ) -> dict[str, np.ndarray]:
        _, _, loadings, var, means, n = self._fit(activity, states, mask)
        return {
            "variance_explained": var,
            "loadings": loadings,
            "state_means": means,
            "n_frames": n,
        }


@register("metric")
class PopulationDistance(Metric):
    """Distances between state-mean population vectors in the full cell space (no PCA).

    ``euclidean`` is the norm of the difference of mean vectors; ``correlation``
    is ``1 - r`` across cells.  Cells are z-scored over the masked frames when
    ``zscore``.  Values ``(n_states, n_states)``, diagonal 0, NaN for states
    with fewer than ``min_frames`` frames.  Null: ``label_shuffle`` or
    ``circular_shift`` (see :mod:`cabana._metrics._pca`).

    Parameters
    ----------
    zscore : bool, default True
        Standardise each cell over the masked frames first.
    distance : {"euclidean", "correlation"}, default "euclidean"
        ``"euclidean"``: norm of the difference of mean vectors.
        ``"correlation"``: ``1 - r`` across cells (range 0 to 2); NaN when a mean
        vector is constant.
    min_frames : int, default 20
        States with fewer masked frames are NaN (rows and columns).

    Returns
    -------
    numpy.ndarray
        ``compute`` returns shape ``(n_states, n_states)``, symmetric, diagonal 0.

    Notes
    -----
    **Tail.**  ``"upper"``: large distances between state means are the finding.

    **State space.**  Any; overlapping states are allowed (a frame counts toward
    every state it belongs to).

    Extras: ``state_means`` ``(n_states, n_cells)`` mean population vector per
    state (NaN rows for states below ``min_frames``; in z-scored units when
    ``zscore``), ``n_frames`` ``(n_states,)`` masked frames per state.
    """

    name: ClassVar[str] = "population_distance"
    level: ClassVar[Literal["cell", "population"]] = "population"
    default_tail: ClassVar[Tail] = "upper"

    zscore: bool = Field(True, description="Z-score each cell over the masked frames first.")
    distance: Literal["euclidean", "correlation"] = Field(
        "euclidean", description="Euclidean distance, or 1 - Pearson r across cells."
    )
    min_frames: int = Field(20, ge=1, description="States with fewer masked frames are NaN.")

    def _means(self, activity: np.ndarray, states: StateSpace, mask: np.ndarray):
        x, idx = _frames_matrix(activity, mask, self.zscore)
        return _state_means(x, states.onehot[idx].astype(np.float64), self.min_frames)

    def compute(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray, fs: float
    ) -> np.ndarray:
        means, _ = self._means(activity, states, mask)
        return _pairwise(means, self.distance)

    def extras(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray, fs: float
    ) -> dict[str, np.ndarray]:
        means, n = self._means(activity, states, mask)
        return {"state_means": means, "n_frames": n}


__all__ = ["PCAPopulation", "PopulationDistance"]
