"""``check_plugin``: a conformance checker for third-party plugins.

It exercises the contract rules in ``docs/PLUGINS.md`` on a session you give it and returns a
:class:`PluginReport`.  A check that raises counts as failed (the exception text is the message).
"""

from __future__ import annotations

import ast
import inspect
import re
import textwrap
import warnings
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from pydantic import BaseModel

from ._models import Session, StateSpace
from ._pipeline import Pipeline
from ._registry import Metric, Null, PreprocessStep, Selector, Transform, _Plugin, build
from ._selection import Selection
from ._shuffle import ShuffleConfig, shuffle_test
from ._statesums import masked_counts

_KINDS = (
    (Transform, "transform"),
    (PreprocessStep, "preprocess"),
    (Metric, "metric"),
    (Null, "null"),
    (Selector, "selector"),
)
_P_VALUE_WORDS = re.compile(r"\bp_?values?\b|\bp_adj\b|\bpvals?\b|\bshuffle_test\b|\bsignificant\b")


def _eq(a: Any, b: Any) -> bool:
    """Deep equality for dicts, lists, arrays (NaN == NaN) and scalars."""
    if isinstance(a, np.ndarray) or isinstance(b, np.ndarray):
        a, b = np.asarray(a), np.asarray(b)
        if a.shape != b.shape:
            return False
        if a.dtype.kind in "fc" and b.dtype.kind in "fc":
            return bool(np.array_equal(a, b, equal_nan=True))
        return bool(np.array_equal(a, b))
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_eq(a[k], b[k]) for k in a)
    if isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return len(a) == len(b) and all(_eq(x, y) for x, y in zip(a, b, strict=True))
    if isinstance(a, BaseModel) and isinstance(b, BaseModel):
        return type(a) is type(b) and _eq(a.model_dump(), b.model_dump())
    if isinstance(a, float) and isinstance(b, float) and np.isnan(a) and np.isnan(b):
        return True
    return bool(a == b)


def _session_diff(a: Session, b: Session) -> str | None:
    """Name of the first field that differs between two sessions, else ``None``."""
    for k in type(a).model_fields:
        if not _eq(getattr(a, k), getattr(b, k)):
            return k
    return None


