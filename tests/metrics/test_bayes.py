import numpy as np
import pytest

import cabana
from cabana import build
from cabana._metrics._bayes import BayesianDecoder
from cabana._models import StateSpace
from cabana._pipeline import AnalysisSpec, Pipeline
from cabana._shuffle import ShuffleConfig, shuffle_test


def categorical(lab, n_states, exclusive=True):
    oh = np.zeros((len(lab), n_states), bool)
    oh[np.arange(len(lab)), lab] = True
    return StateSpace(
        name="s",
        onehot=oh,
        state_names=[f"s{i}" for i in range(n_states)],
        kind="categorical",
        exclusive=exclusive,
    )


@pytest.fixture(scope="module")
def sim():
    s = cabana.simulate_session(duration_s=600, n_cells=100)
    for t in [
        {"name": "resample_signal", "source": "position"},
        {"name": "speed"},
        {"name": "bin_grid", "signals": ["x", "y"], "bin_size": 50.0, "output": "position"},
    ]:
        s = build("transform", t).apply(s)
    s = build("preprocess", {"name": "speed_threshold", "min_speed": 20.0}).apply(s)
    return s, s.states["position"], s.masks["speed"]


def test_registry():
    assert isinstance(build("metric", {"name": "bayesian_decoder", "n_folds": 3}), BayesianDecoder)


