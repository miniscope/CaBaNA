"""Tests for cabana.sweep, SweepResult and the significance guard rail."""

from __future__ import annotations

import pickle

import numpy as np
import pytest

import cabana
from cabana import Pipeline, RunContext, ShuffleConfig, Selection, sweep

SIGMA = "analyses.*.metric.smooth_sigma_bins"


def _pipe(shuffle: bool = False, n_shuffles: int = 10) -> Pipeline:
    sh = ShuffleConfig(n_shuffles=n_shuffles, min_shift_s=10.0, seed=0) if shuffle else None
    return Pipeline(
        analyses=[
            {
                "name": "info",
                "metric": {"name": "information_content"},
                "states": "position",
                "shuffle": sh,
            },
            {"name": "split", "metric": {"name": "split_half_stability"}, "states": "position"},
        ]
    )


@pytest.fixture(scope="module")
def sig_sweep(small_session):
    return sweep(small_session, _pipe(), {SIGMA: [0.0, 1.0, 2.0]}, shuffle=False)


def test_points_and_table(small_session, sig_sweep):
    sw = sig_sweep
    assert sw.params == [SIGMA] and len(sw.points) == 3 and sw.status == "ok"
    t = sw.table
    assert list(t.columns) == [
        "point", SIGMA, "analysis", "cell_id", "state", "value",
        "p_value", "p_adj", "significant", "significant_adj",
    ]  # fmt: skip
    n = small_session.n_cells
    assert len(t) == 3 * 2 * n  # both analyses are 1-D per cell
    assert set(t[SIGMA]) == {0.0, 1.0, 2.0}
    assert t["p_value"].isna().all() and not t["significant"].any()


def test_state_axis_rows(small_session):
    pipe = Pipeline(
        analyses=[{"metric": {"name": "auroc"}, "states": "social"}],
    )
    sw = sweep(small_session, pipe, {"analyses.*.masks": [None, ["position_valid"]]}, shuffle=False)
    k = small_session.states["social"].n_states
    assert len(sw.table) == 2 * small_session.n_cells * k


def test_summary_and_stability_shapes(small_session):
    sw = sweep(small_session, _pipe(shuffle=True), {SIGMA: [0.0, 1.0, 2.0]})
    s = sw.summary()
    assert len(s) == 3 * 2
    for c in ("n_cells", "n_significant", "frac_significant", "median_value", "se_value"):
        assert c in s.columns
    assert s.loc[s.analysis == "info", "frac_significant"].between(0, 1).all()
    assert s.loc[s.analysis == "split", "frac_significant"].isna().all()
    cells, overall = sw.stability("info")
    assert len(cells) == small_session.n_cells
    for c in ("n_flips", "modal_significant", "unstable", f"flips[{SIGMA}]"):
        assert c in cells.columns
    assert overall["n_units"] == small_session.n_cells
    assert len(overall["spearman_by_pair"]) == 2
    assert -1 <= overall["spearman_mean"] <= 1
    assert overall["n_unstable"] == int(cells["unstable"].sum())
    st = sw.summary(by="state")
    assert "state" in st.columns


def test_reliability_extras_in_summary(small_session):
    from cabana._sweep import _is_reliability_key

    assert _is_reliability_key("split_r") and _is_reliability_key("loglik")
    assert not _is_reliability_key("rate_map")


def test_transform_path_reruns_transforms(small_session):
    # session without the position grid: the pipeline builds it per point
    raw = cabana.simulate_session(duration_s=120, n_cells=6, seed=1)
    pipe = Pipeline(
        transforms=[
            {"name": "resample_signal", "source": "position"},
            {"name": "bin_grid", "signals": ["x", "y"], "bin_size": 100.0, "output": "position"},
        ],
        analyses=[
            {"name": "info", "metric": {"name": "information_content"}, "states": "position"}
        ],
    )
    sw = sweep(raw, pipe, {"transforms.position.bin_size": [100.0, 200.0]}, shuffle=False)
    sizes = [
        [t for t in rs["info"].provenance["transforms"] if t.get("output") == "position"][0][
            "bin_size"
        ]
        for _, rs in sw.points
    ]
    assert sizes == [100.0, 200.0]
    assert sw.layouts[0]["position"]["shape"] != sw.layouts[1]["position"]["shape"]


def test_fast_path_runs_transforms_once(small_session, monkeypatch):
    calls = []
    orig = Pipeline.iter_run

    def spy(self, session, *, context=None):
        calls.append(len(self.analyses))
        return orig(self, session, context=context)

    monkeypatch.setattr(Pipeline, "iter_run", spy)
    sweep(small_session, _pipe(), {SIGMA: [0.0, 1.0, 2.0]}, shuffle=False)
    assert len(calls) == 1  # one prepare (stopped before analyses), then analyses-only runs


def test_fast_path_with_selector_keeps_selections(small_session):
    pipe = Pipeline.from_dict(
        {**_pipe().to_dict(), "selectors": [{"name": "_test_fixed_sigma", "sigma": 1.5}]}
    )
    sw = sweep(small_session, pipe, {SIGMA: [0.0, 2.0]}, shuffle=False)
    sigmas = [rs.results[0].params["smooth_sigma_bins"] for _, rs in sw.points]
    assert sigmas == [0.0, 2.0]  # the swept value overrides the selector's choice
    sel = sw.points[0][1].results[0].provenance["selections"]
    assert any(s["method"] == "auto_rule" for s in sel)  # the selector's record is kept


