"""``TuningExport``: the file that carries tuned parameter values back into a pipeline.

The layout mirrors CaLab's CaTune export (``schema_version``, tool version, export
date, ``parameters``, ``metadata``): a small, versioned, strict-JSON document.  Here
``chosen`` maps ``Pipeline.set_param`` paths to values.  :func:`tune` produces one
headlessly from a sweep; a future CaLab slider app will post the same document back,
and :func:`apply_tuning` writes it into a pipeline with a ``Selection`` per value.
"""

from __future__ import annotations

import json
import warnings
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

from ._selection import Selection, _jsonable

if TYPE_CHECKING:
    from ._pipeline import Pipeline, RunContext
    from ._sweep import SweepResult

__all__ = ["TuningExport", "apply_tuning", "tune"]


def _cabana_version() -> str:
    from . import __version__

    return __version__


def _now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class TuningExport(BaseModel):
    """Tuned parameter values with the evidence for them (JSON interchange document).

    Parameters
    ----------
    schema_version : "1.0.0"
        Format version.
    kind : "cabana.TuningExport"
        Document kind.
    cabana_version : str
        Version of cabana that wrote it.
    export_date : str
        UTC ISO 8601 time of export.
    session_hash : str, optional
        Hash of the session activity the sweep ran on (``None`` if unknown).
    pipeline_sha256 : str
        Hash of the base pipeline (``Pipeline.to_dict()``) the values apply to.
    chosen : dict[str, Any]
        Parameter path (``Pipeline.set_param`` grammar) to chosen value.
    swept : dict[str, list]
        Path to the candidates considered (empty for a pick made without a sweep).
    criterion, rule : str, optional
        How the choice was scored and decided.
    informed_by_significance : bool
        True when the chooser saw p-values or significant counts.
    selections : list[Selection]
        One record per chosen path.
    metadata : dict
        ``n_cells``, ``n_time``, ``fs``, ``session_id`` when known and
        ``sweep_summary`` (``{path: {"candidates", "scores", "se"}}``); extra keys allowed.
    """

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal["1.0.0"] = Field(
        default="1.0.0", description="Format version of this document."
    )
    kind: Literal["cabana.TuningExport"] = Field(
        default="cabana.TuningExport", description="Document kind."
    )
    cabana_version: str = Field(
        default_factory=_cabana_version, description="Version of cabana that wrote the export."
    )
    export_date: str = Field(
        default_factory=_now_iso, description="UTC ISO 8601 time the export was made."
    )
    session_hash: str | None = Field(
        default=None, description="Hash of the session activity the sweep ran on, if known."
    )
    pipeline_sha256: str = Field(
        description="SHA-256 of the base pipeline dict the chosen values apply to."
    )
    chosen: dict[str, Any] = Field(
        default_factory=dict,
        description="Parameter path (Pipeline.set_param grammar) to chosen value.",
    )
    swept: dict[str, list[Any]] = Field(
        default_factory=dict,
        description="Parameter path to the candidate values considered (may be empty).",
    )
    criterion: str | None = Field(default=None, description="Criterion the choice was scored by.")
    rule: str | None = Field(default=None, description="Rule that turned scores into a choice.")
    informed_by_significance: bool = Field(
        default=False, description="True when the choice was informed by p-values or counts."
    )
    selections: list[Selection] = Field(
        default_factory=list, description="One Selection record per chosen path."
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Session facts (n_cells, n_time, fs, session_id), sweep_summary, extras.",
    )

    # ------------------------------------------------------------------ I/O
    def to_dict(self) -> dict[str, Any]:
        """Plain JSON-able dict; non-finite floats are encoded as ``{"__float__": ...}``."""
        from ._io import _encode_floats

        d = self.model_dump()  # python mode keeps NaN (json mode would turn it into null)
        return _encode_floats(_jsonable(d))

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> TuningExport:
        """Inverse of :meth:`to_dict`."""
        from ._io import _decode_floats

        return cls.model_validate(_decode_floats(d))

    def to_json(self, path: str | Path | None = None, indent: int | None = 2) -> str:
        """Strict JSON text (no NaN literals); also written to ``path`` when given."""
        text = json.dumps(self.to_dict(), indent=indent, allow_nan=False)
        if path is not None:
            Path(path).write_text(text)
        return text

    @classmethod
    def from_json(cls, path_or_text: str | Path) -> TuningExport:
        """Read an export from a file path or from JSON text."""
        if isinstance(path_or_text, Path):
            text = path_or_text.read_text()
        else:
            s = str(path_or_text)
            text = s if s.lstrip().startswith("{") else Path(s).read_text()
        return cls.from_dict(json.loads(text))


