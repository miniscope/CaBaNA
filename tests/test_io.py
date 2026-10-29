"""Persistence: format versions, migrations, strict JSON, dtype contract, tolerant loading."""

from __future__ import annotations

import io
import json
import re
import zipfile
from pathlib import Path

import numpy as np
import pytest

import cabana
from cabana import AnalysisSpec, Pipeline, ResultSet, Session, ShuffleConfig
from cabana import _io
from cabana._io import _check_dtypes, _npz_load
from cabana._results import MetricResult

DATA = Path(__file__).parent / "data" / "format_v1"


def _zip_files(path):
    with zipfile.ZipFile(path) as z:
        return {n: z.read(n) for n in z.namelist()}


def _write_zip(path, files):
    with zipfile.ZipFile(path, "w") as z:
        for n, d in files.items():
            z.writestr(n, d)


def _nanrepr(x):
    return json.dumps(x, sort_keys=True)  # NaN-safe structural comparison


def _assert_rs_equal(a: ResultSet, b: ResultSet):
    assert a.names() == b.names()
    for ra, rb in zip(a.results, b.results, strict=True):
        np.testing.assert_array_equal(ra.values, rb.values)
        assert ra.cell_ids == rb.cell_ids and ra.state_names == rb.state_names
        assert _nanrepr(ra.params) == _nanrepr(rb.params)
        assert _nanrepr(ra.provenance) == _nanrepr(rb.provenance)
        assert ra.level == rb.level and ra.target == rb.target
        assert set(ra.extras) == set(rb.extras)
        for k in ra.extras:
            np.testing.assert_array_equal(ra.extras[k], rb.extras[k])
        assert (ra.shuffle is None) == (rb.shuffle is None)
        if ra.shuffle is not None:
            sa, sb = ra.shuffle, rb.shuffle
            for f in ("observed", "p_value", "null_lo", "null_hi", "significant", "shifts"):
                x, y = getattr(sa, f), getattr(sb, f)
                assert (x is None) == (y is None), f
                if x is not None:
                    np.testing.assert_array_equal(x, y)
            assert (sa.null is None) == (sb.null is None)
            if sa.null is not None:
                np.testing.assert_allclose(sa.null, sb.null, atol=1e-6)
            assert (sa.alpha, sa.tail, sa.n_shuffles, sa.null_name) == (
                sb.alpha,
                sb.tail,
                sb.n_shuffles,
                sb.null_name,
            )


@pytest.fixture(scope="module")
def mixed_rs() -> ResultSet:
    s = cabana.simulate_session(n_cells=4, duration_s=120, seed=2)
    pipe = Pipeline(
        transforms=[{"name": "bouts_to_states", "source": "social", "output": "social"}],
        analyses=[
            AnalysisSpec(
                name="shuf",
                metric={"name": "auroc"},
                states="social",
                shuffle=ShuffleConfig(n_shuffles=20, seed=0, min_shift_s=2.0),
            ),
            AnalysisSpec(name="plain", metric={"name": "mean_per_state"}, states="social"),
        ],
    )
    return pipe.run(s, progress=False)[1]


def _with_population(rs: ResultSet) -> ResultSet:
    out = ResultSet()
    for r in rs.results:
        out.add(r)
    out.add(
        MetricResult(
            metric="pop",
            name="pop",
            target="social",
            target_kind="states",
            level="population",
            values=np.array([1.0, np.nan, np.inf]),
            params={"a": float("nan"), "b": [1.0, float("-inf")], "c": {"d": float("inf")}},
            provenance={"x": float("nan")},
            extras={"e": np.array([np.nan, 1.0, -np.inf])},
            state_names=["s0", "s1", "s2"],
        )
    )
    return out


# --------------------------------------------------------------------------- #
# v1 fixtures
# --------------------------------------------------------------------------- #


def test_v1_fixture_is_really_v1():
    man = json.loads(_zip_files(DATA / "results.zip")["manifest.json"])
    assert man["format"] == 1 and man["results"][0]["has_cell_ids"]
    arrs = _npz_load(_zip_files(DATA / "results.zip")["results/000.npz"])
    assert arrs["cell_ids"].dtype.kind == "U"


def test_v1_results_load_and_roundtrip(tmp_path):
    rs = ResultSet.load(DATA / "results.zip")
    assert rs.names() == ["shuf", "plain"]
    shuf, plain = rs["shuf"], rs["plain"]
    assert shuf.cell_ids == ["c0", "c1", "c2", "c3"] or all(
        isinstance(c, str) for c in shuf.cell_ids
    )
    assert len(shuf.cell_ids) == shuf.values.shape[0]
    assert shuf.shuffle.n_shuffles == 20 and shuf.shuffle.null.shape[0] == 20
    assert plain.shuffle is None and "n_in_state" in plain.extras
    assert shuf.shuffle.p_value.min() >= 1 / 21 - 1e-12
    assert shuf.provenance
    out = tmp_path / "again.zip"
    rs.save(out)
    man = json.loads(_zip_files(out)["manifest.json"])
    assert man["format"] == _io._FORMAT
    _assert_rs_equal(rs, ResultSet.load(out))


