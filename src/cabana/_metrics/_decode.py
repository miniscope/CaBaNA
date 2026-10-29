"""Cross-validated decoding of behavioral states from population activity.

Cross-validation folds are *contiguous blocks of time*, never random frames.
Neural activity and behavior are both autocorrelated, so a random split puts
near-identical neighbouring frames in train and test and inflates accuracy
(leakage).  Holding out whole blocks is the survey's "hold out whole bouts or
blocks of time".  See :func:`contiguous_folds`.

Pair with the ``label_shuffle`` null (block-permuted labels), which loops over
``compute``, so per-call cost matters.
"""

from __future__ import annotations

import warnings
from typing import ClassVar, Literal, NamedTuple

import numpy as np
from pydantic import Field
from sklearn.exceptions import ConvergenceWarning
from sklearn.linear_model import LogisticRegression
from sklearn.svm import LinearSVC

from .._models import StateSpace
from .._registry import Metric, register
from .._results import Tail
from ._ratemap import contiguous_folds


class _DecodeOut(NamedTuple):
    """Result of one ``DecodeStates`` cross-validation run."""

    values: np.ndarray  # (n_states,) balanced accuracy per state
    confusion: np.ndarray
    overall: float
    n_frames: np.ndarray
    chance: np.ndarray


@register("metric")
class DecodeStates(Metric):
    """Cross-validated linear decoding of behavioral state from population activity.

    Frames used: masked frames with at least one active state.  Folds are
    contiguous time blocks over those frames (see module docstring); the
    scaler (``zscore``) is fitted on the training fold only.

    Parameters
    ----------
    classifier : {"linear_svm", "logistic"}, default "linear_svm"
        ``sklearn`` ``LinearSVC`` or ``LogisticRegression``.
    n_folds : int, default 5
        Number of contiguous time-block cross-validation folds (>= 2).
    zscore : bool, default True
        Standardise each cell using the training fold's mean and s.d.
    balance : {"class_weight", "subsample"}, default "class_weight"
        Class imbalance handling: ``class_weight="balanced"``, or subsample every
        class in the training fold down to the smallest class (seeded by ``seed``).
    min_frames_per_class : int, default 20
        Minimum frames required of a class (and of its complement in
        ``one_vs_rest``) for a state to be decoded.
    C : float, default 1.0
        Inverse regularisation strength passed to the classifier (> 0).
    max_iter : int, default 2000
        Iteration cap for the classifier; a fit that fails to converge raises
        ``RuntimeError`` (raise ``max_iter`` or lower ``C``).
    mode : {"one_vs_rest", "multiclass"}, default "one_vs_rest"
        ``"one_vs_rest"``: for each state a binary decoder of state vs the other
        active frames; the value is the balanced accuracy pooled over folds
        (chance 0.5).  ``"multiclass"``: one multi-class decoder; the value per
        state is its recall (diagonal of the row-normalised confusion matrix).
    seed : int, default 0
        Seed of the random generator used by ``balance="subsample"``.

    Returns
    -------
    numpy.ndarray
        ``compute`` returns shape ``(n_states,)``: balanced accuracy per state
        (``one_vs_rest``) or recall per state (``multiclass``); higher is better.
        A state is NaN when it or its complement has fewer than
        ``min_frames_per_class`` frames, or when some training fold lacks one of
        the two classes (the decoder is then undefined).  In ``multiclass`` mode,
        states below ``min_frames_per_class`` are dropped and at least two valid
        states are needed (or a training fold lacks a class), otherwise everything is NaN.

    Notes
    -----
    **Tail.**  ``"upper"``: accuracy above the label-shuffle null is the effect.
    The default null to pair it with is ``label_shuffle`` (block-permuted labels).

    **State space.**  ``one_vs_rest`` works for exclusive and overlapping spaces
    (frames are used when at least one state is active).  ``multiclass`` requires
    an exclusive space (``ValueError`` otherwise).

    Extras (``extras``): ``confusion`` ``(n_states, 2, 2)`` ``[true, predicted]``
    with index 1 = in state (``one_vs_rest``) or ``(n_states, n_states)``
    ``[true, predicted]`` counts (``multiclass``; NaN outside valid states);
    ``accuracy_overall`` ``(1,)`` mean balanced accuracy over decodable states
    (``one_vs_rest``) or mean recall over valid states (``multiclass``);
    ``n_frames`` ``(n_states,)`` used frames per state; ``chance`` ``(n_states,)``
    chance level (0.5 for ``one_vs_rest``, ``1 / n_valid_states`` for
    ``multiclass``, NaN for dropped states).
    """

    name: ClassVar[str] = "decode_states"
    extras_axes: ClassVar[dict[str, tuple[str | None, ...]]] = {
        "confusion": ("state", None, None),
        "accuracy_overall": (None,),
        "n_frames": ("state",),
        "chance": ("state",),
    }
    level: ClassVar[Literal["cell", "population"]] = "population"
    default_tail: ClassVar[Tail] = "upper"
    default_plots: ClassVar[tuple[str, ...]] = ("metric_strip",)

    classifier: Literal["linear_svm", "logistic"] = Field(
        "linear_svm", description="Linear SVM (LinearSVC) or logistic regression."
    )
    n_folds: int = Field(5, ge=2, description="Number of contiguous time-block CV folds.")
    zscore: bool = Field(True, description="Standardise cells with training-fold mean/s.d.")
    balance: Literal["class_weight", "subsample"] = Field(
        "class_weight", description="Class balancing: balanced class weights or subsampling."
    )
    min_frames_per_class: int = Field(
        20, ge=1, description="Minimum frames of a class (and its complement) to decode a state."
    )
    C: float = Field(1.0, gt=0, description="Inverse regularisation strength of the classifier.")
    max_iter: int = Field(
        2000, ge=1, description="Classifier iteration cap; non-convergence raises."
    )
    mode: Literal["one_vs_rest", "multiclass"] = Field(
        "one_vs_rest", description="Binary per-state decoders, or one multi-class decoder."
    )
    seed: int = Field(0, description="RNG seed for balance='subsample'.")

    # ------------------------------------------------------------------ #
    def _fit_predict(
        self, xtr: np.ndarray, ytr: np.ndarray, xte: np.ndarray, rng: np.random.Generator
    ) -> np.ndarray:
        if self.zscore:
            mu = xtr.mean(axis=0)
            sd = xtr.std(axis=0)
            sd = np.where(sd > 1e-12, sd, 1.0)
            xtr, xte = (xtr - mu) / sd, (xte - mu) / sd
        weight: str | None = "balanced"
        if self.balance == "subsample":
            classes, counts = np.unique(ytr, return_counts=True)
            m = counts.min()
            keep = np.concatenate(
                [rng.choice(np.flatnonzero(ytr == c), size=m, replace=False) for c in classes]
            )
            keep.sort()
            xtr, ytr, weight = xtr[keep], ytr[keep], None
        if self.classifier == "linear_svm":
            clf = LinearSVC(C=self.C, max_iter=self.max_iter, class_weight=weight, dual="auto")
        else:
            clf = LogisticRegression(C=self.C, max_iter=self.max_iter, class_weight=weight)
        with warnings.catch_warnings():
            warnings.simplefilter("error", ConvergenceWarning)
            try:
                clf.fit(xtr, ytr)
            except ConvergenceWarning as e:
                raise RuntimeError(
                    f"{self.classifier} did not converge in {self.max_iter} iterations; "
                    "raise max_iter or lower C"
                ) from e
        return clf.predict(xte)

    def check_target(self, target: StateSpace) -> None:
        super().check_target(target)
        if self.mode == "multiclass" and not target.exclusive:
            raise ValueError(
                f"metric {self.name!r}: mode='multiclass' needs an exclusive StateSpace; "
                "use mode='one_vs_rest'"
            )

    def _cv_predict(self, x: np.ndarray, y: np.ndarray) -> np.ndarray | None:
        """Out-of-fold predictions; ``None`` if any training fold lacks a class of ``y``."""
        folds = contiguous_folds(x.shape[0], self.n_folds)
        rng = np.random.default_rng(self.seed)
        n_classes = np.unique(y).size
        pred = np.empty_like(y)
        for f in range(self.n_folds):
            te = folds == f
            tr = ~te
            if np.unique(y[tr]).size < n_classes:
                return None
            pred[te] = self._fit_predict(x[tr], y[tr], x[te], rng)
        return pred

    def _run(self, activity: np.ndarray, states: StateSpace, mask: np.ndarray) -> _DecodeOut:
        self.check_target(states)
        mask = np.asarray(mask, dtype=bool)
        onehot = states.onehot
        n_states = states.n_states
        use = mask & onehot.any(axis=1)
        idx = np.flatnonzero(use)
        x = np.asarray(activity, dtype=np.float64)[:, idx].T
        oh = onehot[idx]
        n_frames = oh.sum(axis=0).astype(np.int64)
        mc = self.min_frames_per_class

        if self.mode == "one_vs_rest":
            values = np.full(n_states, np.nan)
            conf = np.full((n_states, 2, 2), np.nan)
            chance = np.full(n_states, 0.5)
            for s in range(n_states):
                y = oh[:, s].astype(np.int64)
                if y.sum() < mc or (y.size - y.sum()) < mc:
                    continue
                pred = self._cv_predict(x, y)
                if pred is None:
                    continue
                c = np.zeros((2, 2))
                np.add.at(c, (y, pred), 1)
                conf[s] = c
                values[s] = np.mean(np.diag(c) / c.sum(axis=1))
            overall = np.nanmean(values) if np.isfinite(values).any() else np.nan
            return _DecodeOut(values, conf, overall, n_frames, chance)

        y_all = oh.argmax(axis=1)
        valid = n_frames >= mc
        keep = valid[y_all]
        values = np.full(n_states, np.nan)
        conf = np.full((n_states, n_states), np.nan)
        chance = np.full(n_states, np.nan)
        overall = np.nan
        if valid.sum() >= 2:
            xs, ys = x[keep], y_all[keep]
            pred = self._cv_predict(xs, ys)
            if pred is not None:
                c = np.zeros((n_states, n_states))
                np.add.at(c, (ys, pred), 1)
                ids = np.flatnonzero(valid)
                conf[np.ix_(ids, ids)] = c[np.ix_(ids, ids)]
                values[ids] = np.diag(c)[ids] / c[ids].sum(axis=1)
                overall = float(values[ids].mean())
                chance[ids] = 1.0 / ids.size
        return _DecodeOut(values, conf, overall, n_frames, chance)

    def compute(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray, fs: float
    ) -> np.ndarray:
        return self._run(activity, states, mask).values

    def extras(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray, fs: float
    ) -> dict[str, np.ndarray]:
        out = self._run(activity, states, mask)
        return {
            "confusion": out.confusion,
            "accuracy_overall": np.array([out.overall]),
            "n_frames": out.n_frames,
            "chance": out.chance,
        }


__all__ = ["DecodeStates", "contiguous_folds"]
