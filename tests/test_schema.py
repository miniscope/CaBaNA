"""Results manifest schema (F2): validity of saved manifests, snapshot, array metadata."""

from __future__ import annotations

import copy
import json
import re
import zipfile
from pathlib import Path

import numpy as np
import pytest

import cabana
from cabana import AnalysisSpec, Pipeline, ResultSet, ShuffleConfig
from cabana._io import _array_meta, load_results, save_results
from cabana._results import MetricResult, ShuffleResult

ROOT = Path(__file__).resolve().parent.parent
GOLDEN = sorted((ROOT / "tests" / "golden").glob("*.results.zip"))

_TYPES = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
    "boolean": lambda v: isinstance(v, bool),
    "null": lambda v: v is None,
}


def validate(inst, sch, root, path="$") -> list[str]:
    """Minimal JSON Schema checker: the keywords ``resultset_schema`` uses; list of errors."""
    if "$ref" in sch:
        return validate(inst, root["$defs"][sch["$ref"].rsplit("/", 1)[1]], root, path)
    errs: list[str] = []
    if "type" in sch:
        types = sch["type"] if isinstance(sch["type"], list) else [sch["type"]]
        if not any(_TYPES[t](inst) for t in types):
            return [f"{path}: expected {types}, got {type(inst).__name__}"]
    if "const" in sch and inst != sch["const"]:
        errs.append(f"{path}: expected {sch['const']!r}, got {inst!r}")
    if "enum" in sch and inst not in sch["enum"]:
        errs.append(f"{path}: {inst!r} not in {sch['enum']}")
    if "minimum" in sch and _TYPES["number"](inst) and inst < sch["minimum"]:
        errs.append(f"{path}: {inst} < {sch['minimum']}")
    if "pattern" in sch and isinstance(inst, str) and not re.search(sch["pattern"], inst):
        errs.append(f"{path}: {inst!r} does not match {sch['pattern']}")
    if "oneOf" in sch:
        ok = [not validate(inst, s, root, path) for s in sch["oneOf"]]
        if sum(ok) != 1:
            errs.append(f"{path}: matches {sum(ok)} of oneOf")
    if "anyOf" in sch and not any(not validate(inst, s, root, path) for s in sch["anyOf"]):
        errs.append(f"{path}: matches none of anyOf")
    if isinstance(inst, dict):
        props = sch.get("properties", {})
        for k in sch.get("required", []):
            if k not in inst:
                errs.append(f"{path}: missing required {k!r}")
        for k, v in inst.items():
            if k in props:
                errs += validate(v, props[k], root, f"{path}.{k}")
            else:
                ap = sch.get("additionalProperties", True)
                if ap is False:
                    errs.append(f"{path}: unexpected key {k!r}")
                elif isinstance(ap, dict):
                    errs += validate(v, ap, root, f"{path}.{k}")
    if isinstance(inst, list) and "items" in sch:
        for i, v in enumerate(inst):
            errs += validate(v, sch["items"], root, f"{path}[{i}]")
    return errs


def _manifest(path) -> dict:
    p = Path(path)
    if p.is_dir():
        return json.loads((p / "manifest.json").read_text())
    with zipfile.ZipFile(p) as z:
        return json.loads(z.read("manifest.json"))


def _check(path) -> dict:
    man = _manifest(path)
    errs = validate(man, cabana.resultset_schema(), cabana.resultset_schema())
    assert not errs, errs[:5]
    return man


def _npz(path, name):
    p = Path(path)
    import io

    data = (p / name).read_bytes() if p.is_dir() else zipfile.ZipFile(p).read(name)
    with np.load(io.BytesIO(data), allow_pickle=False) as z:
        return {k: z[k] for k in z.files}


@pytest.fixture(scope="module")
def run_rs(sim_session) -> ResultSet:
    sh = ShuffleConfig(n_shuffles=20, seed=0, min_shift_s=2.0)
    pipe = Pipeline(
        analyses=[
            AnalysisSpec(
                name="ic", metric={"name": "information_content"}, states="position", shuffle=sh
            ),
            AnalysisSpec(name="au", metric={"name": "auroc"}, states="social"),
            AnalysisSpec(name="pv", metric={"name": "pv_stability"}, states="position"),
            AnalysisSpec(name="pe", metric={"name": "peth"}, states="social"),
            AnalysisSpec(name="ds", metric={"name": "decode_signal"}, signal="x"),
        ]
    )
    return pipe.run(sim_session, progress=False)[1]


def test_version_and_snapshot():
    assert cabana.SCHEMA_VERSION == "1.0.0"
    want = json.dumps(cabana.resultset_schema(), indent=2, sort_keys=True) + "\n"
    have = (ROOT / "schemas" / "resultset-v1.json").read_text()
    assert have == want, (
        'regenerate with: .venv/bin/python -c "import cabana,json;print(json.dumps('
        'cabana.resultset_schema(),indent=2,sort_keys=True))" > schemas/resultset-v1.json'
    )


