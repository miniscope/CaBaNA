"""Persistence: ``ResultSet`` and ``Session`` to a directory or ``.zip`` (JSON manifest + npz).

**Format version.**  ``manifest["format"]`` (currently 2).  A missing value means 1.
Loading a file with a greater version raises ``ValueError``; an older one is upgraded
in memory by the ``_MIGRATIONS`` chain (``(manifest, arrays) -> (manifest, arrays)``,
applied one version at a time).  Format 2 moved ``cell_ids`` out of the npz files into
the manifest (as JSON lists of ``str``); format 1 stored them as ``<U`` arrays.

**Additive session keys (still format 2).**  ``Session.cell_meta`` (numeric / bool
columns as ``cell_meta/<key>`` arrays, string columns as lists in
``manifest["cell_meta"]["strings"]``), ``Session.footprints`` (``footprints`` array)
and ``Session.info`` (``manifest["info"]``) were added without a format bump: older
files simply lack them and load with empty defaults.

**Strict JSON.**  Manifests are written with ``allow_nan=False``.  Non-finite floats
anywhere in the manifest are written as ``{"__float__": "nan" | "inf" | "-inf"}`` and
restored on load, so every manifest parses with any JSON reader.

**Dtype contract** (enforced on save by ``_canon_array``, checked by ``_check_dtypes``):

* floating arrays are ``float64``, or ``float32`` if they already are (shuffle null
  draws are always stored as ``float32``);
* masks and significance flags are ``bool``;
* integer arrays (``state_index``, ``shifts``, ...) are ``int32`` when every value
  fits; ``int64`` only when a value exceeds the ``int32`` range.  Integer types
  narrower than 32 bits are kept as they are;
* ``Session.footprints`` are stored as ``float32`` to save space (a lossy cast for
  float64 input); ``cell_meta`` numeric / bool columns keep their dtype;
* never ``object`` dtype (``allow_pickle`` stays ``False`` on load).  Fixed-width
  unicode arrays are only tolerated inside user ``meta``.
"""

from __future__ import annotations

import io
import json
import zipfile
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np

from ._models import (
    BoutTable,
    ContinuousSignal,
    GridTopology,
    LabelSeries,
    Session,
    SessionInfo,
    StateSpace,
)
from ._schema import SCHEMA_VERSION
from ._results import MetricResult, ResultSet, RunError, RunWarning, ShuffleResult

_FORMAT = 2

# Keys a file must contain (everything else is read with ``.get`` and defaulted).
_REQUIRED_RESULT_ARRAYS = ("values",)
_REQUIRED_SHUFFLE_ARRAYS = ("sh_observed", "sh_p_value", "sh_null_lo", "sh_null_hi")
_REQUIRED_ENTRY_KEYS = ("metric", "target", "file")
_REQUIRED_SHUFFLE_META = ("alpha", "tail", "n_shuffles", "null_name")
_REQUIRED_SESSION_ARRAYS = ("activity", "t")
_REQUIRED_SESSION_KEYS = ("fs", "activity_kind")


# --------------------------------------------------------------------------- #
# file container
# --------------------------------------------------------------------------- #


def _write_files(path: str | Path, files: dict[str, bytes]) -> None:
    path = Path(path)
    if path.suffix == ".zip":
        path.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
            for name, data in files.items():
                z.writestr(name, data)
    else:
        for name, data in files.items():
            f = path / name
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(data)


def _read_files(path: str | Path) -> dict[str, bytes]:
    path = Path(path)
    if path.is_dir():
        return {
            p.relative_to(path).as_posix(): p.read_bytes() for p in path.rglob("*") if p.is_file()
        }
    if path.is_file() and zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as z:
            return {n: z.read(n) for n in z.namelist()}
    raise FileNotFoundError(f"{str(path)!r} is not a saved directory or .zip")


def _npz_bytes(arrays: dict[str, np.ndarray]) -> bytes:
    buf = io.BytesIO()
    np.savez_compressed(buf, **arrays)
    return buf.getvalue()


def _npz_load(data: bytes) -> dict[str, np.ndarray]:
    with np.load(io.BytesIO(data), allow_pickle=False) as z:
        return {k: z[k] for k in z.files}


_INT32 = np.iinfo(np.int32)


