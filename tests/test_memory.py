"""F6: chunked null evaluation, null dtype, state-label caching and ``memory_estimate``."""

from __future__ import annotations

import warnings

import numpy as np
import pytest

import cabana
from cabana import Pipeline, ShuffleConfig, build, memory_estimate, shuffle_test
from cabana._memory import shuffle_memory_bytes
from cabana._plugin_check import _mask_for, _resolve_target
from cabana._shuffle import RunCancelled
from cabana import _statesums as ss

pytestmark = pytest.mark.filterwarnings("ignore")


@pytest.fixture(scope="module")
def small_session():
    """Private copy of the conftest chain (other modules' broken plugins mutate the shared one)."""
    from conftest import _prepare

    return _prepare(cabana.simulate_session(duration_s=300, n_cells=20, seed=0), 100.0)


METRICS = [
    "information_content",
    "auroc",
    "split_half_stability",
    "mutual_information",
    "place_fields",
    "peth",
    "glm_encoding",
    "signal_correlation",
]
NULLS = [
    {"name": "circular_shift", "min_shift_s": 5.0},
    {"name": "label_shuffle", "block_s": 2.0},
    {"name": "bout_shuffle"},
    {"name": "within_state_shuffle"},
]


def _setup(session, metric_name):
    m = build("metric", {"name": metric_name})
    target, tname = _resolve_target(m, session, None)
    m.configure(session, tname)
    return m, target, _mask_for(target, session.n_time)


def _both(session, metric_name, null, **cfg):
    m, target, mask = _setup(session, metric_name)
    kw = dict(n_shuffles=24, batch_size=5, seed=3, keep_null="none", null=null, **cfg)
    act = np.asarray(session.activity, float)
    try:
        full = shuffle_test(m, act, target, mask, ShuffleConfig(**kw), session.fs)
    except (ValueError, TypeError):
        pytest.skip("null not applicable to this target")
    chunked = shuffle_test(m, act, target, mask, ShuffleConfig(max_null_bytes=1, **kw), session.fs)
    return full, chunked


def _same(a, b):
    assert b.null_info["chunks"] > 1
    assert "chunks" not in a.null_info
    assert a.null is None and b.null is None
    for f in ("observed", "null_median", "null_mean", "null_std", "null_lo", "null_hi", "p_adj"):
        np.testing.assert_allclose(
            getattr(a, f), getattr(b, f), rtol=1e-12, atol=1e-12, equal_nan=True
        )
    np.testing.assert_array_equal(a.p_value, b.p_value)
    np.testing.assert_array_equal(a.significant, b.significant)
    np.testing.assert_array_equal(a.significant_adj, b.significant_adj)
    assert a.correction_note == b.correction_note


@pytest.mark.parametrize("null", NULLS, ids=lambda n: n["name"])
@pytest.mark.parametrize("metric", METRICS)
def test_chunked_equals_full(small_session, metric, null):
    if null["name"] == "within_state_shuffle" and metric in (
        "information_content",
        "auroc",
        "place_fields",
    ):
        # exactly invariant metrics: p-values are decided by float round-off, not comparable
        pytest.skip("metric is invariant under within_state_shuffle")
    _same(*_both(small_session, metric, null))


@pytest.mark.parametrize("correction", ["max_stat", "bh", "bonferroni"])
@pytest.mark.parametrize("null", NULLS[:2], ids=lambda n: n["name"])
def test_chunked_equals_full_with_correction(small_session, correction, null):
    _same(*_both(small_session, "auroc", null, correction=correction))


def test_chunked_equals_full_n_jobs(small_session):
    _same(*_both(small_session, "information_content", NULLS[0], n_jobs=2))
    _same(*_both(small_session, "information_content", NULLS[1], n_jobs=2))


def test_cell_shift_not_chunked(small_session):
    m, target, mask = _setup(small_session, "information_content")
    act = np.asarray(small_session.activity, float)
    cfg = ShuffleConfig(
        n_shuffles=6,
        null={"name": "cell_shift", "min_shift_s": 5.0},
        keep_null="none",
        max_null_bytes=1,
    )
    r = shuffle_test(m, act, target, mask, cfg, small_session.fs)
    assert "chunks" not in r.null_info


