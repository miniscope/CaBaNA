"""Result containers: what analyses return and what plots/tables consume."""

from __future__ import annotations

from typing import Any, Literal

import numpy as np
import pandas as pd
from pydantic import BaseModel, ConfigDict, Field

Tail = Literal["upper", "lower", "two"]


class ShuffleResult(BaseModel):
    """Observed metric values plus their circular-shift null distribution.

    All arrays share the metric's output shape ``S`` (e.g. ``(n_cells,)`` or
    ``(n_cells, n_states)``) except ``null`` and ``shifts``.

    Attributes
    ----------
    observed : S float
        Metric on the unshifted data.
    null : (n_shuffles, *S) float
        Metric on each shifted copy.
    shifts : (n_shuffles,) int | None
        Frame offsets that were applied (``circular_shift`` only).
    null_name : str
        Registry name of the null that generated the surrogates.
    p_value : S float
        ``(count(null as-or-more-extreme than observed) + 1) / (n_shuffles + 1)``,
        with "extreme" defined by ``tail``.  For ``tail == "two"`` the
        smaller one-sided count is doubled and clipped to 1.
    null_lo, null_hi : S float
        Percentiles of the null at ``alpha/2`` and ``1 - alpha/2`` (two-tailed)
        or at ``alpha``/``1 - alpha`` (one-tailed) -- the thresholds a value
        must cross to be called significant.
    significant : S bool
        ``p_value < alpha``.
    alpha, tail, n_shuffles
        The test parameters, kept for provenance.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    observed: np.ndarray
    null: np.ndarray
    shifts: np.ndarray | None
    p_value: np.ndarray
    null_lo: np.ndarray
    null_hi: np.ndarray
    significant: np.ndarray
    alpha: float
    tail: Tail
    n_shuffles: int
    null_name: str = "circular_shift"


class MetricResult(BaseModel):
    """One metric evaluated on one state space of one session.

    Attributes
    ----------
    metric : str
        Registry name of the metric.
    target : str
        Name of the ``StateSpace`` (or continuous signal) it was computed on.
    target_kind : {"states", "signal"}
    level : {"cell", "population"}
    values : ndarray
        ``shuffle.observed`` when a shuffle was run, else the plain metric.
    shuffle : ShuffleResult | None
    params : dict
        ``metric.to_dict()`` for provenance.
    extras : dict[str, ndarray]
        Metric-specific side outputs (e.g. rate maps, per-half maps).
    cell_ids : list[str] | None
        Row labels for cell-level results.
    state_names : list[str] | None
        Column labels when the metric has a per-state axis.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    metric: str
    target: str
    target_kind: Literal["states", "signal"] = "states"
    level: Literal["cell", "population"]
    values: np.ndarray
    shuffle: ShuffleResult | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    extras: dict[str, np.ndarray] = Field(default_factory=dict)
    cell_ids: list[str] | None = None
    state_names: list[str] | None = None

    def to_dataframe(self) -> pd.DataFrame:
        """Tidy table with one row per (cell[, state]).

        Columns: ``metric, target, cell, state, value, p_value, null_lo,
        null_hi, significant``.  Population-level results produce one row
        with ``cell = state = None`` and the array in ``value``.
        """
        if self.level == "population":
            return self._population_frame()

        n_cells = self.values.shape[0]
        cells = self.cell_ids if self.cell_ids is not None else [str(i) for i in range(n_cells)]
        sh = self.shuffle

        def col(arr: np.ndarray | None, fill: Any) -> np.ndarray:
            if arr is None:
                return np.full(self.values.shape, fill)
            return arr

        p = col(None if sh is None else sh.p_value, np.nan)
        lo = col(None if sh is None else sh.null_lo, np.nan)
        hi = col(None if sh is None else sh.null_hi, np.nan)
        sig = col(None if sh is None else sh.significant, False)

        if self.values.ndim == 1:
            return pd.DataFrame(
                {
                    "metric": self.metric,
                    "target": self.target,
                    "cell": cells,
                    "state": None,
                    "value": self.values,
                    "p_value": p,
                    "null_lo": lo,
                    "null_hi": hi,
                    "significant": sig.astype(bool),
                }
            )

        n_states = self.values.shape[1]
        snames = (
            self.state_names if self.state_names is not None else [str(i) for i in range(n_states)]
        )
        ci, si = np.meshgrid(np.arange(n_cells), np.arange(n_states), indexing="ij")
        return pd.DataFrame(
            {
                "metric": self.metric,
                "target": self.target,
                "cell": np.asarray(cells, dtype=object)[ci.ravel()],
                "state": np.asarray(snames, dtype=object)[si.ravel()],
                "value": self.values.ravel(),
                "p_value": p.ravel(),
                "null_lo": lo.ravel(),
                "null_hi": hi.ravel(),
                "significant": sig.ravel().astype(bool),
            }
        )


    def _population_frame(self) -> pd.DataFrame:
        """Per-state rows for a 1-D population result; one row holding the array otherwise."""
        sh = self.shuffle
        if self.values.ndim == 1:
            n = self.values.shape[0]
            names = self.state_names if self.state_names is not None else [str(i) for i in range(n)]
            nan = np.full(n, np.nan)
            return pd.DataFrame(
                {
                    "metric": self.metric,
                    "target": self.target,
                    "cell": None,
                    "state": names,
                    "value": self.values,
                    "p_value": nan if sh is None else sh.p_value,
                    "null_lo": nan if sh is None else sh.null_lo,
                    "null_hi": nan if sh is None else sh.null_hi,
                    "significant": np.zeros(n, bool) if sh is None else sh.significant.astype(bool),
                }
            )
        return pd.DataFrame(
            [
                {
                    "metric": self.metric,
                    "target": self.target,
                    "cell": None,
                    "state": None,
                    "value": self.values,
                    "p_value": np.nan,
                    "null_lo": np.nan,
                    "null_hi": np.nan,
                    "significant": False,
                }
            ]
        )


class ResultSet(BaseModel):
    """All results from one pipeline run."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    results: list[MetricResult] = Field(default_factory=list)

    def add(self, r: MetricResult) -> None:
        self.results.append(r)

    def get(self, metric: str, target: str | None = None) -> MetricResult:
        hits = [r for r in self.results if r.metric == metric and (target is None or r.target == target)]
        if not hits:
            raise KeyError(f"no result for metric={metric!r}, target={target!r}")
        if len(hits) > 1:
            raise KeyError(f"ambiguous: {len(hits)} results for metric={metric!r}; pass target=")
        return hits[0]

    def to_dataframe(self) -> pd.DataFrame:
        """Tidy table over cell-level results and per-state population results.

        Population matrices (2-D values such as population-vector overlap) are
        left out; fetch them with :meth:`get`.
        """
        frames = [
            r.to_dataframe()
            for r in self.results
            if r.level == "cell" or r.values.ndim == 1
        ]
        if not frames:
            return pd.DataFrame(
                columns=["metric", "target", "cell", "state", "value", "p_value", "null_lo", "null_hi", "significant"]
            )
        return pd.concat(frames, ignore_index=True)

    def __iter__(self):
        return iter(self.results)

    def __len__(self) -> int:
        return len(self.results)


__all__ = ["MetricResult", "ResultSet", "ShuffleResult", "Tail"]
