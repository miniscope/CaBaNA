"""Tests for the pluggable null distributions and their use in ``shuffle_test``."""

from __future__ import annotations

from typing import ClassVar

import numpy as np
import pytest

from cabana import (
    AnalysisSpec,
    BoutShuffle,
    CircularShift,
    LabelShuffle,
    Metric,
    Pipeline,
    ResultSet,
    StateSpace,
    check_plugin,
    build,
    register,
)
from cabana._nulls import CellShift, CovariateMatchedShift, WithinStateShuffle
from cabana._shuffle import ShuffleConfig, shifted_sums, shuffle_test

FS = 10.0


@register("metric")
class _NullsMeanPerState(Metric):
    """Mean activity per state, with a circular-shift fast path."""

    name: ClassVar[str] = "_test_nulls_mean_per_state"
    default_tail: ClassVar = "two"

    def compute(self, activity, states, mask, fs):
        m = states.masked(mask)
        return (activity @ m) / np.maximum(m.sum(0), 1)

    def compute_shifted(self, activity, states, mask, fs, shifts):
        m = states.masked(mask)
        return shifted_sums(activity, m, shifts) / np.maximum(m.sum(0), 1)


@register("metric")
class _NullsSignalMean(Metric):
    """Per-cell activity-weighted mean of a signal."""

    name: ClassVar[str] = "_test_nulls_signal_mean"
    input: ClassVar = "signal"
    default_tail: ClassVar = "two"

    def compute(self, activity, target, mask, fs):
        x = np.asarray(target, float)[mask]
        return activity[:, mask] @ x / max(mask.sum(), 1)


