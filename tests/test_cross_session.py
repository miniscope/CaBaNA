"""Cross-session map/PV correlation and cell-match containers."""

from __future__ import annotations

import numpy as np
import pytest

from cabana import Pipeline, ShuffleConfig, simulate_session
from cabana._cohort_models import CellMatch, SessionSet
from cabana._cross_session import (
    cross_session_map_correlation,
    cross_session_pv_correlation,
    remapping_summary,
)
from cabana._pipeline import AnalysisSpec
from cabana._plots_cohort import plot_cross_session
from cabana._results import MetricResult

NAMES = [f"s{i}" for i in range(30)]


def res(maps, names=NAMES):
    return MetricResult(
        metric="information_content", target="position", level="cell",
        values=np.zeros(maps.shape[0]), extras={"rate_map": maps}, state_names=list(names),
    )


def test_cellmatch_validation():
    m = CellMatch(session_a="a", session_b="b", pairs=[[0, 1], [2, 0]], confidence=[0.9, 0.4])
    assert m.pairs.shape == (2, 2)
    assert m.subset(0.5).n_pairs == 1
    inv = m.inverse()
    assert inv.session_a == "b" and inv.pairs.tolist() == [[1, 0], [0, 2]]
    with pytest.raises(ValueError):
        CellMatch(session_a="a", session_b="b", pairs=np.zeros((3, 3), int))
    with pytest.raises(ValueError, match="duplicate"):
        CellMatch(session_a="a", session_b="b", pairs=[[0, 1], [0, 2]])
    with pytest.raises(ValueError):
        CellMatch(session_a="a", session_b="b", pairs=[[0, 1]], confidence=[0.1, 0.2])
    with pytest.raises(ValueError):
        CellMatch(session_a="a", session_b="b", pairs=[[0, 1]]).subset(0.5)


def test_sessionset():
    s = simulate_session(duration_s=20, n_cells=5, seed=0)
    ss = SessionSet(
        sessions={"a": s, "b": s}, animal={"a": "m1", "b": "m2"},
        matches=[CellMatch(session_a="a", session_b="b", pairs=[[0, 1], [1, 2]])],
    )
    assert ss.animals == ["m1", "m2"] and ss.sessions_of("m1") == ["a"]
    assert ss.match("b", "a").pairs.tolist() == [[1, 0], [2, 1]]
    with pytest.raises(KeyError):
        ss.match("a", "c")
    with pytest.raises(ValueError, match="animal"):
        SessionSet(sessions={"a": s}, animal={})
    with pytest.raises(ValueError, match="unknown session"):
        SessionSet(sessions={"a": s}, animal={"a": "m"},
                   matches=[CellMatch(session_a="a", session_b="z", pairs=[[0, 0]])])
    with pytest.raises(ValueError, match="outside"):
        SessionSet(sessions={"a": s}, animal={"a": "m"},
                   matches=[CellMatch(session_a="a", session_b="a", pairs=[[0, 9]])])


def test_identical_maps_vs_random(tmp_path):
    rng = np.random.default_rng(0)
    A = rng.random((20, 30))
    match = CellMatch(session_a="a", session_b="b", pairs=np.c_[np.arange(20), np.arange(20)])
    cs = cross_session_map_correlation(res(A), res(A), match, n_shuffles=200)
    assert np.allclose(cs.observed, 1)
    assert cs.null.shape == (20, 19)
    assert np.allclose(cs.p_value, 1 / 20)  # exact floor: 1 / n_pairs
    assert cs.p_population < 0.01
    summ = remapping_summary(cs, alpha=0.1)
    assert summ["fraction_stable"] == 1.0 and summ["n_pairs"] == 20
    assert len(cs.to_dataframe()) == 20
    plot_cross_session(cs).savefig(tmp_path / "cs.png")

    cs2 = cross_session_map_correlation(res(A), res(rng.random((20, 30))), match, n_shuffles=200)
    assert cs2.p_population > 0.05
    assert abs(cs2.p_value.mean() - 0.5) < 0.2


def test_planted_random_pair_has_larger_p():
    rng = np.random.default_rng(5)
    A = rng.random((20, 30))
    B = A.copy()
    B[7] = rng.random(30)  # one broken pair
    match = CellMatch(session_a="a", session_b="b", pairs=np.c_[np.arange(20), np.arange(20)])
    cs = cross_session_map_correlation(res(A), res(B), match, n_shuffles=50)
    others = np.delete(cs.p_value, 7)
    assert np.allclose(others, 1 / 20)
    assert cs.p_value[7] > 3 / 20


def test_pearson_near_constant_is_nan():
    from cabana._cross_session import _pearson_rows

    a = np.full((1, 10), 0.1 + 0.2)  # constant with float noise
    a[0, 3] += 1e-17
    b = np.arange(10.0)[None]
    assert np.isnan(_pearson_rows(a * 1e6, b, 3)).all()
    assert np.isnan(_pearson_rows(np.full((1, 10), 0.3), b, 3)).all()


