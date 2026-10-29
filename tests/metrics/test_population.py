import numpy as np
import pytest

from cabana._metrics._population import PopulationVectorOverlap, PopulationVectorStability
from cabana._models import StateSpace
from cabana._registry import build


def _states(onehot):
    onehot = np.asarray(onehot, dtype=bool)
    return StateSpace(
        name="s",
        onehot=onehot,
        state_names=[f"s{i}" for i in range(onehot.shape[1])],
        kind="categorical",
        exclusive=True,
    )


def _structured(n_time=400, fs=10.0, unoccupied=False):
    """6 cells, 4 states. s0,s1 drive cells (0,1); s2 -> cells (2,3); s3 -> cells (4,5).

    s0 and s1 are identical in population code, s2 and s3 orthogonal to everything.
    """
    labels = np.arange(n_time) % 4
    oh = np.zeros((n_time, 4), bool)
    oh[np.arange(n_time), labels] = True
    code = np.zeros((6, 4))
    code[[0, 1], 0] = 1.0
    code[[0, 1], 1] = 1.0
    code[[2, 3], 2] = 1.0
    code[[4, 5], 3] = 1.0
    act = code[:, labels]
    if unoccupied:
        oh[:, 3] = False
    return act, oh, fs


@pytest.mark.parametrize("sim", ["cosine", "pearson"])
def test_pvo_pattern(sim):
    act, oh, fs = _structured()
    m = build("metric", {"name": "population_vector_overlap", "similarity": sim})
    out = m.compute(act, _states(oh), np.ones(oh.shape[0], bool), fs)
    assert out.shape == (4, 4)
    np.testing.assert_allclose(np.diag(out), 1.0, atol=1e-12)
    assert out[0, 1] == pytest.approx(1.0)
    if sim == "cosine":
        assert out[0, 2] == pytest.approx(0.0, abs=1e-12)
        assert out[2, 3] == pytest.approx(0.0, abs=1e-12)
    else:
        assert abs(out[0, 2]) < 0.5 and out[0, 2] < 0
    np.testing.assert_allclose(out, out.T, atol=1e-12)
    rm = m.extras(act, _states(oh), np.ones(oh.shape[0], bool), fs)["rate_map"]
    assert rm.shape == (6, 4) and rm.max() == pytest.approx(1.0)


def test_pvo_unoccupied_state_nan():
    act, oh, fs = _structured(unoccupied=True)
    out = PopulationVectorOverlap().compute(act, _states(oh), np.ones(oh.shape[0], bool), fs)
    assert np.isnan(out[3]).all() and np.isnan(out[:, 3]).all()
    assert np.isfinite(out[:3, :3]).all()
    assert (
        PopulationVectorOverlap().compute_shifted(
            act, _states(oh), np.ones(400, bool), fs, np.array([1])
        )
        is None
    )


def test_pv_stability_identical_halves():
    n_time, fs = 800, 10.0
    # states change every frame in a repeating pattern, so both halves see the same code
    labels = np.arange(n_time) % 4
    oh = np.zeros((n_time, 4), bool)
    oh[np.arange(n_time), labels] = True
    rng = np.random.default_rng(0)
    code = rng.random((6, 4)) + 0.1
    act = code[:, labels]
    m = PopulationVectorStability()
    mask = np.ones(n_time, bool)
    r = m.compute(act, _states(oh), mask, fs)
    np.testing.assert_allclose(r, 1.0, atol=1e-10)
    ex = m.extras(act, _states(oh), mask, fs)
    assert ex["rate_map_a"].shape == (6, 4) and ex["valid_states"].all()


def test_pv_stability_nan_for_invalid_state():
    n_time, fs = 400, 10.0
    labels = np.arange(n_time) % 3
    oh = np.zeros((n_time, 4), bool)
    oh[np.arange(n_time), labels] = True  # state 3 never occupied
    act = np.random.default_rng(1).random((5, n_time))
    r = PopulationVectorStability().compute(act, _states(oh), np.ones(n_time, bool), fs)
    assert np.isnan(r[3]) and np.isfinite(r[:3]).all()


@pytest.mark.parametrize("n_blocks", [2, 5])
def test_pv_stability_shifted_equals_looped(n_blocks):
    rng = np.random.default_rng(4)
    n_time, fs = 600, 10.0
    labels = rng.integers(0, 4, n_time)
    oh = np.zeros((n_time, 4), bool)
    oh[np.arange(n_time), labels] = True
    act = rng.poisson(1.0, size=(8, n_time)).astype(float)
    mask = rng.random(n_time) < 0.8
    m = PopulationVectorStability(n_blocks=n_blocks)
    shifts = np.array([0, 3, 100, 599])
    fast = m.compute_shifted(act, _states(oh), mask, fs, shifts)
    slow = np.stack(
        [m.compute(np.roll(act, int(k), axis=1), _states(oh), mask, fs) for k in shifts]
    )
    assert fast.shape == (4, 4)
    np.testing.assert_allclose(fast, slow, atol=1e-12)


def test_zero_min_occupancy_still_invalidates_unvisited_state():
    # with min_occupancy_s=0 an unvisited state must be invalid (NaN), not a rate-0 state
    act, oh, fs = _structured(unoccupied=True)
    mask = np.ones(oh.shape[0], bool)
    pvo = PopulationVectorOverlap(min_occupancy_s=0.0)
    out = pvo.compute(act, _states(oh), mask, fs)
    assert np.isnan(out[3]).all() and np.isnan(out[:, 3]).all()
    assert np.isnan(pvo.extras(act, _states(oh), mask, fs)["rate_map"][:, 3]).all()
    stab = PopulationVectorStability(min_occupancy_s=0.0)
    r = stab.compute(act, _states(oh), mask, fs)
    assert np.isnan(r[3]) and np.isfinite(r[:3]).all()
    assert not stab.extras(act, _states(oh), mask, fs)["valid_states"][3]


def test_valid_states_helper():
    from cabana._metrics._ratemap import valid_states

    v = valid_states(np.array([0, 1, 5]), fs=10.0, min_occupancy_s=0.0)
    assert v.tolist() == [False, True, True]
    v = valid_states(np.array([0, 1, 5]), fs=10.0, min_occupancy_s=0.3)
    assert v.tolist() == [False, False, True]
