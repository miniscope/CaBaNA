"""Runs inside a project: frozen configuration, merged exclude_frames, storage, retention, export."""

import json
import zipfile
from pathlib import Path

import pytest
import yaml

from cabana_bridge.project_files import merge_exclude_frames
from test_bridge import POP, post_run
from test_projects import create, pb  # noqa: F401  (fixture)


def write_run(project, run_id, analysis="population", status="ok", scope="full", created="2026-01-01T00:00:00Z",
              large=100):
    folder = project.run_dir(run_id)
    (folder / "out").mkdir(parents=True)
    (folder / "out" / "x.results.zip").write_bytes(b"0" * large)
    project.write_run(run_id, {"run_id": run_id, "analysis": analysis, "status": status, "scope": scope,
                               "created_utc": created, "engine": "framework", "results_file": "out/x.results.zip"})


# -- exclude_frames merge ------------------------------------------------------------------
def test_merged_config_equals_todays_config(project):
    sent = {"name": "s", "neural": {"file": "n"}, "behavior": {"position": {"file": "p", "exclude_frames": [[3, 9]]}}}
    without = json.loads(json.dumps(sent))
    del without["behavior"]["position"]["exclude_frames"]
    merged = merge_exclude_frames(without, {"position": {"exclude_frames": [[3, 9]]}})
    assert merged == sent and without["behavior"]["position"].get("exclude_frames") is None  # input untouched
    sha = "%064x" % 1
    (project.inputs_dir / f"{sha}.npy").write_bytes(b"x")
    ids = [project.register_session(cfg, {"neural.file": sha, "behavior.position.file": sha}, {})[0]
           for cfg in (merged, sent)]
    assert ids[0] == ids[1]  # same session, so the framework sees today's config


def test_gui_sent_value_wins_and_no_position_is_left_alone():
    cfg = {"behavior": {"position": {"exclude_frames": [[1, 2]]}}}
    assert merge_exclude_frames(cfg, {"position": {"exclude_frames": [[5, 6]]}}) == cfg
    assert merge_exclude_frames({"neural": {}}, {"position": {"exclude_frames": [[5, 6]]}}) == {"neural": {}}
    assert merge_exclude_frames(cfg, {}) == cfg


# -- a run in a project --------------------------------------------------------------------
def test_run_freezes_config_snapshots_and_merges(pb):
    c, app, tmp = pb
    info = create(c)
    pid, folder = info["id"], Path(info["path"])
    c.json("PUT", f"/projects/{pid}/files/analysis.yaml", {"data": {"population": {"k": 1}}, "summary": "k"})
    c.json("POST", "/projects/open", {"id": pid})
    sid = c.register_example("simulated_social_interaction")
    assert (folder / "processed" / "sessions" / sid / "config.yaml").exists()
    run_id = post_run(c, sid, POP)
    rec = c.wait(run_id)
    assert rec["status"] in {"ok", "partial"}
    frozen = folder / "runs" / run_id / "config"
    assert yaml.safe_load((frozen / "analysis.yaml").read_text()) == {"population": {"k": 1}}
    snaps = c.json("GET", f"/projects/{pid}/history")[1]["snapshots"]
    assert any(s["reason"] == "before run" for s in snaps)
    # edit after the run, then compare with the frozen copy
    c.json("PUT", f"/projects/{pid}/files/analysis.yaml", {"data": {"population": {"k": 2}}, "summary": "k2"})
    diff = c.json("GET", f"/projects/{pid}/files/analysis.yaml/compare?run={run_id}")[1]
    assert not diff["identical"]
    assert "../../processed/sessions/" in (folder / "runs" / run_id / "reproduce.sh").read_text()


