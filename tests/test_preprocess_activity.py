import numpy as np
import pytest

from cabana import Session, build
from cabana._preprocess import BinarizeActivity, ZscoreActivity
from cabana._preprocess_activity import (
    BandpassActivity,
    ClipActivity,
    ComputeDff,
    DetectEvents,
    Detrend,
    estimate_noise,
)

FS = 20.0


def sess(a, kind="raw", fs=FS):
    a = np.atleast_2d(np.asarray(a, float))
    return Session(activity=a, t=np.arange(a.shape[1]) / fs, fs=fs, activity_kind=kind)


def transient_trace(n=6000, sigma=0.1, onsets=(), amp=2.0, tau=0.5, seed=0, base=0.0):
    rng = np.random.default_rng(seed)
    x = np.zeros(n)
    k = np.exp(-np.arange(int(5 * tau * FS)) / (tau * FS))
    for o in onsets:
        seg = min(k.size, n - o)
        x[o : o + seg] += amp * k[:seg]
    return base + x + rng.normal(0, sigma, n), x


def test_registered():
    for nm in ("compute_dff", "detrend", "bandpass_activity", "detect_events", "clip_activity"):
        assert build(
            "preprocess",
            {
                "name": nm,
                **({"baseline": "mean"} if nm == "compute_dff" else {}),
                **({"low_hz": 0.1} if nm == "bandpass_activity" else {}),
            },
        )


# ---- ComputeDff -------------------------------------------------------- #
def test_dff_recovers_amplitude():
    x, truth = transient_trace(onsets=[500, 2000, 4000], amp=2.0, sigma=0.02, base=0.0)
    f = 10.0 + x  # F0 = 10, transient 2 -> dF/F peak 0.2
    out = ComputeDff(baseline="percentile", percentile=8).apply(sess(f))
    assert out.activity_kind == "dff"
    assert out.activity.max() == pytest.approx(0.2, abs=0.03)
    assert abs(np.median(out.activity)) < 0.02
    out2 = ComputeDff(baseline="rolling_percentile", window_s=60).apply(sess(f))
    assert out2.activity.max() == pytest.approx(0.2, abs=0.03)
    out3 = ComputeDff(baseline="rolling_min", window_s=60).apply(sess(f))
    assert out3.activity.max() > 0.18


def test_dff_rolling_handles_bleach():
    n = 6000
    bleach = 10 * (1 + np.exp(-np.arange(n) / 2000.0))
    out = ComputeDff(baseline="rolling_percentile", window_s=60, percentile=50).apply(sess(bleach))
    assert np.abs(out.activity).max() < 0.1  # raw spans 0.5 of F0


def test_dff_kind_check_and_force():
    s = sess(np.ones((1, 100)), kind="dff")
    with pytest.raises(ValueError, match="raw"):
        ComputeDff(baseline="mean").apply(s)
    assert ComputeDff(baseline="mean", force=True).apply(s).activity_kind == "dff"
    assert (
        ComputeDff(baseline="mean").apply(sess(np.ones((1, 100)), "denoised")).activity_kind
        == "dff"
    )


def test_dff_nan_and_eps():
    a = np.full((2, 500), 5.0)
    a[:, 100:110] = np.nan
    a[1] = 0.0
    out = ComputeDff(baseline="percentile").apply(sess(a)).activity
    assert np.isnan(out[0, 100:110]).all() and np.isfinite(out[0, :100]).all()
    assert np.isfinite(out[1, 200])  # eps floor, no inf/nan from 0/0
    out = ComputeDff(baseline="rolling_percentile", window_s=5).apply(sess(a)).activity
    assert np.isnan(out[0, 100:110]).all() and np.isfinite(out[0, 120])


