"""Transforms: raw behavior inputs -> per-frame signals, masks and ``StateSpace`` objects."""

from __future__ import annotations

from typing import ClassVar, Literal

import numpy as np
from pydantic import Field, model_validator

from .._models import (
    BoutTable,
    ContinuousSignal,
    GridTopology,
    LabelSeries,
    Session,
    StateSpace,
)
from .._registry import Transform, register


def _get_behavior(session: Session, key: str, cls: type):
    if key not in session.behavior:
        raise KeyError(f"session.behavior has no {key!r}; available: {sorted(session.behavior)}")
    obj = session.behavior[key]
    if not isinstance(obj, cls):
        raise TypeError(f"session.behavior[{key!r}] is a {type(obj).__name__}, need {cls.__name__}")
    return obj


def _missing_signal_msg(name: str, session: Session) -> str:
    return (
        f"signal {name!r} missing; available: {sorted(session.signals)}. If it lives in "
        "session.behavior, run resample_signal(source=...) first to put behavior signals "
        "on the neural clock"
    )


@register("transform")
class ResampleSignal(Transform):
    """Resample a ``ContinuousSignal`` onto the neural clock.

    ``method="linear"`` (default) interpolates between the finite source samples that bracket
    each frame; frames outside the source range, or whose nearest source sample is NaN, are NaN.
    ``"nearest"`` takes the nearest finite source sample (NaN where that nearest raw sample is
    NaN) and ``"ffill"`` holds the most recent finite sample.  ``max_gap_s`` limits how far a
    value may be carried: a frame whose bracketing finite samples (for ``"ffill"``, the last
    finite sample and the frame) are more than ``max_gap_s`` apart is NaN instead of filled.
    That covers both missing frames in the source clock and long runs of NaN (tracker
    dropouts).  With the defaults the result is the plain linear interpolation.
    """

    name: ClassVar[str] = "resample_signal"

    source: str = Field(..., description="Key in session.behavior of a ContinuousSignal.")
    channels: list[str] | None = Field(
        None, description="Channels to resample; None means all channels."
    )
    method: Literal["linear", "nearest", "ffill"] = Field(
        "linear", description="Interpolation rule between source samples."
    )
    max_gap_s: float | None = Field(
        None, gt=0, description="Do not fill across source gaps longer than this; None = always."
    )

    def _resample(self, tb: np.ndarray, v: np.ndarray, t: np.ndarray, covered: np.ndarray):
        res = np.full(t.shape, np.nan)
        ok = np.isfinite(v)
        if ok.sum() < 1:
            return res
        tf, vf = tb[ok], v[ok]
        k = np.clip(np.searchsorted(tf, t, side="right") - 1, 0, tf.size - 1)  # last <= t
        k1 = np.clip(k + 1, 0, tf.size - 1)
        if self.method == "linear":
            res = np.interp(t, tf, vf)
            left_t, right_t = tf[k], tf[k1]
        elif self.method == "nearest":
            pick = np.where(np.abs(t - tf[k]) <= np.abs(tf[k1] - t), k, k1)
            res = vf[pick]
            left_t, right_t = tf[k], tf[k1]
        else:
            res = vf[k]
            left_t = right_t = tf[k]
        res = np.where(covered, res, np.nan)
        if self.method != "ffill":
            # nearest raw sample (finite or not) decides whether a dropout is propagated
            j = np.clip(np.searchsorted(tb, t), 1, max(tb.size - 1, 1))
            j0, j1 = np.clip(j - 1, 0, tb.size - 1), np.clip(j, 0, tb.size - 1)
            nearest = np.where(np.abs(t - tb[j0]) <= np.abs(tb[j1] - t), j0, j1)
            res[~ok[nearest]] = np.nan
        if self.max_gap_s is not None:
            on_sample = (np.abs(t - left_t) < 1e-9) | (np.abs(right_t - t) < 1e-9)
            if self.method == "ffill":
                too_far = (t - left_t) > self.max_gap_s
            else:
                too_far = (right_t - left_t) > self.max_gap_s
            res[too_far & ~on_sample] = np.nan
        return res

    def apply(self, session: Session) -> Session:
        sig = _get_behavior(session, self.source, ContinuousSignal)
        chans = list(sig.channel_names) if self.channels is None else list(self.channels)
        for c in chans:
            if c not in sig.channel_names:
                raise KeyError(f"channel {c!r} not in {self.source!r}: {sig.channel_names}")
        tb = np.asarray(sig.t, dtype=float)
        t = session.t
        covered = (t >= tb[0]) & (t <= tb[-1]) if tb.size else np.zeros(t.shape, bool)
        out = session
        for c in chans:
            v = np.asarray(sig.values[:, sig.channel_names.index(c)], dtype=float)
            res = self._resample(tb, v, t, covered) if tb.size else np.full(t.shape, np.nan)
            out = out.with_signal(c, res)
        return out.with_mask(f"{self.source}_covered", covered, source=self.to_dict())


