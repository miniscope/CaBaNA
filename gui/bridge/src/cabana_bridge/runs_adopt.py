"""Runs made with no project open live in the workspace's runs/. Saving a project moves them into
the project, with the session each one used, so they list there like runs made in it."""

from __future__ import annotations

import os
import shutil
from pathlib import Path
from typing import Any

import yaml

from .store import BadRequest, Project, _set_path, check_id

ACTIVE = {"queued", "running"}


def _copy_session(source: Project, target: Project, session_id: str) -> None:
    """Gives the project its own copy of the session; input paths are re-pointed from the new folder."""
    folder = target.session_dir(session_id)
    if folder.exists():
        return
    shutil.copytree(source.session_dir(session_id), folder)
    config = yaml.safe_load((folder / "config.yaml").read_text())
    for key, sha in source.session_inputs(session_id).items():
        stored = target.input_file(sha) or source.input_file(sha)
        if stored is not None:
            _set_path(config, key, os.path.relpath(stored, folder))
    (folder / "config.yaml").write_text(yaml.safe_dump(config, sort_keys=False))


def adopt_runs(source: Project, project_folder: Path, run_ids: list[str]) -> dict[str, Any]:
    target = Project(project_folder, in_project=True)
    adopted, skipped = [], []
    for run_id in run_ids:
        try:
            record = source.read_run(check_id(run_id))
        except BadRequest:
            skipped.append({"run_id": run_id, "reason": "bad id"})
            continue
        except FileNotFoundError:
            skipped.append({"run_id": run_id, "reason": "not found"})
            continue
        if record.get("status") in ACTIVE:
            skipped.append({"run_id": run_id, "reason": "still running"})
        elif target.run_dir(run_id).exists():
            skipped.append({"run_id": run_id, "reason": "already in the project"})
        else:
            session_id = record.get("session", {}).get("session_id")
            try:
                if session_id and source.session_dir(session_id).is_dir():
                    _copy_session(source, target, session_id)
            except BadRequest:
                pass  # browser-engine records name no session folder ("browser")
            shutil.move(str(source.run_dir(run_id)), str(target.run_dir(run_id)))
            script = target.run_dir(run_id) / "reproduce.sh"  # a project keeps sessions under processed/
            if script.exists():
                script.write_text(script.read_text().replace(source.sessions_path_from_run, target.sessions_path_from_run))
            adopted.append(record)
    return {"adopted": adopted, "skipped": skipped}
