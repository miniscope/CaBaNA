"""
Generate three simulated example datasets for stress-testing CaBaNA:

    simulated_open_field/          open field, poor tracking on purpose
    simulated_social_interaction/  direct interaction with annotated social behaviors,
                                   a few annotation mistakes on purpose
    simulated_fear_conditioning/   tone and shock epochs and freezing, no position,
                                   no footprints or denoised traces

    python make_examples.py        # the three above
    python make_examples.py new    # simulated_tone_ttl, simulated_frame_labels, simulated_clock_drift

Each folder gets the input files a user would bring. The "deconvolved" and "denoised"
files are not the true events: they are estimated from the noisy trace (a smoothed
trace, a non-negative step, a small cutoff), so they contain small false events like
real pipeline output. Fixed seeds. See each folder's README.md.
"""
from __future__ import annotations

from pathlib import Path

import subprocess
import tempfile

import numpy as np
import pandas as pd
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter1d
from scipy.signal import lfilter

HERE = Path(__file__).parent
FS = 30.0  # miniscope frame rate


# ---------------------------------------------------------------- shared pieces

def write_timestamps(path: Path, n: int, fps: float, first_s: float, rng) -> np.ndarray:
    """Miniscope timeStamps.csv format. Returns the times in seconds."""
    t = first_s + np.arange(n) / fps + rng.normal(0, 0.0015, n)
    pd.DataFrame({"Frame Number": np.arange(n), "Time Stamp (ms)": np.round(t * 1000).astype(int),
                  "Buffer Index": 0}).to_csv(path, index=False)
    return t


def footprints(rng, n_cells: int, size: int = 160, min_dist: float = 9.0, pairs=()):
    """Gaussian blobs, no two centers closer than min_dist, except the planted pairs."""
    centers: list[np.ndarray] = []
    while len(centers) < n_cells:
        p = rng.uniform(8, size - 8, 2)
        if all(np.hypot(*(p - q)) >= min_dist for q in centers):
            centers.append(p)
    centers = np.array(centers)
    for a, b in pairs:  # cell b sits almost on top of cell a
        centers[b] = centers[a] + rng.normal(0, 0.8, 2)
    sigma = rng.uniform(1.8, 2.8, (n_cells, 2))
    angle = rng.uniform(0, np.pi, n_cells)
    yy, xx = np.mgrid[0:size, 0:size]
    out = np.zeros((n_cells, size, size), np.float32)
    for i, ((cy, cx), (sy, sx), a) in enumerate(zip(centers, sigma, angle)):
        dx, dy = xx - cx, yy - cy
        u, v = dx * np.cos(a) + dy * np.sin(a), -dx * np.sin(a) + dy * np.cos(a)
        out[i] = np.exp(-0.5 * ((u / sx) ** 2 + (v / sy) ** 2))
    return out


def kernel_filter(x, tau_rise, tau_decay):
    """Events -> calcium, with a double exponential of peak 1."""
    ad, ar = np.exp(-1 / (FS * tau_decay)), np.exp(-1 / (FS * tau_rise))
    t = np.arange(int(10 * FS * tau_decay))
    peak = (ad**t - ar**t).max()
    return (lfilter([1], [1, -ad], x, axis=0) - lfilter([1], [1, -ar], x, axis=0)) / peak


