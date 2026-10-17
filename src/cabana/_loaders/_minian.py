"""Minian zarr / netCDF loader.

Ported from CaLab (``calab._loaders._minian``, same lab and conventions): variable names
(``S``, ``C``, ``unit_id``, ``frame``) and the lazy ``zarr`` import follow that implementation;
this version reads through ``xarray`` so frame timestamps can be used.
"""

from __future__ import annotations

import warnings
from pathlib import Path

import numpy as np

from .._models import Session
from ._common import check_path, infer_fs, require, validate_time

_KINDS = {"S": "deconvolved", "C": "denoised"}
_TIME_COORDS = ("t", "time", "timestamp", "timestamps", "timestamp_s")


def _open_var(xr, p: Path, name: str):
    """Open variable ``name`` from a Minian output directory, a dataset zarr, or a netCDF file."""
    if p.is_dir():
        for cand in (p / f"{name}.zarr", p / name):
            if cand.is_dir():
                ds = xr.open_zarr(cand)
                break
        else:
            try:
                ds = xr.open_zarr(p)  # one zarr store holding the whole dataset
            except Exception:
                found = sorted(c.name for c in p.iterdir())
                raise KeyError(f"no {name!r} (or {name}.zarr) in {p}; found: {found}") from None
    else:
        ds = xr.open_dataset(p)
    if name not in ds.data_vars:
        raise KeyError(f"variable {name!r} not found in {p}; available: {list(ds.data_vars)}")
    return ds[name], ds


def _load_footprints(xr, p: Path, unit_ids, *, keep: bool, downsample: int):
    """Centroids (and optionally downsampled footprints) from Minian's ``A``, or ``None``.

    Centroids are intensity-weighted from the row / column marginals (lazy for zarr, so
    the full ``(n_units, H, W)`` array is not loaded unless ``keep``), in original pixels.
    """
    try:
        A, _ = _open_var(xr, p, "A")
    except KeyError:
        return None
    dims = [d for d in A.dims if d != "unit_id"]
    if "unit_id" not in A.dims or len(dims) != 2:
        warnings.warn(
            f"'A' has dims {A.dims}; expected (unit_id, height, width): skipped", stacklevel=3
        )
        return None
    try:
        A = A.sel(unit_id=unit_ids)
    except KeyError:
        warnings.warn(
            "'A' does not hold every unit_id of the activity variable: skipped", stacklevel=3
        )
        return None
    A = A.transpose("unit_id", *dims).clip(min=0)
    tot = np.asarray(A.sum(dim=dims).values, dtype=float)
    ys = np.arange(A.sizes[dims[0]], dtype=float)
    xs = np.arange(A.sizes[dims[1]], dtype=float)
    with np.errstate(invalid="ignore", divide="ignore"):
        cy = np.asarray(A.sum(dim=dims[1]).values, dtype=float) @ ys / tot
        cx = np.asarray(A.sum(dim=dims[0]).values, dtype=float) @ xs / tot
    fp = None
    if keep:
        fp = np.asarray(A.values, dtype=np.float32)
        d = int(downsample)
        if d > 1:
            n, h, w = fp.shape
            h2, w2 = h // d, w // d
            fp = fp[:, : h2 * d, : w2 * d].reshape(n, h2, d, w2, d).mean(axis=(2, 4))
    return cx, cy, fp


