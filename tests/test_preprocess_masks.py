import numpy as np
import pytest

from cabana import AnalysisSpec, Pipeline, Session, ShuffleConfig, StateSpace, build
from cabana._preprocess_masks import (
    CleanMask,
    CombineMasks,
    MaskFromSignal,
    MaskFromState,
    clean_mask,
    mask_expression,
)

FS = 10.0
N = 20


def base():
    return Session(activity=np.ones((2, N)), t=np.arange(N) / FS, fs=FS)


def with_states():
    oh = np.zeros((N, 2), bool)
    oh[2:5, 0] = True  # sniff
    oh[8:10, 1] = True  # chase
    sup = np.ones(N, bool)
    sup[15:] = False
    ss = StateSpace(
        name="soc",
        onehot=oh,
        state_names=["sniff", "chase"],
        kind="bouts",
        exclusive=False,
        support=sup,
    )
    return base().replace(states={"soc": ss})


def test_mask_from_state_semantics():
    s = with_states()
    m = MaskFromState(states="soc", include=["sniff"], output="o").apply(s).masks["o"]
    assert m.sum() == 3 and m[2:5].all()
    m = MaskFromState(states="soc", output="o").apply(s).masks["o"]
    assert m.sum() == 5
    inv = MaskFromState(states="soc", include=["sniff"], invert=True, output="o").apply(s)
    assert inv.masks["o"].sum() == 15 - 3  # frames 15+ are outside support -> False
    assert not inv.masks["o"][15:].any()
    inv2 = MaskFromState(
        states="soc", include=["sniff"], invert=True, require_support=False, output="o"
    ).apply(s)
    assert inv2.masks["o"].sum() == N - 3
    with pytest.raises(KeyError):
        MaskFromState(states="soc", include=["nope"], output="o").apply(s)
    with pytest.raises(KeyError):
        MaskFromState(states="zzz", output="o").apply(s)


def test_expression_precedence_and_parens():
    a = np.array([1, 1, 0, 0], bool)
    b = np.array([1, 0, 1, 0], bool)
    c = np.array([0, 0, 0, 1], bool)
    ms = {"a": a, "b": b, "c": c}
    np.testing.assert_array_equal(mask_expression(ms, "a | b & c"), a | (b & c))
    np.testing.assert_array_equal(mask_expression(ms, "(a | b) & c"), (a | b) & c)
    np.testing.assert_array_equal(mask_expression(ms, "~a & b"), (~a) & b)
    np.testing.assert_array_equal(mask_expression(ms, "~(a & b)"), ~(a & b))
    np.testing.assert_array_equal(mask_expression(ms, "~~a"), a)


def test_expression_errors():
    ms = {"a": np.ones(3, bool)}
    with pytest.raises(KeyError, match="zzz"):
        mask_expression(ms, "a & zzz")
    for bad in ["", "a &", "(a", "a b", "a)", "__import__('os')", "a; b", "a ** a", "a.b", "1"]:
        with pytest.raises(ValueError):
            mask_expression(ms, bad)
    with pytest.raises(ValueError):
        CombineMasks(expr="a + b", output="o")


def test_combine_masks_step_and_info():
    s = with_states()
    s = MaskFromState(states="soc", include=["sniff"], output="sniff").apply(s)
    s = s.with_mask("speed", np.arange(N) % 2 == 0)
    out = CombineMasks(expr="speed & ~sniff", output="o").apply(s)
    exp = s.masks["speed"] & ~s.masks["sniff"]
    np.testing.assert_array_equal(out.masks["o"], exp)
    info = out.meta["mask_info"]["o"]
    assert info["n_true"] == exp.sum() and info["source"]["name"] == "combine_masks"
    assert info["source"]["expr"] == "speed & ~sniff"
    with pytest.raises(KeyError):
        CombineMasks(expr="speed & nope", output="o").apply(s)


def mk(idx, n=30):
    m = np.zeros(n, bool)
    m[idx] = True
    return m


