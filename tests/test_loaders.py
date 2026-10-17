"""Real-data loaders on synthetic files."""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
import pytest
import yaml

import cabana
from cabana import loaders
from cabana._shuffle import ShuffleConfig

FS = 10.0
N = 600


def _session(act=None):
    rng = np.random.default_rng(0)
    act = rng.random((4, N)) if act is None else act
    return cabana.Session(activity=act, t=np.arange(N) / FS, fs=FS, activity_kind="deconvolved")


def test_common():
    assert loaders.infer_fs(np.arange(10) / 20.0) == pytest.approx(20.0)
    np.testing.assert_allclose(loaders.video_time_to_neural([5.0, 6.0], 2.0), [3.0, 4.0])
    with pytest.raises(ValueError):
        loaders.validate_time([0, 2, 1])
    with pytest.raises(ValueError):
        loaders.validate_time([0, np.nan])


def test_boris_aggregated_and_offset(tmp_path):
    f = tmp_path / "agg.csv"
    pd.DataFrame(
        {
            "Subject": ["a", "a", "b"],
            "Behavior": ["chase", "groom", "chase"],
            "Behavioral category": ["", "", ""],
            "Start (s)": [12.0, 20.0, 30.0],
            "Stop (s)": [15.0, 22.0, 33.0],
        }
    ).to_csv(f, index=False)
    with (
        pytest.warns(UserWarning, match="scored_span"),
        pytest.warns(UserWarning, match="subjects"),
    ):
        bt = loaders.load_boris(f, t_offset_s=10.0)
    assert bt.labels == ["chase", "groom", "chase"]
    np.testing.assert_allclose(bt.start_s, [2.0, 10.0, 20.0])
    assert bt.scored_start_s == 2.0 and bt.scored_stop_s == 23.0
    bt = loaders.load_boris(
        f, subject="a", behaviors=["chase"], t_offset_s=10.0, scored_span=(0, 60)
    )
    assert bt.labels == ["chase"] and bt.scored_stop_s == 60


def test_boris_raw_with_points(tmp_path):
    f = tmp_path / "raw.tsv"
    pd.DataFrame(
        {
            "Time": [1.0, 3.0, 4.0, 5.0, 7.0],
            "Subject": ["a"] * 5,
            "Behavior": ["chase", "chase", "poke", "groom", "groom"],
            "Status": ["START", "STOP", "POINT", "START", "START"],
        }
    ).to_csv(f, sep="\t", index=False)
    with pytest.warns(UserWarning) as rec:
        bt = loaders.load_boris(f, scored_span=(0, 10))
    msgs = " ".join(str(w.message) for w in rec)
    assert "zero-length" in msgs and "unmatched" in msgs
    assert bt.labels == ["chase", "poke"]
    np.testing.assert_allclose(bt.stop_s - bt.start_s, [2.0, 0.0])
    with pytest.raises(KeyError, match="Start"):
        pd.DataFrame({"Behavior": ["x"]}).to_csv(tmp_path / "bad.csv", index=False)
        loaders.load_boris(tmp_path / "bad.csv")


def _dlc_csv(path, with_lik=True):
    n = 100
    cols = []
    data = {}
    rng = np.random.default_rng(1)
    for b in ("nose", "tail"):
        for c in ("x", "y", "likelihood"):
            cols.append(("scorer", b, c))
        data[b] = rng.uniform(0, 200, (n, 2))
    arr = np.zeros((n, 6))
    arr[:, 0:2], arr[:, 3:5] = data["nose"], data["tail"]
    arr[:, 2] = 0.99
    arr[:, 5] = 0.99
    arr[10, 2] = 0.1  # nose low likelihood at row 10
    df = pd.DataFrame(
        arr, columns=pd.MultiIndex.from_tuples(cols, names=["scorer", "bodyparts", "coords"])
    )
    df.to_csv(path)
    return arr


