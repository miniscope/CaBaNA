import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402

import cabana.plots  # noqa: E402,F401
from cabana import _plots_views as V  # noqa: E402
from cabana._models import GridTopology, Session, StateSpace  # noqa: E402
from cabana._plot_data import check_plot_data  # noqa: E402
from cabana._plot_registry import available_plots, plot  # noqa: E402
from cabana._results import MetricResult, ResultSet, ShuffleResult  # noqa: E402


@pytest.fixture(autouse=True)
def _close():
    yield
    plt.close("all")


def _shuffle(p, correction="none", p_adj=None, alpha=0.05):
    p = np.asarray(p, float)
    pa = p if p_adj is None else np.asarray(p_adj, float)
    return ShuffleResult(
        observed=np.zeros_like(p),
        null=None,
        shifts=None,
        p_value=p,
        null_lo=np.zeros_like(p),
        null_hi=np.ones_like(p),
        significant=p < alpha,
        p_adj=pa,
        significant_adj=pa < alpha,
        correction=correction,
        alpha=alpha,
        tail="upper",
        n_shuffles=100,
    )


def _result(p, name, **kw):
    p = np.asarray(p, float)
    return MetricResult(
        metric="mean_per_state",
        target="x",
        level="cell",
        values=np.zeros_like(p),
        shuffle=_shuffle(p, **kw),
        name=name,
    )


def test_raster_data_and_ribbon(small_session):
    d = V.plot_activity_raster_data(small_session, max_cells=10, sort_by="peak")
    check_plot_data(d, "activity_raster")
    assert d["activity"].shape == (10, small_session.n_time)
    assert 1 <= len(d["ribbon"]) <= 3
    for r in d["ribbon"]:
        sp = small_session.states[r["name"]]
        if sp.exclusive:
            np.testing.assert_array_equal(r["labels"], sp.labels())
        assert sp.kind != "grid"
    assert d["vmax"] > d["vmin"]
    fig = V.plot_activity_raster(small_session, max_cells=10, t_range=(10, 60))
    assert fig.axes


def test_raster_sort_by_result_and_masks(small_session):
    n = small_session.n_cells
    vals = np.arange(n, dtype=float)
    r = MetricResult(metric="m", target="x", level="cell", values=vals)
    s = small_session.with_mask("m1", np.arange(small_session.n_time) % 7 != 0)
    d = V.plot_activity_raster_data(s, sort_by=r, max_cells=5)
    assert d["cell_index"].tolist() == [n - 1, n - 2, n - 3, n - 4, n - 5]
    assert "m1" in [m["name"] for m in d["masks"]]
    check_plot_data(d, "activity_raster")
    V.plot_activity_raster(s, sort_by=r, max_cells=5)


def _tuning_result(n=8, ns=6, sig=None):
    rng = np.random.default_rng(1)
    peaks = rng.permutation(n) % ns
    rm = rng.random((n, ns)) * 0.1
    rm[np.arange(n), peaks] = 5.0 + np.arange(n)  # scaled so normalisation matters
    sh = _shuffle(np.where(np.arange(n) < 3, 0.001, 0.5))
    return (
        MetricResult(
            metric="information_content",
            target="x",
            level="cell",
            values=np.zeros(n),
            shuffle=sh,
            extras={"rate_map": rm},
            state_names=[f"s{i}" for i in range(ns)],
        ),
        peaks,
    )


def test_population_tuning_sorting_and_normalisation():
    res, peaks = _tuning_result()
    d = V.plot_population_tuning_data(res)
    check_plot_data(d, "population_tuning")
    assert d["normalized"]
    np.testing.assert_allclose(np.nanmax(d["matrix"], axis=1), 1.0)
    np.testing.assert_allclose(np.nanmin(d["matrix"], axis=1), 0.0)
    got = d["matrix"].argmax(axis=1)
    assert np.all(np.diff(got) >= 0)
    np.testing.assert_array_equal(got, np.sort(peaks))
    np.testing.assert_array_equal(peaks[d["order"]], got)
    assert d["significant"].sum() == 3
    raw = V.plot_population_tuning_data(res, normalize=False)
    assert np.nanmax(raw["matrix"]) > 1
    fig = V.plot_population_tuning(res)
    assert fig.axes


def test_population_tuning_values_2d_and_error():
    v = np.random.default_rng(0).random((5, 4))
    r = MetricResult(metric="mean_per_state", target="x", level="cell", values=v)
    assert V._applies(r)
    check_plot_data(V.plot_population_tuning_data(r), "population_tuning")
    bad = MetricResult(metric="auroc", target="x", level="cell", values=np.zeros(5))
    assert not V._applies(bad)
    with pytest.raises(ValueError, match="rate_map"):
        V.plot_population_tuning_data(bad)


