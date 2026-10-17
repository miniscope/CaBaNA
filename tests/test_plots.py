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
        observed=obs,
        null=null,
        shifts=np.arange(n),
        p_value=p,
        null_lo=np.full(shape, 0.05),
        null_hi=np.full(shape, 0.95),
        significant=p < 0.05,
        alpha=0.05,
        tail=tail,
        n_shuffles=n,
    )


@pytest.fixture(scope="module")
def setup():
    rng = np.random.default_rng(0)
    t = np.arange(T) / FS
    grid_idx = rng.integers(0, 16, T)
    grid_oh = np.eye(16, dtype=bool)[grid_idx]
    edges = [np.linspace(0, 40, 5), np.linspace(0, 40, 5)]
    topo = GridTopology(shape=(4, 4), edges=edges, axis_names=["x", "y"])
    grid = StateSpace(
        name="grid",
        onehot=grid_oh,
        state_names=[f"b{i}" for i in range(16)],
        kind="grid",
        exclusive=True,
        topology=topo,
    )
    bouts_oh = np.zeros((T, 3), bool)
    bouts_oh[20:60, 0] = True
    bouts_oh[50:90, 1] = True
    bouts_oh[200:260, 2] = True
    bouts = StateSpace(
        name="social",
        onehot=bouts_oh,
        state_names=["sniff", "chase", "groom"],
        kind="bouts",
        exclusive=False,
    )
    lab = np.repeat(np.arange(5), 60)
    cat = StateSpace(
        name="syll",
        onehot=np.eye(5, dtype=bool)[lab],
        state_names=[f"s{i}" for i in range(5)],
        kind="categorical",
        exclusive=True,
    )
    gt = {
        "place_cells": [0, 1, 2],
        "social_cells": [{"cell": 3, "behavior": "sniff", "sign": 1}],
        "syllable_cells": [{"cell": 4, "syllable": "s1"}],
        "untuned_cells": list(range(5, NC)),
    }
    sess = Session(
        activity=rng.random((NC, T)),
        t=t,
        fs=FS,
        signals={"x": 20 + 10 * np.cos(t), "y": 20 + 10 * np.sin(t), "speed": rng.random(T) * 10},
        states={"grid": grid, "social": bouts, "syll": cat},
        masks={"speed": rng.random(T) > 0.3},
        meta={"ground_truth": gt},
    )
    ic = MetricResult(
        metric="information_content",
        target="grid",
        level="cell",
        values=rng.random(NC),
        extras={"rate_map": np.where(rng.random((NC, 16)) < 0.2, np.nan, rng.random((NC, 16)))},
        shuffle=_shuffle(rng, (NC,)),
        state_names=grid.state_names,
    )
    ic.values = ic.shuffle.observed
    stab = MetricResult(
        metric="split_half_stability",
        target="grid",
        level="cell",
        values=rng.random(NC),
        shuffle=_shuffle(rng, (NC,)),
    )
    au_sh = _shuffle(rng, (NC, 3), tail="two")
    au = MetricResult(
        metric="auroc",
        target="social",
        level="cell",
        values=au_sh.observed,
        shuffle=au_sh,
        state_names=bouts.state_names,
    )
    pop = MetricResult(
        metric="population_vector_overlap",
        target="grid",
        level="population",
        values=np.where(np.eye(16) > 0, np.nan, rng.random((16, 16))),
        state_names=grid.state_names,
    )
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
    s1 = StateSpace(
        name="lin",
        onehot=np.eye(16, dtype=bool)[np.arange(T) % 16],
        state_names=[str(i) for i in range(16)],
        kind="grid",
        exclusive=True,
        topology=topo,
    )
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
    with pytest.raises(KeyError):
        P.plot_shuffle_distribution(au, 0, state="nope")


