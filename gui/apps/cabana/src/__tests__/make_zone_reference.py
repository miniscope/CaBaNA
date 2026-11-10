"""Writes zone_reference.json: which zone each sample is in, from the framework's ZoneOccupancy,
for zone-occupancy.ts to match. Run with the python of a framework checkout:

    uv run --project <framework checkout> python make_zone_reference.py
"""

import json
from pathlib import Path

import numpy as np

from cabana._models import Session
from cabana._transform._behavior import ZoneOccupancy

rng = np.random.default_rng(3)
n = 400
x = rng.uniform(-5, 65, n)
y = rng.uniform(-5, 35, n)
x[[5, 50, 51]] = np.nan
x[10], y[10] = 20.0, 15.0  # on a shared rectangle edge: the first listed wins
x[11], y[11] = 60.0, 30.0  # on the outer corner: edges are inclusive

rects = {"left": [0, 0, 20, 30], "center": [20, 0, 40, 30], "right": [40, 0, 60, 30]}
polys = {
    "cup": [[30 + 6 * np.cos(a), 15 + 6 * np.sin(a)] for a in np.linspace(0, 2 * np.pi, 32, endpoint=False)],
    "notch": [[0, 0], [10, 0], [0, 10]],
}
session = Session(activity=np.zeros((1, n)), t=np.arange(n) / 10.0, fs=10.0, activity_kind="deconvolved")
session = session.with_signal("x", x).with_signal("y", y)
space = ZoneOccupancy(signal="", zones=polys, zones_rect=rects).apply(session).states["zones"]
onehot = np.asarray(space.onehot, bool)
support = np.asarray(space.support, bool)
idx = np.where(onehot.any(axis=1), onehot.argmax(axis=1), -1)
idx[~support] = -2

ref = {
    "x": [None if np.isnan(v) else float(v) for v in x],
    "y": [float(v) for v in y],
    "zones": [[k, [list(map(float, p)) for p in v]] for k, v in polys.items()]
    + [[k, list(map(float, v))] for k, v in rects.items()],
    "state_names": list(space.state_names),
    "zone": idx.tolist(),
}
Path(__file__).with_name("zone_reference.json").write_text(json.dumps(ref))
