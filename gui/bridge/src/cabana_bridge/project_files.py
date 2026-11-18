"""Configuration files of one project: safe reads and writes, change log, snapshots."""

from __future__ import annotations

import difflib
import json
import re
import shutil
import time
from pathlib import Path
from typing import Any

import yaml

from . import projects
from .projects import CONFIG_NAMES, FILE_NAMES, atomic_write, now_iso
from .store import BadRequest

SNAPSHOT_EVERY_S = 30 * 60
SNAPSHOT_RE = re.compile(r"^[0-9]{8}-[0-9]{6}(-[0-9]+)?$")


def _clock() -> float:  # a function so tests can move time
    return time.time()


def check_name(name: str) -> str:
    if name not in FILE_NAMES:
        raise BadRequest(f"unknown file {name!r}; expected one of {', '.join(FILE_NAMES)}")
    return name


def parse_text(text: str) -> tuple[dict | None, dict | None]:
    """Returns (data, error). Empty text is an empty mapping; any other top level is an error."""
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        message = getattr(exc, "problem", None) or str(exc)
        return None, {"line": mark.line + 1 if mark else None, "message": message}
    if data is None:
        data = {}
    if not isinstance(data, dict):
        return None, {"line": 1, "message": f"the top level must be a mapping of settings, not a {type(data).__name__}"}
    return data, None


class ProjectFiles:
    def __init__(self, folder: Path) -> None:
        self.folder = Path(folder).resolve()
        self.history = self.folder / "history"

    # -- reading -----------------------------------------------------------------------
    def _path(self, name: str) -> Path:
        path = (self.folder / check_name(name)).resolve()
        if path.parent != self.folder:
            raise BadRequest("path outside the project")
        return path

    def read(self, name: str) -> dict[str, Any]:
        """The file as the GUI shows it. A file edited outside CaBaNA is parsed here first; on an
        error the response names the line and the engine uses the last valid copy."""
        path = self._path(name)
        text = path.read_text() if path.exists() else ""
        data, error = parse_text(text)
        if error is None and path.exists():
            self._set_last_valid(name, text)
        return {"name": name, "text": text,
                "modified": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(path.stat().st_mtime)) if path.exists() else None,
                "valid": error is None, "error": error, "in_use": "this" if error is None else "last-valid"}

    def load(self, name: str) -> dict:
        """The settings the engine uses: the file, or its last valid copy when the file is broken."""
        path = self._path(name)
        data, error = parse_text(path.read_text() if path.exists() else "")
        if error is None:
            return data or {}
        backup = self.history / "last-valid" / name
        return (parse_text(backup.read_text())[0] or {}) if backup.exists() else {}

    def _set_last_valid(self, name: str, text: str) -> None:
        backup = self.history / "last-valid" / name
        if not backup.exists() or backup.read_text() != text:
            atomic_write(backup, text)

    # -- writing -----------------------------------------------------------------------
    def write(self, name: str, data: Any = None, text: str | None = None, summary: str = "") -> dict[str, str]:
        path = self._path(name)
        if text is None:
            if not isinstance(data, dict):
                raise BadRequest("data must be an object, or send text")
            text = yaml.safe_dump(data, sort_keys=False, allow_unicode=True)
        parsed, error = parse_text(text)
        if error:
            raise BadRequest(f"Line {error['line']}: {error['message']}")
        if name == "project.yaml":
            current = yaml.safe_load(path.read_text())
            if (parsed or {}).get("id") != current.get("id"):
                raise BadRequest("project.yaml keeps its id")
        elif path.exists():
            self.snapshot_if_due("edit")
        atomic_write(path, text)
        self._set_last_valid(name, text)
        saved_at = now_iso()
        self._log(name, summary)
        if name != "project.yaml":
            projects.touch(self.folder)
        return {"saved_at": saved_at}

    def _log(self, name: str, summary: str) -> None:
        self.history.mkdir(exist_ok=True)
        with open(self.history / "changes.jsonl", "a") as f:
            f.write(json.dumps({"time": now_iso(), "file": name, "summary": summary}) + "\n")

    # -- snapshots ---------------------------------------------------------------------
    def _snapshots(self) -> list[dict[str, Any]]:
        out = []
        for d in sorted((self.history / "snapshots").glob("*")):
            meta_file = d / "snapshot.json"
            meta = json.loads(meta_file.read_text()) if meta_file.exists() else {}
            out.append({"id": d.name, "time": meta.get("time"), "reason": meta.get("reason", ""),
                        "epoch": meta.get("epoch", d.stat().st_mtime)})
        return out

    def snapshot(self, reason: str) -> str:
        """Copies the three yaml files into history/snapshots/<stamp>/."""
        stamp = time.strftime("%Y%m%d-%H%M%S", time.gmtime(_clock()))
        sid, n = stamp, 2
        while (self.history / "snapshots" / sid).exists():
            sid, n = f"{stamp}-{n}", n + 1
        target = self.history / "snapshots" / sid
        target.mkdir(parents=True)
        for name in CONFIG_NAMES:
            if (self.folder / name).exists():
                shutil.copy2(self.folder / name, target / name)
        (target / "snapshot.json").write_text(json.dumps({"time": now_iso(), "reason": reason, "epoch": _clock()}))
        return sid

    def snapshot_if_due(self, reason: str) -> str | None:
        """At most one snapshot per 30 minutes of edits; taken before the edit so Restore can undo it."""
        last = max((s["epoch"] for s in self._snapshots()), default=0)
        return self.snapshot(reason) if _clock() - last >= SNAPSHOT_EVERY_S else None

    def history_view(self) -> dict[str, Any]:
        changes = []
        log = self.history / "changes.jsonl"
        for line in log.read_text().splitlines() if log.exists() else []:
            try:
                changes.append(json.loads(line))
            except ValueError:
                continue  # a half-written last line
        snaps = [{k: s[k] for k in ("id", "time", "reason")} for s in self._snapshots()]
        return {"changes": changes, "snapshots": snaps[::-1]}

    def restore(self, snapshot_id: str) -> dict[str, Any]:
        """Settings only: the three yaml files come back, results are never touched."""
        if not SNAPSHOT_RE.match(snapshot_id):
            raise BadRequest("bad snapshot id")
        source = self.history / "snapshots" / snapshot_id
        if not source.is_dir():
            raise FileNotFoundError(snapshot_id)
        self.snapshot("before restore")
        for name in CONFIG_NAMES:
            if (source / name).exists():
                text = (source / name).read_text()
                atomic_write(self.folder / name, text)
                if parse_text(text)[1] is None:
                    self._set_last_valid(name, text)
        self._log("*", f"Restored settings from snapshot {snapshot_id}")
        projects.touch(self.folder)
        return {"restored": snapshot_id, "saved_at": now_iso()}

    # -- comparing with a run ----------------------------------------------------------
    def compare(self, name: str, run_id: str, runs_dir: Path) -> dict[str, Any]:
        """Lines that differ between the current file and the copy frozen with the run."""
        check_name(name)
        frozen = runs_dir / run_id / "config" / name
        if not frozen.exists():
            raise FileNotFoundError(f"run {run_id} has no frozen {name}")
        current = self.read(name)["text"].splitlines()
        old = frozen.read_text().splitlines()
        changes = []
        for op, a0, a1, b0, b1 in difflib.SequenceMatcher(None, old, current).get_opcodes():
            if op != "equal":
                changes.append({"op": op, "run_lines": [a0 + 1, a1], "current_lines": [b0 + 1, b1],
                                "run": old[a0:a1], "current": current[b0:b1]})
        return {"name": name, "run": run_id, "identical": not changes, "changes": changes}
