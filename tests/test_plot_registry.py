"""Unit tests of the plot registry, the plot-data JSON helpers and ``default_plots``."""

from __future__ import annotations

from types import SimpleNamespace

import matplotlib

matplotlib.use("Agg")
import matplotlib as mpl
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import pytest

from cabana import plots
from cabana._plot_registry import _PLOTS, PlotSpec, register_plot
from cabana._registry import _REGISTRY
from cabana._results import MetricResult, ResultSet, ShuffleResult

ALLOWED = {
    "rate_maps",
    "metric_strip",
    "shuffle_distribution",
    "joint_histogram",
    "tuning_heatmap",
    "split_half_maps",
    "peth",
    "event_raster",
    "population_matrix",
    "decoded_trajectory",
    "population_tuning",
}


def _shuffle(n=3, null=True):
    return ShuffleResult(
        observed=np.zeros(n),
        null=np.zeros((5, n)) if null else None,
        shifts=None,
        p_value=np.full(n, 0.5),
        null_lo=np.zeros(n),
        null_hi=np.ones(n),
        significant=np.zeros(n, bool),
        alpha=0.05,
        tail="upper",
        n_shuffles=5,
    )


def _result(values=None, *, level="cell", metric="_t_metric", name=None, shuffle=None, extras=None):
    values = np.zeros(3) if values is None else values
    return MetricResult(
        metric=metric,
        target="t",
        level=level,
        values=values,
        shuffle=shuffle,
        extras=extras or {},
        name=name,
    )


@pytest.fixture(autouse=True)
def _clean():
    before = set(_PLOTS)
    yield
    for k in set(_PLOTS) - before:
        del _PLOTS[k]
    plt.close("all")


@pytest.fixture
def metric(monkeypatch):
    cls = type("_TMetric", (), {"default_plots": ("_test_plot",)})
    monkeypatch.setitem(_REGISTRY["metric"], "_t_metric", cls)
    return cls


def _reg(name="_test_plot", **kw):
    @register_plot(name, **kw)
    def render(result, **k):
        render.calls.append(k)
        fig, ax = plt.subplots()
        fig.rc_font = mpl.rcParams["font.size"]
        fig.rc_spine = mpl.rcParams["axes.spines.top"]
        return fig

    render.calls = []
    return render


# --------------------------------------------------------------------------- #
# applies_to
# --------------------------------------------------------------------------- #


def _spec(**kw):
    return PlotSpec(name="x", render=lambda r: None, **kw)


def test_applies_level_and_session():
    r = _result()
    assert _spec(level="cell").applies_to(r)
    assert not _spec(level="population").applies_to(r)
    assert not _spec(needs_session=True).applies_to(r)
    assert _spec(needs_session=True).applies_to(r, object())


def test_applies_shuffle_and_null():
    r0 = _result()
    r1 = _result(shuffle=_shuffle(null=False))
    r2 = _result(shuffle=_shuffle())
    assert [_spec(requires=("shuffle",)).applies_to(r) for r in (r0, r1, r2)] == [False, True, True]
    assert [_spec(requires=("null",)).applies_to(r) for r in (r0, r1, r2)] == [False, False, True]


def test_applies_extras_and_values_dim():
    r = _result(extras={"k": np.zeros(1)})
    assert _spec(requires=("extras:k",)).applies_to(r)
    assert not _spec(requires=("extras:other",)).applies_to(r)
    r2 = _result(np.zeros((3, 4)))
    assert _spec(requires=("values:1d",)).applies_to(r)
    assert not _spec(requires=("values:1d",)).applies_to(r2)
    assert _spec(requires=("values:2d",)).applies_to(r2)
    assert not _spec(requires=("values:2d",)).applies_to(r)


def test_applies_topology_and_ground_truth():
    r = _result()
    grid = SimpleNamespace(
        states={"t": SimpleNamespace(topology=object())}, meta={"ground_truth": {"a": 1}}
    )
    cat = SimpleNamespace(states={"t": SimpleNamespace(topology=None)}, meta={})
    topo = _spec(requires=("topology",))
    assert topo.applies_to(r, grid) and not topo.applies_to(r, cat) and not topo.applies_to(r)
    gt = _spec(requires=("ground_truth",))
    assert gt.applies_to(r, grid) and not gt.applies_to(r, cat) and not gt.applies_to(r)


# --------------------------------------------------------------------------- #
# plots_for / plot
# --------------------------------------------------------------------------- #


def test_plots_for_uses_metric_defaults(metric):
    _reg()
    assert plots.plots_for(_result()) == ["_test_plot"]


def test_plots_for_fallback_generic_when_metric_unknown(monkeypatch):
    for n, req in (("metric_strip", "values:1d"), ("tuning_heatmap", "values:2d")):
        monkeypatch.setitem(
            _PLOTS, n, PlotSpec(name=n, render=lambda r: None, level="cell", requires=(req,))
        )
    r1 = _result(metric="nope_metric")
    r2 = _result(np.zeros((3, 4)), metric="nope_metric")
    assert plots.plots_for(r1)[0] == "metric_strip"
    assert plots.plots_for(r2)[0] == "tuning_heatmap"


def test_plot_error_messages(metric):
    _reg(level="population")
    r = _result()
    with pytest.raises(ValueError, match="no registered plot applies"):
        plots.plot(r)
    with pytest.raises(ValueError, match="does not apply.*level=population"):
        plots.plot(r, kind="_test_plot")
    _reg("_test_need", requires=("shuffle",))
    with pytest.raises(ValueError, match="requires=\\['shuffle'\\]"):
        plots.plot(r, kind="_test_need")
    with pytest.raises(KeyError, match="no plot named"):
        plots.plot(r, kind="_does_not_exist")


