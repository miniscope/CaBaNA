"""Smoke tests for the sweep plots and their plot-data companions."""

from __future__ import annotations

import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import pytest

from cabana import Pipeline, ShuffleConfig, build, sweep
from cabana import plots
from cabana._plots_sweep import (
    plot_sweep_data,
    plot_sweep_gallery_data,
    plot_sweep_stability_data,
)

SIGMA = "analyses.*.metric.smooth_sigma_bins"
SH = ShuffleConfig(n_shuffles=10, min_shift_s=10.0, seed=0)


def _dump(d):
    def default(o):
        if isinstance(o, np.ndarray):
            return o.tolist()
        if isinstance(o, np.generic):
            return o.item()
        raise TypeError(type(o))

    return json.dumps(d, default=default, allow_nan=True)


@pytest.fixture(scope="module")
def session1d(small_session):
    return build(
        "transform", {"name": "bin_grid", "signals": ["x"], "bin_size": 50.0, "output": "pos1d"}
    ).apply(small_session)


@pytest.fixture(scope="module")
def grid_sweep(small_session):
    pipe = Pipeline(
        analyses=[
            {
                "name": "info",
                "metric": {"name": "information_content"},
                "states": "position",
                "shuffle": SH,
            }
        ]
    )
    return sweep(small_session, pipe, {SIGMA: [0.0, 1.0, 2.0]})


def test_gallery_grid(small_session, grid_sweep):
    fig = plots.plot_sweep_gallery(small_session, grid_sweep, 0, param=SIGMA)
    assert len(fig.axes) >= 3
    plt.close(fig)
    d = plot_sweep_gallery_data(small_session, grid_sweep, "cell_001", param=SIGMA)
    assert [p["kind"] for p in d["panels"]] == ["grid2d"] * 3 and d["cell_id"] == "cell_001"
    assert d["vmin"] <= d["vmax"]
    json.loads(_dump(d))


def test_gallery_without_rate_map_extra_recomputes(small_session):
    pipe = Pipeline(
        analyses=[{"name": "s", "metric": {"name": "split_half_stability"}, "states": "position"}]
    )
    sw = sweep(small_session, pipe, {SIGMA: [0.0, 1.0]}, shuffle=False)
    for _, rs in sw.points:
        rs["s"].extras.pop("rate_map_a", None)
    d = plot_sweep_gallery_data(small_session, sw, 2, param=SIGMA)
    assert all(p["kind"] == "grid2d" and p["map"] is not None for p in d["panels"])
    plt.close(plots.plot_sweep_gallery(small_session, sw, 2, param=SIGMA, shared_scale=False))


def test_gallery_categorical_and_1d(small_session, session1d):
    pipe = Pipeline(
        analyses=[{"name": "cat", "metric": {"name": "information_content"}, "states": "syllables"}]
    )
    sw = sweep(
        small_session, pipe, {"analyses.*.metric.min_occupancy_s": [0.05, 0.5]}, shuffle=False
    )
    fig = plots.plot_sweep_gallery(small_session, sw, 0, param="analyses.*.metric.min_occupancy_s")
    assert isinstance(fig, plt.Figure)
    assert (
        plot_sweep_gallery_data(small_session, sw, 0, param="analyses.*.metric.min_occupancy_s")[
            "panels"
        ][0]["kind"]
        == "bar"
    )
    plt.close(fig)
    pipe = Pipeline(
        analyses=[
            {
                "name": "one",
                "metric": {"name": "information_content"},
                "states": "pos1d",
                "shuffle": SH,
            }
        ]
    )
    sw = sweep(session1d, pipe, {SIGMA: [0.0, 1.0]})
    fig = plots.plot_sweep_gallery(session1d, sw, 3, param=SIGMA)
    assert isinstance(fig, plt.Figure)
    d = plot_sweep_gallery_data(session1d, sw, 3, param=SIGMA)
    assert d["panels"][0]["kind"] == "grid1d"
    json.loads(_dump(d))
    plt.close(fig)


def test_stability_plot_and_data(grid_sweep):
    fig = plots.plot_sweep_stability(grid_sweep, analysis="info", param=SIGMA)
    assert isinstance(fig, plt.Figure) and len(fig.axes) == 4  # 3 panels + flip marginal
    plt.close(fig)
    d = plot_sweep_stability_data(grid_sweep, analysis="info", param=SIGMA)
    assert d["matrix"].shape == (20, 3) and len(d["spearman"]) == 2
    assert np.all(d["ci_lo"] <= d["frac_significant"] + 1e-12)
    flips = d["flip_counts"]
    assert flips[0] >= flips[-1]  # sorted by first flip: flippers first
    json.loads(_dump(d))


def test_stability_without_shuffles(small_session):
    pipe = Pipeline(
        analyses=[{"name": "info", "metric": {"name": "information_content"}, "states": "position"}]
    )
    sw = sweep(small_session, pipe, {SIGMA: [0.0, 1.0]}, shuffle=False)
    fig = plots.plot_sweep_stability(sw, analysis="info", param=SIGMA)
    assert isinstance(fig, plt.Figure)
    plt.close(fig)


def test_plot_sweep_generic(grid_sweep):
    s = grid_sweep.summary()
    fig = plots.plot_sweep(s, x=SIGMA, panels=("frac_significant", "median_value"))
    assert len(fig.axes) == 2
    plt.close(fig)
    df = pd.DataFrame(
        {"x": [1, 2, 4] * 2, "h": ["a"] * 3 + ["b"] * 3, "y": [0.1, 0.5, 0.6, 0.2, 0.4, 0.9]}
    )
    fig = plots.plot_sweep(df, x="x", hue="h", panels=("y",), alpha_line=0.05, log_x=True)
    assert fig.axes[0].get_xscale() == "log" and len(fig.axes[0].lines) == 3
    plt.close(fig)
    d = plot_sweep_data(df, x="x", hue="h", panels=("y",))
    assert len(d["lines"]) == 2
    json.loads(_dump(d))
    with pytest.raises(ValueError):
        plots.plot_sweep(df, x="nope")
