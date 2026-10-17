"""Regression tests for the framework-hardening pass: bugs, names, support, persistence."""

from __future__ import annotations

import warnings

import numpy as np
import pandas as pd
import pytest

import cabana
from cabana import (
    AUROC,
    AnalysisSpec,
    BinGrid,
    BoutsToStates,
    BoutTable,
    CrossSessionResult,
    GridTopology,
    LabelsToStates,
    MetricResult,
    Pipeline,
    ResultSet,
    Session,
    ShuffleConfig,
    StateSpace,
    cohort_table,
    fraction_significant_by_animal,
    plots,
    significant_cells,
)

FS = 10.0


def _cat_state(T: int, k: int = 3, seed: int = 0, name: str = "s") -> StateSpace:
    lab = np.random.default_rng(seed).integers(0, k, T)
    oh = np.zeros((T, k), bool)
    oh[np.arange(T), lab] = True
    return StateSpace(
        name=name,
        onehot=oh,
        state_names=[f"s{i}" for i in range(k)],
        kind="categorical",
        exclusive=True,
    )


# ------------------------------------------------------------------ Part 1


def test_glm_results_keep_group_names():
    sim = cabana.simulate_session(n_cells=10, duration_s=300, seed=1)
    p = Pipeline(
        transforms=[
            {"name": "labels_to_states", "source": "syllables", "output": "syl"},
            {"name": "design_matrix", "states": ["syl"]},
        ],
        analyses=[
            AnalysisSpec(
                metric={"name": "glm_encoding"},
                signal="design",
                masks=[],
                shuffle=ShuffleConfig(n_shuffles=5, seed=0, min_shift_s=5),
            )
        ],
    )
    _, rs = p.run(sim)
    r = rs.results[0]
    assert r.state_names == [str(g) for g in r.extras["group_names"]]
    group = r.state_names[0]
    assert significant_cells(r, group).shape == (10,)
    assert group in set(r.to_dataframe()["state"])


def test_auroc_shifted_matches_compute_with_nan_activity_and_gappy_mask():
    rng = np.random.default_rng(0)
    T = 800
    act = rng.random((2, T))
    act[1, 300] = np.nan
    st = _cat_state(T)
    mask = np.ones(T, bool)
    mask[:50] = False
    sh = np.array([0, 10, 20, 300 - 55, 500])
    brute = np.stack([AUROC().compute(np.roll(act, int(k), axis=1), st, mask, FS) for k in sh])
    fast = AUROC().compute_shifted(act, st, mask, FS, sh)
    np.testing.assert_allclose(fast, brute, equal_nan=True)
    assert np.isnan(brute[:, 1]).any() and np.isfinite(brute[:, 0]).all()
    # all-True mask path
    full = np.ones(T, bool)
    brute = np.stack([AUROC().compute(np.roll(act, int(k), axis=1), st, full, FS) for k in sh])
    np.testing.assert_allclose(
        AUROC().compute_shifted(act, st, full, FS, sh), brute, equal_nan=True
    )


def _empty_bin_session() -> Session:
    T = 100
    oh = np.zeros((T, 2), bool)
    oh[0:5, 0] = True
    st = StateSpace(
        name="s",
        onehot=oh,
        state_names=["a", "b"],
        kind="categorical",
        exclusive=True,
        support=np.arange(T) < 5,
    )
    return Session(activity=np.ones((1, T)), t=np.arange(T) / FS, fs=FS, states={"s": st})


def test_rebin_min_fraction_zero_does_not_activate_empty_bins():
    r = _empty_bin_session().rebin(0.5, min_fraction=0.0)
    assert r.states["s"].onehot.sum(axis=1).tolist() == [1] + [0] * 19
    T = 100
    oh = np.zeros((T, 1), bool)
    oh[0:2, 0] = True
    b = StateSpace(name="b", onehot=oh, state_names=["x"], kind="bouts", exclusive=False)
    s2 = Session(activity=np.ones((1, T)), t=np.arange(T) / FS, fs=FS, states={"b": b})
    out = s2.rebin(0.5, min_fraction=0).states["b"].onehot.ravel()
    assert out.sum() == 1 and out[0]


