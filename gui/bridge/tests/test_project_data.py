"""Data referenced by path: registration, moved and missing files, dialog, scan."""

import hashlib
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

from cabana_bridge import dialogs
from test_projects import create, pb  # noqa: F401  (fixture)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@pytest.fixture()
def opened(pb):  # noqa: F811
    c, app, tmp = pb
    info = create(c)
    data = tmp / "recording" / "neural_deconvolved.npy"
    data.parent.mkdir()
    data.write_bytes(b"neural bytes")
    c.json("POST", "/projects/open", {"id": info["id"]})
    return c, app, tmp, info, data


def test_register_records_path_size_mtime_and_hash(opened):
    c, app, tmp, info, data = opened
    status, entry = c.json("POST", f"/projects/{info['id']}/data", {"slot": "neural_deconvolved", "path": str(data)})
    assert status == 201, entry
    assert entry["sha256"] == sha(b"neural bytes") and entry["size"] == 12 and entry["path"] == str(data.resolve())
    meta = yaml.safe_load((Path(info["path"]) / "project.yaml").read_text())
    assert meta["data"][0]["slot"] == "neural_deconvolved" and "copied" not in meta["data"][0]
    assert c.json("POST", f"/projects/{info['id']}/data", {"slot": "nope", "path": str(data)})[0] == 400
    assert c.json("POST", f"/projects/{info['id']}/data", {"slot": "position", "path": str(tmp / "x")})[0] == 404
    # registering the same slot again replaces it
    c.json("POST", f"/projects/{info['id']}/data", {"slot": "neural_deconvolved", "path": str(data)})
    assert len(c.json("GET", f"/projects/{info['id']}/data")[1]["files"]) == 1
    assert c.call("DELETE", f"/projects/{info['id']}/data/neural_deconvolved")[0] == 204
    assert c.json("GET", f"/projects/{info['id']}/data")[1]["files"] == []


def test_status_present_changed_moved_missing(opened):
    c, app, tmp, info, data = opened
    pid = info["id"]
    c.json("POST", f"/projects/{pid}/data", {"slot": "neural_deconvolved", "path": str(data)})
    get = lambda: c.json("GET", f"/projects/{pid}/data")[1]["files"][0]
    assert get()["status"] == "present"
    moved = tmp / "recording" / "renamed.npy"
    data.rename(moved)
    got = get()
    assert got["status"] == "moved" and got["path"] == str(moved.resolve()) and got["last_seen_path"] == str(data.resolve())
    assert get()["status"] == "present"  # the new path was recorded
    moved.unlink()
    got = get()
    assert got["status"] == "missing" and got["last_seen_path"] == str(moved.resolve())
    moved.write_bytes(b"different!!!")
    assert get()["status"] == "changed"


def test_moved_to_a_parent_folder_is_found(opened):
    c, app, tmp, info, data = opened
    pid = info["id"]
    c.json("POST", f"/projects/{pid}/data", {"slot": "neural_deconvolved", "path": str(data)})
    shutil.move(str(data), str(tmp / data.name))
    assert c.json("GET", f"/projects/{pid}/data")[1]["files"][0]["status"] == "moved"


def test_registered_file_is_served_and_unregistered_refused(opened):
    c, app, tmp, info, data = opened
    c.json("POST", f"/projects/{info['id']}/data", {"slot": "neural_deconvolved", "path": str(data)})
    status, body = c.call("GET", f"/files/{sha(b'neural bytes')}")
    assert (status, body) == (200, b"neural bytes")
    other = tmp / "other.npy"
    other.write_bytes(b"other")
    assert c.call("GET", f"/files/{sha(b'other')}")[0] == 404
    c.json("POST", "/projects/close")
    assert c.call("GET", f"/files/{sha(b'neural bytes')}")[0] == 404


def test_sessions_use_referenced_files_without_copying(opened):
    c, app, tmp, info, data = opened
    digest = sha(b"neural bytes")
    c.json("POST", f"/projects/{info['id']}/data", {"slot": "neural_deconvolved", "path": str(data)})
    assert c.call("HEAD", f"/inputs/{digest}")[0] == 204
    assert c.call("PUT", f"/inputs/{digest}?name=x.npy", raw=b"neural bytes")[0] == 204  # nothing stored
    session_id, _ = app.project.register_session({"neural": {"file": "x"}}, {"neural.file": digest}, {})
    config = yaml.safe_load((app.project.session_dir(session_id) / "config.yaml").read_text())
    resolved = (app.project.session_dir(session_id) / config["neural"]["file"]).resolve()
    assert resolved == data.resolve()
    assert not list(app.project.inputs_dir.glob(f"{digest}*"))
    assert app.project.input_meta(digest)["name"] == data.name


def test_copy_data_keeps_a_copy_and_survives_the_original_going(opened):
    c, app, tmp, info, data = opened
    pid = info["id"]
    meta = yaml.safe_load((Path(info["path"]) / "project.yaml").read_text())
    meta["copy_data"] = True
    (Path(info["path"]) / "project.yaml").write_text(yaml.safe_dump(meta))
    entry = c.json("POST", f"/projects/{pid}/data", {"slot": "neural_deconvolved", "path": str(data)})[1]
    assert (Path(info["path"]) / entry["copied"]).read_bytes() == b"neural bytes"
    data.unlink()
    assert c.call("GET", f"/files/{sha(b'neural bytes')}")[0] == 200


