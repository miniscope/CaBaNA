"""cabana.analyze and the bundled recipes."""

from __future__ import annotations

import pytest

import cabana
from cabana import Pipeline

pytest.importorskip("yaml")

TARGETS = {
    "place_cell": {"states": "position"},
    "social": {"states": "social"},
    "social_speed_matched": {"states": "social"},
    "syllables": {"states": "syllables"},
    "event_response": {"states": "social"},
    "speed_tuning": {"signal": "speed"},
    "population": {"states": "syllables"},
}


def test_recipes_listed():
    assert set(cabana.recipes()) >= set(TARGETS)


@pytest.mark.parametrize("name", sorted(TARGETS))
def test_every_recipe_builds_a_valid_pipeline(name, sim_session):
    rec = cabana.recipe(name)
    assert rec["name"] == name and rec["title"] and rec["description"]
    assert set(rec["targets"]) == set(TARGETS[name])
    pipe = cabana.recipe_pipeline(name, **TARGETS[name], n_shuffles=100)
    assert isinstance(pipe, Pipeline) and pipe.analyses
    assert "${" not in pipe.to_yaml()
    # round trip through YAML
    assert Pipeline.from_yaml(pipe.to_yaml()).to_dict() == pipe.to_dict()


@pytest.mark.parametrize("name", sorted(set(TARGETS) - {"place_cell"}))
def test_every_recipe_validates_on_sim_session(name, sim_session):
    pipe = cabana.recipe_pipeline(name, **TARGETS[name], n_shuffles=100)
    assert pipe.validate(sim_session, time_budget_s=0.0).ok


def test_place_cell(sim_session):
    session, res = cabana.analyze(
        sim_session, "place_cell", states="position", n_shuffles=20, progress=False
    )
    assert session.masks["speed"].any()  # the recipe created the speed mask
    assert [r.metric for r in res] == [
        "information_content",
        "split_half_stability",
        "place_fields",
    ]
    assert res.status == "ok" and not res.errors
    assert all(r.shuffle.n_shuffles == 20 and r.provenance["masks"] == ["speed"] for r in res)
    paths = {s["path"] for s in res.selections}
    assert any(p.endswith("smooth_sigma_bins") for p in paths)  # auto_smooth_sigma recorded
    assert any(p.endswith("min_shift_s") for p in paths)  # auto_null_timescale recorded


def test_missing_target_message(sim_session):
    with pytest.raises(ValueError, match=r"recipe 'place_cell' needs states= \(a StateSpace") as e:
        cabana.analyze(sim_session, "place_cell", progress=False)
    assert "position" in str(e.value) and "session has" in str(e.value)
    with pytest.raises(ValueError, match="needs signal="):
        cabana.analyze(sim_session, "speed_tuning", progress=False)
    with pytest.raises(ValueError, match="unknown recipe"):
        cabana.analyze(sim_session, "nope", progress=False)


def test_unknown_state_space_is_a_validation_error(sim_session):
    with pytest.raises(ValueError, match="missing_target"):
        cabana.analyze(sim_session, "place_cell", states="nowhere", progress=False)


def test_overrides_and_selections(sim_session):
    over = {"analyses.*.shuffle.n_shuffles": 45}
    _, res = cabana.analyze(
        sim_session, "syllables", states="syllables", progress=False, min_shift_s=30.0, **over
    )
    assert all(r.shuffle.n_shuffles == 45 for r in res)
    sel = [s for s in res.selections if s["path"] == "analyses.*.shuffle.n_shuffles"]
    assert sel and sel[0]["method"] == "user_pick" and sel[0]["note"] == "analyze() override"
    # an explicit min_shift_s removes the data-driven selector
    assert all(s["method"] != "auto_rule" for s in res.selections)


def test_n_shuffles_keyword(sim_session):
    _, res = cabana.analyze(
        sim_session, "speed_tuning", signal="speed", n_shuffles=45, progress=False
    )
    assert {r.shuffle.n_shuffles for r in res} == {45}


def test_validation_errors_block_the_run(sim_session):
    with pytest.raises(ValueError, match="cannot_reach_alpha"):
        cabana.analyze(sim_session, "social", states="social", n_shuffles=5, progress=False)


def test_pipeline_object_and_yaml_path(sim_session, tmp_path):
    pipe = cabana.recipe_pipeline("speed_tuning", signal="speed", n_shuffles=50)
    _, a = cabana.analyze(sim_session, pipe, n_shuffles=60, progress=False)
    assert {r.shuffle.n_shuffles for r in a} == {60}
    with pytest.raises(ValueError, match="only applies to recipes"):
        cabana.analyze(sim_session, pipe, states="social", progress=False)
    path = tmp_path / "mine.yaml"
    pipe.to_yaml(path)  # a plain pipeline YAML
    _, b = cabana.analyze(sim_session, path, progress=False)
    assert {r.shuffle.n_shuffles for r in b} == {50}
    rec_path = tmp_path / "rec.yaml"
    rec_path.write_text(
        "recipe: {name: mine, targets: {signal: a signal}, defaults: {n_shuffles: 41}}\n"
        "pipeline:\n  analyses:\n  - metric: {name: signal_correlation}\n"
        "    signal: ${signal}\n    shuffle: {n_shuffles: '${n_shuffles}'}\n"
    )
    _, c = cabana.analyze(sim_session, rec_path, signal="speed", progress=False)
    assert {r.shuffle.n_shuffles for r in c} == {41}
    with pytest.raises(ValueError, match="recipe 'mine' needs signal="):
        cabana.analyze(sim_session, rec_path, progress=False)


def test_out_dir(sim_session, tmp_path):
    out = tmp_path / "run"
    _, res = cabana.analyze(
        sim_session, "speed_tuning", signal="speed", n_shuffles=40, progress=False, out_dir=out
    )
    assert {p.name for p in out.iterdir()} == {"results.zip", "pipeline.yaml", "summary.csv"}
    back = cabana.ResultSet.load(out / "results.zip")
    assert back.names() == res.names()
    assert Pipeline.from_yaml(out / "pipeline.yaml").analyses
    import pandas as pd

    assert len(pd.read_csv(out / "summary.csv")) == len(res)


def test_progress_uses_tqdm_when_available(sim_session, monkeypatch):
    import sys
    import types

    bars = []

    class Bar:
        def __init__(self, total=None, **kw):
            self.total, self.n, self.closed = total, 0, False
            bars.append(self)

        def update(self, k):
            self.n += k

        def set_postfix_str(self, *a, **k):
            pass

        def close(self):
            self.closed = True

    monkeypatch.setitem(sys.modules, "tqdm", types.SimpleNamespace(tqdm=Bar))
    seen = []
    ctx = cabana.RunContext(on_progress=lambda ev: seen.append(ev.stage))
    cabana.analyze(
        sim_session, "speed_tuning", signal="speed", n_shuffles=40, context=ctx, progress=True
    )
    assert len(bars) == 1 and bars[0].n == 1000 and bars[0].closed
    assert "done" in seen  # the user's callback ran too


def test_progress_falls_back_to_logger(sim_session, monkeypatch, caplog):
    import sys

    monkeypatch.setitem(sys.modules, "tqdm", None)
    with caplog.at_level("INFO", logger="cabana"):
        cabana.analyze(sim_session, "speed_tuning", signal="speed", n_shuffles=40, progress=True)
    assert any("analysis" in r.getMessage() for r in caplog.records)
