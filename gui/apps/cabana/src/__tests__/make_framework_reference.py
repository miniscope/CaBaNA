"""Writes framework_reference.json: inputs and outputs of the framework functions that
framework.ts reproduces. Run with the python of a framework-demo checkout:

    <checkout>/.venv/bin/python make_framework_reference.py
"""

import json
from pathlib import Path

import numpy as np
from scipy.ndimage import gaussian_filter1d

from cabana._loaders._miniscope import timing_report
from cabana._models import BoutTable, ContinuousSignal, Session
from cabana._preprocess._core import SmoothActivity
from cabana._preprocess._masks import clean_mask
from cabana._transform._behavior import InterpolateGaps, SmoothSignal
from cabana._transform._core import BoutsToStates, ResampleSignal, Speed

rng = np.random.default_rng(1)
n, fs = 120, 10.0
t = np.arange(n) / fs
v = np.cumsum(rng.normal(size=n))
for a, b in [(0, 3), (20, 23), (40, 41), (60, 70), (n - 4, n)]:
    v[a:b] = np.nan
y = np.cumsum(rng.normal(size=n))
session = Session(activity=np.zeros((1, n)), t=t, fs=fs, activity_kind="deconvolved")
session = session.with_signal("x", v).with_signal("y", y)


def signal(name, out):
    return [None if np.isnan(a) else float(a) for a in out.signals[name]]


ref = {"fs": fs, "t": t.tolist(), "v": [None if np.isnan(a) else a for a in v], "y": y.tolist()}
ref["interpolate"] = {
    str(g): signal("x", InterpolateGaps(signal="x", max_gap_s=g).apply(session)) for g in (0.2, 0.5)
}
ref["smooth"] = {
    f"{m}-{w}": signal("x", SmoothSignal(signal="x", method=m, window_s=w).apply(session))
    for m in ("median", "gaussian")
    for w in (0.25, 0.6)
}
ref["speed"] = {
    str(w): signal("speed", Speed(window_s=w).apply(session)) for w in (0.1, 0.25, 0.7)
}
act = rng.normal(size=(1, n))
ref["activity"] = act[0].tolist()
ref["smooth_activity"] = {
    str(s): SmoothActivity(sigma_s=s).apply(session.with_activity(act)).activity[0].tolist()
    for s in (0.1, 0.5)
}

# a position on its own clock: unevenly spaced, with a dropout and a long gap
tb = np.sort(rng.uniform(0, 12, 80))
vb = rng.normal(size=80)
vb[10:12] = np.nan
tb = np.delete(tb, range(40, 46))
vb = np.delete(vb, range(40, 46))
ref["resample"] = {"tb": tb.tolist(), "vb": [None if np.isnan(a) else a for a in vb], "out": {}}
sess_b = session.replace(behavior={"p": ContinuousSignal(t=tb, values=vb[:, None], channel_names=["x"])})
for gap in (None, 0.5):
    out = ResampleSignal(source="p", max_gap_s=gap).apply(sess_b)
    ref["resample"]["out"][str(gap)] = signal("x", out)

bouts = BoutTable(
    labels=["a", "a", "a"], start_s=np.array([1.04, 4.0, 4.3]), stop_s=np.array([2.0, 4.1, 5.5])
)
ref["bouts"] = BoutsToStates(source="b", output="o").apply(
    session.replace(behavior={"b": bouts})
).states["o"].onehot[:, 0].tolist()
ref["bout_times"] = {"start": [1.04, 4.0, 4.3], "stop": [2.0, 4.1, 5.5]}
ref["dilate"] = {
    str(d): clean_mask(np.array(ref["bouts"]), fs, dilate_s=d).tolist() for d in (0.1, 0.25)
}

tt = np.cumsum(np.r_[0.1, np.full(80, 0.1), 0.35, np.full(30, 0.1), 0.2, np.full(10, 0.1)])
tt = tt + rng.normal(scale=0.003, size=tt.size)
rep = timing_report(tt)
ref["timing"] = {"t": tt.tolist(), **{k: rep[k] for k in ("fs_median", "fs_mean", "n_dropped_frames", "dropped_fraction", "gap_n_frames", "jitter_sd_s")}}

Path(__file__).with_name("framework_reference.json").write_text(json.dumps(ref))