def test_dlc_csv(tmp_path):
    f = tmp_path / "dlc.csv"
    arr = _dlc_csv(f)
    sig = loaders.load_dlc(f, fs_video=20.0, t_offset_s=1.0, px_per_mm=2.0)
    assert sig.channel_names[:4] == ["nose_x", "nose_y", "tail_x", "tail_y"]
    assert sig.channel_names[4:] == ["nose_likelihood", "tail_likelihood"]
    assert sig.units == "mm" and sig.values.shape == (100, 6)
    assert sig.values[10, 4] == pytest.approx(0.1)  # raw likelihood kept, not NaN-ed
    assert np.isnan(sig.values[10, :2]).all() and np.isfinite(sig.values[10, 2:]).all()
    np.testing.assert_allclose(sig.t[:2], [-1.0, -0.95])
    np.testing.assert_allclose(sig.values[0, 0], arr[0, 0] / 2.0)
    with pytest.raises(ValueError):
        loaders.load_dlc(f)
    with pytest.raises(KeyError, match="nose"):
        loaders.load_dlc(f, fs_video=20.0, bodyparts=["paw"])
    cen = loaders.dlc_centroid(sig, ["nose", "tail"])
    assert cen.channel_names == ["x", "y"]
    nolik = loaders.load_dlc(f, fs_video=20.0, keep_likelihood=False, likelihood_min=None)
    assert nolik.values.shape == (100, 4) and np.isfinite(nolik.values).all()
    np.testing.assert_allclose(cen.values[10], sig.values[10, 2:4])  # NaN nose ignored


def test_dlc_h5(tmp_path):
    pytest.importorskip("tables")
    f = tmp_path / "dlc.csv"
    _dlc_csv(f)
    df = pd.read_csv(f, header=[0, 1, 2], index_col=0)
    df.to_hdf(tmp_path / "dlc.h5", key="df")
    with pytest.raises(ValueError, match="trusted_hdf"):
        loaders.load_dlc(tmp_path / "dlc.h5", t=np.arange(100) / 20.0)
    sig = loaders.load_dlc(tmp_path / "dlc.h5", t=np.arange(100) / 20.0, trusted_hdf=True)
    assert sig.values.shape == (100, 6)


def test_moseq_csv_and_h5(tmp_path):
    f = tmp_path / "m.csv"
    pd.DataFrame(
        {
            "name": ["r1"] * 4 + ["r2"] * 2,
            "frame_index": [2, 3, 5, 6, 0, 1],
            "syllable": [1, 1, 3, 0, 9, 9],
        }
    ).to_csv(f, index=False)
    ls = loaders.load_moseq(f, fs_video=10.0, t_offset_s=0.5, key="r1")
    np.testing.assert_array_equal(ls.labels, [-1, -1, 1, 1, -1, 3, 0])
    assert ls.label_names == ["syl00", "syl01", "syl02", "syl03"]
    np.testing.assert_allclose(ls.t[:2], [-0.5, -0.4])
    with pytest.raises(KeyError):
        loaders.load_moseq(f, fs_video=10.0)
    h5py = pytest.importorskip("h5py")
    with h5py.File(tmp_path / "results.h5", "w") as h:
        h.create_dataset("rec/syllable", data=np.array([0, 2, 2, 1]))
    ls = loaders.load_moseq(tmp_path / "results.h5", fs_video=5.0, names=["a", "b", "c"])
    assert ls.label_names == ["a", "b", "c"] and ls.labels.tolist() == [0, 2, 2, 1]


def test_caiman(tmp_path):
    h5py = pytest.importorskip("h5py")
    rng = np.random.default_rng(0)
    f = tmp_path / "c.hdf5"
    with h5py.File(f, "w") as h:
        h["estimates/S"] = rng.random((5, 50))
        h["estimates/C"] = rng.random((5, 50))
        h["estimates/idx_components"] = np.array([1, 3])
        h["params/data/fr"] = 20.0
    s = loaders.load_caiman(f, fs=20.0)
    assert s.activity.shape == (2, 50) and s.cell_ids == ["1", "3"]
    assert s.activity_kind == "deconvolved"
    s = loaders.load_caiman(f, activity="C", fs=20.0, keep_idx_components=False)
    assert s.n_cells == 5 and s.activity_kind == "denoised"
    with pytest.raises(KeyError, match="F_dff"):
        loaders.load_caiman(f, activity="F_dff", fs=20.0)


def test_minian(tmp_path):
    xr = pytest.importorskip("xarray")
    pytest.importorskip("zarr")
    rng = np.random.default_rng(0)
    S = xr.DataArray(
        rng.random((3, 40)),
        dims=("unit_id", "frame"),
        coords={"unit_id": [7, 8, 9], "frame": np.arange(40)},
        name="S",
    )
    root = tmp_path / "minian"
    root.mkdir()
    S.to_dataset().to_zarr(root / "S.zarr")
    s = loaders.load_minian(root, fs=30.0)
    assert s.activity.shape == (3, 40) and s.cell_ids == ["7", "8", "9"] and s.fs == 30.0
    with pytest.raises(ValueError, match="time base"):
        loaders.load_minian(root)
    s = loaders.load_minian(root, t=np.arange(40) / 15.0)
    assert s.fs == pytest.approx(15.0)
    with pytest.raises(KeyError, match="C"):
        loaders.load_minian(root, activity="C", fs=30.0)
    # netCDF with a timestamp coordinate
    pytest.importorskip("netCDF4")
    S2 = S.assign_coords(timestamp=("frame", np.arange(40) / 10.0))
    S2.to_dataset().to_netcdf(tmp_path / "m.nc")
    s = loaders.load_minian(tmp_path / "m.nc")
    assert s.fs == pytest.approx(10.0)


