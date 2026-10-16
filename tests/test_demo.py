"""Smoke test: the demo script runs end to end in --quick mode."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pandas as pd

from cabana import ResultSet

ROOT = Path(__file__).resolve().parents[1]


def test_demo_quick(tmp_path):
    proc = subprocess.run(
        [sys.executable, str(ROOT / "examples" / "demo.py"), "--quick", "--out", str(tmp_path)],
        capture_output=True,
        text=True,
        timeout=600,
        cwd=ROOT,
    )
    assert proc.returncode == 0, proc.stderr[-2000:]
    df = pd.read_csv(tmp_path / "results.csv")
    assert {"information_content", "split_half_stability", "auroc"} <= set(df["metric"])
    assert {"position", "social", "syllables"} <= set(df["target"])
    # second increment: events, state means, continuous targets, population analyses
    assert {"mean_per_state", "peth", "signal_correlation", "glm_encoding", "decode_states"} <= set(
        df["metric"]
    )
    # third increment: amplitude as a dimension
    assert {"mutual_information", "bayesian_decoder"} <= set(df["metric"])
    assert (tmp_path / "levels_sweep.csv").exists()
    assert "Position decoders" in proc.stdout
    assert {"speed", "design"} <= set(df["target"])
    assert (tmp_path / "nulls_compared.csv").exists()
    nulls = pd.read_csv(tmp_path / "nulls_compared.csv")
    assert set(nulls["null"]) == {"circular_shift", "label_shuffle", "bout_shuffle"}
    assert "Cross-session map correlation" in proc.stdout
    assert "Overlap of place cells" in proc.stdout
    assert (tmp_path / "ground_truth.json").exists()
    assert (tmp_path / "session.zip").exists()
    reloaded = ResultSet.load(tmp_path / "results.zip")
    assert len(reloaded) >= 12
    assert "mutual_information_binary[position]" in reloaded.names()
    assert (tmp_path / "pipeline.yaml").exists() or (tmp_path / "pipeline.json").exists()
    assert len(list(tmp_path.glob("*.png"))) >= 21
