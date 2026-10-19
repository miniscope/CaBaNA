import numpy as np
import pytest

from cabana import Session, build
from cabana._pipeline import Pipeline
from cabana._transform._behavior import (
    ArenaTransform,
    Distance,
    HeadDirection,
    InterpolateGaps,
    SmoothSignal,
    ZoneOccupancy,
    fit_homography,
    states_to_bouts,
)
from cabana import StateSpace

FS = 10.0
N = 600


def sess(**signals):
    rng = np.random.default_rng(0)
    return Session(activity=rng.random((3, N)), t=np.arange(N) / FS, fs=FS, signals=signals)


def test_interpolate_respects_max_gap():
    v = np.arange(N, dtype=float)
    v[10:13] = np.nan  # 3 frames = 0.3 s: filled
    v[50:58] = np.nan  # 8 frames = 0.8 s: stays
    v[0:2] = np.nan  # edge: never filled
    out = InterpolateGaps(signal="v", max_gap_s=0.5).apply(sess(v=v))
    r = out.signals["v"]
    np.testing.assert_allclose(r[10:13], [10, 11, 12])
    assert np.isnan(r[50:58]).all() and np.isnan(r[:2]).all()
    assert out.meta["interpolate_gaps"] == {"v": 3}
    # exactly at the limit is filled; method variants
    w = np.arange(N, dtype=float)
    w[20:25] = np.nan
    s = sess(w=w)
    assert np.isfinite(InterpolateGaps(signal="w", max_gap_s=0.5).apply(s).signals["w"]).all()
    ff = InterpolateGaps(signal="w", method="ffill", output="_f").apply(s)
    np.testing.assert_allclose(ff.signals["w_f"][20:25], 19.0)
    nn = InterpolateGaps(signal="w", method="nearest").apply(s).signals["w"]
    np.testing.assert_allclose(nn[20:25], [19, 19, 19, 25, 25])
    assert np.isnan(s.signals["w"][20])  # input untouched


def test_interpolate_expands_bodypart_prefix():
    x, y = np.arange(N, dtype=float), np.arange(N, dtype=float)
    x[5:7] = y[5:7] = np.nan
    out = InterpolateGaps(signal="nose").apply(sess(nose_x=x, nose_y=y))
    assert np.isfinite(out.signals["nose_x"]).all() and np.isfinite(out.signals["nose_y"]).all()
    with pytest.raises(KeyError):
        InterpolateGaps(signal="zzz").apply(sess(nose_x=x))


@pytest.mark.parametrize("method", ["median", "gaussian", "savgol"])
def test_smooth_reduces_jitter_and_keeps_nan(method):
    rng = np.random.default_rng(3)
    n = 4000
    s0 = Session(activity=np.ones((1, n)), t=np.arange(n) / 100.0, fs=100.0)
    noise = rng.normal(0, 1.0, n)
    v = noise.copy()
    v[1000:1010] = np.nan
    out = SmoothSignal(signal="v", method=method, window_s=0.21).apply(s0.with_signal("v", v))
    r = out.signals["v"]
    assert np.isnan(r[1000:1010]).all() and np.isfinite(np.delete(r, np.arange(1000, 1010))).all()
    good = np.r_[50:990, 1020:3950]
    if method == "gaussian":
        w = 21
        k = np.exp(-0.5 * (np.arange(-10, 11) / (w / 4)) ** 2)
        k /= k.sum()
        expected = np.sqrt((k**2).sum())
        assert r[good].std() == pytest.approx(noise.std() * expected, rel=0.1)
    elif method == "savgol":
        assert r[good].std() < 0.5 * noise.std()
    else:
        assert r[good].std() < 0.4 * noise.std()


def test_smooth_savgol_preserves_polynomial_and_median_preserves_step():
    t = np.arange(N) / FS
    s = sess(v=0.3 * t**2 - t)
    out = SmoothSignal(signal="v", method="savgol", window_s=0.7, polyorder=2).apply(s)
    np.testing.assert_allclose(out.signals["v"], s.signals["v"], atol=1e-8)
    step = (t > 30).astype(float)
    m = SmoothSignal(signal="v", method="median", window_s=0.5).apply(sess(v=step))
    np.testing.assert_allclose(m.signals["v"], step)


