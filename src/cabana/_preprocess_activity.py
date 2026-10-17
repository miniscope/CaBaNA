"""Activity preprocessing: dF/F, detrending, filtering, event detection, clipping.

Every step is pure (``Session -> Session``), propagates NaN frames as NaN (never
zero-fills) and sets ``activity_kind`` to what the output really is, so that
``Session.rebin`` and the kind warnings do the right thing afterwards.
"""

from __future__ import annotations

import warnings
from typing import ClassVar, Literal

import numpy as np
from pydantic import Field, model_validator
from scipy.signal import butter, sosfiltfilt, welch

from ._models import EVENT_KINDS, Session
from ._registry import PreprocessStep, register

_MAD_TO_SD = 1.4826  # MAD -> standard deviation for Gaussian noise


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _as_float(session: Session) -> np.ndarray:
    return np.asarray(session.activity, dtype=float)


def _fill_nan(x: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Linearly interpolate NaN runs in a 1-D array (edges hold). Returns (filled, finite)."""
    ok = np.isfinite(x)
    if ok.all():
        return x, ok
    if not ok.any():
        return x, ok
    idx = np.arange(x.size)
    return np.interp(idx, idx[ok], x[ok]), ok


def _rolling_percentile(x: np.ndarray, win: int, q: float) -> np.ndarray:
    """Centered rolling percentile of a 1-D array, NaN-aware, evaluated on a stride and interpolated."""
    n = x.size
    win = max(3, min(win, n))
    half = win // 2
    stride = max(1, win // 20)
    centers = np.unique(np.append(np.arange(0, n, stride), n - 1))
    vals = np.full(centers.size, np.nan)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        for i, c in enumerate(centers):
            seg = x[max(0, c - half) : c + half + 1]
            if np.isfinite(seg).any():
                vals[i] = np.nanpercentile(seg, q)
    good = np.isfinite(vals)
    if not good.any():
        return np.full(n, np.nan)
    return np.interp(np.arange(n), centers[good], vals[good])


def _filter_rows(a: np.ndarray, sos: np.ndarray) -> np.ndarray:
    """Zero-phase SOS filter per row; NaN runs are interpolated for filtering, then restored."""
    out = np.full_like(a, np.nan)
    for i, row in enumerate(a):
        filled, ok = _fill_nan(row)
        if not ok.any():
            continue
        y = sosfiltfilt(sos, filled)
        y[~ok] = np.nan
        out[i] = y
    return out


def _check_cutoffs(fs: float, *freqs: float | None) -> None:
    for f in freqs:
        if f is not None and not 0 < f < fs / 2:
            raise ValueError(f"cutoff {f} Hz must lie in (0, Nyquist={fs / 2:g} Hz)")


def _min_length(session: Session, order: int) -> None:
    if session.n_time < 6 * order + 10:
        raise ValueError(f"session has {session.n_time} frames; too short to filter")


def _refuse_events(session: Session, step: str) -> None:
    if session.activity_kind in EVENT_KINDS:
        raise ValueError(
            f"{step} makes no sense on activity_kind={session.activity_kind!r} (event-like data); "
            "apply it to 'raw', 'denoised' or 'dff' traces before event detection"
        )


# --------------------------------------------------------------------------- #
# ComputeDff
# --------------------------------------------------------------------------- #
@register("preprocess")
class ComputeDff(PreprocessStep):
    """Convert fluorescence to dF/F: ``(F - F0) / max(F0, eps)`` per cell.

    ``F0`` is the baseline: a single per-cell value (``percentile`` or ``mean``) or a
    slowly varying trace (``rolling_percentile`` / ``rolling_min`` over ``window_s``),
    which also absorbs photobleaching.  The input must be ``raw`` or ``denoised``
    fluorescence (dF/F of dF/F, or of events, is meaningless); pass ``force=True`` to
    override.  Output kind is ``dff`` (averaged on re-binning).  NaN frames stay NaN.
    """

    name: ClassVar[str] = "compute_dff"

    baseline: Literal["percentile", "rolling_percentile", "rolling_min", "mean"] = Field(
        ..., description="How F0 is estimated per cell."
    )
    percentile: float = Field(
        8.0, ge=0, le=100, description="Percentile for 'percentile' / 'rolling_percentile'."
    )
    window_s: float = Field(
        60.0,
        gt=0,
        description="Window (s) for the rolling baselines; longer than the slowest transient.",
    )
    eps: float = Field(1e-6, gt=0, description="Floor on F0 to avoid division by ~0.")
    force: bool = Field(False, description="Allow activity kinds other than raw/denoised.")

    def apply(self, session: Session) -> Session:
        if session.activity_kind not in ("raw", "denoised") and not self.force:
            raise ValueError(
                f"compute_dff needs activity_kind 'raw' or 'denoised', got "
                f"{session.activity_kind!r}; set force=True to override"
            )
        a = _as_float(session)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            if self.baseline == "percentile":
                f0 = np.nanpercentile(a, self.percentile, axis=1, keepdims=True)
            elif self.baseline == "mean":
                f0 = np.nanmean(a, axis=1, keepdims=True)
            else:
                q = self.percentile if self.baseline == "rolling_percentile" else 0.0
                win = int(round(self.window_s * session.fs))
                f0 = np.stack([_rolling_percentile(r, win, q) for r in a])
        dff = (a - f0) / np.maximum(f0, self.eps)
        return session.with_activity(dff, kind="dff")


# --------------------------------------------------------------------------- #
# Detrend
# --------------------------------------------------------------------------- #
@register("preprocess")
class Detrend(PreprocessStep):
    """Subtract a slow trend (photobleaching, drift) from each cell; the kind is kept.

    ``linear`` fits a line to the finite samples; ``rolling_percentile`` subtracts a
    rolling percentile baseline over ``window_s``; ``highpass`` subtracts a zero-phase
    Butterworth low-pass trend with cutoff ``cutoff_hz``.  With ``preserve_mean`` the
    trend's mean is added back so the overall level (and sign of a raw trace) is kept.
    Refused for ``deconvolved`` / ``spike_counts`` / ``binary`` activity.
    """

    name: ClassVar[str] = "detrend"

    method: Literal["linear", "rolling_percentile", "highpass"] = Field(
        "linear", description="Trend estimator."
    )
    window_s: float = Field(60.0, gt=0, description="Window (s) for 'rolling_percentile'.")
    percentile: float = Field(8.0, ge=0, le=100, description="Percentile for 'rolling_percentile'.")
    cutoff_hz: float = Field(0.01, gt=0, description="Trend cutoff (Hz) for 'highpass'.")
    preserve_mean: bool = Field(True, description="Add the trend's mean back after subtraction.")

    def apply(self, session: Session) -> Session:
        _refuse_events(session, "detrend")
        a = _as_float(session)
        n = session.n_time
        if self.method == "highpass":
            _check_cutoffs(session.fs, self.cutoff_hz)
            _min_length(session, 2)
            sos = butter(2, self.cutoff_hz, btype="low", fs=session.fs, output="sos")
            trend = _filter_rows(a, sos)
        elif self.method == "linear":
            trend = np.full_like(a, np.nan)
            tt = np.arange(n, dtype=float)
            for i, row in enumerate(a):
                ok = np.isfinite(row)
                if ok.sum() >= 2:
                    p = np.polyfit(tt[ok], row[ok], 1)
                    trend[i] = np.polyval(p, tt)
        else:
            win = int(round(self.window_s * session.fs))
            trend = np.stack([_rolling_percentile(r, win, self.percentile) for r in a])
        out = a - trend
        if self.preserve_mean:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                out = out + np.nanmean(trend, axis=1, keepdims=True)
        out[~np.isfinite(a)] = np.nan
        return session.with_activity(out)


# --------------------------------------------------------------------------- #
# BandpassActivity
# --------------------------------------------------------------------------- #
@register("preprocess")
class BandpassActivity(PreprocessStep):
    """Zero-phase Butterworth band/high/low-pass filter per cell (``sosfiltfilt``).

    ``low_hz`` is the high-pass edge, ``high_hz`` the low-pass edge; give one or both.
    NaN runs are linearly interpolated for filtering and restored as NaN afterwards.
    A pure high-pass removes the DC level (use ``Detrend`` to keep it).  The kind is
    kept; event-like kinds are refused.
    """

    name: ClassVar[str] = "bandpass_activity"

    low_hz: float | None = Field(
        None, gt=0, description="High-pass edge (Hz); None = no high-pass."
    )
    high_hz: float | None = Field(None, gt=0, description="Low-pass edge (Hz); None = no low-pass.")
    order: int = Field(2, ge=1, le=8, description="Butterworth order (per filtfilt pass).")

    @model_validator(mode="after")
    def _check(self) -> BandpassActivity:
        if self.low_hz is None and self.high_hz is None:
            raise ValueError("give low_hz and/or high_hz")
        if self.low_hz is not None and self.high_hz is not None and self.low_hz >= self.high_hz:
            raise ValueError("low_hz must be < high_hz")
        return self

    def apply(self, session: Session) -> Session:
        _refuse_events(session, "bandpass_activity")
        _check_cutoffs(session.fs, self.low_hz, self.high_hz)
        _min_length(session, self.order)
        if self.low_hz is not None and self.high_hz is not None:
            sos = butter(
                self.order, [self.low_hz, self.high_hz], "bandpass", fs=session.fs, output="sos"
            )
        elif self.low_hz is not None:
            sos = butter(self.order, self.low_hz, "highpass", fs=session.fs, output="sos")
        else:
            sos = butter(self.order, self.high_hz, "lowpass", fs=session.fs, output="sos")
        return session.with_activity(_filter_rows(_as_float(session), sos))


# --------------------------------------------------------------------------- #
# DetectEvents
# --------------------------------------------------------------------------- #
def estimate_noise(a: np.ndarray, fs: float, how: str) -> np.ndarray:
    """Per-cell noise SD of ``a`` ``(n_cells, n_time)`` (NaN-aware).

    ``diff_mad``: ``1.4826 * MAD(diff(x)) / sqrt(2)``, robust to slow baseline and
    sparse transients (Friedrich et al. 2017; CaImAn).  ``mad``: ``1.4826 * MAD(x)``
    about the median (assumes a flat baseline).  ``psd``: sqrt of the mean Welch PSD
    over the upper half of the band, ``[fs/4, fs/2]`` (as CaImAn's ``get_noise_fft``).
    """
    out = np.full(a.shape[0], np.nan)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        for i, row in enumerate(a):
            ok = np.isfinite(row)
            if ok.sum() < 8:
                continue
            if how == "mad":
                v = row[ok]
                out[i] = _MAD_TO_SD * np.median(np.abs(v - np.median(v)))
            elif how == "diff_mad":
                d = np.diff(row)
                d = d[np.isfinite(d)]
                if d.size:
                    out[i] = _MAD_TO_SD * np.median(np.abs(d - np.median(d))) / np.sqrt(2.0)
            else:
                filled, _ = _fill_nan(row)
                f, p = welch(filled, fs=fs, nperseg=min(256, filled.size))
                band = f >= fs / 4
                out[i] = np.sqrt(p[band].mean() * fs / 2.0)
    return out


def _runs(above: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Start (inclusive) and stop (exclusive) indices of True runs."""
    d = np.diff(np.concatenate(([0], above.astype(np.int8), [0])))
    return np.flatnonzero(d == 1), np.flatnonzero(d == -1)


@register("preprocess")
class DetectEvents(PreprocessStep):
    """Threshold each cell's trace into events (a ``binary`` session by default).

    Methods (``thr`` is per cell):

    * ``sigma_noise``: ``median + k * noise``, with ``noise`` from the chosen estimator
      (``diff_mad`` default: MAD of first differences / sqrt(2); ``mad``; ``psd``).
    * ``mad``: ``median + k * 1.4826 * MAD`` of the trace (same as ``sigma_noise`` with
      ``noise="mad"``; assumes a flat baseline, so detrend / compute dF/F first).
    * ``percentile``: the ``percentile``-th percentile of the finite samples.
    * ``threshold``: the absolute ``threshold`` for every cell.

    Frames strictly above ``thr`` form runs; runs shorter than ``min_duration_s`` are
    dropped, then runs whose onset is within ``refractory_s`` of the previous kept onset.

    ``output``: ``binary`` = 1 while in an event (kind ``binary``, summed on re-binning);
    ``onsets`` = 1 only on the first frame of each event (kind ``binary``, so re-binning
    gives event counts); ``amplitude`` = the trace value inside events, else 0, labelled
    ``deconvolved`` (event-like, non-negative if the threshold is >= 0, summed on
    re-binning).  NaN frames are never events and stay NaN in the output.

    Per-cell ``noise`` (always computed with the ``noise`` estimator) and ``threshold`` are
    stored in ``meta["detect_events"]`` along with the parameters and event counts.
    """

    name: ClassVar[str] = "detect_events"

    method: Literal["mad", "sigma_noise", "percentile", "threshold"] = Field(
        "sigma_noise", description="Threshold rule."
    )
    k: float = Field(3.0, gt=0, description="Threshold = median + k x per-cell noise SD.")
    noise: Literal["mad", "diff_mad", "psd"] = Field(
        "diff_mad", description="Noise SD estimator (diff_mad: MAD of differences / sqrt(2))."
    )
    threshold: float | None = Field(None, description="Absolute threshold, for method 'threshold'.")
    percentile: float = Field(99.0, gt=0, lt=100, description="Percentile for method 'percentile'.")
    min_duration_s: float = Field(0.0, ge=0, description="Drop events shorter than this (s).")
    refractory_s: float = Field(
        0.0,
        ge=0,
        description="Drop events whose onset is within this time (s) of the previous kept onset.",
    )
    output: Literal["binary", "onsets", "amplitude"] = Field(
        "binary", description="Event representation (see class docstring)."
    )

    @model_validator(mode="after")
    def _check(self) -> DetectEvents:
        if self.method == "threshold" and self.threshold is None:
            raise ValueError("method 'threshold' needs threshold=")
        return self

    def apply(self, session: Session) -> Session:
        if session.activity_kind == "binary":
            raise ValueError("activity is already binary; nothing to detect")
        a = _as_float(session)
        fs = session.fs
        noise = estimate_noise(a, fs, "mad" if self.method == "mad" else self.noise)
        noise_rec = (
            noise if self.method in ("mad", "sigma_noise") else estimate_noise(a, fs, self.noise)
        )
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            med = np.nanmedian(a, axis=1)
            if self.method in ("mad", "sigma_noise"):
                thr = med + self.k * noise
            elif self.method == "percentile":
                thr = np.nanpercentile(a, self.percentile, axis=1)
            else:
                thr = np.full(a.shape[0], float(self.threshold))
        min_len = int(np.ceil(self.min_duration_s * fs - 1e-9))
        refr = self.refractory_s * fs

        out = np.zeros_like(a)
        n_events = np.zeros(a.shape[0], dtype=int)
        for i, row in enumerate(a):
            if not np.isfinite(thr[i]):
                out[i] = np.nan
                continue
            with np.errstate(invalid="ignore"):
                above = row > thr[i]
            starts, stops = _runs(above)
            last = -np.inf
            keep = np.zeros(row.size, dtype=bool)
            ons = np.zeros(row.size, dtype=bool)
            for s, e in zip(starts, stops, strict=True):
                if e - s < min_len or s - last < refr:
                    continue
                last = s
                keep[s:e] = True
                ons[s] = True
                n_events[i] += 1
            if self.output == "binary":
                out[i] = keep
            elif self.output == "onsets":
                out[i] = ons
            else:
                out[i] = np.where(keep, row, 0.0)
        out[~np.isfinite(a)] = np.nan
        kind = "deconvolved" if self.output == "amplitude" else "binary"
        new = session.with_activity(out, kind=kind)
        # TODO: move to cell_meta["noise_sd"] / ["event_threshold"] once Session.cell_meta lands.
        info = {
            "method": self.method,
            "k": self.k,
            "noise_estimator": self.noise,
            "output": self.output,
            "noise": [float(x) for x in noise_rec],
            "threshold": [float(x) for x in thr],
            "n_events": [int(x) for x in n_events],
            "source_kind": session.activity_kind,
        }
        return new.replace(meta={**new.meta, "detect_events": info})


# --------------------------------------------------------------------------- #
# ClipActivity
# --------------------------------------------------------------------------- #
@register("preprocess")
class ClipActivity(PreprocessStep):
    """Clip activity to ``[min, max]`` (either may be None); the kind is kept.

    The default ``min=0`` removes negative values, which deconvolution residuals and
    baseline-subtracted dF/F can contain but event-like kinds (and rate-based metrics such
    as Skaggs information) forbid.  Clipping biases the mean upward for noisy dF/F; for
    dF/F prefer event detection over clipping.  NaN stays NaN.
    """

    name: ClassVar[str] = "clip_activity"

    min: float | None = Field(0.0, description="Lower bound; None = no lower bound.")
    max: float | None = Field(None, description="Upper bound; None = no upper bound.")

    @model_validator(mode="after")
    def _check(self) -> ClipActivity:
        if self.min is not None and self.max is not None and self.min > self.max:
            raise ValueError("min must be <= max")
        return self

    def apply(self, session: Session) -> Session:
        return session.with_activity(np.clip(_as_float(session), self.min, self.max))


__all__ = [
    "BandpassActivity",
    "ClipActivity",
    "ComputeDff",
    "DetectEvents",
    "Detrend",
    "estimate_noise",
]
