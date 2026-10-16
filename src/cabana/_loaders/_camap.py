"""CaMAP ``.camap`` bundle loader."""

from __future__ import annotations

import json
import re
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

from .._models import Session
from ._common import check_path, infer_fs


def _yaml(p: Path):
    return yaml.safe_load(p.read_text()) if p.exists() else None


def load_camap(path) -> Session:
    """Load a CaMAP ``.camap`` bundle directory (``BaseCaMAPDataset.save_bundle``) as a Session.

    The bundle layout is read from CaMAP's ``save_bundle`` (bundle schema ``version`` 1).  Files
    consumed:

    * ``metadata.json`` and ``config.yaml`` (``neural.fps`` gives ``fs``) and, if present,
      ``data_config.yaml``; all three are kept in ``meta["camap"]`` (with the parsed
      ``behavior.speed_threshold`` etc. inside ``config``).
    * ``canonical.parquet`` (preferred; needs ``pyarrow``): one row per neural frame that has
      behavior coverage, with ``neural_time`` (seconds, the neural clock), ``frame_index``,
      ``s_unit_<id>`` columns (OASIS-deconvolved activity -> ``activity``, ``activity_kind=
      "deconvolved"``, ``cell_ids`` = unit ids) and every other numeric column (``x``, ``y``,
      ``speed``, ``pos_1d``, ``speed_1d`` ...) -> ``Session.signals`` on the neural clock (mm).
      Frames outside behavior coverage are absent, so ``t`` can have gaps.
    * Fallback when the parquet is missing/unreadable: ``deconv.npz`` (``good_unit_ids``,
      ``S_0``, ``S_1`` ...) with ``t = arange(n) / fps`` and no behavior signals (a warning says so).

    Not read: ``footprints.nc``, ``traces.nc``, ``unit_results/`` (per-cell place-field results),
    ``spatial.npz`` (spatial occupancy/validity maps, not per-frame), ``figures/``.  CaMAP
    binarises events inside its analysis (``event_threshold_sigma``), so the loaded activity is the
    deconvolved amplitude; use cabana's ``binarize`` preprocess to reproduce that.

    Parameters
    ----------
    path : str or Path
        The ``.camap`` directory.

    Raises
    ------
    FileNotFoundError / ValueError
        If the directory or any usable activity data is missing.
    """
    p = check_path(path, "CaMAP bundle")
    if not p.is_dir():
        raise ValueError(f"{p} is not a directory; a .camap bundle is a directory")
    metadata = (
        json.loads((p / "metadata.json").read_text()) if (p / "metadata.json").exists() else {}
    )
    config = _yaml(p / "config.yaml") or {}
    data_cfg = _yaml(p / "data_config.yaml")
    fps = (config.get("neural") or {}).get("fps")
    meta_camap = {"metadata": metadata, "config": config, "data_config": data_cfg}
    signals: dict[str, np.ndarray] = {}
    pq = p / "canonical.parquet"
    session_kw = None
    if pq.exists():
        try:
            df = pd.read_parquet(pq)
        except ImportError:
            warnings.warn(
                "pyarrow missing; cannot read canonical.parquet, using deconv.npz",
                UserWarning,
                stacklevel=2,
            )
            df = None
        if df is not None:
            unit_cols = [c for c in df.columns if re.fullmatch(r"s_unit_-?\d+", c)]
            if "neural_time" not in df.columns or not unit_cols:
                raise KeyError(
                    f"canonical.parquet needs 'neural_time' and 's_unit_<id>' columns; has {list(df.columns)}"
                )
            t = df["neural_time"].to_numpy(dtype=float)
            for c in df.columns:
                if (
                    c != "neural_time"
                    and c not in unit_cols
                    and pd.api.types.is_numeric_dtype(df[c])
                ):
                    signals[c] = df[c].to_numpy(dtype=float)
            session_kw = {
                "activity": df[unit_cols].to_numpy(dtype=float).T,
                "t": t,
                "cell_ids": [c.removeprefix("s_unit_") for c in unit_cols],
            }
            meta_camap["source"] = "canonical.parquet"
    if session_kw is None:
        npz = p / "deconv.npz"
        if not npz.exists():
            raise FileNotFoundError(f"{p} has neither a readable canonical.parquet nor deconv.npz")
        z = np.load(npz)
        S = []
        while f"S_{len(S)}" in z.files:
            S.append(z[f"S_{len(S)}"])
        if not S:
            raise KeyError(f"deconv.npz has no S_<i> arrays; keys: {z.files}")
        if fps is None:
            raise KeyError(
                "config.yaml has no neural.fps; cannot build a time base from deconv.npz"
            )
        ids = [str(i) for i in z["good_unit_ids"]] if "good_unit_ids" in z.files else None
        warnings.warn(
            "loaded deconv.npz only: no behavior signals or timestamps", UserWarning, stacklevel=2
        )
        act = np.stack(S)
        session_kw = {"activity": act, "t": np.arange(act.shape[1]) / float(fps), "cell_ids": ids}
        meta_camap["source"] = "deconv.npz"
    fs = float(fps) if fps else infer_fs(session_kw["t"])
    return Session(
        fs=fs,
        activity_kind="deconvolved",
        signals=signals,
        meta={"source": "camap", "file": str(p), "camap": meta_camap},
        **session_kw,
    )
