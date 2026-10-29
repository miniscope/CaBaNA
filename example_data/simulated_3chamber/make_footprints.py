"""
Add simulated footprints (footprints.npy) to the simulated three-chamber dataset.
Kept apart from make_simulated_3chamber.py so the other files stay exactly as they were.

    python make_footprints.py

One 2D Gaussian blob per cell, cells x height x width. Positions are random (no two
closer than MIN_DIST) and unrelated to the traces. A few pairs are placed on top of each other on purpose, so
the overlap check has something to find. Fixed seed.
"""
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
N_CELLS, SIZE = 180, 160
MIN_DIST = 9.0  # pixels between cell centers, so cells do not overlap by chance
N_OVERLAPPING_PAIRS = 3

rng = np.random.default_rng(54)
centers = []
while len(centers) < N_CELLS:
    p = rng.uniform(8, SIZE - 8, size=2)
    if all(np.hypot(*(p - q)) >= MIN_DIST for q in centers):
        centers.append(p)
centers = np.array(centers)
for k in range(N_OVERLAPPING_PAIRS):  # cell 2k+1 sits almost on top of cell 2k
    centers[2 * k + 1] = centers[2 * k] + rng.normal(0, 0.8, size=2)
sigma = rng.uniform(1.8, 2.8, size=(N_CELLS, 2))
angle = rng.uniform(0, np.pi, size=N_CELLS)

yy, xx = np.mgrid[0:SIZE, 0:SIZE]
out = np.zeros((N_CELLS, SIZE, SIZE), dtype=np.float32)
for i, ((cy, cx), (sy, sx), a) in enumerate(zip(centers, sigma, angle)):
    dy, dx = yy - cy, xx - cx
    u = dx * np.cos(a) + dy * np.sin(a)
    v = -dx * np.sin(a) + dy * np.cos(a)
    out[i] = np.exp(-0.5 * ((u / sx) ** 2 + (v / sy) ** 2))
np.save(HERE / "footprints.npy", out)
print(out.shape, out.dtype)
