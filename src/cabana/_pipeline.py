"""Declarative pipeline: transforms -> preprocess -> analyses."""

from __future__ import annotations

import warnings
from typing import Any

import numpy as np

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from . import _preprocess as _preprocess  # noqa: F401  (registers plugins)
from . import _transform as _transform  # noqa: F401  (registers plugins)
from ._models import Session
from ._registry import Metric, PreprocessStep, Transform, build
from ._results import MetricResult, ResultSet
from ._shuffle import ShuffleConfig, shuffle_test

try:  # optional
    import yaml
except ImportError:  # pragma: no cover
    yaml = None


class AnalysisSpec(BaseModel):
    """One metric applied to one target (a state space or a continuous signal)."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    metric: Metric = Field(..., description="Metric instance or {'name': ..., **params} dict.")
    states: str | None = Field(
        None, description="Name of the StateSpace in session.states (metrics with input='states')."
    )
    signal: str | None = Field(
        None, description="Name of a per-frame signal in session.signals (metrics with input='signal')."
    )
    shuffle: ShuffleConfig | None = Field(None, description="None means observed value only.")
    masks: list[str] | None = Field(
        None,
        description=(
            "Names of session.masks to AND together for this analysis. None uses every "
            "mask; [] uses no mask. Lets a speed threshold apply to spatial metrics but not "
            "to social-behavior metrics in the same pipeline."
        ),
    )

    @field_validator("metric", mode="before")
    @classmethod
    def _build_metric(cls, v: Any) -> Any:
        return build("metric", v) if isinstance(v, dict) else v

    @model_validator(mode="after")
    def _check_target(self) -> AnalysisSpec:
        if (self.states is None) == (self.signal is None):
            raise ValueError("give exactly one of states= or signal=")
        want = self.metric.input
        if want == "states" and self.states is None:
            raise ValueError(f"metric {self.metric.name!r} takes a state space: pass states=")
        if want == "signal" and self.signal is None:
            raise ValueError(f"metric {self.metric.name!r} takes a continuous signal: pass signal=")
        return self

    @property
    def target(self) -> str:
        return self.states if self.states is not None else self.signal  # type: ignore[return-value]

    def to_dict(self) -> dict[str, Any]:
        return {
            "metric": self.metric.to_dict(),
            "states": self.states,
            "signal": self.signal,
            "shuffle": None if self.shuffle is None else self.shuffle.model_dump(),
            "masks": self.masks,
        }


def _build_list(kind: str, v: Any) -> Any:
    if isinstance(v, (list, tuple)):
        return [build(kind, x) if isinstance(x, dict) else x for x in v]  # type: ignore[arg-type]
    return v


def _plain(x: Any) -> Any:
    """Convert tuples to lists recursively (for YAML)."""
    if isinstance(x, dict):
        return {k: _plain(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_plain(v) for v in x]
    return x


class Pipeline(BaseModel):
    """Ordered transforms, preprocess steps and analyses."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    transforms: list[Transform] = Field(default_factory=list, description="Applied first.")
    preprocess: list[PreprocessStep] = Field(default_factory=list, description="Applied second.")
    analyses: list[AnalysisSpec] = Field(default_factory=list, description="Run last.")

    @field_validator("transforms", mode="before")
    @classmethod
    def _t(cls, v: Any) -> Any:
        return _build_list("transform", v)

    @field_validator("preprocess", mode="before")
    @classmethod
    def _p(cls, v: Any) -> Any:
        return _build_list("preprocess", v)

    def run(self, session: Session, progress: bool = False) -> tuple[Session, ResultSet]:
        """Apply all stages; the input session is not modified."""

        def say(msg: str) -> None:
            if progress:
                print(msg, flush=True)

        for t in self.transforms:
            say(f"[transform] {t.name}")
            session = t.apply(session)
        for p in self.preprocess:
            say(f"[preprocess] {p.name}")
            session = p.apply(session)

        results = ResultSet()
        for spec in self.analyses:
            metric = spec.metric.model_copy()  # configure() mutates a per-run copy
            say(f"[analyze] {metric.name} on {spec.target}")
            if spec.states is not None:
                if spec.states not in session.states:
                    raise KeyError(
                        f"no state space {spec.states!r}; available: {sorted(session.states)}"
                    )
                target: Any = session.states[spec.states]
                state_names: list[str] | None = target.state_names
            else:
                if spec.signal not in session.signals:
                    raise KeyError(
                        f"no signal {spec.signal!r}; available: {sorted(session.signals)}"
                    )
                target = np.asarray(session.signals[spec.signal], dtype=np.float64)
                state_names = None
            metric.check_activity_kind(session.activity_kind)
            metric.configure(session, spec.target)
            missing = [m for m in (spec.masks or []) if m not in session.masks]
            if missing:
                raise KeyError(
                    f"analysis masks {missing} not in session.masks "
                    f"(available: {sorted(session.masks)})"
                )
            if spec.masks is None and len(session.masks) > 1:
                warnings.warn(
                    f"analysis {metric.name!r} on {spec.target!r}: masks=None ANDs all "
                    f"{sorted(session.masks)}; pass masks=[...] to choose explicitly",
                    stacklevel=2,
                )
            mask = session.valid_mask(spec.masks)
            shuf = None
            if spec.shuffle is not None:
                shuf = shuffle_test(metric, session.activity, target, mask, spec.shuffle, session.fs)
                values = shuf.observed
            else:
                metric.check_target(target)
                values = metric.compute(session.activity, target, mask, session.fs)
            extras = metric.extras(session.activity, target, mask, session.fs)
            has_state_axis = values.ndim >= 2 or metric.level == "population"
            results.add(
                MetricResult(
                    metric=metric.name,
                    target=spec.target,
                    target_kind=metric.input,
                    level=metric.level,
                    values=values,
                    shuffle=shuf,
                    params=metric.to_dict(),
                    extras=extras,
                    cell_ids=session.cell_ids if metric.level == "cell" else None,
                    state_names=state_names if has_state_axis else None,
                )
            )
        return session, results

    def to_dict(self) -> dict[str, Any]:
        return {
            "transforms": [t.to_dict() for t in self.transforms],
            "preprocess": [p.to_dict() for p in self.preprocess],
            "analyses": [a.to_dict() for a in self.analyses],
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Pipeline:
        return cls(
            transforms=d.get("transforms", []),
            preprocess=d.get("preprocess", []),
            analyses=d.get("analyses", []),
        )

    def to_yaml(self) -> str:
        if yaml is None:
            raise ImportError("to_yaml requires pyyaml (pip install pyyaml)")
        return yaml.safe_dump(_plain(self.to_dict()), sort_keys=False)

    @classmethod
    def from_yaml(cls, text: str) -> Pipeline:
        if yaml is None:
            raise ImportError("from_yaml requires pyyaml (pip install pyyaml)")
        return cls.from_dict(yaml.safe_load(text))


__all__ = ["AnalysisSpec", "Pipeline"]