def test_rebin_records_actual_bin_and_warns_when_rounded():
    s = _empty_bin_session()
    with pytest.warns(UserWarning, match="whole number of frames"):
        r = s.rebin(0.26)
    assert r.meta["rebin"]["bin_s"] == pytest.approx(0.3)
    assert r.meta["rebin"]["frames_per_bin"] == 3
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        assert s.rebin(0.5).meta["rebin"]["bin_s"] == pytest.approx(0.5)


def test_pipeline_and_spec_reject_unknown_fields():
    with pytest.raises(ValueError):
        Pipeline(steps=[])
    with pytest.raises(ValueError):
        AnalysisSpec(metric={"name": "auroc"}, states="s", bogus=1)


def test_metric_result_validates_lengths():
    v = np.zeros((3, 2))
    with pytest.raises(ValueError, match="cell_ids"):
        MetricResult(metric="m", target="t", level="cell", values=v, cell_ids=["a", "b"])
    with pytest.raises(ValueError, match="state_names"):
        MetricResult(metric="m", target="t", level="cell", values=v, state_names=["a"])
    MetricResult(metric="m", target="t", level="cell", values=v, state_names=["a", "b"])


# ------------------------------------------------------------------ Part 3 (support)


def test_transforms_set_support_and_masks():
    T = 100
    t = np.arange(T) / FS
    x = np.linspace(0, 10, T)
    x[:20] = np.nan
    bt = BoutTable(
        labels=["a"],
        start_s=np.array([2.0]),
        stop_s=np.array([3.0]),
        scored_start_s=1.0,
        scored_stop_s=8.0,
    )
    ls = cabana.LabelSeries(t=np.array([0.0, 5.0]), labels=np.array([0, 1]), label_names=["p", "q"])
    s = Session(
        activity=np.ones((1, T)), t=t, fs=FS, signals={"x": x}, behavior={"bt": bt, "ls": ls}
    )
    g = BinGrid(signals=["x"], n_bins=2, output="pos").apply(s).states["pos"]
    assert np.array_equal(g.support, np.isfinite(x))
    assert np.array_equal(g.support, g.onehot.any(axis=1))
    out = BinGrid(signals=["x"], n_bins=2, output="pos").apply(s)
    assert np.array_equal(out.masks["pos_valid"], g.support)
    b = BoutsToStates(source="bt", output="b").apply(s)
    assert np.array_equal(b.states["b"].support, b.masks["b_scored"])
    assert b.states["b"].support.sum() == 70
    lab = LabelsToStates(source="ls", output="l").apply(s)
    assert np.array_equal(lab.states["l"].support, lab.masks["l_covered"])


def test_untracked_frames_do_not_change_grid_auroc():
    rng = np.random.default_rng(0)
    T = 2000
    x = rng.uniform(0, 10, T)
    x[:400] = np.nan
    act = rng.random((1, T))
    act[0, :400] += 5.0
    s = Session(activity=act, t=np.arange(T) / FS, fs=FS, signals={"x": x})
    pipe = Pipeline(
        transforms=[{"name": "bin_grid", "signals": ["x"], "n_bins": 2, "output": "pos"}],
        analyses=[AnalysisSpec(metric={"name": "auroc"}, states="pos")],
    )
    out, rs = pipe.run(s)
    st = out.states["pos"]
    expected = AUROC().compute(act, st, st.onehot.any(axis=1), FS)
    np.testing.assert_allclose(rs.results[0].values, expected)
    assert abs(rs.results[0].values[0, 0] - 0.5) < 0.1
    assert rs.results[0].provenance["support_used"] is True
    assert rs.results[0].provenance["n_frames_used"] == 1600


def test_masks_none_means_support_only(small_session):
    s = small_session.with_mask("speed", np.arange(small_session.n_time) % 2 == 0)
    spec = lambda masks: AnalysisSpec(  # noqa: E731
        metric={"name": "auroc"}, states="syllables", masks=masks
    )
    with warnings.catch_warnings():
        warnings.simplefilter("error")  # no more "ANDs all masks" warning
        _, a = Pipeline(analyses=[spec(None)]).run(s)
    _, b = Pipeline(analyses=[spec(["syllables_covered"])]).run(s)
    _, c = Pipeline(analyses=[spec([])]).run(s)
    _, d = Pipeline(analyses=[spec(["speed"])]).run(s)
    np.testing.assert_array_equal(a.results[0].values, b.results[0].values)
    np.testing.assert_array_equal(a.results[0].values, c.results[0].values)
    assert not np.array_equal(a.results[0].values, d.results[0].values, equal_nan=True)