def neural(rate_hz, rng, kernel, snr_median, crosstalk=(), n_bad=0, cutoff=1.5):
    """rate_hz is frames x cells. Returns raw, denoised and deconvolved, each cells x frames."""
    T, N = rate_hz.shape
    events = rng.poisson(rate_hz / FS).astype(float)
    amp = rng.uniform(0.6, 1.4, N)
    dff = kernel_filter(events, *kernel) * amp
    for a, b in crosstalk:  # overlapping cells pick up each other's signal
        dff[:, b] += 0.8 * dff[:, a]
    snr = rng.lognormal(np.log(snr_median), 0.5, N)
    snr[rng.choice(N, n_bad, replace=False)] = rng.uniform(0.8, 1.6, n_bad)  # very noisy cells
    noisy = dff + rng.normal(0, 1, (T, N)) / snr
    drift = np.cumsum(rng.normal(0, 0.004, (T, N)), axis=0)
    f0 = rng.uniform(80, 200, N)
    bleach = 1 + 0.1 * np.exp(-np.arange(T) / (FS * 600))
    raw = f0 * (1 + noisy + drift) * bleach[:, None]
    # Estimate events from the noisy trace the way a pipeline would.
    g = np.exp(-1 / (FS * kernel[1]))
    smooth = gaussian_filter1d(noisy, 1.0, axis=0)
    step = np.vstack([np.zeros((1, N)), smooth[1:] - g * smooth[:-1]])
    sigma = np.median(np.abs(step - np.median(step, 0)), 0) / 0.6745
    dec = np.where(step > cutoff * sigma, step, 0.0)
    den = lfilter([1], [1, -g], dec, axis=0)
    c = lambda a: np.ascontiguousarray(a.T, dtype=np.float32)  # cells x frames, row by row
    return c(raw), c(den), c(dec)


def random_path(rng, n, fps, size, v_cruise=(8.0, 20.0), margin=1.5):
    """A mouse-like path: bouts of walking with turns, and stops. Positions in cm."""
    dt = 1 / fps
    pos = np.zeros((n, 2))
    p = np.array(size) / 2
    theta, speed, moving, left = rng.uniform(0, 2 * np.pi), 0.0, True, 3.0
    target = rng.uniform(*v_cruise)
    for i in range(n):
        left -= dt
        if left <= 0:
            moving = not moving
            left = rng.exponential(3.0 if moving else 2.0) + 0.5
            target = rng.uniform(*v_cruise) if moving else 0.0
        speed += (target - speed) * dt / 0.3
        theta += rng.normal(0, 1.6 * np.sqrt(dt))
        step = speed * dt * np.array([np.cos(theta), np.sin(theta)])
        q = p + step
        for d in range(2):  # turn away from the walls
            if q[d] < margin or q[d] > size[d] - margin:
                theta = np.pi - theta if d == 0 else -theta
                q = np.clip(p + speed * dt * np.array([np.cos(theta), np.sin(theta)]), margin, np.array(size) - margin)
        p = np.clip(q, margin, np.array(size) - margin)
        pos[i] = p
    return pos


def speed_of(pos, fps):
    return np.r_[0, np.hypot(*np.diff(pos, axis=0).T)] * fps


def epochs(mask, t, min_dur=0.5, merge_gap=0.5):
    """Runs of True as (start_s, stop_s), the way a person annotating would: short gaps merged, short runs dropped."""
    idx = np.flatnonzero(np.diff(np.r_[0, mask.astype(int), 0]))
    runs = [[t[a], t[min(b, len(t) - 1)]] for a, b in zip(idx[::2], idx[1::2])]
    merged: list[list[float]] = []
    for r in runs:
        if merged and r[0] - merged[-1][1] < merge_gap:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    return [(a, b) for a, b in merged if b - a >= min_dur]


def on_neural_clock(t_cam, values, t_neural):
    return np.interp(t_neural, t_cam, values)


def bump(t, windows, latency=0.2, decay=1.0):
    """A 0-1 trace that is 1 inside the (start, stop) windows, shifted by latency and fading over decay."""
    out = np.zeros(len(t))
    for a, b in windows:
        inside = (t >= a + latency) & (t < b + latency)
        out[inside] = 1
        after = t >= b + latency
        out[after] = np.maximum(out[after], np.exp(-(t[after] - b - latency) / decay))
    return out


def write_epochs(path: Path, rows):
    pd.DataFrame(rows, columns=["label", "start_s", "stop_s"]).round(3).to_csv(path, index=False)


