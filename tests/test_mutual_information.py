import time

import numpy as np
import pytest

from cabana._metrics._discretize import activity_levels, level_edges
from cabana._metrics._mutual_information import (
    MutualInformation,
    mutual_information_from_counts,
)
from cabana._models import StateSpace
from cabana._pipeline import AnalysisSpec, Pipeline
from cabana._registry import build
from cabana._shuffle import ShuffleConfig, shuffle_test


def make_states(labels, n_states, exclusive=True):
    labels = np.asarray(labels)
    oh = np.zeros((labels.size, n_states), dtype=bool)
    ok = labels >= 0
    oh[np.flatnonzero(ok), labels[ok]] = True
    return StateSpace(
        name="s",
        onehot=oh,
        state_names=[str(i) for i in range(n_states)],
        kind="categorical",
        exclusive=exclusive,
    )


def brute_mi(levels, labels, n_states, n_levels, mask):
    n = np.zeros((n_states, n_levels))
    for t in np.flatnonzero(mask):
        if labels[t] >= 0:
            n[labels[t], levels[t]] += 1
    p = n / n.sum()
    ps, pl = p.sum(1), p.sum(0)
    out = 0.0
    for s in range(n_states):
        for lv in range(n_levels):
            if p[s, lv] > 0:
                out += p[s, lv] * np.log2(p[s, lv] / (ps[s] * pl[lv]))
    return out


def random_problem(seed=0, n_cells=4, n_time=3000, n_states=6):
    rng = np.random.default_rng(seed)
    labels = rng.integers(0, n_states, n_time)
    act = rng.exponential(1.0, (n_cells, n_time)) * (rng.random((n_cells, n_time)) < 0.4)
    # make cell 0 tuned to state 0
    act[0] += 3.0 * (labels == 0) * (rng.random(n_time) < 0.7)
    return act, make_states(labels, n_states), labels


def test_matches_brute_force():
    act, st, labels = random_problem()
    mask = np.ones(act.shape[1], bool)
    mi = MutualInformation(n_levels=4)
    got = mi.compute(act, st, mask, 20.0)
    edges = level_edges(act, mask, 4, "quantile")
    lv = activity_levels(act, edges)
    ref = [brute_mi(lv[c], labels, 6, 4, mask) for c in range(act.shape[0])]
    assert np.allclose(got, ref)
    assert got[0] > got[1:].max()


def test_compute_agrees_with_compute_shifted_zero():
    act, st, _ = random_problem(1)
    mask = np.ones(act.shape[1], bool)
    mask[500:700] = False
    for kw in [
        {},
        {"binning": "linear"},
        {"bias_correction": "miller_madow"},
        {"units": "bits_per_event"},
    ]:
        mi = MutualInformation(**kw)
        a = mi.compute(act, st, mask, 20.0)
        b = mi.compute_shifted(act, st, mask, 20.0, np.array([0]))[0]
        assert np.allclose(a, b)


def test_shift_equals_compute_on_rolled_full_mask():
    act, st, _ = random_problem(2)
    mask = np.ones(act.shape[1], bool)
    shifts = np.array([0, 17, 400, -33, 2999])
    for kw in [{}, {"bias_correction": "miller_madow"}, {"units": "bits_per_event"}]:
        mi = MutualInformation(**kw)
        sh = mi.compute_shifted(act, st, mask, 20.0, shifts)
        for i, k in enumerate(shifts):
            assert np.allclose(sh[i], mi.compute(np.roll(act, int(k), axis=1), st, mask, 20.0))


def test_shift_with_gappy_mask_uses_fixed_edges():
    act, st, labels = random_problem(3)
    mask = np.ones(act.shape[1], bool)
    mask[100:400] = False
    mask[2000:2100] = False
    mi = MutualInformation(n_levels=4)
    shifts = np.array([5, 250, 1234])
    sh = mi.compute_shifted(act, st, mask, 20.0, shifts)
    edges = level_edges(act, mask, 4, "quantile")  # fitted on the unshifted data
    for i, k in enumerate(shifts):
        lv = activity_levels(np.roll(act, int(k), axis=1), edges)
        ref = [brute_mi(lv[c], labels, 6, 4, mask) for c in range(act.shape[0])]
        assert np.allclose(sh[i], ref)


def test_mask_equals_subset():
    act, st, labels = random_problem(4)
    mask = np.zeros(act.shape[1], bool)
    mask[::2] = True
    mask[:300] = False
    mi = MutualInformation()
    sub = np.flatnonzero(mask)
    full = mi.compute(act, st, mask, 20.0)
    sset = mi.compute(act[:, sub], make_states(labels[sub], 6), np.ones(sub.size, bool), 20.0)
    assert np.allclose(full, sset)


def test_analytic_one_bit_binary():
    labels = np.repeat([0, 1], 500)
    act = np.zeros((1, 1000))
    act[0, :500] = np.random.default_rng(0).uniform(1, 2, 500)
    st = make_states(labels, 2)
    v = MutualInformation(binning="binary", n_levels=9).compute(act, st, np.ones(1000, bool), 10.0)
    assert v[0] == pytest.approx(1.0)


