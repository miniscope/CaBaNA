import math
import time

import numpy as np
import pytest

from cabana._metrics._information import InformationContent
from cabana._metrics._ratemap import rate_maps_from_sums
from cabana._models import GridTopology, StateSpace
from cabana._shuffle import ShuffleConfig, shuffle_test


def make_states(labels, n_states, exclusive=True, topology=None, kind="categorical"):
    labels = np.asarray(labels)
    oh = np.zeros((labels.size, n_states), dtype=bool)
    ok = labels >= 0
    oh[np.flatnonzero(ok), labels[ok]] = True
    return StateSpace(
        name="s",
        onehot=oh,
        state_names=[str(i) for i in range(n_states)],
        kind="grid" if topology is not None else kind,
        exclusive=exclusive,
        topology=topology,
    )


def grid_topology(shape):
    return GridTopology(
        shape=shape,
        edges=[np.arange(n + 1, dtype=float) for n in shape],
        axis_names=[f"a{i}" for i in range(len(shape))],
    )


def hand_example():
    # occupancy 20,10,8,2 frames (fs=1); sums 20,40,16,100
    labels = np.repeat([0, 1, 2, 3], [20, 10, 8, 2])
    act = np.zeros((1, 40))
    for first, tot in zip([0, 20, 30, 38], [20, 40, 16, 100], strict=True):
        act[0, first] = tot
    return act, make_states(labels, 4), np.ones(40, bool)


def test_hand_computed_si_with_exclusion():
    act, st, mask = hand_example()
    m = InformationContent(min_occupancy_s=5)
    si = m.compute(act, st, mask, 1.0)
    # valid states 0..2: P=[20,10,8]/38, rates 1,4,2, mean 2
    assert si.shape == (1,)
    assert si[0] == pytest.approx(10 / 38, abs=1e-9)
    bps = InformationContent(min_occupancy_s=5, units="bits_per_second").compute(act, st, mask, 1.0)
    assert bps[0] == pytest.approx(20 / 38, abs=1e-9)
    ex = m.extras(act, st, mask, 1.0)
    assert ex["valid_states"].tolist() == [True, True, True, False]
    assert ex["occupancy_s"].tolist() == [20, 10, 8, 2]
    assert ex["rate_map"][0, :3].tolist() == [1, 4, 2]
    assert np.isnan(ex["rate_map"][0, 3])


def test_hand_computed_si_all_states():
    act, st, mask = hand_example()
    si = InformationContent().compute(act, st, mask, 1.0)
    p = np.array([20, 10, 8, 2]) / 40
    lam = np.array([1, 4, 2, 50.0])
    mean = sum(p * lam)
    want = sum(pi * (li / mean) * math.log2(li / mean) for pi, li in zip(p, lam, strict=True))
    assert si[0] == pytest.approx(want, abs=1e-9)


def test_binary_weight():
    act, st, mask = hand_example()
    # binary: each state has exactly one nonzero frame -> rates 1/20, 1/10, 1/8, 1/2
    si = InformationContent(weight="binary", min_occupancy_s=5).compute(act, st, mask, 1.0)
    p = np.array([20, 10, 8]) / 38
    lam = np.array([1 / 20, 1 / 10, 1 / 8])
    mean = sum(p * lam)
    want = sum(pi * li / mean * math.log2(li / mean) for pi, li in zip(p, lam, strict=True))
    assert si[0] == pytest.approx(want, abs=1e-9)


def test_zero_activity_is_undefined():
    _, st, mask = hand_example()
    out = InformationContent().compute(np.zeros((2, 40)), st, mask, 1.0)
    assert np.isnan(out).all()  # a silent cell carries no information: NaN, never a fake 0


def test_negative_activity_rejected():
    _, st, mask = hand_example()
    with pytest.raises(ValueError, match="non-negative"):
        InformationContent().compute(-np.ones((2, 40)), st, mask, 1.0)


