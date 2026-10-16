import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pytest
from scipy.stats import hypergeom
from sklearn.metrics import adjusted_rand_score

from cabana._plots_posthoc import plot_clusters, plot_overlap, plot_overlap_matrix
from cabana._posthoc import (
    overlap_matrix,
    overlap_vs_chance,
    response_clusters,
    response_features,
    significant_cells,
)
from cabana._results import MetricResult, ResultSet, ShuffleResult


def _sets(N, n_a, n_b, n_both):
    a = np.zeros(N, bool)
    b = np.zeros(N, bool)
    a[:n_a] = True
    b[n_a - n_both : n_a - n_both + n_b] = True
    return a, b


def test_overlap_hand_example():
    a, b = _sets(100, 20, 30, 12)
    o = overlap_vs_chance(a, b)
    assert (o.n_a, o.n_b, o.n_both, o.N) == (20, 30, 12, 100)
    assert o.expected == pytest.approx(6.0)
    rv = hypergeom(100, 20, 30)
    pmf = rv.pmf(np.arange(0, 21))
    p2 = pmf[pmf <= rv.pmf(12) * (1 + 1e-7)].sum()
    assert o.p_value == pytest.approx(p2, rel=1e-6)
    assert o.p_value >= rv.sf(11)
    assert o.jaccard == pytest.approx(12 / 38)
    assert o.jaccard_chance == pytest.approx(6 / 44)
    assert o.odds_ratio > 1
    assert "p_value" in o.to_dict()


def test_overlap_universe():
    a, b = _sets(100, 20, 30, 12)
    u = np.arange(100) < 50
    assert overlap_vs_chance(a, b, universe=u).N == 50


def test_overlap_null_pvalues():
    rng = np.random.default_rng(1)
    ps = []
    for _ in range(300):
        a = rng.random(200) < 0.3
        b = rng.random(200) < 0.3
        ps.append(overlap_vs_chance(a, b).p_value)
    frac = np.mean(np.array(ps) < 0.05)
    assert 0.01 < frac < 0.12


def _result(values, p, state_names=None, metric="auroc", null=None):
    values = np.asarray(values, float)
    p = np.asarray(p, float)
    if null is None:
        null = np.full((10, *values.shape), 0.5)
    sh = ShuffleResult(
        observed=values, null=null, shifts=None, p_value=p,
        null_lo=np.full(values.shape, 0.4), null_hi=np.full(values.shape, 0.6),
        significant=p < 0.05, alpha=0.05, tail="two", n_shuffles=10,
    )
    return MetricResult(
        metric=metric, target="social", level="cell", values=values, shuffle=sh,
        state_names=state_names,
    )


def test_significant_cells_1d_and_2d():
    r1 = _result([0.9, 0.1, 0.5, 0.8], [0.01, 0.01, 0.9, 0.2])
    assert r1.shuffle.significant.tolist() == [True, True, False, False]
    assert significant_cells(r1).tolist() == [True, True, False, False]
    assert significant_cells(r1, sign="positive").tolist() == [True, False, False, False]
    assert significant_cells(r1, sign="negative").tolist() == [False, True, False, False]
    assert significant_cells(r1, alpha=0.3).tolist() == [True, True, False, True]

    vals = np.array([[0.9, 0.5], [0.5, 0.1], [0.5, 0.5]])
    p = np.array([[0.01, 0.9], [0.9, 0.01], [0.9, 0.9]])
    r2 = _result(vals, p, state_names=["a", "b"])
    assert significant_cells(r2).tolist() == [True, True, False]
    assert significant_cells(r2, "a").tolist() == [True, False, False]
    assert significant_cells(r2, 1, sign="negative").tolist() == [False, True, False]
    assert significant_cells(r2, "b", sign="positive").tolist() == [False, False, False]


