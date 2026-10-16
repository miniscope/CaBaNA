"""Containers for multi-session cohorts: cell registrations and session sets."""

from __future__ import annotations

import numpy as np
from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from ._models import Session


class CellMatch(BaseModel):
    """Registration of cells between two sessions (CellReg-style).

    Attributes
    ----------
    session_a, session_b : str
        Session ids.
    pairs : (n_pairs, 2) int
        ``pairs[k] = (cell index in a, cell index in b)``.
    confidence : (n_pairs,) float | None
        Match confidence (e.g. registration probability).
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    session_a: str
    session_b: str
    pairs: np.ndarray
    confidence: np.ndarray | None = None

    @field_validator("pairs", "confidence", mode="before")
    @classmethod
    def _as_array(cls, v):
        return v if v is None else np.asarray(v)

    @model_validator(mode="after")
    def _check(self) -> CellMatch:
        p = np.asarray(self.pairs)
        if p.size == 0:
            p = p.reshape(0, 2)
        if p.ndim != 2 or p.shape[1] != 2:
            raise ValueError(f"pairs must have shape (n_pairs, 2), got {p.shape}")
        if not np.issubdtype(p.dtype, np.integer):
            if not np.all(np.equal(np.mod(p, 1), 0)):
                raise ValueError("pairs must be integer cell indices")
        p = p.astype(np.int64)
        if (p < 0).any():
            raise ValueError("pairs must be non-negative cell indices")
        for col, name in ((0, self.session_a), (1, self.session_b)):
            if len(np.unique(p[:, col])) != p.shape[0]:
                raise ValueError(f"duplicate cells in session {name!r} column of pairs")
        self.pairs = p
        if self.confidence is not None:
            c = np.asarray(self.confidence, dtype=np.float64)
            if c.shape != (p.shape[0],):
                raise ValueError(f"confidence must have shape ({p.shape[0]},), got {c.shape}")
            self.confidence = c
        return self

    @property
    def n_pairs(self) -> int:
        return int(self.pairs.shape[0])

    def subset(self, min_confidence: float) -> CellMatch:
        """Keep pairs with ``confidence >= min_confidence``."""
        if self.confidence is None:
            raise ValueError("this CellMatch has no confidence values to threshold")
        keep = self.confidence >= min_confidence
        return CellMatch(
            session_a=self.session_a,
            session_b=self.session_b,
            pairs=self.pairs[keep],
            confidence=self.confidence[keep],
        )

    def inverse(self) -> CellMatch:
        """The same registration with a and b swapped."""
        return CellMatch(
            session_a=self.session_b,
            session_b=self.session_a,
            pairs=self.pairs[:, ::-1].copy(),
            confidence=None if self.confidence is None else self.confidence.copy(),
        )


class SessionSet(BaseModel):
    """A cohort: sessions, which animal each belongs to, and cell registrations."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    sessions: dict[str, Session]
    animal: dict[str, str]
    matches: list[CellMatch] = []

    @model_validator(mode="after")
    def _check(self) -> SessionSet:
        missing = [s for s in self.sessions if s not in self.animal]
        if missing:
            raise ValueError(f"sessions without an animal: {missing}")
        extra = [s for s in self.animal if s not in self.sessions]
        if extra:
            raise ValueError(f"animal given for unknown sessions: {extra}")
        for m in self.matches:
            for sid, col in ((m.session_a, 0), (m.session_b, 1)):
                if sid not in self.sessions:
                    raise ValueError(f"match refers to unknown session {sid!r}")
                if m.n_pairs and m.pairs[:, col].max() >= self.sessions[sid].n_cells:
                    raise ValueError(
                        f"match {m.session_a!r}->{m.session_b!r} has a cell index outside "
                        f"session {sid!r} ({self.sessions[sid].n_cells} cells)"
                    )
        return self

    @property
    def animals(self) -> list[str]:
        """Sorted unique animal ids."""
        return sorted(set(self.animal.values()))

    def sessions_of(self, animal: str) -> list[str]:
        """Session ids belonging to ``animal`` (in insertion order)."""
        return [s for s in self.sessions if self.animal[s] == animal]

    def match(self, a: str, b: str) -> CellMatch:
        """The registration from ``a`` to ``b``, inverting a stored ``b -> a`` if needed."""
        for m in self.matches:
            if m.session_a == a and m.session_b == b:
                return m
        for m in self.matches:
            if m.session_a == b and m.session_b == a:
                return m.inverse()
        raise KeyError(f"no match between sessions {a!r} and {b!r}")


__all__ = ["CellMatch", "SessionSet"]