def test_defaults_hook_merges_explicit_wins(metric):
    render = _reg(defaults=lambda r, s: {"cells": [1, 2], "max_cells": 4})
    plt.close(plots.plot(_result()))
    assert render.calls[-1] == {"cells": [1, 2], "max_cells": 4}
    plt.close(plots.plot(_result(), cells=[9]))
    assert render.calls[-1] == {"cells": [9], "max_cells": 4}


def test_session_passed_when_needed(metric):
    seen = []

    @register_plot("_test_sess", needs_session=True)
    def render(result, session, **k):
        seen.append(session)
        return plt.figure()

    sess = object()
    plt.close(plots.plot(_result(), sess, "_test_sess"))
    assert seen == [sess]


def test_style_active_inside_render(metric):
    _reg()
    with mpl.rc_context({"font.size": 20, "axes.spines.top": True}):
        fig = plots.plot(_result())
    assert fig.rc_font == 9 and fig.rc_spine is False


# --------------------------------------------------------------------------- #
# plot_all / save_figures
# --------------------------------------------------------------------------- #


def test_plot_all_keys_and_kinds_override(metric):
    _reg()
    _reg("_test_other")
    rs = ResultSet(results=[_result(name="a"), _result(name="b[x]")])
    out = plots.plot_all(rs)
    assert set(out) == {"a/_test_plot", "b[x]/_test_plot"}
    assert all(isinstance(f, plt.Figure) for f in out.values())
    out = plots.plot_all(rs, kinds={"a": ["_test_other"]})
    assert set(out) == {"a/_test_other", "b[x]/_test_plot"}
    plt.close("all")


def test_plot_all_skips_inapplicable_defaults(metric):
    _reg(requires=("shuffle",))
    assert plots.plot_all([_result(name="a")]) == {}


def test_plot_all_out_dir_names_and_closes(metric, tmp_path):
    _reg()
    rs = ResultSet(results=[_result(name="b[x]")])
    plt.close("all")
    out = plots.plot_all(rs, out_dir=tmp_path / "figs")
    p = out["b[x]/_test_plot"]
    assert p.name == "b_x____test_plot.png" and p.exists()
    assert plt.get_fignums() == []


def test_plot_all_filters_unaccepted_kwargs(metric):
    calls = []

    @register_plot("_test_plot")
    def render(result, cells=None):
        calls.append(cells)
        return plt.figure()

    plots.plot_all([_result(name="a")], bogus=1, cells=[2])
    assert calls == [[2]]


def test_save_figures_pdf_and_keep_open(tmp_path):
    fig = plt.figure()
    paths = plots.save_figures({"a/b": fig}, tmp_path, fmt="pdf", close=False)
    assert paths[0].name == "a__b.pdf" and paths[0].read_bytes().startswith(b"%PDF")
    assert fig.number in plt.get_fignums()
    plots.save_figures({"a/b": fig}, tmp_path, fmt="svg")
    assert fig.number not in plt.get_fignums()


def test_result_and_resultset_delegate(metric, tmp_path):
    _reg()
    r = _result(name="a")
    assert r.plots() == ["_test_plot"]
    assert isinstance(r.plot(), plt.Figure)
    rs = ResultSet(results=[r])
    out = rs.plot_all(out_dir=tmp_path)
    assert out["a/_test_plot"].name == "a___test_plot.png"


# --------------------------------------------------------------------------- #
# plot-data JSON helpers
# --------------------------------------------------------------------------- #


def _data(**kw):
    return {"kind": "k", "version": plots.PLOT_DATA_VERSION, **kw}


def test_json_roundtrip_nan_inf():
    d = _data(
        a=np.array([1.0, np.nan, np.inf, -np.inf]),
        b=3,
        c=np.float64("nan"),
        s=["x", "y"],
        n={"z": np.arange(3)},
        flag=np.bool_(True),
    )
    back = plots.check_plot_data(d, "k")
    assert np.isnan(back["a"][1]) and back["a"][2] == np.inf and back["a"][3] == -np.inf
    assert np.isnan(back["c"]) and back["n"]["z"] == [0, 1, 2] and back["flag"] is True
    text = plots.to_json(d)
    assert "NaN" not in text and "Infinity" not in text
    assert plots.from_json(text)["s"] == ["x", "y"]


def test_check_plot_data_rejects_bad_dicts():
    with pytest.raises(ValueError, match="kind"):
        plots.check_plot_data({"version": plots.PLOT_DATA_VERSION})
    with pytest.raises(ValueError, match="!= expected"):
        plots.check_plot_data(_data(), "other")
    with pytest.raises(ValueError, match="version"):
        plots.check_plot_data({"kind": "k", "version": -1})
    with pytest.raises(TypeError):
        plots.check_plot_data([1])


def test_pandas_in_plot_data_raises():
    with pytest.raises(TypeError, match="DataFrame"):
        plots.to_json(_data(df=pd.DataFrame({"a": [1]})))
    with pytest.raises(TypeError):
        plots.check_plot_data(_data(df=pd.DataFrame({"a": [1]})))


# --------------------------------------------------------------------------- #
# built-in metrics
# --------------------------------------------------------------------------- #


def test_every_builtin_metric_declares_valid_default_plots():
    import cabana  # noqa: F401  (registers the built-ins)

    metrics = _REGISTRY["metric"]
    assert len(metrics) >= 15
    for name, cls in metrics.items():
        dp = cls.default_plots
        assert isinstance(dp, tuple) and all(isinstance(x, str) for x in dp), name
        assert set(dp) <= ALLOWED, (name, set(dp) - ALLOWED)
        assert len(set(dp)) == len(dp), name
