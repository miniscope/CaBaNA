"""Static memory estimates for a pipeline run (nothing is computed).

The dominant allocation of a shuffle test is the null, ``(n_shuffles, *output)``
float64: a 6400-state grid with 200 cells and 1000 shuffles needs 10 GB.
:func:`memory_estimate` reports, per analysis, the null, the ``compute_shifted``
batch intermediate and the dense indicator, applies the same chunking rule as
:func:`cabana.shuffle_test` (``keep_null="none"``), and suggests remedies.

Output sizes follow the metric's ``level`` and the target's number of states;
the shape table :data:`_PER_STATE_CELL` / :data:`_POPULATION_SHAPES` covers the built-in metrics
and falls back to ``(n_cells,)`` (cell level) or one value (population level) for plugins.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

import numpy as np

from ._statesums import DENSE_MAX_STATES

if TYPE_CHECKING:  # pragma: no cover
    from ._models import Session
    from ._pipeline import Pipeline

# cell-level metrics returning (n_cells, n_states)
_PER_STATE_CELL = frozenset({"auroc", "mean_per_state", "peth"})
# population-level metrics: output size as a function of (n_cells, n_states)
_POPULATION_SHAPES: dict[str, str] = {
    "pairwise_correlation": "cells2",
    "pca_population": "states2",
    "population_distance": "states2",
    "population_vector_overlap": "states2",
    "bayesian_decoder": "states",
    "decode_states": "states",
    "pv_stability": "states",
}


def shuffle_memory_bytes(n_shuffles: int, shape: tuple[int, ...], dtype: Any = "float64") -> int:
    """Bytes of a null array ``(n_shuffles, *shape)`` of ``dtype``."""
    return int(n_shuffles) * int(np.prod(shape, dtype=np.int64)) * np.dtype(dtype).itemsize


def human_bytes(n: float) -> str:
    """``1536`` -> ``'1.5 KB'`` (powers of 1024, labelled KB/MB/GB/TB)."""
    n = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if abs(n) < 1024 or unit == "GB":
            return f"{n:.0f} B" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"  # pragma: no cover


def output_shape(metric: Any, n_cells: int, n_states: int | None) -> tuple[int, ...]:
    """Expected shape of ``metric.compute`` from metric name, level and target size."""
    ns = 1 if n_states is None else int(n_states)
    if metric.level == "cell":
        return (n_cells, ns) if metric.name in _PER_STATE_CELL and n_states else (n_cells,)
    kind = _POPULATION_SHAPES.get(metric.name)
    if kind == "cells2":
        return (n_cells, n_cells)
    if kind == "states2":
        return (ns, ns)
    if kind == "states":
        return (ns,)
    return (1,)


@dataclass
class AnalysisMemory:
    """Memory footprint of one analysis (bytes).

    ``null_bytes`` is the null actually held at once (one chunk when ``chunked``);
    ``null_bytes_full`` the whole ``(n_shuffles, *output)`` array.
    """

    null_bytes: int = 0
    null_bytes_full: int = 0
    batch_bytes: int = 0
    indicator_bytes: int = 0
    extras_bytes_estimate: int = 0
    chunked: bool = False
    n_chunks: int = 1
    output_shape: tuple[int, ...] = ()

    @property
    def total_bytes(self) -> int:
        return (
            self.null_bytes + self.batch_bytes + self.indicator_bytes + self.extras_bytes_estimate
        )

    def to_dict(self) -> dict[str, Any]:
        d = dict(self.__dict__)
        d["output_shape"] = list(self.output_shape)
        d["total_bytes"] = self.total_bytes
        return d


@dataclass
class MemoryEstimate:
    """Result of :func:`memory_estimate`; sizes in bytes, ``str()`` is human readable."""

    per_analysis: dict[str, AnalysisMemory] = field(default_factory=dict)
    session_bytes: int = 0
    peak_bytes: int = 0
    suggestions: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "per_analysis": {k: v.to_dict() for k, v in self.per_analysis.items()},
            "session_bytes": self.session_bytes,
            "peak_bytes": self.peak_bytes,
            "suggestions": list(self.suggestions),
        }

    def __str__(self) -> str:
        lines = [
            f"Memory estimate: session {human_bytes(self.session_bytes)}, "
            f"peak {human_bytes(self.peak_bytes)}"
        ]
        for name, a in self.per_analysis.items():
            extra = f" in {a.n_chunks} chunks" if a.chunked else ""
            lines.append(
                f"  {name}: null {human_bytes(a.null_bytes)}{extra} "
                f"(full {human_bytes(a.null_bytes_full)}), batch {human_bytes(a.batch_bytes)}, "
                f"indicator {human_bytes(a.indicator_bytes)}"
            )
        lines += [f"  * {s}" for s in self.suggestions]
        return "\n".join(lines)


def _chunking(config: Any, metric: Any, shape: tuple[int, ...]) -> tuple[int, int]:
    """``(cells per chunk, n_chunks)``; mirrors the rule in ``shuffle_test``."""
    n_cells = shape[0]
    null = config.resolved_null()
    full = config.n_shuffles * int(np.prod(shape, dtype=np.int64)) * 8
    if (
        config.keep_null == "none"
        and metric.level == "cell"
        and metric.cell_separable
        and null.cell_separable
        and full > config.max_null_bytes
    ):
        per_cell = max(1, int(np.prod(shape[1:], dtype=np.int64)))
        chunk = max(1, config.max_null_bytes // (config.n_shuffles * per_cell * 8))
        return chunk, max(1, -(-n_cells // chunk))
    return n_cells, 1


def memory_estimate(pipeline: Pipeline, session: Session) -> MemoryEstimate:
    """Estimate the memory of ``pipeline.run(session)`` without running any metric.

    ``session`` should already contain the states / signals the analyses name (run
    the transforms first); analyses whose target is missing are skipped with a
    suggestion saying so.

    Parameters
    ----------
    pipeline : Pipeline
    session : Session

    Returns
    -------
    MemoryEstimate
        Per-analysis null / batch / indicator bytes, ``session_bytes``, ``peak_bytes``
        (session plus the largest single analysis; analyses run one after another) and
        ``suggestions``.
    """
    n_cells, n_time = session.activity.shape
    sess_bytes = int(session.activity.nbytes) + sum(
        int(s.onehot.nbytes) for s in session.states.values()
    )
    est = MemoryEstimate(session_bytes=sess_bytes)
    names = pipeline.resolved_names()
    for name, spec in zip(names, pipeline.analyses, strict=True):
        metric = spec.metric
        if spec.states is not None:
            space = session.states.get(spec.states)
            n_states = None if space is None else space.n_states
            present = space is not None
        else:
            n_states = None
            present = spec.signal in session.signals
        if not present:
            est.suggestions.append(
                f"analysis {name}: target {spec.target!r} not in session; "
                "run the transforms first for an estimate"
            )
            continue
        shape = output_shape(metric, n_cells, n_states)
        out_bytes = int(np.prod(shape, dtype=np.int64)) * 8
        mem = AnalysisMemory(output_shape=shape, extras_bytes_estimate=2 * out_bytes)
        if n_states is not None and n_states <= DENSE_MAX_STATES:
            mem.indicator_bytes = n_time * n_states * 8
        cfg = spec.shuffle
        cells = shape[0]
        if cfg is not None:
            itemsize = np.dtype(cfg.null_dtype).itemsize if cfg.keep_null == "full" else 8
            mem.null_bytes_full = shuffle_memory_bytes(cfg.n_shuffles, shape, f"f{itemsize}")
            chunk, mem.n_chunks = _chunking(cfg, metric, shape)
            mem.chunked = mem.n_chunks > 1
            cells = chunk if mem.chunked else n_cells
            if mem.chunked:
                mem.null_bytes = shuffle_memory_bytes(
                    cfg.n_shuffles, (chunk, *shape[1:]), "float64"
                )
            else:
                mem.null_bytes = mem.null_bytes_full
            mem.batch_bytes = cfg.batch_size * cells * (n_states or 1) * 8
            if mem.null_bytes_full > cfg.max_null_bytes:
                if cfg.keep_null == "full":
                    est.suggestions.append(
                        f"analysis {name}: null would be {human_bytes(mem.null_bytes_full)}; "
                        "set keep_null='none' to evaluate in chunks"
                        + (
                            f", or null_dtype='float32' to halve it "
                            f"({human_bytes(mem.null_bytes_full / 2)})"
                            if cfg.null_dtype == "float64"
                            else ""
                        )
                    )
                elif not mem.chunked:
                    est.suggestions.append(
                        f"analysis {name}: null of {human_bytes(mem.null_bytes_full)} cannot be "
                        "chunked (population-level metric or non-separable metric/null); "
                        "reduce n_shuffles or the number of states"
                    )
            elif (
                cfg.keep_null == "full"
                and cfg.null_dtype == "float64"
                and (mem.null_bytes_full > cfg.max_null_bytes // 4)
            ):
                est.suggestions.append(
                    f"analysis {name}: null_dtype='float32' would halve the "
                    f"{human_bytes(mem.null_bytes_full)} null"
                )
        est.per_analysis[name] = mem
    est.peak_bytes = sess_bytes + max((a.total_bytes for a in est.per_analysis.values()), default=0)
    return est


__all__ = [
    "AnalysisMemory",
    "MemoryEstimate",
    "human_bytes",
    "memory_estimate",
    "output_shape",
    "shuffle_memory_bytes",
]