def test_requires_exclusive():
    labels = np.zeros(10, int)
    st = make_states(labels, 2, exclusive=False, kind="bouts")
    with pytest.raises(ValueError, match=r"bouts_to_states\(exclusive=True\)"):
        InformationContent().compute(np.ones((1, 10)), st, np.ones(10, bool), 1.0)


def test_smoothing_requires_topology():
    act, st, mask = hand_example()
    with pytest.raises(ValueError):
        InformationContent(smooth_sigma_bins=1.0).compute(act, st, mask, 1.0)


def grid_data(seed=0, n_time=600, shape=(4, 5), n_cells=3):
    rng = np.random.default_rng(seed)
    topo = grid_topology(shape)
    labels = rng.integers(0, topo.n_states, n_time)
    st = make_states(labels, topo.n_states, topology=topo)
    act = rng.poisson(0.3, (n_cells, n_time)).astype(float) * rng.random((n_cells, n_time))
    act[0, labels == 3] *= 5
    mask = rng.random(n_time) > 0.3
    mask[100:150] = False
    return act, st, mask


@pytest.mark.parametrize("sigma", [0.0, 1.0])
@pytest.mark.parametrize("kw", [{}, {"weight": "binary", "units": "bits_per_second"}])
def test_shifted_matches_roll(sigma, kw):
    act, st, mask = grid_data()
    m = InformationContent(smooth_sigma_bins=sigma, min_occupancy_s=0.5, **kw)
    shifts = np.array([0, 1, 37, 250, 599])
    fast = m.compute_shifted(act, st, mask, 5.0, shifts)
    slow = np.stack([m.compute(np.roll(act, k, axis=1), st, mask, 5.0) for k in shifts])
    assert fast.shape == (5, 3)
    np.testing.assert_allclose(fast, slow, atol=1e-9)


def test_smoothing_spreads_and_preserves_total():
    topo = grid_topology((9, 9))
    sums = np.zeros(81)
    sums[4 * 9 + 4] = 10.0
    occ = np.full(81, 20.0)  # 1 s each at fs=20
    rate, valid = rate_maps_from_sums(sums, occ, 20.0, 0.0, topo, 1.0)
    assert valid.all()
    r = rate.reshape(9, 9)
    assert r[4, 5] > 0 and r[3, 4] > 0 and r[4, 4] < 10.0
    assert r.sum() == pytest.approx(10.0, rel=1e-2)  # edge normalisation makes this approximate


def test_planted_shuffle():
    rng = np.random.default_rng(11)
    fs, n_time, n_states = 20.0, 20000, 50
    labels = rng.integers(0, n_states, n_time)
    st = make_states(labels, n_states)
    rate0 = np.where(labels == 7, 5.0, 0.1) / fs
    act = np.stack([rng.poisson(rate0), rng.poisson(np.full(n_time, 0.5 / fs))]).astype(float)
    mask = np.ones(n_time, bool)
    cfg = ShuffleConfig(n_shuffles=200, min_shift_s=1.0)
    t0 = time.perf_counter()
    res = shuffle_test(InformationContent(), act, st, mask, cfg, fs)
    print(f"planted IC shuffle: {time.perf_counter() - t0:.2f}s")
    assert res.p_value[0] < 0.01
    assert res.p_value[1] > 0.05


def test_false_positive_rate():
    rng = np.random.default_rng(2)
    fs, n_time, n_states = 20.0, 20000, 50
    labels = rng.integers(0, n_states, n_time)
    st = make_states(labels, n_states)
    act = rng.poisson(0.5 / fs, (50, n_time)).astype(float)
    res = shuffle_test(
        InformationContent(), act, st, np.ones(n_time, bool),
        ShuffleConfig(n_shuffles=200, min_shift_s=1.0), fs,
    )
    fpr = (res.p_value < 0.05).mean()
    assert 0.0 <= fpr <= 0.15