def test_population_metric_not_chunked(small_session):
    m, target, mask = _setup(small_session, "pairwise_correlation")
    act = np.asarray(small_session.activity, float)
    cfg = ShuffleConfig(n_shuffles=4, keep_null="none", max_null_bytes=1, min_shift_s=5.0)
    assert "chunks" not in shuffle_test(m, act, target, mask, cfg, small_session.fs).null_info


def test_keep_full_not_chunked(small_session):
    m, target, mask = _setup(small_session, "information_content")
    act = np.asarray(small_session.activity, float)
    cfg = ShuffleConfig(n_shuffles=6, max_null_bytes=1, min_shift_s=5.0)
    r = shuffle_test(m, act, target, mask, cfg, small_session.fs)
    assert r.null is not None and "chunks" not in r.null_info


def test_progress_monotone_and_ends_at_total(small_session):
    m, target, mask = _setup(small_session, "information_content")
    act = np.asarray(small_session.activity, float)
    calls: list[tuple[int, int]] = []
    cfg = ShuffleConfig(
        n_shuffles=12, batch_size=5, keep_null="none", max_null_bytes=12 * 8 * 5, min_shift_s=5.0
    )
    r = shuffle_test(
        m, act, target, mask, cfg, small_session.fs, on_batch=lambda d, t: calls.append((d, t))
    )
    n_chunks = r.null_info["chunks"]
    assert n_chunks == 4
    done = [d for d, _ in calls]
    assert done == sorted(done)  # non-decreasing, in true shuffle units
    assert {t for _, t in calls} == {12}
    assert calls[-1] == (12, 12)


def test_cancel_inside_chunk(small_session):
    m, target, mask = _setup(small_session, "information_content")
    act = np.asarray(small_session.activity, float)
    seen = {"n": 0}

    def cancel() -> bool:
        seen["n"] += 1
        return seen["n"] > 4  # past the first chunk (3 batches), inside the second

    cfg = ShuffleConfig(
        n_shuffles=12, batch_size=5, keep_null="none", max_null_bytes=12 * 8 * 5, min_shift_s=5.0
    )
    with pytest.raises(RunCancelled):
        shuffle_test(m, act, target, mask, cfg, small_session.fs, should_cancel=cancel)


def test_null_dtype_float32(small_session):
    m, target, mask = _setup(small_session, "information_content")
    act = np.asarray(small_session.activity, float)
    kw = dict(n_shuffles=200, seed=1, min_shift_s=5.0)
    r64 = shuffle_test(m, act, target, mask, ShuffleConfig(**kw), small_session.fs)
    r32 = shuffle_test(
        m, act, target, mask, ShuffleConfig(null_dtype="float32", **kw), small_session.fs
    )
    assert r64.null.dtype == np.float64 and r32.null.dtype == np.float32
    assert np.abs(r32.p_value - r64.p_value).max() < 0.02
    np.testing.assert_allclose(r32.null, r64.null, rtol=1e-6)


def test_labels_and_counts_cache(small_session):
    sp = small_session.states["position"]
    mask = np.random.default_rng(0).random(sp.n_time) > 0.3
    a = sp.labels(mask)
    assert sp.labels(mask.copy()) is a
    assert sp.labels() is sp.labels()
    assert sp.labels(~mask) is not a
    with pytest.raises(ValueError):
        a[0] = 3
    c = ss.masked_counts(sp, mask)
    assert ss.masked_counts(sp, mask.copy()) is c
    assert ss.masked_counts(sp, ~mask) is not c
    with pytest.raises(ValueError):
        c[0] = 1.0
    np.testing.assert_array_equal(c, sp.onehot[mask].sum(axis=0))


def test_cache_bounded(small_session):
    sp = small_session.states["position"]
    rng = np.random.default_rng(1)
    first = rng.random(sp.n_time) > 0.5
    sp.labels(first)
    for _ in range(10):
        sp.labels(rng.random(sp.n_time) > 0.5)
    assert sum(k[0] == "labels" for k in sp._cache) <= 8


