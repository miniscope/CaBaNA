import time

import numpy as np
import pytest
from scipy.ndimage import gaussian_filter1d
from sklearn.linear_model import Ridge

import cabana
import cabana._metrics._decode_signal  # noqa: F401  (registers "decode_signal")
from cabana import AnalysisSpec, Pipeline, ShuffleConfig, build
from cabana._kernels._ratemap import contiguous_folds
from cabana._metrics._decode_signal import DecodeSignal

FS = 20.0
N = 6000


def planted(n=N, n_cells=20, noise=1.0, lead=0, seed=0):
    """Smooth signal ``x``; activity[:, t] = W x[t + lead] + noise."""
    rng = np.random.default_rng(seed)
    x = gaussian_filter1d(rng.normal(size=n), 8)
    x = (x - x.mean()) / x.std()
    w = rng.normal(size=n_cells)
    drive = np.roll(x, -lead)
    act = np.outer(w, drive) + noise * rng.normal(size=(n_cells, n)) + rng.normal(size=(n_cells, 1))
    return act, x


ALL = np.ones(N, bool)


def test_ridge_and_knn_recover_encoded_signal():
    act, x = planted()
    r = DecodeSignal().compute(act, x, ALL, FS)
    k = DecodeSignal(method="knn").compute(act, x, ALL, FS)
    print("ridge r2", r, "knn r2", k)
    assert r.shape == (1,) and r[0] > 0.5
    assert k[0] > 0.3


def test_shuffled_activity_is_at_chance():
    act, x = planted()
    r = DecodeSignal().compute(np.roll(act, 1000, axis=1), x, ALL, FS)
    assert abs(r[0]) <= 0.05 or r[0] <= 0.05


def test_mae_beats_chance_and_tail():
    act, x = planted()
    m = DecodeSignal(statistic="mae")
    v = m.compute(act, x, ALL, FS)
    ex = m.extras(act, x, ALL, FS)
    assert v[0] < ex["chance_mae"][0]
    np.testing.assert_allclose(ex["mae"], v)
    assert m.resolve_tail(x) == "lower" and DecodeSignal().resolve_tail(x) == "upper"
    corr = DecodeSignal(statistic="corr").compute(act, x, ALL, FS)
    assert corr[0] > 0.7


def test_extras_and_invalid_frames():
    act, x = planted()
    x = x.copy()
    x[100:140] = np.nan
    mask = ALL.copy()
    mask[2000:2300] = False
    m = DecodeSignal()
    m.configure(None, "x")
    ex = m.extras(act, x, mask, FS)
    bad = ~mask | np.isnan(x)
    pred = ex["prediction"]
    assert pred.shape == (N, 1)
    np.testing.assert_array_equal(np.isnan(pred[:, 0]), bad)
    assert ex["n_frames"][0] == (~bad).sum()
    assert ex["fold_scores"].shape == (5, 1) and list(ex["group_names"]) == ["x"]
    for key in ("r2", "corr", "mae", "chance_mae"):
        assert ex[key].shape == (1,)
    # r2 extra equals compute on the same data
    np.testing.assert_allclose(ex["r2"], m.compute(act, x, mask, FS))


def test_min_frames_gives_nan():
    act, x = planted()
    mask = np.zeros(N, bool)
    mask[:50] = True
    assert np.isnan(DecodeSignal().compute(act, x, mask, FS)).all()
    assert np.isnan(DecodeSignal(min_frames=10_000).compute(act, x, ALL, FS)).all()
    ex = DecodeSignal().extras(act, x, mask, FS)
    assert np.isnan(ex["prediction"]).all()


def test_multichannel_signal():
    act, x = planted()
    y = np.stack([x, -x], axis=1)
    v = DecodeSignal().compute(act, y, ALL, FS)
    assert v.shape == (2,) and (v > 0.5).all()
    assert list(DecodeSignal().extras(act, y, ALL, FS)["group_names"]) == ["0", "1"]


