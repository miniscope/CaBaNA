"""Built-in selectors for null-distribution timescales (``min_shift_s``, ``block_s``).

The timescales are chosen from the autocorrelation of the data alone; nothing
here runs or reads a null test (see the ``Selector`` contract).

Autocorrelation time
--------------------
For a 1-D series, over the frames where it is valid (``mask`` and finite), the
series is demeaned with its masked mean and the autocovariance at lag ``k`` is
the mean of ``x[t] * x[t + k]`` over valid pairs (computed by FFT as a sum of
products divided by the number of valid pairs).  Dividing by lag 0 gives the
normalised autocorrelation ``r[k]``.  The autocorrelation time is the smallest
lag ``k >= 1`` (in seconds, ``k / fs``) at which ``r[k] < 1/e``, searching lags
up to ``max_lag_s``.  If ``r`` never falls below ``1/e`` the result is
``max_lag_s`` and a warning is issued.  Uncorrelated noise therefore gives one
frame.
"""

from __future__ import annotations

import fnmatch
import warnings
from typing import Any, ClassVar, Literal

import numpy as np
from pydantic import Field

from ._registry import Selector, register
from ._selection import Selection

_INV_E = float(np.exp(-1.0))
_MIN_PAIRS = 10  # lags with fewer valid pairs are not trusted


def _acf_rows(x: np.ndarray, valid: np.ndarray, max_lag: int) -> np.ndarray:
    """Normalised autocorrelation of each row of ``x`` over valid frames, lags 0..max_lag.

    ``x`` is ``(m, n)``; ``valid`` is ``(m, n)`` bool.  Entries are NaN where a
    lag has too few valid pairs or the row has no variance.
    """
    m, n = x.shape
    max_lag = int(min(max_lag, n - 1))
    v = valid.astype(np.float64)
    cnt = v.sum(axis=1, keepdims=True)
    mean = np.where(
        cnt > 0, np.where(valid, x, 0.0).sum(axis=1, keepdims=True) / np.maximum(cnt, 1), 0.0
    )
    xc = np.where(valid, x - mean, 0.0)
    nfft = 1 << int(np.ceil(np.log2(2 * n)))
    fx = np.fft.rfft(xc, nfft, axis=1)
    fv = np.fft.rfft(v, nfft, axis=1)
    acov = np.fft.irfft(fx * np.conj(fx), nfft, axis=1)[:, : max_lag + 1]
    pairs = np.fft.irfft(fv * np.conj(fv), nfft, axis=1)[:, : max_lag + 1]
    pairs = np.rint(pairs)
    with np.errstate(divide="ignore", invalid="ignore"):
        c = np.where(pairs >= _MIN_PAIRS, acov / pairs, np.nan)
        r = c / c[:, :1]
    var0 = c[:, 0]
    r[
        ~(np.isfinite(var0) & (var0 > 1e-12 * np.maximum(1.0, np.nanmax(np.abs(xc), axis=1) ** 2)))
    ] = np.nan
    return r


def _tau_from_acf(r: np.ndarray, fs: float, max_lag_s: float, *, warn: bool = True) -> float:
    """First lag (s) with ``r < 1/e``; ``max_lag_s`` (and a warning) if none."""
    below = np.flatnonzero(r[1:] < _INV_E)
    if below.size:
        return float(below[0] + 1) / fs
    # never below 1/e within the usable lags (or the lags ran out of valid pairs)
    if warn:
        warnings.warn(
            f"autocorrelation did not fall below 1/e within {max_lag_s:g} s; "
            f"using max_lag_s={max_lag_s:g}",
            UserWarning,
            stacklevel=3,
        )
    return float(max_lag_s)


