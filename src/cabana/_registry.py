"""Plugin registry and the base classes every pluggable step derives from.

Four kinds of plugin exist, one per pipeline stage that we expect to grow:

* ``Transform``      -- raw behavior inputs -> ``StateSpace`` / per-frame signals.
* ``PreprocessStep`` -- ``Session`` -> ``Session`` (masks, smoothing, z-scoring, ...).
* ``Metric``         -- (activity, target, mask, fs) -> array of numbers.
* ``Null``           -- surrogate (activity, target) pairs that break the neural–behavior link.

Each plugin is a pydantic model: its *fields are its parameters*, so configs
are validated, documented and serialisable for free.  Register with::

    @register("metric")
    class InformationContent(Metric):
        name: ClassVar[str] = "information_content"
        ...

and rebuild from a plain dict (e.g. loaded from YAML) with::

    build("metric", {"name": "information_content", "smooth_sigma_bins": 1.0})
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Iterator
from typing import Any, ClassVar, Literal

import numpy as np
from pydantic import BaseModel, ConfigDict

from ._models import Session, StateSpace

PluginKind = Literal["transform", "preprocess", "metric", "null"]

#: What a metric is computed against: a ``StateSpace`` (discrete states) or a
#: continuous per-frame signal ``(n_time,)`` / ``(n_time, d)``.
Target = StateSpace | np.ndarray
TargetKind = Literal["states", "signal"]

_REGISTRY: dict[str, dict[str, type[BaseModel]]] = {
    "transform": {},
    "preprocess": {},
    "metric": {},
    "null": {},
}


class _Plugin(BaseModel, ABC):
    """Common base: a pydantic config with a class-level ``name``."""

    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    #: Registry key.  Subclasses must set this.
    name: ClassVar[str]

    def to_dict(self) -> dict[str, Any]:
        """Parameters plus ``name``; the inverse of :func:`build`."""
        return {"name": self.name, **self.model_dump()}


class Transform(_Plugin):
    """Turns raw behavior inputs into ``StateSpace`` objects or per-frame signals.

    Implementations read from ``session.behavior`` / ``session.signals`` and
    return a new ``Session`` with additional ``states`` / ``signals`` / ``masks``.
    They must not change ``activity`` or ``t``.
    """

    @abstractmethod
    def apply(self, session: Session) -> Session: ...


class PreprocessStep(_Plugin):
    """Session -> Session.  May add masks or replace ``activity``/``signals``.

    Steps that change the number of frames (temporal re-binning) must go
    through ``Session.rebin`` so that *every* per-frame object is resampled
    consistently.
    """

    @abstractmethod
    def apply(self, session: Session) -> Session: ...


class Metric(_Plugin):
    """A number (or array of numbers) computed from activity and a target.

    Contract
    --------
    ``compute(activity, target, mask, fs)`` returns an ndarray whose leading
    axis is ``n_cells`` when ``level == "cell"`` (shape ``(n_cells,)`` or
    ``(n_cells, n_states)`` or ``(n_cells, k)``), or any shape when
    ``level == "population"`` (e.g. a ``(n_states, n_states)`` matrix).

    ``target`` is a ``StateSpace`` when ``input == "states"`` and a float
    array ``(n_time,)`` or ``(n_time, d)`` taken from ``session.signals`` when
    ``input == "signal"``.

    ``mask`` is a ``(n_time,)`` bool array; frames where it is False must be
    ignored entirely (they contribute to neither occupancy nor activity sums).
    ``fs`` is the sampling rate in Hz, so occupancy can be expressed in
    seconds and activity sums as rates.

    ``extras(activity, target, mask, fs)`` optionally returns named side
    outputs (rate maps, PETH arrays, occupancy) that plots need but that are
    not the tested statistic.  Called once, on unshifted data.

    ``compute_shifted(activity, target, mask, fs, shifts)`` is optional.  When
    implemented it returns the metric for *each* circular shift in ``shifts``
    (an int array of frame offsets, each applied as ``np.roll(activity, k,
    axis=1)`` *before* masking), stacked along a new leading axis:
    ``(n_shifts, *compute(...).shape)``.  The ``circular_shift`` null uses it
    when available and falls back to a Python loop over ``compute`` otherwise.
    Most metrics can implement it with :func:`cabana._shuffle.shifted_sums`.

    ``requires_topology`` metrics raise ``ValueError`` on a ``StateSpace``
    without a ``GridTopology`` (e.g. place-field detection).  Order-free
    metrics such as information content must accept *any* state space.

    ``accepts_kinds`` lists the ``activity_kind`` values the metric is valid
    for; ``None`` means any.  Rate-based metrics (Skaggs information) need
    non-negative event-like activity, rank-based ones (AUROC) accept anything.
    """

    level: ClassVar[Literal["cell", "population"]] = "cell"
    input: ClassVar[TargetKind] = "states"
    requires_topology: ClassVar[bool] = False
    accepts_kinds: ClassVar[tuple[str, ...] | None] = None
    #: Which tail of the null is "interesting" by default when shuffling.
    default_tail: ClassVar[Literal["upper", "lower", "two"]] = "upper"

    @abstractmethod
    def compute(
        self, activity: np.ndarray, target: Target, mask: np.ndarray, fs: float
    ) -> np.ndarray: ...

    def compute_shifted(
        self,
        activity: np.ndarray,
        target: Target,
        mask: np.ndarray,
        fs: float,
        shifts: np.ndarray,
    ) -> np.ndarray | None:
        """Vectorised metric over circular shifts; ``None`` means "not implemented"."""
        return None

    def extras(
        self, activity: np.ndarray, target: Target, mask: np.ndarray, fs: float
    ) -> dict[str, np.ndarray]:
        """Named side outputs for plotting/inspection (default: none)."""
        return {}

    def configure(self, session: Session, target_name: str) -> None:
        """Hook called by the pipeline before ``compute`` with the full session.

        Lets a metric read session metadata it cannot get from the arrays
        alone (e.g. ``glm_encoding`` picks up design-matrix column names from
        ``session.meta["design_columns"]``).  Default: no-op.
        """
        return None

    def resolve_tail(self, target: Target) -> Literal["upper", "lower", "two"]:
        """Tail to use when ``ShuffleConfig.tail`` is ``None``.

        Defaults to ``default_tail``; metrics whose statistic changes meaning
        with the target (e.g. decoding *error* on a grid vs *accuracy* on
        categories) override this.
        """
        return self.default_tail

    def check_target(self, target: Target) -> None:
        """Raise ``ValueError`` if ``target`` is not what this metric consumes."""
        if self.input == "states":
            if not isinstance(target, StateSpace):
                raise ValueError(f"metric {self.name!r} needs a StateSpace, got {type(target).__name__}")
            if self.requires_topology and target.topology is None:
                raise ValueError(
                    f"metric {self.name!r} needs a grid topology but state space "
                    f"{target.name!r} (kind={target.kind!r}) has none"
                )
        elif isinstance(target, StateSpace):
            raise ValueError(f"metric {self.name!r} needs a continuous signal, got a StateSpace")

    # Backwards-compatible alias used by early metrics.
    def check_states(self, states: StateSpace) -> None:
        self.check_target(states)

    def check_activity_kind(self, kind: str) -> None:
        if self.accepts_kinds is not None and kind not in self.accepts_kinds:
            raise ValueError(
                f"metric {self.name!r} is defined for activity kinds {list(self.accepts_kinds)}, "
                f"but the session has activity_kind={kind!r}"
            )


class Null(_Plugin):
    """A way of breaking the link between activity and behavior.

    ``surrogates(activity, target, mask, fs, n, rng)`` yields ``n`` pairs
    ``(activity_s, target_s)`` on which the metric is recomputed.  A null may
    perturb the activity (circular shift), the target (label shuffle, bout
    shuffle) or both.  ``perturbs`` says which, so the engine can pick fast
    paths (``compute_shifted``) when the null is a pure shift of activity.
    """

    perturbs: ClassVar[Literal["activity", "target"]] = "activity"

    @abstractmethod
    def surrogates(
        self,
        activity: np.ndarray,
        target: Target,
        mask: np.ndarray,
        fs: float,
        n: int,
        rng: np.random.Generator,
    ) -> Iterator[tuple[np.ndarray, Target]]: ...

    def check_target(self, metric: Metric, target: Target) -> None:
        """Hook for nulls that only make sense for some targets (default: any)."""
        return None


_BASES: dict[str, type[_Plugin]] = {
    "transform": Transform,
    "preprocess": PreprocessStep,
    "metric": Metric,
    "null": Null,
}


def register(kind: PluginKind):
    """Class decorator adding a plugin to the registry under ``cls.name``."""

    def deco(cls: type[_Plugin]) -> type[_Plugin]:
        base = _BASES[kind]
        if not issubclass(cls, base):
            raise TypeError(f"{cls.__name__} must subclass {base.__name__} to register as {kind}")
        name = getattr(cls, "name", None)
        if not isinstance(name, str) or not name:
            raise TypeError(f"{cls.__name__} must define a class-level string 'name'")
        if name in _REGISTRY[kind] and _REGISTRY[kind][name] is not cls:
            raise ValueError(f"{kind} plugin {name!r} is already registered")
        _REGISTRY[kind][name] = cls
        return cls

    return deco


def build(kind: PluginKind, spec: dict[str, Any] | _Plugin) -> Any:
    """Instantiate a registered plugin from ``{"name": ..., **params}``."""
    if isinstance(spec, _Plugin):
        return spec
    spec = dict(spec)
    try:
        name = spec.pop("name")
    except KeyError as e:
        raise KeyError(f"{kind} spec needs a 'name' key: {spec}") from e
    try:
        cls = _REGISTRY[kind][name]
    except KeyError as e:
        raise KeyError(
            f"unknown {kind} {name!r}; registered: {sorted(_REGISTRY[kind])}"
        ) from e
    return cls(**spec)


def available(kind: PluginKind) -> list[str]:
    """Names registered for a plugin kind."""
    return sorted(_REGISTRY[kind])


__all__ = [
    "Metric",
    "Null",
    "PluginKind",
    "PreprocessStep",
    "Target",
    "TargetKind",
    "Transform",
    "available",
    "build",
    "register",
]
