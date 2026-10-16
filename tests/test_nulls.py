"""Tests for the pluggable null distributions and their use in ``shuffle_test``."""

from __future__ import annotations

from typing import ClassVar

import numpy as np
import pytest

from cabana import (
    BoutShuffle,
    CircularShift,
    LabelShuffle,
    Metric,
    StateSpace,
    build,
    register,
)
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
    with pytest.warns(UserWarning, match="too dense") as rec:
        out = list(
            BoutShuffle(refractory_s=0.0).surrogates(
                np.zeros((1, n)), st, mask, FS, 5, np.random.default_rng(0)
            )
        )
    assert len(out) == 5 and len([w for w in rec if "too dense" in str(w.message)]) == 1


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
