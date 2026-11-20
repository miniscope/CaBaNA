"""Data files of a project are referenced by path (not copied); project.yaml keeps path, size,
mtime and SHA-256 for each slot, so a moved file can be found again by hash."""

from __future__ import annotations

import hashlib
import shutil
from pathlib import Path
from typing import Any

from .projects import Conflict, Projects, valid_slot
from .store import BadRequest


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


class ProjectData:
    def __init__(self, folder: Path) -> None:
        self.folder = Path(folder).resolve()

    def entries(self) -> list[dict[str, Any]]:
        meta = Projects._read_meta(self.folder) or {}
        return list(meta.get("data") or [])

    def _save(self, entries: list[dict[str, Any]]) -> None:
        Projects.update_meta(self.folder, {"data": entries})

    def labels(self) -> dict[str, str]:
        """The user's names of "other" data types, by slot."""
        meta = Projects._read_meta(self.folder) or {}
        return dict(meta.get("data_labels") or {})

    def _save_label(self, slot: str, label: str | None) -> None:
        labels = self.labels()
        if label:
            labels[slot] = label
        else:
            labels.pop(slot, None)
        Projects.update_meta(self.folder, {"data_labels": labels})

    def add(self, slot: str, path: str, label: str | None = None) -> dict[str, Any]:
        if not valid_slot(slot):
            raise BadRequest(f"unknown slot {slot!r}")
        source = Path(path).expanduser()
        if not source.is_file():
            raise FileNotFoundError(path)
        st = source.stat()
        entry: dict[str, Any] = {"slot": slot, "path": str(source.resolve()), "size": st.st_size,
                                 "mtime": st.st_mtime, "sha256": sha256_file(source)}
        meta = Projects._read_meta(self.folder) or {}
        if meta.get("copy_data"):  # archiving option: keep a copy inside the project
            target = self.folder / "data" / f"{slot}-{source.name}"
            target.parent.mkdir(exist_ok=True)
            shutil.copy2(source, target)
            entry["copied"] = f"data/{target.name}"
        self._save([e for e in self.entries() if e.get("slot") != slot] + [entry])
        if slot.startswith("other_"):
            if label is not None and not isinstance(label, str):
                raise BadRequest("label must be text")
            self._save_label(slot, (label or "").strip() or None)
        return entry

    def add_copy(self, slot: str, source: Path, sha: str, name: str) -> dict[str, Any]:
        """Stores a copy of an uploaded input as the slot's file (the project then owns its data)."""
        if not valid_slot(slot):
            raise BadRequest(f"unknown slot {slot!r}")
        if not name or name != Path(name).name or name.startswith(".") or "\\" in name or "\0" in name:
            raise BadRequest(f"bad file name {name!r}")
        if sha256_file(source) != sha:
            raise Conflict("the stored input does not match its hash")
        target = self.folder / "data" / f"{slot}-{name}"
        target.parent.mkdir(exist_ok=True)
        shutil.copy2(source, target)
        st = target.stat()
        entry = {"slot": slot, "path": str(target), "size": st.st_size, "mtime": st.st_mtime,
                 "sha256": sha, "copied": f"data/{target.name}"}
        self._save([e for e in self.entries() if e.get("slot") != slot] + [entry])
        return entry

    def remove(self, slot: str) -> None:
        entries = self.entries()
        if not any(e.get("slot") == slot for e in entries):
            raise FileNotFoundError(slot)
        self._save([e for e in entries if e.get("slot") != slot])
        if slot in self.labels():
            self._save_label(slot, None)

    def find(self, sha: str) -> Path | None:
        """Where the registered file with this hash can be read now (the original, else the project's copy)."""
        for entry in self.entries():
            if entry.get("sha256") != sha:
                continue
            for candidate in (Path(entry.get("path", "")), self.folder / entry.get("copied", "\0")):
                if candidate.is_file():
                    return candidate
        return None

    def _search(self, entry: dict[str, Any]) -> Path | None:
        """Looks for the file by hash in the project folder, the original folder and their parents."""
        original = Path(entry["path"])
        folders = [self.folder, self.folder / "data", original.parent, original.parent.parent]
        for folder in dict.fromkeys(folders):
            if not folder.is_dir():
                continue
            for candidate in sorted(folder.iterdir()):
                if candidate.is_file() and candidate.stat().st_size == entry.get("size") \
                        and sha256_file(candidate) == entry["sha256"]:
                    return candidate
        return None

    def status(self) -> list[dict[str, Any]]:
        """Each file as `present`, `changed` (same place, different content), `moved` (found again by
        hash; the new path is recorded, reported once) or `missing` (with the last seen path)."""
        entries, changed = self.entries(), False
        out = []
        for entry in entries:
            path = Path(entry["path"])
            state, last_seen = "missing", entry["path"]
            if path.is_file():
                st = path.stat()
                same = st.st_size == entry.get("size") and abs(st.st_mtime - entry.get("mtime", 0)) < 1e-3
                state = "present" if same or sha256_file(path) == entry["sha256"] else "changed"
            elif (found := self._search(entry)) is not None:
                entry.update(path=str(found.resolve()), mtime=found.stat().st_mtime)
                state, changed = "moved", True
            out.append({**entry, "name": Path(entry["path"]).name, "status": state,
                        "last_seen_path": last_seen if state in ("missing", "moved") else None})
        if changed:
            self._save(entries)
        return out
