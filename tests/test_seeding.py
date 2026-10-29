import numpy as np

from cabana import build
from cabana._nulls import draw_shifts
from cabana._pipeline import Pipeline, derive_seed
from cabana._shuffle import ShuffleConfig


def _spec(metric, target, **shuf):
    return {
        "metric": {"name": metric},
        "states": target,
        "shuffle": {"n_shuffles": 40, "min_shift_s": 5.0, **shuf},
    }


def _pipe(small_session, n=2, **shuf):
    sp = [
        _spec("information_content", "position", **shuf),
        _spec("mean_per_state", "social", **shuf),
    ]
    sp.append(_spec("mean_per_state", "syllables", **shuf))
    return Pipeline(analyses=sp[:n])


def _run(sess, pipe):
    _, rs = pipe.run(sess)
    return {r.name: r for r in rs}


def test_different_shifts_across_analyses(small_session):
    out = _run(small_session, _pipe(small_session, 2))
    a, b = (r.shuffle.shifts for r in out.values())
    assert not np.array_equal(a, b)


def test_repeatable_and_unrelated_addition(small_session):
    two = _run(small_session, _pipe(small_session, 2))
    two_b = _run(small_session, _pipe(small_session, 2))
    three = _run(small_session, _pipe(small_session, 3))
    for k in two:
        assert np.array_equal(two[k].shuffle.shifts, two_b[k].shuffle.shifts)
        assert np.array_equal(two[k].shuffle.shifts, three[k].shuffle.shifts)
        np.testing.assert_array_equal(two[k].shuffle.null, three[k].shuffle.null)


def test_derive_seeds_false_shares_stream(small_session):
    out = _run(small_session, _pipe(small_session, 2, derive_seeds=False))
    a, b = (r.shuffle.shifts for r in out.values())
    assert np.array_equal(a, b)
    p = next(iter(out.values())).provenance
    assert p["effective_seed"] == p["seed"] == 0


def test_derive_seed_formula_stable():
    assert derive_seed(0, "a") == derive_seed(0, "a")
    assert derive_seed(0, "a") != derive_seed(0, "b")
    assert derive_seed(0, "a") != derive_seed(1, "a")


def test_default_rng_bit_identical():
    for s in (0, 7, 123456789):
        a = np.random.default_rng(s).integers(0, 10**9, 50)
        b = np.random.default_rng(np.random.SeedSequence(s)).integers(0, 10**9, 50)
        assert np.array_equal(a, b)


def test_direct_shuffle_test_unchanged(small_session):
    from cabana._shuffle import shuffle_test

    m = build("metric", {"name": "mean_per_state"})
    st = small_session.states["social"]
    m.configure(small_session, "social")
    mask = small_session.valid_mask([])
    r = shuffle_test(
        m,
        small_session.activity,
        st,
        mask,
        ShuffleConfig(n_shuffles=20, min_shift_s=5.0, seed=3),
        small_session.fs,
    )
    expect = draw_shifts(
        small_session.n_time, 20, int(round(5.0 * small_session.fs)), np.random.default_rng(3)
    )
    assert np.array_equal(r.shifts, expect)


def test_provenance(small_session):
    pipe = Pipeline(
        preprocess=[{"name": "speed_threshold", "min_speed": 5.0}],
        analyses=[_spec("mean_per_state", "social")],
    )
    pipe.analyses[0].masks = ["speed"]
    s1, rs1 = pipe.run(small_session)
    _, rs2 = pipe.run(small_session)
    assert s1.meta["preprocess"][0]["name"] == "speed_threshold"
    r1, r2 = list(rs1)[0], list(rs2)[0]
    p = r1.provenance
    assert p["preprocess"] == s1.meta["preprocess"]
    mi = p["mask_info"]["speed"]
    assert mi["source"]["min_speed"] == 5.0 and 0 < mi["n_true"] <= mi["n_frames"]
    assert p["seed"] == 0 and isinstance(p["effective_seed"], int)
    assert p["env"]["numpy"] and "python" in p["env"] and "platform" in p["env"]
    for k in ("pipeline_sha256", "session_sha256"):
        assert len(p[k]) == 64 and p[k] == r2.provenance[k]
