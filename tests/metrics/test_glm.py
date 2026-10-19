import time

import numpy as np
import pytest

import cabana
from cabana import AnalysisSpec, Pipeline
from cabana._design import DesignMatrix, design_columns, raised_cosine_basis
from cabana._metrics import _glm
from cabana._metrics._glm import GLMEncoding
from cabana._models import Session, StateSpace

FS = 10.0


def _grid_session(n=200):
    t = np.arange(n) / FS
    oh = np.zeros((n, 2), bool)
    oh[10:20, 0] = True
    oh[50:80, 1] = True
    st = StateSpace(
        name="beh", onehot=oh, state_names=["rest", "run"], kind="categorical", exclusive=True
    )
    speed = np.linspace(0, 10, n)
    speed[5] = np.nan
    return Session(
        activity=np.zeros((1, n)), t=t, fs=FS, states={"beh": st}, signals={"speed": speed}
    )


def test_design_columns_names_and_order():
    sess = _grid_session()
    out = DesignMatrix(states=["beh"], signals=["speed"], reference="none").apply(sess)
    X = out.signals["design"]
    assert X.shape == (200, 3) and X.dtype == np.float64
    assert design_columns(out) == ["beh:rest", "beh:run", "speed"]
    assert out.meta["design_columns"]["design"] == ["beh:rest", "beh:run", "speed"]
    np.testing.assert_array_equal(X[:, 1], sess.states["beh"].onehot[:, 1].astype(float))
    ok = np.isfinite(sess.signals["speed"])
    assert X[5, 2] == 0.0 and np.all(np.isfinite(X))
    sp = sess.signals["speed"][ok]
    np.testing.assert_allclose(X[ok, 2], (sp - sp.mean()) / sp.std())
    # drop_rest
    out2 = DesignMatrix(states=["beh"], drop_rest=True, output="d2").apply(out)
    assert design_columns(out2, "d2") == ["beh:run"]
    assert design_columns(out2, "design") == ["beh:rest", "beh:run", "speed"]
    with pytest.raises(KeyError):
        DesignMatrix(states=["nope"]).apply(sess)


def test_exclusive_reference_dropped_and_recorded():
    n = 90
    lab = np.repeat([0, 1, 2], 30)
    oh = np.eye(3, dtype=bool)[lab]
    st = StateSpace(
        name="b", onehot=oh, state_names=["a", "b", "c"], kind="categorical", exclusive=True
    )
    sess = Session(activity=np.zeros((1, n)), t=np.arange(n) / FS, fs=FS, states={"b": st})
    out = DesignMatrix(states=["b"]).apply(sess)
    assert design_columns(out) == ["b:a", "b:b"]
    assert out.meta["design_reference"]["design"] == {"b": "c"}
    assert design_columns(DesignMatrix(states=["b"], reference="none").apply(sess)) == [
        "b:a",
        "b:b",
        "b:c",
    ]
    # 'rest' is preferred
    st2 = StateSpace(
        name="b", onehot=oh, state_names=["a", "rest", "c"], kind="categorical", exclusive=True
    )
    out2 = DesignMatrix(states=["b"]).apply(sess.replace(states={"b": st2}))
    assert design_columns(out2) == ["b:a", "b:c"]
    assert out2.meta["design_reference"]["design"] == {"b": "rest"}
    # drop_rest counts as the reference
    out3 = DesignMatrix(states=["b"], drop_rest=True).apply(sess.replace(states={"b": st2}))
    assert design_columns(out3) == ["b:a", "b:c"]
    # non-exclusive spaces keep all columns
    stb = StateSpace(
        name="b", onehot=oh, state_names=["a", "b", "c"], kind="bouts", exclusive=False
    )
    outb = DesignMatrix(states=["b"]).apply(sess.replace(states={"b": stb}))
    assert design_columns(outb) == ["b:a", "b:b", "b:c"]
    assert outb.meta["design_reference"]["design"] == {}