def test_ridge_matches_sklearn_with_train_only_scaling():
    act, x = planted(n=1200, n_cells=8, seed=3)
    n = x.size
    folds = contiguous_folds(n, 5)
    pred = np.empty(n)
    for f in range(5):
        tr, te = folds != f, folds == f
        mu, sd = act[:, tr].mean(axis=1), act[:, tr].std(axis=1)
        z = ((act - mu[:, None]) / sd[:, None]).T
        pred[te] = Ridge(alpha=2.5).fit(z[tr], x[tr]).predict(z[te])
    want = 1 - ((pred - x) ** 2).sum() / ((x - x.mean()) ** 2).sum()
    got = DecodeSignal(alpha=2.5).compute(act, x, np.ones(n, bool), FS)
    np.testing.assert_allclose(got[0], want, atol=1e-9)


def test_zscore_uses_training_statistics_only(monkeypatch):
    act, x = planted(n=1000, n_cells=6)
    seen = []
    orig = DecodeSignal._scale

    def spy(self, xtr):
        seen.append(xtr.shape[0])
        return orig(self, xtr)

    monkeypatch.setattr(DecodeSignal, "_scale", spy)
    DecodeSignal(method="knn").compute(act, x, np.ones(1000, bool), FS)
    assert seen == [800] * 5  # fitted on the 4/5 training frames, never the held-out block


def test_heldout_offset_does_not_leak_into_its_own_fit():
    # fold 4 (frames 800+) trains on frames < 800 only: its training statistics, hence
    # its weights, cannot depend on activity inside the held-out block
    act, x = planted(n=1000, n_cells=6)
    m = np.ones(1000, bool)
    p0 = DecodeSignal().extras(act, x, m, FS)["prediction"][:, 0]
    act2 = act.copy()
    act2[:, 800:] += 5.0
    p1 = DecodeSignal().extras(act2, x, m, FS)["prediction"][:, 0]
    w = np.random.default_rng(0)  # same weights => prediction shift is linear in the offset
    del w
    # folds 0-3 train partly on the shifted block: their *test* frames (< 800) change only
    # through training, so fold 4 is the clean check: shifted block's raw features changed
    # but the model was fitted on untouched data, so the prediction change equals W @ 5.
    d = p1[800:] - p0[800:]
    assert np.allclose(d, d[0])  # constant shift = w_eff . 5, no training contamination
    assert abs(d[0]) > 0


