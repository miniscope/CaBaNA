"""Tests for the synthetic session generator."""

from __future__ import annotations

import json
import time

import numpy as np
import pytest

from cabana._simulate import SimulationConfig, simulate_session


@pytest.fixture(scope="module")
def sess():
    return simulate_session(SimulationConfig(duration_s=600, n_cells=100, seed=3))


def test_deterministic():
    a = simulate_session(duration_s=100, n_cells=20, seed=5)
    b = simulate_session(duration_s=100, n_cells=20, seed=5)
    c = simulate_session(duration_s=100, n_cells=20, seed=6)
    assert np.array_equal(a.activity, b.activity)
    assert a.meta["ground_truth"] == b.meta["ground_truth"]
    assert not np.array_equal(a.activity, c.activity)


def test_shapes_and_clocks(sess):
    assert sess.activity.shape == (100, 600 * 20)
    assert sess.activity.dtype == np.float64
    assert sess.cell_ids[:2] == ["cell_000", "cell_001"]
    assert sess.t[0] == 0 and np.isclose(sess.t[1], 1 / 20)
    pos = sess.behavior["position"]
    assert pos.t[0] == pytest.approx(-2.0)
    assert pos.t[-1] >= sess.t[-1] + 2.0 - 1e-6
    assert pos.values.min() >= 0 and pos.values.max() <= 400
    bt = sess.behavior["social"]
    assert (bt.scored_start_s, bt.scored_stop_s) == (30.0, 570.0)
    assert bt.start_s.min() >= 30 and bt.stop_s.max() <= 570
    syl = sess.behavior["syllables"]
    assert set(np.unique(syl.labels)) == set(range(6))
    assert len(syl.label_names) == 6
    json.dumps(sess.meta)


def test_refractory_gap(sess):
    bt = sess.behavior["social"]
    for name in bt.behavior_names:
        m = np.array(bt.labels) == name
        a, b = bt.start_s[m], bt.stop_s[m]
        assert np.all(a[1:] - b[:-1] >= 2.0 - 1e-9)


def test_populations_disjoint(sess):
    gt = sess.meta["ground_truth"]
    place = set(gt["place_cells"])
    social = {d["cell"] for d in gt["social_cells"]}
    syl = {d["cell"] for d in gt["syllable_cells"]}
    hd = {d["cell"] for d in gt["head_direction_cells"]}
    pc = {d["cell"] for d in gt["pitch_cells"]}
    untuned = set(gt["untuned_cells"])
    assert len(place) == 30 and len(social) == 20 and len(syl) == 10
    assert len(hd) == 10 and len(pc) == 5 and len(untuned) == 25
    assert not (place & social or place & syl or social & syl)
    assert place | social | syl | hd | pc | untuned == set(range(100))
    assert not untuned & (place | social | syl | hd | pc) and not hd & pc
    assert len(gt["field_centers_mm"]) == 30


def test_place_cells_fire_in_field(sess):
    gt = sess.meta["ground_truth"]
    pos = sess.behavior["position"]
    x = np.interp(sess.t, pos.t, pos.values[:, 0])
    y = np.interp(sess.t, pos.t, pos.values[:, 1])
    spd = np.hypot(np.gradient(x), np.gradient(y)) * sess.fs
    moving = spd > gt["speed_gate_mm_s"] * 1.5
    wins = 0
    for c, ctr, sg in zip(
        gt["place_cells"], gt["field_centers_mm"], gt["field_sigma_mm"], strict=True
    ):
        inside = np.hypot(x - ctr[0], y - ctr[1]) < sg
        if (inside & moving).sum() < 20:
            continue
        a = sess.activity[c]
        wins += a[inside & moving].mean() > a[~inside & moving].mean()
    assert wins >= 0.9 * len(gt["place_cells"]) - 3


def test_social_modulation(sess):
    gt = sess.meta["ground_truth"]
    bt = sess.behavior["social"]
    t = sess.t
    on = {
        n: np.any(
            [
                (t >= a) & (t < b)
                for lab, a, b in zip(bt.labels, bt.start_s, bt.stop_s, strict=True)
                if lab == n
            ],
            axis=0,
        )
        for n in bt.behavior_names
    }
    exc, inh = [], []
    for d in gt["social_cells"]:
        a = sess.activity[d["cell"]]
        m = on[d["behavior"]]
        (exc if d["sign"] == "excited" else inh).append(a[m].mean() / max(a[~m].mean(), 1e-9))
    assert len(exc) == len(inh) == 10
    assert np.mean(np.array(exc) > 1) > 0.9
    assert np.mean(np.array(inh) < 1) > 0.9


def test_spike_counts_integer():
    s = simulate_session(duration_s=60, n_cells=10, kind="spike_counts")
    assert s.activity_kind == "spike_counts"
    assert np.array_equal(s.activity, np.round(s.activity))
    d = simulate_session(duration_s=60, n_cells=10)
    assert d.activity_kind == "deconvolved"
    assert not np.array_equal(d.activity, np.round(d.activity))


def test_bad_config():
    with pytest.raises(ValueError):
        SimulationConfig(frac_place=0.6, frac_social=0.6)
    with pytest.raises(ValueError):
        SimulationConfig(bogus=1)


def test_short_config_fast():
    t0 = time.perf_counter()
    simulate_session(duration_s=60, n_cells=20)
    assert time.perf_counter() - t0 < 1.0


# --- head orientation ---------------------------------------------------------


