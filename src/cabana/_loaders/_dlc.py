"""DeepLabCut CSV / H5 loader."""

from __future__ import annotations

import numpy as np
import pandas as pd

from .._models import ContinuousSignal
from ._common import check_path, require, time_axis


def _read(p) -> pd.DataFrame:
    if str(p).lower().endswith((".h5", ".hdf5", ".hdf")):
        require("tables", "loaders", "DeepLabCut H5 files")
        return pd.read_hdf(p)
    first = pd.read_csv(p, header=None, nrows=3, usecols=[0])[0].astype(str).tolist()
    if len(first) > 1 and first[1].strip().lower() == "individuals":
        raise ValueError("multi-animal DeepLabCut files (4-row header) are not supported")
    return pd.read_csv(p, header=[0, 1, 2], index_col=0)


def load_dlc(
    path,
    *,
    fs_video: float | None = None,
    t=None,
    t_offset_s: float = 0.0,
    bodyparts: list[str] | None = None,
    likelihood_min: float = 0.6,
    units: str = "px",
    px_per_mm: float | None = None,
) -> ContinuousSignal:
    """Load a DeepLabCut single-animal CSV (3-row header) or H5 as a ``ContinuousSignal``.

    Channels are ``f"{bodypart}_x"`` and ``f"{bodypart}_y"``.  Samples whose ``likelihood`` is
    below ``likelihood_min`` become NaN in both channels (all samples are kept if the file has no
    likelihood column).

    **Clock.**  ``t`` must be on the neural clock.  Either pass ``t`` (one time per row), or
    ``fs_video`` plus ``t_offset_s``, giving ``t = arange(n) / fs_video - t_offset_s`` where
    ``t_offset_s`` is the imaging start in video time.

    Parameters
    ----------
    path : str or Path
        ``.csv`` or ``.h5`` DeepLabCut output (H5 needs ``tables``: ``pip install
        'cabana[loaders]'``).
    fs_video, t, t_offset_s
        See above.
    bodyparts : list of str, optional
        Bodyparts to keep (default all).
    likelihood_min : float, default 0.6
    units : str, default "px"
    px_per_mm : float, optional
        Divide coordinates by this and set ``units="mm"``.

    Raises
    ------
    KeyError
        If a requested bodypart is absent (lists those available).
    ValueError
        If the time base is missing or inconsistent.
    """
    p = check_path(path, "DeepLabCut file")
    df = _read(p)
    if df.columns.nlevels != 3:
        raise ValueError(
            f"expected scorer/bodyparts/coords column levels, got {df.columns.nlevels}"
        )
    avail = list(dict.fromkeys(df.columns.get_level_values(1)))
    parts = avail if bodyparts is None else list(bodyparts)
    missing = [b for b in parts if b not in avail]
    if missing:
        raise KeyError(f"bodyparts {missing} not in {p}; available: {avail}")
    n = len(df)
    cols, names = [], []
    for b in parts:
        sub = df.xs(b, axis=1, level=1)
        sub.columns = [str(c).lower() for c in sub.columns.get_level_values(-1)]
        for ax in ("x", "y"):
            if ax not in sub.columns:
                raise KeyError(f"bodypart {b!r} has no {ax!r} coordinate; has {list(sub.columns)}")
        xy = np.array(sub[["x", "y"]].to_numpy(dtype=float))
        if "likelihood" in sub.columns:
            xy[sub["likelihood"].to_numpy(dtype=float) < likelihood_min] = np.nan
        cols.append(xy)
        names += [f"{b}_x", f"{b}_y"]
    values = np.concatenate(cols, axis=1)
    if px_per_mm is not None:
        if px_per_mm <= 0:
            raise ValueError("px_per_mm must be positive")
        values = values / float(px_per_mm)
        units = "mm"
    tt = time_axis(n, t=t, fs=fs_video, t_offset_s=t_offset_s, what="DeepLabCut file")
    return ContinuousSignal(t=tt, values=values, channel_names=names, units=units)


def dlc_centroid(signal: ContinuousSignal, bodyparts: list[str]) -> ContinuousSignal:
    """Mean position of ``bodyparts`` as a signal with channels ``x`` and ``y``.

    ``speed`` and ``bin_grid`` default to signals named ``x`` / ``y``, so
    ``resample_signal(source=...)`` on this output feeds them directly.  NaN samples are ignored
    in the mean; a frame is NaN only if every listed bodypart is NaN.
    """
    if not bodyparts:
        raise ValueError("bodyparts must be non-empty")
    out = []
    for ax in ("x", "y"):
        idx = []
        for b in bodyparts:
            c = f"{b}_{ax}"
            if c not in signal.channel_names:
                raise KeyError(f"channel {c!r} not in signal: {signal.channel_names}")
            idx.append(signal.channel_names.index(c))
        v = signal.values[:, idx]
        all_nan = np.isnan(v).all(axis=1)
        cnt = np.maximum((~np.isnan(v)).sum(axis=1), 1)
        m = np.where(all_nan, np.nan, np.nansum(v, axis=1) / cnt)
        out.append(m)
    return ContinuousSignal(
        t=signal.t, values=np.stack(out, axis=1), channel_names=["x", "y"], units=signal.units
    )
