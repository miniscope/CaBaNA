from typing import ClassVar

import numpy as np
import pytest
from pydantic import Field

from cabana import BoutTable, Metric, Session, StateSpace, register
from cabana._pipeline import AnalysisSpec, Pipeline
from cabana._shuffle import ShuffleConfig, shifted_sums

FS = 10.0
N = 200


@register("metric")
class _MeanPerState(Metric):
    name: ClassVar[str] = "test_mean_per_state"
    scale: float = Field(1.0, description="Multiplier.")

    def compute(self, activity, states, mask, fs):
        m = states.masked(mask)
        occ = m.sum(axis=0)
        with np.errstate(invalid="ignore", divide="ignore"):
            return self.scale * (activity @ m) / occ

    def compute_shifted(self, activity, states, mask, fs, shifts):
        m = states.masked(mask)
        occ = m.sum(axis=0)
        with np.errstate(invalid="ignore", divide="ignore"):
            return self.scale * shifted_sums(activity, m, shifts) / occ

    def extras(self, activity, states, mask, fs):
        return {"occupancy_s": states.masked(mask).sum(axis=0) / fs}


@register("metric")
class _PopTotal(Metric):
    name: ClassVar[str] = "test_pop_total"
    level: ClassVar[str] = "population"

    def compute(self, activity, states, mask, fs):
        return states.masked(mask).sum(axis=0)


