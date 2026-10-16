import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import pytest  # noqa: E402
from matplotlib.figure import Figure  # noqa: E402

from cabana import _plots as P  # noqa: E402
from cabana._models import GridTopology, Session, StateSpace  # noqa: E402
from cabana._results import MetricResult, ResultSet, ShuffleResult  # noqa: E402

T, FS, NC = 300, 10.0, 20


def _shuffle(rng, shape, n=50, tail="upper"):
    obs = rng.random(shape)
    null = rng.random((n, *shape))
    p = rng.random(shape)
    return ShuffleResult(
        observed=obs, null=null, shifts=np.arange(n), p_value=p,
        null_lo=np.full(shape, 0.05), null_hi=np.full(shape, 0.95),
        significant=p < 0.05, alpha=0.05, tail=tail, n_shuffles=n,
    )


@pytest.fixture(scope="module")
def setup():
    rng = np.random.default_rng(0)
    t = np.arange(T) / FS
    grid_idx = rng.integers(0, 16, T)
    grid_oh = np.eye(16, dtype=bool)[grid_idx]
    edges = [np.linspace(0, 40, 5), np.linspace(0, 40, 5)]
    topo = GridTopology(shape=(4, 4), edges=edges, axis_names=["x", "y"])
    grid = StateSpace(name="grid", onehot=grid_oh, state_names=[f"b{i}" for i in range(16)],
                      kind="grid", exclusive=True, topology=topo)
    bouts_oh = np.zeros((T, 3), bool)
    bouts_oh[20:60, 0] = True
    bouts_oh[50:90, 1] = True
    bouts_oh[200:260, 2] = True
    bouts = StateSpace(name="social", onehot=bouts_oh, state_names=["sniff", "chase", "groom"],
                       kind="bouts", exclusive=False)
    lab = np.repeat(np.arange(5), 60)
    cat = StateSpace(name="syll", onehot=np.eye(5, dtype=bool)[lab],
                     state_names=[f"s{i}" for i in range(5)], kind="categorical", exclusive=True)
    gt = {
        "place_cells": [0, 1, 2],
        "social_cells": [{"cell": 3, "behavior": "sniff", "sign": 1}],
        "syllable_cells": [{"cell": 4, "syllable": "s1"}],
        "untuned_cells": list(range(5, NC)),
    }
    sess = Session(
        activity=rng.random((NC, T)), t=t, fs=FS,
        signals={"x": 20 + 10 * np.cos(t), "y": 20 + 10 * np.sin(t), "speed": rng.random(T) * 10},
        states={"grid": grid, "social": bouts, "syll": cat},
        masks={"speed": rng.random(T) > 0.3}, meta={"ground_truth": gt},
    )
    ic = MetricResult(
        metric="information_content", target="grid", level="cell", values=rng.random(NC),
        extras={"rate_map": np.where(rng.random((NC, 16)) < 0.2, np.nan, rng.random((NC, 16)))},
        shuffle=_shuffle(rng, (NC,)), state_names=grid.state_names,
    )
    ic.values = ic.shuffle.observed
    stab = MetricResult(metric="split_half_stability", target="grid", level="cell",
                        values=rng.random(NC), shuffle=_shuffle(rng, (NC,)))
    au_sh = _shuffle(rng, (NC, 3), tail="two")
    au = MetricResult(metric="auroc", target="social", level="cell", values=au_sh.observed,
                      shuffle=au_sh, state_names=bouts.state_names)
    pop = MetricResult(metric="population_vector_overlap", target="grid", level="population",
                       values=np.where(np.eye(16) > 0, np.nan, rng.random((16, 16))),
                       state_names=grid.state_names)
    return sess, ic, stab, au, pop


def _check(fig, tmp_path, name):
    assert isinstance(fig, Figure)
    assert len(fig.axes) >= 1
    fig.savefig(tmp_path / f"{name}.png", dpi=60)
    assert (tmp_path / f"{name}.png").stat().st_size > 0
    plt.close(fig)


def test_behavior_overview(setup, tmp_path):
    sess = setup[0]
    fig = P.plot_behavior_overview(sess)
    assert len(fig.axes) >= 5
    _check(fig, tmp_path, "overview")
    _check(P.plot_behavior_overview(sess, states=["syll"]), tmp_path, "overview_syll")


