"""Multiple-comparison corrections: adjust_p_values, ShuffleConfig.correction, significant_cells."""

from __future__ import annotations

import numpy as np
import pytest

import cabana
from cabana import AnalysisSpec, Pipeline, ShuffleConfig, build
from cabana._io import load_results, save_results
from cabana._posthoc import significant_cells
from cabana._shuffle import adjust_p_values


def _run(session, metric, states, **shuffle):
    shuffle.setdefault("n_shuffles", 200)
    pipe = Pipeline(
        transforms=[],
        analyses=[
            AnalysisSpec(metric=metric, states=states, shuffle=ShuffleConfig(**shuffle)),
        ],
    )
    return pipe.run(session)[1].results[0]


@pytest.fixture(scope="module")
def noise_session():
    s = cabana.simulate_session(duration_s=600, n_cells=120, seed=1)
    for spec in (
        {"name": "bouts_to_states", "source": "social"},
        {"name": "labels_to_states", "source": "syllables"},
    ):
        s = build("transform", spec).apply(s)
    return s


def _untuned_fpr(session, field):
    unt = np.array(session.meta["ground_truth"]["untuned_cells"])
    hits = []
    for states in ("syllables", "social"):
        r = _run(session, {"name": "auroc"}, states, **field)
        sh = r.shuffle
        sig = sh.significant if field.get("correction", "none") == "none" else sh.significant_adj
        hits.append(sig[unt].any(axis=1))
    return float(np.concatenate(hits).mean())


def test_any_state_fpr_inflated_then_controlled(noise_session):
    assert _untuned_fpr(noise_session, {}) > 0.15
    assert _untuned_fpr(noise_session, {"correction": "max_stat"}) <= 0.10
    assert _untuned_fpr(noise_session, {"correction": "bh"}) <= 0.08


def test_planted_social_cells_still_detected_with_max_stat(noise_session):
    r = _run(noise_session, {"name": "auroc"}, "social", correction="max_stat")
    hit = [
        r.shuffle.significant_adj[d["cell"], r.state_index(d["behavior"])]
        for d in noise_session.meta["ground_truth"]["social_cells"]
    ]
    assert len(hit) >= 5
    assert np.mean(hit) >= 0.8


def test_adjust_p_values_bh_hand_computed():
    p = np.array([0.01, 0.04, np.nan, 0.03, 0.005])
    # sorted finite: .005 .01 .03 .04 (m=4) -> .02 .02 .04 .04
    np.testing.assert_allclose(
        adjust_p_values(p, "bh"), [0.02, 0.04, np.nan, 0.04, 0.02], equal_nan=True
    )
    np.testing.assert_allclose(
        adjust_p_values(p, "bonferroni"), [0.04, 0.16, np.nan, 0.12, 0.02], equal_nan=True
    )
    np.testing.assert_allclose(adjust_p_values(p, "none"), p, equal_nan=True)
    two = np.array([[0.01, 0.04], [0.5, np.nan]])
    np.testing.assert_allclose(
        adjust_p_values(two, "bonferroni", axis=1), [[0.02, 0.08], [0.5, np.nan]], equal_nan=True
    )
    np.testing.assert_allclose(
        adjust_p_values(two, "bonferroni", axis=0), [[0.02, 0.04], [1.0, np.nan]], equal_nan=True
    )
    with pytest.raises(ValueError):
        adjust_p_values(p, "max_stat")


def test_max_stat_adjusted_ge_raw_and_single_state_equal(noise_session):
    r = _run(noise_session, {"name": "auroc"}, "syllables", correction="max_stat")
    sh = r.shuffle
    ok = np.isfinite(sh.p_value)
    assert np.all(sh.p_adj[ok] >= sh.p_value[ok])
    assert np.array_equal(np.isnan(sh.p_adj), np.isnan(sh.p_value))
    assert sh.p_adj.max() <= 1.0
    # a family of one state: nothing to correct
    from cabana._metrics._auroc import AUROC
    from cabana._shuffle import shuffle_test

    st = noise_session.states["social"]
    onehot_one = type(st)(
        **{**st.model_dump(), "onehot": st.onehot[:, :1], "state_names": st.state_names[:1]}
    )
    res = shuffle_test(
        AUROC(),
        noise_session.activity,
        onehot_one,
        st.support,
        ShuffleConfig(n_shuffles=50, correction="max_stat", keep_null="none"),
        noise_session.fs,
    )
    assert res.p_value.shape[1] == 1
    np.testing.assert_array_equal(res.p_adj, res.p_value)


