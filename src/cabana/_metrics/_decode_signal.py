"""Cross-validated decoding of a continuous signal from population activity.

Folds are contiguous blocks of time (see :func:`cabana._kernels._ratemap.contiguous_folds`),
exactly as in ``decode_states``, so autocorrelation does not leak between train and test.
Pair with the ``circular_shift`` null of the *activity*.
"""

from __future__ import annotations

from typing import ClassVar, Literal

import numpy as np
from pydantic import Field, PrivateAttr

from .._registry import Metric, register
from .._results import Tail
from ._ratemap import contiguous_folds

_CHUNK_ELEMS = 8_000_000  # float64 elements of the gathered design per batch (~64 MB)


def _as_2d(target, name: str) -> np.ndarray:
    """Coerce a signal target to float ``(n_time, d)``."""
    y = np.asarray(target, dtype=np.float64)
    if y.ndim == 1:
        y = y[:, None]
    if y.ndim != 2 or y.shape[1] < 1:
        raise ValueError(f"metric {name!r} needs a (n_time,) or (n_time, d) signal, got {y.shape}")
    return y


def _pearson(p: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Column-wise Pearson r of ``p`` and ``y`` over axis ``-2`` (NaN if degenerate)."""
    pc = p - p.mean(axis=-2, keepdims=True)
    yc = y - y.mean(axis=-2, keepdims=True)
    with np.errstate(divide="ignore", invalid="ignore"):
        r = (pc * yc).sum(axis=-2) / np.sqrt((pc**2).sum(axis=-2) * (yc**2).sum(axis=-2))
    return np.where(np.isfinite(r), r, np.nan)


@register("metric")
class DecodeSignal(Metric):
    """Cross-validated linear (ridge) or kNN decoding of a continuous signal from the population.

    Frames used: those in the mask where the signal (shifted by ``lag_s``) is finite in every
    channel and, for ``lag_s != 0``, where the frame the signal is read from is also in the
    mask.  Folds are contiguous time blocks over those frames; the cell scaler (``zscore``)
    and the ridge/kNN fit see the training fold only.  The statistic is pooled over the held-out
    predictions of all folds.

    The target is a ``(n_time,)`` or ``(n_time, d)`` array from ``session.signals``.  In the
    simulated and imported sessions position is usually stored as separate 1-D signals
    (``x``, ``y``), so decode one channel per analysis (``signal="x"``); a genuinely
    multi-column signal gives one value per column.

    Parameters
    ----------
    method : {"ridge", "knn"}, default "ridge"
        Ridge regression with an unpenalised intercept, or k-nearest-neighbour regression
        (Euclidean distance on the possibly z-scored population vector, mean of the ``k``
        training targets).
    alpha : float, default 1.0
        Ridge penalty (> 0) on standardised features (raw if ``zscore=False``), applied to
        the sum-of-squares (not mean-squares) normal equations.
    k : int, default 10
        Number of neighbours for ``method="knn"``.
    n_folds : int, default 5
        Number of contiguous time-block folds (>= 2).
    zscore : bool, default True
        Standardise each cell with the training fold's mean and s.d.
    lag_s : float, default 0.0
        Alignment in seconds, rounded to whole frames ``L``: activity at ``t`` is paired
        with the signal at ``t + L``.  Positive: activity predicts the future signal;
        negative: activity reflects the past signal.
    statistic : {"r2", "corr", "mae"}, default "r2"
        Pooled held-out coefficient of determination (``1 - SSE / SST``, SST about the pooled
        mean; can be negative), Pearson correlation of prediction and signal, or mean
        absolute error (in signal units; lower is better).
    min_frames : int, default 100
        Minimum valid frames (and at least ``n_folds``); fewer gives NaN.

    Returns
    -------
    numpy.ndarray
        ``compute`` returns shape ``(d,)``: the chosen statistic per signal channel.  NaN
        when fewer than ``min_frames`` valid frames exist or the signal is constant.

    Notes
    -----
    **Tail.**  ``"upper"`` for ``r2`` and ``corr``; ``"lower"`` for ``statistic="mae"``
    (``resolve_tail``).

    **Null.**  ``circular_shift`` of the activity is the right null (``compute_shifted`` is
    implemented for ``method="ridge"``: closed-form, batched over shifts).  Label shuffles do
    not apply to a continuous signal.  Cost of the ridge shifted fit: per shift one gather of
    the ``(n_valid, n_cells)`` design, per-fold Gram matrices (``O(n_valid * n_cells**2)``)
    and a batched ``solve`` of ``n_folds`` systems of size ``n_cells`` -- roughly the cost of
    one ``compute`` per shift but without Python-level fold loops over models.  ``knn`` has no
    shifted path and falls back to a loop over ``compute``.

    **State space.**  Not applicable: the target is a signal (``input="signal"``).

    **Chance level.**  For ``r2`` the chance level is about 0 (slightly negative, because
    held-out frames are predicted from a training mean that differs from the pooled mean);
    for ``corr`` about 0; for ``mae`` it is ``extras["chance_mae"]``, the error of always
    predicting the training-fold mean.  Compare to the shuffle null rather than to these
    values for inference.

    Extras (``extras``): ``prediction`` ``(n_time, d)`` held-out prediction at the activity
    frame ``t`` (the signal it predicts is at ``t + L``), NaN on frames not used; ``r2``,
    ``corr``, ``mae`` and ``chance_mae`` ``(d,)``; ``fold_scores`` ``(n_folds, d)`` the chosen
    statistic per fold; ``n_frames`` ``(1,)``; ``group_names`` ``(d,)`` str array (channel names: the signal
    name for a 1-D target, else ``"0".."d-1"``).
    """

    name: ClassVar[str] = "decode_signal"
    extras_axes: ClassVar[dict[str, tuple[str | None, ...]]] = {
        "prediction": ("time", "channel"),
        "r2": ("channel",),
        "corr": ("channel",),
        "mae": ("channel",),
        "chance_mae": ("channel",),
        "fold_scores": ("fold", "channel"),
        "n_frames": (None,),
        "group_names": ("channel",),
    }
    level: ClassVar[Literal["cell", "population"]] = "population"
    input: ClassVar[Literal["states", "signal"]] = "signal"
    default_tail: ClassVar[Tail] = "upper"
    default_plots: ClassVar[tuple[str, ...]] = ("decode_signal", "metric_strip")

    method: Literal["ridge", "knn"] = Field("ridge", description="Ridge or k-nearest neighbours.")
    alpha: float = Field(1.0, gt=0, description="Ridge penalty on (standardised) features.")
    k: int = Field(10, ge=1, description="Neighbours for method='knn'.")
    n_folds: int = Field(5, ge=2, description="Number of contiguous time-block CV folds.")
    zscore: bool = Field(True, description="Standardise cells with training-fold mean/s.d.")
    lag_s: float = Field(0.0, description="Activity at t predicts signal at t + lag (s).")
    statistic: Literal["r2", "corr", "mae"] = Field("r2", description="Pooled held-out score.")
    min_frames: int = Field(100, ge=2, description="Minimum valid frames; fewer gives NaN.")

    _signal_name: str | None = PrivateAttr(default=None)

    # ------------------------------------------------------------------ #
    def configure(self, session, target_name):
        self._signal_name = str(target_name)

    def resolve_tail(self, target) -> Tail:
        return "lower" if self.statistic == "mae" else "upper"

    def _names(self, d: int) -> list[str]:
        if d == 1 and self._signal_name:
            return [self._signal_name]
        return [str(i) for i in range(d)]

    # ------------------------------------------------------------------ #
    def _prep(self, activity, target, mask, fs):
        """``actT (n_time, n_cells), idx (m,), yv (m, d), folds-bounds, ok``."""
        self.check_target(target)
        y = _as_2d(target, self.name)
        act = np.asarray(activity, dtype=np.float64)
        mask = np.asarray(mask, dtype=bool)
        n = act.shape[1]
        if y.shape[0] != n:
            raise ValueError(f"signal has {y.shape[0]} frames but activity has {n}")
        lag = int(round(self.lag_s * fs))
        y_al = np.full_like(y, np.nan)
        m_al = np.zeros(n, dtype=bool)
        if abs(lag) < n:
            if lag >= 0:
                y_al[: n - lag], m_al[: n - lag] = y[lag:], mask[lag:]
            else:
                y_al[-lag:], m_al[-lag:] = y[: n + lag], mask[: n + lag]
        valid = mask & m_al & np.isfinite(y_al).all(axis=1)
        idx = np.flatnonzero(valid)
        ok = idx.size >= max(self.min_frames, self.n_folds)
        yv = y_al[idx]
        if ok and not (np.ptp(yv, axis=0) > 0).any():
            ok = False
        fold = contiguous_folds(idx.size, self.n_folds)
        bounds = np.searchsorted(fold, np.arange(self.n_folds + 1))
        return np.ascontiguousarray(act.T), idx, yv, bounds, ok

    def _scale(self, xtr: np.ndarray):
        mu = xtr.mean(axis=0)
        if self.zscore:
            sd = xtr.std(axis=0)
            sd = np.where(sd > 1e-12, sd, 1.0)
        else:
            sd = np.ones_like(mu)
        return mu, sd

    def _knn_predict(self, xtr, ytr, xte) -> np.ndarray:
        mu, sd = self._scale(xtr)
        a, b = (xtr - mu) / sd, (xte - mu) / sd
        kk = min(self.k, a.shape[0])
        a2 = (a * a).sum(axis=1)
        out = np.empty((b.shape[0], ytr.shape[1]))
        step = max(1, 4_000_000 // max(a.shape[0], 1))
        for s in range(0, b.shape[0], step):
            blk = b[s : s + step]
            d2 = a2[None, :] - 2.0 * blk @ a.T  # |b|^2 is constant per row
            nn = np.argpartition(d2, kk - 1, axis=1)[:, :kk]
            out[s : s + step] = ytr[nn].mean(axis=1)
        return out

    def _predict_knn(self, actT, idx, yv, bounds) -> np.ndarray:
        x = actT[idx]
        pred = np.empty_like(yv)
        for f in range(self.n_folds):
            lo, hi = bounds[f], bounds[f + 1]
            tr = np.r_[0:lo, hi : idx.size]
            pred[lo:hi] = self._knn_predict(x[tr], yv[tr], x[lo:hi])
        return pred

    def _predict_ridge(self, actT, idx, yv, bounds, shifts) -> np.ndarray:
        """Out-of-fold ridge predictions ``(n_shifts, m, d)`` for ``roll(activity, k)``.

        Per fold the training normal equations come from totals minus the held-out fold's
        sums (``X'X``, ``X'1``, ``X'y``), so each shift needs one pass over the design.  All
        ``n_folds`` systems of a chunk of shifts are solved in one batched ``np.linalg.solve``.
        """
        n_t, n_c = actT.shape
        m, d = yv.shape
        n_f = self.n_folds
        shifts = np.asarray(shifts, dtype=np.int64)
        out = np.empty((shifts.size, m, d))
        step = max(1, _CHUNK_ELEMS // max(m * n_c, 1))
        # shift-independent target sums per fold
        sy_f = np.stack([yv[bounds[f] : bounds[f + 1]].sum(axis=0) for f in range(n_f)])
        n_f_arr = np.diff(bounds).astype(np.float64)
        n_tr = m - n_f_arr
        ybar = (sy_f.sum(axis=0) - sy_f) / n_tr[:, None]  # (F, d)
        eye = self.alpha * np.eye(n_c)
        for s0 in range(0, shifts.size, step):
            ks = shifts[s0 : s0 + step]
            x = actT[(idx[None, :] - ks[:, None]) % n_t]  # (S, m, C): roll(act, k)[:, idx].T
            sxx = np.empty((ks.size, n_f, n_c, n_c))
            sx = np.empty((ks.size, n_f, n_c))
            sxy = np.empty((ks.size, n_f, n_c, d))
            for f in range(n_f):
                xf, yf = x[:, bounds[f] : bounds[f + 1]], yv[bounds[f] : bounds[f + 1]]
                sxx[:, f] = np.einsum("smc,smk->sck", xf, xf)
                sx[:, f] = xf.sum(axis=1)
                sxy[:, f] = np.einsum("smc,md->scd", xf, yf)
            sxx_tr = sxx.sum(axis=1, keepdims=True) - sxx
            sx_tr = sx.sum(axis=1, keepdims=True) - sx
            sxy_tr = sxy.sum(axis=1, keepdims=True) - sxy
            mu = sx_tr / n_tr[None, :, None]  # (S, F, C)
            gc = sxx_tr - n_tr[None, :, None, None] * mu[..., :, None] * mu[..., None, :]
            bc = sxy_tr - n_tr[None, :, None, None] * mu[..., :, None] * ybar[None, :, None, :]
            if self.zscore:
                sd = np.sqrt(np.maximum(np.einsum("sfcc->sfc", gc) / n_tr[None, :, None], 0.0))
                sd = np.where(sd > 1e-12, sd, 1.0)
            else:
                sd = np.ones_like(mu)
            gz = gc / (sd[..., :, None] * sd[..., None, :]) + eye
            bz = bc / sd[..., None]
            with np.errstate(all="ignore"):
                w = np.linalg.solve(gz, bz)  # (S, F, C, d)
            u = w / sd[..., None]
            c0 = ybar[None] - np.einsum("sfc,sfcd->sfd", mu, u)  # intercepts (S, F, d)
            for f in range(n_f):
                lo, hi = bounds[f], bounds[f + 1]
                out[s0 : s0 + ks.size, lo:hi] = x[:, lo:hi] @ u[:, f] + c0[:, f, None, :]
        return out

    # ------------------------------------------------------------------ #
    def _score(self, pred: np.ndarray, yv: np.ndarray, which: str) -> np.ndarray:
        """Pooled statistic over axis ``-2``; ``pred`` may have a leading shift axis."""
        with np.errstate(divide="ignore", invalid="ignore"):
            if which == "r2":
                sst = ((yv - yv.mean(axis=0)) ** 2).sum(axis=0)
                r = 1.0 - ((pred - yv) ** 2).sum(axis=-2) / sst
                return np.where(np.isfinite(r), r, np.nan)
            if which == "corr":
                return _pearson(pred, np.broadcast_to(yv, pred.shape))
            return np.abs(pred - yv).mean(axis=-2)

    def compute_shifted(self, activity, target, mask, fs, shifts):
        if self.method != "ridge":
            return None
        actT, idx, yv, bounds, ok = self._prep(activity, target, mask, fs)
        shifts = np.asarray(shifts, dtype=np.int64)
        if not ok:
            return np.full((shifts.size, _as_2d(target, self.name).shape[1]), np.nan)
        pred = self._predict_ridge(actT, idx, yv, bounds, shifts)
        return self._score(pred, yv, self.statistic)

    def _run(self, activity, target, mask, fs):
        actT, idx, yv, bounds, ok = self._prep(activity, target, mask, fs)
        if not ok:
            return None, idx, yv, bounds
        if self.method == "ridge":
            pred = self._predict_ridge(actT, idx, yv, bounds, np.zeros(1, dtype=np.int64))[0]
        else:
            pred = self._predict_knn(actT, idx, yv, bounds)
        return pred, idx, yv, bounds

    def compute(self, activity, target, mask, fs):
        pred, _, yv, _ = self._run(activity, target, mask, fs)
        if pred is None:
            return np.full(_as_2d(target, self.name).shape[1], np.nan)
        return self._score(pred, yv, self.statistic)

    def extras(self, activity, target, mask, fs):
        y = _as_2d(target, self.name)
        n, d = y.shape
        pred, idx, yv, bounds = self._run(activity, target, mask, fs)
        names = self._names(d)
        nan_d = np.full(d, np.nan)
        out = {
            "prediction": np.full((n, d), np.nan),
            "r2": nan_d.copy(),
            "corr": nan_d.copy(),
            "mae": nan_d.copy(),
            "chance_mae": nan_d.copy(),
            "fold_scores": np.full((self.n_folds, d), np.nan),
            "n_frames": np.array([idx.size]),
            "group_names": np.array(names),
        }
        if pred is None:
            return out
        out["prediction"][idx] = pred
        for key in ("r2", "corr", "mae"):
            out[key] = self._score(pred, yv, key)
        chance = np.empty(d)
        folds = []
        err = np.zeros(d)
        for f in range(self.n_folds):
            lo, hi = bounds[f], bounds[f + 1]
            ytr = np.concatenate([yv[:lo], yv[hi:]])
            err += np.abs(yv[lo:hi] - ytr.mean(axis=0)).sum(axis=0)
            folds.append(self._score(pred[lo:hi], yv[lo:hi], self.statistic))
        chance = err / yv.shape[0]
        out["chance_mae"] = chance
        out["fold_scores"] = np.stack(folds)
        return out


__all__ = ["DecodeSignal"]
