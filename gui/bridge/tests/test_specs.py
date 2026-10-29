"""Pipelines written by the GUI's TypeScript spec builders (snapshots in the app's test fixtures)
must be accepted by the installed framework and pass its validation."""

import json
from pathlib import Path

import pytest

from conftest import EXAMPLES

SPECS = Path(__file__).resolve().parents[2] / "apps/cabana/src/__tests__/fixtures/specs"
CASES = [
    ("population-behaviors", "simulated_social_interaction"),
    ("population-position", "simulated_open_field"),
    ("decoding-position", "simulated_open_field"),
    ("decoding-behavior-bayes", "simulated_social_interaction"),
    ("decoding-behavior-logistic", "simulated_social_interaction"),
    ("place-cells", "simulated_open_field"),
    ("auroc-circular", "simulated_social_interaction"),
    ("auroc-speed-matched", "simulated_social_interaction"),
]


@pytest.mark.parametrize(("name", "example"), CASES)
def test_ts_spec_validates(bridge, name, example):
    client, _ = bridge
    spec = json.loads((SPECS / f"{name}.json").read_text())
    sid = client.register_example(example)
    status, report = client.json("POST", "/validate", {"session_id": sid, "pipeline": spec["pipeline"],
                                                       "rejected_cells": [2, 5]})
    assert status == 200
    errors = [i for i in report["issues"] if i["level"] == "error"]
    # the Bayesian input check and capability gates are the only errors the current framework may add
    errors = [e for e in errors if e["code"] not in {"missing_capability"}]
    assert not errors, errors
    assert report["rejected_cell_ids"] == ["2", "5"]


def _shrink(pipeline, n=20):
    for spec in pipeline["analyses"]:
        if spec.get("shuffle"):
            spec["shuffle"]["n_shuffles"] = n
    return pipeline


@pytest.mark.slow
@pytest.mark.parametrize(("name", "example"), [("population-behaviors", "simulated_social_interaction"),
                                               ("population-position", "simulated_open_field")])
def test_population_specs_run(bridge, name, example):
    client, _ = bridge
    spec = json.loads((SPECS / f"{name}.json").read_text())
    sid = client.register_example(example)
    status, out = client.json("POST", "/runs", {"session_id": sid, "analysis": "population", "scope": "preview",
                                                 "pipeline": _shrink(spec["pipeline"]), "rejected_cells": [2, 5]})
    assert status == 202, out
    rec = client.wait(out["run_id"])
    assert rec["status"] == "ok", rec["errors"]
    assert rec["rejected_cell_ids"] == ["2", "5"]
    _, man = client.json("GET", f"/runs/{out['run_id']}/manifest")
    assert {r["name"] for r in man["results"]} >= {"pv_similarity", "pv_stability", "state_separation", "dimensionality"}
    assert all(r["cell_ids"] is None or "2" not in r["cell_ids"] for r in man["results"])


@pytest.mark.slow
def test_logistic_behavior_spec_runs_without_gate(bridge):
    """Without F1 the GUI gates this run; here it is sent without `requires` to check the pipeline itself."""
    client, _ = bridge
    spec = json.loads((SPECS / "decoding-behavior-logistic.json").read_text())
    sid = client.register_example("simulated_social_interaction")
    status, out = client.json("POST", "/runs", {"session_id": sid, "analysis": "decoding", "scope": "preview",
                                                 "pipeline": _shrink(spec["pipeline"], 10)})
    assert status == 202, out
    rec = client.wait(out["run_id"])
    assert rec["status"] == "ok", rec["errors"]


def test_default_place_spec_matches_recipe():
    """The GUI's place-cell pipeline must keep the recipe's analyses and metric parameters."""
    import cabana

    spec = json.loads((SPECS / "place-cells.json").read_text())["pipeline"]
    recipe = cabana.recipe_pipeline("place_cell", states="position").to_dict()
    for mine, theirs in zip(spec["analyses"], recipe["analyses"], strict=True):
        assert mine["name"] == theirs["name"] and mine["masks"] == theirs["masks"]
        for key, value in mine["metric"].items():
            if key in theirs["metric"] and key not in {"smooth_sigma_bins"}:
                assert theirs["metric"][key] == value, (mine["name"], key)
    assert [s["name"] for s in spec["selectors"]] == [s["name"] for s in recipe["selectors"]]


def test_default_auroc_spec_matches_recipe():
    import cabana

    spec = json.loads((SPECS / "auroc-circular.json").read_text())["pipeline"]
    recipe = cabana.recipe_pipeline("social", states="social").to_dict()
    mine, theirs = spec["analyses"][0], recipe["analyses"][0]
    assert mine["metric"] == theirs["metric"]
    assert mine["shuffle"]["correction"] == theirs["shuffle"]["correction"] == "max_stat"


def test_fold_boundaries_match_framework():
    import numpy as np
    from cabana._kernels._ratemap import contiguous_folds

    cases = json.loads((SPECS.parent / "fold-boundaries.json").read_text())
    for key, boundaries in cases.items():
        n, k = map(int, key.split(","))
        ids = contiguous_folds(n, k)
        first = [int(np.searchsorted(ids, i)) for i in range(k)] + [n]
        assert first == boundaries, key
