"""Per-cell metadata, footprints, SessionInfo, select_cells / select_frames (Phase C1, C8)."""

from __future__ import annotations

import warnings

import numpy as np
import pytest

from cabana import Session, SessionInfo, SessionSet, StateSpace


def make(n_cells=5, n_time=40, **kw) -> Session:
    rng = np.random.default_rng(0)
    oh = np.zeros((n_time, 3), bool)
    oh[np.arange(n_time), np.arange(n_time) % 3] = True
    st = StateSpace(
        name="lab",
        onehot=oh,
        state_names=["a", "b", "c"],
        kind="categorical",
        exclusive=True,
        support=np.arange(n_time) % 7 != 0,
    )
    return Session(
        activity=rng.random((n_cells, n_time)),
        t=np.arange(n_time) / 10.0,
        fs=10.0,
        cell_ids=[f"c{i}" for i in range(n_cells)],
        signals={"x": np.arange(n_time, dtype=float)},
        states={"lab": st},
        masks={"m": np.arange(n_time) % 2 == 0},
        **kw,
    )


def rich(**kw) -> Session:
    fp = np.zeros((5, 6, 8))
    for i in range(5):
        fp[i, i % 6, (2 * i) % 8] = 1.0
    return make(
        cell_meta={
            "snr": np.arange(5) * 1.5,
            "accepted": np.array([1, 0, 1, 1, 0], bool),
            "label": np.array(["pyr", "int", "pyr", "?", "int"]),
            "n_events": np.arange(5),
        },
        footprints=fp,
        info=SessionInfo(animal="mA", date="2026-03-14", group="g1", extra={"k": [1, 2]}),
        **kw,
    )


def test_cell_meta_validation():
    with pytest.raises(ValueError, match="expected"):
        make(cell_meta={"snr": np.ones(4)})
    with pytest.raises(ValueError, match="expected"):
        make(cell_meta={"snr": np.ones((5, 1))})
    with pytest.raises(ValueError, match="dtype"):
        make(cell_meta={"bad": np.array([None] * 5, dtype=object)})
    s = make(cell_meta={"snr": [1, 2, 3, 4, 5]})  # lists are coerced
    assert isinstance(s.cell_meta["snr"], np.ndarray)


def test_footprints_validation_and_centroids():
    with pytest.raises(ValueError, match="footprints"):
        make(footprints=np.zeros((4, 3, 3)))
    with pytest.raises(ValueError, match="footprints"):
        make(footprints=np.zeros((5, 3)))
    s = rich()
    c = s.footprint_centroids()
    assert c.shape == (5, 2)
    np.testing.assert_allclose(c[1], [2, 1])  # (x, y) = (col, row)
    s2 = make(cell_meta={"centroid_x": np.arange(5.0), "centroid_y": np.arange(5.0) * 2})
    np.testing.assert_allclose(s2.footprint_centroids()[:, 1], np.arange(5.0) * 2)
    assert make().footprint_centroids() is None


def test_cell_table():
    df = rich().cell_table()
    assert list(df.index) == [f"c{i}" for i in range(5)]
    assert list(df.columns) == ["snr", "accepted", "label", "n_events"]
    assert df.loc["c1", "label"] == "int"


def test_info_date_validated():
    with pytest.raises(ValueError, match="ISO"):
        SessionInfo(date="14/03/2026")
    assert Session.model_fields["info"].default_factory is not None
    assert make().info == SessionInfo()


@pytest.mark.parametrize("kind", ["int", "bool", "ids"])
def test_select_cells(kind):
    s = rich()
    idx = {
        "int": np.array([3, 0]),
        "bool": np.array([True, False, False, True, False]),
        "ids": ["c3", "c0"],
    }[kind]
    r = s.select_cells(idx)
    order = [3, 0] if kind != "bool" else [0, 3]
    assert r.cell_ids == [f"c{i}" for i in order]
    np.testing.assert_array_equal(r.activity, s.activity[order])
    np.testing.assert_array_equal(r.cell_meta["snr"], s.cell_meta["snr"][order])
    assert list(r.cell_meta["label"]) == list(s.cell_meta["label"][order])
    np.testing.assert_array_equal(r.footprints, s.footprints[order])
    assert r.meta["cell_selection"] == {"n_before": 5, "n_after": 2, "source": None}
    assert r.info == s.info


def test_select_cells_errors():
    s = rich()
    with pytest.raises(ValueError, match="unknown"):
        s.select_cells(["nope"])
    with pytest.raises(ValueError, match="duplicate"):
        s.select_cells([1, 1])
    with pytest.raises(ValueError, match="shape"):
        s.select_cells(np.ones(4, bool))
    with pytest.raises(IndexError):
        s.select_cells([9])


