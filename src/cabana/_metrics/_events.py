"""Event-aligned analyses: bout onsets and peri-event time histograms (PETH)."""

from __future__ import annotations

from typing import ClassVar, Literal

import numpy as np
from pydantic import Field
from scipy.stats import wilcoxon

from .._models import StateSpace
from .._registry import Metric, register
from .._shuffle import shifted_sums


def bouts(states: StateSpace) -> list[tuple[np.ndarray, np.ndarray]]:
    """Per state, ``(onsets, lengths)`` of each run of True frames (in frames).

    ``onsets[i]`` is the first frame of bout ``i`` (a rising edge, including
    frame 0 if the state is active there); ``lengths[i]`` its duration in frames.
    """
    oh = np.asarray(states.onehot, dtype=bool)
    out = []
    pad = np.zeros((1, oh.shape[1]), dtype=np.int8)
    d = np.diff(np.concatenate([pad, oh.astype(np.int8), pad], axis=0), axis=0)
    for s in range(oh.shape[1]):
        on = np.flatnonzero(d[:, s] == 1)
        off = np.flatnonzero(d[:, s] == -1)
        out.append((on.astype(np.int64), (off - on).astype(np.int64)))
    return out


def event_onsets(
    states: StateSpace,
    mask: np.ndarray,
    fs: float,
    min_duration_s: float = 0.0,
    min_gap_s: float = 0.0,
) -> list[np.ndarray]:
    """Per state, frame indices of kept bout onsets.

    A bout is kept if its duration is ``>= min_duration_s``, if its onset is
    ``>= min_gap_s`` after the end of the previous bout of the same state
    (kept or not; the first bout has no predecessor), and if its onset frame
    is inside ``mask``.
    """
    mask = np.asarray(mask, dtype=bool)
    result = []
    for onsets, lengths in bouts(states):
        keep = lengths / fs >= min_duration_s - 1e-9
        if min_gap_s > 0 and onsets.size > 1:
            gap = (onsets[1:] - (onsets[:-1] + lengths[:-1])) / fs
            keep[1:] &= gap >= min_gap_s - 1e-9
        keep &= mask[onsets] if onsets.size else keep
        result.append(onsets[keep])
    return result


def _frames(window_s: tuple[float, float], fs: float) -> tuple[int, int]:
    """Half-open frame-offset range ``[lo, hi)`` of a window given in seconds."""
    lo, hi = int(round(window_s[0] * fs)), int(round(window_s[1] * fs))
    if hi <= lo:
        raise ValueError(f"window {window_s} spans no frames at fs={fs}")
    return lo, hi


_MIN_NONZERO_PREPOST = 6


