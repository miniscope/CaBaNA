"""Tests for TuningExport, cabana.tune and apply_tuning."""

from __future__ import annotations

import json
import warnings

import pytest

import cabana
from cabana import Pipeline, Selection, SweepResult, TuningExport, apply_tuning, sweep, tune

SIGMA = "analyses.*.metric.smooth_sigma_bins"


def _pipe() -> Pipeline:
    return Pipeline(
        analyses=[{"name": "info", "metric": {"name": "information_content"}, "states": "position"}]
    )


@pytest.fixture(scope="module")
def export(small_session):
    return tune(small_session, _pipe(), {SIGMA: [0, 1, 2]}, criterion="median_value")


def test_tune_export_contents(export, small_session):
    assert export.chosen[SIGMA] in [0, 1, 2]
    assert export.swept == {SIGMA: [0, 1, 2]}
    assert export.rule == "one_se" and export.criterion == "median_value"
    assert [s.method for s in export.selections] == ["sweep_stability"]
    assert export.metadata["n_cells"] == small_session.n_cells
    summ = export.metadata["sweep_summary"][SIGMA]
    assert summ["candidates"] == [0, 1, 2] and len(summ["scores"]) == 3 and len(summ["se"]) == 3
    assert export.session_hash and export.pipeline_sha256


def test_json_round_trip_with_nan(export, tmp_path):
    e = export.model_copy(deep=True)
    e.metadata["sweep_summary"][SIGMA]["scores"][0] = float("nan")
    json.dumps(e.to_dict(), allow_nan=False)
    text = e.to_json()
    back = TuningExport.from_json(text)
    assert (
        back.metadata["sweep_summary"][SIGMA]["scores"][0]
        != back.metadata["sweep_summary"][SIGMA]["scores"][0]
    )  # NaN
    f = tmp_path / "t.json"
    e.to_json(f)
    assert TuningExport.from_json(f).chosen == e.chosen
    assert TuningExport.from_json(str(f)).chosen == e.chosen


def test_apply_tuning(export, small_session):
    pipe = _pipe()
    out = pipe.apply_tuning(export)
    assert out.get_param(SIGMA) == [export.chosen[SIGMA]]
    assert [s.path for s in out.selections] == [SIGMA]
    assert out.selections[0].method == "sweep_stability"
    _, rs = out.run(small_session)
    assert rs["info"].provenance["selections"][0]["path"] == SIGMA
    assert pipe.selections == []


def test_apply_tuning_user_pick_when_no_selection(export):
    e = export.model_copy(update={"selections": []})
    out = apply_tuning(_pipe(), e)
    assert out.selections[0].method == "user_pick"
    assert "TuningExport" in out.selections[0].note


def test_hash_mismatch(export):
    other = Pipeline(
        analyses=[{"name": "info", "metric": {"name": "information_content"}, "states": "social"}]
    )
    with pytest.raises(ValueError, match="different pipeline"):
        apply_tuning(other, export)
    with pytest.warns(UserWarning, match="different pipeline"):
        out = apply_tuning(other, export, strict=False)
    assert out.get_param(SIGMA) == [export.chosen[SIGMA]]


def test_export_applies_to_an_already_tuned_pipeline(export):
    """The hash ignores `selections` and the swept values, so applying twice is fine."""
    once = apply_tuning(_pipe(), export)
    assert once.selections  # the hash used to include them
    twice = apply_tuning(once, export)  # strict: must not raise
    assert twice.get_param(SIGMA) == once.get_param(SIGMA)
    assert [s.path for s in twice.selections] == [SIGMA, SIGMA]
    # a user value on the swept path (and a selection) is not a "different pipeline" either
    other_value = _pipe().set_param(SIGMA, 3, method="user_pick")
    assert apply_tuning(other_value, export).get_param(SIGMA) == once.get_param(SIGMA)


def test_sweep_hash_matches_tuning_sha(small_session):
    sw = sweep(small_session, _pipe(), {SIGMA: [0, 1]}, shuffle=False)
    assert sw.pipeline_sha256 == cabana._tuning.tuning_sha(_pipe(), {SIGMA: 0})
    assert cabana._tuning.tuning_sha(_pipe(), {SIGMA: 0}) == cabana._tuning.tuning_sha(
        _pipe().set_param(SIGMA, 2, method="user_pick"), {SIGMA: 0}
    )


def test_tune_requires_a_criterion(small_session):
    with pytest.raises(TypeError, match="criterion"):
        tune(small_session, _pipe(), {SIGMA: [0, 1]})
    doc = tune.__doc__ or ""
    assert "least smoothed" in doc and "auto_smooth_sigma" in doc


def test_processed_session_hash_is_documented():
    assert "rebin_time" in (apply_tuning.__doc__ or "")


def test_session_hash_mismatch_warns(export, small_session, sim_session):
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        apply_tuning(_pipe(), export, session=small_session)
    with pytest.warns(UserWarning, match="another session"):
        apply_tuning(_pipe(), export, session=sim_session)


def test_bad_path_raises(export):
    e = export.model_copy(update={"chosen": {"analyses.*.metric.nope": 1}, "selections": []})
    with pytest.raises(ValueError):
        apply_tuning(_pipe(), e)


def test_significance_refused(small_session):
    with pytest.raises(ValueError, match="refusing to pick"):
        tune(small_session, _pipe(), {SIGMA: [0, 1]}, criterion="frac_significant")


def test_interactive_not_available(small_session):
    with pytest.raises(NotImplementedError, match="not available yet"):
        tune(small_session, _pipe(), {SIGMA: [0, 1]}, criterion="median_value", open_browser=True)
    with pytest.raises(NotImplementedError):
        tune(small_session, _pipe(), {SIGMA: [0, 1]}, criterion="median_value", app_url="http://x")


def test_user_pick_export_without_criterion(small_session):
    sw = sweep(small_session, _pipe(), {SIGMA: [0, 1, 2]}, shuffle=False)
    sel = Selection(path=SIGMA, value=1, method="user_pick", note="eyeballed")
    e = sw.to_tuning_export([sel])
    assert e.chosen == {SIGMA: 1} and e.criterion is None
    assert e.selections[0].method == "user_pick"
    with pytest.raises(ValueError, match="criterion"):
        sw.to_tuning_export()


def test_sweep_save_load_keeps_fields(small_session, tmp_path):
    sw = sweep(small_session, _pipe(), {SIGMA: [0, 1]}, shuffle=False)
    assert sw.pipeline_sha256 and sw.session_hash and sw.session_meta["n_cells"]
    sw.save(tmp_path / "s")
    back = SweepResult.load(tmp_path / "s")
    assert back.pipeline_sha256 == sw.pipeline_sha256
    assert back.session_hash == sw.session_hash
    assert back.session_meta == sw.session_meta
    idx = tmp_path / "s" / "index.json"
    d = json.loads(idx.read_text())
    for k in ("pipeline_sha256", "session_hash", "session_meta"):
        d.pop(k)
    idx.write_text(json.dumps(d))
    old = SweepResult.load(tmp_path / "s")
    assert old.pipeline_sha256 is None and old.session_hash is None and old.session_meta == {}
    with pytest.raises(ValueError, match="predates"):
        old.to_tuning_export(criterion="median_value")


def test_json_schema():
    json.dumps(TuningExport.model_json_schema())
    assert cabana.TuningExport is TuningExport
