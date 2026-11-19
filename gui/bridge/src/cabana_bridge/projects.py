"""CaBaNA projects: folders under a projects root, each with project.yaml as its entry file.

Layout of one project folder:
  project.yaml, experiment.yaml, processing.yaml, analysis.yaml
  history/   changes.jsonl, snapshots/<stamp>/, last-valid/   (see project_files.py)
  runs/<run id>/   records and results
  processed/       regenerable (inputs and sessions cache); safe to delete
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import yaml

from .store import BadRequest

FORMAT_VERSION = 1
DEFAULT_ROOT = Path.home() / "CaBaNA Projects"
CONFIG_NAMES = ("experiment.yaml", "processing.yaml", "analysis.yaml")
FILE_NAMES = ("project.yaml", *CONFIG_NAMES)
SAVE_MODES = ("auto", "manual")
RETENTIONS = ("every", "latest3", "current")
PROJECT_ID = r"([0-9a-f]{12})"
ID_RE = re.compile(rf"^{PROJECT_ID}$")


class Conflict(Exception):
    """A name or state clash (HTTP 409)."""


class NotSupported(Exception):
    """The feature needs macOS (HTTP 501)."""


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def atomic_write(path: Path, text: str) -> None:
    """Write through a temp file and rename, so a crash never leaves half a file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(text)
    os.replace(tmp, path)


def safe_folder_name(name: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|\x00-\x1f]', " ", name or "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    return cleaned or "Untitled project"


def unique_name(parent: Path, name: str) -> str:
    """`name`, or `name 2`, `name 3`... when the folder already exists."""
    base, n, candidate = safe_folder_name(name), 2, safe_folder_name(name)
    while (parent / candidate).exists():
        candidate, n = f"{base} {n}", n + 1
    return candidate


def touch(folder: Path) -> None:
    """Sets `modified` in project.yaml (the library sorts by it)."""
    meta = Projects._read_meta(folder)
    if meta:
        meta["modified"] = now_iso()
        atomic_write(folder / "project.yaml", yaml.safe_dump(meta, sort_keys=False))


# Slot ids are the GUI's (`SlotId` in gui/apps/cabana/src/lib/slots.ts).
SLOT_KINDS = {
    "neural_timestamps": "neural", "neural_deconvolved": "neural", "neural_denoised": "neural",
    "neural_raw": "neural", "footprints": "neural",
    "behavior_timestamps": "behavior", "position": "position", "head_orientation": "position",
    "zone_annotations": "behavior", "behavior_annotations": "behavior", "time_markers": "behavior",
    "frame_labels": "behavior", "config": None,
}


def data_kind(slot: str) -> str | None:
    return SLOT_KINDS.get(slot)


def folder_size(path: Path) -> int:
    total = 0
    for root, _, files in os.walk(path):
        for name in files:
            try:
                total += (Path(root) / name).stat().st_size
            except OSError:
                pass
    return total


def new_project_yaml(name: str) -> dict[str, Any]:
    now = now_iso()
    return {"format": FORMAT_VERSION, "id": uuid.uuid4().hex[:12], "name": name, "created": now, "modified": now,
            "save_mode": "auto", "retention": "every", "copy_data": False, "data": []}


def summarize(folder: Path, meta: dict[str, Any]) -> dict[str, Any]:
    data = meta.get("data") or []
    kinds = sorted({k for d in data if (k := data_kind(str(d.get("slot", ""))))})
    return {
        "id": meta["id"], "name": meta.get("name", folder.name), "path": str(folder),
        "created": meta.get("created"), "modified": meta.get("modified"),
        "kinds": kinds, "file_count": len(data),
        "size_bytes": folder_size(folder),
        # A file counts as missing only when neither the original nor the project's copy is there.
        "missing_count": sum(1 for d in data if not Path(str(d.get("path", ""))).exists()
                             and not (d.get("copied") and (folder / d["copied"]).exists())),
        "readable": True,
        "save_mode": meta.get("save_mode", "auto"), "retention": meta.get("retention", "every"),
        "copy_data": bool(meta.get("copy_data", False)),
    }


