"""Behaviour signal transforms: gap interpolation, smoothing, heading, distance, arena calibration.

All transforms here work on per-frame signals already on the neural clock (``Session.signals``;
put behaviour signals there with ``resample_signal`` first).  A *position* is named by a prefix:
the pair of signals ``{prefix}_x`` / ``{prefix}_y`` (the DeepLabCut channel names, e.g.
``"nose"``), or ``""`` for plain ``x`` / ``y`` (the output of ``dlc_centroid``).

Signal units are recorded in ``session.meta["signal_units"][name]`` (informational, like
``ContinuousSignal.units``; nothing converts between units).
"""

from __future__ import annotations

from typing import ClassVar, Literal

import numpy as np
from pydantic import Field, model_validator

from .._models import BoutTable, Session, StateSpace
from .._registry import Transform, register
from .._util import runs

_AXES = ("x", "y")


def _xy_names(prefix: str) -> tuple[str, str]:
    return (f"{prefix}_x", f"{prefix}_y") if prefix else _AXES


def _has_xy(session: Session, prefix: str) -> bool:
    return all(n in session.signals for n in _xy_names(prefix))


def _get_xy(session: Session, prefix: str) -> np.ndarray:
    """``(n_time, 2)`` float array of the position named ``prefix``."""
    if not _has_xy(session, prefix):
        raise KeyError(
            f"position {prefix!r} needs signals {list(_xy_names(prefix))}; available: "
            f"{sorted(session.signals)}. Run resample_signal(source=...) first to put "
            "behavior signals on the neural clock"
        )
    return np.stack([np.asarray(session.signals[n], float) for n in _xy_names(prefix)], axis=1)


def _units_of(session: Session, name: str) -> str:
    return str(session.meta.get("signal_units", {}).get(name, ""))


def _set_units(session: Session, names: list[str], units: str) -> Session:
    info = {**session.meta.get("signal_units", {}), **{n: units for n in names}}
    return session.replace(meta={**session.meta, "signal_units": info})


def _resolve_signals(session: Session, name: str) -> list[str]:
    """Exact signal ``name``, else the position pair ``{name}_x`` / ``{name}_y``."""
    if name in session.signals:
        return [name]
    if _has_xy(session, name):
        return list(_xy_names(name))
    raise KeyError(
        f"signal {name!r} not found (nor {list(_xy_names(name))}); available: "
        f"{sorted(session.signals)}"
    )


def _odd_frames(window_s: float, fs: float) -> int:
    w = max(1, round(window_s * fs))
    return w if w % 2 else w + 1


class _SignalFilter(Transform):
    """Shared plumbing: apply a 1-D function to every resolved signal."""

    signal: str | list[str] = Field(
        ...,
        description=(
            "Signal name(s) in session.signals.  A name that is not a signal but has "
            "`{name}_x` / `{name}_y` signals (a DeepLabCut bodypart) expands to both."
        ),
    )
    output: str | None = Field(
        None,
        description=(
            "Suffix appended to each input signal's name for the output (e.g. '_smooth'); "
            "None or '' overwrites the signal in place."
        ),
    )

    def _fn(self, v: np.ndarray, session: Session) -> tuple[np.ndarray, int]:
        raise NotImplementedError

    def apply(self, session: Session) -> Session:
        names: list[str] = []
        for s in [self.signal] if isinstance(self.signal, str) else self.signal:
            names += _resolve_signals(session, s)
        out = session
        total = 0
        counts: dict[str, int] = {}
        for n in names:
            v = np.asarray(session.signals[n], float)
            if v.ndim != 1:
                raise ValueError(f"signal {n!r} must be 1-D per frame, got shape {v.shape}")
            res, k = self._fn(v, session)
            dest = n + (self.output or "")
            out = out.with_signal(dest, res)
            units = _units_of(session, n)
            if units:
                out = _set_units(out, [dest], units)
            counts[dest] = k
            total += k
        return self._record(out, counts, total)

    def _record(self, session: Session, counts: dict[str, int], total: int) -> Session:
        return session


