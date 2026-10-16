"""Results-level ("post hoc") analyses: population overlap and response clustering.

These functions consume cell classifications and per-cell feature vectors
extracted from :class:`~cabana._results.MetricResult` objects.  They are plain
functions, not Metric plugins.
"""

from __future__ import annotations

import warnings
from collections.abc import Sequence
from typing import Any, Literal

import numpy as np
import pandas as pd
from pydantic import BaseModel, ConfigDict
from scipy.stats import fisher_exact

from ._results import MetricResult, ResultSet

__all__ = [
    "ClusterResult",
    "OverlapResult",
    "overlap_matrix",
    "overlap_vs_chance",
    "response_clusters",
    "response_features",
    "significant_cells",
]


# --------------------------------------------------------------------------- #
# significant cells
# --------------------------------------------------------------------------- #


def _state_index(result: MetricResult, state: str | int) -> int:
    if isinstance(state, str):
        if result.state_names is None or state not in result.state_names:
            raise KeyError(f"state {state!r} not in state_names of {result.metric!r}")
        return result.state_names.index(state)
    return int(state)


def significant_cells(
    result: MetricResult,
    state: str | int | None = None,
    sign: Literal["any", "positive", "negative"] = "any",
    alpha: float | None = None,
) -> np.ndarray:
    """Boolean ``(n_cells,)`` mask of significant cells of a cell-level result.

    Parameters
    ----------
    state
        For 2-D results, the state (name or column index) to use; ``None``
        means significant in *any* state.  Ignored for 1-D results.
    sign
        ``"positive"``: observed above the null median (``np.nanmedian`` over
        finite draws; above 0.5 for
        ``auroc``); ``"negative"``: below it; ``"any"``: no sign filter.
    alpha
        ``None`` uses the stored ``shuffle.significant``; otherwise
        significance is recomputed as ``p_value < alpha``.
    """
    if result.level != "cell":
        raise ValueError("significant_cells needs a cell-level result")
    sh = result.shuffle
    if sh is None:
        raise ValueError(f"result {result.metric!r} has no shuffle; cannot determine significance")
    vals = np.asarray(result.values, float)
    sig = np.asarray(sh.significant, bool) if alpha is None else np.asarray(sh.p_value) < alpha
    if sign != "any":
        ref = 0.5 if result.metric == "auroc" else np.nanmedian(np.asarray(sh.null, float), axis=0)
        direction = vals > ref if sign == "positive" else vals < ref
        sig = sig & direction
    if vals.ndim == 1:
        return np.asarray(sig, bool)
    if state is None:
        return sig.any(axis=1)
    return np.asarray(sig[:, _state_index(result, state)], bool)


# --------------------------------------------------------------------------- #
# overlap vs chance
# --------------------------------------------------------------------------- #


