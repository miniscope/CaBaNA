"""End to end on the lab's simulated three-chamber dataset (slimmed to 75 s).

Two clocks (miniscope and behavior camera) share one time axis; position has a frame column
only; head orientation is quaternions; annotations are epochs.  The test loads everything with
``cabana.loaders``, builds a ``Session`` and runs the behaviour transforms and a small pipeline.
"""

from __future__ import annotations

import numpy as np
import pytest
import yaml

from cabana import ContinuousSignal, Session, SessionInfo, build, loaders
from cabana._pipeline import AnalysisSpec, Pipeline
from cabana._shuffle import ShuffleConfig


@pytest.fixture(scope="module")
def data(three_chamber_dir):
    d = three_chamber_dir
    t_n = loaders.load_miniscope_timestamps(d / "neural_timestamps.csv")
    t_b = loaders.load_miniscope_timestamps(d / "behavior_timestamps.csv")
    rep_n, rep_b = loaders.timing_report(t_n, 30.0), loaders.timing_report(t_b, 50.0)
    t_pos, xy = loaders.load_position_csv(
        d / "position.csv", timestamps=d / "behavior_timestamps.csv"
    )
    t_h, quat = loaders.load_head_orientation(d / "headOrientation.csv", timestamps=t_n)
    span = (float(t_n[0]), float(t_n[-1]))
    zones = loaders.load_epochs_csv(d / "zone_annotations.csv", scored_span=span)
    inv = loaders.load_epochs_csv(d / "investigation_annotations.csv", scored_span=span)
    act = np.load(d / "neural_deconvolved.npy", allow_pickle=False)
    cfg = yaml.safe_load((d / "config.yaml").read_text())
    return dict(t_n=t_n, t_b=t_b, rep_n=rep_n, rep_b=rep_b, t_pos=t_pos, xy=xy, t_h=t_h,
                quat=quat, zones=zones, inv=inv, act=act, cfg=cfg)  # fmt: skip


def test_timestamps_and_reports(data):
    for t, rep, nominal in ((data["t_n"], data["rep_n"], 30.0), (data["t_b"], data["rep_b"], 50.0)):
        assert t.dtype == np.float64 and np.all(np.diff(t) > 0)
        assert t[0] < 0  # first stamp precedes zero
        assert rep["n_frames"] == t.size and rep["first_t"] == t[0]
        assert rep["fs_mean"] == pytest.approx(nominal, rel=0.005)
        assert rep["n_dropped_frames"] >= 0 and rep["jitter_sd_s"] < 0.25 / nominal
    assert data["act"].dtype == np.float32 and data["act"].shape == (180, data["t_n"].size)
    print(
        "timing neural:",
        {k: v for k, v in data["rep_n"].items() if not k.startswith("gap_")},
        "behavior:",
        {k: v for k, v in data["rep_b"].items() if not k.startswith("gap_")},
    )


def test_position_head_and_epochs(data):
    xy = data["xy"]
    assert xy.shape == (data["t_pos"].size, 2) and data["t_pos"].size == data["t_b"].size
    lost = np.isnan(xy).all(axis=1)
    assert 0 < lost.mean() < 0.03 and not np.any(xy == -1)  # -1 became NaN
    assert data["quat"].shape == (data["t_n"].size, 4)
    np.testing.assert_allclose(np.linalg.norm(data["quat"], axis=1), 1.0, atol=1e-3)
    np.testing.assert_array_equal(data["t_h"], data["t_n"])
    assert set(data["zones"].behavior_names) == {"left", "center", "right"}
    assert set(data["inv"].behavior_names) <= {"investigate_stimulus", "investigate_empty"}
    assert data["zones"].scored_start_s == data["t_n"][0]


def _arena(cfg):
    w, h = cfg["arena_cm"]
    return {
        "size": [w, h],
        "units": "cm",
        "zones": {k: [lo, 0.0, hi, float(h)] for k, (lo, hi) in cfg["zones"].items()},
        "enclosures": {
            k: {"center": [cx, cy], "radius": r} for k, (cx, cy, r) in cfg["enclosures"].items()
        },
    }