def test_toy_categorical_perfect():
    rng = np.random.default_rng(0)
    n = 1200
    lab = (np.arange(n) // 20) % 3
    act = np.zeros((18, n))
    for s in range(3):
        act[6 * s : 6 * s + 6, lab == s] = rng.random((6, (lab == s).sum())) + 0.5
    st = categorical(lab, 3)
    m = BayesianDecoder(window_s=0.0)  # a window would blur the state boundaries
    mask = np.ones(n, bool)
    v = m.compute(act, st, mask, 10.0)
    np.testing.assert_allclose(v, 1.0)
    ex = m.extras(act, st, mask, 10.0)
    assert ex["accuracy_overall"][0] == 1.0
    conf = ex["confusion"]
    assert np.count_nonzero(conf - np.diag(np.diag(conf))) == 0
    assert np.isnan(ex["error_overall"][0]) and np.isnan(ex["error"]).all()
    assert m.resolve_tail(st) == "upper"


@pytest.mark.parametrize(
    "kw",
    [
        {"smooth_sigma_bins": 1.0},
        {"likelihood": "poisson", "smooth_sigma_bins": 1.0},
        {"likelihood": "empirical", "n_levels": 2, "binning": "binary"},
        {"likelihood": "empirical", "smooth_sigma_bins": 1.0, "pseudocount": 0.1},
    ],
)
def test_simulated_beats_chance(sim, kw):
    s, st, mask = sim
    m = BayesianDecoder(**kw)
    v = m.compute(s.activity, st, mask, s.fs)
    assert v.shape == (st.n_states,)
    ex = m.extras(s.activity, st, mask, s.fs)
    assert ex["error_overall"][0] < 0.8 * ex["chance_error"][0], (kw, ex["error_overall"])
    assert m.resolve_tail(st) == "lower"
    assert ex["decoded"].shape == (s.n_time,) and (ex["decoded"][~mask] == -1).all()
    assert 0 < ex["posterior_mean_confidence"][0] <= 1


def test_default_empirical_runs(sim):
    s, st, mask = sim
    v = BayesianDecoder(likelihood="empirical").compute(s.activity, st, mask, s.fs)
    assert np.isfinite(v).any()


def test_rolled_activity_near_chance(sim):
    s, st, mask = sim
    m = BayesianDecoder(smooth_sigma_bins=1.0)
    ex = m.extras(np.roll(s.activity, s.n_time // 2, axis=1), st, mask, s.fs)
    assert ex["error_overall"][0] > 0.8 * ex["chance_error"][0]


def test_label_shuffle_tail_lower(sim):
    s, st, mask = sim
    cfg = ShuffleConfig(n_shuffles=5, null={"name": "label_shuffle"})
    res = shuffle_test(BayesianDecoder(), s.activity, st, mask, cfg, s.fs)
    assert res.tail == "lower"


def test_min_frames_drops_state():
    rng = np.random.default_rng(1)
    n = 800
    lab = (np.arange(n) // 25) % 3
    lab[:5] = 3
    act = rng.random((6, n))
    st = categorical(lab, 4)
    m = BayesianDecoder(min_frames_per_class=20)
    mask = np.ones(n, bool)
    v = m.compute(act, st, mask, 10.0)
    assert np.isnan(v[3]) and np.isfinite(v[:3]).all()
    ex = m.extras(act, st, mask, 10.0)
    assert np.isnan(ex["confusion"][3]).all()
    assert (ex["decoded"][lab == 3] == -1).all()


def test_errors():
    n = 200
    oh = np.zeros((n, 2), bool)
    oh[:, 0] = True
    oh[:50, 1] = True
    st = StateSpace(name="s", onehot=oh, state_names=["a", "b"], kind="bouts", exclusive=False)
    with pytest.raises(ValueError, match="exclusive"):
        BayesianDecoder().compute(np.ones((2, n)), st, np.ones(n, bool), 10.0)
    st2 = categorical((np.arange(n) // 20) % 2, 2)
    with pytest.raises(ValueError, match="GridTopology"):
        BayesianDecoder(smooth_sigma_bins=1.0).compute(np.ones((2, n)), st2, np.ones(n, bool), 10.0)


def test_window_and_binarize(sim):
    s, st, mask = sim
    for kw in (
        {"window_s": 0.0},
        {"window_s": 0.25},
        {"likelihood": "poisson", "binarize": False},
        {"prior": "uniform"},
    ):
        v = BayesianDecoder(**kw).compute(s.activity, st, mask, s.fs)
        assert np.isfinite(v).any(), kw


def test_pipeline_roundtrip(sim):
    pytest.importorskip("yaml")
    s, st, mask = sim
    pipe = Pipeline(
        analyses=[
            AnalysisSpec(
                metric={"name": "bayesian_decoder", "smooth_sigma_bins": 1.0},
                states="position",
                masks=["speed"],
                shuffle=ShuffleConfig(n_shuffles=3, null={"name": "label_shuffle"}),
            )
        ]
    )
    _, res = pipe.run(s)
    assert len(res.to_dataframe()) == st.n_states
    assert Pipeline.from_yaml(pipe.to_yaml()).to_dict() == pipe.to_dict()


@pytest.mark.parametrize("lik", ["gaussian", "poisson"])
def test_masked_frames_do_not_influence(sim, lik):
    s, st, mask = sim
    m = BayesianDecoder(likelihood=lik, smooth_sigma_bins=1.0)
    a = m.extras(s.activity, st, mask, s.fs)
    act = s.activity.copy()
    act[:, ~mask] = np.random.default_rng(3).random((act.shape[0], int((~mask).sum()))) * 1e3
    b = m.extras(act, st, mask, s.fs)
    np.testing.assert_array_equal(a["decoded"], b["decoded"])
    np.testing.assert_array_equal(a["error"], b["error"])


def test_gaussian_expansion_matches_logpdf():
    from scipy.stats import norm

    rng = np.random.default_rng(0)
    n_cells, n_states, n_tr = 5, 4, 400
    lab = (np.arange(n_tr) // 10) % n_states
    oh = np.eye(n_states)[lab]
    xtr = (rng.random((n_cells, n_tr)) < 0.1 + 0.2 * rng.random((n_cells, 1)) * (lab % 2)).astype(
        float
    )
    s_te = rng.random((6, n_cells))
    m = BayesianDecoder(n_trial_blocks=5)
    ll = m._loglik_gaussian(xtr, oh, s_te, None)
    # recompute mu / sigma independently following the documented rule
    blocks = (np.arange(n_tr) * 5) // n_tr
    rates = np.stack(
        [xtr[:, blocks == b] @ oh[blocks == b] / oh[blocks == b].sum(axis=0) for b in range(5)]
    )
    mu, sd = rates.mean(axis=0), rates.std(axis=0)
    sigma = np.maximum(sd, sd.mean(axis=1, keepdims=True))
    ref = np.zeros_like(ll)
    for t in range(6):
        for st_ in range(n_states):
            ref[t, st_] = norm.logpdf(s_te[t], mu[:, st_], sigma[:, st_]).sum()
    np.testing.assert_allclose(ll - ll[:, :1], ref - ref[:, :1], atol=1e-8)


def test_empirical_fit_uses_training_frames_only(sim):
    s, st, mask = sim
    m = BayesianDecoder(likelihood="empirical")
    train = np.zeros(s.n_time, bool)
    train[: s.n_time // 2] = True
    e1, lp1 = m._fit_empirical(s.activity, st, train & mask)
    act = s.activity.copy()
    act[:, s.n_time // 2 :] = np.random.default_rng(0).random((act.shape[0], s.n_time // 2)) * 50
    e2, lp2 = m._fit_empirical(act, st, train & mask)
    np.testing.assert_array_equal(e1, e2)
    np.testing.assert_array_equal(lp1, lp2)


@pytest.mark.parametrize("kw", [{"likelihood": "poisson"}, {"likelihood": "empirical"}])
def test_rolled_activity_near_chance_other_likelihoods(sim, kw):
    s, st, mask = sim
    ex = BayesianDecoder(smooth_sigma_bins=1.0, **kw).extras(
        np.roll(s.activity, s.n_time // 2, axis=1), st, mask, s.fs
    )
    assert ex["error_overall"][0] > 0.8 * ex["chance_error"][0]


def test_pooled_sigma_on_unbalanced_social_states(sim):
    s, _, _ = sim
    s = build(
        "transform",
        {
            "name": "bouts_to_states",
            "source": "social",
            "output": "social_exclusive",
            "exclusive": True,
            "add_rest": True,
        },
    ).apply(s)
    st, mask = s.states["social_exclusive"], s.masks["social_exclusive_scored"]
    acc = {
        kw: BayesianDecoder(sigma=kw).extras(s.activity, st, mask, s.fs)["accuracy_overall"][0]
        for kw in ("per_state", "pooled")
    }
    assert acc["per_state"] < 0.15 and acc["pooled"] > 0.3, acc
    assert BayesianDecoder().sigma == "per_state"
