"""BORIS events export loader (aggregated and raw/tabular exports)."""

from __future__ import annotations

import warnings

import numpy as np
import pandas as pd

from .._models import BoutTable
from ._common import check_path, video_time_to_neural


def _col(df: pd.DataFrame, *names: str) -> str | None:
    low = {str(c).strip().lower(): c for c in df.columns}
    for n in names:
        if n in low:
            return low[n]
    return None


def _read(p) -> pd.DataFrame:
    if str(p).lower().endswith((".tsv", ".txt")):
        return pd.read_csv(p, sep="\t")
    if str(p).lower().endswith(".csv"):
        return pd.read_csv(p)
    return pd.read_csv(p, sep=None, engine="python")


def load_boris(
    path,
    *,
    t_offset_s: float = 0.0,
    subject: str | None = None,
    behaviors: list[str] | None = None,
    scored_span: tuple[float, float] | None = None,
) -> BoutTable:
    """Load a BORIS events export (CSV or TSV) as a :class:`~cabana.BoutTable`.

    Two layouts are recognised (column names are matched case-insensitively):

    * **Aggregated events**: ``Behavior``, ``Start (s)``, ``Stop (s)``, optional ``Subject``,
      ``Behavioral category``, ``Behavior type``.  A missing/NaN stop (POINT event) becomes a
      zero-length bout.
    * **Raw/tabular events**: ``Time``, ``Behavior``, ``Status`` with START/STOP pairs (matched
      per subject and behavior in time order) and POINT rows.  Unmatched START/STOP rows are
      dropped with a warning.

    **Zero-length bouts.**  POINT events become bouts with ``stop_s == start_s``.
    ``bouts_to_states`` marks frames ``start <= t < stop``, so a zero-length bout covers no frame
    and is silently ignored (``min_duration_s`` only drops more).  Use the bout starts
    directly (e.g. event-aligned PETH) for point events.  A warning is issued when any exist.

    Parameters
    ----------
    path : str or Path
        BORIS export.
    t_offset_s : float, default 0.0
        Imaging start in video time; times become ``t_video - t_offset_s`` (BORIS t=0 is the
        video start).  See :func:`~cabana.loaders.video_time_to_neural`.
    subject : str, optional
        Keep only this subject.  With several subjects and none chosen, a warning is issued and
        bouts from all subjects are pooled under the behavior name.
    behaviors : list of str, optional
        Keep only these behaviors.
    scored_span : (float, float), optional
        Scored interval ``(start, stop)`` in seconds **on the neural clock** (after the offset).
        Defaults to ``(min start, max stop)`` of the loaded bouts, with a warning: give the true
        span so unscored time is not treated as absence of behavior.

    Raises
    ------
    KeyError
        If neither layout's required columns are found (message lists the columns present).
    ValueError
        If no bouts remain after filtering.
    """
    p = check_path(path, "BORIS export")
    df = _read(p)
    beh = _col(df, "behavior")
    subj = _col(df, "subject")
    if beh is None:
        raise KeyError(f"BORIS export {p} has no 'Behavior' column; columns: {list(df.columns)}")
    c_start, c_stop = _col(df, "start (s)", "start"), _col(df, "stop (s)", "stop")
    c_time, c_status = _col(df, "time"), _col(df, "status")
    if c_start is not None:
        starts = _numeric(df, c_start)
        stops = _numeric(df, c_stop) if c_stop else starts
        stops = stops.fillna(starts)
        ok = starts.notna()
        rows = pd.DataFrame(
            {
                "label": df[beh].astype(str).str.strip(),
                "start": starts,
                "stop": stops,
                "subject": df[subj].fillna("").astype(str) if subj else "",
            }
        )[ok]
    elif c_time is not None and c_status is not None:
        rows = _pair_raw(df, beh, subj, c_time, c_status)
    else:
        raise KeyError(
            f"BORIS export {p}: need 'Start (s)'/'Stop (s)' (aggregated) or 'Time'/'Status' "
            f"(raw events) columns; found {list(df.columns)}"
        )
    if subject is not None:
        rows = rows[rows["subject"] == subject]
    elif rows["subject"].nunique() > 1:
        warnings.warn(
            f"BORIS export has several subjects {sorted(rows['subject'].unique())}; bouts are "
            "pooled by behavior name. Pass subject= to select one.",
            UserWarning,
            stacklevel=2,
        )
    if behaviors is not None:
        rows = rows[rows["label"].isin(behaviors)]
    if rows.empty:
        raise ValueError("no BORIS bouts left after filtering by subject/behaviors")
    rows = rows.sort_values("start", kind="stable")
    start = video_time_to_neural(rows["start"].to_numpy(), t_offset_s)
    stop = video_time_to_neural(rows["stop"].to_numpy(), t_offset_s)
    if np.any(stop < start):
        raise ValueError("BORIS export has bouts that stop before they start")
    if np.any(stop == start):
        warnings.warn(
            f"{int((stop == start).sum())} zero-length (POINT) bouts loaded; bouts_to_states "
            "ignores zero-length spans (it marks start <= t < stop), so they add no frames. "
            "Use bout starts for event-aligned analyses.",
            UserWarning,
            stacklevel=2,
        )
    if scored_span is None:
        scored_span = (float(start.min()), float(stop.max()))
        warnings.warn(
            "scored_span not given; using (min start, max stop) of the loaded bouts. Pass the "
            "true scored span (neural-clock seconds) so unscored time is not read as absence.",
            UserWarning,
            stacklevel=2,
        )
    return BoutTable(
        labels=list(rows["label"]),
        start_s=start,
        stop_s=stop,
        scored_start_s=float(scored_span[0]),
        scored_stop_s=float(scored_span[1]),
    )


def _numeric(df, col) -> pd.Series:
    """Parse a time column; blanks stay NaN, unparseable text raises."""
    raw = df[col]
    out = pd.to_numeric(raw, errors="coerce")
    blank = raw.isna() | (raw.astype(str).str.strip() == "")
    bad = out.isna() & ~blank
    if bad.any():
        raise ValueError(
            f"{int(bad.sum())} value(s) in BORIS column {col!r} are not numbers "
            f"(e.g. {raw[bad].iloc[0]!r}); export times in seconds, not hh:mm:ss"
        )
    return out


def _pair_raw(df, beh, subj, c_time, c_status) -> pd.DataFrame:
    d = pd.DataFrame(
        {
            "t": _numeric(df, c_time),
            "label": df[beh].astype(str).str.strip(),
            "status": df[c_status].astype(str).str.strip().str.upper(),
            "subject": df[subj].fillna("").astype(str) if subj else "",
        }
    ).dropna(subset=["t"])
    d = d.sort_values("t", kind="stable")
    out: list[tuple[str, float, float, str]] = []
    open_: dict[tuple[str, str], float] = {}
    n_bad = 0
    for t, lab, st, sj in zip(d["t"], d["label"], d["status"], d["subject"], strict=True):
        k = (sj, lab)
        if st == "POINT":
            out.append((lab, t, t, sj))
        elif st == "START":
            n_bad += k in open_
            open_[k] = t
        elif st == "STOP":
            if k in open_:
                out.append((lab, open_.pop(k), t, sj))
            else:
                n_bad += 1
        else:
            raise ValueError(f"unknown BORIS Status {st!r}; expected START, STOP or POINT")
    n_bad += len(open_)
    if n_bad:
        warnings.warn(
            f"{n_bad} unmatched START/STOP rows in the BORIS export were dropped",
            UserWarning,
            stacklevel=3,
        )
    return pd.DataFrame(out, columns=["label", "start", "stop", "subject"])
