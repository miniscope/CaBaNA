"""Label kernel, place_fields and tuning_selectivity."""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")

import numpy as np  # noqa: E402
import pytest  # noqa: E402
from matplotlib.figure import Figure  # noqa: E402

import cabana  # noqa: E402
import cabana._metrics._fields  # noqa: E402, F401  (registers the metrics)
from cabana._kernels._label import component_stats, label_components  # noqa: E402
from cabana._metrics._fields import PlaceFields, TuningSelectivity  # noqa: E402
from cabana._models import GridTopology, StateSpace  # noqa: E402

GOLD = Path(__file__).parents[1] / "golden" / "kernels"


# ---- label kernel -----------------------------------------------------------
def test_label_diagonal_blobs():
    m = np.array([[1, 1, 0, 0], [1, 1, 0, 0], [0, 0, 1, 1], [0, 0, 1, 1]], bool)
    assert label_components(m, 1)[1] == 2
    lab, n = label_components(m, 2)
    assert n == 1 and set(np.unique(lab)) == {0, 1}


def test_label_3d_and_edges():
    m = np.zeros((3, 3, 3), bool)
    m[0, 0, 0] = m[1, 1, 1] = True  # body diagonal
    assert label_components(m, 1)[1] == 2
    assert label_components(m, 2)[1] == 1
    m[2, 2, 2] = True
    lab, n = label_components(m, 1)
    assert n == 3 and lab.dtype == np.int32
    assert [lab[0, 0, 0], lab[1, 1, 1], lab[2, 2, 2]] == [1, 2, 3]


def test_label_empty_full_1d():
    lab, n = label_components(np.zeros((4, 5), bool))
    assert n == 0 and not lab.any()
    lab, n = label_components(np.ones((4, 5), bool))
    assert n == 1 and (lab == 1).all()
    lab, n = label_components(np.array([1, 1, 0, 1, 0, 1], bool))
    assert n == 3 and lab.tolist() == [1, 1, 0, 2, 0, 3]


def test_component_stats_block():
    m = np.zeros((6, 6), bool)
    m[1:4, 2:5] = True
    lab, _ = label_components(m)
    vals = np.arange(36.0).reshape(6, 6)
    size, cen, peak = component_stats(lab, vals)
    assert size.tolist() == [9]
    np.testing.assert_allclose(cen, [[2.0, 3.0]])
    assert peak.tolist() == [3 * 6 + 4]
    # weights shift the centroid
    _, cen_w, _ = component_stats(lab, vals, np.where(lab > 0, vals, 0.0))
    assert cen_w[0, 0] > 2.0


def test_label_golden_roundtrip():
    with np.load(GOLD / "label.npz", allow_pickle=False) as z:
        g = {k: z[k] for k in z.files}
    for tag in ("2d", "3d"):
        for c in (1, 2):
            lab, n = label_components(g[f"in_mask_{tag}"], c)
            np.testing.assert_array_equal(lab, g[f"out_labels_{tag}_c{c}"])
            assert n == int(g[f"out_n_{tag}_c{c}"])
            v = g[f"in_values_{tag}"]
            size, cen, peak = component_stats(lab, v, v)
            np.testing.assert_array_equal(size, g[f"out_size_{tag}_c{c}"])
            np.testing.assert_array_equal(peak, g[f"out_peak_{tag}_c{c}"])
            np.testing.assert_allclose(cen, g[f"out_centroid_{tag}_c{c}"], rtol=1e-12)


# ---- place_fields on the simulated session ----------------------------------
def _inputs(session, name="position"):
    st = session.states[name]
    return session.activity, st, np.ones(session.activity.shape[1], bool), session.fs


def test_place_fields_recovery(sim_session):
    act, st, mask, fs = _inputs(sim_session)
    gt = sim_session.meta["ground_truth"]
    pc = np.array(gt["place_cells"])
    centers = np.array(gt["field_centers_mm"])
    m = PlaceFields()
    ex = m.extras(act, st, mask, fs)
    nf = ex["n_fields"]
    frac = float((nf[pc] >= 1).mean())
    assert frac >= 0.8
    cell_ok = nf[pc] >= 1
    err_mm = np.linalg.norm(ex["centroid"][pc][cell_ok] - centers[cell_ok], axis=1)
    bin_mm = float(np.diff(st.topology.edges[0])[0])
    assert np.median(err_mm) <= 1.5 * bin_mm
    assert (ex["in_out_ratio"][pc][cell_ok] > 1).all()
    np.testing.assert_allclose(m.compute(act, st, mask, fs), ex["in_out_ratio"], equal_nan=True)
    assert ex["rate_map"].shape == ex["field_labels"].shape == (act.shape[0], st.n_states)
    assert ex["field_labels"].dtype == np.int32 and ex["centroid"].shape == (act.shape[0], 2)
    assert ex["bin_area"].shape == (st.n_states,)


