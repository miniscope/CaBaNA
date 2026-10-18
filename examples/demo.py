"""End-to-end CaBaNA demo on a simulated session with planted ground truth.

One pipeline runs the *same* metric code and the *same* circular-shift engine on
a 2D spatial grid, on scored social bouts, and on behavioral syllables.  The
second increment adds, on the same session: PETHs, mean activity per state,
speed correlation, a population pipeline on re-binned data (PCA, decoding, GLM),
a comparison of null distributions, overlap and clustering of response classes,
and a small cohort / cross-session check.

The third increment treats activity amplitude as a dimension: mutual information
between state and discretised activity (with a levels-versus-on/off comparison and
a sweep over the number of levels and recording duration), and a naive-Bayes
population decoder (Gaussian and Poisson likelihoods) on position and on social
behaviors, each against a label-shuffle null.

    python examples/demo.py            # full run (1000 shuffles; roughly 5 minutes)
    python examples/demo.py --quick    # about 40 s

The fifth increment adds multiple-comparison correction (the cell x state analyses use
``correction="max_stat"``; the recovery table reports the false-positive rate of untuned cells
raw and adjusted), cell classification with the criteria layer (figure 27), and run control
(the main pipeline reports progress through a ``RunContext`` callback).

The parameter-selection increment replaces the hard-coded smoothing and null timescale with
selectors (``auto_smooth_sigma``, ``auto_null_timescale``) that record how each value was
chosen (``selections.json``), shows the held-out score curve and a sweep over sigma with and
without the shuffle test (figures 28 and 29), and runs the number-of-levels comparison through
``cabana.sweep``.

The Phase E section (end of the run) adds the nulls and metrics of roadmap phase E: a speed-matched
null on ``auroc[social]`` (acceptance rate and balance printed, significant counts compared
with the plain circular shift), place fields, tuning selectivity, noise correlations and the
participation ratio under ``cell_shift``, decoding of ``x``, a PETH null band with latency
sorting, and the ``z`` column (figures 34 to 38).

Outputs in --out: results.csv, results.zip and session.zip (reload with
`cabana.ResultSet.load` / `cabana.Session.load`), nulls_compared.csv, levels_sweep.csv,
selections.json, provenance files and figures 01 to 29 (20 to 26 are the amplitude / decoding
figures, 27 the classification, 28a/28b the smoothing choice, 29 the smoothing stability), and the evidence-first views (all/, cards/, 30 to 33,
rate_maps_data.json), and 34 to 38 for Phase E (place fields, pairwise matrix, participation
ratio, signal decoding, PETH sorted by latency).
"""

from __future__ import annotations

import argparse
import json
import textwrap
import time
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

import cabana  # noqa: E402
from cabana import grid_bin_size, heldout_smoothing_scores  # noqa: E402
from cabana import (  # noqa: E402
    AnalysisSpec,
    CellMatch,
    Criteria,
    Pipeline,
    ProgressEvent,
    RunContext,
    ShuffleConfig,
    classify,
    cohort_table,
    cross_session_map_correlation,
    describe,
    fraction_significant_by_animal,
    overlap_vs_chance,
    place_cell_criteria,
    remapping_summary,
    responsive_cell_criteria,
    response_clusters,
    response_features,
    simulate_session,
)


def progress_printer(label: str, step: float = 0.1):
    """A ``RunContext.on_progress`` callback that prints one line each time ``step`` is crossed."""
    nxt = [step]

    def on_progress(ev: ProgressEvent) -> None:
        if ev.fraction + 1e-9 >= nxt[0] or ev.stage == "done":
            print(
                f"  [{label}] {ev.fraction:4.0%}  {ev.stage}: {ev.name}  ({ev.elapsed_s:.1f} s)",
                flush=True,
            )
            while nxt[0] <= ev.fraction + 1e-9:
                nxt[0] += step

    return on_progress


def describe_ground_truth(session) -> str:
    gt = session.meta["ground_truth"]
    sim = session.meta["simulation"]
    social = gt["social_cells"]
    n_exc = sum(d["sign"] == "excited" for d in social)
    behaviors = sorted({d["behavior"] for d in social})
    return (
        f"Simulated {sim['n_cells']} cells for {sim['duration_s']:.0f} s at {sim['fs']:g} Hz. "
        f"Planted: {len(gt['place_cells'])} place cells (2D Gaussian fields, active only while "
        f"moving above {gt['speed_gate_mm_s']:g} mm/s), {len(social)} social cells tied to "
        f"{', '.join(behaviors)} ({n_exc} excited, {len(social) - n_exc} inhibited), "
        f"{len(gt['syllable_cells'])} syllable cells (x3 in one syllable), and "
        f"{len(gt['untuned_cells'])} untuned cells that fire at baseline only."
    )


# Candidate smoothing widths (grid bins; 1 bin = 20 mm here), simplest first.
SIGMA_CANDIDATES = [0, 0.5, 1, 1.5, 2, 3, 4]


def build_pipeline(n_shuffles: int) -> Pipeline:
    shuf = ShuffleConfig(n_shuffles=n_shuffles, min_shift_s=20.0, seed=0)
    # cell x state analyses: "significant in any state" is corrected across a cell's states
    # (single-step max-statistic from the null draws; costs almost nothing)
    shuf_c = shuf.model_copy(update={"correction": "max_stat"})
    return Pipeline(
        # parameter selectors run once before the analyses and record a Selection per value:
        # smoothing from a held-out score on the position analyses, and the null timescale
        # (min_shift_s) from the autocorrelation of activity and behavior.  Neither sees a p-value.
        selectors=[
            {
                "name": "auto_smooth_sigma",
                "states": "position",
                "candidates_bins": SIGMA_CANDIDATES,
            },
            {"name": "auto_null_timescale"},
        ],
        transforms=[
            {"name": "resample_signal", "source": "position"},
            {"name": "speed"},
            # fixed arena extent so grids are identical across sessions (needed for cross-session maps)
            {
                "name": "bin_grid",
                "signals": ["x", "y"],
                "bin_size": 20.0,
                "output": "position",
                "extent": [(0.0, 400.0), (0.0, 400.0)],
            },
            {"name": "bouts_to_states", "source": "social", "output": "social"},
            {"name": "labels_to_states", "source": "syllables", "output": "syllables"},
            # one behavior per frame (plus 'rest'), as the Bayesian decoder requires
            {
                "name": "bouts_to_states",
                "source": "social",
                "output": "social_exclusive",
                "exclusive": True,
                "add_rest": True,
            },
        ],
        preprocess=[{"name": "speed_threshold", "min_speed": 20.0}],
        analyses=[
            AnalysisSpec(
                metric={"name": "information_content"},  # sigma: auto_smooth_sigma
                states="position",
                shuffle=shuf,
                masks=["speed"],
            ),
            AnalysisSpec(
                metric={"name": "split_half_stability"},  # sigma: auto_smooth_sigma
                states="position",
                shuffle=shuf,
                masks=["speed"],
            ),
            AnalysisSpec(
                metric={"name": "pv_stability"}, states="position", shuffle=shuf, masks=["speed"]
            ),
            # amplitude as a dimension: 5 quantile levels of activity in every grid bin
            AnalysisSpec(
                metric={"name": "mutual_information"},
                states="position",
                shuffle=shuf,
                masks=["speed"],
            ),
            # the same metric and target with two levels (on/off): a name keeps both results
            AnalysisSpec(
                name="mutual_information_binary[position]",
                metric={"name": "mutual_information", "binning": "binary"},
                states="position",
                shuffle=shuf,
                masks=["speed"],
            ),
            # No speed mask: huddling is stationary. The scored span is the space's own support.
            AnalysisSpec(metric={"name": "auroc"}, states="social", shuffle=shuf_c),
            AnalysisSpec(
                metric={"name": "population_vector_overlap"},
                states="social",
                shuffle=None,
            ),
            # 'still' is a syllable we want to keep, so no speed mask (support = labelled span).
            AnalysisSpec(metric={"name": "information_content"}, states="syllables", shuffle=shuf),
            AnalysisSpec(metric={"name": "auroc"}, states="syllables", shuffle=shuf_c),
            AnalysisSpec(metric={"name": "mutual_information"}, states="syllables", shuffle=shuf_c),
            # --- second increment: more analyses on the SAME states and masks ---
            # mean activity in each behavior minus out-of-behavior (0 = no preference)
            AnalysisSpec(
                metric={"name": "mean_per_state", "statistic": "difference"},
                states="social",
                shuffle=shuf_c,
            ),
            # peri-event time histogram around bout onsets (bouts >= 1.5 s, >= 1 s apart)
            AnalysisSpec(
                metric={
                    "name": "peth",
                    "pre_s": 4.0,
                    "post_s": 4.0,
                    "baseline_s": (-4.0, -1.0),
                    "response_s": (0.0, 1.5),
                    "min_duration_s": 1.5,
                    "min_gap_s": 1.0,
                },
                states="social",
                shuffle=shuf_c,
            ),
            # a continuous target instead of a state space: speed (+/- 2 s cross-correlation)
            AnalysisSpec(
                metric={"name": "signal_correlation", "max_lag_s": 2.0},
                signal="speed",
                shuffle=shuf,
            ),
        ],
    )