def _canon_array(a: Any) -> np.ndarray:
    """Cast ``a`` to the on-disk dtype contract (see module docstring)."""
    a = np.asarray(a)
    k = a.dtype.kind
    if k == "O":
        raise TypeError("object arrays cannot be saved (allow_pickle is disabled)")
    if k == "f":
        return a if a.dtype in (np.float32, np.float64) else a.astype(np.float64)
    if k in "iu" and a.dtype.itemsize >= 4:
        if a.size == 0 or (a.min() >= _INT32.min and a.max() <= _INT32.max):
            return a.astype(np.int32)
        return a.astype(np.int64)  # values exceed int32: keep 64 bit
    return a


def _check_dtypes(arrays: dict[str, np.ndarray]) -> None:
    """Raise ``ValueError`` if any array violates the dtype contract (used on save and in tests)."""
    bad = []
    for k, a in arrays.items():
        a = np.asarray(a)
        kind = a.dtype.kind
        if kind == "O":
            bad.append(f"{k}: object dtype")
        elif kind == "f" and a.dtype not in (np.float32, np.float64):
            bad.append(f"{k}: {a.dtype} (floats must be float32/float64)")
        elif kind in "iu" and a.dtype.itemsize >= 4:
            fits = a.size == 0 or (a.min() >= _INT32.min and a.max() <= _INT32.max)
            if fits and a.dtype != np.int32:
                bad.append(f"{k}: {a.dtype} but values fit int32")
            elif not fits and a.dtype != np.int64:
                bad.append(f"{k}: {a.dtype} but values exceed int32 (use int64)")
    if bad:
        raise ValueError("dtype contract violated: " + "; ".join(bad))


def _npz_bytes(arrays: dict[str, np.ndarray]) -> bytes:
    arrays = {k: _canon_array(v) for k, v in arrays.items()}
    _check_dtypes(arrays)
    buf = io.BytesIO()
    np.savez_compressed(buf, **arrays)
    return buf.getvalue()


def _npz_load(data: bytes) -> dict[str, np.ndarray]:
    with np.load(io.BytesIO(data), allow_pickle=False) as z:
        return {k: z[k] for k in z.files}


#: Axis labels used in ``manifest["results"][i]["arrays"][key]["axes"]`` (``None`` = unknown).
AXIS_LABELS = ("cell", "state", "shuffle", "time", "bin", "group", "lag", "fold", "channel")


def _match_axes(
    shape: tuple[int, ...],
    sizes: dict[str, int],
    *,
    first: str | None = None,
    grid_shape: tuple[int, ...] | None = None,
) -> list[str | None]:
    """Name each axis of ``shape`` by matching its length against known sizes.

    ``sizes`` maps a label to the length it would have (``cell``, ``state``,
    ``shuffle``).  A trailing run of two or more axes whose product is the number of
    states (or that equals ``grid_shape``) is a grid: one ``"bin"`` per axis.  An axis
    matching several labels takes ``first`` when it is axis 0, else ``state``.
    """
    axes: list[str | None] = [None] * len(shape)
    n_states = sizes.get("state")
    start = 0
    if first is not None and shape:
        axes[0] = first
        start = 1
    rest = shape[start:]
    if len(rest) >= 2 and (
        (grid_shape is not None and tuple(rest[-len(grid_shape) :]) == tuple(grid_shape))
        or (n_states is not None and int(np.prod(rest)) == n_states)
    ):
        k = len(grid_shape) if grid_shape is not None and len(grid_shape) <= len(rest) else None
        n_grid = k if k is not None else len(rest)
        for i in range(len(shape) - n_grid, len(shape)):
            axes[i] = "bin"
    for i in range(start, len(shape)):
        if axes[i] is not None:
            continue
        hits = [lab for lab, n in sizes.items() if n == shape[i]]
        if len(hits) == 1:
            axes[i] = hits[0]
        elif len(hits) > 1:
            axes[i] = "state" if "state" in hits else hits[0]
    return axes


