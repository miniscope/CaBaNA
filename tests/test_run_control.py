import json
import math
import warnings
from typing import ClassVar

import numpy as np
import pytest

from cabana import (
    Metric,
    Pipeline,
    ProgressEvent,
    RunCancelled,
    RunContext,
    Session,
    StateSpace,
    ShuffleConfig,
    SessionSet,
    describe,
    register,
    run_set,
    shuffle_test,
)
from cabana._io import load_results
from cabana._registry import available
from cabana._shuffle import shifted_sums

FS = 10.0
N = 200


@register("metric")
class _RcMean(Metric):
    name: ClassVar[str] = "rc_mean"

    def compute(self, activity, states, mask, fs):
        m = states.masked(mask)
        with np.errstate(invalid="ignore", divide="ignore"):
            return (activity @ m) / m.sum(axis=0)

    def compute_shifted(self, activity, states, mask, fs, shifts):
        m = states.masked(mask)
        with np.errstate(invalid="ignore", divide="ignore"):
            return shifted_sums(activity, m, shifts) / m.sum(axis=0)


@register("metric")
class _RcLoop(Metric):  # no fast path: exercises the loop branch
    name: ClassVar[str] = "rc_loop"

    def compute(self, activity, states, mask, fs):
        return _RcMean().compute(activity, states, mask, fs)


@register("metric")
class _RcBoom(Metric):
    name: ClassVar[str] = "rc_boom"

    def compute(self, activity, states, mask, fs):
        raise ValueError("boom")


@register("metric")
class _RcWarn(Metric):
    name: ClassVar[str] = "rc_warn"

    def compute(self, activity, states, mask, fs):
        warnings.warn("careful now", UserWarning, stacklevel=2)
        return _RcMean().compute(activity, states, mask, fs)