def save(folder: Path, raw=None, den=None, dec=None, fp=None):
    folder.mkdir(exist_ok=True)
    for name, a in [("raw", raw), ("denoised", den), ("deconvolved", dec)]:
        if a is not None:
            np.save(folder / f"neural_{name}.npy", a)
    if fp is not None:
        np.save(folder / "footprints.npy", fp)


def arena_media(folder: Path, size_cm, path, cam_fps, body_cm=8.0, px_per_cm=10, margin=40, seconds=12, fps=10):
    """A picture of the empty arena and a short video of the animal moving in it, for the Arena step.
    The arena corner (0, 0) is at the lower left, as in position.csv, and the animal is body_cm long."""
    W, H = (int(v * px_per_cm) for v in size_cm)
    size = (W + 2 * margin, H + 2 * margin)

    def base():
        img = Image.new("RGB", size, (70, 72, 78))
        d = ImageDraw.Draw(img)
        d.rectangle([margin, margin, margin + W, margin + H], fill=(205, 205, 200), outline=(250, 250, 250), width=4)
        d.rectangle([margin - 14, margin + H // 2 - 20, margin - 4, margin + H // 2 + 20], fill=(230, 190, 60))  # a cue card
        return img

    def to_px(p):
        return margin + p[0] * px_per_cm, margin + (size_cm[1] - p[1]) * px_per_cm

    def draw_animal(img, p, q):
        d = ImageDraw.Draw(img)
        (x, y), (x2, y2) = to_px(p), to_px(q)
        ang = np.arctan2(y2 - y, x2 - x) if (x2, y2) != (x, y) else 0.0
        L, Wd = body_cm * px_per_cm, 3.2 * px_per_cm
        cx, cy = x - np.cos(ang) * L * 0.5, y - np.sin(ang) * L * 0.5  # (x, y) is the nose
        c, s_ = np.cos(ang), np.sin(ang)
        pts = [(cx + c * a - s_ * b, cy + s_ * a + c * b) for a, b in
               [(L / 2, 0), (L / 4, Wd / 2), (-L / 3, Wd / 2.4), (-L / 2, 0), (-L / 3, -Wd / 2.4), (L / 4, -Wd / 2)]]
        d.polygon(pts, fill=(60, 50, 45))
        d.line([(cx - c * L / 2, cy - s_ * L / 2), (cx - c * L * 0.95, cy - s_ * L * 0.95)], fill=(120, 90, 80), width=5)

    base().save(folder / "arena_frame.png")
    with tempfile.TemporaryDirectory() as tmp:
        n = seconds * fps
        for i in range(n):
            j = int(i / fps * cam_fps)
            img = base()
            draw_animal(img, path[j], path[min(j + 3, len(path) - 1)])
            img.save(Path(tmp) / f"f{i:04d}.png")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps), "-i", str(Path(tmp) / "f%04d.png"),
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", str(folder / "arena_video.mp4")], check=True)


# ---------------------------------------------------------------- open field

# The neural part of each session config; every example has deconvolved events and timestamps.
NEURAL_CONFIG = (
    "neural:\n  file: neural_deconvolved.npy\n  kind: deconvolved\n  timestamps: neural_timestamps.csv\n"
    "  alternatives: {{{alternatives}}}\n"
)


def open_field():
    rng = np.random.default_rng(101)
    folder = HERE / "simulated_open_field"
    dur, N, size, cam_fps = 600.0, 120, (40.0, 40.0), 30.0
    n_n, n_c = int(dur * FS), int(dur * cam_fps)
    t_n = write_timestamps((folder.mkdir(exist_ok=True) or folder) / "neural_timestamps.csv", n_n, FS, -0.022, rng)
    t_c = write_timestamps(folder / "behavior_timestamps.csv", n_c, cam_fps, -0.018, rng)
    path = random_path(rng, n_c, cam_fps, size)
    speed = speed_of(path, cam_fps)
    x, y, spd = (on_neural_clock(t_c, v, t_n) for v in (path[:, 0], path[:, 1], speed))

    rate = np.full((n_n, N), 0.3) * rng.lognormal(0, 0.4, N)
    kinds = rng.permutation(N)
    for i in kinds[:48]:  # place cells
        cx, cy = rng.uniform(4, 36, 2)
        rate[:, i] += 4.0 * np.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * 4.5**2))
    for i in kinds[48:66]:  # speed cells
        rate[:, i] += 3.0 * np.clip(spd / 20, 0, 1)
    for i in kinds[66:78]:  # border cells
        wall = np.minimum.reduce([x, y, size[0] - x, size[1] - y])
        rate[:, i] += 3.5 * np.exp(-wall / 3.0)
    pairs = [(0, 1), (10, 11), (20, 21)]
    fp = footprints(rng, N, pairs=pairs)
    raw, den, dec = neural(rate, rng, (0.08, 0.5), 8, crosstalk=pairs, n_bad=4)
    save(folder, raw, den, dec, fp)

    # Tracker output: lost frames (-1), one long dropout and a few jumps.
    tracked = path.copy()
    lost = rng.random(n_c) < 0.01
    lost[int(200 * cam_fps): int(270 * cam_fps)] = True
    for i in rng.choice(np.arange(500, n_c - 500), 5, replace=False):
        tracked[i: i + 2] = np.array(size) - tracked[i]  # jumps to the other side of the arena
    tracked[lost] = -1
    pd.DataFrame({"frame": np.arange(n_c), "x": tracked[:, 0].round(4), "y": tracked[:, 1].round(4)}).to_csv(
        folder / "position.csv", index=False)
    arena_media(folder, size, path[:, :], cam_fps)
    center = (np.abs(path[:, 0] - 20) < 10) & (np.abs(path[:, 1] - 20) < 10)
    write_epochs(folder / "zone_annotations.csv",
                 [("center", a, b) for a, b in epochs(center, t_c)] +
                 [("periphery", a, b) for a, b in epochs(~center, t_c)])
    (folder / "config.yaml").write_text(
        "# Session config for the simulated open field, in the layout cabana.loaders.load_session_dir reads.\n"
        "# The center zone is the inner 20 x 20 cm; periphery (in the annotations) is the rest.\n"
        + NEURAL_CONFIG.format(alternatives="denoised: neural_denoised.npy, raw: neural_raw.npy")
        + "behavior:\n  timestamps: behavior_timestamps.csv\n  position: {file: position.csv, units: cm}\n"
        "  epochs:\n    zones: {file: zone_annotations.csv, exclusive: true}\n"
        "arena:\n  size: [40, 40]\n  units: cm\n  zones:\n    center: [10, 10, 30, 30]\n")


