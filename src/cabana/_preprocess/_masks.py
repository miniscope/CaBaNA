"""Mask preprocessing: masks from states, mask expressions, bout cleanup of masks."""

from __future__ import annotations

import re
from typing import ClassVar

import numpy as np
from pydantic import Field, model_validator
from scipy.ndimage import binary_dilation, binary_erosion

from .._models import Session
from .._registry import PreprocessStep, register
from .._util import runs

_TOKEN = re.compile(r"\s*(?:([A-Za-z_][A-Za-z0-9_]*)|([&|~()])|(\S))")


def _tokenize(expr: str) -> list[tuple[str, str]]:
    toks: list[tuple[str, str]] = []
    pos = 0
    expr = expr.strip()
    if not expr:
        raise ValueError("empty mask expression")
    while pos < len(expr):
        m = _TOKEN.match(expr, pos)
        if m is None:  # only trailing whitespace
            break
        pos = m.end()
        if m.group(1):
            toks.append(("name", m.group(1)))
        elif m.group(2):
            toks.append(("op", m.group(2)))
        else:
            raise ValueError(
                f"invalid character {m.group(3)!r} in mask expression {expr!r}; "
                "allowed: mask names, & | ~ ( )"
            )
    return toks


def mask_expression(masks: dict[str, np.ndarray], expr: str) -> np.ndarray:
    """Evaluate a boolean expression over named masks (no ``eval``).

    Grammar (``~`` binds tighter than ``&``, which binds tighter than ``|``)::

        expr := term ('|' term)*
        term := factor ('&' factor)*
        factor := '~' factor | '(' expr ')' | NAME

    ``NAME`` is ``[A-Za-z_][A-Za-z0-9_]*`` and must be a key of ``masks``.

    Raises
    ------
    ValueError
        Empty expression, invalid character, or syntax error.
    KeyError
        A name is not in ``masks``.
    """
    toks = _tokenize(expr)
    i = 0

    def peek() -> tuple[str, str] | None:
        return toks[i] if i < len(toks) else None

    def parse_or() -> np.ndarray:
        nonlocal i
        v = parse_and()
        while peek() == ("op", "|"):
            i += 1
            v = v | parse_and()
        return v

    def parse_and() -> np.ndarray:
        nonlocal i
        v = parse_not()
        while peek() == ("op", "&"):
            i += 1
            v = v & parse_not()
        return v

    def parse_not() -> np.ndarray:
        nonlocal i
        t = peek()
        if t is None:
            raise ValueError(f"unexpected end of mask expression {expr!r}")
        i += 1
        if t == ("op", "~"):
            return ~parse_not()
        if t == ("op", "("):
            v = parse_or()
            if peek() != ("op", ")"):
                raise ValueError(f"missing ')' in mask expression {expr!r}")
            i += 1
            return v
        if t[0] == "name":
            if t[1] not in masks:
                raise KeyError(f"mask {t[1]!r} not found; available: {sorted(masks)}")
            return np.asarray(masks[t[1]], dtype=bool)
        raise ValueError(f"unexpected {t[1]!r} in mask expression {expr!r}")

    out = parse_or()
    if i != len(toks):
        raise ValueError(f"unexpected {toks[i][1]!r} in mask expression {expr!r}")
    return np.array(out, dtype=bool)


def clean_mask(
    mask: np.ndarray,
    fs: float,
    *,
    min_true_s: float = 0.0,
    min_false_s: float = 0.0,
    dilate_s: float = 0.0,
    erode_s: float = 0.0,
) -> np.ndarray:
    """Tidy a boolean mask.  Durations are rounded to whole frames (``round(s * fs)``).

    Order: (1) fill interior False gaps shorter than ``min_false_s``; (2) drop True
    runs shorter than ``min_true_s``; (3) erode by ``erode_s`` (each True run loses
    that much from both ends; the array edges are not treated as False); (4) dilate
    by ``dilate_s``.  Gaps are filled before short runs are dropped so that a
    jittery run is merged first and then judged as a whole; erode-then-dilate
    (an opening) removes thin spurs, and ``dilate_s`` last pads the final bouts.
    Leading and trailing False stretches are not "gaps" and are never filled.
    """
    m = np.array(mask, dtype=bool)
    n_gap = int(round(min_false_s * fs))
    if n_gap > 0 and m.any():
        starts, lengths = runs(~m)
        first, last = np.flatnonzero(m)[[0, -1]]
        for s, ln in zip(starts, lengths, strict=True):
            if s > first and s + ln - 1 < last and ln < n_gap:
                m[s : s + ln] = True
    n_run = int(round(min_true_s * fs))
    if n_run > 0:
        for s, ln in zip(*runs(m), strict=True):
            if ln < n_run:
                m[s : s + ln] = False
    n_er = int(round(erode_s * fs))
    if n_er > 0:
        m = binary_erosion(m, structure=np.ones(2 * n_er + 1, bool), border_value=1)
    n_di = int(round(dilate_s * fs))
    if n_di > 0:
        m = binary_dilation(m, structure=np.ones(2 * n_di + 1, bool))
    return m