def test_perfect_dependence_log2k():
    k = 8
    labels = np.repeat(np.arange(k), 50)
    act = (labels.astype(float) + 1.0)[None]
    st = make_states(labels, k)
    v = MutualInformation(n_levels=k + 1, binning="linear").compute(
        act, st, np.ones(labels.size, bool), 10.0
    )
    assert v[0] == pytest.approx(np.log2(k))


def test_from_counts():
    assert mutual_information_from_counts(np.array([[5.0, 0], [0, 5.0]])) == pytest.approx(1.0)
    ind = np.outer([1, 2, 3], [4, 5]).astype(float)
    assert mutual_information_from_counts(ind) == pytest.approx(0.0, abs=1e-12)
    out = mutual_information_from_counts(np.zeros((3, 2, 2)))
    assert out.shape == (3,) and np.isnan(out).all()
    c = np.random.default_rng(0).integers(0, 20, (3, 4, 5)).astype(float)
    mm = mutual_information_from_counts(c, "miller_madow")
    assert (mm < mutual_information_from_counts(c)).all()


def test_miller_madow_reduces_independent_bias():
    rng = np.random.default_rng(0)
    labels = rng.integers(0, 10, 400)
    act = rng.exponential(1, (200, 400))
    st = make_states(labels, 10)
    m = np.ones(400, bool)
    plug = MutualInformation().compute(act, st, m, 10.0).mean()
    mm = MutualInformation(bias_correction="miller_madow").compute(act, st, m, 10.0).mean()
    assert plug > 0.03 and abs(mm) < plug / 5


def test_silent_cell_nan_and_shuffle():
    act, st, _ = random_problem(5, n_cells=3)
    act[1] = 0.0
    mask = np.ones(act.shape[1], bool)
    mi = MutualInformation()
    v = mi.compute(act, st, mask, 20.0)
    assert np.isnan(v[1]) and np.isfinite(v[[0, 2]]).all()
    r = shuffle_test(mi, act, st, mask, ShuffleConfig(n_shuffles=20, seed=0), 20.0)
    assert np.isnan(r.p_value[1]) and not r.significant[1]
    assert r.null.shape == (20, 3)


def test_signed_activity_and_log():
    act, st, _ = random_problem(6, n_cells=2)
    z = (act - act.mean(1, keepdims=True)) / act.std(1, keepdims=True)
    mask = np.ones(z.shape[1], bool)
    for b in ("quantile", "linear"):
        assert np.isfinite(MutualInformation(binning=b).compute(z, st, mask, 20.0)).all()
    with pytest.raises(ValueError):
        MutualInformation(binning="log").compute(z, st, mask, 20.0)
    assert np.isfinite(MutualInformation(binning="log").compute(act, st, mask, 20.0)).all()


def test_errors():
    act, st, labels = random_problem(7)
    mask = np.ones(act.shape[1], bool)
    bad = act.copy()
    bad[0, 0] = np.nan
    with pytest.raises(ValueError, match="finite"):
        MutualInformation().compute(bad, st, mask, 20.0)
    nonex = StateSpace(
        name="n",
        onehot=np.ones((act.shape[1], 2), bool),
        state_names=["a", "b"],
        kind="categorical",
        exclusive=False,
    )
    with pytest.raises(ValueError, match="exclusive"):
        MutualInformation().compute(act, nonex, mask, 20.0)


def test_invalid_states_dropped_and_nan_when_none():
    labels = np.repeat([0, 1, 2], [500, 500, 2])
    act = np.random.default_rng(0).exponential(1, (2, 1002))
    st = make_states(labels, 3)
    mask = np.ones(1002, bool)
    mi = MutualInformation()
    ex = mi.extras(act, st, mask, 20.0)  # state 2: 0.1 s >= 0.05 -> valid
    assert ex["valid"].all()
    ex = MutualInformation(min_occupancy_s=1.0).extras(act, st, mask, 20.0)
    assert ex["valid"].tolist() == [True, True, False]
    assert (ex["joint"][:, 2] == 0).all() and np.isnan(ex["conditional"][:, 2]).all()
    assert np.allclose(np.nansum(ex["conditional"], axis=-1)[:, :2], 1.0)
    none = MutualInformation(min_occupancy_s=100)
    assert np.isnan(none.compute(act, st, mask, 20.0)).all()
    assert np.isnan(none.compute_shifted(act, st, mask, 20.0, np.array([1, 2]))).all()


def test_extras_shapes():
    act, st, _ = random_problem(8)
    mask = np.ones(act.shape[1], bool)
    ex = MutualInformation(n_levels=5).extras(act, st, mask, 20.0)
    assert ex["joint"].shape == (4, 6, 5) and ex["conditional"].shape == (4, 6, 5)
    assert ex["edges"].shape == (4, 6) and ex["occupancy_s"].shape == (6,)
    assert ex["joint"].sum() == 4 * act.shape[1]
    ex2 = MutualInformation(binning="binary", n_levels=7).extras(act, st, mask, 20.0)
    assert ex2["joint"].shape == (4, 6, 2)


