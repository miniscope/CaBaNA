"""Synthetic sessions with planted ground truth, for the CaBaNA demo and tests.

What is planted, and why
------------------------
A simulated session lets researchers check that the pipeline recovers structure
that is *known* to be there.  Cells fall into six disjoint populations:

* **Place cells** -- a 2D Gaussian field in the arena (peak 3-8 Hz above
  baseline, sigma 30-60 mm).  The field only drives the cell while the animal
  is moving (speed > ``speed_gate_mm_s``), so a speed mask is needed to see it
  cleanly.  The trajectory contains stationary pauses so that mask matters.
* **Social cells** -- each tied to one scored social behavior (sniff, groom,
  chase, huddle).  Half are excited (rate x3-5 during the behavior), half
  inhibited (rate x0.2).  Bouts of different behaviors may overlap; bouts of the
  same behavior are separated by at least 2 s.  Only ``[30 s, duration - 30 s]``
  is "scored"; outside that span the bout table says nothing.
* **Syllable cells** -- tuned (x3) to one kinematic syllable (still, walk, run,
  turn_left, turn_right, rear), derived from the trajectory.
* **Head-direction cells** -- von Mises tuning to the arena-frame head heading
  (kappa 2-6, peak 3-8 Hz above baseline, uniform preferred direction); not
  speed gated.  Carved out of the would-be untuned pool.
* **Pitch cells** -- rate scaled by ``exp(+-gain * pitch_deg / 20)`` (half "up",
  half "down", gain 0.6-1.0, multiplier clipped to [0.1, 10]).  Carved out of
  the would-be untuned pool.
* **Untuned cells** -- baseline firing only (log-normal across cells).

Head orientation (``include_head_orientation``) is a unit quaternion per neural
frame, as the Miniscope V4 IMU reports it: heading follows the direction of
travel while moving (plus slow scanning noise) and holds while paused, pitch
rises during rears (needs syllables), roll is small noise.  All of it, and the
head-direction / pitch cells, is drawn from a separate generator so the
rest of the session is identical to a run without it.

Spikes are Poisson per neural frame.  ``kind="deconvolved"`` multiplies each
event by a log-normal amplitude (sigma 0.3) to mimic deconvolved calcium;
``kind="spike_counts"`` leaves integer counts, mimicking ephys.  Behavior is
sampled on its own clock that starts 2 s before and ends 2 s after the neural
clock, as real tracking data usually does.  The answer key is stored in
``session.meta["ground_truth"]``; the configuration in ``meta["simulation"]``.
"""

from __future__ import annotations

from typing import Any, Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ._models import BoutTable, ContinuousSignal, LabelSeries, Session

SYLLABLE_NAMES = ["still", "walk", "run", "turn_left", "turn_right", "rear"]
_PAD_S = 2.0


