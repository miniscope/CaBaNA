"""``cabana.describe()``: what the library can do, as JSON, for a front end.

Lists every registered plugin with its pydantic JSON schema and docstring, plus
the schemas of the top-level config models.  Phase F2 extends each entry with
output metadata (the arrays a metric produces, their axes and dtypes) and ``ui``
hints per parameter (``group``, ``sweepable``, ``unit``) so a form and a sweep
slider can be generated from the description alone.
"""

from __future__ import annotations

from typing import Any

from ._registry import _REGISTRY

__all__ = ["describe"]


def describe(**kw: Any) -> dict[str, Any]:
    """JSON-serialisable capability description for a front end.

    Returns
    -------
    dict
        ``{"version", "plugins": {kind: {name: {"schema", ...}}}, "schemas":
        {"ShuffleConfig", "AnalysisSpec", "Pipeline", "Selection"}}``.  Metric entries also
        carry ``level``, ``input``, ``default_tail`` and ``requires_topology``.
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
