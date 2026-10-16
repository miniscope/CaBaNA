"""Declarative pipeline: transforms -> preprocess -> analyses."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
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
    """One metric applied to one target (a state space or a continuous signal).

    Exactly one of ``states`` / ``signal`` must be given, matching the metric's
    ``input`` (``"states"`` or ``"signal"``).  ``metric`` may be a metric instance
    or a ``{"name": ..., **params}`` dict (as in YAML).

    Parameters
    ----------
    name : str | None, default None
        Unique analysis name; ``None`` derives ``"metric[target]"``.
    metric : Metric | dict
        The metric to compute.
    states : str | None
        Key into ``session.states``.
    signal : str | None
        Key into ``session.signals``.
    shuffle : ShuffleConfig | None, default None
        Null-distribution test; ``None`` returns observed values only.
    masks : list[str] | None, default None
        Names of ``session.masks`` to AND together (see ``Pipeline``).

    Examples
    --------
    A spatial analysis that respects the speed mask and a social analysis that
    does not, with a shuffle test on the first::

        place = AnalysisSpec(
            metric={"name": "information_content"}, states="position",
            masks=["speed"], shuffle=ShuffleConfig(n_shuffles=500, seed=1),
        )
        social = AnalysisSpec(metric={"name": "auroc"}, states="social")
    """

    model_config = ConfigDict(arbitrary_types_allowed=True, extra="forbid")

    name: str | None = Field(
        None,
        description=(
            "Unique name of this analysis in the ResultSet. None derives 'metric[target]', "
            "adding '#<null>' and/or '#<n>' if that collides within the pipeline."
        ),
    )
    metric: Metric = Field(..., description="Metric instance or {'name': ..., **params} dict.")
    states: str | None = Field(
        None, description="Name of the StateSpace in session.states (metrics with input='states')."
    )
    signal: str | None = Field(
        None,
        description="Name of a per-frame signal in session.signals (metrics with input='signal').",
    )
    shuffle: ShuffleConfig | None = Field(None, description="None means observed value only.")
    masks: list[str] | None = Field(
        None,
        description=(
            "Names of session.masks to AND together for this analysis, on top of the "
            "target StateSpace's own ``support`` (always applied when the target has one). "
            "None and [] both mean 'support only' (no extra masks). Lets a speed threshold "
            "apply to spatial metrics but not to social-behavior metrics in the same pipeline."
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
            "name": self.name,
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


def _target_params(session: Session, target: str) -> dict[str, Any] | None:
    """Parameters of the last logged transform that produced ``target``, if any."""
    for entry in reversed(session.meta.get("transforms", [])):
        if entry.get("output") == target:
            return _plain(entry)
        if entry.get("name") == "resample_signal":
            chans = entry.get("channels")
            if chans is None or target in chans:
                return _plain(entry)
    return None


class Pipeline(BaseModel):
    """Ordered transforms, preprocess steps and analyses, runnable and serialisable.

    **Order of application.**  ``run`` applies every transform in list order
    (each builds states / signals / masks and is logged in
    ``session.meta["transforms"]``), then every preprocess step in list order
    (masks, smoothing, z-scoring, re-binning), then every analysis in list order
    on the resulting session.  Put re-binning after the transforms that create
    state spaces and masks.

    **Returns.**  ``run(session, progress=False)`` returns ``(Session,
    ResultSet)``: the processed session (the input is not modified) and one
    ``MetricResult`` per analysis.

    **Serialisation.**  ``to_dict()`` / ``from_dict(d)`` round-trip through plain
    dicts; ``to_yaml(path=None)`` returns the YAML text (and writes it to ``path``
    when given); ``from_yaml(text_or_path)`` accepts YAML text or the path of a
    YAML file.  YAML needs ``pyyaml``.

    **Analysis naming.**  A result is named by ``AnalysisSpec.name`` when given
    (duplicates raise ``ValueError``).  Otherwise the name is ``metric[target]``,
    e.g. ``auroc[social]``.  If that name is already taken in the pipeline and the
    analysis has a shuffle, ``#<null>`` is appended (``auroc[social]#label_shuffle``);
    if still taken, ``#2``, ``#3``, ... is appended to the base name.  Fetch a
    result with ``ResultSet[name]`` or ``ResultSet.get``.

    **Masks.**  The effective mask of an analysis is the target ``StateSpace``'s
    ``support`` (when it has one; signals have none) AND all frames kept by the
    masks listed in ``AnalysisSpec.masks``.  ``masks=None`` and ``masks=[]`` both
    mean "support only": session masks that are not listed are *not* applied.
    Naming a mask that does not exist raises ``KeyError``.  Example::

        Pipeline(
            preprocess=[{"name": "speed_threshold", "min_speed": 2.0}],
            analyses=[
                {"metric": {"name": "information_content"}, "states": "position",
                 "masks": ["speed"]},          # speed mask AND position support
                {"metric": {"name": "auroc"}, "states": "social"},  # social support only
            ],
        )

    Each result's ``provenance`` records version, seed, null, masks used, frames
    used, sampling rate, activity kind, transform parameters and a timestamp.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True, extra="forbid")

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
        """Apply all stages; the input session is not modified.

        Parameters
        ----------
        session : Session
            Session holding the raw behavior inputs and activity.
        progress : bool, default False
            Print a line per stage / analysis.

        Returns
        -------
        tuple[Session, ResultSet]
            The processed session and the results, in analysis order.

        Raises
        ------
        KeyError
            If an analysis names a state space, signal or mask that is not in the
            session.
        ValueError
            If two analyses share an explicit ``name``, or a metric rejects its
            target (e.g. a non-exclusive state space).


        Each analysis runs on ``target.support & AND(masks listed in the spec)``;
        see ``AnalysisSpec.masks``.  Transform parameters are appended to
        ``session.meta["transforms"]`` and recorded in each result's provenance.
        """
        from . import __version__

        def say(msg: str) -> None:
            if progress:
                print(msg, flush=True)

        for t in self.transforms:
            say(f"[transform] {t.name}")
            session = t.apply(session)
            log = [*session.meta.get("transforms", []), t.to_dict()]
            session = session.replace(meta={**session.meta, "transforms": log})
        for p in self.preprocess:
            say(f"[preprocess] {p.name}")
            session = p.apply(session)

        reserved = {a.name for a in self.analyses if a.name is not None}
        if len(reserved) != sum(a.name is not None for a in self.analyses):
            raise ValueError("duplicate AnalysisSpec.name in pipeline")
        used: set[str] = set()

        def unique_name(spec: AnalysisSpec) -> str:
            if spec.name is not None:
                return spec.name
            base = f"{spec.metric.name}[{spec.target}]"
            cands = [base]
            if spec.shuffle is not None:
                cands.append(f"{base}#{spec.shuffle.resolved_null().name}")
            n = 2
            for c in cands:
                if c not in used and c not in reserved:
                    return c
            while f"{base}#{n}" in used or f"{base}#{n}" in reserved:
                n += 1
            return f"{base}#{n}"

        results = ResultSet()
        for spec in self.analyses:
            metric = spec.metric.model_copy()  # configure() mutates a per-run copy
            name = unique_name(spec)
            used.add(name)
            say(f"[analyze] {name}")
            support = None
            if spec.states is not None:
                if spec.states not in session.states:
                    raise KeyError(
                        f"no state space {spec.states!r}; available: {sorted(session.states)}"
                    )
                target: Any = session.states[spec.states]
                state_names: list[str] | None = target.state_names
                support = target.support
            else:
                if spec.signal not in session.signals:
                    raise KeyError(
                        f"no signal {spec.signal!r}; available: {sorted(session.signals)}"
                    )
                target = np.asarray(session.signals[spec.signal], dtype=np.float64)
                state_names = None
            metric.check_activity_kind(session.activity_kind)
            metric.configure(session, spec.target)
            listed = list(spec.masks or [])
            missing = [m for m in listed if m not in session.masks]
            if missing:
                raise KeyError(
                    f"analysis masks {missing} not in session.masks "
                    f"(available: {sorted(session.masks)})"
                )
            mask = session.valid_mask(listed)
            if support is not None:
                mask = mask & support
            shuf = None
            if spec.shuffle is not None:
                shuf = shuffle_test(
                    metric, session.activity, target, mask, spec.shuffle, session.fs
                )
                values = shuf.observed
            else:
                metric.check_target(target)
                values = metric.compute(session.activity, target, mask, session.fs)
            extras = metric.extras(session.activity, target, mask, session.fs)
            has_state_axis = values.ndim >= 2 or metric.level == "population"
            if values.ndim == 2 and "group_names" in extras:
                state_names = [str(g) for g in extras["group_names"]]
            provenance = {
                "cabana_version": __version__,
                "seed": None if spec.shuffle is None else spec.shuffle.seed,
                "null": None if shuf is None else shuf.null_name,
                "n_shuffles": None if shuf is None else shuf.n_shuffles,
                "alpha": None if shuf is None else shuf.alpha,
                "tail": None if shuf is None else shuf.tail,
                "masks": listed,
                "support_used": support is not None,
                "n_frames_used": int(mask.sum()),
                "fs": float(session.fs),
                "activity_kind": session.activity_kind,
                "n_cells": session.n_cells,
                "target_kind": metric.input,
                "target_params": _target_params(session, spec.target),
                "timestamp": datetime.now(UTC).isoformat(timespec="seconds"),
            }
            results.add(
                MetricResult(
                    metric=metric.name,
                    target=spec.target,
                    name=name,
                    target_kind=metric.input,
                    level=metric.level,
                    values=values,
                    shuffle=shuf,
                    params=metric.to_dict(),
                    extras=extras,
                    cell_ids=session.cell_ids if metric.level == "cell" else None,
                    state_names=state_names if has_state_axis else None,
                    provenance=provenance,
                )
            )
        return session, results

    def to_dict(self) -> dict[str, Any]:
        """Plain-dict form (``{"transforms": [...], "preprocess": [...], "analyses": [...]}``)."""
        return {
            "transforms": [t.to_dict() for t in self.transforms],
            "preprocess": [p.to_dict() for p in self.preprocess],
            "analyses": [a.to_dict() for a in self.analyses],
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Pipeline:
        """Inverse of :meth:`to_dict`; missing sections default to empty lists."""
        return cls(
            transforms=d.get("transforms", []),
            preprocess=d.get("preprocess", []),
            analyses=d.get("analyses", []),
        )

    def to_yaml(self, path: str | Path | None = None) -> str:
        """YAML text of the pipeline; also written to ``path`` when given.

        Parameters
        ----------
        path : str or Path, optional
            File to write the text to.

        Returns
        -------
        str
            The YAML text.

        Raises
        ------
        ImportError
            If ``pyyaml`` is not installed.
        """
        if yaml is None:
            raise ImportError("to_yaml requires pyyaml (pip install pyyaml)")
        text = yaml.safe_dump(_plain(self.to_dict()), sort_keys=False)
        if path is not None:
            Path(path).write_text(text)
        return text

    @classmethod
    def from_yaml(cls, text_or_path: str | Path) -> Pipeline:
        """Build from YAML text, or from a YAML file given as a ``Path`` or path string.

        Parameters
        ----------
        text_or_path : str or Path
            A ``Path`` is always read as a file.  A string is read as a file when
            it is a single line naming an existing file, else parsed as YAML text.

        Returns
        -------
        Pipeline

        Raises
        ------
        FileNotFoundError
            If a one-line string without ``:`` is not an existing file.
        ValueError
            If the YAML is not a mapping.
        ImportError
            If ``pyyaml`` is not installed.
        """
        if yaml is None:
            raise ImportError("from_yaml requires pyyaml (pip install pyyaml)")
        if isinstance(text_or_path, Path):
            text = text_or_path.read_text()
        else:
            s = str(text_or_path)
            one_line = "\n" not in s
            if one_line and Path(s).is_file():
                text = Path(s).read_text()
            elif one_line and ":" not in s and not s.lstrip().startswith(("{", "[")):
                raise FileNotFoundError(f"{s!r} is neither an existing YAML file nor YAML text")
            else:
                text = s
        d = yaml.safe_load(text)
        if not isinstance(d, dict):
            raise ValueError("pipeline YAML must be a mapping with transforms/preprocess/analyses")
        return cls.from_dict(d)


__all__ = ["AnalysisSpec", "Pipeline"]