@register("transform")
class InterpolateGaps(_SignalFilter):
    """Fill short NaN runs (tracking dropouts) in per-frame signals.

    A run of NaN is filled when its duration, ``n_frames / fs``, is at most ``max_gap_s``;
    longer runs stay NaN (and so propagate into support masks as before).  Runs touching the
    start or end of the session have no neighbour on one side and are never filled (no
    extrapolation).  Methods: ``linear`` (between the neighbouring finite samples), ``nearest``
    (the closer neighbour; the earlier on a tie) and ``ffill`` (hold the last finite value).
    The number of filled frames per signal is recorded in ``meta["interpolate_gaps"]``.
    """

    name: ClassVar[str] = "interpolate_gaps"

    max_gap_s: float = Field(0.5, ge=0, description="Longest NaN run to fill, seconds.")
    method: Literal["linear", "nearest", "ffill"] = Field("linear", description="Fill rule.")

    def _fn(self, v: np.ndarray, session: Session) -> tuple[np.ndarray, int]:
        out = v.copy()
        max_frames = int(np.floor(self.max_gap_s * session.fs + 1e-9))
        starts, lens = runs(np.isnan(v))
        n = v.size
        filled = 0
        for a, ln in zip(starts, lens, strict=True):
            b = a + ln  # first finite index after the run
            if ln > max_frames or a == 0 or b >= n:
                continue
            left, right = v[a - 1], v[b]
            k = np.arange(1, ln + 1)
            if self.method == "linear":
                out[a:b] = left + (right - left) * k / (ln + 1)
            elif self.method == "ffill":
                out[a:b] = left
            else:
                out[a:b] = np.where(k <= ln + 1 - k, left, right)
            filled += int(ln)
        return out, filled

    def _record(self, session: Session, counts: dict[str, int], total: int) -> Session:
        prev = dict(session.meta.get("interpolate_gaps", {}))
        for k, c in counts.items():
            prev[k] = prev.get(k, 0) + c
        return session.replace(meta={**session.meta, "interpolate_gaps": prev})


def _nan_sliding(v: np.ndarray, w: int) -> np.ndarray:
    pad = w // 2
    padded = np.concatenate([np.full(pad, np.nan), v, np.full(pad, np.nan)])
    return np.lib.stride_tricks.sliding_window_view(padded, w)