def test_select_frames_consistent():
    s = make()
    r = s.select_frames(slice(10, 30))
    assert r.n_time == 20 and r.fs == s.fs
    np.testing.assert_array_equal(r.activity, s.activity[:, 10:30])
    np.testing.assert_array_equal(r.t, s.t[10:30])
    np.testing.assert_array_equal(r.signals["x"], s.signals["x"][10:30])
    np.testing.assert_array_equal(r.states["lab"].onehot, s.states["lab"].onehot[10:30])
    np.testing.assert_array_equal(r.states["lab"].support, s.states["lab"].support[10:30])
    np.testing.assert_array_equal(r.masks["m"], s.masks["m"][10:30])
    assert r.meta["frame_selection"] == {"n_before": 40, "n_after": 20, "contiguous": True}


def test_select_frames_bool_and_warning():
    s = make()
    keep = np.arange(40) % 2 == 0
    with pytest.warns(UserWarning, match="not contiguous"):
        r = s.select_frames(keep)
    assert r.n_time == 20 and r.meta["frame_selection"]["contiguous"] is False
    np.testing.assert_array_equal(r.t, s.t[keep])
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        s.select_frames(np.arange(5, 15))  # contiguous int array: silent
    with pytest.raises(ValueError, match="increasing"):
        s.select_frames(np.array([5, 3, 9]))
    with pytest.raises(ValueError, match="increasing"):
        s.select_frames(slice(None, None, -1))


def test_with_activity_drops_with_warning_and_carries():
    s = rich()
    with pytest.warns(UserWarning, match="dropping cell_meta"):
        r = s.with_activity(s.activity[:3])
    assert r.cell_meta == {} and r.footprints is None and r.cell_ids == ["0", "1", "2"]
    same = s.with_activity(s.activity * 2)
    assert set(same.cell_meta) == set(s.cell_meta) and same.footprints is not None
    with warnings.catch_warnings():  # nothing to drop: no warning
        warnings.simplefilter("error")
        make().with_activity(make().activity[:3])


def test_rebin_carries():
    s = rich()
    r = s.rebin(0.2)
    assert r.info == s.info and r.footprints is s.footprints
    np.testing.assert_array_equal(r.cell_meta["snr"], s.cell_meta["snr"])


def test_replace_new_fields():
    s = rich()
    r = s.replace(info=SessionInfo(animal="zz"))
    assert r.info.animal == "zz" and r.cell_meta.keys() == s.cell_meta.keys()


@pytest.mark.parametrize("zipped", [False, True])
def test_save_load_roundtrip(tmp_path, zipped):
    s = rich()
    p = tmp_path / ("s.zip" if zipped else "s")
    s.save(p)
    r = Session.load(p)
    assert list(r.cell_meta) == list(s.cell_meta)
    for k in s.cell_meta:
        np.testing.assert_array_equal(r.cell_meta[k], s.cell_meta[k])
        assert r.cell_meta[k].dtype.kind == s.cell_meta[k].dtype.kind
    assert r.footprints.dtype == np.float32
    np.testing.assert_allclose(r.footprints, s.footprints)
    assert r.info == s.info


def test_old_file_without_new_keys_loads(tmp_path):
    import json

    s = make()
    s.save(tmp_path / "s")
    man = json.loads((tmp_path / "s" / "manifest.json").read_text())
    for k in ("info", "cell_meta", "has_footprints"):
        man.pop(k)
    (tmp_path / "s" / "manifest.json").write_text(json.dumps(man))
    r = Session.load(tmp_path / "s")
    assert r.cell_meta == {} and r.footprints is None and r.info == SessionInfo()


def test_session_set_from_sessions_and_table():
    a = make(info=SessionInfo(animal="A", session_id="a1", condition="x", date="2026-01-02"))
    b = make(n_cells=3, info=SessionInfo(animal="B", session_id="b1", group="g"))
    ss = SessionSet.from_sessions([a, b])
    assert ss.animal == {"a1": "A", "b1": "B"}
    t = ss.table()
    assert list(t["session_id"]) == ["a1", "b1"]
    assert list(t["n_cells"]) == [5, 3] and t["group"].isna().tolist() == [True, False]
    assert set(t.columns) == {
        "session_id",
        "animal",
        "date",
        "condition",
        "group",
        "n_cells",
        "duration_s",
        "fs",
    }
    ov = SessionSet.from_sessions({"s": a}, animal={"s": "Z"})
    assert ov.animal == {"s": "Z"}
    with pytest.raises(ValueError, match="no animal"):
        SessionSet.from_sessions({"s": make()})
    with pytest.raises(ValueError, match="session_id"):
        SessionSet.from_sessions([make(info=SessionInfo(animal="A"))])