def load_minian(
    path,
    *,
    activity: str = "S",
    fs: float | None = None,
    t=None,
    footprints: bool = False,
    footprint_downsample: int = 1,
) -> Session:
    """Load a Minian result as a :class:`~cabana.Session`.

    ``path`` may be a Minian output directory containing ``S.zarr`` / ``C.zarr``, a zarr store
    holding the whole dataset, or a netCDF file.  The variable ``activity`` must have dims
    ``(unit_id, frame)`` (either order).  Requires ``xarray`` and ``zarr`` or ``netCDF4``
    (``pip install 'cabana[minian]'``).

    Parameters
    ----------
    path : str or Path
        Minian store.
    activity : {"S", "C"}
        ``S`` deconvolved (``activity_kind="deconvolved"``) or ``C`` denoised fluorescence
        (``"denoised"``; use ``ComputeDff`` for dF/F).
    fs : float, optional
        Frame rate in Hz.  Used as ``arange(n_frames) / fs`` when ``t`` is not given and the
        dataset has no timestamp coordinate on ``frame`` (one of ``t``, ``time``, ``timestamp``,
        ``timestamps``, ``timestamp_s``, in seconds).
    t : array-like, optional
        Frame times in seconds on the neural clock; overrides everything else.

    footprints : bool, default False
        Also attach the spatial footprints ``A`` as ``Session.footprints`` (float32,
        ``(n_cells, H, W)``), averaged over ``footprint_downsample`` x ``footprint_downsample``
        blocks.  Off by default: dense footprints are large.
    footprint_downsample : int, default 1
        Block-mean factor for the attached footprints (``centroid_x`` / ``centroid_y`` are
        always in original pixels, so with a factor above 1 they differ from
        ``Session.footprint_centroids()`` computed from the downsampled images).

    Returns
    -------
    Session
        ``cell_ids`` are the ``unit_id`` values as strings; ``meta["source"] == "minian"``.
        ``cell_meta`` has ``unit_id`` and, when the store holds ``A`` (dims ``unit_id``,
        ``height``, ``width``) covering every unit, ``centroid_x`` / ``centroid_y``.

    Raises
    ------
    ValueError
        If no time information is available (neither ``t``, ``fs`` nor a timestamp coordinate).
    KeyError
        If the variable or the ``unit_id`` / ``frame`` dims are missing.
    """
    if activity not in _KINDS:
        raise ValueError(f"activity must be one of {sorted(_KINDS)}, got {activity!r}")
    xr = require("xarray", "minian", "Minian files")
    p = check_path(path, "Minian store")
    da, ds = _open_var(xr, p, activity)
    for d in ("unit_id", "frame"):
        if d not in da.dims:
            raise KeyError(f"{activity!r} needs dims ('unit_id', 'frame'), got {da.dims}")
    da = da.transpose("unit_id", "frame")
    data = np.asarray(da.values, dtype=float)
    n = data.shape[1]
    src = "user"
    if t is not None:
        tt = validate_time(t, "t")
        if tt.shape[0] != n:
            raise ValueError(f"t has {tt.shape[0]} samples but {activity!r} has {n} frames")
    else:
        tt = None
        for c in _TIME_COORDS:
            if c in da.coords and da.coords[c].dims == ("frame",):
                tt, src = validate_time(da.coords[c].values, c), f"coord:{c}"
                break
        if tt is None and fs is not None:
            if fs <= 0:
                raise ValueError("fs must be positive")
            tt, src = np.arange(n) / float(fs), "fs"
        if tt is None:
            raise ValueError(
                "no time base: pass fs=, or t=, or store a timestamp coordinate "
                f"({', '.join(_TIME_COORDS)}) on 'frame'"
            )
    if fs is not None and src.startswith("coord:"):
        inferred = infer_fs(tt)
        if abs(inferred - float(fs)) > 0.01 * float(fs):
            warnings.warn(
                f"fs={float(fs):g} Hz disagrees with the rate implied by the timestamp "
                f"coordinate ({inferred:g} Hz); the coordinate wins",
                UserWarning,
                stacklevel=2,
            )
    rate = float(fs) if (fs is not None and src in ("fs", "user")) else infer_fs(tt)
    if footprint_downsample < 1:
        raise ValueError("footprint_downsample must be >= 1")
    uid = da["unit_id"].values
    cm = {"unit_id": uid.astype(np.int64) if uid.dtype.kind in "iu" else uid.astype(str)}
    fp = None
    got = _load_footprints(xr, p, uid, keep=footprints, downsample=footprint_downsample)
    if got is not None:
        cm["centroid_x"], cm["centroid_y"], fp = got
    return Session(
        activity=data,
        t=tt,
        fs=rate,
        activity_kind=_KINDS[activity],
        cell_ids=[str(u) for u in da["unit_id"].values],
        cell_meta=cm,
        footprints=fp,
        meta={"source": "minian", "file": str(p), "activity": activity, "time_source": src},
    )