class OverlapResult(BaseModel):
    """Overlap of two cell sets against the independence expectation.

    ``p_value`` is the two-sided Fisher exact test on the 2x2 table, which is
    the hypergeometric test of ``n_both`` given ``N``, ``n_a``, ``n_b``.
    ``jaccard_chance = expected / (n_a + n_b - expected)``.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    n_a: int
    n_b: int
    n_both: int
    N: int
    expected: float
    odds_ratio: float
    p_value: float
    jaccard: float
    jaccard_chance: float

    def to_dict(self) -> dict[str, Any]:
        return self.model_dump()


def overlap_vs_chance(
    a: np.ndarray, b: np.ndarray, *, universe: np.ndarray | None = None
) -> OverlapResult:
    """Test whether two boolean cell sets overlap more (or less) than chance."""
    a = np.asarray(a, bool)
    b = np.asarray(b, bool)
    if a.shape != b.shape or a.ndim != 1:
        raise ValueError("a and b must be 1-D boolean arrays of the same length")
    if universe is not None:
        u = np.asarray(universe, bool)
        if u.shape != a.shape:
            raise ValueError("universe must have the same shape as a and b")
        a, b = a[u], b[u]
    N = int(a.size)
    n_a, n_b = int(a.sum()), int(b.sum())
    both = int((a & b).sum())
    table = [[both, n_a - both], [n_b - both, N - n_a - n_b + both]]
    odds, p = fisher_exact(table, alternative="two-sided")
    expected = n_a * n_b / N if N else float("nan")
    union = n_a + n_b - both
    denom = n_a + n_b - expected
    return OverlapResult(
        n_a=n_a,
        n_b=n_b,
        n_both=both,
        N=N,
        expected=float(expected),
        odds_ratio=float(odds),
        p_value=float(p),
        jaccard=float(both / union) if union else float("nan"),
        jaccard_chance=float(expected / denom) if denom else float("nan"),
    )


def overlap_matrix(
    results: Sequence[tuple[MetricResult, str | int | None]] | dict[str, np.ndarray],
    *,
    universe: np.ndarray | None = None,
) -> pd.DataFrame:
    """Pairwise :func:`overlap_vs_chance` over named cell sets (long format).

    ``results`` is either ``{name: bool_array}`` or a list of
    ``(MetricResult, state)`` pairs, in which case sets come from
    :func:`significant_cells` and are named ``"<metric>:<target>[:<state>]"``.
    Each unordered pair appears once with ``set_a`` before ``set_b``.
    """
    if isinstance(results, dict):
        sets = {k: np.asarray(v, bool) for k, v in results.items()}
    else:
        sets = {}
        for r, st in results:
            name = f"{r.metric}:{r.target}" + ("" if st is None else f":{st}")
            base, i = name, 2
            while name in sets:
                name, i = f"{base}#{i}", i + 1
            sets[name] = significant_cells(r, st)
    names = list(sets)
    rows = []
    for i, na in enumerate(names):
        for nb in names[i + 1 :]:
            o = overlap_vs_chance(sets[na], sets[nb], universe=universe)
            rows.append(
                {
                    "set_a": na,
                    "set_b": nb,
                    "n_a": o.n_a,
                    "n_b": o.n_b,
                    "n_both": o.n_both,
                    "expected": o.expected,
                    "odds_ratio": o.odds_ratio,
                    "p_value": o.p_value,
                }
            )
    return pd.DataFrame(
        rows, columns=["set_a", "set_b", "n_a", "n_b", "n_both", "expected", "odds_ratio", "p_value"]
    )


# --------------------------------------------------------------------------- #
# response features
# --------------------------------------------------------------------------- #


def response_features(
    resultset_or_results: ResultSet | Sequence[MetricResult],
    which: list[tuple[str, str]] | None = None,
    use: Literal["values", "peth"] = "values",
    *,
    standardize: bool = True,
) -> tuple[np.ndarray, list[str], np.ndarray]:
    """Concatenate per-cell feature vectors from cell-level results.

    Parameters
    ----------
    which
        ``(metric, target)`` pairs to include, in order; ``None`` uses every
        cell-level result.
    use
        ``"values"`` takes ``result.values`` (one column per state for 2-D);
        ``"peth"`` takes ``result.extras["peth"]`` flattened per cell.
    standardize
        z-score each column (over kept cells; zero-variance columns become 0).

    Returns
    -------
    features : (n_kept, n_features)
    feature_names : list[str]
    kept : (n_kept,) int
        Indices of the cells without any NaN (the others are dropped).

    Columns that are NaN for *every* cell are dropped first (with a warning
    naming them) so that one undefined feature does not discard all cells;
    cells with NaN in any remaining column are then dropped.

    Note: the return is a 3-tuple (the kept index is the third element).
    """
    results = (
        list(resultset_or_results.results)
        if isinstance(resultset_or_results, ResultSet)
        else list(resultset_or_results)
    )
    results = [r for r in results if r.level == "cell"]
    if which is not None:
        picked = []
        for metric, target in which:
            hits = [r for r in results if r.metric == metric and r.target == target]
            if len(hits) != 1:
                raise KeyError(f"expected one cell-level result for ({metric!r}, {target!r}), got {len(hits)}")
            picked.append(hits[0])
        results = picked
    if not results:
        raise ValueError("no cell-level results to build features from")

    blocks, names = [], []
    for r in results:
        if use == "values":
            arr = np.asarray(r.values, float)
            sn = r.state_names if r.state_names is not None else None
        elif use == "peth":
            if "peth" not in r.extras:
                raise KeyError(f"result {r.metric!r} has no extras['peth']")
            arr = np.asarray(r.extras["peth"], float)
            sn = None
        else:
            raise ValueError(f"unknown use {use!r}")
        n_cells = arr.shape[0]
        arr2 = arr.reshape(n_cells, -1)
        if use == "values" and arr.ndim == 2 and sn is not None and len(sn) == arr2.shape[1]:
            cols = [f"{r.metric}:{r.target}:{s}" for s in sn]
        else:
            cols = [f"{r.metric}:{r.target}:{j}" for j in range(arr2.shape[1])]
            if arr2.shape[1] == 1:
                cols = [f"{r.metric}:{r.target}"]
        blocks.append(arr2)
        names.extend(cols)
    n = {b.shape[0] for b in blocks}
    if len(n) != 1:
        raise ValueError("results have different numbers of cells")
    X = np.concatenate(blocks, axis=1)
    all_nan = np.isnan(X).all(axis=0) if X.shape[0] else np.zeros(X.shape[1], bool)
    if all_nan.any():
        dropped = [nm for nm, d in zip(names, all_nan, strict=True) if d]
        warnings.warn(
            f"dropping {len(dropped)} feature(s) that are NaN for every cell: {dropped}",
            UserWarning,
            stacklevel=2,
        )
        X = X[:, ~all_nan]
        names = [nm for nm, d in zip(names, all_nan, strict=True) if not d]
    kept = np.flatnonzero(~np.isnan(X).any(axis=1))
    X = X[kept]
    if standardize and X.shape[0]:
        sd = X.std(axis=0)
        X = (X - X.mean(axis=0)) / np.where(sd > 0, sd, 1.0)
    return X, names, kept


# --------------------------------------------------------------------------- #
# clustering
# --------------------------------------------------------------------------- #


class ClusterResult(BaseModel):
    """Cluster labels plus model-selection scores.

    ``scores`` maps each k tried to its selection score (silhouette: higher is
    better; bic: lower is better).  ``sizes`` is the number of cells per
    cluster; a (possible, for gmm) empty cluster has size 0 and a NaN row in
    ``cluster_means``.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    labels: np.ndarray
    k: int
    scores: dict[int, float]
    cluster_means: np.ndarray
    sizes: np.ndarray | None = None
    method: str = "kmeans"
    selection: str = "silhouette"

    def to_dataframe(self) -> pd.DataFrame:
        """One row per cluster: ``cluster, n_cells`` plus mean per feature (``f0..``)."""
        k = self.cluster_means.shape[0]
        df = pd.DataFrame(self.cluster_means, columns=[f"f{j}" for j in range(self.cluster_means.shape[1])])
        df.insert(0, "n_cells", [int((self.labels == c).sum()) for c in range(k)])
        df.insert(0, "cluster", np.arange(k))
        return df


