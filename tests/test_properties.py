"""Hypothesis property tests on tiny arrays (no simulator)."""

from __future__ import annotations

import tempfile
from pathlib import Path

import numpy as np
import pytest
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from hypothesis.extra import numpy as hnp

from cabana import ResultSet, StateSpace, build
from cabana import _statesums as ss
from cabana._results import MetricResult
from cabana._shuffle import ShuffleConfig, adjust_p_values, shifted_sums, shuffle_test

FS = 10.0
SETTINGS = settings(max_examples=60, deadline=None, suppress_health_check=[HealthCheck.too_slow])
finite = st.floats(0.0, 10.0, allow_nan=False, allow_infinity=False, width=32)


def _states(labels: np.ndarray, n_states: int) -> StateSpace:
    onehot = np.zeros((labels.size, n_states), dtype=bool)
    ok = labels >= 0
    onehot[np.flatnonzero(ok), labels[ok]] = True
    return StateSpace(
        name="s",
        onehot=onehot,
        state_names=[str(i) for i in range(n_states)],
        kind="categorical",
        exclusive=True,
    )


@st.composite
def problem(draw, max_states=40, min_cells=2, max_cells=6, min_time=60, max_time=120):
    """(activity, labels, n_states): non-negative activity, exclusive labels (-1 = none)."""
    n_states = draw(st.integers(2, max_states))
    n_cells = draw(st.integers(min_cells, max_cells))
    n_time = draw(st.integers(min_time, max_time))
    act = draw(hnp.arrays(np.float64, (n_cells, n_time), elements=finite))
    labels = draw(hnp.arrays(np.int64, n_time, elements=st.integers(-1, n_states - 1)))
    return act, labels, n_states


class _ForceLabelPath:
    def __init__(self, value: int):
        self.value = value

    def __enter__(self):
        self.old = ss.DENSE_MAX_STATES
        ss.DENSE_MAX_STATES = self.value

    def __exit__(self, *exc):
        ss.DENSE_MAX_STATES = self.old


# (a) dense == label path -------------------------------------------------------------


@SETTINGS
@given(problem(), st.data())
def test_dense_equals_label_path(p, data):
    act, labels, n_states = p
    n_time = act.shape[1]
    sp = _states(labels, n_states)
    mask = data.draw(hnp.arrays(np.bool_, n_time, elements=st.booleans()))
    shifts = np.array(
        data.draw(st.lists(st.integers(-3 * n_time, 3 * n_time), min_size=1, max_size=4))
    )
    with _ForceLabelPath(10**9):
        dense = ss.shifted_sums_for(act, sp, mask, shifts)
        mean_dense = build("metric", {"name": "mean_per_state"}).compute_shifted(
            act, sp, mask, FS, shifts
        )
    with _ForceLabelPath(0):
        lab = ss.shifted_sums_for(act, sp, mask, shifts)
        mean_lab = build("metric", {"name": "mean_per_state"}).compute_shifted(
            act, sp, mask, FS, shifts
        )
    np.testing.assert_allclose(lab, dense, rtol=1e-9, atol=1e-9)
    np.testing.assert_allclose(mean_lab, mean_dense, rtol=1e-9, atol=1e-9, equal_nan=True)
    ref = shifted_sums(act, sp.masked(mask), shifts)
    np.testing.assert_allclose(lab, ref, rtol=1e-9, atol=1e-9)


# (b) cell-permutation invariance ----------------------------------------------------


@pytest.mark.parametrize("metric_name", ["mean_per_state", "information_content"])
@SETTINGS
@given(problem(max_states=6, min_cells=3, min_time=100), st.randoms(use_true_random=False))
def test_cell_permutation_invariance(metric_name, p, rnd):
    act, labels, n_states = p
    sp = _states(labels, n_states)
    mask = np.ones(act.shape[1], dtype=bool)
    perm = np.arange(act.shape[0])
    rnd.shuffle(perm)
    metric = build("metric", {"name": metric_name})
    cfg = ShuffleConfig(n_shuffles=20, min_shift_s=1.0, seed=5)
    a = shuffle_test(metric, act, sp, mask, cfg, FS)
    b = shuffle_test(metric, act[perm], sp, mask, cfg, FS)
    for field in ("observed", "p_value", "null_lo", "null_hi", "null_median"):
        np.testing.assert_allclose(
            getattr(b, field), getattr(a, field)[perm], rtol=1e-9, atol=1e-12, equal_nan=True
        )
    np.testing.assert_array_equal(a.shifts, b.shifts)


# (c) shift 0 == observed ------------------------------------------------------------