@pytest.fixture(scope="module")
def prepared(data):
    fs = data["rep_n"]["fs_mean"]
    ses = Session(
        activity=data["act"].astype(np.float64),
        t=data["t_n"],
        fs=fs,
        activity_kind="deconvolved",
        info=SessionInfo(animal="sim3ch", condition="3chamber"),
        behavior={
            "position": ContinuousSignal(
                t=data["t_pos"], values=data["xy"], channel_names=["x", "y"], units="cm"
            ),
            "head": ContinuousSignal(
                t=data["t_h"], values=data["quat"], channel_names=[f"head_{c}" for c in "wxyz"]
            ),
            "zones_epochs": data["zones"],
            "investigation_epochs": data["inv"],
        },
        meta={"arena": _arena(data["cfg"]), "signal_units": {"x": "cm", "y": "cm"}},
    )
    steps = [
        {"name": "resample_signal", "source": "position", "max_gap_s": 0.5},
        {"name": "resample_signal", "source": "head"},
        {"name": "interpolate_gaps", "signal": ["x", "y"], "max_gap_s": 0.5},
        {"name": "speed"},
        {"name": "head_direction", "quaternion": "head"},
        {"name": "zone_occupancy", "signal": "", "zones_from_meta": True, "output": "zones"},
        {
            "name": "bouts_to_states",
            "source": "zones_epochs",
            "exclusive": True,
            "merge_gap_s": 0.5,
            "min_duration_s": 0.5,
            "output": "zones_annot",
        },
        {
            "name": "bouts_to_states",
            "source": "investigation_epochs",
            "merge_gap_s": 0.5,
            "min_duration_s": 0.5,
            "output": "investigation",
        },
    ]
    for st in steps:
        ses = build("transform", st).apply(ses)
    enc = data["cfg"]["enclosures"]["left"]
    ses = build(
        "transform", {"name": "distance", "a": "", "point": enc[:2], "output": "d_stim"}
    ).apply(ses)
    return ses


def test_transforms(prepared, data):
    s = prepared
    for k in ("x", "y", "speed", "head_direction", "d_stim"):
        assert s.signals[k].shape == (s.n_time,)
    assert np.isfinite(s.signals["speed"]).mean() > 0.9
    assert 0 < np.nanmax(s.signals["speed"]) < 40  # cm/s
    assert np.nanmin(s.signals["d_stim"]) >= 0
    assert "interpolate_gaps" in s.meta
    assert s.states["zones"].state_names == ["left", "center", "right"]
    assert s.states["investigation"].onehot.any(axis=0).all()


def test_zone_annotations_agree_with_position(prepared):
    z, a = prepared.states["zones"], prepared.states["zones_annot"]
    cols = [a.state_names.index(n) for n in z.state_names]
    ao = a.onehot[:, cols]
    cover = z.support & a.support & ao.any(axis=1) & z.onehot.any(axis=1)
    agree = (ao[cover] == z.onehot[cover]).all(axis=1).mean()
    print(f"zone agreement on {cover.sum()} covered frames: {agree:.4f}")
    assert cover.sum() > 0.8 * prepared.n_time
    assert agree >= 0.90


def test_small_pipeline(prepared):
    cfg = ShuffleConfig(n_shuffles=20, min_shift_s=5.0, seed=1)
    pipe = Pipeline(
        analyses=[
            AnalysisSpec(
                name="mean_zones", metric={"name": "mean_per_state"}, states="zones_annot",
                shuffle=cfg,
            ),
            AnalysisSpec(
                name="mean_inv", metric={"name": "mean_per_state"}, states="investigation",
                shuffle=cfg,
            ),
            AnalysisSpec(name="auroc_inv", metric={"name": "auroc"}, states="investigation"),
        ]
    )  # fmt: skip
    _, rs = pipe.run(prepared, progress=False)
    nc = prepared.n_cells
    r = rs.get(name="mean_zones")
    assert r.values.shape == (nc, 3) and r.shuffle.null.shape == (20, nc, 3)
    assert rs.get(name="mean_inv").values.shape == (nc, 2)
    au = rs.get(name="auroc_inv").values
    assert au.shape == (nc, 2) and np.isfinite(au).any()
    assert rs.to_dataframe()["cell"].nunique() == nc


