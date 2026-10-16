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

Outputs in --out: results.csv, results.zip and session.zip (reload with
`cabana.ResultSet.load` / `cabana.Session.load`), nulls_compared.csv, levels_sweep.csv, provenance
files and figures 01 to 26 (20 to 26 are the amplitude / decoding figures).
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

import cabana  # noqa: E402
from cabana import (  # noqa: E402
    AnalysisSpec,
    CellMatch,
    Pipeline,
    ShuffleConfig,
    cohort_table,
    cross_session_map_correlation,
    fraction_significant_by_animal,
    overlap_vs_chance,
    remapping_summary,
    response_clusters,
    response_features,
    significant_cells,
    simulate_session,
)


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


def build_pipeline(n_shuffles: int) -> Pipeline:
    shuf = ShuffleConfig(n_shuffles=n_shuffles, min_shift_s=20.0, seed=0)
    return Pipeline(
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
                metric={"name": "information_content", "smooth_sigma_bins": 1.0},
                states="position",
                shuffle=shuf,
                masks=["speed"],
            ),
            AnalysisSpec(
                metric={"name": "split_half_stability", "smooth_sigma_bins": 1.0},
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
            AnalysisSpec(metric={"name": "auroc"}, states="social", shuffle=shuf),
            AnalysisSpec(
                metric={"name": "population_vector_overlap"},
                states="social",
                shuffle=None,
            ),
            # 'still' is a syllable we want to keep, so no speed mask (support = labelled span).
            AnalysisSpec(metric={"name": "information_content"}, states="syllables", shuffle=shuf),
            AnalysisSpec(metric={"name": "auroc"}, states="syllables", shuffle=shuf),
            AnalysisSpec(metric={"name": "mutual_information"}, states="syllables", shuffle=shuf),
            # --- second increment: more analyses on the SAME states and masks ---
            # mean activity in each behavior minus out-of-behavior (0 = no preference)
            AnalysisSpec(
                metric={"name": "mean_per_state", "statistic": "difference"},
                states="social",
                shuffle=shuf,
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
                shuffle=shuf,
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
    """Detection and false-positive rate versus number of activity levels and duration."""
    durations = (300.0, 600.0) if quick else (300.0, 600.0, 1200.0)
    n_shuf = 50 if quick else 100
    levels = (2, 3, 5, 8)
    shuf = ShuffleConfig(n_shuffles=n_shuf, min_shift_s=20.0, seed=0)
    prep = build_pipeline(1)
    prep = Pipeline(transforms=prep.transforms, preprocess=prep.preprocess, analyses=[])
    rows = []
    for dur in durations:
        t = time.perf_counter()
        kw = {"duration_s": dur, "seed": seed}
        if quick:
            kw["n_cells"] = 80
        sess, _ = prep.run(simulate_session(**kw))
        gt = sess.meta["ground_truth"]
        rel, unt = list(gt["place_cells"]), list(gt["untuned_cells"])
        specs = [
            AnalysisSpec(
                metric={"name": "information_content", "smooth_sigma_bins": 1.0},
                states="position",
                shuffle=shuf,
                masks=["speed"],
            )
        ]
        _, res = Pipeline(analyses=specs).run(sess)
        sig = np.asarray(res.get("information_content", "position").shuffle.p_value) < 0.05
        for k in levels:  # Skaggs information does not depend on levels: a flat reference line
            rows.append(
                {
                    "metric": "skaggs_information",
                    "n_levels": k,
                    "duration_s": dur,
                    "detection": float(sig[rel].mean()),
                    "fpr": float(sig[unt].mean()),
                    "n_relevant": len(rel),
                    "n_untuned": len(unt),
                }
            )
        for k in levels:
            spec = AnalysisSpec(
                metric={"name": "mutual_information", "n_levels": k},
                states="position",
                shuffle=shuf,
                masks=["speed"],
            )
            _, res = Pipeline(analyses=[spec]).run(sess)
            sig = np.asarray(res.get("mutual_information", "position").shuffle.p_value) < 0.05
            rows.append(
                {
                    "metric": "mutual_information",
                    "n_levels": k,
                    "duration_s": dur,
                    "detection": float(sig[rel].mean()),
                    "fpr": float(sig[unt].mean()),
                    "n_relevant": len(rel),
                    "n_untuned": len(unt),
                }
            )
        print(f"  {dur:g} s session: {time.perf_counter() - t:.1f} s")
    return pd.DataFrame(rows)


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
    """Per analysis (metric and target): detection in relevant cells, false positives in untuned cells."""
    gt = session.meta["ground_truth"]
    social = gt["social_cells"]
    pops = {
        "position": ("place", list(gt["place_cells"])),
        "social": ("social", [d["cell"] for d in social]),
        "syllables": ("syllable", [d["cell"] for d in gt["syllable_cells"]]),
        "speed": ("place (speed-gated)", list(gt["place_cells"])),
    }
    untuned = list(gt["untuned_cells"])
    rows = []
    for r in results:
        if r.level != "cell" or r.shuffle is None:
            continue
        sig = np.asarray(r.shuffle.p_value) < alpha
        any_sig = sig if sig.ndim == 1 else sig.any(axis=1)
        pop, cells = pops[r.target]
        row = {
            "analysis": r.name,
            "relevant": pop,
            "n_relevant": len(cells),
            "frac_sig_relevant": float(any_sig[cells].mean()),
            "frac_sig_untuned (FPR)": float(any_sig[untuned].mean()),
            "frac_sig_own_state": np.nan,
            "sign_match": np.nan,
        }
        if r.metric in ("auroc", "mean_per_state", "peth") and r.target == "social":
            own = [r.state_names.index(d["behavior"]) for d in social]
            ci = np.array([d["cell"] for d in social])
            own_sig = sig[ci, own]
            auc = np.asarray(r.values)[ci, own]
            excited = np.array([d["sign"] == "excited" for d in social])
            ref = 0.5 if r.metric == "auroc" else 0.0  # chance level of the statistic
            with np.errstate(invalid="ignore"):
                match = np.where(excited, auc > ref, auc < ref)
            row["frac_sig_own_state"] = float(own_sig.mean())
            row["sign_match"] = float(match[own_sig].mean()) if own_sig.any() else np.nan
        elif r.metric == "auroc" and r.target == "syllables":
            sy = gt["syllable_cells"]
            ci = np.array([d["cell"] for d in sy])
            own = [r.state_names.index(d["syllable"]) for d in sy]
            row["frac_sig_own_state"] = float(sig[ci, own].mean())
            auc = np.asarray(r.values)[ci, own]
            own_sig = sig[ci, own]
            row["sign_match"] = float((auc[own_sig] > 0.5).mean()) if own_sig.any() else np.nan
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

    print(f"CaBaNA {cabana.__version__}")
    t0 = time.perf_counter()
    session = simulate_session(**sim_kw)
    print(describe_ground_truth(session), "\n")

    pipe = build_pipeline(n_shuffles)
    t1 = time.perf_counter()
    session, results = pipe.run(session, progress=True)
    print(f"\nPipeline runtime: {time.perf_counter() - t1:.1f} s ({n_shuffles} shuffles)\n")

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

    # --- post hoc: overlap and clusters ---
    ic_sig = significant_cells(ic_pos)
    soc_sig = significant_cells(au_soc)
    ov = overlap_vs_chance(ic_sig, soc_sig)
    print(
        "\nOverlap of place cells (information_content significant) and social-responsive "
        "cells (auroc significant in any state):"
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
    sizes = np.bincount(clusters.labels)
    print(
        f"\nResponse clusters: k={clusters.k} chosen by silhouette "
        f"({ {k_: round(v, 2) for k_, v in clusters.scores.items()} }); sizes {sizes.tolist()}"
    )
    print(comp.to_string())

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
    sweep = levels_sweep(args.seed, args.quick)
    sweep.to_csv(out / "levels_sweep.csv", index=False)
    print(
        sweep.pivot_table(
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
    save_fig(cabana.plots.plot_level_sweep(sweep), out / "23_level_sweep.png")
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

    print("\nGround-truth recovery (fraction significant, alpha=0.05):")
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
    print("\nRecovery by analysis (relevant vs untuned = false-positive rate):")
    print(
        recovery_table(session, list(results)).to_string(
            index=False, float_format=lambda v: f"{v:.2f}"
        )
    )
    print(f"\nTotal runtime: {time.perf_counter() - t0:.1f} s. Outputs in {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
