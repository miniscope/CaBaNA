"""Small array helpers shared across modules."""

from __future__ import annotations

from typing import Any

import numpy as np

__all__ = ["order_session_first", "runs"]


def runs(mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """``(starts, lengths)`` (int64 arrays) of each run of True in a 1-D boolean array.

    Parameters
    ----------
    mask : (n,) bool array
        Any array coercible to boolean.

    Returns
    -------
    starts : (n_runs,) int64 numpy.ndarray
        Index of the first True of each run.
    lengths : (n_runs,) int64 numpy.ndarray
        Number of consecutive True entries in each run (so ``stop = start + length``).
    """
    m = np.concatenate([[0], np.asarray(mask, dtype=bool).astype(np.int8), [0]])
    d = np.diff(m)
    starts = np.flatnonzero(d == 1).astype(np.int64)
    stops = np.flatnonzero(d == -1).astype(np.int64)
    return starts, stops - starts


def order_session_first(a: Any, b: Any) -> tuple[Any, Any]:
    """``(session, other)`` from two arguments given in either order.

    Lets ``plot_*(session, result)`` and ``plot_*(result, session)`` both work.
    """
    from ._models import Session

    if isinstance(a, Session):
        return a, b
    if isinstance(b, Session):
        return b, a
    raise TypeError(
        f"expected one Session among the first two arguments, got {type(a).__name__} "
        f"and {type(b).__name__}"
    )