def autocorrelation_time(x: Any, fs: float, *, mask: Any = None, max_lag_s: float = 60.0) -> float:
    """Autocorrelation time of a 1-D series, in seconds.

    The smallest lag at which the normalised autocorrelation (masked frames,
    NaN-safe mean removal, FFT) first falls below ``1/e``, searching up to
    ``max_lag_s``.  Returns ``max_lag_s`` (with a warning) if it never does, and
    ``nan`` if the series has no variance or fewer than two valid frames.

    Parameters
    ----------
    x : (n_time,) array_like
    fs : float
        Sampling rate in Hz.
    mask : (n_time,) bool array_like, optional
        Frames to use; others are ignored (lags are still counted in frames).
    max_lag_s : float, default 60.0
    """
    x = np.asarray(x, dtype=np.float64).ravel()
    valid = np.isfinite(x)
    if mask is not None:
        valid &= np.asarray(mask, dtype=bool).ravel()
    if valid.sum() < 2:
        return float("nan")
    r = _acf_rows(x[None, :], valid[None, :], int(round(max_lag_s * fs)))[0]
    if not np.isfinite(r[0]):
        return float("nan")
    return _tau_from_acf(r, fs, max_lag_s)


def _rows_taus(
    x: np.ndarray, valid: np.ndarray, fs: float, max_lag_s: float, chunk: int = 128
) -> np.ndarray:
    """Per-row autocorrelation time (nan for rows without variance); warns once."""
    out = np.full(x.shape[0], np.nan)
    max_lag = int(round(max_lag_s * fs))
    capped = 0
    for a in range(0, x.shape[0], chunk):
        r = _acf_rows(x[a : a + chunk], valid[a : a + chunk], max_lag)
        for i, ri in enumerate(r):
            if not np.isfinite(ri[0]):
                continue
            below = np.flatnonzero(ri[1:] < _INV_E)
            if below.size:
                out[a + i] = float(below[0] + 1) / fs
            else:
                out[a + i] = max_lag_s
                capped += 1
    if capped:
        warnings.warn(
            f"autocorrelation of {capped} series did not fall below 1/e within "
            f"{max_lag_s:g} s; using max_lag_s={max_lag_s:g} for them",
            UserWarning,
            stacklevel=3,
        )
    return out


def _state_taus(
    onehot: Any, fs: float, mask: Any, max_lag_s: float
) -> tuple[np.ndarray, np.ndarray]:
    """Per-state autocorrelation time and occupancy (frames in state within the mask)."""
    oh = np.asarray(onehot, dtype=np.float64)
    if oh.ndim == 1:
        oh = oh[:, None]
    n = oh.shape[0]
    valid = np.ones(n, bool) if mask is None else np.asarray(mask, dtype=bool).ravel()
    occ = (oh > 0)[valid].sum(axis=0).astype(float)
    taus = _rows_taus(oh.T, np.broadcast_to(valid, oh.T.shape), fs, max_lag_s)
    return taus, occ


def state_autocorrelation_time(
    onehot: Any, fs: float, mask: Any = None, max_lag_s: float = 60.0
) -> float:
    """Occupancy-weighted mean autocorrelation time of the state indicators, in seconds.

    The autocorrelation time (see :func:`autocorrelation_time`) is computed for
    the 0/1 indicator of each state over the masked frames, and averaged with
    weights equal to each state's number of occupied masked frames.  States
    with no variance are skipped.  ``nan`` if no state has variance.

    Parameters
    ----------
    onehot : (n_time, n_states) bool array_like
    fs : float
    mask : (n_time,) bool array_like, optional
    max_lag_s : float, default 60.0
    """
    taus, occ = _state_taus(onehot, fs, mask, max_lag_s)
    ok = np.isfinite(taus) & (occ > 0)
    if not ok.any():
        return float("nan")
    return float(np.average(taus[ok], weights=occ[ok]))


def mean_bout_length(onehot: Any, fs: float, mask: Any = None) -> float:
    """Mean run length (s) of consecutive occupied masked frames, pooled over states.

    A run ends at a frame where the state is off or the mask is False.  ``nan``
    if there are no runs.
    """
    oh = np.asarray(onehot, dtype=bool)
    if oh.ndim == 1:
        oh = oh[:, None]
    if mask is not None:
        oh = oh & np.asarray(mask, dtype=bool).ravel()[:, None]
    padded = np.vstack([np.zeros((1, oh.shape[1]), bool), oh, np.zeros((1, oh.shape[1]), bool)])
    d = np.diff(padded.astype(np.int8), axis=0)
    n_runs = int((d == 1).sum())
    if n_runs == 0:
        return float("nan")
    return float(oh.sum()) / n_runs / fs


