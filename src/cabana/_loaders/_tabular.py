"""Plain tabular loaders: a position CSV joined to frame times, and epoch (annotation) CSVs."""

from __future__ import annotations

import warnings
from pathlib import Path

import numpy as np
import pandas as pd

from .._models import BoutTable
from ._common import check_path
from ._miniscope import _read_timestamps


def load_position_csv(
    path,
    *,
    timestamps,
    frame_column: str = "frame",
    columns: tuple[str, ...] = ("x", "y"),
    missing_value: float | None = -1,
    units: str = "cm",
) -> tuple[np.ndarray, np.ndarray]:
    """Position table with a frame column (no time column), joined to frame times.

    Tracking software often writes ``frame, x, y`` and keeps the clock in a separate
    timestamps file.  Rows are matched to times by *frame number*, not by row order, so a
    table that skips frames still lands at the right times.

    Parameters
    ----------
    path : str or Path
        The position CSV.
    timestamps : array-like or path
        Either a ``timeStamps.csv`` path (frame numbers and times are read from it) or an array
        of times in seconds whose index is the frame number.  Times are used as given, so they
        must be on the same clock as the session (see ``video_time_to_neural`` / ``apply_clock``
        for a camera clock that starts elsewhere).
    frame_column : str, default "frame"
    columns : tuple of str, default ("x", "y")
        Value columns, in output order.
    missing_value : float or None, default -1
        Marker for a lost frame.  A row where *all* ``columns`` equal it becomes NaN (a single
        coordinate equal to it is a real value).  ``None`` disables this.
    units : str, default "cm"
        Informational: pass it on as ``ContinuousSignal(units=...)``; nothing converts units.

    Returns
    -------
    t : (n,) float64 seconds, one per kept row
    xy : (n, len(columns)) float64, NaN for lost frames

    Warns
    -----
    UserWarning
        Rows whose frame number is absent from the timestamps are dropped (their count and the
        first one are named).
    """
    p = check_path(path, "position CSV")
    df = pd.read_csv(p)
    cols = {str(c).strip().lower(): c for c in df.columns}
    need = [frame_column, *columns]
    miss = [c for c in need if c.lower() not in cols]
    if miss:
        raise KeyError(f"position CSV {p}: missing columns {miss}; found {list(df.columns)}")
    frames = pd.to_numeric(df[cols[frame_column.lower()]], errors="coerce")
    if frames.isna().any():
        raise ValueError(
            f"position CSV {p}: row {int(np.flatnonzero(frames.isna())[0])} has "
            f"a non-numeric {frame_column!r}"
        )
    frames_a = frames.to_numpy(dtype=np.int64)
    vals = np.stack(
        [pd.to_numeric(df[cols[c.lower()]], errors="coerce").to_numpy(np.float64) for c in columns],
        axis=1,
    )
    if isinstance(timestamps, str | Path):
        t_frames, t_sec = _read_timestamps(timestamps, "timestamps file")
    else:
        t_sec = np.asarray(timestamps, dtype=np.float64)
        if t_sec.ndim != 1:
            raise ValueError("timestamps must be 1-D")
        t_frames = np.arange(t_sec.size, dtype=np.int64)
    pos = np.searchsorted(t_frames, frames_a)
    pos_c = np.clip(pos, 0, max(t_frames.size - 1, 0))
    found = (pos < t_frames.size) & (t_frames[pos_c] == frames_a)
    if not found.all():
        first = int(frames_a[~found][0])
        warnings.warn(
            f"position CSV {p}: {int((~found).sum())} row(s) have frame numbers absent from the "
            f"timestamps (first: frame {first}); they are dropped",
            UserWarning,
            stacklevel=2,
        )
    t = t_sec[pos_c[found]]
    xy = vals[found]
    if missing_value is not None:
        xy = np.where((xy == missing_value).all(axis=1, keepdims=True), np.nan, xy)
    if np.any(np.diff(t) < 0):
        raise ValueError(f"position CSV {p}: rows are not in time order after joining")
    return t, xy


def load_epochs_csv(
    path,
    *,
    label_column: str = "label",
    start_column: str = "start_s",
    stop_column: str = "stop_s",
    scored_span: tuple[float, float] | None = None,
) -> BoutTable:
    """Annotation epochs (``label, start_s, stop_s``) as a :class:`~cabana.BoutTable`.

    Times are seconds **already on the session's clock** (no offset is applied); if the
    annotations count from a video that starts elsewhere, convert them with
    ``video_time_to_neural`` first.  Zero-length rows (``stop == start``) are kept as point
    events (a warning notes that ``bouts_to_states`` ignores them unless
    ``point_event_window_s`` is set).

    Parameters
    ----------
    path : str or Path
    label_column, start_column, stop_column : str
    scored_span : (float, float), optional
        Span that was actually annotated, on the session clock.  Defaults to
        ``(min start, max stop)`` with a warning, as ``load_boris`` does.

    Raises
    ------
    KeyError
        A column is missing.
    ValueError
        A time is not a number, or a row stops before it starts (the row is named).
    """
    p = check_path(path, "epochs CSV")
    df = pd.read_csv(p)
    cols = {str(c).strip().lower(): c for c in df.columns}
    miss = [c for c in (label_column, start_column, stop_column) if c.lower() not in cols]
    if miss:
        raise KeyError(f"epochs CSV {p}: missing columns {miss}; found {list(df.columns)}")
    start = pd.to_numeric(df[cols[start_column.lower()]], errors="coerce").to_numpy(np.float64)
    stop = pd.to_numeric(df[cols[stop_column.lower()]], errors="coerce").to_numpy(np.float64)
    bad = ~(np.isfinite(start) & np.isfinite(stop))
    if bad.any():
        raise ValueError(
            f"epochs CSV {p}: row {int(np.flatnonzero(bad)[0])} has a non-numeric time"
        )
    back = np.flatnonzero(stop < start)
    if back.size:
        i = int(back[0])
        raise ValueError(
            f"epochs CSV {p}: row {i} ({df[cols[label_column.lower()]].iloc[i]!r}) stops at "
            f"{stop[i]:g} s before it starts at {start[i]:g} s"
        )
    labels = df[cols[label_column.lower()]].astype(str).str.strip().tolist()
    order = np.argsort(start, kind="stable")
    start, stop = start[order], stop[order]
    labels = [labels[i] for i in order]
    if np.any(stop == start):
        warnings.warn(
            f"{int((stop == start).sum())} zero-length (point) epochs loaded; bouts_to_states "
            "ignores them unless point_event_window_s is set",
            UserWarning,
            stacklevel=2,
        )
    if scored_span is None:
        if start.size == 0:
            raise ValueError(f"epochs CSV {p} has no rows; give scored_span")
        scored_span = (float(start.min()), float(stop.max()))
        warnings.warn(
            "scored_span not given; using (min start, max stop) of the epochs. Pass the true "
            "annotated span so unscored time is not read as absence of behavior.",
            UserWarning,
            stacklevel=2,
        )
    return BoutTable(
        labels=labels,
        start_s=start,
        stop_s=stop,
        scored_start_s=float(scored_span[0]),
        scored_stop_s=float(scored_span[1]),
    )


__all__ = ["load_epochs_csv", "load_position_csv"]
