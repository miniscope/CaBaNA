"""Miniscope-format files: ``timeStamps.csv``, ``headOrientation.csv`` and a timing report."""

from __future__ import annotations

import warnings
from pathlib import Path

import numpy as np
import pandas as pd

from ._common import check_path

_FRAME = "frame number"
_STAMP = "time stamp (ms)"


def _norm_cols(df: pd.DataFrame) -> dict[str, str]:
    return {str(c).strip().lower(): c for c in df.columns}


def _read_timestamps(path, what: str = "Miniscope timestamps") -> tuple[np.ndarray, np.ndarray]:
    """``(frame_numbers int64, t seconds float64)`` from a ``timeStamps.csv``."""
    p = check_path(path, what)
    df = pd.read_csv(p)
    cols = _norm_cols(df)
    missing = [c for c in (_FRAME, _STAMP) if c not in cols]
    if missing:
        raise KeyError(
            f"{what} {p}: need columns 'Frame Number' and 'Time Stamp (ms)'; found "
            f"{list(df.columns)}"
        )
    fr_raw = pd.to_numeric(df[cols[_FRAME]], errors="coerce")
    ts_raw = pd.to_numeric(df[cols[_STAMP]], errors="coerce")
    for name, s in (("Frame Number", fr_raw), ("Time Stamp (ms)", ts_raw)):
        if s.isna().any():
            row = int(np.flatnonzero(s.isna().to_numpy())[0])
            raise ValueError(f"{what} {p}: row {row} has a non-numeric or empty {name!r}")
    frames = fr_raw.to_numpy(dtype=np.int64)
    bad = np.flatnonzero(np.diff(frames) <= 0)
    if bad.size:
        i = int(bad[0]) + 1
        raise ValueError(
            f"{what} {p}: frame numbers must be strictly increasing, but frame "
            f"{int(frames[i])} (row {i}) follows frame {int(frames[i - 1])}"
        )
    t = ts_raw.to_numpy(dtype=np.float64) / 1000.0
    back = np.flatnonzero(np.diff(t) < 0)
    if back.size:
        i = int(back[0]) + 1
        warnings.warn(
            f"{what} {p}: {back.size} time stamp(s) go backwards, first at frame "
            f"{int(frames[i])} (row {i}): {t[i - 1] * 1000:g} ms then {t[i] * 1000:g} ms. "
            "Sessions need non-decreasing time; check the acquisition log.",
            UserWarning,
            stacklevel=3,
        )
    return frames, t


def load_miniscope_timestamps(path) -> np.ndarray:
    """Frame times in seconds from a Miniscope ``timeStamps.csv``.

    The file has columns ``Frame Number``, ``Time Stamp (ms)`` and (optionally, ignored)
    ``Buffer Index``; column names are matched case-insensitively.  The first stamp is
    commonly slightly negative (acquisition starts before the zero of the recording); that is
    kept as is.  Times are on whatever clock the acquisition software used: if the behavior
    camera shares that clock they are already on a common axis, otherwise convert the video
    clock with ``video_time_to_neural`` or ``apply_clock``.

    Parameters
    ----------
    path : str or Path
        The ``timeStamps.csv`` (or a file with the same columns).

    Returns
    -------
    numpy.ndarray
        ``(n_frames,)`` float64 seconds, one per row (frame numbers are used for validation and
        for joining position tables, see ``load_position_csv``).

    Raises
    ------
    KeyError
        A required column is missing (the message lists the columns found).
    ValueError
        Frame numbers are not strictly increasing, or a value is not a number; the message
        names the offending frame.

    Warns
    -----
    UserWarning
        Time stamps that go backwards (the first offending frame is named).  Dropped frames
        are not an error here; use :func:`timing_report`.
    """
    return _read_timestamps(path)[1]


