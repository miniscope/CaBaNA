"""Metrics against a continuous per-frame signal (``input = "signal"``)."""

from __future__ import annotations

from typing import ClassVar, Literal

import numpy as np
from pydantic import Field
from scipy.stats import rankdata

from .._models import GridTopology
from .._registry import Metric, register
from .._results import Tail
from .._shuffle import shifted_sums
from ._information import _si
from ._ratemap import rate_maps_from_sums


def _as_1d(target, name: str) -> np.ndarray:
    """Coerce a signal target to a float ``(n_time,)`` array or raise a clear error."""
    y = np.asarray(target, dtype=np.float64)
    if y.ndim == 2 and y.shape[1] == 1:
        y = y[:, 0]
    if y.ndim != 1:
        raise ValueError(
            f"metric {name!r} takes a single 1-D signal but the target has shape {y.shape}; "
            "pass one signal column, e.g. signal='speed' (not a multi-channel signal)"
        )
    return y


def _pearson_from_sums(n, sx, sxx, sy, syy, sxy) -> np.ndarray:
    """Pearson r from sums over the same ``n`` frames (broadcasting); NaN if degenerate."""
    with np.errstate(divide="ignore", invalid="ignore"):
        cov = sxy - sx * sy / n
        vx = sxx - sx * sx / n
        vy = syy - sy * sy / n
        r = cov / np.sqrt(vx * vy)
    bad = (vx <= 1e-12 * np.abs(sxx)) | (vy <= 1e-12 * np.abs(syy)) | ~np.isfinite(r)
    r = np.clip(r, -1.0, 1.0)
    return np.where(bad, np.nan, r)


