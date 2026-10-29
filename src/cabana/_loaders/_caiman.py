"""CaImAn HDF5 loader.

Ported from CaLab (``calab._loaders._caiman``, same lab and conventions): the HDF5 keys
(``estimates/C`` ...) and the lazy ``h5py`` import follow that implementation.
"""

from __future__ import annotations

import warnings

import numpy as np

from .._models import Session
from ._common import check_path, require

_KINDS = {"S": "deconvolved", "C": "denoised", "F_dff": "dff"}


def _centroids(f, n: int):
    """Intensity-weighted ``(x, y)`` centroids from the sparse CSC ``estimates/A``, or ``None``."""
    if "estimates/A" not in f or "params/data/dims" not in f:
        return None
    g = f["estimates/A"]
    try:
        data, ind, ptr = (np.asarray(g[k]) for k in ("data", "indices", "indptr"))
        d1 = int(np.asarray(f["params/data/dims"])[0])
    except (KeyError, TypeError, ValueError, IndexError):
        return None
    if ptr.size != n + 1:
        return None
    col = np.repeat(np.arange(n), np.diff(ptr))
    w = np.clip(data.astype(float), 0, None)
    tot = np.bincount(col, w, n)
    with np.errstate(invalid="ignore", divide="ignore"):
        cx = np.bincount(col, w * (ind // d1), n) / tot  # Fortran order: pixel = y + d1 * x
        cy = np.bincount(col, w * (ind % d1), n) / tot
    return cx, cy


def load_caiman(
    path,
    *,
    activity: str = "S",
    fs: float,
    accepted_only: bool = True,
    keep_idx_components: bool | None = None,
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
        Which estimate to load; sets ``activity_kind`` to ``deconvolved`` / ``denoised`` / ``dff``.
    fs : float
        Imaging frame rate in Hz (required; ``params/data/fr`` is stored as ``meta`` if present).
    accepted_only : bool, default True
        The full session is built first (all components, ``cell_meta["accepted"]`` set), and
        when ``True`` and ``estimates/idx_components`` exists it is reduced with
        :meth:`Session.select_cells <cabana.Session.select_cells>`, so
        ``meta["cell_selection"]`` records ``n_before`` / ``n_after`` and ``cell_meta``
        stays aligned.  ``False`` returns every component; filter later with the
        ``select_cells`` step (``require=["accepted"]``).  ``cell_ids`` are the original
        CaImAn component indices as strings either way.
    keep_idx_components : bool, optional
        Deprecated alias of ``accepted_only``.

    Returns
    -------
    Session
        ``t = arange(n_frames) / fs``; ``meta`` has ``source="caiman"``.  ``cell_meta``
        holds, when present in the file and per-component: ``snr`` (``SNR_comp``),
        ``r_values``, ``cnn_preds``, ``accepted`` (bool; only when ``idx_components``
        exists), and ``centroid_x`` / ``centroid_y`` (pixels, from the sparse ``A`` and
        ``params/data/dims``).

    Raises
    ------
    KeyError
        If ``estimates/<activity>`` is missing (the message lists the available keys).
    ValueError
        If ``accepted_only`` and ``idx_components`` is empty or out of range.
    """
    if keep_idx_components is not None:
        warnings.warn(
            "keep_idx_components is deprecated; use accepted_only",
            DeprecationWarning,
            stacklevel=2,
        )
        accepted_only = bool(keep_idx_components)
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
        n_all = data.shape[0]
        idx = (
            np.asarray(f["estimates/idx_components"], dtype=int)
            if ("estimates/idx_components" in f and f["estimates/idx_components"].ndim == 1)
            else None
        )
        fr = float(np.asarray(f["params/data/fr"])) if "params/data/fr" in f else None
        cm: dict[str, np.ndarray] = {}
        for src, col in (("SNR_comp", "snr"), ("r_values", "r_values"), ("cnn_preds", "cnn_preds")):
            k = f"estimates/{src}"
            if k in f and f[k].ndim == 1 and f[k].shape[0] == n_all:
                cm[col] = np.asarray(f[k], dtype=float)
        cen = _centroids(f, n_all)
    if idx is not None:
        if idx.size and (idx.max() >= n_all or idx.min() < 0):
            raise ValueError(f"idx_components out of range for {n_all} components")
        acc = np.zeros(n_all, dtype=bool)
        acc[idx] = True
        cm["accepted"] = acc
    if cen is not None:
        cm["centroid_x"], cm["centroid_y"] = cen
    do_filter = accepted_only and idx is not None
    if do_filter and idx.size == 0:
        raise ValueError(
            "CaImAn accepted 0 components (idx_components is empty); "
            "pass accepted_only=False to load all"
        )
    s = Session(
        activity=data,
        t=np.arange(data.shape[1]) / float(fs),
        fs=float(fs),
        activity_kind=_KINDS[activity],
        cell_ids=[str(i) for i in range(n_all)],
        cell_meta=cm,
        meta={
            "source": "caiman",
            "file": str(p),
            "activity": activity,
            "n_components_total": int(n_all),
            "kept_idx_components": bool(do_filter),
            "caiman_fr": fr,
        },
    )
    if do_filter:
        s = s.select_cells(idx)
        sel = {**s.meta["cell_selection"], "source": {"loader": "caiman", "accepted_only": True}}
        s = s.replace(meta={**s.meta, "cell_selection": sel})
    return s
