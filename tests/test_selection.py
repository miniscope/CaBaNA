import numpy as np
import pytest
from pydantic import ValidationError

from cabana import ResultSet, Selection, Session, StateSpace
from cabana._pipeline import Pipeline


def make_session(n=200, fs=10.0):
    rng = np.random.default_rng(1)
    lab = np.repeat([0, 1, 2, 0], n // 4)
    onehot = np.eye(3, dtype=bool)[lab]
    act = rng.random((4, n))
    sp = StateSpace(
        name="cat", onehot=onehot, state_names=["a", "b", "c"], kind="categorical", exclusive=True
    )
    return Session(
        activity=act,
        t=np.arange(n) / fs,
        fs=fs,
        cell_ids=["c0", "c1", "c2", "c3"],
        states={"cat": sp},
    )


def make_pipe(masks=("m",)):
    return Pipeline(
        transforms=[
            {"name": "speed", "signals": ["x"], "window_s": 0.25, "output": "spd"},
            {"name": "speed", "signals": ["x"], "window_s": 0.5, "output": "spd2"},
        ],
        preprocess=[{"name": "speed_threshold", "min_speed": 2.0, "signal": "spd"}],
        analyses=[
            {
                "name": "a1",
                "metric": {"name": "auroc", "min_frames": 20},
                "states": "cat",
                "shuffle": {"n_shuffles": 5, "seed": 1, "min_shift_s": 1.0},
                "masks": list(masks) if masks else None,
            },
            {"name": "a2", "metric": {"name": "mean_per_state", "min_frames": 20}, "states": "cat"},
        ],
    )


def test_get_param_forms():
    p = make_pipe()
    assert p.get_param("transforms.spd.window_s") == 0.25
    assert p.get_param("transforms.1.window_s") == 0.5
    assert p.get_param("transforms.spd2.window_s") == 0.5
    assert p.get_param("transforms.*.window_s") == [0.25, 0.5]
    assert p.get_param("preprocess.speed_threshold.min_speed") == 2.0
    assert p.get_param("preprocess.0.min_speed") == 2.0
    assert p.get_param("analyses.a1.metric.min_frames") == 20
    assert p.get_param("analyses.1.metric.min_frames") == 20
    assert p.get_param("analyses.*.metric.min_frames") == [20, 20]
    assert p.get_param("analyses.a1.shuffle.n_shuffles") == 5
    assert p.get_param("analyses.*.shuffle.n_shuffles") == [5]  # only a1 has a shuffle
    assert p.get_param("analyses.a1.masks") == ["m"]
    assert p.get_param("analyses.*.masks") == [["m"], None]


def test_resolved_names():
    p = make_pipe()
    assert p.resolved_names() == ["a1", "a2"]
    q = Pipeline(
        analyses=[
            {"metric": {"name": "auroc"}, "states": "cat"},
            {"metric": {"name": "auroc"}, "states": "cat", "shuffle": {"n_shuffles": 5}},
        ]
    )
    assert q.resolved_names() == ["auroc[cat]", "auroc[cat]#circular_shift"]


@pytest.mark.parametrize(
    "path, exc",
    [
        ("transforms.spd", ValueError),
        ("bogus.0.x", ValueError),
        ("transforms.spd.nope", ValueError),
        ("transforms.nope.window_s", KeyError),
        ("transforms.7.window_s", KeyError),
        ("analyses.a1.metric.nope", ValueError),
        ("analyses.zzz.metric.min_frames", KeyError),
        ("analyses.a2.shuffle.n_shuffles", ValueError),  # a2 has no shuffle
        ("analyses.*.metric.nope", ValueError),  # no element has the field
        ("analyses.a1.metric.min_frames.extra", ValueError),
    ],
)
def test_invalid_paths(path, exc):
    with pytest.raises(exc):
        make_pipe().get_param(path)


def test_set_param_pure_and_all_forms():
    p = make_pipe()
    q = p.set_param("transforms.spd.window_s", 0.75)
    assert (
        p.get_param("transforms.spd.window_s") == 0.25
        and q.get_param("transforms.0.window_s") == 0.75
    )
    assert q.get_param("transforms.spd2.window_s") == 0.5
    q = p.set_param("analyses.*.metric.min_frames", 30)
    assert q.get_param("analyses.*.metric.min_frames") == [30, 30]
    assert p.get_param("analyses.*.metric.min_frames") == [20, 20]
    q = p.set_param("analyses.a1.shuffle.n_shuffles", 9).set_param("analyses.a2.masks", ["m"])
    assert q.get_param("analyses.a1.shuffle.n_shuffles") == 9
    assert q.get_param("analyses.a2.masks") == ["m"]
    q = p.set_param("preprocess.speed_threshold.min_speed", 5.0)
    assert q.preprocess[0].min_speed == 5.0 and p.preprocess[0].min_speed == 2.0
    assert q.selections == []


def test_set_param_revalidates():
    p = make_pipe()
    with pytest.raises(ValidationError):
        p.set_param("preprocess.0.min_speed", -1.0)
    with pytest.raises(ValidationError):
        p.set_param("analyses.a1.metric.min_frames", 0)
    with pytest.raises(ValidationError):
        p.set_param("analyses.a1.shuffle.n_shuffles", 0)
    with pytest.raises(ValueError):
        p.set_param("analyses.a1.states", None)  # spec needs exactly one target


def test_set_param_selection_recording():
    p = make_pipe()
    q = p.set_param(
        "analyses.a1.metric.min_frames", 25, method="user_pick", criterion="split_half_r", note="x"
    )
    assert len(q.selections) == 1 and p.selections == []
    s = q.selections[0]
    assert s.path == "analyses.a1.metric.min_frames" and s.value == 25 and s.method == "user_pick"
    sel = Selection(path="transforms.spd.window_s", value=0.5, method="fixed_apriori")
    r = q.set_param("transforms.spd.window_s", 0.5, selection=sel)
    assert [x.method for x in r.selections] == ["user_pick", "fixed_apriori"]
    with pytest.raises(ValueError):
        q.set_param(
            "transforms.spd.window_s", 0.5, selection=Selection(path="x.y.z", method="user_pick")
        )
    with pytest.raises(ValueError):
        q.set_param("transforms.spd.window_s", 0.5, selection=sel, method="user_pick")


def test_numpy_coercion():
    s = Selection(
        path="a.b.c",
        value=np.float64(1.5),
        method="auto_cv",
        candidates=np.array([0.0, 1.0, 2.0]),
        scores=[np.float32(1.0), np.float64(2.0)],
    )
    assert type(s.value) is float and s.candidates == [0.0, 1.0, 2.0]
    assert all(type(c) is float for c in s.candidates)
    assert type(Selection(path="a.b.c", value=np.int64(3), method="auto_cv").value) is int
    s.model_dump_json()


def test_selections_survive_roundtrip():
    p = make_pipe().set_param(
        "analyses.a1.metric.min_frames",
        np.int64(25),
        method="auto_cv",
        criterion="heldout_poisson_loglik",
        candidates=[10, 25, 40],
        scores=[-1.0, -0.5, -0.7],
        informed_by_significance=False,
    )
    q = Pipeline.from_dict(p.to_dict())
    assert q.selections == p.selections
    y = Pipeline.from_yaml(p.to_yaml())
    assert y.selections == p.selections and y.selections[0].candidates == [10, 25, 40]
    assert "selections" not in make_pipe().to_dict()


def test_provenance_selections_and_resultset_dedupe():
    p = (
        make_pipe(masks=None)
        .set_param("transforms.spd.window_s", 0.5, method="fixed_apriori")
        .set_param("analyses.a1.metric.min_frames", 25, method="user_pick")
        .set_param("analyses.*.metric.min_frames", 25, method="user_pick", note="all")
    )
    p = p.model_copy(update={"transforms": [], "preprocess": []})
    _, rs = p.run(make_session())
    paths1 = [s["path"] for s in rs["a1"].provenance["selections"]]
    paths2 = [s["path"] for s in rs["a2"].provenance["selections"]]
    assert paths1 == [
        "transforms.spd.window_s",
        "analyses.a1.metric.min_frames",
        "analyses.*.metric.min_frames",
    ]
    assert paths2 == ["transforms.spd.window_s", "analyses.*.metric.min_frames"]
    sels = rs.selections
    assert len(sels) == 3  # shared records appear once
    assert [s["method"] for s in sels] == ["fixed_apriori", "user_pick", "user_pick"]
    assert isinstance(ResultSet().selections, list)
