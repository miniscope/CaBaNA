"""``cabana.describe()``: what the library can do, as JSON, for a front end.

Lists every registered plugin with its pydantic JSON schema, docstring and a flat
``params`` table, plus the schemas of the top-level config models.  Each parameter
carries ``ui`` hints (``group``, ``sweepable``, ``unit``) so a form and a sweep
slider can be generated from the description alone; a plugin field may override
them with ``json_schema_extra={"ui": {...}}``.  Metric entries also describe their
outputs (``outputs``); ``describe(probe=True)`` runs every metric once on a tiny
simulated session to report the extras it produces (shape, dtype, axes).
"""

from __future__ import annotations

import math
import types
import typing
import warnings
from typing import Any, Literal, get_args, get_origin

import numpy as np
from pydantic.fields import FieldInfo
from pydantic_core import PydanticUndefined, to_jsonable_python

from ._registry import _REGISTRY

__all__ = ["describe"]

UI_GROUPS = ("time", "binning", "thresholds", "compute", "method", "other")
_NOT_SWEEPABLE = frozenset({"seed", "n_jobs", "batch_size", "n_shuffles"})
_UNIT_SUFFIXES = (
    ("_s", "s"),
    ("_hz", "Hz"),
    ("_mm", "mm"),
    ("_cm", "cm"),
    ("_bins", "bins"),
    ("_frames", "frames"),
    ("_fraction", "fraction"),
)