def build_population_pipeline(n_pca: int, n_decode: int) -> Pipeline:
    """Second pipeline: re-bin to 0.5 s, build a design matrix, run population analyses."""
    null = {"name": "label_shuffle", "block_s": 5.0}
    return Pipeline(
        preprocess=[
            {"name": "rebin_time", "bin_s": 0.5},
            {
                "name": "design_matrix",
                "states": ["social"],
                "signals": ["speed"],
                "basis": {"n_basis": 4, "pre_s": 1.0, "post_s": 3.0},
            },
        ],
        analyses=[
            AnalysisSpec(
                metric={"name": "pca_population"},
                states="social",
                shuffle=ShuffleConfig(n_shuffles=n_pca, null=null, seed=0),
            ),
            AnalysisSpec(
                metric={"name": "decode_states"},
                states="social",
                shuffle=ShuffleConfig(n_shuffles=n_decode, null=null, seed=0),
            ),
            AnalysisSpec(
                metric={"name": "glm_encoding"},
                signal="design",
                shuffle=None,
            ),
        ],
    )


# Position decoders score a 1 s window of activity, not Shuman et al.'s 0.25 s. On an open field
# there are 400 bins (20 mm over a 400 mm arena) and only about 47 moving frames per bin, so
# with 0.25 s windows an occasional sparsely visited corner bin wins the posterior and about
# 10% of frames are decoded more than 250 mm off; 1 s windows cut that to about 4%.
POSITION_WINDOW_S = 1.0


def build_decoder_pipeline(n_shuffles: int) -> Pipeline:
    """Naive-Bayes decoders on the full-rate session, each against a label_shuffle null."""
    null = {"name": "label_shuffle", "block_s": 5.0}
    shuf = ShuffleConfig(n_shuffles=n_shuffles, null=null, seed=0)
    return Pipeline(
        analyses=[
            AnalysisSpec(
                metric={
                    "name": "bayesian_decoder",
                    "likelihood": "gaussian",
                    "sigma": "per_state",
                    "smooth_sigma_bins": 1.0,
                    "window_s": POSITION_WINDOW_S,
                },
                states="position",
                shuffle=shuf,
                masks=["speed"],
            ),
            AnalysisSpec(
                metric={
                    "name": "bayesian_decoder",
                    "likelihood": "gaussian",
                    "sigma": "pooled",
                    "smooth_sigma_bins": 1.0,
                    "window_s": POSITION_WINDOW_S,
                },
                states="position",
                shuffle=shuf,
                masks=["speed"],
            ),
            AnalysisSpec(
                metric={
                    "name": "bayesian_decoder",
                    "likelihood": "poisson",
                    "smooth_sigma_bins": 1.0,
                    "window_s": POSITION_WINDOW_S,
                },
                states="position",
                shuffle=shuf,
                masks=["speed"],
            ),
            # empirical likelihood tables (defaults: pseudocount 0.1), no null: reported vs chance only
            AnalysisSpec(
                metric={
                    "name": "bayesian_decoder",
                    "likelihood": "empirical",
                    "binning": "binary",
                    "smooth_sigma_bins": 1.0,
                    "window_s": POSITION_WINDOW_S,
                },
                states="position",
                shuffle=None,
                masks=["speed"],
            ),
            AnalysisSpec(
                metric={
                    "name": "bayesian_decoder",
                    "likelihood": "empirical",
                    "n_levels": 5,
                    "smooth_sigma_bins": 1.0,
                    "window_s": POSITION_WINDOW_S,
                },
                states="position",
                shuffle=None,
                masks=["speed"],
            ),
            # same decoder on categorical states: value = recall per behavior
            AnalysisSpec(
                metric={
                    "name": "bayesian_decoder",
                    "sigma": "pooled",
                    "min_frames_per_class": 20,
                },
                states="social_exclusive",
                shuffle=shuf,
            ),
            # cautionary row: Shuman's per-state sigma on unbalanced states; accuracy only, no null
            AnalysisSpec(
                metric={
                    "name": "bayesian_decoder",
                    "sigma": "per_state",
                    "min_frames_per_class": 20,
                },
                states="social_exclusive",
                shuffle=None,
            ),
        ]
    )


def decoder_table(dec_results) -> pd.DataFrame:
    """One row per decoder.  p is the median over states of the per-state p-values."""
    rows = []
    for r in dec_results:
        ex = r.extras
        if r.target == "position":
            rows.append(
                {
                    "likelihood": r.params.get("likelihood", "gaussian")
                    + (
                        (
                            " (binary)"
                            if r.params.get("binning") == "binary"
                            else f" ({r.params.get('n_levels', 5)} levels)"
                        )
                        if r.params.get("likelihood") == "empirical"
                        else ""
                    ),
                    "sigma": (
                        r.params.get("sigma", "per_state")
                        if r.params.get("likelihood", "gaussian") == "gaussian"
                        else "-"
                    ),
                    "smooth_sigma_bins": r.params.get("smooth_sigma_bins"),
                    "median_error_mm": float(np.ravel(ex["error_overall"])[0]),
                    "chance_error_mm": float(np.ravel(ex["chance_error"])[0]),
                    "median_p_over_states": (
                        float(np.nanmedian(r.shuffle.p_value)) if r.shuffle is not None else np.nan
                    ),
                }
            )
    return pd.DataFrame(rows)


def levels_sweep(seed: int, quick: bool) -> pd.DataFrame:
    """Detection and false-positive rate versus number of activity levels and duration.

    One ``cabana.sweep`` per duration over ``analyses.*.metric.n_levels``.  The ``*`` skips
    analyses without the field, so the Skaggs information analysis rides along unchanged (its
    value does not depend on the number of levels: a flat reference line).
    """
    durations = (300.0, 600.0) if quick else (300.0, 600.0, 1200.0)
    n_shuf = 50 if quick else 100
    levels = [2, 3, 5, 8]
    shuf = ShuffleConfig(n_shuffles=n_shuf, min_shift_s=20.0, seed=0)
    prep = build_pipeline(1)
    prep = Pipeline(transforms=prep.transforms, preprocess=prep.preprocess, analyses=[])
    pipe = Pipeline(
        analyses=[
            AnalysisSpec(
                metric={"name": "information_content", "smooth_sigma_bins": 1.0},
                states="position",
                shuffle=shuf,
                masks=["speed"],
            ),
            AnalysisSpec(
                metric={"name": "mutual_information"},
                states="position",
                shuffle=shuf,
                masks=["speed"],
            ),
        ]
    )
    label = {
        "information_content[position]": "skaggs_information",
        "mutual_information[position]": "mutual_information",
    }
    key = "analyses.*.metric.n_levels"
    rows = []
    for dur in durations:
        t = time.perf_counter()
        kw = {"duration_s": dur, "seed": seed}
        if quick:
            kw["n_cells"] = 80
        sess, _ = prep.run(simulate_session(**kw))
        gt = sess.meta["ground_truth"]
        rel, unt = list(gt["place_cells"]), list(gt["untuned_cells"])
        row_of = {str(c): i for i, c in enumerate(sess.cell_ids)}
        sw = cabana.sweep(sess, pipe, {key: levels})
        tab = sw.table.assign(row=sw.table["cell_id"].astype(str).map(row_of))
        tab["sig"] = tab["p_value"] < 0.05
        for (name, k), g in tab.groupby(["analysis", key]):
            sig = g.set_index("row")["sig"]
            rows.append(
                {
                    "metric": label[name],
                    "n_levels": k,
                    "duration_s": dur,
                    "detection": float(sig.loc[rel].mean()),
                    "fpr": float(sig.loc[unt].mean()),
                    "n_relevant": len(rel),
                    "n_untuned": len(unt),
                }
            )
        print(f"  {dur:g} s session: {time.perf_counter() - t:.1f} s")
    df = pd.DataFrame(rows)
    # the previous layout: per duration, the Skaggs rows first, then mutual information
    order = {"skaggs_information": 0, "mutual_information": 1}
    return (
        df.assign(_o=df["metric"].map(order))
        .sort_values(["duration_s", "_o", "n_levels"], kind="stable")
        .drop(columns="_o")
        .reset_index(drop=True)
    )


