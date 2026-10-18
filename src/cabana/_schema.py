"""JSON Schema for saved results and the other CaBaNA file formats (Phase F2).

``resultset_schema()`` is the single source of truth for
``schemas/resultset-v1.json`` (a published snapshot that a test keeps identical);
``SCHEMA_VERSION`` is the semver written as ``manifest["schema_version"]`` by
``cabana._io.save_results``.  ``schema(name)`` dispatches to the other schemas
(pydantic ``model_json_schema()`` of the config models, the ``describe()`` output).
"""

from __future__ import annotations

from typing import Any

__all__ = ["SCHEMA_VERSION", "resultset_schema", "schema"]

#: Semver of the saved-``ResultSet`` manifest contract (``manifest["schema_version"]``).
SCHEMA_VERSION = "1.0.0"

_SCHEMA_ID = "https://miniscope.github.io/CaBaNA/schemas/resultset-v1.json"

#: dtypes the on-disk contract allows (see ``cabana._io``): float64/float32, bool, int32
#: (int64 when a value exceeds int32), and narrower integer types kept as they are.
_DTYPES = ["float64", "float32", "bool", "int32", "int64", "int8", "int16", "uint8", "uint16"]
_AXES = ["cell", "state", "shuffle", "time", "bin", "group", "lag", "fold", "channel"]

_NAMES = [
    "resultset",
    "pipeline",
    "analysis_spec",
    "shuffle_config",
    "selection",
    "study",
    "tuning_export",
    "describe",
]


def _ref(name: str) -> dict[str, str]:
    return {"$ref": f"#/$defs/{name}"}


def _p(schema: dict[str, Any], description: str) -> dict[str, Any]:
    return {**schema, "description": description}


def _nullable(schema: dict[str, Any]) -> dict[str, Any]:
    return {"anyOf": [schema, {"type": "null"}]}


_NUMBER = _ref("number")


def _described_pydantic(cls: Any, descriptions: dict[str, str]) -> dict[str, Any]:
    """``cls.model_json_schema()`` with a description added to every property."""
    sch = cls.model_json_schema()
    sch.pop("title", None)
    for k, v in sch.get("properties", {}).items():
        v.pop("title", None)
        v.setdefault("description", descriptions.get(k, k.replace("_", " ")))
    return sch


