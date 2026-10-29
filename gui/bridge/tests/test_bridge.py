import hashlib
import io
import json
import zipfile

import numpy as np
import pytest

from cabana_bridge import __main__ as entry
from cabana_bridge import pipeline_prep as prep
from cabana_bridge.store import BadRequest

from conftest import EXAMPLES

POP = {
    "preprocess": [{"name": "rebin_time", "bin_s": 0.5, "activity_method": "auto", "min_fraction": 0.5}],
    "analyses": [
        {"name": "pv_similarity", "metric": {"name": "population_vector_overlap", "similarity": "cosine"},
         "states": "social",
         "shuffle": {"n_shuffles": 20, "null": {"name": "cell_shift", "min_shift_s": 20.0,
                                                "min_pair_separation_s": 1.0},
                     "seed": 0, "alpha": 0.05, "correction": "none", "n_jobs": 1}},
    ],
}


def post_run(client, session_id, pipeline, **extra):
    status, out = client.json("POST", "/runs", {"session_id": session_id, "analysis": "population",
                                                 "pipeline": pipeline, "scope": "preview", **extra})
    assert status == 202, out
    return out["run_id"]


def test_startup_assertion_passes_and_rejects(monkeypatch):
    entry.assert_framework()
    import cabana

    monkeypatch.delattr(cabana, "recipe_pipeline")
    with pytest.raises(SystemExit):
        entry.assert_framework()


def test_capabilities(bridge):
    client, app = bridge
    status, caps = client.json("GET", "/capabilities")
    assert status == 200
    for key in ("session_metadata", "session_markers", "frame_labels", "decoding_fold_gap",
                "overlap_policy", "peth_gui_extensions", "cli_rejects_recipes"):
        assert key in caps and isinstance(caps[key], bool)
    # the pinned framework (57c0c4b) has none of these yet
    assert caps["session_metadata"] is False and caps["decoding_fold_gap"] is False


def test_secret_and_host(bridge):
    client, _ = bridge
    assert client.call("GET", "/health", secret="wrong")[0] == 403
    assert client.call("GET", "/health", secret=None)[0] == 403
    assert client.call("GET", "/health")[0] == 200


def test_wrong_hash_rejected(bridge):
    client, _ = bridge
    status, _ = client.call("PUT", f"/inputs/{'0' * 64}?name=a.csv", raw=b"hello")
    assert status == 400


def test_input_roundtrip_and_head(bridge):
    client, _ = bridge
    data = b"a,b\n1,2\n"
    sha = hashlib.sha256(data).hexdigest()
    assert client.call("HEAD", f"/inputs/{sha}")[0] == 404
    assert client.call("PUT", f"/inputs/{sha}?name=x.csv", raw=data)[0] == 201
    assert client.call("PUT", f"/inputs/{sha}?name=x.csv", raw=data)[0] == 204
    assert client.call("HEAD", f"/inputs/{sha}")[0] == 204


@pytest.mark.parametrize("name", ["simulated_social_interaction", "simulated_open_field",
                                  "simulated_3chamber", "simulated_fear_conditioning"])
def test_register_examples(bridge, name):
    client, _ = bridge
    client.register_example(name)


def test_metadata_withheld_when_unsupported(bridge):
    client, _ = bridge
    import yaml

    folder = EXAMPLES / "simulated_social_interaction"
    config = yaml.safe_load((folder / "config.yaml").read_text())
    config["neural"].pop("alternatives", None)
    files = {"neural.file": client.upload(folder / config["neural"]["file"]),
             "neural.timestamps": client.upload(folder / config["neural"]["timestamps"]),
             "behavior.timestamps": client.upload(folder / config["behavior"]["timestamps"]),
             "behavior.position.file": client.upload(folder / config["behavior"]["position"]["file"]),
             "behavior.epochs.social.file": client.upload(folder / config["behavior"]["epochs"]["social"]["file"])}
    config["metadata"] = {"label_roles": {"sniff_face": "measured"}}
    status, out = client.json("POST", "/sessions", {"config": config, "files": files})
    assert status == 200 and out["problems"] == [] and out["withheld"] == ["metadata"]
    status, full = client.json("GET", f"/sessions/{out['session_id']}/config")
    assert full["metadata"]["label_roles"] == {"sniff_face": "measured"}  # nothing lost


