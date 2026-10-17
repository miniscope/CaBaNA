"""``Selection``: the record of how one analysis parameter value was chosen."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, field_validator

SelectionMethod = Literal[
    "literature_default",
    "fixed_apriori",
    "auto_cv",
    "auto_rule",
    "sweep_stability",
    "user_pick",
]


def _jsonable(x: Any) -> Any:
    """Coerce numpy scalars/arrays and tuples to plain Python (recursively)."""
    if isinstance(x, np.generic):
        return x.item()
    if isinstance(x, np.ndarray):
        return _jsonable(x.tolist())
    if isinstance(x, dict):
        return {str(k): _jsonable(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_jsonable(v) for v in x]
    return x


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class Selection(BaseModel):
    """How a parameter value was chosen; written by rules, sweeps and user picks alike.

    Parameters
    ----------
    path : str
        Dotted parameter path, e.g. ``"analyses.place.metric.smooth_sigma_bins"``
        (see ``Pipeline.get_param``).
    value : Any
        The chosen value (JSON-able; numpy scalars are converted).
    method : str
        ``literature_default``, ``fixed_apriori``, ``auto_cv``, ``auto_rule``,
        ``sweep_stability`` or ``user_pick``.
    criterion : str, optional
        What was optimised or inspected, e.g. ``"heldout_poisson_loglik"`` or
        ``"split_half_r"``.  Must never be a p-value or a significant-cell count.
    candidates, scores : list, optional
        Values considered and their criterion scores (aligned).
    split : str, optional
        Description or hash of the data split used for selection.
    informed_by_significance : bool, default False
        True when the chooser saw p-values or significant counts.
    note : str, optional
        Free text.
    timestamp : str
        UTC ISO time of creation.
    """

    model_config = ConfigDict(extra="forbid")

    path: str
    value: Any = None
    method: SelectionMethod
    criterion: str | None = None
    candidates: list[Any] | None = None
    scores: list[float] | None = None
    split: str | None = None
    informed_by_significance: bool = False
    note: str | None = None
    timestamp: str = Field(default_factory=_now)

    @field_validator("value", "candidates", "scores", mode="before")
    @classmethod
    def _coerce(cls, v: Any) -> Any:
        return _jsonable(v)


__all__ = ["Selection", "SelectionMethod"]
