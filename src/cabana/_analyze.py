"""``cabana.analyze``: the researcher front door, backed by YAML recipes.

A *recipe* is a pipeline YAML (the format of :meth:`Pipeline.to_yaml`) with a ``recipe:``
header and ``${placeholders}`` for what changes between datasets: ``states``, ``signal``,
``masks``, ``n_shuffles``, ``seed``, ``min_shift_s``.  Recipes ship in ``cabana/recipes``;
see ``docs/RECIPES.md``.
"""

from __future__ import annotations

import copy
import importlib.resources as _res
import re
import warnings
from collections.abc import Mapping, Sequence
from dataclasses import replace
from pathlib import Path
from typing import Any, Literal

from ._logging import logger, merge_context, print_context, tqdm_context
from ._models import Session
from ._pipeline import Pipeline, RunContext
from ._results import ResultSet
from ._selection import Selection

_PLACEHOLDER = re.compile(r"\$\{(\w+)\}")
_FIELDS = ("states", "signal", "masks", "n_shuffles", "seed", "min_shift_s")


def _yaml() -> Any:
    try:
        import yaml
    except ImportError as exc:  # pragma: no cover
        raise ImportError("recipes need pyyaml (pip install pyyaml)") from exc
    return yaml


def _recipe_dir() -> Any:
    return _res.files("cabana") / "recipes"


def recipes() -> list[str]:
    """Names of the bundled recipes, sorted (see ``docs/RECIPES.md``).

    Returns
    -------
    list[str]
        Names usable as ``cabana.analyze(session, name, ...)``.
    """
    return sorted(
        p.name[: -len(".yaml")] for p in _recipe_dir().iterdir() if p.name.endswith(".yaml")
    )


def _load_text(text: str) -> dict[str, Any]:
    d = _yaml().safe_load(text)
    if not isinstance(d, dict):
        raise ValueError("a recipe / pipeline YAML must be a mapping")
    return d


def _normalize(d: dict[str, Any], default_name: str = "") -> dict[str, Any]:
    """Recipe dict with header keys filled in; a bare pipeline mapping gets an empty header."""
    if "recipe" in d and "pipeline" in d:
        head = dict(d["recipe"] or {})
        pipe = d["pipeline"]
    else:
        head, pipe = {}, d
    head.setdefault("name", default_name)
    head.setdefault("title", head["name"])
    head.setdefault("description", "")
    head["targets"] = dict(head.get("targets") or {})
    head["defaults"] = dict(head.get("defaults") or {})
    head["ensure_masks"] = dict(head.get("ensure_masks") or {})
    head["ensure_signals"] = dict(head.get("ensure_signals") or {})
    return {**head, "pipeline": copy.deepcopy(pipe)}


def _load_recipe(name: str) -> dict[str, Any]:
    """Parsed bundled recipe: header keys plus the pipeline template.

    Parameters
    ----------
    name : str
        A name from :func:`recipes`.

    Returns
    -------
    dict
        ``name``, ``title``, ``description``, ``targets`` (placeholder -> what it must be),
        ``defaults`` (placeholder values used when not given), ``ensure_masks``, ``ensure_signals`` and
        ``pipeline`` (the template with ``${placeholders}``).

    Raises
    ------
    ValueError
        If ``name`` is not a bundled recipe.
    """
    avail = recipes()
    if name not in avail:
        raise ValueError(f"unknown recipe {name!r}; available: {avail}")
    text = (_recipe_dir() / f"{name}.yaml").read_text()
    return _normalize(_load_text(text), name)


def _substitute(obj: Any, values: Mapping[str, Any], where: str) -> Any:
    if isinstance(obj, str):
        m = _PLACEHOLDER.fullmatch(obj)
        if m:
            return _lookup(m.group(1), values, where)
        return _PLACEHOLDER.sub(lambda mm: str(_lookup(mm.group(1), values, where)), obj)
    if isinstance(obj, list):
        return [_substitute(x, values, where) for x in obj]
    if isinstance(obj, dict):
        return {k: _substitute(v, values, where) for k, v in obj.items()}
    return obj


def _lookup(key: str, values: Mapping[str, Any], where: str) -> Any:
    if key not in values:
        raise ValueError(f"{where}: unknown placeholder ${{{key}}} (known: {sorted(values)})")
    return copy.deepcopy(values[key])


def _session_has(session: Session | None) -> str:
    if session is None:
        return ""
    return f"; session has states={sorted(session.states)}, signals={sorted(session.signals)}"


