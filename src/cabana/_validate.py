"""Preflight checks for a pipeline: problems a run would hit, and a time / memory estimate.

:func:`validate_pipeline` runs the cheap stages (transforms, preprocess steps, selectors) to
get the exact state spaces, then inspects every analysis without running the full pipeline:
targets, masks, frame counts, shuffle settings, null / metric pairings.  It times one
``compute`` (and a small batch of shifts) per analysis and extrapolates to ``n_shuffles``.
"""

from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from ._models import Session, StateSpace
from ._pipeline import AnalysisSpec, Pipeline

_log = logging.getLogger("cabana")

_MIN_SECONDS = 60.0
_N_TIMING_SHIFTS = 5
_SHIFT_NULLS = ("circular_shift", "covariate_matched_shift")
# Metrics that depend only on the multiset of activity values in each state (or on per-state
# sums): within_state_shuffle leaves them unchanged (null std ~ 1e-15).  Order-dependent
# metrics (split_half_stability, pv_stability, decode_states, bayesian_decoder, peth,
# signal_correlation, decode_signal) are informative under it and are not listed.
_WITHIN_STATE_DEGENERATE = (
    "mean_per_state",
    "auroc",
    "information_content",
    "tuning_selectivity",
    "mutual_information",
    "place_fields",
    "population_vector_overlap",
    "population_distance",
    "pairwise_correlation",
    "participation_ratio",
    "pca_population",
)
# Population statistics that a common circular shift cannot change at all.
_UNCHANGED_BY_COMMON_SHIFT = ("pairwise_correlation", "participation_ratio")
# Population statistics that a common shift does change, but only tests alignment with the state.
_ALIGNMENT_ONLY_UNDER_COMMON_SHIFT = ("pv_stability", "population_vector_overlap")


@dataclass
class Issue:
    """One finding of :func:`validate_pipeline`.

    Attributes
    ----------
    level : {"error", "warning", "info"}
        ``error`` means the run would fail or its p-values would be meaningless.
    analysis : str or None
        Analysis name, or None for a pipeline-wide finding.
    code : str
        Short machine-readable identifier, e.g. ``"missing_target"``.
    message : str
        Human-readable explanation.
    """

    level: str
    analysis: str | None
    code: str
    message: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "level": self.level,
            "analysis": self.analysis,
            "code": self.code,
            "message": self.message,
        }


@dataclass
class ValidationReport:
    """Result of :func:`validate_pipeline`.

    Attributes
    ----------
    issues : list[Issue]
        Findings in analysis order.
    estimates : dict[str, dict]
        Per analysis ``{"n_frames_used", "time_s", "memory_bytes"}``; a value is ``None``
        when it could not be estimated (e.g. the time budget ran out).
    total_time_s : float or None
        Sum of the known per-analysis time estimates (shuffle test included).
    time_is_lower_bound : bool
        True when the time budget ran out and some analyses were not timed, so
        ``total_time_s`` under-reports the run.
    peak_memory_bytes : int or None
        Session arrays plus the largest single analysis (analyses run one at a time).
    """

    issues: list[Issue] = field(default_factory=list)
    estimates: dict[str, dict[str, Any]] = field(default_factory=dict)
    total_time_s: float | None = None
    time_is_lower_bound: bool = False
    peak_memory_bytes: int | None = None

    @property
    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.level == "error"]

    @property
    def warnings(self) -> list[Issue]:
        return [i for i in self.issues if i.level == "warning"]

    @property
    def ok(self) -> bool:
        """True when there are no errors."""
        return not self.errors

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "issues": [i.to_dict() for i in self.issues],
            "estimates": {k: dict(v) for k, v in self.estimates.items()},
            "total_time_s": self.total_time_s,
            "time_is_lower_bound": self.time_is_lower_bound,
            "peak_memory_bytes": self.peak_memory_bytes,
        }

    def __str__(self) -> str:
        from ._memory import human_bytes

        head = "Pipeline validation: " + ("OK" if self.ok else f"{len(self.errors)} error(s)")
        if self.warnings:
            head += f", {len(self.warnings)} warning(s)"
        lines = [head]
        for i in self.issues:
            where = f" [{i.analysis}]" if i.analysis else ""
            lines.append(f"  {i.level.upper():7s}{where} {i.code}: {i.message}")
        if self.estimates:
            lines.append("Estimates:")
            for name, e in self.estimates.items():
                t = "n/a" if e.get("time_s") is None else f"{e['time_s']:.1f} s"
                m = "n/a" if e.get("memory_bytes") is None else human_bytes(e["memory_bytes"])
                n = e.get("n_frames_used")
                lines.append(f"  {name}: {t}, {m}, {'?' if n is None else n} frames")
        if self.total_time_s is not None:
            if self.time_is_lower_bound:
                lines.append(
                    f"Total time >= {self.total_time_s:.1f} s (some analyses were not timed)"
                )
            else:
                lines.append(f"Total time ~ {self.total_time_s:.1f} s")
        if self.peak_memory_bytes is not None:
            lines.append(f"Peak memory ~ {human_bytes(self.peak_memory_bytes)}")
        return "\n".join(lines)


