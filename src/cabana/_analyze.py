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
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from ._logging import log_context, logger, merge_context, tqdm_context
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
        ``defaults`` (placeholder values used when not given), ``ensure_masks`` and
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


def _build_pipeline(
    rec: dict[str, Any],
    subs: Mapping[str, Any],
    session: Session | None = None,
) -> Pipeline:
    name = rec["name"] or "pipeline"
    where = f"recipe {name!r}"
    values: dict[str, Any] = dict(rec["defaults"])
    values.update({k: v for k, v in subs.items() if v is not None})
    for target, what in rec["targets"].items():
        if values.get(target) is None:
            raise ValueError(f"recipe {name!r} needs {target}= ({what}){_session_has(session)}")
    for k in ("n_shuffles", "seed", "min_shift_s"):
        values.setdefault(k, None)
    masks = values.get("masks")
    if isinstance(masks, str):
        masks = [masks]
    values["masks"] = list(masks) if masks is not None else []
    pipe = _substitute(rec["pipeline"], values, where)
    if subs.get("min_shift_s") is not None:  # an explicit value beats the data-driven selector
        pipe["selectors"] = [
            s for s in pipe.get("selectors", []) if s.get("name") != "auto_null_timescale"
        ]
        if not pipe["selectors"]:
            pipe.pop("selectors")
    if session is not None:
        extra = []
        for m in values["masks"]:
            spec = rec["ensure_masks"].get(m)
            if spec and m not in session.masks and spec.get("signal") in session.signals:
                extra.append(dict(spec))
        if extra:
            pipe["preprocess"] = [*extra, *pipe.get("preprocess", [])]
    return Pipeline.from_dict(pipe)


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
    seed: int | None = 0,
    min_shift_s: float | None = None,
    progress: bool = True,
    out_dir: str | Path | None = None,
    context: RunContext | None = None,
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
    seed : int, default 0
        Base shuffle seed.
    min_shift_s : float, optional
        Smallest circular shift in seconds.  Giving it removes the recipe's
        ``auto_null_timescale`` selector (an explicit value wins).
    progress : bool, default True
        A tqdm bar when tqdm is importable, otherwise stage lines through the ``"cabana"``
        logger at INFO (call ``logging.basicConfig(level=logging.INFO)`` to see them).
    out_dir : str or Path, optional
        Directory receiving ``results.zip``, ``pipeline.yaml`` and ``summary.csv``.
    context : RunContext, optional
        Extra callbacks / cancellation, merged with the progress display.
    **overrides
        Parameter paths as in :meth:`Pipeline.set_param`, e.g.
        ``**{"analyses.*.shuffle.n_shuffles": 200}``; each is recorded as a
        ``user_pick`` selection in the provenance.

    Returns
    -------
    tuple[Session, ResultSet]
        The processed session and the results.  Analyses that fail are recorded in
        ``results.errors`` (``on_error="record"``) unless ``context`` says otherwise.

    Raises
    ------
    ValueError
        A required target is missing, the recipe is unknown, or the pre-run validation
        (:meth:`Pipeline.validate`) reports errors; the message is the report.

    Examples
    --------
    >>> session, results = cabana.analyze(session, "place_cell", states="position")  # doctest: +SKIP
    >>> results.summary()  # doctest: +SKIP
    """
    subs = {
        "states": states,
        "signal": signal,
        "masks": masks,
        "n_shuffles": n_shuffles,
        "seed": seed,
        "min_shift_s": min_shift_s,
    }
    if isinstance(recipe, Pipeline):
        pipeline = _pipeline_object(recipe, subs)
    else:
        if _is_path(recipe):
            p = Path(recipe)
            rec = _normalize(_load_text(p.read_text()), p.stem)
        else:
            rec = _load_recipe(str(recipe))
        pipeline = _build_pipeline(rec, subs, session)
    for path, value in overrides.items():
        pipeline = pipeline.set_param(
            path,
            value,
            selection=Selection(
                path=path, value=value, method="user_pick", note="analyze() override"
            ),
        )

    report = pipeline.validate(session)
    for issue in report.warnings:
        logger.warning(
            "%s%s: %s", issue.code, f" [{issue.analysis}]" if issue.analysis else "", issue.message
        )
    if not report.ok:
        raise ValueError(str(report))

    ctx, closer = _progress_context(progress)
    if context is not None:
        ctx = merge_context(ctx, context)
    elif ctx.on_error == "raise":
        from dataclasses import replace

        ctx = replace(ctx, on_error="record")
    try:
        out_session, results = pipeline.run(session, context=ctx)
    finally:
        if closer is not None:
            closer()
    for e in results.errors:
        logger.warning("analysis %s failed: %s: %s", e.analysis, e.error_type, e.message)
    if out_dir is not None:
        _save(out_dir, pipeline, results)
    return out_session, results


def _pipeline_object(pipeline: Pipeline, subs: Mapping[str, Any]) -> Pipeline:
    for k in ("states", "signal"):
        if subs.get(k) is not None:
            raise ValueError(f"{k}= only applies to recipes; a Pipeline already names its targets")
    out = pipeline
    for key, path in (
        ("masks", "analyses.*.masks"),
        ("n_shuffles", "analyses.*.shuffle.n_shuffles"),
        ("min_shift_s", "analyses.*.shuffle.min_shift_s"),
    ):
        v = subs.get(key)
        if v is None:
            continue
        if key == "masks" and isinstance(v, str):
            v = [v]
        out = out.set_param(
            path,
            v,
            selection=Selection(path=path, value=v, method="user_pick", note="analyze() override"),
        )
    return out


def _progress_context(progress: bool) -> tuple[RunContext, Any]:
    if not progress:
        return RunContext(), None
    try:
        ctx = tqdm_context()
        return ctx, getattr(ctx.on_progress, "close", None)
    except ImportError:
        return log_context(), None


def _save(out_dir: str | Path, pipeline: Pipeline, results: ResultSet) -> None:
    from ._summary import summarize

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    results.save(out / "results.zip")
    pipeline.to_yaml(out / "pipeline.yaml")
    summarize(results).to_csv(out / "summary.csv", index=False)
