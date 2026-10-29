"""Project workspace on disk: inputs (by SHA-256), sessions, runs, project.json."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import threading
from pathlib import Path
from typing import Any, BinaryIO

import yaml

ID_RE = re.compile(r"^[0-9a-zA-Z_-]{8,64}$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")

# Config sections only newer frameworks understand (capability flag -> config path).
GATED_KEYS = {
    "session_metadata": ("metadata",),
    "session_markers": ("behavior", "markers"),
    "frame_labels": ("behavior", "frame_labels"),
}


class BadRequest(ValueError):
    pass


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)


def check_id(value: str) -> str:
    if not ID_RE.match(value):
        raise BadRequest(f"bad id {value!r}")
    return value


def _set_path(config: dict, dotted: str, value: str) -> None:
    """Set the entry named by `dotted`. Keys may contain dots (an epoch called "tone.1"), so the
    longest matching key wins at each level."""
    node: Any = config
    segments = dotted.split(".")
    i = 0
    while i < len(segments):
        for j in range(len(segments), i, -1):
            key = ".".join(segments[i:j])
            if isinstance(node, dict) and key in node:
                if j == len(segments):
                    node[key] = value
                    return
                node, i = node[key], j
                break
        else:
            raise BadRequest(f"config has no {dotted!r}")
    raise BadRequest(f"config has no {dotted!r}")


def _pop_path(config: dict, path: tuple[str, ...]) -> Any:
    node = config
    for part in path[:-1]:
        node = node.get(part)
        if not isinstance(node, dict):
            return None
    return node.pop(path[-1], None)


class Project:
    def __init__(self, root: Path) -> None:
        self.root = Path(root).resolve()
        for sub in ("inputs", "sessions", "runs"):
            (self.root / sub).mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    # -- paths -------------------------------------------------------------------------
    def inside(self, path: Path) -> Path:
        """Reject anything that resolves outside the project directory."""
        resolved = path.resolve()
        if self.root != resolved and self.root not in resolved.parents:
            raise BadRequest("path outside the project")
        return resolved

    @property
    def inputs_dir(self) -> Path:
        return self.root / "inputs"

    def session_dir(self, session_id: str) -> Path:
        return self.inside(self.root / "sessions" / check_id(session_id))

    def run_dir(self, run_id: str) -> Path:
        return self.inside(self.root / "runs" / check_id(run_id))

    # -- inputs ------------------------------------------------------------------------
    def input_file(self, sha: str) -> Path | None:
        if not SHA_RE.match(sha):
            raise BadRequest("bad sha256")
        hits = [p for p in self.inputs_dir.glob(f"{sha}*") if not p.name.endswith(".meta.json")]
        return hits[0] if hits else None

    def put_input(self, sha: str, stream: BinaryIO, length: int, name: str) -> bool:
        """Store the bytes if the hash matches. Returns True when newly stored."""
        if not SHA_RE.match(sha):
            raise BadRequest("bad sha256")
        if self.input_file(sha) is not None:
            return False
        ext = "".join(Path(name).suffixes[-1:]) if name else ""
        if not re.fullmatch(r"(\.[A-Za-z0-9]{1,8})?", ext):
            ext = ""
        tmp = self.inputs_dir / f".{sha}.part"
        digest = hashlib.sha256()
        remaining = length
        with open(tmp, "wb") as out:
            while remaining > 0:
                chunk = stream.read(min(1 << 20, remaining))
                if not chunk:
                    break
                digest.update(chunk)
                out.write(chunk)
                remaining -= len(chunk)
        if remaining or digest.hexdigest() != sha:
            tmp.unlink(missing_ok=True)
            raise BadRequest("hash mismatch or short body")
        os.replace(tmp, self.inputs_dir / f"{sha}{ext}")
        (self.inputs_dir / f"{sha}.meta.json").write_text(json.dumps({"name": Path(name).name, "bytes": length}))
        return True

    def input_meta(self, sha: str) -> dict[str, Any]:
        meta = self.inputs_dir / f"{sha}.meta.json"
        return json.loads(meta.read_text()) if meta.exists() else {}

    # -- sessions ----------------------------------------------------------------------
    def register_session(self, config: dict, files: dict[str, Any], caps: dict[str, bool]) -> tuple[str, dict]:
        """Write the session folder; returns (session_id, info).

        `files` maps a dotted config path (e.g. `neural.file`) to a sha256. The execution
        copy points at `../../inputs/<sha><ext>` and leaves out sections the installed
        framework rejects (reported as `withheld`); the full config is kept beside it.
        """
        if not isinstance(config, dict):
            raise BadRequest("config must be an object")
        sha_for: dict[str, str] = {}
        full = json.loads(json.dumps(config))
        for key, sha in files.items():
            sha = sha["sha256"] if isinstance(sha, dict) else sha
            if self.input_file(sha) is None:
                raise BadRequest(f"input {sha[:12]} for {key} was not uploaded")
            sha_for[key] = sha
        session_id = hashlib.sha256(canonical_json({"config": full, "files": sha_for}).encode()).hexdigest()[:24]
        folder = self.session_dir(session_id)
        execution = json.loads(json.dumps(full))
        for key, sha in sha_for.items():
            stored = self.input_file(sha)
            _set_path(execution, key, os.path.relpath(stored, folder))
        withheld = [
            ".".join(path)
            for flag, path in GATED_KEYS.items()
            if not caps.get(flag) and _pop_path(execution, path) is not None
        ]
        with self._lock:
            folder.mkdir(parents=True, exist_ok=True)
            (folder / "config.yaml").write_text(yaml.safe_dump(execution, sort_keys=False))
            (folder / "config.full.json").write_text(json.dumps(full, indent=2))
            (folder / "inputs.json").write_text(json.dumps(sha_for, indent=2))
            (folder / "info.json").write_text(json.dumps({"withheld": withheld}))
        return session_id, {"withheld": withheld, "inputs": sha_for}

    def session_withheld(self, session_id: str) -> list[str]:
        return json.loads((self.session_dir(session_id) / "info.json").read_text())["withheld"]

    def session_inputs(self, session_id: str) -> dict[str, str]:
        return json.loads((self.session_dir(session_id) / "inputs.json").read_text())

    # -- runs --------------------------------------------------------------------------
    def read_run(self, run_id: str) -> dict[str, Any]:
        path = self.run_dir(run_id) / "run.json"
        if not path.exists():
            raise FileNotFoundError(run_id)
        return json.loads(path.read_text())

    def write_run(self, run_id: str, record: dict[str, Any]) -> None:
        folder = self.run_dir(run_id)
        folder.mkdir(parents=True, exist_ok=True)
        tmp = folder / "run.json.tmp"
        tmp.write_text(json.dumps(record, indent=2, default=str))
        os.replace(tmp, folder / "run.json")

    def list_runs(self, session_id: str | None = None) -> list[dict[str, Any]]:
        records = []
        for path in sorted((self.root / "runs").glob("*/run.json")):
            try:
                rec = json.loads(path.read_text())
            except ValueError:
                continue
            if session_id is None or rec.get("session", {}).get("session_id") == session_id:
                records.append(rec)
        records.sort(key=lambda r: r.get("created_utc", ""), reverse=True)
        return records

    def delete_run(self, run_id: str) -> None:
        shutil.rmtree(self.run_dir(run_id), ignore_errors=True)

    def read_project(self) -> dict[str, Any]:
        path = self.root / "project.json"
        return json.loads(path.read_text()) if path.exists() else {}

    def write_project(self, data: dict[str, Any]) -> None:
        tmp = self.root / "project.json.tmp"
        tmp.write_text(json.dumps(data, indent=2))
        os.replace(tmp, self.root / "project.json")
