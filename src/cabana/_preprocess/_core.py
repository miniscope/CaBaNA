"""Preprocess steps: masks and activity conditioning (``Session -> Session``)."""

from __future__ import annotations

import warnings
from typing import ClassVar, Literal

import numpy as np
from pydantic import Field, model_validator
from scipy.ndimage import gaussian_filter1d

from .._models import Session
from .._registry import PreprocessStep, register


@register("preprocess")
class SpeedThreshold(PreprocessStep):
    """Keep frames whose speed lies in ``[min_speed, max_speed]``; NaN speed is dropped."""

    name: ClassVar[str] = "speed_threshold"

    signal: str = Field("speed", description="Per-frame speed signal to threshold.")
    min_speed: float = Field(..., ge=0, description="Minimum speed (inclusive), signal units/s.")
    max_speed: float | None = Field(None, description="Maximum speed (inclusive); None = no cap.")
    output: str = Field("speed", description="Name of the mask written.")

    def apply(self, session: Session) -> Session:
        if self.signal not in session.signals:
            raise KeyError(f"signal {self.signal!r} missing; available: {sorted(session.signals)}")
        v = np.asarray(session.signals[self.signal], dtype=float)
        with np.errstate(invalid="ignore"):
            m = v >= self.min_speed
            if self.max_speed is not None:
                m &= v <= self.max_speed
        m &= np.isfinite(v)
        return session.with_mask(self.output, m, source=self.to_dict())


@register("preprocess")
class TimeRange(PreprocessStep):
    """Keep frames with ``start_s <= t <= stop_s`` (either bound may be None)."""

    name: ClassVar[str] = "time_range"

    start_s: float | None = Field(None, description="First time kept (inclusive); None = start.")
    stop_s: float | None = Field(None, description="Last time kept (inclusive); None = end.")
    output: str = Field("time_range", description="Name of the mask written.")

    @model_validator(mode="after")
    def _check(self) -> TimeRange:
        if self.start_s is not None and self.stop_s is not None and self.stop_s < self.start_s:
            raise ValueError("stop_s must be >= start_s")
        return self

    def apply(self, session: Session) -> Session:
        m = np.ones(session.n_time, dtype=bool)
        if self.start_s is not None:
            m &= session.t >= self.start_s
        if self.stop_s is not None:
            m &= session.t <= self.stop_s
        return session.with_mask(self.output, m, source=self.to_dict())


@register("preprocess")
class SmoothActivity(PreprocessStep):
    """Gaussian smoothing of each cell's activity along time (edges use nearest padding)."""

    name: ClassVar[str] = "smooth_activity"

    sigma_s: float = Field(..., gt=0, description="Gaussian standard deviation in seconds.")

    def apply(self, session: Session) -> Session:
        out = gaussian_filter1d(
            np.asarray(session.activity, dtype=float),
            sigma=self.sigma_s * session.fs,
            axis=1,
            mode="nearest",
        )
        return session.with_activity(out)


@register("preprocess")
class ZscoreActivity(PreprocessStep):
    """Z-score activity using mean/std over a set of frames (std 0 -> centered only).

    ``by="cell"`` standardises each cell separately, ``"global"`` uses one mean and SD
    pooled over all cells (keeps relative amplitudes).  Frames come from the masks named
    in ``mask_names``; ``None`` means ``valid_mask()`` of *all masks present*, so the result
    depends on which steps ran before this one.  Name the masks explicitly to avoid that.
    ``baseline_window_s=(t0, t1)`` restricts the statistics to a baseline period
    (session time, seconds) so values are z-scores against baseline rather than the whole
    session.  NaN frames are ignored in the statistics and stay NaN.  Output kind is
    ``zscored``; the previous kind is stored in ``meta["zscore_source_kind"]``.
    """

    name: ClassVar[str] = "zscore_activity"

    by: Literal["cell", "global"] = Field("cell", description="Per-cell or pooled statistics.")
    mask_names: list[str] | None = Field(
        None, description="Masks defining frames used for the statistics; None = all masks."
    )
    baseline_window_s: tuple[float, float] | None = Field(
        None,
        description="(start_s, stop_s) baseline period for the statistics; None = whole session.",
    )

    def apply(self, session: Session) -> Session:
        a = np.asarray(session.activity, dtype=float)
        if self.mask_names is not None:
            missing = [n for n in self.mask_names if n not in session.masks]
            if missing:
                raise KeyError(f"masks {missing} missing; available: {sorted(session.masks)}")
        m = session.valid_mask(self.mask_names)
        if self.baseline_window_s is not None:
            t0, t1 = self.baseline_window_s
            if t1 < t0:
                raise ValueError("baseline_window_s must be (start, stop) with stop >= start")
            m = m & (session.t >= t0) & (session.t <= t1)
        if not m.any():
            raise ValueError("no frames selected for z-score statistics")
        sel = a[:, m]
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            if self.by == "cell":
                mu = np.nanmean(sel, axis=1, keepdims=True)
                sd = np.nanstd(sel, axis=1, keepdims=True)
            else:
                mu = np.nanmean(sel)
                sd = np.nanstd(sel)
        sd = np.where(sd > 0, sd, 1.0)
        out = session.with_activity((a - mu) / sd, kind="zscored")
        return out.replace(meta={**out.meta, "zscore_source_kind": session.activity_kind})


@register("preprocess")
class BinarizeActivity(PreprocessStep):
    """Replace activity by ``activity > threshold`` as float (0.0 / 1.0); kind becomes ``binary``.

    Deprecated in favour of :class:`~cabana._preprocess._activity.DetectEvents`, which
    sets the threshold per cell from the noise level and supports minimum duration and
    refractory period.  A single absolute threshold for all cells is rarely right.
    NaN frames stay NaN.
    """

    name: ClassVar[str] = "binarize_activity"

    threshold: float = Field(0.0, description="Activity strictly above this becomes 1.")

    def apply(self, session: Session) -> Session:
        a = np.asarray(session.activity, dtype=float)
        out = np.where(np.isfinite(a), (a > self.threshold).astype(float), np.nan)
        return session.with_activity(out, kind="binary")


__all__ = [
    "BinarizeActivity",
    "SmoothActivity",
    "SpeedThreshold",
    "TimeRange",
    "RebinTime",
    "ZscoreActivity",
]


@register("preprocess")
class RebinTime(PreprocessStep):
    """Re-bin the whole session to coarser time bins (see ``Session.rebin``).

    Place it after the transforms that build state spaces and masks, so that
    everything is resampled together.
    """

    name: ClassVar[str] = "rebin_time"

    bin_s: float = Field(..., gt=0, description="New bin length in seconds.")
    activity_method: Literal["sum", "mean", "auto"] = Field(
        "auto", description="'sum' for event-like activity, 'mean' for dF/F; 'auto' picks by kind."
    )
    min_fraction: float = Field(
        0.5,
        ge=0,
        le=1,
        description="Fraction of frames that must be True/in-state for a bin to count.",
    )

    def apply(self, session: Session) -> Session:
        return session.rebin(self.bin_s, self.activity_method, self.min_fraction)
