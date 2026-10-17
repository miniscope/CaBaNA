"""Clock fitting, timing check, trimming and non-integer resampling."""

from __future__ import annotations

import warnings

import numpy as np
import pytest

from cabana import ContinuousSignal, Session, StateSpace, build, loaders
from cabana._alignment import apply_clock, fit_clock


def test_fit_clock_recovers_offset_and_scale():
    rng = np.random.default_rng(0)
    a = np.sort(rng.uniform(0, 600, 12))
    b = 0.9998 * (a - 12.4) + rng.normal(0, 1e-4, a.size)
    off, sc, rms = fit_clock(a, b, return_rms=True)
    assert off == pytest.approx(12.4, abs=5e-3) and sc == pytest.approx(0.9998, abs=1e-5)
    assert rms < 5e-4
    np.testing.assert_allclose(apply_clock(a, off, sc), b, atol=2e-3)
    assert fit_clock([100.0], [87.6]) == (pytest.approx(12.4), 1.0)
    np.testing.assert_allclose(apply_clock([100.0, 104.0], 12.4), [87.6, 91.6])
    assert loaders.fit_clock is fit_clock
    with pytest.raises(ValueError, match="events"):
        fit_clock([1, 2], [1])
    with pytest.raises(ValueError, match="identical"):
        fit_clock([1, 1], [1, 2])
    with pytest.raises(ValueError, match="not positive"):
        fit_clock([0, 1, 2], [2, 1, 0])


def _session(n=300, fs=30.0, kind="dff", drop=()):
    t = np.arange(n) / fs
    keep = np.ones(n, bool)
    keep[list(drop)] = False
    rng = np.random.default_rng(1)
    act = rng.random((3, n))[:, keep]
    t = t[keep]
    return Session(activity=act, t=t, fs=fs, activity_kind=kind)


def test_timing_check_pure_and_warns():
    s = _session(drop=range(100, 110))
    step = build("preprocess", {"name": "timing_check"})
    with pytest.warns(UserWarning, match="10 dropped frames"):
        out = step.apply(s)
    assert out.meta["timing"]["n_dropped_frames"] == 10 and not out.meta["timing"]["ok"]
    assert out.n_time == s.n_time and "timing" not in s.meta
    clean = _session()
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        out = step.apply(clean)
    assert out.meta["timing"]["ok"]
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        build("preprocess", {"name": "timing_check", "max_dropped_fraction": 0.5}).apply(s)
    s2 = s.replace(t=s.t + np.random.default_rng(0).normal(0, 0.01, s.n_time).cumsum() * 0)
    jit = s2.replace(t=np.sort(s2.t + np.random.default_rng(0).normal(0, 0.012, s2.n_time)))
    with pytest.warns(UserWarning, match="jitter"):
        build("preprocess", {"name": "timing_check", "max_dropped_fraction": 1.0}).apply(jit)


def test_trim_to_overlap():
    s = _session(n=300)
    t = s.t
    pos = ContinuousSignal(
        t=t[(t >= 2) & (t <= 7)],
        values=np.ones((((t >= 2) & (t <= 7)).sum(), 1)),
        channel_names=["x"],
    )
    s = s.replace(behavior={"position": pos})
    s = build("transform", {"name": "resample_signal", "source": "position"}).apply(s)
    out = build("preprocess", {"name": "trim_to_overlap", "signals": ["position"]}).apply(s)
    assert out.t[0] >= 2 - 1e-9 and out.t[-1] <= 7 + 1e-9 and out.masks["position_covered"].all()
    log = out.meta["trim_to_overlap"]
    assert (
        log["n_before"] == 300
        and log["n_after"] == out.n_time
        and out.meta["frame_selection"]["contiguous"]
    )
    assert np.isfinite(out.signals["x"]).all()
    out2 = build("preprocess", {"name": "trim_to_overlap", "t0_s": 3.0, "t1_s": 5.0}).apply(s)
    assert out2.t[0] >= 3.0 and out2.t[-1] <= 5.0 and out2.n_time == 61
    with pytest.raises(ValueError, match="no frame"):
        build("preprocess", {"name": "trim_to_overlap", "t0_s": 8.0, "t1_s": 9.0}).apply(s)
    with pytest.raises(KeyError, match="coverage"):
        build("preprocess", {"name": "trim_to_overlap", "signals": ["nope"]}).apply(s)
    with pytest.raises(ValueError, match="t1_s"):
        build("preprocess", {"name": "trim_to_overlap", "t0_s": 3.0, "t1_s": 2.0})


def test_trim_uses_state_support_and_longest_run():
    s = _session(n=100)
    sup = np.zeros(100, bool)
    sup[10:20] = True
    sup[40:90] = True
    st = StateSpace(
        name="st",
        onehot=np.zeros((100, 1), bool),
        state_names=["a"],
        kind="bouts",
        exclusive=False,
        support=sup,
    )
    s = s.with_state(st)
    with pytest.warns(UserWarning, match="dropped 10 other"):
        out = build("preprocess", {"name": "trim_to_overlap", "signals": ["st"]}).apply(s)
    assert out.n_time == 50 and out.meta["trim_to_overlap"]["start_frame"] == 40


def test_resample_integer_ratio_uses_rebin():
    s = _session(n=300, fs=30.0)
    out = build("preprocess", {"name": "resample", "fs_target": 10.0}).apply(s)
    ref = s.rebin(0.1)
    np.testing.assert_allclose(out.activity, ref.activity)
    assert out.fs == pytest.approx(10.0) and out.meta["resample"]["method"] == "rebin"
    assert build("preprocess", {"name": "resample", "fs_target": 30.0}).apply(s) is s