def _strict(x: Any) -> Any:
    """Copy of ``x`` that survives ``json.dumps(allow_nan=False)`` (non-finite -> None)."""
    if isinstance(x, dict):
        return {str(k): _strict(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_strict(v) for v in x]
    if isinstance(x, np.ndarray):
        return _strict(x.tolist())
    if isinstance(x, np.generic):
        return _strict(x.item())
    if isinstance(x, float):
        return x if math.isfinite(x) else None
    if x is None or isinstance(x, (bool, int, str)):
        return x
    return str(x)


def _union_members(ann: Any) -> list[Any]:
    if get_origin(ann) in (typing.Union, types.UnionType):
        return list(get_args(ann))
    return [ann]


def _json_types(ann: Any) -> list[str]:
    """JSON-schema type names an annotation admits (best effort)."""
    out: list[str] = []
    for m in _union_members(ann):
        origin = get_origin(m)
        if m is type(None):
            t = "null"
        elif m is bool:
            t = "boolean"
        elif m is int:
            t = "integer"
        elif m is float:
            t = "number"
        elif m is str:
            t = "string"
        elif origin is Literal:
            vals = get_args(m)
            t = "string" if all(isinstance(v, str) for v in vals) else "number"
        elif origin in (list, tuple, set, frozenset) or m in (list, tuple):
            t = "array"
        elif origin is dict or m is dict:
            t = "object"
        else:
            t = "object"
        if t not in out:
            out.append(t)
    return out


def _infer_group(name: str) -> str:
    n = name.lower()
    if n.endswith(("_s", "_hz")) or any(w in n for w in ("time", "lag", "shift", "block")):
        return "time"
    if n.startswith(("smooth", "bin")) or n == "sigma" or "sigma" in n:
        return "binning"
    if n.startswith(("min_", "max_", "threshold")) or n in ("alpha", "tolerance"):
        return "thresholds"
    if n.startswith(("n_", "batch")) or n in ("seed", "n_jobs"):
        return "compute"
    if n in ("statistic", "method", "units", "likelihood", "rule", "tail") or n.startswith(
        "correction"
    ):
        return "method"
    return "other"


def _infer_unit(name: str) -> str | None:
    n = name.lower()
    for suffix, unit in _UNIT_SUFFIXES:
        if n.endswith(suffix):
            return unit
    return "fraction" if n.endswith("fraction") else None


def _sweepable(name: str, ann: Any) -> bool:
    if name in _NOT_SWEEPABLE:
        return False
    members = [m for m in _union_members(ann) if m is not type(None)]
    return bool(members) and all(m in (int, float) for m in members)


def _ui(name: str, info: FieldInfo) -> dict[str, Any]:
    ui = {
        "group": _infer_group(name),
        "sweepable": _sweepable(name, info.annotation),
        "unit": _infer_unit(name),
    }
    extra = info.json_schema_extra
    if isinstance(extra, dict) and isinstance(extra.get("ui"), dict):
        ui.update(extra["ui"])
    return ui


def _default(info: FieldInfo) -> Any:
    if info.default is not PydanticUndefined:
        d = info.default
    elif info.default_factory is not None:
        try:
            d = info.default_factory()  # type: ignore[call-arg]
        except Exception:
            return None
    else:
        return None
    try:
        return _strict(to_jsonable_python(d, fallback=str))
    except Exception:
        return str(d)


def _params(cls: Any) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for fname, info in cls.model_fields.items():
        out[fname] = {
            "type": _json_types(info.annotation),
            "default": _default(info),
            "required": info.is_required(),
            "description": info.description or "",
            "ui": _ui(fname, info),
        }
    return out


def _output_axes(cls: Any) -> dict[str, Any]:
    level = getattr(cls, "level", "cell")
    if level == "cell":
        values = {"axes": ["cell", "state?"], "per_state": "maybe"}
    else:
        values = {"axes": None, "per_state": "maybe", "note": "population shape varies"}
    return {
        "level": level,
        "input": getattr(cls, "input", None),
        "values": values,
        "extras": None,
    }


def _probe_session() -> Any:
    from . import build, simulate_session

    s = simulate_session(duration_s=120, n_cells=8, seed=0)
    for spec in (
        {"name": "resample_signal", "source": "position"},
        {"name": "speed"},
        {"name": "bin_grid", "signals": ["x", "y"], "bin_size": 100.0, "output": "position"},
        {"name": "bouts_to_states", "source": "social"},
        {"name": "labels_to_states", "source": "syllables"},
    ):
        s = build("transform", spec).apply(s)
    return s


def _probe_metric(cls: Any, session: Any) -> dict[str, Any]:
    """Run ``cls()`` once on ``session``; return its extras' ``{shape, dtype, axes}``."""
    from ._io import _array_meta
    from ._results import MetricResult

    metric = cls()
    activity = np.asarray(session.activity)
    mask = np.ones(activity.shape[1], dtype=bool)
    if metric.input == "signal":
        names = [n for n in ("x", "speed", "y") if n in session.signals]
        candidates = [(n, np.asarray(session.signals[n], dtype=np.float64)) for n in names]
    else:
        order = ["position"] if metric.requires_topology else ["position", "syllables", "social"]
        candidates = [(n, session.states[n]) for n in order if n in session.states]
    last: Exception | None = None
    for name, target in candidates:
        try:
            metric.check_target(target)
            metric.configure(session, name)
            values = np.asarray(metric.compute(activity, target, mask, session.fs))
            extras = {
                k: np.asarray(v)
                for k, v in metric.extras(activity, target, mask, session.fs).items()
            }
        except Exception as exc:
            last = exc
            continue
        topo = getattr(target, "topology", None)
        grid = tuple(topo.shape) if topo is not None else None
        res = MetricResult.model_construct(
            metric=metric.name,
            target=name,
            level=metric.level,
            values=values,
            extras=extras,
            cell_ids=[str(i) for i in range(activity.shape[0])] if metric.level == "cell" else None,
            state_names=[str(n) for n in target.state_names]
            if hasattr(target, "state_names")
            else None,
            provenance={"n_cells": activity.shape[0]},
        )
        out = {}
        for k, v in extras.items():
            if v.dtype.kind in "US":
                out[k] = {"shape": list(v.shape), "dtype": "str", "axes": [None] * v.ndim}
            else:
                out[k] = _array_meta(res, k, v, grid_shape=grid)
        return out
    return {"error": f"{type(last).__name__}: {last}" if last else "no probe target available"}


def describe(*, probe: bool = False, **kw: Any) -> dict[str, Any]:
    """JSON-serialisable capability description for a front end.

    Parameters
    ----------
    probe : bool, default False
        Run every metric once on a tiny simulated session and fill
        ``outputs["extras"]`` with ``{key: {"shape", "dtype", "axes"}}`` (or
        ``{"error": ...}`` for a metric that cannot run on the probe).  Takes seconds.

    Returns
    -------
    dict
        ``{"version", "plugins": {kind: {name: {"schema", "doc", "params", ...}}},
        "schemas": {"ShuffleConfig", "AnalysisSpec", "Pipeline", "Selection"}}``.  Each
        ``params[field]`` is ``{"type", "default", "required", "description", "ui":
        {"group", "sweepable", "unit"}}``.  Metric entries also carry ``level``,
        ``input``, ``default_tail``, ``requires_topology``, ``cell_separable``,
        ``default_plots`` and ``outputs``; null entries ``perturbs`` and
        ``cell_separable``.  The result passes ``json.dumps(..., allow_nan=False)``.
    """
    from . import __version__
    from ._pipeline import AnalysisSpec, Pipeline
    from ._selection import Selection
    from ._shuffle import ShuffleConfig

    def schema(cls: Any) -> dict[str, Any]:
        try:
            return cls.model_json_schema()
        except Exception as exc:  # arbitrary-typed fields cannot always be schematised
            return {"error": f"{type(exc).__name__}: {exc}"}

    session = None
    plugins: dict[str, Any] = {}
    for kind, reg in _REGISTRY.items():
        entries: dict[str, Any] = {}
        for name in sorted(reg):
            cls = reg[name]
            e: dict[str, Any] = {
                "schema": schema(cls),
                "doc": (cls.__doc__ or "").strip(),
                "params": _params(cls),
            }
            if kind == "metric":
                for attr in (
                    "level",
                    "input",
                    "default_tail",
                    "requires_topology",
                    "cell_separable",
                ):
                    e[attr] = getattr(cls, attr, None)
                e["default_plots"] = list(getattr(cls, "default_plots", ()))
                e["outputs"] = _output_axes(cls)
                if probe:
                    if session is None:
                        session = _probe_session()
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore")
                        e["outputs"]["extras"] = _probe_metric(cls, session)
            elif kind == "null":
                e["perturbs"] = getattr(cls, "perturbs", None)
                e["cell_separable"] = getattr(cls, "cell_separable", None)
            entries[name] = e
        plugins[kind] = entries
    return _strict(
        {
            "version": __version__,
            "plugins": plugins,
            "schemas": {
                "ShuffleConfig": schema(ShuffleConfig),
                "AnalysisSpec": schema(AnalysisSpec),
                "Pipeline": schema(Pipeline),
                "Selection": schema(Selection),
            },
        }
    )
