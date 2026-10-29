"""Feature detection for the installed framework.

The framework is `0.1.0.dev0` everywhere, so versions cannot tell features apart. Each
flag below names the contract (F0a ... F9) in CABANA_GUI_IMPLEMENTATION_PLAN.md section 7.
If a contract names a field differently, change it here and nowhere else.
"""

from __future__ import annotations

import importlib.metadata
import json
import subprocess
import sys
import tempfile
import threading
from pathlib import Path
from typing import Callable

import numpy as np


def _flag(check: Callable[[], bool]) -> bool:
    try:
        return bool(check())
    except Exception:
        return False


def probe() -> dict[str, bool]:
    import cabana
    from cabana._loaders import _session_dir as sd

    behavior = sd.BehaviorConfig.model_fields
    bayes = cabana.BayesianDecoder.model_fields
    decode = cabana.DecodeStates.model_fields
    return {
        "session_metadata": _flag(lambda: "metadata" in sd.SessionDirConfig.model_fields),  # F0a
        "session_markers": _flag(lambda: "markers" in behavior),  # F0b
        "peth_markers": _flag(lambda: "markers" in cabana.AnalysisSpec.model_fields),  # F0b
        "frame_labels": _flag(lambda: "frame_labels" in behavior),  # F0c
        "decoding_fold_gap": _flag(lambda: "fold_gap_s" in bayes and "fold_gap_s" in decode),  # F1
        "decoding_fold_local_window": _flag(lambda: "fold_gap_s" in bayes),  # F1
        "decoding_overall_test": _flag(lambda: hasattr(cabana.ShuffleResult, "summary")),  # F2
        "overlap_policy": _flag(lambda: "overlap" in cabana.BoutsToStates.model_fields),  # F3
        "bayes_input_check": _flag(lambda: cabana.BayesianDecoder.accepts_kinds is not None),  # F4
        "bin_eligibility": _flag(lambda: "min_occupancy_s" in bayes),  # F5
        "preview_flag": _flag(lambda: "preview" in cabana.ShuffleConfig.model_fields),  # F7
        "cli_rejects_recipes": False,  # F8; replaced by probe_cli_recipes()
        "peth_gui_extensions": _flag(lambda: "align" in cabana.PETH.model_fields),  # F9
    }


def framework_info() -> dict[str, str | None]:
    """Installed version and, for a git install, the commit."""
    import cabana

    commit = None
    try:
        dist = importlib.metadata.distribution("cabana")
        text = dist.read_text("direct_url.json")
        if text:
            commit = json.loads(text).get("vcs_info", {}).get("commit_id")
    except Exception:
        pass
    return {"cabana_version": getattr(cabana, "__version__", None), "commit": commit}


def cli_command() -> list[str]:
    """Command prefix that runs `cabana` from this environment.

    `-I` keeps the current folder off the import path: the repository root has its own package
    named `cabana`, and `python -c` run from there would import that one instead.
    """
    return [sys.executable, "-I", "-c", "import sys; from cabana._cli import main; sys.exit(main(sys.argv[1:]))"]


def probe_cli_recipes(timeout_s: float = 120.0) -> bool:
    """True when `cabana run` refuses a bundled recipe file (contract F8).

    Today it runs an empty pipeline and exits 0, which is why the GUI always sends an
    expanded pipeline.
    """
    import cabana

    recipes = Path(cabana.__file__).parent / "recipes"
    recipe = next(iter(sorted(recipes.glob("*.yaml"))), None)
    if recipe is None:
        return False
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        n = 600
        rng = np.random.default_rng(0)
        np.save(tmp_path / "neural.npy", rng.random((n, 4)))
        np.savetxt(tmp_path / "t.csv", np.arange(n) / 30.0, header="t", comments="")
        (tmp_path / "config.yaml").write_text(
            "name: probe\nneural: {file: neural.npy, kind: deconvolved, timestamps: t.csv}\n"
        )
        try:
            done = subprocess.run(
                [*cli_command(), "run", str(recipe), "--session", str(tmp_path), "--out", str(tmp_path / "out")],
                capture_output=True,
                timeout=timeout_s,
            )
        except Exception:
            return False
        return done.returncode != 0


class Capabilities:
    """Probed once; the slow F8 probe finishes in the background."""

    def __init__(self) -> None:
        self.flags = probe()
        self.info = framework_info()
        self._thread = threading.Thread(target=self._finish, daemon=True)
        self._thread.start()

    def _finish(self) -> None:
        self.flags["cli_rejects_recipes"] = probe_cli_recipes()

    def wait(self, timeout: float | None = None) -> None:
        self._thread.join(timeout)
