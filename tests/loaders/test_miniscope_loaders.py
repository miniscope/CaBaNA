"""Miniscope timestamps, timing report, head orientation, position and epoch CSVs."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from cabana import loaders


def _ts(path, ms, frames=None, buffer=True):
    df = pd.DataFrame(
        {"Frame Number": np.arange(len(ms)) if frames is None else frames, "Time Stamp (ms)": ms}
    )
    if buffer:
        df["Buffer Index"] = 0
    df.to_csv(path, index=False)
    return path


def test_timestamps_basic_and_negative_first(tmp_path):
    p = _ts(tmp_path / "timeStamps.csv", [-22, 11, 45, 78])
    t = loaders.load_miniscope_timestamps(p)
    assert t.dtype == np.float64
    np.testing.assert_allclose(t, [-0.022, 0.011, 0.045, 0.078])
    _ts(tmp_path / "nb.csv", [0, 33, 66], buffer=False)
    assert loaders.load_miniscope_timestamps(tmp_path / "nb.csv").size == 3


def test_timestamps_errors(tmp_path):
    with pytest.raises(FileNotFoundError):
        loaders.load_miniscope_timestamps(tmp_path / "nope.csv")
    pd.DataFrame({"a": [1]}).to_csv(tmp_path / "bad.csv", index=False)
    with pytest.raises(KeyError, match="Frame Number"):
        loaders.load_miniscope_timestamps(tmp_path / "bad.csv")
    p = _ts(tmp_path / "dup.csv", [0, 33, 66, 99], frames=[0, 1, 1, 3])
    with pytest.raises(ValueError, match=r"frame 1 \(row 2\) follows frame 1"):
        loaders.load_miniscope_timestamps(p)
    p = _ts(tmp_path / "back.csv", [0, 33, 30, 99])
    with pytest.warns(UserWarning, match="backwards, first at frame 2"):
        t = loaders.load_miniscope_timestamps(p)
    assert t.size == 4


def test_timing_report_regular_and_gaps():
    t = np.arange(300) / 30.0
    rep = loaders.timing_report(t, 30.0)
    assert rep["n_frames"] == 300 and rep["n_dropped_frames"] == 0
    assert rep["fs_median"] == pytest.approx(30.0) and rep["fs_ratio"] == pytest.approx(1.0)
    assert rep["gap_index"] == [] and rep["jitter_sd_s"] < 1e-12 and rep["first_t"] == 0.0
    keep = np.ones(300, bool)
    keep[[50, 51, 52, 200]] = False  # a 3-frame gap and a 1-frame gap
    rep = loaders.timing_report(t[keep])
    assert rep["n_dropped_frames"] == 4 and rep["gap_index"] == [49, 196]
    assert rep["gap_n_frames"] == [3, 1] and rep["fs_nominal"] is None
    assert rep["dropped_fraction"] == pytest.approx(4 / 300)
    assert rep["gap_start_s"][0] == pytest.approx(49 / 30)
    assert rep["fs_mean"] < rep["fs_median"]
    with pytest.raises(ValueError):
        loaders.timing_report([1.0])


def test_timing_report_on_session(sim_session):
    rep = loaders.timing_report(sim_session.t, sim_session.fs)
    assert rep["n_dropped_frames"] == 0 and rep["fs_median"] == pytest.approx(sim_session.fs)


def test_head_orientation(tmp_path):
    q = np.array([[1, 0, 0, 0], [0.7071068, 0, 0, 0.7071068]])
    df = pd.DataFrame(q, columns=["qw", "qx", "qy", "qz"])
    df.insert(0, "Time Stamp (ms)", [-22, 11])
    df.to_csv(tmp_path / "h.csv", index=False)
    t, quat = loaders.load_head_orientation(tmp_path / "h.csv")
    np.testing.assert_allclose(t, [-0.022, 0.011])
    np.testing.assert_allclose(quat, q)
    with pytest.warns(UserWarning, match="differ"):  # 22 ms off the file's own stamps
        t2, _ = loaders.load_head_orientation(tmp_path / "h.csv", timestamps=np.array([0.0, 0.033]))
    np.testing.assert_allclose(t2, [0.0, 0.033])
    with pytest.raises(ValueError, match="rows"):
        loaders.load_head_orientation(tmp_path / "h.csv", timestamps=np.zeros(3))
    df.drop(columns="Time Stamp (ms)").to_csv(tmp_path / "nt.csv", index=False)
    with pytest.raises(ValueError, match="timestamps"):
        loaders.load_head_orientation(tmp_path / "nt.csv")


def test_head_orientation_timestamp_mismatch_warns(tmp_path):
    df = pd.DataFrame({"Time Stamp (ms)": [0, 33], "qw": [1, 1], "qx": [0, 0], "qy": [0, 0],
                       "qz": [0, 0]})  # fmt: skip
    df.to_csv(tmp_path / "h.csv", index=False)
    with pytest.warns(UserWarning, match="differ"):
        loaders.load_head_orientation(tmp_path / "h.csv", timestamps=np.array([0.0, 0.1]))


def test_position_join_by_frame(tmp_path):
    ts = _ts(tmp_path / "b.csv", [0, 20, 40, 60, 80])
    pd.DataFrame(
        {"frame": [0, 1, 2, 4, 9], "x": [1.0, -1, 3, 4, 5], "y": [2.0, -1, 3, 4, 5]}
    ).to_csv(tmp_path / "p.csv", index=False)
    with pytest.warns(UserWarning, match="frame 9"):
        t, xy = loaders.load_position_csv(tmp_path / "p.csv", timestamps=ts)
    np.testing.assert_allclose(t, [0, 0.02, 0.04, 0.08])  # frame 3 skipped, frame 9 dropped
    assert np.isnan(xy[1]).all() and not np.isnan(xy[[0, 2, 3]]).any()
    # array timestamps: index is the frame number; missing_value=None keeps -1
    t, xy = loaders.load_position_csv(
        tmp_path / "p.csv", timestamps=np.arange(10) * 0.02, missing_value=None
    )
    assert xy[1, 0] == -1 and t.size == 5
    with pytest.raises(KeyError, match="missing columns"):
        loaders.load_position_csv(tmp_path / "p.csv", timestamps=ts, columns=("x", "z"))


def test_epochs_csv(tmp_path):
    pd.DataFrame(
        {"label": ["b", "a", "a"], "start_s": [5.0, 1.0, 9.0], "stop_s": [6.0, 3.0, 9.0]}
    ).to_csv(tmp_path / "e.csv", index=False)
    with pytest.warns(UserWarning) as rec:
        bt = loaders.load_epochs_csv(tmp_path / "e.csv")
    msgs = " ".join(str(w.message) for w in rec)
    assert "scored_span" in msgs and "zero-length" in msgs
    assert bt.labels == ["a", "b", "a"]
    np.testing.assert_allclose(bt.start_s, [1, 5, 9])
    assert (bt.scored_start_s, bt.scored_stop_s) == (1.0, 9.0)
    with pytest.warns(UserWarning, match="zero-length"):
        bt = loaders.load_epochs_csv(tmp_path / "e.csv", scored_span=(0, 20))
    assert bt.scored_stop_s == 20
    pd.DataFrame({"label": ["a"], "start_s": [4.0], "stop_s": [3.0]}).to_csv(
        tmp_path / "bad.csv", index=False
    )
    with pytest.raises(ValueError, match="row 0"):
        loaders.load_epochs_csv(tmp_path / "bad.csv", scored_span=(0, 5))
    with pytest.raises(KeyError):
        loaders.load_epochs_csv(tmp_path / "e.csv", label_column="behavior")
