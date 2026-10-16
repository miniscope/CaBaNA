"""Serialisable cell-classification criteria built from analysis results.

A :class:`Clause` is one test on one analysis (e.g. "information content is
significant", "auROC above the 97.5th null percentile for state ``approach``").
A :class:`Criteria` combines clauses and other criteria with AND / OR / NOT
groups.  :func:`classify` applies several criteria to a ``ResultSet`` and returns
boolean cell sets that feed :func:`cabana.overlap_vs_chance` and
:func:`cabana.overlap_matrix` directly.  Everything round-trips through dicts and
YAML so a classification rule can be stored next to the pipeline that produced the
results.
"""

from __future__ import annotations

import warnings
from pathlib import Path
from typing import Any, Literal

import numpy as np
import pandas as pd
from pydantic import BaseModel, ConfigDict, Field, model_validator

from ._results import MetricResult, ResultSet

try:  # optional
    import yaml
except ImportError:  # pragma: no cover
    yaml = None

__all__ = [
    "Clause",
    "ClassificationResult",
    "Criteria",
    "classification_table",
    "classify",
    "fraction_classified_by_animal",
    "place_cell_criteria",
    "responsive_cell_criteria",
]


class Clause(BaseModel):
    """One test on one analysis, evaluated per cell.

    Parameters
    ----------
    analysis : str, optional
        Analysis name such as ``"information_content[position]"``.  Alternatively
        give ``metric`` and ``target`` (resolved with ``ResultSet.get``).
    metric, target : str, optional
        Alternative to ``analysis``.
    state : str or int, optional
        Required for cell x state results: a state name or column index, or
        ``"any"`` to OR the test over all states.  Must be ``None`` for 1-D results.
    test : {"significant", "value", "percentile"}, default "significant"
        ``significant``: permutation p below alpha.  ``value``: ``observed op
        threshold``.  ``percentile``: observed beyond that percentile of the null
        draws (needs ``keep_null="full"``).
    sign : {"any", "positive", "negative"}, default "any"
        Direction relative to ``reference`` for ``significant``.  For
        ``percentile``, ``positive`` means above the percentile, ``negative``
        below; ``any`` means above when ``percentile >= 50`` else below.  Ignored
        for ``value``.
    reference : float, optional
        What "positive/negative" is relative to.  ``None``: the shuffle's null
        median per cell (and state) when available, else 0.5 for ``auroc``, else 0.
    alpha : float, optional
        Override the result's alpha (``significant`` only; compares ``p < alpha``).
    adjusted : bool, optional
        ``True``: use ``ShuffleResult.p_adj`` and raise ``ValueError`` if the
        result has none.  ``False``: raw p-values.  ``None`` (default): ``p_adj``
        when the result has it, else ``p_value``.
    op : {">", ">=", "<", "<="}, default ">"
        Comparison for ``test="value"``.
    threshold : float, optional
        Required for ``test="value"``.
    percentile : float, optional
        Required for ``test="percentile"``, in [0, 100] (e.g. 97.5 or 2.5).
    """

    model_config = ConfigDict(extra="forbid")

    analysis: str | None = Field(None, description="Result name, e.g. 'auroc[social]'.")
    metric: str | None = Field(None, description="Metric name (alternative to analysis).")
    target: str | None = Field(None, description="Target name (alternative to analysis).")
    state: str | int | None = Field(None, description="State name/index, or 'any'.")
    test: Literal["significant", "value", "percentile"] = Field("significant")
    sign: Literal["any", "positive", "negative"] = Field("any")
    reference: float | None = Field(None, description="Reference for sign; None = null median.")
    alpha: float | None = Field(None, description="Override the result's alpha.")
    adjusted: bool | None = Field(None, description="Use p_adj (None: if present).")
    op: Literal[">", ">=", "<", "<="] = Field(">")
    threshold: float | None = Field(None, description="Threshold for test='value'.")
    percentile: float | None = Field(None, description="Null percentile for test='percentile'.")

    @model_validator(mode="after")
    def _check(self) -> Clause:
        if self.analysis is None:
            if self.metric is None or self.target is None:
                raise ValueError("give `analysis`, or both `metric` and `target`")
        elif self.metric is not None or self.target is not None:
            raise ValueError("give either `analysis` or `metric`+`target`, not both")
        if self.test == "value" and self.threshold is None:
            raise ValueError("test='value' needs `threshold`")
        if self.test == "percentile":
            if self.percentile is None or not 0.0 <= self.percentile <= 100.0:
                raise ValueError("test='percentile' needs `percentile` in [0, 100]")
        if self.alpha is not None and not 0.0 < self.alpha < 1.0:
            raise ValueError("alpha must be in (0, 1)")
        return self

    # -- helpers -----------------------------------------------------------------
    def _resolve(self, rs: ResultSet) -> MetricResult:
        r = rs[self.analysis] if self.analysis is not None else rs.get(self.metric, self.target)
        if r.level != "cell":
            raise ValueError(f"{r.name}: criteria need a cell-level result, got {r.level!r}")
        return r

    def _columns(self, r: MetricResult) -> list[int] | None:
        """Column indices to evaluate, or None for a 1-D result."""
        v = np.asarray(r.values)
        if v.ndim == 1:
            if self.state is not None:
                raise ValueError(f"{r.name} is 1-D (no states) but state={self.state!r} was given")
            return None
        if self.state is None:
            raise ValueError(
                f"{r.name} is cell x state (states: {r.state_names}); set state=<name or index> "
                "or state='any' to accept any state"
            )
        if self.state == "any":
            return list(range(v.shape[1]))
        return [r.state_index(self.state)]

    def _compute(self, rs: ResultSet) -> tuple[np.ndarray, np.ndarray]:
        r = self._resolve(rs)
        cols = self._columns(r)
        v = np.asarray(r.values, float)
        v2 = v[:, None] if cols is None else v[:, cols]
        sh = r.shuffle

        def pick(a: np.ndarray | None) -> np.ndarray | None:
            if a is None:
                return None
            a = np.asarray(a, float)
            return a[:, None] if cols is None else a[:, cols]

        finite = np.isfinite(v2)
        if self.test == "value":
            thr = float(self.threshold)  # type: ignore[arg-type]
            with np.errstate(invalid="ignore"):
                hit = {
                    ">": v2 > thr,
                    ">=": v2 >= thr,
                    "<": v2 < thr,
                    "<=": v2 <= thr,
                }[self.op]
            ok, defined = hit & finite, finite
        else:
            if sh is None:
                raise ValueError(f"{r.name} has no shuffle test; test={self.test!r} needs one")
            if self.test == "significant":
                padj = getattr(sh, "p_adj", None)
                if self.adjusted is True and padj is None:
                    raise ValueError(
                        f"{r.name}: adjusted=True but the result has no p_adj "
                        "(re-run with a ShuffleConfig correction, or use adjusted=None/False)"
                    )
                use_adj = padj is not None and self.adjusted is not False
                p = pick(padj if use_adj else sh.p_value)
                alpha = self.alpha if self.alpha is not None else sh.alpha
                defined = finite & np.isfinite(p)
                with np.errstate(invalid="ignore"):
                    core = p < alpha
                direction = self.sign
            else:
                if sh.null is None:
                    raise ValueError(
                        f"{r.name}: test='percentile' needs the null draws "
                        "(ShuffleConfig(keep_null='full'))"
                    )
                null = np.asarray(sh.null, float)
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", RuntimeWarning)
                    pc = np.nanpercentile(null, self.percentile, axis=0)
                pc = pick(pc)
                defined = finite & np.isfinite(pc)
                direction = self.sign
                if direction == "any":
                    direction = "positive" if self.percentile >= 50 else "negative"  # type: ignore[operator]
                with np.errstate(invalid="ignore"):
                    core = v2 > pc if direction == "positive" else v2 < pc
                direction = "any"  # direction already applied against the percentile
            if direction == "any":
                ok = core & defined
            else:
                if self.reference is not None:
                    ref = self.reference
                else:
                    med = pick(getattr(sh, "null_median", None))
                    if med is None and sh.null is not None:
                        with warnings.catch_warnings():
                            warnings.simplefilter("ignore", RuntimeWarning)
                            med = pick(np.nanmedian(np.asarray(sh.null, float), axis=0))
                    ref = med if med is not None else (0.5 if r.metric == "auroc" else 0.0)
                with np.errstate(invalid="ignore"):
                    side = v2 > ref if direction == "positive" else v2 < ref
                ok = core & side & defined
        return ok, defined

    def evaluate(self, resultset: ResultSet) -> np.ndarray:
        """Boolean ``(n_cells,)``: the clause holds (OR over states for ``state="any"``).

        NaN observed values or NaN p-values give ``False``.

        Parameters
        ----------
        resultset : ResultSet
            Results to test.

        Returns
        -------
        numpy.ndarray
            Boolean array over cells.

        Raises
        ------
        KeyError
            If the analysis name is unknown (the message lists available names).
        ValueError
            If the result is 2-D and ``state`` is missing, there is no shuffle for a
            test that needs one, or ``adjusted=True`` but ``p_adj`` is missing.
        """
        ok, _ = self._compute(resultset)
        return ok.any(axis=1)

    def defined(self, resultset: ResultSet) -> np.ndarray:
        """Boolean ``(n_cells,)``: the test could be computed (observed and p/null finite).

        For ``state="any"`` a cell is defined when it is defined in at least one state.
        """
        _, d = self._compute(resultset)
        return d.any(axis=1)

    def to_dict(self) -> dict[str, Any]:
        """Plain dict with ``None`` fields dropped."""
        return self.model_dump(mode="json", exclude_none=True)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Clause:
        """Inverse of :meth:`to_dict`."""
        return cls.model_validate(d)


