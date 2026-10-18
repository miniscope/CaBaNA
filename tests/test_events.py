import matplotlib

matplotlib.use("Agg")

import time  # noqa: E402

import numpy as np  # noqa: E402
import pytest  # noqa: E402

import cabana  # noqa: E402
from cabana import BoutTable, Session, build  # noqa: E402
from cabana._metrics._events import PETH, bouts, event_onsets  # noqa: E402
from cabana._models import StateSpace  # noqa: E402
from cabana._plots_events import plot_event_raster, plot_peth  # noqa: E402
from cabana._results import MetricResult  # noqa: E402
from cabana._shuffle import ShuffleConfig, shuffle_test  # noqa: E402
from cabana._transform import BoutsToStates  # noqa: E402

FS = 10.0


def _states(onehot):
    onehot = np.asarray(onehot, dtype=bool)
    return StateSpace(
        name="s",
        onehot=onehot,
        state_names=[f"s{i}" for i in range(onehot.shape[1])],
        kind="bouts",
        exclusive=False,
    )


def _step_data(onsets, n=400, n_cells=1, length=20, step=3.0, base=1.0):
    """Cell 0 steps from ``base`` to ``base + step`` for ``length`` frames from each onset."""
    oh = np.zeros((n, 1), bool)
    x = np.full((n_cells, n), base)
    for o in onsets:
        oh[o : o + length, 0] = True
        x[0, o : o + length] += step
    return x, _states(oh)


SMALL = dict(pre_s=2.0, post_s=3.0, baseline_s=(-2.0, 0.0), response_s=(0.0, 2.0), min_events=3)


def test_bouts_and_onsets_filtering():
    oh = np.zeros((100, 2), bool)
    oh[0:5, 0] = True  # onset at frame 0, 5 frames
    oh[10:12, 0] = True  # 2 frames, gap 5 frames from previous end
    oh[30:50, 0] = True  # 20 frames, gap 18
    oh[52:60, 0] = True  # 8 frames, gap 2
    oh[20:30, 1] = True
    st = _states(oh)
    b = bouts(st)
    np.testing.assert_array_equal(b[0][0], [0, 10, 30, 52])
    np.testing.assert_array_equal(b[0][1], [5, 2, 20, 8])
    np.testing.assert_array_equal(b[1][0], [20])
    mask = np.ones(100, bool)
    on = event_onsets(st, mask, FS)
    np.testing.assert_array_equal(on[0], [0, 10, 30, 52])
    on = event_onsets(st, mask, FS, min_duration_s=0.5)
    np.testing.assert_array_equal(on[0], [0, 30, 52])
    on = event_onsets(st, mask, FS, min_gap_s=1.0)  # gap >= 10 frames
    np.testing.assert_array_equal(on[0], [0, 30])
    mask[30] = False
    on = event_onsets(st, mask, FS, min_duration_s=0.5, min_gap_s=0.0)
    np.testing.assert_array_equal(on[0], [0, 52])
    np.testing.assert_array_equal(on[1], [20])


def test_p_prepost_needs_six_nonzero_differences():
    onsets = [30, 80, 130, 180, 230, 280, 330]
    x, st = _step_data(onsets)
    mask = np.ones(400, bool)
    p7 = PETH(**SMALL).extras(x, st, mask, FS)["p_prepost"][0, 0]
    assert p7 == pytest.approx(2 / 2**7)
    x5, st5 = _step_data(onsets[:5])
    assert np.isnan(PETH(**SMALL).extras(x5, st5, mask, FS)["p_prepost"][0, 0])
    x6, st6 = _step_data(onsets[:6])
    assert PETH(**SMALL).extras(x6, st6, mask, FS)["p_prepost"][0, 0] == pytest.approx(2 / 2**6)