def make_session(seed=1):
    rng = np.random.default_rng(seed)
    lab = np.repeat([0, 1, 2, 0], N // 4)
    sp = StateSpace(
        name="cat",
        onehot=np.eye(3, dtype=bool)[lab],
        state_names=["a", "b", "c"],
        kind="categorical",
        exclusive=True,
    )
    return Session(
        activity=rng.random((4, N)),
        t=np.arange(N) / FS,
        fs=FS,
        cell_ids=["c0", "c1", "c2", "c3"],
        states={"cat": sp},
    )


def spec(metric, name=None, n=None):
    d = {"metric": {"name": metric}, "states": "cat", "name": name}
    if n:
        d["shuffle"] = ShuffleConfig(n_shuffles=n, min_shift_s=0.5, batch_size=10)
    return d


def test_progress_events_monotone():
    events: list[ProgressEvent] = []
    pipe = Pipeline(
        preprocess=[{"name": "zscore_activity"}],
        analyses=[spec("rc_mean", "a", 25), spec("rc_mean", "b")],
    )
    _, rs = pipe.run(make_session(), context=RunContext(on_progress=events.append))
    fr = [e.fraction for e in events]
    assert fr == sorted(fr) and fr[-1] == 1.0 and events[-1].stage == "done"
    assert {e.stage for e in events} == {"preprocess", "analysis", "shuffle", "done"}
    sh = [e for e in events if e.stage == "shuffle"]
    assert [e.shuffles_done for e in sh] == [10, 20, 25]
    assert all(e.shuffles_total == 25 for e in sh)
    assert all(e.total == 2 for e in events if e.stage == "analysis")
    assert rs.status == "ok" and rs.completed == ["a", "b"]


def test_cancel_after_first_analysis():
    done = []
    ctx = RunContext(
        on_progress=lambda e: (
            done.append(e.name) if (e.stage == "analysis" and e.message == "finished") else None
        ),
        should_cancel=lambda: bool(done),
    )
    pipe = Pipeline(analyses=[spec("rc_mean", "a"), spec("rc_mean", "b"), spec("rc_mean", "c")])
    _, rs = pipe.run(make_session(), context=ctx)
    assert rs.status == "cancelled" and rs.cancelled
    assert rs.completed == ["a"] and rs.names() == ["a"]


def test_cancel_mid_shuffle():
    calls = []

    def cancel():
        calls.append(1)
        return len(calls) >= 2

    pipe = Pipeline(analyses=[spec("rc_mean", "a", 50)])
    _, rs = pipe.run(make_session(), context=RunContext(should_cancel=cancel))
    assert rs.cancelled and rs.completed == []


def test_on_error_record_and_raise():
    pipe = Pipeline(analyses=[spec("rc_boom", "bad"), spec("rc_mean", "good")])
    with pytest.raises(ValueError, match="boom"):
        pipe.run(make_session())
    _, rs = pipe.run(make_session(), context=RunContext(on_error="record"))
    assert rs.status == "partial" and rs.names() == ["good"]
    (e,) = rs.errors
    assert (e.analysis, e.metric, e.target, e.error_type) == ("bad", "rc_boom", "cat", "ValueError")
    assert "boom" in e.message and "Traceback" in e.traceback


def test_warnings_captured_and_emitted():
    pipe = Pipeline(analyses=[spec("rc_warn", "w")])
    with pytest.warns(UserWarning, match="careful"):
        _, rs = pipe.run(make_session())
    assert [(w.analysis, w.category) for w in rs.warnings][0] == ("w", "UserWarning")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        _, rs = pipe.run(make_session(), context=RunContext(capture_warnings=False))
    assert rs.warnings == []


def test_status_roundtrip(tmp_path):
    pipe = Pipeline(analyses=[spec("rc_boom", "bad"), spec("rc_warn", "w")])
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        _, rs = pipe.run(make_session(), context=RunContext(on_error="record"))
    rs.save(tmp_path / "rs")
    back = load_results(tmp_path / "rs")
    assert back.status == "partial" and back.completed == ["w"]
    assert back.errors[0].analysis == "bad" and back.warnings[0].analysis == "w"


def test_iter_run_incremental():
    pipe = Pipeline(analyses=[spec("rc_mean", "a"), spec("rc_mean", "b")])
    it = pipe.iter_run(make_session())
    key, sess = next(it)
    assert key == "session" and isinstance(sess, Session)
    key, eff = next(it)
    assert key == "pipeline" and isinstance(eff, Pipeline)
    assert next(it)[0] == "a"
    assert next(it)[0] == "b"
    assert list(it) == []


def test_run_set_table():
    pipe = Pipeline(analyses=[spec("rc_mean", "a")])
    events = []
    out = run_set(
        pipe,
        {"s1": make_session(1), "s2": make_session(2)},
        animal={"s1": "m1", "s2": "m2"},
        context=RunContext(on_progress=events.append),
    )
    df = out.table()
    assert set(df["session"]) == {"s1", "s2"} and set(df["animal"]) == {"m1", "m2"}
    assert any(e.message.startswith("s2") for e in events)
    assert events[-1].stage == "done" and events[-1].fraction == 1.0
    ss = SessionSet(sessions={"s1": make_session(1)}, animal={"s1": "m1"})
    assert set(run_set(pipe, ss).results) == {"s1"}


def test_describe_json():
    d = json.loads(json.dumps(describe()))
    assert set(d["plugins"]["metric"]) == set(available("metric"))
    m = d["plugins"]["metric"]["rc_mean"]
    assert m["level"] == "cell" and m["input"] == "states"
    assert d["schemas"]["ShuffleConfig"]["properties"]["n_shuffles"]
    assert "version" in d


@pytest.mark.parametrize("metric", ["rc_mean", "rc_loop"])
def test_on_batch_counts(metric):
    s = make_session()
    pipe = Pipeline(analyses=[spec(metric, "a", 35)])
    (a,) = pipe.analyses
    m = a.metric.model_copy()
    calls = []
    cfg = ShuffleConfig(n_shuffles=35, min_shift_s=0.5, batch_size=10)
    mask = np.ones(N, bool)
    shuffle_test(
        m, s.activity, s.states["cat"], mask, cfg, FS, on_batch=lambda d, t: calls.append((d, t))
    )
    assert len(calls) == math.ceil(35 / 10) and calls[-1] == (35, 35)
    with pytest.raises(RunCancelled):
        shuffle_test(m, s.activity, s.states["cat"], mask, cfg, FS, should_cancel=lambda: True)


def test_on_batch_counts_surrogate_null():
    s = make_session()
    m = Pipeline(analyses=[spec("rc_mean")]).analyses[0].metric
    cfg = ShuffleConfig(n_shuffles=25, null={"name": "label_shuffle"}, batch_size=10)
    calls = []
    shuffle_test(
        m,
        s.activity,
        s.states["cat"],
        np.ones(N, bool),
        cfg,
        FS,
        on_batch=lambda d, t: calls.append(d),
    )
    assert calls == [10, 20, 25]


def test_progress_true_prints(capsys):
    Pipeline(
        preprocess=[{"name": "zscore_activity"}],
        analyses=[spec("rc_mean", "my_analysis")],
    ).run(make_session(), progress=True)
    out = capsys.readouterr().out.splitlines()
    assert out == ["[preprocess] zscore_activity", "[analyze] my_analysis"]


@register("metric")
class _RcWarnFail(Metric):
    name: ClassVar[str] = "rc_warn_fail"

    def compute(self, activity, states, mask, fs):
        warnings.warn("before failing", UserWarning, stacklevel=2)
        raise ValueError("late boom")


def test_warning_recorded_when_analysis_fails():
    pipe = Pipeline(analyses=[spec("rc_warn_fail", "wf")])
    with pytest.warns(UserWarning, match="before failing"):
        _, rs = pipe.run(make_session(), context=RunContext(on_error="record"))
    assert rs.errors and [(w.analysis, w.message) for w in rs.warnings] == [
        ("wf", "before failing")
    ]


def test_warnings_deduplicated_under_shuffles():
    pipe = Pipeline(analyses=[spec("rc_warn", "w", 20)])
    with warnings.catch_warnings(record=True) as w:
        warnings.simplefilter("always")
        _, rs = pipe.run(make_session())
    assert len([x for x in w if "careful now" in str(x.message)]) == 1
    (rw,) = rs.warnings
    assert rw.count == 21


def test_warning_recorded_when_cancelled_mid_shuffle():
    calls = []

    def cancel():
        calls.append(1)
        return len(calls) >= 3

    pipe = Pipeline(analyses=[spec("rc_warn", "w", 50)])
    with pytest.warns(UserWarning, match="careful"):
        _, rs = pipe.run(make_session(), context=RunContext(should_cancel=cancel))
    assert rs.cancelled and len(rs.warnings) == 1


def test_cancel_checked_before_batch_not_after_last():
    state = {"computed": 0}

    def cancel():
        return state["computed"] >= 50  # True only after everything is computed

    class _Count(_RcLoop):
        name: ClassVar[str] = "rc_loop"

        def compute(self, activity, states, mask, fs):
            state["computed"] += 1
            return super().compute(activity, states, mask, fs)

    s = make_session()
    cfg = ShuffleConfig(n_shuffles=49, min_shift_s=0.5, batch_size=10)
    res = shuffle_test(
        _Count(), s.activity, s.states["cat"], s.valid_mask([]), cfg, FS, should_cancel=cancel
    )
    assert res.n_shuffles == 49


def test_run_set_validates_animal():
    pipe = Pipeline(analyses=[spec("rc_mean", "a")])
    with pytest.raises(ValueError, match="s2"):
        run_set(pipe, {"s1": make_session(1), "s2": make_session(2)}, animal={"s1": "m1"})
