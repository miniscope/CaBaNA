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

Path(__file__).with_name("decoding_reference.json").write_text(json.dumps(ref))
print("written", {k: (len(v) if hasattr(v, "__len__") else v) for k, v in ref.items() if k in ("shuffle", "position")})