def test_v1_session_load_and_roundtrip(tmp_path):
    s = Session.load(DATA / "session.zip")
    assert isinstance(s.cell_ids, list) and all(isinstance(c, str) for c in s.cell_ids)
    assert len(s.cell_ids) == s.activity.shape[0]
    out = tmp_path / "s.zip"
    s.save(out)
    r = Session.load(out)
    np.testing.assert_array_equal(r.activity, s.activity)
    np.testing.assert_array_equal(r.t, s.t)
    assert r.cell_ids == s.cell_ids and r.meta.keys() == s.meta.keys()
    for k, st in s.states.items():
        assert r.states[k].state_names == st.state_names
        np.testing.assert_array_equal(r.states[k].onehot, st.onehot)


# --------------------------------------------------------------------------- #
# current format
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("ext", ["dir", "zip"])
def test_current_roundtrip_with_nonfinite(tmp_path, mixed_rs, ext):
    rs = _with_population(mixed_rs)
    path = tmp_path / ("r" if ext == "dir" else "r.zip")
    rs.save(path)
    back = ResultSet.load(path)
    _assert_rs_equal(rs, back)
    pop = back["pop"]
    assert np.isnan(pop.params["a"]) and pop.params["b"] == [1.0, float("-inf")]
    assert pop.params["c"]["d"] == float("inf") and np.isnan(pop.provenance["x"])
    np.testing.assert_array_equal(pop.values, [1.0, np.nan, np.inf])
    assert pop.level == "population" and pop.cell_ids is None


def test_strings_live_in_manifest(tmp_path, mixed_rs):
    path = tmp_path / "r.zip"
    mixed_rs.save(path)
    files = _zip_files(path)
    man = json.loads(files["manifest.json"])
    e = man["results"][0]
    assert isinstance(e["cell_ids"], list) and all(isinstance(c, str) for c in e["cell_ids"])
    assert isinstance(e["state_names"], list)
    for name, data in files.items():
        if name.endswith(".npz"):
            assert not any(a.dtype.kind in "US" for a in _npz_load(data).values())
    back = ResultSet.load(path)
    assert back.results[0].cell_ids == mixed_rs.results[0].cell_ids
    assert back.results[0].state_names == mixed_rs.results[0].state_names
    sp = tmp_path / "s.zip"
    sim = cabana.simulate_session(n_cells=3, duration_s=20, seed=1)
    sim.save(sp)
    sf = _zip_files(sp)
    assert json.loads(sf["manifest.json"])["cell_ids"] == sim.cell_ids
    assert "cell_ids" not in _npz_load(sf["arrays.npz"])
    assert Session.load(sp).cell_ids == sim.cell_ids


def test_session_meta_nonfinite_roundtrip(tmp_path):
    s = cabana.simulate_session(n_cells=3, duration_s=20, seed=1)
    s = s.model_copy(update={"meta": {**s.meta, "x": float("nan"), "y": [float("inf")]}})
    s.save(tmp_path / "s.zip")
    r = Session.load(tmp_path / "s.zip")
    assert np.isnan(r.meta["x"]) and r.meta["y"] == [float("inf")]


def test_manifest_is_strict_json(tmp_path, mixed_rs):
    path = tmp_path / "r.zip"
    _with_population(mixed_rs).save(path)
    text = _zip_files(path)["manifest.json"].decode()

    def boom(tok):
        raise AssertionError(f"bare constant {tok}")

    json.loads(text, parse_constant=boom)
    assert not re.search(r"(?<![\"\w])(NaN|-?Infinity)(?![\"\w])", text)
    assert '"__float__"' in text
    with pytest.raises(ValueError):
        json.dumps({"a": float("nan")}, allow_nan=False)
    assert b"NaN" not in _io._dump({"a": float("nan"), "b": [float("inf")]})


# --------------------------------------------------------------------------- #
# format checks
# --------------------------------------------------------------------------- #


def test_newer_format_errors(tmp_path, mixed_rs):
    path = tmp_path / "r.zip"
    mixed_rs.save(path)
    files = _zip_files(path)
    man = json.loads(files["manifest.json"])
    man["format"] = _io._FORMAT + 1
    files["manifest.json"] = json.dumps(man).encode()
    _write_zip(tmp_path / "new.zip", files)
    msg = f"format {_io._FORMAT + 1} > {_io._FORMAT}"
    with pytest.raises(ValueError, match=re.escape(msg)):
        ResultSet.load(tmp_path / "new.zip")
    sp = tmp_path / "s.zip"
    cabana.simulate_session(n_cells=2, duration_s=10, seed=0).save(sp)
    sf = _zip_files(sp)
    sm = json.loads(sf["manifest.json"])
    sm["format"] = 99
    sf["manifest.json"] = json.dumps(sm).encode()
    _write_zip(tmp_path / "news.zip", sf)
    with pytest.raises(ValueError, match="upgrade cabana"):
        Session.load(tmp_path / "news.zip")