def test_place_fields_untuned_false_rate(sim_session):
    act, st, mask, fs = _inputs(sim_session)
    un = np.array(sim_session.meta["ground_truth"]["untuned_cells"])
    nf = PlaceFields(
        threshold_mode="mean_sd", threshold=2.0, min_field_bins=3, statistic="n_fields"
    ).compute(act, st, mask, fs)
    assert (nf[un] == 0).mean() > 0.7


@pytest.mark.parametrize("stat", ["in_out_ratio", "n_fields", "field_area", "peak_rate"])
@pytest.mark.parametrize("min_bins", [1, 2])
def test_place_fields_shifted_matches_loop(sim_session, stat, min_bins):
    act, st, mask, fs = _inputs(sim_session)
    m = PlaceFields(statistic=stat, min_field_bins=min_bins)
    shifts = np.array([0, 700, -1500])
    got = m.compute_shifted(act, st, mask, fs, shifts)
    want = np.stack([m.compute(np.roll(act, int(k), axis=1), st, mask, fs) for k in shifts])
    assert got.shape == (3, act.shape[0])
    np.testing.assert_allclose(got, want, rtol=1e-9, equal_nan=True)


def test_place_fields_hand_map_modes():
    shape = (6, 6)
    topo = GridTopology(
        shape=shape, edges=[np.arange(7) * 2.0, np.arange(7) * 2.0], axis_names=["x", "y"]
    )
    n_t = 36 * 10
    labels = np.repeat(np.arange(36), 10)
    st = StateSpace(
        name="g",
        onehot=np.eye(36, dtype=bool)[labels],
        state_names=[str(i) for i in range(36)],
        kind="grid",
        exclusive=True,
        topology=topo,
    )
    rate = np.full(36, 0.1)
    for ix, iy in [(1, 1), (1, 2), (2, 1), (2, 2)]:
        rate[ix * 6 + iy] = 5.0
    rate[4 * 6 + 4] = 5.0  # singleton: dropped by min_field_bins=2
    act = (rate[labels] * 1.0)[None, :]
    m = PlaceFields(smooth_sigma_bins=0, min_occupancy_s=0, min_field_bins=2)
    ex = m.extras(act, st, np.ones(n_t, bool), 1.0)
    assert ex["n_fields"][0] == 1
    assert ex["field_area"][0] == pytest.approx(4 * 4.0)  # 2x2 bins of 2 x 2 units
    np.testing.assert_allclose(ex["centroid"][0], [4.0, 4.0])  # bins 1-2 of width 2: centres 3, 5
    assert ex["field_labels"][0, 4 * 6 + 4] == 0
    assert ex["in_out_ratio"][0] > 10
    one = PlaceFields(smooth_sigma_bins=0, min_occupancy_s=0, min_field_bins=1)
    assert one.extras(act, st, np.ones(n_t, bool), 1.0)["n_fields"][0] == 2
    ab = PlaceFields(
        smooth_sigma_bins=0, min_occupancy_s=0, threshold_mode="absolute", threshold=6.0
    )
    assert ab.extras(act, st, np.ones(n_t, bool), 1.0)["n_fields"][0] == 0


def test_place_fields_needs_topology(sim_session):
    act, _, mask, fs = _inputs(sim_session)
    with pytest.raises(ValueError, match="grid topology"):
        PlaceFields().compute(act, sim_session.states["syllables"], mask, fs)


# ---- tuning_selectivity -----------------------------------------------------
def _cat_session(n_states=5, per=100):
    labels = np.repeat(np.arange(n_states), per)
    st = StateSpace(
        name="c",
        onehot=np.eye(n_states, dtype=bool)[labels],
        state_names=[str(i) for i in range(n_states)],
        kind="categorical",
        exclusive=True,
    )
    act = np.zeros((3, labels.size))
    act[0, labels == 2] = 1.0  # selective
    act[1] = 1.0  # flat
    return act, st, np.ones(labels.size, bool)


