"""AutoNullTimescale: autocorrelation-based null timescales (never sees the null)."""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import pytest

import cabana
from cabana import Pipeline
from cabana._selectors_null import (
    autocorrelation_time,
    mean_bout_length,
    state_autocorrelation_time,
)

FS = 10.0


def _ar1(n: int, tau_s: float, fs: float, seed: int = 0) -> np.ndarray:
    phi = np.exp(-1.0 / (tau_s * fs))
    rng = np.random.default_rng(seed)
    e = rng.standard_normal(n)
    x = np.empty(n)
    x[0] = e[0]
    for t in range(1, n):
        x[t] = phi * x[t - 1] + e[t]
    return x


def test_tau_recovers_ar1():
    # AR(1): r[k] = exp(-k/(tau fs)) so the 1/e crossing is at tau
    x = _ar1(60_000, 3.0, FS)
    assert autocorrelation_time(x, FS) == pytest.approx(3.0, abs=0.4)


def test_tau_white_noise_is_one_frame():
    x = np.random.default_rng(1).standard_normal(20_000)
    assert autocorrelation_time(x, FS) == pytest.approx(1 / FS)


def test_tau_mask_and_nan_safe():
    x = _ar1(60_000, 3.0, FS)
    x[1000:1100] = np.nan
    mask = np.ones(x.size, bool)
    mask[5000:5200] = False
    assert autocorrelation_time(x, FS, mask=mask) == pytest.approx(3.0, abs=0.5)
    assert np.isnan(autocorrelation_time(np.ones(100), FS))


def test_tau_never_below_warns_and_caps():
    x = np.cumsum(np.random.default_rng(2).standard_normal(5000))
    with pytest.warns(UserWarning, match="1/e"):
        assert autocorrelation_time(x, FS, max_lag_s=20.0) == 20.0


def test_state_autocorr_of_known_bouts():
    rng = np.random.default_rng(3)
    # alternating exponential-ish bouts of mean 5 s on / 5 s off
    n, on, t, s = 40_000, np.zeros(40_000, bool), 0, False
    while t < n:
        ln = max(1, int(rng.exponential(5.0 * FS)))
        on[t : t + ln] = s
        t += ln
        s = not s
    oh = np.stack([on, ~on], axis=1)
    tau = state_autocorrelation_time(oh, FS)
    assert 2.0 < tau < 8.0  # same order as the 5 s bouts (telegraph: 5 ln2 ~ 3.5 s)
    assert mean_bout_length(oh, FS) == pytest.approx(5.0, rel=0.25)


def _pipe(**sel: object) -> Pipeline:
    return Pipeline(
        selectors=[{"name": "auto_null_timescale", **sel}],
        analyses=[
            {
                "metric": {"name": "information_content"},
                "states": "position",
                "shuffle": {"n_shuffles": 10},
                "name": "shift",
            },
            {
                "metric": {"name": "auroc"},
                "states": "social",
                "shuffle": {"n_shuffles": 10, "null": {"name": "label_shuffle"}},
                "name": "block",
            },
            {
                "metric": {"name": "auroc"},
                "states": "social",
                "shuffle": {"n_shuffles": 10, "null": {"name": "bout_shuffle"}},
                "name": "bouts",
            },
        ],
    )


def _chosen(p: Pipeline, session) -> dict:
    sel = p.selectors[0]
    return {s.path: s for s in sel.select(session, p)}


def test_selector_on_sim_session(sim_session):
    p = _pipe()
    _, rs = p.run(sim_session)
    by = {r.name: r for r in rs.results}
    sh = by["shift"].provenance["selections"]
    assert [s["path"] for s in sh] == ["analyses.shift.shuffle.min_shift_s"]
    assert sh[0]["method"] == "auto_rule" and sh[0]["criterion"] == "autocorrelation_1_over_e"
    assert sh[0]["candidates"] is None and sh[0]["scores"] is None
    assert 5.0 <= sh[0]["value"] <= 0.25 * 600
    assert by["shift"].params.get("min_shift_s", sh[0]["value"]) == sh[0]["value"]
    bl = by["block"].provenance["selections"]
    assert [s["path"] for s in bl] == ["analyses.block.shuffle.null"]
    assert bl[0]["value"]["name"] == "label_shuffle" and bl[0]["value"]["block_s"] >= 0.25
    assert by["bouts"].provenance["selections"] == []
    # spec as written is unchanged
    assert p.analyses[0].shuffle.min_shift_s == 20.0
    assert p.analyses[1].shuffle.null.block_s == 1.0


def test_selector_deterministic_and_applied_value(sim_session):
    p = _pipe()
    a, b = _chosen(p, sim_session), _chosen(p, sim_session)
    assert {k: v.value for k, v in a.items()} == {k: v.value for k, v in b.items()}
    eff = p.set_param(
        "analyses.shift.shuffle.min_shift_s", a["analyses.shift.shuffle.min_shift_s"].value
    )
    assert (
        eff.analyses[0].shuffle.resolved_null().min_shift_s
        == a["analyses.shift.shuffle.min_shift_s"].value
    )


def test_selector_flags_and_mean_bout(sim_session):
    p = _pipe(set_block=False)
    assert list(_chosen(p, sim_session)) == ["analyses.shift.shuffle.min_shift_s"]
    p = _pipe(set_min_shift=False, block_rule="mean_bout")
    ch = _chosen(p, sim_session)
    assert list(ch) == ["analyses.block.shuffle.null"]
    assert ch["analyses.block.shuffle.null"].criterion == "mean_bout_length"


def test_selector_caps_short_session():
    sess = cabana.simulate_session(duration_s=40, n_cells=5, seed=0)
    from conftest import _prepare

    sess = _prepare(sess, 100.0)
    ch = _chosen(_pipe(multiple=1000.0), sess)
    v = ch["analyses.shift.shuffle.min_shift_s"].value
    assert v == pytest.approx(0.25 * 40)
    assert "capped" in ch["analyses.shift.shuffle.min_shift_s"].note


def test_selector_no_match_warns(sim_session):
    with pytest.warns(UserWarning, match="no analysis"):
        assert _chosen(_pipe(analyses="nope*"), sim_session) == {}


def test_module_never_sees_the_null():
    src = Path(cabana.__file__).parent.joinpath("_selectors_null.py").read_text()
    assert not re.search(r"import[^\n]*_shuffle|from\s+\.?_shuffle|shuffle_test", src)
    assert not re.search(r"p_value|p-value|significan", src, re.I)
