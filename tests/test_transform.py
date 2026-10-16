import numpy as np
import pytest

from cabana import BoutTable, ContinuousSignal, LabelSeries, Session, build
from cabana._transform import BinGrid, BoutsToStates, LabelsToStates, ResampleSignal, Speed

FS = 10.0
N = 200


def make_session(**kw):
    t = np.arange(N) / FS
    return Session(activity=np.ones((2, N)), t=t, fs=FS, **kw)


def line_session():
    """x = 10*t (units/s = 10), y = 5 on a behavior clock at 30 Hz, wider than session."""
    tb = np.arange(-1, 22, 1 / 30)
    sig = ContinuousSignal(
        t=tb, values=np.stack([10 * tb, np.full_like(tb, 5.0)], 1), channel_names=["x", "y"]
    )
    return make_session(behavior={"position": sig})


def test_resample_signal_values_and_coverage():
    s = line_session()
    out = ResampleSignal(source="position").apply(s)
    np.testing.assert_allclose(out.signals["x"], 10 * s.t, atol=1e-9)
    np.testing.assert_allclose(out.signals["y"], 5.0)
    assert out.masks["position_covered"].all()
    assert "x" not in s.signals  # input untouched


def test_resample_nan_outside_and_missing():
    tb = np.arange(5.0, 15.0, 0.1)
    vals = np.stack([tb, tb], 1)
    vals[30:40, 0] = np.nan
    sig = ContinuousSignal(t=tb, values=vals, channel_names=["x", "y"])
    s = make_session(behavior={"p": sig})
    out = ResampleSignal(source="p", channels=["x"]).apply(s)
    assert "y" not in out.signals
    cov = out.masks["p_covered"]
    assert cov.sum() == np.sum((s.t >= 5.0) & (s.t <= tb[-1]))
    assert np.isnan(out.signals["x"][~cov]).all()
    # NaN gap covers tb[30:40] = 8.0..8.9
    gap = (s.t > 8.05) & (s.t < 8.85)
    assert np.isnan(out.signals["x"][gap]).all()
    assert np.isfinite(out.signals["x"][cov & ~((s.t > 7.95) & (s.t < 8.95))]).all()


def test_resample_errors():
    s = line_session()
    with pytest.raises(KeyError):
        ResampleSignal(source="nope").apply(s)
    with pytest.raises(KeyError):
        ResampleSignal(source="position", channels=["z"]).apply(s)


def test_speed_constant_velocity():
    s = ResampleSignal(source="position").apply(line_session())
    out = Speed(window_s=0.3).apply(s)
    np.testing.assert_allclose(out.signals["speed"], 10.0, atol=1e-6)
    assert out.signals["speed"].shape == (N,)


def test_speed_2d_and_nan():
    t = np.arange(N) / FS
    x = 3 * t
    y = 4 * t
    x[50] = np.nan
    s = make_session().with_signal("x", x).with_signal("y", y)
    out = Speed(window_s=0.1).apply(s)  # w = 1 frame
    spd = out.signals["speed"]
    np.testing.assert_allclose(spd[[10, 100, 0, N - 1]], 5.0)
    assert np.isnan(spd[[49, 50]]).all()  # windows [i, i+1] touching frame 50
    assert np.isfinite(spd[[48, 51, 52]]).all()


def test_bin_grid_2d_exact():
    t = np.arange(N) / FS
    x = np.full(N, 5.0)
    y = np.full(N, 5.0)
    x[0], y[0] = 0.0, 0.0
    x[1], y[1] = 10.0, 10.0  # the max
    x[2], y[2] = 25.0, 5.0
    x[3] = np.nan
    s = make_session().with_signal("x", x).with_signal("y", y)
    out = BinGrid(n_bins=[2, 3], extent=[(0, 10), (0, 12)]).apply(s)
    sp = out.states["position"]
    assert sp.kind == "grid" and sp.exclusive
    assert sp.topology.shape == (2, 3)
    np.testing.assert_allclose(sp.topology.edges[0], [0, 5, 10])
    np.testing.assert_allclose(sp.topology.edges[1], [0, 4, 8, 12])
    assert sp.topology.axis_names == ["x", "y"]
    assert sp.state_names[0] == "x00_y00" and sp.state_names[5] == "x01_y02"
    lab = sp.labels()
    assert lab[0] == np.ravel_multi_index((0, 0), (2, 3))
    assert lab[1] == np.ravel_multi_index((1, 2), (2, 3))
    assert lab[2] == -1 and lab[3] == -1  # outside extent, NaN
    assert lab[4] == np.ravel_multi_index((1, 1), (2, 3))  # x=5 -> bin 1, y=5 -> bin 1
    assert t.shape == lab.shape


def test_bin_grid_default_extent_and_bin_size():
    x = np.linspace(0, 10, N)
    y = np.linspace(0, 4, N)
    s = make_session().with_signal("x", x).with_signal("y", y)
    out = BinGrid(bin_size=2.0).apply(s)
    sp = out.states["position"]
    assert sp.topology.shape == (5, 2)
    assert sp.onehot.any(axis=1).all()  # max falls in last bin
    assert sp.labels()[-1] == sp.n_states - 1
    assert sp.state_names[-1] == "x04_y01"