def test_tuning_selectivity_synthetic():
    act, st, mask = _cat_session()
    fs = 10.0
    ex = TuningSelectivity().extras(act, st, mask, fs)
    # selective: r = [0,0,10,0,0], mean 2 -> (10-2)/(10+2)
    assert ex["selectivity_index"][0] == pytest.approx(8 / 12)
    assert ex["sparseness"][0] == pytest.approx(1 - 1 / 5)  # 1 - 1/n for a single state
    assert ex["depth"][0] == pytest.approx(1.0)
    assert ex["preferred_state"][0] == 2
    assert ex["selectivity_index"][1] == pytest.approx(0.0)
    assert ex["sparseness"][1] == pytest.approx(0.0)
    assert np.isnan(ex["selectivity_index"][2]) and ex["preferred_state"][2] in (-1, 0)
    # one-state-only response with many states approaches SI -> 1
    act2, st2, mask2 = _cat_session(n_states=200, per=20)
    si = TuningSelectivity().compute(act2, st2, mask2, fs)
    assert si[0] > 0.98


@pytest.mark.parametrize("stat", ["selectivity_index", "sparseness", "depth"])
def test_tuning_selectivity_shifted_matches_loop(sim_session, stat):
    act, _, mask, fs = _inputs(sim_session)
    st = sim_session.states["syllables"]
    m = TuningSelectivity(statistic=stat)
    shifts = np.array([5, 900, -333])
    got = m.compute_shifted(act, st, mask, fs, shifts)
    want = np.stack([m.compute(np.roll(act, int(k), axis=1), st, mask, fs) for k in shifts])
    np.testing.assert_allclose(got, want, rtol=1e-10, equal_nan=True)


def test_tuning_selectivity_smoothing_needs_topology(sim_session):
    act, _, mask, fs = _inputs(sim_session)
    with pytest.raises(ValueError, match="GridTopology"):
        TuningSelectivity(smooth_sigma_bins=1.0).compute(
            act, sim_session.states["syllables"], mask, fs
        )
    TuningSelectivity(smooth_sigma_bins=1.0).compute(act, sim_session.states["position"], mask, fs)


def test_tuning_selectivity_planted_place_cells(sim_session):
    act, st, mask, fs = _inputs(sim_session)
    si = TuningSelectivity(smooth_sigma_bins=1.0).compute(act, st, mask, fs)
    pc = sim_session.meta["ground_truth"]["place_cells"]
    un = sim_session.meta["ground_truth"]["untuned_cells"]
    assert np.nanmedian(si[pc]) > np.nanmedian(si[un])


# ---- plugin conformance and pipeline ----------------------------------------
@pytest.mark.parametrize("cls", [PlaceFields, TuningSelectivity])
def test_check_plugin(cls, small_session):
    report = cabana.check_plugin(cls(), small_session, target="position")
    assert report.passed, str(report)


def test_pipeline_plot(small_session):
    ana = cabana.Pipeline(
        analyses=[
            cabana.AnalysisSpec(
                metric={"name": "place_fields"},
                states="position",
                masks=["position_covered"],
                shuffle=cabana.ShuffleConfig(n_shuffles=10, seed=0),
            )
        ]
    )
    sess, rs = ana.run(small_session)
    fig = rs.get("place_fields", "position").plot(sess)
    assert isinstance(fig, Figure)


def test_place_fields_untestable_cell_is_nan(sim_session):
    act, st, mask, fs = _inputs(sim_session)
    bad = act.copy()
    bad[3, 100] = np.nan
    for stat in ("in_out_ratio", "n_fields", "field_area", "peak_rate"):
        for mb in (1, 2):
            m = PlaceFields(statistic=stat, min_field_bins=mb)
            assert np.isnan(m.compute(bad, st, mask, fs)[3])
            assert np.isfinite(m.compute(bad, st, mask, fs)[4])
            sh = m.compute_shifted(bad, st, mask, fs, np.array([10, 20]))
            assert np.isnan(sh[:, 3]).all() and np.isfinite(sh[:, 4]).all()
    ex = PlaceFields().extras(bad, st, mask, fs)
    for k in ("n_fields", "field_area", "in_out_ratio", "peak_rate"):
        assert np.isnan(ex[k][3]) and np.isfinite(ex[k][4])


def test_tuning_selectivity_negative_and_few_states():
    act, st, mask = _cat_session()
    with pytest.raises(ValueError, match="non-negative"):
        TuningSelectivity().compute(act - 0.5, st, mask, 10.0)
    # only one valid state (min_occupancy excludes the rest): NaN, not 0
    m = TuningSelectivity(min_occupancy_s=10.0)
    st1, mask1 = st, mask.copy()
    mask1[100:] = False  # state 0 keeps 100 frames = 10 s, others empty
    assert np.isnan(m.compute(act, st1, mask1, 10.0)).all()
