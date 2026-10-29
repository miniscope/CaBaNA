"""Cross-session map and population-vector correlation with a shuffled-pairing null."""

from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd
from pydantic import BaseModel, ConfigDict, Field

from ._models import CellMatch
from .._models import StateSpace
from .._results import MetricResult
from .._shuffle import _p_values


class CrossSessionResult(BaseModel):
    """Correlations between two sessions plus a shuffled-pairing null.

    ``kind == "map"``: one entry per matched cell pair (``observed`` is
    ``(n_pairs,)``); ``null`` is the exact per-pair null ``(n_pairs, n_pairs - 1)``:
    row ``i`` holds r between cell ``a_i`` and every *other* matched partner
    ``b_j`` (``j != i``).  ``kind == "pv"``: one entry per state (``(n_states,)``
    / ``(n_shuffles, n_states)`` permutation null).  ``median_observed`` and
    ``null_median`` (``(n_shuffles,)``, medians over random derangements)
    summarize the population; ``p_population`` is the upper-tail p of the median.
    With ``n_pairs`` matched cells the smallest attainable per-pair p is
    ``1 / n_pairs``.

    Attributes
    ----------
    kind : {"map", "pv"}
        Per matched cell (``"map"``) or per state (``"pv"``).
    session_a, session_b : str | None
        Session ids of the registration.
    observed : (n_pairs,) or (n_states,) float
        Pearson r per matched cell pair (``map``) or per state (``pv``); NaN when
        undefined.
    null : (n_pairs, n_pairs - 1) or (n_shuffles, n_states) float
        Null correlations: all mismatched partners per pair (``map``) or random
        re-pairings (``pv``).
    p_value : same shape as ``observed``
        Upper-tail permutation p-value (NaN-aware).
    significant : same shape as ``observed``, bool
        ``p_value < alpha``; False where NaN.
    pairs : (n_pairs, 2) int
        ``CellMatch.pairs`` used: cell indices in session a and b.
    state_names : list[str] | None
        State labels of the maps (per-state axis).
    cell_ids_a, cell_ids_b : list[str] | None
        Cell ids of the two sessions' results, indexed by ``pairs``.
    alpha : float, default 0.05
        Significance level.
    n_shuffles : int
        Random derangements used for the population summary (and the ``pv`` null).
    median_observed : float
        Nan-median of ``observed`` (NaN if none finite).
    null_median : (n_shuffles,) float
        Median correlation of each random derangement.
    p_population : float
        ``(count(null_median >= median_observed) + 1) / (n_finite + 1)``.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    kind: str = Field(..., description="'map' (per matched cell) or 'pv' (per state).")
    session_a: str | None = Field(None, description="Session id of the first session.")
    session_b: str | None = Field(None, description="Session id of the second session.")
    observed: np.ndarray = Field(..., description="Pearson r per pair (map) or per state (pv).")
    null: np.ndarray = Field(..., description="Null correlations (see class docstring).")
    p_value: np.ndarray = Field(..., description="Upper-tail p-value per entry of observed.")
    significant: np.ndarray = Field(..., description="p_value < alpha per entry of observed.")
    pairs: np.ndarray = Field(..., description="(n_pairs, 2) cell indices in sessions a and b.")
    state_names: list[str] | None = Field(None, description="Labels of the state axis.")
    cell_ids_a: list[str] | None = Field(None, description="Cell ids of session a's result.")
    cell_ids_b: list[str] | None = Field(None, description="Cell ids of session b's result.")
    alpha: float = Field(0.05, description="Significance level.")
    n_shuffles: int = Field(..., description="Number of random derangements.")
    median_observed: float = Field(..., description="Nan-median of observed.")
    null_median: np.ndarray = Field(..., description="Per-derangement median r, (n_shuffles,).")
    p_population: float = Field(..., description="Upper-tail p of median_observed vs null_median.")

    def summary(self) -> dict[str, Any]:
        """Small dict of kind, sessions, counts, median r and population p.

        Returns
        -------
        dict
            Keys ``kind, session_a, session_b, n_entries, n_shuffles,
            median_observed, p_population, n_significant, alpha``.
        """
        n = int(self.observed.shape[0])
        return {
            "kind": self.kind,
            "session_a": self.session_a,
            "session_b": self.session_b,
            "n_entries": n,
            "n_shuffles": self.n_shuffles,
            "median_observed": float(self.median_observed),
            "p_population": float(self.p_population),
            "n_significant": int(np.asarray(self.significant).sum()),
            "alpha": self.alpha,
        }

    def __repr__(self) -> str:
        d = self.summary()
        return (
            f"CrossSessionResult(kind={d['kind']!r}, {d['session_a']!r} -> {d['session_b']!r}, "
            f"n={d['n_entries']}, median_r={d['median_observed']:.3g}, "
            f"p_population={d['p_population']:.3g}, n_significant={d['n_significant']})"
        )

    def to_dataframe(self) -> pd.DataFrame:
        """One row per matched pair (kind ``map``) or per state (kind ``pv``).

        Returns
        -------
        pandas.DataFrame
            Columns ``cell_a, cell_b, r, p_value, significant`` (``map``) or
            ``state, r, p_value, significant`` (``pv``).
        """
        if self.kind == "map":
            ia, ib = self.pairs[:, 0], self.pairs[:, 1]
            ca = [self.cell_ids_a[i] for i in ia] if self.cell_ids_a else [str(i) for i in ia]
            cb = [self.cell_ids_b[i] for i in ib] if self.cell_ids_b else [str(i) for i in ib]
            return pd.DataFrame(
                {
                    "cell_a": ca,
                    "cell_b": cb,
                    "r": self.observed,
                    "p_value": self.p_value,
                    "significant": self.significant,
                }
            )
        n = self.observed.shape[0]
        names = self.state_names if self.state_names is not None else [str(i) for i in range(n)]
        return pd.DataFrame(
            {
                "state": names,
                "r": self.observed,
                "p_value": self.p_value,
                "significant": self.significant,
            }
        )


def _pearson_rows(a: np.ndarray, b: np.ndarray, min_n: int) -> np.ndarray:
    """Row-wise Pearson r over entries finite in both; NaN if < ``min_n`` or near-constant."""
    both = np.isfinite(a) & np.isfinite(b)
    n = both.sum(axis=1)
    a0 = np.where(both, a, 0.0)
    b0 = np.where(both, b, 0.0)
    with np.errstate(divide="ignore", invalid="ignore"):
        ma = a0.sum(axis=1) / n
        mb = b0.sum(axis=1) / n
        da = np.where(both, a0 - ma[:, None], 0.0)
        db = np.where(both, b0 - mb[:, None], 0.0)
        va = (da * da).sum(axis=1)
        vb = (db * db).sum(axis=1)
        num = (da * db).sum(axis=1)
        # relative tolerance: variance vs the mean square of the raw values
        sa = (a0 * a0).sum(axis=1)
        sb = (b0 * b0).sum(axis=1)
        ok = (va > 1e-12 * sa) & (vb > 1e-12 * sb) & (va > 0) & (vb > 0)
        r = np.where(ok, num / np.sqrt(va * vb), np.nan)
    return np.where(n >= min_n, np.clip(r, -1.0, 1.0), np.nan)


def _topology_edges(s: StateSpace) -> list[np.ndarray] | None:
    return None if s.topology is None else [np.asarray(e) for e in s.topology.edges]


def _get_maps(
    res_a: MetricResult,
    res_b: MetricResult,
    maps: tuple[str, str],
    states: tuple[StateSpace, StateSpace] | None,
) -> tuple[np.ndarray, np.ndarray]:
    if res_a.metric != res_b.metric:
        raise ValueError(
            f"results are from different metrics: {res_a.metric!r} vs {res_b.metric!r}"
        )
    if res_a.state_names is not None and res_b.state_names is not None:
        if list(res_a.state_names) != list(res_b.state_names):
            raise ValueError(
                "state_names differ between the two results; cross-session comparison needs "
                "the same state space definition in both sessions"
            )
    for res, key, tag in ((res_a, maps[0], "a"), (res_b, maps[1], "b")):
        if key not in res.extras:
            raise KeyError(
                f"result {tag} has no extras[{key!r}] (available: {sorted(res.extras)}); "
                "run a metric that stores maps, e.g. information_content"
            )
    A = np.asarray(res_a.extras[maps[0]], dtype=np.float64)
    B = np.asarray(res_b.extras[maps[1]], dtype=np.float64)
    if A.ndim != 2 or B.ndim != 2:
        raise ValueError("maps must be (n_cells, n_states) arrays")
    if A.shape[1] != B.shape[1]:
        raise ValueError(f"maps have different numbers of states: {A.shape[1]} vs {B.shape[1]}")
    if states is not None:
        ea, eb = _topology_edges(states[0]), _topology_edges(states[1])
        if (ea is None) != (eb is None):
            raise ValueError("one state space has a GridTopology and the other does not")
        if ea is not None and eb is not None:
            ok = len(ea) == len(eb) and all(
                x.shape == y.shape and np.allclose(x, y) for x, y in zip(ea, eb, strict=True)
            )
            if not ok:
                raise ValueError(
                    "GridTopology edges differ between the two state spaces; rebin both sessions "
                    "onto the same grid before comparing"
                )
        if list(states[0].state_names) != list(states[1].state_names):
            raise ValueError("state_names differ between the two state spaces")
    return A, B


def _derangement(rng: np.random.Generator, n: int) -> np.ndarray:
    """Random permutation with no fixed points (rejection; identity for n < 2)."""
    if n < 2:
        return np.arange(n)
    idx = np.arange(n)
    while True:
        perm = rng.permutation(n)
        if not (perm == idx).any():
            return perm


def _pair_arrays(A: np.ndarray, B: np.ndarray, match: CellMatch) -> tuple[np.ndarray, np.ndarray]:
    p = match.pairs
    if p.shape[0] == 0:
        raise ValueError("match has no pairs")
    if p[:, 0].max() >= A.shape[0] or p[:, 1].max() >= B.shape[0]:
        raise ValueError("match refers to cell indices outside the results")
    return A[p[:, 0]], B[p[:, 1]]


def _finish(
    kind: str,
    observed: np.ndarray,
    null: np.ndarray,
    p: np.ndarray,
    null_med: np.ndarray,
    match: CellMatch,
    res_a: MetricResult,
    res_b: MetricResult,
    alpha: float,
    n_shuffles: int,
) -> CrossSessionResult:
    med = float(np.nanmedian(observed)) if np.isfinite(observed).any() else float("nan")
    fin = np.isfinite(null_med)
    if np.isfinite(med) and fin.any():
        p_pop = float((np.sum(null_med[fin] >= med - 1e-12) + 1) / (fin.sum() + 1))
    else:
        p_pop = float("nan")
    return CrossSessionResult(
        kind=kind,
        session_a=match.session_a,
        session_b=match.session_b,
        observed=observed,
        null=null,
        p_value=p,
        significant=np.where(np.isfinite(p), p < alpha, False),
        pairs=match.pairs,
        state_names=res_a.state_names,
        cell_ids_a=res_a.cell_ids,
        cell_ids_b=res_b.cell_ids,
        alpha=alpha,
        n_shuffles=int(n_shuffles),
        median_observed=med,
        null_median=null_med,
        p_population=p_pop,
    )


def _nanmedian_rows(x: np.ndarray) -> np.ndarray:
    out = np.full(x.shape[0], np.nan)
    for i, r in enumerate(x):
        f = r[np.isfinite(r)]
        if f.size:
            out[i] = np.median(f)
    return out


def cross_session_map_correlation(
    res_a: MetricResult,
    res_b: MetricResult,
    match: CellMatch,
    *,
    maps: tuple[str, str] = ("rate_map", "rate_map"),
    n_shuffles: int = 1000,
    seed: int = 0,
    alpha: float = 0.05,
    min_states: int = 3,
    states: tuple[StateSpace, StateSpace] | None = None,
) -> CrossSessionResult:
    """Per matched cell, Pearson r between its map in session a and in b.

    r uses states finite in both maps (NaN if fewer than ``min_states`` or if a
    map is near-constant).  Per-pair null is exact: for each matched cell ``a_i``
    r is computed against every other matched partner ``b_j`` (``j != i``), giving
    ``null`` of shape ``(n_pairs, n_pairs - 1)``.  The per-pair p is
    ``(1 + #{j: r_ij >= r_ii}) / (1 + #finite alternatives)`` (NaN if the observed
    r is NaN or no alternative is finite), so with ``n_pairs`` matched cells the
    smallest attainable p is ``1 / n_pairs``.  The population summary compares the
    median observed r to the median r over ``n_shuffles`` random derangements of
    the pairing (NaN-aware).  Pass ``states=(space_a, space_b)`` to additionally
    verify grid topology edges.

    Parameters
    ----------
    res_a, res_b : MetricResult
        Results of the same metric in the two sessions, each with the map in
        ``extras`` (e.g. ``information_content`` ``rate_map``, ``(n_cells, n_states)``).
    match : CellMatch
        Registration from session a's cells to session b's cells.
    maps : (str, str), default ("rate_map", "rate_map")
        ``extras`` keys of the maps in ``res_a`` and ``res_b``.
    n_shuffles : int, default 1000
        Random derangements for the population-level null.
    seed : int, default 0
        RNG seed.
    alpha : float, default 0.05
        Significance level for ``significant``.
    min_states : int, default 3
        Minimum states finite in both maps for r to be defined.
    states : (StateSpace, StateSpace), optional
        State spaces of the two sessions, to check that names and grid edges match.

    Returns
    -------
    CrossSessionResult
        ``kind="map"``; ``observed`` has shape ``(n_pairs,)``.

    Raises
    ------
    ValueError
        If the results come from different metrics, state names / grids differ,
        maps are not 2-D, or the match is empty or out of range.
    KeyError
        If a result lacks the requested ``extras`` key.
    """
    A, B = _get_maps(res_a, res_b, maps, states)
    Ap, Bp = _pair_arrays(A, B, match)
    observed = _pearson_rows(Ap, Bp, min_states)
    rng = np.random.default_rng(seed)
    n = Ap.shape[0]
    null = np.full((n, max(n - 1, 0)), np.nan)
    for i in range(n):
        others = np.delete(np.arange(n), i)
        if others.size:
            null[i] = _pearson_rows(
                np.broadcast_to(Ap[i], (others.size, Ap.shape[1])), Bp[others], min_states
            )
    # p per pair: transpose so columns are pairs
    p = _p_values(observed, null.T, "upper")
    pop = np.empty((n_shuffles, n))
    for k in range(n_shuffles):
        pop[k] = _pearson_rows(Ap, Bp[_derangement(rng, n)], min_states)
    return _finish(
        "map", observed, null, p, _nanmedian_rows(pop), match, res_a, res_b, alpha, n_shuffles
    )


def cross_session_pv_correlation(
    res_a: MetricResult,
    res_b: MetricResult,
    match: CellMatch,
    maps: tuple[str, str] = ("rate_map", "rate_map"),
    n_shuffles: int = 1000,
    seed: int = 0,
    alpha: float = 0.05,
    min_cells: int = 3,
    states: tuple[StateSpace, StateSpace] | None = None,
) -> CrossSessionResult:
    """Per state, Pearson r across matched cells between the two population vectors.

    Null: random re-pairing of cells (derangements), giving ``null`` of shape
    ``(n_shuffles, n_states)``.  The p-value is NaN-aware (only finite null draws
    count).  Documented floor: with ``n_pairs`` matched cells the smallest
    per-pair p of the map correlation is ``1 / n_pairs``; here the floor is
    ``1 / (n_shuffles + 1)`` but the vectors rest on only ``n_pairs`` cells.

    Parameters
    ----------
    res_a, res_b : MetricResult
        Results of the same metric in the two sessions, each with the map in
        ``extras`` (``(n_cells, n_states)``).
    match : CellMatch
        Registration from session a's cells to session b's cells.
    maps : (str, str), default ("rate_map", "rate_map")
        ``extras`` keys of the maps in ``res_a`` and ``res_b``.
    n_shuffles : int, default 1000
        Random re-pairings for the null.
    seed : int, default 0
        RNG seed.
    alpha : float, default 0.05
        Significance level for ``significant``.
    min_cells : int, default 3
        Minimum matched cells finite in both vectors for r to be defined.
    states : (StateSpace, StateSpace), optional
        State spaces of the two sessions, to check that names and grid edges match.

    Returns
    -------
    CrossSessionResult
        ``kind="pv"``; ``observed`` has shape ``(n_states,)`` and ``null`` has
        shape ``(n_shuffles, n_states)``.

    Raises
    ------
    ValueError, KeyError
        As :func:`cross_session_map_correlation`.
    """
    A, B = _get_maps(res_a, res_b, maps, states)
    Ap, Bp = _pair_arrays(A, B, match)
    observed = _pearson_rows(Ap.T, Bp.T, min_cells)
    rng = np.random.default_rng(seed)
    n = Ap.shape[0]
    null = np.empty((n_shuffles, Ap.shape[1]))
    for i in range(n_shuffles):
        null[i] = _pearson_rows(Ap.T, Bp[_derangement(rng, n)].T, min_cells)
    p = _p_values(observed, null, "upper")
    with np.errstate(all="ignore"):
        null_med = _nanmedian_rows(null)
    return _finish("pv", observed, null, p, null_med, match, res_a, res_b, alpha, n_shuffles)


def remapping_summary(cs: CrossSessionResult, alpha: float = 0.05) -> dict[str, Any]:
    """Fraction of matched cells that are stable (p < alpha), median r, n_pairs, p_population.

    Parameters
    ----------
    cs : CrossSessionResult
        Result of :func:`cross_session_map_correlation` (or the ``pv`` variant,
        in which case "cells" are states).
    alpha : float, default 0.05
        Threshold on ``cs.p_value`` (independent of ``cs.alpha``).

    Returns
    -------
    dict
        ``n_pairs`` (entries), ``n_valid`` (finite p-values), ``fraction_stable``
        (share of valid entries with ``p < alpha``; NaN if none valid),
        ``median_r`` and ``p_population``.
    """
    valid = np.isfinite(cs.p_value)
    n_valid = int(valid.sum())
    frac = float((cs.p_value[valid] < alpha).mean()) if n_valid else float("nan")
    return {
        "n_pairs": int(cs.observed.shape[0]),
        "n_valid": n_valid,
        "fraction_stable": frac,
        "median_r": cs.median_observed,
        "p_population": cs.p_population,
    }


__all__ = [
    "CrossSessionResult",
    "cross_session_map_correlation",
    "cross_session_pv_correlation",
    "remapping_summary",
]
