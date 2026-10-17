"""Declarative pipeline: transforms -> preprocess -> analyses."""

from __future__ import annotations

import hashlib
import importlib.metadata as _md
import json
import os
import platform
import sys
import time
import traceback as _tb
import warnings
import zlib
from collections.abc import Callable, Iterator
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

import numpy as np

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from . import _alignment as _alignment  # noqa: F401  (registers plugins)
from . import _preprocess as _preprocess  # noqa: F401  (registers plugins)
from . import _preprocess_activity as _preprocess_activity  # noqa: F401  (registers plugins)
from . import _preprocess_cells as _preprocess_cells  # noqa: F401  (registers plugins)
from . import _preprocess_masks as _preprocess_masks  # noqa: F401  (registers plugins)
from . import _selectors as _selectors  # noqa: F401  (registers plugins)
from . import _selectors_null as _selectors_null  # noqa: F401  (registers plugins)
from . import _transform as _transform  # noqa: F401  (registers plugins)
from . import _transform_behavior as _transform_behavior  # noqa: F401  (registers plugins)
from ._models import Session
from ._registry import _REGISTRY, Metric, PreprocessStep, Selector, Transform, build
from ._results import MetricResult, ResultSet, RunError, RunWarning
from ._selection import Selection
from ._shuffle import RunCancelled, ShuffleConfig, resolve_n_jobs, shuffle_test

try:  # optional
    import yaml
except ImportError:  # pragma: no cover
    yaml = None


@dataclass
class ProgressEvent:
    """One progress notification from a pipeline run.

    ``fraction`` is an overall 0-1 estimate: transforms and preprocess steps
    share a small fixed slice (5%), analyses share the rest weighted by
    ``n_shuffles`` (1 without a shuffle).  ``index`` is zero-based within the
    stage and ``total`` the number of items in that stage.
    """

    stage: Literal["transform", "preprocess", "select", "analysis", "shuffle", "done"]
    name: str
    index: int
    total: int
    fraction: float
    shuffles_done: int | None = None
    shuffles_total: int | None = None
    elapsed_s: float = 0.0
    message: str = ""


@dataclass
class RunContext:
    """Run control for :meth:`Pipeline.run` / :meth:`Pipeline.iter_run` / :func:`run_set`.

    Attributes
    ----------
    on_progress : callable(ProgressEvent), optional
        Called at every stage start, analysis end and shuffle batch.
    should_cancel : callable() -> bool, optional
        Polled between stages, between analyses and after every shuffle batch;
        True stops the run (``Pipeline.run`` then returns the partial results
        with ``status="cancelled"``).
    on_error : {"raise", "record"}, default "raise"
        ``"record"`` catches an exception inside one analysis, stores it in
        ``ResultSet.errors`` and continues with the next analysis.
    capture_warnings : bool, default True
        Collect warnings raised per analysis into ``ResultSet.warnings``; they
        are still re-issued through the normal ``warnings`` machinery.
    log : callable(str), optional
        Receives the human-readable stage lines; defaults to ``print`` when
        ``progress=True`` is passed to ``run``, else nothing.
    n_jobs : int, optional
        Overrides every analysis's ``ShuffleConfig.n_jobs`` for this run (``-1`` =
        all cores) without touching the spec; provenance records the value used
        under ``"n_jobs"``.  ``None`` keeps each spec's own value.
    """

    on_progress: Callable[[ProgressEvent], None] | None = None
    should_cancel: Callable[[], bool] | None = None
    on_error: Literal["raise", "record"] = "raise"
    capture_warnings: bool = True
    log: Callable[[str], None] | None = None
    n_jobs: int | None = None


def _print_log(msg: str) -> None:
    print(msg, flush=True)


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


def derive_seed(base: int, name: str) -> int:
    """Per-analysis seed: ``SeedSequence([base, crc32(name)])`` state word (stable across machines)."""
    ss = np.random.SeedSequence([int(base), zlib.crc32(name.encode())])
    return int(ss.generate_state(1, dtype=np.uint64)[0])


def _sha_json(obj: Any) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()


def _session_sha(session: Session) -> str:
    a = np.ascontiguousarray(session.activity)
    h = hashlib.sha256()
    h.update(f"{a.shape}|{a.dtype}".encode())
    h.update(a.tobytes())
    return h.hexdigest()