@register("transform")
class Speed(Transform):
    """Speed from a centered finite difference of position channels.

    The difference is taken between frames ``i - floor(w/2)`` and ``i - floor(w/2) + w`` with
    ``w = max(1, round(window_s * fs))``, divided by the actual time between them.  Near the
    edges the window is shifted inward (one-sided difference of the same width), so edges take
    the nearest valid estimate rather than NaN.  NaN in any channel propagates to the frames
    whose window touches it.
    """

    name: ClassVar[str] = "speed"

    signals: list[str] = Field(
        default_factory=lambda: ["x", "y"], description="Per-frame position signals."
    )
    window_s: float = Field(0.25, gt=0, description="Width of the difference window, seconds.")
    output: str = Field("speed", description="Name of the signal written.")

    def apply(self, session: Session) -> Session:
        for s in self.signals:
            if s not in session.signals:
                raise KeyError(_missing_signal_msg(s, session))
        n = session.n_time
        if n < 2:
            raise ValueError("need at least 2 frames to compute speed")
        w = max(1, round(self.window_s * session.fs))
        idx = np.arange(n)
        w = min(w, n - 1)
        lo = np.clip(idx - w // 2, 0, n - 1 - w)
        hi = lo + w
        dt = session.t[hi] - session.t[lo]
        pos = np.stack([np.asarray(session.signals[s], dtype=float) for s in self.signals], axis=1)
        d = pos[hi] - pos[lo]
        with np.errstate(invalid="ignore", divide="ignore"):
            spd = np.sqrt((d**2).sum(axis=1)) / dt
        return session.with_signal(self.output, spd)


@register("transform")
class BinGrid(Transform):
    """Bin one or more continuous signals into a regular grid of exclusive states."""

    name: ClassVar[str] = "bin_grid"

    signals: list[str] = Field(
        default_factory=lambda: ["x", "y"], description="Per-frame signals, one per grid axis."
    )
    bin_size: float | None = Field(
        None, gt=0, description="Bin width in signal units (same for all axes)."
    )
    n_bins: int | list[int] | None = Field(
        None, description="Bins per axis (int for all axes, or one int per axis)."
    )
    extent: list[tuple[float, float]] | None = Field(
        None, description="(min, max) per axis; default is the data range."
    )
    output: str = Field("position", description="Name of the StateSpace written.")

    @model_validator(mode="after")
    def _check(self) -> BinGrid:
        if (self.bin_size is None) == (self.n_bins is None):
            raise ValueError("give exactly one of bin_size or n_bins")
        nd = len(self.signals)
        if isinstance(self.n_bins, list):
            if len(self.n_bins) != nd or any(b < 1 for b in self.n_bins):
                raise ValueError("n_bins list needs one positive int per signal")
        elif self.n_bins is not None and self.n_bins < 1:
            raise ValueError("n_bins must be >= 1")
        if self.extent is not None:
            if len(self.extent) != nd:
                raise ValueError("extent needs one (min, max) per signal")
            if any(hi <= lo for lo, hi in self.extent):
                raise ValueError("extent entries need max > min")
        return self

    def apply(self, session: Session) -> Session:
        for s in self.signals:
            if s not in session.signals:
                raise KeyError(_missing_signal_msg(s, session))
        data = np.stack([np.asarray(session.signals[s], float) for s in self.signals], axis=1)
        nd = len(self.signals)
        edges: list[np.ndarray] = []
        for a in range(nd):
            if self.extent is not None:
                lo, hi = self.extent[a]
            else:
                col = data[:, a]
                if not np.isfinite(col).any():
                    raise ValueError(f"signal {self.signals[a]!r} has no finite samples")
                lo, hi = float(np.nanmin(col)), float(np.nanmax(col))
                if hi <= lo:
                    hi = lo + 1.0
            if self.bin_size is not None:
                nb = max(1, int(np.ceil((hi - lo) / self.bin_size - 1e-9)))
                e = lo + self.bin_size * np.arange(nb + 1)
                # last bin absorbs the remainder (data extent) or is narrowed to the
                # requested extent so out-of-extent samples never land in it
                e[-1] = max(e[-1], hi) if self.extent is None else hi
            else:
                nb = self.n_bins[a] if isinstance(self.n_bins, list) else int(self.n_bins)
                e = np.linspace(lo, hi, nb + 1)
            edges.append(e)
        shape = tuple(len(e) - 1 for e in edges)

        idx = np.zeros((session.n_time, nd), dtype=np.int64)
        ok = np.isfinite(data).all(axis=1)
        for a in range(nd):
            col = np.where(ok, data[:, a], edges[a][0])
            i = np.searchsorted(edges[a], col, side="right") - 1
            i = np.where(col == edges[a][-1], shape[a] - 1, i)  # right edge belongs to last bin
            ok &= (i >= 0) & (i < shape[a])
            idx[:, a] = np.clip(i, 0, shape[a] - 1)
        n_states = int(np.prod(shape))
        onehot = np.zeros((session.n_time, n_states), dtype=bool)
        flat = np.ravel_multi_index(tuple(idx[ok].T), shape)  # C order
        onehot[np.flatnonzero(ok), flat] = True
        names = [
            "_".join(
                f"{ax}{i:02d}"
                for ax, i in zip(self.signals, np.unravel_index(s, shape), strict=True)
            )
            for s in range(n_states)
        ]
        topo = GridTopology(shape=shape, edges=edges, axis_names=list(self.signals))
        space = StateSpace(
            name=self.output,
            onehot=onehot,
            state_names=names,
            kind="grid",
            exclusive=True,
            topology=topo,
            support=ok.copy(),
        )
        return session.with_state(space).with_mask(
            f"{self.output}_valid", ok, source=self.to_dict()
        )


@register("transform")
class BoutsToStates(Transform):
    """Turn a ``BoutTable`` into a boolean state space (one column per behavior).

    The state space's ``support`` is the scored span (``BoutTable.scored_start_s`` to
    ``scored_stop_s``); the same frames are written to the ``{output}_scored`` mask.

    Bouts are cleaned in this order before the state space is built:

    1. ``point_event_window_s``: zero-length events (BORIS POINT rows) become the window
       ``[t - w/2, t + w/2]`` centred on the event time; with ``None`` (default) they add no
       frames, because frames are marked for ``start <= t < stop``.
    2. ``merge_gap_s``: bouts of the *same behavior* separated by a gap shorter than this (or
       overlapping) are joined into one bout.  The usual fix for annotators splitting one
       behavior into several.
    3. ``min_gap_s`` (kept for compatibility; prefer ``merge_gap_s``): a bout that starts less
       than this long after the previous bout of the same behavior ended is *dropped* (the
       earlier one is kept), which is what event-aligned analyses want (isolated onsets).
       It is measured against the table after steps 1-2 and before step 4, so a short bout
       that is itself dropped still counts as "recent behavior".  Overlapping bouts have a
       negative gap and are dropped whenever ``min_gap_s > 0``.
    4. ``min_duration_s``: bouts shorter than this are dropped (after merging).

    All default to "off", which keeps every bout.
    """

    name: ClassVar[str] = "bouts_to_states"

    source: str = Field(..., description="Key in session.behavior of a BoutTable.")
    behaviors: list[str] | None = Field(
        None, description="Behaviors to include, in priority order; None means all."
    )
    exclusive: bool = Field(
        False, description="Resolve overlaps so each frame has one state (earlier wins)."
    )
    add_rest: bool = Field(
        False, description="Add a final state for scored frames with no behavior."
    )
    rest_name: str = Field("rest", description="Name of the rest state.")
    output: str = Field("social", description="Name of the StateSpace written.")
    min_duration_s: float = Field(
        0.0, ge=0, description="Drop bouts shorter than this (s), after merging."
    )
    min_gap_s: float = Field(
        0.0,
        ge=0,
        description=(
            "Drop bouts starting < this long after the previous bout of the same behavior "
            "ended (s). Prefer merge_gap_s."
        ),
    )
    merge_gap_s: float = Field(
        0.0,
        ge=0,
        description="Join same-behavior bouts separated by a gap shorter than this (s).",
    )
    point_event_window_s: float | None = Field(
        None,
        gt=0,
        description="Turn zero-length events into [t - w/2, t + w/2]; None ignores them.",
    )

    def _prepare(self, table: BoutTable) -> tuple[np.ndarray, np.ndarray, list[str]]:
        starts = np.asarray(table.start_s, float).copy()
        stops = np.asarray(table.stop_s, float).copy()
        labels = np.asarray(table.labels, dtype=object)
        if self.point_event_window_s is not None:
            pt = stops == starts
            half = self.point_event_window_s / 2
            starts[pt] -= half
            stops[pt] += half
        if self.merge_gap_s > 0 and starts.size:
            ms, me, ml = [], [], []
            for lab in dict.fromkeys(labels.tolist()):
                idx = np.flatnonzero(labels == lab)
                idx = idx[np.argsort(starts[idx], kind="stable")]
                cs, ce = starts[idx[0]], stops[idx[0]]
                for i in idx[1:]:
                    if starts[i] - ce < self.merge_gap_s:
                        ce = max(ce, stops[i])
                    else:
                        ms.append(cs), me.append(ce), ml.append(lab)
                        cs, ce = starts[i], stops[i]
                ms.append(cs), me.append(ce), ml.append(lab)
            starts, stops, labels = np.array(ms), np.array(me), np.array(ml, dtype=object)
        keep = np.ones(starts.shape, bool)
        if self.min_gap_s > 0:
            for lab in dict.fromkeys(labels.tolist()):
                idx = np.flatnonzero(labels == lab)
                idx = idx[np.argsort(starts[idx], kind="stable")]
                prev_end = np.maximum.accumulate(stops[idx])
                gap = starts[idx][1:] - prev_end[:-1]
                keep[idx[1:]] &= gap >= self.min_gap_s
        keep &= (stops - starts) >= self.min_duration_s
        return starts[keep], stops[keep], labels[keep].tolist()

    def apply(self, session: Session) -> Session:
        table = _get_behavior(session, self.source, BoutTable)
        behaviors = list(table.behavior_names if self.behaviors is None else self.behaviors)
        if len(set(behaviors)) != len(behaviors):
            raise ValueError(f"behaviors contains duplicates: {behaviors}")
        known = set(table.behavior_names)
        missing = [b for b in behaviors if b not in known]
        if missing:
            raise KeyError(f"behaviors {missing} not in {self.source!r}: {sorted(known)}")
        t = session.t
        n = session.n_time
        onehot = np.zeros((n, len(behaviors) + int(self.add_rest)), dtype=bool)
        col = {b: i for i, b in enumerate(behaviors)}
        starts, stops, labels = self._prepare(table)
        i0 = np.searchsorted(t, starts, side="left")  # first frame with t >= start
        i1 = np.searchsorted(t, stops, side="left")  # first frame with t >= stop
        for lab, a, b in zip(labels, i0, i1, strict=True):
            if lab in col and b > a:
                onehot[a:b, col[lab]] = True
        nb = len(behaviors)
        if self.exclusive and nb:
            first = onehot[:, :nb].cumsum(axis=1) == 1
            onehot[:, :nb] &= first
        lo = -np.inf if table.scored_start_s is None else table.scored_start_s
        hi = np.inf if table.scored_stop_s is None else table.scored_stop_s
        scored = (t >= lo) & (t < hi)  # half-open, like bout intervals
        names = list(behaviors)
        if self.add_rest:
            onehot[:, nb] = scored & ~onehot[:, :nb].any(axis=1)
            names.append(self.rest_name)
        space = StateSpace(
            name=self.output,
            onehot=onehot,
            state_names=names,
            kind="bouts",
            exclusive=self.exclusive,
            support=scored,
        )
        return session.with_state(space).with_mask(
            f"{self.output}_scored", scored, source=self.to_dict()
        )


def _mode_filter(lab: np.ndarray, w: int) -> np.ndarray:
    """Sliding-window majority vote over integer labels; ``-1`` is ignored and kept as ``-1``.

    Ties go to the frame's own label when it is among the winners, else the smallest label.
    """
    n = lab.size
    half = w // 2
    idx = np.arange(n)
    lo, hi = np.clip(idx - half, 0, n), np.clip(idx + half + 1, 0, n)
    best_n = np.zeros(n, int)
    best_l = np.full(n, -1)
    own_n = np.zeros(n, int)
    for k in np.unique(lab[lab >= 0]):
        c = np.concatenate([[0], np.cumsum(lab == k)])
        cnt = c[hi] - c[lo]
        upd = cnt > best_n
        best_n[upd], best_l[upd] = cnt[upd], k
        own = lab == k
        own_n[own] = cnt[own]
    out = np.where(own_n >= best_n, lab, best_l)
    return np.where(lab >= 0, out, -1)


def _min_run(lab: np.ndarray, min_len: int) -> np.ndarray:
    """Relabel runs shorter than ``min_len`` frames to the longer valid neighbouring run.

    Runs of ``-1`` are never relabelled and never absorb a run; a short run with no valid
    neighbour is left alone.  Shortest runs go first, so chains of blips collapse correctly.
    """
    if lab.size == 0 or min_len <= 1:
        return lab
    change = np.flatnonzero(np.diff(lab) != 0) + 1
    starts = np.concatenate([[0], change])
    lens = np.diff(np.concatenate([starts, [lab.size]]))
    runs_ = [[int(lab[a]), int(n)] for a, n in zip(starts, lens, strict=True)]
    while True:
        cand = [
            i
            for i, (v, n) in enumerate(runs_)
            if v >= 0
            and n < min_len
            and ((i > 0 and runs_[i - 1][0] >= 0) or (i + 1 < len(runs_) and runs_[i + 1][0] >= 0))
        ]
        if not cand:
            break
        i = min(cand, key=lambda j: runs_[j][1])
        left = runs_[i - 1] if i > 0 and runs_[i - 1][0] >= 0 else None
        right = runs_[i + 1] if i + 1 < len(runs_) and runs_[i + 1][0] >= 0 else None
        tgt = left if right is None or (left is not None and left[1] >= right[1]) else right
        tgt[1] += runs_[i][1]
        del runs_[i]
        # merge equal-valued neighbours created by the deletion
        k = 0
        while k + 1 < len(runs_):
            if runs_[k][0] == runs_[k + 1][0]:
                runs_[k][1] += runs_[k + 1][1]
                del runs_[k + 1]
            else:
                k += 1
    return np.repeat([v for v, _ in runs_], [n for _, n in runs_])


@register("transform")
class LabelsToStates(Transform):
    """Step-resample a ``LabelSeries`` onto the neural clock as a categorical state space.

    Optional cleanup of the per-frame integer labels (applied in this order, ``-1`` = no label
    is ignored by both and never filled):

    * ``mode_filter_s``: sliding-window majority vote over a window of
      ``round(mode_filter_s * fs)`` frames (made odd); ties keep the frame's own label.
    * ``min_run_s``: runs shorter than this are relabelled to the longer neighbouring labelled
      run (shortest first).
    """

    name: ClassVar[str] = "labels_to_states"

    source: str = Field(..., description="Key in session.behavior of a LabelSeries.")
    output: str = Field("syllables", description="Name of the StateSpace written.")
    mode_filter_s: float = Field(0.0, ge=0, description="Majority-vote window, seconds (0 = off).")
    min_run_s: float = Field(
        0.0, ge=0, description="Relabel runs shorter than this to a neighbour (0 = off)."
    )

    def apply(self, session: Session) -> Session:
        ls = _get_behavior(session, self.source, LabelSeries)
        t = session.t
        pos = np.searchsorted(ls.t, t, side="right") - 1
        covered = (pos >= 0) & (t <= ls.t[-1]) if ls.t.size else np.zeros(t.shape, bool)
        lab = np.where(covered, ls.labels[np.clip(pos, 0, None)], -1) if ls.t.size else pos * 0 - 1
        lab = np.asarray(lab, dtype=np.int64)
        if self.mode_filter_s > 0:
            w = max(1, round(self.mode_filter_s * session.fs))
            lab = _mode_filter(lab, w if w % 2 else w + 1)
        if self.min_run_s > 0:
            lab = _min_run(lab, int(np.ceil(self.min_run_s * session.fs - 1e-9)))
        n_states = len(ls.label_names)
        onehot = np.zeros((session.n_time, n_states), dtype=bool)
        has = lab >= 0
        onehot[np.flatnonzero(has), lab[has]] = True
        space = StateSpace(
            name=self.output,
            onehot=onehot,
            state_names=list(ls.label_names),
            kind="categorical",
            exclusive=True,
            support=np.asarray(covered, bool),
        )
        return session.with_state(space).with_mask(
            f"{self.output}_covered", covered, source=self.to_dict()
        )


__all__ = [
    "BinGrid",
    "BoutsToStates",
    "LabelsToStates",
    "ResampleSignal",
    "Speed",
]
