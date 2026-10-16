"""Cross-validated naive-Bayes decoding of behavioral state from population activity.

The default (``likelihood="gaussian"``) reproduces the Bayesian position decoder
of Shuman, Aharoni, Cai et al. 2020, *Nature Neuroscience* 23:229-238,
"Breakdown of spatial coding and interneuron synchronization in epileptic
mice", doi 10.1038/s41593-019-0559-0:

* deconvolved activity is binarized (zero stays zero, anything else is 1);
* training builds per-"trial" (here: contiguous block) binarized occupancy-
  normalised maps, smoothed with a Gaussian kernel; for every neuron and state
  the mean ``mu`` and s.d. ``sigma`` over blocks are kept, and any ``sigma``
  below the neuron's mean per-state s.d. is raised to that mean;
* at test time ``S_i(t)`` is the mean binarized activity of cell ``i`` in a
  window centred on ``t`` and the likelihood is ``N(S_i(t); mu_i(x), sigma_i(x))``;
* the decoded state is ``argmax_x occ(x) * prod_i p_i(x, t) / max_x p_i(x, t)``.
  Dividing by ``max_x p_i`` is a constant per (cell, frame), so the argmax is
  unchanged and the decoder works in log space without it.

``likelihood="poisson"`` is the independent-Poisson decoder of Zhang, Ginzburg,
McNaughton & Sejnowski 1998 (*J Neurophysiol*), and ``likelihood="empirical"``
uses the discretised ``P(level | state)`` tables of :mod:`._discretize`.

Folds are contiguous blocks of time (see :func:`.contiguous_folds`); every used
frame is decoded by a model that never saw it.  Pair with the ``label_shuffle``
null, which loops over ``compute``; all likelihoods reduce to a few matrix
products per fold so a call on 200 cells x 24000 frames x 400 states is cheap.
"""

from __future__ import annotations

import warnings
from typing import ClassVar, Literal

import numpy as np
from pydantic import Field
from scipy.ndimage import gaussian_filter, uniform_filter1d
from scipy.special import logsumexp

from .._models import StateSpace
from .._registry import Metric, register
from ._decode import contiguous_folds
from ._discretize import activity_levels, joint_counts, level_edges
from ._ratemap import rate_maps_from_sums

_EPS = 1e-12


