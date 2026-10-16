import numpy as np
import pytest

from cabana import Session, build
from cabana._preprocess import (
    BinarizeActivity,
    SmoothActivity,
    SpeedThreshold,
    TimeRange,
    ZscoreActivity,
)

FS = 10.0
N = 200


def session(activity=None):
    a = np.ones((2, N)) if activity is None else activity
    return Session(activity=a, t=np.arange(a.shape[1]) / FS, fs=FS)


def test_speed_threshold():
    sp = np.linspace(0, 19.9, N)
    sp[10] = np.nan
    s = session().with_signal("speed", sp)
    out = SpeedThreshold(min_speed=5.0, max_speed=15.0).apply(s)
    np.testing.assert_array_equal(out.masks["speed"], (sp >= 5) & (sp <= 15) & np.isfinite(sp))
    assert not out.masks["speed"][10]
    assert s.masks == {}
    out2 = SpeedThreshold(min_speed=5.0, output="fast").apply(s)
    assert "fast" in out2.masks and out2.masks["fast"][-1]
    with pytest.raises(KeyError):
        SpeedThreshold(signal="nope", min_speed=1).apply(s)


def test_time_range():
    s = session()
    out = TimeRange(start_s=5.0, stop_s=10.0).apply(s)
    m = out.masks["time_range"]
    assert m.sum() == 51 and m[50] and m[100] and not m[49] and not m[101]
    assert TimeRange(start_s=5.0).apply(s).masks["time_range"].sum() == N - 50
    with pytest.raises(ValueError):
        TimeRange(start_s=5.0, stop_s=1.0)


def test_smooth_activity_impulse_and_constant():
    a = np.zeros((2, N))
    a[0, 100] = 1.0
    a[1] = 3.0
    s = session(a)
    out = SmoothActivity(sigma_s=0.5).apply(s)  # sigma = 5 frames
    assert out.activity[0].sum() == pytest.approx(1.0, abs=1e-6)
    assert out.activity[0].argmax() == 100
    assert out.activity[0, 100] == pytest.approx(1 / (5 * np.sqrt(2 * np.pi)), rel=1e-3)
    np.testing.assert_allclose(out.activity[1], 3.0)  # edges preserved
    assert s.activity[0, 100] == 1.0 and s.activity[0, 99] == 0.0
    assert out.activity_kind == s.activity_kind


def test_zscore_within_valid_mask():
    rng = np.random.default_rng(0)
    a = rng.random((3, N)) * 5
    a[2] = 7.0
    s = session(a).with_mask("m", np.arange(N) < 100)
    out = ZscoreActivity().apply(s).activity
    np.testing.assert_allclose(out[:2, :100].mean(axis=1), 0, atol=1e-12)
    np.testing.assert_allclose(out[:2, :100].std(axis=1), 1, atol=1e-12)
    np.testing.assert_allclose(out[2], 0)  # constant cell
    assert np.all(np.isfinite(out))


def test_binarize():
    a = np.array([[0.0, 0.5, 1.0, -1.0]])
    s = session(a)
    out = BinarizeActivity().apply(s)
    np.testing.assert_array_equal(out.activity, [[0, 1, 1, 0]])
    assert out.activity.dtype == float
    out2 = BinarizeActivity(threshold=0.5).apply(s)
    np.testing.assert_array_equal(out2.activity, [[0, 0, 1, 0]])


def test_registry_roundtrip():
    for spec in [
        {"name": "speed_threshold", "min_speed": 2.0},
        {"name": "time_range", "start_s": 1.0},
        {"name": "smooth_activity", "sigma_s": 0.2},
        {"name": "zscore_activity"},
        {"name": "binarize_activity"},
    ]:
        p = build("preprocess", spec)
        assert build("preprocess", p.to_dict()) == p
