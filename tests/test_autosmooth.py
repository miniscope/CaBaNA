"""``auto_smooth_sigma``: cross-validated spatial smoothing selector."""

from __future__ import annotations

import ast
import time
from pathlib import Path

import numpy as np
import pytest

import cabana
from cabana import Pipeline
from cabana._selectors import AutoSmoothSigma, grid_bin_size, heldout_smoothing_scores
from conftest import _prepare

CANDS = [0.0, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0]


@pytest.fixture(scope="module")
def s20() -> cabana.Session:
    return _prepare(cabana.simulate_session(duration_s=600, n_cells=60, seed=0), 20.0)


def _pipe(**sel: object) -> Pipeline:
    return Pipeline(
        selectors=[{"name": "auto_smooth_sigma", **sel}],
        analyses=[
            {"metric": {"name": "information_content"}, "states": "position"},
            {"metric": {"name": "split_half_stability"}, "states": "position"},
            {"metric": {"name": "auroc"}, "states": "social"},
        ],
    )


def test_scores_finite_and_peaked(s20):
    t0 = time.perf_counter()
    mean, se = heldout_smoothing_scores(s20, "position", CANDS)
    assert time.perf_counter() - t0 < 30
    assert np.isfinite(mean).all() and np.isfinite(se).all() and (se > 0).all()
    best = int(np.argmax(mean))
    assert 0 < best < len(CANDS) - 1  # interior peak, not monotone
    assert mean[0] < mean[best] - 5 * se[best]  # no smoothing clearly worse
    g, _ = heldout_smoothing_scores(s20, "position", CANDS, likelihood="gaussian")
    assert np.isfinite(g).all() and 0 < int(np.argmax(g)) < len(CANDS) - 1


def test_pipeline_sets_only_matching_analyses(s20):
    p = _pipe()
    _, rs = p.run(s20)
    info, stab, au = (
        rs["information_content[position]"],
        rs["split_half_stability[position]"],
        rs["auroc[social]"],
    )
    sel = info.provenance["selections"]
    assert len(sel) == 1 and sel[0]["method"] == "auto_cv"
    sigma = sel[0]["value"]
    assert 0 < sigma <= 3
    assert stab.params["smooth_sigma_bins"] == sigma == info.params["smooth_sigma_bins"]
    assert "smooth_sigma_bins" not in au.params
    assert not au.provenance["selections"]
    assert sel[0]["criterion"] == "heldout_poisson_loglik"
    assert sel[0]["split"] == "contiguous_folds:5"
    assert sel[0]["candidates"] == CANDS and len(sel[0]["scores"]) == len(CANDS)
    assert "mm" in sel[0]["note"] and "one-SE" in sel[0]["note"]
    # spec as written unchanged
    assert p.analyses[0].metric.smooth_sigma_bins == 0.0 and p.selections == []


def test_deterministic_and_one_se_not_larger(s20):
    a = AutoSmoothSigma().select(s20, _pipe())
    b = AutoSmoothSigma().select(s20, _pipe())
    assert [x.value for x in a] == [x.value for x in b] and a[0].scores == b[0].scores
    full = AutoSmoothSigma(one_se=False).select(s20, _pipe())
    assert a[0].value <= full[0].value
    assert full[0].value == CANDS[int(np.argmax(full[0].scores))]


def test_mm_conversion(s20):
    size, aniso = grid_bin_size(s20.states["position"].topology)
    assert size == pytest.approx(20.0, rel=0.05) and not aniso
    sel = AutoSmoothSigma(candidates_mm=[0, 20, 40, 60]).select(s20, _pipe())
    assert sel[0].candidates == pytest.approx([0, 20 / size, 40 / size, 60 / size])
    with pytest.raises(ValueError, match="not both"):
        AutoSmoothSigma(candidates_mm=[0, 20], candidates_bins=[0, 1])


def test_non_grid_errors_and_no_match_warns(s20):
    with pytest.raises(ValueError, match="grid topology"):
        AutoSmoothSigma(states="social").select(s20, _pipe())
    only_social = Pipeline(analyses=[{"metric": {"name": "auroc"}, "states": "social"}])
    with pytest.warns(UserWarning, match="nothing selected"):
        assert AutoSmoothSigma().select(s20, only_social) == []
    with pytest.raises(KeyError):
        AutoSmoothSigma(analyses=["nope"]).select(s20, _pipe())
    with pytest.raises(NotImplementedError):
        AutoSmoothSigma(pool="per_cell")


def test_explicit_analysis_list(s20):
    sel = AutoSmoothSigma(analyses=["information_content[position]"]).select(s20, _pipe())
    assert [s.path for s in sel] == [
        "analyses.information_content[position].metric.smooth_sigma_bins"
    ]


def test_selector_never_sees_the_null():
    src = Path(cabana.__file__).parent / "_selectors.py"
    text = src.read_text()
    tree = ast.parse(text)
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            assert "shuffle" not in (node.module or "")
            assert all("shuffle" not in a.name for a in node.names)
        if isinstance(node, ast.Import):
            assert all("shuffle" not in a.name for a in node.names)
    assert "p_value" not in text and "shuffle_test" not in text