def test_tuning_heatmap(setup, tmp_path):
    _, ic, _, au, _ = setup
    for i, sort_by in enumerate([None, "peak", "groom"]):
        _check(P.plot_tuning_heatmap(au, sort_by=sort_by), tmp_path, f"heat{i}")
    _check(
        P.plot_tuning_heatmap(au.model_copy(update={"metric": "other", "shuffle": None})),
        tmp_path,
        "heat_plain",
    )
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
    assert list(df.columns) == [
        "result",
        "population",
        "n",
        "fraction_significant",
        "adjusted_fraction",
    ]
    assert df["adjusted_fraction"].isna().all()  # no correction on these results
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


def test_ground_truth_recovery_adjusted(setup, tmp_path):
    sess, ic, stab, au, pop = setup
    sh = au.shuffle
    adj = sh.model_copy(
        update={"p_adj": np.minimum(1.0, sh.p_value * 50), "correction": "bonferroni"}
    )
    au2 = au.model_copy(update={"shuffle": adj})
    rs = ResultSet(results=[au2])

    def frac(**kw):
        df = P.plot_ground_truth_recovery(sess, rs, **kw).cabana_summary
        return df[df["population"] == "place"]["fraction_significant"].iloc[0]

    raw = (sh.p_value[:3] < 0.05).any(axis=1).mean()
    ad = (adj.p_adj[:3] < 0.05).any(axis=1).mean()
    assert frac(adjusted=False) == pytest.approx(raw)
    assert frac() == pytest.approx(ad) == pytest.approx(frac(adjusted=True))


# --------------------------------------------------------------------------- #
# Phase D: plot-data companions, new renderers, registry wiring
# --------------------------------------------------------------------------- #

from cabana import plots as cp  # noqa: E402


@pytest.fixture(scope="module")
def rich(setup):
    """Session with a behavior input (units), occupancy and split-half extras."""
    from cabana._models import ContinuousSignal

    sess, ic, stab, au, pop = setup
    rng = np.random.default_rng(1)
    sig = ContinuousSignal(
        t=sess.t,
        values=np.c_[sess.signals["x"], sess.signals["y"]],
        channel_names=["x", "y"],
        units="cm",
    )
    sess = sess.model_copy(update={"behavior": {"pos": sig}, "activity_kind": "deconvolved"})
    rate = np.where(rng.random((NC, 16)) < 0.2, np.nan, rng.random((NC, 16)))
    sh = _shuffle(rng, (NC,))
    # cells 3 and 7 significant with the lowest value-order; one p at the floor
    p = np.full(NC, 0.5)
    p[[3, 7]] = [1 / 51, 0.03]
    sh = sh.model_copy(update={"p_value": p, "significant": p < 0.05})
    ic2 = ic.model_copy(
        update={
            "values": sh.observed,
            "shuffle": sh,
            "extras": {
                "rate_map": rate,
                "occupancy_s": rng.random(16) + 0.1,
            },
        }
    )
    half = ic2.model_copy(
        update={
            "metric": "split_half_stability",
            "shuffle": sh,
            "extras": {
                "rate_map_a": rate,
                "rate_map_b": np.where(rng.random((NC, 16)) < 0.1, np.nan, rng.random((NC, 16))),
            },
        }
    )
    return sess, ic2, half


def test_data_contract_all(setup, rich):
    sess, ic, stab, au, pop = setup
    sess2, ic2, half = rich
    rs = ResultSet(results=[ic, stab, au, pop])
    cases = [
        (P.plot_behavior_overview_data(sess), "behavior_overview"),
        (P.plot_rate_maps_data(sess2, ic2, [0, 1, 2]), "rate_maps"),
        (P.plot_rate_maps_data(sess2, ic2), "rate_maps"),
        (P.plot_shuffle_distribution_data(ic, 2), "shuffle_distribution"),
        (P.plot_shuffle_distribution_data(au, 2, state="chase"), "shuffle_distribution"),
        (P.plot_tuning_heatmap_data(au, sort_by="peak"), "tuning_heatmap"),
        (P.plot_metric_scatter_data(ic, stab), "metric_scatter"),
        (P.plot_population_matrix_data(pop), "population_matrix"),
        (P.plot_ground_truth_recovery_data(sess, rs), "ground_truth_recovery"),
        (P.plot_metric_strip_data(ic), "metric_strip"),
        (P.plot_split_half_maps_data(sess2, half, [0, 1]), "split_half_maps"),
    ]
    for d, kind in cases:
        cp.check_plot_data(d, kind)
    # empty-ground-truth variant also satisfies the contract
    cp.check_plot_data(
        P.plot_ground_truth_recovery_data(sess.model_copy(update={"meta": {}}), rs),
        "ground_truth_recovery",
    )


