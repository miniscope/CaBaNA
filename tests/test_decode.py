import time

import numpy as np
import pytest

import cabana
from cabana import build
from cabana._metrics._decode import DecodeStates, contiguous_folds
from cabana._models import StateSpace
from cabana._shuffle import ShuffleConfig, shuffle_test


def states_from(lab, n_states, exclusive=True):
    oh = np.zeros((len(lab), n_states), bool)
    oh[np.arange(len(lab)), lab] = True
    return StateSpace(name="s", onehot=oh, state_names=[f"s{i}" for i in range(n_states)],
                      kind="categorical", exclusive=exclusive)


def blocky_labels(n, n_states, block=25):
    return (np.arange(n) // block) % n_states


def test_contiguous_folds():
    f = contiguous_folds(103, 5)
    assert f.min() == 0 and f.max() == 4
    assert (np.diff(f) >= 0).all()  # blocks of time, never interleaved
    assert len(np.unique(f)) == 5
    assert np.bincount(f).max() - np.bincount(f).min() <= 1


@pytest.mark.parametrize("clf", ["linear_svm", "logistic"])
@pytest.mark.parametrize("mode", ["one_vs_rest", "multiclass"])
def test_separable_states(clf, mode):
    rng = np.random.default_rng(0)
    n = 800
    lab = blocky_labels(n, 2)
    x = rng.normal(size=(20, n)) + 4.0 * np.outer(rng.normal(size=20), lab)
    st = states_from(lab, 2)
    m = DecodeStates(classifier=clf, mode=mode)
    v = m.compute(x, st, np.ones(n, bool), 1.0)
    assert v.shape == (2,) and (v > 0.95).all()
    ex = m.extras(x, st, np.ones(n, bool), 1.0)
    assert ex["accuracy_overall"].shape == (1,) and ex["accuracy_overall"][0] > 0.95
    assert ex["confusion"].shape == ((2, 2, 2) if mode == "one_vs_rest" else (2, 2))
    np.testing.assert_allclose(ex["chance"], 0.5)


def test_independent_labels_at_chance_and_subsample():
    rng = np.random.default_rng(1)
    n = 1200
    x = rng.normal(size=(40, n))
    st = states_from(blocky_labels(n, 3, block=40), 3)
    for kw in ({}, {"balance": "subsample"}, {"mode": "multiclass"}):
        v = DecodeStates(**kw).compute(x, st, np.ones(n, bool), 1.0)
        chance = 1 / 3 if kw.get("mode") == "multiclass" else 0.5
        assert np.all(np.abs(v - chance) < 0.1), (kw, v)


def test_small_state_nan_and_nonexclusive():
    rng = np.random.default_rng(2)
    n = 600
    lab = blocky_labels(n, 2)
    x = rng.normal(size=(10, n))
    oh = np.zeros((n, 3), bool)
    oh[np.arange(n), lab] = True
    oh[:5, 2] = True
    st = StateSpace(name="s", onehot=oh, state_names=list("abc"), kind="bouts", exclusive=False)
    v = DecodeStates().compute(x, st, np.ones(n, bool), 1.0)
    assert np.isnan(v[2]) and np.isfinite(v[:2]).all()
    with pytest.raises(ValueError, match="exclusive"):
        DecodeStates(mode="multiclass").compute(x, st, np.ones(n, bool), 1.0)


def test_registry():
    assert isinstance(build("metric", {"name": "decode_states", "n_folds": 3}), DecodeStates)


def test_end_to_end_label_shuffle():
    s = cabana.simulate_session(duration_s=600, n_cells=60)
    s = build("transform", {"name": "resample_signal", "source": "position"}).apply(s)
    s = build("transform", {"name": "bouts_to_states", "source": "social"}).apply(s)
    s = s.rebin(0.5)
    st, mask = s.states["social"], s.masks["social_scored"]
    m = DecodeStates(min_frames_per_class=10)
    cfg = ShuffleConfig(n_shuffles=30, null={"name": "label_shuffle", "block_s": 5.0}, seed=0)
    t0 = time.time()
    res = shuffle_test(m, s.activity, st, mask, cfg, s.fs)
    print(f"decode_states: 30 shuffles {time.time() - t0:.2f}s; obs={res.observed} hi={res.null_hi}")
    n_exceed = int(np.sum(res.observed > res.null_hi))
    assert n_exceed >= 2, (res.observed, res.null_hi)