def test_bin_grid_validation():
    with pytest.raises(ValueError):
        BinGrid()
    with pytest.raises(ValueError):
        BinGrid(bin_size=1.0, n_bins=3)
    with pytest.raises(ValueError):
        BinGrid(n_bins=[2], signals=["x", "y"])


def test_bin_grid_1d():
    x = np.linspace(0, 1, N)
    s = make_session().with_signal("x", x)
    out = BinGrid(signals=["x"], n_bins=4, output="track").apply(s)
    sp = out.states["track"]
    assert sp.topology.shape == (4,)
    assert sp.state_names == ["x00", "x01", "x02", "x03"]
    assert sp.occupancy().sum() == N


def bouts_session():
    tb = BoutTable(
        labels=["a", "b", "a", "b"],
        start_s=np.array([1.0, 2.0, 5.0, 6.0]),
        stop_s=np.array([3.0, 4.0, 5.5, 6.0]),  # last is zero-length
        scored_start_s=0.5,
        scored_stop_s=10.0,
    )
    return make_session(behavior={"bouts": tb})


def test_bouts_non_exclusive_rest():
    s = bouts_session()
    out = BoutsToStates(source="bouts", add_rest=True).apply(s)
    sp = out.states["social"]
    assert sp.kind == "bouts" and not sp.exclusive
    assert sp.state_names == ["a", "b", "rest"]
    t = s.t
    a = (t >= 1) & (t < 3) | (t >= 5) & (t < 5.5)
    b = (t >= 2) & (t < 4)
    np.testing.assert_array_equal(sp.onehot[:, 0], a)
    np.testing.assert_array_equal(sp.onehot[:, 1], b)
    scored = (t >= 0.5) & (t < 10.0)  # half-open, like bout intervals
    np.testing.assert_array_equal(out.masks["social_scored"], scored)
    np.testing.assert_array_equal(sp.onehot[:, 2], scored & ~a & ~b)
    assert (sp.onehot[:, 0] & sp.onehot[:, 1]).any()


def test_bouts_exclusive_priority():
    s = bouts_session()
    out = BoutsToStates(source="bouts", behaviors=["b", "a"], exclusive=True).apply(s)
    sp = out.states["social"]
    assert sp.state_names == ["b", "a"] and sp.exclusive
    t = s.t
    ov = (t >= 2) & (t < 3)
    assert sp.onehot[ov, 0].all() and not sp.onehot[ov, 1].any()
    assert sp.onehot[(t >= 1) & (t < 2), 1].all()
    out2 = BoutsToStates(source="bouts", behaviors=["a", "b"], exclusive=True).apply(s)
    assert out2.states["social"].onehot[ov, 0].all()


def test_bouts_unknown_behavior_and_full_scored():
    s = bouts_session()
    with pytest.raises(KeyError):
        BoutsToStates(source="bouts", behaviors=["zzz"]).apply(s)
    tb = BoutTable(labels=["a"], start_s=np.array([1.0]), stop_s=np.array([2.0]))
    s2 = make_session(behavior={"bouts": tb})
    out = BoutsToStates(source="bouts", output="o").apply(s2)
    assert out.masks["o_scored"].all()


def test_labels_to_states():
    ls = LabelSeries(
        t=np.array([2.0, 4.0, 6.0, 8.0]),
        labels=np.array([0, 1, -1, 2]),
        label_names=["p", "q", "r"],
    )
    s = make_session(behavior={"syl": ls})
    out = LabelsToStates(source="syl").apply(s)
    sp = out.states["syllables"]
    assert sp.kind == "categorical" and sp.exclusive and sp.state_names == ["p", "q", "r"]
    t = s.t
    lab = sp.labels()
    assert (lab[t < 2.0] == -1).all()
    assert (lab[(t >= 2.0) & (t < 4.0)] == 0).all()
    assert (lab[(t >= 4.0) & (t < 6.0)] == 1).all()
    assert (lab[(t >= 6.0) & (t < 8.0)] == -1).all()
    assert lab[np.isclose(t, 8.0)][0] == 2
    assert (lab[t > 8.0] == -1).all()
    cov = out.masks["syllables_covered"]
    np.testing.assert_array_equal(cov, (t >= 2.0) & (t <= 8.0))


def test_registered_and_serialisable():
    t = build("transform", {"name": "bin_grid", "n_bins": 3})
    assert isinstance(t, BinGrid)
    assert build("transform", t.to_dict()) == t
    assert isinstance(build("transform", {"name": "speed"}), Speed)
    assert isinstance(build("transform", {"name": "labels_to_states", "source": "s"}), LabelsToStates)
    assert isinstance(build("transform", {"name": "bouts_to_states", "source": "s"}), BoutsToStates)
