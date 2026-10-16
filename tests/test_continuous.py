import time

import numpy as np
import pytest
from pydantic import ValidationError
from scipy.stats import spearmanr

import cabana
from cabana._metrics._continuous import SignalCorrelation, SignalTuning
from cabana._pipeline import AnalysisSpec, Pipeline
from cabana._shuffle import ShuffleConfig, shuffle_test


def rand_data(seed=0, n_cells=5, n=600):
    rng = np.random.default_rng(seed)
    y = rng.normal(size=n)
    act = np.abs(rng.normal(size=(n_cells, n))) + 0.3 * np.maximum(y, 0)
    mask = rng.random(n) > 0.3
    return act, y, mask


def test_hand_correlations():
    y = np.arange(100, dtype=float)
    act = np.stack([2 * y + 1, -y, np.tile([1.0, -1.0], 50) * 0 + np.r_[np.ones(50), -np.ones(50)][::1] * 0 + 5])
    # third row is constant -> NaN; build a truly uncorrelated row instead
    act[2] = np.tile([1.0, 2.0, 2.0, 1.0], 25)  # symmetric about the signal's midpoint pattern
    r = SignalCorrelation(min_frames=10).compute(act, y, np.ones(100, bool), 10.0)
    assert r[0] == pytest.approx(1.0, abs=1e-12)
    assert r[1] == pytest.approx(-1.0, abs=1e-12)
    assert r[2] == pytest.approx(np.corrcoef(act[2], y)[0, 1], abs=1e-12)
    # exactly zero: y symmetric, x = y^2 around its mean
    y2 = np.arange(-50, 51, dtype=float)
    r0 = SignalCorrelation(min_frames=10).compute((y2**2)[None], y2, np.ones(101, bool), 10.0)
    assert r0[0] == pytest.approx(0.0, abs=1e-12)
    # constant activity -> NaN; (n, 1) signal accepted; too few frames -> NaN
    c = SignalCorrelation(min_frames=10).compute(np.ones((1, 100)), y[:, None], np.ones(100, bool), 1.0)
    assert np.isnan(c[0])
    few = np.zeros(100, bool)
    few[:5] = True
    assert np.isnan(SignalCorrelation().compute(act, y, few, 1.0)).all()


def test_multi_column_signal_rejected():
    act, y, mask = rand_data()
    with pytest.raises(ValueError, match="single 1-D signal"):
        SignalCorrelation().compute(act, np.stack([y, y], axis=1), mask, 10.0)


@pytest.mark.parametrize("method", ["pearson", "spearman"])
def test_matches_numpy_scipy_with_mask_and_nan(method):
    act, y, mask = rand_data(1)
    y = y.copy()
    y[::17] = np.nan
    r = SignalCorrelation(method=method).compute(act, y, mask, 10.0)
    ok = mask & np.isfinite(y)
    for c in range(act.shape[0]):
        if method == "pearson":
            ref = np.corrcoef(act[c, ok], y[ok])[0, 1]
        else:
            ref = spearmanr(act[c, ok], y[ok])[0]
        assert r[c] == pytest.approx(ref, abs=1e-12)


@pytest.mark.parametrize("method", ["pearson", "spearman"])
@pytest.mark.parametrize("full_mask", [False, True])
def test_shifted_equals_loop(method, full_mask):
    act, y, mask = rand_data(2)
    if full_mask:
        mask = np.ones_like(mask)
    m = SignalCorrelation(method=method)
    shifts = np.array([0, 5, 111, 400, 599])
    fast = m.compute_shifted(act, y, mask, 10.0, shifts)
    slow = np.stack([m.compute(np.roll(act, int(k), axis=1), y, mask, 10.0) for k in shifts])
    assert fast.shape == (5, act.shape[0])
    np.testing.assert_allclose(fast, slow, atol=1e-12)


def test_xcorr_recovers_planted_lag():
    fs = 20.0
    rng = np.random.default_rng(3)
    n = 3000
    sig = np.convolve(rng.normal(size=n), np.ones(5) / 5, mode="same")
    act = np.roll(sig, 10)[None] + 0.3 * rng.normal(size=(1, n))  # activity[t] = signal[t - 10]
    m = SignalCorrelation(max_lag_s=1.0)
    ex = m.extras(act, sig, np.ones(n, bool), fs)
    assert ex["xcorr"].shape == (1, 41) and ex["lags_s"].shape == (41,)
    assert ex["best_lag_s"][0] == pytest.approx(10 / fs)  # positive: activity lags signal
    assert ex["n_frames"] == n
    ex2 = m.extras(np.roll(act, -20, axis=1), sig, np.ones(n, bool), fs)
    assert ex2["best_lag_s"][0] == pytest.approx(-10 / fs)  # activity leads signal
    assert "xcorr" not in SignalCorrelation().extras(act, sig, np.ones(n, bool), fs)