def nulls_compared(session, n_shuffles: int) -> pd.DataFrame:
    """Same AUROC analysis, three nulls: one pipeline, one named AnalysisSpec per null."""
    gt = session.meta["ground_truth"]
    social = gt["social_cells"]
    ci = np.array([d["cell"] for d in social])
    untuned = list(gt["untuned_cells"])
    nulls = {
        "circular_shift": {"name": "circular_shift", "min_shift_s": 20.0},
        "label_shuffle": {"name": "label_shuffle", "block_s": 2.0},
        "bout_shuffle": {"name": "bout_shuffle"},
    }
    t = time.perf_counter()
    pipe = Pipeline(
        analyses=[
            AnalysisSpec(
                name=f"auroc[social]#{label}",
                metric={"name": "auroc"},
                states="social",
                shuffle=ShuffleConfig(n_shuffles=n_shuffles, null=null, seed=0),
            )
            for label, null in nulls.items()
        ]
    )
    _, res = pipe.run(session)
    per_null_s = (time.perf_counter() - t) / len(nulls)
    rows = []
    for label in nulls:
        r = res[f"auroc[social]#{label}"]
        sig = np.asarray(r.shuffle.significant, bool)
        own = [r.state_names.index(d["behavior"]) for d in social]
        rows.append(
            {
                "null": label,
                "frac_social_detected_own_behavior": float(sig[ci, own].mean()),
                "untuned_FPR_per_state": float(sig[untuned].mean()),
                "runtime_s": per_null_s,
            }
        )
    return pd.DataFrame(rows)


def recovery_table(session, results, alpha: float = 0.05) -> pd.DataFrame:
    """Per analysis: detection in relevant cells, false positives in untuned cells.

    ``frac_sig_untuned (FPR)`` uses the raw p-values and ``fpr_adj`` the adjusted ones
    (``significant_adj``, which equals the raw decision when no correction was run); both are
    "significant in any state" for cell x state results.  ``sign_match`` classifies the own-state
    cells with ``responsive_cell_criteria`` and asks how many got the planted sign.
    """
    gt = session.meta["ground_truth"]
    social = gt["social_cells"]
    pops = {
        "position": ("place", list(gt["place_cells"])),
        "social": ("social", [d["cell"] for d in social]),
        "syllables": ("syllable", [d["cell"] for d in gt["syllable_cells"]]),
        "speed": ("place (speed-gated)", list(gt["place_cells"])),
    }
    untuned = list(gt["untuned_cells"])

    def any_state(sig):
        return sig if sig.ndim == 1 else sig.any(axis=1)

    def sign_match(metric, target, planted):
        """Fraction of classified own-state cells whose excited/inhibited class is the planted one."""
        cls = classify(
            results, responsive_cell_criteria(results, target, metric=metric, use_p=True)
        )
        exc = np.array([cls.labels[f"{state}_excited"][cell] for cell, state, _ in planted])
        inh = np.array([cls.labels[f"{state}_inhibited"][cell] for cell, state, _ in planted])
        want_exc = np.array([sign == "excited" for _, _, sign in planted])
        got = exc | inh
        return float(np.where(want_exc, exc, inh)[got].mean()) if got.any() else np.nan

    rows = []
    for r in results:
        if r.level != "cell" or r.shuffle is None:
            continue
        sig = np.asarray(r.shuffle.p_value) < alpha
        sig_adj = np.asarray(r.shuffle.significant_adj, bool)
        any_sig, any_adj = any_state(sig), any_state(sig_adj)
        pop, cells = pops[r.target]
        row = {
            "analysis": r.name,
            "relevant": pop,
            "n_relevant": len(cells),
            "frac_sig_relevant": float(any_sig[cells].mean()),
            "frac_sig_untuned (FPR)": float(any_sig[untuned].mean()),
            "frac_adj_relevant": float(any_adj[cells].mean()),
            "fpr_adj": float(any_adj[untuned].mean()),
            "frac_sig_own_state": np.nan,
            "sign_match": np.nan,
        }
        if r.metric in ("auroc", "mean_per_state", "peth") and r.target == "social":
            own = [r.state_names.index(d["behavior"]) for d in social]
            ci = np.array([d["cell"] for d in social])
            row["frac_sig_own_state"] = float(sig[ci, own].mean())
            row["sign_match"] = sign_match(
                r.metric, "social", [(d["cell"], d["behavior"], d["sign"]) for d in social]
            )
        elif r.metric == "auroc" and r.target == "syllables":
            sy = gt["syllable_cells"]
            ci = np.array([d["cell"] for d in sy])
            own = [r.state_names.index(d["syllable"]) for d in sy]
            row["frac_sig_own_state"] = float(sig[ci, own].mean())
            row["sign_match"] = sign_match(
                "auroc", "syllables", [(d["cell"], d["syllable"], "excited") for d in sy]
            )
        rows.append(row)
    return pd.DataFrame(rows)


def glm_table(session, glm) -> pd.DataFrame:
    """Unique contributions: does each social cell's top regressor group match its behavior?"""
    social = session.meta["ground_truth"]["social_cells"]
    groups = [str(g) for g in glm.extras["group_names"]]
    vals = np.asarray(glm.values, float)
    top = np.nanargmax(vals, axis=1)
    ci = np.array([d["cell"] for d in social])
    want = [groups.index(f"social:{d['behavior']}") for d in social]
    untuned = list(session.meta["ground_truth"]["untuned_cells"])
    place = list(session.meta["ground_truth"]["place_cells"])
    speed_top = float(np.mean(top[place] == groups.index("speed")))
    de = np.asarray(glm.extras["deviance_explained"], float)
    return pd.DataFrame(
        [
            {
                "frac_social_top_group_is_own_behavior": float(np.mean(top[ci] == np.array(want))),
                "frac_place_top_group_is_speed": speed_top,
                "median_dev_explained_social": float(np.nanmedian(de[ci])),
                "median_dev_explained_untuned": float(np.nanmedian(de[untuned])),
            }
        ]
    )


def _has_yaml() -> bool:
    try:
        import yaml  # noqa: F401
    except ImportError:
        return False
    return True


def save_fig(fig, path: Path) -> None:
    fig.savefig(path, dpi=130, bbox_inches="tight")
    plt.close(fig)
    print(f"  wrote {path}")


def selections_table(selections: list[dict]) -> pd.DataFrame:
    """Readable table of ``ResultSet.selections``: one row per chosen value."""
    return pd.DataFrame(
        [
            {
                "path": d["path"].removeprefix("analyses."),
                "value": d["value"],
                "method": d["method"],
                "criterion": d["criterion"],
            }
            for d in selections
        ]
    )


def chosen_value(selections: list[dict], suffix: str, analysis: str | None = None):
    """The value of the first selection whose path ends with ``suffix`` (and names ``analysis``)."""
    for d in selections:
        if d["path"].endswith(suffix) and (analysis is None or f".{analysis}." in d["path"]):
            return d["value"]
    return None


def chosen_parameters_line(selections: list[dict], bin_mm: float) -> str:
    """One line for the recovery-table printout: which sigma / min_shift_s the analyses used."""
    sigma = sorted({d["value"] for d in selections if d["path"].endswith("smooth_sigma_bins")})
    shifts = sorted({d["value"] for d in selections if d["path"].endswith("min_shift_s")})
    return (
        "Chosen parameters: smooth_sigma_bins = "
        + (", ".join(f"{v:g}" for v in sigma) or "not selected")
        + (f" ({sigma[0] * bin_mm:g} mm)" if len(sigma) == 1 and bin_mm else "")
        + "; null min_shift_s = "
        + (", ".join(f"{v:g}" for v in shifts) or "not selected")
        + " s (per analysis; see selections.json)"
    )


