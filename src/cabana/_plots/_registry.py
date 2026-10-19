"""Plot registry: which figures a result can draw, and one call that draws them.

Renderers register themselves::

    @register_plot("rate_maps", data=plot_rate_maps_data, needs_session=True,
                   level="cell", requires=("extras:rate_map",), defaults=_rate_map_defaults)
    def plot_rate_maps(session, result, cells, ...): ...

and every ``Metric`` lists the plots that make sense for it in
``Metric.default_plots`` (a tuple of registry names, most informative first).
Then::

    cabana.plots.plot(result, session)            # the metric's first default plot
    cabana.plots.plot(result, session, "shuffle_distribution", cell=3)
    result.plot(session)                           # same as the first line
    figs = resultset.plot_all(session, out_dir="figs/")   # every default plot of every result

``requires`` is a tuple of conditions the result must meet, checked by
:func:`plots_for`: ``"shuffle"`` (a ShuffleResult), ``"null"`` (null draws
kept), ``"extras:<key>"``, ``"values:1d"`` / ``"values:2d"``, ``"target"``
(``result.target`` is a state space of the session), ``"topology"`` (that
state space has a 1-D or 2-D grid; ``"topology:any"`` accepts any
dimensionality), ``"ground_truth"`` (``session.meta["ground_truth"]``).
A default plot whose requirements the result does not meet is skipped by
``plot_all`` rather than raising.

``defaults(result, session) -> dict`` fills keyword arguments the renderer
needs but the caller did not give (e.g. which ``cells`` to show: the
significant ones first, at most ``max_cells``).
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.figure import Figure

from ._style import use_style
from .._results import MetricResult, ResultSet

__all__ = [
    "PlotSpec",
    "available_plots",
    "plot",
    "plot_all",
    "plot_spec",
    "plots_for",
    "register_plot",
    "save_figures",
]

Level = Literal["cell", "population", "any"]


@dataclass(frozen=True)
class PlotSpec:
    """One registered renderer and its companion data function."""

    name: str
    render: Callable[..., Figure]
    data: Callable[..., dict[str, Any]] | None = None
    needs_session: bool = False
    level: Level = "any"
    requires: tuple[str, ...] = ()
    defaults: Callable[[MetricResult, Any], dict[str, Any]] | None = None
    doc: str = field(default="")

    def applies_to(self, result: MetricResult, session: Any = None) -> bool:
        """True when the result (and session) meet ``level`` and ``requires``."""
        if self.level != "any" and result.level != self.level:
            return False
        if self.needs_session and session is None:
            return False
        for req in self.requires:
            if req == "shuffle" and result.shuffle is None:
                return False
            if req == "null" and (result.shuffle is None or result.shuffle.null is None):
                return False
            if req.startswith("extras:") and req[7:] not in result.extras:
                return False
            if req == "values:2d" and np.ndim(result.values) != 2:
                return False
            if req == "values:1d" and np.ndim(result.values) != 1:
                return False
            if req == "target":
                if session is None or result.target not in getattr(session, "states", {}):
                    return False
            if req in ("topology", "topology:any"):
                space = getattr(session, "states", {}).get(result.target) if session else None
                if space is None or space.topology is None:
                    return False
                if req == "topology" and getattr(space.topology, "ndim", 2) not in (1, 2):
                    return False
            if req == "ground_truth" and not (session and session.meta.get("ground_truth")):
                return False
        return True


_PLOTS: dict[str, PlotSpec] = {}


def register_plot(
    name: str,
    *,
    data: Callable[..., dict[str, Any]] | None = None,
    needs_session: bool = False,
    level: Level = "any",
    requires: Sequence[str] = (),
    defaults: Callable[[MetricResult, Any], dict[str, Any]] | None = None,
) -> Callable[[Callable[..., Figure]], Callable[..., Figure]]:
    """Decorator registering a renderer under ``name`` (see module docstring).

    Re-registering a name replaces the entry (so a user plugin may override a
    built-in renderer).
    """

    def deco(fn: Callable[..., Figure]) -> Callable[..., Figure]:
        _PLOTS[name] = PlotSpec(
            name=name,
            render=fn,
            data=data,
            needs_session=needs_session,
            level=level,
            requires=tuple(requires),
            defaults=defaults,
            doc=(fn.__doc__ or "").strip().split("\n", 1)[0],
        )
        return fn

    return deco


def plot_spec(name: str) -> PlotSpec:
    """The registered :class:`PlotSpec` for ``name``; ``KeyError`` lists the names."""
    try:
        return _PLOTS[name]
    except KeyError:
        raise KeyError(f"no plot named {name!r}; available: {available_plots()}") from None


def available_plots() -> list[str]:
    """Registered plot names, sorted."""
    return sorted(_PLOTS)


def _default_plots(result: MetricResult) -> tuple[str, ...]:
    from .._registry import _REGISTRY

    cls = _REGISTRY.get("metric", {}).get(result.metric)
    return tuple(getattr(cls, "default_plots", ()) or ())


def plots_for(result: MetricResult, session: Any = None) -> list[str]:
    """The result's metric ``default_plots`` that apply to this result (and session).

    Metrics without ``default_plots`` (user plugins) fall back to the generic
    views: ``tuning_heatmap`` for 2-D cell values, ``metric_strip`` for 1-D,
    ``shuffle_distribution`` when null draws were kept, ``population_matrix``
    for 2-D population values.
    """
    names = _default_plots(result) or _GENERIC
    return [n for n in names if n in _PLOTS and _PLOTS[n].applies_to(result, session)]


_GENERIC = ("tuning_heatmap", "metric_strip", "population_matrix", "shuffle_distribution")


def plot(result: MetricResult, session: Any = None, kind: str | None = None, **kw: Any) -> Figure:
    """Draw one registered figure for ``result``.

    Parameters
    ----------
    result : MetricResult
    session : Session, optional
        Needed by plots that read state spaces, signals or ground truth.
    kind : str, optional
        Registry name; default is the first applicable entry of the metric's
        ``default_plots``.
    **kw
        Passed to the renderer after ``spec.defaults`` has filled what is missing.

    Raises
    ------
    ValueError
        If no plot applies, or ``kind`` does not apply to this result (the
        message says which requirement failed).
    """
    if kind is None:
        names = plots_for(result, session)
        if not names:
            raise ValueError(
                f"no registered plot applies to {result.name!r} (metric {result.metric!r}, "
                f"level {result.level!r}); pass session=... or kind=..."
            )
        kind = names[0]
    spec = plot_spec(kind)
    if not spec.applies_to(result, session):
        raise ValueError(
            f"plot {kind!r} does not apply to {result.name!r}: needs level={spec.level}, "
            f"requires={list(spec.requires)}, session={'yes' if spec.needs_session else 'no'}"
        )
    args = dict(spec.defaults(result, session)) if spec.defaults else {}
    args.update(kw)
    with use_style():
        if spec.needs_session:
            return spec.render(result, session, **args)
        return spec.render(result, **args)


def plot_all(
    resultset: ResultSet | Iterable[MetricResult],
    session: Any = None,
    *,
    kinds: Mapping[str, Sequence[str]] | None = None,
    out_dir: str | Path | None = None,
    fmt: str = "png",
    dpi: int = 130,
    close: bool = True,
    **kw: Any,
) -> dict[str, Figure | Path]:
    """Every default plot of every result, keyed ``"<analysis>/<plot>"``.

    Parameters
    ----------
    resultset : ResultSet or iterable of MetricResult
    session : Session, optional
    kinds : mapping analysis name -> plot names, optional
        Restrict or extend what is drawn per analysis; analyses not listed keep
        their metric defaults.  A plot named here that does not apply to its
        result raises ``ValueError`` (default plots that do not apply are
        skipped silently).
    out_dir : path, optional
        When given, each figure is saved as ``<out_dir>/<analysis>__<plot>.<fmt>``
        (``/`` and ``[`` ``]`` in names become ``_``) and the dict holds the
        paths; with ``close=True`` (default) the figures are closed after saving.
        Without ``out_dir`` the dict holds open figures.
    **kw
        Passed to every renderer (keywords a renderer does not accept are dropped
        for that renderer).

    Returns
    -------
    dict[str, Figure | Path]
    """
    results = list(resultset.results) if isinstance(resultset, ResultSet) else list(resultset)
    out: dict[str, Figure | Path] = {}
    for r in results:
        name = str(r.name or f"{r.metric}[{r.target}]")
        explicit = kinds is not None and name in kinds
        names = list(kinds[name]) if explicit else plots_for(r, session)
        for k in names:
            spec = plot_spec(k)
            if not spec.applies_to(r, session):
                if explicit:
                    raise ValueError(
                        f"plot {k!r} requested for {name!r} does not apply: needs "
                        f"level={spec.level}, requires={list(spec.requires)}, "
                        f"session={'yes' if spec.needs_session else 'no'}"
                    )
                continue
            fig = plot(r, session, k, **_accepted(spec.render, kw))
            key = f"{name}/{k}"
            if out_dir is None:
                out[key] = fig
            else:
                out[key] = save_figures({key: fig}, out_dir, fmt=fmt, dpi=dpi, close=close)[0]
    return out


def _accepted(fn: Callable[..., Any], kw: Mapping[str, Any]) -> dict[str, Any]:
    import inspect

    try:
        params = inspect.signature(fn).parameters
    except (TypeError, ValueError):
        return dict(kw)
    if any(p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values()):
        return dict(kw)
    return {k: v for k, v in kw.items() if k in params}


def _safe_name(key: str) -> str:
    return "".join(c if c.isalnum() or c in "-._" else "_" for c in key.replace("/", "__"))


def save_figures(
    figs: Mapping[str, Figure],
    out_dir: str | Path,
    *,
    fmt: str = "png",
    dpi: int = 130,
    close: bool = True,
) -> list[Path]:
    """Save figures to ``out_dir/<safe key>.<fmt>``; returns the paths in order.

    Parameters
    ----------
    figs : mapping str -> Figure
    out_dir : path
        Created if missing.
    fmt : str, default "png"
        Any format matplotlib can write (``"pdf"``, ``"svg"``...).
    dpi : int, default 130
    close : bool, default True
        Close each figure after saving (keeps long sessions from leaking memory).
    """
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    for key, fig in figs.items():
        p = out_dir / f"{_safe_name(key)}.{fmt}"
        fig.savefig(p, dpi=dpi, bbox_inches="tight")
        if close:
            plt.close(fig)
        paths.append(p)
    return paths
