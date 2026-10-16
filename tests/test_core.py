"""Contract tests for the core objects, the registry and the shuffle engine."""

from __future__ import annotations

import numpy as np
import pytest
from pydantic import ValidationError

from cabana import (
    BoutTable,
    ContinuousSignal,
    GridTopology,
    LabelSeries,
    Metric,
    MetricResult,
    ResultSet,
    Session,
    ShuffleResult,
    StateSpace,
    available,
    build,
    register,
)
from cabana._shuffle import ShuffleConfig, draw_shifts, shifted_sums, shuffle_test

T, C, S = 2000, 6, 5
FS = 20.0


def _exclusive_states(rng: np.random.Generator, n_time: int, n_states: int) -> StateSpace:
    oh = np.zeros((n_time, n_states), bool)
    oh[np.arange(n_time), rng.integers(0, n_states, n_time)] = True
    return StateSpace(
        name="s",
        onehot=oh,
        state_names=[f"s{i}" for i in range(n_states)],
        kind="categorical",
        exclusive=True,
    )


@pytest.fixture
def rng() -> np.random.Generator:
    return np.random.default_rng(1)


@pytest.fixture
def session(rng: np.random.Generator) -> Session:
    return Session(activity=rng.random((C, T)), t=np.arange(T) / FS, fs=FS)


# ------------------------------------------------------------------ models


def test_session_shapes_and_defaults(session: Session) -> None:
    assert session.n_cells == C
    assert session.n_time == T
    assert session.cell_ids == [str(i) for i in range(C)]
    assert session.valid_mask().all()
    assert session.duration_s == pytest.approx(T / FS)


def test_session_rejects_mismatched_time(rng: np.random.Generator) -> None:
    with pytest.raises(ValidationError):
        Session(activity=rng.random((C, T)), t=np.arange(T + 1) / FS, fs=FS)


def test_session_rejects_int_activity(rng: np.random.Generator) -> None:
    with pytest.raises(ValidationError):
        Session(activity=rng.integers(0, 3, (C, T)), t=np.arange(T) / FS, fs=FS)


def test_session_with_helpers_do_not_mutate(session: Session, rng: np.random.Generator) -> None:
    st = _exclusive_states(rng, T, S)
    m = rng.random(T) > 0.5
    s2 = session.with_state(st).with_mask("m", m).with_signal("x", np.zeros(T))
    assert session.states == {} and session.masks == {} and session.signals == {}
    assert set(s2.states) == {"s"} and set(s2.masks) == {"m"} and set(s2.signals) == {"x"}
    assert s2.valid_mask().sum() == m.sum()


def test_statespace_exclusive_check_and_labels(rng: np.random.Generator) -> None:
    st = _exclusive_states(rng, T, S)
    lab = st.labels()
    assert lab.shape == (T,)
    assert np.array_equal(st.onehot[np.arange(T), lab], np.ones(T, bool))
    oh = np.ones((T, 2), bool)
    with pytest.raises(ValidationError):
        StateSpace(
            name="bad", onehot=oh, state_names=["a", "b"], kind="categorical", exclusive=True
        )
    non_ex = StateSpace(name="ok", onehot=oh, state_names=["a", "b"], kind="bouts", exclusive=False)
    with pytest.raises(ValueError):
        non_ex.labels()


def test_statespace_occupancy_and_masked(rng: np.random.Generator) -> None:
    st = _exclusive_states(rng, T, S)
    mask = rng.random(T) > 0.3
    assert st.occupancy().sum() == T
    assert st.occupancy(mask).sum() == mask.sum()
    M = st.masked(mask)
    assert M.dtype == np.float64 and M.shape == (T, S)
    assert M[~mask].sum() == 0


def test_grid_topology_validation() -> None:
    topo = GridTopology(
        shape=(2, 3), edges=[np.linspace(0, 1, 3), np.linspace(0, 1, 4)], axis_names=["x", "y"]
    )
    assert topo.n_states == 6 and topo.ndim == 2
    assert [len(c) for c in topo.centers()] == [2, 3]
    with pytest.raises(ValidationError):
        GridTopology(shape=(2, 3), edges=[np.linspace(0, 1, 3)], axis_names=["x", "y"])
    oh = np.zeros((10, 6), bool)
    with pytest.raises(ValidationError):  # grid kind needs a topology
        StateSpace(name="g", onehot=oh, state_names=list("abcdef"), kind="grid", exclusive=True)
    with pytest.raises(ValidationError):  # topology size must match
        StateSpace(
            name="g",
            onehot=oh[:, :5],
            state_names=list("abcde"),
            kind="grid",
            exclusive=True,
            topology=topo,
        )


