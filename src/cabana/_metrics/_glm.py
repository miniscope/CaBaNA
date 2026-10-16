"""GLM encoding model: unique contribution of each regressor to held-out fit.

Every cell is regressed on a shared design matrix (``design_matrix`` writes
one) with ridge regularisation, using a Gaussian or a Poisson (log link)
family.  All cells are fitted at once: the Gaussian case is a single shared
linear solve, the Poisson case is batched Newton/IRLS over cells with
per-cell Hessians (built with one BLAS product per iteration).

Objective (per cell), intercept unpenalised::

    Gaussian:  0.5 * sum (y - Xw)^2            + 0.5 * alpha * |w_slopes|^2
    Poisson :  sum (mu - y * eta), mu = exp(eta) + 0.5 * alpha * |w_slopes|^2

Design matrices should be on comparable scales (``design_matrix`` standardizes
signals, state columns are 0/1) because ``alpha`` is not rescaled per column.

Cross-validation
----------------
Frames that are in ``mask`` and have a finite design row are split, in time
order, into ``n_folds`` contiguous blocks.  Each block is held out once; the
model is fitted on the rest.  *Deviance explained* on the held-out block is
``1 - D(model) / D(null)`` with the null being the training-fold mean
(intercept-only).  Poisson deviance is ``2 sum[y log(y/mu) - (y - mu)]``
(``0 log 0 = 0``); Gaussian deviance is the sum of squares.

Unique contribution
-------------------
A *group* is one behavioral variable: all columns whose names are equal after
removing a trailing ``@k`` basis suffix (a state with its basis columns, or a
signal).  ``groups="column"`` makes every column its own group.  The value for
(cell, group) is the held-out deviance explained of the full model minus that
of the model refit without the group, averaged over folds.  It is NaN when
fewer than ``min_frames`` valid frames exist.

Family
------
``"auto"`` chooses Poisson when all masked activity is >= 0 and Gaussian
otherwise.  The metric does not see ``activity_kind``, so z-scored dF/F (which
has negative values) gets Gaussian while deconvolved amplitudes and counts get
(quasi-)Poisson.  Pass ``family`` explicitly for non-negative dF/F.

Null: ``compute_shifted`` is not implemented, so a circular-shift null loops
over ``compute`` (one full CV per shuffle).
"""

from __future__ import annotations

from typing import Any, ClassVar, Literal

import numpy as np
from pydantic import Field

from .._design import raised_cosine_basis
from .._registry import Metric, register
from .._results import Tail

_ETA_CLIP = 30.0


def _add_intercept(x: np.ndarray) -> np.ndarray:
    return np.concatenate([np.ones((x.shape[0], 1)), x], axis=1)


def _penalty(d1: int, alpha: float) -> np.ndarray:
    p = np.full(d1, float(alpha))
    p[0] = 0.0
    return p


def _fit_gaussian(x1: np.ndarray, y: np.ndarray, alpha: float) -> np.ndarray:
    """Ridge solution ``(X'X + P)^-1 X'Y``; returns ``(d1, n_cells)``."""
    a = x1.T @ x1 + np.diag(_penalty(x1.shape[1], alpha))
    b = x1.T @ y
    try:
        return np.linalg.solve(a, b)
    except np.linalg.LinAlgError:
        return np.linalg.pinv(a) @ b


def _poisson_obj(mu: np.ndarray, eta: np.ndarray, y: np.ndarray, w: np.ndarray, pen: np.ndarray):
    return (mu - y * eta).sum(axis=0) + 0.5 * (pen[:, None] * w * w).sum(axis=0)