@register("metric")
class BayesianDecoder(Metric):
    """Cross-validated naive-Bayes decoding of an exclusive state space.

    Frames used: masked frames with an active state, restricted to states with
    at least ``min_frames_per_class`` masked frames.  Folds are contiguous time
    blocks over those frames.

    ``compute`` returns ``(n_states,)``: with a grid topology the per-state
    median decoding error (distance between decoded and true bin centres, in
    the grid's physical units; smaller is better); otherwise the per-state
    recall.  NaN for dropped states.

    ``sigma`` (gaussian only) chooses the likelihood width.  ``"per_state"`` is
    Shuman 2020: each (cell, state) has its own s.d. across training blocks,
    raised to the cell's mean s.d.; use it when states have similar occupancy
    (e.g. spatial bins).  ``"pooled"`` shares one s.d. per cell, the
    block-count-weighted RMS of the per-state block s.d.s (within-state
    variance, as in LDA); use it, or ``likelihood="poisson"``, for unbalanced
    categorical states.  With per-state sigma, rare states have few
    contributing blocks and noisy block means, hence a large sigma and a flat
    Gaussian, so whenever a cell is active the flattest (rarest) state wins and
    the decoder collapses onto a few states.

    ``window_s`` is the total width of the centred boxcar applied to the test
    activity (``0`` disables it; otherwise the width is rounded to an odd number
    of frames and the mean runs over used frames only, never masked ones); it
    is ignored for ``likelihood="empirical"``,
    which scores each frame's discretised level on its own (a windowed mean is
    not one of the levels).  ``smooth_sigma_bins`` smooths the training maps
    (grid only): rate maps for gaussian/poisson, and for empirical the joint
    (state, level) counts per level and the occupancy prior, edge-normalised,
    before the pseudocount is added.  ``n_levels``,
    ``binning`` and ``pseudocount`` apply to the empirical likelihood only.
    Smoothed counts sit on a per-bin scale (a few positive frames per bin and
    level on sparse data), so the Dirichlet ``pseudocount`` defaults to 0.1; a
    pseudocount of 1 swamps them and pushes the decoder toward the prior.

    Extras: ``confusion`` ``(n_states, n_states)`` counts ``[true, decoded]``
    (NaN rows for dropped states), ``decoded`` ``(n_time,)`` state index or -1,
    ``error`` ``(n_time,)`` per-frame error (NaN if not decoded / no
    topology), ``error_overall`` ``(1,)`` median error, ``accuracy_overall``
    ``(1,)``, ``chance_error`` ``(1,)`` median error of always guessing the
    training-prior's most likely state, ``n_frames`` ``(n_states,)`` and
    ``posterior_mean_confidence`` ``(1,)`` mean max posterior.
    """

    name: ClassVar[str] = "bayesian_decoder"
    level: ClassVar[Literal["cell", "population"]] = "population"
    default_tail: ClassVar[Literal["upper", "lower", "two"]] = "lower"

    likelihood: Literal["gaussian", "poisson", "empirical"] = "gaussian"
    binarize: bool = True
    window_s: float = Field(0.25, ge=0, description="Total width of the test-time boxcar (s).")
    smooth_sigma_bins: float = Field(0.0, ge=0, description="Gaussian map smoothing (grid only).")
    n_folds: int = Field(4, ge=2)
    n_trial_blocks: int = Field(10, ge=1, description="Training blocks standing in for trials.")
    sigma: Literal["per_state", "pooled"] = "per_state"
    prior: Literal["occupancy", "uniform"] = "occupancy"
    min_frames_per_class: int = Field(20, ge=1)
    n_levels: int = Field(5, ge=2)
    binning: Literal["quantile", "log", "linear", "binary"] = "quantile"
    pseudocount: float = Field(0.1, gt=0)
    seed: int = 0

    def resolve_tail(self, target):
        return "lower" if getattr(target, "topology", None) is not None else "upper"

    # ------------------------------------------------------------------ #
    # training / scoring of one fold
    # ------------------------------------------------------------------ #
    def _maps(self, x, oh, topology):
        """Smoothed per-frame mean maps ``(n_cells, n_states)`` and the training occupancy."""
        occ = oh.sum(axis=0)
        rate, _ = rate_maps_from_sums(x @ oh, occ, 1.0, 0.0, topology, self.smooth_sigma_bins)
        return rate, occ

    def _loglik_gaussian(self, xtr, oh_tr, s_te, topology):
        n_tr = xtr.shape[1]
        blocks = (np.arange(n_tr) * min(self.n_trial_blocks, n_tr)) // n_tr
        rates = np.stack(
            [
                self._maps(xtr[:, blocks == b], oh_tr[blocks == b], topology)[0]
                for b in range(blocks.max() + 1)
            ]
        )  # (B, cells, states), NaN where a block never visited the state
        ok = np.isfinite(rates)
        count = ok.sum(axis=0)
        with np.errstate(invalid="ignore"), warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)  # states no block visited
            mu = np.nanmean(rates, axis=0)
            sd = np.nanstd(rates, axis=0)
        has2 = count >= 2
        n2 = has2.sum(axis=1)
        mean_sd = np.where(n2 > 0, np.where(has2, sd, 0.0).sum(axis=1) / np.maximum(n2, 1), 0.0)
        mu = np.nan_to_num(mu)
        floor = np.maximum(mean_sd, np.maximum(1e-3 * np.abs(mu).max(axis=1), 1e-9))[:, None]
        if self.sigma == "pooled":
            # one sigma per cell: within-state variance across blocks, pooled over states
            # (weighted by the number of contributing blocks)
            wts = np.where(has2, count, 0.0)
            var = (wts * np.nan_to_num(sd) ** 2).sum(axis=1) / np.maximum(wts.sum(axis=1), 1)
            tiny = np.maximum(1e-3 * np.abs(mu).max(axis=1), 1e-9)[:, None]
            sigma = np.broadcast_to(np.maximum(np.sqrt(var)[:, None], tiny), mu.shape)
        else:
            sigma = np.where(has2, np.maximum(np.nan_to_num(sd), floor), floor)
        a = 1.0 / (2.0 * sigma**2)
        # -(S-mu)^2 a - log(sigma) summed over cells, as three matrix products
        const = -(mu**2 * a + np.log(sigma)).sum(axis=0)
        return s_te @ (2.0 * a * mu) - (s_te**2) @ a + const

    def _loglik_poisson(self, xtr, oh_tr, k_te, n_te, topology):
        """Poisson log-likelihood up to a per-frame constant.

        ``k_te`` ``(n_test, n_cells)`` is the activity summed over the used frames of each
        test window and ``n_te`` ``(n_test,)`` their number, so ``lambda = mu * n``.
        """
        mu, _ = self._maps(xtr, oh_tr, topology)
        mu = np.nan_to_num(mu)
        mu = mu + 1e-4 * max(float(mu.mean()), 1e-6)
        return k_te @ np.log(mu) - n_te[:, None] * mu.sum(axis=0)[None, :]

    def _smooth_states(self, a, topology):
        """Edge-normalised Gaussian smoothing of ``(..., n_states)`` over the grid.

        Mirrors ``rate_maps_from_sums``: values and the occupied-state indicator are
        smoothed with ``mode="constant"`` and the former divided by the latter.  The
        occupied indicator is ``a`` summed over leading axes > 0.  No-op without
        smoothing.
        """
        if self.smooth_sigma_bins <= 0 or topology is None:
            return a
        shape = tuple(topology.shape)
        sig = (0.0,) * (a.ndim - 1) + (float(self.smooth_sigma_bins),) * len(shape)
        sig_v = (float(self.smooth_sigma_bins),) * len(shape)
        occupied = (a.reshape(-1, a.shape[-1]).sum(axis=0) > 0).astype(np.float64)
        norm = gaussian_filter(occupied.reshape(shape), sigma=sig_v, mode="constant")
        norm = norm.reshape(-1)
        out = gaussian_filter(a.reshape(*a.shape[:-1], *shape), sigma=sig, mode="constant")
        out = out.reshape(a.shape)
        with np.errstate(divide="ignore", invalid="ignore"):
            out = np.where(norm > 0, out / norm, 0.0)
        return out

    def _fit_empirical(self, activity, states, train_full):
        """Level edges and ``log P(level | state)`` ``(cells, states, L)``, from training frames only."""
        edges = level_edges(activity, train_full, self.n_levels, self.binning)
        n_lev = edges.shape[1] - 1
        counts = joint_counts(activity_levels(activity, edges), states.masked(train_full), n_lev)
        counts = self._smooth_states(counts.transpose(0, 2, 1), states.topology)
        p = counts.transpose(0, 2, 1) + self.pseudocount
        return edges, np.log(np.maximum(p / p.sum(axis=2, keepdims=True), _EPS))

    def _loglik_empirical(self, activity, states, train_full, idx_te):
        edges, logp = self._fit_empirical(activity, states, train_full)
        lev_te = activity_levels(activity[:, idx_te], edges)
        ll = 0.0
        for k in range(logp.shape[2]):
            ll = ll + (lev_te == k).T.astype(np.float64) @ logp[:, :, k]
        return ll

    # ------------------------------------------------------------------ #
    def _run(self, activity, states: StateSpace, mask, fs):
        if not states.exclusive:
            raise ValueError("bayesian_decoder needs an exclusive StateSpace")
        topology = states.topology
        if self.smooth_sigma_bins > 0 and topology is None:
            raise ValueError("smooth_sigma_bins > 0 requires a state space with a GridTopology")
        mask = np.asarray(mask, dtype=bool)
        act = np.asarray(activity, dtype=np.float64)
        n_time, n_states = states.n_time, states.n_states
        lab = states.labels()
        used = mask & (lab >= 0)
        n_frames = np.bincount(lab[used], minlength=n_states).astype(np.int64)
        valid = n_frames >= self.min_frames_per_class
        used &= valid[np.maximum(lab, 0)]
        idx = np.flatnonzero(used)
        y = lab[idx]

        decoded = np.full(n_time, -1, dtype=np.int64)
        conf_post = np.full(n_time, np.nan)
        guess = np.full(n_time, -1, dtype=np.int64)
        if valid.sum() >= 2 and idx.size >= self.n_folds:
            clean = np.nan_to_num(act)
            xb = (clean > 0).astype(np.float64) if self.binarize else clean
            # odd window so it is centred; averages over *used* frames only, so masked,
            # unlabelled and dropped-state frames never leak into a test frame's features
            w = 1 if self.window_s <= 0 else 2 * int(round(self.window_s * fs / 2)) + 1
            usedf = used.astype(np.float64)
            if w > 1:
                m_num = uniform_filter1d(xb * usedf, size=w, axis=1, mode="constant")
                m_den = uniform_filter1d(usedf, size=w, mode="constant")
            else:
                m_num, m_den = xb * usedf, usedf
            with np.errstate(invalid="ignore", divide="ignore"):
                xs = np.where(m_den > 0, m_num / m_den, 0.0)
            x_all, s_all = xb[:, idx], xs[:, idx]
            k_all, n_all = m_num[:, idx] * w, m_den[idx] * w
            oh_all = np.zeros((idx.size, n_states))
            oh_all[np.arange(idx.size), y] = 1.0
            folds = contiguous_folds(idx.size, self.n_folds)
            for f in range(self.n_folds):
                te, tr = folds == f, folds != f
                oh_tr = oh_all[tr]
                occ = oh_tr.sum(axis=0)
                cand = occ > 0
                if not cand.any():
                    continue
                s_te = s_all[:, te].T
                if self.likelihood == "gaussian":
                    ll = self._loglik_gaussian(x_all[:, tr], oh_tr, s_te, topology)
                elif self.likelihood == "poisson":
                    ll = self._loglik_poisson(
                        x_all[:, tr], oh_tr, k_all[:, te].T, n_all[te], topology
                    )
                else:
                    train_full = np.zeros(n_time, dtype=bool)
                    train_full[idx[tr]] = True
                    ll = self._loglik_empirical(act, states, train_full, idx[te])
                logprior = np.zeros(n_states)
                if self.prior == "occupancy":
                    pocc = occ
                    if self.likelihood == "empirical":  # smoothed prior, as the likelihood
                        pocc = np.where(cand, self._smooth_states(occ, topology), 0.0)
                        pocc = np.where(cand & (pocc <= 0), occ, pocc)
                    logprior[cand] = np.log(pocc[cand] / pocc[cand].sum())
                lp = ll + logprior
                lp[:, ~cand] = -np.inf
                best = lp.argmax(axis=1)
                decoded[idx[te]] = best
                conf_post[idx[te]] = np.exp(lp.max(axis=1) - logsumexp(lp, axis=1))
                guess[idx[te]] = int(np.argmax(occ))

        dec = decoded >= 0
        conf = np.full((n_states, n_states), np.nan)
        ids = np.flatnonzero(valid)
        c = np.zeros((n_states, n_states))
        np.add.at(c, (lab[dec], decoded[dec]), 1)
        conf[np.ix_(ids, ids)] = c[np.ix_(ids, ids)]

        error = np.full(n_time, np.nan)
        err_guess = np.full(n_time, np.nan)
        values = np.full(n_states, np.nan)
        if topology is not None:
            cen = topology.centers()
            grid = np.stack(np.unravel_index(np.arange(n_states), topology.shape), axis=1)
            coords = np.stack([cen[a][grid[:, a]] for a in range(len(cen))], axis=1)
            error[dec] = np.linalg.norm(coords[decoded[dec]] - coords[lab[dec]], axis=1)
            err_guess[dec] = np.linalg.norm(coords[guess[dec]] - coords[lab[dec]], axis=1)
            order = np.argsort(lab[dec], kind="stable")
            tl, te_ = lab[dec][order], error[dec][order]
            for s, grp in zip(*_group(tl, te_), strict=True):
                values[s] = np.median(grp)
        else:
            with np.errstate(invalid="ignore", divide="ignore"):
                values[ids] = np.diag(c)[ids] / c[ids].sum(axis=1)
            values[ids] = np.where(c[ids].sum(axis=1) > 0, values[ids], np.nan)
        return values, conf, decoded, error, err_guess, conf_post, n_frames, lab

    def compute(self, activity, states, mask, fs):
        return self._run(activity, states, mask, fs)[0]

    def extras(self, activity, states, mask, fs):
        values, conf, decoded, error, err_guess, conf_post, n_frames, lab = self._run(
            activity, states, mask, fs
        )
        dec = decoded >= 0
        with np.errstate(all="ignore"):
            acc = float(np.mean(decoded[dec] == lab[dec])) if dec.any() else np.nan
            overall = float(np.nanmedian(error[dec])) if dec.any() and states.topology else np.nan
            chance = (
                float(np.nanmedian(err_guess[dec])) if dec.any() and states.topology else np.nan
            )
            pm = float(np.mean(conf_post[dec])) if dec.any() else np.nan
        return {
            "confusion": conf,
            "decoded": decoded,
            "error": error,
            "error_overall": np.array([overall]),
            "accuracy_overall": np.array([acc]),
            "chance_error": np.array([chance]),
            "n_frames": n_frames,
            "posterior_mean_confidence": np.array([pm]),
        }


def _group(sorted_labels: np.ndarray, vals: np.ndarray):
    """Split ``vals`` by runs of equal ``sorted_labels``; returns (labels, groups)."""
    if sorted_labels.size == 0:
        return [], []
    cut = np.flatnonzero(np.diff(sorted_labels)) + 1
    return sorted_labels[np.r_[0, cut]].tolist(), np.split(vals, cut)


__all__ = ["BayesianDecoder"]
