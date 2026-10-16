"""Tests for signal targets, ``AnalysisSpec`` target validation and metric guards."""

from __future__ import annotations

from typing import ClassVar

import numpy as np
import pytest
from pydantic import ValidationError

from cabana import (
    AnalysisSpec,
    GridTopology,
    Metric,
    Pipeline,
    Session,
    StateSpace,
    register,
)
from cabana._shuffle import ShuffleConfig

FS = 10.0
N = 300


@register("metric")
class _TargetsSignalCorr(Metric):
    """Correlation of each cell with a signal (first channel if 2-D)."""

    name: ClassVar[str] = "_test_targets_signal_corr"
    input: ClassVar = "signal"
    default_tail: ClassVar = "two"

    def compute(self, activity, target, mask, fs):
        x = np.asarray(target, float)
        if x.ndim > 1:
            x = x[:, 0]
        x = x[mask]
        a = activity[:, mask]
        xc = x - x.mean()
        ac = a - a.mean(axis=1, keepdims=True)
        return (ac @ xc) / (np.linalg.norm(ac, axis=1) * np.linalg.norm(xc) + 1e-12)


@register("metric")
class _TargetsStateMean(Metric):
    name: ClassVar[str] = "_test_targets_state_mean"

    def compute(self, activity, states, mask, fs):
        m = states.masked(mask)
        return (activity @ m) / np.maximum(m.sum(0), 1)


@register("metric")
class _TargetsNeedsGrid(_TargetsStateMean):
    name: ClassVar[str] = "_test_targets_needs_grid"
    requires_topology: ClassVar[bool] = True


@register("metric")
class _TargetsDeconvOnly(_TargetsStateMean):
    name: ClassVar[str] = "_test_targets_deconv_only"
    accepts_kinds: ClassVar = ("deconvolved",)