def test_max_stat_works_without_stored_null(noise_session):
    a = _run(noise_session, {"name": "auroc"}, "social", correction="max_stat")
    b = _run(noise_session, {"name": "auroc"}, "social", correction="max_stat", keep_null="none")
    assert b.shuffle.null is None
    np.testing.assert_array_equal(a.shuffle.p_adj, b.shuffle.p_adj)


def test_one_dimensional_scopes(small_session):
    metric = {"name": "information_content"}
    r = _run(small_session, metric, "position", n_shuffles=100, correction="bh")
    sh = r.shuffle
    assert sh.p_value.ndim == 1
    np.testing.assert_allclose(sh.p_adj, adjust_p_values(sh.p_value, "bh"), equal_nan=True)
    assert "applied across cells" in sh.correction_note
    r = _run(small_session, metric, "position", n_shuffles=100, correction="max_stat")
    np.testing.assert_array_equal(r.shuffle.p_adj, r.shuffle.p_value)
    assert "no-op" in r.shuffle.correction_note
    r = _run(
        small_session, metric, "position", n_shuffles=100, correction="bh", correction_scope="cells"
    )
    sh = r.shuffle
    np.testing.assert_allclose(sh.p_adj, adjust_p_values(sh.p_value, "bh"), equal_nan=True)
    assert np.all(sh.p_adj[np.isfinite(sh.p_value)] >= sh.p_value[np.isfinite(sh.p_value)])
    assert sh.correction_scope == "cells"


def test_max_stat_rejects_other_scopes():
    for scope in ("cells", "all"):
        with pytest.raises(ValueError, match="max_stat"):
            ShuffleConfig(correction="max_stat", correction_scope=scope)


def test_roundtrip_and_dataframe(noise_session, tmp_path):
    r = _run(noise_session, {"name": "auroc"}, "social", n_shuffles=100, correction="bh")
    rs = cabana.ResultSet()
    rs.add(r)
    save_results(rs, tmp_path / "out")
    r2 = load_results(tmp_path / "out").results[0]
    sh, sh2 = r.shuffle, r2.shuffle
    np.testing.assert_array_equal(sh2.p_adj, sh.p_adj)
    np.testing.assert_array_equal(sh2.significant_adj, sh.significant_adj)
    assert (sh2.correction, sh2.correction_scope) == ("bh", "states")
    df = r.to_dataframe()
    cols = list(df.columns)
    assert cols[cols.index("significant") + 1 : cols.index("significant") + 3] == [
        "p_adj",
        "significant_adj",
    ]
    assert cols.index("significant_adj") < cols.index("analysis")
    np.testing.assert_array_equal(df["p_adj"].to_numpy(), sh.p_adj.ravel())


def test_significant_cells_adjusted(noise_session):
    raw = _run(noise_session, {"name": "auroc"}, "syllables", n_shuffles=100)
    adj = _run(noise_session, {"name": "auroc"}, "syllables", n_shuffles=100, correction="max_stat")
    # no correction: default and adjusted=True coincide (p_adj == p)
    np.testing.assert_array_equal(significant_cells(raw), significant_cells(raw, adjusted=True))
    # correction set: default uses the adjusted p; adjusted=False forces raw
    np.testing.assert_array_equal(significant_cells(adj), adj.shuffle.significant_adj.any(axis=1))
    np.testing.assert_array_equal(
        significant_cells(adj, adjusted=False), adj.shuffle.significant.any(axis=1)
    )
    assert significant_cells(adj).sum() < significant_cells(adj, adjusted=False).sum()
    name = adj.state_names[0]
    np.testing.assert_array_equal(
        significant_cells(adj, state=name, alpha=0.01, adjusted=True),
        np.nan_to_num(adj.shuffle.p_adj[:, 0], nan=1.0) < 0.01,
    )


