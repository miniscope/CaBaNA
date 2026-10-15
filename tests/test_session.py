import numpy as np
import pandas as pd
import pytest

from cabana import Session


def make(n_frames=100, n_cells=5, fps=20.0, **kw):
    args = dict(
        t=np.arange(n_frames) / fps,
        neural=np.zeros((n_frames, n_cells)),
        behavior=pd.DataFrame({"x": np.zeros(n_frames)}),
        cell_ids=np.arange(n_cells),
        neural_type="denoised",
    )
    args.update(kw)
    return Session(**args)


def test_shape_and_rate():
    s = make()
    assert (s.n_frames, s.n_cells) == (100, 5)
    assert s.fps == pytest.approx(20.0)
    assert s.duration_s == pytest.approx(99 / 20)


def test_transposed_neural_is_caught():
    with pytest.raises(ValueError, match="transpose"):
        make(neural=np.zeros((5, 100)))


def test_unaligned_behavior_is_caught():
    with pytest.raises(ValueError, match="aligned"):
        make(behavior=pd.DataFrame({"x": np.zeros(90)}))


def test_non_increasing_time_is_caught():
    t = np.arange(100) / 20.0
    t[50] = t[49]
    with pytest.raises(ValueError, match="frame 49"):
        make(t=t)


def test_duplicate_cell_ids_are_caught():
    with pytest.raises(ValueError, match="unique"):
        make(cell_ids=[0, 0, 1, 2, 3])


def test_with_neural_leaves_original_unchanged():
    s = make()
    s2 = s.with_neural(np.ones((100, 5)), step="convolved")
    assert s.neural.sum() == 0
    assert s2.neural.sum() == 500
    assert s.history == ()
    assert s2.history == ("convolved",)


def test_frozen():
    s = make()
    with pytest.raises(AttributeError):
        s.neural = np.ones((100, 5))


def test_neural_type_is_required():
    kw = dict(t=np.arange(3.0), neural=np.zeros((3, 2)),
              behavior=pd.DataFrame({"x": [0, 0, 0]}), cell_ids=np.arange(2))
    with pytest.raises(TypeError):
        Session(**kw)


def test_bad_neural_type_is_caught():
    with pytest.raises(ValueError, match="neural_type"):
        make(neural_type="dff")


def test_with_neural_keeps_neural_type_unless_told():
    s = make()
    assert s.with_neural(np.ones((100, 5)), step="x").neural_type == "denoised"
    d = s.with_neural(np.ones((100, 5)), step="deconvolved", neural_type="deconvolved")
    assert d.neural_type == "deconvolved"
    assert s.neural_type == "denoised"


def test_behavior_can_hold_numbers_labels_and_yes_no_columns():
    behavior = pd.DataFrame({
        "x": np.linspace(0, 60, 100),                 # continuous
        "zone": ["left"] * 50 + ["right"] * 50,       # a category per frame
        "investigating": [False] * 90 + [True] * 10,  # yes/no per frame
    })
    s = make(behavior=behavior)
    assert list(s.behavior.columns) == ["x", "zone", "investigating"]
    assert s.behavior.investigating.sum() == 10
    assert "behavior columns: x, zone, investigating" in repr(s)
