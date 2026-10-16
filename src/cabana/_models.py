"""Core data structures shared by every stage of the CaBaNA pipeline.

The whole framework rests on three objects, all expressed on the *neural clock*
(one sample per neural frame):

* ``Session.activity``  -- ``(n_cells, n_time)`` float array of neural activity.
* ``StateSpace.onehot`` -- ``(n_time, n_states)`` bool matrix saying which
  behavioral state(s) the animal is in on each frame.  Spatial bins, behavioral
  syllables and manually scored bouts all reduce to this.
* ``Session.masks``     -- named ``(n_time,)`` bool arrays of frames to keep
  (speed threshold, scored coverage, ...).  ``Session.valid_mask()`` ANDs them.

Raw behavior arrives on its *own* clock (``ContinuousSignal``, ``BoutTable``,
``LabelSeries``) and is moved onto the neural clock by transforms, which
produce ``StateSpace`` objects and per-frame ``signals``.
"""

from __future__ import annotations

import warnings
from pathlib import Path
from typing import Any, Literal

import numpy as np
from numpydantic import NDArray, Shape
from pydantic import BaseModel, ConfigDict, Field, model_validator

ActivityKind = Literal["deconvolved", "dff", "spike_counts", "raw", "zscored"]
StateKind = Literal["grid", "categorical", "bouts"]


class _ArrayModel(BaseModel):
    """Base for models holding numpy arrays."""

    model_config = ConfigDict(arbitrary_types_allowed=True, validate_assignment=False)


# --------------------------------------------------------------------------- #
# Raw behavior inputs (on their own clock)
# --------------------------------------------------------------------------- #


class ContinuousSignal(_ArrayModel):
    """A multichannel continuous signal sampled on its own clock.

    Examples: animal position ``(x, y)`` from DeepLabCut, head direction, speed
    from a wheel encoder.

    Parameters
    ----------
    t : (n_samples,) float
        Sample times in seconds, non-decreasing, on the same time base as
        ``Session.t`` (the neural clock; any origin, but it must match).
    values : (n_samples, n_channels) float
        Signal values in the units given by ``units``.  ``NaN`` marks missing
        samples (e.g. tracking dropouts).
    channel_names : list[str]
        One name per column of ``values``, e.g. ``["x", "y"]``.
    units : str, default ""
        Free-text units for the values, e.g. ``"mm"``.  Informational only:
        nothing converts between units.

    Raises
    ------
    ValueError
        If the number of samples or channels disagrees with ``t`` /
        ``channel_names``, or ``t`` decreases.
    """

    t: NDArray[Shape["* samples"], float]
    values: NDArray[Shape["* samples, * channels"], float]
    channel_names: list[str]
    units: str = ""

    @model_validator(mode="after")
    def _check_shapes(self) -> ContinuousSignal:
        if self.values.shape[0] != self.t.shape[0]:
            raise ValueError(
                f"values has {self.values.shape[0]} samples but t has {self.t.shape[0]}"
            )
        if self.values.shape[1] != len(self.channel_names):
            raise ValueError(
                f"values has {self.values.shape[1]} channels but "
                f"{len(self.channel_names)} channel_names were given"
            )
        if np.any(np.diff(self.t) < 0):
            raise ValueError("t must be non-decreasing")
        return self


class BoutTable(_ArrayModel):
    """Intervals of scored behavior, e.g. a BORIS export or manual annotation.

    Behaviors may overlap in time.  Frames outside ``[scored_start_s,
    scored_stop_s]`` are treated as *unscored* (unknown), not as absence of
    behavior.

    Parameters
    ----------
    labels : list[str]
        Behavior name for each bout, length ``n_bouts``.
    start_s, stop_s : (n_bouts,) float
        Bout boundaries in seconds on the ``Session.t`` time base (the neural
        clock); every ``stop_s >= start_s`` and all values must be finite.
    scored_start_s, scored_stop_s : float | None, default None
        Seconds (same time base) delimiting the span that was actually scored.
        ``None`` means no restriction (the whole session counts as scored).

    Raises
    ------
    ValueError
        If lengths differ, times are non-finite, or a bout stops before it starts.
    """

    labels: list[str]
    start_s: NDArray[Shape["* bouts"], float]
    stop_s: NDArray[Shape["* bouts"], float]
    scored_start_s: float | None = None
    scored_stop_s: float | None = None

    @model_validator(mode="after")
    def _check_shapes(self) -> BoutTable:
        n = len(self.labels)
        if self.start_s.shape[0] != n or self.stop_s.shape[0] != n:
            raise ValueError("labels, start_s and stop_s must have the same length")
        if not (np.all(np.isfinite(self.start_s)) and np.all(np.isfinite(self.stop_s))):
            raise ValueError("bout times must be finite")
        if np.any(self.stop_s < self.start_s):
            raise ValueError("every bout must have stop_s >= start_s")
        return self

    @property
    def behavior_names(self) -> list[str]:
        """Unique behavior names in first-appearance order."""
        return list(dict.fromkeys(self.labels))


