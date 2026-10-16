import time

import numpy as np
import pytest

from cabana._metrics._auroc import AUROC
from cabana._models import StateSpace
from cabana._registry import build
from cabana._shuffle import ShuffleConfig, shuffle_test


def _states(onehot, exclusive=False):
    onehot = np.asarray(onehot, dtype=bool)
    return StateSpace(
        name="s",
        onehot=onehot,
        state_names=[f"s{i}" for i in range(onehot.shape[1])],
        kind="bouts",
        exclusive=exclusive,
    )


def _pairwise_auroc(a, in_state, mask):
    x_in = a[mask & in_state]
    x_out = a[mask & ~in_state]
    d = x_in[:, None] - x_out[None, :]
    return ((d > 0).sum() + 0.5 * (d == 0).sum()) / (x_in.size * x_out.size)


def test_registered():
    assert isinstance(build("metric", {"name": "auroc", "min_frames": 3}), AUROC)
    assert AUROC.default_tail == "two"


@pytest.mark.parametrize(
    "vals_in, vals_out, expected",
    [
        ([5.0, 6.0, 7.0], [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], 1.0),
        ([0.0, 0.1, 0.2], [1.0] * 7, 0.0),
        ([1.0, 1.0, 1.0], [1.0] * 7, 0.5),
    ],
)
def test_hand_examples(vals_in, vals_out, expected):
    act = np.array([vals_in + vals_out])
    oh = np.zeros((10, 1), dtype=bool)
    oh[:3, 0] = True
    m = AUROC(min_frames=1)
    res = m.compute(act, _states(oh), np.ones(10, bool), 10.0)
    assert res.shape == (1, 1)
    assert res[0, 0] == pytest.approx(expected, abs=1e-12)


def test_matches_pairwise_reference_nonexclusive_with_ties():
    rng = np.random.default_rng(1)
    n_time = 300
    act = rng.poisson(1.0, size=(4, n_time)).astype(float)  # many ties
    oh = rng.random((n_time, 3)) < np.array([0.2, 0.4, 0.1])  # overlapping
    mask = rng.random(n_time) < 0.8
    res = AUROC(min_frames=1).compute(act, _states(oh), mask, 10.0)
    for c in range(4):
        for s in range(3):
            ref = _pairwise_auroc(act[c], oh[:, s], mask)
            assert res[c, s] == pytest.approx(ref, abs=1e-12)


def test_min_frames_nan_and_extras():
    rng = np.random.default_rng(2)
    act = rng.random((2, 100))
    oh = np.zeros((100, 2), dtype=bool)
    oh[:30, 0] = True
    oh[:5, 1] = True
    m = AUROC(min_frames=20)
    st = _states(oh)
    res = m.compute(act, st, np.ones(100, bool), 10.0)
    assert np.isfinite(res[:, 0]).all() and np.isnan(res[:, 1]).all()
    np.testing.assert_array_equal(
        m.extras(act, st, np.ones(100, bool), 10.0)["n_in_state"], [30, 5]
    )


@pytest.mark.parametrize("full_mask", [False, True])
def test_shifted_equals_looped(full_mask):
    rng = np.random.default_rng(3)
    n_time = 400
    act = rng.poisson(0.7, size=(5, n_time)).astype(float)
    oh = rng.random((n_time, 3)) < 0.3
    mask = np.ones(n_time, bool) if full_mask else rng.random(n_time) < 0.7
    st = _states(oh)
    m = AUROC(min_frames=5)
    shifts = np.array([0, 1, 17, 123, 399])
    fast = m.compute_shifted(act, st, mask, 10.0, shifts)
    slow = np.stack([m.compute(np.roll(act, int(k), axis=1), st, mask, 10.0) for k in shifts])
    assert fast.shape == (5, 5, 3)
    np.testing.assert_allclose(fast, slow, atol=1e-12)


def _bouts(rng, n_time, n_bouts, dur):
    x = np.zeros(n_time, bool)
    for s in rng.integers(0, n_time - dur, n_bouts):
        x[s : s + dur] = True
    return x