def _placeholders(obj: Any) -> set[str]:
    """Names of every ``${placeholder}`` in a recipe template."""
    if isinstance(obj, str):
        return set(_PLACEHOLDER.findall(obj))
    if isinstance(obj, list):
        return set().union(*(_placeholders(x) for x in obj)) if obj else set()
    if isinstance(obj, dict):
        return set().union(*(_placeholders(v) for v in obj.values())) if obj else set()
    return set()


_UNIT_NAMES = {
    "mm": "mm",
    "millimeter": "mm",
    "millimetre": "mm",
    "cm": "cm",
    "centimeter": "cm",
    "centimetre": "cm",
    "m": "m",
    "meter": "m",
    "metre": "m",
}


def _normalize_unit(text: Any) -> str | None:
    u = str(text or "").strip().lower().split("/")[0].strip()
    return _UNIT_NAMES.get(u)


def _position_units(session: Session, signal: str) -> str | None:
    """Length unit (``"mm"``, ``"cm"``, ``"m"``) of the position behind ``signal``, or None.

    Looks in ``session.meta["signal_units"]`` (the speed signal, then ``x`` / ``y``), in
    ``session.meta["arena"]["units"]`` and in the ``units`` of the ``ContinuousSignal`` in
    ``session.behavior`` that has an ``x`` channel.
    """
    su = session.meta.get("signal_units") or {}
    for key in (signal, "x", "y", "position"):
        u = _normalize_unit(su.get(key))
        if u:
            return u
    arena = session.meta.get("arena")
    if isinstance(arena, Mapping):
        u = _normalize_unit(arena.get("units"))
        if u:
            return u
    sigs = [v for v in getattr(session, "behavior", {}).values() if hasattr(v, "channel_names")]
    sigs.sort(key=lambda v: "x" not in list(v.channel_names))  # position-like signals first
    for v in sigs:
        u = _normalize_unit(getattr(v, "units", ""))
        if u:
            return u
    return None


def _speed_gate(
    spec: dict[str, Any],
    session: Session,
    name: str,
    notes: list[tuple[str, str]],
    override_paths: Sequence[str],
) -> dict[str, Any]:
    """Resolve ``min_speed_by_unit`` of an ``ensure_masks`` step to a ``min_speed`` value."""
    spec = dict(spec)
    table = spec.pop("min_speed_by_unit", None)
    if not table:
        return spec
    unit = _position_units(session, str(spec.get("signal")))
    if unit in table:
        spec["min_speed"] = float(table[unit])
        notes.append(
            (
                "info",
                f"recipe {name!r}: speed gate {spec['min_speed']:g} {unit}/s "
                f"(position units read as {unit})",
            )
        )
    elif not any(p.startswith("preprocess.") and p.endswith(".min_speed") for p in override_paths):
        notes.append(
            (
                "warn",
                f"recipe {name!r}: the position unit of the session is unknown, so the speed "
                f"gate is {spec['min_speed']:g} position-units/s; set it with "
                '**{"preprocess.speed.min_speed": ...} (20 mm/s or 2 cm/s is typical for a mouse)',
            )
        )
    return spec