def test_behavior_inputs_validate() -> None:
    sig = ContinuousSignal(t=np.arange(5.0), values=np.zeros((5, 2)), channel_names=["x", "y"])
    assert sig.values.shape == (5, 2)
    with pytest.raises(ValidationError):
        ContinuousSignal(t=np.arange(5.0), values=np.zeros((5, 2)), channel_names=["x"])
    bt = BoutTable(
        labels=["a", "b", "a"], start_s=np.array([0.0, 1, 2]), stop_s=np.array([1.0, 2, 3])
    )
    assert bt.behavior_names == ["a", "b"]
    with pytest.raises(ValidationError):
        BoutTable(labels=["a"], start_s=np.array([2.0]), stop_s=np.array([1.0]))
    ls = LabelSeries(t=np.arange(4.0), labels=np.array([0, 1, -1, 1]), label_names=["p", "q"])
    assert ls.labels.min() == -1
    with pytest.raises(ValidationError):
        LabelSeries(t=np.arange(2.0), labels=np.array([0, 5]), label_names=["p"])


# ---------------------------------------------------------------- registry


@register("metric")
class _MeanInState(Metric):
    """Test metric: mean activity per state. Linear in activity -> has a fast path."""

    name = "_test_mean_in_state"
    default_tail = "two"

    def compute(self, activity, states, mask, fs):
        M = states.masked(mask)
        return (activity @ M) / np.maximum(M.sum(0), 1)

    def compute_shifted(self, activity, states, mask, fs, shifts):
        M = states.masked(mask)
        return shifted_sums(activity, M, shifts) / np.maximum(M.sum(0), 1)


class _SlowMeanInState(_MeanInState):
    name = "_test_slow_mean_in_state"

    def compute_shifted(self, *args):
        return None


def test_registry_build_roundtrip() -> None:
    assert "_test_mean_in_state" in available("metric")
    m = build("metric", {"name": "_test_mean_in_state"})
    assert isinstance(m, _MeanInState)
    assert m.to_dict() == {"name": "_test_mean_in_state"}
    with pytest.raises(KeyError):
        build("metric", {"name": "does_not_exist"})
    with pytest.raises(KeyError):
        build("metric", {})
    with pytest.raises(ValidationError):  # extra="forbid"
        build("metric", {"name": "_test_mean_in_state", "bogus": 1})


def test_register_rejects_wrong_base() -> None:
    with pytest.raises(TypeError):

        @register("transform")
        class _Bad(Metric):
            name = "_bad"

            def compute(self, *a):
                return np.zeros(1)


# ------------------------------------------------------------------ shuffle


def test_shifted_sums_matches_explicit_roll(rng: np.random.Generator) -> None:
    x = rng.random((C, T))
    st = _exclusive_states(rng, T, S)
    mask = rng.random(T) > 0.3
    shifts = np.array([0, 1, 7, 123, T - 5, T - 1])
    fast = shifted_sums(x, st.masked(mask), shifts)
    slow = np.stack([np.roll(x, k, axis=1) @ st.masked(mask) for k in shifts])
    assert fast.shape == (len(shifts), C, S)
    np.testing.assert_allclose(fast, slow, rtol=0, atol=1e-9)


def test_draw_shifts_respects_bounds(rng: np.random.Generator) -> None:
    sh = draw_shifts(1000, 500, 100, rng)
    assert sh.min() >= 100 and sh.max() <= 900 and len(set(sh)) == 500
    with pytest.warns(UserWarning, match=r"1/\(801\+1\)"):
        sh = draw_shifts(1000, 900, 100, rng)  # more draws than candidates -> with replacement
    assert sh.min() >= 100 and sh.max() <= 900
    with pytest.warns(UserWarning, match="distinct circular shifts"):
        sh = draw_shifts(100, 10, 1000, rng)  # min_shift clamped below half the session
    assert sh.min() >= 1


def test_shuffle_fast_and_slow_paths_agree(rng: np.random.Generator) -> None:
    x = rng.random((C, T))
    st = _exclusive_states(rng, T, S)
    mask = rng.random(T) > 0.3
    cfg = ShuffleConfig(n_shuffles=64, min_shift_s=1.0, seed=3, batch_size=10)
    fast = shuffle_test(_MeanInState(), x, st, mask, cfg, FS)
    slow = shuffle_test(_SlowMeanInState(), x, st, mask, cfg, FS)
    np.testing.assert_array_equal(fast.shifts, slow.shifts)
    np.testing.assert_allclose(fast.null, slow.null, atol=1e-9)
    np.testing.assert_allclose(fast.observed, slow.observed, atol=1e-9)
    assert fast.null.shape == (64, C, S)
    assert fast.tail == "two"  # inherited from metric.default_tail


