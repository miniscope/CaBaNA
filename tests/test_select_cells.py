"""SelectCells step, cell_qc_table and the QC columns written by DetectEvents."""

from __future__ import annotations

import warnings

import numpy as np
import pytest

from cabana import AnalysisSpec, Pipeline, Session, StateSpace, build
from cabana._preprocess_cells import SelectCells, cell_qc_table

FS = 10.0
T = 100


def sess(kind="spike_counts", **kw):
    a = np.zeros((5, T))
    for i in range(5):
        a[i, : 10 * i] = 1.0  # cell i: 10*i active frames (one run)
    a[4, :5] = np.nan
    oh = np.zeros((T, 2), bool)
    oh[np.arange(T), np.arange(T) % 2] = True
    st = StateSpace(name="s", onehot=oh, state_names=["a", "b"], kind="categorical", exclusive=True)
    return Session(
        activity=a,
        t=np.arange(T) / FS,
        fs=FS,
        activity_kind=kind,
        cell_ids=list("ABCDE"),
        states={"s": st},
        cell_meta={
            "snr": np.array([1.0, 2.0, 3.0, 4.0, 5.0]),
            "pve": np.array([0.1, 0.2, 0.3, 0.4, 0.5]),
            "accepted": np.array([1, 1, 0, 1, 1], bool),
        },
        **kw,
    )


def kept(s, **kw):
    return SelectCells(**kw).apply(s).cell_ids


def test_registered():
    assert isinstance(build("preprocess", {"name": "select_cells", "min_snr": 2}), SelectCells)


def test_criteria():
    s = sess()
    assert kept(s, min_snr=3) == ["C", "D", "E"]
    assert kept(s, max_snr=2) == ["A", "B"]
    assert kept(s, min_pve=0.35) == ["D", "E"]
    assert kept(s, require=["accepted"]) == ["A", "B", "D", "E"]
    assert kept(s, ids=["B", "A"]) == ["A", "B"]
    assert kept(s, exclude_ids=["A", "E"]) == ["B", "C", "D"]
    # spike_counts: n_events = total count = 10*i (E has 5 NaN frames -> 35); rate = n / (frames / fs)
    assert kept(s, min_events=20) == ["C", "D", "E"]
    assert kept(s, min_rate_hz=3.0) == ["D", "E"]
    assert kept(s, max_rate_hz=2.5, min_rate_hz=0.5) == ["B", "C"]
    assert kept(s, min_fraction_finite=0.99) == ["A", "B", "C", "D"]
    assert kept(s, min_snr=2, require=["accepted"], exclude_ids=["B"]) == ["D", "E"]


def test_masks_define_event_stats():
    m = np.zeros(T, bool)
    m[:50] = True
    s = sess(masks={"m": m})
    t = cell_qc_table(s)
    # cell D has 30 events, all in the first 50 frames (5 s): rate 6 Hz
    assert t.loc["D", "n_events"] == 30 and t.loc["D", "mean_rate_hz"] == pytest.approx(6.0)


def test_event_definitions_by_kind():
    b = np.zeros((1, T))
    b[0, [3, 4, 5, 20, 40]] = 1
    for kind, n in (("binary", 3), ("deconvolved", 5)):
        s = Session(activity=b, t=np.arange(T) / FS, fs=FS, activity_kind=kind)
        assert cell_qc_table(s)["n_events"].iloc[0] == n
    s = Session(activity=b, t=np.arange(T) / FS, fs=FS, activity_kind="dff")
    assert "n_events" not in cell_qc_table(s).columns


def test_missing_column_warns_and_skips():
    s = sess(kind="dff").replace(cell_meta={"snr": np.arange(5.0)})
    with pytest.warns(UserWarning, match="min_rate_hz skipped"):
        out = SelectCells(min_rate_hz=1.0, min_snr=2).apply(s)
    assert out.cell_ids == ["C", "D", "E"]
    with pytest.warns(UserWarning, match="min_pve skipped"):
        assert SelectCells(min_pve=0.5).apply(s).n_cells == 5
    with pytest.warns(UserWarning, match="require='accepted'"):
        assert SelectCells(require=["accepted"]).apply(s).n_cells == 5
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        SelectCells(min_snr=1).apply(s)


def test_keep_at_least_and_unknown_ids():
    s = sess()
    with pytest.raises(ValueError, match="keep_at_least"):
        SelectCells(min_snr=99).apply(s)
    assert SelectCells(min_snr=99, keep_at_least=0).apply(s).n_cells == 0
    with pytest.raises(ValueError, match="unknown ids"):
        SelectCells(ids=["Z"]).apply(s)
    with pytest.warns(UserWarning, match="exclude_ids"):
        assert kept(s, exclude_ids=["Z"]) == list("ABCDE")
    with pytest.raises(ValueError, match="keep_at_least"):
        SelectCells(min_snr=4, keep_at_least=3).apply(s)


def test_provenance_and_alignment():
    s = sess()
    out = SelectCells(min_snr=3, require=["accepted"]).apply(s)
    sel = out.meta["cell_selection"]
    assert sel["n_before"] == 5 and sel["n_after"] == 2
    assert sel["dropped_ids"] == ["A", "B", "C"]
    assert sel["source"]["name"] == "select_cells" and sel["source"]["min_snr"] == 3
    np.testing.assert_allclose(out.cell_meta["snr"], [4, 5])
    assert out.activity.shape[0] == 2


def test_qc_table_columns():
    t = cell_qc_table(sess())
    assert {"snr", "pve", "accepted", "fraction_finite", "n_events", "mean_rate_hz"} <= set(
        t.columns
    )
    assert t.loc["E", "fraction_finite"] == pytest.approx(0.95)
    assert list(t.index) == list("ABCDE")
    # stored columns win over computed ones
    s = sess().replace(cell_meta={"n_events": np.arange(5)})
    assert list(cell_qc_table(s)["n_events"]) == [0, 1, 2, 3, 4]


def test_detect_events_cell_meta():
    rng = np.random.default_rng(1)
    a = rng.normal(0, 1, (3, 400))
    a[:, 100:110] += 20
    a[0, 300:310] += 20
    s = Session(activity=a, t=np.arange(400) / FS, fs=FS, activity_kind="dff")
    out = build("preprocess", {"name": "detect_events", "k": 5.0}).apply(s)
    for k in ("noise_sd", "event_threshold", "n_events"):
        assert out.cell_meta[k].shape == (3,)
    assert out.cell_meta["n_events"].tolist() == [2, 1, 1]
    assert out.cell_meta["noise_sd"] == pytest.approx(out.meta["detect_events"]["noise"])
    assert out.cell_meta["n_events"].tolist() == out.meta["detect_events"]["n_events"]


def test_pipeline_select_before_analyses():
    s = sess().replace(
        cell_meta={"snr": np.array([1.0, 2.0, 3.0, 4.0, 5.0])},
    )
    pipe = Pipeline(
        preprocess=[{"name": "select_cells", "min_snr": 3}],
        analyses=[AnalysisSpec(metric={"name": "mean_per_state"}, states="s")],
    )
    _, rs = pipe.run(s)
    assert rs.results[0].provenance["n_cells"] == 3
    assert rs.results[0].provenance["preprocess"][0]["name"] == "select_cells"