def _build_pipeline(
    rec: dict[str, Any],
    subs: Mapping[str, Any],
    session: Session | None = None,
    notes: list[tuple[str, str]] | None = None,
    override_paths: Sequence[str] = (),
) -> Pipeline:
    name = rec["name"] or "pipeline"
    where = f"recipe {name!r}"
    notes = notes if notes is not None else []
    used = _placeholders(rec["pipeline"])
    explicit = {k: v for k, v in subs.items() if v is not None}
    for k in explicit:
        if k not in used:
            raise ValueError(
                f"{k}= has no effect on {where}: its pipeline has no ${{{k}}} placeholder "
                f"(it uses {sorted(used & set(_FIELDS)) or 'none of the shortcuts'}); "
                "write a custom recipe or pass a parameter path override instead"
            )
    values: dict[str, Any] = dict(rec["defaults"])
    values.update(explicit)
    for target, what in rec["targets"].items():
        if values.get(target) is None:
            raise ValueError(f"recipe {name!r} needs {target}= ({what}){_session_has(session)}")
    if "seed" in used and values.get("seed") is None:
        values["seed"] = 0
    for k in used & set(_FIELDS) - {"masks"}:
        if values.get(k) is None:
            raise ValueError(
                f"{where} uses ${{{k}}} but has no value for it: pass {k}= or add it to the "
                "recipe's defaults:"
            )
    for k in _FIELDS:
        values.setdefault(k, None)
    masks = values.get("masks")
    if isinstance(masks, str):
        masks = [masks]
    values["masks"] = list(masks) if masks is not None else []
    pipe = _substitute(rec["pipeline"], values, where)
    if subs.get("min_shift_s") is not None:  # an explicit value beats the data-driven selector
        for sel in pipe.get("selectors", []):
            if sel.get("name") == "auto_null_timescale":
                sel["set_min_shift"] = False  # it may still choose block lengths
    if session is not None:
        extra = []
        for m in values["masks"]:
            spec = rec["ensure_masks"].get(m)
            if not spec or m in session.masks:
                continue
            if spec.get("signal") not in session.signals:
                notes.append(
                    (
                        "hint",
                        f"mask {m!r} is not in the session and {where} can only create it from "
                        f"signal {spec.get('signal')!r}, which the session lacks; add the "
                        "transforms that make it, e.g. resample_signal(source='position') then "
                        "speed, or pass the mask in session.masks",
                    )
                )
                continue
            extra.append(_speed_gate(spec, session, name, notes, override_paths))
        if extra:
            pipe["preprocess"] = [*extra, *pipe.get("preprocess", [])]
    if session is not None:
        extra_t: list[dict[str, Any]] = []
        for sig, spec in rec["ensure_signals"].items():
            if sig in session.signals or not _mentions(pipe.get("analyses", []), sig):
                continue
            chain = [dict(t) for t in spec["transforms"]]
            source = spec.get("source")
            if source is not None and source not in session.behavior:
                notes.append(
                    (
                        "hint",
                        f"signal {sig!r} is not in the session and {where} can only create it "
                        f"from the raw signal {source!r}, which the session lacks; add the "
                        f"transforms that make {sig!r} or put the signal in session.signals",
                    )
                )
            elif not any(t in extra_t for t in chain):  # one chain may make several signals
                extra_t.extend(chain)
        if extra_t:
            pipe["transforms"] = [*extra_t, *pipe.get("transforms", [])]
    return Pipeline.from_dict(pipe)


def _mentions(obj: Any, value: str) -> bool:
    if isinstance(obj, str):
        return obj == value
    if isinstance(obj, list):
        return any(_mentions(x, value) for x in obj)
    if isinstance(obj, dict):
        return any(_mentions(v, value) for v in obj.values())
    return False


def recipe(name: str) -> dict[str, Any]:
    """Parsed bundled recipe: header keys plus the pipeline template (see ``_load_recipe``)."""
    return _load_recipe(name)


def recipe_pipeline(name: str, **subs: Any) -> Pipeline:
    """Build a :class:`Pipeline` from a bundled recipe by filling its placeholders.

    Parameters
    ----------
    name : str
        A name from :func:`recipes`.
    **subs
        Values for ``states``, ``signal``, ``masks``, ``n_shuffles``, ``seed``,
        ``min_shift_s``; anything omitted takes the recipe default.

    Returns
    -------
    Pipeline

    Raises
    ------
    ValueError
        If a required target (``states=`` / ``signal=``) is missing or ``name`` is unknown.
    """
    return _build_pipeline(_load_recipe(name), subs)


def _is_path(recipe_arg: str | Path) -> bool:
    if isinstance(recipe_arg, Path):
        return True
    s = str(recipe_arg)
    return s.endswith((".yaml", ".yml")) or "/" in s or "\\" in s or Path(s).is_file()