@register("metric")
class PETH(Metric):
    """Peri-event time histogram around state onsets, with a pre/post statistic.

    For each state, windows ``[onset - pre_s, onset + post_s)`` are taken around
    every kept onset (see :func:`event_onsets`) whose window lies fully inside
    the session; edge events are dropped.  Frames are *not* masked inside a
    window: a PETH is defined by time relative to the event, and masking
    individual frames would give different events different supports.  Only
    the onset frame must be inside ``mask``.

    Values (the tested statistic), shape ``(n_cells, n_states)``: the mean over
    events of ``mean(activity in response_s) - mean(activity in baseline_s)``
    (windows are half-open, relative to onset).  NaN when fewer than
    ``min_events`` events.  This is a linear functional of activity, so the
    circular-shift null is evaluated exactly with :func:`shifted_sums`
    (behavior and event times stay fixed, activity is rolled).

    Extras: ``peth`` ``(n_cells, n_states, n_bins)`` event average (baseline
    subtracted per event if ``baseline_subtract``), ``peth_sem``, ``time_s``
    ``(n_bins,)``, ``n_events`` ``(n_states,)``, and ``p_prepost``
    ``(n_cells, n_states)``: paired Wilcoxon signed-rank p across events of
    response vs. baseline mean (the field's "pre vs post responsiveness test";
    events from one animal are not independent of each other's autocorrelation,
    so prefer the shuffle p for inference).  NaN when fewer than 6 events have a
    non-zero response-baseline difference: the exact two-sided floor
    ``2 / 2**n`` stays above 0.05 for n < 6 and the normal approximation is
    unreliable on sparse deconvolved data.
    """

    name: ClassVar[str] = "peth"
    level: ClassVar[Literal["cell", "population"]] = "cell"
    default_tail: ClassVar[Literal["upper", "lower", "two"]] = "two"

    pre_s: float = Field(5.0, ge=0)
    post_s: float = Field(5.0, gt=0)
    baseline_s: tuple[float, float] = (-5.0, -2.0)
    response_s: tuple[float, float] = (0.0, 2.0)
    bin_s: float | None = Field(None, gt=0)
    min_duration_s: float = Field(0.0, ge=0)
    min_gap_s: float = Field(0.0, ge=0)
    min_events: int = Field(3, ge=1)
    baseline_subtract: bool = True

    # -- geometry ---------------------------------------------------------- #

    def _geometry(self, fs: float) -> tuple[int, int, tuple[int, int], tuple[int, int]]:
        pre, post = int(round(self.pre_s * fs)), int(round(self.post_s * fs))
        base, resp = _frames(self.baseline_s, fs), _frames(self.response_s, fs)
        for lo, hi in (base, resp):
            if lo < -pre or hi > post:
                raise ValueError("baseline_s and response_s must lie within [-pre_s, post_s]")
        return pre, post, base, resp

    def valid_onsets(
        self, states: StateSpace, mask: np.ndarray, fs: float
    ) -> list[np.ndarray]:
        """Kept onsets per state whose full window lies inside the session."""
        pre, post, _, _ = self._geometry(fs)
        n = states.n_time
        ons = event_onsets(states, mask, fs, self.min_duration_s, self.min_gap_s)
        return [o[(o - pre >= 0) & (o + post <= n)] for o in ons]

    def event_windows(self, activity: np.ndarray, onsets: np.ndarray, fs: float) -> np.ndarray:
        """Raw windows ``(n_cells, n_events, pre + post)`` around ``onsets``."""
        pre, post, _, _ = self._geometry(fs)
        idx = onsets[:, None] + np.arange(-pre, post)[None, :]
        return np.asarray(activity, dtype=np.float64)[:, idx]

    def _weights(self, states: StateSpace, mask: np.ndarray, fs: float) -> tuple[np.ndarray, np.ndarray]:
        pre, post, (b0, b1), (r0, r1) = self._geometry(fs)
        ons = self.valid_onsets(states, mask, fs)
        n_ev = np.array([o.size for o in ons], dtype=np.int64)
        w = np.zeros((states.n_time, len(ons)), dtype=np.float64)
        for s, o in enumerate(ons):
            if o.size < self.min_events:
                continue
            for lo, hi, sign in ((r0, r1, 1.0), (b0, b1, -1.0)):
                frames = (o[:, None] + np.arange(lo, hi)[None, :]).ravel()
                np.add.at(w[:, s], frames, sign / (o.size * (hi - lo)))
        return w, n_ev

    def _nan_small(self, arr: np.ndarray, n_ev: np.ndarray) -> np.ndarray:
        return np.where(n_ev >= self.min_events, arr, np.nan)

    # -- Metric contract --------------------------------------------------- #

    def compute(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray, fs: float
    ) -> np.ndarray:
        mask = np.asarray(mask, dtype=bool)
        w, n_ev = self._weights(states, mask, fs)
        return self._nan_small(np.asarray(activity, dtype=np.float64) @ w, n_ev)

    def compute_shifted(
        self,
        activity: np.ndarray,
        states: StateSpace,
        mask: np.ndarray,
        fs: float,
        shifts: np.ndarray,
    ) -> np.ndarray | None:
        w, n_ev = self._weights(states, np.asarray(mask, dtype=bool), fs)
        return self._nan_small(shifted_sums(activity, w, shifts), n_ev)

    def extras(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray, fs: float
    ) -> dict[str, np.ndarray]:
        mask = np.asarray(mask, dtype=bool)
        pre, post, (b0, b1), (r0, r1) = self._geometry(fs)
        n_cells = activity.shape[0]
        n_states = states.onehot.shape[1]
        nb = 1 if self.bin_s is None else max(1, int(round(self.bin_s * fs)))
        n_bins = (pre + post) // nb
        offs = np.arange(-pre, post)[: n_bins * nb].reshape(n_bins, nb).mean(axis=1)
        peth = np.full((n_cells, n_states, n_bins), np.nan)
        sem = np.full_like(peth, np.nan)
        p = np.full((n_cells, n_states), np.nan)
        ons = self.valid_onsets(states, mask, fs)
        n_ev = np.array([o.size for o in ons], dtype=np.int64)
        for s, o in enumerate(ons):
            if o.size < self.min_events:
                continue
            win = self.event_windows(activity, o, fs)  # (cells, events, time)
            base = win[:, :, b0 + pre : b1 + pre].mean(axis=2)
            resp = win[:, :, r0 + pre : r1 + pre].mean(axis=2)
            if self.baseline_subtract:
                win = win - base[:, :, None]
            win = win[:, :, : n_bins * nb].reshape(n_cells, o.size, n_bins, nb).mean(axis=3)
            peth[:, s] = win.mean(axis=1)
            sem[:, s] = win.std(axis=1, ddof=1) / np.sqrt(o.size) if o.size > 1 else np.nan
            diff = resp - base
            for c in range(n_cells):
                if np.count_nonzero(diff[c]) >= _MIN_NONZERO_PREPOST:
                    p[c, s] = wilcoxon(diff[c], zero_method="wilcox").pvalue
        return {
            "peth": peth,
            "peth_sem": sem,
            "time_s": offs / fs,
            "n_events": n_ev,
            "p_prepost": p,
        }


__all__ = ["PETH", "bouts", "event_onsets"]