def test_glm_unique_contribution_exclusive_state_not_zero():
    rng = np.random.default_rng(11)
    n = 3000
    lab = np.repeat(rng.integers(0, 3, n // 50 + 1), 50)[:n]
    oh = np.eye(3, dtype=bool)[lab]
    st = StateSpace(
        name="b", onehot=oh, state_names=["a", "b", "c"], kind="categorical", exclusive=True
    )
    sess = Session(activity=np.zeros((1, n)), t=np.arange(n) / FS, fs=FS, states={"b": st})
    Y = rng.poisson(np.exp(-1.0 + 1.5 * oh[:, 0]))[None].astype(float)
    for ref, expect_positive in (("auto", True), ("none", False)):
        out = DesignMatrix(states=["b"], reference=ref).apply(sess)
        m = GLMEncoding(
            family="poisson", regressor_names=design_columns(out), min_frames=50, alpha=1e-3
        )
        v = m.compute(Y, out.signals["design"], np.ones(n, bool), FS)
        if expect_positive:
            assert v[0, 0] > 0.05  # state "a" has a clear unique contribution
        else:
            assert np.all(np.abs(v) < 0.01)  # collinear with intercept: the old behavior


def test_basis_shape_and_onset_convolution():
    basis, lags = raised_cosine_basis(4, 0.5, 1.5, FS)
    assert basis.shape == (21, 4) and lags.shape == (21,)
    assert lags[0] == pytest.approx(-0.5) and lags[-1] == pytest.approx(1.5)
    assert basis.min() >= 0 and basis.max() <= 1
    n = 100
    oh = np.zeros((n, 1), bool)
    oh[40, 0] = True
    st = StateSpace(name="s", onehot=oh, state_names=["a"], kind="bouts", exclusive=False)
    sess = Session(activity=np.zeros((1, n)), t=np.arange(n) / FS, fs=FS, states={"s": st})
    out = DesignMatrix(states=["s"], basis={"n_basis": 4, "pre_s": 0.5, "post_s": 1.5}).apply(sess)
    assert design_columns(out) == [f"s:a@{k}" for k in range(4)]
    X = out.signals["design"]
    np.testing.assert_allclose(X[40 - 5 : 40 + 16], basis, atol=1e-12)
    assert np.all(X[:35] == 0) and np.all(X[56:] == 0)


def test_gaussian_matches_direct_solve():
    rng = np.random.default_rng(0)
    n, d, c = 500, 4, 3
    X = rng.normal(size=(n, d))
    Y = (X @ rng.normal(size=(d, c)) + 0.3 * rng.normal(size=(n, c)) + 1.0).T
    alpha = 1e-3
    x1 = _glm._add_intercept(X)
    W = _glm._fit(x1, Y.T, "gaussian", alpha, 50, 1e-6)
    P = np.diag([0] + [alpha] * d)
    ref = np.linalg.solve(x1.T @ x1 + P, x1.T @ Y.T)
    np.testing.assert_allclose(W, ref, rtol=0, atol=1e-8)
    ex = GLMEncoding(family="gaussian", alpha=alpha, min_frames=10).extras(
        Y, X, np.ones(n, bool), FS
    )
    np.testing.assert_allclose(ex["weights"].T, ref, atol=1e-8)


def _poisson_data(n=2000, d=5, seed=1, n_cells=20):
    rng = np.random.default_rng(seed)
    X = rng.normal(size=(n, d))
    W = rng.normal(scale=0.5, size=(d, n_cells))
    b = np.full(n_cells, -0.5)
    Y = rng.poisson(np.exp(X @ W + b)).astype(float)
    return X, Y.T, W, b


def test_poisson_recovers_weights():
    X, Y, W, b = _poisson_data()
    w = _glm._fit(_glm._add_intercept(X), Y.T, "poisson", 1e-3, 50, 1e-8)
    est = w[1:].ravel()
    assert np.corrcoef(est, W.ravel())[0, 1] > 0.95
    np.testing.assert_allclose(est, W.ravel(), atol=0.25)


def test_unique_contribution_and_deviance_explained():
    n, d = 3000, 4
    rng = np.random.default_rng(2)
    X = rng.normal(size=(n, d))
    rate = np.exp(-1.0 + 1.2 * X[:, 0])  # cell 0 driven by x0 only
    Y = np.stack([rng.poisson(rate), rng.poisson(np.full(n, np.exp(-0.5)))]).astype(float)
    m = GLMEncoding(family="poisson", regressor_names=["a", "b", "c", "d"], min_frames=50)
    mask = np.ones(n, bool)
    v = m.compute(Y, X, mask, FS)
    assert v.shape == (2, 4)
    assert v[0, 0] > 0.2 and np.all(np.abs(v[0, 1:]) < 0.02)
    assert np.all(np.abs(v[1]) < 0.02)  # untuned cell
    ex = m.extras(Y, X, mask, FS)
    de = ex["deviance_explained"]
    assert de[0] > 0.3 and de[0] <= 1 and de[1] < 0.02
    assert list(ex["group_names"]) == ["a", "b", "c", "d"]
    assert ex["weights"].shape == (2, d + 1)
    assert ex["weights"][0, 1] == pytest.approx(1.2, abs=0.15)
    # too few frames -> NaN
    assert np.all(np.isnan(GLMEncoding(min_frames=10**6).compute(Y, X, mask, FS)))
    # auto picks gaussian for negative data
    assert m.model_copy(update={"family": "auto"})._prepare(-Y, X, mask)[-1] == "gaussian"
    assert m.model_copy(update={"family": "auto"})._prepare(Y, X, mask)[-1] == "poisson"


def test_contiguous_folds_and_masking():
    seen = []
    orig = _glm._null_deviance

    def spy(family, y_tr, y_te):
        seen.append(y_te[:, 0].copy())
        return orig(family, y_tr, y_te)

    n = 400
    t_idx = np.arange(n, dtype=float)
    Y = t_idx[None, :] + 1.0  # activity encodes the frame index
    X = np.random.default_rng(0).normal(size=(n, 2))
    mask = np.ones(n, bool)
    mask[100:150] = False
    _glm._null_deviance = spy
    try:
        GLMEncoding(family="gaussian", n_folds=4, min_frames=10).compute(Y, X, mask, FS)
    finally:
        _glm._null_deviance = orig
    assert len(seen) == 4
    for blk in seen:
        frames = blk - 1
        valid = frames[(frames < 100) | (frames >= 150)]
        assert valid.size == blk.size
        # contiguous in masked-frame order: consecutive up to the masked gap
        steps = np.diff(frames)
        assert np.all((steps == 1) | (steps == 51))
    allf = np.sort(np.concatenate(seen)) - 1
    assert allf.size == 350 and np.unique(allf).size == 350


def test_basis_kernels_extras():
    n = 3000
    rng = np.random.default_rng(3)
    oh = np.zeros((n, 1), bool)
    for s in rng.choice(n - 40, 40, replace=False):
        oh[s : s + 5, 0] = True
    st = StateSpace(name="s", onehot=oh, state_names=["a"], kind="bouts", exclusive=False)
    sess = Session(activity=np.zeros((1, n)), t=np.arange(n) / FS, fs=FS, states={"s": st})
    basis = {"n_basis": 4, "pre_s": 0.0, "post_s": 2.0}
    out = DesignMatrix(states=["s"], basis=basis).apply(sess)
    X = out.signals["design"]
    b, _ = raised_cosine_basis(4, 0.0, 2.0, FS)
    true_k = np.array([0.0, 1.0, 0.5, 0.0]) @ b.T
    rate = np.exp(-1.5 + X @ np.array([0.0, 1.0, 0.5, 0.0]))
    Y = rng.poisson(rate)[None].astype(float)
    m = GLMEncoding(
        family="poisson", regressor_names=design_columns(out), basis=basis, min_frames=50, alpha=0.1
    )
    ex = m.extras(Y, X, np.ones(n, bool), FS)
    assert ex["kernels"].shape == (1, 1, b.shape[0])
    assert np.corrcoef(ex["kernels"][0, 0], true_k)[0, 1] > 0.8
    assert m.compute(Y, X, np.ones(n, bool), FS).shape == (1, 1)


def test_performance_target():
    rng = np.random.default_rng(4)
    n, d, c = 2400, 20, 200
    X = rng.normal(size=(n, d))
    W = np.zeros((d, c))
    W[:3] = rng.normal(scale=0.6, size=(3, c))
    Y = rng.poisson(np.exp(X @ W - 0.5)).T.astype(float)
    # 4 state groups x 4 basis columns + 4 single-column signals = 8 groups
    names = [f"g{i // 4}:s@{i % 4}" if i < 16 else f"sig{i}" for i in range(d)]
    m = GLMEncoding(regressor_names=names)
    t0 = time.perf_counter()
    v = m.compute(Y, X, np.ones(n, bool), FS)
    dt = time.perf_counter() - t0
    print(f"glm 200 cells x 2400 x 20 cols, {v.shape[1]} groups: {dt:.2f}s")
    assert v.shape == (c, 8)
    assert dt < 30  # target ~10 s; generous bound for slow CI


def test_end_to_end_pipeline():
    sess = cabana.simulate_session(duration_s=600, n_cells=40)
    transforms = [
        {"name": "resample_signal", "source": "position"},
        {"name": "speed", "signals": ["x", "y"]},
        {"name": "bouts_to_states", "source": "social", "add_rest": False},
        {"name": "design_matrix", "states": ["social"], "signals": ["speed"]},
    ]
    pre = Pipeline(transforms=transforms, preprocess=[{"name": "rebin_time", "bin_s": 0.5}])
    prepared, _ = pre.run(sess)
    names = design_columns(prepared)
    assert names[-1] == "speed" and all(n.startswith("social:") for n in names[:-1])
    pipe = Pipeline(
        analyses=[
            AnalysisSpec(
                metric={"name": "glm_encoding", "regressor_names": names},
                signal="design",
                masks=["social_scored"],
            )
        ]
    )
    t0 = time.perf_counter()
    _, res = pipe.run(prepared)
    print(f"end-to-end glm: {time.perf_counter() - t0:.2f}s")
    r = res.get("glm_encoding", "design")
    gnames = list(r.extras["group_names"])
    assert gnames == names
    gt = sess.meta["ground_truth"]["social_cells"]
    hits = 0
    for info in gt:
        top = gnames[int(np.nanargmax(r.values[info["cell"]]))]
        hits += top == f"social:{info['behavior']}"
    print(f"social cells with own behavior on top: {hits}/{len(gt)}")
    assert hits / len(gt) > 0.5
    untuned = sess.meta["ground_truth"]["untuned_cells"]
    assert np.nanmedian(r.values[untuned]) < 0.02


def _prep(behaviors):
    sess = cabana.simulate_session(duration_s=200, n_cells=5)
    tr = [
        {"name": "bouts_to_states", "source": "social", "add_rest": False, "behaviors": behaviors},
        {"name": "design_matrix", "states": ["social"], "reference": "none"},
    ]
    return Pipeline(transforms=tr).run(sess)[0]


def test_pipeline_configure_does_not_leak_across_sessions():
    s_all = _prep(None)
    names = list(dict.fromkeys(n.split(":")[1] for n in design_columns(s_all)))
    assert len(names) >= 3
    s_two = _prep(names[:2])
    spec = AnalysisSpec(metric={"name": "glm_encoding", "min_frames": 50}, signal="design")
    pipe = Pipeline(analyses=[spec])
    _, r_two = pipe.run(s_two)
    _, r_all = pipe.run(s_all)
    g_two = list(r_two.get("glm_encoding", "design").extras["group_names"])
    g_all = list(r_all.get("glm_encoding", "design").extras["group_names"])
    assert g_two == [f"social:{n}" for n in names[:2]]
    assert g_all == design_columns(s_all) and len(g_all) > len(g_two)
    assert spec.metric.regressor_names is None  # spec is not mutated


def test_configure_overwrites_stale_names():
    s = _prep(None)
    m = GLMEncoding(regressor_names=["stale"], basis={"n_basis": 2, "pre_s": 0.0, "post_s": 1.0})
    m.configure(s, "design")
    assert m.regressor_names == design_columns(s) and m.basis is None
    m2 = GLMEncoding(regressor_names=["mine"])
    m2.configure(s, "other_target")  # no metadata: user value kept
    assert m2.regressor_names == ["mine"]


def test_groups_column_with_basis_skips_kernels():
    n = 1500
    rng = np.random.default_rng(3)
    oh = np.zeros((n, 1), bool)
    for s in rng.choice(n - 40, 20, replace=False):
        oh[s : s + 5, 0] = True
    st = StateSpace(name="s", onehot=oh, state_names=["a"], kind="bouts", exclusive=False)
    sess = Session(activity=np.zeros((1, n)), t=np.arange(n) / FS, fs=FS, states={"s": st})
    basis = {"n_basis": 3, "pre_s": 0.0, "post_s": 1.0}
    out = DesignMatrix(states=["s"], basis=basis).apply(sess)
    Y = rng.poisson(1.0, size=(1, n)).astype(float)
    m = GLMEncoding(
        family="poisson",
        groups="column",
        regressor_names=design_columns(out),
        basis=basis,
        min_frames=50,
    )
    ex = m.extras(Y, out.signals["design"], np.ones(n, bool), FS)
    assert "kernels" not in ex and "weights" in ex