def test_scan_lists_a_folder_and_one_level_down(pb):
    c, _, tmp = pb
    (tmp / "d" / "sub" / "deeper").mkdir(parents=True)
    (tmp / "d" / "a.csv").write_text("1")
    (tmp / "d" / "sub" / "b.npy").write_bytes(b"22")
    (tmp / "d" / "sub" / "deeper" / "c.npy").write_bytes(b"3")
    (tmp / "d" / ".hidden").write_text("x")
    status, out = c.json("POST", "/scan", {"paths": [str(tmp / "d"), str(tmp / "d" / "a.csv")]})
    assert [f["name"] for f in out["files"]] == ["a.csv", "b.npy", "a.csv"]
    assert out["files"][1]["size"] == 2 and out["files"][0]["modified"].endswith("Z")
    assert c.json("POST", "/scan", {"paths": [str(tmp / "nope")]})[0] == 404


def test_dialog_builds_the_script_and_reads_the_answer(pb, monkeypatch):
    c, _, _ = pb
    seen = []

    def fake(script):
        seen.append(script)
        return subprocess.CompletedProcess([], 0, "/Users/a/one.npy\n/Users/a/two.csv\n", "")

    monkeypatch.setattr(dialogs, "run_osascript", fake)
    monkeypatch.setattr(dialogs.sys, "platform", "darwin")
    status, out = c.json("POST", "/dialog", {"kind": "files", "title": 'Pick "data"'})
    assert out == {"paths": ["/Users/a/one.npy", "/Users/a/two.csv"]}
    assert "multiple selections" in seen[0] and 'Pick \\"data\\"' in seen[0]
    c.json("POST", "/dialog", {"kind": "save", "default_name": "setup.yaml"})
    assert 'default name "setup.yaml"' in seen[1] and "choose file name" in seen[1]
    monkeypatch.setattr(dialogs, "run_osascript",
                        lambda s: subprocess.CompletedProcess([], 1, "", "execution error: User canceled. (-128)"))
    assert c.json("POST", "/dialog", {"kind": "folder"})[1] == {"cancelled": True}
    assert c.json("POST", "/dialog", {"kind": "bogus"})[0] == 400
    monkeypatch.setattr(dialogs.sys, "platform", "linux")
    assert c.json("POST", "/dialog", {"kind": "folder"})[0] == 501


def put_input(c, data: bytes, name: str = "neural.npy") -> str:
    digest = sha(data)
    assert c.call("PUT", f"/inputs/{digest}?name={name}", raw=data)[0] in (201, 204)
    return digest


def test_from_input_copies_the_upload_into_the_project(opened):
    c, app, tmp, info, data = opened
    digest = put_input(c, b"example bytes")
    path = f"/projects/{info['id']}/data/from-input"
    status, entry = c.json("POST", path, {"slot": "neural_deconvolved", "sha": digest, "name": "neural.npy"})
    assert status == 201, entry
    copy = Path(info["path"]) / "data" / "neural_deconvolved-neural.npy"
    assert copy.read_bytes() == b"example bytes" and entry["copied"] == "data/neural_deconvolved-neural.npy"
    assert entry["sha256"] == digest and entry["size"] == 13 and entry["path"] == str(copy)
    files = c.json("GET", f"/projects/{info['id']}/data")[1]["files"]
    assert [(f["slot"], f["status"]) for f in files] == [("neural_deconvolved", "present")]


def test_from_input_errors(opened):
    c, app, tmp, info, data = opened
    path = f"/projects/{info['id']}/data/from-input"
    digest = put_input(c, b"example bytes")
    body = {"slot": "neural_deconvolved", "sha": digest, "name": "n.npy"}
    assert c.json("POST", path, {**body, "sha": sha(b"never uploaded")})[0] == 404
    assert c.json("POST", "/projects/000000000000/data/from-input", body)[0] == 404
    for name in ("../x.npy", "a/b.npy", "..", ".hidden", ""):
        assert c.json("POST", path, {**body, "name": name})[0] == 400, name
    assert c.json("POST", path, {**body, "slot": "nope"})[0] == 400
    assert c.json("POST", path, {"slot": "position"})[0] == 400
    # a stored file whose bytes no longer match its hash is a conflict
    (app.project.inputs_dir / f"{digest}.npy").write_bytes(b"tampered")
    assert c.json("POST", path, body)[0] == 409
    assert not (Path(info["path"]) / "data").exists() or not list((Path(info["path"]) / "data").iterdir())


def test_a_copied_file_is_not_missing_when_the_original_path_is_gone(tmp_path):
    from cabana_bridge.projects import summarize
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "neural_raw-a.npy").write_bytes(b"x")
    data = [{"slot": "neural_raw", "path": "/gone/a.npy", "copied": "data/neural_raw-a.npy"},
            {"slot": "position", "path": "/gone/p.csv"}]
    assert summarize(tmp_path, {"id": "abc", "data": data})["missing_count"] == 1