def _fit(X: np.ndarray, k: int, method: str, seed: int) -> np.ndarray:
    from sklearn.cluster import AgglomerativeClustering, KMeans
    from sklearn.mixture import GaussianMixture

    if method == "kmeans":
        return KMeans(n_clusters=k, n_init=10, random_state=seed).fit_predict(X)
    if method == "gmm":
        return GaussianMixture(n_components=k, random_state=seed, n_init=3).fit(X).predict(X)
    if method == "hierarchical":
        return AgglomerativeClustering(n_clusters=k, linkage="ward").fit_predict(X)
    raise ValueError(f"unknown method {method!r}")


def response_clusters(
    features: np.ndarray,
    k: int | None = None,
    k_range: tuple[int, int] = (2, 8),
    method: Literal["kmeans", "gmm", "hierarchical"] = "kmeans",
    selection: Literal["silhouette", "bic"] = "silhouette",
    seed: int = 0,
) -> ClusterResult:
    """Cluster cells by response profile.

    With ``k=None`` every k in ``k_range`` (inclusive) is tried and chosen by
    ``selection`` (silhouette maximised, or GMM BIC minimised).  With a fixed
    ``k`` the silhouette (or BIC) of that k alone is reported.
    """
    from sklearn.metrics import silhouette_score
    from sklearn.mixture import GaussianMixture

    X = np.asarray(features, float)
    if X.ndim != 2 or np.isnan(X).any():
        raise ValueError("features must be a 2-D array without NaN")
    if selection == "bic" and method != "gmm":
        raise ValueError("selection='bic' is only valid for method='gmm'")
    if selection not in ("silhouette", "bic"):
        raise ValueError(f"unknown selection {selection!r}")
    n = X.shape[0]
    ks = [k] if k is not None else list(range(k_range[0], min(k_range[1], n - 1) + 1))
    if not ks:
        raise ValueError("no valid k to try")
    scores: dict[int, float] = {}
    fits: dict[int, np.ndarray] = {}
    for kk in ks:
        lab = _fit(X, kk, method, seed)
        fits[kk] = lab
        if selection == "bic":
            scores[kk] = float(GaussianMixture(n_components=kk, random_state=seed, n_init=3).fit(X).bic(X))
        else:
            scores[kk] = float(silhouette_score(X, lab)) if len(np.unique(lab)) > 1 else float("nan")
    if k is not None:
        best = k
    elif selection == "bic":
        best = min(scores, key=scores.get)
    else:
        best = max(scores, key=lambda q: -np.inf if np.isnan(scores[q]) else scores[q])
    labels = fits[best]
    sizes = np.array([(labels == c).sum() for c in range(best)], dtype=int)
    means = np.stack(
        [X[labels == c].mean(axis=0) if sizes[c] else np.full(X.shape[1], np.nan) for c in range(best)]
    )
    return ClusterResult(
        labels=labels, k=int(best), scores=scores, cluster_means=means, sizes=sizes, method=method, selection=selection
    )