def analyze(
    session: Session,
    recipe: str | Path | Pipeline,
    *,
    states: str | None = None,
    signal: str | None = None,
    masks: list[str] | str | None = None,
    n_shuffles: int | None = None,
    seed: int | None = None,
    min_shift_s: float | None = None,
    progress: bool = True,
    out_dir: str | Path | None = None,
    context: RunContext | None = None,
    on_error: Literal["raise", "record"] = "record",
    **overrides: Any,
) -> tuple[Session, ResultSet]:
    """Run a recipe on a session: validate, run and (optionally) save in one call.

    Parameters
    ----------
    session : Session
        Session with the behavior (state spaces, signals) the recipe targets.
    recipe : str, Path or Pipeline
        A bundled recipe name (:func:`recipes`), the path of a recipe or pipeline YAML, or a
        ready :class:`Pipeline`.
    states, signal : str, optional
        Name of the state space / signal to analyse (required when the recipe names it).
    masks : list[str] or str, optional
        Session masks to apply; ``None`` keeps the recipe default.  A recipe may add a
        standard preprocess step to create a missing mask (``speed``).
    n_shuffles : int, optional
        Surrogates per test; ``None`` keeps the recipe default.
    seed : int, optional
        Base shuffle seed; ``None`` keeps the recipe default (0) or, for a ``Pipeline``, the
        seeds it already has.
    min_shift_s : float, optional
        Smallest circular shift in seconds.  An explicit value beats the recipe's
        ``auto_null_timescale`` selector (which is removed from a recipe; for a ``Pipeline``
        the selector skips the parameter).  For a ``Pipeline`` whose shuffle has an explicit
        ``null`` it is written into that null.
    progress : bool, default True
        Show progress and print one line with the pre-run estimate (time, peak memory,
        analyses, frames): a tqdm bar when tqdm is importable, otherwise stage lines on
        stdout.  ``False`` prints nothing.
    out_dir : str or Path, optional
        Directory receiving ``results.zip``, ``pipeline.yaml`` and ``summary.csv``.
    context : RunContext, optional
        Extra callbacks / cancellation, merged with the progress display.  Its ``on_error``
        is ignored: use the ``on_error`` argument.
    on_error : {"record", "raise"}, default "record"
        ``"record"`` stores an analysis that raises in ``results.errors`` and continues
        (``results.status`` is then ``"partial"``); ``"raise"`` stops at the first one.  Wins
        over ``context.on_error``.
    **overrides
        Parameter paths as in :meth:`Pipeline.set_param`, e.g.
        ``**{"analyses.*.shuffle.n_shuffles": 200}``; each is recorded as a
        ``user_pick`` selection in the provenance and, because it is a user pick, a selector
        never overwrites it.

    Returns
    -------
    tuple[Session, ResultSet]
        The processed session and the results.  With ``on_error="record"`` a failed analysis
        is listed in ``results.errors`` and a single ``UserWarning`` after the run names
        every failure ("2 of 3 analyses failed: ...").

    Raises
    ------
    ValueError
        A required target is missing, the recipe is unknown, a shortcut (``masks=``,
        ``n_shuffles=``, ``seed=``, ``min_shift_s=``, ``states=``, ``signal=``) matches
        nothing in the recipe or pipeline, a placeholder has no value, or the pre-run
        validation (:meth:`Pipeline.validate`) reports errors; the message is the report.

    Warns
    -----
    UserWarning
        For every validation warning, for a speed gate whose unit could not be determined and
        once after the run when analyses failed.

    Examples
    --------
    >>> session, results = cabana.analyze(session, "place_cell", states="position")  # doctest: +SKIP
    >>> results.summary()  # doctest: +SKIP
    """
    if on_error not in ("raise", "record"):
        raise ValueError(f"on_error must be 'raise' or 'record', got {on_error!r}")
    subs = {
        "states": states,
        "signal": signal,
        "masks": masks,
        "n_shuffles": n_shuffles,
        "seed": seed,
        "min_shift_s": min_shift_s,
    }
    notes: list[tuple[str, str]] = []
    if isinstance(recipe, Pipeline):
        pipeline = _pipeline_object(recipe, subs)
    else:
        if _is_path(recipe):
            p = Path(recipe)
            rec = _normalize(_load_text(p.read_text()), p.stem)
        else:
            rec = _load_recipe(str(recipe))
        pipeline = _build_pipeline(rec, subs, session, notes, list(overrides))
    for path, value in overrides.items():
        pipeline = pipeline.set_param(
            path,
            value,
            selection=Selection(
                path=path, value=value, method="user_pick", note="analyze() override"
            ),
        )
    for kind, msg in notes:
        if kind == "warn":
            logger.warning("%s", msg)
            warnings.warn(msg, UserWarning, stacklevel=2)
        else:
            logger.info("%s", msg)

    report = pipeline.validate(session)
    grouped: dict[tuple[str, str], list[str]] = {}
    for issue in report.warnings:  # one warning per distinct message, naming the analyses
        grouped.setdefault((issue.code, issue.message), []).append(issue.analysis or "")
    for (code, message), names in grouped.items():
        who = ", ".join(n for n in names if n)
        text = f"{code}{f' [{who}]' if who else ''}: {message}"
        logger.warning("%s", text)
        warnings.warn(text, UserWarning, stacklevel=2)
    if not report.ok:
        hints = "".join(f"\nhint: {m}" for k, m in notes if k == "hint")
        raise ValueError(str(report) + hints)

    if progress:
        emit = context.log if context is not None and context.log is not None else _print
        emit(_estimate_line(report, session, len(pipeline.analyses)))
    ctx, closer = _progress_context(progress)
    if context is not None:
        ctx = merge_context(ctx, context)
    ctx = replace(ctx, on_error=on_error)
    try:
        out_session, results = pipeline.run(session, context=ctx)
    finally:
        if closer is not None:
            closer()
    for e in results.errors:
        logger.warning("analysis %s failed: %s: %s", e.analysis, e.error_type, e.message)
    if results.errors:
        shown = "; ".join(
            f"{e.analysis}: {e.error_type}: {_clip(e.message)}" for e in results.errors
        )
        warnings.warn(
            f"{len(results.errors)} of {len(pipeline.analyses)} analyses failed: {shown} "
            "(see results.errors)",
            UserWarning,
            stacklevel=2,
        )
    if out_dir is not None:
        _save(out_dir, pipeline, results)
    return out_session, results