def test_tuning_staircase_hand_example():
    # 4 bins of signal values 0..3, 50 frames each at fs=10 (5 s per bin), rates 1,2,3,4 /s
    fs = 10.0
    y = np.repeat([0.5, 1.5, 2.5, 3.5], 50)
    rates = np.array([1.0, 2.0, 3.0, 4.0])
    act = np.zeros((1, 200))
    for b in range(4):
        act[0, b * 50] = rates[b] * 5  # sum over 5 s
    m = SignalTuning(n_bins=4, extent=(0.0, 4.0), min_occupancy_s=1.0)
    ex = m.extras(act, y, np.ones(200, bool), fs)
    np.testing.assert_allclose(ex["tuning_curve"][0], rates)
    np.testing.assert_allclose(ex["bin_centers"], [0.5, 1.5, 2.5, 3.5])
    np.testing.assert_allclose(ex["occupancy_s"], 5.0)
    assert ex["valid_bins"].all()
    p = np.full(4, 0.25)
    mean = rates.mean()
    si = (p * rates / mean * np.log2(rates / mean)).sum()
    assert m.compute(act, y, np.ones(200, bool), fs)[0] == pytest.approx(si)
    d = SignalTuning(n_bins=4, extent=(0.0, 4.0), statistic="depth").compute(act, y, np.ones(200, bool), fs)
    assert d[0] == pytest.approx(3 / 5)


@pytest.mark.parametrize("statistic", ["information", "depth"])
@pytest.mark.parametrize("sigma", [0.0, 1.0])
def test_tuning_shifted_equals_loop(statistic, sigma):
    act, y, mask = rand_data(4)
    m = SignalTuning(n_bins=8, min_occupancy_s=0.5, statistic=statistic, smooth_sigma_bins=sigma)
    shifts = np.array([0, 7, 123, 590])
    fast = m.compute_shifted(act, y, mask, 10.0, shifts)
    slow = np.stack([m.compute(np.roll(act, int(k), axis=1), y, mask, 10.0) for k in shifts])
    np.testing.assert_allclose(fast, slow, atol=1e-12)
    assert np.isfinite(fast).all()


def test_check_target_rejects_statespace():
    st = cabana.StateSpace(
        name="s", onehot=np.eye(4, dtype=bool), state_names=list("abcd"), kind="categorical", exclusive=True
    )
    with pytest.raises(ValueError, match="continuous signal"):
        SignalCorrelation().check_target(st)


@pytest.fixture(scope="module")
def sim_session():
    # With the default 20 mm/s gate the gate is open ~90% of the time, so place cells are only
    # weakly speed-correlated (power ~0.25); a 70 mm/s gate makes the speed dependence strong.
    s = cabana.simulate_session(duration_s=600, n_cells=40, speed_gate_mm_s=70.0)
    s = cabana.build("transform", {"name": "resample_signal", "source": "position"}).apply(s)
    s = cabana.build("transform", {"name": "speed"}).apply(s)
    return s


def test_planted_shuffle_speed_correlation(sim_session):
    s = sim_session
    gt = s.meta["ground_truth"]
    t0 = time.perf_counter()
    res = shuffle_test(
        SignalCorrelation(),
        s.activity,
        np.asarray(s.signals["speed"], dtype=float),
        s.valid_mask([]),
        ShuffleConfig(n_shuffles=200, seed=0),
        s.fs,
    )
    print(f"shuffle_test signal_correlation: {time.perf_counter() - t0:.2f}s")
    place, untuned = gt["place_cells"], gt["untuned_cells"]
    pos_sig = res.significant & (res.observed > 0)
    assert pos_sig[place].mean() > 0.5
    assert res.significant[untuned].mean() < 0.12


def test_pipeline_end_to_end(sim_session):
    s = sim_session
    pipe = Pipeline(
        analyses=[
            AnalysisSpec(
                metric={"name": "signal_correlation", "max_lag_s": 0.5},
                signal="speed",
                shuffle=ShuffleConfig(n_shuffles=20, seed=1),
                masks=[],
            ),
            AnalysisSpec(metric={"name": "signal_tuning", "n_bins": 10}, signal="speed", masks=[]),
        ]
    )
    _, rs = pipe.run(s)
    r = rs.get("signal_correlation")
    assert r.target == "speed" and r.target_kind == "signal"
    assert r.values.shape == (40,) and r.shuffle is not None and "xcorr" in r.extras
    t = rs.get("signal_tuning")
    assert t.target_kind == "signal" and t.extras["tuning_curve"].shape == (40, 10)


def test_signal_metric_rejects_states_spec():
    with pytest.raises(ValidationError):
        AnalysisSpec(metric={"name": "signal_correlation"}, states="grid")
    with pytest.raises(ValidationError):
        AnalysisSpec(metric={"name": "signal_tuning"}, states="grid")
