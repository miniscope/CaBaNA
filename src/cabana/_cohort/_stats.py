"""Cohort statistics where the animal, not the cell, is the unit of replication."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Literal

import numpy as np
import pandas as pd
from pydantic import BaseModel, ConfigDict, Field
from scipy import stats

from .._results import ResultSet


def cohort_table(results_by_session: dict[str, ResultSet], animal: dict[str, str]) -> pd.DataFrame:
    """Long table of every session's ``ResultSet.to_dataframe()`` plus ``session`` and ``animal``.

    Parameters
    ----------
    results_by_session : dict[str, ResultSet]
        Results of one pipeline run per session id.
    animal : dict[str, str]
        Animal id of each session id; every session in ``results_by_session``
        needs an entry.

    Returns
    -------
    pandas.DataFrame
        The concatenated ``ResultSet.to_dataframe()`` columns followed by
        ``session`` and ``animal``.

    Raises
    ------
    KeyError
        If a session has no animal.
    ValueError
        If ``results_by_session`` is empty.
    """
    frames = []
    for sid, rs in results_by_session.items():
        if sid not in animal:
            raise KeyError(f"session {sid!r} has no animal")
        df = rs.to_dataframe().copy()
        df["session"] = sid
        df["animal"] = animal[sid]
        frames.append(df)
    if not frames:
        raise ValueError("no results given")
    return pd.concat(frames, ignore_index=True)


def _select(
    table: pd.DataFrame,
    metric: str | None = None,
    target: str | None = None,
    analysis: str | None = None,
) -> pd.DataFrame:
    """Rows of one analysis: by ``analysis`` name, or by ``metric`` and ``target``.

    Raises ``ValueError`` (rather than silently pooling) when ``metric``/``target``
    matches more than one analysis name, e.g. the same metric run under two nulls.
    """
    if analysis is not None:
        if "analysis" not in table.columns:
            raise KeyError("table has no 'analysis' column; select with metric= and target=")
        sub = table[table["analysis"] == analysis]
        if sub.empty:
            raise KeyError(
                f"no rows for analysis={analysis!r}; available: {sorted(table['analysis'].unique())}"
            )
        return sub
    if metric is None or target is None:
        raise ValueError("pass analysis=..., or both metric= and target=")
    sub = table[(table["metric"] == metric) & (table["target"] == target)]
    if sub.empty:
        raise KeyError(f"no rows for metric={metric!r}, target={target!r}")
    if "analysis" in sub.columns:
        names = sorted(sub["analysis"].dropna().unique())
        if len(names) > 1:
            raise ValueError(
                f"metric={metric!r}, target={target!r} matches {len(names)} analyses {names}; "
                "pass analysis=..."
            )
    return sub


def _units(df: pd.DataFrame) -> pd.Series:
    """Cell identity: (session, cell) when sessions are present."""
    if "session" in df.columns:
        return df["session"].astype(str) + "|" + df["cell"].astype(str)
    return df["cell"].astype(str)


def _sig_column(sub: pd.DataFrame, adjusted: bool | None) -> str:
    """Name of the significance column to use: ``significant`` or ``significant_adj``.

    ``None`` picks ``significant_adj`` when the selected rows have a shuffle
    (``null`` present) and carry a correction other than "none".
    """
    if adjusted is None:
        if "significant_adj" not in sub.columns or "correction" not in sub.columns:
            return "significant"
        has_null = "null" not in sub.columns or sub["null"].notna().any()
        corrected = (sub["correction"].dropna().astype(str) != "none").any()
        return "significant_adj" if has_null and corrected else "significant"
    if adjusted:
        if "significant_adj" not in sub.columns:
            raise ValueError("table has no 'significant_adj' column")
        return "significant_adj"
    return "significant"


def fraction_significant_by_animal(
    table: pd.DataFrame,
    *,
    metric: str | None = None,
    target: str | None = None,
    analysis: str | None = None,
    by_state: bool = True,
    adjusted: bool | None = None,
) -> pd.DataFrame:
    """Per animal (sessions and cells pooled) fraction of cells significant.

    With ``by_state`` the result has one row per (animal, state); otherwise one
    row per animal where ``state == "all"`` and the fraction is over all
    cell-state rows.  Select the analysis with ``analysis=`` (its name) or with
    ``metric=`` and ``target=``; the latter raises if it matches several analyses.
    Columns: ``animal, state, n_cells, n_significant,
    fraction_significant`` and, when ``null_lo/null_hi`` are present,
    ``fraction_positive`` (value above ``null_hi``) and ``fraction_negative``
    (value below ``null_lo``).  Rows whose ``p_value`` is NaN (the test was
    undefined for that cell) are excluded from the denominator of every
    fraction and counted in ``n_undefined``; ``n_cells`` counts all cells.

    Parameters
    ----------
    table : pandas.DataFrame
        Output of :func:`cohort_table` (needs ``animal``, ``session``, ``cell``,
        ``state``, ``value``, ``significant``; optionally ``p_value``,
        ``null_lo``, ``null_hi``, ``analysis``).
    metric, target : str, optional
        Select the analysis by metric and target name.
    analysis : str, optional
        Select the analysis by its unique name (preferred).
    by_state : bool, default True
        One row per (animal, state), or one per animal with ``state == "all"``.
    adjusted : bool, optional
        ``None`` uses ``significant_adj`` when the selected analysis has a null
        and its ``correction`` is not "none", else ``significant``; ``True``
        forces the adjusted column, ``False`` the raw one.

    Returns
    -------
    pandas.DataFrame
        Columns ``analysis, animal, state, n_cells, n_undefined, n_significant,
        fraction_significant`` (+ ``fraction_positive``, ``fraction_negative``).

    Raises
    ------
    ValueError
        If neither ``analysis`` nor both ``metric`` and ``target`` are given, or
        ``metric``/``target`` match several analyses.
    KeyError
        If nothing matches.
    """
    sub = _select(table, metric, target, analysis).copy()
    sub["_unit"] = _units(sub)
    sigcol = _sig_column(sub, adjusted)
    sub["_sig"] = sub[sigcol].astype(bool)
    if by_state and sub["state"].notna().any():
        sub["_state"] = sub["state"].astype(object)
    else:
        sub["_state"] = "all"
    has_bounds = {"null_lo", "null_hi"} <= set(sub.columns)
    if has_bounds:
        sub["_pos"] = sub["_sig"] & (sub["value"] > sub["null_hi"])
        sub["_neg"] = sub["_sig"] & (sub["value"] < sub["null_lo"])
    rows = []
    analysis_name = (
        str(sub["analysis"].iloc[0]) if "analysis" in sub.columns and len(sub) else analysis
    )
    for (an, st), g in sub.groupby(["animal", "_state"], sort=True):
        n = g["_unit"].nunique()
        if "p_value" in g.columns:
            undefined = g["p_value"].isna().to_numpy()
        else:
            undefined = np.zeros(len(g), bool)
        gv = g[~undefined]
        row: dict[str, Any] = {
            "analysis": analysis_name,
            "animal": an,
            "state": st,
            "n_cells": int(n),
            "n_undefined": int(undefined.sum()),
            "n_significant": int(gv["_sig"].sum()),
            "fraction_significant": float(gv["_sig"].mean()) if len(gv) else float("nan"),
        }
        if has_bounds:
            row["fraction_positive"] = float(gv["_pos"].mean()) if len(gv) else float("nan")
            row["fraction_negative"] = float(gv["_neg"].mean()) if len(gv) else float("nan")
        rows.append(row)
    return pd.DataFrame(rows)


def compare_states_across_animals(
    fractions: pd.DataFrame,
    state: str,
    control_state: str,
    test: Literal["wilcoxon", "ttest"] = "wilcoxon",
    *,
    analysis: str | None = None,
) -> dict[str, Any]:
    """Paired test across animals of ``fraction(state) - fraction(control_state)``.

    Returns ``n_animals, mean_difference, statistic, p_value, p_floor``.
    ``p_floor = 2 / 2**n_nonzero`` (``n_nonzero`` = number of non-zero paired
    differences; NaN if none) is the smallest two-sided p a signed-rank test
    can reach; when it is above alpha the test cannot be significant.  If all
    differences are zero ``p_value`` is 1.0.  The Wilcoxon test uses
    ``zero_method="wilcox"`` and the exact null distribution when
    ``n_nonzero <= 25`` and the absolute differences have no ties.

    Parameters
    ----------
    fractions : pandas.DataFrame
        Output of :func:`fraction_significant_by_animal` with ``by_state=True``.
    state, control_state : str
        States whose per-animal ``fraction_significant`` are compared
        (``state - control_state``).  Animals missing either are dropped.
    test : {"wilcoxon", "ttest"}, default "wilcoxon"
        Signed-rank test, or one-sample t-test of the differences against 0.
    analysis : str, optional
        Needed when ``fractions`` mixes several analyses.

    Returns
    -------
    dict
        Keys ``n_animals, mean_difference, statistic, p_value, p_floor, test,
        n_nonzero``.  ``statistic`` / ``p_value`` are NaN with fewer than two
        animals.

    Raises
    ------
    KeyError
        If a state is not in ``fractions``.
    ValueError
        If analyses are mixed without ``analysis``, or ``test`` is unknown.
    """
    if "analysis" in fractions.columns:
        if analysis is not None:
            fractions = fractions[fractions["analysis"] == analysis]
        elif fractions["analysis"].nunique() > 1:
            raise ValueError(
                f"fractions mixes analyses {sorted(fractions['analysis'].dropna().unique())}; "
                "pass analysis=..."
            )
    elif analysis is not None:
        raise KeyError("fractions has no 'analysis' column")
    wide = fractions.pivot(index="animal", columns="state", values="fraction_significant")
    for s in (state, control_state):
        if s not in wide.columns:
            raise KeyError(f"state {s!r} not in fractions (have {list(wide.columns)})")
    wide = wide[[state, control_state]].dropna()
    n = len(wide)
    diff = (wide[state] - wide[control_state]).to_numpy(dtype=float)
    out: dict[str, Any] = {
        "n_animals": n,
        "mean_difference": float(diff.mean()) if n else float("nan"),
        "statistic": float("nan"),
        "p_value": float("nan"),
        "p_floor": float("nan"),
        "test": test,
    }
    n_nonzero = int(np.count_nonzero(diff))
    out["n_nonzero"] = n_nonzero
    if n_nonzero:
        out["p_floor"] = 2.0 / 2.0**n_nonzero
    if n < 2:
        return out
    if test == "wilcoxon":
        if n_nonzero == 0:
            out["p_value"] = 1.0
            return out
        nz = np.abs(diff[diff != 0])
        res = None
        if n_nonzero <= 25 and len(np.unique(nz)) == len(nz):
            try:
                res = stats.wilcoxon(diff, zero_method="wilcox", method="exact")
            except (TypeError, ValueError):
                res = None
        if res is None:
            res = stats.wilcoxon(diff, zero_method="wilcox")
    elif test == "ttest":
        res = stats.ttest_1samp(diff, 0.0)
    else:
        raise ValueError(f"unknown test {test!r}")
    out["statistic"] = float(res.statistic)
    out["p_value"] = float(res.pvalue)
    return out


class BootstrapResult(BaseModel):
    """Hierarchical (animal -> cell) bootstrap and the naive pooled-cell bootstrap.

    Attributes
    ----------
    estimate : float
        The statistic on the original table.
    distribution : (n_boot,) float
        Statistic on each hierarchical resample (animals, then cells within them).
    mean : float
        Nan-mean of ``distribution``.
    ci : (float, float)
        2.5th and 97.5th percentiles of ``distribution`` (95 % interval).
    naive_distribution : (n_boot,) float
        Statistic on resamples of pooled (session, cell) units, ignoring animals.
    naive_mean : float
        Nan-mean of ``naive_distribution``.
    naive_ci : (float, float)
        95 % percentile interval of ``naive_distribution``; too narrow when animals differ.
    n_boot : int
        Number of resamples.
    n_animals : int
        Number of animals in the table.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    estimate: float = Field(..., description="Statistic on the original table.")
    distribution: np.ndarray = Field(..., description="Hierarchical bootstrap draws (n_boot,).")
    mean: float = Field(..., description="Nan-mean of the hierarchical draws.")
    ci: tuple[float, float] = Field(..., description="95% percentile interval (2.5, 97.5).")
    naive_distribution: np.ndarray = Field(
        ..., description="Pooled-cell bootstrap draws ignoring animals (n_boot,)."
    )
    naive_mean: float = Field(..., description="Nan-mean of the naive draws.")
    naive_ci: tuple[float, float] = Field(
        ..., description="95% percentile interval of the naive draws."
    )
    n_boot: int = Field(..., description="Number of resamples.")
    n_animals: int = Field(..., description="Number of animals resampled.")


