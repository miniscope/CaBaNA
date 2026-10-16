"""Design matrix for encoding models: states, standardized signals, temporal basis.

``design_matrix`` assembles the regressors a GLM needs into one
``(n_time, n_regressors)`` float array stored in ``session.signals[output]``.
The matching column names are stored in ``session.meta["design_columns"][output]``
(read them back with :func:`design_columns`) and are what
``glm_encoding(regressor_names=...)`` expects.

Column order and names (deterministic)::

    "{states}:{state}"            one column per state of each listed state space,
                                  in the order of ``states=`` then state order
    "{states}:{state}@{k}"        the same with ``basis``: ``n_basis`` columns per state
    "{signal}"                    one column per listed signal, in ``signals=`` order

State columns are 0/1 indicators (not standardized).  Signal columns are
standardized to zero mean and unit SD over the *finite frames of the whole
session* (not mask-aware); frames that are NaN are set to 0 (the column mean)
*after* standardizing, so a gap in tracking contributes no information instead
of removing the frame.  A constant signal becomes all zeros.

Temporal basis
--------------
With ``basis={"n_basis": n, "pre_s": a, "post_s": b}`` each state column is
convolved with ``n`` raised-cosine bumps (Pillow et al. 2008) whose centers
are spaced *linearly* over ``[-a, b]`` seconds and which overlap so that
neighbours sum to one in the interior.  Column ``k`` at frame ``t`` is
``sum_j basis[j, k] * x[t - lag_j]`` where ``lag_j`` runs from ``-round(a*fs)``
to ``+round(b*fs)`` frames; negative lags let the state at a *later* time
predict activity now (anticipatory responses).  An isolated one-frame onset
therefore reproduces the basis itself around the onset frame.
Signals are not expanded.

Reference state
---------------
A complete one-hot set of an *exclusive* state space sums to 1 in every
frame, so together with the GLM intercept it is perfectly collinear: the
intercept can absorb any state and every state's *unique* contribution comes
out ~0.  With ``reference="auto"`` (default) one column per exclusive state
space is therefore dropped: the state named ``rest`` if present, else the last
state.  The dropped state becomes the baseline absorbed by the intercept and is
recorded in ``session.meta["design_reference"][output] = {space: state}``.
Non-exclusive (bouts) spaces keep all columns: frames with no active behavior
play the role of the intercept.  ``drop_rest=True`` removes ``rest`` and that
counts as the reference.  ``reference="none"`` keeps every column (only sensible
with a penalised, non-unique-contribution analysis).

Because ``design_matrix`` is a transform it runs on the native clock, before
any ``rebin_time`` preprocess step; the rebin then averages the columns.  The
fitted kernel ``basis @ weights`` is a continuous function of lag, so it can
still be sampled at the coarser rate.
"""

from __future__ import annotations

from typing import Any, ClassVar, Literal

import numpy as np
from pydantic import Field

from ._models import Session
from ._registry import PreprocessStep, Transform, register


def raised_cosine_basis(
    n_basis: int, pre_s: float, post_s: float, fs: float
) -> tuple[np.ndarray, np.ndarray]:
    """Raised-cosine basis on integer-frame lags covering ``[-pre_s, post_s]``.

    Centers are linearly spaced from ``-pre_s`` to ``post_s``; each bump has
    half-width equal to the center spacing, so the bumps tile the window (edge
    bumps are truncated at the window ends).  With ``n_basis == 1`` a single bump
    spans the whole window.

    Parameters
    ----------
    n_basis : int
        Number of bumps (>= 1).
    pre_s : float
        Seconds before the event covered by the window (>= 0).
    post_s : float
        Seconds after the event covered by the window (>= 0; ``pre_s + post_s > 0``).
    fs : float
        Sampling rate in Hz, which sets the integer-frame lags.

    Returns
    -------
    basis : (n_lags, n_basis) float
        Bump values in [0, 1], one column per bump.
    lags_s : (n_lags,) float
        Lag of each row in seconds, ``-round(pre_s*fs)/fs`` to ``round(post_s*fs)/fs``;
        negative lags precede the event.

    Raises
    ------
    ValueError
        If ``n_basis < 1`` or the window is empty or has negative extent.
    """
    if n_basis < 1:
        raise ValueError("n_basis must be >= 1")
    if pre_s < 0 or post_s < 0 or pre_s + post_s <= 0:
        raise ValueError("pre_s and post_s must be >= 0 and not both zero")
    n_pre = int(round(pre_s * fs))
    n_post = int(round(post_s * fs))
    lags = np.arange(-n_pre, n_post + 1)
    lags_s = lags / fs
    lo, hi = -pre_s, post_s
    if n_basis == 1:
        centers = np.array([0.5 * (lo + hi)])
        width = 0.5 * (hi - lo)
    else:
        centers = np.linspace(lo, hi, n_basis)
        width = (hi - lo) / (n_basis - 1)
    arg = np.clip((lags_s[:, None] - centers[None, :]) * np.pi / width, -np.pi, np.pi)
    return 0.5 * (1.0 + np.cos(arg)), lags_s


def _convolve_lags(x: np.ndarray, basis: np.ndarray, n_pre: int) -> np.ndarray:
    """``out[t, k] = sum_j basis[j, k] * x[t - (j - n_pre)]`` (zero padded)."""
    n = x.shape[0]
    out = np.empty((n, basis.shape[1]))
    for k in range(basis.shape[1]):
        full = np.convolve(x, basis[:, k])  # full[m] = sum_j b[j] x[m - j]
        out[:, k] = full[n_pre : n_pre + n]
    return out


