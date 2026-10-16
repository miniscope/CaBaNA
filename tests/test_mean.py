import numpy as np
import pytest

from cabana._metrics._mean import MeanPerState
from cabana._models import StateSpace
from cabana._registry import build


def _states(onehot, exclusive=False):
    onehot = np.asarray(onehot, dtype=bool)
    return StateSpace(
        name="s",
        onehot=onehot,
        state_names=[f"s{i}" for i in range(onehot.shape[1])],
        kind="bouts",
        exclusive=exclusive,
    )


def test_registered():
    m = build("metric", {"name": "mean_per_state", "statistic": "difference", "min_frames": 2})
    assert isinstance(m, MeanPerState) and m.default_tail == "two"


def test_hand_checked_mean_and_difference():
    x = np.array([[1.0, 2.0, 3.0, 10.0, 20.0, 100.0]])
    oh = np.zeros((6, 2), bool)
    oh[0:3, 0] = True
    oh[3:5, 1] = True
    mask = np.array([1, 1, 1, 1, 1, 0], bool)  # last frame masked out
    st = _states(oh, exclusive=True)
    mean = MeanPerState(min_frames=2).compute(x, st, mask, 10.0)
    np.testing.assert_allclose(mean, [[2.0, 15.0]])
    diff = MeanPerState(statistic="difference", min_frames=2).compute(x, st, mask, 10.0)
    np.testing.assert_allclose(diff, [[2.0 - 15.0, 15.0 - 2.0]])
    ex = MeanPerState(min_frames=2).extras(x, st, mask, 10.0)
    np.testing.assert_array_equal(ex["n_in_state"], [3, 2])


def test_min_frames_nan():
    x = np.arange(10.0)[None]
    oh = np.zeros((10, 2), bool)
    oh[:2, 0] = True
    oh[2:, 1] = True
    st = _states(oh, True)
    m = MeanPerState(min_frames=3)
    assert np.isnan(m.compute(x, st, np.ones(10, bool), 1.0)[0, 0])
    assert not np.isnan(m.compute(x, st, np.ones(10, bool), 1.0)[0, 1])
    # difference needs enough frames out of the state too
    d = MeanPerState(statistic="difference", min_frames=3).compute(x, st, np.ones(10, bool), 1.0)
    assert np.isnan(d).all()


@pytest.mark.parametrize("statistic", ["mean", "difference"])
@pytest.mark.parametrize("exclusive", [True, False])
def test_shifted_matches_loop_with_mask(statistic, exclusive):
    rng = np.random.default_rng(1)
    n = 400
    x = rng.random((5, n))
    if exclusive:
        lab = rng.integers(0, 3, n // 20).repeat(20)
        oh = np.eye(3, dtype=bool)[lab]
    else:
        oh = rng.random((n, 3)) < 0.3
    st = _states(oh, exclusive)
    mask = rng.random(n) < 0.7
    m = MeanPerState(statistic=statistic, min_frames=5)
    shifts = np.array([0, 1, 37, 150, 399])
    fast = m.compute_shifted(x, st, mask, 10.0, shifts)
    slow = np.stack([m.compute(np.roll(x, k, axis=1), st, mask, 10.0) for k in shifts])
    np.testing.assert_allclose(fast, slow, atol=1e-12)
    np.testing.assert_allclose(fast[0], m.compute(x, st, mask, 10.0), atol=1e-12)
