"""Persistence: ``ResultSet`` and ``Session`` to a directory or ``.zip`` (JSON manifest + npz)."""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from typing import Any

import numpy as np

from ._models import (
    BoutTable,
    ContinuousSignal,
    GridTopology,
    LabelSeries,
    Session,
    StateSpace,
)
from ._results import MetricResult, ResultSet, RunError, RunWarning, ShuffleResult

_FORMAT = 1


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


def _strs(x: list[str]) -> np.ndarray:
    return np.array([str(v) for v in x], dtype="<U") if len(x) else np.array([], dtype="<U1")


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


def _unjson(x: Any, arrays: dict[str, np.ndarray]) -> Any:
    if isinstance(x, dict):
        if set(x) == {"__array__"}:
            return arrays[x["__array__"]]
        return {k: _unjson(v, arrays) for k, v in x.items()}
    if isinstance(x, list):
        return [_unjson(v, arrays) for v in x]
    return x


def _dump(obj: Any) -> bytes:
    return json.dumps(obj, indent=2, allow_nan=True).encode()


# --------------------------------------------------------------------------- #
# ResultSet
# --------------------------------------------------------------------------- #


def save_results(rs: ResultSet, path: str | Path) -> None:
    """Write a ``ResultSet`` (backs :meth:`ResultSet.save`).

    Layout: ``manifest.json`` (``format``, ``kind="cabana.ResultSet"`` and one
    entry per result with names, params, provenance and shuffle settings) plus
    ``results/NNN.npz`` per result holding ``values``, ``cell_ids``, the extras
    and the shuffle arrays (null draws as float32).

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
        if r.cell_ids is not None:
            arrays["cell_ids"] = _strs(r.cell_ids)
        extra_keys = {}
        for j, (k, v) in enumerate(r.extras.items()):
            arrays[f"extra_{j}"] = np.asarray(v)
            extra_keys[f"extra_{j}"] = k
        sh_meta = None
        if r.shuffle is not None:
            sh = r.shuffle
            for field in ("observed", "p_value", "null_lo", "null_hi", "significant"):
                arrays[f"sh_{field}"] = np.asarray(getattr(sh, field))
            for field in ("shifts", "null_median", "null_mean", "p_adj", "significant_adj"):
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
            }
        fname = f"results/{i:03d}.npz"
        files[fname] = _npz_bytes(arrays)
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
                "state_names": r.state_names,
                "has_cell_ids": r.cell_ids is not None,
                "extras": extra_keys,
                "shuffle": sh_meta,
            }
        )
    files["manifest.json"] = _dump(
        {
            "format": _FORMAT,
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
    man = json.loads(files["manifest.json"])
    if man.get("kind") != "cabana.ResultSet":
        raise ValueError(f"{str(path)!r} is not a saved ResultSet")
    rs = ResultSet()
    for e in man["results"]:
        a = _npz_load(files[e["file"]])
        sh = None
        if e["shuffle"] is not None:
            m = e["shuffle"]
            sh = ShuffleResult(
                observed=a["sh_observed"],
                null=a.get("sh_null"),
                shifts=a.get("sh_shifts"),
                p_value=a["sh_p_value"],
                null_lo=a["sh_null_lo"],
                null_hi=a["sh_null_hi"],
                significant=a["sh_significant"],
                null_median=a.get("sh_null_median"),
                null_mean=a.get("sh_null_mean"),
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
                name=e["name"],
                target=e["target"],
                target_kind=e["target_kind"],
                level=e["level"],
                values=a["values"],
                shuffle=sh,
                params=e["params"],
                provenance=e["provenance"],
                extras={k: a[f] for f, k in e["extras"].items()},
                cell_ids=[str(c) for c in a["cell_ids"]] if e["has_cell_ids"] else None,
                state_names=e["state_names"],
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
    ``activity_kind``, state / behavior descriptions, JSON-safe ``meta``) and
    ``arrays.npz`` (activity, ``t``, cell ids, masks, signals, state ``onehot`` /
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
        "cell_ids": _strs(list(s.cell_ids or [])),
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
    meta = _jsonable(s.meta, meta_store)
    for k, v in meta_store.items():
        arrays[k] = v
    manifest = {
        "format": _FORMAT,
        "kind": "cabana.Session",
        "fs": s.fs,
        "activity_kind": s.activity_kind,
        "masks": list(s.masks),
        "signals": list(s.signals),
        "states": states,
        "behavior": behavior,
        "meta": meta,
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
    man = json.loads(files["manifest.json"])
    if man.get("kind") != "cabana.Session":
        raise ValueError(f"{str(path)!r} is not a saved Session")
    a = _npz_load(files["arrays.npz"])
    states = {}
    for k, m in man["states"].items():
        topo = None
        if m["topology"] is not None:
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
            support=a[f"state/{k}/support"] if m["has_support"] else None,
        )
    behavior: dict[str, Any] = {}
    for k, m in man["behavior"].items():
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
    return Session(
        activity=a["activity"],
        t=a["t"],
        fs=man["fs"],
        activity_kind=man["activity_kind"],
        cell_ids=[str(c) for c in a["cell_ids"]],
        behavior=behavior,
        signals={k: a[f"signal/{k}"] for k in man["signals"]},
        states=states,
        masks={k: a[f"mask/{k}"] for k in man["masks"]},
        meta=_unjson(man["meta"], a),
    )


__all__ = ["load_results", "load_session", "save_results", "save_session"]