def smoothing_choice(session, selections: list[dict], out: Path, n_shuffles: int, quick: bool):
    """Figures 28 (score curve and sigma gallery) and 29 (stability across sigma); guard rail.

    The held-out score is the selection criterion; the sweep over sigma without shuffles
    shows what the choice does to a rate map; the sweep with shuffles shows how many cells
    change classification, and which of them are planted place cells.
    """
    gt = session.meta["ground_truth"]
    place, untuned = np.asarray(gt["place_cells"]), np.asarray(gt["untuned_cells"])
    topo = session.states["position"].topology
    bin_mm, _ = grid_bin_size(topo)
    cands = np.asarray(SIGMA_CANDIDATES, float)

    # --- figure 28a: the held-out score curve ---
    mean, se = heldout_smoothing_scores(
        session, "position", cands, mask=session.valid_mask(["speed"])
    )
    i_max = int(np.argmax(mean))
    i_se = int(np.flatnonzero(mean >= mean[i_max] - se[i_max]).min())
    print(
        f"\nHeld-out score over sigma (bins): argmax {cands[i_max]:g} bins "
        f"({cands[i_max] * bin_mm:g} mm), one-SE pick {cands[i_se]:g} bins "
        f"({cands[i_se] * bin_mm:g} mm); the pipeline selector chose "
        f"{chosen_value(selections, 'smooth_sigma_bins')}"
    )
    d = mean - mean[i_max]
    fig, ax = plt.subplots(figsize=(6.0, 4.2), layout="constrained")
    ylo = 1.3 * np.sort(d)[2]  # zoom past the (far worse) smallest candidates; they are annotated
    ax.axhspan(-se[i_max], 0, color="0.9", label="within 1 SE of the best")
    ax.errorbar(
        cands,
        d,
        yerr=se,
        fmt="o-",
        color="C0",
        capsize=3,
        label="held-out score (mean +/- SE over folds)",
    )
    ax.axvline(cands[i_max], color="C3", ls="--", lw=1.2, label=f"argmax: {cands[i_max]:g} bins")
    ax.axvline(cands[i_se], color="C2", lw=1.8, label=f"one-SE pick: {cands[i_se]:g} bins")
    off = [f"{x:g} bins: {y:,.0f}" for x, y in zip(cands, d, strict=True) if y < ylo]
    if off:
        ax.text(
            0.02,
            0.04,
            "off scale (score minus best):\n" + "\n".join(off),
            transform=ax.transAxes,
            fontsize=8,
            va="bottom",
            bbox={"boxstyle": "round", "fc": "white", "ec": "0.7"},
        )
    ax.set_ylim(ylo, 0.15 * abs(ylo))
    ax.set_xlabel("smoothing sigma (grid bins)")
    ax.set_ylabel("held-out Poisson score minus best")
    ax.secondary_xaxis("top", functions=(lambda v: v * bin_mm, lambda v: v / bin_mm)).set_xlabel(
        "sigma (mm)"
    )
    ax.legend(fontsize=8, loc="lower right", framealpha=0.95)
    save_fig(fig, out / "28a_smoothing_score.png")

    # --- figure 28b: one planted place cell across sigma (no shuffles: fast) ---
    key = "analyses.*.metric.smooth_sigma_bins"
    shuf = ShuffleConfig(
        n_shuffles=n_shuffles,
        min_shift_s=chosen_value(selections, "information_content[position].shuffle.min_shift_s")
        or 20.0,
        seed=0,
    )
    info = AnalysisSpec(
        metric={"name": "information_content"}, states="position", shuffle=shuf, masks=["speed"]
    )
    gal = cabana.sweep(session, Pipeline(analyses=[info]), {key: [0, 1, 2, 4]}, shuffle=False)
    base = Pipeline(analyses=[info]).run(session)[1]["information_content[position]"]
    cell = int(place[np.argmax(base.values[place])])
    save_fig(
        cabana.plots.plot_sweep_gallery(session, gal, cell, param=key),
        out / "28b_smoothing_gallery.png",
    )

    # --- figure 29: stability of the shuffle-test classification across sigma ---
    ids = [str(c) for c in session.cell_ids]
    half = AnalysisSpec(
        metric={"name": "split_half_stability"}, states="position", shuffle=None, masks=["speed"]
    )
    t = time.perf_counter()
    sw = cabana.sweep(session, Pipeline(analyses=[info, half]), {key: list(SIGMA_CANDIDATES)})
    print(
        f"\nSigma sweep with the shuffle test ({n_shuffles} shuffles, {len(SIGMA_CANDIDATES)} "
        f"values): {time.perf_counter() - t:.1f} s"
    )
    save_fig(
        cabana.plots.plot_sweep_stability(sw, analysis="information_content[position]", param=key),
        out / "29_smoothing_stability.png",
    )
    cells, overall = sw.stability("information_content[position]")
    print("Stability across sigma (information_content[position]):")
    print(
        "  "
        + ", ".join(
            f"{k} = {v:.3g}" if isinstance(v, float) else f"{k} = {v}"
            for k, v in overall.items()
            if k != "spearman_by_pair"
        )
    )
    cells = cells.assign(idx=cells["cell_id"].astype(str).map(ids.index))
    for name, pop in (("planted place cells", place), ("untuned cells", untuned)):
        sub = cells[cells["idx"].isin(pop)]
        print(
            f"  {name}: {int(sub['unstable'].sum())} of {len(sub)} change classification at least "
            f"once across sigma (mean flips {sub['n_flips'].mean():.2f})"
        )

    # --- guard rail: a significance count can never be the selection criterion ---
    print("\nGuard rail: choosing sigma by how many cells it makes significant")
    try:
        sw.pick("frac_significant")
    except ValueError as e:
        print(f"  sw.pick('frac_significant') raises: {str(e).splitlines()[0]}")
    pick = sw.pick("median_value", analysis="split_half_stability[position]", rule="one_se")[0]
    print(
        f"  sanctioned: a reliability criterion, {pick.criterion} (one-SE rule) -> sigma "
        f"{pick.value:g} bins; the held-out score (the selector) chose "
        f"{chosen_value(selections, 'smooth_sigma_bins')}. Reliability alone rises with sigma, "
        "so prefer the held-out score. Nothing is applied: the selector's choice stands."
    )


def evidence_first_views(session, results, place_result, out: Path) -> int:
    """Every default figure, cell cards, and the population/QA/agreement views; returns the count."""
    n = 0
    with cabana.plots.use_style():
        # one call: every default figure of every analysis, keyed "<analysis>/<plot>"
        written = results.plot_all(session, out_dir=out / "all")
        n += len(written)
        # one card per significant cell: tuning, null with raw and adjusted p, trace
        cards = cabana.plots.plot_cell_cards(
            session, results, cells="significant", max_cards=6, out_dir=out / "cards"
        )
        n += len(cards)
        # population and session-level views
        save_fig(
            cabana.plots.plot_activity_raster(session, max_cells=60), out / "30_activity_raster.png"
        )
        save_fig(cabana.plots.plot_session_qa(session), out / "31_session_qa.png")
        for kind in ("jaccard", "upset"):
            fig = cabana.plots.plot_analysis_agreement(results, kind=kind)
            save_fig(fig, out / f"32_analysis_agreement_{kind}.png")
        save_fig(
            cabana.plots.plot_population_tuning(place_result, session),
            out / "33_population_tuning_place.png",
        )
        n += 5
    # the same figure as data: what a non-Python front end (CaLab) would draw from
    data = cabana.plots.plot_rate_maps_data(session, place_result, cells=[0, 1, 2])
    (out / "rate_maps_data.json").write_text(cabana.plots.to_json(data))
    return n


def phase_e_pipeline(n_shuffles: int, n_small: int, n_null: int) -> Pipeline:
    """Phase E analyses on the prepared session (states, speed signal and masks already exist).

    ``n_shuffles`` is for the cheap fast-path analyses, ``n_small`` for the ones that
    recompute the metric on every surrogate (``cell_shift``, ``place_fields`` components).
    """
    shuf = ShuffleConfig(n_shuffles=n_shuffles, min_shift_s=20.0, seed=0)
    # the same auROC against two nulls.  The matched null keeps only the shifts under which
    # every social state sees the same distribution of speed as it does in the data
    matched = {
        "name": "covariate_matched_shift",
        "covariate": "speed",
        "statistic": "mean",  # |difference of means| / pooled sd, at most `tolerance`
        "tolerance": 0.5,  # scales with state size: small states need a looser one
        "min_frames": 100,  # states with fewer frames are not matched
        "max_tries": 100,
        "min_shift_s": 10.0,
    }
    # cell_shift rolls every cell by its own offset, which is what a population null needs
    pop = {"name": "cell_shift", "min_pair_separation_s": 2.0}
    return Pipeline(
        analyses=[
            AnalysisSpec(
                name="auroc_plain",
                metric={"name": "auroc"},
                states="social",
                shuffle=ShuffleConfig(n_shuffles=n_shuffles, min_shift_s=10.0, seed=15),
            ),
            AnalysisSpec(
                name="auroc_speed_matched",
                metric={"name": "auroc"},
                states="social",
                shuffle=ShuffleConfig(n_shuffles=n_shuffles, null=matched, seed=16),
            ),
            AnalysisSpec(
                name="fields",
                metric={"name": "place_fields", "min_field_bins": 2},
                states="position",
                masks=["speed"],
                shuffle=ShuffleConfig(n_shuffles=n_small, min_shift_s=20.0, seed=11),
            ),
            AnalysisSpec(
                name="selectivity",
                metric={"name": "tuning_selectivity"},
                states="syllables",
                shuffle=shuf,
            ),
            # noise correlations: shared frame-to-frame variability after removing each
            # syllable's mean.  A common shift would leave them unchanged, so cell_shift
            AnalysisSpec(
                name="noise_corr",
                metric={"name": "pairwise_correlation", "kind": "noise"},
                states="syllables",
                shuffle=ShuffleConfig(n_shuffles=n_small, null=pop, seed=17),
            ),
            AnalysisSpec(
                name="pr",
                metric={"name": "participation_ratio"},
                states="syllables",
                shuffle=ShuffleConfig(n_shuffles=n_small, null=pop, seed=18),
            ),
            AnalysisSpec(
                name="decode_x",
                metric={"name": "decode_signal", "n_folds": 3},
                signal="x",
                shuffle=ShuffleConfig(n_shuffles=n_small, min_shift_s=20.0, seed=12),
            ),
            # PETH with the descriptive null band and response latency
            AnalysisSpec(
                name="peth_band",
                metric={
                    "name": "peth",
                    "pre_s": 4.0,
                    "post_s": 4.0,
                    "baseline_s": (-4.0, -1.0),
                    "response_s": (0.0, 1.5),
                    "min_duration_s": 1.5,
                    "min_gap_s": 1.0,
                    "null_band": True,
                    "n_null": n_null,
                },
                states="social",
            ),
        ]
    )