class Projects:
    """The projects root plus the ones opened from elsewhere (remembered in recent.json)."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = Path(root or DEFAULT_ROOT).expanduser()
        self._lock = threading.RLock()

    # -- lookup ------------------------------------------------------------------------
    @property
    def _recent_file(self) -> Path:
        return self.root / "recent.json"

    def _recent(self) -> list[dict]:
        try:
            items = json.loads(self._recent_file.read_text())
        except (OSError, ValueError):
            return []
        return [i for i in items if isinstance(i, dict) and "path" in i and "id" in i]

    def _remember(self, meta: dict, folder: Path) -> None:
        if folder.parent == self.root.resolve() or folder.parent == self.root:
            return
        items = [i for i in self._recent() if i["id"] != meta["id"]]
        items.append({"id": meta["id"], "path": str(folder), "name": meta.get("name", folder.name)})
        atomic_write(self._recent_file, json.dumps(items, indent=2))

    def _forget(self, project_id: str) -> None:
        if self._recent_file.exists():
            atomic_write(self._recent_file, json.dumps([i for i in self._recent() if i["id"] != project_id], indent=2))

    def list(self) -> list[dict[str, Any]]:
        found: dict[str, dict] = {}
        for entry in sorted(self.root.iterdir()) if self.root.is_dir() else []:
            meta = self._read_meta(entry)
            if meta:
                found[meta["id"]] = summarize(entry, meta)
        for item in self._recent():
            if item["id"] in found:
                continue
            meta = self._read_meta(Path(item["path"]))
            if meta:
                found[meta["id"]] = summarize(Path(item["path"]), meta)
            else:  # drive unplugged or folder moved: keep it listed, marked unreadable
                found[item["id"]] = {"id": item["id"], "name": item.get("name", ""), "path": item["path"],
                                     "created": None, "modified": None, "kinds": [], "file_count": 0,
                                     "size_bytes": 0, "missing_count": 0, "readable": False,
                                     "save_mode": "auto", "retention": "every", "copy_data": False}
        return sorted(found.values(), key=lambda p: p.get("modified") or "", reverse=True)

    @staticmethod
    def _read_meta(folder: Path) -> dict | None:
        try:
            meta = yaml.safe_load((folder / "project.yaml").read_text())
        except (OSError, yaml.YAMLError):
            return None
        return meta if isinstance(meta, dict) and ID_RE.match(str(meta.get("id", ""))) else None

    def folder_of(self, project_id: str) -> Path:
        if not ID_RE.match(project_id):
            raise BadRequest(f"bad project id {project_id!r}")
        for item in self.list():
            if item["id"] == project_id and item["readable"]:
                return Path(item["path"])
        raise FileNotFoundError(f"project {project_id}")

    def info(self, project_id: str) -> dict[str, Any]:
        folder = self.folder_of(project_id)
        return summarize(folder, self._read_meta(folder) or {})

    def read_meta(self, project_id: str) -> dict[str, Any]:
        meta = self._read_meta(self.folder_of(project_id))
        if meta is None:
            raise FileNotFoundError(f"project {project_id}")
        return meta

    # -- lifecycle ---------------------------------------------------------------------
    def create(self, name: str, parent: str | None = None) -> dict[str, Any]:
        base = Path(parent).expanduser() if parent else self.root
        if not name or not str(name).strip():
            raise BadRequest("a project needs a name")
        with self._lock:
            base.mkdir(parents=True, exist_ok=True)
            folder_name = unique_name(base, name)
            folder = base / folder_name
            meta = new_project_yaml(folder_name)  # the name is the folder name, so it stays unique
            self._init_folder(folder, meta)
            self._remember(meta, folder.resolve())
        return summarize(folder, meta)

    @staticmethod
    def _init_folder(folder: Path, meta: dict) -> None:
        folder.mkdir(parents=True)
        for sub in ("history/snapshots", "history/last-valid", "runs", "processed"):
            (folder / sub).mkdir(parents=True)
        for name in CONFIG_NAMES:
            atomic_write(folder / name, "{}\n")
        atomic_write(folder / "history" / "changes.jsonl", "")
        atomic_write(folder / "project.yaml", yaml.safe_dump(meta, sort_keys=False))

    def resolve_open(self, project_id: str | None, path: str | None) -> Path:
        if project_id:
            return self.folder_of(project_id)
        if not path:
            raise BadRequest("id or path is required")
        folder = Path(path).expanduser()
        if folder.name == "project.yaml" or folder.is_file():
            folder = folder.parent
        if self._read_meta(folder) is None:
            raise BadRequest(f"{folder} is not a CaBaNA project (no readable project.yaml)")
        return folder.resolve()

    def describe(self, folder: Path) -> dict[str, Any]:
        return summarize(folder, self._read_meta(folder) or {})

    def remember_opened(self, folder: Path) -> dict[str, Any]:
        with self._lock:
            self._remember(self._read_meta(folder) or {}, folder)
        return self.describe(folder)

    def rename(self, project_id: str, name: str) -> dict[str, Any]:
        if not name or not str(name).strip():
            raise BadRequest("a project needs a name")
        with self._lock:
            old = self.folder_of(project_id)
            target = old.parent / safe_folder_name(name)
            if target != old and target.exists():
                raise Conflict(f"A folder named {target.name!r} already exists in {old.parent}")
            if target != old:
                old.rename(target)
            self.update_meta(target, {"name": target.name})
            self._forget(project_id)
            self._remember(self._read_meta(target) or {}, target.resolve())
        return summarize(target, self._read_meta(target) or {})

    def duplicate(self, project_id: str, name: str | None = None) -> dict[str, Any]:
        """Copies configuration and history; runs and processed data stay behind, data references are kept."""
        with self._lock:
            src = self.folder_of(project_id)
            old = self._read_meta(src) or {}
            folder_name = unique_name(src.parent, name or f"{old.get('name', src.name)} copy")
            folder = src.parent / folder_name
            meta = {**old, **new_project_yaml(folder_name)}  # new id, name and dates; settings and data references kept
            self._init_folder(folder, meta)
            for name_ in CONFIG_NAMES:
                if (src / name_).exists():
                    shutil.copy2(src / name_, folder / name_)
            if (src / "history" / "changes.jsonl").exists():
                shutil.copy2(src / "history" / "changes.jsonl", folder / "history" / "changes.jsonl")
            for sub in ("snapshots", "last-valid"):
                if (src / "history" / sub).is_dir():
                    shutil.copytree(src / "history" / sub, folder / "history" / sub, dirs_exist_ok=True)
            self._remember(meta, folder.resolve())
        return summarize(folder, meta)

    def delete(self, project_id: str) -> str:
        """Moves the folder to the macOS Trash. Original data lives outside the folder and is untouched."""
        with self._lock:
            folder = self.folder_of(project_id)
            trash = Path.home() / ".Trash"
            trash.mkdir(parents=True, exist_ok=True)
            target = trash / unique_name(trash, folder.name)
            shutil.move(str(folder), str(target))
            self._forget(project_id)
        return str(target)

    def reveal(self, project_id: str) -> None:
        if sys.platform != "darwin":
            raise NotSupported("Showing a folder in Finder needs macOS")
        subprocess.run(["open", "-R", str(self.folder_of(project_id))], check=True)

    # -- project.yaml ------------------------------------------------------------------
    @staticmethod
    def update_meta(folder: Path, changes: dict[str, Any]) -> dict[str, Any]:
        meta = Projects._read_meta(folder)
        if meta is None:
            raise FileNotFoundError(f"{folder}/project.yaml")
        meta.update(changes)
        meta["modified"] = now_iso()
        if meta.get("save_mode") not in SAVE_MODES:
            raise BadRequest(f"save_mode must be one of {SAVE_MODES}")
        if meta.get("retention") not in RETENTIONS:
            raise BadRequest(f"retention must be one of {RETENTIONS}")
        atomic_write(folder / "project.yaml", yaml.safe_dump(meta, sort_keys=False))
        return meta