def _array_meta(
    result: MetricResult,
    key: str,
    arr: np.ndarray,
    grid_shape: tuple[int, ...] | None = None,
) -> dict[str, Any]:
    """Shape, dtype and axis labels of one array stored for ``result``.

    Parameters
    ----------
    result : MetricResult
        The result the array belongs to (its ``level``, ``values``, ``state_names``,
        ``cell_ids``, ``shuffle`` and ``provenance`` give the axis sizes).
    key : str
        npz key: ``values``, ``extra_<j>`` or ``sh_*``.
    arr : ndarray
        The array as saved (after the dtype contract was applied).
    grid_shape : tuple[int, ...], optional
        Grid shape of the target; default ``provenance["target_params"]["shape"]`` if present.

    Returns
    -------
    dict
        ``{"shape": [...], "dtype": str, "axes": [label or None, ...]}``.
    """
    arr = np.asarray(arr)
    vals = np.asarray(result.values)
    prov = result.provenance or {}
    if grid_shape is None:
        tp = prov.get("target_params")
        shp = prov.get("target_shape")
        if shp is None and isinstance(tp, dict):
            shp = tp.get("shape")
        if isinstance(shp, (list, tuple)) and shp and all(isinstance(v, int) for v in shp):
            grid_shape = tuple(shp)
    n_cells = len(result.cell_ids) if result.cell_ids is not None else prov.get("n_cells")
    if n_cells is None and result.level == "cell" and vals.ndim:
        n_cells = vals.shape[0]
    sn = result.state_names
    n_states = len(sn) if sn is not None else None
    if n_states is None and result.level == "cell" and vals.ndim >= 2:
        n_states = vals.shape[1]
    if n_states is None and grid_shape is not None:
        n_states = int(np.prod(grid_shape))  # flattened grid bins are the states
    n_shuf = result.shuffle.n_shuffles if result.shuffle is not None else prov.get("n_shuffles")
    sizes: dict[str, int] = {}
    if isinstance(n_cells, int):
        sizes["cell"] = n_cells
    if isinstance(n_states, int):
        sizes["state"] = n_states
    if isinstance(n_shuf, int) and key != "values":
        sizes["shuffle"] = n_shuf

    def values_axes() -> list[str | None]:
        v = vals.shape
        if result.level == "cell":
            if len(v) == 1:
                return ["cell"]
            if len(v) == 2:
                return ["cell", "state"]
            return _match_axes(v, sizes, first="cell", grid_shape=grid_shape)
        if sn is not None:
            if len(v) == 1:
                return ["state"]
            if len(v) == 2 and v[0] == v[1]:
                return ["state", "state"]
        elif len(v) == 2 and v[0] == v[1] and v[0] == n_cells:
            return ["cell", "cell"]
        return _match_axes(v, {k: n for k, n in sizes.items() if k != "shuffle"})

    if key == "values":
        axes = values_axes()
    elif key == "sh_shifts":
        axes = ["shuffle"]
    elif key.startswith("sh_"):
        va = values_axes()
        if key == "sh_null" and arr.ndim == len(va) + 1:
            axes = ["shuffle", *va]
        elif arr.shape == vals.shape:
            axes = va
        else:
            axes = _match_axes(arr.shape, sizes, grid_shape=grid_shape)
    else:
        first = "cell" if result.level == "cell" and arr.ndim and "cell" in sizes else None
        if first and arr.shape[0] != sizes["cell"]:
            first = None
        axes = _match_axes(arr.shape, sizes, first=first, grid_shape=grid_shape)
    return {"shape": [int(n) for n in arr.shape], "dtype": arr.dtype.name, "axes": axes}


def _jsonable(x: Any, store: dict[str, np.ndarray] | None = None) -> Any:
    """JSON-safe copy; arrays go to ``store`` (as ``{"__array__": key}``) when given."""
    if isinstance(x, dict):
        return {str(k): _jsonable(v, store) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_jsonable(v, store) for v in x]
    if isinstance(x, np.ndarray):
        if store is None:
            return x.tolist()
        key = f"meta_{len(store)}"
        store[key] = x
        return {"__array__": key}
    if isinstance(x, np.generic):
        return x.item()
    if isinstance(x, (str, int, float, bool)) or x is None:
        return x
    return str(x)


_FLOAT_KEY = "__float__"