class LabelSeries(_ArrayModel):
    """A per-sample categorical label on its own clock.

    Examples: Keypoint-MoSeq syllables, a per-frame "zone" label.

    Parameters
    ----------
    t : (n_samples,) float
        Sample times in seconds, non-decreasing, on the ``Session.t`` time base.
    labels : (n_samples,) int
        Integer label per sample, indexing ``label_names``.  ``-1`` means
        "no label / unknown": such samples are outside the labelled support.
    label_names : list[str]
        Name of label ``i`` is ``label_names[i]``; every non-negative entry of
        ``labels`` must be a valid index.

    Raises
    ------
    ValueError
        If ``labels`` and ``t`` differ in length, a label has no name, or ``t``
        decreases.
    """

    t: NDArray[Shape["* samples"], float]
    labels: NDArray[Shape["* samples"], int]
    label_names: list[str]

    @model_validator(mode="after")
    def _check_shapes(self) -> LabelSeries:
        if self.labels.shape[0] != self.t.shape[0]:
            raise ValueError("labels and t must have the same length")
        if self.labels.max(initial=-1) >= len(self.label_names):
            raise ValueError("labels contains an index with no name in label_names")
        if np.any(np.diff(self.t) < 0):
            raise ValueError("t must be non-decreasing")
        return self


BehaviorInput = ContinuousSignal | BoutTable | LabelSeries


# --------------------------------------------------------------------------- #
# State spaces (on the neural clock)
# --------------------------------------------------------------------------- #


class GridTopology(_ArrayModel):
    """Describes how categorical states are arranged on a regular grid.

    Present only for binned continuous variables (1D track, 2D arena, 3D
    volume).  Lets order-dependent operations (smoothing across neighboring
    bins, place-field detection, rate-map plotting) know the layout.  State
    index ``s`` corresponds to grid coordinate ``np.unravel_index(s, shape)``.

    Parameters
    ----------
    shape : tuple[int, ...]
        Number of bins along each axis; ``prod(shape)`` equals the number of
        states.  Flattening is C order (``np.unravel_index``).
    edges : list[(n_bins_axis + 1,) float]
        Bin edges along each axis, in the units of the source signal (e.g. the
        ``ContinuousSignal.units``).
    axis_names : list[str]
        Name of the source channel for each axis, e.g. ``["x", "y"]``.

    Raises
    ------
    ValueError
        If ``shape``, ``edges`` and ``axis_names`` differ in length, or an axis
        with ``n`` bins does not have ``n + 1`` edges.
    """

    shape: tuple[int, ...]
    edges: list[NDArray[Shape["* edges"], float]]
    axis_names: list[str]

    @model_validator(mode="after")
    def _check(self) -> GridTopology:
        if not (len(self.shape) == len(self.edges) == len(self.axis_names)):
            raise ValueError("shape, edges and axis_names must have one entry per axis")
        for n, e in zip(self.shape, self.edges, strict=True):
            if e.shape[0] != n + 1:
                raise ValueError(f"axis with {n} bins needs {n + 1} edges, got {e.shape[0]}")
        return self

    @property
    def n_states(self) -> int:
        return int(np.prod(self.shape))

    @property
    def ndim(self) -> int:
        return len(self.shape)

    def centers(self) -> list[np.ndarray]:
        """Bin centers along each axis."""
        return [0.5 * (e[1:] + e[:-1]) for e in self.edges]