def _euler(q):
    w, x, y, z = q.T
    yaw = np.degrees(np.arctan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)))
    pitch = np.degrees(np.arcsin(np.clip(2 * (z * x - w * y), -1, 1)))  # nose-up positive
    roll = np.degrees(np.arctan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)))
    return yaw, pitch, roll


def _wrap(a):
    return (a + 180.0) % 360.0 - 180.0


@pytest.fixture(scope="module")
def hsess():
    return simulate_session(
        duration_s=600, n_cells=200, seed=2, kind="spike_counts", head_yaw_offset_deg=30.0
    )


def test_head_populations_disjoint(hsess):
    gt = hsess.meta["ground_truth"]
    hd = [d["cell"] for d in gt["head_direction_cells"]]
    pc = [d["cell"] for d in gt["pitch_cells"]]
    groups = [
        gt["place_cells"],
        [d["cell"] for d in gt["social_cells"]],
        [d["cell"] for d in gt["syllable_cells"]],
        hd,
        pc,
        gt["untuned_cells"],
    ]
    allc = [c for g in groups for c in g]
    assert len(allc) == len(set(allc)) == 200
    assert (len(hd), len(pc)) == (20, 10)
    assert len(gt["untuned_cells"]) == 200 - 60 - 40 - 20 - 20 - 10
    assert gt["head_yaw_offset_deg"] == 30.0
    assert all(-180 < d["preferred_deg"] <= 180 for d in gt["head_direction_cells"])


def test_head_pool_clipped():
    s = simulate_session(
        duration_s=30,
        n_cells=10,
        seed=1,
        frac_place=0.5,
        frac_social=0.2,
        frac_syllable=0.1,
        frac_head_direction=0.9,
        frac_pitch=0.9,
    )
    gt = s.meta["ground_truth"]
    assert len(gt["head_direction_cells"]) + len(gt["pitch_cells"]) == 2
    assert gt["untuned_cells"] == []


def test_quaternion_properties(hsess):
    sig = hsess.behavior["head_orientation"]
    assert sig.channel_names == ["head_w", "head_x", "head_y", "head_z"]
    assert np.array_equal(sig.t, hsess.t)
    q = sig.values
    assert np.allclose(np.linalg.norm(q, axis=1), 1.0)
    assert ((q[1:] * q[:-1]).sum(axis=1) >= 0).all()


def test_head_yaw_recovers_heading_and_pitch_rises_in_rears(hsess):
    q = hsess.behavior["head_orientation"].values
    yaw, pitch, roll = _euler(q)
    assert np.abs(pitch).max() < 90 and np.abs(roll).max() < 90
    pos = hsess.behavior["position"]
    vel = np.gradient(pos.values, pos.t, axis=0)
    k = 8
    vel = np.apply_along_axis(lambda c: np.convolve(c, np.ones(k) / k, mode="same"), 0, vel)
    speed = np.hypot(vel[:, 0], vel[:, 1])
    mv = np.interp(hsess.t, pos.t, speed) > 40
    hv = np.degrees(
        np.arctan2(np.interp(hsess.t, pos.t, vel[:, 1]), np.interp(hsess.t, pos.t, vel[:, 0]))
    )
    err = np.abs(_wrap(yaw[mv] + 30.0 - hv[mv]))
    assert np.median(err) < 25
    assert np.percentile(err, 90) < 60
    syl = hsess.behavior["syllables"]
    fi = np.clip(np.round((hsess.t + 2.0) * 30 - 0.5 + 1e-9).astype(int), 0, syl.t.size - 1)
    rear = np.asarray(syl.labels)[fi] == 5
    assert rear.sum() > 20
    assert pitch[rear].mean() > pitch[~rear].mean() + 15


def test_head_direction_cells_tuned(hsess):
    gt = hsess.meta["ground_truth"]
    yaw = _euler(hsess.behavior["head_orientation"].values)[0] + 30.0
    good = 0
    for d in gt["head_direction_cells"]:
        a = hsess.activity[d["cell"]]
        mv = (a * np.exp(1j * np.radians(yaw))).sum() / a.sum()
        good += abs(_wrap(np.degrees(np.angle(mv)) - d["preferred_deg"])) < 30
    assert good >= 0.8 * len(gt["head_direction_cells"])


def test_pitch_cells_follow_pitch(hsess):
    gt = hsess.meta["ground_truth"]
    pitch = _euler(hsess.behavior["head_orientation"].values)[1]
    for d in gt["pitch_cells"]:
        r = np.corrcoef(hsess.activity[d["cell"]], pitch)[0, 1]
        assert (r > 0) if d["sign"] == "up" else (r < 0)


def test_head_orientation_off_is_identical_and_absent():
    on = simulate_session(duration_s=60, n_cells=40, seed=4)
    off = simulate_session(duration_s=60, n_cells=40, seed=4, include_head_orientation=False)
    assert "head_orientation" not in off.behavior
    gt = off.meta["ground_truth"]
    assert gt["head_direction_cells"] == [] and gt["pitch_cells"] == []
    changed = {d["cell"] for d in on.meta["ground_truth"]["head_direction_cells"]}
    changed |= {d["cell"] for d in on.meta["ground_truth"]["pitch_cells"]}
    keep = [i for i in range(40) if i not in changed]
    assert np.array_equal(on.activity[keep], off.activity[keep])
    assert np.array_equal(on.behavior["position"].values, off.behavior["position"].values)
