import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import pytest  # noqa: E402
from matplotlib.figure import Figure  # noqa: E402

from cabana import (  # noqa: E402
    AnalysisSpec,
    Pipeline,
    ShuffleConfig,
    SimulationConfig,
    simulate_session,
)
from cabana._plots import _information as pi  # noqa: E402
from cabana import plots  # noqa: E402
from cabana._models import GridTopology, StateSpace  # noqa: E402
from cabana._plots._style import UNVISITED_COLOR  # noqa: E402
from cabana._registry import _REGISTRY  # noqa: E402
from cabana._results import MetricResult  # noqa: E402


@pytest.fixture(scope="module")
def mi_run(small_session):
    prep = small_session
    ana = Pipeline(
        analyses=[
            AnalysisSpec(
                metric={"name": "mutual_information", "n_levels": 3},
                states="position",
                masks=["position_covered"],
                shuffle=ShuffleConfig(n_shuffles=10, seed=0),
            ),
            AnalysisSpec(
                metric={"name": "information_content"},
                states="position",
                masks=["position_covered"],
                shuffle=ShuffleConfig(n_shuffles=10, seed=0),
            ),
        ]
    )
    _, rs = ana.run(prep)
    return prep, rs


def _fake_1d(n_cells=3, n_states=6, n_levels=3):
    rng = np.random.default_rng(1)
    joint = rng.integers(1, 30, (n_cells, n_states, n_levels)).astype(float)
    joint[:, 2, :] = 0
    valid = np.ones(n_states, bool)
    valid[2] = False
    cond = joint / joint.sum(-1, keepdims=True)
    cond[:, 2, :] = np.nan
    edges = np.tile(np.array([0.0, 0.5, 1.0, 3.0]), (n_cells, 1))
    topo = GridTopology(
        shape=(n_states,), edges=[np.linspace(0, 60, n_states + 1)], axis_names=["x"]
    )
    space = StateSpace(
        name="x",
        onehot=np.eye(n_states, dtype=bool)[rng.integers(0, n_states, 50)],
        state_names=[f"b{i}" for i in range(n_states)],
        kind="grid",
        exclusive=True,
        topology=topo,
    )
    res = MetricResult(
        metric="mutual_information",
        target="x",
        level="cell",
        values=rng.random(n_cells),
        state_names=space.state_names,
        extras={
            "joint": joint,
            "conditional": cond,
            "edges": edges,
            "occupancy_s": np.ones(n_states),
            "valid": valid,
        },
    )
    return res, space


@pytest.mark.parametrize("normalize", ["conditional", "joint", "lift"])
def test_joint_histogram_1d(normalize):
    res, space = _fake_1d()
    fig = plots.plot_joint_histogram(res, [0, 1, 2], states=space, normalize=normalize)
    assert isinstance(fig, Figure)
    assert sum(len(a.images) for a in fig.axes) == 3
    assert len(fig.axes) == 4  # 3 panels + colourbar
    plt.close(fig)


def test_joint_histogram_categorical_and_ax():
    res, _ = _fake_1d()
    fig, ax = plt.subplots()
    out = plots.plot_joint_histogram(res, 1, ax=ax)
    assert out is fig and len(ax.images) == 1
    assert ax.get_xticklabels()[0].get_text() == "b0"
    plt.close(fig)
    with pytest.raises(ValueError):
        plots.plot_joint_histogram(res, 0, normalize="bad")


def test_joint_histogram_2d(mi_run):
    prep, rs = mi_run
    res = rs.get("mutual_information", "position")
    fig = plots.plot_joint_histogram(res, [0, 1], states=prep.states["position"], normalize="lift")
    assert sum(len(a.images) for a in fig.axes) == 2 * 3
    plt.close(fig)


def test_information_comparison(mi_run):
    _, rs = mi_run
    a = rs.get("mutual_information", "position")
    b = rs.get("information_content", "position")
    fig = plots.plot_information_comparison(a, b, labels=("MI", "Skaggs"), highlight=[0, 1])
    ax = fig.axes[0]
    assert "Spearman" in ax.get_title()
    assert ax.get_xlabel().startswith("MI")
    assert len(ax.collections) == 5
    plt.close(fig)
    fig = plots.plot_information_comparison(a, a, identity=True)
    assert len(fig.axes[0].lines) == 1
    plt.close(fig)


