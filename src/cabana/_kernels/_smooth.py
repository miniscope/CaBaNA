"""Edge-normalised Gaussian smoothing over a state grid.

The one place a kernel uses scipy.  Exact semantics a port must reproduce
(``scipy.ndimage.gaussian_filter``):

* separable 1-D Gaussian per grid axis, sigma in grid bins, ``order=0``;
* ``truncate=4.0`` (default): kernel radius ``int(4.0 * sigma + 0.5)`` bins,
  weights ``exp(-x^2 / (2 sigma^2))`` normalised to sum 1;
* ``mode="constant"`` with ``cval=0``: out-of-grid samples are zero;
* leading (non-grid) axes get sigma 0, i.e. are not smoothed;
* NaN is not handled (inputs must be finite);
* edge/invalid normalisation: ``values`` and the 0/1 ``valid`` indicator are
  filtered identically and ``out = filt(values) / filt(valid)``; where
  ``filt(valid) <= 0`` the result is 0.
"""

from __future__ import annotations

import numpy as np
from scipy.ndimage import gaussian_filter


def smooth_grid(
    values: np.ndarray, valid: np.ndarray, shape: tuple[int, ...], sigma: float
) -> np.ndarray:
    """Edge-normalised Gaussian smoothing of ``(..., n_states)`` over a grid.

    Parameters
    ----------
    values : (..., n_states) float64, finite
    valid : (n_states,) bool
    shape : grid shape with ``prod(shape) == n_states`` (C order)
    sigma : float, Gaussian sd in bins (same on every axis)

    Returns
    -------
    float64 array, same shape as ``values``; 0 where no valid state is in reach.
    """
    shape = tuple(int(s) for s in shape)
    values = np.asarray(values, dtype=np.float64)

    def filt(a: np.ndarray) -> np.ndarray:
        a = a.reshape(*a.shape[:-1], *shape)
        sig = (0.0,) * (a.ndim - len(shape)) + (float(sigma),) * len(shape)
        return gaussian_filter(a, sigma=sig, mode="constant")

    norm = filt(np.asarray(valid, dtype=np.float64)).reshape(-1)
    out = filt(values).reshape(values.shape)
    with np.errstate(divide="ignore", invalid="ignore"):
        return np.where(norm > 0, out / norm, 0.0)