@register("selector")
class AutoNullTimescale(Selector):
    """Set null timescales from the autocorrelation of activity and behaviour.

    For every matching analysis with a shuffle config: a ``circular_shift`` null
    gets ``min_shift_s = clip(multiple * max(tau_activity, tau_target),
    min_shift_floor_s, max_fraction * duration)``; a ``label_shuffle`` null gets
    ``block_s = clip(tau_target or mean bout, block_floor_s, max_fraction *
    duration)``.  Other nulls are left alone.  Autocorrelation times are defined
    in the module docstring (first lag below 1/e); ``tau_activity`` is the median
    over cells with variance, ``tau_target`` the occupancy-weighted state
    indicator autocorrelation time (or the mean bout length with
    ``block_rule="mean_bout"``), or the signal's own for a continuous target.
    Frames used are the analysis's effective frames (state support AND listed
    masks).  Uses only the data, never a null or a test result.

    Attributes
    ----------
    analyses : str | list[str], default "*"
        Resolved analysis names (or integer indices) to act on; ``fnmatch``
        patterns allowed.
    multiple : float, default 3.0
    min_shift_floor_s : float, default 5.0
    max_fraction : float, default 0.25
    block_rule : {"autocorr", "mean_bout"}, default "autocorr"
    block_floor_s : float, default 0.25
    max_lag_s : float, default 60.0
    set_min_shift, set_block : bool, default True
    """

    name: ClassVar[str] = "auto_null_timescale"

    analyses: str | list[str] = Field(
        "*", description="Analysis names (or '*') whose null settings are set."
    )
    multiple: float = Field(
        3.0, description="Minimum shift as this multiple of the activity autocorrelation time."
    )
    min_shift_floor_s: float = Field(
        5.0, description="Lower bound (s) on the chosen minimum circular shift."
    )
    max_fraction: float = Field(
        0.25, description="Upper bound on the minimum shift as a fraction of the recording."
    )
    block_rule: Literal["autocorr", "mean_bout"] = Field(
        "autocorr", description="How the block length of block-based nulls is chosen."
    )
    block_floor_s: float = Field(0.25, description="Lower bound (s) on the chosen block length.")
    max_lag_s: float = Field(
        60.0, description="Longest lag (s) searched when estimating autocorrelation."
    )
    set_min_shift: bool = Field(True, description="Write the chosen min_shift_s selections.")
    set_block: bool = Field(True, description="Write the chosen block-length selections.")

    def _matches(self, i: int, name: str) -> bool:
        pats = [self.analyses] if isinstance(self.analyses, str) else list(self.analyses)
        return any(p == str(i) or fnmatch.fnmatchcase(name, p) for p in pats)

    def select(self, session: Any, pipeline: Any) -> list[Selection]:
        names = pipeline.resolved_names()
        fs = float(session.fs)
        duration = session.activity.shape[1] / fs
        cap = self.max_fraction * duration
        act_cache: dict[tuple[str, ...], float] = {}
        tgt_cache: dict[tuple[Any, ...], float] = {}
        out: list[Selection] = []
        matched = 0

        for i, (spec, name) in enumerate(zip(pipeline.analyses, names, strict=True)):
            if spec.shuffle is None or not self._matches(i, name):
                continue
            matched += 1
            null = spec.shuffle.resolved_null()
            want_shift = null.name == "circular_shift" and self.set_min_shift
            want_block = null.name == "label_shuffle" and self.set_block
            if not (want_shift or want_block):
                continue

            listed = tuple(spec.masks or [])
            if spec.states is not None:
                space = session.states[spec.states]
                support = space.support
            else:
                space = None
                support = None
            mask = np.asarray(session.valid_mask(list(listed)), dtype=bool)
            if support is not None:
                mask = mask & np.asarray(support, dtype=bool)

            use_mean_bout = want_block and self.block_rule == "mean_bout" and space is not None
            tkey = (spec.states, spec.signal, listed, use_mean_bout)
            if tkey not in tgt_cache:
                if space is not None:
                    if use_mean_bout:
                        tgt_cache[tkey] = mean_bout_length(space.onehot, fs, mask)
                    else:
                        tgt_cache[tkey] = state_autocorrelation_time(
                            space.onehot, fs, mask, self.max_lag_s
                        )
                else:
                    sig = np.asarray(session.signals[spec.signal], dtype=np.float64)
                    if sig.ndim > 1:
                        sig = sig.reshape(sig.shape[0], -1)[:, 0]
                    tgt_cache[tkey] = autocorrelation_time(
                        sig, fs, mask=mask, max_lag_s=self.max_lag_s
                    )
            tau_t = tgt_cache[tkey]
            criterion = "mean_bout_length" if use_mean_bout else "autocorrelation_1_over_e"

            tau_a = float("nan")
            if want_shift:
                akey = tuple(sorted(listed)) + (("support" if support is not None else ""),)
                akey = (spec.states if support is not None else "", *akey)
                if akey not in act_cache:
                    taus = _rows_taus(
                        np.asarray(session.activity, dtype=np.float64),
                        np.broadcast_to(mask, session.activity.shape),
                        fs,
                        self.max_lag_s,
                    )
                    taus = taus[np.isfinite(taus)]
                    act_cache[akey] = float(np.median(taus)) if taus.size else float("nan")
                tau_a = act_cache[akey]

            if want_shift:
                taus_all = [t for t in (tau_a, tau_t) if np.isfinite(t)]
                if not taus_all:
                    warnings.warn(
                        f"auto_null_timescale: no autocorrelation time for {name!r}; skipped",
                        UserWarning,
                        stacklevel=2,
                    )
                    continue
                raw = self.multiple * max(taus_all)
                value, clip_note = _clip(raw, self.min_shift_floor_s, cap)
                note = (
                    f"tau_activity={tau_a:.3g}s, tau_target={tau_t:.3g}s, "
                    f"multiple={self.multiple:g}, raw={raw:.3g}s{clip_note}"
                )
                out.append(
                    _selection(
                        name,
                        spec,
                        "min_shift_s",
                        value,
                        criterion="autocorrelation_1_over_e",
                        note=note,
                    )
                )
            else:
                if not np.isfinite(tau_t):
                    warnings.warn(
                        f"auto_null_timescale: no behaviour timescale for {name!r}; skipped",
                        UserWarning,
                        stacklevel=2,
                    )
                    continue
                value, clip_note = _clip(tau_t, self.block_floor_s, cap)
                note = f"tau_target={tau_t:.3g}s, rule={self.block_rule}{clip_note}"
                out.append(_selection(name, spec, "block_s", value, criterion=criterion, note=note))

        if matched == 0:
            warnings.warn(
                f"auto_null_timescale: no analysis with a shuffle matches {self.analyses!r}",
                UserWarning,
                stacklevel=2,
            )
        return out


