"""Shared helpers for the real-data loaders: clock alignment and validation."""

from __future__ import annotations

from pathlib import Path

import numpy as np


def check_path(path: str | Path, what: str) -> Path:
    """Return ``path`` as a ``Path`` or raise ``FileNotFoundError`` naming the format."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"{what} not found: {p}")
    return p


def require(module: str, extra: str, what: str):
    """Import an optional dependency or raise an ``ImportError`` that names the extra."""
    import importlib

    try:
        return importlib.import_module(module)
    except ImportError:
        raise ImportError(
            f"{module} is required to load {what}. Install it with: pip install 'cabana[{extra}]'"
        ) from None


def video_time_to_neural(t_video, t_offset_s: float = 0.0) -> np.ndarray:
    """Express times measured from the start of the behavior video on the neural clock.

    Parameters
    ----------
    t_video : array-like
        Times in seconds where 0 is the first frame of the behavior video (the clock BORIS,
        DeepLabCut and Keypoint-MoSeq frame indices all use).
    t_offset_s : float, default 0.0
        The moment imaging started, in video time (i.e. how long the video ran before the
        neural recording began).  The neural clock has its origin there, so
        ``t_neural = t_video - t_offset_s``.  Use 0 if the two were started together.

    Returns
    -------
    numpy.ndarray
        Float array of times on the neural clock.
    """
    return np.asarray(t_video, dtype=float) - float(t_offset_s)


def validate_time(t, name: str = "t", *, strict: bool = False) -> np.ndarray:
    """Return ``t`` as a 1-D float array after checking it is finite and monotonic.

    Raises
    ------
    ValueError
        If ``t`` is not 1-D, has non-finite values, or decreases (or repeats when ``strict``).
    """
    a = np.asarray(t, dtype=float)
    if a.ndim != 1:
        raise ValueError(f"{name} must be 1-D, got shape {a.shape}")
    if not np.all(np.isfinite(a)):
        raise ValueError(f"{name} contains non-finite values")
    d = np.diff(a)
    if np.any(d < 0) or (strict and np.any(d == 0)):
        raise ValueError(f"{name} must be {'strictly increasing' if strict else 'non-decreasing'}")
    return a


def infer_fs(t) -> float:
    """Sampling rate in Hz from the median frame interval of ``t`` (seconds)."""
    a = validate_time(t, "t")
    if a.size < 2:
        raise ValueError("need at least 2 timestamps to infer fs")
    dt = float(np.median(np.diff(a)))
    if dt <= 0:
        raise ValueError("cannot infer fs: median frame interval is not positive")
    return 1.0 / dt


def time_axis(
    n: int,
    *,
    t=None,
    fs: float | None = None,
    t_offset_s: float = 0.0,
    what: str = "signal",
) -> np.ndarray:
    """Build/validate a length-``n`` time vector from explicit ``t`` or ``fs`` + offset.

    ``t`` (already on the neural clock) wins; a non-zero ``t_offset_s`` together with ``t`` is an
    error because it would be silently ignored.
    """
    if t is not None:
        if fs is not None:
            import warnings

            warnings.warn(
                "fs/fs_video is ignored because t was given; t is used as is",
                UserWarning,
                stacklevel=3,
            )
        if t_offset_s:
            raise ValueError("pass either t (already on the neural clock) or t_offset_s, not both")
        a = validate_time(t, "t")
        if a.shape[0] != n:
            raise ValueError(f"t has {a.shape[0]} samples but the {what} has {n}")
        return a
    if fs is None:
        raise ValueError(f"give t (neural-clock seconds) or the video frame rate for the {what}")
    if fs <= 0:
        raise ValueError("frame rate must be positive")
    return video_time_to_neural(np.arange(n) / float(fs), t_offset_s)
