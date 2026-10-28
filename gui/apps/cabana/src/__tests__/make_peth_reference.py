"""Writes peth_reference.json: inputs and outputs of the framework's PETH metric, its
circular-shift test, curves and null band, and of scipy's Wilcoxon test, that peth.ts reproduces.
Run next to a framework-demo checkout (commit 57c0c4b):

    uv run --no-project --python 3.12 --with <checkout> python make_peth_reference.py

The data are synthetic (20 Hz, 4 non-exclusive behaviors): bouts too short, too close to the
previous bout, starting inside an excluded gap, at frame 0 and at the end of the session; one
behavior with too few onsets; planted rises and falls; a cell with many ties; a cell with a NaN
inside an onset window and one with a NaN outside every window.
"""

import json
from pathlib import Path

import numpy as np
from scipy.stats import wilcoxon

from cabana._metrics._events import PETH, bouts
from cabana._models import StateSpace
from cabana._nulls import draw_shifts
from cabana._shuffle import ShuffleConfig, shuffle_test
from cabana._util import runs

rng = np.random.default_rng(11)
fs, n, cells = 20.0, 3000, 16
names = ["Investigation", "Allogrooming", "Mounting", "Rare"]
onehot = np.zeros((n, 4), bool)


def plant(b, start, dur):
    """One bout of behavior b, clearing 25 frames around it so it stays a separate bout."""
    onehot[max(0, start - 25) : start + dur + 25, b] = False
    onehot[start : start + dur, b] = True