def design_columns(session: Session, output: str = "design") -> list[str]:
    """Column names of ``session.signals[output]`` as recorded by ``design_matrix``.

    Parameters
    ----------
    session : Session
        Session after a ``design_matrix`` transform / preprocess step.
    output : str, default "design"
        Name of the design signal (the step's ``output``).

    Returns
    -------
    list[str]
        One name per column, e.g. ``"social:sniff"``, ``"social:sniff@0"`` (with a
        basis) or a signal name; the order used by ``glm_encoding``.

    Raises
    ------
    KeyError
        If no design columns were recorded for ``output``.
    """
    try:
        return list(session.meta["design_columns"][output])
    except KeyError as e:
        raise KeyError(f"no design columns recorded for {output!r}") from e


@register("transform")
class DesignMatrix(Transform):
    """Build ``signals[output]`` = (n_time, n_regressors) for ``glm_encoding``."""

    name: ClassVar[str] = "design_matrix"

    states: list[str] = Field(
        default_factory=list, description="State-space names; one column per state."
    )
    signals: list[str] = Field(
        default_factory=list,
        description="Per-frame signals; standardized, NaN -> 0 after standardizing.",
    )
    basis: dict[str, Any] | None = Field(
        None,
        description="{'n_basis': int, 'pre_s': float, 'post_s': float}: raised-cosine "
        "expansion of each state column.",
    )
    drop_rest: bool = Field(False, description="Drop states named 'rest'.")
    reference: Literal["auto", "none"] = Field(
        "auto",
        description="'auto': drop one reference state (rest, else last) of each exclusive "
        "state space to avoid collinearity with the intercept; 'none': keep all.",
    )
    output: str = Field("design", description="Name of the signal written.")

    def apply(self, session: Session) -> Session:
        cols: list[np.ndarray] = []
        names: list[str] = []
        refs: dict[str, str] = {}
        bas = None
        n_pre = 0
        if self.basis is not None:
            missing = {"n_basis", "pre_s", "post_s"} - set(self.basis)
            if missing:
                raise ValueError(f"basis is missing keys {sorted(missing)}")
            bas, _ = raised_cosine_basis(
                int(self.basis["n_basis"]),
                float(self.basis["pre_s"]),
                float(self.basis["post_s"]),
                session.fs,
            )
            n_pre = int(round(float(self.basis["pre_s"]) * session.fs))
        for sname in self.states:
            if sname not in session.states:
                raise KeyError(f"no state space {sname!r}; available: {sorted(session.states)}")
            st = session.states[sname]
            ref: str | None = None
            if st.exclusive:
                if self.drop_rest and "rest" in st.state_names:
                    ref = "rest"
                elif self.reference == "auto":
                    ref = "rest" if "rest" in st.state_names else st.state_names[-1]
            if ref is not None:
                refs[sname] = ref
            for j, state in enumerate(st.state_names):
                if state == ref or (self.drop_rest and state == "rest"):
                    continue
                x = st.onehot[:, j].astype(np.float64)
                if bas is None:
                    cols.append(x[:, None])
                    names.append(f"{sname}:{state}")
                else:
                    cols.append(_convolve_lags(x, bas, n_pre))
                    names.extend(f"{sname}:{state}@{k}" for k in range(bas.shape[1]))
        for sig in self.signals:
            if sig not in session.signals:
                raise KeyError(f"no signal {sig!r}; available: {sorted(session.signals)}")
            v = np.asarray(session.signals[sig], dtype=np.float64)
            v = v.reshape(v.shape[0], -1)
            for c in range(v.shape[1]):
                col = v[:, c]
                ok = np.isfinite(col)
                z = np.zeros_like(col)
                if ok.sum() > 1:
                    sd = col[ok].std()
                    z[ok] = (col[ok] - col[ok].mean()) / sd if sd > 1e-12 else 0.0
                cols.append(z[:, None])
                names.append(sig if v.shape[1] == 1 else f"{sig}[{c}]")
        if not cols:
            raise ValueError("design_matrix needs at least one state space or signal")
        design = np.concatenate(cols, axis=1)
        prev = dict(session.meta.get("design_columns", {}))
        prev[self.output] = names
        meta = {**session.meta, "design_columns": prev}
        ref_info = dict(session.meta.get("design_reference", {}))
        ref_info[self.output] = refs
        meta["design_reference"] = ref_info
        if self.basis is not None:
            info = dict(session.meta.get("design_basis", {}))
            info[self.output] = {**self.basis, "fs": session.fs}
            meta["design_basis"] = info
        return session.with_signal(self.output, design).replace(meta=meta)


@register("preprocess")
class DesignMatrixStep(PreprocessStep):
    """``design_matrix`` as a preprocess step, for use *after* ``rebin_time``.

    Same parameters as :class:`DesignMatrix`.  Building the design on the
    re-binned clock keeps basis convolution and binning consistent.
    """

    name: ClassVar[str] = "design_matrix"

    states: list[str] = Field(
        default_factory=list, description="State-space names; one column per state."
    )
    signals: list[str] = Field(
        default_factory=list,
        description="Per-frame signals; standardized, NaN -> 0 after standardizing.",
    )
    basis: dict[str, Any] | None = Field(
        None,
        description="{'n_basis': int, 'pre_s': float, 'post_s': float}: raised-cosine "
        "expansion of each state column.",
    )
    drop_rest: bool = Field(False, description="Drop states named 'rest'.")
    reference: Literal["auto", "none"] = Field(
        "auto",
        description="'auto': drop one reference state (rest, else last) of each exclusive "
        "state space to avoid collinearity with the intercept; 'none': keep all.",
    )
    output: str = Field("design", description="Name of the signal written.")

    def apply(self, session: Session) -> Session:
        return DesignMatrix(**self.model_dump()).apply(session)


__all__ = ["DesignMatrix", "DesignMatrixStep", "design_columns", "raised_cosine_basis"]
