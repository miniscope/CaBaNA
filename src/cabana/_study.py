"""Study specification and the ``run_study`` driver behind ``cabana run study.yaml`` (F3).

A :class:`StudySpec` names the sessions of a study (with how to load each), the animal
of every session, the pipeline, optional cell-classification criteria and an output
folder.  :func:`run_study` loads the sessions, runs the pipeline over all of them with
:func:`cabana.run_set`, applies the criteria to every session's results and writes a
``study.json`` summary.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from datetime import datetime, UTC
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, model_validator

from ._criteria import ClassificationResult, Criteria, classification_table, classify
from ._pipeline import Pipeline, RunContext, RunSetResult, _plain, _sha_json, run_set

try:  # optional
    import yaml
except ImportError:  # pragma: no cover
    yaml = None

if TYPE_CHECKING:
    import pandas as pd

    from ._models import Session

__all__ = ["SessionSource", "StudyResult", "StudySpec", "load_session_source", "run_study"]

STUDY_KIND = "cabana.Study"


class SessionSource(BaseModel):
    """Where one session of a study comes from.

    Parameters
    ----------
    path : str
        A session saved by ``Session.save`` (``.zip`` or directory with
        ``manifest.json``) or a session folder holding ``session.yaml`` (read by
        ``cabana.loaders.load_session_dir``).  Relative paths resolve against the
        study file's folder.
    loader : {"session", "session_dir"}, optional
        ``None`` detects: a directory with ``session.yaml`` (or ``config.yaml``)
        is ``session_dir``; a ``.zip`` or a directory with ``manifest.json`` is
        ``session``.
    animal : str, optional
        Animal of this session (overridden by ``StudySpec.animal``).
    """

    model_config = ConfigDict(extra="forbid")

    path: str = Field(
        ..., description="Session zip/dir saved by Session.save, or a session folder."
    )
    loader: Literal["session", "session_dir"] | None = Field(
        None, description="How to load path; None detects from its content."
    )
    animal: str | None = Field(None, description="Animal id of this session.")


class StudySpec(BaseModel):
    """Sessions + animal map + pipeline + criteria + output folder of one study.

    Parameters
    ----------
    name : str
        Study name (recorded in ``study.json``).
    sessions : dict[str, SessionSource]
        Session id -> source.
    animal : dict[str, str], optional
        Session id -> animal; merged over each source's ``animal``.  Sessions with
        neither are their own animal.
    pipeline : Pipeline or str
        Inline pipeline (mapping) or a path to a pipeline YAML, relative to the
        study file's folder.
    criteria : dict[str, Criteria or str], optional
        Class name -> inline criteria or path to a criteria YAML.
    out_dir : str, optional
        Output folder (relative to the study file's folder).
    n_jobs : int, default 1
        Sessions processed in parallel (``run_set``).
    resume : bool, default True
        Reuse results already in ``out_dir``.
    """

    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    name: str = Field(..., description="Study name.")
    sessions: dict[str, SessionSource] = Field(..., description="Session id -> source.")
    animal: dict[str, str] | None = Field(
        None, description="Session id -> animal id; default each session is its own animal."
    )
    pipeline: Pipeline | str = Field(..., description="Inline pipeline or path to a pipeline YAML.")
    criteria: dict[str, Criteria | str] | None = Field(
        None, description="Class name -> inline Criteria or path to a criteria YAML."
    )
    out_dir: str | None = Field(None, description="Output folder for results and study.json.")
    n_jobs: int = Field(1, description="Sessions processed in parallel (-1 = all cores).")
    resume: bool = Field(True, description="Reuse per-session results already in out_dir.")

    _base_dir: Path | None = PrivateAttr(default=None)

    @model_validator(mode="before")
    @classmethod
    def _default_criteria_names(cls, data: Any) -> Any:
        crit = data.get("criteria") if isinstance(data, dict) else None
        if crit is None:
            return data
        if not isinstance(crit, dict):
            raise ValueError("criteria must be a mapping of class name -> criteria")
        fixed: dict[str, Any] = {}
        for k, c in crit.items():
            if isinstance(c, dict):
                c = {"name": k, **c}
            elif not isinstance(c, str | Criteria):
                raise ValueError(
                    f"criteria {k!r}: expected an inline mapping or a path to a criteria YAML, "
                    f"got {type(c).__name__}"
                )
            fixed[k] = c
        return {**data, "criteria": fixed}

    @model_validator(mode="after")
    def _check(self) -> StudySpec:
        if not self.sessions:
            raise ValueError("a study needs at least one session")
        extra = [s for s in (self.animal or {}) if s not in self.sessions]
        if extra:
            raise ValueError(f"animal given for unknown sessions: {extra}")
        return self

    # ------------------------------------------------------------------ resolution
    def _base(self, base_dir: str | Path | None) -> Path:
        if base_dir is not None:
            return Path(base_dir)
        return self._base_dir if self._base_dir is not None else Path.cwd()

    def resolved_pipeline(self, base_dir: str | Path | None = None) -> Pipeline:
        """The :class:`Pipeline`, reading it from its YAML when given as a path.

        Parameters
        ----------
        base_dir : path, optional
            Folder relative paths resolve against (default: the folder of the
            file read by :meth:`from_yaml`, else the working directory).
        """
        if isinstance(self.pipeline, Pipeline):
            return self.pipeline
        p = Path(self.pipeline)
        if not p.is_absolute():
            p = self._base(base_dir) / p
        return Pipeline.from_yaml(p)

    def resolved_criteria(self, base_dir: str | Path | None = None) -> dict[str, Criteria]:
        """Criteria by class name, reading YAML paths relative to ``base_dir``."""
        out: dict[str, Criteria] = {}
        for k, c in (self.criteria or {}).items():
            if isinstance(c, Criteria):
                out[k] = c
            else:
                p = Path(c)
                if not p.is_absolute():
                    p = self._base(base_dir) / p
                out[k] = Criteria.from_yaml(p)
        return out

    def resolved_animal(self) -> dict[str, str]:
        """Animal per session id: ``animal`` map, else source ``animal``, else the id."""
        amap = dict(self.animal or {})
        return {sid: amap.get(sid) or src.animal or sid for sid, src in self.sessions.items()}

    def resolved_out_dir(self, base_dir: str | Path | None = None) -> Path | None:
        """``out_dir`` made absolute against the study folder (``None`` if unset)."""
        if self.out_dir is None:
            return None
        p = Path(self.out_dir)
        return p if p.is_absolute() else self._base(base_dir) / p

    # ------------------------------------------------------------------ serialisation
    def to_dict(self) -> dict[str, Any]:
        """Plain dict (inline pipeline / criteria expanded; ``kind`` first)."""
        d: dict[str, Any] = {"kind": STUDY_KIND, "name": self.name}
        d["sessions"] = {
            k: v.model_dump(mode="json", exclude_none=True) for k, v in self.sessions.items()
        }
        if self.animal:
            d["animal"] = dict(self.animal)
        d["pipeline"] = (
            self.pipeline.to_dict() if isinstance(self.pipeline, Pipeline) else self.pipeline
        )
        if self.criteria:
            d["criteria"] = {
                k: (c.to_dict() if isinstance(c, Criteria) else c) for k, c in self.criteria.items()
            }
        if self.out_dir is not None:
            d["out_dir"] = self.out_dir
        d["n_jobs"] = self.n_jobs
        d["resume"] = self.resume
        return _plain(d)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> StudySpec:
        """Inverse of :meth:`to_dict`; ``kind`` must be ``cabana.Study`` when present."""
        d = dict(d)
        kind = d.pop("kind", STUDY_KIND)
        if kind != STUDY_KIND:
            raise ValueError(f"not a study spec: kind={kind!r} (expected {STUDY_KIND!r})")
        if isinstance(d.get("pipeline"), dict):
            d["pipeline"] = Pipeline.from_dict(d["pipeline"])
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
    def from_yaml(cls, path_or_text: str | Path) -> StudySpec:
        """Build from a YAML file or text (same rules as ``Pipeline.from_yaml``).

        When read from a file, relative paths inside resolve against that
        file's folder.
        """
        if yaml is None:
            raise ImportError("from_yaml requires pyyaml (pip install pyyaml)")
        base: Path | None = None
        if isinstance(path_or_text, Path):
            text, base = path_or_text.read_text(), path_or_text.resolve().parent
        else:
            s = str(path_or_text)
            if "\n" not in s and Path(s).is_file():
                text, base = Path(s).read_text(), Path(s).resolve().parent
            else:
                text = s
        d = yaml.safe_load(text)
        if not isinstance(d, dict) or ("kind" not in d and "sessions" not in d):
            raise ValueError("study YAML must be a mapping with `kind: cabana.Study` and sessions")
        spec = cls.from_dict(d)
        spec._base_dir = base
        return spec


def is_study_mapping(d: Any) -> bool:
    """True if a parsed YAML document is a study spec (``kind`` or ``sessions`` key)."""
    return isinstance(d, dict) and (d.get("kind") == STUDY_KIND or "sessions" in d)


def load_session_source(
    path: str | Path, loader: str | None = None, base_dir: str | Path | None = None
) -> Session:
    """Load a session from a ``Session.save`` zip/dir or a ``session.yaml`` folder.

    Parameters
    ----------
    path : str or Path
        Location; relative paths resolve against ``base_dir``.
    loader : {"session", "session_dir"}, optional
        Force a loader; ``None`` detects (see :class:`SessionSource`).
    base_dir : path, optional
        Folder for relative ``path``.

    Raises
    ------
    FileNotFoundError
        If ``path`` does not exist.
    ValueError
        If the loader cannot be detected.
    """
    from ._models import Session

    p = Path(path)
    if not p.is_absolute() and base_dir is not None:
        p = Path(base_dir) / p
    if not p.exists():
        raise FileNotFoundError(f"session path not found: {p}")
    if loader is None:
        if p.is_dir() and (p / "manifest.json").exists():
            loader = "session"
        elif p.is_dir() and ((p / "session.yaml").exists() or (p / "config.yaml").exists()):
            loader = "session_dir"
        elif p.suffix.lower() == ".zip":
            loader = "session"
        elif p.is_file() and p.suffix.lower() in (".yaml", ".yml"):
            loader = "session_dir"
        else:
            raise ValueError(
                f"cannot tell how to load {p}: expected a .zip / folder with manifest.json "
                "(Session.save) or a folder with session.yaml"
            )
    if loader == "session":
        return Session.load(p)
    if loader == "session_dir":
        from .loaders import load_session_dir

        return load_session_dir(p)
    raise ValueError(f"unknown loader {loader!r}")


@dataclass
class StudyResult:
    """Outcome of :func:`run_study`.

    Attributes
    ----------
    run : RunSetResult
        Per-session results and status.
    classifications : dict[str, ClassificationResult]
        Per session id, for sessions whose run finished (``ok`` / ``partial``).
    status : {"ok", "partial", "cancelled"}
        ``cancelled`` if any session was cancelled / not run, else ``partial`` if any
        recorded errors, else ``ok``.
    classification_errors : dict[str, str]
        Sessions of a partial run whose criteria could not be evaluated.
    """

    run: RunSetResult
    classifications: dict[str, ClassificationResult] = field(default_factory=dict)
    status: str = "ok"
    classification_errors: dict[str, str] = field(default_factory=dict)

    def classification_table(self) -> pd.DataFrame:
        """Long ``session, animal, cell, class, member`` table (see ``classification_table``)."""
        return classification_table(self.classifications, self.run.animal)


def save_cancelled(run: RunSetResult, out_dir: str | Path) -> list[Path]:
    """Write the partial results of cancelled sessions as ``<sid>.results.cancelled.zip``.

    ``run_set`` does not write cancelled sessions; the distinct name keeps ``resume``
    from mistaking a partial result for a finished one.  A stale cancelled zip of a
    session that has since completed into ``out_dir`` is deleted, and the cancelled
    sessions get a ``"file"`` entry in ``run_set.json`` (other keys are kept).
    """
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    paths = []
    for sid, rs in run.results.items():
        f = out / f"{sid}.results.cancelled.zip"
        if rs.cancelled:
            rs.save(f)
            paths.append(f)
        elif run.status.get(sid) in ("ok", "partial"):
            f.unlink(missing_ok=True)
    meta_path = out / "run_set.json"
    if paths and meta_path.exists():
        meta = json.loads(meta_path.read_text())
        sessions = meta.get("sessions", {})
        for f in paths:
            sid = f.name.removesuffix(".results.cancelled.zip")
            if isinstance(sessions.get(sid), dict):
                sessions[sid]["file"] = f.name
        tmp = out / "run_set.json.tmp"
        tmp.write_text(json.dumps(meta, indent=2))
        tmp.replace(meta_path)
    return paths


def run_study(
    spec: StudySpec,
    *,
    base_dir: str | Path | None = None,
    context: RunContext | None = None,
    out_dir: str | Path | None = None,
) -> StudyResult:
    """Load the sessions, run the pipeline, classify cells and write ``study.json``.

    Parameters
    ----------
    spec : StudySpec
    base_dir : path, optional
        Folder relative paths in ``spec`` resolve against (default: the study
        file's folder, else the working directory).
    context : RunContext, optional
        Progress, cancellation and error handling, shared by all sessions.
    out_dir : path, optional
        Overrides ``spec.out_dir`` (relative to the working directory).

    Returns
    -------
    StudyResult

    Raises
    ------
    ValueError
        If a session cannot be loaded (the message names the session id), or the
        criteria cannot be evaluated on a finished session (result zips and
        ``study.json`` with ``classification_errors`` are written first).
    """
    from . import __version__
    from ._cohort_models import SessionSet

    pipeline = spec.resolved_pipeline(base_dir)
    criteria = spec.resolved_criteria(base_dir)
    out = Path(out_dir) if out_dir is not None else spec.resolved_out_dir(base_dir)
    sessions: dict[str, Session] = {}
    for sid, src in spec.sessions.items():
        try:
            sessions[sid] = load_session_source(src.path, src.loader, spec._base(base_dir))
        except Exception as e:
            raise ValueError(f"session {sid!r}: {type(e).__name__}: {e}") from e
    animal = spec.resolved_animal()
    sset = SessionSet(sessions=sessions, animal=animal)
    t0 = time.perf_counter()
    run = run_set(
        pipeline,
        sset,
        context=context,
        animal=animal,
        n_jobs=spec.n_jobs,
        out_dir=out,
        resume=spec.resume,
    )
    if out is not None:
        save_cancelled(run, out)

    classifications: dict[str, ClassificationResult] = {}
    cls_errors: dict[str, str] = {}
    fatal: tuple[str, Exception] | None = None
    if criteria:
        for sid, rs in run.results.items():
            if run.status.get(sid) not in ("ok", "partial"):
                continue
            try:
                classifications[sid] = classify(rs, criteria)
            except Exception as e:
                if run.status[sid] == "ok" and fatal is None:
                    fatal = (sid, e)
                cls_errors[sid] = f"{type(e).__name__}: {e}"
    if run.cancelled:
        status = "cancelled"
    elif any(v == "partial" for v in run.status.values()):
        status = "partial"
    else:
        status = "ok"
    result = StudyResult(run, classifications, status, cls_errors)

    if out is not None:
        doc = {
            "name": spec.name,
            "status": status,
            "cabana_version": __version__,
            "pipeline_sha256": _sha_json(pipeline.to_dict()),
            "timestamp": datetime.now(UTC).isoformat(timespec="seconds"),
            "elapsed_s": round(time.perf_counter() - t0, 3),
            "animal": animal,
            "sessions": {
                sid: {
                    "status": run.status.get(sid, "not_run"),
                    **(
                        {"file": f"{sid}.results.cancelled.zip"}
                        if run.status.get(sid) == "cancelled"
                        else {}
                    ),
                }
                for sid in sessions
            },
            "classification_counts": {sid: c.counts() for sid, c in classifications.items()},
            "classification_errors": cls_errors,
        }
        Path(out).mkdir(parents=True, exist_ok=True)
        (Path(out) / "study.json").write_text(json.dumps(doc, indent=2, default=str))
    if fatal is not None:
        sid, e = fatal
        where = f"result zips were saved in {out}" if out is not None else "results were not saved"
        raise ValueError(
            f"session {sid!r}: criteria could not be evaluated ({type(e).__name__}: {e}); {where}"
        ) from e
    return result