class StateSpace(_ArrayModel):
    """Which behavioral state(s) the animal occupies on every neural frame.

    This is the universal behavioral representation every metric consumes.

    Attributes
    ----------
    name : str
        Identifier used to look the state space up in ``Session.states``.
    onehot : (n_time, n_states) bool
        ``onehot[t, s]`` is True when the animal is in state ``s`` at frame ``t``.
        A frame may have no True entry (unoccupied / unscored): an all-False row
        means "no state", and is *not* counted as any state.  If ``exclusive`` is
        True each frame has at most one True entry (validated).
    state_names : list[str]
        Human-readable name per state (bin label, syllable, behavior).
    kind : {"grid", "categorical", "bouts"}
        How the states were produced.  Plot functions dispatch on this.
    exclusive : bool
        True when states are mutually exclusive (spatial bins, syllables);
        False when states may overlap (scored social behaviors).
    topology : GridTopology | None
        Grid layout for ``kind == "grid"``; ``None`` otherwise.
    support : (n_time,) bool | None
        Frames where the state space is *defined*: the scored span for bouts, the
        labelled span for categorical labels, tracked in-extent frames for grids.
        ``Pipeline.run`` ANDs it into every analysis mask on this target, so
        unscored / untracked frames never count as "not in state".  ``None``
        means defined everywhere.  An all-False ``onehot`` row inside ``support``
        means "defined, but in none of the states"; outside ``support`` it means
        "unknown".

    Examples
    --------
    Three frames, two states; frame 2 is unscored (all-False row, outside
    ``support``)::

        StateSpace(name="social", state_names=["sniff", "chase"], kind="bouts",
                   exclusive=False, onehot=np.array([[1, 0], [1, 1], [0, 0]], bool),
                   support=np.array([True, True, False]))
    """

    name: str
    onehot: NDArray[Shape["* time, * states"], bool]
    state_names: list[str]
    kind: StateKind
    exclusive: bool
    topology: GridTopology | None = None
    support: NDArray[Shape["* time"], bool] | None = None

    @model_validator(mode="after")
    def _check(self) -> StateSpace:
        if self.support is not None and self.support.shape[0] != self.onehot.shape[0]:
            raise ValueError(
                f"support has {self.support.shape[0]} frames but onehot has {self.onehot.shape[0]}"
            )
        if self.onehot.shape[1] != len(self.state_names):
            raise ValueError(
                f"onehot has {self.onehot.shape[1]} states but {len(self.state_names)} names"
            )
        if self.exclusive and np.any(self.onehot.sum(axis=1) > 1):
            raise ValueError("exclusive StateSpace has frames with more than one active state")
        if self.topology is not None and self.topology.n_states != self.n_states:
            raise ValueError("topology.n_states does not match onehot.shape[1]")
        if self.kind == "grid" and self.topology is None:
            raise ValueError("kind='grid' requires a topology")
        return self

    @property
    def n_time(self) -> int:
        return int(self.onehot.shape[0])

    @property
    def n_states(self) -> int:
        return int(self.onehot.shape[1])

    def labels(self, mask: np.ndarray | None = None) -> np.ndarray:
        """Integer state per frame, ``-1`` where no state is active (or ``mask`` is False).

        Only meaningful for exclusive state spaces.  Exclusive spaces are
        processed by metrics as these integer labels (bucketed sums, see
        ``cabana._statesums``) instead of a dense float ``(n_time, n_states)``
        matrix, which keeps fine grids (thousands of states) cheap.
        """
        if not self.exclusive:
            raise ValueError("labels() requires an exclusive StateSpace; use onehot instead")
        lab = np.full(self.n_time, -1, dtype=np.int64)
        has = self.onehot.any(axis=1)
        if mask is not None:
            has &= np.asarray(mask, dtype=bool)
        rows = np.flatnonzero(has)
        for a in range(0, rows.size, 2048):  # chunked: no (n_time, n_states) temporary
            r = rows[a : a + 2048]
            lab[r] = self.onehot[r].argmax(axis=1)
        return lab

    def occupancy(self, mask: np.ndarray | None = None) -> np.ndarray:
        """Number of (masked) frames spent in each state, shape ``(n_states,)``."""
        oh = self.onehot if mask is None else self.onehot[mask]
        return oh.sum(axis=0).astype(np.int64)

    def masked(self, mask: np.ndarray) -> np.ndarray:
        """``onehot`` with rows outside ``mask`` zeroed, as float64 for matmuls."""
        return (self.onehot & mask[:, None]).astype(np.float64)


# --------------------------------------------------------------------------- #
# Session
# --------------------------------------------------------------------------- #


