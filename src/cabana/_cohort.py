"""Cohort statistics where the animal, not the cell, is the unit of replication."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Literal

import numpy as np
import pandas as pd
from pydantic import BaseModel, ConfigDict
from scipy import stats

from ._results import ResultSet


def cohort_table(results_by_session: dict[str, ResultSet], animal: dict[str, str]) -> pd.DataFrame:
    """Long table of every session's ``ResultSet.to_dataframe()`` plus ``session`` and ``animal``."""
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


def _select(table: pd.DataFrame, metric: str, target: str) -> pd.DataFrame:
    sub = table[(table["metric"] == metric) & (table["target"] == target)]
    if sub.empty:
        raise KeyError(f"no rows for metric={metric!r}, target={target!r}")
    return sub


def _units(df: pd.DataFrame) -> pd.Series:
    """Cell identity: (session, cell) when sessions are present."""
    if "session" in df.columns:
        return df["session"].astype(str) + "|" + df["cell"].astype(str)
    return df["cell"].astype(str)


def fraction_significant_by_animal(
    table: pd.DataFrame, *, metric: str, target: str, by_state: bool = True
) -> pd.DataFrame:
    """Per animal (sessions and cells pooled) fraction of cells significant.

    With ``by_state`` the result has one row per (animal, state); otherwise one
    row per animal where ``state == "all"`` and the fraction is over all
    cell-state rows.  Columns: ``animal, state, n_cells, n_significant,
    fraction_significant`` and, when ``null_lo/null_hi`` are present,
    ``fraction_positive`` (value above ``null_hi``) and ``fraction_negative``
    (value below ``null_lo``).  Rows whose ``p_value`` is NaN (the test was
    undefined for that cell) are excluded from the denominator of every
    fraction and counted in ``n_undefined``; ``n_cells`` counts all cells.
    """
    sub = _select(table, metric, target).copy()
    sub["_unit"] = _units(sub)
    if by_state and sub["state"].notna().any():
        sub["_state"] = sub["state"].astype(object)
    else:
        sub["_state"] = "all"
    has_bounds = {"null_lo", "null_hi"} <= set(sub.columns)
    if has_bounds:
        sub["_pos"] = sub["significant"].astype(bool) & (sub["value"] > sub["null_hi"])
        sub["_neg"] = sub["significant"].astype(bool) & (sub["value"] < sub["null_lo"])
    rows = []
    for (an, st), g in sub.groupby(["animal", "_state"], sort=True):
        n = g["_unit"].nunique()
        if "p_value" in g.columns:
            undefined = g["p_value"].isna().to_numpy()
        else:
            undefined = np.zeros(len(g), bool)
        gv = g[~undefined]
        row: dict[str, Any] = {
            "animal": an,
            "state": st,
            "n_cells": int(n),
            "n_undefined": int(undefined.sum()),
            "n_significant": int(gv["significant"].astype(bool).sum()),
            "fraction_significant": float(gv["significant"].astype(bool).mean()) if len(gv) else float("nan"),
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
) -> dict[str, Any]:
    """Paired test across animals of ``fraction(state) - fraction(control_state)``.

    Returns ``n_animals, mean_difference, statistic, p_value, p_floor``.
    ``p_floor = 2 / 2**n_nonzero`` (``n_nonzero`` = number of non-zero paired
    differences; NaN if none) is the smallest two-sided p a signed-rank test
    can reach; when it is above alpha the test cannot be significant.  If all
    differences are zero ``p_value`` is 1.0.  The Wilcoxon test uses
    ``zero_method="wilcox"`` and the exact null distribution when
    ``n_nonzero <= 25`` and the absolute differences have no ties.
    """
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
    """Hierarchical (animal -> cell) bootstrap and the naive pooled-cell bootstrap."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    estimate: float
    distribution: np.ndarray
    mean: float
    ci: tuple[float, float]
    naive_distribution: np.ndarray
    naive_mean: float
    naive_ci: tuple[float, float]
    n_boot: int
    n_animals: int


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


def per_animal_summary(table: pd.DataFrame, metric: str, target: str) -> pd.DataFrame:
    """Per animal: median value, fraction significant, number of cells."""
    sub = _select(table, metric, target).copy()
    sub["_unit"] = _units(sub)
    g = sub.groupby("animal", sort=True)
    return pd.DataFrame(
        {
            "median_value": g["value"].median(),
            "fraction_significant": g["significant"].apply(lambda s: float(s.astype(bool).mean())),
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