def test_peth_step_response_exact_and_shapes():
    x, st = _step_data([50, 120, 200, 300])
    m = PETH(**SMALL)
    mask = np.ones(400, bool)
    val = m.compute(x, st, mask, FS)
    assert val.shape == (1, 1)
    np.testing.assert_allclose(val, 3.0)
    ex = m.extras(x, st, mask, FS)
    assert ex["peth"].shape == (1, 1, 50)
    assert ex["time_s"].shape == (50,)
    np.testing.assert_allclose(ex["time_s"][[0, 20, 49]], [-2.0, 0.0, 2.9])
    assert ex["n_events"].tolist() == [4]
    np.testing.assert_allclose(ex["peth"][0, 0, :20], 0.0)  # baseline-subtracted
    np.testing.assert_allclose(ex["peth"][0, 0, 20:40], 3.0)
    np.testing.assert_allclose(ex["peth"][0, 0, 40:], 0.0)
    np.testing.assert_allclose(ex["peth_sem"], 0.0, atol=1e-12)
    assert np.isnan(ex["p_prepost"][0, 0])  # only 4 non-zero differences: cannot reach alpha
    # without baseline subtraction the raw level shows
    raw = PETH(**SMALL, baseline_subtract=False).extras(x, st, mask, FS)["peth"]
    np.testing.assert_allclose(raw[0, 0, :20], 1.0)
    # binned
    b = PETH(**SMALL, bin_s=0.5).extras(x, st, mask, FS)
    assert b["peth"].shape == (1, 1, 10) and b["time_s"].shape == (10,)
    np.testing.assert_allclose(b["time_s"][0], -1.8)
    np.testing.assert_allclose(b["peth"][0, 0, 4:8], 3.0)


def test_peth_edge_events_dropped_and_min_events():
    x, st = _step_data([5, 120, 200, 395], n=400)  # first and last windows leave the session
    m = PETH(**{**SMALL, "min_events": 2})
    ex = m.extras(x, st, np.ones(400, bool), FS)
    assert ex["n_events"].tolist() == [2]
    assert m.compute(x, st, np.ones(400, bool), FS)[0, 0] == pytest.approx(3.0)
    m3 = PETH(**SMALL)
    assert np.isnan(m3.compute(x, st, np.ones(400, bool), FS)).all()
    assert np.isnan(m3.extras(x, st, np.ones(400, bool), FS)["peth"]).all()
    assert np.isnan(m3.compute_shifted(x, st, np.ones(400, bool), FS, np.array([0, 5]))).all()
    with pytest.raises(ValueError):
        PETH(pre_s=1.0, post_s=1.0, baseline_s=(-3, -1), response_s=(0, 1)).compute(
            x, st, np.ones(400, bool), FS
        )


def test_peth_masked_onset_excluded():
    x, st = _step_data([50, 120, 200, 300])
    mask = np.ones(400, bool)
    mask[120] = False
    ex = PETH(**SMALL).extras(x, st, mask, FS)
    assert ex["n_events"].tolist() == [3]


def test_peth_shifted_equals_loop_with_mask():
    rng = np.random.default_rng(0)
    n = 600
    oh = np.zeros((n, 2), bool)
    for o in (30, 100, 180, 260, 340, 430, 520):
        oh[o : o + int(rng.integers(5, 25)), 0] = True
    for o in (60, 150, 240, 330, 580):
        oh[o : o + 8, 1] = True
    st = _states(oh)
    x = rng.random((6, n))
    mask = rng.random(n) < 0.8
    m = PETH(pre_s=2.0, post_s=2.5, baseline_s=(-2.0, -0.5), response_s=(0.0, 1.5), min_events=3)
    shifts = np.array([0, 3, 77, 311, 599])
    fast = m.compute_shifted(x, st, mask, FS, shifts)
    slow = np.stack([m.compute(np.roll(x, k, axis=1), st, mask, FS) for k in shifts])
    np.testing.assert_allclose(fast, slow, atol=1e-12)
    # independent looped definition of the statistic (state 0)
    ons = m.valid_onsets(st, mask, FS)[0]
    d = [x[:, o : o + 15].mean(1) - x[:, o - 20 : o - 5].mean(1) for o in ons]
    np.testing.assert_allclose(m.compute(x, st, mask, FS)[:, 0], np.mean(d, axis=0), atol=1e-12)


def test_wilcoxon_small_for_signal_not_noise():
    rng = np.random.default_rng(3)
    onsets = list(range(60, 1900, 100))
    n = 2000
    oh = np.zeros((n, 1), bool)
    x = rng.normal(0, 1, (2, n))
    for o in onsets:
        oh[o : o + 20, 0] = True
        x[0, o : o + 20] += 3.0  # cell 0 responds; cell 1 is noise
    ex = PETH(**SMALL).extras(x, _states(oh), np.ones(n, bool), FS)
    assert ex["p_prepost"][0, 0] < 1e-3
    assert ex["p_prepost"][1, 0] > 0.01


