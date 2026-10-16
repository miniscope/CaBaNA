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
from typing import ClassVar, Literal

import numpy as np
from pydantic import Field
from sklearn.exceptions import ConvergenceWarning
from sklearn.linear_model import LogisticRegression
from sklearn.svm import LinearSVC

from .._models import StateSpace
from .._registry import Metric, register


def contiguous_folds(n: int, n_folds: int) -> np.ndarray:
    """Fold id (0..n_folds-1) for ``n`` time-ordered frames: equal-size contiguous blocks."""
    if n_folds < 2:
        raise ValueError("n_folds must be >= 2")
    return (np.arange(n) * n_folds) // max(n, 1)


@register("metric")
class DecodeStates(Metric):
    """Cross-validated linear decoding of behavioral state from population activity.

    Frames used: masked frames with at least one active state.  Folds are
    contiguous time blocks over those frames (see module docstring); the
    scaler (``zscore``) is fitted on the training fold only; class imbalance
    is handled by ``balance`` (``class_weight`` or ``subsample`` of the
    majority class in the training fold).

    ``mode="one_vs_rest"``: for each state, a binary decoder of state vs the
    other active frames; value is the balanced accuracy pooled over folds
    (chance 0.5).  Works for non-exclusive spaces.  A state is NaN when it or
    its complement has fewer than ``min_frames_per_class`` frames, or when some
    training fold lacks one of the two classes (the decoder is then undefined).

    ``mode="multiclass"`` (exclusive spaces only): one multi-class decoder; the
    value per state is its recall (diagonal of the row-normalised confusion
    matrix); the overall balanced accuracy is in ``accuracy_overall``.

    Extras: ``confusion`` ``(n_states, 2, 2)`` ``[true, predicted]`` with index
    1 = in state (one_vs_rest) or ``(n_states, n_states)`` (multiclass),
    ``accuracy_overall`` ``(1,)``, ``n_frames`` ``(n_states,)``, ``chance``
    ``(n_states,)``.  Fits that fail to converge raise ``RuntimeError``.
    """

    name: ClassVar[str] = "decode_states"
    level: ClassVar[Literal["cell", "population"]] = "population"
    default_tail: ClassVar[Literal["upper", "lower", "two"]] = "upper"

    classifier: Literal["linear_svm", "logistic"] = "linear_svm"
    n_folds: int = Field(5, ge=2)
    zscore: bool = True
    balance: Literal["class_weight", "subsample"] = "class_weight"
    min_frames_per_class: int = Field(20, ge=1)
    C: float = Field(1.0, gt=0)
    max_iter: int = Field(2000, ge=1)
    mode: Literal["one_vs_rest", "multiclass"] = "one_vs_rest"
    seed: int = 0

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

    def _run(self, activity: np.ndarray, states: StateSpace, mask: np.ndarray):
        mask = np.asarray(mask, dtype=bool)
        if self.mode == "multiclass" and not states.exclusive:
            raise ValueError("mode='multiclass' needs an exclusive StateSpace; use 'one_vs_rest'")
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
            return values, conf, overall, n_frames, chance

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
        return values, conf, overall, n_frames, chance

    def compute(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray, fs: float
    ) -> np.ndarray:
        return self._run(activity, states, mask)[0]

    def extras(
        self, activity: np.ndarray, states: StateSpace, mask: np.ndarray, fs: float
    ) -> dict[str, np.ndarray]:
        _, conf, overall, n_frames, chance = self._run(activity, states, mask)
        return {
            "confusion": conf,
            "accuracy_overall": np.array([overall]),
            "n_frames": n_frames,
            "chance": chance,
        }


__all__ = ["DecodeStates", "contiguous_folds"]
