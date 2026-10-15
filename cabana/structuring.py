"""
cabana.structuring — put the data in the shape an analysis needs, without changing
the numbers: convert between epochs, frame labels and continuous variables, line up
behavior with the neural recording, and pick out the frames or time windows to use.

Terms used across CaBaNA:
    epoch                 a stretch of time with a start and a stop (sniffing, a stay
                          in a zone, a stimulus presentation)
    frame labels          one label for every frame: yes/no (sniffing or not, in
                          the zone or not) or a category (which zone, which spatial bin)
    continuous variable   a number for every frame (speed, position, head orientation)

Frame labels come from epochs (epochs_to_frame_labels) or from a continuous variable
(binarize, bin_position). They are stored as columns of session.behavior,
next to the continuous variables.

File loading is in cabana.io.

Written:
    epochs_from_frame_labels   frame labels -> epochs (see its docstring for the sources)

Not written yet. None of these functions have been written yet. 
Each will be written using the linked code as a reference. 

Aligning behavior to the neural recording

align_behavior_to_neural(neural_t, behav_t, behavior) -> DataFrame, one row per neural frame
    Continuous columns (x, y, speed): linear interpolation onto the neural times.
    Frame-label columns (zone, investigating): the label of the nearest behavior frame.
    pynapple, core/time_series.py, Tsd.interpolate (L799-867): np.interp inside each
    recording stretch
    https://github.com/pynapple-org/pynapple/blob/7fdadfbc105bf5f380cd8a1eaf07fe3bb5bc0a7e/pynapple/core/time_series.py#L799-L867
    pynapple, core/base_class.py, value_from (L180-232), mode="closest": takes the value
    of the nearest sample
    https://github.com/pynapple-org/pynapple/blob/7fdadfbc105bf5f380cd8a1eaf07fe3bb5bc0a7e/pynapple/core/base_class.py#L180-L232
    Sun_Giocomo_2022_NComms, calculate_firing_ratemap.m (L35): interp1 of position at
    the neural times
    https://github.com/yanjuns/Sun_Giocomo_2022_NComms/blob/fa2f1b8d20f8130d54bbc9468ccaf287e012a1fe/miniscope_analysis_cpp/calculate_firing_ratemap.m#L35

Converting between epochs, frame labels and continuous variables

epochs_to_frame_labels(starts_s, stops_s, frame_times_s)
    Epochs given as start and stop times in seconds -> yes/no frame labels, one per
    frame. A frame is True if its own timestamp, from the timestamps file, falls
    inside an epoch. There is no time-to-frame conversion step: the timestamps file
    already pairs each frame number with its time.
    neuro_py, process/intervals.py, in_intervals (L346-416): marks the timestamps that
    fall inside each interval
    https://github.com/ryanharvey1/neuro_py/blob/c614e1e807589d77482cdef6651c64f9ac7f07e7/neuro_py/process/intervals.py#L346-L416

binarize(x, threshold, direction="above")
    Continuous variable -> yes/no frame labels (running = speed above a cutoff, cell active =
    trace above a cutoff). direction is "above", "below", "aboveequal" or "belowequal".
    pynapple, core/time_series.py, Tsd.threshold (L3115-3168)
    https://github.com/pynapple-org/pynapple/blob/7fdadfbc105bf5f380cd8a1eaf07fe3bb5bc0a7e/pynapple/core/time_series.py#L3115-L3168
    Sun_Giocomo_2022_NComms, calculate_firing_ratemap.m (L40-43): trace above a
    threshold set for each cell
    https://github.com/yanjuns/Sun_Giocomo_2022_NComms/blob/fa2f1b8d20f8130d54bbc9468ccaf287e012a1fe/miniscope_analysis_cpp/calculate_firing_ratemap.m#L40-L43
    optinist, basic_neural_analysis/eta.py (L16)
    https://github.com/oist/optinist/blob/c8f9526300b63bb7bfa7440bbaece3d7505667b0/studio/app/optinist/wrappers/optinist/basic_neural_analysis/eta.py#L16

bin_position(xy, bin_size, arena)    (frame labels: one spatial bin per frame)
    Position -> the spatial bin of every frame. Bin edges run from 0 in steps of
    bin_size; the other functions count frames per bin, this one returns the bin of
    each frame.
    Sun_Giocomo_2022_NComms, calculate_firing_ratemap.m (L29-31)
    https://github.com/yanjuns/Sun_Giocomo_2022_NComms/blob/fa2f1b8d20f8130d54bbc9468ccaf287e012a1fe/miniscope_analysis_cpp/calculate_firing_ratemap.m#L29-L31
    neuro_py, tuning/maps.py (L940-943)
    https://github.com/ryanharvey1/neuro_py/blob/c614e1e807589d77482cdef6651c64f9ac7f07e7/neuro_py/tuning/maps.py#L940-L943

Choosing frames and cutting windows

class_frame_labels(behavior, column, positive, negative=None) -> positive_labels, negative_labels
    Yes/no frame labels for the frames where behavior[column] is `positive`, and the
    frames to compare them with: where it is `negative`, or every other frame.
    Code_for_2025_Raam, roc_all.m (L43-55): one chosen column, or all frames; all other
    behaviors are run in turn
    https://github.com/hongw-lab/Code_for_2025_Raam/blob/268c7a71c5812c7899cd8e79903931950f524139/roc_all.m#L43-L55
    Code_for_2024_ZhangM, ROC.m (L14-17): the "other" column
    https://github.com/hongw-lab/Code_for_2024_ZhangM/blob/2019a15bf9b802e39040cd361bcc2449f0a206a3/ROC.m#L14-L17

select_frames(session, frame_labels)
    A new Session with only the frames where the yes/no frame labels are True, and the step recorded.
    Code_for_2025_Raam, roc_all.m (L72-74): keeps the frames in the negative class or
    the behavior, then runs on those
    https://github.com/hongw-lab/Code_for_2025_Raam/blob/268c7a71c5812c7899cd8e79903931950f524139/roc_all.m#L72-L74
    neuro_py, tuning/maps.py (L420): keeps running frames (speed above 4 by default)
    https://github.com/ryanharvey1/neuro_py/blob/c614e1e807589d77482cdef6651c64f9ac7f07e7/neuro_py/tuning/maps.py#L420

onset_windows(session, onset_frames, pre_s, post_s) -> onsets x time x cells
    Cut a window around each onset (the first frame of an epoch). The start and the end are set separately, and
    windows that run past the recording are padded with NaN.
    pynapple, process/_process_functions.py (L47-65): separate counts before and after,
    padded with NaN at the edges
    https://github.com/pynapple-org/pynapple/blob/7fdadfbc105bf5f380cd8a1eaf07fe3bb5bc0a7e/pynapple/process/_process_functions.py#L47-L65
    optinist, basic_neural_analysis/eta.py, calc_trigger_average (L63-72)
    https://github.com/oist/optinist/blob/c8f9526300b63bb7bfa7440bbaece3d7505667b0/studio/app/optinist/wrappers/optinist/basic_neural_analysis/eta.py#L63-L72
    dCA1_Paper, onep/trace_analysis_functions.py (L230-236): cubic interpolation onto a
    window around each onset
    https://github.com/rsenne/dCA1_Paper/blob/280eae5a9e78542907d8c1c7fcb55209ac5a40e8/onep/trace_analysis_functions.py#L230-L236
    neuro_py, process/peri_event.py (L918-922): centres the window on the onset, so an
    uneven window is mislabelled (not adopted; checked by running it)
    https://github.com/ryanharvey1/neuro_py/blob/c614e1e807589d77482cdef6651c64f9ac7f07e7/neuro_py/process/peri_event.py#L918-L922

population_matrix(session, rows="frames" | "windows" | "epochs", ...)
    The matrix PCA is run on: one row per frame, per window, or per epoch.
    Canton, Figure_5_PCA_dataframe_creation.py (L131-150): one row per baseline frame
    https://github.com/pinto-lab-nu/Canton-JoshEtAl2025/blob/8b8728dc7b4f92cda38235a7dbae9687f3e5af24/Figure_5_PCA_dataframe_creation.py#L131-L150
    linfangu, example_pca_by_bout.m (L37): one row per epoch
    https://github.com/linfangu/Computational-neuroscience-toolbox/blob/73fd0598ed8e421f5c2c3b61ea3a5b2c5e568154/example_pca_by_bout.m#L37
    linfangu, example_pca_by_trajectory.m (L41): one row per time point of the average
    response
    https://github.com/linfangu/Computational-neuroscience-toolbox/blob/73fd0598ed8e421f5c2c3b61ea3a5b2c5e568154/example_pca_by_trajectory.m#L41
"""
import numpy as np


