"""Label-based (memory-light) per-state sums vs the dense matmul reference."""

import tracemalloc

import numpy as np
import pytest

import cabana
from cabana import build
from cabana import _statesums as ss
from cabana._shuffle import shifted_sums
from cabana._statesums import (
    masked_counts,
    shifted_state_sums,
    shifted_sums_for,
    shifted_sums_multi,
    state_labels,
    state_sums,
)
from test_information import make_states


def _random_states(rng, n_time, n_states, p_none=0.15, exclusive=True):
    labels = rng.integers(0, n_states, n_time)
    labels[rng.random(n_time) < p_none] = -1
    return make_states(labels, n_states, exclusive=exclusive), labels


@pytest.fixture
def force_labels(monkeypatch):
    monkeypatch.setattr(ss, "DENSE_MAX_STATES", 0)


def test_state_labels_and_statespace_labels_mask():
    st = make_states(np.array([0, 2, -1, 1, 2]), 4)
    mask = np.array([True, False, True, True, True])
    np.testing.assert_array_equal(state_labels(st, mask), [0, -1, -1, 1, 2])
    np.testing.assert_array_equal(st.labels(), [0, 2, -1, 1, 2])
    assert state_labels(st, None).dtype == np.int32


@pytest.mark.parametrize("n_states", [1, 7, 50])
def test_shifted_state_sums_matches_dense(n_states):
    rng = np.random.default_rng(1)
    n_time, n_cells = 300, 6
    st, labels = _random_states(rng, n_time, n_states)
    x = rng.random((n_cells, n_time))
    mask = rng.random(n_time) < 0.7  # gappy
    shifts = np.array([0, 1, -1, 37, -250, n_time, 3 * n_time + 5, -2 * n_time - 3])
    ref = shifted_sums(x, st.masked(mask), shifts)
    got = shifted_state_sums(x, state_labels(st, mask), n_states, shifts)
    assert got.shape == ref.shape == (shifts.size, n_cells, n_states)
    np.testing.assert_allclose(got, ref, atol=1e-10)


def test_empty_states_are_zero_and_all_skipped():
    rng = np.random.default_rng(2)
    x = rng.random((3, 40))
    labels = np.full(40, -1, np.int32)
    labels[::2] = 4  # states 0-3 and 5-9 never occur
    out = shifted_state_sums(x, labels, 10, np.array([0, 5]))
    assert (out[..., [0, 1, 2, 3, 5, 6, 7, 8, 9]] == 0).all()
    assert out[0, :, 4] == pytest.approx(x[:, ::2].sum(axis=1))
    none = shifted_state_sums(x, np.full(40, -1), 10, np.array([0, 1]))
    assert none.shape == (2, 3, 10) and (none == 0).all()


def test_label_shape_mismatch_raises():
    with pytest.raises(ValueError):
        shifted_state_sums(np.zeros((2, 5)), np.zeros(4, int), 3, np.array([0]))


@pytest.mark.parametrize("exclusive", [True, False])
@pytest.mark.parametrize("force", [True, False])
def test_dispatchers_match_dense(exclusive, force, monkeypatch):
    if force:
        monkeypatch.setattr(ss, "DENSE_MAX_STATES", 0)
    rng = np.random.default_rng(3)
    n_time, n_states = 400, 12
    if exclusive:
        st, _ = _random_states(rng, n_time, n_states)
    else:
        oh = rng.random((n_time, n_states)) < 0.2  # overlapping
        st = cabana.StateSpace(
            name="o",
            onehot=oh,
            state_names=[str(i) for i in range(n_states)],
            kind="bouts",
            exclusive=False,
        )
    x = rng.random((4, n_time))
    mask = rng.random(n_time) < 0.8
    m2 = rng.random(n_time) < 0.5
    shifts = np.array([0, 17, -33, 900])
    extra = mask[:, None].astype(float)
    ref = shifted_sums(x, st.masked(mask), shifts)
    np.testing.assert_allclose(shifted_sums_for(x, st, mask, shifts), ref, atol=1e-10)
    np.testing.assert_allclose(state_sums(x, st, mask), x @ st.masked(mask), atol=1e-10)
    np.testing.assert_allclose(masked_counts(st, mask), st.masked(mask).sum(axis=0))
    a, b, e = shifted_sums_multi(x, st, [mask, m2], shifts, extra_columns=extra)
    np.testing.assert_allclose(a, ref, atol=1e-10)
    np.testing.assert_allclose(b, shifted_sums(x, st.masked(m2), shifts), atol=1e-10)
    np.testing.assert_allclose(e, shifted_sums(x, extra, shifts), atol=1e-10)
    keep = rng.random(n_states) < 0.5
    np.testing.assert_allclose(
        shifted_sums_for(x, st, mask, shifts, keep=keep), ref[..., keep], atol=1e-10
    )
    both = shifted_sums_for(x, st, mask, shifts, extra_columns=extra)
    assert both.shape == (4, 4, n_states + 1)