def test_missing_format_treated_as_v1(tmp_path):
    files = _zip_files(DATA / "results.zip")
    man = json.loads(files["manifest.json"])
    del man["format"]
    files["manifest.json"] = json.dumps(man).encode()
    _write_zip(tmp_path / "nofmt.zip", files)
    assert ResultSet.load(tmp_path / "nofmt.zip").names() == ["shuf", "plain"]


def test_migration_chain_runs_in_order(monkeypatch):
    calls = []

    def m2(man, arrays):
        calls.append(2)
        man["seen2"] = True
        return man, arrays

    monkeypatch.setattr(_io, "_FORMAT", 3)
    monkeypatch.setitem(_io._MIGRATIONS, 2, m2)
    man, _ = _io._migrate({"kind": "x", "format": 1}, {}, 1)
    assert calls == [2] and man["seen2"] and man["format"] == 3
    monkeypatch.delitem(_io._MIGRATIONS, 2)
    with pytest.raises(ValueError, match="no migration"):
        _io._migrate({"format": 2}, {}, 2)


# --------------------------------------------------------------------------- #
# dtype contract
# --------------------------------------------------------------------------- #


def _all_npz(path):
    out = {}
    for name, data in _zip_files(path).items():
        if name.endswith(".npz"):
            out.update({f"{name}:{k}": v for k, v in _npz_load(data).items()})
    return out


def test_dtype_contract_on_saved_files(tmp_path, mixed_rs):
    p = tmp_path / "r.zip"
    mixed_rs.save(p)
    arrs = _all_npz(p)
    _check_dtypes(arrs)
    assert arrs["results/000.npz:sh_observed"].dtype == np.float64
    assert arrs["results/000.npz:sh_null"].dtype == np.float32
    assert arrs["results/000.npz:sh_significant"].dtype == np.bool_
    assert arrs["results/000.npz:sh_shifts"].dtype == np.int32
    sp = tmp_path / "s.zip"
    cabana.simulate_session(n_cells=3, duration_s=20, seed=1).save(sp)
    sarr = _all_npz(sp)
    _check_dtypes(sarr)
    assert all(v.dtype.kind != "O" for v in sarr.values())
    assert all(v.dtype == np.bool_ for k, v in sarr.items() if "mask/" in k)


def test_canon_array_rules():
    assert _io._canon_array(np.arange(5, dtype=np.int64)).dtype == np.int32
    big = np.array([2**40, 1], dtype=np.int64)
    assert _io._canon_array(big).dtype == np.int64
    assert _io._canon_array(np.ones(2, np.float16)).dtype == np.float64
    assert _io._canon_array(np.ones(2, np.float32)).dtype == np.float32
    assert _io._canon_array(np.ones(2, np.uint8)).dtype == np.uint8
    with pytest.raises(TypeError):
        _io._canon_array(np.array([object()], dtype=object))
    with pytest.raises(ValueError, match="int32"):
        _check_dtypes({"a": np.arange(3, dtype=np.int64)})
    with pytest.raises(ValueError, match="float"):
        _check_dtypes({"a": np.ones(3, np.float16)})
    with pytest.raises(ValueError, match="object"):
        _check_dtypes({"a": np.array([None], dtype=object)})
    _check_dtypes({"a": big, "b": np.ones(3, bool), "c": np.ones(2, np.float32)})


# --------------------------------------------------------------------------- #
# tolerant loading
# --------------------------------------------------------------------------- #


def test_optional_arrays_may_be_absent(tmp_path, mixed_rs):
    path = tmp_path / "r.zip"
    mixed_rs.save(path)
    files = _zip_files(path)
    fn = "results/000.npz"
    arrs = _npz_load(files[fn])
    for k in ("sh_null", "sh_p_adj", "sh_significant_adj", "sh_shifts", "sh_significant"):
        arrs.pop(k, None)
    buf = io.BytesIO()
    np.savez_compressed(buf, **arrs)
    files[fn] = buf.getvalue()
    _write_zip(tmp_path / "t.zip", files)
    r = ResultSet.load(tmp_path / "t.zip").results[0]
    assert r.shuffle.null is None and r.shuffle.p_adj is None
    np.testing.assert_array_equal(
        r.shuffle.significant, mixed_rs.results[0].shuffle.p_value < r.shuffle.alpha
    )


def test_missing_required_array_is_clear_error(tmp_path, mixed_rs):
    path = tmp_path / "r.zip"
    mixed_rs.save(path)
    files = _zip_files(path)
    arrs = _npz_load(files["results/000.npz"])
    del arrs["values"]
    buf = io.BytesIO()
    np.savez_compressed(buf, **arrs)
    files["results/000.npz"] = buf.getvalue()
    _write_zip(tmp_path / "t.zip", files)
    with pytest.raises(ValueError, match="values"):
        ResultSet.load(tmp_path / "t.zip")
