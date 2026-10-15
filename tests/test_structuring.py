import numpy as np
import pytest

from cabana.structuring import epochs_from_frame_labels


def yn(*bits):
    """yes/no frame labels, one per frame"""
    return np.array(bits, dtype=bool)


def test_basic_stretches():
    on, off = epochs_from_frame_labels(yn(0, 1, 1, 0, 0, 1, 0))
    assert on.tolist() == [1, 5]
    assert off.tolist() == [3, 6]


def test_stretch_touching_both_edges():
    on, off = epochs_from_frame_labels(yn(1, 1, 0, 1, 1))
    assert on.tolist() == [0, 3]
    assert off.tolist() == [2, 5]


def test_all_true_and_all_false():
    on, off = epochs_from_frame_labels(yn(1, 1, 1))
    assert (on.tolist(), off.tolist()) == ([0], [3])
    on, off = epochs_from_frame_labels(yn(0, 0, 0))
    assert len(on) == 0 and len(off) == 0
    on, off = epochs_from_frame_labels(yn())
    assert len(on) == 0 and len(off) == 0


def test_slice_gives_the_stretch():
    labels = yn(0, 1, 1, 1, 0, 1)
    on, off = epochs_from_frame_labels(labels)
    for a, b in zip(on, off):
        assert labels[a:b].all()


def test_merge_gap():
    labels = yn(1, 1, 0, 1, 1, 0, 0, 1)
    on, off = epochs_from_frame_labels(labels, merge_gap=1)   # joins the 1-frame gap only
    assert on.tolist() == [0, 7] and off.tolist() == [5, 8]
    on, off = epochs_from_frame_labels(labels, merge_gap=2)   # joins both
    assert on.tolist() == [0] and off.tolist() == [8]


def test_min_len_applied_after_merging():
    labels = yn(1, 0, 1, 0, 0, 0, 1)
    # without merging all three stretches are 1 frame; merged, the first is 3
    on, off = epochs_from_frame_labels(labels, min_len=3, merge_gap=1)
    assert on.tolist() == [0] and off.tolist() == [3]
    on, off = epochs_from_frame_labels(labels, min_len=2)
    assert len(on) == 0


@pytest.mark.parametrize("bad", [np.array([0, 1, 1]), np.array([[True, False]]), np.array([True, False], dtype=object)])
def test_rejects_non_boolean_or_non_1d(bad):
    with pytest.raises(ValueError):
        epochs_from_frame_labels(bad)
