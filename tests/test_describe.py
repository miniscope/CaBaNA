"""``cabana.describe()`` completeness, strict JSON and ui hints (F2)."""

from __future__ import annotations

import json
import time

import pytest

import cabana
from cabana._registry import _REGISTRY

GROUPS = {"time", "binning", "thresholds", "compute", "method", "other"}


@pytest.fixture(scope="module")
def desc():
    return cabana.describe()


def test_every_plugin_listed(desc):
    assert set(desc["plugins"]) == set(_REGISTRY)
    for kind, reg in _REGISTRY.items():
        assert set(desc["plugins"][kind]) == set(reg)


def test_every_field_described(desc):
    missing = []
    for kind, entries in desc["plugins"].items():
        for name, e in entries.items():
            if name.startswith("_"):  # plugins registered by the test-suite itself
                continue
            assert set(e["params"]) == set(_REGISTRY[kind][name].model_fields)
            props = e["schema"].get("properties", {})
            for f, p in e["params"].items():
                if not p["description"].strip():
                    missing.append(f"{kind}.{name}.{f}")
                if props:
                    assert props[f].get("description"), f"{kind}.{name}.{f} schema"
    assert not missing, missing


def test_ui_hints(desc):
    for entries in desc["plugins"].values():
        for e in entries.values():
            for f, p in e["params"].items():
                ui = p["ui"]
                assert ui["group"] in GROUPS
                assert isinstance(ui["sweepable"], bool)
                assert ui["unit"] is None or isinstance(ui["unit"], str)
                if f in ("seed", "n_jobs", "batch_size", "n_shuffles"):
                    assert ui["sweepable"] is False
    ic = desc["plugins"]["metric"]["information_content"]["params"]
    assert ic["min_occupancy_s"]["ui"] == {"group": "time", "sweepable": True, "unit": "s"}
    assert ic["smooth_sigma_bins"]["ui"]["group"] == "binning"
    assert ic["units"]["ui"]["sweepable"] is False


def test_metric_and_null_entries(desc):
    for e in desc["plugins"]["metric"].values():
        assert {"cell_separable", "default_plots", "outputs", "level", "input"} <= set(e)
        assert e["outputs"]["values"]["axes"] is None or e["outputs"]["values"]["axes"][0] == "cell"
    for e in desc["plugins"]["null"].values():
        assert {"perturbs", "cell_separable"} <= set(e)


def test_strict_json(desc):
    json.dumps(desc, allow_nan=False)


def test_ui_override():
    from pydantic import Field

    from cabana._describe import _params
    from cabana._registry import Metric

    class _M(Metric):
        a_s: float = Field(1.0, description="x", json_schema_extra={"ui": {"group": "other"}})

        def compute(self, *a):  # pragma: no cover
            raise NotImplementedError

    p = _params(_M)["a_s"]
    assert p["ui"] == {"group": "other", "sweepable": True, "unit": "s"}


def test_probe_extras():
    d = cabana.describe(probe=True)
    json.dumps(d, allow_nan=False)
    ex = d["plugins"]["metric"]["information_content"]["outputs"]["extras"]
    rm = ex["rate_map"]
    assert rm["dtype"] == "float64" and rm["axes"][0] == "cell" and len(rm["axes"]) == 2
    assert d["plugins"]["metric"]["peth"]["outputs"]["extras"]["peth"]["axes"][:2] == [
        "cell",
        "state",
    ]
    assert all(isinstance(e["outputs"]["extras"], dict) for e in d["plugins"]["metric"].values())


def test_describe_is_fast():
    cabana.describe()
    t = time.perf_counter()
    cabana.describe()
    assert time.perf_counter() - t < 1.0
