"""Portable projects: `<name>.cabana.zip` (export) and unpacking one into the projects root (import)."""

from __future__ import annotations

import tempfile
import uuid
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

import yaml

from .project_data import ProjectData
from .projects import ID_RE, Projects, atomic_write, unique_name
from .store import BadRequest

ALWAYS = ("project.yaml", "experiment.yaml", "processing.yaml", "analysis.yaml")


def export_zip(folder: Path, include: dict[str, Any]) -> Path:
    """Writes the zip to a temporary file and returns it. Configuration and history are always in;
    `results` adds run folders, `figures` adds each run's figures, `data` adds the referenced files."""
    meta = Projects._read_meta(folder) or {}
    include = include or {}
    tmp = Path(tempfile.mkstemp(suffix=".cabana.zip")[1])
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for name in ALWAYS[1:]:
            if (folder / name).exists():
                z.write(folder / name, name)
        for path in sorted((folder / "history").rglob("*")):
            if path.is_file():
                z.write(path, path.relative_to(folder).as_posix())
        for path in sorted((folder / "runs").rglob("*")):
            if not path.is_file():
                continue
            in_figures = "figures" in path.relative_to(folder / "runs").parts
            if include.get("results") and (include.get("figures") or not in_figures) \
                    or include.get("figures") and in_figures:
                z.write(path, path.relative_to(folder).as_posix())
        data = []
        for entry in meta.get("data") or []:
            entry = dict(entry)
            source = ProjectData(folder).find(entry["sha256"])
            if include.get("data") and source:
                entry["copied"] = f"data/{entry['slot']}-{source.name}"
                z.write(source, entry["copied"])
            data.append(entry)
        z.writestr("project.yaml", yaml.safe_dump({**meta, "data": data}, sort_keys=False))
    return tmp


def import_zip(zip_path: str, root: Path, existing_ids: set[str]) -> Path:
    path = Path(zip_path).expanduser()
    if not zipfile.is_zipfile(path):
        raise BadRequest(f"{path} is not a CaBaNA project zip")
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        for n in names:  # no absolute paths or ..
            parts = PurePosixPath(n).parts
            if PurePosixPath(n).is_absolute() or ".." in parts:
                raise BadRequest("the zip contains unsafe paths")
        if "project.yaml" not in names:
            raise BadRequest("the zip has no project.yaml")
        meta = yaml.safe_load(z.read("project.yaml"))
        if not isinstance(meta, dict):
            raise BadRequest("project.yaml is not valid")
        folder = root / unique_name(root, path.name.removesuffix(".zip").removesuffix(".cabana") or "Imported project")
        root.mkdir(parents=True, exist_ok=True)
        z.extractall(folder)
    for sub in ("runs", "processed", "history/snapshots", "history/last-valid"):
        (folder / sub).mkdir(parents=True, exist_ok=True)
    if meta.get("id") in existing_ids or not ID_RE.match(str(meta.get("id", ""))):  # an import never replaces the project it came from
        meta["id"] = uuid.uuid4().hex[:12]
    meta["name"] = folder.name
    atomic_write(folder / "project.yaml", yaml.safe_dump(meta, sort_keys=False))
    return folder