def test_every_property_has_description():
    def walk(s, path="$"):
        if isinstance(s, dict):
            for k, v in s.get("properties", {}).items():
                assert v.get("description") or "$ref" in v, f"{path}.{k}"
            for k, v in s.items():
                walk(v, f"{path}.{k}")
        elif isinstance(s, list):
            for i, v in enumerate(s):
                walk(v, f"{path}[{i}]")

    walk(cabana.resultset_schema())


def test_saved_manifest_validates(run_rs, tmp_path):
    save_results(run_rs, tmp_path / "r.zip")
    man = _check(tmp_path / "r.zip")
    assert man["schema_version"] == "1.0.0" and man["format"] == 2
    assert len(man["results"]) == 5
    assert any(e["extras"] for e in man["results"]) and any(e["shuffle"] for e in man["results"])
    sh = next(e for e in man["results"] if e["shuffle"])
    assert sh["arrays"]["sh_null"]["axes"][0] == "shuffle"
    assert sh["arrays"]["sh_null"]["dtype"] == "float32"
    rs = load_results(tmp_path / "r.zip")
    assert len(rs.results) == 5


def test_directory_and_nonfinite(tmp_path):
    r = MetricResult(
        metric="pop",
        target="t",
        level="population",
        values=np.array([[1.0, np.nan], [np.inf, 2.0]]),
        params={"a": float("nan")},
        state_names=["a", "b"],
    )
    save_results(ResultSet(results=[r]), tmp_path / "d")
    man = _check(tmp_path / "d")
    assert man["results"][0]["arrays"]["values"]["axes"] == ["state", "state"]


@pytest.mark.parametrize("zpath", GOLDEN, ids=lambda p: p.name)
def test_golden_resaved_validates(zpath, tmp_path):
    old = _manifest(zpath)
    assert "schema_version" not in old  # predates the schema
    rs = ResultSet.load(zpath)  # on-disk manifests load unchanged
    assert len(rs.results) == len(old["results"])
    rs.save(tmp_path / "again.zip")
    _check(tmp_path / "again.zip")


def test_invalid_manifests_fail(run_rs, tmp_path):
    save_results(run_rs, tmp_path / "r.zip")
    man = _manifest(tmp_path / "r.zip")
    sch = cabana.resultset_schema()
    bad = copy.deepcopy(man)
    bad["results"][0]["arrays"]["values"]["dtype"] = "float16"
    assert validate(bad, sch, sch)
    bad = copy.deepcopy(man)
    del bad["results"][0]["arrays"]["values"]["shape"]
    assert validate(bad, sch, sch)
    bad = copy.deepcopy(man)
    del bad["results"][0]["metric"]
    assert validate(bad, sch, sch)
    bad = copy.deepcopy(man)
    bad["kind"] = "other"
    assert validate(bad, sch, sch)
    bad = copy.deepcopy(man)
    bad["schema_version"] = "2.0.0"
    assert validate(bad, sch, sch)


def test_arrays_meta_matches_npz(run_rs, tmp_path):
    save_results(run_rs, tmp_path / "r.zip")
    man = _manifest(tmp_path / "r.zip")
    for e in man["results"]:
        arrays = _npz(tmp_path / "r.zip", e["file"])
        assert set(arrays) == set(e["arrays"])
        for k, a in arrays.items():
            m = e["arrays"][k]
            assert m["shape"] == list(a.shape) and m["dtype"] == a.dtype.name
            assert len(m["axes"]) == a.ndim


def _res(level, values, **kw):
    return MetricResult.model_construct(
        metric="m", target="t", level=level, values=np.asarray(values), extras={}, **kw
    )


def test_array_meta_values():
    r = _res("cell", np.zeros(5), cell_ids=list("abcde"), state_names=None, provenance={})
    assert _array_meta(r, "values", r.values)["axes"] == ["cell"]
    r = _res("cell", np.zeros((5, 3)), cell_ids=list("abcde"), state_names=list("xyz"))
    m = _array_meta(r, "values", r.values)
    assert m == {"shape": [5, 3], "dtype": "float64", "axes": ["cell", "state"]}
    r = _res("population", np.zeros(3), state_names=list("xyz"), cell_ids=None)
    assert _array_meta(r, "values", r.values)["axes"] == ["state"]
    r = _res("population", np.zeros((3, 3)), state_names=list("xyz"), cell_ids=None)
    assert _array_meta(r, "values", r.values)["axes"] == ["state", "state"]
    r = _res(
        "population", np.zeros((5, 5)), state_names=None, cell_ids=None, provenance={"n_cells": 5}
    )
    assert _array_meta(r, "values", r.values)["axes"] == ["cell", "cell"]
    r = _res(
        "population", np.zeros((4, 2)), state_names=None, cell_ids=None, provenance={"n_cells": 5}
    )
    assert _array_meta(r, "values", r.values)["axes"] == [None, None]