def _runs_states(rng: np.random.Generator, n_time: int, n_states: int, mean_run: int = 20):
    """Exclusive state space made of random-length runs of random states."""
    labels = np.empty(n_time, dtype=int)
    i = 0
    while i < n_time:
        n = int(rng.integers(mean_run // 2, mean_run * 3 // 2 + 1))
        labels[i : i + n] = rng.integers(0, n_states)
        i += n
    oh = np.zeros((n_time, n_states), bool)
    oh[np.arange(n_time), labels] = True
    return StateSpace(
        name="s",
        onehot=oh,
        state_names=[f"s{i}" for i in range(n_states)],
        kind="categorical",
        exclusive=True,
    )


def _row_codes(onehot: np.ndarray) -> np.ndarray:
    return np.sort(onehot.astype(np.int64) @ (1 << np.arange(onehot.shape[1])))


def _runs(col: np.ndarray) -> list[tuple[int, int]]:
    d = np.diff(np.concatenate([[0], col.astype(np.int8), [0]]))
    starts = np.flatnonzero(d == 1)
    ends = np.flatnonzero(d == -1)
    return list(zip(starts.tolist(), (ends - starts).tolist(), strict=True))


def _bout_states() -> tuple[StateSpace, np.ndarray]:
    """Non-overlapping bouts of two states inside a masked span [50, 350) of 400 frames."""
    n = 400
    oh = np.zeros((n, 2), bool)
    for a, b in [(60, 70), (120, 135), (200, 220)]:
        oh[a:b, 0] = True
    for a, b in [(90, 102), (250, 262)]:
        oh[a:b, 1] = True
    st = StateSpace(name="b", onehot=oh, state_names=["a", "b"], kind="bouts", exclusive=False)
    mask = np.zeros(n, bool)
    mask[50:350] = True
    return st, mask


# ------------------------------------------------------------------ config


def test_build_null_roundtrip() -> None:
    n = build("null", {"name": "label_shuffle", "block_s": 2.0})
    assert isinstance(n, LabelShuffle)
    assert n.to_dict() == {"name": "label_shuffle", "block_s": 2.0}
    assert build("null", n.to_dict()) == n
    for spec in (CircularShift(min_shift_s=3.0), BoutShuffle(refractory_s=1.0)):
        assert build("null", spec.to_dict()) == spec


def test_shuffle_config_builds_null_from_dict() -> None:
    cfg = ShuffleConfig(null={"name": "bout_shuffle", "refractory_s": 0.5})
    assert isinstance(cfg.null, BoutShuffle)
    assert cfg.resolved_null() is cfg.null
    d = cfg.model_dump()
    assert d["null"] == {"name": "bout_shuffle", "refractory_s": 0.5}
    assert ShuffleConfig(**d).null == cfg.null


def test_shuffle_config_default_null_is_circular_shift() -> None:
    cfg = ShuffleConfig(min_shift_s=7.5)
    n = cfg.resolved_null()
    assert isinstance(n, CircularShift) and n.min_shift_s == 7.5
    assert cfg.model_dump()["null"] is None


# ------------------------------------------------------------- LabelShuffle


def test_label_shuffle_states_are_row_permutations() -> None:
    rng = np.random.default_rng(0)
    st = _runs_states(rng, 107, 4)  # not a multiple of the block
    act = rng.random((3, 107))
    null = LabelShuffle(block_s=2.0)
    out = list(null.surrogates(act, st, np.ones(107, bool), FS, 5, np.random.default_rng(1)))
    assert len(out) == 5
    changed = 0
    for act_s, st_s in out:
        assert act_s is act or np.array_equal(act_s, act)
        assert isinstance(st_s, StateSpace) and st_s.onehot.shape == st.onehot.shape
        assert np.array_equal(_row_codes(st_s.onehot), _row_codes(st.onehot))
        assert st_s.state_names == st.state_names and st_s.exclusive == st.exclusive
        changed += not np.array_equal(st_s.onehot, st.onehot)
    assert changed >= 4
    # the original is not modified
    assert np.array_equal(st.onehot, _runs_states(np.random.default_rng(0), 107, 4).onehot)


def test_label_shuffle_blocks_stay_contiguous_for_signal() -> None:
    n_time, block = 100, 20
    sig = np.arange(n_time, dtype=float)
    act = np.random.default_rng(0).random((2, n_time))
    null = LabelShuffle(block_s=block / FS)
    outs = list(null.surrogates(act, sig, np.ones(n_time, bool), FS, 6, np.random.default_rng(3)))
    moved = 0
    for act_s, sig_s in outs:
        assert np.array_equal(act_s, act)
        assert sig_s.shape == (n_time,)
        assert np.array_equal(np.sort(sig_s), sig)
        blocks = sig_s.reshape(-1, block)
        assert np.all(np.diff(blocks, axis=1) == 1)
        # each block starts at a multiple of the block length
        assert np.all(blocks[:, 0] % block == 0)
        moved += not np.array_equal(sig_s, sig)
    assert moved >= 5


def test_label_shuffle_2d_signal() -> None:
    sig = np.stack([np.arange(40.0), -np.arange(40.0)], axis=1)
    act = np.zeros((1, 40))
    (_, s), *_ = LabelShuffle(block_s=1.0).surrogates(
        act, sig, np.ones(40, bool), FS, 1, np.random.default_rng(0)
    )
    assert s.shape == (40, 2)
    assert np.array_equal(s[:, 0], -s[:, 1])


# -------------------------------------------------------------- BoutShuffle


def test_bout_shuffle_preserves_bouts_and_stays_in_mask() -> None:
    st, mask = _bout_states()
    act = np.random.default_rng(0).random((2, st.n_time))
    null = BoutShuffle(refractory_s=0.5)
    orig_lengths = [sorted(L for _, L in _runs(st.onehot[:, s])) for s in range(2)]
    seen_different = 0
    for act_s, st_s in null.surrogates(act, st, mask, FS, 30, np.random.default_rng(2)):
        assert act_s is act or np.array_equal(act_s, act)
        assert st_s.exclusive is False
        assert st_s.state_names == st.state_names and st_s.n_time == st.n_time
        assert not st_s.onehot[~mask].any()
        for s in range(2):
            runs = _runs(st_s.onehot[:, s])
            assert sorted(L for _, L in runs) == orig_lengths[s]
            # no overlap: total True frames equals the sum of bout lengths
            assert st_s.onehot[:, s].sum() == sum(L for _, L in runs)
        seen_different += not np.array_equal(st_s.onehot, st.onehot)
    assert seen_different >= 25
    assert st.exclusive is False  # original untouched


def test_label_shuffle_permutes_only_within_mask() -> None:
    n = 120
    mask = np.zeros(n, bool)
    mask[20:50] = True
    mask[70:110] = True
    sig = np.arange(n, dtype=float)
    act = np.zeros((1, n))
    null = LabelShuffle(block_s=0.5)  # 5-frame blocks
    moved = 0
    for _, s in null.surrogates(act, sig, mask, FS, 8, np.random.default_rng(0)):
        assert np.array_equal(s[~mask], sig[~mask])
        assert np.array_equal(np.sort(s[mask]), sig[mask])
        moved += not np.array_equal(s, sig)
    assert moved >= 7
    # states: masked frames per state unchanged
    st = _runs_states(np.random.default_rng(1), n, 3)
    for _, s_st in null.surrogates(act, st, mask, FS, 5, np.random.default_rng(2)):
        assert np.array_equal(s_st.onehot[~mask], st.onehot[~mask])
        assert np.array_equal(s_st.onehot[mask].sum(axis=0), st.onehot[mask].sum(axis=0))


def test_bout_shuffle_exclusive_stays_exclusive() -> None:
    n = 600
    oh = np.zeros((n, 3), bool)
    for k, (a, b) in enumerate(
        [(10, 30), (60, 80), (100, 115), (200, 230), (300, 310), (400, 420)]
    ):
        oh[a:b, k % 3] = True
    st = StateSpace(
        name="e", onehot=oh, state_names=["a", "b", "c"], kind="categorical", exclusive=True
    )
    mask = np.ones(n, bool)
    for _, s in BoutShuffle(refractory_s=0.5).surrogates(
        np.zeros((1, n)), st, mask, FS, 20, np.random.default_rng(0)
    ):
        assert s.exclusive is True
        assert s.onehot.sum(axis=1).max() <= 1
        assert s.onehot.sum(axis=0).tolist() == oh.sum(axis=0).tolist()


def test_bout_shuffle_preserves_masked_occupancy_and_no_warning_when_sparse() -> None:
    import warnings

    st, mask = _bout_states()
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        for _, s in BoutShuffle(refractory_s=0.5).surrogates(
            np.zeros((1, 400)), st, mask, FS, 30, np.random.default_rng(4)
        ):
            assert not s.onehot[~mask].any()
            assert s.onehot.sum(axis=0).tolist() == st.onehot.sum(axis=0).tolist()


def test_bout_shuffle_only_replaces_bouts_inside_mask() -> None:
    n = 300
    oh = np.zeros((n, 1), bool)
    oh[5:25, 0] = True  # outside the mask -> stays
    oh[150:160, 0] = True  # inside -> moves
    st = StateSpace(name="b", onehot=oh, state_names=["a"], kind="bouts", exclusive=False)
    mask = np.zeros(n, bool)
    mask[100:250] = True
    for _, s in BoutShuffle(refractory_s=0.0).surrogates(
        np.zeros((1, n)), st, mask, FS, 10, np.random.default_rng(0)
    ):
        assert np.array_equal(s.onehot[:100], oh[:100])
        assert s.onehot[100:250].sum() == 10 and not s.onehot[250:].any()


def test_bout_shuffle_warns_when_too_dense() -> None:
    n = 100
    oh = np.zeros((n, 1), bool)
    oh[0:40, 0] = True
    oh[50:90, 0] = True  # 80 of 100 frames
    st = StateSpace(name="b", onehot=oh, state_names=["a"], kind="bouts", exclusive=False)
    mask = np.zeros(n, bool)
    mask[0:70] = True  # two 40-frame bouts cannot fit in 70 frames without overlap
    cfg = ShuffleConfig(
        n_shuffles=5, null={"name": "bout_shuffle", "refractory_s": 0.0}, batch_size=2
    )
    # each surrogate warns; shuffle_test de-duplicates to one warning per call
    with pytest.warns(UserWarning, match="too dense") as rec:
        res = shuffle_test(
            build("metric", {"name": "mean_per_state"}), np.ones((1, n)), st, mask, cfg, FS
        )
    assert res.null is not None and len([w for w in rec if "too dense" in str(w.message)]) == 1


def test_bout_shuffle_rejects_signal_target() -> None:
    null = BoutShuffle()
    metric = _NullsSignalMean()
    with pytest.raises(ValueError, match="StateSpace"):
        null.check_target(metric, np.zeros(20))
    rng = np.random.default_rng(0)
    cfg = ShuffleConfig(n_shuffles=5, null={"name": "bout_shuffle"})
    with pytest.raises(ValueError):
        shuffle_test(metric, rng.random((2, 20)), np.zeros(20), np.ones(20, bool), cfg, FS)


# ------------------------------------------------------- shuffle_test usage

NULL_SPECS = [
    {"name": "circular_shift", "min_shift_s": 5.0},
    {"name": "label_shuffle", "block_s": 2.0},
    {"name": "bout_shuffle", "refractory_s": 0.5},
]


def _poisson_setup(tuned: bool):
    rng = np.random.default_rng(11)
    n_time, n_cells, n_states = 3000, 200, 4
    st = _runs_states(rng, n_time, n_states)
    rate = np.full((n_cells, n_time), 0.3)
    if tuned:
        rate[0, st.onehot[:, 1]] = 1.5
    act = rng.poisson(rate).astype(float)
    return act, st, np.ones(n_time, bool)


@pytest.mark.parametrize("spec", NULL_SPECS, ids=lambda s: s["name"])
def test_false_positive_rate_is_near_alpha(spec) -> None:
    act, st, mask = _poisson_setup(tuned=False)
    cfg = ShuffleConfig(n_shuffles=200, null=spec, seed=4, alpha=0.05)
    res = shuffle_test(_NullsMeanPerState(), act, st, mask, cfg, FS)
    assert res.observed.shape == (200, 4) and res.null.shape == (200, 200, 4)
    assert res.tail == "two" and res.null_name == spec["name"]
    fpr = res.significant.mean()
    assert 0.02 <= fpr <= 0.09, fpr
    if spec["name"] == "circular_shift":
        assert res.shifts is not None and res.shifts.shape == (200,)
    else:
        assert res.shifts is None


@pytest.mark.parametrize("spec", NULL_SPECS, ids=lambda s: s["name"])
def test_planted_tuned_cell_is_detected(spec) -> None:
    act, st, mask = _poisson_setup(tuned=True)
    cfg = ShuffleConfig(n_shuffles=200, null=spec, seed=4)
    res = shuffle_test(_NullsMeanPerState(), act, st, mask, cfg, FS)
    assert res.p_value[0, 1] < 0.05
    assert res.significant[0, 1]
    assert res.observed[0, 1] > res.null_hi[0, 1]


def test_label_shuffle_on_signal_target_via_shuffle_test() -> None:
    rng = np.random.default_rng(5)
    n_time = 600
    sig = np.cumsum(rng.normal(size=n_time))
    act = rng.random((3, n_time))
    cfg = ShuffleConfig(n_shuffles=20, null={"name": "label_shuffle", "block_s": 1.0})
    res = shuffle_test(_NullsSignalMean(), act, sig, np.ones(n_time, bool), cfg, FS)
    assert res.null.shape == (20, 3) and res.shifts is None
    assert res.null_name == "label_shuffle"


# ------------------------------------------------------------ reproducibility


@pytest.mark.filterwarnings("ignore:bout_shuffle")
@pytest.mark.parametrize("spec", NULL_SPECS, ids=lambda s: s["name"])
def test_same_seed_gives_identical_surrogates(spec) -> None:
    rng = np.random.default_rng(0)
    st = _runs_states(rng, 400, 3)
    act = rng.random((2, 400))
    mask = np.ones(400, bool)
    null = build("null", spec)

    def run(seed: int):
        return list(null.surrogates(act, st, mask, FS, 6, np.random.default_rng(seed)))

    a, b, c = run(7), run(7), run(8)
    for (a_act, a_t), (b_act, b_t) in zip(a, b, strict=True):
        assert np.array_equal(a_act, b_act)
        assert np.array_equal(a_t.onehot, b_t.onehot)
    assert any(
        not (np.array_equal(x[0], y[0]) and np.array_equal(x[1].onehot, y[1].onehot))
        for x, y in zip(a, c, strict=True)
    )


@pytest.mark.parametrize("spec", NULL_SPECS, ids=lambda s: s["name"])
def test_shuffle_test_same_seed_identical_null(spec) -> None:
    act, st, mask = _poisson_setup(tuned=False)
    act = act[:10]
    cfg = ShuffleConfig(n_shuffles=30, null=spec, seed=9)
    r1 = shuffle_test(_NullsMeanPerState(), act, st, mask, cfg, FS)
    r2 = shuffle_test(_NullsMeanPerState(), act, st, mask, cfg, FS)
    assert np.array_equal(r1.null, r2.null, equal_nan=True)
    assert np.array_equal(r1.p_value, r2.p_value, equal_nan=True)


# ------------------------------------------------------- phase E nulls


def _cms_pipeline(**null_kw):
    null = {"name": "covariate_matched_shift", "covariate": "speed", "min_frames": 200}
    null.update(null_kw)
    return Pipeline(
        analyses=[
            AnalysisSpec(
                metric={"name": "information_content"},
                states="position",
                shuffle=ShuffleConfig(n_shuffles=30, null=null, seed=0),
            )
        ]
    )


def test_new_nulls_exported_and_registered() -> None:
    for name, cls in [
        ("covariate_matched_shift", CovariateMatchedShift),
        ("cell_shift", CellShift),
        ("within_state_shuffle", WithinStateShuffle),
    ]:
        assert type(build("null", {"name": name})) is cls
    assert issubclass(CovariateMatchedShift, CircularShift)


def test_covariate_matched_shift_pipeline(small_session, tmp_path) -> None:
    pipe = _cms_pipeline(tolerance=0.35)
    _, rs = pipe.run(small_session)
    sh = rs.results[0].shuffle
    info = sh.null_info
    assert 0 < info["acceptance_rate"] <= 1
    assert info["balance_max"] <= 0.35 + 1e-12
    assert info["covariate"] == "speed" and info["statistic"] == "ks"
    assert info["tolerance"] == 0.35 and info["n_candidates"] >= 30
    assert sh.shifts.shape == (30,)
    min_shift = int(round(20.0 * small_session.fs))
    assert (sh.shifts >= min_shift).all()
    assert (sh.shifts <= small_session.n_time - min_shift).all()
    assert sh.null_name == "covariate_matched_shift"

    # the point of the null: better covariate balance than unconstrained shifts
    spec = pipe.analyses[0]
    bound = spec.shuffle.resolved_null().configure(small_session, spec)
    rng = np.random.default_rng(0)
    free = CircularShift().draw(small_session.n_time, small_session.fs, 30, rng)
    assert info["balance_mean"] < bound.balance(free).mean()

    # n_jobs independence
    _, rs4 = pipe.run(small_session, n_jobs=4)
    np.testing.assert_array_equal(rs4.results[0].shuffle.null, sh.null)
    np.testing.assert_array_equal(rs4.results[0].shuffle.shifts, sh.shifts)

    # null_info and null_std survive save / load
    rs.save(tmp_path / "rs")
    back = ResultSet.load(tmp_path / "rs")
    sh2 = back.results[0].shuffle
    assert sh2.null_info == info
    np.testing.assert_allclose(sh2.null_std, sh.null_std)


def test_covariate_matched_shift_mean_statistic(small_session) -> None:
    _, rs = _cms_pipeline(statistic="mean", tolerance=0.5, min_frames=400).run(small_session)
    info = rs.results[0].shuffle.null_info
    assert info["statistic"] == "mean" and info["balance_max"] <= 0.5 + 1e-12


def test_covariate_matched_shift_deterministic(small_session) -> None:
    pipe = _cms_pipeline(tolerance=0.35)
    spec = pipe.analyses[0]
    bound = spec.shuffle.resolved_null().configure(small_session, spec)
    a = bound.draw(small_session.n_time, small_session.fs, 20, np.random.default_rng(5))
    b = bound.draw(small_session.n_time, small_session.fs, 20, np.random.default_rng(5))
    np.testing.assert_array_equal(a, b)


def test_covariate_matched_shift_unconfigured_raises() -> None:
    with pytest.raises(RuntimeError, match="needs the session"):
        CovariateMatchedShift().draw(1000, FS, 5, np.random.default_rng(0))


def test_covariate_matched_shift_impossible_tolerance(small_session) -> None:
    with pytest.raises(ValueError, match="acceptance rate"):
        _cms_pipeline(tolerance=1e-6).run(small_session)


def test_covariate_matched_shift_missing_covariate(small_session) -> None:
    with pytest.raises(KeyError, match="available signals"):
        _cms_pipeline(covariate="nope", tolerance=0.35).run(small_session)


def test_check_plugin_new_nulls(small_session) -> None:
    pipe = _cms_pipeline(tolerance=0.4, min_frames=50)
    spec = pipe.analyses[0]
    cms = spec.shuffle.resolved_null().configure(small_session, spec)
    target = small_session.states["position"]
    check_plugin(cms, small_session, target=target).raise_if_failed()
    check_plugin(CellShift(min_shift_s=1.0), small_session, target="social").raise_if_failed()
    check_plugin(WithinStateShuffle(), small_session, target="syllables").raise_if_failed()


def test_cell_shift_permutes_each_row_with_distinct_shifts() -> None:
    rng = np.random.default_rng(0)
    act = rng.normal(size=(12, 400))
    st = _runs_states(rng, 400, 3)
    null = CellShift(min_shift_s=2.0)
    out, tgt = null.surrogate(act, st, np.ones(400, bool), FS, np.random.default_rng(1))
    assert tgt is st and out.shape == act.shape
    np.testing.assert_array_equal(np.sort(out, axis=1), np.sort(act, axis=1))
    shifts = [int(np.flatnonzero(np.isclose(act[i], out[i][0]))[0]) for i in range(12)]
    assert len(set(shifts)) > 1
    ks = [
        next(k for k in range(400) if np.array_equal(np.roll(act[i], k), out[i])) for i in range(12)
    ]
    assert len(set(ks)) > 6
    assert all(20 <= k <= 380 for k in ks)
    again, _ = null.surrogate(act, st, np.ones(400, bool), FS, np.random.default_rng(1))
    other, _ = null.surrogate(act, st, np.ones(400, bool), FS, np.random.default_rng(2))
    np.testing.assert_array_equal(out, again)
    assert not np.array_equal(out, other)


def test_cell_shift_changes_state_means_and_breaks_correlation() -> None:
    rng = np.random.default_rng(3)
    n_time, n_cells = 2000, 15
    shared = np.convolve(rng.normal(size=n_time), np.ones(10) / 10, mode="same")
    act = shared[None] * 3 + 0.3 * rng.normal(size=(n_cells, n_time))
    st = _runs_states(rng, n_time, 3, mean_run=50)
    mask = np.ones(n_time, bool)
    mean_pc = build("metric", {"name": "mean_per_state"})
    obs = mean_pc.compute(act, st, mask, FS)
    out, _ = CellShift(min_shift_s=5.0).surrogate(act, st, mask, FS, np.random.default_rng(0))
    assert not np.allclose(mean_pc.compute(out, st, mask, FS), obs)

    def mean_abs_corr(a: np.ndarray) -> float:
        c = np.corrcoef(a)
        return float(np.abs(c[np.triu_indices(n_cells, 1)]).mean())

    assert mean_abs_corr(act) > 0.8
    assert mean_abs_corr(out) < 0.15


def test_within_state_shuffle_preserves_state_sums_and_outside_frames() -> None:
    rng = np.random.default_rng(0)
    n = 600
    act = rng.normal(size=(5, n))
    st = _runs_states(rng, n, 4)
    oh = st.onehot.copy()
    oh[100:150] = False  # frames in no state
    st = st.model_copy(update={"onehot": oh})
    mask = np.ones(n, bool)
    mask[300:360] = False
    null = WithinStateShuffle()
    out, tgt = null.surrogate(act, st, mask, FS, np.random.default_rng(1))
    assert tgt is st
    keep = ~(oh & mask[:, None]).any(1)
    np.testing.assert_array_equal(out[:, keep], act[:, keep])
    for s in range(4):
        idx = oh[:, s] & mask
        np.testing.assert_allclose(out[:, idx].sum(1), act[:, idx].sum(1))
        np.testing.assert_array_equal(np.sort(out[:, idx], axis=1), np.sort(act[:, idx], axis=1))
    assert not np.array_equal(out, act)
    # state-mean metric: null equals observed on every surrogate
    res = shuffle_test(
        build("metric", {"name": "mean_per_state"}),
        act,
        st,
        mask,
        ShuffleConfig(n_shuffles=5, null=null, seed=0),
        FS,
    )
    np.testing.assert_allclose(res.null, np.broadcast_to(res.observed, res.null.shape), atol=1e-10)


def test_within_state_shuffle_blocks_stay_contiguous() -> None:
    n = 400
    oh = np.zeros((n, 1), bool)
    oh[:] = True
    st = StateSpace(name="one", onehot=oh, state_names=["a"], kind="categorical", exclusive=True)
    act = np.arange(n, dtype=float)[None]
    out, _ = WithinStateShuffle(block_s=2.0).surrogate(
        act, st, np.ones(n, bool), FS, np.random.default_rng(0)
    )
    blocks = out[0].reshape(-1, 20)
    assert (np.diff(blocks, axis=1) == 1).all()  # each block is an unbroken run
    assert not np.array_equal(out, act)
    assert sorted(out[0]) == list(range(n))


def test_within_state_shuffle_check_target() -> None:
    null = WithinStateShuffle()
    met = build("metric", {"name": "mean_per_state"})
    non_excl = StateSpace(
        name="n",
        onehot=np.ones((10, 2), bool),
        state_names=["a", "b"],
        kind="bouts",
        exclusive=False,
    )
    with pytest.raises(ValueError, match="exclusive"):
        null.check_target(met, non_excl)
    with pytest.raises(ValueError, match="StateSpace"):
        null.check_target(met, np.zeros(10))