@dataclass
class PluginReport:
    """Outcome of :func:`check_plugin`.

    Attributes
    ----------
    plugin, kind : str
        Registry name and kind of the plugin that was checked.
    checks : list of (name, ok, message)
        One entry per check, in the order run.
    warnings : list of str
        Best-effort findings that do not fail the plugin (missing field descriptions, p-value text).
    """

    plugin: str
    kind: str
    checks: list[tuple[str, bool, str]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def passed(self) -> bool:
        return all(ok for _, ok, _ in self.checks)

    def failed(self) -> list[tuple[str, bool, str]]:
        return [c for c in self.checks if not c[1]]

    def raise_if_failed(self) -> None:
        """Raise ``AssertionError`` listing the failed checks (no-op when everything passed)."""
        if not self.passed:
            lines = "; ".join(f"{n}: {m}" for n, _, m in self.failed())
            raise AssertionError(f"plugin {self.plugin!r} ({self.kind}) failed: {lines}")

    def __str__(self) -> str:
        w = max([len(n) for n, _, _ in self.checks] + [5])
        rows = [f"{self.kind} plugin {self.plugin!r}: {'PASSED' if self.passed else 'FAILED'}"]
        rows += [f"  {'ok  ' if ok else 'FAIL'} {n:<{w}}  {m}" for n, ok, m in self.checks]
        rows += [f"  warn {m}" for m in self.warnings]
        return "\n".join(rows)


class _Runner:
    def __init__(self, report: PluginReport, skip: tuple[str, ...]) -> None:
        self.report, self.skip = report, skip

    def __call__(self, name: str, fn: Callable[[], str | None]) -> bool:
        """Run ``fn``; ``None``/str = pass (str is a note), AssertionError or any error = fail."""
        if name in self.skip:
            self.report.checks.append((name, True, "skipped by caller"))
            return True
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                msg = fn()
            self.report.checks.append((name, True, msg or ""))
            return True
        except AssertionError as e:
            self.report.checks.append((name, False, str(e) or "assertion failed"))
        except Exception as e:  # a crashing plugin is a failed check, not a crashed checker
            self.report.checks.append((name, False, f"{type(e).__name__}: {e}"))
        return False


def _ensure(cond: bool, msg: str) -> None:
    if not cond:
        raise AssertionError(msg)


def _common(plugin: _Plugin, kind: str, run: _Runner, report: PluginReport) -> None:
    def round_trip() -> None:
        again = build(kind, plugin.to_dict())  # type: ignore[arg-type]
        _ensure(type(again) is type(plugin), f"build returned {type(again).__name__}")
        _ensure(_eq(again.to_dict(), plugin.to_dict()), "to_dict -> build changed the parameters")

    run("round_trip", round_trip)
    for fname, f in type(plugin).model_fields.items():
        if not f.description:
            report.warnings.append(f"field {fname!r} has no description (shown by describe())")
    try:
        type(plugin).model_json_schema()
    except Exception as e:
        report.warnings.append(
            f"model_json_schema() fails ({type(e).__name__}); describe() will show an error"
        )


def _check_session_plugin(plugin: Any, session: Session, kind: str, run: _Runner) -> None:
    before = session.model_copy(deep=True)
    out: list[Session] = []

    def apply() -> None:
        res = plugin.apply(session)
        _ensure(isinstance(res, Session), f"apply returned {type(res).__name__}, not Session")
        out.append(res)

    if not run("apply", apply):
        return
    o = out[0]
    run(
        "input_unchanged",
        lambda: _ensure(
            (d := _session_diff(session, before)) is None,
            f"apply mutated the input session (field {d!r}); return session.replace/with_*",
        ),
    )

    def frames() -> str | None:
        changed = o.n_time != session.n_time or not _eq(o.t, session.t)
        logged = any(
            not _eq(o.meta.get(k), session.meta.get(k)) for k in ("rebin", "frame_selection")
        )
        if kind == "transform":
            _ensure(not changed, "a Transform must not change n_time or t")
            _ensure(_eq(o.activity, session.activity), "a Transform must not change activity")
        elif changed:
            _ensure(logged, "n_time/t changed without rebin/select_frames (meta log missing)")
            return "frame count changed via rebin/select_frames"
        return None

    run("frame_count", frames)

    def finite() -> None:
        bad = [
            n
            for n, v in {"activity": o.activity, **o.signals}.items()
            if np.asarray(v).dtype.kind in "fc" and np.isinf(np.asarray(v)).any()
        ]
        _ensure(not bad, f"inf in {bad}; use NaN for missing values")

    run("finite_or_nan", finite)
    run(
        "masks_bool",
        lambda: _ensure(
            all(m.dtype == bool and m.shape == (o.n_time,) for m in o.masks.values()),
            "masks must be bool arrays of shape (n_time,)",
        ),
    )
    units = o.meta.get("signal_units", {})
    new_sig = [n for n in o.signals if n not in session.signals]
    run(
        "signal_units",
        lambda: _ensure(
            all(n in units for n in new_sig),
            f"new signals without meta['signal_units']: {[n for n in new_sig if n not in units]}",
        ),
    )
    info = o.meta.get("mask_info", {})
    new_masks = [n for n in o.masks if n not in session.masks]
    run(
        "mask_info",
        lambda: _ensure(
            all(n in info for n in new_masks),
            f"new masks without mask_info (use with_mask(source=)): "
            f"{[n for n in new_masks if n not in info]}",
        ),
    )

    def deterministic() -> None:
        again = plugin.apply(session.model_copy(deep=True))
        _ensure((d := _session_diff(o, again)) is None, f"two applies differ (field {d!r})")

    run("deterministic", deterministic)


def _resolve_target(plugin: Any, session: Session, target: Any) -> tuple[Any, str]:
    if isinstance(target, str):
        return (
            session.states[target] if target in session.states else session.signals[target]
        ), target
    if target is not None:
        return target, getattr(target, "name", "target")
    if getattr(plugin, "input", "states") == "signal":
        for n, v in session.signals.items():
            if np.asarray(v).ndim == 1 and np.asarray(v).dtype.kind == "f":
                return np.asarray(v, float), n
        raise ValueError("session has no 1-D float signal to use as a target; pass target=")
    for n, s in session.states.items():
        try:
            if isinstance(plugin, Metric):
                plugin.check_target(s)
        except ValueError:
            continue
        return s, n
    raise ValueError("session has no state space this plugin accepts; pass target=")


def _mask_for(target: Any, n_time: int) -> np.ndarray:
    m = np.arange(n_time) % 10 != 0  # also exercises masking
    sup = getattr(target, "support", None)
    return m & sup if sup is not None else m


def _check_metric(
    plugin: Metric, session: Session, target: Any, tname: str, run: _Runner, n_shuffles: int
) -> None:
    act, fs = np.asarray(session.activity, float), session.fs
    mask = _mask_for(target, session.n_time)
    m = plugin.model_copy(deep=True)
    state0 = m.model_dump()

    def accepts() -> None:
        m.check_target(target)
        m.check_activity_kind(session.activity_kind)
        m.configure(session, tname)
        if isinstance(target, StateSpace):
            wrong: Any = np.zeros(session.n_time)
        else:
            wrong = next(iter(session.states.values()), None)
            if wrong is None:
                return
        try:
            m.check_target(wrong)
        except ValueError:
            return
        raise AssertionError("check_target accepted a target of the wrong kind (input=...)")

    if not run("check_target", accepts):
        return
    res: list[np.ndarray] = []
    snap = (
        act.copy(),
        mask.copy(),
        target.model_copy(deep=True) if isinstance(target, StateSpace) else target.copy(),
    )

    def shape() -> str:
        out = np.asarray(m.compute(act, target, mask, fs))
        res.append(out)
        if m.level == "cell":
            _ensure(
                out.ndim in (1, 2) and out.shape[0] == session.n_cells,
                f"level='cell' needs shape (n_cells[, k]) = ({session.n_cells}, ...), got {out.shape}",
            )
        _ensure(
            out.dtype.kind in "fiub" and not np.isinf(out.astype(float)).any(),
            "output must be numeric with NaN (not inf) for undefined values",
        )
        return f"shape {out.shape}"

    if not run("compute_shape", shape):
        return
    out = res[0]
    run(
        "inputs_unchanged",
        lambda: _ensure(
            _eq(act, snap[0]) and _eq(mask, snap[1]) and _eq(target, snap[2]),
            "compute mutated activity, mask or target",
        ),
    )
    run(
        "self_unchanged",
        lambda: _ensure(
            _eq(m.model_dump(), state0) and _eq(m.__dict__, plugin.model_copy(deep=True).__dict__),
            "compute mutated self; not thread-safe under n_jobs",
        ),
    )
    run(
        "deterministic",
        lambda: _ensure(_eq(m.compute(act, target, mask, fs), out), "two calls differ"),
    )
    if m.level == "cell":

        def perm() -> None:
            p = np.random.default_rng(0).permutation(session.n_cells)
            _ensure(
                np.allclose(
                    m.compute(act[p], target, mask, fs),
                    out[p],
                    equal_nan=True,
                    rtol=1e-9,
                    atol=1e-12,
                ),
                "permuting cells changed the per-cell values (cells must not interact)",
            )

        run("cell_permutation", perm)

    def shifted() -> str:
        if type(m).compute_shifted is Metric.compute_shifted:
            return "not implemented (engine loops over compute)"
        n = session.n_time
        ks = np.array([n // 7, n // 3 + 1, -(n // 5)], dtype=np.int64)
        fast = m.compute_shifted(act, target, mask, fs, ks)
        if fast is None:
            return "returns None (engine loops over compute)"
        slow = np.stack([m.compute(np.roll(act, int(k), axis=1), target, mask, fs) for k in ks])
        fast = np.asarray(fast)
        _ensure(fast.shape == slow.shape, f"compute_shifted shape {fast.shape} != {slow.shape}")
        ok = np.allclose(fast, slow, equal_nan=True, rtol=1e-7, atol=1e-9)
        _ensure(
            ok,
            f"compute_shifted != compute on np.roll'ed activity (max abs diff {np.nanmax(np.abs(fast - slow)):.3g})",
        )
        return "matches compute on rolled activity for 3 shifts"

    run("compute_shifted", shifted)

    def extras() -> None:
        e = m.extras(act, target, mask, fs)
        _ensure(
            isinstance(e, dict) and all(isinstance(k, str) for k in e),
            "extras must be dict[str, array]",
        )
        e2 = m.extras(act, target, mask, fs)
        _ensure(
            all(np.asarray(v).dtype.kind in "fiubU" for v in e.values()),
            "extras must be numeric (or str-label) arrays",
        )
        _ensure(_eq(e, e2), "extras are not deterministic")

    run("extras", extras)
    run(
        "resolve_tail",
        lambda: _ensure(
            m.resolve_tail(target) in ("upper", "lower", "two"),
            "resolve_tail must return upper|lower|two",
        ),
    )

    def engine() -> None:
        cfg = ShuffleConfig(n_shuffles=n_shuffles, min_shift_s=1.0, seed=0, batch_size=4)
        r1 = shuffle_test(m, act, target, mask, cfg, fs)
        r2 = shuffle_test(m, act, target, mask, cfg.model_copy(update={"n_jobs": 2}), fs)
        _ensure(
            r1.null is not None and r1.null.shape == (n_shuffles, *out.shape),
            "null shape != (n_shuffles, *observed.shape)",
        )
        _ensure(_eq(r1.null, r2.null), "null differs between n_jobs=1 and n_jobs=2")

    run("shuffle_engine", engine)


def _check_null(plugin: Null, session: Session, target: Any, run: _Runner, n_shuffles: int) -> None:
    from ._metrics import MeanPerState

    act, fs = np.asarray(session.activity, float), session.fs
    mask = _mask_for(target, session.n_time)
    snap = (
        act.copy(),
        mask.copy(),
        target.model_copy(deep=True) if isinstance(target, StateSpace) else target.copy(),
    )
    has_one = plugin.has_surrogate
    has_many = type(plugin).surrogates is not Null.surrogates

    def draw(seed: int, glob: int = 0) -> tuple[np.ndarray, Any]:
        np.random.seed(glob)  # a null using the global RNG changes with this
        rng = np.random.default_rng(seed)
        if has_one:
            return plugin.surrogate(act, target, mask, fs, rng)
        return next(iter(plugin.surrogates(act, target, mask, fs, 1, rng)))

    def impl() -> None:
        _ensure(
            has_one or has_many,
            "implement surrogate(activity, target, mask, fs, rng) (preferred) or surrogates",
        )

    if not run("implements_surrogate", impl):
        return
    saved = np.random.get_state()
    s1 = []

    def shapes() -> str:
        a, t = draw(1)
        s1.append((a, t))
        _ensure(
            a.shape == act.shape and a.dtype.kind == "f",
            f"activity surrogate must be float {act.shape}, got {a.dtype}{a.shape}",
        )
        if isinstance(target, StateSpace):
            _ensure(
                isinstance(t, StateSpace)
                and t.onehot.shape == target.onehot.shape
                and t.onehot.dtype == bool
                and t.state_names == target.state_names,
                "target surrogate must be a StateSpace of the same shape/dtype/names",
            )
        else:
            _ensure(
                np.asarray(t).shape == np.asarray(target).shape,
                "target surrogate must keep the signal's shape",
            )
        _ensure(not np.isinf(a).any(), "inf in surrogate activity")
        return "per-draw" if has_one else "surrogates only (serial)"

    ok = run("surrogate_shapes", shapes)
    run(
        "inputs_unchanged",
        lambda: _ensure(
            _eq(act, snap[0]) and _eq(mask, snap[1]) and _eq(target, snap[2]),
            "surrogate mutated its inputs",
        ),
    )
    if ok:

        def seeds() -> None:
            a, t = s1[0]
            a2, t2 = draw(1, glob=99)
            _ensure(
                _eq(a, a2) and _eq(t, t2),
                "same rng seed gave different surrogates (uses global RNG, time or self state?)",
            )
            a3, t3 = draw(2)
            _ensure(
                not (_eq(a, a3) and _eq(t, t3)),
                "different seeds gave identical surrogates (rng ignored?)",
            )

        run("rng_discipline", seeds)

        def what_changes() -> str | None:
            a, t = s1[0]
            if plugin.perturbs == "activity":
                _ensure(_eq(t, target), "perturbs='activity' but the target was changed")
                return None
            _ensure(_eq(a, act), "perturbs='target' but the activity was changed")
            if isinstance(target, StateSpace) and isinstance(t, StateSpace):
                _ensure(
                    _eq(masked_counts(t, mask), masked_counts(target, mask)),
                    "per-state masked frame counts changed (skip='frame_counts' if intended)",
                )
            return None

        run("frame_counts", what_changes)
    np.random.set_state(saved)
    run("check_target", lambda: plugin.check_target(MeanPerState(), target))

    def engine() -> None:
        met = MeanPerState(min_frames=1)
        if not isinstance(target, StateSpace):
            return None
        cfg = ShuffleConfig(n_shuffles=n_shuffles, null=plugin, seed=0, batch_size=4)
        r1 = shuffle_test(met, act, target, mask, cfg, fs)
        r2 = shuffle_test(met, act, target, mask, cfg.model_copy(update={"n_jobs": 2}), fs)
        _ensure(
            r1.null is not None and _eq(r1.null, r2.null),
            "null differs between n_jobs=1 and n_jobs=2",
        )

    run("shuffle_engine", engine)


def _check_selector(
    plugin: Selector,
    session: Session,
    pipeline: Pipeline | None,
    run: _Runner,
    report: PluginReport,
) -> None:
    if pipeline is None:
        report.warnings.append("no pipeline= given: selector checks skipped")
        return
    s0, p0 = session.model_copy(deep=True), pipeline.model_dump()
    sels: list[list[Selection]] = []

    def select() -> None:
        r = plugin.select(session, pipeline)
        _ensure(
            isinstance(r, list) and all(isinstance(s, Selection) for s in r),
            "select must return list[Selection]",
        )
        sels.append(r)

    if not run("select", select):
        return
    run(
        "pure",
        lambda: _ensure(
            _session_diff(session, s0) is None and _eq(pipeline.model_dump(), p0),
            "select mutated the session or pipeline",
        ),
    )

    def paths() -> None:
        for s in sels[0]:
            pipeline.get_param(s.path)
            pipeline.set_param(s.path, s.value, selection=s)

    run("paths_resolve", paths)

    def same() -> None:
        strip = lambda ss: [s.model_dump(exclude={"timestamp"}) for s in ss]  # noqa: E731
        _ensure(
            _eq(strip(plugin.select(session, pipeline)), strip(sels[0])),
            "two calls gave different selections",
        )

    run("deterministic", same)
    run(
        "no_significance",
        lambda: _ensure(
            not any(s.informed_by_significance for s in sels[0]),
            "a selection is marked informed_by_significance",
        ),
    )
    try:
        tree = ast.parse(textwrap.dedent(inspect.getsource(type(plugin))))
        for n in ast.walk(tree):
            if (
                isinstance(n, (ast.ClassDef, ast.FunctionDef))
                and n.body
                and isinstance(n.body[0], ast.Expr)
                and isinstance(getattr(n.body[0], "value", None), ast.Constant)
            ):
                n.body = n.body[1:] or [ast.Pass()]
        hits = sorted(set(_P_VALUE_WORDS.findall(ast.unparse(tree))))
        if hits:
            report.warnings.append(
                f"selector code mentions {hits}; selection criteria must never see p-values"
            )
    except (OSError, TypeError, SyntaxError):
        report.warnings.append("could not read the selector source for the p-value text check")


def check_plugin(
    plugin: _Plugin,
    session: Session,
    *,
    target: Any = None,
    n_shuffles: int = 10,
    pipeline: Pipeline | None = None,
    skip: tuple[str, ...] = (),
) -> PluginReport:
    """Check that ``plugin`` honours the contract in ``docs/PLUGINS.md``.

    Parameters
    ----------
    plugin : Transform, PreprocessStep, Metric, Null or Selector
        An instance, with parameters set (the class must be registered).
    session : Session
        A small session the plugin can run on, e.g. a simulated one after the transforms the
        plugin needs.  It is never modified.
    target : StateSpace, ndarray or str, optional
        For metrics and nulls: the target, or the name of a state space / signal in ``session``.
        Default: the first state space the plugin accepts (a 1-D float signal for
        ``input == "signal"`` metrics).
    n_shuffles : int, default 10
        Surrogates drawn in the end-to-end engine check for metrics and nulls.
    pipeline : Pipeline, optional
        Selectors only: the pipeline whose parameter paths the selections must resolve in.
    skip : tuple of str
        Check names to skip (reported as passed, "skipped by caller").

    Returns
    -------
    PluginReport
        ``passed``, ``checks`` (name, ok, message), ``warnings``; ``raise_if_failed()``.
    """
    kind = next((k for c, k in _KINDS if isinstance(plugin, c)), None)
    if kind is None:
        raise TypeError(
            f"{type(plugin).__name__} is not a Transform, PreprocessStep, Metric, Null or Selector"
        )
    report = PluginReport(plugin=plugin.name, kind=kind)
    run = _Runner(report, tuple(skip))
    _common(plugin, kind, run, report)
    if kind in ("transform", "preprocess"):
        _check_session_plugin(plugin, session, kind, run)
    elif kind == "selector":
        _check_selector(plugin, session, pipeline, run, report)  # type: ignore[arg-type]
    else:
        tgt: list[Any] = []

        def pick() -> None:
            tgt.extend(_resolve_target(plugin, session, target))

        if run("target", pick):
            if kind == "metric":
                _check_metric(plugin, session, tgt[0], tgt[1], run, n_shuffles)  # type: ignore[arg-type]
            else:
                tgt_obj, tgt_name = tgt[0], tgt[1]

                def bind() -> None:
                    # the pipeline calls Null.configure(session, spec) before the shuffle
                    # test; mirror it with a minimal spec so bound nulls can be checked
                    from types import SimpleNamespace

                    is_state = isinstance(tgt_obj, StateSpace)
                    spec = SimpleNamespace(
                        states=tgt_name if is_state else None,
                        signal=None if is_state else tgt_name,
                        masks=None,
                        name=f"check[{tgt_name}]",
                    )
                    tgt.append(plugin.configure(session, spec))

                bound = plugin
                if run("configure", bind):
                    bound = tgt[2]
                _check_null(bound, session, tgt_obj, run, n_shuffles)  # type: ignore[arg-type]
    return report


__all__ = ["PluginReport", "check_plugin"]
