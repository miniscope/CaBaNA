"""StudySpec and run_study (F3)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import cabana
from cabana import Criteria, ResultSet, RunContext, StudySpec, run_study

PIPE = {
    "analyses": [
        {
            "metric": {"name": "information_content"},
            "states": "position",
            "shuffle": {"n_shuffles": 10, "min_shift_s": 1.0, "seed": 1, "batch_size": 2},
        }
    ]
}
CRIT = cabana.place_cell_criteria(require_stability=False)


@pytest.fixture()
def study_dir(tmp_path: Path, small_session) -> Path:
    small_session.save(tmp_path / "a.zip")
    small_session.save(tmp_path / "b.zip")
    return tmp_path


def _spec(**kw) -> StudySpec:
    d = {
        "name": "t",
        "sessions": {"a": {"path": "a.zip", "animal": "m1"}, "b": {"path": "b.zip"}},
        "animal": {"b": "m2"},
        "pipeline": PIPE,
        "criteria": {"place": CRIT.to_dict()},
        "out_dir": "out",
    }
    d.update(kw)
    return StudySpec.from_dict(d)


def test_yaml_round_trip():
    s = _spec()
    text = s.to_yaml()
    assert text.startswith("kind: cabana.Study")
    s2 = StudySpec.from_yaml(text)
    assert s2.to_dict() == s.to_dict()
    assert s2.resolved_animal() == {"a": "m1", "b": "m2"}
    assert isinstance(s2.resolved_pipeline(), cabana.Pipeline)


def test_accepts_missing_kind_and_rejects_wrong():
    d = _spec().to_dict()
    d.pop("kind")
    assert StudySpec.from_dict(d).name == "t"
    d["kind"] = "other"
    with pytest.raises(ValueError):
        StudySpec.from_dict(d)
    with pytest.raises(ValueError):
        StudySpec.from_dict({**_spec().to_dict(), "bogus": 1})


def test_relative_path_resolution(tmp_path):
    sub = tmp_path / "proj"
    sub.mkdir()
    cabana.Pipeline.from_dict(PIPE).to_yaml(sub / "pipe.yaml")
    CRIT.to_yaml(sub / "crit.yaml")
    (sub / "study.yaml").write_text(
        "kind: cabana.Study\nname: x\nsessions: {a: {path: a.zip}}\n"
        "pipeline: pipe.yaml\ncriteria: {place: crit.yaml}\nout_dir: o\n"
    )
    s = StudySpec.from_yaml(sub / "study.yaml")
    assert s.pipeline == "pipe.yaml"
    assert len(s.resolved_pipeline().analyses) == 1
    assert isinstance(s.resolved_criteria()["place"], Criteria)
    assert s.resolved_out_dir() == sub / "o"
    assert len(s.resolved_pipeline(sub).analyses) == 1


def test_unknown_animal_session_rejected():
    with pytest.raises(ValueError):
        _spec(animal={"zzz": "m"})


def test_run_study_writes_everything(study_dir):
    res = run_study(_spec(), base_dir=study_dir)
    assert res.status == "ok"
    out = study_dir / "out"
    for sid in ("a", "b"):
        assert ResultSet.load(out / f"{sid}.results.zip").status == "ok"
    doc = json.loads((out / "study.json").read_text())
    assert doc["status"] == "ok" and doc["sessions"]["a"]["status"] == "ok"
    assert doc["pipeline_sha256"] and doc["cabana_version"] and doc["timestamp"]
    assert set(doc["classification_counts"]["a"]) >= {"place"}
    assert set(res.classifications) == {"a", "b"}
    assert res.run.animal == {"a": "m1", "b": "m2"}
    assert set(res.classification_table()["animal"]) == {"m1", "m2"}


def test_resume_reuses_zips(study_dir):
    run_study(_spec(), base_dir=study_dir)
    res = run_study(_spec(), base_dir=study_dir)
    info = json.loads((study_dir / "out" / "run_set.json").read_text())["sessions"]
    assert {v["source"] for v in info.values()} == {"resumed"}
    assert res.status == "ok"
    run_study(_spec(resume=False), base_dir=study_dir)
    info = json.loads((study_dir / "out" / "run_set.json").read_text())["sessions"]
    assert {v["source"] for v in info.values()} == {"computed"}


def test_cancel_path(study_dir):
    ctx = RunContext(should_cancel=lambda: True)
    res = run_study(_spec(), base_dir=study_dir, context=ctx)
    assert res.status == "cancelled"
    assert set(res.run.status.values()) == {"not_run"}
    doc = json.loads((study_dir / "out" / "study.json").read_text())
    assert doc["status"] == "cancelled"


def test_cancel_midrun_saves_partial(study_dir):
    n = {"k": 0}

    def cancel():
        n["k"] += 1
        return n["k"] > 3

    res = run_study(_spec(), base_dir=study_dir, context=RunContext(should_cancel=cancel))
    assert res.status == "cancelled"
    assert list((study_dir / "out").glob("*.results.cancelled.zip"))


def test_session_error_names_id(study_dir):
    s = _spec(sessions={"a": {"path": "a.zip"}, "ghost": {"path": "missing.zip"}}, animal=None)
    with pytest.raises(ValueError, match="ghost"):
        run_study(s, base_dir=study_dir)


def test_session_dir_loader():
    root = Path(__file__).parent / "data" / "simulated_3chamber"
    from cabana._study import load_session_source

    s = load_session_source(root)
    assert s.n_cells > 0
    assert load_session_source(root, "session_dir").n_cells == s.n_cells
    with pytest.raises(ValueError):
        load_session_source(root.parent)  # directory with neither marker