class SimulationConfig(BaseModel):
    """Parameters of a synthetic session.  See the module docstring.

    Cell populations are disjoint: ``frac_place``, ``frac_social`` and
    ``frac_syllable`` (rounded to whole cells) are carved out of ``n_cells`` and
    every remaining cell is untuned, so their sum must be <= 1.  With
    ``include_syllables=False`` no syllable cells are made (their share becomes
    untuned).  ``frac_head_direction`` and ``frac_pitch`` are NOT part of that
    sum: they are taken out of the remaining untuned pool (fewer if it runs
    out), and are zero when ``include_head_orientation=False``.  Times are in seconds, lengths in millimetres, rates in Hz, and
    ``social_behaviors`` / ``social_mean_durations_s`` must have equal length.
    Each field's ``description`` gives its meaning and unit.
    """

    model_config = ConfigDict(extra="forbid")

    fs: float = Field(20.0, gt=0, le=1000, description="Neural sampling rate (Hz).")
    duration_s: float = Field(1200.0, gt=1, description="Neural recording duration (s).")
    n_cells: int = Field(200, ge=1, le=20000, description="Number of simulated cells.")
    seed: int = Field(0, ge=0, description="Seed for numpy's default_rng.")
    arena_size_mm: float = Field(400.0, gt=10, description="Side of the square arena (mm).")
    behavior_fs: float = Field(30.0, gt=0, le=1000, description="Behavior sampling rate (Hz).")
    frac_place: float = Field(0.3, ge=0, le=1, description="Fraction of place cells.")
    frac_social: float = Field(0.2, ge=0, le=1, description="Fraction of social-tuned cells.")
    frac_syllable: float = Field(0.1, ge=0, le=1, description="Fraction of syllable-tuned cells.")
    include_syllables: bool = Field(True, description="Derive and store syllable labels.")
    kind: Literal["deconvolved", "spike_counts"] = Field(
        "deconvolved", description="Activity type: amplitude-scaled events or raw counts."
    )
    speed_gate_mm_s: float = Field(
        20.0, ge=0, description="Place fields only drive cells above this speed (mm/s)."
    )
    baseline_rate_hz: float = Field(0.2, gt=0, description="Median baseline rate (Hz).")
    baseline_sigma_log: float = Field(0.5, ge=0, description="Log-sd of baseline rates.")
    social_behaviors: list[str] = Field(
        default_factory=lambda: ["sniff", "groom", "chase", "huddle"],
        description="Names of scored social behaviors.",
    )
    social_mean_durations_s: list[float] = Field(
        default_factory=lambda: [3.0, 6.0, 2.0, 10.0],
        description="Mean bout duration per social behavior (s).",
    )
    social_duration_sigma_log: float = Field(0.4, ge=0, description="Log-sd of bout durations.")
    social_gap_mean_s: float = Field(
        20.0, gt=0, description="Mean extra wait after the 2 s refractory gap (s)."
    )
    social_refractory_s: float = Field(
        2.0, ge=0, description="Min gap between same-behavior bouts."
    )
    pause_fraction: float = Field(0.15, ge=0, lt=1, description="Approx. fraction of time paused.")
    include_head_orientation: bool = Field(
        True, description="Simulate head orientation quaternions and head-direction/pitch cells."
    )
    frac_head_direction: float = Field(
        0.1, ge=0, le=1, description="Fraction of head-direction cells (taken from untuned)."
    )
    frac_pitch: float = Field(
        0.05, ge=0, le=1, description="Fraction of pitch-tuned cells (taken from untuned)."
    )
    head_yaw_offset_deg: float = Field(
        0.0,
        description="Sensor yaw zero relative to the arena (deg); the sensor reports heading - offset.",
    )

    @model_validator(mode="after")
    def _check(self) -> SimulationConfig:
        if self.frac_place + self.frac_social + self.frac_syllable > 1 + 1e-9:
            raise ValueError("frac_place + frac_social + frac_syllable must be <= 1")
        if len(self.social_behaviors) != len(self.social_mean_durations_s):
            raise ValueError("social_behaviors and social_mean_durations_s differ in length")
        return self


def _reflect(p: np.ndarray, v: np.ndarray, size: float) -> None:
    for k in range(2):
        if p[k] < 0:
            p[k], v[k] = -p[k], -v[k]
        elif p[k] > size:
            p[k], v[k] = 2 * size - p[k], -v[k]


def _trajectory(
    cfg: SimulationConfig, t_b: np.ndarray, rng: np.random.Generator
) -> tuple[np.ndarray, np.ndarray]:
    """OU-velocity random walk reflected at walls, with stationary pauses."""
    n = t_b.size
    dt = 1.0 / cfg.behavior_fs
    theta, sd = 1.0, 50.0  # 1 s velocity persistence, 50 mm/s per-axis stationary sd
    paused = np.zeros(n, dtype=bool)
    if cfg.pause_fraction > 0:
        mean_pause = 6.0
        mean_gap = mean_pause * (1 - cfg.pause_fraction) / cfg.pause_fraction
        i = int(rng.exponential(mean_gap) * cfg.behavior_fs)
        while i < n:
            length = int(rng.uniform(2.0, 10.0) * cfg.behavior_fs)
            paused[i : i + length] = True
            i += length + max(1, int(rng.exponential(mean_gap) * cfg.behavior_fs))
    noise = rng.standard_normal((n, 2)) * sd * np.sqrt(2 * theta * dt)
    pos = np.empty((n, 2))
    p = rng.uniform(0.2, 0.8, 2) * cfg.arena_size_mm
    v = rng.standard_normal(2) * sd
    decay = 1 - theta * dt
    for i in range(n):
        if paused[i]:
            v[:] = 0.0
        else:
            v = v * decay + noise[i]
            p = p + v * dt
            _reflect(p, v, cfg.arena_size_mm)
        pos[i] = p
    k = max(1, int(round(0.25 * cfg.behavior_fs)))
    vel = np.gradient(pos, dt, axis=0)
    speed = np.hypot(vel[:, 0], vel[:, 1])
    # light smoothing of speed to avoid reflection spikes
    ker = np.ones(k) / k
    speed = np.convolve(speed, ker, mode="same")
    return pos, speed


