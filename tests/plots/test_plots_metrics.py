import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402

import cabana._plots._metrics as PM  # noqa: E402,F401  (registers the plots)
from cabana import AnalysisSpec, Pipeline, ShuffleConfig  # noqa: E402
from cabana._plots._data import check_plot_data  # noqa: E402
from cabana._plots._registry import plot, plot_all, plots_for  # noqa: E402
from cabana._results import MetricResult, ShuffleResult  # noqa: E402


@pytest.fixture(autouse=True)
def _close():
    yield
    plt.close("all")


@pytest.fixture(scope="module")
def run(sim_session):
    rng = np.random.default_rng(0)
    n = sim_session.n_time
    hd = np.mod(np.cumsum(rng.normal(0, 12, n)), 360.0)
    sess = sim_session.replace(signals={**sim_session.signals, "hd": hd})
    cfg = ShuffleConfig(n_shuffles=10, seed=0)
    cell_shift = ShuffleConfig(n_shuffles=10, null={"name": "cell_shift"}, seed=0)
    pipe = Pipeline(
        analyses=[
            AnalysisSpec(metric={"name": "place_fields"}, states="position", shuffle=cfg),
            AnalysisSpec(metric={"name": "circular_tuning"}, signal="hd", shuffle=cfg),
            AnalysisSpec(metric={"name": "decode_signal"}, signal="x", shuffle=cfg, masks=[]),
            AnalysisSpec(
                metric={"name": "pairwise_correlation"}, states="syllables", shuffle=cell_shift
            ),
            AnalysisSpec(
                metric={"name": "participation_ratio"}, states="syllables", shuffle=cell_shift
            ),
        ]
    )
    _, rs = pipe.run(sess)
    return sess, rs


def _r(rs, metric):
    return next(r for r in rs.results if r.metric == metric)


def test_defaults_lead_with_new_plots(run):
    sess, rs = run
    for metric, name in [
        ("place_fields", "place_fields"),
        ("circular_tuning", "circular_tuning"),
        ("decode_signal", "decode_signal"),
        ("pairwise_correlation", "pairwise_matrix"),
        ("participation_ratio", "participation_ratio"),
    ]:
        assert plots_for(_r(rs, metric), sess)[0] == name


def test_data_contract_and_render(run):
    sess, rs = run
    pf, ct, ds = _r(rs, "place_fields"), _r(rs, "circular_tuning"), _r(rs, "decode_signal")
    pw, pr = _r(rs, "pairwise_correlation"), _r(rs, "participation_ratio")
    check_plot_data(PM.plot_place_fields_data(sess, pf), "place_fields")
    check_plot_data(PM.plot_circular_tuning_data(ct), "circular_tuning")
    check_plot_data(PM.plot_decode_signal_data(ds, sess), "decode_signal")
    check_plot_data(PM.plot_pairwise_matrix_data(pw), "pairwise_matrix")
    check_plot_data(PM.plot_participation_ratio_data(pr), "participation_ratio")
    for r in (pf, ct, ds, pw, pr):
        assert isinstance(r.plot(sess), plt.Figure)


def test_plot_all_includes_new_plots(run):
    sess, rs = run
    figs = plot_all(rs, sess)
    keys = set(figs)
    for metric, name in [
        ("place_fields", "place_fields"),
        ("circular_tuning", "circular_tuning"),
        ("decode_signal", "decode_signal"),
        ("pairwise_correlation", "pairwise_matrix"),
        ("participation_ratio", "participation_ratio"),
    ]:
        assert f"{_r(rs, metric).name}/{name}" in keys


def test_place_field_outline_for_planted_cell(run):
    sess, rs = run
    pf = _r(rs, "place_fields")
    nf = np.asarray(pf.extras["n_fields"])
    cell = int(np.argmax(nf > 0))
    assert nf[cell] > 0
    fig = plot(pf, sess, "place_fields", cells=[cell])
    ax = fig.axes[0]
    assert sum(c.get_gid() == "field_outline" for c in ax.collections) > 0
    d = PM.plot_place_fields_data(sess, pf, cells=[cell])
    assert (d["field_labels"][0] > 0).any() and d["field_labels"].shape == d["rate_maps"].shape
    assert d["centroids"].shape == (1, 2) and np.isfinite(d["centroids"]).all()
    assert "field" in d["titles"][0]
    fig2 = PM.plot_place_fields(pf, sess, cells=[cell], show_centroid=False)  # either order
    assert fig2 is not None


def test_place_fields_paging(run):
    sess, rs = run
    pf = _r(rs, "place_fields")
    d = PM.plot_place_fields_data(sess, pf, cells=list(range(10)), max_cells=4, page=2)
    assert len(d["cells"]) == 2 and d["paging"]["n_pages"] == 3


def test_circular_polar_vs_linear(run):
    sess, rs = run
    ct = _r(rs, "circular_tuning")
    fp = PM.plot_circular_tuning(ct, cells=[0, 1], polar=True)
    fl = PM.plot_circular_tuning(ct, cells=[0, 1], polar=False)
    assert fp.axes[0].name == "polar" and fl.axes[0].name == "rectilinear"
    assert "deg" in fl.axes[0].get_xlabel() or "deg" in fl.axes[-1].get_xlabel()
    d = PM.plot_circular_tuning_data(ct, cells=[0])
    assert d["units"] == "deg" and np.allclose(d["bin_centers_rad"], np.deg2rad(d["bin_centers"]))


