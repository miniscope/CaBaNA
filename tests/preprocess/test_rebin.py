"""Tests for ``Session.rebin`` and the ``rebin_time`` preprocess step."""

from __future__ import annotations

from typing import ClassVar

import numpy as np
import pytest

from cabana import (
    AnalysisSpec,
    BoutTable,
    ContinuousSignal,
    GridTopology,
    Metric,
    Pipeline,
    RebinTime,
    Session,
    StateSpace,
    register,
)

FS = 10.0
N = 100


@register("metric")
class _RebinMeanPerState(Metric):
    name: ClassVar[str] = "_test_rebin_mean_per_state"

    def compute(self, activity, states, mask, fs):
        m = states.masked(mask)
        return (activity @ m) / np.maximum(m.sum(0), 1)


def _session(**kw) -> Session:
    rng = np.random.default_rng(0)
    base = dict(
        activity=rng.random((3, N)),
        t=np.arange(N) / FS + 5.0,
        fs=FS,
        cell_ids=["a", "b", "c"],
    )
    base.update(kw)
    return Session(**base)


def _exclusive(labels: np.ndarray, n_states: int, **kw) -> StateSpace:
    oh = np.zeros((labels.size, n_states), bool)
    ok = labels >= 0
    oh[np.flatnonzero(ok), labels[ok]] = True
    return StateSpace(
        name=kw.pop("name", "s"),
        onehot=oh,
        state_names=[f"s{i}" for i in range(n_states)],
        kind=kw.pop("kind", "categorical"),
        exclusive=True,
        **kw,
    )


# --------------------------------------------------------------- basic shape


def test_rebin_shapes_time_and_fs() -> None:
    s = _session()
    r = s.rebin(0.5)
    assert r.n_time == 20 and r.n_cells == 3
    assert r.fs == pytest.approx(2.0)
    expected_t = s.t.reshape(20, 5).mean(axis=1)
    assert np.allclose(r.t, expected_t)
    assert r.cell_ids == ["a", "b", "c"]
    assert r.activity_kind == "deconvolved"
    assert r.meta["rebin"] == {"bin_s": 0.5, "frames_per_bin": 5, "method": "sum"}
    assert "rebin" not in s.meta  # original not mutated
    assert s.n_time == N


def test_rebin_activity_sum_for_deconvolved_and_mean_for_dff() -> None:
    s = _session()
    r = s.rebin(0.5)
    assert np.allclose(r.activity, s.activity.reshape(3, 20, 5).sum(axis=2))
    d = _session(activity_kind="dff").rebin(0.5)
    assert np.allclose(d.activity, s.activity.reshape(3, 20, 5).mean(axis=2))
    assert d.activity_kind == "dff" and d.meta["rebin"]["method"] == "mean"
    sc = _session(activity_kind="spike_counts").rebin(0.5)
    assert sc.meta["rebin"]["method"] == "sum"
    raw = _session(activity_kind="raw").rebin(0.5)
    assert raw.meta["rebin"]["method"] == "mean"


def test_rebin_activity_method_override() -> None:
    s = _session()
    blocks = s.activity.reshape(3, 20, 5)
    assert np.allclose(s.rebin(0.5, activity_method="mean").activity, blocks.mean(axis=2))
    dff = _session(activity_kind="dff")
    assert np.allclose(dff.rebin(0.5, activity_method="sum").activity, blocks.sum(axis=2))
    assert dff.rebin(0.5, activity_method="sum").meta["rebin"]["method"] == "sum"


def test_rebin_drops_trailing_frames() -> None:
    s = _session()
    r = s.rebin(0.3)  # 3 frames per bin -> 33 bins, 1 frame dropped
    assert r.n_time == 33
    assert np.allclose(r.activity, s.activity[:, :99].reshape(3, 33, 3).sum(axis=2))
    assert np.allclose(r.t, s.t[:99].reshape(33, 3).mean(axis=1))
    assert r.fs == pytest.approx(FS / 3)


def test_rebin_k1_returns_self() -> None:
    s = _session()
    assert s.rebin(0.1) is s
    with pytest.warns(UserWarning, match="whole number of frames"):
        assert s.rebin(0.104) is s  # rounds to one frame


def test_rebin_errors() -> None:
    s = _session()
    with pytest.raises(ValueError, match="shorter than one frame"):
        s.rebin(0.01)
    with pytest.raises(ValueError, match="too large"):
        s.rebin(6.0)  # one bin only
    assert s.rebin(5.0).n_time == 2  # two bins is the minimum


# ----------------------------------------------------------- signals / masks