class Session(_ArrayModel):
    """One recording: neural activity plus everything known about behavior.

    ``Session`` is the single object passed between pipeline stages.  Stages
    never mutate a session in place; they return validated copies via ``replace`` /
    ``with_state`` / ``with_signal`` / ``with_mask`` / ``with_activity``.

    **Time alignment.**  ``t`` is in seconds on the neural clock and may have any
    origin; every behavior input (``ContinuousSignal.t``, ``BoutTable`` times,
    ``LabelSeries.t``) must be expressed on that same time base.  ``fs`` should
    match ``1 / median(diff(t))``; a ``UserWarning`` is issued when they differ by
    more than 5 %.  A ``UserWarning`` is also issued when a ``deconvolved`` /
    ``spike_counts`` session has negative activity.

    **Units.**  ``activity`` carries whatever units the input signals had (a.u.
    fluorescence, dF/F, event amplitude, spike counts per frame); the package
    never rescales it except in explicit preprocess steps.  Seconds are used for
    all times and Hz for ``fs``.

    Attributes
    ----------
    activity : (n_cells, n_time) float
        Neural activity on the neural clock.  Non-negative for ``deconvolved``
        and ``spike_counts``.
    t : (n_time,) float
        Frame times in seconds.  This is the canonical clock.
    fs : float
        Nominal sampling rate in Hz (must be positive).
    activity_kind : {"deconvolved", "dff", "spike_counts", "raw", "zscored"}
        What the numbers mean.  Metrics may branch on this (e.g. amplitude vs
        binary weighting); ``rebin`` sums ``deconvolved`` / ``spike_counts`` and
        averages the others.  ``"zscored"`` is set by the z-scoring preprocess
        step (per cell, mean 0 and unit variance over the ``valid_mask()`` frames) and
        can be negative.
    cell_ids : list[str] | None
        One identifier per row of ``activity``; ``None`` is replaced by
        ``"0", "1", ...`` on construction.
    behavior : dict[str, BehaviorInput]
        Raw behavior inputs on their own clocks, keyed by name
        (e.g. ``"position"``, ``"social"``, ``"syllables"``).
    signals : dict[str, (n_time, ...) float]
        Continuous per-frame signals already on the neural clock, e.g.
        ``"x"``, ``"y"``, ``"speed"``.  First axis is always ``n_time``.
    states : dict[str, StateSpace]
        State spaces on the neural clock, keyed by ``StateSpace.name``.
    masks : dict[str, (n_time,) bool]
        Named frame masks (``"speed"``, ``"scored"``, ...).  See ``valid_mask``.
    meta : dict
        Free-form provenance: animal, date, simulation ground truth, ...  Values
        that are not JSON types are stored as strings by :meth:`save`.

    See Also
    --------
    Session.save, Session.load : persist a session to a directory or ``.zip``.
    Session.rebin : change the frame rate consistently across all per-frame objects.
    """

    activity: NDArray[Shape["* cells, * time"], float]
    t: NDArray[Shape["* time"], float]
    fs: float = Field(gt=0)
    activity_kind: ActivityKind = "deconvolved"
    cell_ids: list[str] | None = None
    behavior: dict[str, BehaviorInput] = Field(default_factory=dict)
    signals: dict[str, NDArray] = Field(default_factory=dict)
    states: dict[str, StateSpace] = Field(default_factory=dict)
    masks: dict[str, NDArray[Shape["* time"], bool]] = Field(default_factory=dict)
    meta: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check(self) -> Session:
        n_cells, n_time = self.activity.shape
        if self.t.shape[0] != n_time:
            raise ValueError(f"activity has {n_time} frames but t has {self.t.shape[0]}")
        if self.cell_ids is None:
            self.cell_ids = [str(i) for i in range(n_cells)]
        elif len(self.cell_ids) != n_cells:
            raise ValueError(f"{len(self.cell_ids)} cell_ids for {n_cells} cells")
        for k, v in self.signals.items():
            if np.shape(v)[0] != n_time:
                raise ValueError(f"signal {k!r} has {np.shape(v)[0]} frames, expected {n_time}")
        for k, s in self.states.items():
            if s.n_time != n_time:
                raise ValueError(f"state space {k!r} has {s.n_time} frames, expected {n_time}")
            if s.name != k:
                raise ValueError(f"state space stored under {k!r} has name {s.name!r}")
            if s.support is not None and s.support.shape[0] != n_time:
                raise ValueError(
                    f"state space {k!r} support has {s.support.shape[0]} frames, expected {n_time}"
                )
        for k, m in self.masks.items():
            if m.shape[0] != n_time:
                raise ValueError(f"mask {k!r} has {m.shape[0]} frames, expected {n_time}")
        if n_time >= 3:
            dt = float(np.median(np.diff(self.t)))
            if dt > 0 and abs(1.0 / dt - self.fs) > 0.05 * self.fs:
                warnings.warn(
                    f"fs={self.fs:g} Hz disagrees with 1/median(diff(t)) = {1.0 / dt:g} Hz "
                    "(more than 5%); check that t is in seconds and fs is in Hz",
                    UserWarning,
                    stacklevel=2,
                )
        if self.activity_kind in ("deconvolved", "spike_counts") and n_time:
            if np.nanmin(self.activity, initial=0.0) < 0:
                warnings.warn(
                    f"activity_kind={self.activity_kind!r} but activity has negative values; "
                    "did you mean activity_kind='dff' or 'raw'?",
                    UserWarning,
                    stacklevel=2,
                )
        return self

    @property
    def n_cells(self) -> int:
        return int(self.activity.shape[0])

    @property
    def n_time(self) -> int:
        return int(self.activity.shape[1])

    @property
    def duration_s(self) -> float:
        return float(self.n_time / self.fs)

    def valid_mask(self, include: list[str] | None = None) -> np.ndarray:
        """AND of the named masks (all of them by default); all-True if none."""
        names = list(self.masks) if include is None else include
        m = np.ones(self.n_time, dtype=bool)
        for k in names:
            m &= self.masks[k]
        return m

    # Convenience builders used by transforms / preprocessing ------------- #

    def rebin(
        self,
        bin_s: float,
        activity_method: Literal["sum", "mean", "auto"] = "auto",
        min_fraction: float = 0.5,
    ) -> Session:
        """Re-bin every per-frame object to ``bin_s`` seconds (changes ``n_time``).

        Population analyses (PCA, decoding, GLM) typically work on 100 ms to
        1 s bins.  Everything on the neural clock is resampled together so
        the session stays consistent:

        * ``activity``: with ``"auto"``, summed per bin for event-like kinds
          (``deconvolved``, ``spike_counts``) and averaged for every other kind
          (``dff``, ``raw``, ``zscored``).
        * ``t``: mean frame time per bin; ``fs`` becomes ``fs / k``.
        * ``signals``: nan-mean per bin.
        * ``masks`` and ``StateSpace.support``: True when at least ``min_fraction``
          of the frames are True.
        * ``states``: a state is active when it occupies at least
          ``min_fraction`` of the bin; for exclusive spaces only the dominant
          state can be active.  Topology is kept.

        ``bin_s`` is rounded to a whole number of frames (a warning is issued
        when it is not one); ``meta["rebin"]["bin_s"]`` records the actual width.
        Trailing frames that do not fill a whole bin are dropped.  Raw
        ``behavior`` inputs are untouched (they live on their own clocks).

        Parameters
        ----------
        bin_s : float
            Target bin width in seconds.
        activity_method : {"sum", "mean", "auto"}, default "auto"
            How activity is aggregated; ``"auto"`` follows the rule above.
        min_fraction : float, default 0.5
            Minimum fraction of a bin's frames that must be True for a mask,
            support or state to be True in the new bin.

        Returns
        -------
        Session
            New session with ``n_time // k`` frames (``k = round(bin_s * fs)``);
            ``self`` unchanged when ``k == 1``.

        Raises
        ------
        ValueError
            If ``bin_s`` is shorter than one frame or fewer than two bins remain.
        """
        k = int(round(bin_s * self.fs))
        if abs(bin_s * self.fs - k) > 1e-6 and k >= 1:
            warnings.warn(
                f"bin_s={bin_s} is not a whole number of frames at fs={self.fs:g} Hz; using "
                f"{k} frames = {k / self.fs:g} s",
                UserWarning,
                stacklevel=2,
            )
        if k < 1:
            raise ValueError(f"bin_s={bin_s} is shorter than one frame at fs={self.fs}")
        if k == 1:
            return self
        n_new = self.n_time // k
        if n_new < 2:
            raise ValueError("bin_s is too large: fewer than two bins would remain")
        n_keep = n_new * k

        def blocks(a: np.ndarray) -> np.ndarray:
            a = np.asarray(a)[:n_keep]
            return a.reshape(n_new, k, *a.shape[1:])

        method = activity_method
        if method == "auto":
            method = "sum" if self.activity_kind in ("deconvolved", "spike_counts") else "mean"
        act_blocks = self.activity[:, :n_keep].reshape(self.n_cells, n_new, k)
        activity = act_blocks.sum(axis=2) if method == "sum" else act_blocks.mean(axis=2)

        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN bins -> NaN, silently
            signals = {name: np.nanmean(blocks(v), axis=1) for name, v in self.signals.items()}
        masks = {name: blocks(m).mean(axis=1) >= min_fraction for name, m in self.masks.items()}
        states: dict[str, StateSpace] = {}
        for name, st in self.states.items():
            frac = blocks(st.onehot).mean(axis=1)  # (n_new, n_states)
            if st.exclusive:
                oh = np.zeros_like(frac, dtype=bool)
                best = frac.argmax(axis=1)
                top = frac[np.arange(n_new), best]
                ok = (top >= min_fraction) & (top > 0)
                oh[np.flatnonzero(ok), best[ok]] = True
            else:
                oh = (frac >= min_fraction) & (frac > 0)
            support = (
                None if st.support is None else blocks(st.support).mean(axis=1) >= min_fraction
            )
            states[name] = st.model_copy(update={"onehot": oh, "support": support})
        meta = {
            **self.meta,
            "rebin": {"bin_s": k / self.fs, "frames_per_bin": k, "method": method},
        }
        return Session(
            activity=activity,
            t=blocks(self.t).mean(axis=1),
            fs=self.fs / k,
            activity_kind=self.activity_kind,
            cell_ids=self.cell_ids,
            behavior=self.behavior,
            signals=signals,
            states=states,
            masks=masks,
            meta=meta,
        )

    def save(self, path: str | Path) -> None:
        """Write to a directory or ``.zip`` (``manifest.json`` + ``arrays.npz``).

        Meta values that are not JSON types are stored as strings; tuples come
        back as lists; arrays in ``meta`` are kept as arrays.

        Parameters
        ----------
        path : str or Path
            A directory (created if needed) or a path ending in ``.zip``.
            ``manifest.json`` holds scalars and names, ``arrays.npz`` holds
            activity, ``t``, masks, signals, state ``onehot``/``support``/edges
            and raw behavior arrays.
        """
        from ._io import save_session

        save_session(self, path)

    @classmethod
    def load(cls, path: str | Path) -> Session:
        """Read a session written by :meth:`save`.

        Parameters
        ----------
        path : str or Path
            Directory or ``.zip`` written by :meth:`save`.

        Returns
        -------
        Session

        Raises
        ------
        ValueError
            If ``path`` does not hold a saved ``Session`` manifest.
        FileNotFoundError
            If ``path`` is neither a directory nor a zip file.
        """
        from ._io import load_session

        return load_session(path)

    def replace(self, **update: Any) -> Session:
        """Copy with fields replaced, re-running validation (unlike ``model_copy``).

        Arrays are shared, not copied; callers must not mutate them afterwards.
        """
        fields = {name: getattr(self, name) for name in type(self).model_fields}
        fields.update(update)
        return Session(**fields)

    def with_state(self, state: StateSpace) -> Session:
        return self.replace(states={**self.states, state.name: state})

    def with_signal(self, name: str, values: np.ndarray) -> Session:
        return self.replace(signals={**self.signals, name: np.asarray(values)})

    def with_mask(self, name: str, mask: np.ndarray) -> Session:
        return self.replace(masks={**self.masks, name: np.asarray(mask, bool)})

    def with_activity(self, activity: np.ndarray, kind: ActivityKind | None = None) -> Session:
        upd: dict[str, Any] = {"activity": activity}
        if kind is not None:
            upd["activity_kind"] = kind
        if activity.shape[0] != self.n_cells:
            upd["cell_ids"] = None  # ids no longer apply; validator assigns defaults
        return self.replace(**upd)


__all__ = [
    "ActivityKind",
    "BehaviorInput",
    "BoutTable",
    "ContinuousSignal",
    "GridTopology",
    "LabelSeries",
    "Session",
    "StateKind",
    "StateSpace",
]
