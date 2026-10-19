"""The plot-data layer: what a figure shows, separated from how it is drawn.

Every renderer ``cabana.plots.plot_<x>(...)`` has a companion
``plot_<x>_data(...) -> dict`` that computes *everything the figure shows*
(arrays, labels, units, colours, significance flags, titles) and nothing about
matplotlib.  The renderer calls its ``_data`` function and draws from the
returned dict only; it never goes back to the ``MetricResult`` or ``Session``
for numbers.  This is what lets CaLab (TypeScript) draw the same figure from
the same dict, and what lets a test check a plot without rendering it.

Contract for a plot-data dict
-----------------------------
* ``"kind"``: the plot name without the ``plot_`` prefix, e.g. ``"rate_maps"``.
* ``"version"``: :data:`PLOT_DATA_VERSION` (bumped when any dict's keys or
  meaning change; renderers accept only the current version).
* Arrays are ``numpy.ndarray`` (any dtype JSON can hold after ``tolist``);
  scalars are Python/numpy scalars; labels are ``list[str]``; colours are RGBA
  tuples or hex strings; nested dicts/lists are fine.  Nothing else
  (no ``Figure``, no pandas, no ``Session``).
* NaN means "no data" (an unvisited bin, an untested cell); renderers draw it
  as such (:data:`cabana._plots._style.UNVISITED_COLOR`), never as zero.
* :func:`to_json` must succeed on the dict (strict JSON: NaN/inf become
  ``{"__float__": "nan" | "inf" | "-inf"}``, the same sentinel the results
  manifest uses) and :func:`from_json` must give the dict back with arrays as
  lists.  ``check_plot_data`` asserts all of this and is applied to every
  ``_data`` function in the test-suite.
"""

from __future__ import annotations

import json
from typing import Any

import numpy as np

from .._io import _decode_floats, _encode_floats

__all__ = ["PLOT_DATA_VERSION", "check_plot_data", "from_json", "to_json", "to_jsonable"]

#: Version of the plot-data dict contract (all ``_data`` functions share it).
PLOT_DATA_VERSION = 1


def to_jsonable(x: Any) -> Any:
    """Plain-JSON copy of a plot-data value: arrays to lists, numpy scalars to Python.

    Raises
    ------
    TypeError
        For anything that is not an array, scalar, str, bool, None, dict, list or
        tuple -- a figure, a pandas object or a model slipped into the data dict.
    """
    if isinstance(x, dict):
        return {str(k): to_jsonable(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [to_jsonable(v) for v in x]
    if isinstance(x, np.ndarray):
        if x.dtype.kind in "biuf":
            return to_jsonable(x.tolist())
        if x.dtype.kind in "US":
            return [str(v) for v in x.ravel().tolist()] if x.ndim == 1 else x.astype(str).tolist()
        return to_jsonable(x.tolist())
    if isinstance(x, np.generic):
        return to_jsonable(x.item())
    if isinstance(x, float):
        return _encode_floats(x)
    if isinstance(x, (str, int, bool)) or x is None:
        return x
    raise TypeError(f"plot data may not contain {type(x).__name__} values")


def to_json(data: dict[str, Any], **kw: Any) -> str:
    """Strict JSON text of a plot-data dict (see module docstring)."""
    return json.dumps(to_jsonable(data), allow_nan=False, **kw)


def from_json(text: str) -> dict[str, Any]:
    """Inverse of :func:`to_json`; arrays come back as nested lists."""
    return _decode_floats(json.loads(text))


def check_plot_data(data: dict[str, Any], kind: str | None = None) -> dict[str, Any]:
    """Assert ``data`` follows the plot-data contract; return the JSON round-trip.

    Used by tests on every ``_data`` function.  Checks ``kind`` and ``version``
    keys, that :func:`to_json` succeeds, and that the round-trip preserves
    every finite numeric array value.
    """
    if not isinstance(data, dict):
        raise TypeError(f"plot data must be a dict, got {type(data).__name__}")
    if "kind" not in data or not isinstance(data["kind"], str):
        raise ValueError("plot data needs a str 'kind'")
    if kind is not None and data["kind"] != kind:
        raise ValueError(f"plot data kind {data['kind']!r} != expected {kind!r}")
    if data.get("version") != PLOT_DATA_VERSION:
        raise ValueError(f"plot data version {data.get('version')!r} != {PLOT_DATA_VERSION}")
    back = from_json(to_json(data))
    _assert_same(data, back, "")
    return back


def _assert_same(a: Any, b: Any, path: str) -> None:
    if isinstance(a, dict):
        if set(map(str, a)) != set(b):
            raise AssertionError(f"{path}: keys differ after round-trip")
        for k, v in a.items():
            _assert_same(v, b[str(k)], f"{path}.{k}")
    elif isinstance(a, np.ndarray):
        if a.dtype.kind in "biuf":
            if a.size == 0:
                if np.asarray(b, float).size != 0:
                    raise AssertionError(f"{path}: empty array came back non-empty")
                return
            arr = np.asarray(b, float).reshape(a.shape)
            np.testing.assert_allclose(
                arr, np.asarray(a, float), rtol=0, atol=0, equal_nan=True, err_msg=path
            )
    elif isinstance(a, (list, tuple)):
        if len(a) != len(b):
            raise AssertionError(f"{path}: length differs after round-trip")
        for i, (x, y) in enumerate(zip(a, b, strict=True)):
            _assert_same(x, y, f"{path}[{i}]")
    elif isinstance(a, (float, np.floating)):
        if not (np.isnan(a) and np.isnan(b)) and float(a) != b:
            raise AssertionError(f"{path}: {a!r} != {b!r}")