def _env_info() -> dict[str, str | None]:
    def v(pkg: str) -> str | None:
        try:
            return _md.version(pkg)
        except Exception:
            return None

    return {
        "python": sys.version.split()[0],
        **{p: v(p) for p in ("numpy", "scipy", "pydantic", "numpydantic", "scikit-learn")},
        "platform": platform.platform(),
    }


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

    ``selections`` records how parameter values were chosen (:meth:`set_param`); each
    result's provenance copies the relevant ones.

    Each result's ``provenance`` records version, seed, null, masks used, frames
    used, sampling rate, activity kind, transform parameters and a timestamp.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True, extra="forbid")

    transforms: list[Transform] = Field(default_factory=list, description="Applied first.")
    preprocess: list[PreprocessStep] = Field(default_factory=list, description="Applied second.")
    selectors: list[Selector] = Field(
        default_factory=list,
        description="Data-driven parameter choices applied to a per-run copy before analyses.",
    )
    analyses: list[AnalysisSpec] = Field(default_factory=list, description="Run last.")
    selections: list[Selection] = Field(
        default_factory=list,
        description="How parameter values were chosen (see Pipeline.set_param); copied to provenance.",
    )

    @field_validator("transforms", mode="before")
    @classmethod
    def _t(cls, v: Any) -> Any:
        return _build_list("transform", v)

    @field_validator("preprocess", mode="before")
    @classmethod
    def _p(cls, v: Any) -> Any:
        return _build_list("preprocess", v)

    @field_validator("selectors", mode="before")
    @classmethod
    def _s(cls, v: Any) -> Any:
        return _build_list("selector", v)

    def resolved_names(self) -> list[str]:
        """Result names of the analyses, in order, exactly as a run will assign them.

        Raises
        ------
        ValueError
            If two analyses share an explicit ``name``.
        """
        reserved = {a.name for a in self.analyses if a.name is not None}
        if len(reserved) != sum(a.name is not None for a in self.analyses):
            raise ValueError("duplicate AnalysisSpec.name in pipeline")
        used: set[str] = set()
        out: list[str] = []
        for spec in self.analyses:
            if spec.name is not None:
                name = spec.name
            else:
                base = f"{spec.metric.name}[{spec.target}]"
                cands = [base]
                if spec.shuffle is not None:
                    cands.append(f"{base}#{spec.shuffle.resolved_null().name}")
                name = next((c for c in cands if c not in used and c not in reserved), "")
                if not name:
                    n = 2
                    while f"{base}#{n}" in used or f"{base}#{n}" in reserved:
                        n += 1
                    name = f"{base}#{n}"
            used.add(name)
            out.append(name)
        return out

    # ---- parameter addressing -------------------------------------------------

    def _resolve_key(self, section: str, key: str) -> list[int]:
        """Indices in ``section`` selected by ``key`` (index, ``*``, or a name)."""
        items = getattr(self, section)
        if key == "*":
            return list(range(len(items)))
        if key.lstrip("-").isdigit():
            i = int(key)
            if not -len(items) <= i < len(items):
                raise KeyError(f"{section}[{i}] out of range (have {len(items)})")
            return [i % len(items)]
        if section == "analyses":
            names = self.resolved_names()
            if key in names:
                return [names.index(key)]
            raise KeyError(f"no analysis named {key!r}; available: {names}")
        attrs = ("output", "name") if section == "transforms" else ("name", "output")
        for attr in attrs:
            hits = [i for i, x in enumerate(items) if getattr(x, attr, None) == key]
            if len(hits) == 1:
                return hits
            if len(hits) > 1:
                raise KeyError(
                    f"{section} key {key!r} is ambiguous ({len(hits)} elements have "
                    f"{attr}={key!r}); use an integer index"
                )
        avail = [getattr(x, "output", None) or x.name for x in items]
        raise KeyError(f"no {section} element {key!r}; available: {avail}")

    def _parse_path(self, path: str) -> tuple[str, list[int], str | None, str, bool]:
        """Return ``(section, indices, sub, field, wildcard)`` with only valid, existing targets."""
        parts = path.split(".")
        if len(parts) < 3 or parts[0] not in ("transforms", "preprocess", "analyses"):
            raise ValueError(
                f"bad parameter path {path!r}: expected transforms.<key>.<field>, "
                "preprocess.<key>.<field>, analyses.<key>.metric.<field>, "
                "analyses.<key>.shuffle.<field> or analyses.<key>.<field>"
            )
        section, key, rest = parts[0], parts[1], parts[2:]
        sub: str | None = None
        if section == "analyses" and rest[0] in ("metric", "shuffle"):
            if len(rest) != 2:
                raise ValueError(
                    f"bad parameter path {path!r}: expected analyses.<key>.{rest[0]}.<field>"
                )
            sub = rest[0]
        elif len(rest) != 1:
            raise ValueError(f"bad parameter path {path!r}: too many components")
        field = rest[-1]
        wildcard = key == "*"
        idxs = self._resolve_key(section, key)
        keep: list[int] = []
        for i in idxs:
            obj: Any = getattr(self, section)[i]
            if sub is not None:
                obj = getattr(obj, sub)
                if obj is None:
                    continue
            if field in type(obj).model_fields:
                keep.append(i)
        if not keep:
            what = "any element" if wildcard else "the element"
            raise ValueError(f"{what} addressed by {path!r} has no field {field!r}")
        return section, keep, sub, field, wildcard

    def get_param(self, path: str) -> Any:
        """Value at a dotted parameter path; a list (one per element) for a ``*`` key.

        Path grammar: ``transforms.<key>.<field>``, ``preprocess.<key>.<field>``,
        ``analyses.<key>.metric.<field>``, ``analyses.<key>.shuffle.<field>`` and
        ``analyses.<key>.<field>`` (e.g. ``masks``).  ``<key>`` is an integer index,
        the ``output`` name (transforms; also preprocess) or ``name`` (preprocess;
        also transforms), the resolved analysis name (see :meth:`resolved_names`),
        or ``*`` for every element that has the field.  Keys cannot contain dots.

        Raises
        ------
        ValueError
            For a malformed path or a field that does not exist.
        KeyError
            For an unknown or ambiguous key.
        """
        section, idxs, sub, field, wildcard = self._parse_path(path)
        vals = []
        for i in idxs:
            obj: Any = getattr(self, section)[i]
            if sub is not None:
                obj = getattr(obj, sub)
            vals.append(getattr(obj, field))
        return vals if wildcard else vals[0]

    def set_param(
        self,
        path: str,
        value: Any,
        *,
        selection: Selection | None = None,
        method: str | None = None,
        criterion: str | None = None,
        candidates: list[Any] | None = None,
        scores: list[float] | None = None,
        split: str | None = None,
        informed_by_significance: bool = False,
        note: str | None = None,
    ) -> Pipeline:
        """Return a copy with ``value`` set at ``path`` (this pipeline is not modified).

        The plugin or spec is re-validated with the new value, so invalid values
        raise ``pydantic.ValidationError``.  Give ``selection`` (a
        :class:`Selection` whose ``path`` equals ``path``) or ``method=`` (plus
        optional ``criterion``, ``candidates``, ``scores``, ``split``,
        ``informed_by_significance``, ``note``) to append a record to
        ``selections``.  See :meth:`get_param` for the path grammar.
        """
        if selection is not None and method is not None:
            raise ValueError("pass selection= or method=, not both")
        if selection is not None and selection.path != path:
            raise ValueError(f"selection.path {selection.path!r} != path {path!r}")
        section, idxs, sub, field, _ = self._parse_path(path)

        def revalidate(obj: Any) -> Any:
            data = {k: getattr(obj, k) for k in type(obj).model_fields}
            data[field] = value
            return type(obj).model_validate(data)

        items = list(getattr(self, section))
        for i in idxs:
            if sub is None:
                items[i] = revalidate(items[i])
            else:
                spec = items[i]
                data = {k: getattr(spec, k) for k in type(spec).model_fields}
                data[sub] = revalidate(getattr(spec, sub))
                items[i] = type(spec).model_validate(data)
        update: dict[str, Any] = {section: items}
        if method is not None:
            selection = Selection(
                path=path,
                value=value,
                method=method,  # type: ignore[arg-type]
                criterion=criterion,
                candidates=candidates,
                scores=scores,
                split=split,
                informed_by_significance=informed_by_significance,
                note=note,
            )
        if selection is not None:
            update["selections"] = [*self.selections, selection]
        return self.model_copy(update=update)

    def _selections_for(self, name: str) -> list[dict[str, Any]]:
        """Selections relevant to the analysis ``name`` (pipeline-level plus its own)."""
        try:
            idx = self.resolved_names().index(name)
        except ValueError:
            idx = -1
        own = {name, "*", str(idx)}
        out = []
        for s in self.selections:
            head = s.path.split(".")
            if head[0] in ("transforms", "preprocess") or (
                head[0] == "analyses" and len(head) > 1 and head[1] in own
            ):
                out.append(s.model_dump(mode="json"))
        return out

    def run(
        self,
        session: Session,
        progress: bool = False,
        *,
        context: RunContext | None = None,
        n_jobs: int | None = None,
    ) -> tuple[Session, ResultSet]:
        """Apply all stages; the input session is not modified.

        Parameters
        ----------
        session : Session
            Session holding the raw behavior inputs and activity.
        progress : bool, default False
            Print a line per stage / analysis (``[transform] ...``,
            ``[preprocess] ...``, ``[analyze] ...``).
        context : RunContext, optional
            Progress callbacks, cancellation, error isolation and warning
            capture; see :class:`RunContext`.
        n_jobs : int, optional
            Shuffle worker threads for every analysis, overriding each spec's
            ``ShuffleConfig.n_jobs`` (and ``context.n_jobs``) for this run; the
            spec, and so the provenance ``params``, stay as written.  Results do
            not depend on it.

        Returns
        -------
        tuple[Session, ResultSet]
            The processed session and the results, in analysis order.  If the
            run is cancelled (``context.should_cancel``) nothing is raised: the
            results completed so far are returned with ``status="cancelled"``
            (and ``completed`` listing them); the session is the processed one
            when cancellation came after the preprocess stage, else the input
            session unchanged (a cancel before the analysis stage starts, i.e.
            during transform or preprocess, returns the input session as is).
            With ``on_error="record"`` failed analyses are listed in
            ``ResultSet.errors`` and ``status`` is ``"partial"``.

        Raises
        ------
        KeyError
            If an analysis names a state space, signal or mask that is not in the
            session (unless ``on_error="record"``).
        ValueError
            If two analyses share an explicit ``name``, or a metric rejects its
            target (e.g. a non-exclusive state space; unless ``on_error="record"``).


        Each analysis runs on ``target.support & AND(masks listed in the spec)``;
        see ``AnalysisSpec.masks``.  Transform parameters are appended to
        ``session.meta["transforms"]`` and recorded in each result's provenance.
        """
        ctx = self._context(context, progress)
        if n_jobs is not None:
            ctx = replace(ctx, n_jobs=n_jobs)
        results = ResultSet()
        out = session
        for key, val in self._execute(session, ctx, results):
            if key == "session":
                out = val
        return out, results

    def iter_run(
        self, session: Session, *, context: RunContext | None = None
    ) -> Iterator[tuple[str, Any]]:
        """Generator form of :meth:`run` for incremental results.

        Yields ``("session", transformed_session)`` once transforms,
        preprocess steps and selectors are done, then ``("pipeline",
        effective_pipeline)`` (this pipeline with any selector choices applied
        and recorded in ``selections``), then ``(analysis_name, MetricResult)``
        as each analysis finishes.  Cancellation simply ends the iteration; recorded
        errors / warnings are only reported through ``context`` (use :meth:`run`
        for a ``ResultSet`` carrying them).
        """
        yield from self._execute(session, self._context(context, False), ResultSet())

    @staticmethod
    def _context(context: RunContext | None, progress: bool) -> RunContext:
        ctx = context if context is not None else RunContext()
        if progress and ctx.log is None:
            ctx = replace(ctx, log=_print_log)
        return ctx

    def _execute(
        self, session: Session, ctx: RunContext, results: ResultSet
    ) -> Iterator[tuple[str, Any]]:
        from . import __version__

        t0 = time.perf_counter()
        n_t, n_p, n_a = len(self.transforms), len(self.preprocess), len(self.analyses)
        weights = [s.shuffle.n_shuffles if s.shuffle is not None else 1 for s in self.analyses]
        wtot = float(sum(weights)) or 1.0
        pre_slice = 0.05 if n_a else 1.0
        stage_slice = pre_slice / max(n_t + n_p, 1)

        def emit(stage: str, name: str, index: int, total: int, fraction: float, **kw: Any) -> None:
            if ctx.on_progress is not None:
                ctx.on_progress(
                    ProgressEvent(
                        stage,  # type: ignore[arg-type]
                        name,
                        index,
                        total,
                        float(min(max(fraction, 0.0), 1.0)),
                        elapsed_s=time.perf_counter() - t0,
                        **kw,
                    )
                )

        def say(msg: str) -> None:
            if ctx.log is not None:
                ctx.log(msg)

        def check_cancel() -> None:
            if ctx.should_cancel is not None and ctx.should_cancel():
                raise RunCancelled("cancelled")

        all_names = self.resolved_names()

        frac = 0.0
        try:
            step = 0
            for i, t in enumerate(self.transforms):
                check_cancel()
                say(f"[transform] {t.name}")
                emit("transform", t.name, i, n_t, step * stage_slice)
                session = t.apply(session)
                log = [*session.meta.get("transforms", []), t.to_dict()]
                session = session.replace(meta={**session.meta, "transforms": log})
                step += 1
            for i, p in enumerate(self.preprocess):
                check_cancel()
                say(f"[preprocess] {p.name}")
                emit("preprocess", p.name, i, n_p, step * stage_slice)
                kind_before = session.activity_kind
                session = p.apply(session)
                meta = {
                    **session.meta,
                    "preprocess": [*session.meta.get("preprocess", []), p.to_dict()],
                }
                if session.activity_kind != kind_before:
                    hist = session.meta.get("activity_kind_history") or [kind_before]
                    meta["activity_kind_history"] = [*hist, session.activity_kind]
                session = session.replace(meta=meta)
                step += 1
            active = self
            n_s = len(self.selectors)
            for i, sel in enumerate(self.selectors):
                check_cancel()
                say(f"[select] {sel.name}")
                emit("select", sel.name, i, n_s, pre_slice)
                for s in sel.select(session, active):
                    active = active.set_param(s.path, s.value, selection=s)
                    say(f"  {s.path} = {s.value!r} ({s.method})")
            frac = pre_slice
            run_info = {
                "env": _env_info(),
                "pipeline_sha256": _sha_json(self.to_dict()),
                "session_sha256": _session_sha(session),
            }
            if n_s:
                run_info["selectors"] = [sel.to_dict() for sel in self.selectors]
                run_info["effective_pipeline_sha256"] = _sha_json(active.to_dict())
            yield ("session", session)
            yield ("pipeline", active)

            done_w = 0.0
            for ai, spec in enumerate(active.analyses):
                w = weights[ai]
                base_frac = pre_slice + (1 - pre_slice) * done_w / wtot
                check_cancel()
                name = all_names[ai]
                say(f"[analyze] {name}")
                emit("analysis", name, ai, n_a, base_frac, message="start")
                frac = base_frac

                def on_batch(
                    done: int,
                    total: int,
                    name: str = name,
                    ai: int = ai,
                    w: float = w,
                    base_frac: float = base_frac,
                ) -> None:
                    nonlocal frac
                    frac = base_frac + (1 - pre_slice) * w * (done / total) / wtot
                    emit(
                        "shuffle",
                        name,
                        ai,
                        n_a,
                        frac,
                        shuffles_done=done,
                        shuffles_total=total,
                    )

                result: MetricResult | None = None
                caught: list[warnings.WarningMessage] = []
                try:
                    try:
                        with warnings.catch_warnings(record=ctx.capture_warnings) as rec:
                            if ctx.capture_warnings:
                                warnings.simplefilter("always")
                            try:
                                result = active._analyze(
                                    session,
                                    spec,
                                    name,
                                    __version__,
                                    on_batch,
                                    ctx.should_cancel,
                                    run_info,
                                    n_jobs=ctx.n_jobs,
                                )
                            finally:
                                caught = list(rec or [])
                    finally:
                        # recorded and re-issued on every path (success, error, cancel)
                        self._flush_warnings(caught, name, results)
                except RunCancelled:
                    raise
                except Exception as exc:
                    if ctx.on_error != "record":
                        raise
                    results.errors.append(
                        RunError(
                            analysis=name,
                            metric=spec.metric.name,
                            target=spec.target,
                            error_type=type(exc).__name__,
                            message=str(exc),
                            traceback="".join(_tb.format_exception(exc)),
                        )
                    )
                done_w += w
                frac = pre_slice + (1 - pre_slice) * done_w / wtot
                if result is not None:
                    results.add(result)
                    results.completed.append(name)
                    emit("analysis", name, ai, n_a, frac, message="finished")
                    yield (name, result)
                else:
                    emit("analysis", name, ai, n_a, frac, message="failed")
        except RunCancelled:
            results.status = "cancelled"
            say("[cancelled]")
            emit("done", "", n_a, n_a, frac, message="cancelled")
            return
        results.status = "partial" if results.errors else "ok"
        emit("done", "", n_a, n_a, 1.0, message="done")

    @staticmethod
    def _flush_warnings(
        caught: list[warnings.WarningMessage], name: str, results: ResultSet
    ) -> None:
        """Record one ``RunWarning`` per distinct (category, message) and re-issue each once."""
        groups: dict[tuple[str, str], list[Any]] = {}
        for wm in caught:
            key = (wm.category.__name__, str(wm.message))
            groups.setdefault(key, []).append(wm)
        for (cat, msg), wms in groups.items():
            results.warnings.append(
                RunWarning(analysis=name, category=cat, message=msg, count=len(wms))
            )
        for wms in groups.values():  # re-issue through the caller's filters
            wm = wms[0]
            warnings.warn_explicit(
                wm.message, wm.category, wm.filename, wm.lineno, source=wm.source
            )

    def _analyze(
        self,
        session: Session,
        spec: AnalysisSpec,
        name: str,
        version: str,
        on_batch: Callable[[int, int], None],
        should_cancel: Callable[[], bool] | None,
        run_info: dict[str, Any] | None = None,
        *,
        n_jobs: int | None = None,
    ) -> MetricResult:
        metric = spec.metric.model_copy()  # configure() mutates a per-run copy
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
                raise KeyError(f"no signal {spec.signal!r}; available: {sorted(session.signals)}")
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
        effective_seed: int | None = None
        used_n_jobs: int | None = None
        if spec.shuffle is not None:
            cfg = spec.shuffle
            effective_seed = cfg.seed
            if cfg.derive_seeds and cfg.seed is not None:
                effective_seed = derive_seed(cfg.seed, name)
                cfg = cfg.model_copy(update={"seed": effective_seed})
            if n_jobs is not None:
                cfg = cfg.model_copy(update={"n_jobs": n_jobs})
            used_n_jobs = resolve_n_jobs(cfg.n_jobs)
            shuf = shuffle_test(
                metric,
                session.activity,
                target,
                mask,
                cfg,
                session.fs,
                on_batch=on_batch,
                should_cancel=should_cancel,
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
            "cabana_version": version,
            "seed": None if spec.shuffle is None else spec.shuffle.seed,
            "null": None if shuf is None else shuf.null_name,
            "n_shuffles": None if shuf is None else shuf.n_shuffles,
            "alpha": None if shuf is None else shuf.alpha,
            "tail": None if shuf is None else shuf.tail,
            "effective_seed": effective_seed,
            "n_jobs": used_n_jobs,
            "masks": listed,
            "mask_info": {m: session.meta.get("mask_info", {}).get(m) for m in listed},
            "preprocess": list(session.meta.get("preprocess", [])),
            "transforms": list(session.meta.get("transforms", [])),
            **(run_info or {}),
            "support_used": support is not None,
            "n_frames_used": int(mask.sum()),
            "fs": float(session.fs),
            "activity_kind": session.activity_kind,
            "n_cells": session.n_cells,
            "target_kind": metric.input,
            "target_params": _target_params(session, spec.target),
            "selections": self._selections_for(name),
            "timestamp": datetime.now(UTC).isoformat(timespec="seconds"),
        }
        return MetricResult(
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

    def to_dict(self) -> dict[str, Any]:
        """Plain-dict form (``{"transforms": [...], "preprocess": [...], "analyses": [...]}``)."""
        d: dict[str, Any] = {
            "transforms": [t.to_dict() for t in self.transforms],
            "preprocess": [p.to_dict() for p in self.preprocess],
            "analyses": [a.to_dict() for a in self.analyses],
        }
        if self.selectors:  # omitted when empty so older pipelines hash as before
            d["selectors"] = [s.to_dict() for s in self.selectors]
        if self.selections:
            d["selections"] = [s.model_dump(mode="json") for s in self.selections]
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Pipeline:
        """Inverse of :meth:`to_dict`; missing sections default to empty lists."""
        return cls(
            transforms=d.get("transforms", []),
            preprocess=d.get("preprocess", []),
            selectors=d.get("selectors", []),
            analyses=d.get("analyses", []),
            selections=d.get("selections", []),
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


class RunSetResult:
    """Outcome of :func:`run_set`: per-session processed sessions and results.

    Attributes
    ----------
    sessions_out : dict[str, Session]
        Processed sessions of the sessions computed in this call (sessions
        resumed from ``out_dir`` have results only).
    results : dict[str, ResultSet]
    animal : dict[str, str]
    status : dict[str, str]
        Per session: ``"ok"``, ``"partial"``, ``"cancelled"``, or ``"not_run"``
        (never started because the shared context cancelled).
    """

    def __init__(
        self,
        sessions_out: dict[str, Session],
        results: dict[str, ResultSet],
        animal: dict[str, str],
        status: dict[str, str] | None = None,
    ) -> None:
        self.sessions_out = sessions_out
        self.results = results
        self.animal = animal
        self.status = status if status is not None else {k: r.status for k, r in results.items()}

    @property
    def cancelled(self) -> bool:
        """True if any session's run was cancelled or not started because of a cancel."""
        return any(v in ("cancelled", "not_run") for v in self.status.values())

    def table(self) -> Any:
        """Long cohort table (``cohort_table(results, animal)``)."""
        from ._cohort import cohort_table

        return cohort_table(self.results, self.animal)

    def save(self, out_dir: str | Path) -> None:
        """Write ``<session_id>.results.zip`` per session plus ``run_set.json``."""
        out = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)
        info: dict[str, Any] = {}
        for sid, rs in self.results.items():
            _check_sid(sid)
            rs.save(out / f"{sid}.results.zip")
            info[sid] = {"status": self.status.get(sid, rs.status), "source": "saved"}
        _write_run_set_json(out, None, info, self.animal)

    @classmethod
    def load(cls, out_dir: str | Path) -> RunSetResult:
        """Read what :meth:`save` or an ``out_dir`` run of :func:`run_set` wrote.

        Sessions with no results file (cancelled, not run) are absent from
        ``results`` but keep their ``status`` entry; ``sessions_out`` is empty.
        """
        out = Path(out_dir)
        meta = json.loads((out / "run_set.json").read_text())
        res: dict[str, ResultSet] = {}
        status: dict[str, str] = {}
        for sid, info in meta["sessions"].items():
            status[sid] = info["status"]
            f = out / f"{sid}.results.zip"
            if f.exists():
                res[sid] = ResultSet.load(f)
        animal = meta.get("animal") or {sid: sid for sid in status}
        return cls({}, res, animal, status)


def _check_sid(sid: str) -> None:
    if not sid or "/" in sid or "\\" in sid or sid.startswith("."):
        raise ValueError(f"session id {sid!r} cannot be used as a file name in out_dir")


def _write_run_set_json(
    out: Path, pipeline_sha: str | None, info: dict[str, Any], animal: dict[str, str]
) -> None:
    from . import __version__

    doc = {
        "cabana_version": __version__,
        "pipeline_sha256": pipeline_sha,
        "animal": animal,
        "sessions": info,
    }
    tmp = out / "run_set.json.tmp"
    tmp.write_text(json.dumps(doc, indent=2))
    tmp.replace(out / "run_set.json")


def _run_one(
    pipeline: Pipeline,
    sid: str,
    session: Session,
    ctx: RunContext,
    out_file: str | None,
) -> tuple[str, Session, ResultSet]:
    """Process-pool worker (module level so it pickles under ``spawn``)."""
    out, rs = pipeline.run(session, context=ctx)
    if out_file is not None and not rs.cancelled:
        rs.save(out_file)
    return sid, out, rs


def run_set(
    pipeline: Pipeline,
    sessions: Any,
    *,
    context: RunContext | None = None,
    animal: dict[str, str] | None = None,
    n_jobs: int = 1,
    out_dir: str | Path | None = None,
    resume: bool = True,
) -> RunSetResult:
    """Run ``pipeline`` on every session of a ``SessionSet`` or ``{id: Session}`` dict.

    Parameters
    ----------
    pipeline : Pipeline
    sessions : SessionSet or dict[str, Session]
    context : RunContext, optional
        Shared run control.  Progress events carry ``"<session id>: ..."`` in
        ``message`` and an overall ``fraction``; per-session ``done`` events are
        suppressed and one final ``done`` is emitted.
    animal : dict, optional
        Defaults to the ``SessionSet``'s map, else each session id is its own animal.
    n_jobs : int, default 1
        Sessions processed in parallel in separate processes (``spawn``; ``-1`` =
        all cores).  ``1`` runs in this process.  Callbacks cannot cross
        processes: with ``n_jobs > 1`` ``on_progress`` fires once per finished
        session, ``should_cancel`` is polled in this process between submissions
        and completions (running sessions finish; session granularity), and a
        worker runs its shuffle tests with ``n_jobs=1`` unless ``context.n_jobs``
        is set.  Plugins must be importable in the workers.
    out_dir : path, optional
        Write ``<session_id>.results.zip`` as each session finishes (cancelled
        sessions are not written) and ``run_set.json`` (per-session status).
    resume : bool, default True
        With ``out_dir``, a session whose zip exists is loaded instead of run
        (null draws come back float32), unless it was written by a different
        pipeline (``pipeline_sha256`` mismatch), in which case it is rerun.

    Returns
    -------
    RunSetResult

    Notes
    -----
    A session whose run was cancelled is recorded as ``"cancelled"`` and the
    remaining sessions still run, unless the cancel came from the shared
    ``context.should_cancel``; then the rest are ``"not_run"``.
    """
    from ._cohort_models import SessionSet

    if isinstance(sessions, SessionSet):
        sess = dict(sessions.sessions)
        animal = animal if animal is not None else dict(sessions.animal)
    else:
        sess = dict(sessions)
    animal = animal if animal is not None else {sid: sid for sid in sess}
    missing = [sid for sid in sess if sid not in animal]
    if missing:
        raise ValueError(f"animal map is missing session ids: {missing}")
    ctx = context if context is not None else RunContext()
    n = len(sess)
    t0 = time.perf_counter()
    out: dict[str, Session] = {}
    res: dict[str, ResultSet] = {}
    status: dict[str, str] = {sid: "not_run" for sid in sess}
    info: dict[str, Any] = {sid: {"status": "not_run"} for sid in sess}
    pipe_sha = _sha_json(pipeline.to_dict())
    shared_cancel = False

    def polled_cancel() -> bool:
        nonlocal shared_cancel
        if ctx.should_cancel is not None and ctx.should_cancel():
            shared_cancel = True
        return shared_cancel

    outp = Path(out_dir) if out_dir is not None else None
    if outp is not None:
        outp.mkdir(parents=True, exist_ok=True)
        for sid in sess:
            _check_sid(sid)

    def flush() -> None:
        if outp is not None:
            _write_run_set_json(outp, pipe_sha, info, animal)

    todo: list[str] = []
    for sid in sess:
        f = None if outp is None else outp / f"{sid}.results.zip"
        if resume and f is not None and f.exists():
            loaded = ResultSet.load(f)
            shas = {r.provenance.get("pipeline_sha256") for r in loaded}
            if shas <= {pipe_sha}:  # same pipeline (or nothing to compare)
                res[sid], status[sid] = loaded, loaded.status
                info[sid] = {"status": loaded.status, "source": "resumed", "file": f.name}
                continue
            warnings.warn(
                f"{f.name} was written by a different pipeline; recomputing {sid!r}", stacklevel=2
            )
        todo.append(sid)
    flush()

    done_count = n - len(todo)
    last = done_count / n if n else 1.0

    def record(sid: str, s_out: Session | None, rs: ResultSet, elapsed: float) -> None:
        nonlocal done_count
        if s_out is not None:
            out[sid] = s_out
        res[sid], status[sid] = rs, rs.status
        info[sid] = {
            "status": rs.status,
            "source": "computed",
            "elapsed_s": round(elapsed, 3),
            **({"file": f"{sid}.results.zip"} if outp is not None and not rs.cancelled else {}),
        }
        flush()

    workers = (os.cpu_count() or 1) if n_jobs == -1 else max(1, int(n_jobs))
    if workers <= 1 or len(todo) <= 1:
        for sid in todo:
            if polled_cancel():
                break
            i = list(sess).index(sid)

            def wrap(ev: ProgressEvent, i: int = i, sid: str = sid) -> None:
                nonlocal last
                if ev.stage == "done":
                    return
                last = (i + ev.fraction) / n
                if ctx.on_progress is not None:
                    ctx.on_progress(
                        replace(
                            ev,
                            fraction=last,
                            elapsed_s=time.perf_counter() - t0,
                            message=f"{sid}: {ev.message}".rstrip(": ").rstrip(),
                        )
                    )

            inner = replace(ctx, on_progress=wrap, should_cancel=polled_cancel)
            ts = time.perf_counter()
            s_out, rs = pipeline.run(sess[sid], context=inner)
            if outp is not None and not rs.cancelled:
                rs.save(outp / f"{sid}.results.zip")
            record(sid, s_out, rs, time.perf_counter() - ts)
            if rs.cancelled and shared_cancel:
                break
        else:
            last = 1.0
    else:
        import multiprocessing as mp
        from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, wait

        wctx = RunContext(
            on_error=ctx.on_error,
            capture_warnings=ctx.capture_warnings,
            n_jobs=ctx.n_jobs if ctx.n_jobs is not None else 1,
        )
        queue = list(todo)
        pending: dict[Any, tuple[str, float]] = {}
        with ProcessPoolExecutor(
            min(workers, len(queue)), mp_context=mp.get_context("spawn")
        ) as ex:
            try:
                while queue or pending:
                    while queue and len(pending) < workers and not polled_cancel():
                        sid = queue.pop(0)
                        f = None if outp is None else str(outp / f"{sid}.results.zip")
                        fut = ex.submit(_run_one, pipeline, sid, sess[sid], wctx, f)
                        pending[fut] = (sid, time.perf_counter())
                    if not pending:
                        break
                    finished, _ = wait(list(pending), timeout=0.5, return_when=FIRST_COMPLETED)
                    polled_cancel()
                    for fut in finished:
                        sid, ts = pending.pop(fut)
                        _, s_out, rs = fut.result()
                        record(sid, s_out, rs, time.perf_counter() - ts)
                        done_count += 1
                        last = done_count / n
                        if ctx.on_progress is not None:
                            ctx.on_progress(
                                ProgressEvent(
                                    "analysis",
                                    sid,
                                    done_count - 1,
                                    n,
                                    last,
                                    elapsed_s=time.perf_counter() - t0,
                                    message=f"{sid}: finished",
                                )
                            )
                    if shared_cancel:
                        queue.clear()
            except BaseException:
                for fut in pending:
                    fut.cancel()
                raise
        if not shared_cancel:
            last = 1.0
    flush()
    if ctx.on_progress is not None:
        ctx.on_progress(
            ProgressEvent(
                "done",
                "",
                len(res),
                n,
                last,
                elapsed_s=time.perf_counter() - t0,
                message="cancelled"
                if any(v in ("cancelled", "not_run") for v in status.values())
                else "done",
            )
        )
    return RunSetResult(out, res, animal, status)


def describe() -> dict[str, Any]:
    """JSON-serialisable capability description for a front end.

    Returns
    -------
    dict
        ``{"version", "plugins": {kind: {name: {"schema", ...}}}, "schemas":
        {"ShuffleConfig", "AnalysisSpec", "Pipeline", "Selection"}}``.  Metric entries also
        carry ``level``, ``input``, ``default_tail`` and ``requires_topology``.
    """
    from . import __version__

    def schema(cls: Any) -> dict[str, Any]:
        try:
            return cls.model_json_schema()
        except Exception as exc:  # arbitrary-typed fields cannot always be schematised
            return {"error": f"{type(exc).__name__}: {exc}"}

    plugins: dict[str, Any] = {}
    for kind, reg in _REGISTRY.items():
        entries: dict[str, Any] = {}
        for name in sorted(reg):
            cls = reg[name]
            e: dict[str, Any] = {"schema": schema(cls), "doc": (cls.__doc__ or "").strip()}
            if kind == "metric":
                for attr in ("level", "input", "default_tail", "requires_topology"):
                    e[attr] = getattr(cls, attr, None)
            entries[name] = e
        plugins[kind] = entries
    return {
        "version": __version__,
        "plugins": plugins,
        "schemas": {
            "ShuffleConfig": schema(ShuffleConfig),
            "AnalysisSpec": schema(AnalysisSpec),
            "Pipeline": schema(Pipeline),
            "Selection": schema(Selection),
        },
    }


__all__ = [
    "AnalysisSpec",
    "Pipeline",
    "ProgressEvent",
    "RunCancelled",
    "RunContext",
    "RunError",
    "RunSetResult",
    "RunWarning",
    "Selection",
    "describe",
    "run_set",
]