# ---- geometry-derived investigation vs the lab's annotations

_PAIR = {"left_cup": "investigate_stimulus", "right_cup": "investigate_empty"}


def _bout_match(pred, ref, tol):
    """Number of ``pred`` bouts with a ``ref`` bout whose start and stop are both within tol s."""
    return sum(
        any(abs(a - c) <= tol and abs(b - d) <= tol for c, d in zip(*ref, strict=True))
        for a, b in zip(*pred, strict=True)
    )


@pytest.fixture(scope="module")
def derived(three_chamber_dir):
    s = loaders.load_session_dir(three_chamber_dir)
    return build(
        "transform", {"name": "investigation_from_geometry", "output": "investigation_geo"}
    ).apply(s)


def _agreement(s, tol=0.5):
    from cabana._transform_behavior import states_to_bouts

    geo, ann = s.states["investigation_geo"], s.states["investigation"]
    gb = states_to_bouts(geo, s.fs, t0=s.t[0])
    ab = states_to_bouts(ann, s.fs, t0=s.t[0])
    out = {}
    for tgt, lab in _PAIR.items():
        g = geo.onehot[:, geo.state_names.index(tgt)]
        a = ann.onehot[:, ann.state_names.index(lab)]
        ok = geo.support & ann.support
        gi = [i for i, n in enumerate(gb.labels) if n == tgt]
        ai = [i for i, n in enumerate(ab.labels) if n == lab]
        gs, as_ = (gb.start_s[gi], gb.stop_s[gi]), (ab.start_s[ai], ab.stop_s[ai])
        out[tgt] = dict(
            agree=float((g[ok] == a[ok]).mean()),
            n_pred=len(gi),
            n_ann=len(ai),
            precision=_bout_match(gs, as_, tol) / max(len(gi), 1),
            recall=_bout_match(as_, gs, tol) / max(len(ai), 1),
        )
    return out


def test_geometry_investigation_matches_annotations(derived):
    geo = derived.states["investigation_geo"]
    assert geo.state_names == ["left_cup", "right_cup"] and geo.exclusive
    assert "investigation_geo_valid" in derived.masks
    assert derived.meta["investigation_from_geometry"]["targets_used"]["left_cup"] == [0, 15, 9]
    res = _agreement(derived)
    print("geometry vs annotation:", res)
    for tgt, r in res.items():
        assert r["agree"] >= 0.97, (tgt, r)
    st = res["left_cup"]
    assert st["n_ann"] >= 3 and st["precision"] >= 0.8 and st["recall"] >= 0.8, st


def test_geometry_needs_distance_and_angle(derived):
    s = derived
    loose = build(
        "transform",
        {"name": "investigation_from_geometry", "max_distance": 50.0, "output": "g2"},
    ).apply(s)
    tight = build(
        "transform",
        {"name": "investigation_from_geometry", "max_angle_deg": 5.0, "output": "g3"},
    ).apply(s)
    n = lambda x, k: int(x.states[k].onehot.sum())  # noqa: E731
    assert n(tight, "g3") < n(s, "investigation_geo") < n(loose, "g2")


def test_pipeline_on_derived_investigation(derived):
    cfg = ShuffleConfig(n_shuffles=20, min_shift_s=5.0, seed=2)
    pipe = Pipeline(
        analyses=[
            AnalysisSpec(
                name="auroc_geo", metric={"name": "auroc"}, states="investigation_geo", shuffle=cfg
            )
        ]
    )
    _, rs = pipe.run(derived, progress=False)
    r = rs.get(name="auroc_geo")
    assert r.values.shape == (derived.n_cells, 2) and np.isfinite(r.values).any()
    assert r.shuffle.null.shape == (20, derived.n_cells, 2)
