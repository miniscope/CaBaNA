"""Projects root, lifecycle, configuration files, history (design 2026-11-18)."""

import json
import sys
import threading
from pathlib import Path

import pytest
import yaml

from cabana_bridge import project_files, projects
from cabana_bridge.server import App, make_server
from cabana_bridge.store import Project
from conftest import SECRET, Client


@pytest.fixture()
def pb(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path / "home"))  # Trash and defaults stay in tmp
    monkeypatch.setattr(projects.Path, "home", lambda: tmp_path / "home")
    app = App(Project(tmp_path / "workspace"), SECRET, projects_root=tmp_path / "root")
    server = make_server(app, 0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield Client(server.server_address[1]), app, tmp_path
    server.shutdown()


def create(c, name="M24 social preference", **kw):
    status, out = c.json("POST", "/projects", {"name": name, **kw})
    assert status == 201, out
    return out


def test_create_makes_the_layout_and_unique_names(pb):
    c, app, tmp = pb
    first = create(c)
    folder = Path(first["path"])
    assert folder == tmp / "root" / "M24 social preference"
    for name in ("project.yaml", "experiment.yaml", "processing.yaml", "analysis.yaml", "history/changes.jsonl"):
        assert (folder / name).exists()
    for sub in ("history/snapshots", "runs", "processed"):
        assert (folder / sub).is_dir()
    meta = yaml.safe_load((folder / "project.yaml").read_text())
    assert (meta["save_mode"], meta["retention"], meta["copy_data"], meta["data"]) == ("auto", "every", False, [])
    assert create(c)["name"] == "M24 social preference 2"
    assert create(c)["name"] == "M24 social preference 3"
    assert create(c, "a/b:c")["name"] == "a b c"  # filesystem-safe


def test_create_in_another_parent(pb):
    c, _, tmp = pb
    info = create(c, "Lab drive", parent=str(tmp / "elsewhere"))
    assert Path(info["path"]).parent == tmp / "elsewhere"
    ids = [p["id"] for p in c.json("GET", "/projects")[1]["projects"]]
    assert info["id"] in ids  # remembered in recent.json


def test_list_reports_data_kinds_sizes_and_missing(pb):
    c, app, tmp = pb
    info = create(c)
    folder = Path(info["path"])
    meta = yaml.safe_load((folder / "project.yaml").read_text())
    here = tmp / "neural.npy"
    here.write_bytes(b"x")
    meta["data"] = [{"slot": "neural_deconvolved", "path": str(here)},
                    {"slot": "position", "path": str(tmp / "gone.csv")}]
    (folder / "project.yaml").write_text(yaml.safe_dump(meta))
    row = c.json("GET", "/projects")[1]["projects"][0]
    assert row["kinds"] == ["neural", "position"]
    assert (row["file_count"], row["missing_count"], row["readable"]) == (2, 1, True)
    assert row["size_bytes"] > 0


def test_unreadable_remembered_project_is_listed(pb):
    c, _, tmp = pb
    info = create(c, "Away", parent=str(tmp / "usb"))
    import shutil
    shutil.rmtree(tmp / "usb")
    row = [p for p in c.json("GET", "/projects")[1]["projects"] if p["id"] == info["id"]][0]
    assert row["readable"] is False


def test_open_switches_the_store_and_close_returns(pb):
    c, app, tmp = pb
    info = create(c)
    assert c.json("GET", "/projects/current")[1] == {"project": None}
    status, out = c.json("POST", "/projects/open", {"id": info["id"]})
    assert status == 200 and out["id"] == info["id"]
    assert c.json("GET", "/projects/current")[1]["project"]["id"] == info["id"]
    assert app.project.root == Path(info["path"]).resolve()
    assert app.project.sessions_dir == Path(info["path"]).resolve() / "processed" / "sessions"
    assert (Path(info["path"]) / "runs").is_dir()
    c.json("POST", "/projects/close")
    assert app.project is app.workspace
    # opening by the path of project.yaml, from outside the root
    status, out = c.json("POST", "/projects/open", {"path": str(Path(info["path"]) / "project.yaml")})
    assert status == 200 and out["id"] == info["id"]
    assert c.json("POST", "/projects/open", {"path": str(tmp)})[0] == 400


def test_existing_endpoints_use_the_open_project(pb):
    c, app, _ = pb
    info = create(c)
    c.json("POST", "/projects/open", {"id": info["id"]})
    assert c.json("GET", "/runs")[1] == []
    c.json("PUT", "/project", {"gui": 1})
    assert (Path(info["path"]) / "processed" / "project.json").exists()
    assert not (Path(info["path"]) / "inputs").exists()


def test_rename_refuses_a_clash_and_follows_the_open_project(pb):
    c, app, tmp = pb
    a, b = create(c, "A"), create(c, "B")
    status, out = c.json("POST", f"/projects/{a['id']}/rename", {"name": "B"})
    assert status == 409 and "already exists" in out["error"]
    c.json("POST", "/projects/open", {"id": a["id"]})
    status, out = c.json("POST", f"/projects/{a['id']}/rename", {"name": "Renamed"})
    assert status == 200 and out["name"] == "Renamed"
    assert (tmp / "root" / "Renamed" / "project.yaml").exists() and not (tmp / "root" / "A").exists()
    assert app.project.root == (tmp / "root" / "Renamed").resolve()


def test_duplicate_copies_settings_not_runs(pb):
    c, _, tmp = pb
    info = create(c)
    folder = Path(info["path"])
    c.json("PUT", f"/projects/{info['id']}/files/experiment.yaml", {"data": {"fs": 30}, "summary": "fs"})
    (folder / "runs" / "r1").mkdir()
    (folder / "processed" / "big.bin").write_bytes(b"0")
    status, dup = c.json("POST", f"/projects/{info['id']}/duplicate", {})
    assert status == 201 and dup["id"] != info["id"] and dup["name"] == "M24 social preference copy"
    new = Path(dup["path"])
    assert yaml.safe_load((new / "experiment.yaml").read_text()) == {"fs": 30}
    assert (new / "history" / "changes.jsonl").read_text().count("\n") == 1
    assert not any((new / "runs").iterdir()) and not any((new / "processed").iterdir())


def test_delete_moves_to_trash_and_keeps_data(pb):
    c, app, tmp = pb
    info = create(c)
    data = tmp / "neural.npy"
    data.write_bytes(b"x")
    c.json("POST", "/projects/open", {"id": info["id"]})
    status, out = c.json("DELETE", f"/projects/{info['id']}")
    assert status == 200, out
    assert not Path(info["path"]).exists()
    assert (tmp / "home" / ".Trash" / "M24 social preference" / "project.yaml").exists()
    assert data.exists() and app.project is app.workspace
    assert c.json("GET", "/projects")[1]["projects"] == []


def test_reveal_runs_open_on_mac_only(pb, monkeypatch):
    c, _, _ = pb
    info = create(c)
    calls = []
    monkeypatch.setattr(projects.subprocess, "run", lambda cmd, **kw: calls.append(cmd))
    monkeypatch.setattr(projects.sys, "platform", "darwin")
    assert c.call("POST", f"/projects/{info['id']}/reveal")[0] == 204
    assert calls == [["open", "-R", info["path"]]]
    monkeypatch.setattr(projects.sys, "platform", "linux")
    assert c.call("POST", f"/projects/{info['id']}/reveal")[0] == 501


def test_open_refused_while_a_run_is_active(pb):
    c, app, tmp = pb
    info = create(c)
    app.workspace.write_run("20260101-000000-aaaaaa", {"run_id": "20260101-000000-aaaaaa", "status": "running",
                                                     "engine": "browser-ts"})
    status, out = c.json("POST", "/projects/open", {"id": info["id"]})
    assert status == 409 and "run is in progress" in out["error"]


# -- configuration files and history -----------------------------------------------------
def put(c, pid, name, **body):
    return c.json("PUT", f"/projects/{pid}/files/{name}", body)


def test_put_writes_atomically_and_logs_the_summary(pb):
    c, _, _ = pb
    info = create(c)
    pid, folder = info["id"], Path(info["path"])
    status, out = put(c, pid, "processing.yaml", data={"smoothing_s": 0.2}, summary="Event smoothing 0.20 s (was off)")
    assert status == 200 and out["saved_at"].endswith("Z")
    assert yaml.safe_load((folder / "processing.yaml").read_text()) == {"smoothing_s": 0.2}
    assert not list(folder.glob(".*.tmp"))
    log = [json.loads(line) for line in (folder / "history/changes.jsonl").read_text().splitlines()]
    assert log[-1]["file"] == "processing.yaml" and log[-1]["summary"] == "Event smoothing 0.20 s (was off)"
    got = c.json("GET", f"/projects/{pid}/files/processing.yaml")[1]
    assert got["valid"] and got["in_use"] == "this" and got["error"] is None and "smoothing_s" in got["text"]


def test_put_refuses_bad_names_and_bad_yaml(pb):
    c, _, _ = pb
    pid = create(c)["id"]
    assert c.call("PUT", f"/projects/{pid}/files/..%2Fevil.yaml", body={"data": {}})[0] == 404
    assert c.call("GET", f"/projects/{pid}/files/secrets.yaml")[0] == 400  # not one of the four names
    status, out = put(c, pid, "experiment.yaml", text="a: [1, 2\nb: 3\n")
    assert status == 400 and "Line" in out["error"]
    assert put(c, pid, "experiment.yaml", text="- a\n- b\n")[0] == 400  # wrong top-level type
    assert put(c, pid, "experiment.yaml", data=[1])[0] == 400


def test_project_yaml_keeps_its_id(pb):
    c, _, _ = pb
    info = create(c)
    text = yaml.safe_dump({"id": "000000000000", "name": "x"})
    assert put(c, info["id"], "project.yaml", text=text)[0] == 400


def test_outside_edit_with_an_error_names_the_line_and_uses_the_last_valid_copy(pb):
    c, app, _ = pb
    info = create(c)
    pid, folder = info["id"], Path(info["path"])
    put(c, pid, "experiment.yaml", data={"fs": 30}, summary="fs")
    (folder / "experiment.yaml").write_text("fs: 30\nzones: [a, b\nname: x\n")  # edited in a text editor
    got = c.json("GET", f"/projects/{pid}/files/experiment.yaml")[1]
    assert not got["valid"] and got["in_use"] == "last-valid" and got["error"]["line"] >= 2
    assert project_files.ProjectFiles(folder).load("experiment.yaml") == {"fs": 30}
    (folder / "processing.yaml").write_text("just a string\n")
    got = c.json("GET", f"/projects/{pid}/files/processing.yaml")[1]
    assert not got["valid"] and "mapping" in got["error"]["message"]


def test_snapshot_at_most_every_30_minutes_and_restore(pb, monkeypatch):
    c, _, _ = pb
    info = create(c)
    pid, folder = info["id"], Path(info["path"])
    now = [1_800_000_000.0]
    monkeypatch.setattr(project_files, "_clock", lambda: now[0])
    put(c, pid, "analysis.yaml", data={"v": 1}, summary="v1")
    now[0] += 60
    put(c, pid, "analysis.yaml", data={"v": 2}, summary="v2")  # too soon: no new snapshot
    history = c.json("GET", f"/projects/{pid}/history")[1]
    assert len(history["snapshots"]) == 1 and len(history["changes"]) == 2
    now[0] += 31 * 60
    put(c, pid, "analysis.yaml", data={"v": 3}, summary="v3")
    snaps = c.json("GET", f"/projects/{pid}/history")[1]["snapshots"]
    assert len(snaps) == 2
    oldest = snaps[-1]  # newest first
    assert yaml.safe_load((folder / "history/snapshots" / oldest["id"] / "analysis.yaml").read_text()) == {}
    # restoring the second snapshot (taken before v3) brings back v2 and snapshots v3 first
    newest = snaps[0]
    status, out = c.json("POST", f"/projects/{pid}/history/{newest['id']}/restore")
    assert status == 200
    assert yaml.safe_load((folder / "analysis.yaml").read_text()) == {"v": 2}
    after = c.json("GET", f"/projects/{pid}/history")[1]
    assert len(after["snapshots"]) == 3 and "Restored" in after["changes"][-1]["summary"]
    assert c.call("POST", f"/projects/{pid}/history/20990101-000000/restore")[0] == 404
    assert c.call("POST", f"/projects/{pid}/history/..%2F..%2Fx/restore")[0] == 404


def test_compare_with_a_runs_frozen_copy(pb):
    c, _, _ = pb
    info = create(c)
    pid, folder = info["id"], Path(info["path"])
    frozen = folder / "runs" / "20260101-000000-aaaaaa" / "config"
    frozen.mkdir(parents=True)
    (frozen / "analysis.yaml").write_text("a: 1\nb: 2\n")
    put(c, pid, "analysis.yaml", text="a: 1\nb: 3\nc: 4\n", summary="edit")
    out = c.json("GET", f"/projects/{pid}/files/analysis.yaml/compare?run=20260101-000000-aaaaaa")[1]
    assert not out["identical"] and out["changes"][0]["run"] == ["b: 2"]
    assert out["changes"][0]["current"] == ["b: 3", "c: 4"]
    assert c.call("GET", f"/projects/{pid}/files/analysis.yaml/compare?run=20260101-000000-bbbbbb")[0] == 404


def test_last_valid_and_frozen_texts(pb):
    c, app, _ = pb
    info = create(c)
    pid, folder = info["id"], Path(info["path"])
    put(c, pid, "analysis.yaml", text="a: 1\n", summary="edit")
    c.json("GET", f"/projects/{pid}/files/analysis.yaml")  # a valid read keeps the copy
    (folder / "analysis.yaml").write_text("a: [broken\n")
    assert c.json("GET", f"/projects/{pid}/files/analysis.yaml")[1]["valid"] is False
    status, text = c.call("GET", f"/projects/{pid}/files/analysis.yaml/last-valid")
    assert (status, text) == (200, b"a: 1\n")
    assert c.call("GET", f"/projects/{pid}/files/other.yaml/last-valid")[0] == 400
    assert c.call("POST", "/projects/open", {"id": pid})[0] == 200
    frozen = folder / "runs" / "20260101-000000-aaaaaa" / "config"
    frozen.mkdir(parents=True)
    (frozen / "analysis.yaml").write_text("a: 0\n")
    assert c.call("GET", "/runs/20260101-000000-aaaaaa/config/analysis.yaml") == (200, b"a: 0\n")
    assert c.call("GET", "/runs/20260101-000000-aaaaaa/config/processing.yaml")[0] == 404
    assert c.call("GET", "/runs/20260101-000000-bbbbbb/config/analysis.yaml")[0] == 404


def test_unknown_project_and_missing_secret(pb):
    c, _, _ = pb
    assert c.call("GET", "/projects/0123456789ab/history")[0] == 404
    assert c.call("GET", "/projects", secret=None)[0] == 403


@pytest.mark.parametrize(
    ("text", "line"),
    [
        ("a: 1\nb: [1, 2\nc: 3\n", 2),  # list never closed: blame where it opens
        ("a: 1\nb: 'x\nc: 3\n", 2),  # quote never closed
        ("a: 1\nb: 2\n  c: 3\n", 3),  # the bad line itself
        ("a: 1\nb: : 2\n", 2),
    ],
)
def test_yaml_error_names_the_line_with_the_mistake(text, line):
    data, error = project_files.parse_text(text)
    assert data is None and error["line"] == line
