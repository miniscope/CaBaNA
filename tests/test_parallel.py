"""n_jobs: threads over shuffle batches, processes over sessions, resumable run_set."""

from __future__ import annotations

import json
import time
import warnings
from typing import ClassVar

import numpy as np
import pytest

from cabana import (
    Metric,
    Pipeline,
    ResultSet,
    RunCancelled,
    RunContext,
    RunSetResult,
    ShuffleConfig,
    build,
    register,
    run_set,
    shuffle_test,
)
from cabana._shuffle import in_shuffle_worker


def _run(sess, metric, states, null, n_jobs, n=40, bs=7, seed=5):
    m = build("metric", {"name": metric})
    m.configure(sess, states)
    cfg = ShuffleConfig(n_shuffles=n, batch_size=bs, seed=seed, null=null, n_jobs=n_jobs)
    return shuffle_test(m, sess.activity, sess.states[states], sess.valid_mask([]), cfg, sess.fs)


def _same(a, b):
    assert np.array_equal(a.observed, b.observed, equal_nan=True)
    assert np.array_equal(a.null, b.null, equal_nan=True)
    assert np.array_equal(a.p_value, b.p_value, equal_nan=True)
    if a.shifts is None:
        assert b.shifts is None
    else:
        assert np.array_equal(a.shifts, b.shifts)


@pytest.mark.parametrize(
    ("null", "metric", "states"),
    [
        (None, "auroc", "syllables"),
        (None, "mean_per_state", "social"),
        ({"name": "label_shuffle", "block_s": 2.0}, "auroc", "syllables"),
        ({"name": "bout_shuffle"}, "auroc", "social"),
    ],
)
def test_n_jobs_is_bit_identical(small_session, null, metric, states):
    r1 = _run(small_session, metric, states, null, 1)
    r3 = _run(small_session, metric, states, null, 3)
    _same(r1, r3)


def test_n_jobs_identical_on_sim_session(sim_session):
    r1 = _run(sim_session, "auroc", "syllables", None, 1, n=30, bs=5)
    r4 = _run(sim_session, "auroc", "syllables", None, 4, n=30, bs=5)
    _same(r1, r4)


def test_batch_size_does_not_change_target_null(small_session):
    a = _run(small_session, "auroc", "syllables", {"name": "label_shuffle"}, 1, bs=3)
    b = _run(small_session, "auroc", "syllables", {"name": "label_shuffle"}, 1, bs=40)
    _same(a, b)


def test_workers_are_flagged_so_inner_pools_stay_serial(small_session):
    seen: list[bool] = []

    @register("metric")
    class _Probe(Metric):
        name: ClassVar[str] = "_par_probe"

        def compute(self, activity, states, mask, fs):
            seen.append(in_shuffle_worker())
            return activity.mean(axis=1)

    st = small_session.states["syllables"]
    cfg = ShuffleConfig(n_shuffles=12, batch_size=3, n_jobs=3, null={"name": "label_shuffle"})
    shuffle_test(_Probe(), small_session.activity, st, small_session.valid_mask([]), cfg, 10.0)
    assert not seen[0] and all(seen[1:])  # observed in the caller, surrogates in workers


def test_cancel_midrun_with_threads_returns_without_hanging(small_session):
    m = build("metric", {"name": "auroc"})
    m.configure(small_session, "syllables")
    calls = {"n": 0}

    def cancel():
        calls["n"] += 1
        return calls["n"] > 4

    ticks: list[int] = []
    cfg = ShuffleConfig(n_shuffles=200, batch_size=5, n_jobs=3)
    t0 = time.time()
    with pytest.raises(RunCancelled):
        shuffle_test(
            m,
            small_session.activity,
            small_session.states["syllables"],
            small_session.valid_mask([]),
            cfg,
            small_session.fs,
            on_batch=lambda d, t: ticks.append(d),
            should_cancel=cancel,
        )
    assert time.time() - t0 < 30
    assert ticks == sorted(ticks) and 0 < ticks[-1] < 200


def _shuf_analysis(states, n=20):
    return {
        "metric": {"name": "auroc"},
        "states": states,
        "shuffle": ShuffleConfig(n_shuffles=n, batch_size=5),
    }


def test_pipeline_cancel_with_n_jobs_is_partial(small_session):
    pipe = Pipeline(analyses=[_shuf_analysis("syllables"), _shuf_analysis("social")])
    n = {"c": 0}

    def cancel():
        n["c"] += 1
        return n["c"] > 6

    _, rs = pipe.run(small_session, context=RunContext(should_cancel=cancel), n_jobs=3)
    assert rs.cancelled and len(rs) < 2


def test_worker_warnings_surface_once(small_session):
    @register("metric")
    class _Warny(Metric):
        name: ClassVar[str] = "_par_warny"

        def compute(self, activity, states, mask, fs):
            warnings.warn("loud metric", UserWarning, stacklevel=1)
            return activity.mean(axis=1)

    st = small_session.states["syllables"]
    cfg = ShuffleConfig(n_shuffles=12, batch_size=3, n_jobs=3, null={"name": "label_shuffle"})
    with warnings.catch_warnings(record=True) as rec:
        warnings.simplefilter("always")
        shuffle_test(_Warny(), small_session.activity, st, small_session.valid_mask([]), cfg, 10.0)
    # the observed call (caller thread) once, plus the 12 worker warnings collapsed to one
    assert len([w for w in rec if "loud metric" in str(w.message)]) == 2


