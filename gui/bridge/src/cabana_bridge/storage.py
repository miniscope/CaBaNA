"""Sizes, deleting regenerable or large files, and the retention policy of one project.

Large files of a run are `out/` (results, arrays) and `figures/`. A run whose large files are
deleted keeps run.json, its settings, frozen configuration and summary table (`summary.json`),
and is marked `outputs_deleted`.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from . import serialize
from .project_data import ProjectData
from .projects import Projects, atomic_write, folder_size
from .store import BadRequest, Project

LARGE_DIRS = ("out", "figures", "reproduced")
DONE = {"ok", "partial"}
KEEP_COUNT = {"latest3": 3, "current": 1}
DELETABLE = {"processed": "Processed intermediates", "previews": "Preview runs",
             "figures": "Figures", "old_runs": "Older runs' large files"}


def _large_bytes(run_dir: Path) -> int:
    return sum(folder_size(run_dir / d) for d in LARGE_DIRS if (run_dir / d).is_dir())


def delete_outputs(project: Project, run_id: str) -> int:
    """Deletes a run's large files, keeping the record and a copy of its summary table. Returns bytes freed."""
    rec = project.read_run(run_id)
    if rec.get("status") in {"queued", "running"}:
        raise BadRequest("cancel the run before deleting its outputs")
    folder = project.run_dir(run_id)
    freed = _large_bytes(folder)
    if rec.get("results_file") and (folder / rec["results_file"]).exists():
        try:  # the summary table outlives the results file
            atomic_write(folder / "summary.json", json.dumps(serialize.summary_rows(folder / rec["results_file"])))
        except Exception:
            pass
    for name in LARGE_DIRS:
        shutil.rmtree(folder / name, ignore_errors=True)
    rec["outputs_deleted"] = True
    project.write_run(run_id, rec)
    return freed


def _runs(project: Project) -> list[dict[str, Any]]:
    return project.list_runs()  # newest first


def _newest_per_analysis(runs: list[dict[str, Any]]) -> set[str]:
    seen, newest = set(), set()
    for rec in runs:
        key = rec.get("analysis")
        if rec.get("scope") != "preview" and rec.get("status") in DONE and key not in seen:
            seen.add(key)
            newest.add(rec["run_id"])
    return newest


def _has_outputs(project: Project, rec: dict[str, Any]) -> bool:
    return not rec.get("outputs_deleted") and _large_bytes(project.run_dir(rec["run_id"])) > 0


def report(project: Project, folder: Path) -> dict[str, Any]:
    runs = _runs(project)
    newest = _newest_per_analysis(runs)
    rows, sizes = [], {k: 0 for k in ("previews", "figures", "old_runs", "current_runs")}
    for rec in runs:
        run_dir = project.run_dir(rec["run_id"])
        large = _large_bytes(run_dir)
        record = folder_size(run_dir) - large
        rows.append({"run_id": rec["run_id"], "analysis": rec.get("analysis"), "scope": rec.get("scope"),
                     "status": rec.get("status"), "created": rec.get("created_utc"), "record_bytes": record,
                     "large_bytes": large, "outputs_deleted": bool(rec.get("outputs_deleted"))})
        figures = folder_size(run_dir / "figures")
        sizes["figures"] += figures
        rest = large - figures
        key = "previews" if rec.get("scope") == "preview" else "current_runs" if rec["run_id"] in newest else "old_runs"
        sizes[key] += rest
    data = sum(e.get("size", 0) for e in ProjectData(folder).entries())
    keep = {"project.yaml", "experiment.yaml", "processing.yaml", "analysis.yaml", "history"}
    config = sum(folder_size(folder / n) if (folder / n).is_dir() else (folder / n).stat().st_size
                 for n in keep if (folder / n).exists())
    cats = [("config", "Configuration and history", config, False),
            ("processed", DELETABLE["processed"], folder_size(folder / "processed"), True),
            ("previews", DELETABLE["previews"], sizes["previews"], True),
            ("figures", DELETABLE["figures"], sizes["figures"], True),
            ("old_runs", DELETABLE["old_runs"], sizes["old_runs"], True),
            ("current_runs", "Latest run of each analysis", sizes["current_runs"], False),
            ("data", "Original data (referenced, not in the project)", data, False)]
    return {"categories": [{"id": i, "label": l, "bytes": b, "deletable": d} for i, l, b, d in cats],
            "runs": rows, "total_bytes": folder_size(folder)}


def delete_category(project: Project, folder: Path, category: str) -> int:
    """Returns bytes freed. Refused for categories that cannot be deleted."""
    if category not in DELETABLE:
        raise BadRequest(f"{category!r} cannot be deleted here; choose one of {', '.join(DELETABLE)}")
    runs = _runs(project)
    if any(r.get("status") in {"queued", "running"} for r in runs):
        raise BadRequest("a run is in progress")
    freed = 0
    if category == "processed":
        processed = folder / "processed"
        for entry in list(processed.iterdir()) if processed.is_dir() else []:
            if entry == project.state_file:  # GUI state is not regenerable
                continue
            freed += folder_size(entry) if entry.is_dir() else entry.stat().st_size
            shutil.rmtree(entry) if entry.is_dir() else entry.unlink()
        project.inputs_dir.mkdir(parents=True, exist_ok=True)
        project.sessions_dir.mkdir(parents=True, exist_ok=True)
        return freed
    newest = _newest_per_analysis(runs)
    for rec in runs:
        if not _has_outputs(project, rec):
            continue
        preview = rec.get("scope") == "preview"
        if category == "figures":
            fig = project.run_dir(rec["run_id"]) / "figures"
            freed += folder_size(fig)
            shutil.rmtree(fig, ignore_errors=True)
        elif (category == "previews" and preview) or (category == "old_runs" and not preview
                                                       and rec["run_id"] not in newest):
            freed += delete_outputs(project, rec["run_id"])
    return freed


def apply_retention(project: Project, folder: Path, analysis: str) -> None:
    """After a completed run: keep every run, the newest 3, or only the newest, per analysis."""
    keep = KEEP_COUNT.get((Projects._read_meta(folder) or {}).get("retention", "every"))
    if not keep:
        return
    done = [r for r in _runs(project) if r.get("analysis") == analysis and r.get("scope") != "preview"
            and r.get("status") in DONE]
    for rec in done[keep:]:
        if _has_outputs(project, rec):
            delete_outputs(project, rec["run_id"])
