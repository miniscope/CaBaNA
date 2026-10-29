"""Runs framework analyses as `cabana run` subprocesses, one at a time (plan D-1, D-7)."""

from __future__ import annotations

import datetime as dt
import json
import queue
import signal
import subprocess
import threading
import time
import uuid
import zipfile
from pathlib import Path
from typing import Any

from . import capabilities as caps_mod
from . import pipeline_prep as prep
from .store import BadRequest, Project

EXIT_STATUS = {0: "ok", 3: "cancelled", 4: "partial"}
TERMINAL = {"ok", "partial", "cancelled", "failed"}
RECORD_VERSION = 1


def now_utc() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class Refused(Exception):
    """The run cannot start; `payload` goes back to the GUI (HTTP 409)."""

    def __init__(self, message: str, payload: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.payload = {"error": message, **(payload or {})}


class Runner:
    def __init__(self, project: Project, capabilities: caps_mod.Capabilities, sessions: prep.SessionCache) -> None:
        self.project, self.capabilities, self.sessions = project, capabilities, sessions
        self._queue: queue.Queue[str] = queue.Queue()
        self._procs: dict[str, subprocess.Popen] = {}
        self._cancel: set[str] = set()
        self._lock = threading.Lock()
        self._recover()
        threading.Thread(target=self._loop, daemon=True).start()

    def _recover(self) -> None:
        """Runs left queued or running by a previous bridge are marked failed."""
        for rec in self.project.list_runs():
            if rec.get("engine") == "framework" and rec["status"] in {"queued", "running"}:
                rec.update(status="failed", finished_utc=now_utc())
                rec.setdefault("errors", []).append({"message": "bridge stopped while this run was active"})
                self.project.write_run(rec["run_id"], rec)

    # -- submit ------------------------------------------------------------------------
    def submit(self, body: dict[str, Any]) -> str:
        session_id = body.get("session_id")
        if not session_id or "pipeline" not in body:
            raise BadRequest("session_id and pipeline are required")
        missing = prep.missing_capabilities(body.get("requires"), self.capabilities.flags)
        if missing:
            raise Refused("The installed framework lacks required features.", {"missing_capabilities": missing})
        session = self.sessions.get(session_id)
        pipeline_dict, notes = prep.prepare(session, body["pipeline"], body.get("rejected_cells"))
        reasons = prep.guard_bayesian(session, pipeline_dict)
        if reasons:
            raise Refused(" ".join(reasons), {"reasons": reasons})
        try:
            pipeline = prep.to_pipeline(pipeline_dict)
        except Exception as exc:
            raise Refused(f"The pipeline is not valid: {exc}") from exc
        null_not_kept = prep.keep_null_none_if_large(pipeline, session)

        run_id = f"{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
        folder = self.project.run_dir(run_id)
        folder.mkdir(parents=True)
        prep.write_yaml(pipeline, folder / "pipeline.yaml")
        reproduce = folder / "reproduce.sh"
        reproduce.write_text(
            "#!/bin/sh\n# Re-runs this analysis with the CLI; compare reproduced/ with out/.\n"
            'cd "$(dirname "$0")" || exit 1\n'
            f"cabana run pipeline.yaml --session ../../sessions/{session_id} --out reproduced --on-error record\n"
        )
        reproduce.chmod(0o755)
        gui = dict(body.get("gui_meta") or {})
        gui.update(settings=body.get("gui_settings", {}), settings_sha256=body.get("settings_sha256"),
                   rejected_cells=body.get("rejected_cells", []))
        full_config = json.loads((self.project.session_dir(session_id) / "config.full.json").read_text())
        withheld = self.project.session_withheld(session_id)
        inputs = [
            {"key": key, "sha256": sha, **self.project.input_meta(sha)}
            for key, sha in self.project.session_inputs(session_id).items()
        ]
        record = {
            "record_version": RECORD_VERSION,
            "run_id": run_id,
            "group_id": body.get("group_id"),
            "analysis": body.get("analysis", "custom"),
            "engine": "framework",
            "status": "queued",
            "scope": body.get("scope", "full"),
            "created_utc": now_utc(),
            "finished_utc": None,
            "session": {
                "session_id": session_id,
                "name": full_config.get("name"),
                "inputs": inputs,
                "metadata_withheld": "metadata" in withheld,
                "withheld": withheld,
            },
            "gui": gui,
            "framework": {**self.capabilities.info, "capabilities": dict(self.capabilities.flags)},
            "pipeline_file": "pipeline.yaml",
            "results_file": None,
            "seeds": {"base": _first_seed(pipeline_dict)},
            "rejected_cell_ids": notes["rejected_cell_ids"],
            "null_not_kept": null_not_kept,
            "errors": [],
            "warnings": [],
        }
        self.project.write_run(run_id, record)
        self._queue.put(run_id)
        return run_id

    # -- worker ------------------------------------------------------------------------
    def _loop(self) -> None:
        while True:
            run_id = self._queue.get()
            try:
                self._execute(run_id)
            except Exception as exc:  # a bug here must not kill the worker
                rec = self.project.read_run(run_id)
                rec.update(status="failed", finished_utc=now_utc())
                rec["errors"].append({"message": f"bridge error: {exc}"})
                self.project.write_run(run_id, rec)

    def _execute(self, run_id: str) -> None:
        rec = self.project.read_run(run_id)
        if run_id in self._cancel:
            rec.update(status="cancelled", finished_utc=now_utc())
            self.project.write_run(run_id, rec)
            return
        folder = self.project.run_dir(run_id)
        rec.update(status="running", started_utc=now_utc())
        self.project.write_run(run_id, rec)
        progress = folder / "progress.jsonl"
        progress.write_text("")
        cmd = [
            *caps_mod.cli_command(), "run", str(folder / "pipeline.yaml"),
            "--session", str(self.project.session_dir(rec["session"]["session_id"])),
            "--out", str(folder / "out"), "--progress-file", str(progress), "--on-error", "record",
        ]
        with open(folder / "stderr.txt", "wb") as err:
            proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=err, start_new_session=True, cwd=folder)
            with self._lock:
                self._procs[run_id] = proc
            if run_id in self._cancel:  # cancel arrived between 'running' and the process starting
                proc.send_signal(signal.SIGINT)
            code = proc.wait()
        with self._lock:
            self._procs.pop(run_id, None)
        self._finish(run_id, code)

    def _finish(self, run_id: str, code: int) -> None:
        folder = self.project.run_dir(run_id)
        rec = self.project.read_run(run_id)
        rec.update(finished_utc=now_utc(), exit_code=code, status=EXIT_STATUS.get(code, "failed"))
        if rec["status"] == "failed" and (run_id in self._cancel or rec.get("cancel_requested_at")):
            rec["status"] = "cancelled"  # stopped before the CLI could install its own handler
        zips = sorted((folder / "out").glob("*.results.zip"))
        if zips:
            rec["results_file"] = f"out/{zips[0].name}"
        events = self.events(run_id, 0)[0]
        rec["warnings"] = [{"message": e["message"], "category": e.get("category")}
                           for e in events if e.get("event") == "warning"]
        for e in events:
            if e.get("event") == "error":
                rec["errors"].append({"message": e.get("message"), "type": e.get("type"),
                                      "traceback": e.get("traceback")})
        if rec["results_file"]:
            try:
                with zipfile.ZipFile(folder / rec["results_file"]) as z:
                    manifest = json.loads(z.read("manifest.json"))
                for err in manifest.get("errors", []):
                    rec["errors"].append(err if isinstance(err, dict) else {"message": str(err)})
                if manifest.get("status") == "partial" and rec["status"] == "ok":
                    rec["status"] = "partial"
                rec["result_names"] = [r["name"] for r in manifest.get("results", [])]
            except Exception as exc:
                rec["errors"].append({"message": f"could not read results: {exc}"})
        if rec["status"] == "failed" and not rec["errors"]:
            tail = (folder / "stderr.txt").read_text(errors="replace")[-2000:]
            rec["errors"].append({"message": tail or f"cabana exited with code {code}"})
        self.project.write_run(run_id, rec)

    # -- control -----------------------------------------------------------------------
    def cancel(self, run_id: str) -> None:
        """First call: SIGINT (graceful). A repeat after 10 s: SIGTERM."""
        rec = self.project.read_run(run_id)
        if rec["status"] in TERMINAL:
            return
        with self._lock:
            proc = self._procs.get(run_id)
        if proc is None:
            self._cancel.add(run_id)
            return
        if rec.get("cancel_requested_at") and time.time() - rec["cancel_requested_at"] > 10:
            proc.send_signal(signal.SIGTERM)
            return
        rec["cancel_requested_at"] = time.time()
        self.project.write_run(run_id, rec)
        proc.send_signal(signal.SIGINT)

    def events(self, run_id: str, after: int) -> tuple[list[dict], int]:
        path = self.project.run_dir(run_id) / "progress.jsonl"
        if not path.exists():
            return [], after
        out = []
        for line in path.read_text(errors="replace").splitlines()[after:]:
            try:
                out.append(json.loads(line))
            except ValueError:
                break  # a half-written last line; read it next poll
        return out, after + len(out)


def _first_seed(pipeline: dict) -> int | None:
    for spec in pipeline.get("analyses", []):
        shuffle = spec.get("shuffle")
        if shuffle and "seed" in shuffle:
            return shuffle["seed"]
    return None