def test_behavior_overview_empty(tmp_path):
    s = Session(activity=np.zeros((1, 5)), t=np.arange(5) / 10, fs=10.0)
    _check(P.plot_behavior_overview(s), tmp_path, "overview_empty")


def test_rate_maps(setup, tmp_path):
    sess, ic, _, _, _ = setup
    _check(P.plot_rate_maps(sess, ic, [0, 1, 2, 3, 4], ncols=3), tmp_path, "rate_grid")
    # bar chart path
    bar = ic.model_copy(update={"target": "social", "extras": {"rate_map": np.random.rand(NC, 3)}})
    _check(P.plot_rate_maps(sess, bar, [0, 1]), tmp_path, "rate_bars")
    # 1D topology path
    topo = GridTopology(shape=(16,), edges=[np.arange(17.0)], axis_names=["x"])
    s1 = StateSpace(name="lin", onehot=np.eye(16, dtype=bool)[np.arange(T) % 16],
                    state_names=[str(i) for i in range(16)], kind="grid", exclusive=True,
                    topology=topo)
    line = ic.model_copy(update={"target": "lin"})
    _check(P.plot_rate_maps(sess.with_state(s1), line, [0, 1]), tmp_path, "rate_line")
    with pytest.raises(ValueError, match="rate_map"):
        P.plot_rate_maps(sess, ic.model_copy(update={"extras": {}}), [0])


def test_shuffle_distribution(setup, tmp_path):
    _, ic, _, au, _ = setup
    _check(P.plot_shuffle_distribution(ic, 2), tmp_path, "shuf1d")
    _check(P.plot_shuffle_distribution(au, 2, state=1), tmp_path, "shuf2d_idx")
    _check(P.plot_shuffle_distribution(au, 2, state="chase"), tmp_path, "shuf2d_name")
    fig, ax = plt.subplots()
    assert P.plot_shuffle_distribution(ic, 0, ax=ax) is fig
    plt.close(fig)
    with pytest.raises(ValueError):
        P.plot_shuffle_distribution(ic.model_copy(update={"shuffle": None}), 0)
    with pytest.raises(ValueError):
        P.plot_shuffle_distribution(au, 0, state="nope")


def test_tuning_heatmap(setup, tmp_path):
    _, ic, _, au, _ = setup
    for i, sort_by in enumerate([None, "peak", "groom"]):
        _check(P.plot_tuning_heatmap(au, sort_by=sort_by), tmp_path, f"heat{i}")
    _check(P.plot_tuning_heatmap(au.model_copy(update={"metric": "other", "shuffle": None})),
           tmp_path, "heat_plain")
    with pytest.raises(ValueError):
        P.plot_tuning_heatmap(ic)


def test_metric_scatter(setup, tmp_path):
    _, ic, stab, _, _ = setup
    _check(P.plot_metric_scatter(ic, stab), tmp_path, "scatter")
    _check(P.plot_metric_scatter(ic, stab, log_x=True, log_y=True), tmp_path, "scatter_log")
    ns = ic.model_copy(update={"shuffle": None})
    _check(P.plot_metric_scatter(ns, ns), tmp_path, "scatter_nosh")


def test_population_matrix(setup, tmp_path):
    _, ic, _, _, pop = setup
    _check(P.plot_population_matrix(pop), tmp_path, "popmat")
    with pytest.raises(ValueError):
        P.plot_population_matrix(ic)


def test_ground_truth_recovery(setup, tmp_path):
    sess, ic, stab, au, pop = setup
    rs = ResultSet(results=[ic, stab, au, pop])
    fig = P.plot_ground_truth_recovery(sess, rs)
    df = fig.cabana_summary
    assert isinstance(df, pd.DataFrame)
    assert list(df.columns) == ["result", "population", "n", "fraction_significant"]
    assert len(df) == 3 * 4
    assert set(df["population"]) == {"place", "social", "syllable", "untuned"}
    # 2D result is significant in ANY state
    row = df[(df["result"] == "auroc[social]") & (df["population"] == "place")].iloc[0]
    expect = (au.shuffle.p_value[:3] < 0.05).any(axis=1).mean()
    assert row["fraction_significant"] == pytest.approx(expect)
    _check(fig, tmp_path, "gt")
    # defensive: no ground truth
    bare = sess.model_copy(update={"meta": {}})
    fig2 = P.plot_ground_truth_recovery(bare, rs)
    assert fig2.cabana_summary.empty
    _check(fig2, tmp_path, "gt_empty")
