import time

import numpy as np
import pytest

from cabana._metrics._ratemap import split_half_columns
from cabana._metrics._stability import SplitHalfStability
from cabana._shuffle import ShuffleConfig, shuffle_test
from helpers import grid_data, grid_topology, make_states


def test_split_half_columns():
    st = make_states(np.arange(12) % 3, 3)
    mask = np.ones(12, bool)
    mask[:2] = False  # 10 masked frames -> blocks of 5
    a, b, ma, mb = split_half_columns(st, mask, 2)
    assert ma.sum() == 5 and mb.sum() == 5
    assert ma[2:7].all() and mb[7:].all()
    assert not (ma & mb).any()
    assert a.sum() == 5 and b.sum() == 5
    _, _, ma4, mb4 = split_half_columns(st, mask, 4)
    assert ma4.sum() + mb4.sum() == 10


def test_identical_halves_give_r1():
    # 5 states cycling; halves are [0:100) and [100:200); activity depends only on state
    labels = np.tile(np.arange(5), 40)
    st = make_states(labels, 5)
    act = (np.array([1.0, 3.0, 2.0, 5.0, 0.5])[labels])[None]
    r = SplitHalfStability().compute(act, st, np.ones(200, bool), 10.0)
    assert r[0] == pytest.approx(1.0, abs=1e-9)
    ex = SplitHalfStability().extras(act, st, np.ones(200, bool), 10.0)
    np.testing.assert_allclose(ex["rate_map_a"], ex["rate_map_b"])
    assert ex["valid_states"].all()


def test_anticorrelated_and_few_states():
    labels = np.tile(np.arange(4), 50)
    st = make_states(labels, 4)
    base = np.array([1.0, 2.0, 3.0, 4.0])
    act = np.where(np.arange(200) < 100, base[labels], base[::-1][labels])[None]
    r = SplitHalfStability().compute(act, st, np.ones(200, bool), 10.0)
    assert r[0] == pytest.approx(-1.0, abs=1e-9)
    st2 = make_states(np.tile(np.arange(2), 100), 2)
    r2 = SplitHalfStability().compute(np.ones((1, 200)), st2, np.ones(200, bool), 10.0)
    assert np.isnan(r2[0])


def test_non_exclusive_works():
    rng = np.random.default_rng(0)
    oh = rng.random((400, 3)) > 0.6
    from cabana._models import StateSpace

    st = StateSpace(name="b", onehot=oh, state_names=list("abc"), kind="bouts", exclusive=False)
    r = SplitHalfStability(min_occupancy_s=0.1).compute(
        rng.random((2, 400)), st, np.ones(400, bool), 10.0
    )
    assert r.shape == (2,)


@pytest.mark.parametrize("sigma", [0.0, 1.0])
@pytest.mark.parametrize("n_blocks", [2, 6])
def test_shifted_matches_roll(sigma, n_blocks):
    act, st, mask = grid_data(seed=3, n_time=1500)
    m = SplitHalfStability(n_blocks=n_blocks, smooth_sigma_bins=sigma, min_occupancy_s=0.2)
    shifts = np.array([0, 5, 123, 777, 1499])
    fast = m.compute_shifted(act, st, mask, 5.0, shifts)
    slow = np.stack([m.compute(np.roll(act, k, axis=1), st, mask, 5.0) for k in shifts])
    assert fast.shape == (5, 3)
    assert np.isfinite(fast).any()
    np.testing.assert_allclose(fast, slow, atol=1e-9)


def test_smoothing_requires_topology():
    st = make_states(np.arange(100) % 4, 4)
    with pytest.raises(ValueError):
        SplitHalfStability(smooth_sigma_bins=1.0).compute(
            np.ones((1, 100)), st, np.ones(100, bool), 1.0
        )


def test_planted_shuffle():
    rng = np.random.default_rng(11)
    fs, n_time, n_states = 20.0, 20000, 50
    labels = rng.integers(0, n_states, n_time)
    st = make_states(labels, n_states)
    rate0 = np.where(labels == 7, 5.0, 0.1) / fs
    act = np.stack([rng.poisson(rate0), rng.poisson(np.full(n_time, 0.5 / fs))]).astype(float)
    t0 = time.perf_counter()
    res = shuffle_test(
        SplitHalfStability(),
        act,
        st,
        np.ones(n_time, bool),
        ShuffleConfig(n_shuffles=200, min_shift_s=1.0),
        fs,
    )
    print(f"planted stability shuffle: {time.perf_counter() - t0:.2f}s")
    assert res.p_value[0] < 0.01
    assert res.p_value[1] > 0.05


def test_grid_topology_helper_used():
    assert grid_topology((4, 5)).n_states == 20
