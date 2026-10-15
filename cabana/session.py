"""
cabana.session — Shared data structure for all analyses.

A Session holds neural and behavioral data from one recording, aligned to the
same timestamps. All analyses take a Session as input, regardless of how the
data were originally loaded or formatted.

Fields:
    t            (n_frames,)          Neural timestamps in seconds
    neural       (n_frames, n_cells)  Neural data used for analysis
    behavior     DataFrame            Behavioral data, one row per neural frame
    cell_ids     (n_cells,)           Cell ID for each column of neural
    neural_type  str                  "raw", "denoised", or "deconvolved"
    config       dict                 Settings such as arena size, bin size, zones
    history      tuple of str         Processing steps applied to neural

`behavior` can hold any columns: continuous measurements (x, y, speed, head
orientation) and frame labels (zone, investigation, spatial bin). An analysis reads
the columns it needs.

Neural timestamps are the reference clock. Behavioral data are aligned to
these timestamps in cabana.structuring, so row i of behavior and neural both
correspond to t[i]. Neural data are never resampled.

A Session cannot be modified directly. Processing returns a new Session,
leaving the original unchanged and recording the step in history:

    smoothed = session.with_neural(
        smoothed_neural,
        step="Gaussian smoothing, sigma=0.2 s"
    )

neural_type is required so functions can check whether a processing step is
appropriate. Steps that change the neural data type update it using
with_neural(..., neural_type=...).

Neural data are stored as frames x cells. Arrays in cells x frames format
must be transposed before loading.
"""
from __future__ import annotations

import dataclasses as dc

import numpy as np
import pandas as pd

__all__ = ["Session", "NEURAL_TYPES"]

NEURAL_TYPES = ("raw", "denoised", "deconvolved")


@dc.dataclass(frozen=True)
class Session:
    t: np.ndarray
    neural: np.ndarray
    behavior: pd.DataFrame
    cell_ids: np.ndarray
    neural_type: str
    config: dict = dc.field(default_factory=dict)
    name: str = ""
    history: tuple[str, ...] = ()

    def __post_init__(self):
        # Coerce inputs to their expected types. A frozen dataclass blocks normal
        # assignment, so object.__setattr__ is the documented way to set fields here.
        t = np.asarray(self.t, dtype=float)
        neural = np.asarray(self.neural, dtype=float)
        cell_ids = np.asarray(self.cell_ids)
        behavior = self.behavior.reset_index(drop=True)
        object.__setattr__(self, "t", t)
        object.__setattr__(self, "neural", neural)
        object.__setattr__(self, "cell_ids", cell_ids)
        object.__setattr__(self, "behavior", behavior)
        object.__setattr__(self, "history", tuple(self.history))

        # Check that every field agrees on n_frames and n_cells. These checks catch
        # most input mistakes (transposed arrays, off-by-one timestamp files,
        # behavior that was never aligned) before they turn into a wrong answer.
        if t.ndim != 1:
            raise ValueError(f"t must be 1-D, got shape {t.shape}")
        if neural.ndim != 2:
            raise ValueError(f"neural must be 2-D (frames x cells), got shape {neural.shape}")
        n_frames, n_cells = neural.shape
        if len(t) != n_frames:
            raise ValueError(
                f"t has {len(t)} timestamps but neural has {n_frames} rows. "
                f"If neural has {len(t)} columns instead, it is cells x frames: transpose it."
            )
        if len(behavior) != n_frames:
            raise ValueError(
                f"behavior has {len(behavior)} rows but there are {n_frames} neural frames. "
                "Behavior must be aligned to the neural clock first (cabana.structuring)."
            )
        if len(cell_ids) != n_cells:
            raise ValueError(f"{len(cell_ids)} cell_ids for {n_cells} cells")
        if len(np.unique(cell_ids)) != n_cells:
            raise ValueError("cell_ids are not unique")
        if self.neural_type not in NEURAL_TYPES:
            raise ValueError(f"neural_type must be one of {NEURAL_TYPES}, got {self.neural_type!r}")
        if n_frames > 1 and not np.all(np.diff(t) > 0):
            bad = int(np.argmax(np.diff(t) <= 0))
            raise ValueError(f"t is not strictly increasing (at frame {bad} -> {bad + 1})")

    @property
    def n_frames(self) -> int:
        return self.neural.shape[0]

    @property
    def n_cells(self) -> int:
        return self.neural.shape[1]

    @property
    def fps(self) -> float:
        """Frame rate from the median frame interval, so one dropped frame doesn't skew it."""
        return 1.0 / float(np.median(np.diff(self.t)))

    @property
    def duration_s(self) -> float:
        return float(self.t[-1] - self.t[0])

    def with_neural(self, neural, step: str, neural_type: str | None = None) -> Session:
        """
        A new Session with `neural` replaced and `step` added to the history.

        `neural_type` stays the same unless the step changes what the neural data is
        (a deconvolution step would pass neural_type="deconvolved").
        """
        return dc.replace(
            self,
            neural=neural,
            history=self.history + (step,),
            neural_type=neural_type or self.neural_type,
        )

    def __repr__(self) -> str:
        cols = ", ".join(self.behavior.columns) or "none"
        steps = " -> ".join(self.history) or "none"
        return (
            f"Session({self.name or 'unnamed'}: {self.n_cells} cells x {self.n_frames} frames, "
            f"{self.duration_s:.1f} s at {self.fps:.2f} fps, {self.neural_type})\n"
            f"  behavior columns: {cols}\n"
            f"  history: {steps}"
        )
