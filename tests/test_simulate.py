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
    untuned = set(gt["untuned_cells"])
    assert len(place) == 30 and len(social) == 20 and len(syl) == 10
    assert not (place & social or place & syl or social & syl)
    assert place | social | syl | untuned == set(range(100))
    assert not untuned & (place | social | syl)
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