def test_rebin_signals_nanmean() -> None:
    x = np.arange(N, dtype=float)
    x[0:2] = np.nan  # first 5-frame bin partly NaN
    x[5:10] = np.nan  # second bin all NaN
    y = np.stack([np.arange(N, dtype=float), np.ones(N)], axis=1)
    s = _session(signals={"x": x, "y": y})
    import warnings

    with warnings.catch_warnings():
        warnings.simplefilter("error")  # an all-NaN bin must become NaN without a warning
        r = s.rebin(0.5)
    assert r.signals["x"].shape == (20,)
    assert r.signals["x"][0] == pytest.approx(np.mean([2, 3, 4]))
    assert np.isnan(r.signals["x"][1])
    assert r.signals["x"][2] == pytest.approx(12.0)
    assert r.signals["y"].shape == (20, 2)
    assert np.allclose(r.signals["y"][:, 0], np.arange(N).reshape(20, 5).mean(axis=1))
    assert np.allclose(r.signals["y"][:, 1], 1.0)


def test_rebin_mask_min_fraction_boundaries() -> None:
    # k = 4 frames per bin; bin i has (i % 5) True frames -> fractions 0, .25, .5, .75, 1
    m = np.zeros(N, bool)
    for i in range(25):
        m[i * 4 : i * 4 + (i % 5)] = True
    s = _session(masks={"m": m})
    r = s.rebin(0.4)
    counts = np.arange(25) % 5
    assert np.array_equal(r.masks["m"], counts / 4 >= 0.5)
    assert r.masks["m"][2] and not r.masks["m"][1]  # exactly 0.5 passes, 0.25 fails
    strict = s.rebin(0.4, min_fraction=0.75)
    assert np.array_equal(strict.masks["m"], counts / 4 >= 0.75)
    assert not strict.masks["m"][2] and strict.masks["m"][3]
    lax = s.rebin(0.4, min_fraction=0.0)
    assert lax.masks["m"].all()
    full = s.rebin(0.4, min_fraction=1.0)
    assert np.array_equal(full.masks["m"], counts == 4)
    assert r.masks["m"].dtype == bool


# ------------------------------------------------------------------- states


def _labels_for_boundaries() -> np.ndarray:
    """25 bins of 4 frames; the first six exercise the dominance / threshold rules."""
    lab = np.full((25, 4), 2, dtype=int)
    lab[0] = [0, 0, 0, 0]  # pure state 0
    lab[1] = [0, 0, 1, 1]  # 0.5 / 0.5 tie -> lowest index wins, fraction 0.5 passes
    lab[2] = [1, 1, 0, 2]  # state 1 at exactly 0.5
    lab[3] = [0, 1, 2, -1]  # all fractions 0.25 -> nothing
    lab[4] = [1, 1, 1, -1]  # 0.75
    lab[5] = [-1, -1, -1, -1]  # unoccupied
    return lab.ravel()


def test_rebin_exclusive_states_dominant_only() -> None:
    st = _exclusive(_labels_for_boundaries(), 3)
    r = _session(states={"s": st}).rebin(0.4)
    rs = r.states["s"]
    assert rs.onehot.shape == (25, 3) and rs.exclusive
    assert rs.onehot.sum(axis=1).max() <= 1
    got = rs.labels()
    assert list(got[:6]) == [0, 0, 1, -1, 1, -1]
    assert np.all(got[6:] == 2)


def test_rebin_exclusive_states_min_fraction() -> None:
    st = _exclusive(_labels_for_boundaries(), 3)
    r = _session(states={"s": st}).rebin(0.4, min_fraction=0.75)
    got = r.states["s"].labels()
    assert list(got[:6]) == [0, -1, -1, -1, 1, -1]  # only >= 0.75 survive
    r1 = _session(states={"s": st}).rebin(0.4, min_fraction=1.0)
    assert list(r1.states["s"].labels()[:6]) == [0, -1, -1, -1, -1, -1]


def test_rebin_nonexclusive_states_threshold_per_state() -> None:
    oh = np.zeros((N, 2), bool)
    oh[0:2, 0] = True  # bin 0: state 0 at 0.5 -> on
    oh[2:4, 1] = True  # bin 0: state 1 at 0.5 -> on (overlap allowed)
    oh[4:5, 0] = True  # bin 1: state 0 at 0.25 -> off
    oh[5:8, 1] = True  # bin 1: state 1 at 0.75 -> on
    st = StateSpace(name="b", onehot=oh, state_names=["a", "b"], kind="bouts", exclusive=False)
    r = _session(states={"b": st}).rebin(0.4)
    rs = r.states["b"]
    assert not rs.exclusive and rs.kind == "bouts" and rs.state_names == ["a", "b"]
    assert rs.onehot[0].tolist() == [True, True]
    assert rs.onehot[1].tolist() == [False, True]
    assert not rs.onehot[2:].any()
    strict = _session(states={"b": st}).rebin(0.4, min_fraction=0.75)
    assert strict.states["b"].onehot[0].tolist() == [False, False]
    assert strict.states["b"].onehot[1].tolist() == [False, True]


