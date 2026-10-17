"""Clock alignment and timing diagnostics: dropped frames, offsets, drift, trimming.

Alignment belongs *before* resampling: behavior and neural data each carry their own clock, and
``fit_clock`` / ``apply_clock`` map the behavior times onto the neural clock so that
``resample_signal`` can then interpolate onto ``Session.t``.  The registered preprocess steps
(``timing_check``, ``trim_to_overlap``, ``resample``) work on a session that is already on the
neural clock.
"""

from __future__ import annotations

import warnings
from typing import ClassVar

import numpy as np
from pydantic import Field, model_validator

from ._loaders._miniscope import timing_report
from ._models import EVENT_KINDS, Session
from ._registry import PreprocessStep, register
from ._util import runs


def apply_clock(t, offset_s: float = 0.0, scale: float = 1.0) -> np.ndarray:
    """Map times from a source clock onto the target clock: ``scale * (t - offset_s)``.

    With ``scale == 1`` this is the loaders' convention ``t_neural = t_video - t_offset_s``.
    ``scale`` corrects clock drift (e.g. a camera that really runs at 49.98 Hz when it claims
    50 Hz): a source interval of ``dt`` becomes ``scale * dt``.
    """
    return float(scale) * (np.asarray(t, dtype=float) - float(offset_s))


def fit_clock(
    t_a_events, t_b_events, *, return_rms: bool = False
) -> tuple[float, float] | tuple[float, float, float]:
    """Least-squares ``(offset_s, scale)`` taking clock A to clock B from paired sync events.

    ``t_a_events[i]`` and ``t_b_events[i]`` are the same physical event (a TTL pulse, an LED
    flash) timed by each clock.  The fit is ``t_b = scale * (t_a - offset_s)``, so
    ``apply_clock(t_a, offset_s, scale)`` lands on clock B.  One event pins the offset only
    (``scale = 1``); two or more also fit drift.

    Parameters
    ----------
    t_a_events, t_b_events : array-like
        Equal-length event times in seconds on clock A (e.g. video) and B (e.g. neural).
    return_rms : bool, default False
        Also return the RMS residual in seconds; a value much larger than one frame means the
        events were mismatched.
    """
    a = np.asarray(t_a_events, dtype=float).ravel()
    b = np.asarray(t_b_events, dtype=float).ravel()
    if a.shape != b.shape:
        raise ValueError(f"{a.size} events on clock A but {b.size} on clock B")
    if a.size < 1:
        raise ValueError("need at least one paired sync event")
    if not (np.all(np.isfinite(a)) and np.all(np.isfinite(b))):
        raise ValueError("sync events must be finite")
    if a.size == 1:
        offset, scale = float(a[0] - b[0]), 1.0
    else:
        if np.ptp(a) == 0:
            raise ValueError("sync events on clock A are all identical")
        scale, icpt = np.polyfit(a, b, 1)
        scale = float(scale)
        if scale <= 0:
            raise ValueError(f"fitted scale {scale:g} is not positive; events are mismatched")
        offset = float(-icpt / scale)
    if return_rms:
        rms = float(np.sqrt(np.mean((apply_clock(a, offset, scale) - b) ** 2)))
        return offset, scale, rms
    return offset, scale


@register("preprocess")
class TimingCheck(PreprocessStep):
    """Record a ``timing_report`` of ``session.t`` in ``meta["timing"]`` and warn on problems.

    Warns when the estimated dropped-frame fraction exceeds ``max_dropped_fraction`` or the
    interval jitter exceeds ``max_jitter_s`` (default a quarter of the median interval).  The
    session is otherwise unchanged (pure).
    """

    name: ClassVar[str] = "timing_check"

    max_dropped_fraction: float = Field(0.01, ge=0, le=1)
    max_jitter_s: float | None = Field(None, gt=0, description="Default: 0.25 / fs_median.")

    def apply(self, session: Session) -> Session:
        rep = timing_report(session.t, session.fs)
        limit = self.max_jitter_s if self.max_jitter_s is not None else 0.25 / rep["fs_median"]
        problems = []
        if rep["dropped_fraction"] > self.max_dropped_fraction:
            problems.append(
                f"{rep['n_dropped_frames']} dropped frames ({rep['dropped_fraction']:.2%}, "
                f"limit {self.max_dropped_fraction:.2%})"
            )
        if rep["jitter_sd_s"] > limit:
            problems.append(
                f"interval jitter {rep['jitter_sd_s'] * 1000:.2f} ms > {limit * 1000:.2f} ms"
            )
        if problems:
            warnings.warn(
                "timing_check: " + "; ".join(problems) + ". Dropped frames break the regular "
                "time base; see 'Two clocks and dropped frames' in docs/BRING_YOUR_OWN_DATA.md.",
                UserWarning,
                stacklevel=2,
            )
        rep["ok"] = not problems
        return session.replace(meta={**session.meta, "timing": rep})