def test_camap(tmp_path):
    pytest.importorskip("pyarrow")
    b = tmp_path / "x.camap"
    b.mkdir()
    (b / "metadata.json").write_text(json.dumps({"version": 1, "camap_version": "0"}))
    (b / "config.yaml").write_text(
        yaml.dump({"neural": {"fps": 10.0}, "behavior": {"type": "arena", "speed_threshold": 20.0}})
    )
    n = 100
    rng = np.random.default_rng(0)
    t = np.arange(n) / 10.0
    df = pd.DataFrame(
        {
            "frame_index": np.arange(n),
            "neural_time": t,
            "x": rng.uniform(0, 100, n),
            "y": rng.uniform(0, 100, n),
            "speed": rng.random(n),
        }
    )
    df["s_unit_3"] = rng.random(n)
    df["s_unit_5"] = rng.random(n)
    df.to_parquet(b / "canonical.parquet")
    s = loaders.load_camap(b)
    assert s.activity.shape == (2, n) and s.cell_ids == ["3", "5"] and s.fs == 10.0
    assert set(s.signals) >= {"x", "y", "speed"}
    assert s.meta["camap"]["config"]["behavior"]["speed_threshold"] == 20.0
    # deconv fallback
    (b / "canonical.parquet").unlink()
    np.savez(b / "deconv.npz", good_unit_ids=np.array([1, 2]), S_0=rng.random(n), S_1=rng.random(n))
    with pytest.warns(UserWarning, match="deconv.npz"):
        s = loaders.load_camap(b)
    assert s.cell_ids == ["1", "2"] and s.signals == {}


def test_loaded_objects_run_standard_pipeline(tmp_path):
    f = tmp_path / "dlc.csv"
    _dlc_csv(f)
    n = 100
    # DLC at 20 Hz covering 5 s; neural session 10 Hz over 10 s, imaging starts 0.5 s into video
    sig = loaders.dlc_centroid(loaders.load_dlc(f, fs_video=20.0, t_offset_s=0.5), ["nose", "tail"])
    bf = tmp_path / "b.csv"
    pd.DataFrame(
        {"Behavior": ["chase", "groom"], "Start (s)": [1.5, 3.5], "Stop (s)": [3.0, 4.5]}
    ).to_csv(bf, index=False)
    bt = loaders.load_boris(bf, t_offset_s=0.5, scored_span=(0.0, 4.5))
    rng = np.random.default_rng(2)
    s = cabana.Session(
        activity=rng.random((3, 100)),
        t=np.arange(n) / 10.0,
        fs=10.0,
        behavior={"position": sig, "social": bt},
    )
    pipe = cabana.Pipeline(
        transforms=[
            {"name": "resample_signal", "source": "position"},
            {"name": "speed"},
            {"name": "bin_grid", "signals": ["x", "y"], "n_bins": 4, "output": "position"},
            {"name": "bouts_to_states", "source": "social", "output": "social"},
        ],
        analyses=[
            cabana.AnalysisSpec(
                metric={"name": "auroc"},
                states="social",
                shuffle=ShuffleConfig(n_shuffles=5, min_shift_s=1.0, seed=0),
            )
        ],
    )
    out, rs = pipe.run(s)
    assert "speed" in out.signals and "position" in out.states
    assert out.states["social"].onehot.any()
    assert rs.results[0].shuffle.null.shape[0] == 5


def test_caiman_empty_idx_components_raises(tmp_path):
    h5py = pytest.importorskip("h5py")
    f = tmp_path / "e.hdf5"
    with h5py.File(f, "w") as h:
        h["estimates/S"] = np.random.default_rng(0).random((4, 30))
        h["estimates/idx_components"] = np.array([], dtype=int)
    with pytest.raises(ValueError, match="accepted 0 components"):
        loaders.load_caiman(f, fs=10.0)
    assert loaders.load_caiman(f, fs=10.0, keep_idx_components=False).n_cells == 4
    g = tmp_path / "absent.hdf5"
    with h5py.File(g, "w") as h:
        h["estimates/S"] = np.random.default_rng(0).random((4, 30))
    assert loaders.load_caiman(g, fs=10.0).n_cells == 4