def test_peth_all_zero_diff_gives_nan_p():
    x, st = _step_data([50, 120, 200, 300], step=0.0)
    ex = PETH(**SMALL).extras(x, st, np.ones(400, bool), FS)
    assert np.isnan(ex["p_prepost"]).all()


def test_registered():
    assert isinstance(build("metric", {"name": "peth", "pre_s": 1.0}), PETH)
    assert PETH.default_tail == "two"


# --------------------------------------------------------------------------- #
# BoutsToStates filtering
# --------------------------------------------------------------------------- #


def _bout_session():
    t = np.arange(300) / FS
    tb = BoutTable(
        labels=["a", "a", "a", "a", "b"],
        start_s=np.array([1.0, 3.0, 10.0, 10.45, 5.0]),
        stop_s=np.array([1.25, 4.0, 10.35, 12.0, 5.15]),
    )
    return Session(activity=np.ones((1, 300)), t=t, fs=FS, behavior={"bouts": tb})


def test_bouts_to_states_min_duration_and_gap():
    s = _bout_session()
    t = s.t

    def active(**kw):
        return BoutsToStates(source="bouts", **kw).apply(s).states["social"].onehot

    full = active()
    assert (
        full[:, 0]
        == (
            (t >= 1) & (t < 1.25)
            | (t >= 3) & (t < 4)
            | (t >= 10) & (t < 10.35)
            | (t >= 10.45) & (t < 12)
        )
    ).all()
    dur = active(min_duration_s=0.5)  # drops a[0] (0.2 s) and a[2] (0.3 s)
    np.testing.assert_array_equal(dur[:, 0], (t >= 3) & (t < 4) | (t >= 10.45) & (t < 12))
    assert not dur[:, 1].any()  # b's only bout is 0.15 s
    gap = active(min_gap_s=1.0)  # a[1] gap 1.8 ok, a[2] gap 6, a[3] gap 0.1 dropped
    np.testing.assert_array_equal(
        gap[:, 0], (t >= 1) & (t < 1.25) | (t >= 3) & (t < 4) | (t >= 10) & (t < 10.35)
    )
    both = active(min_gap_s=1.0, min_duration_s=0.3)  # a[0] too short
    np.testing.assert_array_equal(both[:, 0], (t >= 3) & (t < 4) | (t >= 10) & (t < 10.35))
    with pytest.raises(ValueError):
        BoutsToStates(source="bouts", min_gap_s=-1.0)


# --------------------------------------------------------------------------- #
# planted detection through the shuffle engine
# --------------------------------------------------------------------------- #


@pytest.fixture(scope="module")
def planted():
    s = cabana.simulate_session(duration_s=600, n_cells=40, seed=0)
    s = build("transform", {"name": "resample_signal", "source": "position"}).apply(s)
    s = build("transform", {"name": "bouts_to_states", "source": "social"}).apply(s)
    return s


@pytest.fixture(scope="module")
def planted_result(planted):
    s = planted
    metric = PETH(
        pre_s=4.0,
        post_s=4.0,
        baseline_s=(-4.0, -1.0),
        response_s=(0.0, 1.5),
        min_duration_s=1.5,
        min_gap_s=1.0,
    )
    mask = s.masks["social_scored"]
    t0 = time.perf_counter()
    sh = shuffle_test(
        metric,
        s.activity,
        s.states["social"],
        mask,
        ShuffleConfig(n_shuffles=200, seed=0),
        s.fs,
    )
    elapsed = time.perf_counter() - t0
    extras = metric.extras(s.activity, s.states["social"], mask, s.fs)
    res = MetricResult(
        metric="peth",
        target="social",
        level="cell",
        values=sh.observed,
        shuffle=sh,
        params=metric.to_dict(),
        extras=extras,
        cell_ids=s.cell_ids,
        state_names=s.states["social"].state_names,
    )
    return res, elapsed


def test_planted_social_peth_detection(planted, planted_result):
    res, elapsed = planted_result
    print(f"\nPETH shuffle test (200 shuffles, 40 cells): {elapsed:.2f}s")
    gt = planted.meta["ground_truth"]
    names = res.state_names
    sh = res.shuffle
    excited = [
        (g["cell"], names.index(g["behavior"]))
        for g in gt["social_cells"]
        if g["sign"] == "excited"
    ]
    hits = [
        res.values[c, s] > 0 and sh.p_value[c, s] < 0.05 and res.extras["p_prepost"][c, s] < 0.05
        for c, s in excited
    ]
    assert np.mean(hits) > 0.6, (hits, excited)
    tuned = {(g["cell"], names.index(g["behavior"])) for g in gt["social_cells"]}
    fp = []
    for c in gt["untuned_cells"]:
        for s in range(len(names)):
            if np.isfinite(sh.p_value[c, s]):
                fp.append(sh.p_value[c, s] < 0.05)
    assert tuned and np.mean(fp) < 0.12, np.mean(fp)