def resultset_schema() -> dict[str, Any]:
    """JSON Schema (draft 2020-12) of a saved ``ResultSet``'s ``manifest.json``.

    Returns
    -------
    dict
        The schema; ``schemas/resultset-v1.json`` in the repository is its pretty-printed
        dump.  Non-finite floats are stored as ``{"__float__": "nan" | "inf" | "-inf"}``
        and the ``number`` definition admits them wherever a number may appear.
    """
    from ._results import RunError, RunWarning

    str_list = {"type": "array", "items": {"type": "string"}}
    run_error = _described_pydantic(
        RunError,
        {
            "analysis": "Name of the analysis that failed.",
            "metric": "Registry name of its metric.",
            "target": "State space or signal it was run on.",
            "error_type": "Exception class name.",
            "message": "Exception message.",
            "traceback": "Formatted traceback.",
        },
    )
    run_warning = _described_pydantic(
        RunWarning,
        {
            "analysis": "Name of the analysis that raised the warning.",
            "category": "Warning category name.",
            "message": "Warning text.",
            "count": "Times this (category, message) was raised during the analysis.",
        },
    )
    array_meta = {
        "type": "object",
        "description": "Shape, dtype and axis labels of one array in the result's npz file.",
        "properties": {
            "shape": _p({"type": "array", "items": {"type": "integer", "minimum": 0}}, "Shape."),
            "dtype": _p(
                {"anyOf": [{"enum": _DTYPES}, {"type": "string", "pattern": "^str[0-9]+$"}]},
                "numpy dtype name as saved (the dtype contract); fixed-width unicode extras "
                "(e.g. group names) are 'str<N>'.",
            ),
            "axes": _p(
                {"type": "array", "items": {"enum": [*_AXES, None]}},
                "One label per axis; null where the axis could not be named.",
            ),
        },
        "required": ["shape", "dtype", "axes"],
        "additionalProperties": False,
    }
    provenance = {
        "type": "object",
        "description": "How the result was produced (filled by Pipeline.run; empty by hand).",
        "properties": {
            "cabana_version": _p({"type": "string"}, "Library version that produced it."),
            "seed": _p(_nullable({"type": "integer"}), "Base shuffle seed."),
            "effective_seed": _p(
                _nullable({"type": "integer"}), "Per-analysis seed derived from the base seed."
            ),
            "null": _p(_nullable({"type": "string"}), "Null name used by the shuffle test."),
            "n_shuffles": _p(_nullable({"type": "integer"}), "Number of shuffles."),
            "alpha": _p(_nullable(_NUMBER), "Significance level."),
            "tail": _p(_nullable({"enum": ["upper", "lower", "two"]}), "Tail of the test."),
            "n_jobs": _p(_nullable({"type": "integer"}), "Worker count actually used."),
            "masks": _p(str_list, "Names of the masks listed in the analysis spec."),
            "mask_info": _p({"type": "object"}, "Per-mask metadata."),
            "preprocess": _p({"type": "array"}, "Preprocess steps applied (to_dict)."),
            "transforms": _p({"type": "array"}, "Transforms applied (to_dict)."),
            "support_used": _p({"type": "boolean"}, "Whether a support mask restricted frames."),
            "n_frames_used": _p({"type": "integer"}, "Frames that passed the mask."),
            "fs": _p(_NUMBER, "Sampling rate in Hz."),
            "activity_kind": _p({"type": "string"}, "Kind of the activity matrix."),
            "n_cells": _p({"type": "integer"}, "Number of cells."),
            "target_kind": _p({"enum": ["states", "signal"]}, "Kind of the target."),
            "target_params": _p(
                _nullable({"type": "object"}), "Parameters of the transform producing the target."
            ),
            "selections": _p({"type": "array"}, "Auto-selected parameter values applied."),
            "timestamp": _p({"type": "string"}, "ISO 8601 UTC time of the run."),
        },
        "additionalProperties": True,
    }
    shuffle = {
        "type": "object",
        "description": "Settings of the shuffle test; its arrays are the sh_* npz keys.",
        "properties": {
            "alpha": _p(_NUMBER, "Significance level."),
            "tail": _p({"enum": ["upper", "lower", "two"]}, "Tail defining 'extreme'."),
            "n_shuffles": _p({"type": "integer", "minimum": 0}, "Surrogates drawn."),
            "null_name": _p({"type": "string"}, "Registry name of the null."),
            "correction": _p(
                {"enum": ["none", "bh", "bonferroni", "max_stat"]}, "Multiplicity correction."
            ),
            "correction_scope": _p(
                {"enum": ["states", "cells", "all"]}, "Family the correction ran over."
            ),
            "correction_note": _p({"type": "string"}, "Non-empty when the correction was a no-op."),
            "null_info": _p({"type": "object"}, "Null.diagnostics() output."),
        },
        "required": ["alpha", "tail", "n_shuffles", "null_name"],
        "additionalProperties": False,
    }
    entry = {
        "type": "object",
        "description": "One MetricResult and the npz file that holds its arrays.",
        "properties": {
            "file": _p({"type": "string"}, "Path of the npz file inside the container."),
            "metric": _p({"type": "string"}, "Registry name of the metric."),
            "name": _p(_nullable({"type": "string"}), "Unique analysis name."),
            "target": _p({"type": "string"}, "State space or signal analysed."),
            "target_kind": _p({"enum": ["states", "signal"]}, "Kind of the target."),
            "level": _p({"enum": ["cell", "population"]}, "Whether axis 0 of values is cells."),
            "params": _p({"type": "object"}, "metric.to_dict() for provenance."),
            "provenance": provenance,
            "state_names": _p(_nullable(str_list), "Labels of the state axis."),
            "cell_ids": _p(_nullable(str_list), "Row labels of cell-level results."),
            "extras": _p(
                {"type": "object", "additionalProperties": {"type": "string"}},
                "Maps the npz key extra_<j> to the metric's extra name.",
            ),
            "arrays": _p(
                {"type": "object", "additionalProperties": _ref("array_meta")},
                "Per npz key (values, extra_<j>, sh_*): shape, dtype and axis labels.",
            ),
            "shuffle": _p(_nullable(_ref("shuffle")), "Shuffle test settings; null if not run."),
        },
        "required": ["file", "metric", "target"],
        "additionalProperties": True,
    }
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": _SCHEMA_ID,
        "title": "cabana.ResultSet manifest",
        "description": "manifest.json of a ResultSet saved by cabana.ResultSet.save().",
        "type": "object",
        "properties": {
            "format": _p({"type": "integer", "minimum": 1}, "Container format number."),
            "schema_version": _p(
                {"const": SCHEMA_VERSION}, "Semver of this manifest schema (absent in old files)."
            ),
            "kind": _p({"const": "cabana.ResultSet"}, "File kind."),
            "status": _p({"enum": ["ok", "cancelled", "partial"]}, "How the run ended."),
            "completed": _p(str_list, "Names of the analyses that completed."),
            "errors": _p({"type": "array", "items": run_error}, "Analyses that failed."),
            "warnings": _p({"type": "array", "items": run_warning}, "Warnings raised."),
            "results": _p({"type": "array", "items": _ref("entry")}, "One entry per result."),
        },
        "required": ["format", "schema_version", "kind", "results"],
        "additionalProperties": True,
        "$defs": {
            "number": {
                "description": "A JSON number, or the sentinel for a non-finite float.",
                "oneOf": [
                    {"type": "number"},
                    {
                        "type": "object",
                        "properties": {
                            "__float__": _p({"enum": ["nan", "inf", "-inf"]}, "Which float.")
                        },
                        "required": ["__float__"],
                        "additionalProperties": False,
                    },
                ],
            },
            "array_meta": array_meta,
            "shuffle": shuffle,
            "entry": entry,
        },
    }