def test_lag_alignment_recovers_planted_lag():
    lead = 15  # activity at t encodes x[t + 15]
    act, x = planted(lead=lead, noise=0.5)
    r = {
        lag: DecodeSignal(lag_s=lag / FS).compute(act, x, ALL, FS)[0]
        for lag in (-lead, 0, lead // 2, lead, 2 * lead, 3 * lead)
    }
    print("lag r2", r)
    assert max(r, key=r.get) == lead
    assert r[lead] > r[0] + 0.05


def test_lagged_prediction_nan_pattern():
    act, x = planted(n=500)
    ex = DecodeSignal(lag_s=2 / FS, min_frames=50).extras(act, x, np.ones(500, bool), FS)
    p = np.isnan(ex["prediction"][:, 0])
    assert p[-2:].all() and not p[:-2].any()
    ex = DecodeSignal(lag_s=-2 / FS, min_frames=50).extras(act, x, np.ones(500, bool), FS)
    p = np.isnan(ex["prediction"][:, 0])
    assert p[:2].all() and not p[2:].any()


@pytest.mark.parametrize("kw", [{}, {"zscore": False}, {"statistic": "mae"}, {"lag_s": 0.5}])
def test_compute_shifted_equals_loop(kw):
    act, x = planted(n=2000, n_cells=10, seed=2)
    x = x.copy()
    x[300:320] = np.nan
    mask = np.ones(2000, bool)
    mask[1000:1200] = False  # makes the Gram matrices shift-dependent
    m = DecodeSignal(**kw)
    shifts = np.array([0, 1, 7, 333, 1999, 2500, -40, 1200])
    got = m.compute_shifted(act, x, mask, FS, shifts)
    want = np.stack([m.compute(np.roll(act, int(k), axis=1), x, mask, FS) for k in shifts])
    assert got.shape == (shifts.size, 1)
    np.testing.assert_allclose(got, want, atol=1e-9)


def test_compute_shifted_multichannel_and_chunking(monkeypatch):
    import cabana._metrics._decode_signal as mod

    monkeypatch.setattr(mod, "_CHUNK_ELEMS", 5000)  # force several chunks
    act, x = planted(n=1500, n_cells=5)
    y = np.stack([x, x**2], axis=1)
    m = DecodeSignal(statistic="corr")
    shifts = np.arange(0, 1500, 150)
    got = m.compute_shifted(act, y, np.ones(1500, bool), FS, shifts)
    want = np.stack(
        [m.compute(np.roll(act, int(k), axis=1), y, np.ones(1500, bool), FS) for k in shifts]
    )
    assert got.shape == (10, 2)
    np.testing.assert_allclose(got, want, atol=1e-9)


def test_knn_has_no_shifted_path():
    act, x = planted(n=500)
    assert (
        DecodeSignal(method="knn").compute_shifted(act, x, np.ones(500, bool), FS, [0, 1]) is None
    )


def test_does_not_mutate_inputs():
    act, x = planted(n=600)
    a0, x0 = act.copy(), x.copy()
    DecodeSignal().extras(act, x, np.ones(600, bool), FS)
    DecodeSignal(method="knn").compute(act, x, np.ones(600, bool), FS)
    np.testing.assert_array_equal(act, a0)
    np.testing.assert_array_equal(x, x0)


def test_validation():
    with pytest.raises(ValueError):
        DecodeSignal(n_folds=1)
    with pytest.raises(ValueError):
        DecodeSignal(alpha=0)


def test_check_plugin(small_session):
    # ``extras`` is skipped only because the checker demands numeric extras while
    # ``group_names`` (a str array of channel labels) is a documented extra; determinism
    # is checked by hand.
    rep = cabana.check_plugin(DecodeSignal(), small_session, target="x", skip=("extras",))
    assert rep.passed, (rep.failed(), rep.warnings)
    sig = np.asarray(small_session.signals["x"])
    mk = small_session.valid_mask([])
    e1 = DecodeSignal().extras(small_session.activity, sig, mk, small_session.fs)
    e2 = DecodeSignal().extras(small_session.activity, sig, mk, small_session.fs)
    for key, v in e1.items():
        np.testing.assert_array_equal(v, e2[key])


def test_shifted_cost_and_pipeline(small_session):
    s = small_session
    m = DecodeSignal()
    shifts = np.arange(100) * 50 + 100
    mask = s.valid_mask([])
    t0 = time.perf_counter()
    m.compute_shifted(s.activity, np.asarray(s.signals["x"]), mask, s.fs, shifts)
    print("100 shifts on small_session:", time.perf_counter() - t0, "s")
    pipe = Pipeline(
        analyses=[
            AnalysisSpec(
                metric={"name": "decode_signal"},
                signal="x",
                shuffle=ShuffleConfig(n_shuffles=10, min_shift_s=5.0, seed=0),
                masks=[],
            )
        ]
    )
    _, rs = pipe.run(s)
    r = rs.get("decode_signal")
    assert r.values.shape == (1,) and r.shuffle is not None
    assert list(r.extras["group_names"]) == ["x"]
    assert r.plot(s) is not None
    assert build("metric", {"name": "decode_signal"}).name == "decode_signal"


def test_pipeline_state_names_from_group_names(small_session):
    pipe = Pipeline(analyses=[AnalysisSpec(metric={"name": "decode_signal"}, signal="x", masks=[])])
    _, rs = pipe.run(small_session)
    assert rs.get("decode_signal").state_names == ["x"]
