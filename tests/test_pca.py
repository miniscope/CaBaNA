import time

import numpy as np

import cabana
from cabana import build
from cabana._metrics._pca import PCAPopulation, PopulationDistance, _pairwise, _pooled_within_cov
from cabana._models import StateSpace
from cabana._shuffle import ShuffleConfig, shuffle_test


def make_states(labels, n_states, exclusive=True):
    oh = np.zeros((len(labels), n_states), bool)
    ok = labels >= 0
    oh[np.flatnonzero(ok), labels[ok]] = True
    return StateSpace(
        name="s", onehot=oh, state_names=[f"s{i}" for i in range(n_states)],
        kind="categorical", exclusive=exclusive,
    )


def low_rank_data(n=600, n_cells=12, sep=5.0, noise=1e-3, seed=0):
    rng = np.random.default_rng(seed)
    lab = rng.integers(0, 3, n)
    direction = rng.normal(size=n_cells)
    direction /= np.linalg.norm(direction)
    coord = np.array([0.0, sep, 3 * sep])[lab]
    x = np.outer(direction, coord) + noise * rng.normal(size=(n_cells, n))
    return x, lab, direction


def test_pca_recovers_rank_one_and_separation():
    x, lab, _ = low_rank_data(noise=0.0)
    st = make_states(lab, 3)
    m = PCAPopulation(zscore=False)
    mask = np.ones(len(lab), bool)
    ex = m.extras(x, st, mask, 1.0)
    np.testing.assert_allclose(ex["variance_explained"], [1.0])  # rank 1 -> k=1
    d = m.compute(x, st, mask, 1.0)
    np.testing.assert_allclose(d[0, 1], 5.0, rtol=1e-9)
    np.testing.assert_allclose(d[1, 2], 10.0, rtol=1e-9)
    np.testing.assert_allclose(d[0, 2], 15.0, rtol=1e-9)
    assert ex["loadings"].shape == (12, 1) and ex["state_means"].shape == (3, 1)

    x2, lab2, _ = low_rank_data(noise=1e-2)
    ve = PCAPopulation(zscore=False).extras(x2, make_states(lab2, 3), mask, 1.0)["variance_explained"]
    assert ve[0] > 0.999 and ve.sum() <= 1 + 1e-12


def test_distance_properties_and_invalid_state():
    x, lab, _ = low_rank_data()
    lab = lab.copy()
    lab[:] = np.where(np.arange(lab.size) < 5, 3, lab)  # state 3 has 5 frames only
    st = make_states(lab, 4)
    mask = np.ones(lab.size, bool)
    for m in (PCAPopulation(), PCAPopulation(distance="mahalanobis"), PopulationDistance(),
              PopulationDistance(distance="correlation")):
        d = m.compute(x, st, mask, 1.0)
        assert d.shape == (4, 4)
        assert np.isnan(d[3]).all() and np.isnan(d[:, 3]).all()
        v = d[:3, :3]
        np.testing.assert_allclose(v, v.T, atol=1e-12)
        np.testing.assert_allclose(np.diag(v), 0.0)
        assert m.extras(x, st, mask, 1.0)["n_frames"][3] == 5
    assert isinstance(build("metric", {"name": "pca_population", "n_components": 3}), PCAPopulation)
    assert build("metric", {"name": "population_distance"}).name == "population_distance"


def test_mahalanobis_equals_euclidean_on_whitened():
    rng = np.random.default_rng(1)
    n, d = 500, 4
    lab = rng.integers(0, 3, n)
    z = rng.normal(size=(n, d)) @ rng.normal(size=(d, d)) + 2.0 * np.eye(3)[lab] @ rng.normal(size=(3, d))
    member = np.eye(3)[lab]
    means = (member.T @ z) / member.sum(0)[:, None]
    w = _pooled_within_cov(z, member, means)
    evals, evecs = np.linalg.eigh(w)
    xw = z @ (evecs / np.sqrt(evals)) @ evecs.T
    np.testing.assert_allclose(
        _pooled_within_cov(xw, member, (member.T @ xw) / member.sum(0)[:, None]), np.eye(d), atol=1e-9
    )
    st = make_states(lab, 3)
    mask = np.ones(n, bool)
    kw = dict(n_components=d, zscore=False)  # keep all PCs: a rotation, covariance stays identity
    dm = PCAPopulation(distance="mahalanobis", **kw).compute(xw.T, st, mask, 1.0)
    de = PCAPopulation(distance="euclidean", **kw).compute(xw.T, st, mask, 1.0)
    np.testing.assert_allclose(dm, de, atol=1e-9)
    means_w = (member.T @ xw) / member.sum(0)[:, None]
    np.testing.assert_allclose(_pairwise(means_w, "mahalanobis", np.eye(d)),
                               _pairwise(means_w, "euclidean"), atol=1e-12)


def test_non_exclusive_and_mask():
    x, lab, _ = low_rank_data(n=400)
    oh = np.zeros((400, 3), bool)
    oh[np.arange(400), lab] = True
    oh[:, 1] |= lab == 0  # state 1 also contains all state-0 frames
    st = StateSpace(name="s", onehot=oh, state_names=list("abc"), kind="bouts", exclusive=False)
    mask = np.ones(400, bool)
    mask[:100] = False
    d = PCAPopulation().compute(x, st, mask, 1.0)
    assert np.isfinite(d).all()
    n = PCAPopulation().extras(x, st, mask, 1.0)["n_frames"]
    assert n[1] == (oh[100:, 1]).sum()


def simulated():
    s = cabana.simulate_session(duration_s=600, n_cells=60)
    s = build("transform", {"name": "resample_signal", "source": "position"}).apply(s)
    s = build("transform", {"name": "bouts_to_states", "source": "social"}).apply(s)
    return s.rebin(0.5)


def test_pca_planted_label_shuffle():
    s = simulated()
    st = s.states["social"]
    mask = s.masks["social_scored"]
    m = PCAPopulation(n_components=5, min_frames=10)
    t0 = time.time()
    res = shuffle_test(m, s.activity, st, mask,
                       ShuffleConfig(n_shuffles=30, null={"name": "label_shuffle", "block_s": 5.0}, seed=0), s.fs)
    print(f"pca_population: 30 shuffles {time.time() - t0:.2f}s")
    obs = res.observed
    iu = np.triu_indices(st.n_states, 1)
    above = (obs[iu] > res.null_hi[iu]) & np.isfinite(obs[iu])
    assert above.sum() >= 1
