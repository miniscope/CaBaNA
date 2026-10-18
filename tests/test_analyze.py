"""cabana.analyze and the bundled recipes."""

from __future__ import annotations

import pytest

import cabana
from cabana import AnalysisSpec, Pipeline, ShuffleConfig

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


def _kw(name):
    """Recipe targets plus n_shuffles where the recipe has a shuffle (event_response has none)."""
    return {**TARGETS[name], **({} if name == "event_response" else {"n_shuffles": 100})}


def test_recipes_listed():
    assert set(cabana.recipes()) >= set(TARGETS)


@pytest.mark.parametrize("name", sorted(TARGETS))
def test_every_recipe_builds_a_valid_pipeline(name, sim_session):
    rec = cabana.recipe(name)
    assert rec["name"] == name and rec["title"] and rec["description"]
    assert set(rec["targets"]) == set(TARGETS[name])
    pipe = cabana.recipe_pipeline(name, **_kw(name))
    assert isinstance(pipe, Pipeline) and pipe.analyses
    assert "${" not in pipe.to_yaml()
    # round trip through YAML
    assert Pipeline.from_yaml(pipe.to_yaml()).to_dict() == pipe.to_dict()


@pytest.mark.parametrize("name", sorted(set(TARGETS) - {"place_cell"}))
def test_every_recipe_validates_on_sim_session(name, sim_session):
    pipe = cabana.recipe_pipeline(name, **_kw(name))
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


def test_progress_falls_back_to_stdout(sim_session, monkeypatch, capsys):
    import sys

    monkeypatch.setitem(sys.modules, "tqdm", None)
    cabana.analyze(sim_session, "speed_tuning", signal="speed", n_shuffles=40, progress=True)
    out = capsys.readouterr().out
    assert "estimated" in out and "peak" in out and "2 analyses" in out
    assert "analysis 1/2 correlation finished" in out  # not silence without tqdm


# ---------------------------------------------------------------- review fixes


def _effective(pipeline, session):
    """The pipeline after its selectors ran (what the engine actually used)."""
    gen = pipeline.iter_run(session)
    try:
        for key, val in gen:
            if key == "pipeline":
                return val
    finally:
        gen.close()
    raise AssertionError("no effective pipeline")


def test_override_beats_selector_and_is_in_provenance(sim_session):
    over = {
        "analyses.fields.metric.smooth_sigma_bins": 2.0,
        "analyses.*.shuffle.min_shift_s": 77.0,
    }
    done, res = cabana.analyze(
        sim_session, "place_cell", states="position", n_shuffles=20, progress=False, **over
    )
    sels = res["fields"].provenance["selections"]
    picks = {s["path"]: s for s in sels if s["method"] == "user_pick"}
    assert picks["analyses.fields.metric.smooth_sigma_bins"]["value"] == 2.0
    assert picks["analyses.*.shuffle.min_shift_s"]["value"] == 77.0
    # no selector value for those paths is recorded next to the user's
    assert not [s for s in sels if s["method"] == "auto_rule" and s["path"].endswith("min_shift_s")]
    # the effective values are the user's, not the selectors'
    pipe = cabana.recipe_pipeline("place_cell", states="position", n_shuffles=20)
    for path, v in over.items():
        pipe = pipe.set_param(
            path,
            v,
            selection=cabana.Selection(path=path, value=v, method="user_pick"),
        )
    eff = _effective(pipe, done)  # `done` has the speed mask the recipe created
    assert eff.get_param("analyses.fields.metric.smooth_sigma_bins") == 2.0
    assert set(eff.get_param("analyses.*.shuffle.min_shift_s")) == {77.0}


def _failing_pipeline():
    """syllables are speed-defined, so the speed-matched null raises (validate cannot tell)."""
    return cabana.recipe_pipeline("social_speed_matched", states="syllables", n_shuffles=50)


def test_failed_analyses_warn_once(sim_session):
    with pytest.warns(UserWarning, match=r"\d of 2 analyses failed: auroc: \w+Error") as w:
        _, res = cabana.analyze(sim_session, _failing_pipeline(), progress=False)
    assert res.status == "partial" and res.errors
    assert len([x for x in w if "analyses failed" in str(x.message)]) == 1
    msg = [str(x.message) for x in w if "analyses failed" in str(x.message)][0]
    assert all(e.analysis in msg for e in res.errors)


