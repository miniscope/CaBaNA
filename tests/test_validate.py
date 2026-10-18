"""Pipeline.validate / cabana.validate_pipeline."""

from __future__ import annotations

import json

import cabana
from cabana import AnalysisSpec, Pipeline, ShuffleConfig


def _one(metric, states="social", shuffle=None, masks=None, name="a", **kw):
    return Pipeline(
        analyses=[
            AnalysisSpec(
                name=name, metric=metric, states=states, shuffle=shuffle, masks=masks, **kw
            )
        ]
    )


def _codes(report, level="error"):
    return {i.code for i in report.issues if i.level == level}


def test_demo_style_pipeline_is_ok(sim_session):
    shuf = ShuffleConfig(n_shuffles=50, min_shift_s=20.0, seed=1)
    pipe = Pipeline(
        preprocess=[{"name": "speed_threshold", "signal": "speed", "min_speed": 5.0}],
        analyses=[
            AnalysisSpec(
                name="info",
                metric={"name": "information_content"},
                states="position",
                shuffle=shuf,
                masks=["speed"],
            ),
            AnalysisSpec(name="auc", metric={"name": "auroc"}, states="social", shuffle=shuf),
        ],
    )
    rep = pipe.validate(sim_session)
    assert rep.ok and isinstance(rep, cabana.ValidationReport)
    assert set(rep.estimates) == {"info", "auc"}
    for e in rep.estimates.values():
        assert e["n_frames_used"] > 0 and e["memory_bytes"] > 0
    assert rep.estimates["info"]["time_s"] > 0
    assert rep.total_time_s > 0 and rep.peak_memory_bytes > 0
    text = str(rep)
    assert "info" in text and "auc" in text and "OK" in text
    json.dumps(rep.to_dict())  # plain data


def test_missing_target_and_mask_and_kind(sim_session):
    rep = _one({"name": "auroc"}, states="nope").validate(sim_session)
    assert not rep.ok and "missing_target" in _codes(rep) and "nope" in str(rep)
    rep = _one({"name": "signal_tuning"}, states=None, signal="nope").validate(sim_session)
    assert "missing_target" in _codes(rep)
    rep = _one({"name": "auroc"}, masks=["ghost"]).validate(sim_session)
    assert "missing_mask" in _codes(rep)
    rep = _one({"name": "place_fields"}, states="social").validate(sim_session)
    assert "needs_topology" in _codes(rep)


def test_bad_shuffle_counts_and_alpha(sim_session):
    rep = _one({"name": "auroc"}, shuffle=ShuffleConfig(n_shuffles=10)).validate(sim_session)
    assert "cannot_reach_alpha" in _codes(rep)  # two-tailed floor 2/11
    rep = _one(
        {"name": "information_content"}, states="position", shuffle=ShuffleConfig(n_shuffles=10)
    ).validate(sim_session)
    assert "cannot_reach_alpha" in _codes(rep)  # one-tailed floor 1/11 > 0.05
    rep = _one(
        {"name": "information_content"},
        states="position",
        shuffle=ShuffleConfig(n_shuffles=100, alpha=0.001),
    ).validate(sim_session)
    assert "cannot_reach_alpha" in _codes(rep)
    rep = _one(
        {"name": "information_content"},
        states="position",
        shuffle=ShuffleConfig(n_shuffles=100, alpha=0.05),
    ).validate(sim_session)
    assert rep.ok


def test_min_shift_against_session_length(sim_session):
    long = ShuffleConfig(n_shuffles=100, min_shift_s=400.0)  # session is 600 s
    rep = _one({"name": "information_content"}, states="position", shuffle=long).validate(
        sim_session
    )
    assert "min_shift_too_long" in _codes(rep)
    mid = ShuffleConfig(n_shuffles=100, min_shift_s=200.0)
    rep = _one({"name": "information_content"}, states="position", shuffle=mid).validate(
        sim_session
    )
    assert rep.ok and "min_shift_long" in _codes(rep, "warning")