def test_rate_maps_default_cells_and_paging(rich):
    sess, ic, _ = rich
    order = cp.plot_spec("rate_maps").defaults(ic, sess)["cells"]
    assert sorted(order) == list(range(NC))
    assert set(order[:2]) == {3, 7}  # significant first
    vals = np.asarray(ic.values)
    assert vals[order[0]] >= vals[order[1]]
    rest = order[2:]
    assert all(vals[a] >= vals[b] for a, b in zip(rest, rest[1:], strict=False))
    d0 = P.plot_rate_maps_data(sess, ic, max_cells=8, page=0)
    d2 = P.plot_rate_maps_data(sess, ic, max_cells=8, page=2)
    assert list(d0["cells"]) == order[:8]
    assert list(d2["cells"]) == order[16:]
    assert d0["paging"]["n_pages"] == 3 and len(d2["cells"]) == NC - 16
    with pytest.raises(ValueError, match="page"):
        P.plot_rate_maps_data(sess, ic, max_cells=8, page=3)
    fig = P.plot_rate_maps(sess, ic, max_cells=8, page=1)
    assert "page 2/3" in fig._suptitle.get_text()
    plt.close(fig)


def test_rate_maps_nan_unvisited_units_and_floor(rich, tmp_path):
    sess, ic, _ = rich
    d = P.plot_rate_maps_data(sess, ic, [0, 1, 2, 3, 4, 5, 6, 7])
    assert np.isnan(d["rate_maps"]).any()  # NaN carried, not zero
    assert d["rate_maps"].shape == (8, 4, 4)
    assert d["rate_label"] == "rate (events/s)"
    assert d["axis_labels"] == ["x (cm)", "y (cm)"]
    assert d["occupancy"].shape == (4, 4)
    assert any("unvisited" in n.lower() for n in d["notes"])
    assert P.plot_rate_maps_data(sess, ic, [0], show_occupancy=False)["occupancy"] is None
    # floor: cell 3 has p = 1/(n+1)
    assert d["p_floor"][3] and not d["p_floor"][0]
    assert any("floor" in n for n in d["notes"])
    assert "(floor)" in d["titles"][3]
    fig = P.plot_rate_maps(sess, ic, [0, 3, 7])
    assert "floor" in fig._supxlabel.get_text()
    # first panel is occupancy, rate panels carry the unvisited colour for bad bins
    assert fig.axes[0].get_title() == "occupancy (s)"
    plt.close(fig)
    dff = sess.model_copy(update={"activity_kind": "dff"})
    assert P.plot_rate_maps_data(dff, ic, [0])["rate_label"] == "rate (a.u./s)"
    # no floor, no note
    d2 = P.plot_rate_maps_data(sess, ic, [0, 1])
    assert not any("floor" in n for n in d2["notes"])


def test_metric_strip(setup, tmp_path):
    _, ic, *_ = setup
    d = P.plot_metric_strip_data(ic)
    assert np.all(np.diff(d["values"]) <= 0)  # descending
    assert d["null_lo"] is not None and len(d["null_lo"]) == NC
    assert d["show_ids"] and len(d["cell_labels"]) == NC
    unsorted = P.plot_metric_strip_data(ic, sort=False)
    np.testing.assert_allclose(unsorted["values"], ic.values)
    assert list(P.plot_metric_strip_data(ic, max_cells=5)["cells"]) == list(d["cells"][:5])
    sig = np.asarray(ic.shuffle.significant)
    assert d["significant"].sum() == sig.sum()
    assert P.plot_metric_strip_data(ic.model_copy(update={"shuffle": None}))["null_lo"] is None
    many = ic.model_copy(update={"values": np.arange(50.0), "shuffle": None})
    assert not P.plot_metric_strip_data(many)["show_ids"]
    fig = P.plot_metric_strip(ic)
    assert fig.axes[0].get_ylabel().startswith("spatial information")
    _check(fig, tmp_path, "strip")
    with pytest.raises(ValueError):
        P.plot_metric_strip_data(ic.model_copy(update={"values": np.zeros((NC, 2))}))