@register("preprocess")
class TrimToOverlap(PreprocessStep):
    """Keep one contiguous stretch of frames where every listed signal is covered.

    For each name in ``signals`` the step reads, in order, the mask ``{name}_covered`` (written
    by ``resample_signal``), a mask called ``name``, or the ``support`` of the state space
    ``name``.  ``signals=None`` uses every ``*_covered`` mask.  Frames where all are True and
    that lie within ``[t0_s, t1_s]`` (when given) are candidates; the longest contiguous run is
    kept through ``Session.select_frames`` (a warning says if other candidate frames were
    dropped).  Details go to ``meta["trim_to_overlap"]``.
    """

    name: ClassVar[str] = "trim_to_overlap"

    signals: list[str] | None = Field(None, description="Behavior/state names; None = all.")
    t0_s: float | None = Field(None, description="Earliest kept time, seconds.")
    t1_s: float | None = Field(None, description="Latest kept time, seconds.")

    @model_validator(mode="after")
    def _check(self) -> TrimToOverlap:
        if self.t0_s is not None and self.t1_s is not None and self.t1_s <= self.t0_s:
            raise ValueError("t1_s must be greater than t0_s")
        return self

    def _mask_for(self, session: Session, name: str) -> np.ndarray:
        if f"{name}_covered" in session.masks:
            return session.masks[f"{name}_covered"]
        if name in session.masks:
            return session.masks[name]
        st = session.states.get(name)
        if st is not None and st.support is not None:
            return st.support
        raise KeyError(
            f"no coverage for {name!r}: need mask '{name}_covered', mask '{name}' or a state "
            f"space with support; masks: {sorted(session.masks)}"
        )

    def apply(self, session: Session) -> Session:
        names = (
            [k[: -len("_covered")] for k in session.masks if k.endswith("_covered")]
            if self.signals is None
            else list(self.signals)
        )
        keep = np.ones(session.n_time, bool)
        for n in names:
            keep &= self._mask_for(session, n)
        if self.t0_s is not None:
            keep &= session.t >= self.t0_s
        if self.t1_s is not None:
            keep &= session.t <= self.t1_s
        starts, lens = runs(keep)
        if starts.size == 0:
            raise ValueError(f"trim_to_overlap: no frame is covered by all of {names}")
        i = int(np.argmax(lens))
        a, b = int(starts[i]), int(starts[i] + lens[i])
        n_other = int(keep.sum() - lens[i])
        if n_other:
            warnings.warn(
                f"trim_to_overlap kept the longest contiguous run ({b - a} frames) and dropped "
                f"{n_other} other covered frames separated by gaps",
                UserWarning,
                stacklevel=2,
            )
        out = session.select_frames(slice(a, b))
        log = {
            "signals": names,
            "n_before": session.n_time,
            "n_after": b - a,
            "start_frame": a,
            "stop_frame": b,
            "t_start": float(session.t[a]),
            "t_stop": float(session.t[b - 1]),
            "n_dropped_noncontiguous": n_other,
        }
        return out.replace(meta={**out.meta, "trim_to_overlap": log})


def _interp_rows(t_src: np.ndarray, a: np.ndarray, t_new: np.ndarray) -> np.ndarray:
    """Linear interpolation along the last axis (NaN propagates from either neighbour)."""
    k = np.clip(np.searchsorted(t_src, t_new, side="right") - 1, 0, t_src.size - 2)
    span = t_src[k + 1] - t_src[k]
    w = np.where(span > 0, (t_new - t_src[k]) / np.where(span > 0, span, 1), 0.0)
    return a[..., k] * (1 - w) + a[..., k + 1] * w


