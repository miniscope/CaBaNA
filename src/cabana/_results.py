"""Result containers: what analyses return and what plots/tables consume."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

import numpy as np
import pandas as pd
from pydantic import BaseModel, ConfigDict, Field, model_validator

Tail = Literal["upper", "lower", "two"]


class ShuffleResult(BaseModel):
    """Observed metric values plus their null distribution (see ``ShuffleConfig.null``).

    All arrays share the metric's output shape ``S`` (e.g. ``(n_cells,)`` or
    ``(n_cells, n_states)``) except ``null`` and ``shifts``.  NaN in ``observed``
    gives NaN ``p_value`` and ``significant = False``.

    Attributes
    ----------
    observed : S float
        Metric on the unshifted data.
    null : (n_shuffles, *S) float | None
        Metric on each surrogate.  ``None`` when the test was run with
        ``ShuffleConfig(keep_null="none")`` (or the result was saved without
        it); ``p_value``, ``null_lo``/``null_hi``, ``null_median`` and
        ``null_mean`` are still stored.  Saved results reload it as float32.
    shifts : (n_shuffles,) int | None
        Frame offsets that were applied (``circular_shift`` only; ``None`` for
        other nulls).
    p_value : S float
        ``(count(null as-or-more-extreme than observed) + 1) / (n_valid + 1)``
        over the finite null draws, with "extreme" defined by ``tail``.  For
        ``tail == "two"`` it is ``2 * (smaller one-sided count + 1) / (n_valid + 1)``
        clipped to 1.  Floor: ``1 / (n_shuffles + 1)`` (two-tailed ``2 / (n_shuffles + 1)``).
    null_lo, null_hi : S float
        Percentiles of the null at ``alpha/2`` and ``1 - alpha/2`` (two-tailed)
        or at ``alpha``/``1 - alpha`` (one-tailed) -- the thresholds a value
        must cross to be called significant.
    significant : S bool
        ``p_value < alpha``; False where ``p_value`` is NaN.
    p_adj, significant_adj : S float, S bool, optional
        Adjusted p-values and ``p_adj < alpha`` under ``correction`` over
        ``correction_scope``; equal to the raw values when ``correction`` is
        ``"none"`` (``None`` only for results saved before this was added).
    alpha : float
        Significance level used.
    tail : {"upper", "lower", "two"}
        Tail that defined "extreme" (resolved from the metric when not given).
    n_shuffles : int
        Number of surrogates drawn.
    null_name : str, default "circular_shift"
        Registry name of the null that generated the surrogates.
    null_median, null_mean : S float | None
        Nan-median / nan-mean of the null draws (kept even when ``null`` is dropped).
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    observed: np.ndarray = Field(..., description="Metric on the unshifted data, shape S.")
    null: np.ndarray | None = Field(
        ..., description="Null draws (n_shuffles, *S); None when keep_null='none'."
    )
    shifts: np.ndarray | None = Field(
        ..., description="Frame offsets applied (circular_shift only), else None."
    )
    p_value: np.ndarray = Field(..., description="Permutation p-value, shape S (NaN if undefined).")
    null_lo: np.ndarray = Field(
        ..., description="Lower null percentile (alpha or alpha/2), shape S."
    )
    null_hi: np.ndarray = Field(
        ..., description="Upper null percentile (1-alpha or 1-alpha/2), shape S."
    )
    significant: np.ndarray = Field(..., description="p_value < alpha (False where NaN), shape S.")
    p_adj: np.ndarray | None = Field(
        None,
        description="Multiplicity-adjusted p-value, shape S (equals p_value when correction='none').",
    )
    significant_adj: np.ndarray | None = Field(
        None, description="p_adj < alpha (False where NaN), shape S."
    )
    correction: str = Field(
        "none", description="Correction applied: none, bh, bonferroni, max_stat."
    )
    correction_scope: str = Field(
        "states", description="Family of the correction: states, cells or all."
    )
    correction_note: str = Field("", description="Non-empty when the correction was a no-op.")
    alpha: float = Field(..., description="Significance level.")
    tail: Tail = Field(..., description="Tail defining 'extreme': upper, lower or two.")
    n_shuffles: int = Field(..., description="Number of surrogates drawn.")
    null_name: str = Field("circular_shift", description="Registry name of the null used.")
    null_median: np.ndarray | None = Field(
        None, description="Nan-median of the null draws, shape S (kept when null is dropped)."
    )
    null_mean: np.ndarray | None = Field(
        None, description="Nan-mean of the null draws, shape S (kept when null is dropped)."
    )


