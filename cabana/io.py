"""
cabana.io — read the input files and check them.

This module only reads files. It does not change what it reads; that is done in
cabana.structuring and cabana.processing.

Written:
    load_timestamps     read a timestamps file: frame numbers and times in seconds

Not written yet. Each will be written using the linked code as a reference.

load_neural(path) -> neural (n_frames, n_cells), cell_ids
    Check the file exists, pick the reader from the file extension, and stop with a
    clear error for a format that is not supported.
    pynapple, io/misc.py, load_file (L26-68)
    https://github.com/pynapple-org/pynapple/blob/7fdadfbc105bf5f380cd8a1eaf07fe3bb5bc0a7e/pynapple/io/misc.py#L26-L68
    neuro_py, io/matlab.py, load_mat (L20-39): reads both older and v7.3 .mat files
    https://github.com/ryanharvey1/neuro_py/blob/c614e1e807589d77482cdef6651c64f9ac7f07e7/neuro_py/io/matlab.py#L20-L39

load_position(path) -> DataFrame (frame, x, y), one row per behavior-camera frame
    Read a position file from tracking software (DeepLabCut, ezTrack) and turn the -1
    that marks a lost frame into NaN. The file has a frame column and no time column;
    the times come from the behavior timestamps file (load_timestamps), matched on
    frame number.
    neuro_py, io/loading.py (L1170-1199): carried over from the earlier load_behavior
    plan; check it still fits a plain CSV.
    https://github.com/ryanharvey1/neuro_py/blob/c614e1e807589d77482cdef6651c64f9ac7f07e7/neuro_py/io/loading.py#L1170-L1199

load_head_orientation(path) -> t (seconds), q (n_frames, 4) as qw, qx, qy, qz
    Miniscope V4 BNO headOrientation.csv: a Time Stamp (ms) column and a unit
    quaternion per miniscope frame. It is on the neural clock, with the same
    timestamps as the neural timestamps file, and has no frame column and no lost
    frames. Convert ms to seconds here, like load_timestamps. It does not turn the
    quaternion into an angle; that is cabana.processing (quaternion_to_head_orientation).

load_annotations(path) -> DataFrame (label, start_s, stop_s)
    Read a file of epochs. Annotations are always given as a start time and a stop time,
    in seconds, on the same time axis as the timestamps files. Used for the zone and
    investigation annotation files. Does not turn them into frame labels; that is
    cabana.structuring (epochs_to_frame_labels).

load_config(path) -> dict
    Read a YAML settings file.
    Representational_Dynamics_demo, src/repdyn/config.py, load_config (L7-9)
    https://github.com/UladzislauBarayeu/Representational_Dynamics_demo/blob/2d267d21066f6e59087427ecedde867c825e414c/src/repdyn/config.py#L7-L9

validate_inputs(...)
    Stop with a message that says exactly what is wrong. Checks: timestamps in
    increasing order in each timestamps file, required inputs present, no empty
    behavior column, annotation stop times after their start times, the frame column
    of the position file matches Frame Number in the behavior timestamps file, and
    the neural timestamps file and the head orientation file have the same number of
    rows and the same times.
    pynapple, core/time_index.py, sort_timestamps (L132-153): checks times are in
    order (it warns and sorts; CaBaNA should raise instead)
    https://github.com/pynapple-org/pynapple/blob/7fdadfbc105bf5f380cd8a1eaf07fe3bb5bc0a7e/pynapple/core/time_index.py#L132-L153
    neuro_py, process/peri_event.py (L1258 and L1290): ValueError when the signal or
    the times to cut around are missing
    https://github.com/ryanharvey1/neuro_py/blob/c614e1e807589d77482cdef6651c64f9ac7f07e7/neuro_py/process/peri_event.py#L1258
    Code_for_2025_Raam, roc_all.m (L56-64): warns when a behavior column is empty
    https://github.com/hongw-lab/Code_for_2025_Raam/blob/268c7a71c5812c7899cd8e79903931950f524139/roc_all.m#L56-L64
"""
from pathlib import Path

import pandas as pd


def load_timestamps(path):
    """
    Read a timestamps file in the Miniscope timeStamps.csv format.

    Used for both clocks. The neural timestamps and the behavior timestamps are
    separate files in the same format.

    Parameters
    ----------
    path : str or Path
        A CSV with a `Frame Number` column and a `Time Stamp (ms)` column. Other
        columns (`Buffer Index`) are ignored.

    Returns
    -------
    frames : (n_frames,) int array
        The `Frame Number` column.
    t : (n_frames,) float array
        The `Time Stamp (ms)` column in seconds. Row i of `frames` and row i of `t`
        are the same frame, so these two arrays are the frame-to-time table: nothing
        else converts between frames and times. All files share one time axis (time
        since the recording started), and a first frame can be a few ms before zero.

    Example
    -------
    A file whose rows are `0,-22,0` and `1,11,0` gives
    >>> frames, t = load_timestamps("timeStamps.csv")
    >>> frames, t
    (array([0, 1]), array([-0.022,  0.011]))

    Not checked here
    ----------------
    Whether the times are in increasing order. That is checked in `validate_inputs`
    and again when a Session is made.

    Adapted from
    ------------
    Written with pandas; no code copied. The unit handling follows:
    - Sun, calculate_firing_ratemap.m (L22): milliseconds divided by 1000 to get seconds.
      https://github.com/yanjuns/Sun_Giocomo_2022_NComms/blob/fa2f1b8d20f8130d54bbc9468ccaf287e012a1fe/miniscope_analysis_cpp/calculate_firing_ratemap.m#L22
    Not adopted: pynapple's return_timestamps (time_index.py L100-130) accepts s, ms or
    us. Here the unit is always ms, because that is what the Miniscope writes.
      https://github.com/pynapple-org/pynapple/blob/7fdadfbc105bf5f380cd8a1eaf07fe3bb5bc0a7e/pynapple/core/time_index.py#L100-L130
    """
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"timestamps file not found: {path}")

    table = pd.read_csv(path)
    needed = ["Frame Number", "Time Stamp (ms)"]
    missing = [name for name in needed if name not in table.columns]
    if missing:
        raise ValueError(
            f"{path.name} is missing column(s) {missing}. It has {list(table.columns)}."
        )
    if table.empty:
        raise ValueError(f"{path.name} has no rows")
    if table[needed].isna().any().any():
        raise ValueError(f"{path.name} has empty values in {needed}")

    frames = table["Frame Number"].to_numpy()
    t = table["Time Stamp (ms)"].to_numpy(dtype=float) / 1000
    return frames, t
