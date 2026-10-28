"""Writes decoding_reference.json: inputs and outputs of the framework's `bayesian_decoder`
(Gaussian per-state and pooled sigma, Poisson, a categorical target), `Session.rebin`,
`BoutsToStates` (exclusive, add_rest) and the `label_shuffle` null, which decoding.ts reproduces.
Run next to a framework-demo checkout (commit 57c0c4b):

    uv run --no-project --python 3.12 --with <checkout> python make_decoding_reference.py

The data are synthetic: 20 Hz, a 5 x 4 arena with place-tuned cells (a silent cell, a cell with
NaN, cells with many ties), frames outside the speed mask, a bin visited too rarely to be
decoded, and a categorical target with unequal state sizes.
"""

import json
from pathlib import Path

import numpy as np

from cabana._metrics._bayes import BayesianDecoder
from cabana._models import BoutTable, GridTopology, Session, StateSpace
from cabana._nulls import LabelShuffle
from cabana._transform._core import BoutsToStates

rng = np.random.default_rng(3)
fs, n, cells = 20.0, 3000, 14
ny, nx = 4, 5
n_states = ny * nx

# ---- position: a random walk over the arena, and the bin of every frame -----------------------
pos = np.zeros((n, 2))
pos[0] = [nx / 2, ny / 2]
for t in range(1, n):
    pos[t] = np.clip(pos[t - 1] + rng.normal(0, 0.12, 2), 0.01, [nx - 0.01, ny - 0.01])
lab = (pos[:, 1].astype(int)) * nx + pos[:, 0].astype(int)
lab[1200:1203] = 19  # a bin visited for 3 frames only: dropped as too rare
lab[1203:1210] = np.where(lab[1203:1210] == 19, 18, lab[1203:1210])
tracked = np.ones(n, bool)
tracked[400:440] = False  # lost tracking: no state
lab_state = np.where(tracked, lab, -1)
onehot = np.zeros((n, n_states), bool)
onehot[np.flatnonzero(tracked), lab[tracked]] = True
mask = np.ones(n, bool)
mask[900:1000] = False  # speed mask: valid labels, not used
mask[2200:2230] = False

# ---- neural: place-tuned events -----------------------------------------------------------------
centers = rng.uniform([0, 0], [nx, ny], (cells, 2))
d2 = ((pos[None] - centers[:, None]) ** 2).sum(axis=2)
p_event = 0.03 + 0.35 * np.exp(-d2 / (2 * 0.6**2))
act = (rng.random((cells, n)) < p_event) * rng.gamma(2.0, 1.0, (cells, n))
act[0] = 0.0  # silent cell
act[1] = np.where(rng.random(n) < 0.97, 0.0, 1.0)  # very sparse, binary
act[2, 100:104] = np.nan
act = act.astype(np.float64)

topology = GridTopology(
    shape=(ny, nx),
    edges=[np.arange(ny + 1, dtype=float), np.arange(nx + 1, dtype=float)],
    axis_names=["y", "x"],
)
grid = StateSpace(
    name="position",
    onehot=onehot,
    state_names=[str(i) for i in range(n_states)],
    kind="grid",
    exclusive=True,
    topology=topology,
)

# ---- a categorical target: 4 unequal states, exclusive -------------------------------------------
cat = np.full(n, -1)
t = 0
sizes = {0: (80, 200), 1: (40, 120), 2: (20, 60), 3: (10, 25)}
while t < n:
    k = int(rng.choice([0, 0, 1, 1, 2, 3]))
    d = int(rng.integers(*sizes[k]))
    cat[t : t + d] = k
    t += d + int(rng.integers(0, 40)) * int(rng.random() < 0.3)
cat[2500:2560] = -1
cat_oh = np.zeros((n, 4), bool)
cat_oh[np.flatnonzero(cat >= 0), cat[cat >= 0]] = True
beh = StateSpace(
    name="beh", onehot=cat_oh, state_names=list("ABCD"), kind="bouts", exclusive=True
)
cat_act = act.copy()
for c in range(3, 11):  # state-tuned cells
    s = c % 4
    cat_act[c] = np.where(cat == s, rng.gamma(2.0, 1.0, n) * (rng.random(n) < 0.5), cat_act[c] * 0.3)
cat_act[2] = np.nan_to_num(cat_act[2])

CONFIGS = {
    "gauss_per_state": dict(likelihood="gaussian", sigma="per_state", window_s=0.25),
    "gauss_pooled_smooth": dict(
        likelihood="gaussian", sigma="pooled", window_s=1.0, smooth_sigma_bins=1.0
    ),
    "poisson_smooth": dict(likelihood="poisson", window_s=0.5, smooth_sigma_bins=1.0),
    "gauss_uniform_prior": dict(
        likelihood="gaussian", sigma="per_state", window_s=0.0, prior="uniform", n_folds=4
    ),
}


