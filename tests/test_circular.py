import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402
from matplotlib.figure import Figure  # noqa: E402

import cabana  # noqa: E402
import cabana._metrics._circular  # noqa: E402, F401
from cabana import Session  # noqa: E402
from cabana._metrics._circular import CircularTuning  # noqa: E402
from cabana._pipeline import AnalysisSpec, Pipeline  # noqa: E402
from cabana._shuffle import ShuffleConfig  # noqa: E402

FS = 10.0
N = 6000


def synth(seed=0):
    rng = np.random.default_rng(seed)
    # heading wanders over the full circle
    ang = np.mod(np.cumsum(rng.normal(0, 0.25, N)), 2 * np.pi)
    bump = np.exp(2.0 * (np.cos(ang - np.pi / 2) - 1))  # von Mises, kappa=2 shape
    a0 = bump + 0.02 * rng.random(N)
    a1 = 0.5 + 0.02 * rng.random(N)
    return np.stack([a0, a1]), np.degrees(ang)


def test_recovery_deg_and_rad():
    act, deg = synth()
    mask = np.ones(N, bool)
    m = CircularTuning()
    v = m.compute(act, deg, mask, FS)
    ex = m.extras(act, deg, mask, FS)
    print("MVL", v, "pref", ex["preferred_direction"])
    assert v[0] > 0.6 and v[1] < 0.15
    assert abs(ex["preferred_direction"][0] - 90) < 10
    assert ex["tuning_curve"].shape == (2, 36) and ex["bin_centers"].shape == (36,)
    assert ex["bin_centers"][0] == pytest.approx(5.0)
    mr = CircularTuning(units="rad")
    vr = mr.compute(act, np.radians(deg), mask, FS)
    np.testing.assert_allclose(vr, v, atol=1e-12)
    pref = mr.extras(act, np.radians(deg), mask, FS)["preferred_direction"][0]
    assert abs(pref - np.pi / 2) < np.radians(10)
    assert 0 <= pref < 2 * np.pi


def test_smoothing_wraps_and_conserves():
    # peak on the seam: bins 0 and 35 both active
    ang = np.tile(np.arange(36) * 10.0 + 5.0, 20)
    act = np.zeros((1, ang.size))
    act[0, ang == 5.0] = 1.0
    m = CircularTuning(smooth_sigma_bins=1.5, min_occupancy_s=0.0)
    ex = m.extras(act, ang, np.ones(ang.size, bool), FS)
    raw = CircularTuning(min_occupancy_s=0.0).extras(act, ang, np.ones(ang.size, bool), FS)
    curve = ex["tuning_curve"][0]
    assert curve.sum() == pytest.approx(raw["tuning_curve"][0].sum())
    assert curve[35] == pytest.approx(curve[1])  # symmetric across the seam
    assert np.argmax(curve) == 0
    # smoothing keeps the 90 degree peak for the synthetic bump
    a, deg = synth()
    e2 = CircularTuning(smooth_sigma_bins=2.0).extras(a, deg, np.ones(N, bool), FS)
    assert abs(e2["preferred_direction"][0] - 90) < 10
    assert e2["tuning_curve"][0].sum() == pytest.approx(
        CircularTuning().extras(a, deg, np.ones(N, bool), FS)["tuning_curve"][0].sum(), rel=0.05
    )


def test_shifted_equals_loop():
    act, deg = synth(1)
    mask = np.random.default_rng(2).random(N) > 0.2
    shifts = np.array([0, 777, 4000])
    for kw in ({}, {"statistic": "rayleigh_z", "weight": "events"}, {"smooth_sigma_bins": 1.0}):
        m = CircularTuning(**kw)
        fast = m.compute_shifted(act, deg, mask, FS, shifts)
        loop = np.stack([m.compute(np.roll(act, int(k), axis=1), deg, mask, FS) for k in shifts])
        np.testing.assert_allclose(fast, loop, atol=1e-10)


def test_nan_frames_dropped_and_few_bins_nan():
    act, deg = synth()
    mask = np.ones(N, bool)
    deg2 = deg.copy()
    deg2[::3] = np.nan
    m = CircularTuning()
    v = m.compute(act, deg2, mask, FS)
    ref = m.compute(act, deg, mask & (np.arange(N) % 3 != 0), FS)
    np.testing.assert_allclose(v, ref, atol=1e-12)
    # one occupied bin only
    one = np.full(N, 12.0)
    assert np.isnan(m.compute(act, one, mask, FS)).all()
    assert np.isnan(m.compute(act, np.full(N, np.nan), mask, FS)).all()
    # input untouched
    assert np.isnan(deg2[0])


def test_check_plugin():
    act, deg = synth()
    s = Session(activity=act, t=np.arange(N) / FS, fs=FS, signals={"hd": deg})
    rep = cabana.check_plugin(CircularTuning(), s, target="hd")
    assert rep.passed, rep.checks
    assert CircularTuning.name == "circular_tuning"
    assert cabana.build("metric", {"name": "circular_tuning", "n_bins": 12}).n_bins == 12


def test_pipeline_and_plot():
    act, deg = synth()
    s = Session(activity=act, t=np.arange(N) / FS, fs=FS, signals={"hd": deg})
    pipe = Pipeline(
        analyses=[
            AnalysisSpec(
                metric={"name": "circular_tuning"},
                signal="hd",
                shuffle=ShuffleConfig(n_shuffles=10, seed=0, min_shift_s=5.0),
                masks=[],
            )
        ]
    )
    _, rs = pipe.run(s)
    r = rs.get("circular_tuning")
    assert r.values.shape == (2,) and r.shuffle is not None
    assert r.extras["tuning_curve"].shape == (2, 36)
    fig = r.plot()
    assert isinstance(fig, Figure)
    plt.close("all")