for b, (dur, gap) in enumerate([(50, 150), (45, 220), (60, 200)]):
    t = int(rng.integers(0, gap))
    while t < n - 120:
        d = int(rng.integers(dur // 2, dur * 2))  # some bouts shorter than 30 frames
        onehot[t : t + d, b] = True
        t += d + int(rng.integers(gap // 6, gap * 3 // 2))  # some gaps shorter than 20 frames
plant(0, 0, 50)  # starts at frame 0
plant(0, 2950, 45)  # window runs past the end
plant(1, 2960, 40)
plant(0, 510, 60)  # onsets inside excluded gaps
plant(1, 1230, 60)
plant(2, 1905, 60)
plant(2, 2610, 60)
for b, k in ((0, 5), (1, 4), (2, 3)):  # a second bout 12 frames (0.6 s) after the k-th one
    o, ln = runs(onehot[:, b])
    e = int(o[k] + ln[k]) + 12
    onehot[e : e + 70, b] = False
    onehot[e : e + 45, b] = True
for s, d in ((300, 40), (900, 50)):  # the rare behavior: two valid onsets only
    plant(3, s, d)
mask = np.ones(n, bool)
for a, b in [(500, 540), (1200, 1260), (1900, 1950), (2600, 2640)]:
    mask[a:b] = False
ss = StateSpace(name="social", onehot=onehot, state_names=names, kind="bouts", exclusive=False)

P = dict(pre_s=4.0, post_s=4.0, baseline_s=(-4.0, -1.0), response_s=(0.0, 1.5),
         min_duration_s=1.5, min_gap_s=1.0, min_events=3)
valid = PETH(bin_s=0.25, **P).valid_onsets(ss, mask, fs)

act = rng.gamma(1.0, 1.0, (cells, n))
for c in range(3):  # rise after Investigation
    for o in bouts(ss)[0][0]:
        act[c, o : o + 30] += 1.5
for c in range(3, 6):  # fall after Allogrooming
    for o in bouts(ss)[1][0]:
        act[c, o : o + 30] *= 0.2
for c in (8, 9):  # late rise after Mounting
    for o in bouts(ss)[2][0]:
        act[c, o + 10 : o + 50] += 1.2
# Cells 6, 7 and 10 have many zeros (exact ties). They stay continuous: sums of rounded or integer
# values tie only up to floating-point noise, and then the framework's p depends on how BLAS orders
# its sums, which no other code can repeat.
act[6] = np.where(rng.random(n) < 0.85, 0.0, act[6])
act[7] = np.where(rng.random(n) < 0.6, 0.0, act[7])
act[10] = np.where(rng.random(n) < 0.97, 0.0, act[10] * 3)
act[14, valid[0][3] + 10] = np.nan  # inside an onset window
covered = np.zeros(n, bool)
for o in np.concatenate(valid):
    covered[o - 80 : o + 80] = True
act[15, np.flatnonzero(~covered & mask)[0]] = np.nan  # outside every window
assert np.isnan(act[15]).sum() == 1
act = np.round(act, 4)  # short numbers keep the reference file small

nn = lambda a: [None if not np.isfinite(v) else float(f"{v:.15g}") for v in np.asarray(a, float).ravel()]
SUB = [0, 3, 6, 8, 14, 15]  # cells kept for the per-frame curves
NULL_CELLS = [0, 3, 6, 14]  # cells whose 200 shifted statistics are stored


def report():
    pre = post = 80
    out = []
    for b in range(4):
        ons, lens = bouts(ss)[b]
        r = dict(bouts=int(ons.size), short=0, gap=0, outside=0, edge=0, onsets=0)
        for i, (o, ln) in enumerate(zip(ons, lens)):
            if ln / fs < P["min_duration_s"] - 1e-9:
                r["short"] += 1
            elif i > 0 and (o - (ons[i - 1] + lens[i - 1])) / fs < P["min_gap_s"] - 1e-9:
                r["gap"] += 1
            elif not mask[o]:
                r["outside"] += 1
            elif o - pre < 0 or o + post > n:
                r["edge"] += 1
            else:
                r["onsets"] += 1
        out.append(r)
    return out


rep = report()
assert [r["onsets"] for r in rep] == [v.size for v in valid]
for k in ("short", "gap", "outside", "edge"):
    assert sum(r[k] for r in rep) > 0, k
assert valid[3].size == 2

ref = {
    "fs": fs, "frames": n, "cells": cells, "states": 4, "n_shuffles": 200,
    "neural": nn(act), "onehot": onehot.T.astype(int).tolist(), "mask": mask.astype(int).tolist(),
    "params": dict(P),
    "bouts": [dict(onsets=o.tolist(), lengths=ln.tolist()) for o, ln in bouts(ss)],
    "valid_onsets": [v.tolist() for v in valid],
    "report": rep,
}

# observed values and the circular-shift test (bin_s and baseline_subtract do not touch them)
metric = PETH(bin_s=0.25, **P)
cfg = ShuffleConfig(n_shuffles=200, min_shift_s=5.0, seed=0, correction="max_stat")
r = shuffle_test(metric, act, ss, mask, cfg, fs)
fixed = [7, 100, 333, 1000, 2999, 3000, 3333, -250]  # includes shifts beyond the session and negative
ref["shuffle"] = {
    "shifts": r.shifts.tolist(), "observed": nn(r.observed), "null": nn(r.null[:, NULL_CELLS]),
    "p": nn(r.p_value), "p_adj": nn(r.p_adj), "null_cells": NULL_CELLS,
    "fixed_shifts": fixed, "fixed_null": nn(metric.compute_shifted(act, ss, mask, fs, np.array(fixed))),
}

# curves: one bin per 0.25 s with the baseline subtracted (all cells), and one bin per frame
# without (a few cells only, to keep the file small)
for key, kw, x, levels in (("binned", dict(bin_s=0.25, baseline_subtract=True), act, (1, 2, 3)),
                           ("perframe", dict(bin_s=None, baseline_subtract=False), act[SUB], (2,))):
    ex = PETH(**kw, **P).extras(x, ss, mask, fs)
    ref[key] = {k: nn(ex[k]) for k in ("peth", "peth_sem", "time_s", "n_events", "p_prepost")}
    ref[key]["bins"] = int(ex["time_s"].size)
    ref[key].update(kw)
    nulls = {}
    for L in levels:
        b = PETH(**kw, **P, null_band=True, n_null=50, null_seed=0, min_shift_s=5.0, min_latency_bins=L)
        eb = b.extras(x, ss, mask, fs)
        names_ = ("peth_null_lo", "peth_null_hi", "peth_null_mean", "latency_s") if L == 2 else ("latency_s",)
        nulls[str(L)] = {k: nn(eb[k]) for k in names_}
    ref[key]["band"] = nulls
ref["sub"] = SUB
ref["band_shifts"] = draw_shifts(n, 50, 100, np.random.default_rng(0)).tolist()

# Wilcoxon: every branch of scipy's 'auto' method (exact, permutation, normal approximation)
w = np.random.default_rng(3)
cases = []
for size in (6, 7, 8, 10, 12, 13, 14, 15, 20, 30, 40, 50, 51, 60):
    d = np.round(w.normal(0.3, 1, size), 3)
    variants = {
        "plain": d,
        "ties": np.round(d * 2) / 2,
        "zeros": np.where(w.random(size) < 0.3, 0.0, d),
        "ties and zeros": np.where(w.random(size) < 0.3, 0.0, np.round(d * 2) / 2),
        "all positive": np.abs(d) + 0.1,
        "mostly negative": -np.abs(d) + np.where(w.random(size) < 0.15, 2 * np.abs(d), 0),
    }
    for name, v in variants.items():
        if np.count_nonzero(v) >= 6:
            cases.append(dict(name=name, d=[float(x) for x in v], p=float(wilcoxon(v, zero_method="wilcox").pvalue)))
cases.append(dict(name="five non-zero", d=[1, -2, 3, 0, 0, 0, 5, -4, 0.0],
                  p=float(wilcoxon([1, -2, 3, 0, 0, 0, 5, -4, 0.0], zero_method="wilcox").pvalue)))
cases.append(dict(name="all ties", d=[1.0] * 5 + [-1.0] * 4 + [2.0] * 3,
                  p=float(wilcoxon([1.0] * 5 + [-1.0] * 4 + [2.0] * 3, zero_method="wilcox").pvalue)))
ref["wilcoxon"] = cases

Path(__file__).with_name("peth_reference.json").write_text(json.dumps(ref))
print("onsets", [v.size for v in valid], "report", rep)
print("wilcoxon cases", len(cases))
p = np.array(ref["shuffle"]["p"], float)
print("NaN p", int(np.isnan(p).sum()), "sig adj", int((np.nan_to_num(np.array(ref["shuffle"]["p_adj"], float), nan=1) < 0.05).sum()))
print("NaN observed cells", [c for c in range(cells) if np.isnan(r.observed[c]).any()])
for key in ("binned", "perframe"):
    print(key, "latency finite", int(np.isfinite(np.array(ref[key]["band"]["2"]["latency_s"], float)).sum()),
          "p_prepost finite", int(np.isfinite(np.array(ref[key]["p_prepost"], float)).sum()))