def phase_e_section(session, out: Path, quick: bool) -> dict[str, int]:
    """Confound-resistant nulls and the Phase E metrics; returns counts the tests can check."""
    n_fast = 200 if quick else 1000
    n_small = 30 if quick else 200
    n_null = 50 if quick else 200
    t0 = time.perf_counter()
    _, res = phase_e_pipeline(n_fast, n_small, n_null).run(session)
    if res.errors:
        raise RuntimeError(f"Phase E analyses failed: {res.errors}")
    print(f"  Phase E analyses ran in {time.perf_counter() - t0:.1f} s")

    # 1. speed-matched null versus the plain circular shift
    plain, matched = res["auroc_plain"], res["auroc_speed_matched"]
    info = matched.shuffle.null_info
    n_plain = int(cabana.significant_cells(plain).sum())
    n_matched = int(cabana.significant_cells(matched).sum())
    print(
        f"\n  Speed-matched null on auroc[social]: acceptance rate {info['acceptance_rate']:.0%} "
        f"({info['n_candidates']} candidate shifts), balance_max {info['balance_max']:.2f} "
        f"(tolerance {info['tolerance']}), balance_mean {info['balance_mean']:.2f}"
    )
    print(
        f"  Cells significant in any social state: circular shift {n_plain}, "
        f"speed-matched {n_matched} of {plain.values.shape[0]}"
    )
    gt = session.meta["ground_truth"]
    untuned = np.array(gt["untuned_cells"])
    print(
        "  Untuned cells called significant (false positives): "
        f"circular shift {int(cabana.significant_cells(plain)[untuned].sum())}, "
        f"speed-matched {int(cabana.significant_cells(matched)[untuned].sum())} of {len(untuned)}"
    )
    # states defined by speed cannot be matched on speed: the null raises instead of guessing
    try:
        Pipeline(
            analyses=[
                AnalysisSpec(
                    metric={"name": "auroc"},
                    states="syllables",
                    shuffle=ShuffleConfig(
                        n_shuffles=20,
                        null={
                            "name": "covariate_matched_shift",
                            "covariate": "speed",
                            "tolerance": 0.1,
                            "max_tries": 20,
                        },
                    ),
                )
            ]
        ).run(session)
        print("  speed-matched null on syllables: no error (unexpected for this simulation)")
    except ValueError as exc:
        print(f"  speed-matched null on the speed-defined syllables raises: {str(exc)[:90]}...")

    # 2. place fields
    fields = res["fields"]
    sig_f = cabana.significant_cells(fields)
    n_fields = fields.extras["n_fields"]
    print(
        f"\n  place_fields[position]: {int(sig_f.sum())} cells with a significant in/out ratio; "
        f"median fields per significant cell {np.median(n_fields[sig_f]) if sig_f.any() else float('nan'):.0f}, "
        f"median area {np.nanmedian(fields.extras['field_area'][sig_f]) if sig_f.any() else float('nan'):.0f} mm^2"
    )
    place = np.array(gt["place_cells"])
    show = place[np.argsort(-np.nan_to_num(fields.values[place]))[:12]]
    save_fig(
        cabana.plots.plot_place_fields(session, fields, list(show)), out / "34_place_fields.png"
    )

    # 3. tuning selectivity of the syllable states
    sel = res["selectivity"]
    print(
        f"  tuning_selectivity[syllables]: median selectivity index {np.nanmedian(sel.values):.2f}, "
        f"{int(cabana.significant_cells(sel).sum())} cells significant"
    )

    # 4. pairwise noise correlations and the participation ratio, both against cell_shift
    nc, pr = res["noise_corr"], res["pr"]
    print(
        f"  noise correlations (cell_shift null): mean off-diagonal "
        f"{float(np.ravel(nc.extras['mean_offdiag'])[0]):+.4f}, "
        f"{np.nanmean(nc.shuffle.significant[~np.eye(nc.values.shape[0], dtype=bool)]):.1%} "
        f"of pairs significant (uncorrected; two-sided p floor {2 / (n_small + 1):.3f})"
    )
    print(
        f"  participation_ratio: {pr.values[0]:.1f} of {pr.extras['eigenvalues'].size} cells "
        f"(null {pr.shuffle.null_lo[0]:.1f} to {pr.shuffle.null_hi[0]:.1f}, p={pr.shuffle.p_value[0]:.3f})"
    )
    # weak coupling: narrow colour range
    save_fig(
        cabana.plots.plot_pairwise_matrix(nc, vmin=-0.2, vmax=0.2), out / "35_pairwise_matrix.png"
    )
    save_fig(cabana.plots.plot_participation_ratio(pr), out / "36_participation_ratio.png")

    # 5. decoding a continuous signal
    dec = res["decode_x"]
    print(
        f"  decode_signal[x]: held-out R^2 {dec.values[0]:.2f} "
        f"(null {dec.shuffle.null_lo[0]:.2f} to {dec.shuffle.null_hi[0]:.2f}), "
        f"MAE {dec.extras['mae'][0]:.0f} mm vs chance {dec.extras['chance_mae'][0]:.0f} mm"
    )
    save_fig(cabana.plots.plot_decode_signal(dec, session), out / "37_decode_signal.png")

    # 6. PETH with the null band, cells sorted by latency
    peth = res["peth_band"]
    lat = peth.extras["latency_s"]
    print(
        f"  peth null band: {int(np.isfinite(lat).sum())} of {lat.size} cell x state pairs leave "
        f"the band; median latency {np.nanmedian(lat):.2f} s"
    )
    save_fig(
        cabana.plots.plot_peth(peth, session, states=[peth.state_names[0]], sort_by="latency"),
        out / "38_peth_latency.png",
    )

    # 7. effect sizes: z = (observed - null mean) / null sd, next to p, which is floored
    df = res.to_dataframe()
    df = df[df["analysis"] == "auroc_speed_matched"].copy()
    df["abs_z"] = df["z"].abs()
    cols = ["cell", "state", "value", "p_value", "z"]
    print(
        f"\n  Strongest cells by |z| under the speed-matched null (p cannot go below "
        f"{1 / (matched.shuffle.n_shuffles + 1):.4f}):"
    )
    print(
        df.sort_values("abs_z", ascending=False)[cols]
        .head(6)
        .to_string(index=False, float_format=lambda v: f"{v:.3g}")
    )
    return {"n_plain": n_plain, "n_matched": n_matched}