def _syllables(
    cfg: SimulationConfig, pos: np.ndarray, speed: np.ndarray, rng: np.random.Generator
) -> np.ndarray:
    """Label each behavior frame from speed and heading change (ints 0..5)."""
    n = pos.shape[0]
    k = max(1, int(round(0.25 * cfg.behavior_fs)))
    z = pos[:, 0] + 1j * pos[:, 1]
    idx = np.arange(n)
    ahead = z[np.clip(idx + k, 0, n - 1)] - z
    behind = z - z[np.clip(idx - k, 0, n - 1)]
    dtheta = np.angle(ahead * np.conj(behind))  # >0 means counter-clockwise (left)
    lab = np.ones(n, dtype=np.int64)  # walk
    lab[speed > 80] = 2
    thr = 0.6
    moving = speed >= 5
    lab[moving & (dtheta > thr)] = 3
    lab[moving & (dtheta < -thr)] = 4
    lab[speed < 5] = 0
    # rare rear bouts (~1 per 60 s, 1-3 s)
    t = rng.exponential(60.0)
    dur_total = n / cfg.behavior_fs
    while t < dur_total:
        d = rng.uniform(1.0, 3.0)
        lab[int(t * cfg.behavior_fs) : int((t + d) * cfg.behavior_fs)] = 5
        t += d + rng.exponential(60.0)
    return lab


def _ou(n: int, dt: float, tau: float, sd: float, mean: float, rng: np.random.Generator):
    """Ornstein-Uhlenbeck path with stationary sd ``sd`` and time constant ``tau``."""
    a = np.exp(-dt / tau)
    kick = rng.standard_normal(n) * sd * np.sqrt(1 - a * a)
    x = np.empty(n)
    x[0] = mean + rng.standard_normal() * sd
    for i in range(1, n):
        x[i] = mean + (x[i - 1] - mean) * a + kick[i]
    return x