def test_non_exclusive_never_uses_labels(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("label path used for non-exclusive space")

    monkeypatch.setattr(ss, "DENSE_MAX_STATES", 0)
    monkeypatch.setattr(ss, "shifted_state_sums", boom)
    rng = np.random.default_rng(4)
    oh = rng.random((50, 3)) < 0.5
    st = cabana.StateSpace(
        name="o", onehot=oh, state_names=list("abc"), kind="bouts", exclusive=False
    )
    shifted_sums_for(rng.random((2, 50)), st, np.ones(50, bool), np.array([0, 3]))


# --------------------------------------------------------------------------- #
# Metrics: label path == dense path
# --------------------------------------------------------------------------- #

_METRICS = [
    {"name": "information_content"},
    {"name": "information_content", "weight": "binary"},
    {"name": "split_half_stability"},
    {"name": "mean_per_state"},
    {"name": "mean_per_state", "statistic": "difference"},
    {"name": "pv_stability"},
    {"name": "mutual_information"},
    {"name": "mutual_information", "bias_correction": "miller_madow", "n_levels": 3},
]


def _gappy_mask(n, seed=0):
    m = np.random.default_rng(seed).random(n) < 0.8
    m[: n // 10] = False
    return m


def _run(metric, session, key, mask, shifts, use_labels, monkeypatch):
    monkeypatch.setattr(ss, "DENSE_MAX_STATES", 0 if use_labels else 10**9)
    st = session.states[key]
    act = session.activity
    out = {"compute": metric.compute(act, st, mask, session.fs)}
    out["shifted"] = metric.compute_shifted(act, st, mask, session.fs, shifts)
    try:
        out["extras"] = metric.extras(act, st, mask, session.fs)
    except NotImplementedError:
        pass
    return out


def _same(a, b):
    if isinstance(a, dict):
        assert a.keys() == b.keys()
        for k in a:
            _same(a[k], b[k])
    elif a is None:
        assert b is None
    else:
        np.testing.assert_allclose(
            np.asarray(a, float), np.asarray(b, float), rtol=1e-9, atol=1e-10, equal_nan=True
        )


@pytest.mark.parametrize("spec", _METRICS, ids=lambda s: "-".join(map(str, s.values())))
@pytest.mark.parametrize(
    "sess_name,key", [("small_session", "position"), ("sim_session", "syllables")]
)
def test_metrics_label_equals_dense(spec, sess_name, key, request, monkeypatch):
    session = request.getfixturevalue(sess_name)
    metric = build("metric", spec)
    n_time = session.n_time
    shifts = np.array([0, 25, -61, n_time // 2, n_time + 7])
    for mask in (np.ones(n_time, bool), _gappy_mask(n_time)):
        dense = _run(metric, session, key, mask, shifts, False, monkeypatch)
        lab = _run(metric, session, key, mask, shifts, True, monkeypatch)
        _same(dense, lab)


def test_population_vector_overlap_and_bayes_label_equals_dense(small_session, monkeypatch):
    st = small_session.states["position"]
    mask = _gappy_mask(small_session.n_time)
    for spec in ({"name": "population_vector_overlap"}, {"name": "bayesian_decoder"}):
        m = build("metric", spec)
        out = []
        for use_labels in (False, True):
            monkeypatch.setattr(ss, "DENSE_MAX_STATES", 0 if use_labels else 10**9)
            out.append(m.compute(small_session.activity, st, mask, small_session.fs))
        _same(out[0], out[1])


def test_metrics_on_non_exclusive_space_unchanged(small_session, monkeypatch):
    st = small_session.states["social"]
    assert not st.exclusive
    mask = _gappy_mask(small_session.n_time)
    shifts = np.array([0, 40, -90])
    for spec in ({"name": "mean_per_state"}, {"name": "split_half_stability"}):
        m = build("metric", spec)
        a = _run(m, small_session, "social", mask, shifts, False, monkeypatch)
        b = _run(m, small_session, "social", mask, shifts, True, monkeypatch)
        _same(a, b)


def test_default_threshold_uses_dense_for_small_spaces(monkeypatch):
    called = []
    monkeypatch.setattr(ss, "shifted_state_sums", lambda *a, **k: called.append(1))
    st, _ = _random_states(np.random.default_rng(5), 100, 10)
    shifted_sums_for(np.ones((2, 100)), st, np.ones(100, bool), np.array([0]))
    assert not called


# --------------------------------------------------------------------------- #
# Memory
# --------------------------------------------------------------------------- #


def test_large_state_space_information_content_is_memory_light():
    rng = np.random.default_rng(6)
    n_time, n_cells, n_states = 20_000, 50, 6400
    labels = rng.integers(0, n_states, n_time)
    st = make_states(labels, n_states)  # bool onehot ~128 MB, built before tracing
    act = rng.random((n_cells, n_time))
    mask = np.ones(n_time, bool)
    metric = build("metric", {"name": "information_content", "min_occupancy_s": 0.0})
    shifts = np.arange(10) * 500 + 1
    dense_matrix_bytes = n_time * n_states * 8
    tracemalloc.start()
    try:
        out = metric.compute_shifted(act, st, mask, 20.0, shifts)
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    assert out.shape == (10, n_cells)
    assert peak < 150e6, (
        f"peak {peak / 1e6:.0f} MB (dense matrix would be {dense_matrix_bytes / 1e6:.0f} MB)"
    )


@pytest.mark.parametrize("masked_out", [False, True])
def test_nan_frame_semantics_match_dense(monkeypatch, masked_out):
    rng = np.random.default_rng(3)
    T, C, S = 300, 4, 6
    lab = rng.integers(0, S, T)
    st = cabana.StateSpace(
        name="s",
        onehot=np.eye(S, dtype=bool)[lab],
        state_names=[str(i) for i in range(S)],
        kind="categorical",
        exclusive=True,
    )
    x = rng.normal(size=(C, T))
    x[1, 10] = np.nan
    mask = np.ones(T, bool)
    if masked_out:
        mask[10] = False
    shifts = np.array([0, 5, -7])
    ref = shifted_sums(x, st.masked(mask), shifts)
    monkeypatch.setattr(ss, "DENSE_MAX_STATES", 0)
    got = ss.shifted_sums_for(x, st, mask, shifts)
    np.testing.assert_allclose(got, ref, equal_nan=True)
    assert np.isnan(got[:, 1, :]).all() and np.isfinite(got[:, [0, 2, 3], :]).all()
    np.testing.assert_allclose(
        ss.state_sums(x, st, mask),
        shifted_sums(x, st.masked(mask), np.zeros(1, int))[0],
        equal_nan=True,
    )


def test_state_labels_and_counts_cached_read_only():
    rng = np.random.default_rng(0)
    sp = make_states(rng.integers(0, 5, 300), 5)
    mask = rng.random(300) > 0.4
    lab = state_labels(sp, mask)
    assert state_labels(sp, mask.copy()) is lab and lab.dtype == np.int32
    assert not lab.flags.writeable
    assert state_labels(sp, ~mask) is not lab
    c = masked_counts(sp, mask)
    assert masked_counts(sp, mask.copy()) is c and not c.flags.writeable
