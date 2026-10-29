"""
Generate the simulated three-chamber example dataset. Writes the input files into
this folder. Independent of the `cabana` package: it only makes files, the way an
acquisition system would, and the pipeline reads them back.

    python make_simulated_3chamber.py

See README.md in this folder for what the files contain. Fixed seed, so rerunning
reproduces the same files.
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).parent

SEED = 53
DURATION_S = 300.0
NEURAL_FPS = 30.0  # miniscope
BEHAVIOR_FPS = 50.0  # behavior camera, a different rate and clock from the miniscope
# Both clocks share one time axis (time since the recording started) and each file's
# first frame is a few ms before zero, as in a real session.
NEURAL_FIRST_S = -0.022
BEHAVIOR_FIRST_S = -0.018
JITTER_S = 0.0015  # frame timing wobble
N_CELLS = 180
N_STIMULUS = 20  # cells that respond when the animal investigates the stimulus animal
N_EMPTY = 10  # cells that respond when it investigates the empty enclosure
N_PLACE = 25
ARENA_CM = (60.0, 30.0)
ZONE_EDGES_CM = (20.0, 40.0)  # left | center | right on x
# Half-disc enclosures against the two end walls, as in the arena: (centre x, centre y, radius) in cm.
# The subject cannot enter them. A stimulus animal is in the left one; the right one is empty.
ENCLOSURES_CM = {"left": (0.0, 15.0, 9.0), "right": (60.0, 15.0, 9.0)}
CONTAINS = {"left": "stimulus", "right": "empty"}
NEAR_CM = 4.0  # "at an enclosure" means within this distance of its edge
FACING_DEG = 45.0  # and the head points at the enclosure within this angle
# Walls between the chambers: (x, y from, y to) in cm. Each stops short of an arena wall, so the
# animal goes around its end through the doorway. The left doorway is at the bottom (y 0-9), the right at the top (y 21-30).
DIVIDERS_CM = {"left": (20.0, 9.0, 30.0), "right": (40.0, 0.0, 21.0)}
WALL_CM = 1.0  # thickness of a divider
BODY_CM = 1.0  # the animal's centre stays this far from dividers and enclosures
EDGE_CM = 0.5  # and this far from the outer walls
# How the animal moves. Times are in seconds, so the path does not depend on the frame rate.
SPEED_MAX_CM_S = 14.5  # it never moves faster than this. A little under 15, so speed worked out from the file stays under 15
CRUISE_CM_S = (10.0, 14.5)  # each trip has its own typical speed, in this range
SPEED_WOBBLE_CM_S = 1.5  # speed varies around that by about this much within a trip
SPEED_TAU_S = 0.3  # how quickly its speed changes
EASE_IN_CM = 3.0  # it slows down over this distance as it nears its goal
MOVE_BOUT_S = 4.0  # on average it moves this long before stopping ...
PAUSE_S = 1.0  # ... and stops this long
TURN_RATE = 4.0  # how strongly it steers toward where it is going (per second)
TURN_NOISE = 0.8  # random steering (radians per root second)
WANDER_RAD = 0.6  # how far its path drifts to either side of a straight line
WANDER_TAU_S = 2.0  # how long a drift lasts
HEAD_TAU_S = 0.3  # how quickly the head follows its target
ARRIVE_CM, DOOR_ARRIVE_CM = 1.5, 2.5  # how close counts as having arrived
P_STIMULUS, P_EMPTY = 0.17, 0.09  # chance that the next trip is to the stimulus or the empty enclosure
STAY_S = {"stimulus": (1.5, 5.0), "empty": (1.0, 3.5)}  # how long it stays there, facing it
STATION_GAP_CM = 2.0  # it stops this far from the enclosure's edge
WALL_SHARE = 0.4  # share of its other trips that end against a wall
N_CANDIDATES = 16  # for those it picks the least-visited of this many random spots
TRAVEL_COST = 0.02  # seconds of 'not visited yet' that one cm of walking is worth
BIN_CM = 2.0  # size of the bins used to count visits
TRACKER_NOISE_CM = 0.0  # position error of the tracker. None here, so speed read from position.csv stays under 15 cm/s
LOST_FRAME_FRACTION = 0.01  # tracker dropouts, written as -1
MIN_EPOCH_S = 0.5  # an annotator ignores epochs shorter than this ...
MERGE_GAP_S = 0.5  # ... and treats gaps shorter than this as one continuous epoch


def accessible(x, y, margin=0.0):
    """True on open floor: inside the arena, outside the enclosures and the dividers.
    `margin` keeps the point that far from them."""
    if not (0 <= x <= ARENA_CM[0] and 0 <= y <= ARENA_CM[1]):
        return False
    for cx, cy, r in ENCLOSURES_CM.values():
        if np.hypot(x - cx, y - cy) <= r + margin:
            return False
    for xd, y0, y1 in DIVIDERS_CM.values():
        if abs(x - xd) <= WALL_CM / 2 + margin and y0 - margin <= y <= y1 + margin:
            return False
    return True


def free(x, y):
    """Where the animal's centre can be: open floor, a body-width from the walls."""
    return EDGE_CM <= x <= ARENA_CM[0] - EDGE_CM and EDGE_CM <= y <= ARENA_CM[1] - EDGE_CM and accessible(x, y, BODY_CM)