class MetricResult(BaseModel):
    """One metric evaluated on one target of one session.

    Attributes
    ----------
    metric : str
        Registry name of the metric.
    target : str
        Name of the ``StateSpace`` (or continuous signal) it was computed on.
    target_kind : {"states", "signal"}, default "states"
        Whether ``target`` is a state space or a signal.
    level : {"cell", "population"}
        Whether the leading axis of ``values`` is cells.
    values : ndarray
        ``shuffle.observed`` when a shuffle was run, else the plain metric.
        Shape ``(n_cells,)``, ``(n_cells, n_states)`` or a population shape.
    shuffle : ShuffleResult | None
        Null-distribution test, or ``None`` if no shuffle was configured.
    params : dict
        ``metric.to_dict()`` for provenance.
    extras : dict[str, ndarray]
        Metric-specific side outputs (e.g. rate maps, per-half maps); keys are
        documented in each metric's docstring.
    cell_ids : list[str] | None
        Row labels for cell-level results.
    state_names : list[str] | None
        Column labels when the metric has a per-state axis (for ``glm_encoding``
        these are the regressor group names).
    name : str | None
        Unique analysis name within a pipeline run (``AnalysisSpec.name`` or
        ``"metric[target]"`` plus a ``#null`` / ``#n`` suffix when needed).
        Defaults to ``"metric[target]"``.
    provenance : dict
        How the result was produced; filled by ``Pipeline.run`` with keys
        ``cabana_version``, ``seed``, ``null``, ``n_shuffles``, ``alpha``,
        ``tail`` (None without a shuffle), ``masks`` (names listed in the spec),
        ``support_used`` (bool), ``n_frames_used``, ``fs``, ``activity_kind``,
        ``n_cells``, ``target_kind``, ``target_params`` (parameters of the
        transform that produced the target, or None) and ``timestamp`` (ISO
        8601, UTC).  Empty for results built by hand.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    metric: str = Field(..., description="Registry name of the metric.")
    target: str = Field(..., description="Name of the state space or signal analysed.")
    target_kind: Literal["states", "signal"] = Field(
        "states", description="Whether the target is a state space or a signal."
    )
    level: Literal["cell", "population"] = Field(
        ..., description="'cell' if the leading axis of values is cells."
    )
    values: np.ndarray = Field(..., description="Observed metric values.")
    shuffle: ShuffleResult | None = Field(None, description="Null test; None if not run.")
    params: dict[str, Any] = Field(default_factory=dict, description="metric.to_dict().")
    extras: dict[str, np.ndarray] = Field(
        default_factory=dict, description="Metric-specific side outputs, keyed by name."
    )
    cell_ids: list[str] | None = Field(None, description="Row labels for cell-level results.")
    state_names: list[str] | None = Field(None, description="Column labels of the state axis.")
    name: str | None = Field(
        None, description="Unique analysis name; defaults to 'metric[target]'."
    )
    provenance: dict[str, Any] = Field(
        default_factory=dict, description="Version, seed, null, masks, frames used, timestamp, ..."
    )

    @model_validator(mode="after")
    def _check(self) -> MetricResult:
        if self.name is None:
            self.name = f"{self.metric}[{self.target}]"
        v = np.asarray(self.values)
        if self.level == "cell":
            if v.ndim == 0:
                raise ValueError("cell-level values must have a leading cell axis")
            if self.cell_ids is not None and len(self.cell_ids) != v.shape[0]:
                raise ValueError(
                    f"{self.name}: {len(self.cell_ids)} cell_ids but values has "
                    f"{v.shape[0]} rows (cells)"
                )
            if self.state_names is not None and v.ndim >= 2 and len(self.state_names) != v.shape[1]:
                raise ValueError(
                    f"{self.name}: {len(self.state_names)} state_names but values has "
                    f"{v.shape[1]} columns (states)"
                )
        elif self.state_names is not None and v.ndim >= 1 and len(self.state_names) != v.shape[0]:
            raise ValueError(
                f"{self.name}: {len(self.state_names)} state_names but values has "
                f"{v.shape[0]} entries along its first axis"
            )
        return self

    def _tag(self) -> dict[str, Any]:
        sh = self.shuffle
        return {
            "metric": self.metric,
            "target": self.target,
            "analysis": self.name,
            "null": None if sh is None else sh.null_name,
            "n_shuffles": 0 if sh is None else sh.n_shuffles,
            "correction": "none" if sh is None else sh.correction,
        }

    def state_index(self, state: int | str) -> int:
        """Column index of a state given by index or by name.

        Parameters
        ----------
        state : int or str
            A column index (returned unchanged) or a name in ``state_names``.

        Returns
        -------
        int
            Column index along the state axis of ``values``.

        Raises
        ------
        KeyError
            If ``state`` is a name that is not in ``state_names``.
        """
        if isinstance(state, str):
            names = self.state_names or []
            if state not in names:
                raise KeyError(f"state {state!r} not in state_names of {self.metric!r}: {names}")
            return names.index(state)
        return int(state)

    def to_dataframe(self) -> pd.DataFrame:
        """Tidy table with one row per (cell[, state]).

        Columns, in order: ``metric, target, cell, state, value, p_value,
        null_lo, null_hi, significant, p_adj, significant_adj, analysis, null,
        n_shuffles``.  ``analysis``
        is the unique analysis name, ``null`` the null's name (None without a
        shuffle), ``n_shuffles`` 0 without a shuffle.  Without a shuffle
        ``p_value``, ``null_lo`` and ``null_hi`` are NaN and ``significant`` is
        False.  A cell-level 1-D result has ``state = None``; a 1-D population
        result gives one row per state with ``cell = None``; a 2-D population
        result gives one row with ``cell = state = None`` and the whole array in
        ``value``.

        Returns
        -------
        pandas.DataFrame
        """
        df = self._frame()
        lead = [
            "metric",
            "target",
            "cell",
            "state",
            "value",
            "p_value",
            "null_lo",
            "null_hi",
            "significant",
            "p_adj",
            "significant_adj",
            "analysis",
            "null",
            "n_shuffles",
            "correction",
        ]
        return df[lead]

    def _frame(self) -> pd.DataFrame:
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
        padj = col(None if sh is None or sh.p_adj is None else sh.p_adj, np.nan)
        if sh is not None and sh.p_adj is None:
            padj = p
        sigadj = col(
            None if sh is None or sh.significant_adj is None else sh.significant_adj, False
        )
        if sh is not None and sh.significant_adj is None:
            sigadj = sig

        if self.values.ndim == 1:
            return pd.DataFrame(
                {
                    **self._tag(),
                    "cell": cells,
                    "state": None,
                    "value": self.values,
                    "p_value": p,
                    "null_lo": lo,
                    "null_hi": hi,
                    "significant": sig.astype(bool),
                    "p_adj": padj,
                    "significant_adj": sigadj.astype(bool),
                }
            )

        n_states = self.values.shape[1]
        snames = (
            self.state_names if self.state_names is not None else [str(i) for i in range(n_states)]
        )
        ci, si = np.meshgrid(np.arange(n_cells), np.arange(n_states), indexing="ij")
        return pd.DataFrame(
            {
                **self._tag(),
                "cell": np.asarray(cells, dtype=object)[ci.ravel()],
                "state": np.asarray(snames, dtype=object)[si.ravel()],
                "value": self.values.ravel(),
                "p_value": p.ravel(),
                "null_lo": lo.ravel(),
                "null_hi": hi.ravel(),
                "significant": sig.ravel().astype(bool),
                "p_adj": padj.ravel(),
                "significant_adj": sigadj.ravel().astype(bool),
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
                    **self._tag(),
                    "cell": None,
                    "state": names,
                    "value": self.values,
                    "p_value": nan if sh is None else sh.p_value,
                    "null_lo": nan if sh is None else sh.null_lo,
                    "null_hi": nan if sh is None else sh.null_hi,
                    "significant": np.zeros(n, bool) if sh is None else sh.significant.astype(bool),
                    "p_adj": nan if sh is None else (sh.p_value if sh.p_adj is None else sh.p_adj),
                    "significant_adj": np.zeros(n, bool)
                    if sh is None
                    else (
                        sh.significant if sh.significant_adj is None else sh.significant_adj
                    ).astype(bool),
                }
            )
        return pd.DataFrame(
            [
                {
                    **self._tag(),
                    "cell": None,
                    "state": None,
                    "value": self.values,
                    "p_value": np.nan,
                    "null_lo": np.nan,
                    "null_hi": np.nan,
                    "significant": False,
                    "p_adj": np.nan,
                    "significant_adj": False,
                }
            ]
        )


class RunError(BaseModel):
    """An analysis that failed during a run with ``on_error="record"``."""

    analysis: str
    metric: str
    target: str
    error_type: str
    message: str
    traceback: str = ""


class RunWarning(BaseModel):
    """A warning raised while an analysis ran (``capture_warnings=True``)."""

    analysis: str
    category: str
    message: str
    count: int = 1  # times this (category, message) was raised during the analysis


class ResultSet(BaseModel):
    """All results from one pipeline run, in analysis order.

    Supports ``len``, iteration over ``MetricResult`` objects, ``rs["name"]`` and
    :meth:`get`.

    Attributes
    ----------
    results : list[MetricResult]
        The results; add with :meth:`add`.
    status : {"ok", "cancelled", "partial"}, default "ok"
        ``"cancelled"`` if the run was stopped by ``should_cancel`` (the results
        are those completed so far), ``"partial"`` if errors were recorded
        (``on_error="record"``), else ``"ok"``.
    errors : list[RunError]
        Analyses that failed and were skipped.
    warnings : list[RunWarning]
        Warnings captured per analysis (``RunContext.capture_warnings``).
    completed : list[str]
        Names of the analyses that finished, in order.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    results: list[MetricResult] = Field(
        default_factory=list, description="MetricResult objects in analysis order."
    )

    status: Literal["ok", "cancelled", "partial"] = "ok"
    errors: list[RunError] = Field(default_factory=list)
    warnings: list[RunWarning] = Field(default_factory=list)
    completed: list[str] = Field(default_factory=list)

    @property
    def cancelled(self) -> bool:
        """True if the run was cancelled before all analyses finished."""
        return self.status == "cancelled"

    def add(self, r: MetricResult) -> None:
        """Append a result."""
        self.results.append(r)

    def names(self) -> list[str]:
        """Analysis names of all results, in order.

        Returns
        -------
        list[str]
        """
        return [str(r.name) for r in self.results]

    def __getitem__(self, name: str) -> MetricResult:
        """Result by exact analysis name.

        Parameters
        ----------
        name : str
            Analysis name, e.g. ``"auroc[social]"`` (see :meth:`names`).

        Returns
        -------
        MetricResult

        Raises
        ------
        KeyError
            If no analysis has that name.
        """
        for r in self.results:
            if r.name == name:
                return r
        raise KeyError(f"no analysis named {name!r}; available: {self.names()}")

    def get(
        self,
        metric: str | None = None,
        target: str | None = None,
        *,
        name: str | None = None,
        null: str | None = None,
    ) -> MetricResult:
        """The single result matching the filters.

        ``name`` matches the analysis name exactly.  Otherwise results are
        filtered by ``metric``, ``target`` and ``null`` (the null's registry
        name).  Raises ``KeyError`` if nothing matches, or if several do (the
        message lists their names; pass ``name=...``).

        Parameters
        ----------
        metric : str, optional
            Metric registry name.
        target : str, optional
            State-space or signal name.
        name : str, optional
            Exact analysis name (takes precedence over the other filters).
        null : str, optional
            Name of the null of the result's shuffle; results without a shuffle
            never match when this is given.

        Returns
        -------
        MetricResult
        """
        if name is not None:
            return self[name]
        hits = [
            r
            for r in self.results
            if (metric is None or r.metric == metric)
            and (target is None or r.target == target)
            and (null is None or (r.shuffle is not None and r.shuffle.null_name == null))
        ]
        if not hits:
            raise KeyError(
                f"no result for metric={metric!r}, target={target!r}, null={null!r}; "
                f"available: {self.names()}"
            )
        if len(hits) > 1:
            raise KeyError(
                f"ambiguous: {len(hits)} results match metric={metric!r}, target={target!r}, "
                f"null={null!r}: {[r.name for r in hits]}; pass name=..."
            )
        return hits[0]

    def save(self, path: str | Path) -> None:
        """Write to a directory or ``.zip``: ``manifest.json`` plus one ``.npz`` per result.

        Parameters
        ----------
        path : str or Path
            A directory (created as needed) or a path ending in ``.zip``.  Null
            draws are stored as float32; ``params`` and ``provenance`` as JSON.
        """
        from ._io import save_results

        save_results(self, path)

    @classmethod
    def load(cls, path: str | Path) -> ResultSet:
        """Read a ``ResultSet`` written by :meth:`save` (null draws come back as float32).

        Parameters
        ----------
        path : str or Path
            Directory or ``.zip`` written by :meth:`save`.

        Returns
        -------
        ResultSet

        Raises
        ------
        FileNotFoundError
            If ``path`` is neither a directory nor a zip file.
        ValueError
            If it holds no ``manifest.json`` or is not a saved ``ResultSet``.
        """
        from ._io import load_results

        return load_results(path)

    @property
    def selections(self) -> list[dict[str, Any]]:
        """De-duplicated ``provenance["selections"]`` records across all results (JSON dicts)."""
        seen: set[str] = set()
        out: list[dict[str, Any]] = []
        for r in self.results:
            for s in r.provenance.get("selections") or []:
                key = json.dumps(s, sort_keys=True, default=str)
                if key not in seen:
                    seen.add(key)
                    out.append(s)
        return out

    def to_dataframe(self) -> pd.DataFrame:
        """Tidy table over cell-level results and per-state population results.

        Population matrices (2-D values such as population-vector overlap) are
        left out; fetch them with :meth:`get`.

        Returns
        -------
        pandas.DataFrame
            Concatenation of each result's :meth:`MetricResult.to_dataframe`
            (columns ``metric, target, cell, state, value, p_value, null_lo,
            null_hi, significant, p_adj, significant_adj, analysis, null, n_shuffles,
            correction``); an empty frame
            with those columns if nothing qualifies.
        """
        frames = [r.to_dataframe() for r in self.results if r.level == "cell" or r.values.ndim == 1]
        if not frames:
            return pd.DataFrame(
                columns=[
                    "metric",
                    "target",
                    "cell",
                    "state",
                    "value",
                    "p_value",
                    "null_lo",
                    "null_hi",
                    "significant",
                    "analysis",
                    "null",
                    "n_shuffles",
                    "p_adj",
                    "significant_adj",
                    "correction",
                ]
            )
        return pd.concat(frames, ignore_index=True)

    def __iter__(self):
        return iter(self.results)

    def __len__(self) -> int:
        return len(self.results)


__all__ = ["MetricResult", "ResultSet", "ShuffleResult", "Tail"]