def test_split_half_maps(rich, setup, tmp_path):
    sess, _, half = rich
    d = P.plot_split_half_maps_data(sess, half, [0, 3])
    assert d["maps_a"].shape == (2, 4, 4) and d["maps_b"].shape == (2, 4, 4)
    assert "r=" in d["titles"][0] and "p" in d["titles"][0]
    _check(P.plot_split_half_maps(sess, half, [0, 3]), tmp_path, "half2d")
    _check(P.plot_split_half_maps(half, sess), tmp_path, "half_default")  # either order
    # categorical target
    ex = {k: np.random.rand(NC, 3) for k in ("rate_map_a", "rate_map_b")}
    cat = half.model_copy(update={"target": "social", "extras": ex})
    dc = P.plot_split_half_maps_data(sess, cat, [0, 1])
    assert dc["layout"] == "categorical" and dc["maps_a"].shape == (2, 3)
    _check(P.plot_split_half_maps(sess, cat, [0, 1]), tmp_path, "half_cat")
    with pytest.raises(ValueError, match="rate_map_a"):
        P.plot_split_half_maps_data(sess, half.model_copy(update={"extras": {}}))


def test_ground_truth_adjusted_overlay(setup, tmp_path):
    sess, ic, stab, au, pop = setup
    sh = au.shuffle
    adj = sh.model_copy(update={"p_adj": np.minimum(1.0, sh.p_value * 50), "correction": "bh"})
    au2 = au.model_copy(update={"shuffle": adj})
    fig = P.plot_ground_truth_recovery(sess, [au2])
    df = fig.cabana_summary
    un = df[df["population"] == "untuned"].iloc[0]
    assert un["adjusted_fraction"] == pytest.approx((adj.p_adj[5:] < 0.05).any(axis=1).mean())
    legend = [t.get_text() for t in fig.axes[0].get_legend().get_texts()]
    assert "untuned (adjusted)" in legend
    _check(fig, tmp_path, "gt_adj")


def test_registry_wiring(rich, setup, tmp_path):
    sess, ic, half = rich
    _, _, stab, au, pop = setup
    for name in ("rate_maps", "split_half_maps", "metric_strip", "shuffle_distribution"):
        assert name in cp.available_plots()
    assert cp.plot_spec("rate_maps").applies_to(ic, sess)
    assert cp.plot_spec("split_half_maps").applies_to(half, sess)
    assert not cp.plot_spec("split_half_maps").applies_to(ic, sess)
    names = cp.plots_for(ic, sess)
    assert "metric_strip" in names and "shuffle_distribution" in names
    assert "tuning_heatmap" in cp.plots_for(au, sess)
    assert "population_matrix" in cp.plots_for(pop, sess)
    for kind in ("rate_maps", "metric_strip", "shuffle_distribution"):
        fig = cp.plot(ic, sess, kind)
        assert isinstance(fig, Figure)
        plt.close(fig)
    fig = cp.plot(half, sess, "split_half_maps")
    plt.close(fig)
    fig = cp.plot(au, sess, "tuning_heatmap")  # default sort_by="peak"
    assert fig.axes[0].get_ylabel() == "cell (sorted)"
    plt.close(fig)
    fig = cp.plot(au, sess, "shuffle_distribution")  # default cell and state
    plt.close(fig)
    fig = cp.plot(pop, sess, "population_matrix")
    plt.close(fig)
    fig = ic.plot(sess)
    assert isinstance(fig, Figure)
    plt.close(fig)
    assert cp.plot_spec("shuffle_distribution").defaults(ic, sess)["cell"] == 3
    assert cp.plot_spec("shuffle_distribution").defaults(au, sess).keys() == {"cell", "state"}
