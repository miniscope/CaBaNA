"""Turning a GUI pipeline object into a framework `Pipeline`, plus the checks that need a session."""

from __future__ import annotations

import copy
from collections import OrderedDict
from pathlib import Path
from typing import Any

# Preprocess steps that change the values a decoder would see (plan D-20).
ACTIVITY_CHANGING = {
    "smooth_activity",
    "zscore_activity",
    "binarize_activity",
    "compute_dff",
    "detrend",
    "bandpass_activity",
    "clip_activity",
}
TWO_GB = 2 * 1024**3


class SessionCache:
    """Loaded sessions, newest two kept (a session can be several hundred MB)."""

    def __init__(self, project: Any, size: int = 2) -> None:
        self.project, self.size = project, size
        self._items: OrderedDict[str, Any] = OrderedDict()

    def get(self, session_id: str) -> Any:
        if session_id in self._items:
            self._items.move_to_end(session_id)
            return self._items[session_id]
        from cabana.loaders import load_session_dir

        folder = self.project.session_dir(session_id)
        if not (folder / "config.yaml").exists():
            raise FileNotFoundError(f"unknown session {session_id}")
        session = load_session_dir(folder / "config.yaml")
        self._items[session_id] = session
        while len(self._items) > self.size:
            self._items.popitem(last=False)
        return session


def prepare(session: Any, pipeline: dict, rejected_cells: list[int] | None = None) -> tuple[dict, dict[str, Any]]:
    """Returns (pipeline dict to run, notes). Rejected cells become a `select_cells` step by id."""
    out = copy.deepcopy(pipeline)
    notes: dict[str, Any] = {"rejected_cell_ids": []}
    rejected = sorted(set(rejected_cells or []))
    if rejected:
        ids = [str(session.cell_ids[i]) for i in rejected if 0 <= i < len(session.cell_ids)]
        notes["rejected_cell_ids"] = ids
        steps = out.setdefault("preprocess", [])
        if ids and not any(s.get("name") == "select_cells" for s in steps):
            steps.insert(0, {"name": "select_cells", "exclude_ids": ids})
    return out, notes


def to_pipeline(pipeline: dict) -> Any:
    from cabana import Pipeline

    return Pipeline.from_dict(pipeline)


def guard_bayesian(session: Any, pipeline: dict) -> list[str]:
    """Reasons a Bayesian decoder must not run on this input (empty = fine)."""
    analyses = [a for a in pipeline.get("analyses", []) if (a.get("metric") or {}).get("name") == "bayesian_decoder"]
    if not analyses:
        return []
    reasons = []
    kind = getattr(session, "activity_kind", None)
    if kind != "deconvolved":
        reasons.append(f"The Bayesian decoder needs deconvolved events; the neural data is '{kind}'.")
    changing = [s.get("name") for s in pipeline.get("preprocess", []) if s.get("name") in ACTIVITY_CHANGING]
    if changing:
        reasons.append("Steps before the decoder change the events: " + ", ".join(changing) + ".")
    return reasons


def missing_capabilities(required: list[str] | None, flags: dict[str, bool]) -> list[str]:
    return [name for name in (required or []) if not flags.get(name)]


def keep_null_none_if_large(pipeline: Any, session: Any) -> bool:
    """Drop stored null draws when the estimate is above 2 GB; p-values are unchanged."""
    from cabana import memory_estimate

    try:
        peak = memory_estimate(pipeline, session).peak_bytes
    except Exception:
        return False
    if peak <= TWO_GB:
        return False
    changed = False
    for spec in pipeline.analyses:
        shuffle = getattr(spec, "shuffle", None)
        if shuffle is not None and shuffle.keep_null != "none":
            shuffle.keep_null = "none"
            changed = True
    return changed


def validation_report(session: Any, pipeline: Any) -> dict[str, Any]:
    from cabana import memory_estimate, validate_pipeline

    report = validate_pipeline(pipeline, session)
    out = report.to_dict()
    try:
        out["memory"] = memory_estimate(pipeline, session).to_dict()
    except Exception as exc:  # estimate failure must not hide the validation result
        out["memory"] = {"error": str(exc)}
    return out


def write_yaml(pipeline: Any, path: Path) -> None:
    pipeline.to_yaml(path)