def test_support_rebinned_and_validated():
    s = _empty_bin_session()
    r = s.rebin(0.5)
    assert r.states["s"].support is not None and r.states["s"].support.shape == (20,)
    assert r.states["s"].support.tolist() == [True] + [False] * 19
    bad = s.states["s"].model_copy(update={"support": np.ones(7, bool)})
    with pytest.raises(ValueError, match="support"):
        s.with_state(bad)
    with pytest.raises(ValueError, match="support"):
        StateSpace(
            name="x",
            onehot=np.zeros((5, 1), bool),
            state_names=["a"],
            kind="bouts",
            exclusive=False,
            support=np.ones(4, bool),
        )


# ------------------------------------------------------------------ Part 2 (names)


def _named_session():
    return cabana.simulate_session(n_cells=8, duration_s=120, seed=2)


def _named_pipeline():
    sh = ShuffleConfig(n_shuffles=10, seed=0, min_shift_s=2.0)
    bs = ShuffleConfig(n_shuffles=10, seed=0, null={"name": "bout_shuffle"})
    return Pipeline(
        transforms=[{"name": "bouts_to_states", "source": "social", "output": "social"}],
        analyses=[
            AnalysisSpec(metric={"name": "auroc"}, states="social"),
            AnalysisSpec(metric={"name": "auroc"}, states="social", shuffle=bs),
            AnalysisSpec(metric={"name": "auroc"}, states="social", shuffle=sh),
            AnalysisSpec(metric={"name": "auroc"}, states="social", shuffle=sh),
            AnalysisSpec(name="mine", metric={"name": "auroc"}, states="social"),
        ],
    )


def test_unique_analysis_names_and_lookup():
    _, rs = _named_pipeline().run(_named_session())
    assert rs.names() == [
        "auroc[social]",
        "auroc[social]#bout_shuffle",
        "auroc[social]#circular_shift",
        "auroc[social]#2",
        "mine",
    ]
    assert rs["mine"] is rs.results[4]
    assert rs.get(name="auroc[social]#2") is rs.results[3]
    assert rs.get("auroc", "social", null="bout_shuffle") is rs.results[1]
    with pytest.raises(KeyError, match="pass name="):
        rs.get("auroc", "social")
    with pytest.raises(KeyError):
        rs["nope"]
    with pytest.raises(ValueError, match="duplicate"):
        Pipeline(
            analyses=[
                AnalysisSpec(name="a", metric={"name": "auroc"}, states="s"),
                AnalysisSpec(name="a", metric={"name": "auroc"}, states="s"),
            ]
        ).run(_named_session())


def test_dataframe_columns_and_cohort_analysis_selection():
    _, rs = _named_pipeline().run(_named_session())
    df = rs.to_dataframe()
    assert {"analysis", "null", "n_shuffles"} <= set(df.columns)
    one = rs["auroc[social]#bout_shuffle"].to_dataframe()
    assert set(one["null"]) == {"bout_shuffle"} and set(one["n_shuffles"]) == {10}
    assert set(rs["mine"].to_dataframe()["null"]) == {None}
    tab = cohort_table({"s1": rs}, {"s1": "A"})
    assert "analysis" in tab.columns
    with pytest.raises(ValueError, match="analysis="):
        fraction_significant_by_animal(tab, metric="auroc", target="social")
    fr = fraction_significant_by_animal(tab, analysis="auroc[social]#bout_shuffle")
    assert set(fr["analysis"]) == {"auroc[social]#bout_shuffle"}
    with pytest.raises(KeyError):
        fraction_significant_by_animal(tab, analysis="missing")


# ------------------------------------------------------------------ Part 4


def test_provenance_filled():
    s = _named_session()
    out, rs = _named_pipeline().run(s)
    p = rs.results[1].provenance
    assert p["cabana_version"] == cabana.__version__
    assert p["null"] == "bout_shuffle" and p["n_shuffles"] == 10 and p["seed"] == 0
    assert p["support_used"] is True and p["masks"] == []
    assert p["target_kind"] == "states" and p["n_cells"] == 8 and p["fs"] == s.fs
    assert p["target_params"]["name"] == "bouts_to_states"
    assert out.meta["transforms"][0]["name"] == "bouts_to_states"
    assert "transforms" not in s.meta
    assert pd.Timestamp(p["timestamp"])
    assert rs.results[0].provenance["null"] is None