@register("preprocess")
class MaskFromState(PreprocessStep):
    """Mask of frames in (or, with ``invert``, not in) some states of a state space.

    Semantics: ``in_state`` is True where any of the ``include`` states is active
    (``include=None``: any state at all).  The mask is ``in_state`` (or
    ``~in_state`` when ``invert``).  With ``require_support=True`` (default) it is
    then ANDed with the space's ``support``, so frames where the state space is
    undefined (unscored, untracked) are always False, even when inverted.  With
    ``require_support=False`` support is ignored: inverted masks are then True on
    unscored frames.  Example: exclude "sniff" from a place-cell analysis with
    ``include=["sniff"], invert=True``.
    """

    name: ClassVar[str] = "mask_from_state"

    states: str = Field(..., description="Name of the StateSpace in session.states.")
    include: list[str] | None = Field(
        None, description="State names to count as 'in state'; None = any state active."
    )
    invert: bool = Field(False, description="Mask frames NOT in those states.")
    require_support: bool = Field(
        True, description="AND the result with the state space's support (unknown frames False)."
    )
    output: str = Field(..., description="Name of the mask written.")

    def apply(self, session: Session) -> Session:
        if self.states not in session.states:
            raise KeyError(
                f"state space {self.states!r} missing; available: {sorted(session.states)}"
            )
        ss = session.states[self.states]
        if self.include is None:
            cols = np.arange(ss.n_states)
        else:
            unknown = [s for s in self.include if s not in ss.state_names]
            if unknown:
                raise KeyError(f"states {unknown} not in {self.states!r}: {ss.state_names}")
            cols = np.array([ss.state_names.index(s) for s in self.include], dtype=int)
        inside = np.asarray(ss.onehot)[:, cols].any(axis=1)
        m = ~inside if self.invert else inside
        if self.require_support and ss.support is not None:
            m = m & np.asarray(ss.support, dtype=bool)
        return session.with_mask(self.output, m, source=self.to_dict())


@register("preprocess")
class CombineMasks(PreprocessStep):
    """Write a mask from a boolean expression over existing masks, e.g. ``"speed & ~sniff"``.

    Operators ``~`` (not), ``&`` (and), ``|`` (or), parentheses; ``~`` binds tightest,
    then ``&``, then ``|``.  Evaluated by a small parser, never ``eval``.
    """

    name: ClassVar[str] = "combine_masks"

    expr: str = Field(..., description="Boolean expression over mask names, e.g. 'speed & ~sniff'.")
    output: str = Field(..., description="Name of the mask written.")

    @model_validator(mode="after")
    def _check(self) -> CombineMasks:
        _tokenize(self.expr)  # fail early on bad characters
        return self

    def apply(self, session: Session) -> Session:
        m = mask_expression(session.masks, self.expr)
        return session.with_mask(self.output, m, source=self.to_dict())


@register("preprocess")
class CleanMask(PreprocessStep):
    """Fill short gaps, drop short runs, erode, dilate a mask (see ``clean_mask`` for order)."""

    name: ClassVar[str] = "clean_mask"

    mask: str = Field(..., description="Name of the mask to clean.")
    min_true_s: float = Field(0.0, ge=0, description="Drop True runs shorter than this (s).")
    min_false_s: float = Field(
        0.0, ge=0, description="Fill interior False gaps shorter than this (s)."
    )
    dilate_s: float = Field(0.0, ge=0, description="Grow True runs by this much each side (s).")
    erode_s: float = Field(0.0, ge=0, description="Shrink True runs by this much each side (s).")
    output: str | None = Field(None, description="Name written; None overwrites ``mask``.")

    def apply(self, session: Session) -> Session:
        if self.mask not in session.masks:
            raise KeyError(f"mask {self.mask!r} missing; available: {sorted(session.masks)}")
        m = clean_mask(
            session.masks[self.mask],
            session.fs,
            min_true_s=self.min_true_s,
            min_false_s=self.min_false_s,
            dilate_s=self.dilate_s,
            erode_s=self.erode_s,
        )
        return session.with_mask(self.output or self.mask, m, source=self.to_dict())


@register("preprocess")
class MaskFromSignal(PreprocessStep):
    """Mask of frames where a signal lies in ``[min, max]`` (inclusive; None = unbounded).

    NaN frames get ``nan_is`` (default False).  For 2-D signals ``channel`` picks the column.
    Generalises ``SpeedThreshold``: e.g. distance-to-partner ``max=50``, likelihood ``min=0.9``.
    """

    name: ClassVar[str] = "mask_from_signal"

    signal: str = Field(..., description="Name of the signal in session.signals.")
    min: float | None = Field(None, description="Lower bound (inclusive); None = none.")
    max: float | None = Field(None, description="Upper bound (inclusive); None = none.")
    channel: int = Field(
        0,
        ge=0,
        description="Column of a 2-D signal to use.",
        json_schema_extra={"ui": {"sweepable": False}},
    )
    nan_is: bool = Field(False, description="Mask value assigned to NaN frames.")
    output: str = Field(..., description="Name of the mask written.")

    @model_validator(mode="after")
    def _check(self) -> MaskFromSignal:
        if self.min is None and self.max is None:
            raise ValueError("give at least one of min / max")
        if self.min is not None and self.max is not None and self.max < self.min:
            raise ValueError("max must be >= min")
        return self

    def apply(self, session: Session) -> Session:
        if self.signal not in session.signals:
            raise KeyError(f"signal {self.signal!r} missing; available: {sorted(session.signals)}")
        v = np.asarray(session.signals[self.signal], dtype=float)
        if v.ndim == 2:
            if self.channel >= v.shape[1]:
                raise ValueError(f"channel {self.channel} out of range for {v.shape[1]} columns")
            v = v[:, self.channel]
        nan = np.isnan(v)
        with np.errstate(invalid="ignore"):
            m = np.ones(v.shape, dtype=bool)
            if self.min is not None:
                m &= v >= self.min
            if self.max is not None:
                m &= v <= self.max
        m = np.where(nan, self.nan_is, m)
        return session.with_mask(self.output, m, source=self.to_dict())


__all__ = [
    "CleanMask",
    "CombineMasks",
    "MaskFromSignal",
    "MaskFromState",
    "clean_mask",
    "mask_expression",
]