def test_on_error_raise_and_wins_over_context(sim_session):
    with pytest.raises(Exception):  # noqa: B017 - the engine's own error
        cabana.analyze(sim_session, _failing_pipeline(), progress=False, on_error="raise")
    # a context no longer silently turns recording off or on: the argument decides
    ctx = cabana.RunContext(on_error="raise")
    with pytest.warns(UserWarning, match="analyses failed"):
        _, res = cabana.analyze(
            sim_session, _failing_pipeline(), progress=False, context=ctx, on_error="record"
        )
    assert res.errors
    with pytest.raises(ValueError, match="on_error"):
        cabana.analyze(sim_session, "social", states="social", on_error="ignore")


def test_validation_warnings_are_warned_and_logged(sim_session, caplog):
    with caplog.at_level("WARNING", logger="cabana"):
        with pytest.warns(UserWarning, match="min_shift_long"):
            cabana.analyze(
                sim_session,
                "social",
                states="social",
                n_shuffles=50,
                min_shift_s=160.0,
                progress=False,
            )
    assert any("min_shift_long" in r.getMessage() for r in caplog.records)


def test_progress_prints_estimate_through_context_log(sim_session):
    lines = []
    ctx = cabana.RunContext(log=lines.append)
    cabana.analyze(
        sim_session, "speed_tuning", signal="speed", n_shuffles=40, progress=True, context=ctx
    )
    est = [m for m in lines if m.startswith("estimated")]
    assert len(est) == 1 and "peak" in est[0] and "2 analyses on" in est[0]
    quiet = []
    cabana.analyze(
        sim_session,
        "speed_tuning",
        signal="speed",
        n_shuffles=40,
        progress=False,
        context=cabana.RunContext(log=quiet.append),
    )
    assert not any(m.startswith("estimated") for m in quiet)


def test_ignored_shortcuts_raise(sim_session):
    with pytest.raises(ValueError, match=r"masks= has no effect on recipe 'social'"):
        cabana.analyze(sim_session, "social", states="social", masks=["speed"], progress=False)
    with pytest.raises(ValueError, match=r"n_shuffles= has no effect on recipe 'event_response'"):
        cabana.analyze(sim_session, "event_response", states="social", n_shuffles=50)
    with pytest.raises(ValueError, match=r"min_shift_s= has no effect on recipe 'event_response'"):
        cabana.recipe_pipeline("event_response", states="social", min_shift_s=10.0)
    with pytest.raises(ValueError, match=r"states= has no effect on recipe 'speed_tuning'"):
        cabana.analyze(sim_session, "speed_tuning", signal="speed", states="social")
    no_shuffle = Pipeline(analyses=[AnalysisSpec(metric={"name": "auroc"}, states="social")])
    for kw in ({"n_shuffles": 50}, {"seed": 3}, {"min_shift_s": 10.0}):
        with pytest.raises(ValueError, match=f"{next(iter(kw))}= has no effect"):
            cabana.analyze(sim_session, no_shuffle, progress=False, **kw)


def test_seed_shortcut_on_pipeline_object(sim_session):
    pipe = cabana.recipe_pipeline("speed_tuning", signal="speed", n_shuffles=40, seed=1)
    _, a = cabana.analyze(sim_session, pipe, seed=7, progress=False)
    assert {r.provenance["seed"] for r in a} == {7}
    assert any(s["path"] == "analyses.*.shuffle.seed" for s in a.selections)
    _, b = cabana.analyze(sim_session, pipe, progress=False)  # no seed: the pipeline's own
    assert {r.provenance["seed"] for r in b} == {1}


def test_min_shift_on_explicit_null_writes_the_null(sim_session):
    shuf = ShuffleConfig(
        n_shuffles=40, null={"name": "circular_shift", "min_shift_s": 20.0}, seed=0
    )
    pipe = Pipeline(
        analyses=[AnalysisSpec(name="a", metric={"name": "auroc"}, states="social", shuffle=shuf)]
    )
    _, res = cabana.analyze(sim_session, pipe, min_shift_s=33.0, progress=False)
    sel = [s for s in res.selections if s["method"] == "user_pick"]
    assert sel and sel[0]["path"].endswith("shuffle.null")
    assert sel[0]["value"]["min_shift_s"] == 33.0
    bad = Pipeline(
        analyses=[
            AnalysisSpec(
                name="a",
                metric={"name": "decode_states"},
                states="social",
                shuffle=ShuffleConfig(n_shuffles=40, null={"name": "label_shuffle"}),
            )
        ]
    )
    with pytest.raises(ValueError, match="label_shuffle.*no min_shift_s"):
        cabana.analyze(sim_session, bad, min_shift_s=10.0, progress=False)