def test_pipeline_results_identical_with_cache(small_session):
    pipe = Pipeline(
        analyses=[
            {
                "metric": {"name": "information_content"},
                "states": "position",
                "shuffle": ShuffleConfig(n_shuffles=20, min_shift_s=5.0),
            },
        ]
    )
    _, r1 = pipe.run(small_session)
    _, r2 = pipe.run(small_session)
    for k in r1.names():
        np.testing.assert_array_equal(r1[k].values, r2[k].values)
        np.testing.assert_array_equal(r1[k].shuffle.p_value, r2[k].shuffle.p_value)


# -- memory_estimate ------------------------------------------------------------


def _grid_session(n_cells=12, n_time=400, n_states=6400):
    rng = np.random.default_rng(0)
    lab = rng.integers(0, n_states, n_time)
    onehot = np.zeros((n_time, n_states), bool)
    onehot[np.arange(n_time), lab] = True
    space = cabana.StateSpace(
        name="grid",
        onehot=onehot,
        state_names=[str(i) for i in range(n_states)],
        kind="categorical",
        exclusive=True,
    )
    return cabana.Session(
        activity=rng.random((n_cells, n_time)),
        t=np.arange(n_time) / 10.0,
        fs=10.0,
        states={"grid": space},
    )


def _pipe(**shuffle):
    return Pipeline(
        analyses=[
            {
                "metric": {"name": "auroc"},
                "states": "grid",
                "shuffle": ShuffleConfig(n_shuffles=1000, **shuffle),
            },
            {
                "metric": {"name": "information_content"},
                "states": "grid",
                "shuffle": ShuffleConfig(n_shuffles=1000, **shuffle),
            },
        ]
    )


def test_memory_estimate_arithmetic():
    sess = _grid_session()
    est = memory_estimate(_pipe(), sess)
    a, ic = (est.per_analysis[n] for n in est.per_analysis)
    assert a.null_bytes == 1000 * 12 * 6400 * 8 == 614_400_000
    assert ic.null_bytes == 1000 * 12 * 8
    assert a.batch_bytes == 100 * 12 * 6400 * 8
    assert a.indicator_bytes == 0  # 6400 states > DENSE_MAX_STATES
    assert not a.chunked and a.n_chunks == 1
    assert est.session_bytes == sess.activity.nbytes + sess.states["grid"].onehot.nbytes
    assert est.peak_bytes >= max(x.null_bytes for x in est.per_analysis.values())
    assert est.peak_bytes == est.session_bytes + max(
        x.total_bytes for x in est.per_analysis.values()
    )
    assert shuffle_memory_bytes(1000, (12, 6400)) == a.null_bytes
    s = str(est)
    assert "MB" in s and "peak" in s
    assert est.to_dict()["peak_bytes"] == est.peak_bytes


def test_memory_estimate_suggests_and_chunks():
    sess = _grid_session()
    big = memory_estimate(_pipe(max_null_bytes=1 << 28), sess)
    assert any("keep_null='none'" in s and "MB" in s for s in big.suggestions)
    chunked = memory_estimate(_pipe(max_null_bytes=1 << 28, keep_null="none"), sess)
    a = next(iter(chunked.per_analysis.values()))
    assert a.chunked and a.n_chunks == 3  # 5 cells * 6400 * 1000 * 8 = 256 MB per chunk
    assert a.null_bytes == 1000 * 5 * 6400 * 8 <= 1 << 28
    assert not any("keep_null='none'" in s for s in chunked.suggestions)
    quiet = memory_estimate(_pipe(), sess)
    assert not any("keep_null='none'" in s for s in quiet.suggestions)