@register("preprocess")
class Resample(PreprocessStep):
    """Resample the whole session onto ``fs_target`` Hz (non-integer ratios allowed).

    Prefer an integer ``Session.rebin``: it averages or sums whole frames and is exact.  When
    ``fs / fs_target`` is an integer greater than 1 this step simply calls ``rebin``.  Otherwise
    new frame times are ``t[0] + j / fs_target`` up to ``t[-1]`` and:

    * ``activity`` of continuous kinds (``dff``, ``raw``, ``zscored``, ``denoised``) and float
      ``signals`` are linearly interpolated between the two neighbouring source frames;
    * ``activity`` of event kinds (``deconvolved``, ``spike_counts``) is **summed** over the
      source frames whose time falls in each new frame (``binary``: any), so totals are kept
      only approximately when the grid is not a multiple of the source grid;
    * ``states`` take the nearest source frame; ``masks`` and ``support`` are True only where
      *every* source frame in the new frame is True (and there is at least one).

    Raw ``behavior`` is untouched.  A ``UserWarning`` always says that the output is
    interpolated.  Details go to ``meta["resample"]``.
    """

    name: ClassVar[str] = "resample"

    fs_target: float = Field(..., gt=0, description="Target rate, Hz.")

    def apply(self, session: Session) -> Session:
        fs0, fs1 = session.fs, float(self.fs_target)
        ratio = fs0 / fs1
        if abs(ratio - 1) < 1e-9:
            return session
        if ratio > 1 and abs(ratio - round(ratio)) < 1e-6:
            out = session.rebin(round(ratio) / fs0)
            return out.replace(meta={**out.meta, "resample": {"fs_target": fs1, "method": "rebin"}})
        warnings.warn(
            f"resample: fs {fs0:g} Hz -> {fs1:g} Hz is not an integer ratio, so frames are "
            "interpolated (continuous data) or re-binned unevenly (events). An integer "
            "Session.rebin is exact and preferred whenever the target allows it.",
            UserWarning,
            stacklevel=2,
        )
        if fs1 > fs0:
            warnings.warn(
                "resample: upsampling adds no information; event-like activity becomes sparse",
                UserWarning,
                stacklevel=2,
            )
        t = session.t
        n_new = int(np.floor((t[-1] - t[0]) * fs1 + 1e-9)) + 1
        if n_new < 2:
            raise ValueError("resample: fewer than two target frames would remain")
        t_new = t[0] + np.arange(n_new) / fs1
        # source frames per target frame: those with time in [t_j - h, t_j + h)
        h = 0.5 / fs1
        lo = np.searchsorted(t, t_new - h, side="left")
        hi = np.searchsorted(t, t_new + h, side="left")
        count = hi - lo
        nearest = np.clip(np.searchsorted(t, t_new), 1, t.size - 1)
        nearest = np.where(
            np.abs(t_new - t[nearest - 1]) <= np.abs(t[nearest] - t_new), nearest - 1, nearest
        )

        def frac_all(m: np.ndarray) -> np.ndarray:
            cs = np.concatenate([[0], np.cumsum(~np.asarray(m, bool))])
            return ((cs[hi] - cs[lo]) == 0) & (count > 0)

        kind = session.activity_kind
        act = session.activity.astype(float)
        if kind in EVENT_KINDS:
            cs = np.concatenate([np.zeros((act.shape[0], 1)), np.cumsum(act, axis=1)], axis=1)
            new_act = cs[:, hi] - cs[:, lo]
            if kind == "binary":
                new_act = (new_act > 0).astype(float)
        else:
            new_act = _interp_rows(t, act, t_new)
        signals = {}
        for k, v in session.signals.items():
            v = np.asarray(v)
            if v.dtype.kind == "f":
                signals[k] = np.moveaxis(_interp_rows(t, np.moveaxis(v, 0, -1), t_new), -1, 0)
            else:
                signals[k] = v[nearest]
        masks = {k: frac_all(m) for k, m in session.masks.items()}
        states = {
            k: st.model_copy(
                update={
                    "onehot": st.onehot[nearest],
                    "support": None if st.support is None else frac_all(st.support),
                }
            )
            for k, st in session.states.items()
        }
        info = {
            "fs_source": fs0,
            "fs_target": fs1,
            "n_before": session.n_time,
            "n_after": n_new,
            "method": "sum" if kind in EVENT_KINDS else "linear",
        }
        return session.replace(
            activity=new_act,
            t=t_new,
            fs=fs1,
            signals=signals,
            masks=masks,
            states=states,
            meta={**session.meta, "resample": info},
        )


__all__ = ["Resample", "TimingCheck", "TrimToOverlap", "apply_clock", "fit_clock", "timing_report"]