def test_planted_shuffle():
    rng = np.random.default_rng(7)
    fs, n_time = 20.0, 12000
    oh = np.stack(
        [_bouts(rng, n_time, 25, 60), _bouts(rng, n_time, 25, 60), _bouts(rng, n_time, 20, 40)], 1
    )
    base = 2.0 / fs
    gain = np.ones((3, n_time))
    gain[0, oh[:, 0]] = 4.0
    gain[1, oh[:, 1]] = 0.2
    act = rng.poisson(base * gain).astype(float)
    mask = np.ones(n_time, bool)
    mask[3000:3600] = False  # non-trivial mask -> exercises the per-shift ranking path
    cfg = ShuffleConfig(n_shuffles=200, min_shift_s=1.0, seed=0)
    t0 = time.perf_counter()
    res = shuffle_test(AUROC(), act, _states(oh), mask, cfg, fs)
    print(f"planted AUROC shuffle (n_shuffles=200, 12000 frames): {time.perf_counter() - t0:.2f}s")
    assert res.tail == "two"
    assert res.observed[0, 0] > 0.5 and res.p_value[0, 0] < 0.01
    assert res.observed[1, 1] < 0.5 and res.p_value[1, 1] < 0.01
    assert (res.p_value[2] > 0.05).all()


def _reference_shifted(act, onehot, mask, shifts, min_frames):
    """Old approach: re-rank every rolled, masked series with scipy rankdata."""
    from scipy.stats import rankdata

    m = onehot[mask].astype(float)
    n1 = m.sum(0)
    n0 = mask.sum() - n1
    out = []
    for k in shifts:
        r = rankdata(np.roll(act, int(k), axis=1)[:, mask], axis=1)
        auc = (r @ m - n1 * (n1 + 1) / 2) / (n1 * n0)
        out.append(np.where((n1 >= min_frames) & (n0 >= min_frames), auc, np.nan))
    return np.stack(out)


@pytest.mark.parametrize("exclusive", [False, True])
def test_shifted_masked_matches_rankdata_reference_heavy_ties(exclusive):
    rng = np.random.default_rng(11)
    n_cells, n_time = 7, 900
    act = rng.poisson(0.05, (n_cells, n_time)) * rng.lognormal(size=(n_cells, n_time))
    act[0] = 0.0  # all-tied cell
    act[1, ::3] = 0.0
    if exclusive:
        oh = np.zeros((n_time, 3), bool)
        lab = rng.integers(-1, 3, n_time)
        for s in range(3):
            oh[:, s] = lab == s
    else:
        oh = rng.random((n_time, 3)) < np.array([0.2, 0.5, 0.05])
    mask = rng.random(n_time) < 0.75
    mask[:50] = False
    mask[-50:] = False
    shifts = np.array([0, 1, 2, 50, 333, 899, 450])
    fast = AUROC(min_frames=3).compute_shifted(act, _states(oh, exclusive), mask, 10.0, shifts)
    ref = _reference_shifted(act, oh, mask, shifts, 3)
    np.testing.assert_allclose(fast, ref, atol=1e-9, equal_nan=True)


def test_shifted_masked_matches_pairwise_definition_tiny():
    act = np.array([[0, 1, 1, 0, 2, 2, 0, 1, 0, 3, 1, 1]], float)
    n = act.shape[1]
    oh = np.zeros((n, 1), bool)
    oh[[1, 2, 5, 8], 0] = True
    mask = np.ones(n, bool)
    mask[[0, 11]] = False
    shifts = np.array([0, 3, 7])
    fast = AUROC(min_frames=1).compute_shifted(act, _states(oh), mask, 10.0, shifts)
    for i, k in enumerate(shifts):
        ref = _pairwise_auroc(np.roll(act[0], int(k)), oh[:, 0], mask)
        assert fast[i, 0, 0] == pytest.approx(ref, abs=1e-12)
