"""Writes auroc_reference.json: inputs and outputs of the framework's auROC, circular-shift test
and max-stat correction that auroc.ts reproduces. Run with the python of a framework-demo checkout:

    <checkout>/.venv/bin/python make_auroc_reference.py

The data are synthetic (overlapping behaviors with planted effects, tied cells, four excluded
gaps, one cell with a NaN in the kept frames, one with a NaN only in an excluded gap, one behavior
too short to test). The test is run once with the mask and once with every frame kept.
"""

import json
from pathlib import Path

import numpy as np

from cabana._metrics._auroc import AUROC
from cabana._models import StateSpace
from cabana._nulls import CovariateMatchedShift
from cabana._selectors_null import _rows_taus, state_autocorrelation_time
from cabana._shuffle import ShuffleConfig, shuffle_test

rng = np.random.default_rng(5)
fs, n, cells, n_shuf = 20.0, 2400, 16, 200
names = ["Investigation", "Allogrooming", "Mounting", "Rare"]
onehot = np.zeros((n, 4), bool)
for s, (dur, gap) in enumerate([(40, 160), (60, 200), (30, 120)]):  # bouts, in frames
    t = int(rng.integers(0, gap))
    while t < n:
        onehot[t : t + dur, s] = True
        t += dur + int(rng.integers(gap // 2, gap * 3 // 2))
onehot[100:112, 3] = True  # 12 frames: below min_frames
act = rng.gamma(1.0, 1.0, (cells, n))
act[:3] += 1.5 * onehot[:, [0]].T  # excited by Investigation
act[3:6] -= 0.8 * onehot[:, [1]].T * (act[3:6] > 0.8)  # inhibited by Allogrooming
act[6] = rng.poisson(0.3, n)  # many ties (zeros)
act[10:12] = np.round(act[10:12], 1)
mask = np.ones(n, bool)
for a, b in [(0, 100), (700, 760), (1500, 1530), (2300, 2400)]:
    mask[a:b] = False
act[14, 900] = np.nan  # inside the mask
act[15, 720] = np.nan  # inside an excluded gap
ss = StateSpace(name="social", onehot=onehot, state_names=names, kind="bouts", exclusive=False)
metric = AUROC(min_frames=20)
nn = lambda a: [None if not np.isfinite(v) else float(v) for v in np.asarray(a, float).ravel()]

ref = {
    "fs": fs, "frames": n, "cells": cells, "states": 4, "n_shuffles": n_shuf,
    "neural": nn(act), "onehot": onehot.T.astype(int).tolist(),
}
for key, m in (("masked", mask), ("all", np.ones(n, bool))):
    cfg = ShuffleConfig(n_shuffles=n_shuf, min_shift_s=5.0, seed=0, correction="max_stat")
    r = shuffle_test(metric, act, ss, m, cfg, fs)
    ref[key] = {
        "mask": m.astype(int).tolist(),
        "shifts": r.shifts.tolist(),
        "observed": nn(r.observed),
        "null": nn(r.null),
        "p": nn(r.p_value),
        "p_adj": nn(r.p_adj),
        "n_in_state": metric.extras(act, ss, m, fs)["n_in_state"].tolist(),
    }

# speed-matched null: a smooth speed signal that is higher during Investigation
speed = np.convolve(rng.normal(size=n), np.ones(5) / 5, mode="same") + 0.35 * onehot[:, 0]
speed[300] = np.nan  # a missing value becomes the median
cov = np.where(np.isfinite(speed), speed, np.nanmedian(speed))
groups = [np.flatnonzero(onehot[:, b] & mask) for b in range(4)]
groups = [g for g in groups if g.size >= 50]
fixed = rng.integers(100, n - 100, 30)
ref["speed"] = {"speed": nn(speed), "n_groups": len(groups), "shifts": fixed.tolist()}
for stat, tol in (("ks", 0.3), ("mean", 0.8)):
    null = CovariateMatchedShift(min_shift_s=5.0, statistic=stat, tolerance=tol, max_tries=20)
    null._cov, null._groups = cov, groups
    order = np.random.default_rng(1).permutation(np.arange(100, n - 100 + 1))
    accepted = null.draw(n, fs, 30, np.random.default_rng(1))
    ref["speed"][stat] = {
        "tolerance": tol,
        "balance": nn(null._stat_matrix(cov, groups, fixed)),
        "order": order.tolist(),
        "accepted": accepted.tolist(),
        "stats": {k: float(v) for k, v in null._stats.items()},
    }
    print(stat, null._stats, "distinct", np.unique(accepted).size)

used = mask
ref["acf"] = {
    "cell_taus": nn(_rows_taus(act, np.broadcast_to(used, act.shape), fs, 60.0)),
    "behavior_tau": state_autocorrelation_time(onehot, fs, used, 60.0),
}
Path(__file__).with_name("auroc_reference.json").write_text(json.dumps(ref))
p = np.array(ref["masked"]["p"], float)
print("min p", np.nanmin(p), "NaN pairs", int(np.isnan(p).sum()), "sig adj", int((np.nan_to_num(np.array(ref["masked"]["p_adj"], float), nan=1) < 0.05).sum()))