@register("metric")
class SignalCorrelation(Metric):
    """Correlation of each cell's activity with a continuous signal.

    This is the survey's "correlation with a continuous variable"; it is also
    the standard speed-confound check for other metrics (correlate activity
    with speed and see whether a "tuned" cell is just a speed cell).

    ``method="pearson"`` is the Pearson correlation over frames that are in the
    mask and where the signal is finite; ``"spearman"`` is Pearson on average
    ranks (ranked over those frames).  NaN if fewer than ``min_frames`` frames
    or either variable is constant.

    With ``max_lag_s > 0`` the extras also contain the cross-correlation at
    every integer-frame lag in ``[-max_lag_s, +max_lag_s]``.  **Sign
    convention:** the correlation at lag ``L`` pairs ``activity[t]`` with
    ``signal[t - L]``, so a *positive* best lag means activity *lags* (follows)
    the signal by ``L / fs`` seconds, a negative one that activity leads it.
    ``best_lag_s`` is the lag of the largest ``|xcorr|``.  Lagged pairs use only
    frames where both ends are in the mask (Spearman uses ranks computed once
    over the unlagged valid frames).  The tested statistic remains the lag-0
    correlation.

    Extras: ``xcorr`` (n_cells, n_lags), ``lags_s`` (n_lags,), ``best_lag_s``
    (n_cells,) when ``max_lag_s > 0``, and always ``n_frames`` (scalar array).
    ``lags_s`` is in seconds; ``xcorr`` is NaN where fewer than ``min_frames``
    paired frames exist, and ``best_lag_s`` is NaN for a cell with no finite
    ``xcorr``.  With ``max_lag_s == 0`` only ``n_frames`` is written.

    Parameters
    ----------
    method : {"pearson", "spearman"}, default "pearson"
        Linear, or rank, correlation.
    max_lag_s : float, default 0.0
        Half-width (s) of the cross-correlation window, rounded to whole frames
        and capped at ``n_time - 1``; ``0`` disables the cross-correlation extras.
    min_frames : int, default 50
        Minimum valid frames (masked and finite signal) for a correlation; fewer
        gives NaN.

    Returns
    -------
    numpy.ndarray
        ``compute`` returns shape ``(n_cells,)``: the lag-0 correlation in [-1, 1].

    Notes
    -----
    **Tail.**  ``"two"``: positive and negative correlations are both findings.

    **State space.**  Not applicable: the target is a single 1-D signal from
    ``session.signals`` (``input="signal"``); a multi-channel signal raises
    ``ValueError``.
    """

    name: ClassVar[str] = "signal_correlation"
    extras_axes: ClassVar[dict[str, tuple[str | None, ...]]] = {
        "n_frames": (),
        "xcorr": ("cell", "lag"),
        "lags_s": ("lag",),
        "best_lag_s": ("cell",),
    }
    input: ClassVar[Literal["states", "signal"]] = "signal"
    default_tail: ClassVar[Tail] = "two"
    default_plots: ClassVar[tuple[str, ...]] = ("metric_strip", "shuffle_distribution")

    method: Literal["pearson", "spearman"] = Field(
        "pearson", description="Pearson or Spearman (rank) correlation."
    )
    max_lag_s: float = Field(
        0.0, ge=0, description="Cross-correlation half-window (s); 0 skips the lag extras."
    )
    min_frames: int = Field(
        50, ge=2, description="Minimum valid (masked, finite-signal) frames; fewer gives NaN."
    )

    # -- helpers ---------------------------------------------------------
    def _prep(self, activity, target, mask):
        self.check_target(target)
        y = _as_1d(target, self.name)
        act = np.asarray(activity, dtype=np.float64)
        mask = np.asarray(mask, dtype=bool)
        valid = mask & np.isfinite(y)
        return act, y, valid

    def _ranked(self, act, y, valid):
        """Full-length x and y (y zero outside ``valid``); both ranked if Spearman."""
        x = act  # pearson: unmasked activity (the mask lives in the columns / weights)
        yy = np.where(valid, y, 0.0)
        if self.method == "spearman" and valid.any():
            x = np.zeros_like(act)
            x[:, valid] = rankdata(act[:, valid], axis=1)
            yy = np.zeros_like(y)
            yy[valid] = rankdata(y[valid])
        return x, yy

    def _fixed(self, yy, valid):
        v = valid.astype(np.float64)
        return np.stack([yy, v], axis=1), float((yy * yy).sum()), int(valid.sum())

    def compute(self, activity, target, mask, fs):
        out = self.compute_shifted(activity, target, mask, fs, np.zeros(1, dtype=np.int64))
        return out[0]

    def compute_shifted(self, activity, target, mask, fs, shifts):
        act, y, valid = self._prep(activity, target, mask)
        shifts = np.asarray(shifts, dtype=np.int64)
        n = int(valid.sum())
        n_cells = act.shape[0]
        if n < self.min_frames:
            return np.full((shifts.size, n_cells), np.nan)
        if self.method == "spearman" and not valid.all():
            # ranks of a rolled, masked series are not a roll of the ranks: re-rank per shift
            out = np.empty((shifts.size, n_cells))
            yr = rankdata(y[valid])
            sy, syy = yr.sum(), (yr * yr).sum()
            for i, k in enumerate(shifts):
                xr = rankdata(np.roll(act, int(k), axis=1)[:, valid], axis=1)
                out[i] = _pearson_from_sums(
                    n, xr.sum(axis=1), (xr * xr).sum(axis=1), sy, syy, xr @ yr
                )
            return out
        x, yy = self._ranked(act, y, valid)
        cols, syy, _ = self._fixed(yy, valid)
        sy = float(yy.sum())
        v = cols[:, 1:2]
        s = shifted_sums(x, cols, shifts)  # (S, C, 2): sum x*y, sum x over valid
        sxx = shifted_sums(x * x, v, shifts)[..., 0]
        return _pearson_from_sums(n, s[..., 1], sxx, sy, syy, s[..., 0])

    def extras(self, activity, target, mask, fs):
        act, y, valid = self._prep(activity, target, mask)
        out: dict[str, np.ndarray] = {"n_frames": np.asarray(int(valid.sum()))}
        if self.max_lag_s <= 0:
            return out
        n_time = act.shape[1]
        L = min(int(round(self.max_lag_s * fs)), n_time - 1)
        lags = np.arange(-L, L + 1)
        n_cells = act.shape[0]
        xc = np.full((n_cells, lags.size), np.nan)
        if valid.sum() >= self.min_frames:
            x, yy = self._ranked(act, y, valid)
            v = valid.astype(np.float64)
            for j, lag in enumerate(lags):
                # pairs (x[t], y[t - lag])
                if lag >= 0:
                    xs, ys = x[:, lag:], yy[: n_time - lag]
                    w = v[lag:] * v[: n_time - lag]
                else:
                    xs, ys = x[:, : n_time + lag], yy[-lag:]
                    w = v[: n_time + lag] * v[-lag:]
                m = w.sum()
                if m < self.min_frames:
                    continue
                xc[:, j] = _pearson_from_sums(
                    m, xs @ w, (xs * xs) @ w, (ys * w).sum(), (ys * ys * w).sum(), xs @ (ys * w)
                )
        with np.errstate(invalid="ignore"):
            absx = np.abs(xc)
            ok = np.isfinite(absx).any(axis=1)
            best = np.argmax(np.where(np.isfinite(absx), absx, -1.0), axis=1)
        best_lag = np.where(ok, lags[best] / fs, np.nan)
        out.update(xcorr=xc, lags_s=lags / fs, best_lag_s=best_lag)
        return out