def test_head_direction_recovers_heading():
    rng = np.random.default_rng(1)
    theta = np.linspace(-3.0, 3.0, N)
    back = rng.uniform(0, 100, (N, 2))
    front = back + 5 * np.stack([np.cos(theta), np.sin(theta)], 1)
    back_x = back[:, 0].copy()
    back_x[7] = np.nan
    s = sess(nose_x=front[:, 0], nose_y=front[:, 1], neck_x=back_x, neck_y=back[:, 1])
    out = HeadDirection(front="nose", back="neck").apply(s)
    a = out.signals["head_direction"]
    assert np.isnan(a[7])
    np.testing.assert_allclose(np.delete(a, 7), np.delete(theta, 7), atol=1e-9)
    d = HeadDirection(front="nose", back="neck", units="deg").apply(s)
    np.testing.assert_allclose(d.signals["head_direction"][100], np.degrees(theta[100]))
    # +x -> 0, +y -> pi/2 (counter-clockwise), wrap and unwrap
    th2 = np.cumsum(np.full(N, 0.2))  # spins past pi
    f2 = np.stack([np.cos(th2), np.sin(th2)], 1)
    s2 = sess(a_x=f2[:, 0], a_y=f2[:, 1], b_x=np.zeros(N), b_y=np.zeros(N))
    w = HeadDirection(front="a", back="b").apply(s2).signals["head_direction"]
    assert w.max() <= np.pi and w.min() > -np.pi
    u = HeadDirection(front="a", back="b", unwrap=True).apply(s2).signals["head_direction"]
    np.testing.assert_allclose(u - u[0], th2 - th2[0], atol=1e-9)


def test_distance_signal_and_point():
    x, y = np.arange(N, dtype=float), np.zeros(N)
    px, py = np.arange(N, dtype=float), np.full(N, 3.0)
    s = sess(x=x, y=y, p_x=px, p_y=py)
    s = s.replace(meta={"signal_units": {"x": "mm"}})
    out = Distance(a="", b="p").apply(s)
    np.testing.assert_allclose(out.signals["distance"], 3.0)
    assert out.meta["signal_units"]["distance"] == "mm"
    out = Distance(a="", point=[3.0, 4.0], output="d").apply(s)
    np.testing.assert_allclose(out.signals["d"][:4], [5, np.hypot(2, 4), np.hypot(1, 4), 4])
    with pytest.raises(ValueError):
        Distance(a="", b="p", point=[0, 0])
    with pytest.raises(ValueError):
        Distance(a="")


def test_arena_transform_similarity_and_units():
    x, y = np.array([0.0, 10.0, 10.0]), np.array([0.0, 0.0, 10.0])
    t = np.arange(3) / FS
    s = Session(activity=np.ones((1, 3)), t=t, fs=FS, signals={"x": x, "y": y})
    out = ArenaTransform(signals=[""], scale=0.5, rotate_deg=90, translate=[1, 2]).apply(s)
    np.testing.assert_allclose(out.signals["x"], [1, 1, -4], atol=1e-12)
    np.testing.assert_allclose(out.signals["y"], [2, 7, 7], atol=1e-12)
    assert out.meta["signal_units"]["x"] == "mm"
    keep = ArenaTransform(signals=[""], scale=[2, 1], output_suffix="_mm").apply(s)
    np.testing.assert_allclose(keep.signals["x_mm"], 2 * x)
    np.testing.assert_allclose(keep.signals["x"], x)
    with pytest.raises(ValueError):
        ArenaTransform(signals=[""], scale=2, corners_px=[[0, 0]] * 4, corners_mm=[[0, 0]] * 4)


