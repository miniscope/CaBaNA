import matplotlib

matplotlib.use("Agg")
import numpy as np
import pytest

from cabana import AnalysisSpec, Pipeline, ShuffleConfig
from cabana._criteria import (
    Clause,
    Criteria,
    classification_table,
    classify,
    fraction_classified_by_animal,
    place_cell_criteria,
    responsive_cell_criteria,
)
from cabana._plots._posthoc import plot_classification
from cabana._posthoc import overlap_matrix, overlap_vs_chance


@pytest.fixture(scope="module")
def rs_gt(sim_session):
    shuf = ShuffleConfig(n_shuffles=50, seed=0)
    pipe = Pipeline(
        preprocess=[{"name": "speed_threshold", "min_speed": 20.0}],
        analyses=[
            AnalysisSpec(
                metric={"name": "information_content", "smooth_sigma_bins": 1.0},
                states="position",
                shuffle=shuf,
                masks=["speed"],
            ),
            AnalysisSpec(
                metric={"name": "split_half_stability", "smooth_sigma_bins": 1.0},
                states="position",
                shuffle=shuf,
                masks=["speed"],
            ),
            AnalysisSpec(metric={"name": "auroc"}, states="social", shuffle=shuf),
        ],
    )
    _, rs = pipe.run(sim_session, progress=False)
    return rs, sim_session.meta["ground_truth"]


def test_place_cells_recovered(rs_gt):
    rs, gt = rs_gt
    m = place_cell_criteria().evaluate(rs)
    assert m[gt["place_cells"]].mean() >= 0.8
    assert m[gt["untuned_cells"]].mean() <= 0.1


@pytest.mark.parametrize("use_p", [False, True])
def test_responsive(rs_gt, use_p):
    rs, gt = rs_gt
    crit = responsive_cell_criteria(rs, "social", use_p=use_p)
    cl = classify(rs, crit)
    hits = [
        cl.labels[f"{d['behavior']}_{'excited' if d['sign'] == 'excited' else 'inhibited'}"][
            d["cell"]
        ]
        for d in gt["social_cells"]
    ]
    assert np.mean(hits) >= 0.7


def test_clause_state_rules(rs_gt):
    rs, _ = rs_gt
    with pytest.raises(ValueError, match="state"):
        Clause(analysis="auroc[social]").evaluate(rs)
    with pytest.raises(ValueError, match="1-D"):
        Clause(analysis="information_content[position]", state="x").evaluate(rs)
    r = rs["auroc[social]"]
    names = r.state_names
    each = [Clause(analysis="auroc[social]", state=s).evaluate(rs) for s in names]
    anyc = Clause(metric="auroc", target="social", state="any").evaluate(rs)
    np.testing.assert_array_equal(anyc, np.any(each, axis=0))
    assert Clause(analysis="auroc[social]", state=0).evaluate(rs).shape == (60,)
    d = Clause(analysis="auroc[social]", state="any").defined(rs)
    assert d.dtype == bool and d.all()


def test_value_and_unknown_and_adjusted(rs_gt):
    rs, _ = rs_gt
    c = Clause(analysis="information_content[position]", test="value", threshold=0.0)
    assert c.evaluate(rs).sum() > 0
    with pytest.raises(KeyError, match="available"):
        Clause(analysis="nope").evaluate(rs)
    with pytest.raises(ValueError):
        Clause(analysis="a", metric="m", target="t")
    with pytest.raises(ValueError):
        Clause(analysis="a", test="value")
    sh = rs["information_content[position]"].shuffle
    if getattr(sh, "p_adj", None) is None:
        with pytest.raises(ValueError, match="p_adj"):
            Clause(analysis="information_content[position]", adjusted=True).evaluate(rs)
    else:
        Clause(analysis="information_content[position]", adjusted=True).evaluate(rs)