def test_population_tuning_1d_grid_and_registry(small_session):
    assert "population_tuning" in available_plots()
    n, ns = 5, 4
    topo = GridTopology(shape=(ns,), edges=[np.linspace(0, 40, ns + 1)], axis_names=["x"])
    sp = StateSpace(
        name="track",
        onehot=np.eye(ns, dtype=bool)[np.arange(60) % ns],
        state_names=[f"b{i}" for i in range(ns)],
        kind="grid",
        exclusive=True,
        topology=topo,
    )
    s = Session(activity=np.zeros((n, 60)), t=np.arange(60) / 10.0, fs=10.0, states={"track": sp})
    r = MetricResult(
        metric="mean_per_state",
        target="track",
        level="cell",
        values=np.random.default_rng(0).random((n, ns)),
    )
    d = V.plot_population_tuning_data(r, s)
    np.testing.assert_allclose(d["x"], [5, 15, 25, 35])
    assert d["x_label"] == "x"
    fig = plot(r, s, "population_tuning")
    assert fig.axes


def test_session_qa_simulated(small_session):
    d = V.plot_session_qa_data(small_session)
    check_plot_data(d, "session_qa")
    assert d["occupancy"] is not None and d["occupancy"]["image"] is not None
    assert d["bouts"] is not None
    assert d["timing"] is not None
    fig = V.plot_session_qa(small_session)
    assert len(fig.axes) >= 6


def test_session_qa_with_masks():
    s = Session(
        activity=np.zeros((3, 100)),
        t=np.arange(100) / 10.0,
        fs=10.0,
        masks={"a": np.arange(100) < 80, "b": np.arange(100) % 2 == 0},
        cell_meta={"snr": np.array([1.0, 2.0, 3.0])},
    )
    d = V.plot_session_qa_data(s)
    check_plot_data(d, "session_qa")
    np.testing.assert_allclose(d["masks"]["excluded_fraction"], [0.2, 0.5])
    assert d["masks"]["kept_after_all"] == pytest.approx(0.4)
    assert d["cells"]["name"] == "snr"
    V.plot_session_qa(s)


def test_session_qa_bare_session():
    s = Session(activity=np.zeros((2, 50)), t=np.arange(50) / 10.0, fs=10.0)
    d = V.plot_session_qa_data(s)
    check_plot_data(d, "session_qa")
    assert d["occupancy"] is None and d["masks"] is None and d["cells"] is None
    assert d["notes"]
    fig = V.plot_session_qa(s)
    assert fig.axes
    r = V.plot_activity_raster(s)
    assert r.axes


def test_agreement_jaccard_hand_computed():
    pa = np.array([0.01, 0.01, 0.01, 0.9, 0.9, 0.9])
    pb = np.array([0.9, 0.01, 0.01, 0.01, 0.9, 0.9])
    rs = ResultSet(results=[_result(pa, "A"), _result(pb, "B")])
    d = V.plot_analysis_agreement_data(rs)
    check_plot_data(d, "analysis_agreement")
    # A = {0,1,2}, B = {1,2,3}: |inter|=2, |union|=4
    np.testing.assert_allclose(d["jaccard"], [[1, 0.5], [0.5, 1]])
    assert d["sets"].shape == (6, 2)
    assert d["analysis_names"] == ["A", "B"]
    pats = {tuple(i["pattern"]): i["count"] for i in d["intersections"]}
    assert pats == {(True, True): 2, (True, False): 1, (False, True): 1}
    assert np.isfinite(d["neglog10_p"]).all()
    for kind in ("jaccard", "upset", "pgrid"):
        assert V.plot_analysis_agreement(rs, kind=kind).axes
    with pytest.raises(ValueError):
        V.plot_analysis_agreement(rs, kind="nope")


def test_agreement_adjusted_default_and_override():
    p = np.array([0.01, 0.01, 0.9])
    padj = np.array([0.2, 0.01, 0.9])
    r = _result(p, "A", correction="bh", p_adj=padj)
    d = V.plot_analysis_agreement_data([r])
    assert d["sets"][:, 0].tolist() == [False, True, False]
    d2 = V.plot_analysis_agreement_data([r], adjusted=False)
    assert d2["sets"][:, 0].tolist() == [True, True, False]


def test_agreement_per_state_p_and_empty():
    p = np.array([[0.9, 0.01], [0.9, 0.9]])
    r = _result(p, "A")
    d = V.plot_analysis_agreement_data([r])
    assert d["sets"][:, 0].tolist() == [True, False]
    assert np.isnan(d["jaccard"][0, 0]) is np.False_
    e = V.plot_analysis_agreement_data([_result(np.array([0.9, 0.9]), "E")])
    assert np.isnan(e["jaccard"][0, 0]) and e["intersections"] == []
    V.plot_analysis_agreement([_result(np.array([0.9, 0.9]), "E")], kind="upset")
    with pytest.raises(ValueError):
        V.plot_analysis_agreement_data([])
