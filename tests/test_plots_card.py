import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt  # noqa: E402
import warnings  # noqa: E402
import pytest  # noqa: E402
from matplotlib.figure import Figure  # noqa: E402

import cabana  # noqa: E402
from cabana._plot_data import check_plot_data  # noqa: E402
from cabana._plots_card import plot_cell_card, plot_cell_card_data, plot_cell_cards  # noqa: E402

# alpha=0.1: with 15 shuffles the smallest one-tailed p is 1/16 = 0.0625, so the default
# alpha of 0.05 can never be reached.
_SH = {"n_shuffles": 15, "min_shift_s": 10.0, "seed": 0, "alpha": 0.1}


def _specs(shuffle=_SH):
    def spec(metric, states):
        d = {"metric": {"name": metric}, "states": states}
        if shuffle is not None:
            d["shuffle"] = shuffle
        return d

    return [
        spec("information_content", "position"),
        spec("split_half_stability", "position"),
        spec("auroc", "social"),
        spec("mean_per_state", "syllables"),
        spec("peth", "social"),
        spec("mutual_information", "syllables"),
    ]


@pytest.fixture(scope="module")
def run(small_session):
    return cabana.Pipeline(analyses=_specs()).run(small_session)


@pytest.fixture(scope="module")
def session(run):
    return run[0]


@pytest.fixture(scope="module")
def rs(run):
    return run[1]


@pytest.fixture(scope="module")
def sig_cell(session, rs):
    """A cell significant in at least one analysis."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        cards = plot_cell_cards(session, rs, "significant", max_cards=1)
    (cid,) = cards
    plt.close("all")
    return cid


def test_data_contract_and_panel_kinds(session, rs, sig_cell):
    d = plot_cell_card_data(session, rs, sig_cell, max_analyses=6)
    check_plot_data(d, "cell_card")
    assert d["cell_id"] == sig_cell
    assert d["n_analyses_total"] == 6
    kinds = {p["analysis"]: p["kind"] for p in d["panels"]}
    assert kinds == {
        "information_content[position]": "rate_map",
        "split_half_stability[position]": "split_half",
        "auroc[social]": "state_bars",
        "mean_per_state[syllables]": "state_bars",
        "peth[social]": "peth",
        "mutual_information[syllables]": "joint_histogram",
    }
    assert len(d["nulls"]) == len(d["panels"])
    for p, n in zip(d["panels"], d["nulls"], strict=True):
        assert n is not None and n["kind"] == "shuffle_distribution"
        assert {"analysis", "p", "p_adj", "significant", "value", "rank", "n_cells"} <= set(p)
        assert 1 <= p["rank"] <= p["n_cells"]
    assert set(d["trace"]) >= {"t", "activity", "ribbon", "excluded"}
    assert d["trace"]["t"].shape == d["trace"]["activity"].shape == d["trace"]["excluded"].shape
    assert len(d["trace"]["ribbon"]) == 2
    assert d["header"]["cell_id"] == sig_cell and d["header"]["n_events"] is not None
    assert len(d["table"]) == 6


def test_significant_first(session, rs, sig_cell):
    d = plot_cell_card_data(session, rs, sig_cell)
    flags = [p["significant"] for p in d["panels"]]
    assert any(flags)
    assert flags == sorted(flags, reverse=True)
    ps = [p["p"] for p in d["panels"] if p["significant"]]
    assert ps == sorted(ps)


def test_cell_id_and_index_agree(session, rs, sig_cell):
    idx = list(session.cell_ids).index(sig_cell)
    a = plot_cell_card_data(session, rs, sig_cell)
    b = plot_cell_card_data(session, rs, idx)
    assert a["cell_index"] == b["cell_index"] == idx
    assert [p["analysis"] for p in a["panels"]] == [p["analysis"] for p in b["panels"]]
    assert [p["value"] for p in a["panels"]] == [p["value"] for p in b["panels"]]
    with pytest.raises(KeyError):
        plot_cell_card_data(session, rs, "nope")
    with pytest.raises(IndexError):
        plot_cell_card_data(session, rs, 999)


def test_max_analyses_truncates(session, rs):
    d = plot_cell_card_data(session, rs, 0, max_analyses=2)
    assert len(d["panels"]) == 2
    assert d["n_analyses_total"] == 6
    assert len(d["table"]) == 6
    assert sum(r["shown"] for r in d["table"]) == 2


def test_axes_count_three_analyses(session, rs):
    fig = plot_cell_card(session, rs, 0, max_analyses=3)
    try:
        assert isinstance(fig, Figure)
        assert len(fig.axes) == 3 + 2 * 3  # header, trace, 3 x (evidence + null), table
    finally:
        plt.close(fig)


def test_no_shuffle_results_render(small_session):
    s, rs0 = cabana.Pipeline(analyses=_specs(shuffle=None)).run(small_session)
    d = plot_cell_card_data(s, rs0, 3)
    check_plot_data(d, "cell_card")
    assert all(n is None for n in d["nulls"])
    assert all(p["null_text"] for p in d["panels"])
    assert all(not p["significant"] for p in d["panels"])
    fig = plot_cell_card(s, rs0, 3)
    plt.close(fig)


def test_dropped_null_renders_text(small_session):
    sh = {**_SH, "keep_null": "none"}
    s, rs1 = cabana.Pipeline(analyses=_specs(sh)[:2]).run(small_session)
    d = plot_cell_card_data(s, rs1, 0)
    assert all(n is None for n in d["nulls"])
    assert "null draws not kept" in d["panels"][0]["null_text"]
    plt.close(plot_cell_card(s, rs1, 0))


def test_correction_shows_adjusted_p(small_session):
    sh = {**_SH, "correction": "bh"}
    s, rs2 = cabana.Pipeline(analyses=_specs(sh)[:1]).run(small_session)
    d = plot_cell_card_data(s, rs2, 0)
    assert "adj" in d["panels"][0]["p_text"]
    assert d["panels"][0]["p_adj"] >= d["panels"][0]["p"]
    plt.close(plot_cell_card(s, rs2, 0))


def test_plot_cell_cards_significant_and_cap(session, rs):
    with pytest.warns(UserWarning, match="max_cards"):
        cards = plot_cell_cards(session, rs, "significant", max_cards=2)
    try:
        assert len(cards) == 2
        assert all(isinstance(f, Figure) for f in cards.values())
    finally:
        plt.close("all")
    cards = plot_cell_cards(session, rs, "significant", max_cards=100)
    try:
        n_sig = len(cards)
        assert 2 <= n_sig <= session.n_cells
    finally:
        plt.close("all")
    top = plot_cell_cards(session, rs, 3)
    assert list(top) == list(cards)[:3]
    ids = [session.cell_ids[1], 4]
    some = plot_cell_cards(session, rs, ids)
    assert list(some) == [session.cell_ids[1], session.cell_ids[4]]
    plt.close("all")


def test_plot_cell_cards_writes_files(session, rs, tmp_path):
    out = plot_cell_cards(session, rs, [0, "cell_002"], out_dir=tmp_path, dpi=40)
    assert set(out) == {session.cell_ids[0], "cell_002"}
    for cid, path in out.items():
        assert path.name == f"{cid}.png" and path.exists() and path.stat().st_size > 0
    assert not plt.get_fignums()