def _brute_min_p(observed, null, tail):
    """Reference Westfall-Young single-step min-p, plain loops (one cell)."""
    n, k = null.shape
    p_null = np.empty((n, k))
    for s in range(k):
        for i in range(n):
            ge = sum(null[j, s] >= null[i, s] for j in range(n))
            le = sum(null[j, s] <= null[i, s] for j in range(n))
            p_null[i, s] = {"upper": ge, "lower": le, "two": 2 * min(ge, le)}[tail] / n
    out = np.empty(k)
    for s in range(k):
        ge = sum(null[j, s] >= observed[s] for j in range(n))
        le = sum(null[j, s] <= observed[s] for j in range(n))
        p_obs = {"upper": ge + 1, "lower": le + 1, "two": 2 * min(ge + 1, le + 1)}[tail] / (n + 1)
        p_raw = {"upper": ge + 1, "lower": le + 1, "two": 2 * (min(ge, le) + 1)}[tail] / (n + 1)
        cnt = sum(p_null[i].min() <= min(p_obs, 1.0) for i in range(n))
        out[s] = max((cnt + 1) / (n + 1), min(p_raw, 1.0))
    return out


@pytest.mark.parametrize("tail", ["upper", "lower", "two"])
def test_min_p_matches_brute_force_tiny_example(tail):
    from cabana._shuffle import _max_stat_p, _p_values

    # 1 cell, 2 states, 5 shuffles (with a tie in state 0)
    null = np.array([[0.1, 0.5], [0.3, 0.2], [0.3, 0.9], [0.7, 0.4], [0.9, 0.6]])[:, None, :]
    observed = np.array([[0.95, 0.3]])
    p = _p_values(observed, null, tail)
    got = _max_stat_p(observed, null, tail, p)
    np.testing.assert_allclose(got[0], _brute_min_p(observed[0], null[:, 0], tail))
    if tail == "upper":
        # state 0: obs above every draw -> p_obs = 1/6; p_null(min over states) hand-computed:
        # state0 p_null = [1, 4/5, 4/5, 2/5, 1/5]; state1 p_null = [3/5, 1, 1/5, 4/5, 2/5]
        # minp = [3/5, 4/5, 1/5, 2/5, 1/5]; count(minp <= 1/6) = 0 -> (0+1)/6
        assert got[0, 0] == pytest.approx(1 / 6)


def test_min_p_matches_brute_force_random_with_nans():
    from cabana._shuffle import _max_stat_p, _p_values

    rng = np.random.default_rng(0)
    null = np.round(rng.normal(size=(40, 3, 4)), 1)  # rounded: plenty of ties
    null[3, 1, 2] = np.nan
    observed = np.round(rng.normal(size=(3, 4)), 1)
    p = _p_values(observed, null, "two")
    got = _max_stat_p(observed, null, "two", p)
    for c in (0, 2):  # cell 1 has a NaN draw: brute force assumes none
        np.testing.assert_allclose(got[c], _brute_min_p(observed[c], null[:, c], "two"))
    assert np.all(got[np.isfinite(got)] >= p[np.isfinite(got)])


def test_min_p_calibration_on_untuned_cells():
    hits = []
    for seed in (0, 1):
        s = cabana.simulate_session(seed=seed)
        s = build("transform", {"name": "bouts_to_states", "source": "social"}).apply(s)
        r = _run(s, {"name": "auroc"}, "social", n_shuffles=200, correction="max_stat").shuffle
        ok = np.isfinite(r.p_value)
        assert np.all(r.p_adj[ok] >= r.p_value[ok])
        unt = np.array(s.meta["ground_truth"]["untuned_cells"])
        hits.append(r.significant_adj[unt].any(axis=1))
    rate = float(np.concatenate(hits).mean())
    # nominal 0.05; the shift null is not perfectly exchangeable, hence the looser upper bound
    assert 0.01 <= rate <= 0.15, rate