# ---- Detrend ----------------------------------------------------------- #
def test_detrend_removes_bleach():
    n = 6000
    tt = np.arange(n) / FS
    rng = np.random.default_rng(1)
    flat = 5 + rng.normal(0, 0.05, n)
    bleach = 3 * np.exp(-tt / 150.0)
    for method, kw in [
        ("linear", {}),
        ("rolling_percentile", {"window_s": 60, "percentile": 50}),
        ("highpass", {"cutoff_hz": 0.01}),
    ]:
        out = Detrend(method=method, **kw).apply(sess(flat + bleach))
        assert out.activity_kind == "raw"
        resid = out.activity[0] - flat
        resid = resid - resid.mean()
        if method == "linear":
            assert resid.std() < bleach.std()  # linear only partly removes an exponential
        else:
            assert np.abs(resid[200:-200]).mean() < 0.3 * np.abs(bleach - bleach.mean()).mean()
        assert out.activity[0].mean() == pytest.approx((flat + bleach).mean(), rel=0.05)


def test_detrend_linear_exact_and_no_preserve():
    x = 2.0 + 0.01 * np.arange(500)
    out = Detrend(method="linear", preserve_mean=False).apply(sess(x))
    assert np.abs(out.activity).max() < 1e-8


@pytest.mark.parametrize("kind", ["deconvolved", "spike_counts", "binary"])
def test_detrend_refuses_events(kind):
    with pytest.raises(ValueError, match="event"):
        Detrend().apply(sess(np.ones((1, 200)), kind))


def test_detrend_nan_propagates():
    a = np.arange(400, dtype=float)[None] * 0.01 + 1
    a[0, 50:60] = np.nan
    for m in ("linear", "rolling_percentile", "highpass"):
        out = Detrend(method=m, window_s=5, cutoff_hz=0.1).apply(sess(a)).activity
        assert (
            np.isnan(out[0, 50:60]).all()
            and np.isfinite(out[0, :50]).all()
            and np.isfinite(out[0, 60:]).all()
        )


# ---- Bandpass ---------------------------------------------------------- #
def test_bandpass_attenuates_tone():
    n = 4000
    tt = np.arange(n) / FS
    slow, fast = np.sin(2 * np.pi * 0.05 * tt), np.sin(2 * np.pi * 4.0 * tt)
    s = sess(slow + fast)
    lo = BandpassActivity(high_hz=1.0).apply(s).activity[0]
    assert np.std(lo - slow) < 0.05 and lo.std() == pytest.approx(slow.std(), rel=0.05)
    hi = BandpassActivity(low_hz=1.0).apply(s).activity[0]
    assert np.std(hi - fast) < 0.05
    bp = BandpassActivity(low_hz=2.0, high_hz=6.0).apply(s).activity[0]
    assert np.std(bp[100:-100] - fast[100:-100]) < 0.15
    assert BandpassActivity(high_hz=1.0).apply(s).activity_kind == "raw"


def test_bandpass_errors_and_nan():
    with pytest.raises(ValueError):
        BandpassActivity()
    with pytest.raises(ValueError):
        BandpassActivity(low_hz=3, high_hz=1)
    s = sess(np.random.default_rng(0).normal(size=(1, 500)))
    with pytest.raises(ValueError, match="Nyquist"):
        BandpassActivity(high_hz=FS).apply(s)
    with pytest.raises(ValueError, match="event"):
        BandpassActivity(high_hz=1).apply(sess(np.ones((1, 500)), "spike_counts"))
    a = np.random.default_rng(0).normal(size=(2, 500))
    a[0, 100:120] = np.nan
    a[1] = np.nan
    out = BandpassActivity(high_hz=2.0).apply(sess(a)).activity
    assert np.isnan(out[0, 100:120]).all() and np.isfinite(out[0, :100]).all()
    assert np.isnan(out[1]).all()


# ---- DetectEvents ------------------------------------------------------ #
def test_noise_estimates_within_15pct():
    sigma = 0.1
    onsets = list(range(300, 5800, 400))
    x, _ = transient_trace(sigma=sigma, onsets=onsets, amp=1.5)
    a = x[None]
    res = {}
    for how in ("diff_mad", "mad", "psd"):
        res[how] = estimate_noise(a, FS, how)[0]
    print("noise estimates (truth 0.1):", res)
    assert res["diff_mad"] == pytest.approx(sigma, rel=0.15)
    assert res["psd"] == pytest.approx(sigma, rel=0.25)  # transients leak into the PSD
    # pure noise: all three agree
    w = np.random.default_rng(3).normal(0, sigma, (1, 6000))
    for how in ("diff_mad", "mad", "psd"):
        assert estimate_noise(w, FS, how)[0] == pytest.approx(sigma, rel=0.15)