def test_response_features():
    n = 6
    rng = np.random.default_rng(0)
    r1 = _result(rng.random((n, 3)), np.ones((n, 3)), state_names=["x", "y", "z"])
    r2 = _result(rng.random(n), np.ones(n), metric="mean_per_state")
    r2.values[2] = np.nan
    rs = ResultSet(results=[r1, r2])
    X, names, kept = response_features(rs)
    assert X.shape == (5, 4) and len(names) == 4
    assert 2 not in kept
    np.testing.assert_allclose(X.mean(0), 0, atol=1e-9)
    X2, _, _ = response_features(rs, which=[("auroc", "social")], standardize=False)
    assert X2.shape == (6, 3)
    r1.extras["peth"] = rng.random((n, 4, 5))
    X3, names3, _ = response_features([r1], use="peth")
    assert X3.shape == (6, 20) and len(names3) == 20


def _planted(seed=0):
    rng = np.random.default_rng(seed)
    centers = np.array([[0, 0, 0], [6, 0, 0], [0, 6, 6]], float)
    truth = np.repeat([0, 1, 2], 40)
    return centers[truth] + rng.normal(0, 0.5, (120, 3)), truth


@pytest.mark.parametrize("method", ["kmeans", "gmm", "hierarchical"])
def test_clusters_recover(method):
    X, truth = _planted()
    cr = response_clusters(X, method=method)
    assert cr.k == 3
    assert adjusted_rand_score(truth, cr.labels) > 0.9
    assert cr.cluster_means.shape == (3, 3)
    assert len(cr.to_dataframe()) == 3
    assert set(cr.scores) == set(range(2, 9))


def test_clusters_bic_and_errors():
    X, truth = _planted()
    cr = response_clusters(X, method="gmm", selection="bic")
    assert cr.k == 3
    with pytest.raises(ValueError):
        response_clusters(X, method="kmeans", selection="bic")
    assert response_clusters(X, k=2).k == 2


def test_plots(tmp_path):
    a, b = _sets(100, 20, 30, 12)
    o = overlap_vs_chance(a, b)
    plot_overlap(o, labels=("soc", "syl")).savefig(tmp_path / "o.png")
    df = overlap_matrix({"a": a, "b": b, "c": ~a})
    assert len(df) == 3
    plot_overlap_matrix(df).savefig(tmp_path / "m.png")
    X, _ = _planted()
    cr = response_clusters(X)
    plot_clusters(cr, [f"f{i}" for i in range(3)]).savefig(tmp_path / "c.png")
    _, ax = plt.subplots()
    plot_overlap(o, ax=ax)
    plt.close("all")
    assert (tmp_path / "c.png").exists()


def test_overlap_matrix_from_results():
    r = _result([0.9, 0.1, 0.5, 0.8], [0.01, 0.01, 0.9, 0.2])
    df = overlap_matrix([(r, None), (r, None)])
    assert len(df) == 1


def test_significant_cells_sign_with_nan_null_draws():
    vals = np.array([0.9, 0.1, 0.5])
    null = np.full((10, 3), 0.5)
    null[0] = np.nan  # a NaN draw must not turn the median into NaN
    null[1:4, 0] = np.nan
    r = _result(vals, [0.01, 0.01, 0.9], metric="mean_per_state", null=null)
    assert significant_cells(r, sign="positive").tolist() == [True, False, False]
    assert significant_cells(r, sign="negative").tolist() == [False, True, False]


def test_response_features_drops_all_nan_columns_with_warning():
    n = 6
    rng = np.random.default_rng(0)
    r1 = _result(rng.random((n, 2)), np.ones((n, 2)), state_names=["x", "y"])
    r1.values[:, 1] = np.nan  # undefined feature for every cell
    with pytest.warns(UserWarning, match="auroc:social:y"):
        X, names, kept = response_features([r1])
    assert X.shape == (n, 1) and names == ["auroc:social:x"] and len(kept) == n


def test_clusters_empty_component_guard(monkeypatch):
    import cabana._posthoc as ph

    X, truth = _planted()
    monkeypatch.setattr(ph, "_fit", lambda X, k, method, seed: np.where(truth == 2, 1, truth))
    cr = response_clusters(X, k=3, method="gmm")
    assert cr.sizes.tolist() == [40, 80, 0]
    assert np.isnan(cr.cluster_means[2]).all() and np.isfinite(cr.cluster_means[:2]).all()
    assert cr.to_dataframe()["n_cells"].tolist() == [40, 80, 0]
    cr2 = response_clusters(X, method="kmeans", k=3)
    assert cr2.sizes.sum() == len(X)
