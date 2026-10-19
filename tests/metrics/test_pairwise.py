import numpy as np
import pytest

import cabana
import cabana._metrics._pairwise  # noqa: F401  (registers the metrics)
from cabana._metrics._pairwise import PairwiseCorrelation, ParticipationRatio
from cabana._models import StateSpace
from cabana._pipeline import AnalysisSpec, Pipeline
from cabana._shuffle import ShuffleConfig, shuffle_test

FS = 10.0


def _states(labels, n_states=None, exclusive=True):
    labels = np.asarray(labels)
    n_states = n_states or int(labels.max()) + 1
    oh = np.zeros((labels.size, n_states), bool)
    ok = labels >= 0
    oh[np.flatnonzero(ok), labels[ok]] = True
    return StateSpace(
        name="s",
        onehot=oh,
        state_names=[f"s{i}" for i in range(n_states)],
        kind="categorical",
        exclusive=exclusive,
    )


def _run(metric, act, st, mask=None):
    mask = np.ones(act.shape[1], bool) if mask is None else mask
    return metric.compute(act, st, mask, FS), metric.extras(act, st, mask, FS)


def test_total_block_structure():
    rng = np.random.default_rng(0)
    n = 2000
    a, b = rng.normal(size=n), rng.normal(size=n)
    act = np.vstack([a + 0.2 * rng.normal(size=(3, n)), -a + 0.2 * rng.normal(size=(3, n))])
    r, ex = _run(PairwiseCorrelation(), act, _states(np.zeros(n, int)))
    assert r.shape == (6, 6) and np.isnan(np.diag(r)).all()
    np.testing.assert_allclose(r, r.T, equal_nan=True)
    assert r[0, 1] > 0.8 and r[3, 4] > 0.8 and r[0, 3] < -0.8
    iu = np.triu_indices(6, 1)
    assert float(ex["mean_offdiag"]) == pytest.approx(np.mean(r[iu]))
    # hand computation against numpy
    ref = np.corrcoef(act)
    assert r[0, 4] == pytest.approx(ref[0, 4])
    assert float(ex["n_frames"]) == n
    assert b.size == n


def test_spearman_monotone():
    rng = np.random.default_rng(1)
    x = rng.normal(size=500)
    act = np.vstack([x, np.exp(x), -(x**3)])
    r, _ = _run(PairwiseCorrelation(method="spearman"), act, _states(np.zeros(500, int)))
    assert r[0, 1] == pytest.approx(1.0) and r[0, 2] == pytest.approx(-1.0)


def test_signal_shared_tuning():
    rng = np.random.default_rng(2)
    n, ns = 3000, 5
    lab = rng.integers(0, ns, n)
    tuning = rng.normal(size=ns)
    act = rng.normal(size=(4, n)) * 0.05
    act[0] += tuning[lab]
    act[1] += 3 * tuning[lab] + 1
    act[2] += rng.normal(size=ns)[lab]
    r, ex = _run(PairwiseCorrelation(kind="signal"), act, _states(lab))
    assert r.shape == (4, 4)
    assert r[0, 1] > 0.99
    assert ex["state_means"].shape == (4, ns)


def test_signal_invalid_states_and_too_few():
    lab = np.r_[np.zeros(100, int), np.ones(100, int), np.full(10, 2)]
    act = np.random.default_rng(0).normal(size=(3, lab.size))
    m = PairwiseCorrelation(kind="signal", min_frames=50)
    r, ex = _run(m, act, _states(lab))
    assert np.isnan(ex["state_means"][:, 2]).all()
    assert np.isfinite(r[~np.eye(3, dtype=bool)]).all()  # two valid states: r = +-1
    one = np.r_[np.zeros(100, int), np.full(10, 1)]
    r1, _ = _run(m, act[:, :110], _states(one))
    assert np.isnan(r1).all()  # a single valid state cannot define tuning similarity