def planted(n_cells=10, n=6000, sigma=0.1, amp=1.5, seed=0):
    rng = np.random.default_rng(seed)
    onsets = np.arange(300, 5700, 400)
    acts, truth = [], []
    for c in range(n_cells):
        x, ev = transient_trace(
            n, sigma, onsets + rng.integers(-20, 20, onsets.size), amp, seed=seed + c
        )
        acts.append(x)
        truth.append(ev > 0.25 * amp * 0 + 0.5)  # frames where the transient is well above noise
    return np.array(acts), np.array(truth), onsets


def test_detect_events_sensitivity_and_false_positives():
    a, truth, onsets = planted()
    out = DetectEvents(k=3.0).apply(sess(a, "dff"))
    assert out.activity_kind == "binary"
    det = out.activity > 0
    sens = (det & truth).sum() / truth.sum()
    # false positives: frames far from any transient (truth-free zone) flagged
    quiet = ~np.array([np.convolve(t, np.ones(41), "same") > 0 for t in truth])
    fp = (det & quiet).sum() / quiet.sum()
    print(f"sensitivity {sens:.3f}  false-positive rate {fp:.4f}")
    assert sens >= 0.9 and fp <= 0.02
    # pure Gaussian noise
    w = np.random.default_rng(5).normal(0, 0.1, (20, 6000))
    fpn = (DetectEvents(k=3.0).apply(sess(w, "dff")).activity > 0).mean()
    print(f"false-positive rate on pure noise {fpn:.4f}")
    assert fpn <= 0.02
    rec = out.meta["detect_events"]
    assert len(rec["noise"]) == 10 and len(rec["threshold"]) == 10
    assert np.allclose(rec["noise"], 0.1, rtol=0.15)


def test_onsets_count_equals_planted():
    a, _, onsets = planted(n_cells=4, amp=3.0)
    out = DetectEvents(k=4.0, output="onsets", refractory_s=2.0).apply(sess(a, "dff"))
    assert out.activity_kind == "binary"
    assert (out.activity.sum(axis=1) == onsets.size).all()
    assert out.meta["detect_events"]["n_events"] == [onsets.size] * 4


def test_min_duration_and_refractory():
    x = np.zeros(200)
    x[10:12] = 5  # 2 frames
    x[30:40] = 5  # 10 frames
    x[44:50] = 5  # 6 frames, onset 14 frames (0.7 s) after the previous onset...
    s = sess(x + np.random.default_rng(0).normal(0, 0.01, 200), "dff")
    base = DetectEvents(method="threshold", threshold=1.0, output="onsets").apply(s)
    assert base.activity.sum() == 3
    md = DetectEvents(
        method="threshold", threshold=1.0, output="onsets", min_duration_s=0.25
    ).apply(s)
    assert list(np.flatnonzero(md.activity[0])) == [30, 44]  # 0.25 s = 5 frames
    rf = DetectEvents(method="threshold", threshold=1.0, output="onsets", refractory_s=1.0).apply(s)
    assert list(np.flatnonzero(rf.activity[0])) == [10, 30]  # 44 is 0.7 s after 30
    b = DetectEvents(method="threshold", threshold=1.0, min_duration_s=0.25).apply(s)
    assert b.activity[0].sum() == 16


def test_detect_amplitude_and_methods():
    a, _, _ = planted(n_cells=2)
    s = sess(a, "dff")
    out = DetectEvents(output="amplitude").apply(s)
    assert out.activity_kind == "deconvolved" and (out.activity >= 0).all()
    assert (out.activity[out.activity > 0] > 0.2).all()
    for kw in (
        {"method": "mad"},
        {"method": "percentile", "percentile": 99},
        {"noise": "psd"},
        {"noise": "mad"},
    ):
        r = DetectEvents(**kw).apply(s)
        assert r.activity_kind == "binary"
    r = DetectEvents(method="percentile", percentile=95).apply(s)
    assert (r.activity > 0).mean() == pytest.approx(0.05, abs=0.01)
    with pytest.raises(ValueError):
        DetectEvents(method="threshold")
    with pytest.raises(ValueError, match="binary"):
        DetectEvents().apply(sess(np.zeros((1, 100)), "binary"))