def _assert_results_equal(a: ResultSet, b: ResultSet) -> None:
    assert a.names() == b.names()
    for ra, rb in zip(a, b, strict=True):
        assert ra.metric == rb.metric and ra.target == rb.target and ra.level == rb.level
        assert ra.cell_ids == rb.cell_ids and ra.state_names == rb.state_names
        assert ra.provenance == rb.provenance
        assert np.array_equal(ra.values, rb.values, equal_nan=True)
        assert set(ra.extras) == set(rb.extras)
        for k in ra.extras:
            assert np.array_equal(ra.extras[k], rb.extras[k], equal_nan=True)
        assert (ra.shuffle is None) == (rb.shuffle is None)
        if ra.shuffle is not None:
            sa, sb = ra.shuffle, rb.shuffle
            for f in ("observed", "p_value", "null_lo", "null_hi", "significant", "shifts"):
                x, y = getattr(sa, f), getattr(sb, f)
                assert (x is None) == (y is None)
                if x is not None:
                    assert np.array_equal(x, y, equal_nan=True), f
            assert (sa.null is None) == (sb.null is None)
            if sa.null is not None:
                np.testing.assert_allclose(sa.null, sb.null, atol=1e-6, equal_nan=True)
            assert (sa.null_name, sa.n_shuffles, sa.tail, sa.alpha) == (
                sb.null_name,
                sb.n_shuffles,
                sb.tail,
                sb.alpha,
            )
    pd.testing.assert_frame_equal(a.to_dataframe(), b.to_dataframe())


@pytest.mark.parametrize("ext", ["dir", "zip"])
def test_resultset_roundtrip(tmp_path, ext):
    _, rs = _named_pipeline().run(_named_session())
    path = tmp_path / ("res" if ext == "dir" else "res.zip")
    rs.save(path)
    _assert_results_equal(rs, ResultSet.load(path))


def test_keep_null_none_drops_draws_but_keeps_inference(tmp_path):
    s = _named_session()
    pipe = Pipeline(
        transforms=[{"name": "bouts_to_states", "source": "social", "output": "social"}],
        analyses=[
            AnalysisSpec(
                name="full",
                metric={"name": "auroc"},
                states="social",
                shuffle=ShuffleConfig(n_shuffles=10, min_shift_s=2.0, derive_seeds=False),
            ),
            AnalysisSpec(
                name="lean",
                metric={"name": "auroc"},
                states="social",
                shuffle=ShuffleConfig(
                    n_shuffles=10, min_shift_s=2.0, keep_null="none", derive_seeds=False
                ),
            ),
        ],
    )
    _, rs = pipe.run(s)
    full, lean = rs["full"].shuffle, rs["lean"].shuffle
    assert lean.null is None and full.null.shape[0] == 10
    for f in ("p_value", "null_lo", "null_hi", "significant"):
        np.testing.assert_array_equal(getattr(full, f), getattr(lean, f))
    assert significant_cells(rs["lean"], sign="positive").shape == (8,)
    with pytest.raises(ValueError, match="keep_null"):
        plots.plot_shuffle_distribution(rs["lean"], cell=0, state=0)
    rs.save(tmp_path / "r")
    _assert_results_equal(rs, ResultSet.load(tmp_path / "r"))


