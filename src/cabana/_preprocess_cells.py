"""Cell selection / QC preprocessing (needs ``Session.cell_meta``)."""

from __future__ import annotations

import warnings
from typing import Any, ClassVar

import numpy as np
from pydantic import Field

from ._models import Session
from ._registry import PreprocessStep, register


def _rising_edges(x: np.ndarray) -> np.ndarray:
    """Number of 0 -> 1 runs per row of a 0/1 array (a leading 1 counts)."""
    b = np.nan_to_num(x, nan=0.0) > 0
    return (b[:, 0].astype(int) if b.shape[1] else 0) + (b[:, 1:] & ~b[:, :-1]).sum(axis=1)


def _computed_stats(session: Session) -> dict[str, np.ndarray]:
    """Per-cell ``fraction_finite`` and, for event-like kinds, ``n_events`` and ``mean_rate_hz``.

    Event statistics use only frames that are finite and inside ``session.valid_mask()``;
    the duration is their count divided by ``fs``.  ``n_events`` is

    * ``binary``: the number of rising edges (runs of 1);
    * ``deconvolved``: the number of frames with activity above 0;
    * ``spike_counts``: the total count.

    ``mean_rate_hz = n_events / duration`` (NaN for a cell with no usable frame).  Trace
    kinds (``dff``, ``raw``, ``denoised``, ``zscored``) get neither; run ``detect_events``.
    """
    a = np.asarray(session.activity, dtype=float)
    fin = np.isfinite(a)
    out: dict[str, np.ndarray] = {"fraction_finite": fin.mean(axis=1)}
    kind = session.activity_kind
    if kind in ("binary", "deconvolved", "spike_counts"):
        use = fin & session.valid_mask()[None, :]
        z = np.where(use, a, 0.0)
        if kind == "binary":
            n_ev = _rising_edges(np.where(use, a, 0.0)).astype(float)
        elif kind == "deconvolved":
            n_ev = (z > 0).sum(axis=1).astype(float)
        else:
            n_ev = z.sum(axis=1)
        dur = use.sum(axis=1) / session.fs
        with np.errstate(invalid="ignore", divide="ignore"):
            rate = np.where(dur > 0, n_ev / dur, np.nan)
        out["n_events"] = n_ev
        out["mean_rate_hz"] = rate
    return out


def cell_qc_table(session: Session) -> Any:
    """``Session.cell_table()`` plus computed ``fraction_finite``, ``n_events``, ``mean_rate_hz``.

    Computed columns are added only where ``cell_meta`` lacks them (a stored column wins),
    and ``n_events`` / ``mean_rate_hz`` only for event-like kinds (see ``SelectCells``).
    Inspect this table to choose thresholds before calling ``select_cells``.
    """
    df = session.cell_table()
    for k, v in _computed_stats(session).items():
        if k not in df.columns:
            df[k] = v
    return df


@register("preprocess")
class SelectCells(PreprocessStep):
    """Keep the cells that pass every criterion (QC), via :meth:`Session.select_cells`.

    Criteria set to ``None`` are ignored.  A criterion whose column is not available
    (for example ``min_snr`` on a session without ``cell_meta["snr"]``) is **skipped with a
    ``UserWarning``**, never silently passed as satisfied.  Cells with a NaN value fail
    numeric criteria.  Cells are kept in session order.

    ``n_events`` / ``mean_rate_hz`` come from ``cell_meta`` if present, else are computed
    for event-like kinds over finite frames inside ``valid_mask()`` (definitions in
    :func:`cell_qc_table`).  The result's ``meta["cell_selection"]`` is
    ``{"n_before", "n_after", "source": <this step's dict>, "dropped_ids": [...]}``.
    """

    name: ClassVar[str] = "select_cells"

    min_snr: float | None = Field(None, description="Keep cells with cell_meta['snr'] >= this.")
    max_snr: float | None = Field(None, description="Keep cells with cell_meta['snr'] <= this.")
    min_pve: float | None = Field(None, description="Keep cells with cell_meta['pve'] >= this.")
    min_events: float | None = Field(None, description="Keep cells with n_events >= this.")
    min_rate_hz: float | None = Field(None, description="Keep cells with mean_rate_hz >= this.")
    max_rate_hz: float | None = Field(None, description="Keep cells with mean_rate_hz <= this.")
    require: list[str] | None = Field(
        None, description="Bool cell_meta columns that must be True (e.g. ['accepted'])."
    )
    ids: list[str] | None = Field(None, description="Keep only these cell ids.")
    exclude_ids: list[str] | None = Field(None, description="Drop these cell ids.")
    min_fraction_finite: float | None = Field(
        None, ge=0, le=1, description="Keep cells whose fraction of finite frames is >= this."
    )
    keep_at_least: int = Field(
        1,
        ge=0,
        description="Raise if fewer cells remain.",
        json_schema_extra={"ui": {"sweepable": False}},
    )

    def apply(self, session: Session) -> Session:
        n = session.n_cells
        keep = np.ones(n, dtype=bool)
        cols = {k: np.asarray(v) for k, v in session.cell_meta.items()}
        for k, v in _computed_stats(session).items():
            cols.setdefault(k, v)

        def column(name: str, crit: str) -> np.ndarray | None:
            if name not in cols:
                warnings.warn(
                    f"select_cells: {crit} skipped, no {name!r} column in cell_meta",
                    UserWarning,
                    stacklevel=3,
                )
                return None
            return cols[name].astype(float)

        for crit, col, lo, hi in (
            ("min_snr", "snr", self.min_snr, None),
            ("max_snr", "snr", None, self.max_snr),
            ("min_pve", "pve", self.min_pve, None),
            ("min_events", "n_events", self.min_events, None),
            ("min_rate_hz", "mean_rate_hz", self.min_rate_hz, None),
            ("max_rate_hz", "mean_rate_hz", None, self.max_rate_hz),
            ("min_fraction_finite", "fraction_finite", self.min_fraction_finite, None),
        ):
            if lo is None and hi is None:
                continue
            v = column(col, crit)
            if v is None:
                continue
            with np.errstate(invalid="ignore"):
                keep &= (v >= lo) if lo is not None else (v <= hi)
        for name in self.require or []:
            if column(name, f"require={name!r}") is None:
                continue
            keep &= cols[name].astype(bool) & ~np.isnan(cols[name].astype(float))
        cids = np.asarray(session.cell_ids)
        if self.ids is not None:
            unknown = sorted(set(self.ids) - set(cids.tolist()))
            if unknown:
                raise ValueError(f"select_cells: unknown ids {unknown[:5]}")
            keep &= np.isin(cids, self.ids)
        if self.exclude_ids is not None:
            unknown = sorted(set(self.exclude_ids) - set(cids.tolist()))
            if unknown:
                warnings.warn(
                    f"select_cells: exclude_ids not in session: {unknown[:5]}",
                    UserWarning,
                    stacklevel=2,
                )
            keep &= ~np.isin(cids, self.exclude_ids)
        if int(keep.sum()) < self.keep_at_least:
            raise ValueError(
                f"select_cells: {int(keep.sum())} of {n} cells pass, "
                f"fewer than keep_at_least={self.keep_at_least}"
            )
        out = session.select_cells(keep)
        sel = {
            **out.meta["cell_selection"],
            "source": self.to_dict(),
            "dropped_ids": [str(c) for c in cids[~keep]],
        }
        return out.replace(meta={**out.meta, "cell_selection": sel})