def test_level_sweep():
    rows = [
        {"n_levels": k, "duration_s": d, "detection": 0.5 + 0.1 * k, "fpr": 0.05, "metric": m}
        for k in (2, 3, 5)
        for d in (300, 900)
        for m in ("mi", "skaggs")
    ]
    fig = plots.plot_level_sweep(pd.DataFrame(rows))
    assert len(fig.axes) == 2
    assert fig.axes[0].get_ylim() == (0, 1.05)
    assert len(fig.axes[0].lines) == 4 and len(fig.axes[1].lines) == 5
    plt.close(fig)
    fig = plots.plot_level_sweep(pd.DataFrame(rows).drop(columns="metric"))
    assert len(fig.axes[0].lines) == 2
    plt.close(fig)
    with pytest.raises(ValueError):
        plots.plot_level_sweep(pd.DataFrame({"n_levels": [2]}))


@pytest.fixture(scope="module")
def decoded_run():
    sess = simulate_session(SimulationConfig(duration_s=300, n_cells=12, seed=0))
    prep = Pipeline(
        transforms=[
            {"name": "resample_signal", "source": "position"},
            {"name": "bin_grid", "signals": ["x", "y"], "bin_size": 100.0, "output": "position"},
        ],
        analyses=[
            AnalysisSpec(
                metric={"name": "bayesian_decoder", "n_folds": 2, "smooth_sigma_bins": 1.0},
                states="position",
            )
        ],
    )
    sess, rs = prep.run(sess)
    return sess, rs.get("bayesian_decoder", "position")


def test_decoded_trajectory(decoded_run):
    sess, res = decoded_run
    fig = plots.plot_decoded_trajectory(res, sess, sess.states["position"])
    # x, y, error CDF, path, accuracy map + 2 colourbars
    assert len(fig.axes) == 7
    from matplotlib.collections import LineCollection

    ax_path = fig.axes[3]
    assert any(isinstance(c, LineCollection) for c in ax_path.collections)
    assert not any(
        c.get_offsets().shape[0]
        for c in ax_path.collections
        if hasattr(c, "get_offsets") and not isinstance(c, LineCollection)
    )
    assert len(fig.axes[0].lines) == 2
    assert "median error" in fig._suptitle.get_text()
    plt.close(fig)
    fig = plots.plot_decoded_trajectory(res, sess, sess.states["position"], t_range=(100, 130))
    plt.close(fig)
    fig = plots.plot_decoded_trajectory(res, sess)  # states default to session.states[target]
    plt.close(fig)
    with pytest.raises(ValueError):
        plots.plot_decoded_trajectory(res, sess, sess.states["position"], ax=object())


def test_decoded_trajectory_data_2d(decoded_run):
    sess, res = decoded_run
    topo = sess.states["position"].topology
    d = pi.plot_decoded_trajectory_data(res, sess, t_range=(100, 130))
    plots.check_plot_data(d, "decoded_trajectory")
    n = d["time_s"].size
    assert d["true"].shape == d["decoded"].shape == (2, n)
    assert d["path_true"].shape == d["path_decoded"].shape == (n, 2)
    assert d["accuracy_map"].shape == (topo.shape[1], topo.shape[0])
    assert d["axis_names"] == ["x", "y"] and len(d["units"]) == 2
    assert len(d["extent"]) == 4
    assert d["decoded_valid"].shape == (n,) and len(d["bin_width"]) == 2
    # bins never visited are NaN, not zero
    conf = np.asarray(res.extras["confusion"], float)
    never = ~(np.nan_to_num(conf).sum(axis=1) > 0)
    acc = d["accuracy_map"].T.ravel()
    assert np.isnan(acc[never]).all()
    assert np.nanmin(acc) >= 0 and np.nanmax(acc) <= 1
    assert d["error_cdf"]["y"][-1] == pytest.approx(1.0)