def nn(a):
    """JSON-safe list: NaN becomes null."""
    a = np.asarray(a, dtype=float)
    return np.where(np.isfinite(a), a, None).tolist()


def run(dec, activity, states, m):
    out = dec._run(activity, states, m, fs)
    ex = dec.extras(activity, states, m, fs)
    return {
        "values": nn(out.values),
        "confusion": nn(out.confusion),
        "decoded": out.decoded.tolist(),
        "error": nn(out.error),
        "n_frames": out.n_frames.tolist(),
        "error_overall": nn(ex["error_overall"]),
        "accuracy_overall": nn(ex["accuracy_overall"]),
        "chance_error": nn(ex["chance_error"]),
        "posterior_mean_confidence": nn(ex["posterior_mean_confidence"]),
    }


ref = {
    "fs": fs,
    "frames": n,
    "cells": cells,
    "shape": [ny, nx],
    "neural": nn(act),
    "labels": lab_state.tolist(),
    "mask": mask.astype(int).tolist(),
    "cat_neural": nn(cat_act),
    "cat_labels": cat.tolist(),
    "position": {},
}
for name, kw in CONFIGS.items():
    ref["position"][name] = {"params": kw, **run(BayesianDecoder(**kw), act, grid, mask)}
ref["categorical"] = {
    "params": dict(likelihood="gaussian", sigma="pooled", window_s=0.25),
    **run(BayesianDecoder(likelihood="gaussian", sigma="pooled", window_s=0.25), cat_act, beh, None
          if False else np.ones(n, bool)),
}
ref["categorical_poisson"] = {
    "params": dict(likelihood="poisson", window_s=0.25),
    **run(BayesianDecoder(likelihood="poisson", window_s=0.25), cat_act, beh, np.ones(n, bool)),
}

# ---- label shuffle: the block order is drawn the way LabelShuffle draws it ----------------------
block_s, seed = 0.5, 5
block = max(1, int(round(block_s * fs)))
idx = np.flatnonzero(mask)
order = np.random.default_rng(seed).permutation(int(np.ceil(idx.size / block)))
_, shuffled = LabelShuffle(block_s=block_s).surrogate(act, grid, mask, fs, np.random.default_rng(seed))
shuf_lab = shuffled.labels()
dec = BayesianDecoder(**CONFIGS["gauss_per_state"])
ref["shuffle"] = {
    "block_s": block_s,
    "order": order.tolist(),
    "labels": shuf_lab.tolist(),
    "decode": run(dec, act, shuffled, mask),
}

# ---- rebin ---------------------------------------------------------------------------------------
t_s = np.arange(n) / fs
sess = Session(
    activity=np.nan_to_num(act),
    t=t_s,
    fs=fs,
    activity_kind="deconvolved",
    states={"position": grid, "beh": beh},
    masks={"speed": mask},
)
reb = sess.rebin(0.5)
k = 10
ref["rebin"] = {
    "k": k,
    "neural": nn(reb.activity),
    "position": reb.states["position"].labels().tolist(),
    "beh": reb.states["beh"].labels().tolist(),
    "mask": reb.masks["speed"].astype(int).tolist(),
}

# ---- exclusive labels with priority and "other" -------------------------------------------------
ts = np.arange(600) / fs
bt = BoutTable(
    labels=["a", "b", "a", "c", "b", "c"],
    start_s=np.array([1.0, 2.0, 8.0, 9.0, 14.0, 20.0]),
    stop_s=np.array([5.0, 4.0, 12.0, 11.0, 18.0, 28.0]),
    scored_start_s=0.0,
    scored_stop_s=25.0,
)
s0 = Session(activity=np.zeros((2, 600)), t=ts, fs=fs, behavior={"bt": bt})
bts = {}
for name, order_, rest in [("order_abc_rest", ["a", "b", "c"], True), ("order_cba", ["c", "b", "a"], False)]:
    out = BoutsToStates(source="bt", behaviors=order_, exclusive=True, add_rest=rest, output="e").apply(s0)
    bts[name] = {
        "behaviors": order_,
        "rest": rest,
        "labels": out.states["e"].labels().tolist(),
    }
ref["exclusive"] = {
    "frames": 600,
    "fs": fs,
    "epochs": [
        {"label": l, "start": float(a), "stop": float(b)}
        for l, a, b in zip(bt.labels, bt.start_s, bt.stop_s)
    ],
    "scored": [0.0, 25.0],
    "cases": bts,
}