def front_door_section(session, out: Path, quick: bool) -> dict[str, int]:
    """The one-call path: recipes, preflight, summary, memory, tuning and the CLI."""
    from cabana._cli import main as cabana_main

    fd = out / "front_door"
    fd.mkdir(parents=True, exist_ok=True)
    n_sh = 100 if quick else 300
    recipes = cabana.recipes()
    print(f"  recipes: {', '.join(recipes)}")

    # (a) preflight: a recipe is a pipeline with placeholders; validate() checks it on the session
    pipe = cabana.recipe_pipeline("place_cell", states="position")
    print("\n  Preflight report (Pipeline.validate):")
    print(textwrap.indent(str(pipe.validate(session)), "    "))

    # (b) the one-liner
    t0 = time.perf_counter()
    sess_fd, results = cabana.analyze(
        session, "place_cell", states="position", n_shuffles=n_sh, progress=False, out_dir=fd
    )
    print(f"\n  analyze(place_cell) in {time.perf_counter() - t0:.1f} s; results.summary():")
    summ = results.summary()
    short = ["analysis", "metric", "n_shuffles", "n_tested", "n_significant", "median_z"]
    print(textwrap.indent(cabana.format_summary(summ[short]), "    "))
    n_sig = int(summ.loc[summ["analysis"] == "information", "n_significant"].iloc[0])

    # (c) memory: the estimate, and the chunked null giving the same p-values
    print("\n  Memory estimate:")
    print(textwrap.indent(str(cabana.memory_estimate(pipe, sess_fd)), "    "))

    def auroc_social(**shuffle_kw):
        spec = AnalysisSpec(
            name="a",
            metric={"name": "auroc"},
            states="social",
            shuffle=ShuffleConfig(n_shuffles=n_sh, **shuffle_kw),
        )
        return Pipeline(analyses=[spec]).run(sess_fd)[1]["a"]

    full = auroc_social()
    chunked = auroc_social(keep_null="none", max_null_bytes=1)
    n_chunks = int(chunked.shuffle.null_info["chunks"])
    diff = float(np.max(np.abs(full.shuffle.p_value - chunked.shuffle.p_value)))
    same = bool(np.allclose(full.shuffle.p_value, chunked.shuffle.p_value))
    print(
        f"  auroc[social], keep_null='none', max_null_bytes=1: {n_chunks} chunks; "
        f"p equals the unchunked run: {same} (max abs difference {diff:.1e})"
    )

    # (d) tuning: sweep, choose, apply; reliability criterion only
    base = Pipeline(
        analyses=[
            AnalysisSpec(
                name="split",
                metric={"name": "split_half_stability"},
                states="position",
                masks=["speed"],
            )
        ]
    )
    sigma = "analyses.*.metric.smooth_sigma_bins"
    print(
        "\n  tune() picks by 'median_value' here only because the metric is split_half_stability, "
        "a held-out reliability.\n  Never use median_value for information_content: its bias "
        "grows with smoothing, so the score rewards the wrong sigma."
    )
    export = cabana.tune(sess_fd, base, {sigma: [0, 1, 2]}, criterion="median_value")
    tuned = base.apply_tuning(export)
    chosen = tuned.analyses[0].metric.smooth_sigma_bins
    print(f"  chosen smooth_sigma_bins: {chosen} (export.chosen {export.chosen})")
    print("  export.to_json()[:300]:")
    print(textwrap.indent(export.to_json()[:300], "    "))

    # (e) save and run the same thing headless through the command line
    sess_fd.save(fd / "session.zip")
    yaml_path = fd / "pipeline.yaml"
    (fd / "cli").mkdir(exist_ok=True)  # the progress file's folder must exist
    prog = fd / "cli" / "progress.jsonl"
    print(f"\n  cabana run {yaml_path.name} --session session.zip --out cli --progress jsonl:")
    rc = cabana_main(
        [
            "run",
            str(yaml_path),
            "--session",
            str(fd / "session.zip"),
            "--out",
            str(fd / "cli"),
            "--progress",
            "jsonl",
            "--progress-file",
            str(prog),
        ]
    )
    lines = prog.read_text().splitlines()
    print(f"  exit code {rc}; {len(lines)} jsonl lines; last event: {lines[-1]}")
    return {
        "n_recipes": len(recipes),
        "n_significant_place": n_sig,
        "n_chunks": n_chunks,
        "n_progress_lines": len(lines),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    ap.add_argument("--n-shuffles", type=int, default=1000)
    ap.add_argument("--out", type=Path, default=Path("examples/output"))
    ap.add_argument(
        "--quick",
        action="store_true",
        help="duration 300 s, 80 cells, 200 shuffles (decoders 20, level sweep 50); ~40 s",
    )
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args(argv)

    sim_kw = {"seed": args.seed}
    n_shuffles = args.n_shuffles
    if args.quick:
        sim_kw.update(duration_s=300.0, n_cells=80)
        n_shuffles = 200
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)
    pd.set_option("display.width", 200)
    pd.set_option("display.max_columns", 20)

    caps = describe()
    print(
        f"CaBaNA {caps['version']}: {len(caps['plugins']['metric'])} registered metrics, "
        f"{len(caps['plugins']['null'])} nulls (cabana.describe())"
    )
    t0 = time.perf_counter()
    session = simulate_session(**sim_kw)
    print(describe_ground_truth(session), "\n")

    pipe = build_pipeline(n_shuffles)
    t1 = time.perf_counter()
    # run control: a progress callback (one line per 10%) and the stage lines through `log`;
    # `should_cancel` / `on_error="record"` are the other RunContext hooks (see docs/DESIGN.md)
    ctx = RunContext(on_progress=progress_printer("main"), log=lambda m: print(m, flush=True))
    session, results = pipe.run(session, context=ctx)
    print(
        f"\nPipeline runtime: {time.perf_counter() - t1:.1f} s ({n_shuffles} shuffles); "
        f"status {results.status}, {len(results.completed)} analyses completed, "
        f"{len(results.errors)} errors, {len(results.warnings)} warnings\n"
    )

    selections = results.selections
    print("Parameter selections (how each value was chosen; none saw a p-value):")
    print(selections_table(selections).to_string(index=False, float_format=lambda v: f"{v:g}"))
    print()

    # two mutual_information analyses share metric and target; the second was named explicitly
    mi_bin = results["mutual_information_binary[position]"]

    # --- save tables / provenance ---
    df = results.to_dataframe()
    df.to_csv(out / "results.csv", index=False)
    results.save(out / "results.zip")  # reload with cabana.ResultSet.load
    session.save(out / "session.zip")  # session with all derived signals, states and masks
    try:
        (out / "pipeline.yaml").write_text(pipe.to_yaml())
    except ImportError:
        (out / "pipeline.json").write_text(json.dumps(pipe.to_dict(), indent=2, default=str))
    (out / "ground_truth.json").write_text(json.dumps(session.meta["ground_truth"], indent=2))
    (out / "selections.json").write_text(json.dumps(selections, indent=2, default=str))

    # --- figures ---
    gt = session.meta["ground_truth"]
    ic_pos = results["information_content[position]"]
    sh_pos = results.get("split_half_stability", "position")
    au_soc = results["auroc[social]"]
    au_syl = results.get("auroc", "syllables")
    pvo = results.get("population_vector_overlap", "social")

    print("Figures:")
    save_fig(cabana.plots.plot_behavior_overview(session), out / "01_behavior_overview.png")

    place = np.array(gt["place_cells"])
    top = place[np.argsort(-ic_pos.values[place])[:12]]
    untuned = np.array(gt["untuned_cells"])[:6]
    save_fig(
        cabana.plots.plot_rate_maps(session, ic_pos, list(top)), out / "02_rate_maps_place.png"
    )
    save_fig(
        cabana.plots.plot_rate_maps(session, ic_pos, list(untuned)),
        out / "03_rate_maps_untuned.png",
    )

    fig, axes = plt.subplots(1, 2, figsize=(10, 3.8), layout="constrained")
    cabana.plots.plot_shuffle_distribution(ic_pos, int(top[0]), ax=axes[0])
    cabana.plots.plot_shuffle_distribution(ic_pos, int(untuned[0]), ax=axes[1])
    save_fig(fig, out / "04_shuffle_distribution.png")

    save_fig(cabana.plots.plot_tuning_heatmap(au_soc, sort_by="peak"), out / "05_tuning_social.png")
    save_fig(
        cabana.plots.plot_tuning_heatmap(au_syl, sort_by="peak"), out / "06_tuning_syllables.png"
    )
    save_fig(cabana.plots.plot_metric_scatter(ic_pos, sh_pos), out / "07_info_vs_stability.png")
    save_fig(
        cabana.plots.plot_population_matrix(pvo, vmin=-1, vmax=1), out / "08_pv_overlap_social.png"
    )
    rec = cabana.plots.plot_ground_truth_recovery(session, results)
    summary = rec.cabana_summary
    save_fig(rec, out / "09_ground_truth_recovery.png")

    # ===================== second increment =====================
    n_pop = 100
    n_dec = 20 if args.quick else 50
    n_null = 100 if args.quick else 200

    # --- population pipeline on the re-binned session ---
    print("\nPopulation pipeline (0.5 s bins, design matrix, label_shuffle null):")
    t2 = time.perf_counter()
    pop_pipe = build_population_pipeline(n_pop, n_dec)
    binned, pop_results = pop_pipe.run(session, progress=True)
    print(
        f"  re-binned: {session.n_time} -> {binned.n_time} frames at {binned.fs:g} Hz; "
        f"runtime {time.perf_counter() - t2:.1f} s"
    )
    if _has_yaml():
        (out / "pipeline_population.yaml").write_text(pop_pipe.to_yaml())
    pop_df = pop_results.to_dataframe()
    df = pd.concat([df, pop_df], ignore_index=True)
    df.to_csv(out / "results.csv", index=False)

    # --- nulls compared ---
    print(f"\nNulls compared (auroc on social, {n_null} shuffles each; one-line change):")
    nulls_df = nulls_compared(session, n_null)
    print(nulls_df.to_string(index=False, float_format=lambda v: f"{v:.2f}"))
    nulls_df.to_csv(out / "nulls_compared.csv", index=False)

    # --- post hoc: classify cells with the criteria layer, then overlap and clusters ---
    # place cell = information AND split-half stability significant; excited / inhibited per social
    # state = auroc above the 97.5th / below the 2.5th percentile of the circular-shift null
    resp = responsive_cell_criteria(results, "social")
    cls = classify(
        results,
        {
            "place_cell": place_cell_criteria("position"),
            "social_excited": Criteria(
                name="social_excited", any_of=[c for k, c in resp.items() if k.endswith("_excited")]
            ),
            "social_inhibited": Criteria(
                name="social_inhibited",
                any_of=[c for k, c in resp.items() if k.endswith("_inhibited")],
            ),
        },
    )
    print(
        "\nClassification (place_cell_criteria; responsive_cell_criteria at the 97.5th percentile): "
        + ", ".join(f"{k} {v} ({cls.fractions()[k]:.0%})" for k, v in cls.counts().items())
    )
    # the percentile rule is uncorrected; the same classes from the max_stat-adjusted p-values
    cls_p = classify(results, responsive_cell_criteria(results, "social", use_p=True))
    unt_idx = np.array(gt["untuned_cells"])
    n_unt_pct = int(np.any([v[unt_idx] for v in cls.labels.values()][1:], axis=0).sum())
    n_unt_adj = int(np.any([v[unt_idx] for v in cls_p.labels.values()], axis=0).sum())
    print(
        f"Untuned cells called social-responsive (of {len(unt_idx)}): {n_unt_pct} by the "
        f"97.5th-percentile rule, {n_unt_adj} by significant adjusted p (use_p=True)"
    )
    social_any = cls.labels["social_excited"] | cls.labels["social_inhibited"]
    ov = overlap_vs_chance(cls.labels["place_cell"], social_any)
    print(
        "\nOverlap of place cells (information and stability significant) and social-responsive "
        "cells (auroc beyond the null percentile in any state):"
    )
    print(ov)
    feats, fnames, kept = response_features(
        results, which=[("auroc", "social"), ("mean_per_state", "social")]
    )
    clusters = response_clusters(feats, k=None, k_range=(2, 6))
    pop_label = np.full(session.n_cells, "other", dtype=object)
    pop_label[list(gt["place_cells"])] = "place"
    pop_label[list(gt["syllable_cells"][i]["cell"] for i in range(len(gt["syllable_cells"])))] = (
        "syllable"
    )
    pop_label[list(gt["untuned_cells"])] = "untuned"
    for d in gt["social_cells"]:
        pop_label[d["cell"]] = f"social_{d['sign']}"
    comp = pd.crosstab(
        pd.Series(clusters.labels, name="cluster"),
        pd.Series(pop_label[kept], name="planted population"),
    )
    by_class = pd.crosstab(
        pd.Series(cls.label_per_cell(), name="classified as"),
        pd.Series(pop_label, name="planted population"),
    )
    sizes = np.bincount(clusters.labels)
    print(
        f"\nResponse clusters: k={clusters.k} chosen by silhouette "
        f"({ {k_: round(v, 2) for k_, v in clusters.scores.items()} }); sizes {sizes.tolist()}"
    )
    print(comp.to_string())
    print("\nClassification versus planted population (cells; 'multiple' = several classes):")
    print(by_class.to_string())

    # --- cohort smoke test ---
    print("\nCohort smoke test (2 extra 300 s sessions, seeds 1 and 2):")
    t3 = time.perf_counter()
    cohort_kw = {**sim_kw, "duration_s": 300.0}
    cohort_pipe = build_pipeline(min(n_shuffles, 100))
    by_session = {"s0": results}
    extra_sessions = {}
    for sid, seed in (("s1", 1), ("s2", 2)):
        sess_i, res_i = cohort_pipe.run(simulate_session(**{**cohort_kw, "seed": seed}))
        by_session[sid] = res_i
        extra_sessions[sid] = sess_i
    animal = {"s0": "A", "s1": "A", "s2": "B"}
    table = cohort_table(by_session, animal)
    fracs = fraction_significant_by_animal(table, metric="auroc", target="social")
    print(fracs.to_string(index=False, float_format=lambda v: f"{v:.2f}"))
    print(f"  cohort runtime {time.perf_counter() - t3:.1f} s")
    # NEGATIVE CONTROL: s0 and s1 are different simulated animals, so the identity
    # 'registration' pairs unrelated cells.  Rate maps should NOT correlate.
    ic_s1 = by_session["s1"].get("information_content", "position")
    n_id = min(session.n_cells, extra_sessions["s1"].n_cells)
    ident = CellMatch(session_a="s0", session_b="s1", pairs=np.c_[np.arange(n_id), np.arange(n_id)])
    cs = cross_session_map_correlation(
        ic_pos,
        ic_s1,
        ident,
        n_shuffles=200,
        states=(session.states["position"], extra_sessions["s1"].states["position"]),
    )
    print(
        "\nCross-session map correlation, s0 vs s1 with an identity (wrong) match "
        "[negative control, expect ~0 and p_population not small]:"
    )
    print(remapping_summary(cs))

    # --- new figures ---
    print("\nFigures (second increment):")
    pe = results.get("peth", "social")
    mps_res = results.get("mean_per_state", "social")
    sc = results.get("signal_correlation", "speed")
    pca = pop_results.get("pca_population", "social")
    dec = pop_results.get("decode_states", "social")
    glm = pop_results.get("glm_encoding", "design")
    social_cells = np.array([d["cell"] for d in gt["social_cells"]])
    own_idx = [pe.state_names.index(d["behavior"]) for d in gt["social_cells"]]
    best = int(np.argmax(np.abs(np.nan_to_num(pe.values[social_cells, own_idx]))))
    top_cell, top_state = int(social_cells[best]), gt["social_cells"][best]["behavior"]
    save_fig(cabana.plots.plot_peth(pe, session, ncols=4), out / "10_peth_social.png")
    save_fig(
        cabana.plots.plot_event_raster(
            session, pe, top_cell, top_state, mask=session.valid_mask(["social_scored"])
        ),
        out / "11_event_raster_top_social_cell.png",
    )
    save_fig(
        cabana.plots.plot_tuning_heatmap(mps_res, sort_by="peak"),
        out / "12_mean_per_state_social.png",
    )
    place_arr = np.array(gt["place_cells"])
    pc = int(place_arr[np.nanargmax(np.abs(sc.values[place_arr]))])
    fig, axes = plt.subplots(1, 2, figsize=(10, 3.8), layout="constrained")
    cabana.plots.plot_shuffle_distribution(sc, pc, ax=axes[0])
    axes[0].set_title(f"speed correlation, place cell {pc}")
    cabana.plots.plot_shuffle_distribution(sc, int(untuned[0]), ax=axes[1])
    axes[1].set_title(f"speed correlation, untuned cell {int(untuned[0])}")
    save_fig(fig, out / "13_speed_correlation_shuffle.png")
    save_fig(
        cabana.plots.plot_population_matrix(pca, cmap="magma"), out / "14_pca_distances_social.png"
    )
    fig, ax = plt.subplots(figsize=(5.5, 3.8), layout="constrained")
    xs = np.arange(len(dec.state_names))
    ax.bar(xs, dec.values, color="C0", label="decoder (held-out blocks)")
    ax.plot(xs, dec.shuffle.null_hi, "k_", ms=28, mew=2, label="null 95th pct (label_shuffle)")
    ax.axhline(0.5, color="0.6", ls="--", lw=1)
    ax.set_xticks(xs, dec.state_names)
    ax.set_ylabel("balanced accuracy (one vs rest)")
    ax.set_ylim(0.4, 1.0)
    ax.legend(fontsize=8, loc="upper right")
    save_fig(fig, out / "15_decoding_vs_null.png")
    save_fig(cabana.plots.plot_overlap(ov, labels=("place", "social")), out / "16_overlap.png")
    save_fig(cabana.plots.plot_clusters(clusters, fnames), out / "17_response_clusters.png")
    save_fig(cabana.plots.plot_cohort_fractions(fracs), out / "18_cohort_fractions.png")
    save_fig(cabana.plots.plot_cross_session(cs), out / "19_cross_session_negative_control.png")

    # ===================== third increment: amplitude as a dimension =====================
    print("\nAmplitude as a dimension: mutual information and Bayesian decoding")
    mi_pos = results["mutual_information[position]"]
    place_arr = np.array(gt["place_cells"])
    sig_ic = np.asarray(ic_pos.shuffle.p_value) < 0.05
    sig_mi = np.asarray(mi_pos.shuffle.p_value) < 0.05
    sig_bin = np.asarray(mi_bin.shuffle.p_value) < 0.05
    unt_all = np.array(gt["untuned_cells"])
    print(
        pd.DataFrame(
            {
                "analysis": ["Skaggs information", "MI, 5 quantile levels", "MI, binary (on/off)"],
                "detect_place": [sig[place_arr].mean() for sig in (sig_ic, sig_mi, sig_bin)],
                "FPR_untuned": [sig[unt_all].mean() for sig in (sig_ic, sig_mi, sig_bin)],
            }
        ).to_string(index=False, float_format=lambda v: f"{v:.2f}")
    )

    t_dec = time.perf_counter()
    n_dec_shuf = 20 if args.quick else 50
    dec_pipe = build_decoder_pipeline(n_dec_shuf)
    _, dec_results = dec_pipe.run(session, progress=True)
    print(
        f"\nDecoders ({n_dec_shuf} label_shuffle shuffles each; empirical ones unshuffled): "
        f"{time.perf_counter() - t_dec:.1f} s"
    )
    df = pd.concat([df, dec_results.to_dataframe()], ignore_index=True)
    df.to_csv(out / "results.csv", index=False)
    bd_pos = [
        r
        for r in dec_results
        if r.target == "position" and r.params.get("likelihood") != "empirical"
    ]
    bd_socs = [r for r in dec_results if r.target == "social_exclusive"]
    bd_soc = next(r for r in bd_socs if r.params.get("sigma") == "pooled")
    bd_soc_ps = next(r for r in bd_socs if r.params.get("sigma", "per_state") == "per_state")
    print(
        "\nPosition decoders (error = median over held-out frames, mm; "
        "p = median over states of the per-state p-values):"
    )
    print(decoder_table(dec_results).to_string(index=False, float_format=lambda v: f"{v:.3g}"))
    print("\nSocial decoder, recall per behavior vs 95th percentile of the label_shuffle null:")
    print(
        pd.DataFrame(
            {
                "state": bd_soc.state_names,
                "recall": bd_soc.values,
                "null_hi": bd_soc.shuffle.null_hi,
                "p": bd_soc.shuffle.p_value,
            }
        ).to_string(index=False, float_format=lambda v: f"{v:.3f}")
    )

    print(
        "\nSocial decoder overall accuracy (chance = 1 / n_states = "
        f"{1 / len(bd_soc.state_names):.2f}): gaussian pooled "
        f"{float(np.ravel(bd_soc.extras['accuracy_overall'])[0]):.2f} vs gaussian per_state "
        f"{float(np.ravel(bd_soc_ps.extras['accuracy_overall'])[0]):.2f} (cautionary: rare "
        "states get a wide sigma and a flat likelihood)"
    )
    n_beat = int((np.asarray(bd_soc.shuffle.p_value) < 0.05).sum())
    print(
        f"Pooled social decoder beats its label_shuffle null in {n_beat} of "
        f"{len(bd_soc.state_names)} behaviors (p < 0.05)"
    )

    t_sw = time.perf_counter()
    print("\nLevels sweep (planted place-cell detection and untuned FPR):")
    lvl = levels_sweep(args.seed, args.quick)
    lvl.to_csv(out / "levels_sweep.csv", index=False)
    print(
        lvl.pivot_table(
            index=["metric", "n_levels"], columns="duration_s", values=["detection", "fpr"]
        ).to_string(float_format=lambda v: f"{v:.2f}")
    )
    print(f"  sweep runtime {time.perf_counter() - t_sw:.1f} s")

    print("\nFigures (amplitude and decoding):")
    mi_top = place_arr[np.argsort(-np.nan_to_num(mi_pos.values[place_arr]))[:3]]
    pos_states = session.states["position"]
    save_fig(
        cabana.plots.plot_joint_histogram(
            mi_pos, list(mi_top), states=pos_states, normalize="conditional"
        ),
        out / "20_joint_histogram_place.png",
    )
    save_fig(
        cabana.plots.plot_joint_histogram(
            mi_pos, [*mi_top, int(unt_all[0])], states=pos_states, normalize="lift"
        ),
        out / "21_joint_histogram_lift.png",
    )
    save_fig(
        cabana.plots.plot_information_comparison(
            ic_pos,
            mi_pos,
            labels=("Skaggs information (bits/event)", "mutual information (bits)"),
            highlight=list(place_arr),
        ),
        out / "22_info_vs_mi.png",
    )
    save_fig(cabana.plots.plot_level_sweep(lvl), out / "23_level_sweep.png")
    g_dec = bd_pos[1]  # gaussian, pooled sigma
    save_fig(
        cabana.plots.plot_decoded_trajectory(g_dec, session, pos_states),
        out / "24_decoded_trajectory.png",
    )
    fig, ax = plt.subplots(figsize=(6.2, 3.8), layout="constrained")
    top_err = np.nanpercentile(
        np.concatenate([np.asarray(r.extras["error"]) for r in bd_pos]), 99.5
    )
    bins = np.linspace(0, top_err, 50)
    for i, r in enumerate(bd_pos):
        lab = r.params.get("likelihood", "gaussian")
        if lab == "gaussian":
            lab += f" ({r.params.get('sigma', 'per_state')})"
        ax.hist(
            np.asarray(r.extras["error"]),
            bins=bins,
            histtype="step",
            color=f"C{i}",
            density=True,
            label=lab,
        )
        ax.axvline(float(np.ravel(r.extras["error_overall"])[0]), color=f"C{i}", ls="--", lw=1)
    ax.axvline(
        float(np.ravel(g_dec.extras["chance_error"])[0]),
        color="k",
        ls=":",
        label="chance (guess most occupied bin)",
    )
    ax.set_xlabel("decoding error (mm); dashed = median")
    ax.set_ylabel("density of frames")
    ax.legend(fontsize=8, frameon=False)
    save_fig(fig, out / "25_decoder_errors.png")
    conf = np.asarray(bd_soc.extras["confusion"], float)
    with np.errstate(invalid="ignore", divide="ignore"):
        conf_n = conf / conf.sum(axis=1, keepdims=True)
    fig, ax = plt.subplots(figsize=(5.2, 4.4), layout="constrained")
    im = ax.imshow(conf_n, vmin=0, vmax=1, cmap="viridis")
    names = list(bd_soc.state_names)
    ax.set_xticks(range(len(names)), names, rotation=45, ha="right")
    ax.set_yticks(range(len(names)), names)
    for i in range(len(names)):
        for j in range(len(names)):
            if np.isfinite(conf_n[i, j]):
                ax.text(
                    j,
                    i,
                    f"{conf_n[i, j]:.2f}",
                    ha="center",
                    va="center",
                    fontsize=8,
                    color="w" if conf_n[i, j] < 0.5 else "k",
                )
    ax.set_xlabel("decoded behavior")
    ax.set_ylabel("true behavior")
    fig.colorbar(im, ax=ax, label="fraction of true-behavior frames")
    save_fig(fig, out / "26_decoder_social_confusion.png")

    print("\nFigure (classification):")
    save_fig(cabana.plots.plot_classification(cls), out / "27_classification.png")

    print("\nFigures (parameter choice):")
    smoothing_choice(session, selections, out, 100 if args.quick else 300, args.quick)

    print("\nGround-truth recovery (fraction significant, raw p-values, alpha=0.05):")
    print(summary.to_string(index=False, float_format=lambda v: f"{v:.2f}"))
    print("\nGLM unique contributions (population pipeline, Poisson, held-out blocks):")
    print(glm_table(session, glm).to_string(index=False, float_format=lambda v: f"{v:.2f}"))
    print("\nDecoder accuracy vs null (label_shuffle):")
    print(
        pd.DataFrame(
            {
                "state": dec.state_names,
                "balanced_acc": dec.values,
                "null_hi": dec.shuffle.null_hi,
                "p": dec.shuffle.p_value,
            }
        ).to_string(index=False, float_format=lambda v: f"{v:.3f}")
    )
    print(
        "\nRecovery by analysis (relevant vs untuned = false-positive rate; raw p-values and, "
        "in the *_adj columns, the max_stat-adjusted ones for the cell x state analyses):"
    )
    print(chosen_parameters_line(selections, grid_bin_size(session.states["position"].topology)[0]))
    print(
        recovery_table(session, results).to_string(index=False, float_format=lambda v: f"{v:.2f}")
    )
    print("\nEvidence-first views (docs/PLOTS.md):")
    n_views = evidence_first_views(session, results, ic_pos, out)
    print(f"  {n_views} figures written to {out}/all, {out}/cards and {out}")

    print("\nPhase E: confound-resistant nulls and new metrics (docs/STATISTICS.md):")
    phase_e_section(session, out, args.quick)

    print("\nPhase F: the front door and the headless path")
    front_door_section(session, out, args.quick)

    print(f"\nTotal runtime: {time.perf_counter() - t0:.1f} s. Outputs in {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