@pytest.mark.parametrize("ext", ["dir", "zip"])
def test_session_roundtrip_with_bouts_and_grid(tmp_path, ext):
    sim = _named_session()
    s = Pipeline(
        transforms=[
            {"name": "resample_signal", "source": "position"},
            {"name": "bin_grid", "signals": ["x", "y"], "bin_size": 100.0, "output": "position"},
            {"name": "bouts_to_states", "source": "social", "output": "social"},
            {"name": "labels_to_states", "source": "syllables", "output": "syllables"},
        ]
    ).run(sim)[0]
    path = tmp_path / ("sess" if ext == "dir" else "sess.zip")
    s.save(path)
    r = Session.load(path)
    assert np.array_equal(r.activity, s.activity) and np.array_equal(r.t, s.t)
    assert r.fs == s.fs and r.activity_kind == s.activity_kind and r.cell_ids == s.cell_ids
    assert set(r.masks) == set(s.masks) and set(r.signals) == set(s.signals)
    for k in s.masks:
        assert np.array_equal(r.masks[k], s.masks[k])
    for k in s.signals:
        assert np.array_equal(r.signals[k], s.signals[k], equal_nan=True)
    for k, st in s.states.items():
        o = r.states[k]
        assert np.array_equal(o.onehot, st.onehot) and o.state_names == st.state_names
        assert (o.kind, o.exclusive) == (st.kind, st.exclusive)
        assert np.array_equal(o.support, st.support)
        assert (o.topology is None) == (st.topology is None)
    topo: GridTopology = r.states["position"].topology
    assert topo.shape == s.states["position"].topology.shape
    for e1, e2 in zip(topo.edges, s.states["position"].topology.edges, strict=True):
        assert np.array_equal(e1, e2)
    bt, bt2 = s.behavior["social"], r.behavior["social"]
    assert isinstance(bt2, BoutTable) and bt2.labels == bt.labels
    assert np.array_equal(bt2.start_s, bt.start_s) and bt2.scored_stop_s == bt.scored_stop_s
    assert set(r.behavior) == set(s.behavior)
    assert r.meta["transforms"][0]["name"] == "resample_signal"
    gt = s.meta.get("ground_truth")
    if gt is not None:
        assert set(r.meta["ground_truth"]) == set(gt)


def test_pipeline_yaml_path_roundtrip(tmp_path):
    pipe = _named_pipeline()
    f = tmp_path / "p.yaml"
    text = pipe.to_yaml(f)
    assert f.read_text() == text
    for src in (f, str(f), text):
        assert Pipeline.from_yaml(src).to_dict() == pipe.to_dict()
    with pytest.raises(FileNotFoundError):
        Pipeline.from_yaml(str(tmp_path / "missing.yaml"))


# ------------------------------------------------------------------ Part 5


def test_missing_signal_messages_point_to_resample():
    s = Session(activity=np.ones((1, 10)), t=np.arange(10) / FS, fs=FS)
    for tr in (BinGrid(signals=["x"], n_bins=2), cabana.Speed()):
        with pytest.raises(KeyError, match=r"resample_signal\(source=\.\.\.\)"):
            tr.apply(s)


def test_session_warns_on_fs_and_negative_activity():
    t = np.arange(50) / FS
    with pytest.warns(UserWarning, match="disagrees"):
        Session(activity=np.ones((1, 50)), t=t, fs=1.0)
    with pytest.warns(UserWarning, match="negative"):
        Session(activity=-np.ones((1, 50)), t=t, fs=FS, activity_kind="spike_counts")
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        Session(activity=-np.ones((1, 50)), t=t, fs=FS, activity_kind="dff")


def test_draw_shifts_warning_names_parameter():
    with pytest.warns(UserWarning, match="min_shift_s"):
        cabana._nulls.draw_shifts(100, 500, 10, np.random.default_rng(0))


def test_plots_accept_either_argument_order():
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    sim = cabana.simulate_session(n_cells=6, duration_s=120, seed=3)
    s, rs = Pipeline(
        transforms=[
            {"name": "resample_signal", "source": "position"},
            {"name": "bin_grid", "signals": ["x", "y"], "bin_size": 100.0, "output": "position"},
        ],
        analyses=[AnalysisSpec(metric={"name": "information_content"}, states="position")],
    ).run(sim)
    r = rs.results[0]
    f1 = plots.plot_rate_maps(s, r, [0, 1])
    f2 = plots.plot_rate_maps(r, s, [0, 1])
    assert len(f1.axes) == len(f2.axes)
    with pytest.raises(TypeError):
        plots.plot_rate_maps(r, r, [0])
    plt.close("all")


def test_cross_session_result_summary_and_repr():
    cs = CrossSessionResult(
        kind="map",
        session_a="a",
        session_b="b",
        observed=np.arange(5.0),
        null=np.zeros((5, 4)),
        p_value=np.full(5, 0.2),
        significant=np.array([1, 0, 0, 0, 1], bool),
        pairs=np.zeros((5, 2), int),
        n_shuffles=4,
        median_observed=2.0,
        null_median=np.zeros(4),
        p_population=0.01,
    )
    d = cs.summary()
    assert d["n_entries"] == 5 and d["n_significant"] == 2 and d["median_observed"] == 2.0
    r = repr(cs)
    assert "CrossSessionResult" in r and "array" not in r and len(r) < 200