def test_array_meta_shuffle_and_extras():
    sh = ShuffleResult.model_construct(n_shuffles=7)
    r = _res(
        "cell",
        np.zeros((5, 3)),
        cell_ids=list("abcde"),
        state_names=list("xyz"),
        shuffle=sh,
        provenance={},
    )
    f32 = np.zeros((7, 5, 3), np.float32)
    assert _array_meta(r, "sh_null", f32) == {
        "shape": [7, 5, 3],
        "dtype": "float32",
        "axes": ["shuffle", "cell", "state"],
    }
    assert _array_meta(r, "sh_shifts", np.zeros(7, np.int32))["axes"] == ["shuffle"]
    assert _array_meta(r, "sh_p_value", np.zeros((5, 3)))["axes"] == ["cell", "state"]
    # extras of an unregistered metric: no size matching beyond a leading cell axis
    assert _array_meta(r, "extra_0", np.zeros((5, 3)))["axes"] == ["cell", None]
    assert _array_meta(r, "extra_1", np.zeros(3, bool)) == {
        "shape": [3],
        "dtype": "bool",
        "axes": [None],
    }
    assert _array_meta(r, "extra_2", np.zeros((5, 3, 11)))["axes"] == ["cell", None, None]
    assert _array_meta(r, "extra_3", np.zeros(()))["axes"] == []
    assert _array_meta(r, "extra_4", np.zeros(200))["axes"] == [None]  # no "shuffle" guess


def test_array_meta_grid():
    r = _res("cell", np.zeros((5, 2, 3)), cell_ids=list("abcde"), state_names=None, provenance={})
    ax = _array_meta(r, "values", r.values, grid_shape=(2, 3))["axes"]
    assert ax == ["cell", "bin", "bin"]
    r.provenance = {"target_params": {"shape": [2, 3]}}
    assert _array_meta(r, "values", r.values)["axes"] == ["cell", "bin", "bin"]


def _named(metric, level, values, n_cells, state_names=None, **kw):
    return MetricResult.model_construct(
        metric=metric,
        target="t",
        level=level,
        values=np.asarray(values),
        extras={},
        cell_ids=[str(i) for i in range(n_cells)] if level == "cell" else None,
        state_names=state_names,
        provenance=kw.pop("provenance", {"n_cells": n_cells}),
        **kw,
    )


def test_declared_values_axes_for_cell_by_cell_matrix():
    # pairwise_correlation labels its state axis with cell ids: the matrix is cell x cell
    sh = ShuffleResult.model_construct(n_shuffles=50)
    r = _named(
        "pairwise_correlation",
        "population",
        np.zeros((6, 6)),
        6,
        shuffle=sh,
        state_names=[str(i) for i in range(6)],
    )
    assert _array_meta(r, "values", r.values)["axes"] == ["cell", "cell"]
    assert _array_meta(r, "sh_null", np.zeros((50, 6, 6)))["axes"] == ["shuffle", "cell", "cell"]
    assert _array_meta(r, "sh_p_value", np.zeros((6, 6)))["axes"] == ["cell", "cell"]


def test_declared_axes_beat_size_coincidences():
    # signal_tuning: 20 cells and 20 bins
    r = _named("signal_tuning", "cell", np.zeros(20), 20)
    assert _array_meta(r, "extra_0", np.zeros((20, 20)), extra_name="tuning_curve")["axes"] == [
        "cell",
        "bin",
    ]
    for name in ("bin_centers", "occupancy_s", "valid_bins"):
        assert _array_meta(r, "extra_0", np.zeros(20), extra_name=name)["axes"] == ["bin"]
    # peth with n_shuffles == n_time_bins == 200
    sh = ShuffleResult.model_construct(n_shuffles=200)
    r = _named("peth", "cell", np.zeros((20, 4)), 20, shuffle=sh, state_names=list("abcd"))
    assert _array_meta(r, "extra_0", np.zeros(200), extra_name="time_s")["axes"] == ["time"]
    pe = _array_meta(r, "extra_1", np.zeros((20, 4, 200)), extra_name="peth_sem")["axes"]
    assert pe == ["cell", "state", "time"]
    # n_cells == n_states
    r = _named(
        "information_content", "cell", np.zeros(16), 16, state_names=[str(i) for i in range(16)]
    )
    ax = _array_meta(r, "extra_0", np.zeros((16, 16)), extra_name="rate_map")["axes"]
    assert ax == ["cell", "state"]
    assert _array_meta(r, "extra_1", np.zeros(16), extra_name="occupancy_s")["axes"] == ["state"]
    r = _named("pv_stability", "population", np.zeros((16, 16)), 16, [str(i) for i in range(16)])
    ax = _array_meta(r, "extra_0", np.zeros((16, 16)), extra_name="rate_map_a")["axes"]
    assert ax == ["cell", "state"]
    r = _named("participation_ratio", "population", np.zeros(1), 8)
    ax = _array_meta(r, "extra_0", np.zeros(8), extra_name="eigenvalues")["axes"]
    assert ax == ["component"]