def hierarchical_bootstrap(
    table: pd.DataFrame,
    statistic: Callable[[pd.DataFrame], float],
    *,
    n_boot: int = 2000,
    seed: int = 0,
    level: tuple[str, ...] = ("animal", "cell"),
) -> BootstrapResult:
    """Resample animals with replacement, then cells within each sampled animal.

    ``statistic`` receives the resampled long table.  A cell is identified by
    (session, cell) and all its rows (e.g. one per state) are kept together.
    ``level=("animal",)`` skips the within-animal cell resampling.  The result
    also carries the naive bootstrap that resamples pooled cells ignoring
    animals; its CI is too narrow when animals differ (CaSA).

    Parameters
    ----------
    table : pandas.DataFrame
        Long table from :func:`cohort_table` (needs ``animal``, ``session``,
        ``cell``).
    statistic : callable
        ``statistic(df) -> float`` evaluated on each resampled table.
    n_boot : int, default 2000
        Number of resamples.
    seed : int, default 0
        RNG seed.
    level : tuple of str, default ("animal", "cell")
        ``("animal", "cell")`` or ``("animal",)``.

    Returns
    -------
    BootstrapResult
        Estimate, bootstrap distributions, means and 95 % percentile CIs.

    Raises
    ------
    ValueError
        If ``level`` is not one of the two allowed tuples.
    """
    if not set(level) <= {"animal", "cell"} or "animal" not in level:
        raise ValueError("level must be ('animal', 'cell') or ('animal',)")
    rng = np.random.default_rng(seed)
    df = table.reset_index(drop=True)
    unit = _units(df).to_numpy()
    animals = df["animal"].to_numpy()
    by_animal: dict[Any, list[np.ndarray]] = {}
    all_units: list[np.ndarray] = []
    for an in pd.unique(animals):
        idx = np.flatnonzero(animals == an)
        u = unit[idx]
        groups = [idx[u == k] for k in pd.unique(u)]
        by_animal[an] = groups
        all_units.extend(groups)
    names = list(by_animal)
    boots = np.empty(n_boot)
    naive = np.empty(n_boot)
    for b in range(n_boot):
        parts = []
        for ai in rng.integers(0, len(names), len(names)):
            groups = by_animal[names[ai]]
            if "cell" in level:
                parts.extend(groups[j] for j in rng.integers(0, len(groups), len(groups)))
            else:
                parts.extend(groups)
        boots[b] = statistic(df.iloc[np.concatenate(parts)])
        pick = rng.integers(0, len(all_units), len(all_units))
        naive[b] = statistic(df.iloc[np.concatenate([all_units[j] for j in pick])])

    def ci(x: np.ndarray) -> tuple[float, float]:
        lo, hi = np.nanpercentile(x, [2.5, 97.5])
        return float(lo), float(hi)

    return BootstrapResult(
        estimate=float(statistic(df)),
        distribution=boots,
        mean=float(np.nanmean(boots)),
        ci=ci(boots),
        naive_distribution=naive,
        naive_mean=float(np.nanmean(naive)),
        naive_ci=ci(naive),
        n_boot=n_boot,
        n_animals=len(names),
    )


