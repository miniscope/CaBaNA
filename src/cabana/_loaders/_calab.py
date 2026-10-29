"""CaLab deconvolution result loader (duck-typed; CaLab itself is never imported)."""

from __future__ import annotations

import warnings
from pathlib import Path
from typing import Any

import numpy as np

from .._models import Session, SessionInfo
from ._common import check_path, time_axis

_NPZ_ALIASES = {
    "alphas": ("alphas", "alpha"),
    "baselines": ("baselines", "baseline"),
    "pves": ("pves", "pve"),
}
_KERNEL_KEYS = ("tau_rise", "tau_decay", "beta", "residual")


def _from_npz(p: Path) -> dict[str, Any]:
    with np.load(p, allow_pickle=False) as z:
        d = {k: z[k] for k in z.files}
    if "activity" not in d:
        raise KeyError(f"{p} has no 'activity' array; keys: {sorted(d)}")
    out: dict[str, Any] = {"activity": d["activity"]}
    if "fs" in d:
        out["fs"] = float(d["fs"])
    elif "sampling_rate_hz" in d:
        out["fs"] = float(d["sampling_rate_hz"])
    for canon, names in _NPZ_ALIASES.items():
        for n in names:
            if n in d:
                out[canon] = d[n]
                break
    meta = {}
    for k in _KERNEL_KEYS:
        for n in (k, f"{k}_s"):
            if n in d and np.asarray(d[n]).size == 1:
                meta[k] = float(np.asarray(d[n]))
                break
    out["metadata"] = meta
    return out


def _get(obj: Any, name: str) -> Any:
    return obj.get(name) if isinstance(obj, dict) else getattr(obj, name, None)


def _calab_version() -> str | None:
    try:
        from importlib.metadata import version

        return version("calab")
    except Exception:
        return None


