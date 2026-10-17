"""Smoke test: the demo script runs end to end in --quick mode."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pandas as pd
import pytest

from cabana import ResultSet

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.slow
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
    assert len(list(tmp_path.glob("*.png"))) >= 22
    # fifth increment: correction, criteria and run control
    assert {"p_adj", "significant_adj"} <= set(df.columns)
    assert "fpr_adj" in proc.stdout
    assert "[analyze]" in proc.stdout
    assert "registered metrics" in proc.stdout
    assert "Classification" in proc.stdout
    assert (tmp_path / "27_classification.png").exists()
    auroc = df[df["analysis"] == "auroc[social]"]
    assert (auroc["p_adj"] >= auroc["p_value"] - 1e-12).all()
    # parameter selection: selectors, sweeps, guard rail
    sel = json.loads((tmp_path / "selections.json").read_text())
    assert {s["method"] for s in sel} == {"auto_cv", "auto_rule"}
    assert not any(s["informed_by_significance"] for s in sel)
    for name in ("28a_smoothing_score", "28b_smoothing_gallery", "29_smoothing_stability"):
        assert (tmp_path / f"{name}.png").exists()
    assert "Chosen parameters: smooth_sigma_bins" in proc.stdout
    assert "raises: refusing to pick by 'frac_significant'" in proc.stdout
    assert "Stability across sigma" in proc.stdout