# ---- p-values and max-stat correction across states for a fixed null ----------------------------
from cabana._shuffle import _max_stat_p, _p_values  # noqa: E402

nr = np.random.default_rng(9)
n_shuf, n_st = 60, 7
null = np.round(nr.normal(2.0, 0.6, (n_shuf, n_st)), 1)  # rounded, so ties occur
null[:, 5] = nr.normal(0.0, 5.0, n_shuf)  # a state with a much wider null
null[:12, 6] = np.nan  # a state undefined on some shuffles
obs = np.array([0.6, 1.2, 2.0, 2.4, 3.9, -7.0, 0.3])
tests = {}
for tail in ("lower", "upper"):
    p_raw = _p_values(obs, null, tail)
    p_adj = _max_stat_p(obs[None], null[:, None, :], tail, p_raw[None])[0]
    tests[tail] = {"p_raw": nn(p_raw), "p_adj": nn(p_adj)}
ref["pvalues"] = {"observed": nn(obs), "null": nn(null), "tails": tests}

# ---- linear decoder: logistic regression, one-vs-rest, on 0.5 s bins ---------------------------------
from sklearn.linear_model import LogisticRegression  # noqa: E402

from cabana._metrics._decode import DecodeStates  # noqa: E402
from cabana._metrics._ratemap import contiguous_folds  # noqa: E402

def linear_reference(activity, states):
    sess_c = Session(
        activity=np.nan_to_num(activity), t=t_s, fs=fs, activity_kind="deconvolved", states={"beh": states}
    ).rebin(0.5)
    st_c = sess_c.states["beh"]
    lab_c = st_c.labels()
    use_c = lab_c >= 0
    xb = sess_c.activity[:, use_c].T  # (frames, cells), the frames DecodeStates uses
    yb = lab_c[use_c]
    dec = DecodeStates(classifier="logistic", mode="one_vs_rest", n_folds=5)
    out_c = dec._run(sess_c.activity, st_c, np.ones(sess_c.n_time, bool))
    pred_by_state = {}
    for s_ in range(states.n_states):
        y1 = (yb == s_).astype(np.int64)
        if y1.sum() < 20 or (y1.size - y1.sum()) < 20:
            continue
        pred_by_state[s_] = dec._cv_predict(xb, y1).tolist()
    # the exact optimum of the first fold's training problem (tight tolerance), for weights
    folds_c = contiguous_folds(xb.shape[0], 5)
    tr0 = folds_c != 0
    y_s1 = (yb == 1).astype(np.int64)
    mu0, sd0 = xb[tr0].mean(axis=0), xb[tr0].std(axis=0)
    sd0 = np.where(sd0 > 1e-12, sd0, 1.0)
    fits = [
        LogisticRegression(C=C, class_weight="balanced", tol=1e-12, max_iter=200000).fit(
            (xb[tr0] - mu0) / sd0, y_s1[tr0]
        )
        for C in (1.0, 0.05)
    ]
    return {
        "frames": int(sess_c.n_time),
        "fs": float(sess_c.fs),
        "n_states": states.n_states,
        "neural": nn(sess_c.activity),
        "labels": lab_c.tolist(),
        "values": nn(out_c.values),
        "overall": float(out_c.overall),
        "confusion": nn(out_c.confusion),
        "n_frames": out_c.n_frames.tolist(),
        "predictions": {str(k): v for k, v in pred_by_state.items()},
        "fit": {
            "state": 1,
            "fold": 0,
            "C": [1.0, 0.05],
            "coef": [f.coef_[0].tolist() for f in fits],
            "intercept": [float(f.intercept_[0]) for f in fits],
        },
    }


ref["linear"] = linear_reference(cat_act, beh)
# a harder problem: the arena quadrant the animal is in, decoded from the place-tuned cells
quad = np.where(tracked, (lab // nx >= ny // 2) * 2 + (lab % nx >= nx // 2), -1)
quad_oh = np.zeros((n, 4), bool)
quad_oh[np.flatnonzero(tracked), quad[tracked]] = True
quad_ss = StateSpace(name="beh", onehot=quad_oh, state_names=list("abcd"), kind="categorical", exclusive=True)
ref["linear_hard"] = linear_reference(act, quad_ss)

Path(__file__).with_name("decoding_reference.json").write_text(json.dumps(ref))
print("written", {k: (len(v) if hasattr(v, "__len__") else v) for k, v in ref.items() if k in ("shuffle", "position")})