def test_resample_non_integer_continuous():
    fs = 30.0
    t = np.arange(600) / fs
    act = np.stack([np.sin(2 * np.pi * 0.5 * t), 2 * t])  # linear row is reproduced exactly
    sig = np.stack([t, np.where(t > 10, np.nan, 3 * t)], axis=1)
    mask = np.ones(600, bool)
    mask[100:110] = False
    s = Session(
        activity=act, t=t, fs=fs, activity_kind="dff", signals={"a": sig}, masks={"m": mask}
    )
    with pytest.warns(UserWarning, match="not an integer ratio") as rec:
        out = build("preprocess", {"name": "resample", "fs_target": 20.0}).apply(s)
    assert any("integer" in str(w.message) and "rebin" in str(w.message) for w in rec)
    assert out.fs == 20.0 and out.n_time == int(np.floor(t[-1] * 20)) + 1
    np.testing.assert_allclose(out.t, np.arange(out.n_time) / 20.0)
    np.testing.assert_allclose(out.activity[1], 2 * out.t, atol=1e-9)
    np.testing.assert_allclose(out.signals["a"][:, 0], out.t, atol=1e-9)
    assert np.isnan(out.signals["a"][-1, 1]) and np.isfinite(out.signals["a"][0, 1])
    m = out.masks["m"]
    assert not m[(out.t > 100 / fs) & (out.t < 109 / fs)].any() and m[0] and m[-1]
    assert out.meta["resample"]["method"] == "linear"


def test_resample_events_sum_and_states_nearest():
    fs = 30.0
    n = 600
    t = np.arange(n) / fs
    act = np.zeros((2, n))
    act[0, ::5] = 1.0
    act[1, 7] = 4.0
    lab = np.zeros((n, 2), bool)
    lab[:300, 0] = True
    lab[300:, 1] = True
    st = StateSpace(name="s", onehot=lab, state_names=["a", "b"], kind="categorical",
                    exclusive=True, support=np.ones(n, bool))  # fmt: skip
    s = Session(activity=act, t=t, fs=fs, activity_kind="spike_counts", states={"s": st})
    with pytest.warns(UserWarning, match="not an integer ratio"):
        out = build("preprocess", {"name": "resample", "fs_target": 20.0}).apply(s)
    assert out.meta["resample"]["method"] == "sum"
    assert abs(out.activity.sum() - act.sum()) <= 0.02 * act.sum() + 4  # edge frames only
    assert out.activity.min() >= 0
    o = out.states["s"]
    assert o.onehot[: out.n_time // 2 - 5, 0].all() and o.onehot[out.n_time // 2 + 5 :, 1].all()
    assert o.support.all()
    b = _session(n=600, kind="binary")
    b = b.with_activity((b.activity > 0.5).astype(float))
    with pytest.warns(UserWarning):
        ob = build("preprocess", {"name": "resample", "fs_target": 20.0}).apply(b)
    assert set(np.unique(ob.activity)) <= {0.0, 1.0}


def test_resample_signal_method_and_max_gap():
    t_s = np.arange(0, 5, 0.1)
    keep = np.ones(t_s.size, bool)
    keep[40:42] = False  # missing timestamps: samples at 3.9 then 4.2
    sig = ContinuousSignal(t=t_s[keep], values=t_s[keep, None], channel_names=["x"])
    s = Session(
        activity=np.zeros((1, 100)),
        t=np.arange(100) * 0.05,
        fs=20.0,
        behavior={"p": sig},
    )
    base = build("transform", {"name": "resample_signal", "source": "p"}).apply(s)
    assert np.isfinite(base.signals["x"][:99]).all()  # linear across the missing stamps
    capped = build("transform", {"name": "resample_signal", "source": "p", "max_gap_s": 0.25})
    x = capped.apply(s).signals["x"]
    assert np.isnan(x[79:84]).all() and np.isfinite(x[[78, 84]]).all()
    np.testing.assert_allclose(x[:79], base.signals["x"][:79])
    assert np.isfinite(
        build("transform", {"name": "resample_signal", "source": "p", "max_gap_s": 0.35})
        .apply(s)
        .signals["x"][:99]
    ).all()
    # a tracker dropout (NaN run) is handled by the nearest sample, and by max_gap_s for ffill
    v = t_s.copy()
    v[20:30] = np.nan
    s2 = s.replace(behavior={"p": ContinuousSignal(t=t_s, values=v[:, None], channel_names=["x"])})
    xn = build("transform", {"name": "resample_signal", "source": "p", "method": "nearest"})
    xn = xn.apply(s2).signals["x"]
    assert np.isfinite(xn[:38]).all() and np.isnan(xn[45]) and np.isnan(xn[50])
    ff = build(
        "transform", {"name": "resample_signal", "source": "p", "method": "ffill", "max_gap_s": 0.3}
    )
    ff = ff.apply(s2).signals["x"]
    assert ff[41] == pytest.approx(1.9) and np.isnan(ff[50]) and ff[62] == pytest.approx(3.1)
    d = build("transform", {"name": "resample_signal", "source": "p"}).to_dict()
    assert d["max_gap_s"] is None and d["method"] == "linear"  # defaults serialised like any plugin
    d2 = build("transform", {"name": "resample_signal", "source": "p", "max_gap_s": 1.0}).to_dict()
    assert d2["max_gap_s"] == 1.0 and d2["method"] == "linear"