def test_detect_nan_propagates():
    a, _, _ = planted(n_cells=2)
    a[:, 1000:1010] = np.nan
    for o in ("binary", "onsets", "amplitude"):
        out = DetectEvents(output=o).apply(sess(a, "dff")).activity
        assert np.isnan(out[:, 1000:1010]).all() and np.isfinite(out[:, :1000]).all()


def test_rebin_after_detect_events_sums_counts():
    a, _, onsets = planted(n_cells=3, amp=3.0)
    ev = DetectEvents(k=4.0, output="onsets", refractory_s=2.0).apply(sess(a, "dff"))
    binned = ev.rebin(1.0)
    assert binned.activity_kind == "binary"
    np.testing.assert_allclose(
        binned.activity.sum(axis=1), ev.activity[:, : binned.n_time * 20].sum(axis=1)
    )
    assert binned.activity.max() >= 1


# ---- Clip -------------------------------------------------------------- #
def test_clip():
    a = np.array([[-1.0, 0.5, 3.0, np.nan]])
    out = ClipActivity().apply(sess(a, "dff"))
    np.testing.assert_array_equal(out.activity, [[0.0, 0.5, 3.0, np.nan]])
    assert out.activity_kind == "dff"
    out = ClipActivity(min=None, max=1.0).apply(sess(a))
    assert out.activity[0, 0] == -1.0 and out.activity[0, 2] == 1.0
    with pytest.raises(ValueError):
        ClipActivity(min=2, max=1)


# ---- Zscore / Binarize ------------------------------------------------- #
def test_zscore_by_global_masks_baseline():
    rng = np.random.default_rng(0)
    a = np.vstack([rng.normal(5, 1, 400), rng.normal(0, 10, 400)])
    s = sess(a, "dff").with_mask("m1", np.arange(400) < 300).with_mask("m2", np.arange(400) < 200)
    z = ZscoreActivity().apply(s)
    assert z.activity_kind == "zscored" and z.meta["zscore_source_kind"] == "dff"
    assert z.activity[:, :200].mean(axis=1) == pytest.approx([0, 0], abs=0.3)
    # explicit masks decouple from step order
    z1 = ZscoreActivity(mask_names=["m1"]).apply(s)
    assert z1.activity[:, :300].std(axis=1) == pytest.approx([1, 1], abs=1e-9)
    with pytest.raises(KeyError):
        ZscoreActivity(mask_names=["nope"]).apply(s)
    g = ZscoreActivity(by="global", mask_names=[]).apply(s).activity
    assert g.mean() == pytest.approx(0, abs=1e-9) and g.std() == pytest.approx(1, abs=1e-9)
    assert g[0].std() < g[1].std()  # relative amplitudes preserved
    bw = ZscoreActivity(baseline_window_s=(0.0, 5.0), mask_names=[]).apply(s).activity
    n5 = int(5 * FS) + 1
    assert bw[:, :n5].mean(axis=1) == pytest.approx([0, 0], abs=1e-9)
    assert bw[:, :n5].std(axis=1) == pytest.approx([1, 1], abs=1e-9)
    with pytest.raises(ValueError):
        ZscoreActivity(baseline_window_s=(100.0, 200.0)).apply(s)


def test_zscore_nan():
    a = np.random.default_rng(0).normal(size=(2, 100))
    a[0, 10] = np.nan
    z = ZscoreActivity().apply(sess(a)).activity
    assert np.isnan(z[0, 10]) and np.isfinite(z[0, 11]) and np.isfinite(z[1]).all()


def test_binarize_kind():
    a = np.array([[0.0, 1.0, np.nan, 2.0]])
    out = BinarizeActivity(threshold=0.5).apply(sess(a, "dff"))
    assert out.activity_kind == "binary"
    np.testing.assert_array_equal(out.activity, [[0, 1, np.nan, 1]])
