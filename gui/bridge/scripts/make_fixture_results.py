"""Writes small framework results used by GUI tests (needs the bridge environment).

    uv run --project gui/bridge python gui/bridge/scripts/make_fixture_results.py

Each fixture is one `<name>.results.zip` plus `<name>.pipeline.json` under
gui/apps/cabana/src/__tests__/fixtures/. Everything is seeded, so a second run gives
the same arrays.
"""

from __future__ import annotations

import hashlib
import io
import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

import numpy as np
import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fixture_pipelines as fp  # noqa: E402

from cabana_bridge import capabilities  # noqa: E402

REPO = HERE.parents[2]
EXAMPLES = REPO / "example_data"
OUT = REPO / "gui" / "apps" / "cabana" / "src" / "__tests__" / "fixtures"
MAX_BYTES = 2 * 1024 * 1024


def recipe(name: str, **subs) -> dict:
    import cabana

    return cabana.recipe_pipeline(name, **subs).to_dict()


def place_cell(n_shuffles: int) -> dict:
    pipeline = recipe("place_cell", states="position", n_shuffles=n_shuffles)
    pipeline["transforms"] = [{"name": "speed", "signals": ["x", "y"], "window_s": 0.5},
                              {"name": "bin_grid", "signals": ["x", "y"], "bin_size": 3.0, "output": "position"}]
    pipeline["preprocess"] = [{"name": "speed_threshold", "signal": "speed", "min_speed": 2.0, "output": "speed"}]
    return pipeline


def gui_pipeline(name: str, n_shuffles: int, **null_settings) -> dict:
    """A pipeline as the GUI's TypeScript builders write it (snapshot in fixtures/specs), with fewer shuffles."""
    pipeline = json.loads((OUT / "specs" / f"{name}.json").read_text())["pipeline"]
    for analysis in pipeline["analyses"]:
        if analysis.get("shuffle"):
            analysis["shuffle"]["n_shuffles"] = n_shuffles
            analysis["shuffle"].get("null", {}).update(null_settings)
    return pipeline


def jobs() -> dict[str, tuple[str, dict]]:
    pca = {"analyses": [{**fp.population()["analyses"][2], "name": "pca"}],
           "preprocess": fp.population()["preprocess"]}
    return {
        "population_social": ("simulated_social_interaction", fp.population(50)),
        "pca_population": ("simulated_social_interaction", pca),
        "pairwise_social": ("simulated_social_interaction", fp.pairwise()),
        "bayes_position_open_field": ("simulated_open_field", fp.bayesian_position(20)),
        "decode_logistic_social": ("simulated_social_interaction", fp.decode_states_logistic(20)),
        "place_cell_open_field": ("simulated_open_field", place_cell(50)),
        "social_auroc": ("simulated_social_interaction", recipe("social", states="social", n_shuffles=50)),
        # small GUI-built runs for the place-cell and auROC adapter tests
        "gui_place_cells": ("simulated_open_field", gui_pipeline("place-cells", 25)),
        "gui_auroc_circular": ("simulated_social_interaction", gui_pipeline("auroc-circular", 20)),
        # the default tolerance of 0.1 accepts no shift on this recording, so the fixture loosens it to 0.2
        "gui_auroc_speed_matched": (
            "simulated_social_interaction",
            gui_pipeline("auroc-speed-matched", 20, tolerance=0.2),
        ),
    }


def values_hash(zip_path: Path) -> str:
    digest = hashlib.sha256()
    with zipfile.ZipFile(zip_path) as z:
        for name in sorted(n for n in z.namelist() if n.endswith(".npz")):
            arrays = np.load(io.BytesIO(z.read(name)))
            digest.update(arrays["values"].tobytes())
    return digest.hexdigest()


def dump_json(zip_path: Path, out: Path) -> None:
    """The manifest and every array as plain JSON, so GUI tests can read results without unzipping."""
    with zipfile.ZipFile(zip_path) as z:
        manifest = json.loads(z.read("manifest.json"))
        arrays = {}
        for entry in manifest["results"]:
            npz = np.load(io.BytesIO(z.read(entry["file"])))
            arrays[entry["name"]] = {
                key: {"shape": list(npz[key].shape),
                      "data": [None if v != v else v for v in npz[key].astype(float).ravel().tolist()]}
                for key in npz.files
                if npz[key].dtype.kind in "fiub"  # text arrays (group names) are in the manifest or unused
            }
    out.write_text(json.dumps({"manifest": manifest, "arrays": arrays}, separators=(",", ":"), allow_nan=False))


def run(session: str, pipeline: dict, out: Path) -> Path:
    with tempfile.TemporaryDirectory() as tmp:
        spec = Path(tmp) / "pipeline.yaml"
        import cabana

        cabana.Pipeline.from_dict(pipeline).to_yaml(spec)
        done = subprocess.run([*capabilities.cli_command(), "run", str(spec), "--session", str(EXAMPLES / session),
                        "--out", tmp + "/out", "--on-error", "record"], capture_output=True, text=True)
        if done.returncode not in (0, 4):
            raise SystemExit(f"{session}: {done.stderr[-1500:]}")
        found = next(Path(tmp, "out").glob("*.results.zip"))
        out.write_bytes(found.read_bytes())
    return out


def main(only: list[str]) -> None:
    """Make every fixture, or only the named ones (the others are left as they are)."""
    OUT.mkdir(parents=True, exist_ok=True)
    hash_file = OUT / "values-hashes.json"
    hashes = json.loads(hash_file.read_text()) if hash_file.exists() else {}
    for name, (session, pipeline) in jobs().items():
        if only and name not in only:
            continue
        target = OUT / f"{name}.results.zip"
        run(session, pipeline, target)
        (OUT / f"{name}.pipeline.json").write_text(json.dumps({"session": session, "pipeline": pipeline}, indent=1))
        size = target.stat().st_size
        assert size < MAX_BYTES, f"{name} is {size} bytes"
        hashes[name] = values_hash(target)
        if not name.startswith(("place_cell", "social_auroc")):  # those two would exceed 2 MB as JSON
            dump_json(target, OUT / f"{name}.fixture.json")
        print(f"{name}: {size / 1024:.0f} kB")
    hash_file.write_text(json.dumps(hashes, indent=1, sort_keys=True))


if __name__ == "__main__":
    main(sys.argv[1:])