def test_none_of_nested_exclusive(rs_gt):
    rs, _ = rs_gt
    info = Clause(analysis="information_content[position]")
    stab = Clause(analysis="split_half_stability[position]")
    only_info = Criteria(name="info_only", all_of=[info], none_of=[stab])
    mi, ms = info.evaluate(rs), stab.evaluate(rs)
    np.testing.assert_array_equal(only_info.evaluate(rs), mi & ~ms)
    outer = Criteria(name="outer", any_of=[only_info, Criteria(name="s", all_of=[stab])])
    np.testing.assert_array_equal(outer.evaluate(rs), mi | ms)
    cl = classify(rs, [Criteria(name="a", all_of=[info]), Criteria(name="b", all_of=[stab])])
    assert cl.table()["n_classes"].max() == 2
    ex = classify(
        rs, [Criteria(name="a", all_of=[info]), Criteria(name="b", all_of=[stab])], exclusive=True
    )
    np.testing.assert_array_equal(ex.labels["a"], mi)
    np.testing.assert_array_equal(ex.labels["b"], ms & ~mi)
    np.testing.assert_array_equal(ex.labels["unclassified"], ~(mi | ms))
    assert sum(ex.counts().values()) == 60 and ex.table()["n_classes"].max() == 1
    lab = cl.label_per_cell()
    assert set(lab) <= {"a", "b", "multiple", "unclassified"}
    assert abs(sum(ex.fractions().values()) - 1) < 1e-9
    with pytest.raises(ValueError):
        Criteria(name="empty")


def test_roundtrip(tmp_path):
    c = Criteria(
        name="x",
        all_of=[Clause(analysis="a", state="any", test="percentile", percentile=97.5)],
        none_of=[Criteria(name="y", any_of=[Clause(metric="m", target="t", alpha=0.01)])],
    )
    assert Criteria.from_dict(c.to_dict()) == c
    assert Criteria.from_yaml(c.to_yaml()) == c
    p = tmp_path / "c.yaml"
    c.to_yaml(p)
    assert Criteria.from_yaml(p) == c
    assert Criteria.from_yaml(str(p)) == c


def test_overlap_and_plot(rs_gt):
    rs, _ = rs_gt
    cl = classify(
        rs,
        {
            "info": Criteria(name="i", all_of=[Clause(analysis="information_content[position]")]),
            "stab": place_cell_criteria(require_stability=False),
        },
    )
    res = overlap_vs_chance(cl.labels["info"], cl.labels["stab"])
    assert res.n_both == int((cl.labels["info"] & cl.labels["stab"]).sum())
    assert len(overlap_matrix(cl.labels)) == 1
    fig = plot_classification(classify(rs, [place_cell_criteria()], exclusive=True))
    assert fig is not None


def test_cohort_fractions(rs_gt):
    rs, _ = rs_gt
    cl = classify(rs, [place_cell_criteria()], exclusive=True)
    tab = classification_table({"s1": cl, "s2": cl}, {"s1": "A", "s2": "B"})
    assert set(tab.columns) == {"session", "animal", "cell", "class", "member"}
    fr = fraction_classified_by_animal(tab)
    assert set(fr["animal"]) == {"A", "B"} and (fr["n_cells"] == 60).all()
    pc = fr[(fr["animal"] == "A") & (fr["class"] == "place_cell")].iloc[0]
    assert pc["fraction"] == pytest.approx(cl.fractions()["place_cell"])
    with pytest.raises(KeyError):
        classification_table({"s1": cl}, {})


def test_exclusive_rejects_reserved_unclassified_name(rs_gt):
    rs, _ = rs_gt
    info = Clause(analysis="information_content[position]")
    crit = [Criteria(name="unclassified", all_of=[info])]
    with pytest.raises(ValueError, match="unclassified"):
        classify(rs, crit, exclusive=True)
    classify(rs, crit, exclusive=False)  # fine when not exclusive


def test_named_criteria_with_two_nulls(sim_session):
    pipe = Pipeline(
        analyses=[
            AnalysisSpec(
                metric={"name": "auroc"},
                states="social",
                shuffle=ShuffleConfig(n_shuffles=20, seed=0),
            ),
            AnalysisSpec(
                metric={"name": "auroc"},
                states="social",
                shuffle=ShuffleConfig(n_shuffles=20, seed=0, null={"name": "bout_shuffle"}),
            ),
        ]
    )
    _, rs = pipe.run(sim_session, progress=False)
    names = [r.name for r in rs]
    assert len(set(names)) == 2
    with pytest.raises(KeyError, match="ambiguous"):
        responsive_cell_criteria(rs, "social")
    nm = "auroc[social]#bout_shuffle"
    assert nm in names
    crit = responsive_cell_criteria(rs, "social", name=nm)
    assert crit
    for c in crit.values():
        assert all(cl.analysis == nm and cl.metric is None for cl in c.all_of)
        assert c.evaluate(rs).shape[0] == 60
    pc = place_cell_criteria(information_name="a", stability_name="b")
    assert [cl.analysis for cl in pc.all_of] == ["a", "b"]
