"""``ShuffleResult.z_score`` / ``bias_corrected``, null_std retention and the ``z`` column."""

from __future__ import annotations

import numpy as np
import pytest

from cabana import MetricResult, ResultSet, ShuffleResult, StateSpace, build, check_plugin
from cabana._nulls import CellShift, CovariateMatchedShift, WithinStateShuffle
from cabana._shuffle import ShuffleConfig, shuffle_test

LEAD = [
    "metric",
    "target",
    "cell",
    "state",
    "value",
    "p_value",
    "null_lo",
    "null_hi",
    "significant",
    "p_adj",
    "significant_adj",
    "z",
]


def _shuffle(observed, null, **kw) -> ShuffleResult:
    observed = np.asarray(observed, float)
    null = None if null is None else np.asarray(null, float)
    shape = observed.shape
    base = dict(
        observed=observed,
        null=null,
        shifts=None,
        p_value=np.full(shape, 0.5),
        null_lo=np.zeros(shape),
        null_hi=np.ones(shape),
        significant=np.zeros(shape, bool),
        alpha=0.05,
        tail="upper",
        n_shuffles=0 if null is None else null.shape[0],
    )
    base.update(kw)
    return ShuffleResult(**base)


def test_z_score_matches_definition() -> None:
    rng = np.random.default_rng(0)
    null = rng.normal(2.0, 3.0, size=(200, 4))
    obs = np.array([5.0, 0.0, 2.0, 9.0])
    sh = _shuffle(obs, null, null_mean=null.mean(0), null_std=null.std(0, ddof=1))
    np.testing.assert_allclose(sh.z_score, (obs - null.mean(0)) / null.std(0, ddof=1))
    np.testing.assert_allclose(sh.bias_corrected, obs - null.mean(0))


def test_z_score_nan_where_undefined() -> None:
    obs = np.array([1.0, 2.0, 3.0])
    sh = _shuffle(
        obs,
        np.zeros((3, 3)),
        null_mean=np.array([0.0, 1.0, 1.0]),
        null_std=np.array([0.0, np.nan, 2.0]),
    )
    z = sh.z_score
    assert np.isnan(z[0]) and np.isnan(z[1]) and z[2] == 1.0
    missing = _shuffle(obs, None)
    assert np.isnan(missing.z_score).all() and np.isnan(missing.bias_corrected).all()
    no_std = _shuffle(obs, None, null_mean=np.zeros(3))
    assert np.isnan(no_std.z_score).all()
    np.testing.assert_allclose(no_std.bias_corrected, obs)


def test_null_std_kept_when_null_dropped(small_session) -> None:
    sess = small_session
    states = sess.states["syllables"]
    mask = sess.valid_mask([])
    met = build("metric", {"name": "mean_per_state"})
    cfg = ShuffleConfig(n_shuffles=20, min_shift_s=2.0, seed=1, keep_null="none")
    sh = shuffle_test(met, sess.activity, states, mask, cfg, sess.fs)
    assert sh.null is None and sh.null_std is not None
    assert np.isfinite(sh.z_score).any()
    full = shuffle_test(
        met, sess.activity, states, mask, cfg.model_copy(update={"keep_null": "full"}), sess.fs
    )
    np.testing.assert_allclose(sh.z_score, full.z_score, equal_nan=True)


def test_dataframe_has_z_column() -> None:
    rng = np.random.default_rng(1)
    # 1-D cell
    obs1 = np.array([1.0, 2.0, 3.0])
    sh1 = _shuffle(obs1, rng.normal(size=(50, 3)), null_mean=np.zeros(3), null_std=np.ones(3))
    r1 = MetricResult(metric="m1", target="t", level="cell", values=obs1, shuffle=sh1)
    df1 = r1.to_dataframe()
    assert list(df1.columns[: len(LEAD)]) == LEAD
    np.testing.assert_allclose(df1["z"], obs1)
    # 2-D cell
    obs2 = np.array([[1.0, 2.0], [3.0, 4.0], [5.0, 6.0]])
    sh2 = _shuffle(
        obs2, rng.normal(size=(50, 3, 2)), null_mean=np.zeros((3, 2)), null_std=np.full((3, 2), 2.0)
    )
    r2 = MetricResult(
        metric="m2", target="t", level="cell", values=obs2, shuffle=sh2, state_names=["a", "b"]
    )
    df2 = r2.to_dataframe()
    assert list(df2.columns[: len(LEAD)]) == LEAD
    np.testing.assert_allclose(df2["z"], obs2.ravel() / 2)
    # population 1-D
    obsp = np.array([0.5, 1.5])
    shp = _shuffle(obsp, rng.normal(size=(50, 2)), null_mean=np.zeros(2), null_std=np.ones(2))
    rp = MetricResult(
        metric="mp",
        target="t",
        level="population",
        values=obsp,
        shuffle=shp,
        state_names=["a", "b"],
    )
    dfp = rp.to_dataframe()
    assert list(dfp.columns[: len(LEAD)]) == LEAD
    np.testing.assert_allclose(dfp["z"], obsp)
    # no shuffle: NaN, and ResultSet concatenation keeps the column
    bare = MetricResult(metric="m3", target="t", level="cell", values=obs1)
    assert bare.to_dataframe()["z"].isna().all()
    popm = MetricResult(
        metric="pm", target="t", level="population", values=np.eye(2), state_names=["a", "b"]
    )
    assert popm.to_dataframe()["z"].isna().all()
    rs = ResultSet()
    for r in (r1, r2, rp):
        rs.add(r)
    assert "z" in rs.to_dataframe().columns
    assert "z" in ResultSet().to_dataframe().columns


@pytest.mark.parametrize(
    "plugin,target",
    [
        (CellShift(min_shift_s=1.0), "social"),
        (WithinStateShuffle(), "syllables"),
        (WithinStateShuffle(block_s=0.5), "syllables"),
    ],
)
def test_check_plugin_passes(small_session, plugin, target) -> None:
    check_plugin(plugin, small_session, target=target).raise_if_failed()


def test_check_plugin_passes_covariate_matched(small_session) -> None:
    spec = type("Spec", (), {"states": "social", "signal": None, "masks": None})()
    bound = CovariateMatchedShift(tolerance=0.5, min_frames=20).configure(small_session, spec)
    target: StateSpace = small_session.states["social"]
    check_plugin(bound, small_session, target=target).raise_if_failed()
