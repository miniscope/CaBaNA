"""Smoke test: the three-chamber walkthrough script runs end to end in --quick mode."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pandas as pd
import pytest

from cabana import ResultSet

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "examples" / "three_chamber.py"


def _run(*args, timeout=300):
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
        timeout=timeout,
        cwd=ROOT,
    )


def test_help():
    proc = _run("--help", timeout=60)
    assert proc.returncode == 0 and "--session" in proc.stdout and "--quick" in proc.stdout


@pytest.mark.slow
def test_three_chamber_quick(tmp_path):
    proc = _run("--quick", "--out", str(tmp_path))
    assert proc.returncode == 0, proc.stderr[-2000:]
    for name in ("results.zip", "session.zip", "results.csv", "selections.json"):
        assert (tmp_path / name).stat().st_size > 0, name
    pngs = sorted(tmp_path.glob("0?_*.png"))
    assert [p.name[:2] for p in pngs] == ["01", "02", "03", "04", "05", "06"]
    assert all(p.stat().st_size > 5000 for p in pngs)
    df = pd.read_csv(tmp_path / "results.csv")
    assert {"auroc", "mean_per_state", "peth", "information_content", "mutual_information"} <= set(
        df["metric"]
    )
    assert len(ResultSet.load(tmp_path / "results.zip")) == 6
    assert "To run on your own data:" in proc.stdout and "dropped ids" in proc.stdout