def test_validate_missing_target(bridge):
    client, _ = bridge
    sid = client.register_example("simulated_social_interaction")
    bad = json.loads(json.dumps(POP))
    bad["analyses"][0]["states"] = "nope"
    status, out = client.json("POST", "/validate", {"session_id": sid, "pipeline": bad})
    assert status == 200
    assert any(i["level"] == "error" and i["code"] == "missing_target" for i in out["issues"])
    status, out = client.json("POST", "/validate", {"session_id": sid, "pipeline": POP})
    assert not [i for i in out["issues"] if i["level"] == "error"]
    assert out["memory"]["peak_bytes"] > 0


def test_missing_capability_refused(bridge):
    client, _ = bridge
    sid = client.register_example("simulated_social_interaction")
    status, out = client.json("POST", "/runs", {"session_id": sid, "pipeline": POP,
                                                "requires": ["decoding_fold_gap"]})
    assert status == 409 and out["missing_capabilities"] == ["decoding_fold_gap"]


@pytest.mark.slow
def test_run_arrays_reproducible_and_njobs(bridge, project):
    client, _ = bridge
    sid = client.register_example("simulated_social_interaction")
    one = post_run(client, sid, POP)
    parallel = json.loads(json.dumps(POP))
    parallel["analyses"][0]["shuffle"]["n_jobs"] = -1
    two = post_run(client, sid, parallel)
    rec1, rec2 = client.wait(one), client.wait(two)
    assert rec1["status"] == rec2["status"] == "ok"
    assert rec1["scope"] == "preview" and rec1["framework"]["cabana_version"]
    for key in ("values", "sh_p_value", "sh_null_lo", "sh_null_hi"):
        a = np.load(io.BytesIO(client.call("GET", f"/runs/{one}/arrays/pv_similarity/{key}.npy")[1]))
        b = np.load(io.BytesIO(client.call("GET", f"/runs/{two}/arrays/pv_similarity/{key}.npy")[1]))
        assert np.array_equal(a, b, equal_nan=True), key
    # reproduce.sh equivalent: run the CLI on the stored pipeline and session again
    import subprocess

    from cabana_bridge import capabilities as caps

    folder = project.run_dir(one)
    subprocess.run([*caps.cli_command(), "run", str(folder / "pipeline.yaml"), "--session",
                    str(project.session_dir(sid)), "--out", str(folder / "again"), "--on-error", "record"],
                   check=True, capture_output=True)
    from cabana import ResultSet

    again = ResultSet.load(next((folder / "again").glob("*.results.zip")))["pv_similarity"]
    stored = np.load(io.BytesIO(client.call("GET", f"/runs/{one}/arrays/pv_similarity/values.npy")[1]))
    assert np.array_equal(again.values, stored)
    assert np.array_equal(again.shuffle.p_value, np.load(io.BytesIO(
        client.call("GET", f"/runs/{one}/arrays/pv_similarity/sh_p_value.npy")[1])))
    # endpoints
    status, man = client.json("GET", f"/runs/{one}/manifest")
    assert status == 200 and man["results"][0]["plots"]
    assert client.call("GET", f"/runs/{one}/table/pv_similarity.csv")[0] == 200
    assert client.json("GET", f"/runs/{one}/summary")[0] == 200
    kind = man["results"][0]["plots"][0]
    assert client.call("GET", f"/runs/{one}/plotdata/pv_similarity/{kind}")[0] == 200
    status, svg = client.call("GET", f"/runs/{one}/figure/pv_similarity/{kind}.svg")
    assert status == 200 and b"<svg" in svg
    status, bundle = client.call("GET", f"/runs/{one}/bundle.zip")
    names = zipfile.ZipFile(io.BytesIO(bundle)).namelist()
    assert {"run.json", "pipeline.yaml", "config.yaml", "results.zip", "reproduce.sh", "README.txt"} <= set(names)