def test_plots_save_png(planted, planted_result, tmp_path):
    res, _ = planted_result
    fig = plot_peth(res, planted, cells=range(20), states=["sniff", 1], ncols=2, sort_by="peak")
    fig.savefig(tmp_path / "peth.png")
    fig2 = plot_peth(res, planted)
    fig2.savefig(tmp_path / "peth_all.png")
    cell = planted.meta["ground_truth"]["social_cells"][0]["cell"]
    fig3 = plot_event_raster(planted, res, cell, "sniff", mask=planted.masks["social_scored"])
    fig3.savefig(tmp_path / "raster.png")
    assert (tmp_path / "peth.png").stat().st_size > 1000
    assert (tmp_path / "raster.png").stat().st_size > 1000
    with pytest.raises(ValueError):
        plot_peth(res, planted, sort_by="bogus")


# --------------------------------------------------------------------------- #
# per-bin null band and latency
# --------------------------------------------------------------------------- #


def _band_data(n=3000, onset_lag=5, seed=0):
    """Cell 0 responds ``onset_lag`` frames after each event onset; cell 1 is flat noise."""
    rng = np.random.default_rng(seed)
    onsets = np.arange(100, n - 100, 200)
    oh = np.zeros((n, 1), bool)
    x = rng.normal(0.0, 0.3, (2, n))
    for o in onsets:
        oh[o : o + 10, 0] = True
        x[0, o + onset_lag : o + onset_lag + 15] += 4.0
    return x, _states(oh)


BAND = dict(pre_s=2.0, post_s=3.0, baseline_s=(-2.0, 0.0), response_s=(0.0, 2.0), min_shift_s=10.0)


def test_null_band_extras_shapes_and_latency():
    x, st = _band_data()
    mask = np.ones(x.shape[1], bool)
    off = PETH(**BAND).extras(x, st, mask, FS)
    on = PETH(**BAND, null_band=True, n_null=100).extras(x, st, mask, FS)
    assert set(on) - set(off) == {"peth_null_lo", "peth_null_hi", "peth_null_mean", "latency_s"}
    assert set(off) == {"peth", "peth_sem", "time_s", "n_events", "p_prepost"}
    for k in off:
        np.testing.assert_array_equal(on[k], off[k])
    assert on["peth_null_lo"].shape == on["peth"].shape == (2, 1, 50)
    assert on["latency_s"].shape == (2, 1)
    assert (on["peth_null_lo"] <= on["peth_null_mean"]).all()
    assert (on["peth_null_mean"] <= on["peth_null_hi"]).all()
    # planted response begins at 0.5 s
    assert on["latency_s"][0, 0] == pytest.approx(0.5, abs=0.2)
    assert np.isnan(on["latency_s"][1, 0])
    # the observed flat cell stays mostly inside its band
    inside = (on["peth"][1, 0] >= on["peth_null_lo"][1, 0]) & (
        on["peth"][1, 0] <= on["peth_null_hi"][1, 0]
    )
    assert inside.mean() > 0.8


def test_null_band_matches_explicit_shift_and_is_deterministic():
    from cabana._nulls import draw_shifts

    x, st = _band_data()
    mask = np.ones(x.shape[1], bool)
    m = PETH(**BAND, null_band=True, n_null=20, null_seed=3, bin_s=0.5)
    a = m.extras(x, st, mask, FS)
    b = m.extras(x, st, mask, FS)
    np.testing.assert_array_equal(a["peth_null_lo"], b["peth_null_lo"])
    shifts = draw_shifts(x.shape[1], 20, 100, np.random.default_rng(3))
    base = PETH(**BAND, bin_s=0.5)
    ref = np.stack([base.extras(np.roll(x, int(k), axis=1), st, mask, FS)["peth"] for k in shifts])
    np.testing.assert_allclose(a["peth_null_mean"], ref.mean(axis=0), atol=1e-10)
    np.testing.assert_allclose(a["peth_null_hi"], np.percentile(ref, 97.5, axis=0), atol=1e-10)