def _clip(x: float, lo: float, hi: float) -> tuple[float, str]:
    """Clip to ``[lo, hi]`` (the upper cap wins if ``hi < lo``); rounded to ms."""
    v = max(x, lo)
    note = f", raised to floor {lo:g}s" if x < lo else ""
    if v > hi:
        v, note = hi, f", capped at {hi:.3g}s (max_fraction of duration)"
    return round(float(v), 3), note


def _selection(
    key: str, spec: Any, field: str, value: float, *, criterion: str, note: str
) -> Selection:
    """Selection for ``field`` of the analysis's null, at whichever path the engine reads.

    ``key`` is the resolved analysis name (readable in provenance; ``set_param``
    accepts names with brackets and ``#`` suffixes).
    """
    cfg = spec.shuffle
    if cfg.null is None:  # default circular_shift: the engine reads ShuffleConfig.min_shift_s
        path, val = f"analyses.{key}.shuffle.{field}", value
    else:  # explicit null: replace it with a copy carrying the new value
        path, val = f"analyses.{key}.shuffle.null", {**cfg.null.to_dict(), field: value}
    return Selection(
        path=path,
        value=val,
        method="auto_rule",
        criterion=criterion,
        candidates=None,
        scores=None,
        note=f"{field}={value:g}s; {note}",
    )