@pytest.mark.parametrize("metric_name", ["mean_per_state", "information_content"])
@SETTINGS
@given(problem(max_states=8))
def test_zero_shift_reproduces_observed(metric_name, p):
    act, labels, n_states = p
    sp = _states(labels, n_states)
    mask = np.ones(act.shape[1], dtype=bool)
    metric = build("metric", {"name": metric_name})
    shifted = metric.compute_shifted(act, sp, mask, FS, np.array([0, act.shape[1]]))
    obs = metric.compute(act, sp, mask, FS)
    for row in shifted:  # shift 0 and a full-length shift are both the identity
        np.testing.assert_allclose(row, obs, rtol=1e-9, atol=1e-12, equal_nan=True)


# (d) p-values -----------------------------------------------------------------------


@pytest.mark.parametrize("tail", ["upper", "lower"])
@SETTINGS
@given(problem(max_states=5, min_time=100))
def test_p_values_match_stored_null(tail, p):
    act, labels, n_states = p
    sp = _states(labels, n_states)
    mask = np.ones(act.shape[1], dtype=bool)
    n = 25
    cfg = ShuffleConfig(n_shuffles=n, min_shift_s=1.0, seed=3, tail=tail, keep_null="full")
    r = shuffle_test(build("metric", {"name": "mean_per_state"}), act, sp, mask, cfg, FS)
    assert r.null is not None and r.null.shape[0] == n
    fin = np.isfinite(r.observed)
    p_ = r.p_value[fin]
    assert np.all((p_ > 0) & (p_ <= 1))
    assert p_.size == 0 or p_.min() >= 1 / (n + 1) - 1e-15
    cmp = (r.null >= r.observed[None]) if tail == "upper" else (r.null <= r.observed[None])
    ge = (cmp & np.isfinite(r.null)).sum(axis=0)
    n_valid = np.isfinite(r.null).sum(axis=0)
    expected = (ge + 1) / (n_valid + 1)
    np.testing.assert_allclose(r.p_value[fin], expected[fin], rtol=1e-12)
    np.testing.assert_array_equal(r.significant, np.where(fin, r.p_value < cfg.alpha, False))


# (e) multiple-comparison adjustment ---------------------------------------------------

p_arrays = hnp.arrays(
    np.float64,
    st.integers(1, 30),
    elements=st.one_of(st.floats(1e-6, 1.0, allow_nan=False), st.just(float("nan"))),
)


@pytest.mark.parametrize("method", ["bh", "bonferroni"])
@SETTINGS
@given(p_arrays)
def test_adjust_p_values_monotone_bounded(method, p):
    adj = adjust_p_values(p, method)
    fin = np.isfinite(p)
    np.testing.assert_array_equal(np.isnan(adj), np.isnan(p))
    if not fin.any():
        return
    pf, af = p[fin], adj[fin]
    assert np.all(af <= 1.0 + 1e-12) and np.all(af >= pf - 1e-12)
    order = np.argsort(pf, kind="stable")
    assert np.all(np.diff(af[order]) >= -1e-12), "adjusted p must be monotone in raw p"
    if method == "bh":
        np.testing.assert_array_less(af, adjust_p_values(p, "bonferroni")[fin] + 1e-12)


# (f) save / load round trip with non-finite values ------------------------------------

special = st.sampled_from([float("nan"), float("inf"), float("-inf")])
value_elems = st.one_of(st.floats(-1e6, 1e6, allow_nan=False), special)


@SETTINGS
@given(
    hnp.arrays(np.float64, st.tuples(st.integers(1, 5), st.integers(1, 4)), elements=value_elems),
    st.dictionaries(st.sampled_from(["a", "b", "c"]), value_elems, min_size=1),
)
def test_resultset_roundtrip_with_nonfinite(values, extra_params):
    n_cells = values.shape[0]
    r = MetricResult(
        metric="mean_per_state",
        target="s",
        level="cell",
        values=values,
        params={"name": "mean_per_state", **extra_params},
        extras={"e": values * 2.0},
        cell_ids=[f"c{i}" for i in range(n_cells)],
        state_names=[f"s{i}" for i in range(values.shape[1])],
        name="x",
    )
    rs = ResultSet()
    rs.add(r)
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "rs.zip"
        rs.save(path)
        back = ResultSet.load(path)["x"]
    np.testing.assert_array_equal(back.values, values)  # NaN-aware exact comparison
    np.testing.assert_array_equal(back.extras["e"], values * 2.0)
    assert back.cell_ids == r.cell_ids and back.state_names == r.state_names
    assert set(back.params) == set(r.params)
    for k, v in extra_params.items():
        got = back.params[k]
        assert (np.isnan(v) and np.isnan(got)) or got == v