def chamber(x):
    return int(x >= ZONE_EDGES_CM[0]) + int(x >= ZONE_EDGES_CM[1])


def doorway(i):
    """The middle of the doorway in divider i (0 = left, 1 = right)."""
    xd, y0, y1 = list(DIVIDERS_CM.values())[i]
    return np.array([xd, y0 / 2 if y0 > 0 else (y1 + ARENA_CM[1]) / 2])


def route(pos, goal):
    """The points to head for, in order: a doorway for each divider between here and the goal."""
    a, b = chamber(pos[0]), chamber(goal[0])
    step = 1 if b > a else -1
    return [doorway(min(c, c + step)) for c in range(a, b, step)] + [np.array(goal)]


def bin_of(x, y):
    return min(int(x // BIN_CM), int(ARENA_CM[0] // BIN_CM) - 1), min(int(y // BIN_CM), int(ARENA_CM[1] // BIN_CM) - 1)


def pick_goal(rng, pos, visits):
    """Where the animal goes next: an enclosure, or somewhere it has spent little time."""
    r = rng.random()
    if r < P_STIMULUS + P_EMPTY:
        kind = "stimulus" if r < P_STIMULUS else "empty"
        side = "left" if kind == "stimulus" else "right"
        cx, cy, rad = ENCLOSURES_CM[side]
        theta = np.radians(rng.uniform(-70, 70))  # a spot on the arena side of the enclosure
        sign = 1 if side == "left" else -1
        return kind, (cx + sign * (rad + STATION_GAP_CM) * np.cos(theta), cy + (rad + STATION_GAP_CM) * np.sin(theta))
    candidates = []
    while len(candidates) < N_CANDIDATES:
        x, y = rng.uniform(EDGE_CM, ARENA_CM[0] - EDGE_CM), rng.uniform(EDGE_CM, ARENA_CM[1] - EDGE_CM)
        if rng.random() < WALL_SHARE:  # mice spend time along the walls and in the corners
            gap = rng.uniform(1.0, 2.0)
            x, y = [(x, gap), (x, ARENA_CM[1] - gap), (gap, y), (ARENA_CM[0] - gap, y)][rng.integers(4)]
        if free(x, y):
            candidates.append((x, y))
    # prefer places it has not been, and places that are not far to walk to (around the dividers)
    def cost(c):
        points = [np.asarray(pos)] + route(pos, c)
        return visits[bin_of(*c)] + TRAVEL_COST * sum(np.hypot(*(q - r)) for r, q in zip(points, points[1:]))
    return "explore", min(candidates, key=cost)


def wrap(angle):
    return (angle + np.pi) % (2 * np.pi) - np.pi


def walk(n, fps, rng):
    """Position and head orientation for n behavior frames.

    The animal travels toward a goal in stop-and-go bouts, with a path that drifts and
    curves. It goes around the dividers through their doorways, slides along walls it
    meets, and stops at an enclosure to face it.
    """
    dt = 1.0 / fps
    pos = np.array([30.0, 15.0])
    xy, head_out = np.empty((n, 2)), np.empty(n)
    xy[0], head_out[0] = pos, 0.0
    theta = head = 0.0  # body direction, head orientation
    speed = psi = head_off = sway = 0.0  # speed; drift off the straight line; head scanning; sway while facing an enclosure
    visits = np.zeros((int(ARENA_CM[0] // BIN_CM), int(ARENA_CM[1] // BIN_CM)))  # seconds spent in each bin so far
    kind, goal = pick_goal(rng, pos, visits)
    goals, cruise, mode, pause_left, stay_left, side = route(pos, goal), rng.uniform(*CRUISE_CM_S), "travel", 0.0, 0.0, None
    wobble = 0.0  # speed variation within a trip

    def new_trip():
        nonlocal kind, goals, cruise
        kind, goal = pick_goal(rng, pos, visits)
        goals = route(pos, goal)
        cruise = rng.uniform(*CRUISE_CM_S)

    for i in range(1, n):
        if mode == "travel" and np.hypot(*(goals[0] - pos)) < (ARRIVE_CM if len(goals) == 1 else DOOR_ARRIVE_CM):
            goals.pop(0)
            if not goals:
                if kind == "explore":
                    pause_left = rng.exponential(PAUSE_S)
                    new_trip()
                else:  # at an enclosure: stay and face it
                    mode, side = "stay", "left" if kind == "stimulus" else "right"
                    stay_left = rng.uniform(*STAY_S[kind])

        if mode == "stay":
            stay_left -= dt
            if stay_left <= 0:
                mode = "travel"
                new_trip()
            speed_target = 0.0
        else:
            to_goal = goals[0] - pos
            dist = np.hypot(*to_goal)
            phi = np.arctan2(to_goal[1], to_goal[0])
            if pause_left > 0:
                pause_left -= dt
                speed_target = 0.0
                theta += 1.0 * np.sqrt(dt) * rng.normal()  # looks about while stopped
            else:
                if rng.random() < dt / MOVE_BOUT_S:
                    pause_left = rng.exponential(PAUSE_S)
                wobble += -wobble * dt / 1.0 + SPEED_WOBBLE_CM_S * np.sqrt(2 * dt / 1.0) * rng.normal()
                slow = 1.0 if len(goals) > 1 else min(1.0, dist / EASE_IN_CM + 0.3)  # eases in to its goal
                speed_target = float(np.clip(cruise * slow + wobble, 0.0, SPEED_MAX_CM_S))
            psi += -psi * dt / WANDER_TAU_S + WANDER_RAD * np.sqrt(2 * dt / WANDER_TAU_S) * rng.normal()
            theta += TURN_RATE * wrap(phi + psi - theta) * dt + TURN_NOISE * np.sqrt(dt) * rng.normal()

        speed = float(np.clip(speed + (speed_target - speed) * dt / SPEED_TAU_S, 0.0, SPEED_MAX_CM_S))
        step = speed * dt
        new = pos + step * np.array([np.cos(theta), np.sin(theta)])
        if mode == "stay":
            new = pos + 0.05 * np.sqrt(dt) * rng.normal(size=2)  # a small sway, not walking
        if not free(*new):
            move = new - pos  # slide along what it hit, at the same speed
            axes = sorted((0, 1), key=lambda a: -abs(move[a]))
            for a in axes:
                candidate = pos.copy()
                candidate[a] += np.sign(move[a]) * step
                if free(*candidate):
                    new = candidate
                    break
            else:  # boxed in: stop and turn away
                new, speed = pos, 0.0
                theta += rng.uniform(-1.5, 1.5)
        pos = new
        visits[bin_of(*pos)] += dt

        if mode == "stay":  # head on the enclosure, with a little sway
            cx, cy, _ = ENCLOSURES_CM[side]
            sway += -sway * dt / 1.0 + 0.25 * np.sqrt(2 * dt / 1.0) * rng.normal()
            head_target = np.arctan2(cy - pos[1], cx - pos[0]) + sway
        else:  # head follows the body, and scans a little
            head_off += -head_off * dt / 0.5 + 0.35 * np.sqrt(2 * dt / 0.5) * rng.normal()
            head_target = theta + head_off
        head += wrap(head_target - head) * dt / HEAD_TAU_S
        xy[i], head_out[i] = pos, wrap(head)
    return xy, head_out


def investigating(xy, hd, side):
    """True where the animal is within NEAR_CM of an enclosure and its head points at it."""
    cx, cy, r = ENCLOSURES_CM[side]
    dist = np.hypot(cx - xy[:, 0], cy - xy[:, 1])
    angle_to = np.arctan2(cy - xy[:, 1], cx - xy[:, 0])
    off = np.abs((hd - angle_to + np.pi) % (2 * np.pi) - np.pi)  # angle between head orientation and the enclosure
    return (dist <= r + NEAR_CM) & (off <= np.radians(FACING_DEG))


def coverage(xy, bin_cm=BIN_CM, min_s=0.1):
    """Fraction of the open 2 cm bins the animal spent at least min_s seconds in."""
    min_frames = min_s * BEHAVIOR_FPS
    xe, ye = np.arange(0, ARENA_CM[0] + bin_cm, bin_cm), np.arange(0, ARENA_CM[1] + bin_cm, bin_cm)
    counts, _, _ = np.histogram2d(xy[:, 0], xy[:, 1], bins=[xe, ye])
    gx, gy = np.meshgrid(xe[:-1] + bin_cm / 2, ye[:-1] + bin_cm / 2, indexing="ij")
    open_bins = np.vectorize(accessible)(gx, gy)
    return float((counts[open_bins] >= min_frames).mean())


def zone_of(x):
    return np.where(x < ZONE_EDGES_CM[0], "left", np.where(x < ZONE_EDGES_CM[1], "center", "right"))


def epochs(frame_labels, t, min_s=0.0, merge_gap_s=0.0):
    """Start and stop times (s) of each epoch: a stretch where yes/no frame labels are True."""
    edges = np.diff(np.concatenate([[0], frame_labels.astype(int), [0]]))
    on, off = np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)  # off is exclusive
    start, stop = t[on], t[np.minimum(off, len(t) - 1)]
    keep_gap = start[1:] - stop[:-1] > merge_gap_s  # a gap this long stays a gap
    first = np.concatenate([[True], keep_gap])
    last = np.concatenate([keep_gap, [True]])
    start, stop = start[first], stop[last]
    long = stop - start >= min_s
    return start[long], stop[long]


def annotations(labels, t):
    """One annotation table (label, start_s, stop_s) with an epoch per row."""
    rows = []
    for name, frame_labels in labels:
        s, e = epochs(frame_labels, t, MIN_EPOCH_S, MERGE_GAP_S)
        rows += [(name, a, b) for a, b in zip(s, e)]
    return pd.DataFrame(rows, columns=["label", "start_s", "stop_s"]).sort_values("start_s")


def main():
    rng = np.random.default_rng(SEED)

    # --- behavior camera clock ---
    n_b = int(DURATION_S * BEHAVIOR_FPS) + 2  # the camera runs a little past the miniscope
    xy_walk, hd_walk = walk(n_b, BEHAVIOR_FPS, rng)
    t_nominal = BEHAVIOR_FIRST_S + np.arange(n_b) / BEHAVIOR_FPS
    t_b = np.round(np.sort(t_nominal + rng.uniform(-JITTER_S, JITTER_S, n_b)), 3)  # time stamps are whole ms
    # Each frame is captured at its own time stamp, so the animal's position in a frame is its position
    # at that time. Speed worked out from the file then matches the animal's real speed.
    xy_b = np.column_stack([np.interp(t_b, t_nominal, xy_walk[:, k]) for k in (0, 1)])
    hd_b = (np.interp(t_b, t_nominal, np.unwrap(hd_walk)) + np.pi) % (2 * np.pi) - np.pi
    investigating_b = {side: investigating(xy_b, hd_b, side) for side in ENCLOSURES_CM}

    # --- miniscope clock, as in a Miniscope timeStamps.csv (milliseconds) ---
    n_n = int(DURATION_S * NEURAL_FPS)
    t_n = NEURAL_FIRST_S + np.arange(n_n) / NEURAL_FPS + rng.uniform(-JITTER_S, JITTER_S, n_n)
    t_n = np.round(np.sort(t_n), 3)

    # what the cells respond to, on the miniscope clock
    x_n = np.interp(t_n, t_b, xy_b[:, 0])
    y_n = np.interp(t_n, t_b, xy_b[:, 1])
    nearest_b = np.searchsorted(t_b, t_n).clip(0, n_b - 1)
    investigating_n = {side: v[nearest_b] for side, v in investigating_b.items()}

    # --- event rate (events/s) ---
    rate = np.tile(rng.uniform(0.2, 1.0, N_CELLS), (n_n, 1))
    ids = rng.permutation(N_CELLS)
    stimulus_cells = ids[:N_STIMULUS]
    empty_cells = ids[N_STIMULUS:N_STIMULUS + N_EMPTY]
    place_cells = np.sort(ids[N_STIMULUS + N_EMPTY:N_STIMULUS + N_EMPTY + N_PLACE])
    for c in stimulus_cells:
        rate[:, c] += investigating_n["left"] * rng.uniform(3.0, 6.0)
    for c in empty_cells:
        rate[:, c] += investigating_n["right"] * rng.uniform(3.0, 6.0)
    fields = {}
    for c in place_cells:
        while True:  # a place field centre in the open part of the arena
            cx, cy = rng.uniform(4, ARENA_CM[0] - 4), rng.uniform(3, ARENA_CM[1] - 3)
            if accessible(cx, cy):
                break
        fields[int(c)] = (round(float(cx), 1), round(float(cy), 1))
        d2 = ((x_n - cx) / 5.0) ** 2 + ((y_n - cy) / 5.0) ** 2
        rate[:, c] += 5.0 * np.exp(-d2 / 2)
    events = rng.poisson(rate / NEURAL_FPS).astype(float)

    # --- the three neural types, all cells x frames ---
    decay = np.exp(-1.0 / (0.5 * NEURAL_FPS))  # calcium decay, tau = 0.5 s
    calcium = np.zeros_like(events)
    for i in range(1, n_n):
        calcium[i] = decay * calcium[i - 1] + events[i]
    amp = rng.uniform(0.5, 1.5, N_CELLS)  # arbitrary scale per cell
    f0 = rng.uniform(80, 200, N_CELLS)  # baseline fluorescence per cell
    drift = np.cumsum(rng.normal(0, 0.02, (n_n, N_CELLS)), axis=0)  # slow baseline wander
    deconvolved = (events * amp).T
    denoised = (calcium * amp).T  # clean calcium, baseline at 0
    raw = (f0 * (1 + 0.3 * calcium * amp) + drift * f0 * 0.05 + rng.normal(0, 0.03, calcium.shape) * f0).T

    # --- position from the tracker (behavior camera clock). Lost frames are -1. ---
    lost = rng.random(n_b) < LOST_FRAME_FRACTION
    xy_tracked = xy_b + rng.normal(0, TRACKER_NOISE_CM, xy_b.shape)  # the tracker is a little off
    position = pd.DataFrame({"frame": np.arange(n_b), "x": xy_tracked[:, 0], "y": xy_tracked[:, 1]})
    position.loc[lost, ["x", "y"]] = -1

    # --- head orientation from the miniscope IMU, as in a Miniscope V4 BNO
    # headOrientation.csv: unit quaternions, one row per miniscope frame, on the
    # neural clock, with no dropouts. Yaw (about z, 0 = east, counterclockwise) is
    # the simulated head orientation; pitch and roll wobble a little. ---
    yaw = np.interp(t_n, t_b, np.unwrap(hd_b))
    wobble = lambda: np.convolve(rng.normal(0, 1, n_n), np.ones(15) / 15, mode="same") * 4.0
    pitch, roll = np.radians(wobble()), np.radians(wobble())
    cy, sy, cp, sp, cr, sr = np.cos(yaw / 2), np.sin(yaw / 2), np.cos(pitch / 2), np.sin(pitch / 2), np.cos(roll / 2), np.sin(roll / 2)
    head_orientation = pd.DataFrame({
        "Time Stamp (ms)": np.round(t_n * 1000).astype(int),
        "qw": cr * cp * cy + sr * sp * sy,
        "qx": sr * cp * cy - cr * sp * sy,
        "qy": cr * sp * cy + sr * cp * sy,
        "qz": cr * cp * sy - sr * sp * cy,
    })

    # --- annotations, on the behavior camera clock: when the animal was in each
    # zone, and when it was investigating. Made from the true behavior, not the
    # tracker output. ---
    zone = zone_of(xy_b[:, 0])
    zone_annotations = annotations([(z, zone == z) for z in ("left", "center", "right")], t_b)
    investigation_annotations = annotations(
        [(f"investigate_{CONTAINS[side]}", investigating_b[side]) for side in ("left", "right")], t_b)

    # --- write ---
    for name, arr in [("raw", raw), ("denoised", denoised), ("deconvolved", deconvolved)]:
        np.save(HERE / f"neural_{name}.npy", arr.astype(np.float32))
    # one timestamps file per clock, both in the Miniscope timeStamps.csv format
    for name, t in [("neural", t_n), ("behavior", t_b)]:
        pd.DataFrame({
            "Frame Number": np.arange(len(t)),
            "Time Stamp (ms)": np.round(t * 1000).astype(int),
            "Buffer Index": 0,
        }).to_csv(HERE / f"{name}_timestamps.csv", index=False)
    position.to_csv(HERE / "position.csv", index=False, float_format="%.4f")
    head_orientation.to_csv(HERE / "headOrientation.csv", index=False, float_format="%.6f")
    zone_annotations.to_csv(HERE / "zone_annotations.csv", index=False, float_format="%.3f")
    investigation_annotations.to_csv(HERE / "investigation_annotations.csv", index=False, float_format="%.3f")
    def wall(xd, y0, y1):  # a divider as the polygon of its 1 cm wall
        a, b = xd - WALL_CM / 2, xd + WALL_CM / 2
        return f"[[{a:g}, {y0:g}], [{b:g}, {y0:g}], [{b:g}, {y1:g}], [{a:g}, {y1:g}]]"

    (HERE / "config.yaml").write_text(
        "# Session config for the simulated three-chamber task, in the layout cabana.loaders.load_session_dir reads.\n"
        "# Head orientation: quaternion (qw, qx, qy, qz) from the miniscope IMU; yaw about z, 0 = east, counterclockwise.\n"
        f"# Investigation: within {NEAR_CM:g} cm of an enclosure with the head pointing at it (within {FACING_DEG:g} degrees).\n"
        "neural:\n"
        "  file: neural_deconvolved.npy\n"
        "  kind: deconvolved\n"
        "  timestamps: neural_timestamps.csv\n"
        "  alternatives: {denoised: neural_denoised.npy, raw: neural_raw.npy}\n"
        "behavior:\n"
        "  timestamps: behavior_timestamps.csv\n"
        "  position: {file: position.csv, units: cm}\n"
        "  head_orientation: {file: headOrientation.csv}\n"
        "  epochs:\n"
        "    zones: {file: zone_annotations.csv, exclusive: true}\n"
        "    investigation: {file: investigation_annotations.csv, exclusive: false}\n"
        "arena:\n"
        f"  size: [{ARENA_CM[0]:g}, {ARENA_CM[1]:g}]\n"
        "  units: cm\n"
        "  zones:  # x-ranges [x0, x1], each across the full height\n"
        f"    left: [0, {ZONE_EDGES_CM[0]:g}]\n"
        f"    center: [{ZONE_EDGES_CM[0]:g}, {ZONE_EDGES_CM[1]:g}]\n"
        f"    right: [{ZONE_EDGES_CM[1]:g}, {ARENA_CM[0]:g}]\n"
        "  enclosures:  # half-discs against the end walls; the subject cannot enter\n"
        + "".join(
            f"    {side}: {{center: [{cx:g}, {cy:g}], radius: {r:g}, contents: {CONTAINS[side]}}}\n"
            for side, (cx, cy, r) in ENCLOSURES_CM.items()
        )
        + "  dividers:  # walls between the chambers; each stops short of one arena wall, leaving a doorway\n"
        + "".join(f"    {side}: {wall(*d)}\n" for side, d in DIVIDERS_CM.items())
    )

    print(f"coverage of the open arena: {coverage(xy_b):.0%} of 2 cm bins; lost frames {lost.mean():.1%}")
    print("investigation of the stimulus animal:", f"{investigating_b['left'].mean():.1%} of frames;",
          "of the empty enclosure:", f"{investigating_b['right'].mean():.1%}")
    print(f"{len(zone_annotations)} zone epochs; investigation epochs:",
          investigation_annotations.label.value_counts().to_dict())
    print("zones:", pd.Series(zone_of(xy_b[:, 0])).value_counts(normalize=True).round(2).to_dict())

if __name__ == "__main__":
    main()