def _encode_floats(x: Any) -> Any:
    """Replace non-finite floats by ``{"__float__": "nan"|"inf"|"-inf"}`` (recursively)."""
    if isinstance(x, float) and not np.isfinite(x):
        return {_FLOAT_KEY: "nan" if np.isnan(x) else ("inf" if x > 0 else "-inf")}
    if isinstance(x, dict):
        return {k: _encode_floats(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_encode_floats(v) for v in x]
    return x


def _decode_floats(x: Any) -> Any:
    if isinstance(x, dict):
        if set(x) == {_FLOAT_KEY} and x[_FLOAT_KEY] in ("nan", "inf", "-inf"):
            return float(x[_FLOAT_KEY])
        return {k: _decode_floats(v) for k, v in x.items()}
    if isinstance(x, list):
        return [_decode_floats(v) for v in x]
    return x


def _unjson(x: Any, arrays: dict[str, np.ndarray]) -> Any:
    if isinstance(x, dict):
        if set(x) == {"__array__"}:
            return arrays[x["__array__"]]
        return {k: _unjson(v, arrays) for k, v in x.items()}
    if isinstance(x, list):
        return [_unjson(v, arrays) for v in x]
    return x


def _dump(obj: Any) -> bytes:
    return json.dumps(_encode_floats(obj), indent=2, allow_nan=False).encode()


def _str_list(x: Any) -> list[str]:
    return [str(v) for v in x]


# --------------------------------------------------------------------------- #
# format versions and migrations
# --------------------------------------------------------------------------- #

Migration = Callable[[dict, dict], tuple[dict, dict]]


def _migrate_1_to_2(man: dict, arrays: dict) -> tuple[dict, dict]:
    """Format 1 -> 2: ``cell_ids`` moves from ``<U`` npz arrays into the manifest as ``list[str]``.

    ``arrays`` is the flat ``{"<npz file>:<name>": array}`` view for a ResultSet
    (one npz per result) and ``{"<name>": array}`` for a Session.
    """
    if man.get("kind") == "cabana.ResultSet":
        for e in man.get("results", []):
            key = f"{e['file']}:cell_ids"
            if e.pop("has_cell_ids", False) and key in arrays:
                e["cell_ids"] = _str_list(arrays.pop(key))
            else:
                arrays.pop(key, None)
                e.setdefault("cell_ids", None)
    elif man.get("kind") == "cabana.Session":
        man["cell_ids"] = _str_list(arrays.pop("cell_ids", []))
    man["format"] = 2
    return man, arrays


_MIGRATIONS: dict[int, Migration] = {1: _migrate_1_to_2}


def _format_of(man: dict) -> int:
    fmt = man.get("format", 1)
    if isinstance(fmt, bool) or not isinstance(fmt, int) or fmt < 1:
        raise ValueError(f"invalid manifest format {fmt!r}")
    if fmt > _FORMAT:
        raise ValueError(
            f"file was written by a newer cabana (format {fmt} > {_FORMAT}); upgrade cabana"
        )
    return fmt


def _migrate(man: dict, arrays: dict, fmt: int) -> tuple[dict, dict]:
    while fmt < _FORMAT:
        if fmt not in _MIGRATIONS:
            raise ValueError(f"no migration from format {fmt} to {fmt + 1}")
        man, arrays = _MIGRATIONS[fmt](man, arrays)
        fmt += 1
        man["format"] = fmt
    return man, arrays


def _require(d: dict, keys: tuple[str, ...], what: str) -> None:
    missing = [k for k in keys if k not in d]
    if missing:
        raise ValueError(f"saved file is missing required {what}: {', '.join(missing)}")


# --------------------------------------------------------------------------- #
# ResultSet
# --------------------------------------------------------------------------- #


def save_results(rs: ResultSet, path: str | Path) -> None:
    """Write a ``ResultSet`` (backs :meth:`ResultSet.save`).

    Layout: ``manifest.json`` (``format``, ``kind="cabana.ResultSet"`` and one
    entry per result with names, params, provenance, shuffle settings and an ``arrays``
    map of shape / dtype / axis labels per stored array; ``schema_version`` is the semver
    of ``schemas/resultset-v1.json``) plus
    ``results/NNN.npz`` per result holding ``values``, the extras
    and the shuffle arrays (null draws as float32).  ``cell_ids`` and ``state_names``
    are lists of ``str`` in the manifest entry.  See the module docstring for the
    format version, strict-JSON and dtype rules.

    Parameters
    ----------
    rs : ResultSet
        Results to save.
    path : str or Path
        Directory, or a path ending in ``.zip``.
    """
    files: dict[str, bytes] = {}
    entries = []
    for i, r in enumerate(rs.results):
        arrays: dict[str, np.ndarray] = {"values": np.asarray(r.values)}
        extra_keys = {}
        for j, (k, v) in enumerate(r.extras.items()):
            arrays[f"extra_{j}"] = np.asarray(v)
            extra_keys[f"extra_{j}"] = k
        sh_meta = None
        if r.shuffle is not None:
            sh = r.shuffle
            for field in ("observed", "p_value", "null_lo", "null_hi", "significant"):
                arrays[f"sh_{field}"] = np.asarray(getattr(sh, field))
            for field in (
                "shifts",
                "null_median",
                "null_mean",
                "null_std",
                "p_adj",
                "significant_adj",
            ):
                v = getattr(sh, field)
                if v is not None:
                    arrays[f"sh_{field}"] = np.asarray(v)
            if sh.null is not None:
                arrays["sh_null"] = np.asarray(sh.null, dtype=np.float32)
            sh_meta = {
                "alpha": sh.alpha,
                "tail": sh.tail,
                "n_shuffles": sh.n_shuffles,
                "null_name": sh.null_name,
                "correction": sh.correction,
                "correction_scope": sh.correction_scope,
                "correction_note": sh.correction_note,
                "null_info": _jsonable(sh.null_info),
            }
        fname = f"results/{i:03d}.npz"
        files[fname] = _npz_bytes(arrays)
        arrays_meta = {k: _array_meta(r, k, _canon_array(v)) for k, v in arrays.items()}
        entries.append(
            {
                "file": fname,
                "metric": r.metric,
                "name": r.name,
                "target": r.target,
                "target_kind": r.target_kind,
                "level": r.level,
                "params": _jsonable(r.params),
                "provenance": _jsonable(r.provenance),
                "state_names": None if r.state_names is None else _str_list(r.state_names),
                "cell_ids": None if r.cell_ids is None else _str_list(r.cell_ids),
                "extras": extra_keys,
                "arrays": arrays_meta,
                "shuffle": sh_meta,
            }
        )
    files["manifest.json"] = _dump(
        {
            "format": _FORMAT,
            "schema_version": SCHEMA_VERSION,
            "kind": "cabana.ResultSet",
            "results": entries,
            "status": rs.status,
            "completed": list(rs.completed),
            "errors": [e.model_dump() for e in rs.errors],
            "warnings": [w.model_dump() for w in rs.warnings],
        }
    )
    _write_files(path, files)


def load_results(path: str | Path) -> ResultSet:
    """Read a ``ResultSet`` written by :func:`save_results`.

    Parameters
    ----------
    path : str or Path
        Directory or ``.zip``.

    Returns
    -------
    ResultSet

    Raises
    ------
    FileNotFoundError
        If ``path`` is neither a directory nor a zip file.
    ValueError
        If there is no ``manifest.json`` or it is not a saved ``ResultSet``.
    """
    files = _read_files(path)
    if "manifest.json" not in files:
        raise ValueError(f"{str(path)!r} has no manifest.json")
    man = _decode_floats(json.loads(files["manifest.json"]))
    if man.get("kind") != "cabana.ResultSet":
        raise ValueError(f"{str(path)!r} is not a saved ResultSet")
    fmt = _format_of(man)
    flat: dict[str, np.ndarray] = {}
    for e in man.get("results", []):
        _require(e, _REQUIRED_ENTRY_KEYS, "result keys")
        for k, v in _npz_load(files[e["file"]]).items():
            flat[f"{e['file']}:{k}"] = v
    man, flat = _migrate(man, flat, fmt)
    rs = ResultSet()
    for e in man.get("results", []):
        pre = f"{e['file']}:"
        a = {k[len(pre) :]: v for k, v in flat.items() if k.startswith(pre)}
        _require(a, _REQUIRED_RESULT_ARRAYS, f"arrays in {e['file']}")
        sh = None
        if e.get("shuffle") is not None:
            m = e["shuffle"]
            _require(m, _REQUIRED_SHUFFLE_META, "shuffle settings")
            _require(a, _REQUIRED_SHUFFLE_ARRAYS, f"shuffle arrays in {e['file']}")
            p = a["sh_p_value"]
            sig = a.get("sh_significant")
            if sig is None:
                sig = np.nan_to_num(p, nan=1.0) < m["alpha"]
            sh = ShuffleResult(
                observed=a["sh_observed"],
                null=a.get("sh_null"),
                shifts=a.get("sh_shifts"),
                p_value=p,
                null_lo=a["sh_null_lo"],
                null_hi=a["sh_null_hi"],
                significant=sig,
                null_median=a.get("sh_null_median"),
                null_mean=a.get("sh_null_mean"),
                null_std=a.get("sh_null_std"),
                null_info=dict(m.get("null_info") or {}),
                p_adj=a.get("sh_p_adj"),
                significant_adj=a.get("sh_significant_adj"),
                correction=m.get("correction", "none"),
                correction_scope=m.get("correction_scope", "states"),
                correction_note=m.get("correction_note", ""),
                alpha=m["alpha"],
                tail=m["tail"],
                n_shuffles=m["n_shuffles"],
                null_name=m["null_name"],
            )
        rs.add(
            MetricResult(
                metric=e["metric"],
                name=e.get("name"),
                target=e["target"],
                target_kind=e.get("target_kind", "states"),
                level=e.get("level", "cell"),
                values=a["values"],
                shuffle=sh,
                params=e.get("params") or {},
                provenance=e.get("provenance") or {},
                extras={k: a[f] for f, k in (e.get("extras") or {}).items() if f in a},
                cell_ids=e.get("cell_ids"),
                state_names=e.get("state_names"),
            )
        )
    rs.status = man.get("status", "ok")
    rs.completed = list(man.get("completed", rs.names()))
    rs.errors = [RunError(**e) for e in man.get("errors", [])]
    rs.warnings = [RunWarning(**w) for w in man.get("warnings", [])]
    return rs


# --------------------------------------------------------------------------- #
# Session
# --------------------------------------------------------------------------- #


def save_session(s: Session, path: str | Path) -> None:
    """Write a ``Session`` (backs :meth:`Session.save`).

    Layout: ``manifest.json`` (``format``, ``kind="cabana.Session"``, ``fs``,
    ``activity_kind``, ``cell_ids``, state / behavior descriptions, JSON-safe ``meta``) and
    ``arrays.npz`` (activity, ``t``, masks, signals, state ``onehot`` /
    ``support`` / grid edges, raw behavior arrays and arrays found in ``meta``).
    Non-JSON ``meta`` values are stored as strings.

    Parameters
    ----------
    s : Session
        Session to save.
    path : str or Path
        Directory, or a path ending in ``.zip``.
    """
    arrays: dict[str, np.ndarray] = {
        "activity": np.asarray(s.activity),
        "t": np.asarray(s.t),
    }
    for k, v in s.masks.items():
        arrays[f"mask/{k}"] = np.asarray(v, bool)
    for k, v in s.signals.items():
        arrays[f"signal/{k}"] = np.asarray(v)
    states = {}
    for k, st in s.states.items():
        arrays[f"state/{k}/onehot"] = st.onehot
        if st.support is not None:
            arrays[f"state/{k}/support"] = np.asarray(st.support, bool)
        topo = None
        if st.topology is not None:
            for a, e in enumerate(st.topology.edges):
                arrays[f"state/{k}/edges_{a}"] = np.asarray(e)
            topo = {"shape": list(st.topology.shape), "axis_names": list(st.topology.axis_names)}
        states[k] = {
            "state_names": list(st.state_names),
            "kind": st.kind,
            "exclusive": st.exclusive,
            "has_support": st.support is not None,
            "topology": topo,
        }
    behavior = {}
    for k, b in s.behavior.items():
        if isinstance(b, ContinuousSignal):
            arrays[f"behavior/{k}/t"] = b.t
            arrays[f"behavior/{k}/values"] = b.values
            behavior[k] = {
                "type": "continuous",
                "channel_names": list(b.channel_names),
                "units": b.units,
            }
        elif isinstance(b, BoutTable):
            arrays[f"behavior/{k}/start_s"] = b.start_s
            arrays[f"behavior/{k}/stop_s"] = b.stop_s
            behavior[k] = {
                "type": "bouts",
                "labels": list(b.labels),
                "scored_start_s": b.scored_start_s,
                "scored_stop_s": b.scored_stop_s,
            }
        else:
            arrays[f"behavior/{k}/t"] = b.t
            arrays[f"behavior/{k}/labels"] = b.labels
            behavior[k] = {"type": "labels", "label_names": list(b.label_names)}
    meta_store: dict[str, np.ndarray] = {}
    info = _jsonable(s.info.model_dump(), meta_store)
    cm_strings: dict[str, list[str]] = {}
    for k, v in s.cell_meta.items():
        if v.dtype.kind == "U":
            cm_strings[k] = [str(x) for x in v]
        else:
            arrays[f"cell_meta/{k}"] = np.asarray(v)
    if s.footprints is not None:
        arrays["footprints"] = np.asarray(s.footprints, dtype=np.float32)
    meta = _jsonable(s.meta, meta_store)
    for k, v in meta_store.items():
        arrays[k] = v
    manifest = {
        "format": _FORMAT,
        "kind": "cabana.Session",
        "fs": s.fs,
        "activity_kind": s.activity_kind,
        "cell_ids": _str_list(s.cell_ids or []),
        "masks": list(s.masks),
        "signals": list(s.signals),
        "states": states,
        "behavior": behavior,
        "meta": meta,
        "info": info,
        "cell_meta": {"order": list(s.cell_meta), "strings": cm_strings},
        "has_footprints": s.footprints is not None,
    }
    _write_files(path, {"manifest.json": _dump(manifest), "arrays.npz": _npz_bytes(arrays)})


def load_session(path: str | Path) -> Session:
    """Read a ``Session`` written by :func:`save_session`.

    Parameters
    ----------
    path : str or Path
        Directory or ``.zip``.

    Returns
    -------
    Session

    Raises
    ------
    FileNotFoundError
        If ``path`` is neither a directory nor a zip file.
    ValueError
        If the manifest or arrays are missing, or it is not a saved ``Session``.
    """
    files = _read_files(path)
    if "manifest.json" not in files or "arrays.npz" not in files:
        raise ValueError(f"{str(path)!r} is not a saved Session")
    man = _decode_floats(json.loads(files["manifest.json"]))
    if man.get("kind") != "cabana.Session":
        raise ValueError(f"{str(path)!r} is not a saved Session")
    fmt = _format_of(man)
    man, a = _migrate(man, _npz_load(files["arrays.npz"]), fmt)
    _require(a, _REQUIRED_SESSION_ARRAYS, "arrays")
    _require(man, _REQUIRED_SESSION_KEYS, "manifest keys")
    states = {}
    for k, m in (man.get("states") or {}).items():
        topo = None
        if m.get("topology") is not None:
            shape = tuple(m["topology"]["shape"])
            topo = GridTopology(
                shape=shape,
                edges=[a[f"state/{k}/edges_{i}"] for i in range(len(shape))],
                axis_names=m["topology"]["axis_names"],
            )
        states[k] = StateSpace(
            name=k,
            onehot=a[f"state/{k}/onehot"],
            state_names=m["state_names"],
            kind=m["kind"],
            exclusive=m["exclusive"],
            topology=topo,
            support=a[f"state/{k}/support"] if m.get("has_support") else None,
        )
    behavior: dict[str, Any] = {}
    for k, m in (man.get("behavior") or {}).items():
        if m["type"] == "continuous":
            behavior[k] = ContinuousSignal(
                t=a[f"behavior/{k}/t"],
                values=a[f"behavior/{k}/values"],
                channel_names=m["channel_names"],
                units=m["units"],
            )
        elif m["type"] == "bouts":
            behavior[k] = BoutTable(
                labels=m["labels"],
                start_s=a[f"behavior/{k}/start_s"],
                stop_s=a[f"behavior/{k}/stop_s"],
                scored_start_s=m["scored_start_s"],
                scored_stop_s=m["scored_stop_s"],
            )
        else:
            behavior[k] = LabelSeries(
                t=a[f"behavior/{k}/t"],
                labels=a[f"behavior/{k}/labels"],
                label_names=m["label_names"],
            )
    cmm = man.get("cell_meta") or {}
    cm_strings = cmm.get("strings") or {}
    cell_meta: dict[str, np.ndarray] = {}
    for k in cmm.get("order", []):
        cell_meta[k] = (
            np.asarray(cm_strings[k], dtype=str) if k in cm_strings else a[f"cell_meta/{k}"]
        )
    return Session(
        activity=a["activity"],
        t=a["t"],
        fs=man["fs"],
        activity_kind=man["activity_kind"],
        cell_ids=_str_list(man.get("cell_ids", [])),
        behavior=behavior,
        signals={k: a[f"signal/{k}"] for k in man.get("signals", [])},
        states=states,
        masks={k: a[f"mask/{k}"] for k in man.get("masks", [])},
        meta=_unjson(man.get("meta") or {}, a),
        info=SessionInfo(**_unjson(man.get("info") or {}, a)),
        cell_meta=cell_meta,
        footprints=a.get("footprints"),
    )


__all__ = ["load_results", "load_session", "save_results", "save_session"]