def test_sessions_merge_processing_exclude_frames(pb):
    c, app, tmp = pb
    info = create(c)
    pid = info["id"]
    c.json("PUT", f"/projects/{pid}/files/processing.yaml",
           {"data": {"position": {"exclude_frames": [[10, 20]]}}, "summary": "jump"})
    c.json("POST", "/projects/open", {"id": pid})
    import hashlib
    sha = hashlib.sha256(b"abc").hexdigest()
    c.call("PUT", f"/inputs/{sha}?name=p.csv", raw=b"abc")
    config = {"behavior": {"position": {"file": "p.csv"}}}
    status, out = c.json("POST", "/sessions", {"config": config, "files": {"behavior.position.file": sha}})
    assert status == 200
    saved = json.loads((app.project.session_dir(out["session_id"]) / "config.full.json").read_text())
    assert saved["behavior"]["position"]["exclude_frames"] == [[10, 20]]


# -- storage and retention ----------------------------------------------------------------
def test_storage_report_and_delete_categories(pb):
    c, app, tmp = pb
    info = create(c)
    pid, folder = info["id"], Path(info["path"])
    c.json("POST", "/projects/open", {"id": pid})
    p = app.project
    write_run(p, "20260101-000001-aaaaaa", created="2026-01-01T00:00:01Z", large=300)
    write_run(p, "20260101-000002-bbbbbb", created="2026-01-01T00:00:02Z", large=200)
    write_run(p, "20260101-000003-cccccc", scope="preview", created="2026-01-01T00:00:03Z", large=50)
    (p.inputs_dir / "junk.bin").write_bytes(b"0" * 40)
    out = c.json("GET", f"/projects/{pid}/storage")[1]
    by = {x["id"]: x for x in out["categories"]}
    assert (by["old_runs"]["bytes"], by["current_runs"]["bytes"], by["previews"]["bytes"]) == (300, 200, 50)
    assert by["processed"]["bytes"] >= 40 and not by["config"]["deletable"] and not by["data"]["deletable"]
    assert {r["run_id"]: r["large_bytes"] for r in out["runs"]}["20260101-000001-aaaaaa"] == 300
    assert c.json("POST", f"/projects/{pid}/storage/delete", {"category": "config"})[0] == 400
    assert c.json("POST", f"/projects/{pid}/storage/delete", {"category": "previews"})[1]["freed_bytes"] == 50
    assert c.json("POST", f"/projects/{pid}/storage/delete", {"category": "old_runs"})[1]["freed_bytes"] == 300
    assert (p.run_dir("20260101-000002-bbbbbb") / "out").exists()  # the latest run keeps its files
    old = p.read_run("20260101-000001-aaaaaa")
    assert old["outputs_deleted"] and old["status"] == "ok"  # record stays
    assert c.json("POST", f"/projects/{pid}/storage/delete", {"category": "processed"})[0] == 200
    assert not (p.inputs_dir / "junk.bin").exists() and p.inputs_dir.is_dir()


def test_delete_outputs_keeps_record_and_summary(pb):
    c, app, _ = pb
    info = create(c)
    c.json("POST", "/projects/open", {"id": info["id"]})
    p = app.project
    rid = "20260101-000001-aaaaaa"
    write_run(p, rid)
    status, out = c.json("POST", f"/runs/{rid}/delete-outputs")
    assert status == 200 and out["freed_bytes"] == 100
    assert not (p.run_dir(rid) / "out").exists() and p.read_run(rid)["outputs_deleted"] is True
    assert c.call("GET", f"/runs/{rid}/manifest")[0] == 404  # results are gone, with a clear message
    p.write_run(rid, {**p.read_run(rid), "status": "running"})
    assert c.json("POST", f"/runs/{rid}/delete-outputs")[0] == 400