def test_noise_shared_within_state():
    rng = np.random.default_rng(3)
    n, ns = 4000, 4
    lab = rng.integers(0, ns, n)
    tuning = rng.normal(size=(3, ns)) * 2
    shared = rng.normal(size=n)
    base = tuning[:, lab] + 0.3 * rng.normal(size=(3, n))
    with_noise = base + np.array([[1.0], [1.0], [0.0]]) * shared
    m = PairwiseCorrelation(kind="noise")
    st = _states(lab)
    r1, ex = _run(m, with_noise, st)
    r0, _ = _run(m, base, st)
    assert r1[0, 1] > 0.5
    assert abs(r0[0, 1]) < 0.1
    assert abs(r1[0, 2]) < 0.1
    # total correlation of the independent-noise population is dominated by tuning
    rt, _ = _run(PairwiseCorrelation(), base, st)
    assert abs(rt[0, 1]) > abs(r0[0, 1])
    assert ex["state_means"].shape == (3, ns)


def test_noise_requires_exclusive():
    lab = np.zeros(200, int)
    st = _states(lab, exclusive=False)
    m = PairwiseCorrelation(kind="noise")
    with pytest.raises(ValueError, match="exclusive"):
        m.check_target(st)
    with pytest.raises(ValueError):
        m.compute(np.zeros((2, 200)), st, np.ones(200, bool), FS)


def test_per_state_stack_and_invalid():
    rng = np.random.default_rng(4)
    lab = np.r_[np.zeros(300, int), np.ones(300, int), np.full(20, 2)]
    act = rng.normal(size=(5, lab.size))
    m = PairwiseCorrelation(states_as="per_state")
    r, ex = _run(m, act, _states(lab))
    assert r.shape == (5, 5)
    assert ex["per_state"].shape == (3, 5, 5)
    assert np.isnan(ex["per_state"][2]).all() and np.isfinite(ex["per_state"][0][0, 1])
    # compute stays the same as with states_as="all"
    r_all, ex_all = _run(PairwiseCorrelation(), act, _states(lab))
    np.testing.assert_allclose(r, r_all, equal_nan=True)
    assert "per_state" not in ex_all
    with pytest.raises(ValueError):
        PairwiseCorrelation(kind="signal", states_as="per_state").check_target(_states(lab))


def test_too_few_frames_nan_and_mask():
    act = np.random.default_rng(0).normal(size=(3, 100))
    st = _states(np.zeros(100, int))
    mask = np.zeros(100, bool)
    mask[:10] = True
    r, _ = _run(PairwiseCorrelation(min_frames=50), act, st, mask)
    assert np.isnan(r).all()
    r2, _ = _run(PairwiseCorrelation(min_frames=5), act, st, mask)
    np.testing.assert_allclose(r2[0, 1], np.corrcoef(act[:, :10])[0, 1])


def test_pipeline_labels_cells(small_session):
    pipe = Pipeline(
        analyses=[AnalysisSpec(metric={"name": "pairwise_correlation"}, states="syllables")]
    )
    _, rs = pipe.run(small_session)
    r = rs.results[0]
    ids = [str(c) for c in small_session.cell_ids]
    assert r.values.shape == (20, 20)
    assert r.state_names == ids
    assert "group_names" in r.extras


def test_total_circular_shift_null_equals_observed():
    rng = np.random.default_rng(5)
    n = 600
    act = rng.normal(size=(4, n))
    act[1] += act[0]
    st = _states(rng.integers(0, 3, n))
    cfg = ShuffleConfig(n_shuffles=6, min_shift_s=1.0, seed=0)
    res = shuffle_test(PairwiseCorrelation(), act, st, np.ones(n, bool), cfg, FS)
    np.testing.assert_allclose(res.null, np.broadcast_to(res.observed, res.null.shape), atol=1e-9)