def _model_schema(cls: Any) -> dict[str, Any]:
    try:
        return cls.model_json_schema()
    except Exception as exc:  # arbitrary-typed fields cannot always be schematised
        out: dict[str, Any] = {
            "type": "object",
            "x-error": f"{type(exc).__name__}: {exc}",
            "properties": {
                k: {"description": f.description or k, "title": k}
                for k, f in getattr(cls, "model_fields", {}).items()
            },
        }
        return out


def schema(name: str) -> dict[str, Any]:
    """Schema by name.

    Parameters
    ----------
    name : str
        ``resultset``, ``pipeline``, ``analysis_spec``, ``shuffle_config``, ``selection``,
        ``study``, ``tuning_export`` or ``describe`` (the capability listing).

    Returns
    -------
    dict
        A JSON-serialisable schema (``describe`` returns the ``describe()`` output).

    Raises
    ------
    KeyError
        For an unknown name, or ``study`` / ``tuning_export`` when that module is not
        available in this installation.
    """
    if name == "resultset":
        return resultset_schema()
    if name == "describe":
        from ._describe import describe

        return describe()
    if name in ("pipeline", "analysis_spec"):
        from ._pipeline import AnalysisSpec, Pipeline

        return _model_schema(Pipeline if name == "pipeline" else AnalysisSpec)
    if name == "shuffle_config":
        from ._shuffle import ShuffleConfig

        return _model_schema(ShuffleConfig)
    if name == "selection":
        from ._selection import Selection

        return _model_schema(Selection)
    if name in ("study", "tuning_export"):
        try:
            if name == "study":
                from ._study import StudySpec as cls
            else:
                from ._tuning import TuningExport as cls
        except ImportError as exc:
            raise KeyError(f"schema {name!r} is unavailable in this installation: {exc}") from exc
        return _model_schema(cls)
    raise KeyError(f"unknown schema {name!r}; valid names: {', '.join(_NAMES)}")