@pytest.mark.parametrize("retention, kept", [("every", 4), ("latest3", 3), ("current", 1)])
def test_retention_applies_per_analysis(pb, retention, kept):
    c, app, _ = pb
    info = create(c)
    meta_path = Path(info["path"]) / "project.yaml"
    meta = yaml.safe_load(meta_path.read_text())
    meta["retention"] = retention
    meta_path.write_text(yaml.safe_dump(meta))
    c.json("POST", "/projects/open", {"id": info["id"]})
    p = app.project
    for i in range(4):
        write_run(p, f"20260101-00000{i}-aaaaaa", analysis="population", created=f"2026-01-01T00:00:0{i}Z")
    write_run(p, "20260101-000009-zzzzzz", analysis="auroc", created="2026-01-01T00:00:09Z")
    from cabana_bridge import storage
    storage.apply_retention(p, p.root, "population")
    with_outputs = [r for r in p.list_runs() if r["analysis"] == "population" and not r.get("outputs_deleted")]
    assert len(with_outputs) == kept
    assert not p.read_run("20260101-000009-zzzzzz").get("outputs_deleted")  # other analysis untouched
    assert len(p.list_runs()) == 5  # records are never removed


# -- export and import --------------------------------------------------------------------
def test_export_options_and_import(pb):
    c, app, tmp = pb
    info = create(c)
    pid, folder = info["id"], Path(info["path"])
    data = tmp / "neural.npy"
    data.write_bytes(b"neural")
    c.json("PUT", f"/projects/{pid}/files/experiment.yaml", {"data": {"fs": 30}, "summary": "fs"})
    c.json("POST", f"/projects/{pid}/data", {"slot": "neural_deconvolved", "path": str(data)})
    c.json("POST", "/projects/open", {"id": pid})
    write_run(app.project, "20260101-000001-aaaaaa")
    (app.project.run_dir("20260101-000001-aaaaaa") / "figures").mkdir()
    (app.project.run_dir("20260101-000001-aaaaaa") / "figures" / "f.svg").write_text("<svg/>")

    def names(include):
        status, body = c.call("POST", f"/projects/{pid}/export", {"include": include})
        assert status == 200
        out = tmp / "e.zip"
        out.write_bytes(body)
        return set(zipfile.ZipFile(out).namelist()), out

    base, _ = names({})
    assert {"project.yaml", "experiment.yaml", "history/changes.jsonl"} <= base
    assert not any(n.startswith("runs/") for n in base)
    with_results, _ = names({"results": True})
    assert "runs/20260101-000001-aaaaaa/out/x.results.zip" in with_results
    assert "runs/20260101-000001-aaaaaa/figures/f.svg" not in with_results
    figs, _ = names({"figures": True})
    assert "runs/20260101-000001-aaaaaa/figures/f.svg" in figs and "runs/20260101-000001-aaaaaa/run.json" not in figs
    with_data, zpath = names({"data": True})
    assert "data/neural_deconvolved-neural.npy" in with_data
    # import: unique name, new id because the source project still exists
    c.json("POST", "/projects/close")
    status, imported = c.json("POST", "/projects/import", {"path": str(zpath)})
    assert status == 201 and imported["id"] != pid and imported["file_count"] == 1
    new = Path(imported["path"])
    assert yaml.safe_load((new / "experiment.yaml").read_text()) == {"fs": 30}
    c.json("POST", "/projects/open", {"id": imported["id"]})
    data.unlink()  # the original is gone; the bundled copy serves it
    import hashlib
    assert c.call("GET", f"/files/{hashlib.sha256(b'neural').hexdigest()}")[0] == 200


def test_import_refuses_unsafe_or_foreign_zips(pb):
    c, _, tmp = pb
    bad = tmp / "bad.cabana.zip"
    with zipfile.ZipFile(bad, "w") as z:
        z.writestr("../evil.txt", "x")
        z.writestr("project.yaml", "id: 0123456789ab\n")
    assert c.json("POST", "/projects/import", {"path": str(bad)})[0] == 400
    plain = tmp / "plain.zip"
    with zipfile.ZipFile(plain, "w") as z:
        z.writestr("a.txt", "x")
    assert c.json("POST", "/projects/import", {"path": str(plain)})[0] == 400
    assert c.json("POST", "/projects/import", {"path": str(tmp / "none.zip")})[0] == 400