def test_decoded_trajectory_registry(monkeypatch, decoded_run):
    sess, res = decoded_run
    monkeypatch.setattr(
        _REGISTRY["metric"]["bayesian_decoder"],
        "default_plots",
        ("decoded_trajectory",),
        raising=False,
    )
    assert plots.plots_for(res, sess) == ["decoded_trajectory"]
    fig = plots.plot(res, sess, "decoded_trajectory")
    assert isinstance(fig, Figure)
    plt.close(fig)


def test_decoded_trajectory_data_1d():
    sess = simulate_session(SimulationConfig(duration_s=200, n_cells=10, seed=1))
    prep = Pipeline(
        transforms=[
            {"name": "resample_signal", "source": "position"},
            {"name": "bin_grid", "signals": ["x"], "bin_size": 100.0, "output": "x1d"},
        ],
        analyses=[AnalysisSpec(metric={"name": "bayesian_decoder", "n_folds": 2}, states="x1d")],
    )
    sess, rs = prep.run(sess)
    res = rs.get("bayesian_decoder", "x1d")
    d = pi.plot_decoded_trajectory_data(res, sess)
    plots.check_plot_data(d, "decoded_trajectory")
    assert d["accuracy_map"] is None and d["true"].shape[0] == 1
    fig = plots.plot_decoded_trajectory(res, sess)
    assert len(fig.axes) == 2
    plt.close(fig)


def test_joint_histogram_default_lift_and_nan():
    res, space = _fake_1d()
    d = pi.plot_joint_histogram_data(res, [0, 1], states=space)
    plots.check_plot_data(d, "joint_histogram")
    assert d["normalize"] == "lift" and "lift" in d["cbar_label"]
    assert d["vmin"] == -d["vmax"]
    assert np.isnan(d["panels"][:, 2, :]).all()  # unvisited state is NaN, not 0
    assert d["layout"] == "grid1d" and len(d["level_labels"][0]) == 3
    assert d["level_labels"][0][0] == "0" and d["level_labels"][0][-1].startswith("≥")
    d2 = pi.plot_joint_histogram_data(res, 0, normalize="conditional")
    assert d2["layout"] == "categorical" and d2["state_names"][0] == "b0"
    assert d2["vmin"] == 0.0 and "p(level" in d2["cbar_label"]
    fig = plots.plot_joint_histogram(res, [0, 1], states=space)
    im = fig.axes[0].images[0]
    assert im.get_cmap()(np.nan) == pytest.approx(matplotlib.colors.to_rgba(UNVISITED_COLOR))
    assert fig.axes[-1].get_ylabel().startswith("log2 lift")
    plt.close(fig)


def test_joint_histogram_registry(mi_run, monkeypatch):
    prep, rs = mi_run
    res = rs.get("mutual_information", "position")
    monkeypatch.setattr(
        _REGISTRY["metric"]["mutual_information"],
        "default_plots",
        ("joint_histogram",),
        raising=False,
    )
    assert plots.plots_for(res, prep) == ["joint_histogram"]
    fig = plots.plot(res, prep, "joint_histogram")
    assert isinstance(fig, Figure)
    plt.close(fig)
    d = pi.plot_joint_histogram_data(res, [0], prep.states["position"])
    assert d["layout"] == "grid2d" and d["extent"][1] > d["extent"][0]
    plots.check_plot_data(d, "joint_histogram")


def test_information_comparison_data(mi_run):
    _, rs = mi_run
    a = rs.get("mutual_information", "position")
    b = rs.get("information_content", "position")
    d = pi.plot_information_comparison_data(a, b, ("MI", "Skaggs"), highlight=[0, 1], identity=True)
    plots.check_plot_data(d, "information_comparison")
    assert sum(g["n"] for g in d["groups"]) == d["x"].size
    assert list(d["highlight"]) == [0, 1] and d["identity_line"] is not None


def test_level_sweep_data():
    rows = [
        {"n_levels": k, "duration_s": dur, "detection": 0.5, "fpr": 0.05}
        for k in (2, 3)
        for dur in (300, 900)
    ]
    d = pi.plot_level_sweep_data(pd.DataFrame(rows))
    plots.check_plot_data(d, "level_sweep")
    assert d["hue_labels"] == ["300 s", "900 s"] and len(d["sweep"]["lines"]) == 2
