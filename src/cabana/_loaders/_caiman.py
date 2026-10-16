"""CaImAn HDF5 loader.

Ported from CaLab (``calab._loaders._caiman``, same lab and conventions): the HDF5 keys
(``estimates/C`` ...) and the lazy ``h5py`` import follow that implementation.
"""

from __future__ import annotations

import numpy as np

from .._models import Session
from ._common import check_path, require

_KINDS = {"S": "deconvolved", "C": "raw", "F_dff": "dff"}


def load_caiman(
    path,
    *,
    activity: str = "S",
    fs: float,
    keep_idx_components: bool = True,
) -> Session:
    """Load a CaImAn HDF5 results file as a :class:`~cabana.Session`.

    Reads ``estimates/<activity>`` (``S`` deconvolved spikes, ``C`` denoised fluorescence,
    ``F_dff`` dF/F), shape ``(n_components, n_frames)``, and ``estimates/idx_components`` (the
    accepted components).  Requires ``h5py`` (``pip install 'cabana[caiman]'``).

    Parameters
    ----------
    path : str or Path
        CaImAn results ``.hdf5`` file.
    activity : {"S", "C", "F_dff"}
        Which estimate to load; sets ``activity_kind`` to ``deconvolved`` / ``raw`` / ``dff``.
    fs : float
        Imaging frame rate in Hz (required; ``params/data/fr`` is stored as ``meta`` if present).
    keep_idx_components : bool, default True
        Keep only the accepted components in ``estimates/idx_components`` (when that dataset
        exists).  ``cell_ids`` are the original CaImAn component indices as strings.

    Returns
    -------
    Session
        ``t = arange(n_frames) / fs``; ``meta`` has ``source="caiman"``.

    Raises
    ------
    KeyError
        If ``estimates/<activity>`` is missing (the message lists the available keys).
    """
    if activity not in _KINDS:
        raise ValueError(f"activity must be one of {sorted(_KINDS)}, got {activity!r}")
    if fs is None or fs <= 0:
        raise ValueError("fs (Hz) must be a positive number")
    h5py = require("h5py", "caiman", "CaImAn files")
    p = check_path(path, "CaImAn HDF5 file")
    key = f"estimates/{activity}"
    with h5py.File(p, "r") as f:
        if key not in f or not isinstance(f[key], h5py.Dataset) or f[key].ndim != 2:
            avail = list(f["estimates"].keys()) if "estimates" in f else list(f.keys())
            raise KeyError(f"dataset {key!r} (2-D) not found in {p}; available: {avail}")
        data = np.asarray(f[key], dtype=float)
        idx = (
            np.asarray(f["estimates/idx_components"], dtype=int)
            if ("estimates/idx_components" in f and f["estimates/idx_components"].ndim == 1)
            else None
        )
        fr = float(np.asarray(f["params/data/fr"])) if "params/data/fr" in f else None
    ids = np.arange(data.shape[0])
    n_all = data.shape[0]
    if keep_idx_components and idx is not None:
        if idx.size == 0:
            raise ValueError(
                "CaImAn accepted 0 components (idx_components is empty); "
                "pass keep_idx_components=False to load all"
            )
        if idx.max() >= n_all or idx.min() < 0:
            raise ValueError(f"idx_components out of range for {n_all} components")
        data, ids = data[idx], idx
    return Session(
        activity=data,
        t=np.arange(data.shape[1]) / float(fs),
        fs=float(fs),
        activity_kind=_KINDS[activity],
        cell_ids=[str(i) for i in ids],
        meta={
            "source": "caiman",
            "file": str(p),
            "activity": activity,
            "n_components_total": int(n_all),
            "kept_idx_components": bool(keep_idx_components and idx is not None),
            "caiman_fr": fr,
        },
    )
