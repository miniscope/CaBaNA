"""DeepLabCut CSV / H5 loader."""

from __future__ import annotations

import numpy as np
import pandas as pd

from .._models import ContinuousSignal
from ._common import check_path, require, time_axis


def _read(p, trusted_hdf: bool) -> pd.DataFrame:
    if str(p).lower().endswith((".h5", ".hdf5", ".hdf")):
        if not trusted_hdf:
            raise ValueError(
                "DeepLabCut H5 files are read with pandas.read_hdf, which unpickles object "
                "columns and can execute code embedded in a malicious file. Pass "
                "trusted_hdf=True only for files you produced yourself, or export the DLC "
                "CSV instead."
            )
        require("tables", "loaders", "DeepLabCut H5 files")
        return pd.read_hdf(p)
    first = pd.read_csv(p, header=None, nrows=3, usecols=[0])[0].astype(str).tolist()
    if len(first) > 1 and first[1].strip().lower() == "individuals":
        return pd.read_csv(p, header=[0, 1, 2, 3], index_col=0)  # multi-animal: 4-row header
    return pd.read_csv(p, header=[0, 1, 2], index_col=0)


def load_dlc(
    path,
    *,
    fs_video: float | None = None,
    t=None,
    t_offset_s: float = 0.0,
    bodyparts: list[str] | None = None,
    likelihood_min: float | None = 0.6,
    keep_likelihood: bool = True,
    individuals: list[str] | None = None,
    units: str = "px",
    px_per_mm: float | None = None,
    trusted_hdf: bool = False,
) -> ContinuousSignal:
    """Load a DeepLabCut CSV or H5 (single- or multi-animal) as a ``ContinuousSignal``.

    H5 files require ``trusted_hdf=True``: ``pandas.read_hdf`` unpickles object columns, so an
    untrusted file could execute code.  CSV is always safe.

    Channels are ``f"{bodypart}_x"`` and ``f"{bodypart}_y"`` for single-animal files (3-row
    header).  Multi-animal files (an ``individuals`` header level) give
    ``f"{individual}_{bodypart}_x"`` etc.; the prefix ``f"{individual}_{bodypart}"`` is what
    ``head_direction``, ``distance`` and ``zone_occupancy`` take once the signal is resampled.

    **Likelihood.**  Samples whose ``likelihood`` is below ``likelihood_min`` become NaN in both
    coordinate channels (``likelihood_min=None`` keeps everything).  With ``keep_likelihood``
    (default) the raw likelihood is also stored per bodypart as channel
    ``f"{bodypart}_likelihood"`` (not NaN-ed, not scaled by ``px_per_mm``; the signal's
    ``units`` describe the coordinates), so after ``resample_signal`` it is a session signal that
    ``mask_from_signal`` can re-threshold.  Files without a likelihood column get no such channel.

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
    likelihood_min : float or None, default 0.6
    keep_likelihood : bool, default True
    individuals : list of str, optional
        Multi-animal files only: individuals to keep (default all, including DLC's ``single``
        for unique bodyparts).  Passing it for a single-animal file raises ``ValueError``.
    units : str, default "px"
    px_per_mm : float, optional
        Divide coordinates by this and set ``units="mm"``.

    Raises
    ------
    KeyError
        If a requested bodypart or individual is absent (lists those available).
    ValueError
        If the time base is missing or inconsistent.
    """
    p = check_path(path, "DeepLabCut file")
    df = _read(p, trusted_hdf)
    if df.columns.nlevels not in (3, 4):
        raise ValueError(
            "expected scorer/bodyparts/coords (or scorer/individuals/bodyparts/coords) "
            f"column levels, got {df.columns.nlevels}"
        )
    multi = df.columns.nlevels == 4
    if individuals is not None and not multi:
        raise ValueError(f"{p} is a single-animal file; `individuals` does not apply")
    bp_level = 2 if multi else 1
    groups: list[tuple[str | None, str]] = []  # (individual, bodypart)
    if multi:
        avail_ind = list(dict.fromkeys(df.columns.get_level_values(1)))
        inds = avail_ind if individuals is None else list(individuals)
        missing = [i for i in inds if i not in avail_ind]
        if missing:
            raise KeyError(f"individuals {missing} not in {p}; available: {avail_ind}")
    else:
        inds = [None]
    avail = list(dict.fromkeys(df.columns.get_level_values(bp_level)))
    parts = avail if bodyparts is None else list(bodyparts)
    missing = [b for b in parts if b not in avail]
    if missing:
        raise KeyError(f"bodyparts {missing} not in {p}; available: {avail}")
    for ind in inds:
        have = (
            set(df.xs(ind, axis=1, level=1).columns.get_level_values(1))
            if ind is not None
            else set(avail)
        )
        groups += [(ind, b) for b in parts if b in have]
    if not groups:
        raise KeyError(f"no matching bodyparts in {p}")
    n = len(df)
    cols, names, lik_cols, lik_names = [], [], [], []
    for ind, b in groups:
        sub = df.xs(ind, axis=1, level=1) if ind is not None else df
        sub = sub.xs(b, axis=1, level=1)
        sub.columns = [str(c).lower() for c in sub.columns.get_level_values(-1)]
        for ax in ("x", "y"):
            if ax not in sub.columns:
                raise KeyError(f"bodypart {b!r} has no {ax!r} coordinate; has {list(sub.columns)}")
        xy = np.array(sub[["x", "y"]].to_numpy(dtype=float))
        pref = b if ind is None else f"{ind}_{b}"
        if "likelihood" in sub.columns:
            lik = sub["likelihood"].to_numpy(dtype=float)
            if likelihood_min is not None:
                xy[lik < likelihood_min] = np.nan
            if keep_likelihood:
                lik_cols.append(lik[:, None])
                lik_names.append(f"{pref}_likelihood")
        cols.append(xy)
        names += [f"{pref}_x", f"{pref}_y"]
    values = np.concatenate(cols, axis=1)
    if px_per_mm is not None:
        if px_per_mm <= 0:
            raise ValueError("px_per_mm must be positive")
        values = values / float(px_per_mm)
        units = "mm"
    if lik_cols:
        values = np.concatenate([values, *lik_cols], axis=1)
        names += lik_names
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
