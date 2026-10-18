"""Event-aligned analyses: bout onsets and peri-event time histograms (PETH)."""

from __future__ import annotations

from typing import ClassVar, Literal

import numpy as np
from pydantic import Field
from scipy.stats import wilcoxon

from .._models import StateSpace
from .._registry import Metric, register
from .._results import Tail
from .._nulls import draw_shifts
from .._shuffle import shifted_sums
from .._util import runs


def bouts(states: StateSpace) -> list[tuple[np.ndarray, np.ndarray]]:
    """Per state, ``(onsets, lengths)`` of each run of True frames (in frames).

    ``onsets[i]`` is the first frame of bout ``i`` (a rising edge, including
    frame 0 if the state is active there); ``lengths[i]`` its duration in frames.

    Parameters
    ----------
    states : StateSpace
        Any state space; each column of ``onehot`` is scanned independently, so
        overlapping states are fine.

    Returns
    -------
    list[tuple[numpy.ndarray, numpy.ndarray]]
        One ``(onsets, lengths)`` pair per state (int64 arrays of equal length,
        empty if the state is never active).
    """
    oh = np.asarray(states.onehot, dtype=bool)
    return [runs(oh[:, s]) for s in range(oh.shape[1])]


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

    Parameters
    ----------
    states : StateSpace
        State space whose bouts (runs of True) are scanned, one state at a time.
    mask : (n_time,) bool
        Frames allowed; only the onset frame is tested against it.
    fs : float
        Sampling rate in Hz, to convert frames to seconds.
    min_duration_s : float, default 0.0
        Minimum bout duration in seconds (inclusive).
    min_gap_s : float, default 0.0
        Minimum silence in seconds between the end of the previous bout of the
        same state and this onset (inclusive); ``0`` disables the check.

    Returns
    -------
    list[numpy.ndarray]
        One int array of onset frame indices per state, in time order.
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

    Parameters
    ----------
    pre_s, post_s : float, default 5.0 and 5.0
        Seconds of the window before and after each onset (``pre_s >= 0``,
        ``post_s > 0``); window frames are ``[onset - pre, onset + post)``.
    baseline_s : (float, float), default (-5.0, -2.0)
        Baseline interval in seconds relative to onset (half-open); must lie
        within ``[-pre_s, post_s]``.
    response_s : (float, float), default (0.0, 2.0)
        Response interval in seconds relative to onset (half-open); must lie
        within ``[-pre_s, post_s]``.
    bin_s : float | None, default None
        Bin width in seconds used to average the ``peth`` / ``peth_sem`` extras
        along time; ``None`` keeps one bin per frame.  Does not affect the tested
        statistic.
    min_duration_s : float, default 0.0
        Drop bouts shorter than this (seconds) before taking onsets.
    min_gap_s : float, default 0.0
        Drop onsets closer than this (seconds) to the end of the previous bout of
        the same state, so events are well separated.  The defaults (no duration
        or gap filter) are *not* what the demo uses: its ``1.5 s`` / ``1 s``
        values are chosen explicitly for the simulated bouts.
    min_events : int, default 3
        States with fewer valid events are NaN.
    baseline_subtract : bool, default True
        Subtract each event's baseline mean from its window in the ``peth``
        extras (the tested statistic is always response minus baseline).

    null_band : bool, default False
        Also write a per-bin null band and response latency to the extras (see
        below).  Off by default; the extras above are unchanged either way.
    n_null : int, default 200
        Number of circular shifts used for the band.
    null_seed : int, default 0
        Seed of the generator that draws those shifts.
    min_shift_s : float, default 20.0
        Smallest circular shift (s) for the band (see ``draw_shifts``).
    min_latency_bins : int, default 2
        Consecutive bins outside the band that define a response latency.

    Returns
    -------
    numpy.ndarray
        ``compute`` returns shape ``(n_cells, n_states)`` in activity units: mean
        over events of response-window mean minus baseline-window mean.

    Notes
    -----
    **Tail.**  ``"two"``: activity can rise or fall after the event.

    **State space.**  Any state space with discrete bouts (typically ``"bouts"``
    or a categorical/syllable space); each run of True in a state's column is one
    event, whether or not the space is exclusive.  Not meaningful for fine grids.

    Extras shapes: ``peth`` and ``peth_sem`` ``(n_cells, n_states, n_bins)`` with
    ``n_bins = (pre + post) // bin_frames`` (NaN for states below ``min_events``;
    ``peth_sem`` is also NaN for a single event), ``time_s`` ``(n_bins,)`` bin
    centres in seconds relative to onset, ``n_events`` ``(n_states,)`` valid
    events (window inside the session), ``p_prepost`` ``(n_cells, n_states)``.

    **Null band (``null_band=True``).**  Additional extras, all from ``n_null``
    circular shifts of the activity (shifts from ``draw_shifts`` with
    ``default_rng(null_seed)``, same shifts for every cell and state, event times fixed):
    ``peth_null_lo`` / ``peth_null_hi`` ``(n_cells, n_states, n_bins)`` at the 2.5 /
    97.5 percentiles of the shifted PETH, ``peth_null_mean``, and ``latency_s``
    ``(n_cells, n_states)``: the first bin time ``>= 0`` at which the observed PETH
    lies outside the band for at least ``min_latency_bins`` consecutive bins (NaN if
    never).  This band is *descriptive*: it is computed inside ``extras``, independent
    of the ``ShuffleConfig`` null, is not multiplicity corrected, and does not change
    the tested statistic.  The shifted PETH is a gather over event windows, vectorised
    over shifts in blocks.
    """

    name: ClassVar[str] = "peth"
    extras_axes: ClassVar[dict[str, tuple[str | None, ...]]] = {
        "peth": ("cell", "state", "time"),
        "peth_sem": ("cell", "state", "time"),
        "time_s": ("time",),
        "n_events": ("state",),
        "p_prepost": ("cell", "state"),
        "peth_null_lo": ("cell", "state", "time"),
        "peth_null_hi": ("cell", "state", "time"),
        "peth_null_mean": ("cell", "state", "time"),
        "latency_s": ("cell", "state"),
    }
    level: ClassVar[Literal["cell", "population"]] = "cell"
    default_tail: ClassVar[Tail] = "two"
    default_plots: ClassVar[tuple[str, ...]] = ("peth", "event_raster")

    pre_s: float = Field(5.0, ge=0, description="Seconds before onset in each window.")
    post_s: float = Field(5.0, gt=0, description="Seconds after onset in each window.")
    baseline_s: tuple[float, float] = Field(
        (-5.0, -2.0), description="Baseline interval (s, relative to onset); inside the window."
    )
    response_s: tuple[float, float] = Field(
        (0.0, 2.0), description="Response interval (s, relative to onset); inside the window."
    )
    bin_s: float | None = Field(
        None, gt=0, description="Bin width (s) for the peth extras; None = one bin per frame."
    )
    min_duration_s: float = Field(0.0, ge=0, description="Minimum bout duration (s) to keep.")
    min_gap_s: float = Field(
        0.0, ge=0, description="Minimum gap (s) since the previous bout of the same state."
    )
    min_events: int = Field(3, ge=1, description="States with fewer valid events are NaN.")
    baseline_subtract: bool = Field(
        True, description="Subtract each event's baseline mean in the peth extras."
    )
    null_band: bool = Field(
        False, description="Add a per-bin circular-shift null band and latency to the extras."
    )
    n_null: int = Field(200, ge=10, description="Circular shifts used for the null band.")
    null_seed: int = Field(0, description="Seed of the generator drawing the band's shifts.")
    min_shift_s: float = Field(20.0, ge=0, description="Smallest shift (s) for the null band.")
    min_latency_bins: int = Field(
        2, ge=1, description="Consecutive bins outside the band that define a latency."
    )

    # -- geometry ---------------------------------------------------------- #

    def _geometry(self, fs: float) -> tuple[int, int, tuple[int, int], tuple[int, int]]:
        pre, post = int(round(self.pre_s * fs)), int(round(self.post_s * fs))
        base, resp = _frames(self.baseline_s, fs), _frames(self.response_s, fs)
        for lo, hi in (base, resp):
            if lo < -pre or hi > post:
                raise ValueError("baseline_s and response_s must lie within [-pre_s, post_s]")
        return pre, post, base, resp

    def valid_onsets(self, states: StateSpace, mask: np.ndarray, fs: float) -> list[np.ndarray]:
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

    def _weights(
        self, states: StateSpace, mask: np.ndarray, fs: float
    ) -> tuple[np.ndarray, np.ndarray]:
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
        out = {
            "peth": peth,
            "peth_sem": sem,
            "time_s": offs / fs,
            "n_events": n_ev,
            "p_prepost": p,
        }
        if self.null_band:
            out.update(self._band(activity, ons, peth, offs / fs, fs, nb, n_bins))
        return out

    def _band(self, activity, ons, peth, time_s, fs, nb, n_bins):
        """Per-bin null band from circular shifts, and the response latency."""
        pre, post, (b0, b1), _ = self._geometry(fs)
        act = np.asarray(activity, dtype=np.float64)
        n_cells, n_time = act.shape
        n_states = len(ons)
        rng = np.random.default_rng(self.null_seed)
        shifts = draw_shifts(n_time, self.n_null, int(round(self.min_shift_s * fs)), rng)
        offs = np.arange(-pre, post)
        shape = (n_cells, n_states, n_bins)
        lo, hi, mean = (np.full(shape, np.nan) for _ in range(3))
        for s, o in enumerate(ons):
            if o.size < self.min_events:
                continue
            null = np.empty((n_cells, shifts.size, n_bins))
            block = max(1, int(4e6 // (n_cells * o.size * offs.size)))
            for i in range(0, shifts.size, block):
                k = shifts[i : i + block]
                # roll(x, k)[t] = x[(t - k) mod n]; mean over events first (linear)
                idx = (o[None, :, None] + offs[None, None, :] - k[:, None, None]) % n_time
                m = act[:, idx].mean(axis=2)  # (cells, shifts, window)
                if self.baseline_subtract:
                    m = m - m[:, :, b0 + pre : b1 + pre].mean(axis=2, keepdims=True)
                m = m[:, :, : n_bins * nb].reshape(n_cells, k.size, n_bins, nb).mean(axis=3)
                null[:, i : i + k.size] = m
            q = np.percentile(null, [2.5, 97.5], axis=1)
            lo[:, s], hi[:, s], mean[:, s] = q[0], q[1], null.mean(axis=1)
        with np.errstate(invalid="ignore"):
            out = (peth < lo) | (peth > hi)
        out &= np.isfinite(peth) & np.isfinite(lo)
        out &= (time_s >= 0)[None, None, :]
        run = out.copy()
        L = self.min_latency_bins
        if L > 1:
            run = np.zeros_like(out)
            if n_bins >= L:
                run[..., : n_bins - L + 1] = np.logical_and.reduce(
                    [out[..., j : n_bins - L + 1 + j] for j in range(L)]
                )
        first = np.argmax(run, axis=-1)
        latency = np.where(run.any(axis=-1), time_s[first], np.nan)
        return {
            "peth_null_lo": lo,
            "peth_null_hi": hi,
            "peth_null_mean": mean,
            "latency_s": latency,
        }


__all__ = ["PETH", "bouts", "event_onsets"]
