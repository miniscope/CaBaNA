"""GUI/CLI parity (plan section 10): the pipelines the TypeScript place-cell and auROC builders write
give bit-identical results through the bridge and through `cabana run` on the same pipeline file
and session folder."""

import io
import json
import subprocess
import zipfile
from pathlib import Path

import numpy as np
import pytest

from cabana_bridge import capabilities as caps

SPECS = Path(__file__).resolve().parents[2] / "apps/cabana/src/__tests__/fixtures/specs"
KEYS = ("values", "sh_p_value", "sh_p_adj", "sh_null_lo", "sh_null_hi")
N_SHUFFLES = 50


def _results(zip_path: Path) -> dict[str, dict[str, np.ndarray]]:
    out = {}
    with zipfile.ZipFile(zip_path) as z:
        for entry in json.loads(z.read("manifest.json"))["results"]:
            npz = np.load(io.BytesIO(z.read(entry["file"])))
            out[entry["name"]] = {key: npz[key] for key in KEYS if key in npz.files}
    return out


@pytest.mark.slow
@pytest.mark.parametrize(
    ("spec", "example", "analysis", "names"),
    [
        ("place-cells", "simulated_open_field", "place", {"information", "stability", "fields"}),
        ("auroc-circular", "simulated_social_interaction", "auroc", {"auroc"}),
    ],
)
def test_bridge_and_cli_agree_bit_for_bit(bridge, project, spec, example, analysis, names):
    client, _ = bridge
    pipeline = json.loads((SPECS / f"{spec}.json").read_text())["pipeline"]
    for item in pipeline["analyses"]:
        item["shuffle"]["n_shuffles"] = N_SHUFFLES
    sid = client.register_example(example)
    status, out = client.json("POST", "/runs", {"session_id": sid, "analysis": analysis,
                                                 "pipeline": pipeline, "scope": "full"})
    assert status == 202, out
    record = client.wait(out["run_id"])
    assert record["status"] == "ok", record["errors"]

    folder = project.run_dir(out["run_id"])
    subprocess.run([*caps.cli_command(), "run", str(folder / "pipeline.yaml"), "--session",
                    str(project.session_dir(sid)), "--out", str(folder / "again"), "--on-error", "record"],
                   check=True, capture_output=True)
    gui = _results(folder / record["results_file"])
    cli = _results(next((folder / "again").glob("*.results.zip")))
    assert set(gui) == set(cli) == names
    for name in names:
        assert set(gui[name]) == set(cli[name]) >= {"values", "sh_p_value", "sh_null_lo", "sh_null_hi"}
        for key in gui[name]:
            assert np.array_equal(gui[name][key], cli[name][key], equal_nan=True), f"{name}.{key}"