def test_degenerate_and_recommended_nulls(sim_session):
    within = ShuffleConfig(n_shuffles=100, null={"name": "within_state_shuffle"})
    rep = _one({"name": "mean_per_state"}, shuffle=within).validate(sim_session)
    assert "degenerate_null" in _codes(rep)
    rep = _one({"name": "split_half_stability"}, states="position", shuffle=within).validate(
        sim_session
    )
    assert "degenerate_null" not in _codes(rep)
    cell = ShuffleConfig(n_shuffles=100, null={"name": "cell_shift"})
    rep = _one({"name": "information_content"}, states="position", shuffle=cell).validate(
        sim_session
    )
    assert "cell_shift_cell_level" in _codes(rep, "warning")
    rep = _one(
        {"name": "participation_ratio"}, states="syllables", shuffle=ShuffleConfig(n_shuffles=100)
    ).validate(sim_session)
    assert "prefer_cell_shift" in _codes(rep, "info")


def test_correction_hint_and_empty_states(sim_session):
    rep = _one({"name": "auroc"}, shuffle=ShuffleConfig(n_shuffles=100)).validate(sim_session)
    assert "no_correction" in _codes(rep, "info")
    rep = _one(
        {"name": "auroc"}, shuffle=ShuffleConfig(n_shuffles=100, correction="max_stat")
    ).validate(sim_session)
    assert "no_correction" not in _codes(rep, "info")
    # a mask that removes everything of one state, then everything
    import numpy as np

    ids = sim_session.states["syllables"]
    first = np.flatnonzero(ids.onehot[:, 0])
    mask = np.ones(sim_session.n_time, bool)
    mask[first] = False
    s2 = sim_session.replace(masks={**sim_session.masks, "no_first": mask})
    rep = _one({"name": "information_content"}, states="syllables", masks=["no_first"]).validate(s2)
    assert "empty_states" in _codes(rep, "warning")
    s3 = sim_session.replace(
        masks={**sim_session.masks, "none": np.zeros(sim_session.n_time, bool)}
    )
    rep = _one({"name": "information_content"}, states="syllables", masks=["none"]).validate(s3)
    assert "no_frames" in _codes(rep)


def test_little_data_warning(small_session):
    short = small_session.replace(
        masks={**small_session.masks, "first": (np_arange(small_session) < 400)}
    )
    rep = _one({"name": "information_content"}, states="syllables", masks=["first"]).validate(short)
    assert "little_data" in _codes(rep, "warning")


def np_arange(s):
    import numpy as np

    return np.arange(s.n_time)


def test_prepare_failure_and_check_exception_become_issues(sim_session):
    bad = Pipeline(transforms=[{"name": "speed", "signals": ["nope"], "output": "s2"}])
    rep = bad.validate(sim_session)
    assert not rep.ok and "prepare_failed" in _codes(rep)
    # a selector that cannot run is reported and the checks still happen
    pipe = Pipeline(
        selectors=[{"name": "auto_smooth_sigma", "states": "nope"}],
        analyses=[AnalysisSpec(name="a", metric={"name": "auroc"}, states="nope")],
    )
    rep = pipe.validate(sim_session)
    assert "missing_target" in _codes(rep)


def test_time_budget_leaves_estimates_empty(sim_session):
    shuf = ShuffleConfig(n_shuffles=50)
    pipe = Pipeline(
        analyses=[
            AnalysisSpec(name="a", metric={"name": "auroc"}, states="social", shuffle=shuf),
            AnalysisSpec(name="b", metric={"name": "auroc"}, states="syllables", shuffle=shuf),
        ]
    )
    rep = pipe.validate(sim_session, time_budget_s=0.0)
    assert rep.estimates["a"]["time_s"] is not None  # the first one is always timed
    assert rep.estimates["b"]["time_s"] is None
    assert rep.estimates["b"]["memory_bytes"] > 0


def test_estimate_grows_with_n_shuffles(sim_session):
    def total(n):
        p = _one(
            {"name": "information_content"}, states="position", shuffle=ShuffleConfig(n_shuffles=n)
        )
        return p.validate(sim_session).estimates["a"]

    lo, hi = total(100), total(1000)
    assert hi["memory_bytes"] > lo["memory_bytes"]
    assert hi["time_s"] > lo["time_s"]