def test_shuffle_p_values_and_bounds(rng: np.random.Generator) -> None:
    x = rng.random((C, T))
    st = _exclusive_states(rng, T, S)
    mask = np.ones(T, bool)
    cfg = ShuffleConfig(n_shuffles=99, min_shift_s=1.0, seed=0, tail="upper", alpha=0.1)
    r = shuffle_test(_MeanInState(), x, st, mask, cfg, FS)
    ge = (r.null >= r.observed[None]).sum(0)
    np.testing.assert_allclose(r.p_value, (ge + 1) / 100)
    assert r.p_value.min() >= 1 / 100 and r.p_value.max() <= 1
    np.testing.assert_array_equal(r.significant, r.p_value < 0.1)
    np.testing.assert_allclose(r.null_hi, np.percentile(r.null, 90, axis=0))
    np.testing.assert_allclose(r.null_lo, np.percentile(r.null, 10, axis=0))


def test_shuffle_false_positive_rate_is_nominal() -> None:
    """Untuned cells vs random states: ~alpha of (cell, state) pairs are 'significant'."""
    rng = np.random.default_rng(7)
    n_cells, n_time, n_states = 40, 4000, 8
    x = rng.poisson(0.2, (n_cells, n_time)).astype(float)
    st = _exclusive_states(rng, n_time, n_states)
    cfg = ShuffleConfig(n_shuffles=200, min_shift_s=1.0, seed=0, tail="two", alpha=0.05)
    r = shuffle_test(_MeanInState(), x, st, np.ones(n_time, bool), cfg, FS)
    fpr = r.significant.mean()
    assert 0.02 <= fpr <= 0.09, fpr


def test_shuffle_detects_planted_tuning() -> None:
    rng = np.random.default_rng(11)
    n_time, n_states = 6000, 6
    st = _exclusive_states(rng, n_time, n_states)
    lab = st.labels()
    rate = np.where(lab == 2, 2.0, 0.1)  # cell 0 tuned to state 2
    x = np.stack([rng.poisson(rate), rng.poisson(0.3, n_time)]).astype(float)
    cfg = ShuffleConfig(n_shuffles=300, min_shift_s=1.0, seed=0, tail="two")
    r = shuffle_test(_MeanInState(), x, st, np.ones(n_time, bool), cfg, FS)
    assert r.p_value[0, 2] < 0.01
    assert r.observed[0, 2] > r.null_hi[0, 2]
    # the tuned state has the largest observed value; chance hits on the untuned cell are
    # covered by test_shuffle_false_positive_rate_is_nominal
    assert r.observed[0].argmax() == 2


# ------------------------------------------------------------------ results


def test_metric_result_dataframe_shapes() -> None:
    vals = np.arange(6, dtype=float).reshape(2, 3)
    r = MetricResult(
        metric="m",
        target="s",
        level="cell",
        values=vals,
        cell_ids=["a", "b"],
        state_names=list("xyz"),
    )
    df = r.to_dataframe()
    assert len(df) == 6 and list(df.columns[:5]) == ["metric", "target", "cell", "state", "value"]
    assert df.loc[(df.cell == "b") & (df.state == "z"), "value"].item() == 5.0
    assert df.p_value.isna().all() and not df.significant.any()
    r1 = MetricResult(metric="m1", target="s", level="cell", values=np.array([1.0, 2.0]))
    assert len(r1.to_dataframe()) == 2
    rp = MetricResult(metric="pop", target="s", level="population", values=np.eye(3))
    rs = ResultSet()
    rs.add(r)
    rs.add(r1)
    rs.add(rp)
    assert len(rs) == 3
    assert len(rs.to_dataframe()) == 8  # population *matrices* excluded from the tidy table
    # 1-D population results (e.g. pv_stability) appear as per-state rows with their p-values
    sh = ShuffleResult(
        observed=np.array([0.9, 0.1]),
        null=np.zeros((5, 2)),
        shifts=np.arange(5),
        p_value=np.array([0.01, 0.8]),
        null_lo=np.zeros(2),
        null_hi=np.ones(2),
        significant=np.array([True, False]),
        alpha=0.05,
        tail="upper",
        n_shuffles=5,
    )
    rs.add(
        MetricResult(
            metric="pv",
            target="s",
            level="population",
            values=sh.observed,
            shuffle=sh,
            state_names=["a", "b"],
        )
    )
    df = rs.to_dataframe()
    assert len(df) == 10
    row = df[(df.metric == "pv") & (df.state == "a")].iloc[0]
    assert row.cell is None and row.p_value == 0.01 and bool(row.significant) is True
    assert rs.get("pop").values.shape == (3, 3)
    with pytest.raises(KeyError):
        rs.get("nope")