def test_clean_mask_operations():
    # 10 frames/s: 0.3 s == 3 frames
    m = mk([2, 3, 4, 7, 8, 9, 10, 11, 12, 13])  # runs 2-4 (3), 7-13 (7), gap of 2
    assert clean_mask(m, FS, min_false_s=0.3)[2:14].all()  # gap 5-6 filled (2 < 3)
    assert clean_mask(m, FS, min_false_s=0.2)[5] == False  # noqa: E712  (2 !< 2)
    out = clean_mask(m, FS, min_true_s=0.4)
    assert out.sum() == 7 and not out[2:5].any()
    out = clean_mask(m, FS, erode_s=0.1)
    np.testing.assert_array_equal(np.flatnonzero(out), [3, 8, 9, 10, 11, 12])
    out = clean_mask(mk([10, 11]), FS, dilate_s=0.2)
    np.testing.assert_array_equal(np.flatnonzero(out), np.arange(8, 14))
    # leading/trailing False are not gaps
    assert clean_mask(mk([5]), FS, min_false_s=10.0).sum() == 1
    # fill -> drop: two 2-frame runs separated by a 1-frame gap survive min_true 0.5 s
    out = clean_mask(mk([2, 3, 5, 6]), FS, min_false_s=0.2, min_true_s=0.5)
    assert out.sum() == 5 and out[4]
    # erode keeps recording edges
    assert clean_mask(np.ones(10, bool), FS, erode_s=0.2).all()
    # input untouched
    assert m.sum() == 10


def test_clean_mask_step_overwrite_and_output():
    s = base().with_mask("m", mk([2, 3, 4, 8], N))
    out = CleanMask(mask="m", min_true_s=0.2).apply(s)
    assert out.masks["m"].sum() == 3 and s.masks["m"].sum() == 4
    out = CleanMask(mask="m", min_true_s=0.2, output="c").apply(s)
    assert out.masks["m"].sum() == 4 and out.masks["c"].sum() == 3
    assert out.meta["mask_info"]["c"]["source"]["name"] == "clean_mask"
    with pytest.raises(KeyError):
        CleanMask(mask="zz").apply(s)


def test_mask_from_signal():
    v = np.arange(N, dtype=float)
    v[3] = np.nan
    s = base().with_signal("d", v)
    out = MaskFromSignal(signal="d", min=5, max=10, output="o").apply(s).masks["o"]
    np.testing.assert_array_equal(np.flatnonzero(out), np.arange(5, 11))
    assert MaskFromSignal(signal="d", max=4, output="o").apply(s).masks["o"][3] == False  # noqa: E712
    assert MaskFromSignal(signal="d", max=4, nan_is=True, output="o").apply(s).masks["o"][3]
    two = base().with_signal("p", np.stack([v, np.ones(N)], axis=1))
    out = MaskFromSignal(signal="p", channel=1, min=0.9, output="o").apply(two).masks["o"]
    assert out.all()
    with pytest.raises(ValueError):
        MaskFromSignal(signal="d", output="o")
    with pytest.raises(ValueError):
        MaskFromSignal(signal="p", channel=2, min=0, output="o").apply(two)
    with pytest.raises(KeyError):
        MaskFromSignal(signal="zz", min=0, output="o").apply(s)


def test_registered_and_roundtrip():
    st = build("preprocess", {"name": "combine_masks", "expr": "a | b", "output": "o"})
    assert isinstance(st, CombineMasks)
    assert isinstance(
        build("preprocess", {"name": "mask_from_signal", "signal": "x", "min": 1, "output": "o"}),
        MaskFromSignal,
    )


def test_pipeline_uses_composed_mask(small_session):
    s = small_session
    s = MaskFromState(
        states="social", include=[s.states["social"].state_names[0]], invert=True, output="no_beh"
    ).apply(s)
    s = build("preprocess", {"name": "speed_threshold", "min_speed": 20.0}).apply(s)
    s = CombineMasks(expr="speed & no_beh", output="combo").apply(s)
    pipe = Pipeline(
        transforms=[],
        preprocess=[],
        analyses=[
            AnalysisSpec(
                name="a",
                metric={"name": "information_content"},
                states="position",
                masks=["speed"],
                shuffle=ShuffleConfig(n_shuffles=2, seed=0),
            ),
            AnalysisSpec(
                name="b",
                metric={"name": "information_content"},
                states="position",
                masks=["combo"],
                shuffle=ShuffleConfig(n_shuffles=2, seed=0),
            ),
        ],
    )
    _, rs = pipe.run(s, progress=False)
    pos = s.states["position"].support
    assert rs["b"].provenance["n_frames_used"] == int((s.masks["combo"] & pos).sum())
    assert rs["b"].provenance["n_frames_used"] < rs["a"].provenance["n_frames_used"]
