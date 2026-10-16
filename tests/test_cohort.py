"""Cohort statistics: animal is the unit."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from cabana import Pipeline, ShuffleConfig, simulate_session
from cabana._cohort import (
    cohort_table,
    compare_states_across_animals,
    fraction_significant_by_animal,
    hierarchical_bootstrap,
    per_animal_summary,
)
from cabana._pipeline import AnalysisSpec
from cabana._plots_cohort import plot_cohort_fractions, plot_hierarchical_bootstrap
from cabana._results import MetricResult, ResultSet, ShuffleResult


def hand_table():
    rows = []
    for an, sigs in {"m1": [1, 1, 0, 0], "m2": [1, 0, 0, 0]}.items():
        for i, sg in enumerate(sigs):
            for st in ("x", "y"):
                rows.append(
                    dict(
                        metric="m",
                        target="t",
                        cell=f"c{i}",
                        state=st,
                        value=1.0 if sg else 0.0,
                        p_value=0.01 if sg else 0.5,
                        null_lo=-0.5,
                        null_hi=0.5,
                        significant=bool(sg),
                        session=f"s_{an}",
                        animal=an,
                    )
                )
    return pd.DataFrame(rows)


def test_fraction_significant_hand():
    f = fraction_significant_by_animal(hand_table(), metric="m", target="t")
    d = f.set_index(["animal", "state"])
    assert d.loc[("m1", "x"), "fraction_significant"] == 0.5
    assert d.loc[("m2", "y"), "fraction_significant"] == 0.25
    assert d.loc[("m1", "x"), "n_cells"] == 4
    assert d.loc[("m1", "x"), "fraction_positive"] == 0.5
    assert d.loc[("m1", "x"), "fraction_negative"] == 0.0
    allf = fraction_significant_by_animal(hand_table(), metric="m", target="t", by_state=False)
    assert set(allf["state"]) == {"all"} and len(allf) == 2
    with pytest.raises(KeyError):
        fraction_significant_by_animal(hand_table(), metric="zz", target="t")
    s = per_animal_summary(hand_table(), "m", "t")
    assert s.set_index("animal").loc["m1", "n_cells"] == 4


def test_compare_states_p_floor():
    rows = []
    for i in range(5):
        rows.append(dict(animal=f"m{i}", state="beh", fraction_significant=0.3 + 0.01 * i))
        rows.append(dict(animal=f"m{i}", state="ctl", fraction_significant=0.05))
    res = compare_states_across_animals(pd.DataFrame(rows), "beh", "ctl")
    assert res["n_animals"] == 5
    assert res["p_floor"] == pytest.approx(0.0625)
    assert res["p_value"] == pytest.approx(0.0625)
    assert res["mean_difference"] == pytest.approx(0.27)
    tt = compare_states_across_animals(pd.DataFrame(rows), "beh", "ctl", test="ttest")
    assert tt["p_value"] < 0.001
    with pytest.raises(KeyError):
        compare_states_across_animals(pd.DataFrame(rows), "beh", "nope")


def test_compare_states_zero_differences_and_p_floor_from_nonzero():
    def frame(diffs):
        rows = []
        for i, d in enumerate(diffs):
            rows.append(dict(animal=f"m{i}", state="beh", fraction_significant=0.1 + d))
            rows.append(dict(animal=f"m{i}", state="ctl", fraction_significant=0.1))
        return pd.DataFrame(rows)

    allzero = compare_states_across_animals(frame([0.0] * 5), "beh", "ctl")
    assert allzero["p_value"] == 1.0 and np.isnan(allzero["p_floor"])
    some = compare_states_across_animals(frame([0.1, 0.2, 0.3, 0.0, 0.0, 0.0, 0.0]), "beh", "ctl")
    assert some["n_animals"] == 7
    assert some["p_floor"] == pytest.approx(2 / 2**3)  # 3 non-zero differences
    assert some["p_value"] == pytest.approx(0.25)  # exact two-sided with n=3, all positive


def test_fraction_significant_excludes_undefined_p():
    t = hand_table()
    # make two of m1's cells undefined (NaN p) in state x
    idx = t[(t.animal == "m1") & (t.state == "x") & (t.cell.isin(["c2", "c3"]))].index
    t.loc[idx, "p_value"] = np.nan
    f = fraction_significant_by_animal(t, metric="m", target="t").set_index(["animal", "state"])
    assert f.loc[("m1", "x"), "n_undefined"] == 2
    assert f.loc[("m1", "x"), "fraction_significant"] == 1.0  # 2 of 2 defined
    assert f.loc[("m1", "y"), "n_undefined"] == 0
    assert f.loc[("m1", "y"), "fraction_significant"] == 0.5


def test_hierarchical_bootstrap_wider_than_pooled(tmp_path):
    rng = np.random.default_rng(0)
    rows = []
    means = [0.0, 1.0, 2.0, 3.0, 4.0]
    for k, mu in enumerate(means):
        for c in range(100):
            rows.append(
                dict(animal=f"m{k}", session=f"s{k}", cell=f"c{c}", value=mu + rng.normal(0, 0.3))
            )
    df = pd.DataFrame(rows)
    boot = hierarchical_bootstrap(df, lambda t: float(t["value"].mean()), n_boot=400, seed=1)
    assert boot.ci[0] < 2.0 < boot.ci[1]
    assert (boot.ci[1] - boot.ci[0]) > 3 * (boot.naive_ci[1] - boot.naive_ci[0])
    again = hierarchical_bootstrap(df, lambda t: float(t["value"].mean()), n_boot=400, seed=1)
    assert np.array_equal(boot.distribution, again.distribution)
    plot_hierarchical_bootstrap(boot).savefig(tmp_path / "boot.png")
    one = hierarchical_bootstrap(
        df, lambda t: float(t["value"].mean()), n_boot=50, level=("animal",)
    )
    assert one.n_animals == 5


def _results(seed, n_shuffles=100):
    pipe = Pipeline(
        transforms=[
            {"name": "resample_signal", "source": "position"},
            {"name": "speed"},
            {"name": "bin_grid", "signals": ["x", "y"], "bin_size": 50.0, "output": "position"},
        ],
        analyses=[
            AnalysisSpec(
                metric={"name": "information_content"},
                states="position",
                shuffle=ShuffleConfig(n_shuffles=n_shuffles, seed=0),
            )
        ],
    )
    return pipe.run(simulate_session(duration_s=300, n_cells=40, seed=seed))[1]


def test_end_to_end(tmp_path):
    rs = {f"s{i}": _results(i) for i in range(3)}
    animal = {"s0": "m1", "s1": "m1", "s2": "m2"}
    tab = cohort_table(rs, animal)
    assert {"session", "animal", "metric", "value", "significant"} <= set(tab.columns)
    assert set(tab["animal"]) == {"m1", "m2"}
    f = fraction_significant_by_animal(
        tab, metric="information_content", target="position", by_state=False
    )
    assert len(f) == 2
    assert f.set_index("animal").loc["m1", "n_cells"] == 80
    assert (f["fraction_significant"] > 0).all()
    plot_cohort_fractions(f.assign(state=["a", "b"])).savefig(tmp_path / "f.png")


def test_plot_fractions_with_control(tmp_path):
    rows = [
        dict(animal=f"m{i}", state=s, fraction_significant=v + 0.01 * i)
        for i in range(4)
        for s, v in (("a", 0.4), ("b", 0.3), ("ctl", 0.05))
    ]
    fig = plot_cohort_fractions(pd.DataFrame(rows), control_state="ctl")
    fig.savefig(tmp_path / "g.png")


def test_cohort_table_missing_animal():
    mr = MetricResult(
        metric="m",
        target="t",
        level="cell",
        values=np.zeros(2),
        shuffle=ShuffleResult(
            observed=np.zeros(2),
            null=np.zeros((3, 2)),
            shifts=None,
            p_value=np.ones(2),
            null_lo=np.zeros(2),
            null_hi=np.zeros(2),
            significant=np.zeros(2, bool),
            alpha=0.05,
            tail="upper",
            n_shuffles=3,
        ),
    )
    rs = ResultSet(results=[mr])
    with pytest.raises(KeyError):
        cohort_table({"a": rs}, {})
    assert list(cohort_table({"a": rs}, {"a": "m"})["animal"]) == ["m", "m"]