def test_arena_homography_maps_corners_exactly():
    px = np.array([[100, 80], [520, 95], [500, 410], [90, 400]], float)
    mm = np.array([[0, 0], [400, 0], [400, 300], [0, 300]], float)
    h = fit_homography(px, mm)
    got = np.c_[px, np.ones(4)] @ h.T
    np.testing.assert_allclose(got[:, :2] / got[:, 2:], mm, atol=1e-8)
    s = sess(cx_x=px[:, 0].repeat(N // 4), cx_y=px[:, 1].repeat(N // 4))
    out = ArenaTransform(signals=["cx"], corners_px=px.tolist(), corners_mm=mm.tolist()).apply(s)
    np.testing.assert_allclose(out.signals["cx_x"][:: N // 4], mm[:, 0], atol=1e-7)
    np.testing.assert_allclose(out.signals["cx_y"][:: N // 4], mm[:, 1], atol=1e-7)
    assert out.meta["signal_units"]["cx_x"] == "mm"
    # overdetermined: 6 consistent points still exact
    pts = np.vstack([px, px.mean(0)[None], (px[0] + px[1])[None] / 2])
    d = np.c_[pts, np.ones(len(pts))] @ h.T
    h6 = fit_homography(pts, d[:, :2] / d[:, 2:])
    np.testing.assert_allclose(h6, h, atol=1e-8)


def zone_session():
    x = np.full(N, 50.0)
    y = np.full(N, 50.0)
    x[:200], x[200:400], x[400:] = 10.0, 50.0, 90.0  # left, middle, right
    x[100], y[100] = np.nan, np.nan
    x[300], y[300] = 500.0, 500.0  # outside every zone
    return sess(x=x, y=y)


ZONES = {"left": [[0, 0], [30, 0], [30, 100], [0, 100]]}
RECTS = {"middle": [30, 0, 70, 100], "right": [70, 0, 100, 100]}


def test_zone_occupancy_assignment_and_support():
    out = ZoneOccupancy(signal="", zones=ZONES, zones_rect=RECTS, output="zn").apply(zone_session())
    sp = out.states["zn"]
    assert sp.state_names == ["left", "middle", "right"]
    assert sp.kind == "categorical" and sp.exclusive
    lab = sp.labels()
    assert (lab[:100] == 0).all() and (lab[101:200] == 0).all()
    assert (lab[200:300] == 1).all() and (lab[301:400] == 1).all()
    assert (lab[400:] == 2).all()
    assert lab[100] == -1 and lab[300] == -1  # NaN and outside
    assert not sp.support[100] and sp.support[300]  # outside is defined, NaN is unknown
    np.testing.assert_array_equal(out.masks["zn_valid"], sp.support)


def test_zone_occupancy_overlap_and_validation():
    overlap = {"a": [0, 0, 60, 100], "b": [40, 0, 100, 100]}
    excl = ZoneOccupancy(signal="", zones_rect=overlap).apply(zone_session()).states["zones"]
    both = ZoneOccupancy(signal="", zones_rect=overlap, exclusive=False).apply(zone_session())
    assert excl.onehot.sum(axis=1).max() == 1 and not both.states["zones"].exclusive
    mid = 250  # x=50 lies in both
    assert both.states["zones"].onehot[mid].all() and excl.onehot[mid].tolist() == [True, False]
    with pytest.raises(ValueError):
        ZoneOccupancy(signal="")
    with pytest.raises(ValueError):
        ZoneOccupancy(signal="", zones_rect={"a": [0, 0, 1, 1]}, zones={"a": ZONES["left"]})
    with pytest.raises(KeyError):
        ZoneOccupancy(signal="nope", zones_rect=overlap).apply(zone_session())


def test_zone_states_feed_pipeline():
    s = ZoneOccupancy(signal="", zones=ZONES, zones_rect=RECTS, output="zn").apply(zone_session())
    pipe = Pipeline(
        analyses=[
            {
                "metric": {"name": "mean_per_state"},
                "states": "zn",
                "shuffle": {"n_shuffles": 20, "min_shift_s": 2.0},
            }
        ]
    )
    _, rs = pipe.run(s)
    assert len(list(rs)) == 1


def test_registered_and_serialisable():
    for spec, cls in [
        ({"name": "interpolate_gaps", "signal": "x"}, InterpolateGaps),
        ({"name": "smooth_signal", "signal": "x"}, SmoothSignal),
        ({"name": "head_direction", "front": "a", "back": "b"}, HeadDirection),
        ({"name": "distance", "a": "a", "point": [0, 0]}, Distance),
        ({"name": "arena_transform", "signals": ["a"], "scale": 0.5}, ArenaTransform),
        (
            {"name": "zone_occupancy", "signal": "a", "zones_rect": {"z": [0, 0, 1, 1]}},
            ZoneOccupancy,
        ),
    ]:
        t = build("transform", spec)
        assert isinstance(t, cls) and build("transform", t.to_dict()) == t


def _quat_z(theta):
    return np.stack([np.cos(theta / 2), 0 * theta, 0 * theta, np.sin(theta / 2)], axis=1)


def test_head_direction_quaternion_yaw_and_offset():
    th = np.linspace(-3.0, 3.0, N)
    q = _quat_z(th)
    q[5] = np.nan
    s = Session(activity=np.ones((1, N)), t=np.arange(N) / FS, fs=FS, signals={"imu": q})
    a = HeadDirection(quaternion="imu").apply(s).signals["head_direction"]
    assert np.isnan(a[5])
    np.testing.assert_allclose(np.delete(a, 5), np.delete(th, 5), atol=1e-9)
    # four named channels, unnormalised, plus an offset that wraps
    s2 = sess(**{f"imu_{c}": 2 * q[:, i] for i, c in enumerate("wxyz")})
    b = HeadDirection(quaternion="imu", offset_deg=90, units="deg").apply(s2)
    want = np.degrees(th) + 90
    want = np.where(want > 180, want - 360, want)
    np.testing.assert_allclose(
        np.delete(b.signals["head_direction"], 5), np.delete(want, 5), atol=1e-6
    )
    # pure z rotation of +90 deg is +y
    assert HeadDirection(quaternion="imu").apply(
        Session(
            activity=np.ones((1, 1)),
            t=np.zeros(1),
            fs=FS,
            signals={"imu": _quat_z(np.array([np.pi / 2]))},
        )
    ).signals["head_direction"][0] == pytest.approx(np.pi / 2)
    with pytest.raises(ValueError):
        HeadDirection(quaternion="imu", front="a", back="b")
    with pytest.raises(ValueError):
        HeadDirection()
    # offset also applies to the two-point mode
    s3 = sess(a_x=np.ones(N), a_y=np.zeros(N), b_x=np.zeros(N), b_y=np.zeros(N))
    r = HeadDirection(front="a", back="b", offset_deg=180).apply(s3).signals["head_direction"]
    np.testing.assert_allclose(np.abs(r), np.pi)


def test_states_to_bouts_roundtrip_and_cleanup():
    n = 100
    oh = np.zeros((n, 2), bool)
    oh[0:10, 0] = True  # touches the start
    oh[12:15, 0] = True  # gap of 2 frames (0.2 s)
    oh[20:22, 0] = True  # 0.2 s run, short
    oh[90:, 1] = True  # touches the end
    sp = StateSpace(
        name="s",
        onehot=oh,
        state_names=["a", "b"],
        kind="bouts",
        exclusive=False,
        support=np.arange(n) < 95,
    )
    raw = states_to_bouts(sp, FS)
    assert raw.labels == ["a", "a", "a", "b"]
    np.testing.assert_allclose(raw.start_s, [0, 1.2, 2.0, 9.0])
    np.testing.assert_allclose(raw.stop_s, [1.0, 1.5, 2.2, 10.0])
    assert raw.scored_start_s == 0.0 and raw.scored_stop_s == pytest.approx(9.5)
    m = states_to_bouts(sp, FS, merge_gap_s=0.3)
    np.testing.assert_allclose(m.start_s[:2], [0, 2.0])
    np.testing.assert_allclose(m.stop_s[:2], [1.5, 2.2])
    # min_duration applies after merging: the merged 1.5 s bout survives, the 0.2 s one does not
    d = states_to_bouts(sp, FS, merge_gap_s=0.3, min_duration_s=0.5)
    assert d.labels == ["a", "b"]
    # roundtrip through bouts_to_states
    from cabana._transform._core import BoutsToStates

    s = Session(activity=np.ones((1, n)), t=np.arange(n) / FS, fs=FS, behavior={"b": raw})
    back = BoutsToStates(source="b", behaviors=["a", "b"]).apply(s).states["social"]
    np.testing.assert_array_equal(back.onehot, oh)


def test_zones_from_meta():
    s = zone_session().replace(
        meta={
            "arena": {
                "size": [100, 100],
                "units": "cm",
                "zones": {**{"left": ZONES["left"]}, "right": [70, 0, 100, 100]},
            }
        }
    )
    out = ZoneOccupancy(signal="", zones_from_meta=True, output="z").apply(s).states["z"]
    assert out.state_names == ["left", "right"]
    lab = out.labels()
    assert (lab[:100] == 0).all() and (lab[400:] == 1).all() and (lab[200:300] == -1).all()
    with pytest.raises(KeyError):
        ZoneOccupancy(signal="", zones_from_meta=True).apply(zone_session())