def _prepare(pipeline: Pipeline, session: Session) -> tuple[Session, Pipeline]:
    """Run transforms / preprocess / selectors only (see ``_sweep``); returns both outputs."""
    prepared = effective = None
    gen = pipeline.iter_run(session)
    try:
        for key, val in gen:
            if key == "session":
                prepared = val
            elif key == "pipeline":
                effective = val
                break
    finally:
        gen.close()
    if prepared is None or effective is None:
        raise RuntimeError("pipeline preparation was cancelled")
    return prepared, effective


def _fmt_list(items: list[str], cap: int = 8) -> str:
    shown = ", ".join(items[:cap])
    return shown + (f", ... ({len(items)} in all)" if len(items) > cap else "")


def _time_analysis(
    metric: Any,
    spec: AnalysisSpec,
    session: Session,
    target: Any,
    mask: np.ndarray,
    n_jobs: int,
) -> tuple[float, np.ndarray]:
    """Seconds for ``compute`` plus the extrapolated shuffle test; and the observed values."""
    act, fs = session.activity, session.fs
    t0 = time.perf_counter()
    values = np.asarray(metric.compute(act, target, mask, fs))
    t_compute = time.perf_counter() - t0
    total = t_compute
    cfg = spec.shuffle
    if cfg is not None:
        null = cfg.resolved_null()
        per = t_compute
        if null.name in _SHIFT_NULLS:
            n = act.shape[1]
            lo = int(min(max(getattr(null, "min_shift_s", 0.0) * fs, 1), max(n // 2, 1)))
            shifts = np.linspace(lo, max(n - lo, lo), _N_TIMING_SHIFTS).astype(np.int64)
            t0 = time.perf_counter()
            out = metric.compute_shifted(act, target, mask, fs, shifts)
            if out is None:
                for _ in range(_N_TIMING_SHIFTS):
                    metric.compute(act, target, mask, fs)
            per = (time.perf_counter() - t0) / _N_TIMING_SHIFTS
        workers = max(1, min(_resolve_jobs(cfg.n_jobs), math.ceil(cfg.n_shuffles / cfg.batch_size)))
        total += cfg.n_shuffles * per / workers
    return total, values


def _resolve_jobs(n_jobs: int) -> int:
    from ._shuffle import resolve_n_jobs

    return resolve_n_jobs(n_jobs)


def validate_pipeline(
    pipeline: Pipeline, session: Session, *, time_budget_s: float = 2.0
) -> ValidationReport:
    """Check ``pipeline`` against ``session`` without running it; estimate time and memory.

    Parameters
    ----------
    pipeline : Pipeline
        The pipeline to check (selectors included; they are run to get the effective values).
    session : Session
        Session holding the raw inputs.
    time_budget_s : float, default 2.0
        Wall-clock budget for the timing probes.  Once spent, the remaining analyses are not
        timed (their ``time_s`` estimate is ``None`` and the report's ``time_is_lower_bound``
        is True) but every other check still runs; the first analysis is always timed.

    Returns
    -------
    ValidationReport
        ``issues`` (errors, warnings, info), per-analysis ``estimates`` and totals.  Checks
        per analysis: target exists and matches the metric's input kind, grid topology,
        activity kind, masks exist, frames left after support and masks (none: error; under
        60 s: warning), states with no frames, whether ``n_shuffles`` can reach ``alpha``,
        ``min_shift_s`` against the session length, degenerate or mismatched null / metric
        pairs and missing multiple-comparison correction.  An exception inside a check becomes
        an ``error`` issue instead of propagating.

    Notes
    -----
    Transforms, preprocess steps and selectors really run (they are needed for exact state
    spaces), so a very expensive selector makes validation slow.
    """
    report = ValidationReport()
    issues = report.issues

    try:
        try:
            prepared, effective = _prepare(pipeline, session)
        except Exception as exc:
            if not pipeline.selectors:
                raise
            issues.append(
                Issue(
                    "warning",
                    None,
                    "selectors_failed",
                    f"selectors raised {type(exc).__name__}: {exc}; checking without them",
                )
            )
            stripped = pipeline.model_copy(update={"selectors": []})
            prepared, effective = _prepare(stripped, session)
    except Exception as exc:
        issues.append(
            Issue(
                "error",
                None,
                "prepare_failed",
                f"transforms/preprocess failed: {type(exc).__name__}: {exc}",
            )
        )
        return report

    try:
        names = effective.resolved_names()
    except Exception as exc:
        issues.append(Issue("error", None, "bad_names", str(exc)))
        names = [f"analysis[{i}]" for i in range(len(effective.analyses))]
    if not effective.analyses:
        issues.append(Issue("info", None, "no_analyses", "the pipeline has no analyses"))

    t_start = time.perf_counter()
    for name, spec in zip(names, effective.analyses, strict=False):
        est: dict[str, Any] = {"n_frames_used": None, "time_s": None, "memory_bytes": None}
        report.estimates[name] = est
        try:
            _check_analysis(
                name,
                spec,
                prepared,
                effective,
                report,
                est,
                over_budget=(
                    time.perf_counter() - t_start > time_budget_s and len(report.estimates) > 1
                ),
            )
        except Exception as exc:
            issues.append(Issue("error", name, "check_failed", f"{type(exc).__name__}: {exc}"))

    known = [e["time_s"] for e in report.estimates.values() if e["time_s"] is not None]
    report.total_time_s = float(sum(known)) if known else None
    _memory(effective, prepared, report)
    return report


def _memory(pipeline: Pipeline, session: Session, report: ValidationReport) -> None:
    try:
        from ._memory import memory_estimate

        mem = memory_estimate(pipeline, session)
        for name, a in mem.per_analysis.items():
            if name in report.estimates:
                report.estimates[name]["memory_bytes"] = int(a.total_bytes)
        report.peak_memory_bytes = int(mem.peak_bytes)
    except Exception:  # pragma: no cover - estimator unavailable or failed: fall back
        n_cells, n_time = session.activity.shape
        peak = 0
        for name, spec in zip(report.estimates, pipeline.analyses, strict=False):
            n_states = 1
            if spec.states is not None and spec.states in session.states:
                n_states = session.states[spec.states].n_states
            size = n_cells * n_states
            b = size * 8
            if spec.shuffle is not None:
                keep = spec.shuffle.keep_null == "full"
                b += (spec.shuffle.n_shuffles * size * 8 if keep else 0) + (
                    spec.shuffle.batch_size * size * 8
                )
            report.estimates[name]["memory_bytes"] = int(b)
            peak = max(peak, b)
        report.peak_memory_bytes = int(peak + session.activity.nbytes)


def _check_analysis(
    name: str,
    spec: AnalysisSpec,
    session: Session,
    pipeline: Pipeline,
    report: ValidationReport,
    est: dict[str, Any],
    over_budget: bool,
) -> None:
    issues = report.issues

    def add(level: str, code: str, msg: str) -> None:
        issues.append(Issue(level, name, code, msg))

    metric = spec.metric.model_copy()
    # target
    if spec.states is not None:
        if spec.states not in session.states:
            add(
                "error",
                "missing_target",
                f"no state space {spec.states!r}; available: {sorted(session.states)}",
            )
            return
        target: Any = session.states[spec.states]
        support = target.support
    else:
        if spec.signal not in session.signals:
            add(
                "error",
                "missing_target",
                f"no signal {spec.signal!r}; available: {sorted(session.signals)}",
            )
            return
        target = np.asarray(session.signals[spec.signal], dtype=np.float64)
        support = None
    is_states = isinstance(target, StateSpace)
    if (metric.input == "states") != is_states:
        add(
            "error",
            "target_kind",
            f"metric {metric.name!r} takes {metric.input}, but the target {spec.target!r} is "
            f"{'a state space' if is_states else 'a signal'}",
        )
        return
    ok = True
    if metric.requires_topology and getattr(target, "topology", None) is None:
        add(
            "error",
            "needs_topology",
            f"metric {metric.name!r} needs a grid topology but state space {spec.target!r} has none",
        )
        ok = False
    try:
        metric.check_activity_kind(session.activity_kind)
    except Exception as exc:
        add("error", "activity_kind", str(exc))
        ok = False
    if ok:
        try:
            metric.check_target(target)
        except Exception as exc:
            add("error", "bad_target", str(exc))
            ok = False
    # masks
    listed = list(spec.masks or [])
    missing = [m for m in listed if m not in session.masks]
    if missing:
        add(
            "error",
            "missing_mask",
            f"masks {missing} not in session.masks (available: {sorted(session.masks)})",
        )
        return
    mask = session.valid_mask(listed)
    if support is not None:
        mask = mask & support
    n_used = int(mask.sum())
    est["n_frames_used"] = n_used
    seconds = n_used / float(session.fs)
    if n_used == 0:
        add("error", "no_frames", "no frames are left after the target's support and the masks")
        return
    if seconds < _MIN_SECONDS:
        add(
            "warning",
            "little_data",
            f"only {seconds:.1f} s of data are left after support and masks (< {_MIN_SECONDS:.0f} s)",
        )
    if is_states:
        counts = np.asarray(target.onehot)[mask].sum(axis=0)
        empty = [str(s) for s, c in zip(target.state_names, counts, strict=True) if c == 0]
        if empty:
            add(
                "warning",
                "empty_states",
                f"states with no frames after masking: {_fmt_list(empty)}",
            )

    cfg = spec.shuffle
    null = None
    if cfg is not None:
        null = cfg.resolved_null()
        n_sh = cfg.n_shuffles
        tail = cfg.tail
        if tail is None:
            try:
                tail = metric.resolve_tail(target)
            except Exception:
                tail = "upper"
        floor = (2.0 if tail == "two" else 1.0) / (n_sh + 1)
        if floor >= cfg.alpha:
            need = math.ceil((2.0 if tail == "two" else 1.0) / cfg.alpha)
            add(
                "error",
                "cannot_reach_alpha",
                f"n_shuffles={n_sh} gives a smallest p-value of {floor:.3g} "
                f"({'two' if tail == 'two' else 'one'}-tailed), which cannot be below alpha="
                f"{cfg.alpha}; use n_shuffles >= {need}",
            )
        min_shift = getattr(null, "min_shift_s", None)
        if min_shift is not None:
            duration = session.n_time / float(session.fs)
            if min_shift >= duration / 2:
                add(
                    "error",
                    "min_shift_too_long",
                    f"min_shift_s={min_shift:g} is at least half the session ({duration:.1f} s): "
                    "no valid shift exists",
                )
            elif min_shift > duration / 4:
                add(
                    "warning",
                    "min_shift_long",
                    f"min_shift_s={min_shift:g} is over a quarter of the session "
                    f"({duration:.1f} s): few distinct shifts, a coarse null",
                )
        if metric.name in _WITHIN_STATE_DEGENERATE and null.name == "within_state_shuffle":
            add(
                "error",
                "degenerate_null",
                f"within_state_shuffle leaves {metric.name} exactly unchanged, so its p-values "
                "mean nothing; use circular_shift (see STATISTICS.md, Choosing a null)",
            )
        if null.name == "cell_shift" and metric.level == "cell":
            add(
                "warning",
                "cell_shift_cell_level",
                "cell_shift is identical to circular_shift per cell for a cell-level metric",
            )
        if metric.level == "population" and null.name == "circular_shift":
            if metric.name in _UNCHANGED_BY_COMMON_SHIFT:
                add(
                    "info",
                    "prefer_cell_shift",
                    f"a common circular shift leaves {metric.name} unchanged; consider "
                    "null={'name': 'cell_shift'}",
                )
            elif metric.name in _ALIGNMENT_ONLY_UNDER_COMMON_SHIFT:
                add(
                    "info",
                    "prefer_cell_shift",
                    f"a common circular shift keeps cell-to-cell coordination and only tests "
                    f"the alignment with the states, so it cannot say whether {metric.name} "
                    "reflects population structure; consider null={'name': 'cell_shift'}",
                )
        if ok:
            try:
                null.check_target(metric, target)
            except Exception as exc:
                add("error", "null_incompatible", str(exc))
                ok = False

    if not ok or any(i.analysis == name and i.level == "error" for i in issues):
        return
    # null configuration is checked even when the time budget is spent; the timing probe
    # (which also reveals the output shape) is the only thing skipped then
    if not over_budget:
        metric.configure(session, spec.target)
    if cfg is not None and null is not None:
        try:
            null = null.configure(session, spec)
        except Exception as exc:
            add("error", "null_config", f"{type(exc).__name__}: {exc}")
            return
    if over_budget:
        shape = _expected_shape(metric, session, target if is_states else None)
        report.time_is_lower_bound = True
    else:
        t, values = _time_analysis(metric, spec, session, target, mask, cfg.n_jobs if cfg else 1)
        est["time_s"] = float(t)
        shape = tuple(np.shape(values))
    if cfg is None or shape is None:
        return
    n_states = target.n_states if is_states else 1
    if cfg.correction == "bonferroni":
        m = _family_size(shape, cfg.correction_scope)
        if m > 1 and floor * m >= cfg.alpha:
            add(
                "warning",
                "correction_floor",
                f"bonferroni over {m} {_family_noun(shape, cfg.correction_scope, metric.level)} multiplies the "
                f"p-value floor to {floor * m:.3g}, above alpha={cfg.alpha}",
            )
    if (
        cfg.correction == "none"
        and is_states
        and n_states > 1
        and metric.level == "cell"
        and len(shape) >= 2
    ):
        add(
            "info",
            "no_correction",
            f"{n_states} states are tested without a multiple-comparison correction; "
            "consider correction='max_stat'",
        )


def _expected_shape(metric: Any, session: Session, target: Any) -> tuple[int, ...] | None:
    """Output shape without computing (from the metric's name and level); None if unknown."""
    try:
        from ._memory import output_shape

        n_states = None if target is None else target.n_states
        return tuple(output_shape(metric, session.n_cells, n_states))
    except Exception:  # pragma: no cover - estimator unavailable
        return None


def _family_size(shape: tuple[int, ...], scope: str) -> int:
    """Number of tests corrected together for a result of ``shape`` (as ``_correct`` does)."""
    if scope == "all" or len(shape) < 2:
        return int(np.prod(shape)) if len(shape) else 1
    return int(shape[1] if scope == "states" else shape[0])


def _family_noun(shape: tuple[int, ...], scope: str, level: str) -> str:
    if scope == "all" or len(shape) < 2:
        return "cells" if (level == "cell" and scope != "all") else "tests"
    return "states" if scope == "states" else "cells"