def _hessian_terms(x1: np.ndarray, mu: np.ndarray) -> np.ndarray:
    """``H[c] = X' diag(mu[:, c]) X`` as ``(n_cells, d1, d1)`` via chunked BLAS products."""
    n, d1 = x1.shape
    chunk = max(1, int(2e7 // (d1 * d1)))
    h = np.zeros((mu.shape[1], d1 * d1))
    for s in range(0, n, chunk):
        xc = x1[s : s + chunk]
        z = (xc[:, :, None] * xc[:, None, :]).reshape(xc.shape[0], d1 * d1)
        h += mu[s : s + chunk].T @ z
    return h.reshape(-1, d1, d1)


def _fit_poisson(
    x1: np.ndarray, y: np.ndarray, alpha: float, max_iter: int, tol: float
) -> np.ndarray:
    """Batched penalised Newton / IRLS with step halving; returns ``(d1, n_cells)``."""
    n, d1 = x1.shape
    n_cells = y.shape[1]
    pen = _penalty(d1, alpha)
    w = np.zeros((d1, n_cells))
    w[0] = np.log(np.maximum(y.mean(axis=0), 1e-6))
    eta = np.clip(x1 @ w, -_ETA_CLIP, _ETA_CLIP)
    mu = np.exp(eta)
    obj = _poisson_obj(mu, eta, y, w, pen)
    active = np.arange(n_cells)
    ridge = np.diag(pen)[None]
    for _ in range(max_iter):
        if active.size == 0:
            break
        ya, wa, mua = y[:, active], w[:, active], mu[:, active]
        grad = x1.T @ (mua - ya) + pen[:, None] * wa  # (d1, n_a)
        h = _hessian_terms(x1, mua) + ridge + 1e-8 * np.eye(d1)[None]
        try:
            step = np.linalg.solve(h, grad.T[:, :, None])[:, :, 0].T
        except np.linalg.LinAlgError:
            step = np.linalg.pinv(h) @ grad.T[:, :, None]
            step = step[:, :, 0].T
        scale = np.ones(active.size)
        old = obj[active]
        new_w = wa - step
        for _h in range(10):
            eta_n = np.clip(x1 @ new_w, -_ETA_CLIP, _ETA_CLIP)
            mu_n = np.exp(eta_n)
            new_obj = _poisson_obj(mu_n, eta_n, ya, new_w, pen)
            bad = ~(new_obj <= old + 1e-9 * np.abs(old))
            if not bad.any():
                break
            scale[bad] *= 0.5
            new_w[:, bad] = wa[:, bad] - step[:, bad] * scale[bad]
        else:
            # could not improve: keep the old point for the still-bad cells
            new_w[:, bad] = wa[:, bad]
            new_obj = np.where(bad, old, new_obj)
            eta_n = np.clip(x1 @ new_w, -_ETA_CLIP, _ETA_CLIP)
            mu_n = np.exp(eta_n)
        w[:, active] = new_w
        mu[:, active] = mu_n
        obj[active] = new_obj
        converged = np.abs(old - new_obj) <= tol * np.maximum(np.abs(old), 1.0)
        active = active[~converged]
    return w


def _fit(x1: np.ndarray, y: np.ndarray, family: str, alpha: float, max_iter: int, tol: float):
    if family == "gaussian":
        return _fit_gaussian(x1, y, alpha)
    return _fit_poisson(x1, y, alpha, max_iter, tol)


def _deviance(family: str, y: np.ndarray, pred_eta: np.ndarray) -> np.ndarray:
    """Per-cell deviance of ``y`` (n, n_cells) given linear predictor / mean (n, n_cells)."""
    if family == "gaussian":
        return ((y - pred_eta) ** 2).sum(axis=0)
    mu = np.exp(np.clip(pred_eta, -_ETA_CLIP, _ETA_CLIP))
    pos = y > 0
    term = np.where(pos, y * np.log(np.where(pos, y, 1.0) / mu), 0.0)
    return 2.0 * (term - (y - mu)).sum(axis=0)


def _null_deviance(family: str, y_tr: np.ndarray, y_te: np.ndarray) -> np.ndarray:
    m = y_tr.mean(axis=0)
    if family == "gaussian":
        return _deviance(family, y_te, np.broadcast_to(m, y_te.shape))
    return _deviance(family, y_te, np.broadcast_to(np.log(np.maximum(m, 1e-6)), y_te.shape))


def _group_keys(names: list[str], mode: str) -> list[str]:
    if mode == "column":
        return list(names)
    return [n.rsplit("@", 1)[0] if "@" in n and n.rsplit("@", 1)[1].isdigit() else n for n in names]


@register("metric")
class GLMEncoding(Metric):
    """Cross-validated GLM; value = unique held-out deviance explained per regressor group.

    Every cell is regressed on a shared design matrix (a ``(n_time, n_regressors)``
    signal written by the ``design_matrix`` transform) with ridge regularisation.
    For each regressor *group* the value is the held-out deviance explained by
    the full model minus that of the model refit without the group, averaged over
    folds (see the module docstring for the objective, folds and grouping).

    Parameters
    ----------
    family : {"poisson", "gaussian", "auto"}, default "auto"
        Noise model.  ``"auto"`` picks Poisson (log link) when all masked finite
        activity is >= 0, Gaussian otherwise.  The metric does not see
        ``activity_kind``, so pass ``family`` explicitly for non-negative dF/F.
    alpha : float, default 1.0
        Ridge penalty on the non-intercept weights; columns are not rescaled, so
        keep them on comparable scales.
    n_folds : int, default 5
        Number of contiguous (``np.array_split``) blocks of valid frames.
    max_iter : int, default 50
        Newton/IRLS iteration cap (Poisson only).
    tol : float, default 1e-6
        Relative objective change at which a cell stops iterating (Poisson only).
    regressor_names : list[str] | None, default None
        One name per design column; ``None`` gives ``x0, x1, ...``.  Overwritten
        automatically from ``session.meta["design_columns"][target]`` by
        :meth:`configure` when the target was built by ``design_matrix``.
    groups : {"prefix", "column"}, default "prefix"
        ``"prefix"`` groups columns whose names are equal after dropping a
        trailing ``@k`` basis suffix; ``"column"`` makes each column a group.
    basis : dict | None, default None
        ``{"n_basis", "pre_s", "post_s"}`` of the temporal basis; set from
        ``session.meta["design_basis"]`` by :meth:`configure`.  When present
        (and ``groups="prefix"``) temporal kernels are added to the extras.
    min_frames : int, default 100
        Fewer valid frames (mask, finite design row and finite activity), or
        fewer than ``n_folds``, gives NaN.

    Returns
    -------
    numpy.ndarray
        ``compute`` returns shape ``(n_cells, n_groups)``: unique held-out
        deviance explained (fraction of null deviance; may be slightly negative).
        Groups are in first-appearance order of ``group_names``.

    Notes
    -----
    **Tail.**  ``"upper"``: only a positive unique contribution indicates
    encoding of that regressor.

    **Target.**  ``input="signal"``: the target is a design matrix from
    ``session.signals``, not a ``StateSpace``; state-space exclusivity does not
    apply (state columns are ordinary 0/1 regressors).

    Extras: ``group_names`` ``(n_groups,)`` object array naming the value
    columns; ``deviance_explained`` ``(n_cells,)`` held-out deviance explained
    by the full model, mean over folds; ``weights`` ``(n_cells, n_columns + 1)``
    full-model weights refit on all valid frames, column 0 the intercept (link
    scale: identity for Gaussian, log for Poisson).  Frames-short sessions give
    NaN arrays of the same shapes.  With ``basis`` and prefix groups also
    ``kernels`` ``(n_cells, n_kernel_groups, n_lags)`` temporal kernels
    reconstructed from the basis weights, ``kernel_lags_s`` ``(n_lags,)`` seconds
    relative to the event, and ``kernel_group_names`` ``(n_kernel_groups,)``.
    """

    name: ClassVar[str] = "glm_encoding"
    level: ClassVar = "cell"
    input: ClassVar = "signal"
    default_tail: ClassVar[Tail] = "upper"

    family: Literal["poisson", "gaussian", "auto"] = Field(
        "auto", description="'auto': Poisson if masked activity is non-negative, else Gaussian."
    )
    alpha: float = Field(1.0, ge=0, description="Ridge penalty on non-intercept weights.")
    n_folds: int = Field(5, ge=2, description="Contiguous blocks of valid frames.")
    max_iter: int = Field(50, ge=1, description="Newton iterations (Poisson).")
    tol: float = Field(1e-6, gt=0, description="Relative objective change to stop (Poisson).")
    regressor_names: list[str] | None = Field(
        None, description="Design column names (default x0..x{d-1}); see design_columns()."
    )
    groups: Literal["prefix", "column"] = Field(
        "prefix",
        description="'prefix': columns equal after dropping a '@k' suffix form one group "
        "(a state with its basis columns, or a signal); 'column': one group per column.",
    )
    basis: dict[str, Any] | None = Field(
        None,
        description="Mirror of DesignMatrix.basis; when given, temporal kernels of the "
        "state groups are returned in extras.",
    )
    min_frames: int = Field(100, ge=1, description="Fewer valid frames gives NaN.")

    # ------------------------------------------------------------------ #

    def _prepare(self, activity, target, mask):
        x = np.asarray(target, dtype=np.float64)
        if x.ndim == 1:
            x = x[:, None]
        if x.ndim != 2 or x.shape[0] != activity.shape[1]:
            raise ValueError("glm_encoding needs a design signal of shape (n_time, n_regressors)")
        d = x.shape[1]
        names = (
            list(self.regressor_names)
            if self.regressor_names is not None
            else [f"x{i}" for i in range(d)]
        )
        if len(names) != d:
            raise ValueError(f"{len(names)} regressor_names for {d} design columns")
        keys = _group_keys(names, self.groups)
        gnames = list(dict.fromkeys(keys))
        gcols = [np.flatnonzero(np.array(keys) == g) for g in gnames]
        mask = np.asarray(mask, dtype=bool)
        y_all = np.asarray(activity, dtype=np.float64)
        valid = mask & np.isfinite(x).all(axis=1) & np.isfinite(y_all).all(axis=0)
        idx = np.flatnonzero(valid)
        family = self.family
        if family == "auto":
            family = "poisson" if (idx.size == 0 or y_all[:, idx].min() >= 0) else "gaussian"
        return x, y_all, idx, names, gnames, gcols, family

    def _cv(self, x, y_all, idx, gcols, family, with_groups):
        """Per-fold held-out deviance explained: full ``(F, C)`` and drops ``(F, G, C)``."""
        n_cells = y_all.shape[0]
        # np.array_split (extra frames go to the first folds), not contiguous_folds: kept for
        # numerical continuity of GLM results.
        folds = np.array_split(np.arange(idx.size), self.n_folds)
        de_full = np.full((len(folds), n_cells), np.nan)
        de_drop = np.full((len(folds), len(gcols), n_cells), np.nan)
        d = x.shape[1]
        for f, test in enumerate(folds):
            if test.size == 0:
                continue
            tr = np.setdiff1d(np.arange(idx.size), test, assume_unique=True)
            xtr, xte = x[idx[tr]], x[idx[test]]
            ytr, yte = y_all[:, idx[tr]].T, y_all[:, idx[test]].T
            d_null = _null_deviance(family, ytr, yte)
            d_null = np.where(d_null > 1e-12, d_null, np.nan)

            def held_out(cols, xtr=xtr, xte=xte, ytr=ytr, yte=yte, d_null=d_null):
                w = _fit(
                    _add_intercept(xtr[:, cols]), ytr, family, self.alpha, self.max_iter, self.tol
                )
                return 1.0 - _deviance(family, yte, _add_intercept(xte[:, cols]) @ w) / d_null

            all_cols = np.arange(d)
            de_full[f] = held_out(all_cols)
            if with_groups:
                for g, cols in enumerate(gcols):
                    de_drop[f, g] = held_out(np.setdiff1d(all_cols, cols))
        return de_full, de_drop

    def configure(self, session, target_name):
        """Adopt column names and basis recorded by ``design_matrix`` for this target.

        Metadata always overwrites ``regressor_names`` / ``basis`` so that a metric
        object reused across sessions never keeps another session's columns;
        explicit user values apply only to targets without metadata.
        """
        cols = session.meta.get("design_columns", {})
        if target_name in cols:
            self.regressor_names = list(cols[target_name])
        basis_info = session.meta.get("design_basis", {})
        if target_name in basis_info:
            info = dict(basis_info[target_name])
            self.basis = {k: info[k] for k in ("n_basis", "pre_s", "post_s") if k in info}
        elif target_name in cols:
            self.basis = None

    def compute(self, activity, target, mask, fs):
        x, y_all, idx, _, _, gcols, family = self._prepare(activity, target, mask)
        n_cells = y_all.shape[0]
        if idx.size < self.min_frames or idx.size < self.n_folds:
            return np.full((n_cells, len(gcols)), np.nan)
        de_full, de_drop = self._cv(x, y_all, idx, gcols, family, True)
        with np.errstate(all="ignore"):
            uniq = np.nanmean(de_full[:, None, :] - de_drop, axis=0)  # (G, C)
        return uniq.T

    def extras(self, activity, target, mask, fs):
        x, y_all, idx, names, gnames, gcols, family = self._prepare(activity, target, mask)
        n_cells, d = y_all.shape[0], x.shape[1]
        out: dict[str, np.ndarray] = {"group_names": np.array(gnames, dtype=object)}
        if idx.size < self.min_frames or idx.size < self.n_folds:
            out["weights"] = np.full((n_cells, d + 1), np.nan)
            out["deviance_explained"] = np.full(n_cells, np.nan)
            return out
        de_full, _ = self._cv(x, y_all, idx, gcols, family, False)
        with np.errstate(all="ignore"):
            out["deviance_explained"] = np.nanmean(de_full, axis=0)
        w = _fit(
            _add_intercept(x[idx]), y_all[:, idx].T, family, self.alpha, self.max_iter, self.tol
        )
        out["weights"] = w.T
        if self.basis is not None and self.groups == "prefix":
            nb = int(self.basis["n_basis"])
            bas, lags_s = raised_cosine_basis(
                nb, float(self.basis["pre_s"]), float(self.basis["post_s"]), fs
            )
            kern, kn = [], []
            for g, cols in zip(gnames, gcols, strict=True):
                if not all("@" in names[c] for c in cols):
                    continue
                if len(cols) != nb:
                    raise ValueError(f"group {g!r} has {len(cols)} columns but basis n_basis={nb}")
                kern.append(w[cols + 1].T @ bas.T)  # (C, nb) @ (nb, L)
                kn.append(g)
            if kern:
                out["kernels"] = np.stack(kern, axis=1)
                out["kernel_lags_s"] = lags_s
                out["kernel_group_names"] = np.array(kn, dtype=object)
        return out


__all__ = ["GLMEncoding"]