def per_animal_summary(
    table: pd.DataFrame,
    metric: str | None = None,
    target: str | None = None,
    *,
    analysis: str | None = None,
    adjusted: bool | None = None,
) -> pd.DataFrame:
    """Per animal: median value, fraction significant, number of cells.

    Parameters
    ----------
    table : pandas.DataFrame
        Output of :func:`cohort_table`.
    metric, target : str, optional
        Select the analysis by metric and target.
    analysis : str, optional
        Select the analysis by its unique name.
    adjusted : bool, optional
        As in :func:`fraction_significant_by_animal`.

    Returns
    -------
    pandas.DataFrame
        One row per animal: ``animal, median_value, fraction_significant,
        n_cells``.  Values and significance are pooled over states and cells.
    """
    sub = _select(table, metric, target, analysis).copy()
    sub["_unit"] = _units(sub)
    sub["_sig"] = sub[_sig_column(sub, adjusted)].astype(bool)
    g = sub.groupby("animal", sort=True)
    return pd.DataFrame(
        {
            "median_value": g["value"].median(),
            "fraction_significant": g["_sig"].mean(),
            "n_cells": g["_unit"].nunique(),
        }
    ).reset_index()


__all__ = [
    "BootstrapResult",
    "cohort_table",
    "compare_states_across_animals",
    "fraction_significant_by_animal",
    "hierarchical_bootstrap",
    "per_animal_summary",
]