def test_unresolved_placeholder_names_recipe_and_shortcut(sim_session, tmp_path):
    rec = tmp_path / "mine.yaml"
    rec.write_text(
        "recipe: {name: mine, targets: {states: x}}\n"
        "pipeline:\n  analyses:\n  - name: a\n    metric: {name: auroc}\n"
        "    states: ${states}\n    shuffle:\n      n_shuffles: ${n_shuffles}\n"
        "      seed: ${seed}\n"
    )
    with pytest.raises(ValueError, match=r"recipe 'mine' uses \$\{n_shuffles\}.*pass n_shuffles="):
        cabana.analyze(sim_session, rec, states="social", progress=False)
    _, res = cabana.analyze(sim_session, rec, states="social", n_shuffles=40, progress=False)
    assert {r.provenance["seed"] for r in res} == {0}  # unseeded recipes still default to 0


def test_speed_gate_follows_position_units(sim_session):
    assert sim_session.behavior["position"].units == "mm"
    no_mask = sim_session.replace(
        masks={k: v for k, v in sim_session.masks.items() if k != "speed"}
    )
    pipe_steps = []
    notes: list = []
    rec = cabana.recipe("place_cell")
    from cabana import _analyze as A

    pipe = A._build_pipeline(rec, {"states": "position"}, no_mask, notes)
    pipe_steps = [p for p in pipe.preprocess if p.name == "speed_threshold"]
    assert pipe_steps and pipe_steps[0].min_speed == 20.0
    assert not [n for n in notes if n[0] == "warn"]
    # centimetres
    cm = no_mask.replace(meta={**no_mask.meta, "signal_units": {"x": "cm", "y": "cm"}})
    pipe = A._build_pipeline(rec, {"states": "position"}, cm, [])
    assert [p for p in pipe.preprocess if p.name == "speed_threshold"][0].min_speed == 2.0
    # unknown unit: 2 position-units/s and a warning that says how to set it
    unk = no_mask.replace(behavior={})
    notes = []
    pipe = A._build_pipeline(rec, {"states": "position"}, unk, notes)
    assert [p for p in pipe.preprocess if p.name == "speed_threshold"][0].min_speed == 2.0
    warns = [m for k, m in notes if k == "warn"]
    assert warns and "preprocess.speed.min_speed" in warns[0] and "2 position-units/s" in warns[0]
    # an explicit override silences it
    notes = []
    A._build_pipeline(rec, {"states": "position"}, unk, notes, ["preprocess.speed.min_speed"])
    assert not [n for n in notes if n[0] == "warn"]


def test_missing_speed_signal_hint(sim_session):
    bare = sim_session.replace(
        masks={k: v for k, v in sim_session.masks.items() if k != "speed"},
        signals={k: v for k, v in sim_session.signals.items() if k != "speed"},
    )
    with pytest.raises(ValueError, match=r"missing_mask[\s\S]*hint: mask 'speed'.*speed"):
        cabana.analyze(bare, "place_cell", states="position", n_shuffles=20, progress=False)


def test_population_recipe_decoder_uses_label_shuffle():
    pipe = cabana.recipe_pipeline("population", states="syllables", n_shuffles=20)
    nulls = {a.name: a.shuffle.null.name for a in pipe.analyses}
    assert nulls == {
        "pv_stability": "cell_shift",
        "pv_overlap": "cell_shift",
        "decoding": "label_shuffle",
        "participation_ratio": "cell_shift",
    }
    assert pipe.analyses[0].shuffle.null.min_pair_separation_s > 0


def test_social_speed_matched_has_no_selector():
    pipe = cabana.recipe_pipeline("social_speed_matched", states="social", n_shuffles=50)
    assert not pipe.selectors
    assert "syllables" in cabana.recipe("social_speed_matched")["description"]


def test_min_shift_keeps_block_selector_of_population(sim_session):
    pipe = cabana.recipe_pipeline("population", states="syllables", n_shuffles=20, min_shift_s=15.0)
    assert [s.set_min_shift for s in pipe.selectors] == [False]
    assert all(a.shuffle.null.min_shift_s == 15.0 for a in pipe.analyses if a.name != "decoding")


def test_documented_peth_shuffle_recipe_runs(sim_session, tmp_path):
    import re
    from pathlib import Path

    doc = (Path(__file__).resolve().parent.parent / "docs" / "RECIPES.md").read_text()
    block = re.search(r"```yaml\n(recipe:\n  name: peth_shuffle.*?)```", doc, re.S).group(1)
    path = tmp_path / "peth_shuffle.yaml"
    path.write_text(block)
    _, res = cabana.analyze(sim_session, path, states="social", n_shuffles=50, progress=False)
    assert [r.metric for r in res] == ["peth"] and res.status == "ok"
    assert res["peth"].shuffle is not None