def test_memory_estimate_does_not_compute(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("metric run")

    monkeypatch.setattr(type(build("metric", {"name": "auroc"})), "compute", boom)
    memory_estimate(_pipe(), _grid_session())


def test_memory_estimate_missing_target():
    est = memory_estimate(_pipe(), _grid_session().model_copy(update={"states": {}}))
    assert not est.per_analysis and "not in session" in est.suggestions[0]


def test_cell_separable_check_flags_cross_cell_metric(small_session):
    from typing import ClassVar

    from cabana import Metric, register
    from cabana._metrics import InformationContent

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")

        @register("metric")
        class _Centered(InformationContent):
            name: ClassVar[str] = "_centered_ic"

            def compute(self, activity, target, mask, fs):
                v = super().compute(activity, target, mask, fs)
                return v - np.nanmean(v)

            def compute_shifted(self, *a, **k):
                return None

    try:
        rep = cabana.check_plugin(_Centered(), small_session)
    finally:
        from cabana._registry import _REGISTRY

        _REGISTRY["metric"].pop("_centered_ic", None)
    assert any(n == "cell_separable" for n, ok, _ in rep.failed())
    assert "cell_separable = False" in dict((n, m) for n, _, m in rep.checks)["cell_separable"]
    assert isinstance(Metric.cell_separable, bool)


# -- review fixes ---------------------------------------------------------------


@pytest.mark.parametrize("tail", ["upper", "lower", "two"])
def test_float32_exact_ties_stay_ties(tail):
    from cabana._shuffle import _p_values

    obs = np.array([0.7, 0.1])
    null64 = np.full((50, 2), 0.7)
    null64[:, 1] = 0.1
    p64 = _p_values(obs, null64, tail)
    p32 = _p_values(obs, null64.astype(np.float32), tail)
    np.testing.assert_array_equal(p32, p64)
    if tail != "two":
        assert p32[0] == 1.0


def test_float32_max_stat_ties():
    from cabana._shuffle import _max_stat_p

    obs = np.full((1, 3), 0.7)
    null = np.full((40, 1, 3), 0.7)
    for tail in ("upper", "lower"):
        p = np.ones((1, 3))
        a64 = _max_stat_p(obs, null, tail, p)
        a32 = _max_stat_p(obs, null.astype(np.float32), tail, p)
        np.testing.assert_array_equal(a32, a64)


def test_float32_pipeline_ties(small_session):
    m, target, mask = _setup(small_session, "information_content")
    act = np.asarray(small_session.activity, float)
    cfg = dict(n_shuffles=30, seed=1, min_shift_s=5.0, null_dtype="float32")
    r = shuffle_test(m, act, target, mask, ShuffleConfig(**cfg), small_session.fs)
    # observed equal to every draw must give p == 1 (here: force it)
    r.null[:] = np.float32(r.observed.flat[0]) if r.observed.size else 0
    from cabana._shuffle import _p_values

    p = _p_values(np.full(r.observed.shape, r.observed.flat[0]), r.null, "upper")
    assert np.all(p == 1.0)


def test_memory_estimate_glm_shape():
    from cabana import AnalysisSpec
    from cabana._design import design_columns

    sess = cabana.simulate_session(duration_s=120, n_cells=12)
    tr = [
        {"name": "resample_signal", "source": "position"},
        {"name": "speed", "signals": ["x", "y"]},
        {"name": "bouts_to_states", "source": "social", "add_rest": False},
        {"name": "design_matrix", "states": ["social"], "signals": ["speed"]},
    ]
    prepared, _ = Pipeline(transforms=tr, preprocess=[{"name": "rebin_time", "bin_s": 0.5}]).run(
        sess
    )
    names = design_columns(prepared)
    pipe = Pipeline(
        analyses=[
            AnalysisSpec(
                metric={"name": "glm_encoding", "regressor_names": names},
                signal="design",
                masks=["social_scored"],
                shuffle={"n_shuffles": 10, "keep_null": "none", "min_shift_s": 5.0},
            )
        ]
    )
    a = next(iter(memory_estimate(pipe, prepared).per_analysis.values()))
    _, res = pipe.run(prepared)
    real = res.get("glm_encoding", "design").values
    assert real.ndim == 2 and real.shape[1] > 1
    assert a.output_shape == real.shape
    # without metadata and names: falls back to the signal's width
    pipe2 = Pipeline(analyses=[AnalysisSpec(metric={"name": "glm_encoding"}, signal="design")])
    prepared.meta.pop("design_columns", None)
    b = next(iter(memory_estimate(pipe2, prepared).per_analysis.values()))
    assert b.output_shape == (real.shape[0], prepared.signals["design"].shape[1])


@pytest.mark.parametrize("chunked", [False, True])
def test_estimate_within_factor_two_of_tracemalloc(chunked):
    import tracemalloc

    rng = np.random.default_rng(0)
    n_time, ns = 3000, 100
    lab = rng.integers(0, ns, n_time)
    oh = np.zeros((n_time, ns), bool)
    oh[np.arange(n_time), lab] = True
    sp = cabana.StateSpace(
        name="g",
        onehot=oh,
        state_names=[str(i) for i in range(ns)],
        kind="categorical",
        exclusive=True,
    )
    sess = cabana.Session(
        activity=rng.random((30, n_time)), t=np.arange(n_time) / 10.0, fs=10.0, states={"g": sp}
    )
    kw = {"keep_null": "none", "max_null_bytes": 300 * 10 * ns * 8} if chunked else {}
    pipe = Pipeline(
        analyses=[
            {
                "metric": {"name": "auroc"},
                "states": "g",
                "shuffle": ShuffleConfig(n_shuffles=300, batch_size=50, min_shift_s=5.0, **kw),
            }
        ]
    )
    a = next(iter(memory_estimate(pipe, sess).per_analysis.values()))
    assert a.chunked == chunked and a.summary_bytes == 3 * a.null_bytes
    tracemalloc.start()
    tracemalloc.reset_peak()
    try:
        pipe.run(sess)
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    assert 0.5 <= peak / a.total_bytes <= 2.0, (peak, a.total_bytes)


def test_plan_chunks_matches_engine(small_session):
    from cabana._shuffle import plan_chunks

    m, target, mask = _setup(small_session, "information_content")
    cfg = ShuffleConfig(
        n_shuffles=12, batch_size=5, keep_null="none", max_null_bytes=12 * 8 * 5, min_shift_s=5.0
    )
    obs = np.asarray(m.compute(np.asarray(small_session.activity, float), target, mask, 100.0))
    n, cells, full, held = plan_chunks(m, cfg.resolved_null(), obs.shape, cfg)
    r = shuffle_test(
        m, np.asarray(small_session.activity, float), target, mask, cfg, small_session.fs
    )
    assert n == r.null_info["chunks"] and held <= cfg.max_null_bytes < full
    assert cells * n >= obs.shape[0]


def test_chunked_warnings_once(small_session):
    m, target, mask = _setup(small_session, "information_content")
    act = np.asarray(small_session.activity, float)
    kw = dict(
        n_shuffles=10,
        batch_size=5,
        seed=3,
        keep_null="none",
        null={"name": "within_state_shuffle", "block_s": 60.0},
    )
    try:
        with warnings.catch_warnings(record=True) as w_full:
            warnings.simplefilter("always")
            shuffle_test(m, act, target, mask, ShuffleConfig(**kw), small_session.fs)
        with warnings.catch_warnings(record=True) as w_ch:
            warnings.simplefilter("always")
            r = shuffle_test(
                m, act, target, mask, ShuffleConfig(max_null_bytes=1, **kw), small_session.fs
            )
    except (ValueError, TypeError):
        pytest.skip("null not applicable")
    keys = [(x.category, str(x.message)) for x in w_ch]
    assert r.null_info["chunks"] > 1
    assert len(keys) == len(set(keys))
    assert set(keys) == {(x.category, str(x.message)) for x in w_full}


def test_statespace_pickle_drops_cache(small_session):
    import pickle

    sp = small_session.states["position"].model_copy()
    sp.labels(np.ones(sp.n_time, bool))
    assert sp._cache
    sp2 = pickle.loads(pickle.dumps(sp))
    assert sp2._cache == {}
    assert sp._cache  # source untouched
    np.testing.assert_array_equal(sp2.onehot, sp.onehot)


def test_statespace_cache_invalidation(small_session):
    import copy

    sp = small_session.states["position"].model_copy()
    mask = np.ones(sp.n_time, bool)
    sp.labels(mask)
    c = copy.copy(sp)
    assert c._cache == {} and sp._cache
    c.labels(mask)
    assert c._cache is not sp._cache
    for name, value in (
        ("onehot", sp.onehot.copy()),
        ("support", None),
        ("exclusive", sp.exclusive),
        ("state_names", list(sp.state_names)),
    ):
        sp.labels(mask)
        assert sp._cache
        setattr(sp, name, value)
        assert sp._cache == {}
    sp.labels(mask)
    sp.name = "other"  # unrelated fields keep the cache
    assert sp._cache