def _states(n_time: int = N, n_states: int = 3, topology: bool = False) -> StateSpace:
    lab = (np.arange(n_time) // 10) % n_states
    oh = np.zeros((n_time, n_states), bool)
    oh[np.arange(n_time), lab] = True
    kw = {}
    if topology:
        kw = dict(
            kind="grid",
            topology=GridTopology(
                shape=(n_states,), edges=[np.linspace(0, 1, n_states + 1)], axis_names=["x"]
            ),
        )
    else:
        kw = dict(kind="categorical")
    return StateSpace(
        name="pos",
        onehot=oh,
        state_names=[f"s{i}" for i in range(n_states)],
        exclusive=True,
        **kw,
    )


def _session(**kw) -> Session:
    rng = np.random.default_rng(0)
    speed = np.abs(np.sin(np.arange(N) / 20.0))
    act = rng.random((4, N))
    act[0] += 2 * speed  # cell 0 tracks speed
    base = dict(
        activity=act,
        t=np.arange(N) / FS,
        fs=FS,
        signals={"speed": speed, "xy": np.stack([speed, -speed], axis=1)},
        states={"pos": _states()},
    )
    base.update(kw)
    return Session(**base)


# ---------------------------------------------------------- signal pipeline


def test_signal_metric_runs_through_pipeline() -> None:
    pipe = Pipeline(
        analyses=[AnalysisSpec(metric={"name": "_test_targets_signal_corr"}, signal="speed")]
    )
    _, rs = pipe.run(_session())
    r = rs.get("_test_targets_signal_corr")
    assert r.target == "speed" and r.target_kind == "signal"
    assert r.state_names is None and r.level == "cell"
    assert r.values.shape == (4,)
    assert r.values[0] > 0.5
    assert r.cell_ids == ["0", "1", "2", "3"]
    df = rs.to_dataframe()
    assert "target" in df.columns
    assert (df["target"] == "speed").all() and len(df) == 4


def test_signal_metric_with_shuffle_and_2d_signal() -> None:
    pipe = Pipeline(
        analyses=[
            AnalysisSpec(
                metric={"name": "_test_targets_signal_corr"},
                signal="xy",
                shuffle=ShuffleConfig(n_shuffles=20, min_shift_s=2.0),
            )
        ]
    )
    _, rs = pipe.run(_session())
    r = rs.get("_test_targets_signal_corr", "xy")
    assert r.shuffle is not None and r.shuffle.null.shape == (20, 4)
    assert r.shuffle.null_name == "circular_shift"
    assert r.target_kind == "signal"


def test_states_result_has_target_kind_states() -> None:
    pipe = Pipeline(analyses=[AnalysisSpec(metric={"name": "_test_targets_state_mean"}, states="pos")])
    _, rs = pipe.run(_session())
    r = rs.get("_test_targets_state_mean")
    assert r.target == "pos" and r.target_kind == "states"
    assert r.state_names == ["s0", "s1", "s2"]


# --------------------------------------------------------- spec validation


def test_spec_needs_exactly_one_target() -> None:
    m = {"name": "_test_targets_signal_corr"}
    with pytest.raises(ValidationError):
        AnalysisSpec(metric=m)
    with pytest.raises(ValidationError):
        AnalysisSpec(metric=m, states="pos", signal="speed")
    with pytest.raises(ValidationError):
        AnalysisSpec(metric={"name": "_test_targets_state_mean"})


def test_spec_target_kind_must_match_metric_input() -> None:
    with pytest.raises(ValidationError, match="continuous signal"):
        AnalysisSpec(metric={"name": "_test_targets_signal_corr"}, states="pos")
    with pytest.raises(ValidationError, match="state space"):
        AnalysisSpec(metric={"name": "_test_targets_state_mean"}, signal="speed")


def test_target_property() -> None:
    assert AnalysisSpec(metric={"name": "_test_targets_signal_corr"}, signal="speed").target == "speed"
    assert AnalysisSpec(metric={"name": "_test_targets_state_mean"}, states="pos").target == "pos"


def test_unknown_targets_raise_keyerror_at_run() -> None:
    sig = Pipeline(
        analyses=[AnalysisSpec(metric={"name": "_test_targets_signal_corr"}, signal="nope")]
    )
    with pytest.raises(KeyError, match="nope"):
        sig.run(_session())
    st = Pipeline(analyses=[AnalysisSpec(metric={"name": "_test_targets_state_mean"}, states="nope")])
    with pytest.raises(KeyError, match="nope"):
        st.run(_session())


# ------------------------------------------------------------- check_target


def test_check_target_kind_mismatch() -> None:
    states_metric = _TargetsStateMean()
    signal_metric = _TargetsSignalCorr()
    with pytest.raises(ValueError, match="StateSpace"):
        states_metric.check_target(np.zeros(N))
    with pytest.raises(ValueError, match="continuous signal"):
        signal_metric.check_target(_states())
    states_metric.check_target(_states())  # fine
    signal_metric.check_target(np.zeros(N))  # fine
    signal_metric.check_target(np.zeros((N, 2)))  # fine
    assert states_metric.check_states is not None
    with pytest.raises(ValueError):
        states_metric.check_states(np.zeros(N))  # type: ignore[arg-type]


def test_requires_topology_enforced() -> None:
    m = _TargetsNeedsGrid()
    with pytest.raises(ValueError, match="topology"):
        m.check_target(_states(topology=False))
    m.check_target(_states(topology=True))
    pipe = Pipeline(analyses=[AnalysisSpec(metric=m, states="pos")])
    with pytest.raises(ValueError, match="topology"):
        pipe.run(_session())
    out_sess = _session(states={"pos": _states(topology=True)})
    _, rs = pipe.run(out_sess)
    assert rs.get("_test_targets_needs_grid").values.shape == (4, 3)


def test_requires_topology_enforced_with_shuffle() -> None:
    pipe = Pipeline(
        analyses=[
            AnalysisSpec(
                metric=_TargetsNeedsGrid(),
                states="pos",
                shuffle=ShuffleConfig(n_shuffles=5, min_shift_s=2.0),
            )
        ]
    )
    with pytest.raises(ValueError, match="topology"):
        pipe.run(_session())


# ------------------------------------------------------------ accepts_kinds


def test_accepts_kinds_enforced_in_pipeline() -> None:
    pipe = Pipeline(analyses=[AnalysisSpec(metric={"name": "_test_targets_deconv_only"}, states="pos")])
    _, rs = pipe.run(_session(activity_kind="deconvolved"))
    assert len(rs) == 1
    with pytest.raises(ValueError, match="activity_kind='dff'"):
        pipe.run(_session(activity_kind="dff"))
    with pytest.raises(ValueError):
        _TargetsDeconvOnly().check_activity_kind("spike_counts")
    _TargetsStateMean().check_activity_kind("dff")  # None means any


# --------------------------------------------------------- serialisation


def test_spec_to_dict_includes_signal_and_roundtrips() -> None:
    spec = AnalysisSpec(
        metric={"name": "_test_targets_signal_corr"},
        signal="speed",
        shuffle=ShuffleConfig(n_shuffles=10, null={"name": "label_shuffle", "block_s": 2.0}),
        masks=[],
    )
    d = spec.to_dict()
    assert d["signal"] == "speed" and d["states"] is None
    assert d["shuffle"]["null"] == {"name": "label_shuffle", "block_s": 2.0}
    sd = AnalysisSpec(metric={"name": "_test_targets_state_mean"}, states="pos").to_dict()
    assert sd["states"] == "pos" and sd["signal"] is None

    pipe = Pipeline(analyses=[spec])
    again = Pipeline.from_dict(pipe.to_dict())
    assert again.to_dict() == pipe.to_dict()
    assert again.analyses[0].signal == "speed" and again.analyses[0].states is None
    assert again.analyses[0].target == "speed"
    _, rs = again.run(_session())
    r = rs.get("_test_targets_signal_corr")
    assert r.target_kind == "signal"
    assert r.shuffle is not None and r.shuffle.null_name == "label_shuffle"
    assert r.shuffle.shifts is None


def test_pipeline_yaml_roundtrip_with_signal() -> None:
    pytest.importorskip("yaml")
    pipe = Pipeline(analyses=[AnalysisSpec(metric={"name": "_test_targets_signal_corr"}, signal="speed")])
    again = Pipeline.from_yaml(pipe.to_yaml())
    assert again.analyses[0].signal == "speed"
