"""Native file dialogs (macOS, through osascript) and folder scanning."""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from .projects import NotSupported
from .store import BadRequest


def _quote(text: str) -> str:
    return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _script(kind: str, title: str | None, default_name: str | None) -> str:
    prompt = f" with prompt {_quote(title)}" if title else ""
    if kind == "folder":
        return f"POSIX path of (choose folder{prompt})"
    if kind == "files":
        return ("set picked to choose file with multiple selections allowed" + prompt
                + '\nset out to ""\nrepeat with f in picked\nset out to out & POSIX path of f & linefeed\nend repeat\nout')
    if kind == "save":
        name = f" default name {_quote(default_name)}" if default_name else ""
        return f"POSIX path of (choose file name{prompt}{name})"
    raise BadRequest("kind must be folder, files or save")


def run_osascript(script: str) -> subprocess.CompletedProcess:  # separate so tests can replace it
    return subprocess.run(["osascript", "-e", script], capture_output=True, text=True)


def choose(kind: str, title: str | None = None, default_name: str | None = None) -> dict[str, Any]:
    if sys.platform != "darwin":
        raise NotSupported("The file dialog needs macOS")
    result = run_osascript(_script(kind, title, default_name))
    if result.returncode != 0:
        if "-128" in result.stderr:  # the user pressed Cancel
            return {"cancelled": True}
        raise RuntimeError(result.stderr.strip() or "osascript failed")
    paths = [line for line in result.stdout.splitlines() if line.strip()]
    return {"paths": paths} if paths else {"cancelled": True}


def _describe(path: Path) -> dict[str, Any]:
    st = path.stat()
    return {"name": path.name, "path": str(path), "size": st.st_size,
            "modified": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(st.st_mtime))}


def scan(paths: list[str]) -> dict[str, Any]:
    """Files of each folder (its own files plus one level of subfolders); a file path is listed itself."""
    files = []
    for raw in paths:
        path = Path(raw).expanduser()
        if not path.exists():
            raise FileNotFoundError(raw)
        if path.is_file():
            files.append(_describe(path))
            continue
        for entry in sorted(path.iterdir()):
            if entry.name.startswith("."):
                continue
            if entry.is_file():
                files.append(_describe(entry))
            elif entry.is_dir():
                files += [_describe(f) for f in sorted(entry.iterdir()) if f.is_file() and not f.name.startswith(".")]
    return {"files": files}