@pytest.mark.skipif(
    "cell_shift" not in cabana.available("null"), reason="cell_shift not registered"
)
def test_cell_shift_null_pipeline(small_session):
    pipe = Pipeline(
        analyses=[
            AnalysisSpec(
                metric={"name": "pairwise_correlation"},
                states="syllables",
                shuffle=ShuffleConfig(n_shuffles=10, null={"name": "cell_shift"}, seed=0),
            ),
            AnalysisSpec(
                metric={"name": "participation_ratio", "per_state": True},
                states="syllables",
                shuffle=ShuffleConfig(n_shuffles=10, null={"name": "cell_shift"}, seed=0),
            ),
        ]
    )
    _, rs = pipe.run(small_session)
    assert len(rs.results) == 2
    assert all(r.shuffle is not None for r in rs.results)


def test_participation_ratio_isotropic_and_rank1():
    rng = np.random.default_rng(6)
    n, c = 20000, 10
    st = _states(np.zeros(n, int))
    iso, ex = _run(ParticipationRatio(), rng.normal(size=(c, n)), st)
    assert iso.shape == (1,) and iso[0] == pytest.approx(c, rel=0.05)
    lam = ex["eigenvalues"]
    assert lam.shape == (c,) and np.all(np.diff(lam) <= 1e-12)
    assert ex["variance_explained"][-1] == pytest.approx(1.0)
    assert list(ex["group_names"]) == ["all"]
    r1, _ = _run(ParticipationRatio(), np.outer(rng.normal(size=c) + 3, rng.normal(size=n)), st)
    assert r1[0] == pytest.approx(1.0, abs=1e-6)


def test_participation_ratio_per_state_nan():
    rng = np.random.default_rng(7)
    lab = np.r_[np.zeros(500, int), np.ones(500, int), np.full(10, 2)]
    act = rng.normal(size=(6, lab.size))
    out, ex = _run(ParticipationRatio(per_state=True), act, _states(lab))
    assert out.shape == (3,) and np.isnan(out[2]) and np.isfinite(out[:2]).all()
    assert "group_names" not in ex
    out_all, _ = _run(ParticipationRatio(), act, _states(lab))
    assert out_all.shape == (1,)


def test_participation_ratio_shift_invariant():
    rng = np.random.default_rng(8)
    n = 500
    act = rng.normal(size=(4, n))
    st = _states(np.zeros(n, int))
    cfg = ShuffleConfig(n_shuffles=4, min_shift_s=1.0, seed=0)
    res = shuffle_test(ParticipationRatio(), act, st, np.ones(n, bool), cfg, FS)
    np.testing.assert_allclose(res.null, np.broadcast_to(res.observed, res.null.shape), atol=1e-9)
    assert (
        ParticipationRatio().compute_shifted(act, st, np.ones(n, bool), FS, np.array([1])) is None
    )


@pytest.mark.parametrize(
    "plugin",
    [
        PairwiseCorrelation(),
        PairwiseCorrelation(kind="noise", min_frames=20),
        PairwiseCorrelation(kind="signal"),
        ParticipationRatio(),
        ParticipationRatio(per_state=True),
    ],
)
def test_check_plugin(small_session, plugin):
    # ``extras`` is skipped only because the checker demands numeric extras while
    # ``group_names`` (axis labels, a string array) is a documented extra; it is
    # checked for determinism by hand below.
    rep = cabana.check_plugin(plugin, small_session, target="syllables", skip=("extras",))
    assert rep.passed, str(rep)
    st = small_session.states["syllables"]
    mask = np.ones(small_session.n_time, bool)
    m = plugin.model_copy()
    m.configure(small_session, "syllables")
    e1 = m.extras(small_session.activity, st, mask, small_session.fs)
    e2 = m.extras(small_session.activity, st, mask, small_session.fs)
    assert e1.keys() == e2.keys()
    for k in e1:
        np.testing.assert_array_equal(e1[k], e2[k])
