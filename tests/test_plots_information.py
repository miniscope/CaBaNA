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
from cabana import plots  # noqa: E402
from cabana._models import GridTopology, StateSpace  # noqa: E402
from cabana._results import MetricResult  # noqa: E402


@pytest.fixture(scope="module")
def mi_run():
    sess = simulate_session(SimulationConfig(duration_s=300, n_cells=20, seed=0))
    prep = Pipeline(
        transforms=[
            {"name": "resample_signal", "source": "position"},
            {"name": "speed"},
            {"name": "bin_grid", "signals": ["x", "y"], "bin_size": 100.0, "output": "position"},
        ]
    ).run(sess)[0]
    ana = Pipeline(
        analyses=[
            AnalysisSpec(
                metric={"name": "mutual_information", "n_levels": 3},
                states="position",
                shuffle=ShuffleConfig(n_shuffles=10, seed=0),
            ),
            AnalysisSpec(
                metric={"name": "information_content"},
                states="position",
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


def test_decoded_trajectory():
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
    res = rs.get("bayesian_decoder", "position")
    fig = plots.plot_decoded_trajectory(res, sess, sess.states["position"])
    assert len(fig.axes) == 3  # x, y, error CDF
    assert len(fig.axes[0].lines) == 2
    assert "median error" in fig._suptitle.get_text()
    plt.close(fig)
    fig = plots.plot_decoded_trajectory(res, sess, sess.states["position"], t_range=(100, 130))
    plt.close(fig)
    with pytest.raises(ValueError):
        plots.plot_decoded_trajectory(res, sess, sess.states["position"], ax=object())