def timing_report(t, fs_nominal: float | None = None) -> dict:
    """Describe the regularity of a frame-time vector (also usable on ``Session.t``).

    A frame is counted as dropped when the interval to the previous frame exceeds 1.5 times
    the median interval: a gap of ``dt`` seconds is estimated to hide ``round(dt / median) - 1``
    frames.  Jitter is the standard deviation of the intervals that are *not* gaps.

    Parameters
    ----------
    t : array-like
        Frame times, seconds, non-decreasing.
    fs_nominal : float, optional
        The rate the acquisition was set to (Hz); echoed back and used to report
        ``fs_ratio = fs_median / fs_nominal``.

    Returns
    -------
    dict
        ``n_frames``, ``duration_s`` (last minus first time), ``fs_median`` (1 / median
        interval; biased when stamps are rounded to whole ms), ``fs_mean`` (frames per second
        over the whole record, ``(n - 1) / duration``, a better ``Session.fs`` when drops are rare), ``fs_nominal`` (as given, or ``None``), ``fs_ratio`` (or ``None``),
        ``n_dropped_frames``, ``dropped_fraction`` (dropped / (frames + dropped)),
        ``gap_index`` (indices ``i`` such that the gap lies between frames ``i`` and ``i + 1``),
        ``gap_start_s`` (time of frame ``i``), ``gap_n_frames`` (estimated frames lost in each
        gap), ``jitter_sd_s`` and ``first_t``.
    """
    a = np.asarray(t, dtype=float)
    if a.ndim != 1:
        raise ValueError(f"t must be 1-D, got shape {a.shape}")
    if a.size < 2:
        raise ValueError("need at least 2 time stamps for a timing report")
    if not np.all(np.isfinite(a)):
        raise ValueError("t contains non-finite values")
    dt = np.diff(a)
    med = float(np.median(dt))
    if med <= 0:
        raise ValueError("median frame interval is not positive; t is not increasing")
    gap = dt > 1.5 * med
    idx = np.flatnonzero(gap)
    sizes = np.maximum(np.rint(dt[idx] / med).astype(np.int64) - 1, 1)
    n_drop = int(sizes.sum())
    regular = dt[~gap]
    fs_med = 1.0 / med
    return {
        "n_frames": int(a.size),
        "duration_s": float(a[-1] - a[0]),
        "fs_median": fs_med,
        "fs_mean": float((a.size - 1) / (a[-1] - a[0])) if a[-1] > a[0] else fs_med,
        "fs_nominal": None if fs_nominal is None else float(fs_nominal),
        "fs_ratio": None if fs_nominal is None else fs_med / float(fs_nominal),
        "n_dropped_frames": n_drop,
        "dropped_fraction": n_drop / (a.size + n_drop),
        "gap_index": [int(i) for i in idx],
        "gap_start_s": [float(a[i]) for i in idx],
        "gap_n_frames": [int(s) for s in sizes],
        "jitter_sd_s": float(np.std(regular)) if regular.size else 0.0,
        "first_t": float(a[0]),
    }


def load_head_orientation(path, *, timestamps=None) -> tuple[np.ndarray, np.ndarray]:
    """Head orientation quaternions from a Miniscope V4 ``headOrientation.csv``.

    Columns: ``Time Stamp (ms)``, ``qw``, ``qx``, ``qy``, ``qz`` (a unit quaternion from the
    IMU, ``w, x, y, z`` order).  These rows are on the *neural* clock (one per miniscope frame).
    The quaternion zero of yaw is the sensor's power-on heading; calibrate with
    ``head_direction(offset_deg=...)``.

    Parameters
    ----------
    path : str or Path
    timestamps : array-like or path, optional
        Times in seconds to use instead of the file's own column (an array with one value per
        row, or a ``timeStamps.csv`` path).  When the file has its own stamps and they disagree
        with these by more than 1 ms a warning is issued.  Required if the file has no time
        column.

    Returns
    -------
    t : (n,) float64 seconds
    quat : (n, 4) float64 in ``w, x, y, z`` order; unparseable entries are NaN.
    """
    p = check_path(path, "head orientation file")
    df = pd.read_csv(p)
    cols = _norm_cols(df)
    qn = ["qw", "qx", "qy", "qz"]
    missing = [c for c in qn if c not in cols]
    if missing:
        raise KeyError(f"head orientation {p}: missing columns {missing}; found {list(df.columns)}")
    quat = np.stack(
        [pd.to_numeric(df[cols[c]], errors="coerce").to_numpy(dtype=np.float64) for c in qn],
        axis=1,
    )
    own = None
    if _STAMP in cols:
        own = pd.to_numeric(df[cols[_STAMP]], errors="coerce").to_numpy(dtype=np.float64) / 1000.0
        if not np.all(np.isfinite(own)):
            raise ValueError(f"head orientation {p}: non-numeric 'Time Stamp (ms)'")
    if timestamps is None:
        if own is None:
            raise ValueError(f"head orientation {p} has no 'Time Stamp (ms)'; pass timestamps=")
        t = own
    else:
        if isinstance(timestamps, str | Path):
            t = _read_timestamps(timestamps)[1]
        else:
            t = np.asarray(timestamps, dtype=np.float64)
        if t.shape != (quat.shape[0],):
            raise ValueError(
                f"head orientation has {quat.shape[0]} rows but timestamps has {t.shape[0]}"
            )
        if own is not None and np.max(np.abs(own - t)) > 1e-3:
            warnings.warn(
                f"head orientation {p}: its own time stamps differ from timestamps= by up to "
                f"{np.max(np.abs(own - t)) * 1000:.1f} ms; using timestamps=",
                UserWarning,
                stacklevel=2,
            )
    if np.any(np.diff(t) < 0):
        raise ValueError(f"head orientation {p}: time stamps must be non-decreasing")
    return t, quat


__all__ = ["load_head_orientation", "load_miniscope_timestamps", "timing_report"]
