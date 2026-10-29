"""Keypoint-MoSeq syllable loader (CSV export or results.h5)."""

from __future__ import annotations

import numpy as np
import pandas as pd

from .._models import LabelSeries
from ._common import check_path, require, video_time_to_neural


def load_moseq(
    path,
    *,
    fs_video: float,
    t_offset_s: float = 0.0,
    key: str | None = None,
    names: dict[int, str] | list[str] | None = None,
) -> LabelSeries:
    """Load Keypoint-MoSeq syllables as a :class:`~cabana.LabelSeries`.

    Two inputs are supported:

    * **CSV** with ``syllable`` and ``frame_index`` (or ``frame``) columns (optional ``onset``
      is ignored); if it has a ``name`` / ``recording`` column, ``key`` selects the recording.
    * **HDF5** ``results.h5`` with one ``<recording>/syllable`` dataset per recording (needs
      ``h5py``: ``pip install 'cabana[caiman]'`` or ``'cabana[loaders]'``); ``key`` selects the
      recording and may be omitted when there is only one.

    Frame ``k`` is at ``k / fs_video - t_offset_s`` on the neural clock (``t_offset_s`` = imaging
    start in video time).  The series spans frames ``0..max_frame``; frames with no syllable
    (gaps, NaN, leading frames MoSeq trims) are ``-1``.

    Parameters
    ----------
    path : str or Path
    fs_video : float
        Video frame rate (Hz) the syllable frame indices refer to.
    t_offset_s : float, default 0.0
    key : str, optional
        Recording name.
    names : dict or list, optional
        Syllable names, by id (default ``f"syl{k:02d}"``).

    Raises
    ------
    KeyError
        If required columns/datasets are missing, or ``key`` is needed but not given/unknown.
    """
    if fs_video <= 0:
        raise ValueError("fs_video must be positive")
    p = check_path(path, "Keypoint-MoSeq results")
    if str(p).lower().endswith((".h5", ".hdf5")):
        h5py = require("h5py", "loaders", "Keypoint-MoSeq results.h5")
        with h5py.File(p, "r") as f:
            recs = [k for k in f.keys() if isinstance(f[k], h5py.Group) and "syllable" in f[k]]
            if key is None:
                if len(recs) != 1:
                    raise KeyError(f"give key=; recordings with 'syllable' in {p}: {recs}")
                key = recs[0]
            if key not in recs:
                raise KeyError(f"recording {key!r} not in {p}; available: {recs}")
            syl = np.asarray(f[key]["syllable"], dtype=float)
        frames = np.arange(syl.shape[0])
    else:
        df = pd.read_csv(p)
        fcol = next((c for c in ("frame_index", "frame") if c in df.columns), None)
        if fcol is None or "syllable" not in df.columns:
            raise KeyError(
                f"{p} needs 'syllable' and 'frame_index' (or 'frame') columns; has {list(df.columns)}"
            )
        rcol = next((c for c in ("name", "recording") if c in df.columns), None)
        if rcol is not None:
            recs = list(dict.fromkeys(df[rcol].astype(str)))
            if key is None:
                if len(recs) != 1:
                    raise KeyError(f"give key=; recordings in {p}: {recs}")
                key = recs[0]
            if key not in recs:
                raise KeyError(f"recording {key!r} not in {p}; available: {recs}")
            df = df[df[rcol].astype(str) == key]
        frames = df[fcol].to_numpy(dtype=int)
        syl = df["syllable"].to_numpy(dtype=float)
    if frames.size == 0:
        raise ValueError("no syllable rows found")
    if frames.min() < 0:
        raise ValueError("negative frame indices")
    n = int(frames.max()) + 1
    labels = np.full(n, -1, dtype=int)
    ok = np.isfinite(syl) & (syl >= 0)
    labels[frames[ok]] = syl[ok].astype(int)
    n_syl = int(labels.max()) + 1 if (labels >= 0).any() else 0
    if names is None:
        label_names = [f"syl{k:02d}" for k in range(n_syl)]
    elif isinstance(names, dict):
        label_names = [names.get(k, f"syl{k:02d}") for k in range(n_syl)]
    else:
        label_names = list(names)
        if len(label_names) < n_syl:
            raise ValueError(
                f"names has {len(label_names)} entries but syllable ids reach {n_syl - 1}"
            )
    t = video_time_to_neural(np.arange(n) / float(fs_video), t_offset_s)
    return LabelSeries(t=t, labels=labels, label_names=label_names)
