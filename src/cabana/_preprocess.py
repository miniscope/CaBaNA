"""Preprocess steps: masks and activity conditioning (``Session -> Session``)."""

from __future__ import annotations

from typing import ClassVar, Literal

import numpy as np
from pydantic import Field, model_validator
from scipy.ndimage import gaussian_filter1d

from ._models import Session
from ._registry import PreprocessStep, register


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
    """Z-score each cell using mean/std over ``valid_mask()`` frames (std 0 -> centered only)."""

    name: ClassVar[str] = "zscore_activity"

    def apply(self, session: Session) -> Session:
        a = np.asarray(session.activity, dtype=float)
        m = session.valid_mask()
        if not m.any():
            raise ValueError("valid_mask() is empty; cannot z-score")
        mu = a[:, m].mean(axis=1, keepdims=True)
        sd = a[:, m].std(axis=1, keepdims=True)
        sd = np.where(sd > 0, sd, 1.0)
        return session.with_activity((a - mu) / sd, kind="zscored")


@register("preprocess")
class BinarizeActivity(PreprocessStep):
    """Replace activity by ``activity > threshold`` as float (0.0 / 1.0)."""

    name: ClassVar[str] = "binarize_activity"

    threshold: float = Field(0.0, description="Activity strictly above this becomes 1.")

    def apply(self, session: Session) -> Session:
        return session.with_activity((np.asarray(session.activity) > self.threshold).astype(float))


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
