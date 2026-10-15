from pathlib import Path

import numpy as np
import pytest

from cabana.io import load_timestamps

EXAMPLE = Path(__file__).parent.parent / "example_data" / "simulated_3chamber"


def write(tmp_path, text, name="timeStamps.csv"):
    path = tmp_path / name
    path.write_text(text)
    return path


def test_frames_and_times_in_seconds(tmp_path):
    path = write(tmp_path, "Frame Number,Time Stamp (ms),Buffer Index\n0,-22,0\n1,11,0\n2,44,0\n")
    frames, t = load_timestamps(path)
    assert frames.tolist() == [0, 1, 2]
    assert t == pytest.approx([-0.022, 0.011, 0.044])   # ms -> s, and a negative first frame is kept


def test_buffer_index_is_not_needed(tmp_path):
    path = write(tmp_path, "Frame Number,Time Stamp (ms)\n0,5\n1,38\n")
    frames, t = load_timestamps(path)
    assert t == pytest.approx([0.005, 0.038])


def test_accepts_a_string_path(tmp_path):
    path = write(tmp_path, "Frame Number,Time Stamp (ms)\n0,5\n")
    frames, t = load_timestamps(str(path))
    assert len(frames) == len(t) == 1


def test_missing_file_is_named(tmp_path):
    with pytest.raises(FileNotFoundError, match="nope.csv"):
        load_timestamps(tmp_path / "nope.csv")


def test_missing_column_is_named(tmp_path):
    path = write(tmp_path, "Frame Number,Buffer Index\n0,0\n")
    with pytest.raises(ValueError, match="Time Stamp"):
        load_timestamps(path)


def test_header_only_file_is_caught(tmp_path):
    path = write(tmp_path, "Frame Number,Time Stamp (ms),Buffer Index\n")
    with pytest.raises(ValueError, match="no rows"):
        load_timestamps(path)


def test_empty_value_is_caught(tmp_path):
    path = write(tmp_path, "Frame Number,Time Stamp (ms)\n0,5\n1,\n")
    with pytest.raises(ValueError, match="empty values"):
        load_timestamps(path)


def test_the_two_example_clocks_load():
    frames_n, t_n = load_timestamps(EXAMPLE / "neural_timestamps.csv")
    frames_b, t_b = load_timestamps(EXAMPLE / "behavior_timestamps.csv")
    assert (len(t_n), len(t_b)) == (9000, 15002)
    assert t_n[0] < 0 and t_b[0] < 0                         # both start just before zero
    assert frames_n.tolist() == list(range(9000))
    assert np.all(np.diff(t_n) > 0) and np.all(np.diff(t_b) > 0)
