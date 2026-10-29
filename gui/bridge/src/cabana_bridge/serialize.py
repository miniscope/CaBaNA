"""Reading framework results for the GUI: manifest, arrays, tables, summaries, plot data."""

from __future__ import annotations

import io
import json
import math
import threading
import zipfile
from pathlib import Path
from typing import Any

import numpy as np

SUPPORTED_FORMAT = 2
_MPL_LOCK = threading.Lock()  # pyplot state is not thread safe


class UnsupportedResults(ValueError):
    """Results written by a newer framework than the one installed."""


def read_manifest(zip_path: Path) -> dict[str, Any]:
    """The manifest as written (non-finite floats stay `{"__float__": ...}`)."""
    with zipfile.ZipFile(zip_path) as z:
        manifest = json.loads(z.read("manifest.json"))
    if int(manifest.get("format", 1)) > SUPPORTED_FORMAT:
        raise UnsupportedResults(f"results format {manifest['format']} is newer than {SUPPORTED_FORMAT}")
    return manifest


def _entry(manifest: dict[str, Any], name: str) -> dict[str, Any]:
    for entry in manifest["results"]:
        if entry["name"] == name:
            return entry
    raise KeyError(f"result {name!r}")


def manifest_view(zip_path: Path, session: Any) -> dict[str, Any]:
    """Manifest plus, per result, extras by name and the framework plots that apply."""
    manifest = read_manifest(zip_path)
    results = load_results(zip_path)
    from cabana import plots

    for entry in manifest["results"]:
        entry["extras_by_name"] = {v: k for k, v in (entry.get("extras") or {}).items()}
        try:
            entry["plots"] = plots.plots_for(results[entry["name"]], session)
        except Exception:
            entry["plots"] = []
    return manifest


def array_bytes(zip_path: Path, result: str, key: str) -> bytes:
    """One array of one result as `.npy` bytes. `key` is `values`, an extras name or `sh_*`."""
    entry = _entry(read_manifest(zip_path), result)
    npz_key = next((stored for stored, name in (entry.get("extras") or {}).items() if name == key), key)
    with zipfile.ZipFile(zip_path) as z:
        arrays = np.load(io.BytesIO(z.read(entry["file"])), allow_pickle=False)
        if npz_key not in arrays.files:
            raise KeyError(f"array {key!r} of result {result!r}")
        out = io.BytesIO()
        np.save(out, arrays[npz_key], allow_pickle=False)
    return out.getvalue()


def load_results(zip_path: Path) -> Any:
    from cabana import ResultSet

    read_manifest(zip_path)  # version check first, with a clear message
    return ResultSet.load(zip_path)


def _matrix_long_form(res: Any) -> Any:
    """One row per matrix entry (row, column, value and its test), not a printed array."""
    import pandas as pd

    values = np.asarray(res.values)
    n_rows, n_cols = values.shape
    rows = res.state_names if res.state_names and len(res.state_names) == n_rows else list(map(str, range(n_rows)))
    cols = res.state_names if res.state_names and len(res.state_names) == n_cols else list(map(str, range(n_cols)))
    frame = pd.DataFrame(
        {
            "row": np.repeat(rows, n_cols),
            "column": np.tile(cols, n_rows),
            "value": values.ravel(),
        }
    )
    sh = res.shuffle
    if sh is not None:
        for name in ("p_value", "p_adj", "null_lo", "null_hi"):
            arr = getattr(sh, name, None)
            if arr is not None and np.shape(arr) == values.shape:
                frame[name] = np.asarray(arr).ravel()
    return frame


def table_csv(zip_path: Path, result: str) -> str:
    res = load_results(zip_path)[result]
    if res.level == "population" and np.ndim(res.values) == 2:
        return _matrix_long_form(res).to_csv(index=False)
    return res.to_dataframe().to_csv(index=False)


def _clean(value: Any) -> Any:
    if isinstance(value, (np.floating, np.integer)):
        value = value.item()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, np.bool_):
        return bool(value)
    return value


def summary_rows(zip_path: Path) -> list[dict[str, Any]]:
    df = load_results(zip_path).summary()
    return [{k: _clean(v) for k, v in row.items()} for row in df.reset_index().to_dict("records")]


def plot_kwargs(query: dict[str, list[str]]) -> dict[str, Any]:
    """Query-string values to plot keyword arguments (JSON where possible)."""
    out: dict[str, Any] = {}
    for key, values in query.items():
        if key == "token":
            continue
        try:
            out[key] = json.loads(values[-1])
        except ValueError:
            out[key] = values[-1]
    return out


def _spec(kind: str) -> Any:
    from cabana import plots

    try:
        return plots.plot_spec(kind)
    except KeyError as exc:
        raise KeyError(f"plot {kind!r}") from exc


def plot_data_json(zip_path: Path, session: Any, result: str, kind: str, **kw: Any) -> str:
    from cabana import plots

    res = load_results(zip_path)[result]
    spec = _spec(kind)
    if spec.data is None:
        raise ValueError(f"plot {kind!r} has no data function")
    args = dict(spec.defaults(res, session)) if spec.defaults else {}
    args.update(kw)
    data = spec.data(res, session, **args) if spec.needs_session else spec.data(res, **args)
    return plots.to_json(data)


def figure_bytes(zip_path: Path, session: Any, result: str, kind: str, fmt: str, **kw: Any) -> bytes:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from cabana import plots

    res = load_results(zip_path)[result]
    with _MPL_LOCK:
        fig = plots.plot(res, session, kind=kind, **kw)
        try:
            buf = io.BytesIO()
            fig.savefig(buf, format=fmt, dpi=200 if fmt == "png" else None, bbox_inches="tight")
        finally:
            plt.close(fig)
    return buf.getvalue()