@register("metric")
class SignalTuning(Metric):
    """Occupancy-normalised tuning curve of activity against a binned 1-D signal.

    The signal is cut into ``n_bins`` equal bins over ``extent`` (default: 1st to
    99th percentile of the masked, finite signal); frames outside the extent are
    ignored.  Rates are activity sums over occupancy in seconds; bins with less
    than ``min_occupancy_s`` are invalid.  ``smooth_sigma_bins > 0`` smooths
    sums and occupancy with edge normalisation (as in ``information_content``).

    ``statistic="information"`` is Skaggs information in bits per event of the
    tuning curve (needs non-negative activity); ``"depth"`` is
    ``(max - min) / (max + min)`` of the curve over valid bins.

    Parameters
    ----------
    n_bins : int, default 20
        Number of equal-width bins (>= 2).
    extent : (float, float) | None, default None
        ``(lo, hi)`` range of the signal to bin, in signal units; ``None`` uses the
        1st to 99th percentile of the masked finite signal.  A degenerate extent
        raises ``ValueError``.
    min_occupancy_s : float, default 0.1
        Bins with less masked occupancy (s) are invalid.
    smooth_sigma_bins : float, default 0.0
        Gaussian sigma in bins applied to sums and occupancy before dividing.
    statistic : {"information", "depth"}, default "information"
        See above.

    Returns
    -------
    numpy.ndarray
        ``compute`` returns shape ``(n_cells,)``; NaN when no bin is valid or the
        cell is silent (``information``) or ``max + min <= 0`` (``depth``).

    Notes
    -----
    **Tail.**  ``"upper"``: a larger statistic means sharper tuning.

    **State space.**  Not applicable: the target is a single 1-D signal.

    Extras: ``tuning_curve`` ``(n_cells, n_bins)`` rate per bin (activity units
    per second; NaN for invalid bins), ``bin_centers`` ``(n_bins,)`` in signal
    units, ``occupancy_s`` ``(n_bins,)`` seconds, ``valid_bins`` ``(n_bins,)`` bool.
    """

    name: ClassVar[str] = "signal_tuning"
    extras_axes: ClassVar[dict[str, tuple[str | None, ...]]] = {
        "tuning_curve": ("cell", "bin"),
        "bin_centers": ("bin",),
        "occupancy_s": ("bin",),
        "valid_bins": ("bin",),
    }
    input: ClassVar[Literal["states", "signal"]] = "signal"
    default_tail: ClassVar[Tail] = "upper"
    default_plots: ClassVar[tuple[str, ...]] = ("metric_strip", "shuffle_distribution")

    n_bins: int = Field(20, ge=2, description="Number of equal-width signal bins.")
    extent: tuple[float, float] | None = Field(
        None, description="(lo, hi) of the binned range; None = 1st to 99th percentile."
    )
    min_occupancy_s: float = Field(
        0.1, ge=0, description="Minimum masked occupancy (s) for a bin to be valid."
    )
    smooth_sigma_bins: float = Field(
        0.0, ge=0, description="Gaussian smoothing of the tuning curve, in bins."
    )
    statistic: Literal["information", "depth"] = Field(
        "information", description="Skaggs information (bits/event) or modulation depth."
    )

    def _setup(self, activity, target, mask):
        self.check_target(target)
        y = _as_1d(target, self.name)
        act = np.asarray(activity, dtype=np.float64)
        if self.statistic == "information" and np.nanmin(act) < 0:
            raise ValueError(
                "metric 'signal_tuning': statistic='information' needs non-negative activity; "
                "use statistic='depth' or skip zscore_activity"
            )
        valid = np.asarray(mask, dtype=bool) & np.isfinite(y)
        if self.extent is not None:
            lo, hi = self.extent
        elif valid.any():
            lo, hi = np.percentile(y[valid], [1, 99])
        else:
            lo = hi = np.nan
        if not (np.isfinite(lo) and np.isfinite(hi) and hi > lo):
            raise ValueError(
                f"metric 'signal_tuning': needs a non-degenerate extent, got ({lo}, {hi}); "
                "pass extent=(lo, hi) or check the signal/mask"
            )
        edges = np.linspace(lo, hi, self.n_bins + 1)
        ok = valid & (y >= lo) & (y <= hi)
        b = np.clip(np.searchsorted(edges, y[ok], side="right") - 1, 0, self.n_bins - 1)
        onehot = np.zeros((y.size, self.n_bins))
        onehot[np.flatnonzero(ok), b] = 1.0
        topo = None
        if self.smooth_sigma_bins > 0:
            topo = GridTopology(shape=(self.n_bins,), edges=[edges], axis_names=["signal"])
        return act, onehot, edges, topo

    def _stat(self, rate, occ, valid):
        if self.statistic == "information":
            return _si(rate, occ, valid, False)
        r = np.where(valid, rate, np.nan)
        with np.errstate(invalid="ignore", divide="ignore"):
            if not valid.any():
                return np.full(rate.shape[:-1], np.nan)
            mx, mn = np.nanmax(r, axis=-1), np.nanmin(r, axis=-1)
            d = (mx - mn) / (mx + mn)
        return np.where(mx + mn > 0, d, np.nan)

    def _maps(self, sums, occ, fs, topo):
        return rate_maps_from_sums(
            sums, occ, fs, self.min_occupancy_s, topo, self.smooth_sigma_bins
        )

    def compute(self, activity, target, mask, fs):
        act, onehot, _, topo = self._setup(activity, target, mask)
        occ = onehot.sum(axis=0)
        rate, valid = self._maps(act @ onehot, occ, fs, topo)
        return self._stat(rate, occ, valid)

    def compute_shifted(self, activity, target, mask, fs, shifts):
        act, onehot, _, topo = self._setup(activity, target, mask)
        occ = onehot.sum(axis=0)
        rate, valid = self._maps(shifted_sums(act, onehot, shifts), occ, fs, topo)
        return self._stat(rate, occ, valid)

    def extras(self, activity, target, mask, fs):
        act, onehot, edges, topo = self._setup(activity, target, mask)
        occ = onehot.sum(axis=0)
        rate, valid = self._maps(act @ onehot, occ, fs, topo)
        return {
            "tuning_curve": rate,
            "bin_centers": 0.5 * (edges[1:] + edges[:-1]),
            "occupancy_s": occ / fs,
            "valid_bins": valid,
        }


__all__ = ["SignalCorrelation", "SignalTuning"]