def _sweep_summary(
    sweep: SweepResult, selections: list[Selection], criterion: str | None, analysis: str | None
) -> dict[str, Any]:
    """Per path: candidates, scores and SEs of the criterion (as :meth:`SweepResult.pick`)."""
    out: dict[str, Any] = {}
    se_by_path: dict[str, list[float]] = {}
    if criterion is not None and criterion.startswith("median_"):
        summ = sweep.summary()
        if not summ.empty:
            names = list(dict.fromkeys(summ["analysis"]))
            a = analysis if analysis is not None else (names[0] if len(names) == 1 else None)
            se_col = "se_" + criterion[len("median_") :]
            if a in names and criterion in summ.columns and se_col in summ.columns:
                summ = summ[summ["analysis"] == a]
                score = summ[criterion].to_numpy(float)
                se = summ[se_col].to_numpy(float)
                cand = np.array([sweep._cand_index(int(k)) for k in summ["point"].to_numpy(int)])
                for j, p in enumerate(sweep.params):
                    ses = []
                    for ci in range(len(sweep.over[p])):
                        m = (cand[:, j] == ci) & np.isfinite(score)
                        if m.any():
                            ses.append(float(np.sqrt(np.nansum(se[m] ** 2)) / m.sum()))
                    se_by_path[p] = ses
    for s in selections:
        if s.candidates is None or s.scores is None:
            continue
        ses = se_by_path.get(s.path, [])
        out[s.path] = {
            "candidates": list(s.candidates),
            "scores": list(s.scores),
            "se": ses if len(ses) == len(s.scores) else [],
        }
    return out


def _build_export(
    sweep: SweepResult,
    selections: list[Selection],
    *,
    criterion: str | None,
    rule: str | None,
    analysis: str | None = None,
) -> TuningExport:
    """Assemble a :class:`TuningExport` from a sweep and its selections."""
    if not selections:
        raise ValueError("no selections to export")
    if sweep.pipeline_sha256 is None:
        raise ValueError(
            "this SweepResult predates pipeline hashes (saved by an older cabana); rerun the sweep"
        )
    if criterion is None:
        crits = {s.criterion for s in selections if s.criterion}
        criterion = crits.pop() if len(crits) == 1 else None
    meta: dict[str, Any] = {k: v for k, v in sweep.session_meta.items() if v is not None}
    meta["sweep_summary"] = _sweep_summary(sweep, selections, criterion, analysis)
    return TuningExport(
        session_hash=sweep.session_hash,
        pipeline_sha256=sweep.pipeline_sha256,
        chosen={s.path: s.value for s in selections},
        swept={p: _jsonable(list(v)) for p, v in sweep.over.items()},
        criterion=criterion,
        rule=rule,
        informed_by_significance=any(s.informed_by_significance for s in selections),
        selections=selections,
        metadata=meta,
    )