def _hand_tuning(nan_bin=None):
    n_bins = 12
    curve = np.tile(np.linspace(1, 2, n_bins), (2, 1))
    if nan_bin is not None:
        curve[:, nan_bin] = np.nan
    bc = (np.arange(n_bins) + 0.5) * 2 * np.pi / n_bins
    return MetricResult(
        metric="circular_tuning",
        target="hd",
        target_kind="signal",
        level="cell",
        values=np.array([0.3, 0.2]),
        params={"units": "rad", "statistic": "mvl"},
        extras={
            "tuning_curve": curve,
            "bin_centers": bc,
            "preferred_direction": np.array([1.0, 2.0]),
            "mvl": np.array([0.3, 0.2]),
        },
    )


def test_nan_bin_breaks_line():
    r = _hand_tuning(nan_bin=4)
    d = PM.plot_circular_tuning_data(r)
    assert np.isnan(d["tuning_curve"][:, 4]).all()
    check_plot_data(d, "circular_tuning")
    for polar in (True, False):
        fig = PM.plot_circular_tuning(r, polar=polar)
        y = fig.axes[0].lines[0].get_ydata()
        assert np.isnan(np.asarray(y, float)).any()
    assert "rad" in PM.plot_circular_tuning(r, polar=False).axes[0].get_xlabel()


def _hand_pairwise(sig=True):
    rng = np.random.default_rng(1)
    n = 10
    base = np.where(np.arange(n) < 5, 1.0, -1.0)
    m = 0.6 * np.outer(base, base) + 0.05 * rng.normal(size=(n, n))
    m = (m + m.T) / 2
    np.fill_diagonal(m, 1.0)
    sh = None
    if sig:
        p = np.full((n, n), 0.5)
        p[:5, :5] = 0.001
        sh = ShuffleResult(
            observed=m,
            null=None,
            shifts=None,
            p_value=p,
            null_lo=-np.ones((n, n)),
            null_hi=np.ones((n, n)),
            significant=p < 0.05,
            alpha=0.05,
            tail="two",
            n_shuffles=10,
        )
    # interleave the two blocks so ordering has work to do
    perm = np.r_[np.arange(0, n, 2), np.arange(1, n, 2)]
    inv = np.argsort(perm)
    m = m[np.ix_(inv, inv)]
    if sh is not None:
        sh = sh.model_copy(
            update={
                "p_value": sh.p_value[np.ix_(inv, inv)],
                "significant": sh.significant[np.ix_(inv, inv)],
            }
        )
    return MetricResult(
        metric="pairwise_correlation",
        target="s",
        level="population",
        values=m,
        shuffle=sh,
        params={"kind": "total"},
        extras={"mean_offdiag": np.asarray(0.1)},
        state_names=[f"c{i}" for i in range(n)],
    ), inv


def test_pairwise_order_is_permutation_and_groups_blocks():
    r, inv = _hand_pairwise()
    for order in ("cluster", "none", "state"):
        d = PM.plot_pairwise_matrix_data(r, order=order)
        check_plot_data(d, "pairwise_matrix")
        assert sorted(d["order"].tolist()) == list(range(10))
        assert np.isnan(np.diag(d["matrix"])).all()
        assert d["cell_ids"] == [f"c{i}" for i in d["order"]]
    d = PM.plot_pairwise_matrix_data(r, order="cluster")
    block = (inv[d["order"]] < 5).astype(int)  # original block membership along the new order
    assert np.abs(np.diff(block)).sum() <= 1  # the two blocks are contiguous
    assert d["frac_significant"] == pytest.approx(20 / 90)
    assert d["significant"].shape == (10, 10)
    assert PM.plot_pairwise_matrix(r, order="none").axes[0].get_xticklabels()[0].get_text() == "c0"
    with pytest.raises(ValueError):
        PM.plot_pairwise_matrix_data(r, order="bad")


def test_pairwise_without_shuffle_and_many_cells():
    r, _ = _hand_pairwise(sig=False)
    d = PM.plot_pairwise_matrix_data(r)
    assert d["significant"] is None and np.isnan(d["frac_significant"])
    big = r.model_copy(update={"values": np.eye(70), "state_names": None})
    assert PM.plot_pairwise_matrix_data(big)["show_ids"] is False


def test_participation_ratio_data(run):
    _, rs = run
    pr = _r(rs, "participation_ratio")
    d = PM.plot_participation_ratio_data(pr)
    assert d["pr"] == pytest.approx(float(pr.values[0]), rel=1e-6)
    assert np.isfinite(d["null_lo"]) and d["p_text"].startswith("p")
    assert d["variance_explained"][-1] == pytest.approx(1.0)


def test_decode_signal_data(run):
    sess, rs = run
    ds = _r(rs, "decode_signal")
    d = PM.plot_decode_signal_data(ds, sess, t_range=(10.0, 30.0))
    assert d["t"].min() >= 10.0 and d["t"].max() <= 30.0
    assert d["true"].shape == d["prediction"].shape == (len(d["t"]), 1)
    assert d["channel_names"] == ["x"] and d["fold_scores"].shape[1] == 1
    assert d["scatter_true"].shape == d["scatter_prediction"].shape
    assert np.isfinite(d["scatter_prediction"]).all()