def test_declaration_ndim_mismatch_falls_back():
    r = _named("information_content", "cell", np.zeros(5), 5)
    ax = _array_meta(r, "extra_0", np.zeros((5, 3, 2)), extra_name="rate_map")["axes"]
    assert ax == ["cell", None, None]


def test_every_axis_label_is_in_vocabulary():
    from cabana._io import AXIS_LABELS
    from cabana._registry import _REGISTRY

    for name, cls in _REGISTRY["metric"].items():
        for k, axes in cls.extras_axes.items():
            assert all(a is None or a in AXIS_LABELS for a in axes), (name, k)
    assert set(AXIS_LABELS) == set(
        cabana.resultset_schema()["$defs"]["array_meta"]["properties"]["axes"]["items"]["enum"]
    ) - {None}


def test_probe_matches_saved_manifest(tmp_path):
    from cabana._describe import _probe_session

    session = _probe_session()
    pipe = Pipeline(
        analyses=[
            AnalysisSpec(name="ds", metric={"name": "decode_signal"}, signal="x"),
            AnalysisSpec(name="au", metric={"name": "auroc"}, states="position"),
        ]
    )
    rs = pipe.run(session, progress=False)[1]
    save_results(rs, tmp_path / "r.zip")
    man = _manifest(tmp_path / "r.zip")
    d = cabana.describe(probe=True)["plugins"]["metric"]
    for e in man["results"]:
        probed = d[e["metric"]]["outputs"]["extras"]
        assert probed
        for j, name in e["extras"].items():
            assert probed[name] == e["arrays"][j], (e["metric"], name)
    ds = next(e for e in man["results"] if e["metric"] == "decode_signal")
    assert ds["arrays"][next(j for j, n in ds["extras"].items() if n == "r2")]["axes"] == [
        "channel"
    ]
    assert ds["state_names"] == ["x"]
    probe_gn = d["decode_signal"]["outputs"]["extras"]["group_names"]
    assert probe_gn["dtype"].startswith("str")


def test_schema_dispatch():
    assert cabana.schema("resultset") == cabana.resultset_schema()
    for n in ("pipeline", "analysis_spec", "shuffle_config", "selection"):
        assert "properties" in cabana.schema(n) or "$defs" in cabana.schema(n)
    assert "plugins" in cabana.schema("describe")
    for n in ("study", "tuning_export"):
        try:
            cabana.schema(n)
        except KeyError as exc:
            assert n in str(exc)
    with pytest.raises(KeyError, match="resultset"):
        cabana.schema("nope")


def _validates(name, doc):
    sch = cabana.schema(name)
    return validate(doc, sch, sch)


def test_pipeline_yaml_validates_against_schema():
    import yaml

    files = sorted((ROOT / "tests" / "golden").glob("*.pipeline.yaml"))
    assert files
    for f in files:
        doc = yaml.safe_load(f.read_text())
        assert not _validates("pipeline", doc), f.name
    doc = yaml.safe_load(files[0].read_text())
    bad = copy.deepcopy(doc)
    bad["transforms"][0]["name"] = "no_such_transform"
    assert _validates("pipeline", bad)
    bad = copy.deepcopy(doc)
    bad["transforms"][0]["bogus_field"] = 1
    assert _validates("pipeline", bad)


def test_study_yaml_validates_against_schema():
    import yaml

    text = (ROOT / "docs" / "CLI.md").read_text()
    m = re.search(r"```yaml\n(kind: cabana\.Study.*?)```", text, re.S)
    assert m
    doc = yaml.safe_load(m.group(1))
    assert doc["kind"] == "cabana.Study"
    assert not _validates("study", doc)
    assert cabana.schema("study")["properties"]["kind"]["const"] == "cabana.Study"
    doc["kind"] = "other"
    assert _validates("study", doc)


def test_provenance_target_shape_known():
    props = cabana.resultset_schema()["$defs"]["entry"]["properties"]["provenance"]["properties"]
    assert "target_shape" in props
    desc = cabana.resultset_schema()["properties"]["schema_version"]["description"]
    assert "absent" not in desc
