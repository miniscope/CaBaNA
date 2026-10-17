"""``load_session_dir``: the config-driven session-folder loader."""

from __future__ import annotations

import shutil

import numpy as np
import pandas as pd
import pytest
import yaml

from cabana import SessionInfo, loaders
from cabana.loaders import SessionDirConfig, load_session_dir, write_session_dir_template


@pytest.fixture(scope="module")
def ses(three_chamber_dir):
    return load_session_dir(three_chamber_dir)


@pytest.fixture
def copy(three_chamber_dir, tmp_path):
    d = tmp_path / "s"
    shutil.copytree(three_chamber_dir, d)
    return d


def _edit(d, fn):
    p = d / "session.yaml"
    cfg = yaml.safe_load(p.read_text())
    fn(cfg)
    p.write_text(yaml.safe_dump(cfg))
    return d


def test_loads_fixture(ses, three_chamber_dir):
    assert ses.activity.dtype == np.float64 and ses.activity.shape == (180, ses.t.size)
    assert ses.activity_kind == "deconvolved"
    t_n = loaders.load_miniscope_timestamps(three_chamber_dir / "neural_timestamps.csv")
    np.testing.assert_array_equal(ses.t, t_n)
    assert ses.fs == pytest.approx(30.0, rel=0.005)
    assert ses.info.animal == "sim3ch" and ses.info.session_id == "sim3ch"
    assert ses.info.extra["stimulus"] == {"left_cup": "stimulus_mouse", "right_cup": None}
    m = ses.meta
    assert m["source"] == "session_dir" and m["config_path"].endswith("session.yaml")
    assert m["timing"]["neural"]["n_frames"] == ses.t.size
    assert m["timing"]["behavior"]["fs_mean"] == pytest.approx(50.0, rel=0.005)
    assert m["subjects"]["focal"] == "sim3ch"
    assert (
        set(m["enclosures"]) == {"left_cup", "right_cup"}
        and m["arena"]["enclosures"] == m["enclosures"]
    )
    assert m["neural_alternatives"] == {"denoised": "neural_denoised.npy", "raw": "neural_raw.npy"}
    assert m["signal_units"]["x"] == "cm"


def test_signals_and_states(ses):
    for k in ("x", "y", "head_direction", "head_w", "head_x", "head_y", "head_z"):
        assert ses.signals[k].shape == (ses.n_time,)
    assert 0 < np.isnan(ses.signals["x"]).mean() < 0.05  # lost frames stay NaN
    assert not np.any(ses.signals["x"] == -1)
    assert np.nanmax(np.abs(ses.signals["head_direction"])) <= np.pi
    z = ses.states["zones"]
    assert z.exclusive and set(z.state_names) == {"left", "center", "right"}
    inv = ses.states["investigation"]
    assert not inv.exclusive and set(inv.state_names) == {
        "investigate_stimulus",
        "investigate_empty",
    }
    assert inv.support.all() and inv.onehot.any()
    assert "zones_epochs" in ses.behavior and "position" in ses.behavior


def test_xrange_zones_expanded(ses):
    z = ses.meta["arena"]["zones"]
    assert z["left"] == [0.0, 0.0, 20.0, 30.0] and z["right"] == [40.0, 0.0, 60.0, 30.0]
    from cabana import build

    out = build(
        "transform", {"name": "zone_occupancy", "signal": "", "zones_from_meta": True}
    ).apply(ses)
    assert out.states["zones"].onehot.any(axis=0).all()


def test_resample_false_and_activity_and_info(ses, three_chamber_dir):
    raw = load_session_dir(three_chamber_dir, resample=False)
    assert not raw.signals and not raw.states and "position" in raw.behavior
    assert raw.behavior["position"].t.size == raw.meta["timing"]["behavior"]["n_frames"]
    s = load_session_dir(three_chamber_dir, info=SessionInfo(animal="m7", group="g"))
    assert s.info.animal == "m7" and s.info.group == "g" and s.info.session_id == "sim3ch"
    with pytest.raises(KeyError, match="alternatives"):
        load_session_dir(three_chamber_dir, activity="nope")
    with pytest.raises(FileNotFoundError, match="neural.file"):
        load_session_dir(three_chamber_dir, activity="denoised")  # not in the slim fixture


def test_config_file_path_and_config_yaml_only(copy):
    assert load_session_dir(copy / "session.yaml").n_cells == 180
    with pytest.raises(FileNotFoundError):
        load_session_dir(copy / "missing.yaml")