def test_rebin_preserves_topology_and_metadata() -> None:
    topo = GridTopology(shape=(3,), edges=[np.linspace(0, 3, 4)], axis_names=["x"])
    lab = np.arange(N) * 3 // N
    st = _exclusive(lab, 3, name="position", kind="grid", topology=topo)
    r = _session(states={"position": st}).rebin(0.5)
    rs = r.states["position"]
    assert rs.topology is not None and rs.topology == topo
    assert rs.kind == "grid" and rs.name == "position" and rs.state_names == st.state_names
    assert rs.n_time == 20


def test_rebin_behavior_inputs_untouched() -> None:
    pos = ContinuousSignal(t=np.arange(50.0), values=np.zeros((50, 2)), channel_names=["x", "y"])
    bouts = BoutTable(labels=["a"], start_s=np.array([1.0]), stop_s=np.array([2.0]))
    s = _session(behavior={"pos": pos, "bouts": bouts})
    r = s.rebin(0.5)
    assert r.behavior["pos"] is pos and r.behavior["bouts"] is bouts
    assert r.behavior["pos"].values.shape == (50, 2)


# ------------------------------------------------------------ RebinTime step


def _pipeline_session() -> Session:
    n = 200
    t = np.arange(n) / FS
    rng = np.random.default_rng(1)
    pos = ContinuousSignal(
        t=t,
        values=np.stack([np.abs(np.sin(t / 3)), np.abs(np.cos(t / 5))], axis=1),
        channel_names=["x", "y"],
    )
    bouts = BoutTable(
        labels=["chase", "sniff", "chase"],
        start_s=np.array([1.0, 6.0, 12.0]),
        stop_s=np.array([4.0, 9.0, 16.0]),
        scored_start_s=0.0,
        scored_stop_s=18.0,
    )
    return Session(
        activity=rng.random((4, n)),
        t=t,
        fs=FS,
        cell_ids=list("wxyz"),
        behavior={"pos": pos, "bouts": bouts},
    )


def _pipeline_dict() -> dict:
    return {
        "transforms": [
            {"name": "resample_signal", "source": "pos"},
            {"name": "bin_grid", "signals": ["x", "y"], "n_bins": [2, 2], "output": "position"},
            {"name": "bouts_to_states", "source": "bouts", "add_rest": True, "output": "social"},
        ],
        "preprocess": [{"name": "rebin_time", "bin_s": 0.5}],
        "analyses": [
            {"metric": {"name": "_test_rebin_mean_per_state"}, "states": "position", "masks": []},
            {"metric": {"name": "_test_rebin_mean_per_state"}, "states": "social", "masks": []},
        ],
    }


def test_rebin_time_step_in_pipeline() -> None:
    sess = _pipeline_session()
    pipe = Pipeline.from_dict(_pipeline_dict())
    assert isinstance(pipe.preprocess[0], RebinTime)
    out, results = pipe.run(sess)
    assert out.n_time == 40 and out.fs == pytest.approx(2.0)
    assert sess.n_time == 200  # input untouched
    assert out.meta["rebin"]["frames_per_bin"] == 5
    assert out.states["position"].n_time == 40 and out.states["social"].n_time == 40
    assert out.states["position"].topology is not None
    assert "social_scored" in out.masks and out.masks["social_scored"].shape == (40,)
    assert results.get("_test_rebin_mean_per_state", "position").values.shape == (4, 4)
    social = results.get("_test_rebin_mean_per_state", "social")
    assert social.values.shape == (4, 3)
    assert social.state_names == ["chase", "sniff", "rest"]
    assert social.cell_ids == list("wxyz")
    df = results.to_dataframe()
    assert set(df["cell"]) == set("wxyz")
    assert set(df.loc[df["target"] == "social", "state"]) == {"chase", "sniff", "rest"}


def test_pipeline_with_rebin_roundtrips() -> None:
    pipe = Pipeline.from_dict(_pipeline_dict())
    d = pipe.to_dict()
    assert d["preprocess"] == [
        {"name": "rebin_time", "bin_s": 0.5, "activity_method": "auto", "min_fraction": 0.5}
    ]
    again = Pipeline.from_dict(d)
    assert again.to_dict() == d
    assert isinstance(again.preprocess[0], RebinTime)
    assert isinstance(again.analyses[0], AnalysisSpec)
    out1, r1 = pipe.run(_pipeline_session())
    out2, r2 = again.run(_pipeline_session())
    assert np.allclose(out1.activity, out2.activity)
    assert np.allclose(
        r1.get("_test_rebin_mean_per_state", "social").values,
        r2.get("_test_rebin_mean_per_state", "social").values,
    )