def load_calab(
    result_or_path,
    *,
    fs: float | None = None,
    t=None,
    t_offset_s: float = 0.0,
    raw=None,
    cell_ids=None,
    info: SessionInfo | None = None,
) -> Session:
    """Build a :class:`~cabana.Session` from a CaLab deconvolution result.

    Parameters
    ----------
    result_or_path : CaDeconResult-like, dict, str or Path
        An object with ``.activity`` ``(n_cells, n_time)`` and ``.fs`` (CaLab's
        ``CaDeconResult``, or any duck-typed stand-in), optionally ``.alphas``,
        ``.baselines``, ``.pves`` ``(n_cells,)`` and ``.metadata`` (``tau_rise``,
        ``tau_decay``, ``beta``, ``residual``; each may be ``None``).  A ``dict`` with the same
        keys works too, as does the path of an ``.npz`` holding ``activity`` and ``fs``
        plus any of ``alphas``/``alpha``, ``baselines``/``baseline``, ``pves``/``pve``,
        ``tau_rise``, ``tau_decay``, ``beta``, ``residual``.  CaLab has no native npz writer;
        ``np.savez(path, activity=r.activity, fs=r.fs, alphas=r.alphas, ...)`` produces
        one.  ``calab`` is not imported.
    fs : float, optional
        Overrides the result's rate (a ``UserWarning`` if they differ by more than 1%).
        Required when the input carries no ``fs``.  Ignored when ``t`` is given.
    t : array-like, optional
        Frame times in seconds on the neural clock (overrides ``fs`` / ``t_offset_s``).
    t_offset_s : float
        Same convention as the behaviour loaders: ``t = arange(n) / fs - t_offset_s``
        (the moment imaging started in the other clock); ignored when ``t`` is given.
    raw : array, optional
        Raw traces ``(n_cells, n_time)``.  ``Session`` has one activity layer (multiple
        layers are roadmap C8), so this is validated and then discarded with a warning.
    cell_ids : sequence of str, optional
        Default ``"0".."n-1"``.
    info : SessionInfo, optional

    Returns
    -------
    Session
        ``activity_kind="deconvolved"``.  CaLab emits float32; it is promoted to float64
        (CaBaNA's working dtype).  ``cell_meta`` gets ``alpha``, ``baseline``, ``pve``
        when present, and, when the fit ran, ``tau_rise_s`` / ``tau_decay_s`` (one value per
        session, broadcast to every cell).  ``meta["kernel"]`` holds ``tau_rise_s``,
        ``tau_decay_s``, ``beta``, ``residual`` (``None`` where unavailable),
        ``meta["source"] = "calab"`` and ``meta["calab_version"]`` if calab is installed.

    Notes
    -----
    **Amplitudes are not comparable across cells.**  CaLab rescales each cell's activity
    by its own ``alpha`` (the fluorescence per unit activity), so deconvolved amplitudes
    of two cells differ by their alphas.  Compare binary activity (``detect_events``),
    z-scored activity, or divide by ``cell_meta["alpha"]`` first.
    """
    src_file = None
    if isinstance(result_or_path, (str, Path)):
        p = check_path(result_or_path, "CaLab npz file")
        obj: Any = _from_npz(p)
        src_file = str(p)
    else:
        obj = result_or_path
    act = _get(obj, "activity")
    if act is None:
        raise ValueError("input has no 'activity'")
    act = np.asarray(act)
    if act.ndim != 2:
        raise ValueError(f"activity must be (n_cells, n_time), got shape {act.shape}")
    act = act.astype(np.float64)
    n_cells, n = act.shape

    res_fs = _get(obj, "fs")
    res_fs = None if res_fs is None else float(res_fs)
    if fs is not None and res_fs is not None and abs(fs - res_fs) > 0.01 * res_fs and t is None:
        warnings.warn(
            f"fs={fs:g} Hz differs from the result's fs={res_fs:g} Hz; using fs={fs:g}",
            UserWarning,
            stacklevel=2,
        )
    use_fs = fs if fs is not None else res_fs
    tt = time_axis(n, t=t, fs=None if t is not None else use_fs, t_offset_s=t_offset_s)
    if t is not None:
        from ._common import infer_fs

        use_fs = infer_fs(tt) if use_fs is None else use_fs

    cm: dict[str, np.ndarray] = {}
    for key, col in (("alphas", "alpha"), ("baselines", "baseline"), ("pves", "pve")):
        v = _get(obj, key)
        if v is None:
            continue
        v = np.asarray(v, dtype=np.float64)
        if v.shape != (n_cells,):
            raise ValueError(f"{key} has shape {v.shape}, expected ({n_cells},)")
        cm[col] = v

    md = _get(obj, "metadata") or {}
    kernel: dict[str, float | None] = {}
    for k in _KERNEL_KEYS:
        v = md.get(k) if isinstance(md, dict) else None
        kernel[k + ("_s" if k.startswith("tau") else "")] = None if v is None else float(v)
    for k in ("tau_rise_s", "tau_decay_s"):
        if kernel[k] is not None:
            cm[k] = np.full(n_cells, kernel[k])

    if raw is not None:
        r = np.asarray(raw)
        if r.shape != act.shape:
            raise ValueError(f"raw has shape {r.shape}, expected {act.shape}")
        warnings.warn(
            "raw is not stored: Session has a single activity layer", UserWarning, stacklevel=2
        )

    meta: dict[str, Any] = {"source": "calab", "kernel": kernel}
    ver = _calab_version()
    if ver is not None:
        meta["calab_version"] = ver
    if src_file is not None:
        meta["file"] = src_file
    return Session(
        activity=act,
        t=tt,
        fs=float(use_fs),
        activity_kind="deconvolved",
        cell_ids=[str(c) for c in cell_ids]
        if cell_ids is not None
        else [str(i) for i in range(n_cells)],
        cell_meta=cm,
        meta=meta,
        info=info if info is not None else SessionInfo(),
    )
