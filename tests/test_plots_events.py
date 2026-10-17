import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pytest  # noqa: E402
from matplotlib.figure import Figure  # noqa: E402

import cabana  # noqa: E402
from cabana import _plots_events as pe  # noqa: E402
from cabana import plots  # noqa: E402
from cabana._metrics._events import PETH  # noqa: E402
from cabana._registry import _REGISTRY  # noqa: E402
from cabana._results import MetricResult  # noqa: E402
from cabana._shuffle import ShuffleConfig, shuffle_test  # noqa: E402
from cabana import build  # noqa: E402


def _synthetic(with_sem=True):
    """4 cells x 2 states; state 0 cells peak (inside the response window) at known times."""
    t = np.round(np.arange(-2.0, 3.0, 0.1), 6)
    peaks = np.array([1.5, 0.3, 1.0, 0.7])  # cell -> peak time in state 0
    amp = np.array([1.0, 2.0, 4.0, 3.0])
    arr = np.full((4, 2, t.size), np.nan)
    for c in range(4):
        arr[c, 0] = amp[c] * np.exp(-((t - peaks[c]) ** 2) / 0.02)
    arr[:, 1] = np.nan  # state 1: too few events
    extras = {"peth": arr, "time_s": t, "n_events": np.array([10, 1])}
    if with_sem:
        extras["peth_sem"] = np.where(np.isfinite(arr), 0.1, np.nan)
    params = PETH(pre_s=2.0, post_s=3.0, baseline_s=(-2.0, 0.0), response_s=(0.0, 2.0)).to_dict()
    values = np.full((4, 2), np.nan)
    values[:, 0] = amp
    return MetricResult(
        metric="peth",
        target="s",
        level="cell",
        values=values,
        params=params,
        extras=extras,
        cell_ids=["a", "b", "c", "d"],
        state_names=["x", "y"],
    ), peaks


def test_latency_sort_order():
    res, peaks = _synthetic()
    d = pe.plot_peth_data(res, None, sort_by="latency")
    plots.check_plot_data(d, "peth")
    np.testing.assert_array_equal(d["order"][0], np.argsort(peaks))
    np.testing.assert_allclose(d["latency_s"][0], np.sort(peaks), atol=1e-9)
    assert d["cell_ids_sorted"][0] == ["b", "d", "c", "a"]
    assert not d["valid"][1] and np.isnan(d["peth"][1]).all()
    d = pe.plot_peth_data(res, None, sort_by="response")
    np.testing.assert_array_equal(d["order"][0], [2, 3, 1, 0])
    d = pe.plot_peth_data(res, None, sort_by="peak")
    np.testing.assert_array_equal(d["order"][0], np.argsort(peaks))
    assert d["units"] == "response (a.u.)"
    with pytest.raises(ValueError):
        pe.plot_peth_data(res, None, sort_by="bogus")


def test_peth_sem_band_and_colorbar():
    res, _ = _synthetic(with_sem=True)
    d = pe.plot_peth_data(res, None, states=[0])
    assert d["sem"] is not None and np.isfinite(d["mean_sem"]).all()
    # sqrt(4 * 0.1^2) / 4
    np.testing.assert_allclose(d["mean_sem"][0], 0.05)
    fig = pe.plot_peth(
        res,
        cabana.simulate_session(duration_s=30, n_cells=4, seed=0),
        states=[0],
        sort_by="latency",
    )
    n_band = sum(len(a.collections) for a in fig.axes)
    assert n_band >= 1  # the SEM band
    assert len(fig.axes) == 3  # heatmap, trace, colourbar
    assert fig.axes[-1].get_ylabel() == "response (a.u.)"
    plt.close(fig)
    res2, _ = _synthetic(with_sem=False)
    d2 = pe.plot_peth_data(res2, None)
    assert d2["sem"] is None and d2["mean_sem"] is None
    plots.check_plot_data(d2, "peth")


@pytest.fixture(scope="module")
def planted():
    s = cabana.simulate_session(duration_s=600, n_cells=20, seed=0)
    s = build("transform", {"name": "resample_signal", "source": "position"}).apply(s)
    return build("transform", {"name": "bouts_to_states", "source": "social"}).apply(s)


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
    sh = shuffle_test(
        metric, s.activity, s.states["social"], mask, ShuffleConfig(n_shuffles=50, seed=0), s.fs
    )
    return MetricResult(
        metric="peth",
        target="social",
        level="cell",
        values=sh.observed,
        shuffle=sh,
        params=metric.to_dict(),
        extras=metric.extras(s.activity, s.states["social"], mask, s.fs),
        cell_ids=s.cell_ids,
        state_names=s.states["social"].state_names,
    )


def test_event_raster_data(planted, planted_result):
    mask = planted.masks["social_scored"]
    d = pe.plot_event_raster_data(planted, planted_result, 0, "sniff", mask=mask)
    plots.check_plot_data(d, "event_raster")
    assert d["windows"].shape == (d["n_events"], d["time_s"].size)
    fig = plots.plot_event_raster(planted, planted_result, 0, "sniff", mask=mask)
    assert isinstance(fig, Figure)
    plt.close(fig)


def test_registry_wiring(monkeypatch, planted, planted_result):
    cls = _REGISTRY["metric"]["peth"]
    monkeypatch.setattr(cls, "default_plots", ("peth", "event_raster"), raising=False)
    names = plots.plots_for(planted_result, planted)
    assert names == ["peth", "event_raster"]
    assert plots.plots_for(planted_result) == []  # both need a session
    for kind in names:
        fig = plots.plot(planted_result, planted, kind)
        assert isinstance(fig, Figure)
        plt.close(fig)
    fig = plots.plot(planted_result, planted, "peth", sort_by="latency")
    plt.close(fig)
