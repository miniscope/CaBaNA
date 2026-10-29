"""Runs the GUI's pipelines on a real-size recording through the bridge and logs time and memory.

    uv run --project gui/bridge python gui/bridge/scripts/verify_scale.py [shuffles]

Uses example_data/hipp CA2 social behavior (148 cells, 17,872 frames). The TypeScript spec
snapshots are the pipelines; only the names tied to the dataset (bout table, arena extent) change.
"""

from __future__ import annotations

import copy
import json
import resource
import sys
import tempfile
import time
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tests"))
from cabana_bridge.server import App  # noqa: E402
from cabana_bridge.store import Project  # noqa: E402

REPO = HERE.parents[2]
SPECS = REPO / "gui/apps/cabana/src/__tests__/fixtures/specs"
DATA = REPO / "example_data" / "hipp CA2 social behavior"
ARENA = (77.0, 38.0)


def load_spec(name: str) -> dict:
    return json.loads((SPECS / f"{name}.json").read_text())["pipeline"]


def retarget(pipeline: dict, shuffles: int) -> dict:
    p = copy.deepcopy(pipeline)
    for t in p.get("transforms", []):
        if t.get("source") == "social_epochs":
            t["source"] = "investigation_epochs"
            t.pop("behaviors", None)  # every investigation label
        if t.get("name") == "bin_grid":
            t["extent"] = [[0, ARENA[0]], [0, ARENA[1]]]
    for a in p["analyses"]:
        if a.get("shuffle"):
            a["shuffle"]["n_shuffles"] = shuffles
    return p


def main() -> None:
    shuffles = int(sys.argv[1]) if len(sys.argv) > 1 else 1000
    project = Project(Path(tempfile.mkdtemp(prefix="cabana-scale-")))
    app = App(project, "x")
    cfg = yaml.safe_load((DATA / "session.yaml").read_text())
    cfg["neural"].pop("alternatives", None)
    files = {}
    import hashlib
    import io

    def upload(rel: str) -> str:
        data = (DATA / rel).read_bytes()
        sha = hashlib.sha256(data).hexdigest()
        project.put_input(sha, io.BytesIO(data), len(data), rel)
        return sha

    def walk(node, trail):
        if isinstance(node, dict):
            for k, v in node.items():
                if k in ("file", "timestamps") and isinstance(v, str):
                    files[".".join(trail + [k])] = upload(v)
                else:
                    walk(v, trail + [k])

    walk(cfg, [])
    session_id, info = project.register_session(cfg, files, app.capabilities.flags)
    session = app.sessions.get(session_id)
    print(f"session: {session.n_cells} cells, {session.n_time} frames, kind {session.activity_kind}")

    jobs = {
        "population": retarget(load_spec("population-behaviors"), shuffles),
        "place_cells": retarget(load_spec("place-cells"), shuffles),
        "auroc_circular": retarget(load_spec("auroc-circular"), shuffles),
    }
    # the auROC snapshot names its own behavior list; use every investigation label
    for t in jobs["auroc_circular"]["transforms"]:
        if t.get("name") == "bouts_to_states":
            t["source"] = "investigation_epochs"
            t.pop("behaviors", None)
    results = {}
    for name, pipeline in jobs.items():
        run_id = app.runner.submit({"session_id": session_id, "analysis": name, "pipeline": pipeline, "scope": "full"})
        t0 = time.time()
        while True:
            rec = project.read_run(run_id)
            if rec["status"] in {"ok", "partial", "cancelled", "failed"}:
                break
            time.sleep(1)
        rss_mb = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / 1024**2  # bytes on macOS
        results[name] = {
            "status": rec["status"],
            "seconds": round(time.time() - t0, 1),
            "peak_rss_mb_so_far": round(rss_mb),
            "results": rec.get("result_names"),
            "errors": [e.get("message", "")[-300:] for e in rec["errors"]],
            "null_not_kept": rec.get("null_not_kept"),
        }
        print(name, json.dumps(results[name]), flush=True)
    print(json.dumps({"shuffles": shuffles, "session": session_id, "results": results}))


if __name__ == "__main__":
    main()