@pytest.mark.slow
def test_cancel_and_partial_and_recovery(bridge, project):
    client, app = bridge
    sid = client.register_example("simulated_social_interaction")
    long = {"analyses": [{"name": "dec", "metric": {"name": "decode_states", "classifier": "logistic"},
                          "states": "social",
                          "shuffle": {"n_shuffles": 5000, "null": {"name": "label_shuffle", "block_s": 1.0},
                                      "seed": 0, "n_jobs": 1}}]}
    run = post_run(client, sid, long)
    for _ in range(200):
        _, out = client.json("GET", f"/runs/{run}")
        if any(e.get("stage") == "analysis" for e in out["events"]):
            break
        import time

        time.sleep(0.2)
    assert client.call("POST", f"/runs/{run}/cancel")[0] == 202
    rec = client.wait(run)
    assert rec["status"] == "cancelled" and rec["exit_code"] == 3

    broken = json.loads(json.dumps(POP))
    broken["analyses"].append({"name": "bad", "metric": {"name": "pv_stability"}, "states": "missing"})
    rec = client.wait(post_run(client, sid, broken))
    assert rec["status"] == "partial" and rec["errors"]

    stale = project.read_run(run)
    stale.update(status="running", run_id=run)
    project.write_run(run, stale)
    from cabana_bridge.runner import Runner

    Runner(project, app.capabilities, app.sessions)
    assert project.read_run(run)["status"] == "failed"


def test_path_traversal_and_ids(bridge):
    client, _ = bridge
    assert client.call("GET", "/runs/..%2f..%2fetc/manifest")[0] in (400, 404)
    assert client.call("GET", "/runs/abcdefgh/files/..%2f..%2frun.json")[0] in (400, 404)
    assert client.call("GET", f"/sessions/{'a' * 24}/files/{'0' * 64}")[0] == 404
    from cabana_bridge.store import Project

    with pytest.raises(BadRequest):
        Project.inside(bridge[1].project, bridge[1].project.root / ".." / "x")


def test_future_format_refused(bridge, project):
    client, _ = bridge
    run_id = "20261028-000000-fake01"
    folder = project.run_dir(run_id)
    (folder / "out").mkdir(parents=True)
    with zipfile.ZipFile(folder / "out" / "x.results.zip", "w") as z:
        z.writestr("manifest.json", json.dumps({"format": 3, "results": []}))
    project.write_run(run_id, {"run_id": run_id, "status": "ok", "results_file": "out/x.results.zip",
                               "session": {"session_id": "a" * 24}, "created_utc": ""})
    status, out = client.json("GET", f"/runs/{run_id}/summary")
    assert status == 422 and "newer framework" in out["error"]


def test_bayesian_guard():
    class S:
        activity_kind = "denoised"

    reasons = prep.guard_bayesian(S(), {"preprocess": [{"name": "smooth_activity"}],
                                        "analyses": [{"metric": {"name": "bayesian_decoder"}}]})
    assert len(reasons) == 2


def test_set_path_with_dotted_keys():
    from cabana_bridge.store import _set_path

    config = {"behavior": {"epochs": {"tone.1": {"file": "a.csv"}}}}
    _set_path(config, "behavior.epochs.tone.1.file", "x")
    assert config["behavior"]["epochs"]["tone.1"]["file"] == "x"
    with pytest.raises(BadRequest):
        _set_path(config, "behavior.nope.file", "x")


@pytest.mark.slow
def test_run_works_from_the_repository_root(bridge, monkeypatch):
    """The repo root holds a package also named `cabana`; the run must still use the framework."""
    from conftest import EXAMPLES

    monkeypatch.chdir(EXAMPLES.parent)
    client, _ = bridge
    sid = client.register_example("simulated_social_interaction")
    rec = client.wait(post_run(client, sid, POP))
    assert rec["status"] == "ok", rec["errors"]


@pytest.mark.slow
def test_matrix_table_is_long_form_and_early_cancel_is_honoured(bridge):
    client, _ = bridge
    sid = client.register_example("simulated_social_interaction")
    rec = client.wait(post_run(client, sid, POP))
    status, text = client.call("GET", f"/runs/{rec['run_id']}/table/pv_similarity.csv")
    lines = text.decode().strip().splitlines()
    assert lines[0].startswith("row,column,value") and "p_value" in lines[0]
    assert len(lines) == 1 + 9  # 3 x 3 behaviors
    assert "..." not in text.decode()
    # a cancel sent while the run is still queued must not be lost
    long = {"analyses": [{"name": "dec", "metric": {"name": "decode_states", "classifier": "logistic"},
                          "states": "social",
                          "shuffle": {"n_shuffles": 5000, "null": {"name": "label_shuffle", "block_s": 1.0},
                                      "seed": 0, "n_jobs": 1}}]}
    run = post_run(client, sid, long)
    client.call("POST", f"/runs/{run}/cancel")
    assert client.wait(run)["status"] == "cancelled"
