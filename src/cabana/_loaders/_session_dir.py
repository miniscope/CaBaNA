"""Config-driven session-folder loader: one YAML describes the files, clocks and arena."""

from __future__ import annotations

import warnings
from pathlib import Path
from typing import Any, Literal

import numpy as np
import pandas as pd
import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from .._models import ContinuousSignal, Session, SessionInfo
from ._miniscope import _read_timestamps, load_head_orientation, timing_report
from ._tabular import load_epochs_csv, load_position_csv

_CONFIG_NAMES = ("session.yaml", "config.yaml")


class _Cfg(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ClockConfig(_Cfg):
    """Map behavior-camera time onto the neural clock: ``scale * (t - offset_s)``."""

    offset_s: float = 0.0
    scale: float = Field(1.0, gt=0)


class NeuralConfig(_Cfg):
    """The activity matrix and its frame times.

    ``file`` is a ``.npy`` (2-D) or a ``.npz`` (give ``key``).  ``orientation`` says how the
    matrix is laid out on disk; the session always holds cells x frames.  ``timestamps`` is a
    Miniscope ``timeStamps.csv``; without it ``fs`` is required and ``t = arange(n) / fs``.
    ``cell_ids`` is null, a list, or the path of a text/``.npy`` file with one id per cell.
    ``alternatives`` are other layers of the same recording (name to file), recorded in
    ``meta["neural_alternatives"]``; ``load_session_dir(activity=name)`` loads one of them
    instead of ``file``.
    """

    file: str
    key: str | None = None
    orientation: Literal["cells_x_frames", "frames_x_cells"] = "cells_x_frames"
    kind: Literal["deconvolved", "denoised", "raw", "dff", "spike_counts", "binary"] = "deconvolved"
    timestamps: str | None = None
    fs: float | None = Field(None, gt=0)
    cell_ids: list[str] | str | None = None
    alternatives: dict[str, str] = Field(default_factory=dict)


class PositionConfig(_Cfg):
    """A ``frame, x, y`` table (no time column) joined to the behavior timestamps by frame."""

    file: str
    frame_column: str = "frame"
    columns: list[str] = Field(default_factory=lambda: ["x", "y"])
    missing_value: float | None = -1
    units: str = "cm"
    max_gap_s: float | None = Field(0.5, gt=0)


class HeadOrientationConfig(_Cfg):
    """Miniscope ``headOrientation.csv`` (one quaternion per neural frame)."""

    file: str
    format: Literal["quaternion_wxyz"] = "quaternion_wxyz"
    output: str = "head_direction"
    offset_deg: float = 0.0


class SignalConfig(_Cfg):
    """An extra tabular signal, joined like position."""

    file: str
    frame_column: str = "frame"
    columns: list[str]
    missing_value: float | None = None
    units: str = ""
    max_gap_s: float | None = Field(None, gt=0)


class EpochConfig(_Cfg):
    """An annotation CSV (``label, start_s, stop_s``) turned into a boolean state space."""

    file: str
    exclusive: bool = False
    merge_gap_s: float = Field(0.0, ge=0)
    min_duration_s: float = Field(0.0, ge=0)


class BehaviorConfig(_Cfg):
    timestamps: str | None = None
    clock: ClockConfig | None = None
    position: PositionConfig | None = None
    head_orientation: HeadOrientationConfig | None = None
    signals: dict[str, SignalConfig] = Field(default_factory=dict)
    epochs: dict[str, EpochConfig] = Field(default_factory=dict)


class EnclosureConfig(_Cfg):
    """A cup / enclosure the subject cannot enter (a disc of ``radius`` at ``center``)."""

    center: list[float]
    radius: float = Field(0.0, ge=0)
    contents: str | None = None

    @model_validator(mode="after")
    def _c(self) -> EnclosureConfig:
        if len(self.center) != 2:
            raise ValueError("center needs [x, y]")
        return self


class ArenaConfig(_Cfg):
    """Arena geometry.  A zone is a rect ``[x0, y0, x1, y1]``, a polygon ``[[x, y], ...]`` or
    an x-range ``[x0, x1]`` (expanded to the full ``size[1]`` height).  An enclosure may also be
    written ``[cx, cy, radius]``."""

    size: list[float] | None = None
    units: str = "cm"
    zones: dict[str, list[Any]] = Field(default_factory=dict)
    enclosures: dict[str, EnclosureConfig | list[float]] = Field(default_factory=dict)
    dividers: Any = None

    @model_validator(mode="after")
    def _c(self) -> ArenaConfig:
        if self.size is not None and (len(self.size) != 2 or min(self.size) <= 0):
            raise ValueError("size needs two positive numbers [width, height]")
        for k, z in self.zones.items():
            self.zones[k] = _norm_zone(k, z, self.size)
        for k, e in list(self.enclosures.items()):
            if not isinstance(e, EnclosureConfig):
                if len(e) != 3:
                    raise ValueError(f"enclosure {k!r}: a list needs [cx, cy, radius]")
                self.enclosures[k] = EnclosureConfig(center=e[:2], radius=e[2])
        return self


class SubjectsConfig(_Cfg):
    focal: str | None = None
    stimulus: dict[str, str | None] = Field(default_factory=dict)


class SessionDirConfig(_Cfg):
    """Typed schema of a session-folder config (``session.yaml`` / ``config.yaml``).

    All file paths are relative to the YAML.  See ``docs/LOADERS.md`` ("A session folder with a
    config") and :func:`write_session_dir_template` for a commented example.
    """

    name: str | None = None
    neural: NeuralConfig
    behavior: BehaviorConfig = Field(default_factory=BehaviorConfig)
    arena: ArenaConfig | None = None
    subjects: SubjectsConfig | None = None

    @classmethod
    def from_yaml(cls, path) -> SessionDirConfig:
        """Parse and validate a YAML file (errors name the file)."""
        p = Path(path)
        try:
            raw = yaml.safe_load(p.read_text())
            if not isinstance(raw, dict):
                raise ValueError("top level must be a mapping")
            return cls.model_validate(raw)
        except (ValidationError, ValueError, yaml.YAMLError) as e:
            raise ValueError(f"{p}: invalid session config: {e}") from e


def _norm_zone(name: str, z: list, size: list[float] | None) -> list:
    arr = np.asarray(z, dtype=float) if len(z) and not isinstance(z[0], list | tuple) else None
    if arr is not None:
        if arr.shape == (4,):
            if arr[2] < arr[0] or arr[3] < arr[1]:
                raise ValueError(f"zone {name!r}: rect needs x1>=x0 and y1>=y0")
            return arr.tolist()
        if arr.shape == (2,):
            if size is None:
                raise ValueError(f"zone {name!r}: an x-range [x0, x1] needs arena.size")
            if arr[1] < arr[0]:
                raise ValueError(f"zone {name!r}: x-range needs x1>=x0")
            return [float(arr[0]), 0.0, float(arr[1]), float(size[1])]
        raise ValueError(f"zone {name!r}: need [x0,x1], [x0,y0,x1,y1] or a polygon")
    poly = np.asarray(z, dtype=float)
    if poly.ndim != 2 or poly.shape[1] != 2 or poly.shape[0] < 3:
        raise ValueError(f"zone {name!r}: a polygon needs at least 3 [x, y] vertices")
    return poly.tolist()


# --------------------------------------------------------------------------- helpers


def _resolve(path_or_config) -> Path:
    p = Path(path_or_config)
    if p.is_dir():
        for n in _CONFIG_NAMES:
            if (p / n).exists():
                return p / n
        raise FileNotFoundError(f"no {' or '.join(_CONFIG_NAMES)} in {p}")
    if not p.exists():
        raise FileNotFoundError(f"session config not found: {p}")
    return p


def _file(base: Path, rel: str, field: str) -> Path:
    p = base / rel
    if not p.exists():
        raise FileNotFoundError(f"{field}: file not found: {p}")
    return p


def _wrap(field: str, path: Path, fn, *a, **k):
    try:
        return fn(*a, **k)
    except (ValueError, KeyError) as e:
        msg = e.args[0] if isinstance(e, KeyError) and e.args else str(e)
        raise ValueError(f"{field} ({path.name}): {msg}") from e


def _timestamps(base: Path, rel: str, field: str) -> tuple[np.ndarray, np.ndarray]:
    p = _file(base, rel, field)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")  # backwards stamps are an error here, below
        frames, t = _wrap(field, p, _read_timestamps, p)
    bad = np.flatnonzero(np.diff(t) <= 0)
    if bad.size:
        i = int(bad[0]) + 1
        raise ValueError(
            f"{field} ({p.name}): time must be strictly increasing, but row {i} "
            f"(frame {int(frames[i])}) is {t[i] * 1000:g} ms after {t[i - 1] * 1000:g} ms"
        )
    return frames, t


def _load_activity(base: Path, rel: str, cfg: NeuralConfig, field: str) -> np.ndarray:
    p = _file(base, rel, field)
    if p.suffix == ".npz":
        with np.load(p, allow_pickle=False) as z:
            if cfg.key is None or cfg.key not in z.files:
                raise ValueError(f"{field} ({p.name}): set neural.key to one of {sorted(z.files)}")
            a = z[cfg.key]
    else:
        a = np.load(p, allow_pickle=False)
    if a.ndim != 2:
        raise ValueError(f"{field} ({p.name}): need a 2-D array, got shape {a.shape}")
    a = np.asarray(a, dtype=np.float64)
    return a.T if cfg.orientation == "frames_x_cells" else a


def _cell_ids(base: Path, cfg: NeuralConfig, n_cells: int) -> list[str] | None:
    ids = cfg.cell_ids
    if ids is None:
        return None
    if isinstance(ids, str):
        p = _file(base, ids, "neural.cell_ids")
        if p.suffix == ".npy":
            ids = [str(v) for v in np.load(p, allow_pickle=False).ravel()]
        else:
            ids = [ln.strip() for ln in p.read_text().splitlines() if ln.strip()]
    if len(ids) != n_cells:
        raise ValueError(f"neural.cell_ids: {len(ids)} ids for {n_cells} cells")
    return [str(i) for i in ids]


def _check_frames(csv: Path, column: str, frames: np.ndarray, field: str) -> None:
    df = pd.read_csv(csv)
    cols = {str(c).strip().lower(): c for c in df.columns}
    if column.lower() not in cols:
        raise ValueError(
            f"{field}.frame_column ({csv.name}): no column {column!r}; found {list(df.columns)}"
        )
    f = pd.to_numeric(df[cols[column.lower()]], errors="coerce").to_numpy()
    if np.isnan(f).any():
        raise ValueError(f"{field} ({csv.name}): non-numeric frame number in {column!r}")
    absent = np.setdiff1d(f.astype(np.int64), frames)
    if absent.size:
        raise ValueError(
            f"{field} ({csv.name}): {absent.size} frame number(s) in {column!r} are not in the "
            f"timestamps file (first: {int(absent[0])}); frames must be a subset"
        )


def _info(cfg: SessionDirConfig, user: SessionInfo | None) -> SessionInfo:
    focal = cfg.subjects.focal if cfg.subjects else None
    extra = {}
    if cfg.subjects and cfg.subjects.stimulus:
        extra["stimulus"] = dict(cfg.subjects.stimulus)
    base = SessionInfo(animal=focal or cfg.name, session_id=cfg.name, extra=extra)
    if user is None:
        return base
    return base.model_copy(update={k: getattr(user, k) for k in user.model_fields_set})


# --------------------------------------------------------------------------- the loader


def load_session_dir(
    path_or_config,
    *,
    activity: str | None = None,
    info: SessionInfo | None = None,
    resample: bool = True,
) -> Session:
    """Load a session folder described by a config file into a :class:`~cabana.Session`.

    Parameters
    ----------
    path_or_config : str or Path
        A directory holding ``session.yaml`` (or ``config.yaml``), or the YAML itself.  File
        paths inside are relative to the YAML.  See :class:`SessionDirConfig`.
    activity : str, optional
        Load ``neural.alternatives[activity]`` (``activity_kind`` becomes that name) instead of
        ``neural.file``.
    info : SessionInfo, optional
        Fields set here override what the config provides (``animal`` from ``subjects.focal`` or
        ``name``, ``session_id`` from ``name``).
    resample : bool, default True
        Also build the neural-clock products: position and extra signals resampled onto the
        neural frames (``max_gap_s``), ``head_w/x/y/z`` and ``head_direction``, and one state
        space per ``behavior.epochs`` entry.  ``False`` keeps only the raw inputs in
        ``session.behavior`` (on their own clocks) for you to process.

    Returns
    -------
    Session
        With ``meta["timing"]`` (``timing_report`` of each clock), ``meta["arena"]``,
        ``meta["enclosures"]``, ``meta["subjects"]``, ``meta["source"] == "session_dir"``,
        ``meta["config_path"]`` and, when given, ``meta["neural_alternatives"]``.

    Raises
    ------
    FileNotFoundError
        A configured file is missing (the message names the field).
    ValueError
        Invalid config, or data that contradicts it: neural frames differ from the timestamps,
        position frames not in the timestamps, head-orientation rows differ from the neural
        frames, epochs stopping before they start, time not strictly increasing.  Messages name
        the field and the file.
    """
    cfg_path = _resolve(path_or_config)
    base = cfg_path.parent
    cfg = SessionDirConfig.from_yaml(cfg_path)
    nc, bc = cfg.neural, cfg.behavior

    # neural
    rel = nc.file
    kind: str = nc.kind
    if activity is not None and activity != nc.kind:
        if activity not in nc.alternatives:
            raise KeyError(
                f"activity={activity!r}: not neural.kind ({nc.kind!r}) nor in "
                f"neural.alternatives {sorted(nc.alternatives)}"
            )
        rel, kind = nc.alternatives[activity], activity
    act = _load_activity(base, rel, nc, "neural.file")
    n_frames = act.shape[1]
    timing: dict[str, Any] = {}
    if nc.timestamps is not None:
        n_frame_ids, t = _timestamps(base, nc.timestamps, "neural.timestamps")
        if t.size != n_frames:
            raise ValueError(
                f"neural.file ({Path(rel).name}) has {n_frames} frames but neural.timestamps "
                f"({Path(nc.timestamps).name}) has {t.size}; check neural.orientation "
                f"(currently {nc.orientation})"
            )
    else:
        if nc.fs is None:
            raise ValueError("neural: give timestamps (a timeStamps.csv) or fs")
        t = np.arange(n_frames) / nc.fs
        n_frame_ids = np.arange(n_frames, dtype=np.int64)
    timing["neural"] = timing_report(t, nc.fs) if t.size > 1 else {}
    fs = timing["neural"]["fs_mean"]
    ids = _cell_ids(base, nc, act.shape[0])

    # behavior inputs, on their own clock
    behavior: dict[str, Any] = {}
    b_frames, b_t = n_frame_ids, t  # fall back to the neural frames when no behavior stamps
    if bc.timestamps is not None:
        b_frames, b_t = _timestamps(base, bc.timestamps, "behavior.timestamps")
        timing["behavior"] = timing_report(b_t)
        if bc.clock is not None:
            timing["behavior"]["clock"] = bc.clock.model_dump()
    clock = bc.clock

    def tabular(field: str, c: PositionConfig | SignalConfig) -> ContinuousSignal:
        p = _file(base, c.file, f"{field}.file")
        _check_frames(p, c.frame_column, b_frames, field)
        tt, v = _wrap(
            field,
            p,
            load_position_csv,
            p,
            timestamps=(base / bc.timestamps) if bc.timestamps else t,
            frame_column=c.frame_column,
            columns=tuple(c.columns),
            missing_value=c.missing_value,
        )
        if clock is not None:
            from .._alignment import apply_clock

            tt = apply_clock(tt, clock.offset_s, clock.scale)
        return ContinuousSignal(t=tt, values=v, channel_names=list(c.columns), units=c.units)

    units: dict[str, str] = {}
    resample_specs: list[dict[str, Any]] = []
    if bc.position is not None:
        behavior["position"] = tabular("behavior.position", bc.position)
        units.update({c: bc.position.units for c in bc.position.columns})
        resample_specs.append(
            {"name": "resample_signal", "source": "position", "max_gap_s": bc.position.max_gap_s}
        )
    for k, sc in bc.signals.items():
        behavior[k] = tabular(f"behavior.signals.{k}", sc)
        units.update({c: sc.units for c in sc.columns if sc.units})
        resample_specs.append({"name": "resample_signal", "source": k, "max_gap_s": sc.max_gap_s})
    ho = bc.head_orientation
    if ho is not None:
        p = _file(base, ho.file, "behavior.head_orientation.file")
        n_rows = len(pd.read_csv(p))
        if n_rows != t.size:
            raise ValueError(
                f"behavior.head_orientation ({p.name}) has {n_rows} rows but there are "
                f"{t.size} neural frames; it must have one row per neural frame"
            )
        th, quat = _wrap("behavior.head_orientation", p, load_head_orientation, p, timestamps=t)
        behavior["head"] = ContinuousSignal(
            t=th, values=quat, channel_names=[f"head_{c}" for c in "wxyz"]
        )
        resample_specs.append({"name": "resample_signal", "source": "head"})
    span = (float(t[0]), float(t[-1]) + 1.0 / fs)  # half-open: keep the last frame
    for k, ec in bc.epochs.items():
        p = _file(base, ec.file, f"behavior.epochs.{k}.file")
        behavior[f"{k}_epochs"] = _wrap(
            f"behavior.epochs.{k}", p, load_epochs_csv, p, scored_span=span
        )

    # arena, subjects
    meta: dict[str, Any] = {
        "source": "session_dir",
        "config_path": str(cfg_path),
        "timing": timing,
        "signal_units": units,
    }
    if cfg.name is not None:
        meta["name"] = cfg.name
    if cfg.arena is not None:
        a = cfg.arena
        encl = {
            k: {"center": list(e.center), "radius": e.radius, "contents": e.contents}
            for k, e in a.enclosures.items()
            if isinstance(e, EnclosureConfig)
        }
        meta["arena"] = {
            "size": a.size,
            "units": a.units,
            "zones": dict(a.zones),
            "enclosures": encl,
            "dividers": a.dividers,
        }
        meta["enclosures"] = encl
    if cfg.subjects is not None:
        meta["subjects"] = cfg.subjects.model_dump()
    if nc.alternatives:
        meta["neural_alternatives"] = dict(nc.alternatives)

    ses = Session(
        activity=act,
        t=t,
        fs=fs,
        activity_kind=kind,
        cell_ids=ids,
        info=_info(cfg, info),
        behavior=behavior,
        meta=meta,
    )
    if not resample:
        return ses

    from .._registry import build

    for spec in resample_specs:
        ses = build("transform", spec).apply(ses)
    if ho is not None:
        ses = build(
            "transform",
            {"name": "head_direction", "quaternion": "head", "output": ho.output,
             "offset_deg": ho.offset_deg},
        ).apply(ses)  # fmt: skip
    for k, ec in bc.epochs.items():
        ses = build(
            "transform",
            {"name": "bouts_to_states", "source": f"{k}_epochs", "exclusive": ec.exclusive,
             "merge_gap_s": ec.merge_gap_s, "min_duration_s": ec.min_duration_s, "output": k},
        ).apply(ses)  # fmt: skip
    return ses


_TEMPLATE = """\
# Session-folder config for cabana.loaders.load_session_dir.  All paths are relative to this file.
name: session01                      # becomes info.session_id (and info.animal if no focal animal)

neural:
  file: neural_deconvolved.npy       # .npy, or .npz plus `key: name`
  orientation: cells_x_frames        # or frames_x_cells (the session always holds cells x frames)
  kind: deconvolved                  # deconvolved | denoised | raw | dff | spike_counts | binary
  timestamps: neural_timestamps.csv  # Miniscope timeStamps.csv; omit it and give `fs` instead
  # fs: 30.0
  # cell_ids: [c0, c1]               # or a text / .npy file with one id per cell
  alternatives:                      # other layers, recorded but not loaded; activity="denoised"
    denoised: neural_denoised.npy    # loads one of them instead

behavior:
  timestamps: behavior_timestamps.csv   # the camera's own clock; same zero as the neural clock
  # clock: {offset_s: 0.0, scale: 1.0}  # only if that clock needs mapping: scale * (t - offset_s)
  position:
    file: position.csv               # frame, x, y (no time column: joined by frame number)
    frame_column: frame
    columns: [x, y]
    missing_value: -1                # a row with every column equal to this is a lost frame (NaN)
    units: cm
    max_gap_s: 0.5                   # do not interpolate across longer tracking gaps
  head_orientation:
    file: headOrientation.csv        # one quaternion per neural frame
    format: quaternion_wxyz
    output: head_direction           # signal name; head_w/x/y/z are written too
    offset_deg: 0.0                  # calibrate the sensor's arbitrary zero heading
  # signals:                         # extra tabular signals, same join rule as position
  #   wheel: {file: wheel.csv, columns: [speed]}
  epochs:                            # annotation CSVs: label, start_s, stop_s (session clock)
    zones: {file: zone_annotations.csv, exclusive: true, merge_gap_s: 0.5, min_duration_s: 0.5}
    investigation: {file: investigation_annotations.csv, exclusive: false, merge_gap_s: 0.5, min_duration_s: 0.5}

arena:
  size: [60, 30]
  units: cm
  zones:                             # rect [x0,y0,x1,y1], polygon [[x,y],...] or x-range [x0,x1]
    left: [0, 20]
    center: [20, 40]
    right: [40, 60]
  enclosures:                        # cups the subject cannot enter
    left_cup: {center: [0, 15], radius: 9, contents: stimulus}
    right_cup: {center: [60, 15], radius: 9, contents: empty}
  # dividers: recorded only

subjects:
  focal: mouse01
  stimulus: {left_cup: mouse02, right_cup: null}
"""


def write_session_dir_template(path, *, overwrite: bool = False) -> Path:
    """Write a commented example config; ``path`` is a directory (``session.yaml`` inside) or a file.

    The template parses with :class:`SessionDirConfig`.  Returns the path written.
    """
    p = Path(path)
    if p.suffix not in (".yaml", ".yml"):
        p.mkdir(parents=True, exist_ok=True)
        p = p / "session.yaml"
    if p.exists() and not overwrite:
        raise FileExistsError(f"{p} exists; pass overwrite=True")
    p.write_text(_TEMPLATE)
    return p


__all__ = ["SessionDirConfig", "load_session_dir", "write_session_dir_template"]