class Criteria(BaseModel):
    """AND of three groups: all ``all_of``, at least one ``any_of``, none of ``none_of``.

    Members are :class:`Clause` or nested :class:`Criteria`.  An empty ``any_of``
    imposes no constraint.  At least one member overall is required.

    Parameters
    ----------
    name : str
        Class name (the label used by :func:`classify`).
    all_of, any_of, none_of : list[Clause | Criteria]
        The three groups.  A ``none_of`` clause whose result is undefined (NaN)
        for a cell counts as *not met*, so the cell passes that group.
    """

    model_config = ConfigDict(extra="forbid")

    name: str
    all_of: list[Clause | Criteria] = Field(default_factory=list)
    any_of: list[Clause | Criteria] = Field(default_factory=list)
    none_of: list[Clause | Criteria] = Field(default_factory=list)

    @model_validator(mode="after")
    def _nonempty(self) -> Criteria:
        if not (self.all_of or self.any_of or self.none_of):
            raise ValueError(f"criteria {self.name!r} has no clauses")
        return self

    def evaluate(self, resultset: ResultSet) -> np.ndarray:
        """Boolean ``(n_cells,)`` membership.

        Parameters
        ----------
        resultset : ResultSet

        Returns
        -------
        numpy.ndarray
            ``all(all_of) & any(any_of) & ~any(none_of)`` per cell.
        """
        out: np.ndarray | None = None

        def merge(cur: np.ndarray | None, new: np.ndarray) -> np.ndarray:
            return new if cur is None else cur & new

        for c in self.all_of:
            out = merge(out, c.evaluate(resultset))
        if self.any_of:
            acc = None
            for c in self.any_of:
                m = c.evaluate(resultset)
                acc = m if acc is None else acc | m
            out = merge(out, acc)  # type: ignore[arg-type]
        for c in self.none_of:
            out = merge(out, ~c.evaluate(resultset))
        return out  # type: ignore[return-value]

    def to_dict(self) -> dict[str, Any]:
        """Plain nested dict (``None`` clause fields dropped)."""
        return self.model_dump(mode="json", exclude_none=True)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> Criteria:
        """Inverse of :meth:`to_dict`."""
        return cls.model_validate(d)

    def to_yaml(self, path: str | Path | None = None) -> str:
        """YAML text; also written to ``path`` when given.  Needs ``pyyaml``."""
        if yaml is None:
            raise ImportError("to_yaml requires pyyaml (pip install pyyaml)")
        text = yaml.safe_dump(self.to_dict(), sort_keys=False)
        if path is not None:
            Path(path).write_text(text)
        return text

    @classmethod
    def from_yaml(cls, text_or_path: str | Path) -> Criteria:
        """Build from YAML text or a YAML file (same rules as ``Pipeline.from_yaml``)."""
        if yaml is None:
            raise ImportError("from_yaml requires pyyaml (pip install pyyaml)")
        if isinstance(text_or_path, Path):
            text = text_or_path.read_text()
        else:
            s = str(text_or_path)
            if "\n" not in s and Path(s).is_file():
                text = Path(s).read_text()
            else:
                text = s
        d = yaml.safe_load(text)
        if not isinstance(d, dict):
            raise ValueError("criteria YAML must be a mapping")
        return cls.from_dict(d)