def test_frames_x_cells_and_fs_fallback(tmp_path):
    rng = np.random.default_rng(0)
    np.save(tmp_path / "a.npy", rng.random((100, 7)).astype(np.float32))  # frames x cells
    (tmp_path / "ids.txt").write_text("\n".join(f"c{i}" for i in range(7)))
    (tmp_path / "session.yaml").write_text(
        yaml.safe_dump(
            {
                "neural": {
                    "file": "a.npy",
                    "orientation": "frames_x_cells",
                    "fs": 20.0,
                    "kind": "dff",
                    "cell_ids": "ids.txt",
                }
            }
        )  # fmt: skip
    )
    s = load_session_dir(tmp_path)
    assert s.activity.shape == (7, 100) and s.activity.dtype == np.float64
    assert s.fs == pytest.approx(20.0) and s.t[1] == pytest.approx(0.05)
    assert s.activity_kind == "dff" and s.cell_ids == [f"c{i}" for i in range(7)]
    np.testing.assert_allclose(s.activity, np.load(tmp_path / "a.npy").T)


def test_behavior_clock(copy):
    base = load_session_dir(copy)
    _edit(copy, lambda c: c["behavior"].update(clock={"offset_s": 0.1, "scale": 1.0}))
    s = load_session_dir(copy)
    np.testing.assert_allclose(
        s.behavior["position"].t, base.behavior["position"].t - 0.1, atol=1e-12
    )


# ---- validation: each error names the field and the file


def test_err_neural_length(copy):
    ts = pd.read_csv(copy / "neural_timestamps.csv").iloc[:-5]
    ts.to_csv(copy / "neural_timestamps.csv", index=False)
    with pytest.raises(
        ValueError, match=r"neural\.timestamps.*neural_timestamps\.csv|neural_timestamps"
    ):
        load_session_dir(copy)


def test_err_orientation_mismatch(copy):
    _edit(copy, lambda c: c["neural"].update(orientation="frames_x_cells"))
    with pytest.raises(ValueError, match="neural.timestamps"):
        load_session_dir(copy)


def test_err_time_not_increasing(copy):
    df = pd.read_csv(copy / "behavior_timestamps.csv")
    df.loc[10, "Time Stamp (ms)"] = df.loc[9, "Time Stamp (ms)"]
    df.to_csv(copy / "behavior_timestamps.csv", index=False)
    with pytest.raises(ValueError, match=r"behavior\.timestamps.*strictly increasing"):
        load_session_dir(copy)


def test_err_position_frames_not_subset(copy):
    df = pd.read_csv(copy / "position.csv")
    df.loc[3, "frame"] = 10**6
    df.to_csv(copy / "position.csv", index=False)
    with pytest.raises(ValueError, match=r"behavior\.position.*position\.csv.*subset"):
        load_session_dir(copy)


def test_err_head_rows(copy):
    df = pd.read_csv(copy / "headOrientation.csv").iloc[:-3]
    df.to_csv(copy / "headOrientation.csv", index=False)
    with pytest.raises(ValueError, match=r"head_orientation.*headOrientation\.csv.*one row per"):
        load_session_dir(copy)


def test_err_epoch_stop_before_start(copy):
    df = pd.read_csv(copy / "investigation_annotations.csv")
    df.loc[0, ["start_s", "stop_s"]] = [5.0, 4.0]
    df.to_csv(copy / "investigation_annotations.csv", index=False)
    with pytest.raises(ValueError, match=r"epochs\.investigation.*investigation_annotations"):
        load_session_dir(copy)


def test_err_missing_file_and_bad_config(copy):
    (copy / "position.csv").unlink()
    with pytest.raises(FileNotFoundError, match=r"behavior\.position\.file"):
        load_session_dir(copy)
    _edit(copy, lambda c: c["neural"].update(bogus=1))
    with pytest.raises(ValueError, match="session.yaml"):
        load_session_dir(copy)


def test_err_no_timestamps_no_fs(tmp_path):
    np.save(tmp_path / "a.npy", np.zeros((3, 10)))
    (tmp_path / "session.yaml").write_text(yaml.safe_dump({"neural": {"file": "a.npy"}}))
    with pytest.raises(ValueError, match="timestamps.*fs"):
        load_session_dir(tmp_path)


def test_template_roundtrip(tmp_path):
    p = write_session_dir_template(tmp_path / "new")
    assert p.name == "session.yaml"
    cfg = SessionDirConfig.from_yaml(p)
    assert cfg.neural.kind == "deconvolved" and cfg.arena.zones["left"] == [0.0, 0.0, 20.0, 30.0]
    assert cfg.arena.enclosures["left_cup"].contents == "stimulus"
    assert set(cfg.behavior.epochs) == {"zones", "investigation"}
    with pytest.raises(FileExistsError):
        write_session_dir_template(p)
    write_session_dir_template(p, overwrite=True)
