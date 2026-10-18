"""The Selector plugin stage: data-driven parameter choices applied before analyses."""

from __future__ import annotations

from typing import Any

import numpy as np

import cabana
from cabana import Pipeline
from cabana._registry import available


def _pipeline(**kw: Any) -> Pipeline:
    return Pipeline(
        selectors=[{"name": "_test_fixed_sigma", "sigma": 1.5}],
        analyses=[
            {
                "metric": {"name": "information_content"},
                "states": "position",
                "shuffle": {"n_shuffles": 10},
            }
        ],
        **kw,
    )


def test_selector_registered_and_serialised():
    assert "_test_fixed_sigma" in available("selector")
    p = _pipeline()
    d = p.to_dict()
    assert d["selectors"] == [{"name": "_test_fixed_sigma", "sigma": 1.5}]
    p2 = Pipeline.from_yaml(p.to_yaml())
    assert p2.selectors[0].sigma == 1.5
    assert "selectors" not in Pipeline(analyses=p.analyses).to_dict()


def test_selector_applies_to_run_copy_and_records_provenance(small_session):
    p = _pipeline()
    _, rs = p.run(small_session)
    r = rs.results[0]
    # consuming metric saw the chosen value; the spec as written is unchanged
    assert r.params["smooth_sigma_bins"] == 1.5
    assert p.analyses[0].metric.smooth_sigma_bins == 0.0
    sel = r.provenance["selections"]
    assert len(sel) == 1 and sel[0]["method"] == "auto_rule" and sel[0]["value"] == 1.5
    assert r.provenance["selectors"][0]["name"] == "_test_fixed_sigma"
    assert r.provenance["effective_pipeline_sha256"] != r.provenance["pipeline_sha256"]
    # same numbers as setting the parameter by hand
    manual = p.model_copy(update={"selectors": []}).set_param(
        "analyses.*.metric.smooth_sigma_bins", 1.5
    )
    np.testing.assert_allclose(manual.run(small_session)[1].results[0].values, r.values)


def test_selector_progress_stage(small_session):
    stages: list[str] = []
    ctx = cabana.RunContext(on_progress=lambda e: stages.append(e.stage))
    _pipeline().run(small_session, context=ctx)
    assert "select" in stages


def test_user_pick_is_not_overridden_by_selector(small_session):
    from cabana import RunContext, Selection

    p = _pipeline().set_param(
        "analyses.*.metric.smooth_sigma_bins",
        2.5,
        selection=Selection(
            path="analyses.*.metric.smooth_sigma_bins", value=2.5, method="user_pick"
        ),
    )
    logs: list[str] = []
    _, rs = p.run(small_session, context=RunContext(log=logs.append))
    r = rs.results[0]
    assert r.params["smooth_sigma_bins"] == 2.5  # the user's value survived the selector
    methods = [s["method"] for s in r.provenance["selections"]]
    assert methods == ["user_pick"]  # the selector's choice was not recorded
    assert any("kept the user's value 2.5" in line for line in logs)
    # a literature default does not pin the value: the selector still acts
    q = _pipeline().set_param(
        "analyses.*.metric.smooth_sigma_bins",
        2.5,
        selection=Selection(
            path="analyses.*.metric.smooth_sigma_bins", value=2.5, method="literature_default"
        ),
    )
    assert q.run(small_session)[1].results[0].params["smooth_sigma_bins"] == 1.5