def apply_tuning(
    pipeline: Pipeline,
    export: TuningExport,
    *,
    session: Any = None,
    strict: bool = True,
) -> Pipeline:
    """Return ``pipeline`` with every ``chosen`` value written by ``set_param``.

    Each value carries a ``Selection`` (the export's, or a ``user_pick`` note when the
    export has none for that path) with ``informed_by_significance`` from the export.

    Parameters
    ----------
    pipeline : Pipeline
        Pipeline to tune; should be the one the export was made for.
    export : TuningExport
        Tuned values.
    session : Session, optional
        When given and ``export.session_hash`` is set and different, a
        ``UserWarning`` says the values came from another session.
    strict : bool, default True
        Raise ``ValueError`` when ``export.pipeline_sha256`` differs from the hash of
        ``pipeline``; ``False`` warns instead.

    Raises
    ------
    ValueError
        On a pipeline hash mismatch (``strict``).  A path that does not exist raises
        the ``set_param`` error unchanged.
    """
    from ._pipeline import _session_sha, _sha_json

    sha = _sha_json(pipeline.to_dict())
    if sha != export.pipeline_sha256:
        msg = (
            "the TuningExport was made for a different pipeline "
            f"(export {export.pipeline_sha256[:12]}..., this pipeline {sha[:12]}...); "
            "its values may not mean what they did when tuned"
        )
        if strict:
            raise ValueError(msg + "; pass strict=False to apply anyway")
        warnings.warn(msg, UserWarning, stacklevel=2)
    if session is not None and export.session_hash is not None:
        if _session_sha(session) != export.session_hash:
            warnings.warn(
                "the tuned values came from another session (activity hash differs)",
                UserWarning,
                stacklevel=2,
            )
    by_path = {s.path: s for s in export.selections}
    out = pipeline
    for path, value in export.chosen.items():
        sel = by_path.get(path)
        if sel is None:
            sel = Selection(
                path=path,
                value=value,
                method="user_pick",
                criterion=export.criterion,
                informed_by_significance=export.informed_by_significance,
                note=f"from TuningExport made {export.export_date}",
            )
        else:
            sel = sel.model_copy(
                update={
                    "value": value,
                    "informed_by_significance": export.informed_by_significance
                    or sel.informed_by_significance,
                }
            )
        out = out.set_param(path, value, selection=sel)
    return out


def tune(
    session: Any,
    pipeline: Pipeline,
    over: dict[str, list[Any]],
    *,
    criterion: str = "median_value",
    rule: str = "one_se",
    analysis: str | None = None,
    shuffle: bool = False,
    context: RunContext | None = None,
    n_jobs: int | None = None,
    allow_significance: bool = False,
    open_browser: bool = False,
    app_url: str | None = None,
    timeout: float | None = None,
) -> TuningExport:
    """Tune parameters over a sweep and return a :class:`TuningExport`.

    Modelled on ``calab.tune()``, which opens CaTune in the browser and returns the
    exported parameters.  Today this is the headless version: it runs
    :func:`cabana.sweep` and picks with :meth:`SweepResult.pick`.  The returned export
    has the format the future CaLab slider app will post back, so code written against
    it keeps working; apply it with :func:`apply_tuning` or ``Pipeline.apply_tuning``.

    Parameters
    ----------
    session, pipeline, over, shuffle, context, n_jobs
        As for :func:`cabana.sweep` (``shuffle=False`` by default: observed values only).
    criterion, rule, analysis, allow_significance
        As for :meth:`SweepResult.pick`.  A p-value or significance criterion is
        refused unless ``allow_significance=True``.
    open_browser, app_url, timeout
        Reserved for interactive tuning in CaLab; ``open_browser=True`` or ``app_url``
        raise ``NotImplementedError`` for now.

    Returns
    -------
    TuningExport
    """
    if open_browser or app_url is not None:
        raise NotImplementedError(
            "interactive tuning in CaLab is not available yet; the export format is the contract"
        )
    from ._sweep import sweep

    sw = sweep(session, pipeline, over, shuffle=shuffle, context=context, n_jobs=n_jobs)
    return sw.to_tuning_export(
        criterion=criterion, rule=rule, analysis=analysis, allow_significance=allow_significance
    )
