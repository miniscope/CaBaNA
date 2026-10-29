"""Command-line interface: ``cabana run | describe | schema | validate | version`` (F3).

Exit codes: 0 ok, 1 error, 2 usage, 3 cancelled, 4 completed with recorded errors.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import signal
import sys
import threading
import time
import traceback
import warnings
from collections.abc import Iterator
from concurrent.futures.process import BrokenProcessPool
from pathlib import Path
from typing import Any, TextIO

from ._pipeline import Pipeline, ProgressEvent, RunContext, run_set

__all__ = ["main"]

EXIT_OK, EXIT_ERROR, EXIT_USAGE, EXIT_CANCELLED, EXIT_PARTIAL = 0, 1, 2, 3, 4
SCHEMA_NAMES = (
    "resultset",
    "pipeline",
    "analysis_spec",
    "shuffle_config",
    "selection",
    "study",
    "tuning_export",
    "describe",
)


class _Canceller:
    """SIGINT handler: the first Ctrl-C sets a flag (``__call__``), the second raises."""

    def __init__(self, notify: Any = None) -> None:
        self.requested = False
        self._notify = notify
        self._previous: Any = None
        self._installed = False

    def __call__(self) -> bool:
        return self.requested

    def handler(self, signum: int, frame: Any) -> None:
        if self.requested:
            raise KeyboardInterrupt
        self.requested = True
        msg = "cabana: cancelling after the current step (Ctrl-C again to abort)"
        if self._notify is not None:
            self._notify(msg)
        else:
            print(msg, file=sys.stderr)

    def __enter__(self) -> _Canceller:
        if threading.current_thread() is threading.main_thread():
            self._previous = signal.signal(signal.SIGINT, self.handler)
            self._installed = True
        return self

    def __exit__(self, *exc: Any) -> None:
        if self._installed:
            signal.signal(signal.SIGINT, self._previous)
            self._installed = False


class _Progress:
    """Builds the RunContext callbacks for ``--progress`` and owns the stderr/jsonl stream.

    In ``jsonl`` mode every message (progress, log lines, warnings, the fatal error and
    the final ``done``) is one JSON object per line with an ``"event"`` key.
    """

    def __init__(self, mode: str, path: str | None) -> None:
        self.mode = mode
        self._own = None
        self.stream: TextIO = sys.stderr
        if path is not None and mode == "jsonl":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            self._own = open(path, "w", buffering=1)  # noqa: SIM115
            self.stream = self._own
        self.t0 = time.perf_counter()
        self.error_reported = False

    @property
    def jsonl(self) -> bool:
        return self.mode == "jsonl"

    def _line(self, obj: dict[str, Any]) -> None:
        self.stream.write(json.dumps(obj, allow_nan=False, default=str) + "\n")
        self.stream.flush()

    def on_progress(self, ev: ProgressEvent) -> None:
        self._line({"event": "progress", **ev.to_dict()})

    def log(self, msg: str) -> None:
        """A free-text message: ``log`` event in jsonl mode, a plain stderr line otherwise."""
        if self.jsonl:
            self._line({"event": "log", "message": msg})
        else:
            print(msg, file=sys.stderr, flush=True)

    def warn(self, message: Any, category: Any) -> None:
        if self.jsonl:
            self._line(
                {
                    "event": "warning",
                    "category": getattr(category, "__name__", str(category)),
                    "message": str(message),
                }
            )

    def error(self, exc: BaseException, tb: str | None = None) -> None:
        """Record a fatal error as an ``error`` event (jsonl mode only)."""
        if self.jsonl:
            obj: dict[str, Any] = {
                "event": "error",
                "type": type(exc).__name__,
                "message": str(exc),
            }
            if tb:
                obj["traceback"] = tb
            self._line(obj)
            self.error_reported = True

    @contextlib.contextmanager
    def capture_warnings(self) -> Iterator[None]:
        """Route Python warnings into the jsonl stream for the duration of the run."""
        if not self.jsonl:
            yield
            return

        def hook(
            message: Any, category: Any, filename: Any, lineno: Any, *a: Any, **k: Any
        ) -> None:
            self.warn(message, category)

        with warnings.catch_warnings():
            warnings.showwarning = hook
            yield

    def apply(self, ctx: RunContext) -> RunContext:
        if self.mode == "jsonl":
            ctx.on_progress = self.on_progress
        elif self.mode == "text":
            ctx.log = self.log
        return ctx

    def done(self, status: str) -> None:
        if self.mode == "jsonl":
            self._line(
                {
                    "event": "done",
                    "status": status,
                    "elapsed_s": round(time.perf_counter() - self.t0, 3),
                }
            )

    def close(self) -> None:
        if self._own is not None:
            self._own.close()


def _status_code(status: str) -> int:
    return {"cancelled": EXIT_CANCELLED, "partial": EXIT_PARTIAL}.get(status, EXIT_OK)


def _load_yaml_mapping(path: str) -> Any:
    import yaml

    return yaml.safe_load(Path(path).read_text())


def _session_id(session: Any, path: str) -> str:
    p = Path(path)
    return session.info.session_id or (p.stem if p.suffix.lower() == ".zip" else p.name)


def _cmd_run(args: argparse.Namespace) -> int:
    from ._study import StudySpec, is_study_mapping, load_session_source, run_study, save_cancelled

    mode = "jsonl" if args.progress_file else args.progress  # --progress-file implies jsonl
    progress = _Progress(mode, args.progress_file)
    canceller = _Canceller(notify=progress.log)
    ctx = progress.apply(RunContext(should_cancel=canceller, on_error=args.on_error))
    status = "error"
    try:
        with progress.capture_warnings(), canceller:
            spec_path = Path(args.spec)
            if not spec_path.is_file():
                raise FileNotFoundError(f"spec not found: {spec_path}")
            doc = _load_yaml_mapping(args.spec)
            study = is_study_mapping(doc)
            if study and args.session:
                progress.log("cabana run: --session is not used with a study YAML")
                return EXIT_USAGE
            if not study and not args.session:
                progress.log("cabana run: a pipeline YAML needs at least one --session")
                return EXIT_USAGE
            try:
                if study:
                    spec = StudySpec.from_yaml(spec_path)
                    if args.n_jobs is not None:
                        spec.n_jobs = args.n_jobs
                    if args.no_resume:
                        spec.resume = False
                    result = run_study(spec, context=ctx, out_dir=args.out)
                    run, status = result.run, result.status
                    out = args.out or spec.resolved_out_dir()
                    for sid, st in run.status.items():
                        print(f"{sid}: {st}")
                    for sid, c in (result.classifications or {}).items():
                        print(f"{sid}: {c.counts()}")
                else:
                    pipeline = Pipeline.from_yaml(spec_path)
                    sessions: dict[str, Any] = {}
                    for p in args.session:
                        s = load_session_source(p)
                        sid = _session_id(s, p)
                        if sid in sessions:
                            raise ValueError(f"duplicate session id {sid!r} ({p})")
                        sessions[sid] = s
                    out = args.out
                    run = run_set(
                        pipeline,
                        sessions,
                        context=ctx,
                        n_jobs=args.n_jobs or 1,
                        out_dir=out,
                        resume=not args.no_resume,
                    )
                    if out is not None:
                        save_cancelled(run, out)
                    if run.cancelled:
                        status = "cancelled"
                    elif any(v == "partial" for v in run.status.values()):
                        status = "partial"
                    else:
                        status = "ok"
                    if out is None:
                        _print_results(run)
                    else:
                        for sid, st in run.status.items():
                            print(f"{sid}: {st}")
            except BrokenProcessPool:
                status = "cancelled"
                progress.log(
                    "cabana: workers interrupted; partial results were not written for "
                    "sessions that were running"
                )
                return EXIT_CANCELLED
            if out is not None:
                print(f"results written to {out}")
            elif status == "cancelled":
                progress.log("cabana: results were not saved because --out was not given")
        return _status_code(status)
    except Exception as e:
        progress.error(e, traceback.format_exc() if getattr(args, "debug", False) else None)
        if progress.error_reported and progress.stream is sys.stderr:
            e._cabana_reported = True  # type: ignore[attr-defined]
        raise
    finally:
        progress.done(status)
        progress.close()


def _print_results(run: Any) -> None:
    for sid, rs in run.results.items():
        print(f"== {sid} ({run.status.get(sid)})")
        df = rs.to_dataframe()
        print(df.head().to_string() if len(df) else "(no cell-level results)")
        try:
            print(rs.summary().to_string())
        except (NotImplementedError, ImportError):
            pass


def _cmd_describe(args: argparse.Namespace) -> int:
    from ._pipeline import describe

    print(json.dumps(describe(probe=args.probe), indent=args.indent, allow_nan=False))
    return EXIT_OK


def _cmd_schema(args: argparse.Namespace) -> int:
    from . import _schema

    try:
        sch = _schema.schema(args.name)
    except KeyError:
        print(
            f"cabana schema: unknown schema {args.name!r}; valid names: {', '.join(SCHEMA_NAMES)}",
            file=sys.stderr,
        )
        return EXIT_USAGE
    print(json.dumps(sch, indent=args.indent, allow_nan=False, sort_keys=True))
    return EXIT_OK


def _cmd_validate(args: argparse.Namespace) -> int:
    from ._study import is_study_mapping, load_session_source

    if is_study_mapping(_load_yaml_mapping(args.spec)):
        from ._study import StudySpec

        pipeline = StudySpec.from_yaml(Path(args.spec)).resolved_pipeline()
    else:
        pipeline = Pipeline.from_yaml(Path(args.spec))
    report = pipeline.validate(load_session_source(args.session))
    if hasattr(report, "to_dict"):
        print(json.dumps(report.to_dict(), indent=2, default=str))
    else:
        print(str(report))
    return EXIT_OK if getattr(report, "ok", True) else EXIT_ERROR


def _cmd_version(args: argparse.Namespace) -> int:
    from . import __version__

    print(__version__)
    return EXIT_OK


def _build_parser() -> argparse.ArgumentParser:
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument(
        "--debug",
        action="store_true",
        default=argparse.SUPPRESS,
        help="show a traceback on errors",
    )
    p = argparse.ArgumentParser(prog="cabana", description="CaBaNA command line.", parents=[common])
    sub = p.add_subparsers(dest="command", required=True, metavar="COMMAND")

    r = sub.add_parser("run", parents=[common], help="run a pipeline or study")
    r.add_argument("spec", help="pipeline YAML or study YAML (kind: cabana.Study)")
    r.add_argument(
        "--session",
        action="append",
        default=[],
        metavar="PATH",
        help="session zip/dir or session folder (repeatable; pipeline YAML only)",
    )
    r.add_argument("--out", metavar="DIR", help="output folder (overrides the study's out_dir)")
    r.add_argument(
        "--progress",
        choices=["none", "text", "jsonl"],
        default="none",
        help="progress on stderr: stage lines or one JSON object per line",
    )
    r.add_argument(
        "--progress-file",
        metavar="PATH",
        help="write the jsonl event stream here instead of stderr (implies --progress jsonl)",
    )
    r.add_argument("--n-jobs", type=int, default=None, help="sessions in parallel (-1 = all cores)")
    r.add_argument("--no-resume", action="store_true", help="recompute sessions already in --out")
    r.add_argument(
        "--on-error",
        choices=["raise", "record"],
        default="raise",
        help="record: store failed analyses in the results and continue",
    )
    r.set_defaults(func=_cmd_run)

    d = sub.add_parser("describe", parents=[common], help="print the capability description (JSON)")
    d.add_argument(
        "--probe",
        action="store_true",
        help="also run every metric once on a tiny simulated session to report its output arrays",
    )
    d.add_argument("--indent", type=int, default=2)
    d.set_defaults(func=_cmd_describe)

    s = sub.add_parser("schema", parents=[common], help="print a JSON Schema")
    s.add_argument("name", help="one of: " + ", ".join(SCHEMA_NAMES))
    s.add_argument("--indent", type=int, default=2)
    s.set_defaults(func=_cmd_schema)

    v = sub.add_parser("validate", parents=[common], help="check a pipeline against a session")
    v.add_argument("spec", help="pipeline YAML or study YAML")
    v.add_argument("--session", required=True, metavar="PATH")
    v.set_defaults(func=_cmd_validate)

    sub.add_parser("version", parents=[common], help="print the version").set_defaults(
        func=_cmd_version
    )
    return p


def main(argv: list[str] | None = None) -> int:
    """Entry point of the ``cabana`` command; returns the exit code.

    Parameters
    ----------
    argv : list[str], optional
        Arguments (default ``sys.argv[1:]``).

    Returns
    -------
    int
        0 ok, 1 error, 2 usage, 3 cancelled, 4 completed with recorded errors.
    """
    parser = _build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as e:
        return int(e.code) if isinstance(e.code, int) else EXIT_USAGE
    debug = getattr(args, "debug", False)
    try:
        return int(args.func(args))
    except KeyboardInterrupt:
        raise
    except BrokenPipeError:  # e.g. `cabana describe | head`
        with contextlib.suppress(Exception):
            os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        return EXIT_OK
    except Exception as e:
        if getattr(e, "_cabana_reported", False):
            pass
        elif debug:
            traceback.print_exc()
        else:
            print(f"cabana: error: {type(e).__name__}: {e}", file=sys.stderr)
        return EXIT_ERROR


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
