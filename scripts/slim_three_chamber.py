"""Slim the lab's ``simulated_3chamber`` dataset to a small test fixture.

Usage::

    python scripts/slim_three_chamber.py FULL_DIR [OUT_DIR] [--seconds 75]

``FULL_DIR`` holds the full dataset (``git show origin/samaramaxine-proposed-code-structure:
example_data/simulated_3chamber/<file>`` for each file).  Everything is cut consistently to the
first ``--seconds`` seconds (default 75, which keeps the fixture under 2 MB): neural frames whose stamp is at most that, behavior frames likewise,
position rows by frame number, head-orientation rows, and annotations clipped to
``[first neural stamp, seconds]``.  ``neural_raw.npy`` and ``neural_denoised.npy`` are dropped.
``README.md`` is written by hand and is not touched here.  The inputs are untrusted data: arrays
are loaded with ``allow_pickle=False``.
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

import numpy as np
import pandas as pd

OUT_DEFAULT = Path(__file__).resolve().parent.parent / "tests" / "data" / "simulated_3chamber"


def _clip_epochs(df: pd.DataFrame, lo: float, hi: float) -> pd.DataFrame:
    df = df[(df["stop_s"] > lo) & (df["start_s"] < hi)].copy()
    df["start_s"] = df["start_s"].clip(lower=lo, upper=hi)
    df["stop_s"] = df["stop_s"].clip(lower=lo, upper=hi)
    return df.round({"start_s": 3, "stop_s": 3})


def slim(full: Path, out: Path, seconds: float = 75.0) -> None:
    out.mkdir(parents=True, exist_ok=True)
    limit_ms = seconds * 1000.0

    nts = pd.read_csv(full / "neural_timestamps.csv")
    keep_n = (nts["Time Stamp (ms)"] <= limit_ms).to_numpy()
    n_keep = int(keep_n.sum())
    if not keep_n[:n_keep].all():
        raise ValueError("neural time stamps are not increasing")
    nts[keep_n].to_csv(out / "neural_timestamps.csv", index=False)

    act = np.load(full / "neural_deconvolved.npy", allow_pickle=False)
    np.save(out / "neural_deconvolved.npy", act[:, :n_keep].astype(np.float32))

    bts = pd.read_csv(full / "behavior_timestamps.csv")
    keep_b = bts["Time Stamp (ms)"] <= limit_ms
    bts[keep_b].to_csv(out / "behavior_timestamps.csv", index=False)
    frames = set(bts.loc[keep_b, "Frame Number"])

    pos = pd.read_csv(full / "position.csv")
    pos[pos["frame"].isin(frames)].to_csv(out / "position.csv", index=False)

    head = pd.read_csv(full / "headOrientation.csv")
    head[head["Time Stamp (ms)"] <= limit_ms].to_csv(out / "headOrientation.csv", index=False)

    lo = float(nts["Time Stamp (ms)"].iloc[0]) / 1000.0
    for name in ("zone_annotations.csv", "investigation_annotations.csv"):
        _clip_epochs(pd.read_csv(full / name), lo, seconds).to_csv(out / name, index=False)

    shutil.copy(full / "config.yaml", out / "config.yaml")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("full_dir", type=Path)
    ap.add_argument("out_dir", type=Path, nargs="?", default=OUT_DEFAULT)
    ap.add_argument("--seconds", type=float, default=75.0)
    a = ap.parse_args()
    slim(a.full_dir, a.out_dir, a.seconds)
    total = sum(f.stat().st_size for f in a.out_dir.iterdir())
    print(f"wrote {a.out_dir} ({total / 1e6:.2f} MB)")


if __name__ == "__main__":
    main()
