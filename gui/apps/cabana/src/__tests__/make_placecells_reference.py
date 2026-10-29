"""Writes placecells_reference.json: inputs and outputs of the framework's place-cell
functions that placecells.ts reproduces. Run with the python of a framework-demo checkout:

    <checkout>/.venv/bin/python make_placecells_reference.py
"""

import json
from pathlib import Path

import numpy as np

from cabana._metrics._fields import PlaceFields
from cabana._metrics._information import InformationContent
from cabana._metrics._stability import SplitHalfStability
from cabana._models import Session
from cabana._selectors import heldout_smoothing_scores
from cabana._selectors_null import _rows_taus, autocorrelation_time, state_autocorrelation_time
from cabana._statesums import state_labels
from cabana._transform._core import BinGrid

rng = np.random.default_rng(3)
n, fs, cells = 3000, 10.0, 14
t = np.arange(n) / fs
pos = np.empty((n, 2))
pos[0] = 50
for i in range(1, n):  # random walk reflected at the arena walls
    p = pos[i - 1] + rng.normal(scale=3, size=2)
    pos[i] = np.where(p < 0, -p, np.where(p > 100, 200 - p, p))
act = np.zeros((cells, n))
for c in range(cells):
    if c < 8:  # place cells with a Gaussian field
        cx, cy = rng.uniform(15, 85, 2)
        rate = np.exp(-((pos[:, 0] - cx) ** 2 + (pos[:, 1] - cy) ** 2) / (2 * 12**2))
        act[c] = rng.poisson(0.05 + 0.6 * rate) * rng.uniform(0.5, 1.5, n)
    elif c < 13:  # untuned
        act[c] = rng.poisson(0.2, n) * rng.uniform(0.5, 1.5, n)
act[13] = 0  # silent cell
session = Session(activity=act, t=t, fs=fs, activity_kind="deconvolved")
session = session.with_signal("x", pos[:, 0]).with_signal("y", pos[:, 1])
session = BinGrid(signals=["x", "y"], bin_size=10.0, extent=[(0, 100), (0, 100)]).apply(session)
states = session.states["position"]
mask = rng.random(n) > 0.25
mask[:200] = False
labels = state_labels(states, mask)
shape = list(states.topology.shape)

sigma = 1.5
shifts = rng.choice(np.arange(60, n - 60), size=12, replace=False)
metrics = {
    "information": InformationContent(smooth_sigma_bins=sigma),
    "stability": SplitHalfStability(smooth_sigma_bins=sigma),
    "fields": PlaceFields(smooth_sigma_bins=sigma),
}
ref = {
    "fs": fs,
    "shape": shape,
    "sigma": sigma,
    "neural": act.reshape(-1).tolist(),
    "cells": cells,
    "frames": n,
    "labels": labels.tolist(),
    "shifts": shifts.tolist(),
}
nn = lambda a: [None if np.isnan(v) else float(v) for v in np.asarray(a, float)]
for name, m in metrics.items():
    ref[name] = {
        "observed": nn(m.compute(act, states, mask, fs)),
        "shifted": [nn(r) for r in m.compute_shifted(act, states, mask, fs, shifts)],
    }
ex = metrics["fields"].extras(act, states, mask, fs)
ref["fields"]["rate_map"] = [nn(r) for r in ex["rate_map"]]
ref["fields"]["labels"] = ex["field_labels"].tolist()
ref["fields"]["n_fields"] = nn(ex["n_fields"])

cands = [0.0, 0.5, 1.0, 2.0, 3.0]
mean, se = heldout_smoothing_scores(session, "position", cands, mask=mask)
ref["sigma_scores"] = {"candidates": cands, "mean": mean.tolist(), "se": se.tolist()}

used = mask & states.support if states.support is not None else mask
ref["acf"] = {
    "cell_taus": nn(_rows_taus(act, np.broadcast_to(used, act.shape), fs, 60.0)),
    "state_tau": state_autocorrelation_time(states.onehot, fs, used, 60.0),
    "position_x_tau": autocorrelation_time(pos[:, 0], fs, mask=used, max_lag_s=60.0),
    "used": used.tolist(),
}
Path(__file__).with_name("placecells_reference.json").write_text(json.dumps(ref))
print("shape", shape, "frames used", int((labels >= 0).sum()))