def _box(x: np.ndarray, k: int) -> np.ndarray:
    """Centered moving average along axis 0 with edge padding."""
    if k <= 1:
        return x
    if x.ndim == 2:
        return np.stack([_box(x[:, j], k) for j in range(x.shape[1])], axis=1)
    pad = np.pad(x, (k // 2, k - 1 - k // 2), mode="edge")
    return np.convolve(pad, np.ones(k) / k, mode="valid")


def _head_kinematics(
    cfg: SimulationConfig,
    pos: np.ndarray,
    speed: np.ndarray,
    syl: np.ndarray | None,
    rng: np.random.Generator,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Arena-frame yaw (unwrapped), pitch and roll in degrees on the behavior clock."""
    n = pos.shape[0]
    dt = 1.0 / cfg.behavior_fs
    k = max(1, int(round(0.25 * cfg.behavior_fs)))
    vel = _box(np.gradient(pos, dt, axis=0), k)
    ang = np.arctan2(vel[:, 1], vel[:, 0])
    moving = speed > 5.0
    if moving.any():
        idx = np.where(moving, np.arange(n), -1)
        idx = np.maximum.accumulate(idx)  # last moving frame (hold heading while paused)
        first = int(np.argmax(moving))
        idx[idx < 0] = first
        ang = ang[idx]
    else:
        ang = np.zeros(n)
    body = _box(np.unwrap(ang), max(1, int(round(0.3 * cfg.behavior_fs))))
    yaw = np.degrees(body) + _ou(n, dt, 0.5, 20.0, 0.0, rng)
    pitch = _ou(n, dt, 1.0, 8.0, -5.0, rng)
    if syl is not None:
        rear = _box((syl == 5).astype(float), max(1, int(round(0.3 * cfg.behavior_fs))))
        pitch = pitch + 35.0 * rear
    roll = _ou(n, dt, 0.5, 6.0, 0.0, rng)
    return yaw, pitch, roll


def _euler_to_quat(yaw_deg: np.ndarray, pitch_deg: np.ndarray, roll_deg: np.ndarray) -> np.ndarray:
    """Unit quaternions (w, x, y, z) of q_z(yaw) * q_y(-pitch) * q_x(roll), hemisphere-continuous.

    Pitch is nose-up positive (x forward, y left, z up), as the head_orientation transform reports it.
    """
    cy, sy = np.cos(np.radians(yaw_deg) / 2), np.sin(np.radians(yaw_deg) / 2)
    cp, sp = np.cos(np.radians(pitch_deg) / 2), np.sin(-np.radians(pitch_deg) / 2)
    cr, sr = np.cos(np.radians(roll_deg) / 2), np.sin(np.radians(roll_deg) / 2)
    q = np.stack(
        [
            cr * cp * cy + sr * sp * sy,
            sr * cp * cy - cr * sp * sy,
            cr * sp * cy + sr * cp * sy,
            cr * cp * sy - sr * sp * cy,
        ],
        axis=1,
    )
    flip = np.where((q[1:] * q[:-1]).sum(axis=1) < 0, -1.0, 1.0)
    return q * np.concatenate([[1.0], np.cumprod(flip)])[:, None]


def _simulate_counts(rate: np.ndarray, cfg: SimulationConfig, rng: np.random.Generator):
    counts = rng.poisson(rate / cfg.fs).astype(np.float64)
    if cfg.kind == "deconvolved":
        nz = counts > 0
        counts[nz] *= rng.lognormal(0.0, 0.3, int(nz.sum()))
    return counts


def _social_bouts(cfg: SimulationConfig, rng: np.random.Generator) -> BoutTable:
    lo, hi = 30.0, cfg.duration_s - 30.0
    labels: list[str] = []
    starts: list[float] = []
    stops: list[float] = []
    s = cfg.social_duration_sigma_log
    if hi > lo:
        for name, mean in zip(cfg.social_behaviors, cfg.social_mean_durations_s, strict=True):
            mu = np.log(mean) - 0.5 * s**2
            t = lo + rng.exponential(cfg.social_gap_mean_s)
            while t < hi:
                stop = min(t + rng.lognormal(mu, s), hi)
                labels.append(name)
                starts.append(t)
                stops.append(stop)
                t = stop + cfg.social_refractory_s + rng.exponential(cfg.social_gap_mean_s)
    order = np.argsort(starts, kind="stable") if starts else np.array([], dtype=int)
    return BoutTable(
        labels=[labels[i] for i in order],
        start_s=np.asarray(starts, dtype=float)[order],
        stop_s=np.asarray(stops, dtype=float)[order],
        scored_start_s=lo,
        scored_stop_s=max(lo, hi),
    )


def simulate_session(config: SimulationConfig | None = None, **overrides: Any) -> Session:
    """Simulate a session with planted place, social, syllable, head-direction and pitch tuning.

    Parameters
    ----------
    config : SimulationConfig, optional
        Base configuration; defaults are used when omitted.
    **overrides
        Fields of ``SimulationConfig`` to override (validated).

    Returns
    -------
    Session
        ``activity`` ``(n_cells, round(duration_s * fs))`` on the neural clock
        ``t = arange(n_time) / fs`` (seconds, starting at 0), ``activity_kind``
        ``config.kind`` and ``cell_ids`` ``"cell_000"``...  Behavior is on its own
        clock that spans ``[-2 s, duration_s + 2 s]``: ``behavior["position"]``
        (``ContinuousSignal``, channels ``["x", "y"]``, mm),
        ``behavior["social"]`` (``BoutTable`` scored over ``[30 s, duration_s - 30 s]``)
        and, if ``include_syllables``, ``behavior["syllables"]`` (``LabelSeries``
        with names ``SYLLABLE_NAMES``).  If ``include_head_orientation``,
        ``behavior["head_orientation"]`` is a ``ContinuousSignal`` of unit
        quaternions (channels ``head_w, head_x, head_y, head_z``, intrinsic Z-Y'-X''
        yaw/pitch/roll) on the NEURAL clock ``t``, in the sensor frame (heading minus
        ``head_yaw_offset_deg``).  ``meta["simulation"]`` is the config and
        ``meta["ground_truth"]`` the answer key: ``place_cells`` (cell indices),
        ``field_centers_mm`` and ``field_sigma_mm`` (per place cell, in that
        order), ``social_cells`` (dicts with ``cell``, ``behavior``, ``sign``),
        ``syllable_cells`` (dicts with ``cell``, ``syllable``), ``head_direction_cells``
        (dicts with ``cell``, ``preferred_deg`` in the arena frame in (-180, 180],
        ``kappa``, ``peak_hz``), ``pitch_cells`` (dicts with ``cell``, ``sign``
        ``"up"``/``"down"``, ``gain``; both lists empty without head orientation),
        ``head_yaw_offset_deg``, ``untuned_cells`` (the cells left untuned) and
        ``speed_gate_mm_s``.  The same ``seed`` reproduces the session exactly.

    Raises
    ------
    pydantic.ValidationError
        If the config or an override is invalid.
    """
    cfg = config or SimulationConfig()
    if overrides:
        cfg = SimulationConfig(**{**cfg.model_dump(), **overrides})
    rng = np.random.default_rng(cfg.seed)

    n_time = int(round(cfg.duration_s * cfg.fs))
    t = np.arange(n_time) / cfg.fs
    n_b = int(round((cfg.duration_s + 2 * _PAD_S) * cfg.behavior_fs)) + 1
    t_b = -_PAD_S + np.arange(n_b) / cfg.behavior_fs

    pos, speed = _trajectory(cfg, t_b, rng)
    bouts = _social_bouts(cfg, rng)
    syl = _syllables(cfg, pos, speed, rng) if cfg.include_syllables else None

    # --- cell populations (disjoint) ---
    n = cfg.n_cells
    n_place = int(round(cfg.frac_place * n))
    n_social = int(round(cfg.frac_social * n))
    n_syl = int(round(cfg.frac_syllable * n)) if cfg.include_syllables else 0
    perm = rng.permutation(n)
    place_idx = np.sort(perm[:n_place])
    social_idx = np.sort(perm[n_place : n_place + n_social])
    syl_idx = np.sort(perm[n_place + n_social : n_place + n_social + n_syl])
    untuned = np.sort(perm[n_place + n_social + n_syl :])

    # head-direction / pitch cells come out of the untuned pool, drawn from a separate
    # generator so every main-rng draw is unchanged
    hrng = np.random.default_rng([cfg.seed, 1])
    hd_idx = pitch_idx = np.array([], dtype=perm.dtype)
    if cfg.include_head_orientation:
        n_hd = min(int(round(cfg.frac_head_direction * n)), untuned.size)
        n_pitch = min(int(round(cfg.frac_pitch * n)), untuned.size - n_hd)
        pick = hrng.permutation(untuned)
        hd_idx = np.sort(pick[:n_hd])
        pitch_idx = np.sort(pick[n_hd : n_hd + n_pitch])
        untuned = np.sort(pick[n_hd + n_pitch :])

    base = rng.lognormal(np.log(cfg.baseline_rate_hz), cfg.baseline_sigma_log, n)
    rate = np.repeat(base[:, None], n_time, axis=1)

    # place cells: gated Gaussian field on the behavior clock, interpolated to neural clock
    centers = rng.uniform(0.15, 0.85, (n_place, 2)) * cfg.arena_size_mm
    sigmas = rng.uniform(30, 60, n_place)
    peaks = rng.uniform(3, 8, n_place)
    gate = speed > cfg.speed_gate_mm_s
    for j, c in enumerate(place_idx):
        d2 = ((pos - centers[j]) ** 2).sum(axis=1)
        add_b = peaks[j] * np.exp(-d2 / (2 * sigmas[j] ** 2)) * gate
        rate[c] += np.interp(t, t_b, add_b)

    # social cells
    names = cfg.social_behaviors
    social_info: list[dict[str, Any]] = []
    if names:
        beh_on = {}
        for name in names:
            on = np.zeros(n_time, dtype=bool)
            for lab, a, b in zip(bouts.labels, bouts.start_s, bouts.stop_s, strict=True):
                if lab == name:
                    on |= (t >= a) & (t < b)
            beh_on[name] = on
        for i, c in enumerate(social_idx):
            name = names[(i // 2) % len(names)]
            excited = i % 2 == 0
            factor = rng.uniform(3, 5) if excited else 0.2
            rate[c, beh_on[name]] *= factor
            social_info.append(
                {"cell": int(c), "behavior": name, "sign": "excited" if excited else "inhibited"}
            )

    # syllable cells
    syl_info: list[dict[str, Any]] = []
    if syl is not None:
        # previous-sample lookup, identical to the labels_to_states transform
        fi = np.clip(np.round((t + _PAD_S) * cfg.behavior_fs - 0.5 + 1e-9).astype(int), 0, n_b - 1)
        syl_n = syl[fi]
        for i, c in enumerate(syl_idx):
            k = i % len(SYLLABLE_NAMES)
            rate[c, syl_n == k] *= 3.0
            syl_info.append({"cell": int(c), "syllable": SYLLABLE_NAMES[k]})

    # --- activity ---
    counts = rng.poisson(rate / cfg.fs).astype(np.float64)
    if cfg.kind == "deconvolved":
        nz = counts > 0
        counts[nz] *= rng.lognormal(0.0, 0.3, int(nz.sum()))

    # --- head orientation and its cells (separate generator; overwrites only their rows) ---
    head_q = None
    hd_info: list[dict[str, Any]] = []
    pitch_info: list[dict[str, Any]] = []
    if cfg.include_head_orientation:
        yaw_b, pitch_b, roll_b = _head_kinematics(cfg, pos, speed, syl, hrng)
        yaw_n = np.interp(t, t_b, yaw_b)  # arena frame, unwrapped, degrees
        pitch_n = np.interp(t, t_b, pitch_b)
        roll_n = np.interp(t, t_b, roll_b)
        head_q = _euler_to_quat(yaw_n - cfg.head_yaw_offset_deg, pitch_n, roll_n)

        mus = hrng.uniform(-np.pi, np.pi, hd_idx.size)
        kappas = hrng.uniform(2, 6, hd_idx.size)
        hd_peaks = hrng.uniform(3, 8, hd_idx.size)
        theta = np.radians(yaw_n)
        hd_rate = np.repeat(base[hd_idx, None], n_time, axis=1)
        for j in range(hd_idx.size):
            hd_rate[j] += hd_peaks[j] * np.exp(kappas[j] * (np.cos(theta - mus[j]) - 1))
            hd_info.append(
                {
                    "cell": int(hd_idx[j]),
                    "preferred_deg": float(180.0 - ((180.0 - np.degrees(mus[j])) % 360.0)),
                    "kappa": float(kappas[j]),
                    "peak_hz": float(hd_peaks[j]),
                }
            )
        gains = hrng.uniform(0.6, 1.0, pitch_idx.size)
        p_rate = np.repeat(base[pitch_idx, None], n_time, axis=1)
        for j in range(pitch_idx.size):
            up = j % 2 == 0
            mult = np.exp((1 if up else -1) * gains[j] * pitch_n / 20.0)
            p_rate[j] *= np.clip(mult, 0.1, 10.0)
            pitch_info.append(
                {"cell": int(pitch_idx[j]), "sign": "up" if up else "down", "gain": float(gains[j])}
            )
        if hd_idx.size:
            counts[hd_idx] = _simulate_counts(hd_rate, cfg, hrng)
        if pitch_idx.size:
            counts[pitch_idx] = _simulate_counts(p_rate, cfg, hrng)

    behavior: dict[str, Any] = {
        "position": ContinuousSignal(t=t_b, values=pos, channel_names=["x", "y"], units="mm"),
        "social": bouts,
    }
    if head_q is not None:
        behavior["head_orientation"] = ContinuousSignal(
            t=t, values=head_q, channel_names=["head_w", "head_x", "head_y", "head_z"], units=""
        )
    if syl is not None:
        behavior["syllables"] = LabelSeries(t=t_b, labels=syl, label_names=list(SYLLABLE_NAMES))

    ground_truth = {
        "place_cells": [int(i) for i in place_idx],
        "field_centers_mm": [[float(x), float(y)] for x, y in centers],
        "field_sigma_mm": [float(x) for x in sigmas],
        "social_cells": social_info,
        "syllable_cells": syl_info,
        "head_direction_cells": hd_info,
        "pitch_cells": pitch_info,
        "head_yaw_offset_deg": float(cfg.head_yaw_offset_deg),
        "untuned_cells": [int(i) for i in untuned],
        "speed_gate_mm_s": float(cfg.speed_gate_mm_s),
    }
    return Session(
        activity=counts,
        t=t,
        fs=cfg.fs,
        activity_kind=cfg.kind,
        cell_ids=[f"cell_{i:03d}" for i in range(n)],
        behavior=behavior,
        meta={"ground_truth": ground_truth, "simulation": cfg.model_dump()},
    )


__all__ = ["SYLLABLE_NAMES", "SimulationConfig", "simulate_session"]