def test_shuffle_modes(small_session):
    sw = sweep(small_session, _pipe(shuffle=True), {SIGMA: [0.0, 1.0]}, shuffle=False)
    assert sw.table["p_value"].isna().all()
    with pytest.raises(ValueError, match="no ShuffleConfig"):
        sweep(small_session, _pipe(shuffle=False), {SIGMA: [0.0]}, shuffle=True)
    with pytest.raises(ValueError):
        sweep(small_session, _pipe(), {})
    with pytest.raises(ValueError):
        sweep(small_session, _pipe(), {SIGMA: []})


def test_grid_two_params_and_progress(small_session):
    events = []
    ctx = RunContext(on_progress=events.append)
    over = {SIGMA: [0.0, 1.0], "analyses.*.metric.min_occupancy_s": [0.05, 0.2]}
    sw = sweep(small_session, _pipe(), over, shuffle=False, context=ctx)
    assert len(sw.points) == 4
    assert [e.stage for e in events] == ["analysis"] * 4 + ["done"]
    assert events[-1].fraction == 1.0
    assert sw.stability()[1]["n_units"] > 0
    assert len(sw.stability()[1]["spearman_by_pair"]) == 2 * 2 * 2  # 4 pairs x 2 analyses


def test_cancel_stops_early(small_session):
    n = {"k": 0}

    def cancel():
        n["k"] += 1
        return n["k"] > 3  # prepare consumes some polls; later points are skipped

    sw = sweep(
        small_session, _pipe(), {SIGMA: [0.0, 1.0, 2.0, 3.0, 4.0]}, shuffle=False,
        context=RunContext(should_cancel=cancel),
    )  # fmt: skip
    assert sw.status == "cancelled" and len(sw.points) < 5


def test_pick_guard_rail(sig_sweep):
    for bad in (
        "p_value",
        "p_adj",
        "significant",
        "significant_adj",
        "n_significant",
        "frac_significant",
        "p_whatever",
        "n_significant_adj",
    ):
        with pytest.raises(ValueError, match="degree"):
            sig_sweep.pick(bad, analysis="info")
    sels = sig_sweep.pick("median_value", analysis="info")
    assert isinstance(sels[0], Selection) and not sels[0].informed_by_significance
    assert sels[0].method == "auto_rule" and sels[0].criterion == "median_value"
    assert sels[0].candidates == [0.0, 1.0, 2.0] and len(sels[0].scores) == 3
    with pytest.raises(ValueError, match="several analyses"):
        sig_sweep.pick("median_value")
    with pytest.raises(ValueError, match="not a summary column"):
        sig_sweep.pick("nonsense", analysis="info")


def test_pick_allow_significance(small_session):
    sw = sweep(small_session, _pipe(shuffle=True), {SIGMA: [0.0, 1.0, 2.0]})
    sel = sw.pick("frac_significant", analysis="info", allow_significance=True)[0]
    assert sel.informed_by_significance is True
    ok = sw.pick("median_value", analysis="info", allow_significance=True)[0]
    assert ok.informed_by_significance is False


def test_pick_reliability_one_se_and_apply(small_session, sig_sweep):
    sw = sig_sweep
    s = sw.summary()
    sc = s[s.analysis == "split"]["median_value"].to_numpy()
    sel = sw.pick("median_value", analysis="split", rule="one_se")[0]
    assert sel.method == "sweep_stability" and "one_se" in sel.note
    best = int(np.argmax(sc))
    se = s[s.analysis == "split"]["se_value"].to_numpy()[best]
    first_ok = int(np.flatnonzero(sc >= sc[best] - se)[0])
    assert sel.value == [0.0, 1.0, 2.0][first_ok]
    plat = sw.pick("median_value", analysis="split", rule="plateau")[0]
    assert plat.method == "sweep_stability" and plat.value in (0.0, 1.0, 2.0)
    mx = sw.pick("median_value", analysis="split", rule="min")[0]
    assert mx.value == [0.0, 1.0, 2.0][int(np.argmin(sc))]
    pipe = sw.apply(_pipe())
    assert pipe.selections and pipe.selections[-1].path == SIGMA
    assert pipe.get_param(SIGMA) == [mx.value] * 2
    with pytest.raises(ValueError):
        sweep(small_session, _pipe(), {SIGMA: [0.0]}, shuffle=False).apply(_pipe())


def test_plateau_rule():
    from cabana._sweep import _apply_rule

    s = np.array([0.1, 0.8, 0.9, 0.85, 0.2])
    e = np.full(5, 0.1)
    assert _apply_rule(s, e, "plateau", True) == 2  # run 1..3, middle 2
    assert _apply_rule(s, e, "one_se", True) == 1


def test_save_load_pickle(tmp_path, small_session):
    sw = sweep(small_session, _pipe(shuffle=True), {SIGMA: [0.0, 1.0]})
    sw.pick("median_value", analysis="info")
    sw.save(tmp_path / "sw")
    back = cabana.SweepResult.load(tmp_path / "sw")
    assert back.params == sw.params and back.over == sw.over and len(back.points) == 2
    assert back.layouts == sw.layouts and back.last_picks == sw.last_picks
    a, b = sw.table, back.table
    np.testing.assert_allclose(a["value"].to_numpy(), b["value"].to_numpy(), rtol=1e-6)
    assert list(a["significant"]) == list(b["significant"])
    again = pickle.loads(pickle.dumps(sw))
    assert len(again.points) == 2
    with pytest.raises(ValueError):
        cabana.SweepResult.load(tmp_path)
