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
from ._results import Tail
from ._selection import Selection

PluginKind = Literal["transform", "preprocess", "metric", "null", "selector"]

#: What a metric is computed against: a ``StateSpace`` (discrete states) or a
#: continuous per-frame signal ``(n_time,)`` / ``(n_time, d)``.
Target = StateSpace | np.ndarray
TargetKind = Literal["states", "signal"]

_REGISTRY: dict[str, dict[str, type[BaseModel]]] = {
    "transform": {},
    "preprocess": {},
    "metric": {},
    "null": {},
    "selector": {},
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
    In the current code every metric has ``accepts_kinds = None`` (no kind is
    rejected); metrics that need non-negative values (``information_content``,
    ``signal_tuning`` with ``statistic="information"``) check the *values* and
    raise ``ValueError`` on negative activity instead.
    """

    level: ClassVar[Literal["cell", "population"]] = "cell"
    input: ClassVar[TargetKind] = "states"
    requires_topology: ClassVar[bool] = False
    accepts_kinds: ClassVar[tuple[str, ...] | None] = None
    #: Which tail of the null is "interesting" by default when shuffling.
    default_tail: ClassVar[Tail] = "upper"
    #: Registry names (``cabana.plots.available_plots()``) of the figures that
    #: make sense for this metric, most informative first.  ``result.plot()``
    #: draws the first one that applies; ``ResultSet.plot_all`` draws them all.
    #: Empty means "use the generic views" (tuning heatmap / metric strip /
    #: shuffle distribution / population matrix, whichever fits the result).
    default_plots: ClassVar[tuple[str, ...]] = ()

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

    def resolve_tail(self, target: Target) -> Tail:
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
                raise ValueError(
                    f"metric {self.name!r} needs a StateSpace, got {type(target).__name__}"
                )
            if self.requires_topology and target.topology is None:
                raise ValueError(
                    f"metric {self.name!r} needs a grid topology but state space "
                    f"{target.name!r} (kind={target.kind!r}) has none"
                )
        elif isinstance(target, StateSpace):
            raise ValueError(f"metric {self.name!r} needs a continuous signal, got a StateSpace")

    def require_exclusive(self, target: Target) -> None:
        """Raise ``ValueError`` unless ``target`` is an exclusive state space."""
        if not target.exclusive:
            raise ValueError(
                f"metric {self.name!r}: requires an exclusive state space but {target.name!r} "
                "is not exclusive; build it with bouts_to_states(exclusive=True)"
            )

    def require_topology_for_smoothing(self, target: Target) -> None:
        """Raise ``ValueError`` if ``smooth_sigma_bins > 0`` but ``target`` has no grid topology."""
        if getattr(self, "smooth_sigma_bins", 0) > 0 and target.topology is None:
            raise ValueError(
                f"metric {self.name!r}: smooth_sigma_bins > 0 requires a state space with a "
                "GridTopology"
            )

    def check_activity_kind(self, kind: str) -> None:
        if self.accepts_kinds is not None and kind not in self.accepts_kinds:
            raise ValueError(
                f"metric {self.name!r} is defined for activity kinds {list(self.accepts_kinds)}, "
                f"but the session has activity_kind={kind!r}"
            )


class Null(_Plugin):
    """A way of breaking the link between activity and behavior.

    ``surrogate(activity, target, mask, fs, rng)`` returns one pair
    ``(activity_s, target_s)`` on which the metric is recomputed (preferred:
    enables per-surrogate seeds and parallel runs).  Alternatively
    ``surrogates(activity, target, mask, fs, n, rng)`` yields ``n`` pairs from
    one shared generator (serial only).  A null may
    perturb the activity (circular shift), the target (label shuffle, bout
    shuffle) or both.  ``perturbs`` says which, so the engine can pick fast
    paths (``compute_shifted``) when the null is a pure shift of activity.
    """

    perturbs: ClassVar[Literal["activity", "target"]] = "activity"

    def surrogate(
        self,
        activity: np.ndarray,
        target: Target,
        mask: np.ndarray,
        fs: float,
        rng: np.random.Generator,
    ) -> tuple[np.ndarray, Target]:
        """One independent surrogate drawn from ``rng`` (and only from ``rng``).

        Implement this to let the engine run surrogates in parallel and
        deterministically: ``shuffle_test`` gives surrogate ``i`` its own
        generator ``default_rng(SeedSequence(seed).spawn(n)[i])``, so the result
        does not depend on ``n_jobs`` or on the order batches finish.  Must be
        thread-safe (do not mutate ``self`` or the inputs).
        """
        raise NotImplementedError

    @property
    def has_surrogate(self) -> bool:
        """True if the subclass implements :meth:`surrogate` (per-draw seeding, parallel)."""
        return type(self).surrogate is not Null.surrogate

    def surrogates(
        self,
        activity: np.ndarray,
        target: Target,
        mask: np.ndarray,
        fs: float,
        n: int,
        rng: np.random.Generator,
    ) -> Iterator[tuple[np.ndarray, Target]]:
        """Yield ``n`` surrogates drawing sequentially from one ``rng``.

        The default builds on :meth:`surrogate`.  Third-party nulls may override
        this instead of implementing ``surrogate``; they then run serially from
        the single main generator (``n_jobs`` is ignored).
        """
        if not self.has_surrogate:
            raise NotImplementedError(
                f"{type(self).__name__} must implement surrogate or surrogates"
            )
        for _ in range(n):
            yield self.surrogate(activity, target, mask, fs, rng)

    def check_target(self, metric: Metric, target: Target) -> None:
        """Hook for nulls that only make sense for some targets (default: any)."""
        return None


class Selector(_Plugin):
    """Data-driven choice of pipeline parameters, run after preprocessing.

    A selector looks at the (transformed, preprocessed) session and the pipeline
    and returns :class:`~cabana.Selection` records; the pipeline applies each
    one with ``Pipeline.set_param(path, value, selection=...)`` to a per-run
    copy before any analysis runs, so the consuming plugins stay pure functions
    of explicit numbers and every chosen value is recorded in provenance.

    Contract
    --------
    * Must not look at shuffle nulls or p-values: choose on a criterion that is
      independent of the significance test (held-out likelihood, map
      reliability, a data statistic).  Set ``informed_by_significance`` on the
      record if that rule is knowingly broken.
    * Returns one ``Selection`` per parameter set; ``path`` follows the
      ``Pipeline.set_param`` grammar (``analyses.*.metric.<field>`` to set a
      field on every analysis that has it).
    * Pure: must not mutate ``session`` or ``pipeline``.
    """

    @abstractmethod
    def select(self, session: Session, pipeline: Any) -> list[Selection]: ...


_BASES: dict[str, type[_Plugin]] = {
    "transform": Transform,
    "preprocess": PreprocessStep,
    "metric": Metric,
    "null": Null,
    "selector": Selector,
}


def register(kind: PluginKind):
    """Class decorator adding a plugin to the registry under ``cls.name``.

    Parameters
    ----------
    kind : {"transform", "preprocess", "metric", "null", "selector"}
        Registry to add to; the class must subclass the matching base.

    Returns
    -------
    callable
        The decorator; it returns the class unchanged.

    Raises
    ------
    TypeError
        If the class does not subclass the base for ``kind`` or has no class-level
        string ``name``.
    ValueError
        If another class is already registered under that name.
    """

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
    """Instantiate a registered plugin from ``{"name": ..., **params}``.

    Parameters
    ----------
    kind : {"transform", "preprocess", "metric", "null", "selector"}
        Which registry to look in.
    spec : dict or plugin instance
        ``{"name": registry_name, **fields}``; an existing plugin instance is
        returned unchanged.

    Returns
    -------
    Transform, PreprocessStep, Metric or Null
        The validated plugin.

    Raises
    ------
    KeyError
        If ``spec`` has no ``"name"`` key or the name is not registered (the
        message lists the registered names).
    pydantic.ValidationError
        If the parameters are invalid.
    """
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
        raise KeyError(f"unknown {kind} {name!r}; registered: {sorted(_REGISTRY[kind])}") from e
    return cls(**spec)


def available(kind: PluginKind) -> list[str]:
    """Names registered for a plugin kind.

    Parameters
    ----------
    kind : {"transform", "preprocess", "metric", "null", "selector"}
        Registry to list.

    Returns
    -------
    list[str]
        Sorted registry names, usable as ``{"name": ...}`` in ``build`` or YAML.
    """
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
