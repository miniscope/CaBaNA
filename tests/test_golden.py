"""Golden numeric regression: rerun the stored pipelines and compare with the stored results.

Refresh after an intentional numeric change (e.g. new surrogate seeding)::

    .venv/bin/pytest tests/test_golden.py --update-golden

(equivalently ``.venv/bin/python scripts/generate_golden.py``) and review the diff of the
golden zips before committing.  See ``scripts/generate_golden.py`` for what is covered.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from cabana import Pipeline, ResultSet, Session
from cabana._results import MetricResult

GOLDEN = Path(__file__).parent / "golden"
MANIFEST = (
    json.loads((GOLDEN / "MANIFEST.json").read_text())
    if (GOLDEN / "MANIFEST.json").exists()
    else {"cases": {}}
)

# Provenance keys that must not drift.  Volatile (timestamp, env, cabana_version) and
# pipeline_sha256 (changes whenever a Pipeline/AnalysisSpec field is added) are skipped.
STABLE_PROVENANCE = (
    "seed",
    "effective_seed",
    "null",
    "n_shuffles",
    "alpha",
    "tail",
    "masks",
    "mask_info",
    "preprocess",
    "transforms",
    "support_used",
    "n_frames_used",
    "fs",
    "activity_kind",
    "n_cells",
    "target_kind",
    "target_params",
    "session_sha256",
)

_CACHE: dict[str, tuple[ResultSet, ResultSet]] = {}


def _both(case: str) -> tuple[ResultSet, ResultSet]:
    """(golden, fresh) result sets for a case; the fresh run is shared by all its analyses."""
    if case not in _CACHE:
        golden = ResultSet.load(GOLDEN / f"{case}.results.zip")
        session = Session.load(GOLDEN / f"{case}.session.zip")
        pipe = Pipeline.from_yaml(GOLDEN / f"{case}.pipeline.yaml")
        _, fresh = pipe.run(session)
        _CACHE[case] = (golden, fresh)
    return _CACHE[case]


def _assert_same(a, b, label: str) -> None:
    """``a`` fresh, ``b`` golden (as loaded from disk: float32 nulls, int32 shifts)."""
    a, b = np.asarray(a), np.asarray(b)
    assert a.shape == b.shape, f"{label}: shape {a.shape} != {b.shape}"
    if (
        b.dtype.kind in "US" or a.dtype.kind in "OUS"
    ):  # string-like (object arrays were stored as <U)
        assert a.astype(str).tolist() == b.astype(str).tolist(), label
    elif b.dtype.kind == "f":
        np.testing.assert_allclose(
            a.astype(b.dtype), b, rtol=1e-9, atol=0, equal_nan=True, err_msg=label
        )
    else:  # int / bool: exact
        np.testing.assert_array_equal(a, b, err_msg=label)


_SHUFFLE_ARRAYS = (
    "observed",
    "null",
    "shifts",
    "p_value",
    "null_lo",
    "null_hi",
    "significant",
    "p_adj",
    "significant_adj",
    "null_median",
    "null_mean",
)
_SHUFFLE_SCALARS = ("alpha", "tail", "n_shuffles", "null_name", "correction", "correction_scope")


def compare_result(fresh: MetricResult, gold: MetricResult) -> None:
    assert fresh.metric == gold.metric and fresh.target == gold.target
    assert fresh.level == gold.level
    assert fresh.cell_ids == gold.cell_ids and fresh.state_names == gold.state_names
    assert json.loads(json.dumps(fresh.params)) == gold.params  # tuples vs lists
    _assert_same(fresh.values, gold.values, "values")
    assert (fresh.shuffle is None) == (gold.shuffle is None)
    if gold.shuffle is not None:
        for k in _SHUFFLE_SCALARS:
            assert getattr(fresh.shuffle, k) == getattr(gold.shuffle, k), k
        for k in _SHUFFLE_ARRAYS:
            g, f = getattr(gold.shuffle, k), getattr(fresh.shuffle, k)
            assert (f is None) == (g is None), f"shuffle.{k}: presence differs"
            if g is not None:
                _assert_same(f, g, f"shuffle.{k}")
    assert set(fresh.extras) == set(gold.extras), "extras keys differ"
    for k in sorted(gold.extras):
        _assert_same(fresh.extras[k], gold.extras[k], f"extras[{k}]")
    for k in STABLE_PROVENANCE:
        assert fresh.provenance.get(k) == gold.provenance.get(k), f"provenance[{k}]"


CASE_ANALYSES = [(c, a) for c, d in MANIFEST["cases"].items() for a in d]


def test_manifest_present():
    assert CASE_ANALYSES, "tests/golden is empty: run pytest tests/test_golden.py --update-golden"


@pytest.mark.parametrize(
    ("case", "analysis"), CASE_ANALYSES, ids=[f"{c}-{a}" for c, a in CASE_ANALYSES]
)
def test_golden(case: str, analysis: str) -> None:
    golden, fresh = _both(case)
    compare_result(fresh[analysis], golden[analysis])


@pytest.mark.parametrize("case", list(MANIFEST["cases"]))
def test_golden_analysis_set(case: str) -> None:
    golden, fresh = _both(case)
    assert fresh.names() == golden.names() == list(MANIFEST["cases"][case])