def test_pipeline_n_jobs_override_and_provenance(small_session):
    pipe = Pipeline(analyses=[_shuf_analysis("syllables", 14)])
    _, a = pipe.run(small_session)
    _, b = pipe.run(small_session, n_jobs=3)
    assert a.results[0].provenance["n_jobs"] == 1 and b.results[0].provenance["n_jobs"] == 3
    assert pipe.analyses[0].shuffle.n_jobs == 1  # spec untouched
    assert b.results[0].params == a.results[0].params
    assert np.array_equal(a.results[0].shuffle.null, b.results[0].shuffle.null)
    _, c = pipe.run(small_session, context=RunContext(n_jobs=2))
    assert c.results[0].provenance["n_jobs"] == 2


# ---- run_set -------------------------------------------------------------------------

COUNT = {"n": 0}


@register("metric")
class _CountMean(Metric):
    name: ClassVar[str] = "_par_count_mean"

    def compute(self, activity, states, mask, fs):
        COUNT["n"] += 1
        return activity.mean(axis=1)


@register("metric")
class _CancelOnNeg(Metric):
    name: ClassVar[str] = "_par_cancel_on_neg"

    def compute(self, activity, states, mask, fs):
        if activity.sum() < 0:
            raise RunCancelled("session asked to stop")
        return activity.mean(axis=1)


def _pipe(metric="_par_count_mean"):
    return Pipeline(analyses=[{"metric": {"name": metric}, "states": "syllables"}])


def _sessions(small_session, k=3):
    return {f"s{i}": small_session for i in range(k)}


def test_run_set_out_dir_writes_and_resumes(small_session, tmp_path):
    out = tmp_path / "run"
    r1 = run_set(_pipe(), _sessions(small_session), out_dir=out)
    names = sorted(p.name for p in out.glob("*.results.zip"))
    assert names == [f"s{i}.results.zip" for i in range(3)]
    meta = json.loads((out / "run_set.json").read_text())
    assert {v["status"] for v in meta["sessions"].values()} == {"ok"}
    mt = {p.name: p.stat().st_mtime_ns for p in out.glob("*.zip")}
    COUNT["n"] = 0
    r2 = run_set(_pipe(), _sessions(small_session), out_dir=out)
    assert COUNT["n"] == 0  # nothing recomputed
    assert {p.name: p.stat().st_mtime_ns for p in out.glob("*.zip")} == mt
    assert set(r2.results) == set(r1.results) and r2.sessions_out == {}
    assert json.loads((out / "run_set.json").read_text())["sessions"]["s0"]["source"] == "resumed"
    run_set(_pipe(), _sessions(small_session), out_dir=out, resume=False)
    assert COUNT["n"] == 3
    loaded = RunSetResult.load(out)
    assert set(loaded.results) == {"s0", "s1", "s2"} and loaded.status["s1"] == "ok"


def test_run_set_resume_ignores_other_pipeline(small_session, tmp_path):
    out = tmp_path / "run"
    run_set(_pipe(), {"a": small_session}, out_dir=out)
    other = Pipeline(analyses=[{"metric": {"name": "mean_per_state"}, "states": "syllables"}])
    with pytest.warns(UserWarning, match="different pipeline"):
        r = run_set(other, {"a": small_session}, out_dir=out)
    assert r.results["a"].results[0].metric == "mean_per_state"


def test_run_set_cancelled_session_does_not_stop_the_rest(small_session, tmp_path):
    bad = small_session.replace(activity=-np.abs(small_session.activity) - 1.0)
    out = tmp_path / "run"
    r = run_set(
        _pipe("_par_cancel_on_neg"),
        {"s0": small_session, "bad": bad, "s2": small_session},
        out_dir=out,
    )
    assert r.status == {"s0": "ok", "bad": "cancelled", "s2": "ok"} and r.cancelled
    assert not (out / "bad.results.zip").exists()
    doc = json.loads((out / "run_set.json").read_text())
    assert doc["sessions"]["bad"]["status"] == "cancelled"


def test_run_set_shared_cancel_stops_the_rest(small_session):
    calls = {"n": 0}

    def cancel():
        calls["n"] += 1
        return calls["n"] > 1

    r = run_set(_pipe(), _sessions(small_session, 3), context=RunContext(should_cancel=cancel))
    assert r.cancelled and "not_run" in r.status.values()


def test_run_set_processes(small_session, tmp_path):
    pipe = Pipeline(analyses=[_shuf_analysis("syllables", 10)])
    ss = {"a": small_session, "b": small_session}
    serial = run_set(pipe, ss)
    events = []
    par = run_set(
        pipe, ss, n_jobs=2, out_dir=tmp_path, context=RunContext(on_progress=events.append)
    )
    for sid in ss:
        a, b = serial.results[sid].results[0], par.results[sid].results[0]
        assert np.array_equal(a.shuffle.null, b.shuffle.null)
    assert (tmp_path / "a.results.zip").exists() and events[-1].stage == "done"


def test_run_set_resume_skips_partial_and_empty(small_session, tmp_path):
    out = tmp_path / "run"
    # an empty, "partial" result set on disk must not be mistaken for a finished run
    rs = ResultSet(status="partial")
    out.mkdir()
    rs.save(out / "a.results.zip")
    with pytest.warns(UserWarning, match="holds no results"):
        r = run_set(_pipe(), {"a": small_session}, out_dir=out)
    assert r.status["a"] == "ok" and len(r.results["a"]) > 0
    # a saved partial run of the same pipeline is recomputed too
    full = ResultSet.load(out / "a.results.zip")
    full.status = "partial"
    full.save(out / "a.results.zip")
    with pytest.warns(UserWarning, match="status 'partial'"):
        r = run_set(_pipe(), {"a": small_session}, out_dir=out)
    assert r.status["a"] == "ok"
    assert json.loads((out / "run_set.json").read_text())["sessions"]["a"]["source"] == "computed"