Criteria.model_rebuild()


class ClassificationResult(BaseModel):
    """Per-cell class membership produced by :func:`classify`.

    Attributes
    ----------
    labels : dict[str, ndarray]
        Boolean ``(n_cells,)`` membership per class (plus ``"unclassified"`` when
        ``exclusive``).  Directly usable as ``overlap_vs_chance(labels[a], labels[b])``
        or ``overlap_matrix(labels)``.
    cell_ids : list[str]
        Row labels.
    n_cells : int
    exclusive : bool
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    labels: dict[str, np.ndarray]
    cell_ids: list[str]
    n_cells: int
    exclusive: bool = False

    def counts(self) -> dict[str, int]:
        """Number of member cells per class."""
        return {k: int(v.sum()) for k, v in self.labels.items()}

    def fractions(self) -> dict[str, float]:
        """Fraction of all cells per class."""
        n = max(self.n_cells, 1)
        return {k: float(v.sum()) / n for k, v in self.labels.items()}

    def table(self) -> pd.DataFrame:
        """One row per cell: ``cell``, one bool column per class, ``n_classes``.

        ``n_classes`` counts the real classes a cell is in (``"unclassified"`` excluded).
        """
        df = pd.DataFrame({"cell": self.cell_ids})
        for k, v in self.labels.items():
            df[k] = v
        real = [k for k in self.labels if k != "unclassified" or not self.exclusive]
        df["n_classes"] = (
            np.sum([self.labels[k] for k in real], axis=0).astype(int)
            if real
            else np.zeros(self.n_cells, int)
        )
        return df

    def label_per_cell(self) -> np.ndarray:
        """Object array of class names; ``"multiple"`` for several, ``"unclassified"`` for none."""
        names = [k for k in self.labels if k != "unclassified"]
        out = np.full(self.n_cells, "unclassified", dtype=object)
        if not names:
            return out
        stack = np.stack([self.labels[k] for k in names])
        n = stack.sum(axis=0)
        first = stack.argmax(axis=0)
        for i in range(self.n_cells):
            if n[i] == 1:
                out[i] = names[first[i]]
            elif n[i] > 1:
                out[i] = "multiple"
        return out


def classify(
    resultset: ResultSet,
    criteria: list[Criteria] | dict[str, Criteria],
    *,
    exclusive: bool = False,
) -> ClassificationResult:
    """Apply criteria to a ``ResultSet``.

    Parameters
    ----------
    resultset : ResultSet
    criteria : list[Criteria] or dict[str, Criteria]
        Class definitions; dict keys name the classes, otherwise ``Criteria.name``.
        Names must be unique.
    exclusive : bool, default False
        Assign each cell to the first matching criteria in order and add an
        ``"unclassified"`` class.  Otherwise classes may overlap.

    Returns
    -------
    ClassificationResult

    Raises
    ------
    ValueError
        On duplicate class names, no criteria, no cell-level results, or (with
        ``exclusive=True``) a criteria named ``"unclassified"``.

    Notes
    -----
    ``none_of`` clauses treat undefined (NaN) results as passing: a cell whose
    test could not be evaluated is not excluded by it.  ``state="any"`` is
    reserved for OR-ing a test over all states.  ``percentile`` tests compare
    against the null percentile directly and are *not* multiplicity-corrected
    (unlike ``significant``, which uses the adjusted p-values).
    """
    items = (
        list(criteria.items()) if isinstance(criteria, dict) else [(c.name, c) for c in criteria]
    )
    if not items:
        raise ValueError("no criteria given")
    names = [k for k, _ in items]
    if len(set(names)) != len(names):
        raise ValueError(f"duplicate criteria names: {names}")
    cell_res = next((r for r in resultset.results if r.level == "cell"), None)
    if cell_res is None:
        raise ValueError("the ResultSet has no cell-level results")
    n = int(np.asarray(cell_res.values).shape[0])
    ids = list(cell_res.cell_ids) if cell_res.cell_ids is not None else [str(i) for i in range(n)]
    labels = {k: np.asarray(c.evaluate(resultset), bool) for k, c in items}
    for k, v in labels.items():
        if v.shape != (n,):
            raise ValueError(f"criteria {k!r} gave shape {v.shape}, expected ({n},)")
    if exclusive:
        if "unclassified" in names:
            raise ValueError(
                "a criteria is named 'unclassified', which is reserved for exclusive=True; "
                "rename it"
            )
        taken = np.zeros(n, bool)
        for k in names:
            m = labels[k] & ~taken
            taken |= m
            labels[k] = m
        labels["unclassified"] = ~taken
    return ClassificationResult(labels=labels, cell_ids=ids, n_cells=n, exclusive=exclusive)


def place_cell_criteria(
    position: str = "position",
    alpha: float = 0.05,
    require_stability: bool = True,
    *,
    name: str = "place_cell",
    information_name: str | None = None,
    stability_name: str | None = None,
) -> Criteria:
    """The survey's usual place-cell rule.

    Spatial information (``information_content[position]``) significant against the
    null, and (``require_stability``) split-half map stability
    (``split_half_stability[position]``) significant.  Field-size criteria are not
    included.

    Parameters
    ----------
    position : str, default "position"
        Name of the position state space (analyses ``metric[position]``).
    alpha : float, default 0.05
        Significance level for both clauses.
    require_stability : bool, default True
        Also require the stability test.
    name : str, default "place_cell"
    information_name, stability_name : str, optional
        Analysis names overriding ``information_content[position]`` and
        ``split_half_stability[position]`` (e.g. when several nulls were run).

    Returns
    -------
    Criteria
    """
    info = information_name or f"information_content[{position}]"
    stab = stability_name or f"split_half_stability[{position}]"
    clauses = [Clause(analysis=info, alpha=alpha, sign="positive")]
    if require_stability:
        clauses.append(Clause(analysis=stab, alpha=alpha, sign="positive"))
    return Criteria(name=name, all_of=clauses)


def responsive_cell_criteria(
    resultset: ResultSet,
    target: str = "social",
    metric: str = "auroc",
    percentile: float = 97.5,
    *,
    use_p: bool = False,
    alpha: float = 0.05,
    name: str | None = None,
) -> dict[str, Criteria]:
    """Excited / inhibited criteria for every state of ``metric[target]``.

    Encodes the usual auROC rule: excited when the observed value is above the
    ``percentile`` (97.5) of the null, inhibited when below ``100 - percentile``
    (2.5).  With ``use_p=True`` it instead requires a significant p-value and the
    observed value above / below the null median.

    Parameters
    ----------
    resultset : ResultSet
        Needed to enumerate the states.
    target, metric : str
        The analysis ``metric[target]`` is looked up with ``ResultSet.get``.
    percentile : float, default 97.5
    use_p : bool, default False
    alpha : float, default 0.05
        Used with ``use_p``.
    name : str, optional
        Analysis name; when given, ``resultset[name]`` is used instead of the
        metric/target lookup (needed when several analyses share both).  The
        clauses always reference the resolved analysis by name.

    Returns
    -------
    dict[str, Criteria]
        ``{"<state>_excited": ..., "<state>_inhibited": ...}`` per state.
    """
    r = resultset[name] if name is not None else resultset.get(metric, target)
    if not r.state_names or np.asarray(r.values).ndim != 2:
        raise ValueError(f"{r.name} has no per-state axis")
    out: dict[str, Criteria] = {}
    for s in r.state_names:
        if use_p:
            up = Clause(analysis=r.name, state=s, test="significant", sign="positive", alpha=alpha)
            dn = Clause(analysis=r.name, state=s, test="significant", sign="negative", alpha=alpha)
        else:
            up = Clause(
                analysis=r.name, state=s, test="percentile", percentile=percentile, sign="positive"
            )
            dn = Clause(
                analysis=r.name,
                state=s,
                test="percentile",
                percentile=100.0 - percentile,
                sign="negative",
            )
        out[f"{s}_excited"] = Criteria(name=f"{s}_excited", all_of=[up])
        out[f"{s}_inhibited"] = Criteria(name=f"{s}_inhibited", all_of=[dn])
    return out


def classification_table(
    classifications: dict[str, ClassificationResult],
    animal: dict[str, str] | None = None,
) -> pd.DataFrame:
    """Long table over sessions: ``session, animal, cell, class, member``.

    Parameters
    ----------
    classifications : dict[str, ClassificationResult]
        One classification per session id.
    animal : dict[str, str], optional
        Animal id per session id; defaults to the session id itself.

    Returns
    -------
    pandas.DataFrame

    Raises
    ------
    KeyError
        If ``animal`` lacks a session.
    ValueError
        If ``classifications`` is empty.
    """
    if not classifications:
        raise ValueError("no classifications given")
    frames = []
    for sid, c in classifications.items():
        if animal is not None and sid not in animal:
            raise KeyError(f"session {sid!r} has no animal")
        for k, v in c.labels.items():
            frames.append(
                pd.DataFrame(
                    {
                        "session": sid,
                        "animal": sid if animal is None else animal[sid],
                        "cell": c.cell_ids,
                        "class": k,
                        "member": np.asarray(v, bool),
                    }
                )
            )
    return pd.concat(frames, ignore_index=True)


def fraction_classified_by_animal(table: pd.DataFrame) -> pd.DataFrame:
    """Per animal and class, the fraction of cells (sessions pooled) that are members.

    Parameters
    ----------
    table : pandas.DataFrame
        Output of :func:`classification_table`.

    Returns
    -------
    pandas.DataFrame
        Columns ``animal, class, n_cells, n_members, fraction``.
    """
    g = table.groupby(["animal", "class"], sort=False)["member"]
    out = g.agg(n_cells="size", n_members="sum").reset_index()
    out["n_members"] = out["n_members"].astype(int)
    out["fraction"] = out["n_members"] / out["n_cells"]
    return out