def test_boris_nan_subject_counts_as_subject(tmp_path):
    f = tmp_path / "nan_subj.csv"
    pd.DataFrame(
        {
            "Subject": ["a", None],
            "Behavior": ["chase", "chase"],
            "Start (s)": [1.0, 5.0],
            "Stop (s)": [2.0, 6.0],
        }
    ).to_csv(f, index=False)
    with (
        pytest.warns(UserWarning, match="subjects"),
        pytest.warns(UserWarning, match="scored_span"),
    ):
        loaders.load_boris(f)


def test_boris_unparseable_times_raise(tmp_path):
    f = tmp_path / "hms.csv"
    pd.DataFrame(
        {
            "Behavior": ["chase", "chase"],
            "Start (s)": ["00:00:01", "5.0"],
            "Stop (s)": ["00:00:02", "6.0"],
        }
    ).to_csv(f, index=False)
    with pytest.raises(ValueError, match=r"1 value.*00:00:01.*seconds"):
        loaders.load_boris(f, scored_span=(0, 10))


def test_minian_fs_vs_coordinate_warns(tmp_path):
    xr = pytest.importorskip("xarray")
    pytest.importorskip("netCDF4")
    S = xr.DataArray(
        np.random.default_rng(0).random((3, 40)),
        dims=("unit_id", "frame"),
        coords={
            "unit_id": [1, 2, 3],
            "frame": np.arange(40),
            "timestamp": ("frame", np.arange(40) / 10.0),
        },
        name="S",
    )
    S.to_dataset().to_netcdf(tmp_path / "m.nc")
    with pytest.warns(UserWarning, match="coordinate wins"):
        s = loaders.load_minian(tmp_path / "m.nc", fs=30.0)
    assert s.fs == pytest.approx(10.0)


def test_time_axis_warns_when_fs_and_t_both_given():
    from cabana._loaders._common import time_axis

    with pytest.warns(UserWarning, match="ignored"):
        time_axis(5, t=np.arange(5) / 10.0, fs=30.0)


def test_import_cabana_does_not_need_optional_deps():
    import subprocess
    import sys

    code = (
        "import sys\n"
        "for m in ('h5py','xarray','tables','pyarrow','zarr'): sys.modules[m] = None\n"
        "import cabana, cabana.loaders\n"
    )
    r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def test_dlc_multi_animal_csv(tmp_path):
    n = 30
    rng = np.random.default_rng(2)
    cols, data = [], []
    for ind in ("mouse1", "mouse2"):
        for b in ("nose", "neck"):
            for c in ("x", "y", "likelihood"):
                cols.append(("scorer", ind, b, c))
            data.append(rng.uniform(0, 100, (n, 2)))
            data.append(np.full((n, 1), 0.95))
    arr = np.concatenate(data, axis=1)
    arr[4, 2] = 0.1  # mouse1 nose low likelihood (column order: x, y, lik per part)
    df = pd.DataFrame(
        arr,
        columns=pd.MultiIndex.from_tuples(
            cols, names=["scorer", "individuals", "bodyparts", "coords"]
        ),
    )
    f = tmp_path / "multi.csv"
    df.to_csv(f)
    sig = loaders.load_dlc(f, fs_video=10.0)
    assert sig.channel_names[:4] == [
        "mouse1_nose_x",
        "mouse1_nose_y",
        "mouse1_neck_x",
        "mouse1_neck_y",
    ]
    assert "mouse2_neck_likelihood" in sig.channel_names and sig.values.shape == (n, 12)
    np.testing.assert_allclose(sig.values[0, 0], arr[0, 0])
    assert np.isnan(sig.values[4, :2]).all() and np.isfinite(sig.values[4, 2:]).all()
    only = loaders.load_dlc(f, fs_video=10.0, individuals=["mouse2"], bodyparts=["nose"])
    assert only.channel_names == ["mouse2_nose_x", "mouse2_nose_y", "mouse2_nose_likelihood"]
    np.testing.assert_allclose(only.values[:, 0], arr[:, 6])
    with pytest.raises(KeyError, match="mouse3"):
        loaders.load_dlc(f, fs_video=10.0, individuals=["mouse3"])
    cen = loaders.dlc_centroid(sig, ["mouse1_nose", "mouse1_neck"])
    assert cen.channel_names == ["x", "y"]
    single = tmp_path / "single.csv"
    _dlc_csv(single)
    with pytest.raises(ValueError, match="single-animal"):
        loaders.load_dlc(single, fs_video=20.0, individuals=["a"])