def make_session():
    rng = np.random.default_rng(1)
    lab = np.repeat([0, 1, 2, 0], N // 4)
    onehot = np.eye(3, dtype=bool)[lab]
    act = rng.random((4, N))
    act[0, lab == 1] += 5.0  # cell 0 prefers state 1
    sp = StateSpace(
        name="cat", onehot=onehot, state_names=["a", "b", "c"], kind="categorical", exclusive=True
    )
    return Session(
        activity=act,
        t=np.arange(N) / FS,
        fs=FS,
        cell_ids=["c0", "c1", "c2", "c3"],
        states={"cat": sp},
    ), lab


def test_run_no_shuffle():
    s, lab = make_session()
    pipe = Pipeline(
        preprocess=[{"name": "time_range", "start_s": 0.0, "stop_s": 15.0}],
        analyses=[AnalysisSpec(metric={"name": "test_mean_per_state"}, states="cat")],
    )
    out, rs = pipe.run(s)
    assert "time_range" in out.masks and not s.masks
    r = rs.get("test_mean_per_state")
    keep = np.arange(N) <= 150
    expected = np.stack([s.activity[:, keep & (lab == k)].mean(axis=1) for k in range(3)], axis=1)
    np.testing.assert_allclose(r.values, expected)
    assert r.shuffle is None and r.cell_ids == ["c0", "c1", "c2", "c3"]
    assert r.state_names == ["a", "b", "c"] and r.level == "cell"
    assert r.params == {"name": "test_mean_per_state", "scale": 1.0}
    assert "occupancy_s" in r.extras
    df = rs.to_dataframe()
    assert len(df) == 12
    assert set(df["state"]) == {"a", "b", "c"} and set(df["cell"]) == {"c0", "c1", "c2", "c3"}
    assert not df["significant"].any()


def test_run_with_shuffle():
    s, _ = make_session()
    cfg = ShuffleConfig(n_shuffles=50, min_shift_s=0.5, seed=3, tail="upper")
    pipe = Pipeline(
        analyses=[
            AnalysisSpec(metric={"name": "test_mean_per_state", "scale": 2.0}, states="cat", shuffle=cfg)
        ]
    )
    _, rs = pipe.run(s, progress=False)
    r = rs.results[0]
    assert r.shuffle is not None and r.shuffle.null.shape == (50, 4, 3)
    np.testing.assert_array_equal(r.values, r.shuffle.observed)
    assert (r.shuffle.p_value >= 1 / 51 - 1e-12).all()
    df = rs.to_dataframe()
    assert len(df) == 12 and df["p_value"].notna().all()
    row = df[(df["cell"] == "c0") & (df["state"] == "b")].iloc[0]
    assert row["significant"] and row["p_value"] == pytest.approx(1 / 51)


def test_population_level_and_1d_state_names():
    s, _ = make_session()
    pipe = Pipeline(analyses=[{"metric": {"name": "test_pop_total"}, "states": "cat"}])
    _, rs = pipe.run(s)
    r = rs.results[0]
    assert r.cell_ids is None and r.state_names == ["a", "b", "c"]
    np.testing.assert_array_equal(r.values, [100, 50, 50])
    assert len(rs.to_dataframe()) == 3  # 1-D population results appear as per-state rows


def test_unknown_states_error_lists_available():
    s, _ = make_session()
    pipe = Pipeline(analyses=[AnalysisSpec(metric={"name": "test_pop_total"}, states="nope")])
    with pytest.raises(KeyError, match="cat"):
        pipe.run(s)


def test_progress_prints(capsys):
    s, _ = make_session()
    Pipeline(
        preprocess=[{"name": "zscore_activity"}],
        analyses=[AnalysisSpec(metric={"name": "test_pop_total"}, states="cat")],
    ).run(s, progress=True)
    lines = capsys.readouterr().out.strip().splitlines()
    assert len(lines) == 2


def test_end_to_end_transforms_to_results():
    t = np.arange(N) / FS
    rng = np.random.default_rng(0)
    s = Session(
        activity=rng.random((3, N)),
        t=t,
        fs=FS,
        behavior={
            "bouts": BoutTable(labels=["x", "y"], start_s=np.array([1.0, 8.0]),
                               stop_s=np.array([4.0, 12.0]), scored_start_s=0.0, scored_stop_s=18.0)
        },
    )
    pipe = Pipeline(
        transforms=[{"name": "bouts_to_states", "source": "bouts", "add_rest": True}],
        analyses=[AnalysisSpec(metric={"name": "test_mean_per_state"}, states="social")],
    )
    out, rs = pipe.run(s)
    assert out.states["social"].state_names == ["x", "y", "rest"]
    assert rs.results[0].values.shape == (3, 3)
    assert s.states == {}


def test_dict_roundtrip_and_instances():
    d = {
        "transforms": [
            {"name": "bin_grid", "signals": ["x", "y"], "bin_size": None, "n_bins": [3, 4],
             "extent": [(0.0, 1.0), (0.0, 2.0)], "output": "position"},
            {"name": "speed", "signals": ["x", "y"], "window_s": 0.5, "output": "speed"},
        ],
        "preprocess": [
            {"name": "speed_threshold", "signal": "speed", "min_speed": 2.0, "max_speed": None,
             "output": "speed"},
        ],
        "analyses": [
            {"metric": {"name": "test_mean_per_state", "scale": 3.0}, "states": "position", "signal": None,
             "shuffle": ShuffleConfig(n_shuffles=10, min_shift_s=1.0).model_dump(), "masks": None},
            {"metric": {"name": "test_pop_total"}, "states": "position", "signal": None, "shuffle": None, "masks": None},
        ],
    }
    p = Pipeline.from_dict(d)
    assert p.transforms[0].name == "bin_grid" and not isinstance(p.transforms[0], dict)
    assert isinstance(p.analyses[0].metric, Metric)
    assert p.to_dict() == d
    assert Pipeline.from_dict(p.to_dict()) == p
    assert Pipeline().to_dict() == {"transforms": [], "preprocess": [], "analyses": []}


def test_yaml_roundtrip():
    pytest.importorskip("yaml")
    p = Pipeline(
        transforms=[{"name": "bin_grid", "n_bins": 3, "extent": [(0, 1), (0, 2)]}],
        analyses=[AnalysisSpec(metric={"name": "test_mean_per_state"}, states="position",
                               shuffle=ShuffleConfig(n_shuffles=5))],
    )
    p2 = Pipeline.from_yaml(p.to_yaml())
    assert p2.to_dict() == p.to_dict()


def test_unknown_plugin_name():
    with pytest.raises(Exception, match="unknown"):
        Pipeline(transforms=[{"name": "nope"}])
