"""JSON Schema for saved results and the other CaBaNA file formats (Phase F2).

``resultset_schema()`` is the single source of truth for
``schemas/resultset-v1.json`` (a published snapshot that a test keeps identical);
``SCHEMA_VERSION`` is the semver written as ``manifest["schema_version"]`` by
``cabana._io.save_results``.
"""

from __future__ import annotations

from typing import Any

__all__ = ["SCHEMA_VERSION", "resultset_schema", "schema"]

#: Semver of the saved-``ResultSet`` manifest contract (``manifest["schema_version"]``).
SCHEMA_VERSION = "1.0.0"


def resultset_schema() -> dict[str, Any]:
    """JSON Schema (draft 2020-12) of a saved ``ResultSet``'s ``manifest.json``."""
    raise NotImplementedError("Phase F2: see docs/ROADMAP.md")


def schema(name: str) -> dict[str, Any]:
    """Schema by name: ``resultset``, ``pipeline``, ``analysis_spec``, ``shuffle_config``,
    ``selection``, ``study``, ``tuning_export`` or ``describe`` (the capability listing)."""
    raise NotImplementedError("Phase F2: see docs/ROADMAP.md")