def _print(msg: str) -> None:
    print(msg, flush=True)


def _clip(text: str, n: int = 240) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= n else text[: n - 3] + "..."


def _estimate_line(report: Any, session: Session, n_analyses: int) -> str:
    from ._memory import human_bytes

    if report.total_time_s is None:
        t = "time unknown"
    else:
        t = f"{'>= ' if report.time_is_lower_bound else ''}{report.total_time_s:.1f} s"
    mem = (
        ""
        if report.peak_memory_bytes is None
        else f", peak {human_bytes(report.peak_memory_bytes)}"
    )
    frames = [e["n_frames_used"] for e in report.estimates.values() if e["n_frames_used"]]
    n = max(frames) if frames else session.n_time
    return (
        f"estimated {t}{mem}, {n_analyses} analys{'is' if n_analyses == 1 else 'es'} on {n} frames"
    )


def _pipeline_object(pipeline: Pipeline, subs: Mapping[str, Any]) -> Pipeline:
    """Apply the shortcuts to a ready pipeline; one that matches nothing raises."""
    for k in ("states", "signal"):
        if subs.get(k) is not None:
            raise ValueError(f"{k}= only applies to recipes; a Pipeline already names its targets")
    names = pipeline.resolved_names()
    shuffled = [i for i, a in enumerate(pipeline.analyses) if a.shuffle is not None]
    out = pipeline

    def pick(path: str, value: Any) -> None:
        nonlocal out
        out = out.set_param(
            path,
            value,
            selection=Selection(
                path=path, value=value, method="user_pick", note="analyze() override"
            ),
        )

    if subs.get("masks") is not None:
        v = subs["masks"]
        pick("analyses.*.masks", [v] if isinstance(v, str) else list(v))
    for key in ("n_shuffles", "seed"):
        v = subs.get(key)
        if v is None:
            continue
        if not shuffled:
            raise ValueError(
                f"{key}= has no effect: no analysis of this Pipeline has a shuffle test"
            )
        pick(f"analyses.*.shuffle.{key}", v)
    v = subs.get("min_shift_s")
    if v is not None:
        if not shuffled:
            raise ValueError(
                "min_shift_s= has no effect: no analysis of this Pipeline has a shuffle"
            )
        plain = [i for i in shuffled if pipeline.analyses[i].shuffle.null is None]
        for i in shuffled:
            null = pipeline.analyses[i].shuffle.null
            if null is not None and "min_shift_s" not in type(null).model_fields:
                raise ValueError(
                    f"min_shift_s= cannot be applied to analysis {names[i]!r}: its null "
                    f"{null.name!r} has no min_shift_s; set the null yourself or drop the "
                    "shortcut"
                )
        if len(plain) == len(shuffled):
            pick("analyses.*.shuffle.min_shift_s", v)
        else:
            for i in shuffled:
                null = pipeline.analyses[i].shuffle.null
                if null is None:
                    pick(f"analyses.{names[i]}.shuffle.min_shift_s", v)
                else:
                    pick(f"analyses.{names[i]}.shuffle.null", {**null.to_dict(), "min_shift_s": v})
    return out


def _progress_context(progress: bool) -> tuple[RunContext, Any]:
    if not progress:
        return RunContext(), None
    try:
        ctx = tqdm_context()
        return ctx, getattr(ctx.on_progress, "close", None)
    except ImportError:
        return print_context(), None


def _save(out_dir: str | Path, pipeline: Pipeline, results: ResultSet) -> None:
    from ._summary import summarize

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    results.save(out / "results.zip")
    pipeline.to_yaml(out / "pipeline.yaml")
    summarize(results).to_csv(out / "summary.csv", index=False)
