"""Logging and progress-bar adapters for pipeline runs.

``logger`` is the ``"cabana"`` logger (a ``NullHandler`` is attached, so nothing is printed
until the application configures logging, e.g. ``logging.basicConfig(level=logging.INFO)``).
:func:`log_context` and :func:`tqdm_context` build a :class:`~cabana.RunContext` that reports
a run through the logger or a tqdm bar; :func:`merge_context` combines two contexts.
"""

from __future__ import annotations

import logging
from dataclasses import replace
from typing import Any

from ._pipeline import ProgressEvent, RunContext

logger = logging.getLogger("cabana")
logger.addHandler(logging.NullHandler())

_BAR_UNITS = 1000


def log_context(level: int = logging.INFO) -> RunContext:
    """A :class:`RunContext` that reports to the ``"cabana"`` logger.

    Stage lines (``[transform] ...``, ``[analyze] ...``) go to ``logger`` at ``level``;
    ``on_progress`` logs the start and end of every analysis at ``level`` and every shuffle
    batch at DEBUG.

    Parameters
    ----------
    level : int, default logging.INFO
        Level of the stage and analysis lines.

    Returns
    -------
    RunContext
    """

    def log(msg: str) -> None:
        logger.log(level, "%s", msg)

    def on_progress(ev: ProgressEvent) -> None:
        if ev.stage == "shuffle":
            logger.debug(
                "%s: shuffle %s/%s (%.0f%% overall)",
                ev.name,
                ev.shuffles_done,
                ev.shuffles_total,
                100 * ev.fraction,
            )
        elif ev.stage == "analysis":
            what = {"start": "started", "finished": "finished", "failed": "FAILED"}.get(
                ev.message, ev.message
            )
            logger.log(
                level,
                "analysis %d/%d %s %s (%.0f%%, %.1f s)",
                ev.index + 1,
                ev.total,
                ev.name,
                what,
                100 * ev.fraction,
                ev.elapsed_s,
            )
        elif ev.stage == "done":
            logger.log(level, "run %s in %.1f s", ev.message or "done", ev.elapsed_s)

    return RunContext(on_progress=on_progress, log=log)


def tqdm_context(
    total: int | None = None,
    desc: str = "cabana",
    leave: bool = False,
    **tqdm_kw: Any,
) -> RunContext:
    """A :class:`RunContext` whose ``on_progress`` drives one tqdm bar.

    The bar counts ``fraction * total`` units (``total`` defaults to 1000, i.e. 0.1 % steps),
    shows the current ``stage:name`` as its postfix and is closed by the ``done`` event.  The
    callback also has a ``close()`` attribute for runs that raise before ``done``.

    Parameters
    ----------
    total : int, optional
        Bar length in units; default 1000.
    desc : str, default "cabana"
        Bar description.
    leave : bool, default False
        Keep the finished bar on screen.
    **tqdm_kw
        Passed to ``tqdm.tqdm`` (``file=``, ``disable=``, ...).

    Returns
    -------
    RunContext

    Raises
    ------
    ImportError
        If tqdm is not installed (``pip install tqdm``).
    """
    try:
        from tqdm import tqdm
    except ImportError as exc:
        raise ImportError(
            "tqdm_context needs tqdm (pip install tqdm); or use cabana.log_context() "
            "for logger-based progress"
        ) from exc
    units = int(total) if total is not None else _BAR_UNITS
    bar = tqdm(total=units, desc=desc, leave=leave, **tqdm_kw)
    state = {"n": 0, "closed": False}

    def close() -> None:
        if not state["closed"]:
            state["closed"] = True
            bar.close()

    def on_progress(ev: ProgressEvent) -> None:
        if state["closed"]:
            return
        frac = 1.0 if ev.stage == "done" and ev.message != "cancelled" else ev.fraction
        target = min(units, max(state["n"], int(round(frac * units))))
        if target > state["n"]:
            bar.update(target - state["n"])
            state["n"] = target
        if ev.stage != "done":
            bar.set_postfix_str(f"{ev.stage}:{ev.name}" if ev.name else ev.stage, refresh=False)
        else:
            close()

    on_progress.close = close  # type: ignore[attr-defined]
    return RunContext(on_progress=on_progress)


def _both(fa: Any, fb: Any) -> Any:
    if fa is None:
        return fb
    if fb is None:
        return fa

    def call(*args: Any) -> None:
        fa(*args)
        fb(*args)

    for attr in ("close",):
        closers = [c for c in (getattr(fa, attr, None), getattr(fb, attr, None)) if c]
        if closers:
            call.close = lambda cs=closers: [c() for c in cs]  # type: ignore[attr-defined]
    return call


def merge_context(a: RunContext | None, b: RunContext | None) -> RunContext:
    """Combine two contexts: every callback of both is called, ``should_cancel`` is ORed.

    ``on_progress`` and ``log`` call ``a`` then ``b``.  For the scalar fields ``b`` wins when
    it differs from the default (``on_error``, ``capture_warnings``, ``n_jobs``).

    Parameters
    ----------
    a, b : RunContext or None
        Contexts to merge; ``None`` is an empty context.

    Returns
    -------
    RunContext
    """
    a = a if a is not None else RunContext()
    b = b if b is not None else RunContext()
    cancel = None
    if a.should_cancel is not None and b.should_cancel is not None:

        def cancel() -> bool:  # noqa: F811
            return bool(a.should_cancel()) or bool(b.should_cancel())

    else:
        cancel = a.should_cancel or b.should_cancel
    return replace(
        a,
        on_progress=_both(a.on_progress, b.on_progress),
        should_cancel=cancel,
        log=_both(a.log, b.log),
        on_error=b.on_error if b.on_error != "raise" else a.on_error,
        capture_warnings=a.capture_warnings and b.capture_warnings,
        n_jobs=b.n_jobs if b.n_jobs is not None else a.n_jobs,
    )
