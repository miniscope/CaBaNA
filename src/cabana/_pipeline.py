"""Declarative pipeline: transforms -> preprocess -> analyses."""

from __future__ import annotations

import time
import traceback as _tb
import warnings
from collections.abc import Callable, Iterator
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

import numpy as np

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from . import _preprocess as _preprocess  # noqa: F401  (registers plugins)
from . import _transform as _transform  # noqa: F401  (registers plugins)
from ._models import Session
from ._registry import _REGISTRY, Metric, PreprocessStep, Transform, build
from ._results import MetricResult, ResultSet, RunError, RunWarning
from ._shuffle import RunCancelled, ShuffleConfig, shuffle_test

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

    stage: Literal["transform", "preprocess", "analysis", "shuffle", "done"]
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
    """

    on_progress: Callable[[ProgressEvent], None] | None = None
    should_cancel: Callable[[], bool] | None = None
    on_error: Literal["raise", "record"] = "raise"
    capture_warnings: bool = True
    log: Callable[[str], None] | None = None


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

    def run(
        self,
        session: Session,
        progress: bool = False,
        *,
        context: RunContext | None = None,
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

        Yields ``("session", transformed_session)`` once transforms and
        preprocess steps are done, then ``(analysis_name, MetricResult)`` as each
        analysis finishes.  Cancellation simply ends the iteration; recorded
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
                session = p.apply(session)
                step += 1
            frac = pre_slice
            yield ("session", session)

            done_w = 0.0
            for ai, spec in enumerate(self.analyses):
                w = weights[ai]
                base_frac = pre_slice + (1 - pre_slice) * done_w / wtot
                check_cancel()
                name = unique_name(spec)
                used.add(name)
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
                                result = self._analyze(
                                    session, spec, name, __version__, on_batch, ctx.should_cancel
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
        if spec.shuffle is not None:
            shuf = shuffle_test(
                metric,
                session.activity,
                target,
                mask,
                spec.shuffle,
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


class RunSetResult:
    """Outcome of :func:`run_set`: per-session processed sessions and results.

    Attributes
    ----------
    sessions_out : dict[str, Session]
    results : dict[str, ResultSet]
    animal : dict[str, str]
    """

    def __init__(
        self,
        sessions_out: dict[str, Session],
        results: dict[str, ResultSet],
        animal: dict[str, str],
    ) -> None:
        self.sessions_out = sessions_out
        self.results = results
        self.animal = animal

    @property
    def cancelled(self) -> bool:
        """True if any session's run was cancelled (later sessions were not run)."""
        return any(r.cancelled for r in self.results.values())

    def table(self) -> Any:
        """Long cohort table (``cohort_table(results, animal)``)."""
        from ._cohort import cohort_table

        return cohort_table(self.results, self.animal)


def run_set(
    pipeline: Pipeline,
    sessions: Any,
    *,
    context: RunContext | None = None,
    animal: dict[str, str] | None = None,
) -> RunSetResult:
    """Run ``pipeline`` on every session of a ``SessionSet`` or ``{id: Session}`` dict.

    Sessions run sequentially (parallel execution, ``n_jobs``, is out of scope).
    Progress events carry ``"<session id>: ..."`` in ``message`` and an overall
    ``fraction`` across sessions; per-session ``done`` events are suppressed and
    one final ``done`` is emitted.  A cancelled session stops the loop and the
    remaining sessions are not run.  ``animal`` defaults to the ``SessionSet``'s
    map, else each session id is its own animal.
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
    last = 0.0
    for i, (sid, s) in enumerate(sess.items()):

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

        inner = replace(ctx, on_progress=wrap)
        out[sid], res[sid] = pipeline.run(s, context=inner)
        if res[sid].cancelled:
            break
    else:
        last = 1.0
    if ctx.on_progress is not None:
        ctx.on_progress(
            ProgressEvent(
                "done",
                "",
                len(res),
                n,
                last,
                elapsed_s=time.perf_counter() - t0,
                message="cancelled" if any(r.cancelled for r in res.values()) else "done",
            )
        )
    return RunSetResult(out, res, animal)


def describe() -> dict[str, Any]:
    """JSON-serialisable capability description for a front end.

    Returns
    -------
    dict
        ``{"version", "plugins": {kind: {name: {"schema", ...}}}, "schemas":
        {"ShuffleConfig", "AnalysisSpec", "Pipeline"}}``.  Metric entries also
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
    "describe",
    "run_set",
]
