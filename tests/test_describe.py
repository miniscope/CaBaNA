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
    cms = desc["plugins"]["null"]["covariate_matched_shift"]["params"]
    assert cms["channel"]["ui"]["sweepable"] is False
    assert desc["plugins"]["metric"]["pairwise_correlation"]["outputs"]["values"]["axes"] == [
        "cell",
        "cell",
    ]


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
    assert all(
        "error" not in e["outputs"]["extras"]
        for n, e in d["plugins"]["metric"].items()
        if n != "bayesian_decoder"
    )


def test_ui_hint_fixes(desc):
    pl = desc["plugins"]

    def ui(kind, name, f):
        return pl[kind][name]["params"][f]["ui"]

    for kind, name, f in (
        ("metric", "bayesian_decoder", "n_trial_blocks"),
        ("metric", "pv_stability", "n_blocks"),
        ("metric", "split_half_stability", "n_blocks"),
        ("selector", "auto_null_timescale", "set_min_shift"),
        ("selector", "auto_null_timescale", "set_block"),
        ("selector", "auto_null_timescale", "block_rule"),
    ):
        assert ui(kind, name, f)["group"] != "time", (name, f)
    assert ui("selector", "auto_null_timescale", "block_rule")["group"] == "method"
    assert ui("metric", "bayesian_decoder", "n_trial_blocks")["group"] == "compute"
    assert ui("null", "label_shuffle", "block_s")["group"] == "time"
    for name in ("decode_signal", "glm_encoding"):
        assert ui("metric", name, "alpha")["group"] == "method"
    assert ui("metric", "glm_encoding", "max_iter")["group"] == "compute"
    assert ui("metric", "decode_states", "max_iter")["group"] == "compute"
    for kind, name, f in (
        ("metric", "peth", "null_seed"),
        ("metric", "peth", "n_null"),
        ("preprocess", "mask_from_signal", "channel"),
        ("metric", "place_fields", "connectivity"),
        ("preprocess", "bandpass_activity", "order"),
        ("transform", "smooth_signal", "polyorder"),
        ("preprocess", "select_cells", "keep_at_least"),
    ):
        assert ui(kind, name, f)["sweepable"] is False, (name, f)
    assert ui("metric", "peth", "pre_s")["sweepable"] is True
    for kind, name, f, unit in (
        ("transform", "arena_transform", "rotate_deg", "deg"),
        ("transform", "head_direction", "offset_deg", "deg"),
        ("transform", "investigation_from_geometry", "max_angle_deg", "deg"),
        ("preprocess", "resample", "fs_target", "Hz"),
        ("preprocess", "speed_threshold", "min_speed", "position units/s"),
        ("preprocess", "speed_threshold", "max_speed", "position units/s"),
        ("transform", "bin_grid", "bin_size", "position units"),
        ("transform", "investigation_from_geometry", "max_distance", "position units"),
        ("preprocess", "compute_dff", "percentile", "%"),
    ):
        assert ui(kind, name, f)["unit"] == unit, (name, f)


def test_probe_declarations_complete():
    """Every extra a built-in metric emits has an ``extras_axes`` entry of the right ndim."""
    d = cabana.describe(probe=True)["plugins"]["metric"]
    for name, e in d.items():
        cls = _REGISTRY["metric"][name]
        if not cls.__module__.startswith("cabana._metrics"):
            continue
        out = e["outputs"]
        assert out["probe_error"] is None, (name, out["probe_error"])
        assert out["extras"] is not None
        for k, meta in out["extras"].items():
            decl = cls.extras_axes.get(k)
            assert decl is not None, f"{name}: extra {k!r} has no extras_axes declaration"
            assert len(decl) == len(meta["shape"]), (name, k, decl, meta["shape"])
            assert meta["axes"] == list(decl), (name, k)


def test_probe_specific_axes():
    d = cabana.describe(probe=True)["plugins"]["metric"]
    ex = d["signal_tuning"]["outputs"]["extras"]
    assert ex["tuning_curve"]["axes"] == ["cell", "bin"]
    assert ex["bin_centers"]["axes"] == ["bin"]
    assert d["peth"]["outputs"]["extras"]["time_s"]["axes"] == ["time"]
    assert d["participation_ratio"]["outputs"]["extras"]["eigenvalues"]["axes"] == ["component"]
    # a real extra called "error" is an array, not the probe's failure sentinel
    be = d["bayesian_decoder"]["outputs"]
    assert be["extras"]["error"]["axes"] == ["time"] and be["probe_error"] is None
    # dtypes are the canonical saved ones
    assert d["auroc"]["outputs"]["extras"]["n_in_state"]["dtype"] == "int32"
    assert d["decode_signal"]["outputs"]["extras"]["group_names"]["dtype"].startswith("str")


def test_probe_survives_required_field():
    from typing import ClassVar

    from pydantic import Field

    from cabana import Metric, register

    @register("metric")
    class _NeedsArg(Metric):
        """Metric with a required field (cannot be instantiated bare)."""

        name: ClassVar[str] = "_needs_arg"
        k: int = Field(..., description="Required.")

        def compute(self, *a):  # pragma: no cover
            raise NotImplementedError

    try:
        d = cabana.describe(probe=True)
        out = d["plugins"]["metric"]["_needs_arg"]["outputs"]
        assert out["extras"] == {} and "ValidationError" in out["probe_error"]
        assert d["plugins"]["metric"]["information_content"]["outputs"]["probe_error"] is None
    finally:
        _REGISTRY["metric"].pop("_needs_arg", None)


def test_describe_is_fast():
    cabana.describe()
    t = time.perf_counter()
    cabana.describe()
    assert time.perf_counter() - t < 1.0