def test_pv_p_ignores_nan_null_draws():
    from cabana._cross_session import _upper_p

    null = np.array([[0.5], [np.nan], [0.1], [np.nan]])
    p = _upper_p(np.array([0.4]), null)
    assert p[0] == pytest.approx((1 + 1) / (1 + 2))
    assert np.isnan(_upper_p(np.array([0.4]), np.full((3, 1), np.nan))[0])


def test_null_reproducible_and_nan_handling():
    rng = np.random.default_rng(1)
    A, B = rng.random((10, 30)), rng.random((10, 30))
    A[:, :5] = np.nan
    match = CellMatch(session_a="a", session_b="b", pairs=np.c_[np.arange(10), np.arange(10)])
    c1 = cross_session_map_correlation(res(A), res(B), match, n_shuffles=50, seed=3)
    assert c1.null.shape == (10, 9)
    c2 = cross_session_map_correlation(res(A), res(B), match, n_shuffles=50, seed=3)
    c3 = cross_session_map_correlation(res(A), res(B), match, n_shuffles=50, seed=4)
    assert np.array_equal(c1.null, c2.null, equal_nan=True)
    assert np.array_equal(c1.null, c3.null, equal_nan=True)  # per-pair null is exact
    assert not np.array_equal(c1.null_median, c3.null_median, equal_nan=True)
    assert np.isfinite(c1.observed).all()
    A[0, 3:] = np.nan  # only 0 valid states left for cell 0
    c4 = cross_session_map_correlation(res(A), res(B), match, n_shuffles=10)
    assert np.isnan(c4.observed[0]) and np.isnan(c4.p_value[0])


def test_mismatched_inputs_raise():
    A = np.random.default_rng(0).random((4, 30))
    match = CellMatch(session_a="a", session_b="b", pairs=[[0, 0]])
    with pytest.raises(ValueError, match="state_names"):
        cross_session_map_correlation(res(A), res(A, names=NAMES[::-1]), match, n_shuffles=5)
    with pytest.raises(KeyError):
        cross_session_map_correlation(res(A), res(A), match, maps=("nope", "rate_map"), n_shuffles=5)


def test_topology_mismatch_raises():
    from cabana._models import GridTopology, StateSpace

    def space(width):
        topo = GridTopology(shape=(3,), edges=[np.linspace(0, width, 4)], axis_names=["x"])
        return StateSpace(name="p", onehot=np.eye(3, dtype=bool)[np.arange(6) % 3],
                          state_names=["0", "1", "2"], kind="grid", exclusive=True, topology=topo)

    A = np.random.default_rng(0).random((4, 3))
    r = res(A, names=["0", "1", "2"])
    match = CellMatch(session_a="a", session_b="b", pairs=[[0, 0], [1, 1], [2, 2]])
    cross_session_map_correlation(r, r, match, n_shuffles=5, states=(space(3), space(3)))
    with pytest.raises(ValueError, match="edges"):
        cross_session_map_correlation(r, r, match, n_shuffles=5, states=(space(3), space(4)))


def test_pv_correlation_hand_example():
    A = np.array([[1.0, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [0, 1, 1]])
    B = A.copy()
    B[:, 2] = B[::-1, 2]  # state 2 population vector scrambled
    match = CellMatch(session_a="a", session_b="b", pairs=np.c_[np.arange(5), np.arange(5)])
    cs = cross_session_pv_correlation(res(A, ["a", "b", "c"]), res(B, ["a", "b", "c"]), match,
                                      n_shuffles=100)
    assert np.allclose(cs.observed[:2], 1.0)
    pv2 = np.corrcoef(A[:, 2], B[:, 2])[0, 1]
    assert cs.observed[2] == pytest.approx(pv2)
    assert cs.null.shape == (100, 3) and cs.p_value.shape == (3,)
    assert cs.to_dataframe()["state"].tolist() == ["a", "b", "c"]


def _run(seed):
    pipe = Pipeline(
        transforms=[
            {"name": "resample_signal", "source": "position"},
            {"name": "speed"},
            {"name": "bin_grid", "signals": ["x", "y"], "bin_size": 50.0, "output": "position"},
        ],
        analyses=[AnalysisSpec(metric={"name": "information_content"}, states="position",
                               shuffle=ShuffleConfig(n_shuffles=20, seed=0))],
    )
    _, rs = pipe.run(simulate_session(duration_s=300, n_cells=40, seed=seed))
    return rs.get("information_content", "position")


def test_end_to_end_same_vs_different_seed():
    a, a2, b = _run(0), _run(0), _run(1)
    match = CellMatch(session_a="a", session_b="b", pairs=np.c_[np.arange(40), np.arange(40)])
    same = cross_session_map_correlation(a, a2, match, n_shuffles=100)
    assert np.allclose(same.observed[np.isfinite(same.observed)], 1.0)
    diff = cross_session_map_correlation(a, b, match, n_shuffles=100)
    assert np.nanmedian(diff.observed) < np.nanmedian(same.observed)
    assert remapping_summary(diff)["fraction_stable"] < 1.0