def epochs_from_frame_labels(frame_labels, min_len=1, merge_gap=0):
    """
    Find each epoch: a stretch of frames where yes/no frame labels are True.

    Parameters
    ----------
    frame_labels : (n_frames,) bool array
        True on the frames where the animal is doing the thing
        (sniffing, running, in the zone).
    merge_gap : int
        Two stretches separated by at most this many False frames are
        joined into one. 0 joins nothing. Applied before `min_len`.
    min_len : int
        Stretches shorter than this many frames (after merging) are dropped.

    Returns
    -------
    onsets, offsets : (n_epochs,) int arrays
        Frame index of the first True frame, and of the first frame after
        the stretch (exclusive), so `frame_labels[onsets[i]:offsets[i]]` is the
        epoch and `offsets - onsets` is its length in frames.

    Example
    -------
    >>> epochs_from_frame_labels(np.array([0, 1, 1, 0, 0, 1, 0], bool))
    (array([1, 5]), array([3, 6]))

    Used for
    --------
    Onset-aligned averages (onsets are the times windows are cut around), ROC (the
    epochs of each behavior), place cells (epochs where the animal is running) and
    PCA (epochs that become rows of the matrix).

    Adapted from
    ------------
    Written with np.diff; no code copied. The onset rule and how long each stretch
    lasts come from:
    - optinist, calc_trigger (eta.py L14-53): an "up" trigger is a True after a False,
      and the length is counted forward.
      https://github.com/oist/optinist/blob/c8f9526300b63bb7bfa7440bbaece3d7505667b0/studio/app/optinist/wrappers/optinist/basic_neural_analysis/eta.py#L14-L53
    - linfangu, first_beh_in_sessions.m: bwconncomp finds the stretches (L27-29) and the
      onset is the first frame of each (L44).
      https://github.com/linfangu/Computational-neuroscience-toolbox/blob/73fd0598ed8e421f5c2c3b61ea3a5b2c5e568154/utils/general/first_beh_in_sessions.m#L27-L44
    - neuro_py, find_interval (intervals.py L311-342): start and end index of each run
      of True.
      https://github.com/ryanharvey1/neuro_py/blob/c614e1e807589d77482cdef6651c64f9ac7f07e7/neuro_py/process/intervals.py#L311-L342
    `merge_gap` follows pynapple's IntervalSet.merge_close_intervals (L835-870) and
    `min_len` follows IntervalSet.drop_short_intervals (L769-788):
      https://github.com/pynapple-org/pynapple/blob/7fdadfbc105bf5f380cd8a1eaf07fe3bb5bc0a7e/pynapple/core/interval_set.py#L835-L870
      https://github.com/pynapple-org/pynapple/blob/7fdadfbc105bf5f380cd8a1eaf07fe3bb5bc0a7e/pynapple/core/interval_set.py#L769-L788
    Not adopted: optinist keeps only stretches of the most common length (eta.py
    L47-49), which drops epochs of any other length.
    """
    frame_labels = np.asarray(frame_labels)
    if frame_labels.ndim != 1 or frame_labels.dtype != bool:
        raise ValueError("frame_labels must be a 1-D boolean array")

    # Pad with False on both ends so a stretch touching either edge still has
    # a rising and a falling edge. diff is +1 at a rising edge, -1 at a
    # falling edge; the index is the first frame after the change.
    edges = np.diff(np.concatenate(([False], frame_labels, [False])).astype(np.int8))
    onsets = np.flatnonzero(edges == 1)
    offsets = np.flatnonzero(edges == -1)
    if len(onsets) == 0:
        return onsets, offsets

    # Gap between the end of one stretch and the start of the next. Keep a
    # boundary only where the gap is wider than merge_gap.
    gaps = onsets[1:] - offsets[:-1]
    keep = gaps > merge_gap
    onsets = onsets[np.concatenate(([True], keep))]
    offsets = offsets[np.concatenate((keep, [True]))]

    long_enough = (offsets - onsets) >= min_len
    return onsets[long_enough], offsets[long_enough]