@register("transform")
class SmoothSignal(_SignalFilter):
    """NaN-aware smoothing of per-frame signals.

    ``window_s`` is the full window width; it is converted to an odd number of frames
    (at least 1).  Only finite frames contribute, and frames that are NaN in the input stay NaN
    (smoothing never invents data in a gap).  Methods: ``median`` (nan-median over the window;
    robust to tracking jumps), ``gaussian`` (kernel sigma = window / 4, normalised over the
    finite samples) and ``savgol`` (local polynomial of order ``polyorder`` fitted by least
    squares to the finite samples in the window; the window is widened to at least
    ``polyorder + 1`` frames; near edges and gaps the fit uses the finite samples available,
    and frames with too few of them keep their raw value).
    """

    name: ClassVar[str] = "smooth_signal"

    method: Literal["median", "gaussian", "savgol"] = Field("median", description="Filter.")
    window_s: float = Field(0.25, gt=0, description="Window width, seconds.")
    polyorder: int = Field(
        2,
        ge=0,
        description="Polynomial order (savgol only).",
        json_schema_extra={"ui": {"sweepable": False}},
    )

    def _fn(self, v: np.ndarray, session: Session) -> tuple[np.ndarray, int]:
        w = _odd_frames(self.window_s, session.fs)
        fin = np.isfinite(v)
        if w == 1 or not fin.any():
            return v.copy(), 0
        if self.method == "median":
            import warnings

            with warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                out = np.nanmedian(_nan_sliding(v, w), axis=1)
        elif self.method == "gaussian":
            sigma = w / 4.0
            k = np.exp(-0.5 * (np.arange(-(w // 2), w // 2 + 1) / sigma) ** 2)
            num = np.convolve(np.where(fin, v, 0.0), k, mode="same")
            den = np.convolve(fin.astype(float), k, mode="same")
            with np.errstate(invalid="ignore", divide="ignore"):
                out = num / den
        else:
            out = self._savgol(v, max(w, self.polyorder + 1))
        out = np.where(fin, out, np.nan)
        return out, 0

    def _savgol(self, v: np.ndarray, w: int) -> np.ndarray:
        w = w if w % 2 else w + 1
        h = w // 2
        off = np.arange(-h, h + 1, dtype=float)
        vand = np.vander(off, self.polyorder + 1, increasing=True)
        coef = np.linalg.pinv(vand)[0]  # value of the fitted polynomial at the window centre
        win = _nan_sliding(v, w)
        full = np.isfinite(win).all(axis=1)
        out = v.copy()
        out[full] = win[full] @ coef
        for i in np.flatnonzero(~full & np.isfinite(v)):
            ok = np.isfinite(win[i])
            if ok.sum() > self.polyorder:
                c = np.linalg.lstsq(vand[ok], win[i][ok], rcond=None)[0]
                out[i] = c[0]
        return out


def _quaternion(session: Session, name: str) -> np.ndarray:
    """Unnormalised ``(n_time, 4)`` w,x,y,z array from a 2-D signal or ``{name}_w/_x/_y/_z``."""
    if name in session.signals and np.asarray(session.signals[name]).ndim == 2:
        arr = np.asarray(session.signals[name], float)
        if arr.shape[1] != 4:
            raise ValueError(f"quaternion signal {name!r} needs 4 channels, got {arr.shape[1]}")
        return arr
    names = [f"{name}_{c}" for c in "wxyz"]
    missing = [n for n in names if n not in session.signals]
    if missing:
        raise KeyError(
            f"quaternion {name!r} needs a (n_time, 4) signal or signals {names}; "
            f"missing {missing}; available: {sorted(session.signals)}"
        )
    return np.stack([np.asarray(session.signals[n], float) for n in names], axis=1)


@register("transform")
class HeadDirection(Transform):
    """Heading angle, from two points or from an orientation quaternion.

    **Convention.**  0 points along +x (east), positive angles are counter-clockwise in a y-up
    frame (image coordinates, with y down, flip the sense), wrapped to ``(-pi, pi]`` (or
    ``(-180, 180]`` degrees).  ``unwrap=True`` removes the 2*pi jumps across finite frames (NaN
    gaps are bridged), giving an unbounded angle.  ``offset_deg`` is added before wrapping as a
    calibration offset.

    **Two input modes** (exactly one):

    * ``front`` and ``back`` position prefixes (e.g. ``"nose"``, ``"neck"`` for ``nose_x``,
      ``nose_y``, ...): ``atan2(front_y - back_y, front_x - back_x)``.  Frames where either
      point is NaN, or the two coincide, are NaN.
    * ``quaternion``: a 4-channel orientation signal in ``w, x, y, z`` order (e.g. Miniscope V4
      BNO), either a 2-D ``(n_time, 4)`` signal of that name or the four signals
      ``{name}_w, _x, _y, _z``.  ``yaw = atan2(2(wz + xy), 1 - 2(y^2 + z^2))``.  The
      quaternion is normalised first; NaN rows give NaN.

    Without calibration the zero of a quaternion yaw is arbitrary (the sensor's power-on
    heading, plus drift); set ``offset_deg`` from a known reference heading before comparing
    sessions or relating heading to arena landmarks.
    """

    name: ClassVar[str] = "head_direction"

    front: str | None = Field(None, description="Position prefix of the front point.")
    back: str | None = Field(None, description="Position prefix of the back point.")
    quaternion: str | None = Field(None, description="4-channel w,x,y,z orientation signal.")
    offset_deg: float = Field(0.0, description="Calibration offset added to the angle, degrees.")
    output: str = Field("head_direction", description="Name of the signal written.")
    units: Literal["rad", "deg"] = Field("rad", description="Angle units.")
    unwrap: bool = Field(False, description="Unwrap 2*pi jumps across finite frames.")

    @model_validator(mode="after")
    def _check(self) -> HeadDirection:
        pts = self.front is not None or self.back is not None
        if pts == (self.quaternion is not None):
            raise ValueError("give either front and back, or quaternion")
        if pts and (self.front is None or self.back is None):
            raise ValueError("front and back must both be given")
        return self

    def apply(self, session: Session) -> Session:
        if self.quaternion is not None:
            q = _quaternion(session, self.quaternion)
            norm = np.sqrt((q**2).sum(axis=1))
            with np.errstate(invalid="ignore", divide="ignore"):
                w, x, y, z = (q / norm[:, None]).T
            ang = np.arctan2(2 * (w * z + x * y), 1 - 2 * (y**2 + z**2))
            ang[~(norm > 0)] = np.nan
        else:
            d = _get_xy(session, self.front) - _get_xy(session, self.back)
            ang = np.arctan2(d[:, 1], d[:, 0])
            ang[(d == 0).all(axis=1)] = np.nan
        ang = ang + np.radians(self.offset_deg)
        if self.unwrap:
            ok = np.isfinite(ang)
            ang[ok] = np.unwrap(ang[ok])
        else:
            ang = np.where(np.isfinite(ang), -np.arctan2(np.sin(-ang), np.cos(-ang)), np.nan)
        if self.units == "deg":
            ang = np.degrees(ang)
        return _set_units(session.with_signal(self.output, ang), [self.output], self.units)


@register("transform")
class HeadOrientation(Transform):
    """Roll, pitch and yaw from an orientation quaternion (Miniscope V4 BNO).

    **Convention.**  Intrinsic Z-Y'-X'' Tait-Bryan angles in a head frame with x forward,
    y left and z up, ``q = q_z(yaw) * q_y(-pitch) * q_x(roll)`` for a ``w, x, y, z``
    quaternion (normalised first)::

        yaw   = atan2(2(wz + xy), 1 - 2(y^2 + z^2))     in (-180, 180]
        pitch = asin(clip(2(zx - wy), -1, 1))           in [-90, 90]
        roll  = atan2(2(wx + yz), 1 - 2(x^2 + y^2))     in (-180, 180]

    Positive yaw is counter-clockwise seen from above, positive pitch is nose up (a positive
    rotation about the left-pointing y axis tips the nose down, hence the sign) and positive
    roll lowers the right ear.

    ``yaw`` uses the same formula as :class:`HeadDirection`, so ``head_yaw`` equals
    ``head_direction`` in the same units.  ``q`` and ``-q`` give identical angles.  Rows with a
    zero norm or any NaN are NaN in all three outputs.  Units default to degrees, matching the
    ``circular_tuning`` metric.

    Near ``pitch = +-90`` degrees (gimbal lock) yaw and roll become ill-defined individually
    (only their sum or difference is constrained): do not interpret them there.

    The axes are those of the sensor.  If the IMU is not mounted with x forward, y left and z
    up relative to the head, pitch and roll swap or change sign, so check against a known
    movement: rearing should give positive pitch.  ``yaw_offset_deg`` is a calibration offset added to yaw before
    wrapping (the sensor's power-on zero is arbitrary).
    """

    name: ClassVar[str] = "head_orientation"

    quaternion: str = Field(
        "head",
        description="w,x,y,z orientation: a (n_time, 4) signal of this name or {name}_w.._z.",
    )
    prefix: str = Field("head", description="Outputs are {prefix}_yaw, _pitch and _roll.")
    units: Literal["deg", "rad"] = Field("deg", description="Angle units.")
    yaw_offset_deg: float = Field(0.0, description="Calibration offset added to yaw, degrees.")
    unwrap_yaw: bool = Field(False, description="Unwrap 2*pi jumps in yaw across finite frames.")

    def apply(self, session: Session) -> Session:
        q = _quaternion(session, self.quaternion)
        norm = np.sqrt((q**2).sum(axis=1))
        with np.errstate(invalid="ignore", divide="ignore"):
            w, x, y, z = (q / norm[:, None]).T
        yaw = np.arctan2(2 * (w * z + x * y), 1 - 2 * (y**2 + z**2))
        pitch = np.arcsin(np.clip(2 * (z * x - w * y), -1, 1))
        roll = np.arctan2(2 * (w * x + y * z), 1 - 2 * (x**2 + y**2))
        bad = ~(norm > 0) | ~np.isfinite(q).all(axis=1)
        yaw, pitch, roll = (np.where(bad, np.nan, a) for a in (yaw, pitch, roll))
        yaw = yaw + np.radians(self.yaw_offset_deg)
        if self.unwrap_yaw:
            ok = np.isfinite(yaw)
            yaw[ok] = np.unwrap(yaw[ok])
        else:
            yaw = np.where(np.isfinite(yaw), -np.arctan2(np.sin(-yaw), np.cos(-yaw)), np.nan)
        out = {"yaw": yaw, "pitch": pitch, "roll": roll}
        names = []
        for k, a in out.items():
            names.append(f"{self.prefix}_{k}")
            session = session.with_signal(names[-1], np.degrees(a) if self.units == "deg" else a)
        return _set_units(session, names, self.units)


@register("transform")
class Distance(Transform):
    """Euclidean distance between two positions, or from a position to a fixed point.

    ``a`` is a position prefix; give exactly one of ``b`` (another position prefix, e.g. a
    partner animal) or ``point`` (``[x, y]`` in the units of ``a``, e.g. a cup or zone centre).
    Units are those of ``a``'s ``x`` signal (from ``meta["signal_units"]``).  NaN in either
    input gives NaN.
    """

    name: ClassVar[str] = "distance"

    a: str = Field(..., description="Position prefix.")
    b: str | None = Field(None, description="Second position prefix.")
    point: list[float] | None = Field(None, description="Fixed [x, y] in a's units.")
    output: str = Field("distance", description="Name of the signal written.")

    @model_validator(mode="after")
    def _check(self) -> Distance:
        if (self.b is None) == (self.point is None):
            raise ValueError("give exactly one of b or point")
        if self.point is not None and len(self.point) != 2:
            raise ValueError("point needs two values [x, y]")
        return self

    def apply(self, session: Session) -> Session:
        pa = _get_xy(session, self.a)
        pb = _get_xy(session, self.b) if self.b is not None else np.asarray(self.point, float)
        dist = np.sqrt(((pa - pb) ** 2).sum(axis=1))
        out = session.with_signal(self.output, dist)
        return _set_units(out, [self.output], _units_of(session, _xy_names(self.a)[0]))


def fit_homography(src: np.ndarray, dst: np.ndarray) -> np.ndarray:
    """3x3 homography mapping ``src`` to ``dst`` (``(k, 2)`` points, ``k >= 4``), numpy only.

    Direct linear transform: the least-squares solution of ``A h = 0`` is the right singular
    vector of the smallest singular value; with exactly 4 non-degenerate points it maps them
    exactly.  Points are normalised (centred, unit mean distance) for conditioning.
    """
    src, dst = np.asarray(src, float), np.asarray(dst, float)
    if src.shape != dst.shape or src.ndim != 2 or src.shape[1] != 2 or src.shape[0] < 4:
        raise ValueError("need matching (k, 2) point arrays with k >= 4")

    def norm(p):
        c = p.mean(axis=0)
        s = np.sqrt(2) / max(np.sqrt(((p - c) ** 2).sum(axis=1)).mean(), 1e-12)
        return np.array([[s, 0, -s * c[0]], [0, s, -s * c[1]], [0, 0, 1.0]])

    ts, td = norm(src), norm(dst)
    sh = np.c_[src, np.ones(len(src))] @ ts.T
    dh = np.c_[dst, np.ones(len(dst))] @ td.T
    rows = []
    for (x, y, _), (u, v, _) in zip(sh, dh, strict=True):
        rows.append([-x, -y, -1, 0, 0, 0, u * x, u * y, u])
        rows.append([0, 0, 0, -x, -y, -1, v * x, v * y, v])
    h = np.linalg.svd(np.asarray(rows))[2][-1].reshape(3, 3)
    h = np.linalg.inv(td) @ h @ ts
    return h / h[2, 2]


@register("transform")
class ArenaTransform(Transform):
    """Calibrate positions from pixels to arena units (scale / rotate / translate or homography).

    Two ways to specify the map (not both):

    * similarity: ``scale`` (a factor, or ``[sx, sy]``; e.g. ``1 / px_per_mm``) is applied first,
      then ``rotate_deg`` (counter-clockwise about the origin), then ``translate`` (``[dx, dy]``);
    * homography: ``corners_px`` and ``corners_mm`` (at least 4 corresponding points) give a
      projective map fitted by least squares (exact for 4 points); use it to remove perspective
      and to put the arena corner at the origin.

    ``signals`` are position prefixes (see the module docstring); results overwrite them when
    ``output_suffix`` is empty.  Units become ``"mm"`` when ``scale`` or the corners are given.
    """

    name: ClassVar[str] = "arena_transform"

    signals: list[str] = Field(..., description="Position prefixes to transform.")
    scale: float | list[float] | None = Field(None, description="Scale (px -> mm).")
    rotate_deg: float = Field(0.0, description="Counter-clockwise rotation, degrees.")
    translate: list[float] | None = Field(None, description="[dx, dy] added last.")
    corners_px: list[list[float]] | None = Field(None, description="Corner points, pixels.")
    corners_mm: list[list[float]] | None = Field(None, description="Same points, arena units.")
    output_suffix: str = Field("", description="Suffix for output names; '' = in place.")

    @model_validator(mode="after")
    def _check(self) -> ArenaTransform:
        homog = self.corners_px is not None or self.corners_mm is not None
        if homog:
            if self.corners_px is None or self.corners_mm is None:
                raise ValueError("give both corners_px and corners_mm")
            if self.scale is not None or self.rotate_deg != 0 or self.translate is not None:
                raise ValueError("corners_* cannot be combined with scale/rotate_deg/translate")
            fit_homography(np.asarray(self.corners_px), np.asarray(self.corners_mm))
        if isinstance(self.scale, list) and len(self.scale) != 2:
            raise ValueError("scale list needs [sx, sy]")
        if self.translate is not None and len(self.translate) != 2:
            raise ValueError("translate needs [dx, dy]")
        return self

    def _matrix(self) -> np.ndarray:
        if self.corners_px is not None:
            return fit_homography(np.asarray(self.corners_px), np.asarray(self.corners_mm))
        sx, sy = (
            (1.0, 1.0)
            if self.scale is None
            else (self.scale, self.scale)
            if isinstance(self.scale, int | float)
            else self.scale
        )
        th = np.radians(self.rotate_deg)
        rot = np.array([[np.cos(th), -np.sin(th), 0], [np.sin(th), np.cos(th), 0], [0, 0, 1.0]])
        tx, ty = self.translate or (0.0, 0.0)
        trans = np.array([[1, 0, tx], [0, 1, ty], [0, 0, 1.0]])
        return trans @ rot @ np.diag([sx, sy, 1.0])

    def apply(self, session: Session) -> Session:
        m = self._matrix()
        calibrated = self.scale is not None or self.corners_px is not None
        out = session
        for p in self.signals:
            xy = _get_xy(session, p)
            h = np.c_[xy, np.ones(len(xy))] @ m.T
            with np.errstate(invalid="ignore", divide="ignore"):
                new = h[:, :2] / h[:, 2:3]
            names = [n + self.output_suffix for n in _xy_names(p)]
            for n, col in zip(names, new.T, strict=True):
                out = out.with_signal(n, col)
            if calibrated:
                out = _set_units(out, names, "mm")
            else:
                u = _units_of(session, _xy_names(p)[0])
                if u:
                    out = _set_units(out, names, u)
        return out


def _in_polygon(xy: np.ndarray, poly: np.ndarray) -> np.ndarray:
    """Even-odd ray casting; NaN points are False."""
    x, y = xy[:, 0], xy[:, 1]
    inside = np.zeros(len(xy), bool)
    n = len(poly)
    with np.errstate(invalid="ignore", divide="ignore"):
        for i in range(n):
            x1, y1 = poly[i]
            x2, y2 = poly[(i + 1) % n]
            cross = (y1 > y) != (y2 > y)
            xint = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            inside ^= cross & (x < xint)
    return inside & np.isfinite(xy).all(axis=1)


@register("transform")
class ZoneOccupancy(Transform):
    """Turn a position into a state space with one state per zone (chambers, cup, centre...).

    Zones are polygons (``zones``: name to vertices ``[[x, y], ...]``, even-odd ray casting) or
    rectangles (``zones_rect``: name to ``[x0, y0, x1, y1]``, edges inclusive), in the units of
    the position signal.  Polygons come first in state order, then rectangles, each in dict
    order.  With ``exclusive=True`` (default) a frame inside several zones goes to the first
    listed (``kind="categorical"``); otherwise zones may overlap (``kind="bouts"``).  Frames
    outside every zone are "defined but in no state" (all-False row); frames with a NaN
    position are outside ``support``, also written to the ``{output}_valid`` mask.

    With ``zones_from_meta=True`` the zones of ``session.meta["arena"]["zones"]`` are added
    (after the explicit ones; a rect is 4 numbers, a polygon a list of ``[x, y]``).  Expected
    layout, which a loader may stash::

        meta["arena"] = {"size": [w, h], "units": "cm",
                         "zones": {name: rect | polygon},
                         "enclosures": {name: {"center": [x, y], "radius": r}}}

    ``enclosures`` are not read here; use ``distance(point=center)`` for them.
    """

    name: ClassVar[str] = "zone_occupancy"

    signal: str = Field(..., description="Position prefix (`{signal}_x`, `{signal}_y`).")
    zones: dict[str, list[list[float]]] = Field(
        default_factory=dict, description="Zone name -> polygon vertices."
    )
    zones_rect: dict[str, list[float]] = Field(
        default_factory=dict, description="Zone name -> [x0, y0, x1, y1]."
    )
    output: str = Field("zones", description="Name of the StateSpace written.")
    exclusive: bool = Field(True, description="One zone per frame (first listed wins).")
    zones_from_meta: bool = Field(
        False, description="Also read zones from session.meta['arena']['zones']."
    )

    @model_validator(mode="after")
    def _check(self) -> ZoneOccupancy:
        names = list(self.zones) + list(self.zones_rect)
        if not names and not self.zones_from_meta:
            raise ValueError("give at least one zone in zones or zones_rect")
        if len(set(names)) != len(names):
            raise ValueError(f"zone names must be unique: {names}")
        for k, poly in self.zones.items():
            if len(poly) < 3 or any(len(p) != 2 for p in poly):
                raise ValueError(f"zone {k!r} needs at least 3 [x, y] vertices")
        for k, r in self.zones_rect.items():
            if len(r) != 4 or r[2] < r[0] or r[3] < r[1]:
                raise ValueError(f"zone {k!r} needs [x0, y0, x1, y1] with x1>=x0, y1>=y0")
        return self

    def _all_zones(self, session: Session) -> tuple[dict, dict]:
        polys, rects = dict(self.zones), dict(self.zones_rect)
        if self.zones_from_meta:
            meta_z = session.meta.get("arena", {}).get("zones")
            if not meta_z:
                raise KeyError("zones_from_meta=True but session.meta['arena']['zones'] is empty")
            for k, z in meta_z.items():
                if k in polys or k in rects:
                    raise ValueError(f"zone {k!r} given both explicitly and in meta")
                arr = np.asarray(z, float)
                if arr.shape == (4,):
                    rects[k] = arr.tolist()
                elif arr.ndim == 2 and arr.shape[0] >= 3 and arr.shape[1] == 2:
                    polys[k] = arr.tolist()
                else:
                    raise ValueError(f"meta zone {k!r} must be [x0,y0,x1,y1] or [[x,y],...]")
        return polys, rects

    def apply(self, session: Session) -> Session:
        xy = _get_xy(session, self.signal)
        valid = np.isfinite(xy).all(axis=1)
        cols, names = [], []
        polys, rects = self._all_zones(session)
        for k, poly in polys.items():
            cols.append(_in_polygon(xy, np.asarray(poly, float)))
            names.append(k)
        for k, (x0, y0, x1, y1) in rects.items():
            cols.append(valid & (xy[:, 0] >= x0) & (xy[:, 0] <= x1))
            cols[-1] &= (xy[:, 1] >= y0) & (xy[:, 1] <= y1)
            names.append(k)
        onehot = np.stack(cols, axis=1)
        if self.exclusive:
            onehot &= onehot.cumsum(axis=1) == 1
        space = StateSpace(
            name=self.output,
            onehot=onehot,
            state_names=names,
            kind="categorical" if self.exclusive else "bouts",
            exclusive=self.exclusive,
            support=valid.copy(),
        )
        return session.with_state(space).with_mask(
            f"{self.output}_valid", valid, source=self.to_dict()
        )


@register("transform")
class InvestigationFromGeometry(Transform):
    """Social investigation derived from geometry: close to a target and facing it.

    A frame counts as investigating target ``k`` when the animal is within ``max_distance`` of
    the target **and** its heading points at the target to within ``max_angle_deg``.  The
    distance is measured to the enclosure *edge* (centre distance minus the radius) when the
    radius is known, which is how a person scores "sniffing the cup"; for a point target
    (no radius) it is the centre distance.  The bearing is ``atan2(target_y - y, target_x -
    x)`` and the heading follows the ``head_direction`` convention (0 = +x, counter-clockwise,
    radians), so ``|wrap(heading - bearing)| <= max_angle_deg``.  If the heading zero is
    arbitrary (a quaternion's power-on yaw), calibrate it with ``head_direction(offset_deg=)``
    before this step.

    Targets come from ``targets`` (name to ``[x, y]`` or ``[x, y, radius]``) or, with
    ``targets_from_meta=True`` and no ``targets``, from ``session.meta["enclosures"]`` (name to
    ``{"center": [x, y], "radius": r}``, as written by ``load_session_dir``).  One state per
    target, in that order.  ``exclusive=True`` gives a frame close to two targets to the nearer
    one (``kind="categorical"``); otherwise the states may overlap (``kind="bouts"``).
    Same-state runs separated by less than ``merge_gap_s`` are merged and runs shorter than
    ``min_duration_s`` dropped, the same cleanup as ``bouts_to_states``.  ``support`` is the
    frames with a finite position *and* heading, also written to the ``{output}_valid`` mask.
    """

    name: ClassVar[str] = "investigation_from_geometry"

    position: str = Field("", description="Position prefix (`{position}_x`, `{position}_y`).")
    heading: str = Field("head_direction", description="Heading signal, radians.")
    targets: dict[str, list[float]] | None = Field(
        None, description="Target name -> [x, y] or [x, y, radius], position units."
    )
    targets_from_meta: bool = Field(
        True, description="Without `targets`, read session.meta['enclosures']."
    )
    max_distance: float = Field(4.0, ge=0, description="Max distance to the target edge.")
    max_angle_deg: float = Field(45.0, gt=0, le=180, description="Max heading error, degrees.")
    merge_gap_s: float = Field(0.5, ge=0, description="Join runs separated by less than this.")
    min_duration_s: float = Field(0.5, ge=0, description="Drop runs shorter than this.")
    output: str = Field("investigation", description="Name of the StateSpace written.")
    exclusive: bool = Field(True, description="Nearest target wins when several qualify.")

    @model_validator(mode="after")
    def _check(self) -> InvestigationFromGeometry:
        for k, v in (self.targets or {}).items():
            if len(v) not in (2, 3):
                raise ValueError(f"target {k!r} needs [x, y] or [x, y, radius], got {v}")
            if len(v) == 3 and v[2] < 0:
                raise ValueError(f"target {k!r} has a negative radius")
        if self.targets is None and not self.targets_from_meta:
            raise ValueError("give targets, or leave targets_from_meta=True")
        return self

    def _targets(self, session: Session) -> dict[str, tuple[float, float, float]]:
        if self.targets is not None:
            return {k: (v[0], v[1], v[2] if len(v) == 3 else 0.0) for k, v in self.targets.items()}
        enc = session.meta.get("enclosures")
        if not enc:
            raise KeyError("no targets given and session.meta['enclosures'] is empty")
        out = {}
        for k, e in enc.items():
            c = e["center"]
            out[k] = (float(c[0]), float(c[1]), float(e.get("radius") or 0.0))
        return out

    def apply(self, session: Session) -> Session:
        if self.heading not in session.signals:
            raise KeyError(
                f"heading signal {self.heading!r} not found; available: {sorted(session.signals)}"
            )
        xy = _get_xy(session, self.position)
        head = np.asarray(session.signals[self.heading], float)
        valid = np.isfinite(xy).all(axis=1) & np.isfinite(head)
        tg = self._targets(session)
        lim = np.radians(self.max_angle_deg)
        cols, gaps = [], []
        with np.errstate(invalid="ignore"):
            for cx, cy, r in tg.values():
                dx, dy = cx - xy[:, 0], cy - xy[:, 1]
                gap = np.hypot(dx, dy) - r
                err = np.abs(
                    np.arctan2(np.sin(head - np.arctan2(dy, dx)), np.cos(head - np.arctan2(dy, dx)))
                )
                cols.append(valid & (gap <= self.max_distance) & (err <= lim))
                gaps.append(gap)
        onehot = np.stack(cols, axis=1)
        if self.exclusive and onehot.shape[1] > 1:
            g = np.where(onehot, np.stack(gaps, axis=1), np.inf)
            best = np.argmin(g, axis=1)
            onehot &= np.arange(onehot.shape[1])[None, :] == best[:, None]
        fs = session.fs
        for k in range(onehot.shape[1]):
            onehot[:, k] = _clean_runs(onehot[:, k], fs, self.merge_gap_s, self.min_duration_s)
        space = StateSpace(
            name=self.output,
            onehot=onehot,
            state_names=list(tg),
            kind="categorical" if self.exclusive else "bouts",
            exclusive=self.exclusive,
            support=valid.copy(),
        )
        out = session.with_state(space).with_mask(
            f"{self.output}_valid", valid, source=self.to_dict()
        )
        return out.replace(
            meta={
                **out.meta,
                self.name: {**self.to_dict(), "targets_used": {k: list(v) for k, v in tg.items()}},
            }
        )


def _clean_runs(v: np.ndarray, fs: float, merge_gap_s: float, min_duration_s: float) -> np.ndarray:
    """Merge True runs separated by < ``merge_gap_s`` and drop runs shorter than ``min_duration_s``."""
    v = v.copy()
    if merge_gap_s > 0:
        a, ln = runs(~v)
        for s0, n0 in zip(a.tolist(), ln.tolist(), strict=True):
            if s0 > 0 and s0 + n0 < v.size and n0 / fs < merge_gap_s:
                v[s0 : s0 + n0] = True
    if min_duration_s > 0:
        a, ln = runs(v)
        for s0, n0 in zip(a.tolist(), ln.tolist(), strict=True):
            if n0 / fs < min_duration_s - 1e-12:
                v[s0 : s0 + n0] = False
    return v


def states_to_bouts(
    states: StateSpace,
    fs: float,
    *,
    merge_gap_s: float = 0.0,
    min_duration_s: float = 0.0,
    t0: float = 0.0,
) -> BoutTable:
    """Frame labels to epochs: the inverse of ``bouts_to_states``, for exporting behaviours.

    Each state becomes a behavior; every run of True frames ``[i0, i1)`` becomes the bout
    ``[t0 + i0/fs, t0 + i1/fs)`` (so runs touching the first or last frame start at ``t0`` or
    end at ``t0 + n/fs``).  Same-state bouts separated by a gap shorter than ``merge_gap_s`` are
    merged first, then bouts shorter than ``min_duration_s`` are dropped (the same order as
    ``bouts_to_states``).  ``scored_start_s``/``scored_stop_s`` are taken from the first and
    last frame of ``states.support`` (``None`` if it has none).  Bouts are ordered by start.
    """
    if fs <= 0:
        raise ValueError("fs must be positive")
    labels: list[str] = []
    starts: list[float] = []
    stops: list[float] = []
    for k, name in enumerate(states.state_names):
        a, ln = runs(states.onehot[:, k])
        b = a + ln
        ms: list[list[int]] = []
        for x0, x1 in zip(a.tolist(), b.tolist(), strict=True):
            if ms and (x0 - ms[-1][1]) / fs < merge_gap_s:
                ms[-1][1] = x1
            else:
                ms.append([x0, x1])
        for x0, x1 in ms:
            if (x1 - x0) / fs >= min_duration_s - 1e-12:
                labels.append(name)
                starts.append(t0 + x0 / fs)
                stops.append(t0 + x1 / fs)
    order = np.argsort(starts, kind="stable")
    sup = None if states.support is None else np.flatnonzero(states.support)
    return BoutTable(
        labels=[labels[i] for i in order],
        start_s=np.asarray(starts, float)[order],
        stop_s=np.asarray(stops, float)[order],
        scored_start_s=None if sup is None or sup.size == 0 else t0 + sup[0] / fs,
        scored_stop_s=None if sup is None or sup.size == 0 else t0 + (sup[-1] + 1) / fs,
    )


__all__ = [
    "states_to_bouts",
    "ArenaTransform",
    "Distance",
    "HeadDirection",
    "InterpolateGaps",
    "InvestigationFromGeometry",
    "SmoothSignal",
    "ZoneOccupancy",
    "fit_homography",
]