# ---------------------------------------------------------------- social interaction

def social():
    rng = np.random.default_rng(202)
    folder = HERE / "simulated_social_interaction"
    dur, N, size, cam_fps = 600.0, 150, (50.0, 50.0), 25.0
    n_n, n_c = int(dur * FS), int(dur * cam_fps)
    t_n = write_timestamps((folder.mkdir(exist_ok=True) or folder) / "neural_timestamps.csv", n_n, FS, -0.022, rng)
    t_c = write_timestamps(folder / "behavior_timestamps.csv", n_c, cam_fps, -0.018, rng)
    subj = random_path(rng, n_c, cam_fps, size)
    # The partner alternates between approaching the subject and wandering.
    wander = random_path(rng, n_c, cam_fps, size)
    partner = wander.copy()
    approach, p = False, wander[0].copy()
    for i in range(n_c):
        if i % int(cam_fps * 12) == 0:
            approach = rng.random() < 0.6
        if approach:
            d = subj[i] - p
            p = p + np.clip(d, -1, 1) * np.minimum(np.hypot(*d), 10 / cam_fps) / (np.hypot(*d) + 1e-9)
        else:
            p = np.clip(p + (wander[i] - wander[max(i - 1, 0)]), 1.5, np.array(size) - 1.5)
        partner[i] = p
    dist = np.hypot(*(subj - partner).T)
    v_s, v_p = speed_of(subj, cam_fps), speed_of(partner, cam_fps)
    follow = (dist < 12) & (v_s > 8) & (v_p > 8)
    near = (dist < 6) & ~follow
    # Split close contacts into face and anogenital sniffing, alternating by bout.
    rows = []
    bouts = epochs(near, t_c, min_dur=0.5, merge_gap=0.5)
    for k, (a, b) in enumerate(bouts):
        rows.append(("sniff_face" if rng.random() < 0.6 else "sniff_anogenital", a, b))
    rows += [("follow", a, b) for a, b in epochs(follow, t_c, min_dur=1.0, merge_gap=1.0)]
    rows.sort(key=lambda r: r[1])

    x, y = (on_neural_clock(t_c, v, t_n) for v in subj.T)
    spd = on_neural_clock(t_c, v_s, t_n)
    mk = lambda label: [(a, b) for l, a, b in rows if l == label]
    rate = np.full((n_n, N), 0.3) * rng.lognormal(0, 0.4, N)
    order = rng.permutation(N)
    for i in order[:25]:
        rate[:, i] += 4.0 * bump(t_n, mk("sniff_face"))
    for i in order[25:45]:
        rate[:, i] += 4.0 * bump(t_n, mk("sniff_anogenital"))
    for i in order[45:57]:
        rate[:, i] += 3.0 * bump(t_n, mk("follow"), decay=0.5)
    for i in order[57:77]:
        rate[:, i] += 3.0 * np.clip(spd / 20, 0, 1)
    pairs = [(2, 3), (40, 41), (80, 81)]
    fp = footprints(rng, N, pairs=pairs)
    raw, den, dec = neural(rate, rng, (0.15, 1.0), 10, crosstalk=pairs, n_bad=6)  # GCaMP6s-like
    save(folder, raw, den, dec, fp)

    arena_media(folder, size, subj, cam_fps)
    tracked = subj.copy()
    tracked[rng.random(n_c) < 0.01] = -1
    pd.DataFrame({"frame": np.arange(n_c), "x": tracked[:, 0].round(4), "y": tracked[:, 1].round(4)}).to_csv(
        folder / "position.csv", index=False)

    # Annotation mistakes on purpose: an overlap within one label, an epoch past the end, an epoch of 20 ms.
    faces = [i for i, r in enumerate(rows) if r[0] == "sniff_face"]
    i = faces[len(faces) // 2]
    nxt = next(j for j in range(i + 1, len(rows)) if rows[j][0] == "sniff_face")
    rows[i] = (rows[i][0], rows[i][1], rows[nxt][1] + 0.8)
    last = max(j for j, r in enumerate(rows) if r[0] == "follow")
    rows[last] = ("follow", rows[last][1], dur + 5.0)
    rows.append(("sniff_anogenital", 300.0, 300.02))
    write_epochs(folder / "social_annotations.csv", rows)
    (folder / "config.yaml").write_text(
        "# Session config for the simulated social interaction, in the layout cabana.loaders.load_session_dir reads.\n"
        "# Sniffing: within 6 cm. Following: within 12 cm and both faster than 8 cm/s.\n"
        + NEURAL_CONFIG.format(alternatives="denoised: neural_denoised.npy, raw: neural_raw.npy")
        + "behavior:\n  timestamps: behavior_timestamps.csv\n  position: {file: position.csv, units: cm}\n"
        "  epochs:\n    social: {file: social_annotations.csv, exclusive: false}\n"
        "arena:\n  size: [50, 50]\n  units: cm\n")


# ---------------------------------------------------------------- fear conditioning

def fear():
    rng = np.random.default_rng(303)
    folder = HERE / "simulated_fear_conditioning"
    dur, N, cam_fps = 900.0, 80, 20.0
    n_n, n_c = int(dur * FS), int(dur * cam_fps)
    t_n = write_timestamps((folder.mkdir(exist_ok=True) or folder) / "neural_timestamps.csv", n_n, FS, -0.022, rng)
    t_c = write_timestamps(folder / "behavior_timestamps.csv", n_c, cam_fps, -0.018, rng)
    tones = [(s, s + 30.0) for s in (150, 270, 390, 510, 630)]
    shocks = [(b - 2.0, b) for a, b in tones[2:]]  # the last three tones end with a shock
    near_tone = bump(t_c, tones, latency=0, decay=60.0)  # freezing stays up for a minute afterwards
    # Freezing: a two-state process whose rate of starting a freeze rises near tones.
    freeze, frz = np.zeros(n_c, bool), False
    for i in range(n_c):
        p_on = (0.004 + 0.03 * near_tone[i]) / cam_fps * 10
        p_off = (0.15 - 0.1 * near_tone[i]) / cam_fps
        frz = (rng.random() < p_on) if not frz else not (rng.random() < p_off)
        freeze[i] = frz
    rows = [("cs", a, b) for a, b in tones] + [("us", a, b) for a, b in shocks]
    rows += [("freezing", a, b) for a, b in epochs(freeze, t_c, min_dur=1.0, merge_gap=0.5)]
    rows.sort(key=lambda r: r[1])
    mk = lambda label: [(a, b) for l, a, b in rows if l == label]
    freeze_n = np.interp(t_n, t_c, freeze.astype(float))
    rate = np.full((n_n, N), 0.3) * rng.lognormal(0, 0.4, N)
    order = rng.permutation(N)
    for i in order[:15]:
        rate[:, i] += 3.5 * bump(t_n, mk("cs"), decay=0.5)
    for i in order[15:25]:
        rate[:, i] += 6.0 * bump(t_n, mk("us"), decay=5.0)
    for i in order[25:45]:
        rate[:, i] += 2.5 * freeze_n
    raw, den, dec = neural(rate, rng, (0.05, 0.3), 12, n_bad=3)  # jGCaMP8f-like
    save(folder, raw=raw, dec=dec)  # no denoised traces and no footprints on purpose
    write_epochs(folder / "behavior_annotations.csv", rows)
    (folder / "config.yaml").write_text(
        "# Session config for the simulated fear conditioning session, in the layout cabana.loaders.load_session_dir reads.\n"
        "# Tones: 5 x 30 s, starting at 150 s and every 120 s. Shocks: 2 s at the end of tones 3 to 5.\n"
        + NEURAL_CONFIG.format(alternatives="raw: neural_raw.npy")
        + "behavior:\n  timestamps: behavior_timestamps.csv\n"
        "  epochs:\n    behavior: {file: behavior_annotations.csv, exclusive: false}\n"
        "arena:\n  size: [25, 25]\n  units: cm\n")


# ---------------------------------------------------------------- annotation-import examples
# Small sessions (5 minutes, 40 cells) for the time-marker, frame-label and clock-drift features.
# Run with `python make_examples.py new`; the three examples above are not regenerated.

def write_camera_timestamps(path: Path, t_s: np.ndarray):
    """Miniscope timeStamps.csv format for the given times (s)."""
    pd.DataFrame({"Frame Number": np.arange(len(t_s)), "Time Stamp (ms)": np.round(t_s * 1000).astype(int),
                  "Buffer Index": 0}).to_csv(path, index=False)


def tone_ttl():
    rng = np.random.default_rng(404)
    folder = HERE / "simulated_tone_ttl"
    dur, N, cam_fps = 300.0, 40, 20.0
    n_n, n_c = int(dur * FS), int(dur * cam_fps)
    t_n = write_timestamps((folder.mkdir(exist_ok=True) or folder) / "neural_timestamps.csv", n_n, FS, -0.022, rng)
    t_c = write_timestamps(folder / "behavior_timestamps.csv", n_c, cam_fps, -0.018, rng)
    tones = [40.0 + 40.0 * k for k in range(6)]  # tone onsets; each tone lasts 20 s
    shocks = [t + 19.0 for t in tones[3:]]  # the last three tones end with a shock
    near_tone = bump(t_c, [(t, t + 20) for t in tones], latency=0, decay=15.0)
    freeze, frz = np.zeros(n_c, bool), False
    for i in range(n_c):
        p_on = (0.004 + 0.03 * near_tone[i]) / cam_fps * 10
        p_off = (0.15 - 0.1 * near_tone[i]) / cam_fps
        frz = (rng.random() < p_on) if not frz else not (rng.random() < p_off)
        freeze[i] = frz
    write_epochs(folder / "behavior_annotations.csv", [("freezing", a, b) for a, b in epochs(freeze, t_c, 1.0, 0.5)])
    # A marker file as a TTL log would give it. The last tone marker is after the recording ends, on purpose.
    markers = [("tone", t) for t in tones] + [("shock", t) for t in shocks] + [("tone", dur + 15.0)]
    pd.DataFrame(markers, columns=["label", "time_s"]).sort_values("time_s").to_csv(folder / "time_markers.csv", index=False)

    freeze_n = np.interp(t_n, t_c, freeze.astype(float))
    rate = np.full((n_n, N), 0.3) * rng.lognormal(0, 0.4, N)
    order = rng.permutation(N)
    for i in order[:8]:  # tone onset cells
        rate[:, i] += 4.0 * bump(t_n, [(t, t + 0.5) for t in tones], decay=1.0)
    for i in order[8:14]:  # shock cells
        rate[:, i] += 6.0 * bump(t_n, [(t, t + 0.5) for t in shocks], decay=3.0)
    for i in order[14:24]:
        rate[:, i] += 2.5 * freeze_n
    raw, _, dec = neural(rate, rng, (0.05, 0.3), 12, n_bad=2)
    save(folder, raw=raw, dec=dec)
    (folder / "config.yaml").write_text(
        "# Session config for the simulated tone and TTL session, in the layout cabana.loaders.load_session_dir reads.\n"
        "# time_markers.csv is not listed: the framework does not read a `markers:` key yet.\n"
        + NEURAL_CONFIG.format(alternatives="raw: neural_raw.npy")
        + "behavior:\n  timestamps: behavior_timestamps.csv\n"
        "  epochs:\n    behavior: {file: behavior_annotations.csv, exclusive: false}\n"
        "arena:\n  size: [25, 25]\n  units: cm\n")


def frame_labels():
    rng = np.random.default_rng(505)
    folder = HERE / "simulated_frame_labels"
    dur, N, size, cam_fps = 300.0, 40, (30.0, 30.0), 20.0
    n_n, n_c = int(dur * FS), int(dur * cam_fps)
    t_n = write_timestamps((folder.mkdir(exist_ok=True) or folder) / "neural_timestamps.csv", n_n, FS, -0.022, rng)
    t_c = write_timestamps(folder / "behavior_timestamps.csv", n_c, cam_fps, -0.018, rng)
    path = random_path(rng, n_c, cam_fps, size)

    # One behavior per frame in bouts: grooming, rearing, or nothing scored (blank).
    names = np.array(["grooming", "rearing", ""])
    behavior = np.empty(n_c, dtype=object)
    i = 0
    while i < n_c:
        n = int(rng.integers(30, 160))
        behavior[i: i + n] = rng.choice(names, p=[0.25, 0.25, 0.5])
        i += n
    grooming = (behavior == "grooming").astype(float)
    rearing = (behavior == "rearing").astype(float)

    table = pd.DataFrame({"frame": np.arange(n_c), "x": path[:, 0].round(4), "y": path[:, 1].round(4),
                          "grooming": grooming, "rearing": rearing, "behavior": behavior})
    # Unscored stretches have no binary value for rearing; grooming stays 0 there.
    table.loc[behavior == "", "rearing"] = np.nan
    # Five deliberate disagreements: the binary grooming column contradicts the behavior column.
    labeled = np.flatnonzero(behavior != "")
    for f in rng.choice(labeled[(labeled > 200) & (labeled < n_c - 200)], 5, replace=False):
        table.loc[f, "grooming"] = 1.0 - table.loc[f, "grooming"]
    # A few frames are missing from the file: two stretches and some single frames.
    drop = np.zeros(n_c, bool)
    drop[1500:1560] = drop[3800:3830] = True
    drop[rng.choice(n_c, 8, replace=False)] = True
    # Keep the deliberate disagreements in the file.
    conflicts = np.flatnonzero((table.grooming == 1.0) != (table.behavior == "grooming") & (table.behavior != ""))
    drop[conflicts] = False
    table[~drop].to_csv(folder / "frame_labels.csv", index=False, float_format="%g")

    g, r = (np.interp(t_n, t_c, v) for v in (grooming, rearing))
    rate = np.full((n_n, N), 0.3) * rng.lognormal(0, 0.4, N)
    order = rng.permutation(N)
    for i in order[:10]:
        rate[:, i] += 3.5 * g
    for i in order[10:20]:
        rate[:, i] += 3.5 * r
    raw, _, dec = neural(rate, rng, (0.08, 0.5), 10, n_bad=2)
    save(folder, raw=raw, dec=dec)
    (folder / "config.yaml").write_text(
        "# Session config for the simulated frame-label session, in the layout cabana.loaders.load_session_dir reads.\n"
        "# frame_labels.csv is not listed: the framework does not read a `frame_labels:` key yet.\n"
        + NEURAL_CONFIG.format(alternatives="raw: neural_raw.npy")
        + "behavior:\n  timestamps: behavior_timestamps.csv\n  position: {file: frame_labels.csv, units: cm}\n"
        "arena:\n  size: [30, 30]\n  units: cm\n")


def clock_drift():
    rng = np.random.default_rng(606)
    folder = HERE / "simulated_clock_drift"
    offset, scale = 0.35, 1.0004
    dur, N, size, cam_fps = 300.0, 40, (30.0, 30.0), 30.0
    n_n, n_c = int(dur * FS), int(dur * cam_fps)
    t_n = write_timestamps((folder.mkdir(exist_ok=True) or folder) / "neural_timestamps.csv", n_n, FS, -0.022, rng)
    t_c = -0.018 + np.arange(n_c) / cam_fps + rng.normal(0, 0.0015, n_c)  # true times, on the neural clock
    # The camera's own clock reads t_cam, and the framework maps it back as scale * (t_cam - offset).
    write_camera_timestamps(folder / "behavior_timestamps.csv", t_c / scale + offset)
    path = random_path(rng, n_c, cam_fps, size)
    x, y = (on_neural_clock(t_c, v, t_n) for v in (path[:, 0], path[:, 1]))
    rate = np.full((n_n, N), 0.3) * rng.lognormal(0, 0.4, N)
    for i in range(24):  # place cells, so a wrong clock blurs the fields
        cx, cy = rng.uniform(4, 26, 2)
        rate[:, i] += 4.0 * np.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * 3.5**2))
    raw, _, dec = neural(rate, rng, (0.08, 0.5), 10, n_bad=2)
    save(folder, raw=raw, dec=dec)
    pd.DataFrame({"frame": np.arange(n_c), "x": path[:, 0].round(4), "y": path[:, 1].round(4)}).to_csv(
        folder / "position.csv", index=False)
    (folder / "config.yaml").write_text(
        "# Session config for the simulated clock drift session, in the layout cabana.loaders.load_session_dir reads.\n"
        "# The camera clock runs 0.35 s late and 0.04% fast: neural time = scale * (camera time - offset_s).\n"
        + NEURAL_CONFIG.format(alternatives="raw: neural_raw.npy")
        + f"behavior:\n  timestamps: behavior_timestamps.csv\n  clock: {{offset_s: {offset}, scale: {scale}}}\n"
        "  position: {file: position.csv, units: cm}\n"
        "arena:\n  size: [30, 30]\n  units: cm\n")


if __name__ == "__main__":
    import sys

    if sys.argv[1:] == ["new"]:
        tone_ttl()
        frame_labels()
        clock_drift()
    else:
        open_field()
        social()
        fear()
    print("done")