@pytest.fixture
def spatial(sim_session):
    return sim_session


def test_planted_place_cells_detected(spatial):
    st = spatial.states["position"]
    mask = np.ones(spatial.activity.shape[1], bool)
    t0 = time.perf_counter()
    r = shuffle_test(
        MutualInformation(),
        spatial.activity,
        st,
        mask,
        ShuffleConfig(n_shuffles=50, seed=0),
        spatial.fs,
    )
    assert time.perf_counter() - t0 < 15
    place = np.zeros(spatial.activity.shape[0], bool)
    place[spatial.meta["ground_truth"]["place_cells"]] = True
    assert r.significant[place].mean() > 0.8
    assert r.significant[~place].mean() < 0.2


def test_independent_labels_low_mi(spatial):
    st = spatial.states["position"]
    perm = np.random.default_rng(0).permutation(st.onehot.shape[0])
    st2 = StateSpace(
        name="p",
        onehot=st.onehot[perm],
        state_names=st.state_names,
        kind="categorical",
        exclusive=True,
    )
    mask = np.ones(spatial.activity.shape[1], bool)
    real = MutualInformation().compute(spatial.activity, st, mask, spatial.fs)
    fake = MutualInformation().compute(spatial.activity, st2, mask, spatial.fs)
    place = spatial.meta["ground_truth"]["place_cells"]
    assert np.mean(fake[place]) < 0.5 * np.mean(real[place])


def test_pipeline_and_yaml(spatial):
    pytest.importorskip("yaml")
    pipe = Pipeline(
        analyses=[
            AnalysisSpec(
                metric={
                    "name": "mutual_information",
                    "n_levels": 4,
                    "binning": "linear",
                    "bias_correction": "miller_madow",
                },
                states="position",
                masks=["position_covered"],
                shuffle=ShuffleConfig(n_shuffles=20, seed=0),
            )
        ]
    )
    _, rs = pipe.run(spatial)
    df = rs.to_dataframe()
    assert len(df) == spatial.activity.shape[0]
    p2 = Pipeline.from_yaml(pipe.to_yaml())
    assert p2.to_dict() == pipe.to_dict()
    assert build("metric", {"name": "mutual_information"}).n_levels == 5


def _fixed_ref(act, labels, n_states, mask, shifts, n_levels, scale=None, mm=False, valid=None):
    """Brute force with edges (and scale) fitted on the unshifted masked data."""
    edges = level_edges(act, mask, n_levels, "quantile")
    valid = np.ones(n_states, bool) if valid is None else valid
    out = []
    for k in shifts:
        lv = activity_levels(np.roll(act, int(k), axis=1), edges)
        row = []
        for c in range(act.shape[0]):
            n = np.zeros((n_states, n_levels))
            for t in np.flatnonzero(mask):
                if labels[t] >= 0 and valid[labels[t]]:
                    n[labels[t], lv[c, t]] += 1
            v = mutual_information_from_counts(n, "miller_madow" if mm else "none")
            row.append(v * (1.0 if scale is None else scale[c]))
        out.append(row)
    return np.array(out)


def test_bits_per_event_gappy_mask_fixed_scale():
    act, st, labels = random_problem(9)
    mask = np.ones(act.shape[1], bool)
    mask[100:900] = False
    shifts = np.array([3, 700, 1500])
    mi = MutualInformation(n_levels=4, units="bits_per_event")
    got = mi.compute_shifted(act, st, mask, 20.0, shifts)
    scale = 1.0 / (act[:, mask] > 0).mean(axis=1)
    ref = _fixed_ref(act, labels, 6, mask, shifts, 4, scale=scale)
    assert np.allclose(got, ref)
    # by design the rolled-then-computed value differs (edges and scale refit)
    rolled = mi.compute(np.roll(act, 700, axis=1), st, mask, 20.0)
    assert not np.allclose(got[1], rolled)


def test_gappy_shifted_invalid_state_miller_madow():
    rng = np.random.default_rng(10)
    n_time = 3000
    labels = rng.integers(0, 5, n_time)
    labels[:3] = 5  # 3 frames = 0.15 s at fs=20 -> invalid for min_occupancy_s=0.5
    act = rng.exponential(1.0, (3, n_time)) * (rng.random((3, n_time)) < 0.5)
    act[0] += 2.0 * (labels == 1)
    st = make_states(labels, 6)
    mask = np.ones(n_time, bool)
    mask[1000:1400] = False
    mask[2500:2600] = False
    mi = MutualInformation(n_levels=4, min_occupancy_s=0.5, bias_correction="miller_madow")
    valid = np.array([True] * 5 + [False])
    assert mi.extras(act, st, mask, 20.0)["valid"].tolist() == valid.tolist()
    shifts = np.array([11, 800, -250])
    got = mi.compute_shifted(act, st, mask, 20.0, shifts)
    ref = _fixed_ref(act, labels, 6, mask, shifts, 4, mm=True, valid=valid)
    assert np.allclose(got, ref)
