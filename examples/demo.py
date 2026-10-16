"""End-to-end CaBaNA demo on a simulated session with planted ground truth.

One pipeline runs the *same* metric code and the *same* circular-shift engine on
a 2D spatial grid, on scored social bouts, and on behavioral syllables.  The
second increment adds, on the same session: PETHs, mean activity per state,
speed correlation, a population pipeline on re-binned data (PCA, decoding, GLM),
a comparison of null distributions, overlap and clustering of response classes,
and a small cohort / cross-session check.

    python examples/demo.py            # full run (1000 shuffles)
    python examples/demo.py --quick    # well under a minute
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
            {"name": "bin_grid", "signals": ["x", "y"], "bin_size": 20.0, "output": "position",
             "extent": [(0.0, 400.0), (0.0, 400.0)]},
            {"name": "bouts_to_states", "source": "social", "output": "social"},
            {"name": "labels_to_states", "source": "syllables", "output": "syllables"},
        ],
        preprocess=[{"name": "speed_threshold", "min_speed": 20.0}],
        analyses=[
            AnalysisSpec(metric={"name": "information_content", "smooth_sigma_bins": 1.0},
                         states="position", shuffle=shuf, masks=["speed"]),
            AnalysisSpec(metric={"name": "split_half_stability", "smooth_sigma_bins": 1.0},
                         states="position", shuffle=shuf, masks=["speed"]),
            AnalysisSpec(metric={"name": "pv_stability"}, states="position",
                         shuffle=shuf, masks=["speed"]),
            # NOT speed-filtered: huddling is stationary.
            AnalysisSpec(metric={"name": "auroc"}, states="social",
                         shuffle=shuf, masks=["social_scored"]),
            AnalysisSpec(metric={"name": "population_vector_overlap"}, states="social",
                         shuffle=None, masks=["social_scored"]),
            # 'still' is a syllable we want to keep, so no speed mask.
            AnalysisSpec(metric={"name": "information_content"}, states="syllables",
                         shuffle=shuf, masks=[]),
            AnalysisSpec(metric={"name": "auroc"}, states="syllables",
                         shuffle=shuf, masks=[]),
            # --- second increment: more analyses on the SAME states and masks ---
            # mean activity in each behavior minus out-of-behavior (0 = no preference)
            AnalysisSpec(metric={"name": "mean_per_state", "statistic": "difference"},
                         states="social", shuffle=shuf, masks=["social_scored"]),
            # peri-event time histogram around bout onsets (bouts >= 1.5 s, >= 1 s apart)
            AnalysisSpec(
                metric={"name": "peth", "pre_s": 4.0, "post_s": 4.0, "baseline_s": (-4.0, -1.0),
                        "response_s": (0.0, 1.5), "min_duration_s": 1.5, "min_gap_s": 1.0},
                states="social", shuffle=shuf, masks=["social_scored"]),
            # a continuous target instead of a state space: speed (+/- 2 s cross-correlation)
            AnalysisSpec(metric={"name": "signal_correlation", "max_lag_s": 2.0},
                         signal="speed", shuffle=shuf, masks=[]),
        ],
    )


def build_population_pipeline(n_pca: int, n_decode: int) -> Pipeline:
    """Second pipeline: re-bin to 0.5 s, build a design matrix, run population analyses."""
    null = {"name": "label_shuffle", "block_s": 5.0}
    return Pipeline(
        preprocess=[
            {"name": "rebin_time", "bin_s": 0.5},
            {"name": "design_matrix", "states": ["social"], "signals": ["speed"],
             "basis": {"n_basis": 4, "pre_s": 1.0, "post_s": 3.0}},
        ],
        analyses=[
            AnalysisSpec(metric={"name": "pca_population"}, states="social", masks=["social_scored"],
                         shuffle=ShuffleConfig(n_shuffles=n_pca, null=null, seed=0)),
            AnalysisSpec(metric={"name": "decode_states"}, states="social", masks=["social_scored"],
                         shuffle=ShuffleConfig(n_shuffles=n_decode, null=null, seed=0)),
            AnalysisSpec(metric={"name": "glm_encoding"}, signal="design", masks=["social_scored"],
                         shuffle=None),
        ],
    )


def nulls_compared(session, n_shuffles: int) -> pd.DataFrame:
    """Same AUROC analysis, three nulls: only the ShuffleConfig(null=...) line changes."""
    gt = session.meta["ground_truth"]
    social = gt["social_cells"]
    ci = np.array([d["cell"] for d in social])
    untuned = list(gt["untuned_cells"])
    nulls = {
        "circular_shift": {"name": "circular_shift", "min_shift_s": 20.0},
        "label_shuffle": {"name": "label_shuffle", "block_s": 2.0},
        "bout_shuffle": {"name": "bout_shuffle"},
    }
    rows = []
    for label, null in nulls.items():
        t = time.perf_counter()
        pipe = Pipeline(analyses=[AnalysisSpec(
            metric={"name": "auroc"}, states="social", masks=["social_scored"],
            shuffle=ShuffleConfig(n_shuffles=n_shuffles, null=null, seed=0))])
        _, res = pipe.run(session)
        r = res.get("auroc", "social")
        sig = np.asarray(r.shuffle.significant, bool)
        own = [r.state_names.index(d["behavior"]) for d in social]
        rows.append({
            "null": label,
            "frac_social_detected_own_behavior": float(sig[ci, own].mean()),
            "untuned_FPR_per_state": float(sig[untuned].mean()),
            "runtime_s": time.perf_counter() - t,
        })
    return pd.DataFrame(rows)


def recovery_table(session, results, alpha: float = 0.05) -> pd.DataFrame:
    """Per (metric, states): detection in relevant cells, false positives in untuned cells."""
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
            "metric": r.metric, "target": r.target, "relevant": pop,
            "n_relevant": len(cells),
            "frac_sig_relevant": float(any_sig[cells].mean()),
            "frac_sig_untuned (FPR)": float(any_sig[untuned].mean()),
            "frac_sig_own_state": np.nan, "sign_match": np.nan,
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
    return pd.DataFrame([{
        "frac_social_top_group_is_own_behavior": float(np.mean(top[ci] == np.array(want))),
        "frac_place_top_group_is_speed": speed_top,
        "median_dev_explained_social": float(np.nanmedian(de[ci])),
        "median_dev_explained_untuned": float(np.nanmedian(de[untuned])),
    }])


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
    ap.add_argument("--quick", action="store_true",
                    help="duration 300 s, 80 cells, 200 shuffles")
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

    t0 = time.perf_counter()
    session = simulate_session(**sim_kw)
    print(describe_ground_truth(session), "\n")

    pipe = build_pipeline(n_shuffles)
    t1 = time.perf_counter()
    session, results = pipe.run(session, progress=True)
    print(f"\nPipeline runtime: {time.perf_counter() - t1:.1f} s ({n_shuffles} shuffles)\n")

    # --- save tables / provenance ---
    df = results.to_dataframe()
    df.to_csv(out / "results.csv", index=False)
    try:
        (out / "pipeline.yaml").write_text(pipe.to_yaml())
    except ImportError:
        (out / "pipeline.json").write_text(json.dumps(pipe.to_dict(), indent=2, default=str))
    (out / "ground_truth.json").write_text(json.dumps(session.meta["ground_truth"], indent=2))

    # --- figures ---
    gt = session.meta["ground_truth"]
    ic_pos = results.get("information_content", "position")
    sh_pos = results.get("split_half_stability", "position")
    au_soc = results.get("auroc", "social")
    au_syl = results.get("auroc", "syllables")
    pvo = results.get("population_vector_overlap", "social")

    print("Figures:")
    save_fig(cabana.plots.plot_behavior_overview(session), out / "01_behavior_overview.png")

    place = np.array(gt["place_cells"])
    top = place[np.argsort(-ic_pos.values[place])[:12]]
    untuned = np.array(gt["untuned_cells"])[:6]
    save_fig(cabana.plots.plot_rate_maps(session, ic_pos, list(top)), out / "02_rate_maps_place.png")
    save_fig(cabana.plots.plot_rate_maps(session, ic_pos, list(untuned)),
             out / "03_rate_maps_untuned.png")

    fig, axes = plt.subplots(1, 2, figsize=(10, 3.8), layout="constrained")
    cabana.plots.plot_shuffle_distribution(ic_pos, int(top[0]), ax=axes[0])
    cabana.plots.plot_shuffle_distribution(ic_pos, int(untuned[0]), ax=axes[1])
    save_fig(fig, out / "04_shuffle_distribution.png")

    save_fig(cabana.plots.plot_tuning_heatmap(au_soc, sort_by="peak"), out / "05_tuning_social.png")
    save_fig(cabana.plots.plot_tuning_heatmap(au_syl, sort_by="peak"),
             out / "06_tuning_syllables.png")
    save_fig(cabana.plots.plot_metric_scatter(ic_pos, sh_pos), out / "07_info_vs_stability.png")
    save_fig(cabana.plots.plot_population_matrix(pvo, vmin=-1, vmax=1),
             out / "08_pv_overlap_social.png")
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
    print(f"  re-binned: {session.n_time} -> {binned.n_time} frames at {binned.fs:g} Hz; "
          f"runtime {time.perf_counter() - t2:.1f} s")
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
    print("\nOverlap of place cells (information_content significant) and social-responsive "
          "cells (auroc significant in any state):")
    print(ov)
    feats, fnames, kept = response_features(
        results, which=[("auroc", "social"), ("mean_per_state", "social")])
    clusters = response_clusters(feats, k=None, k_range=(2, 6))
    pop_label = np.full(session.n_cells, "other", dtype=object)
    pop_label[list(gt["place_cells"])] = "place"
    pop_label[list(gt["syllable_cells"][i]["cell"] for i in range(len(gt["syllable_cells"])))] = "syllable"
    pop_label[list(gt["untuned_cells"])] = "untuned"
    for d in gt["social_cells"]:
        pop_label[d["cell"]] = f"social_{d['sign']}"
    comp = pd.crosstab(pd.Series(clusters.labels, name="cluster"),
                       pd.Series(pop_label[kept], name="planted population"))
    sizes = np.bincount(clusters.labels)
    print(f"\nResponse clusters: k={clusters.k} chosen by silhouette "
          f"({ {k_: round(v, 2) for k_, v in clusters.scores.items()} }); sizes {sizes.tolist()}")
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
        ic_pos, ic_s1, ident, n_shuffles=200,
        states=(session.states["position"], extra_sessions["s1"].states["position"]))
    print("\nCross-session map correlation, s0 vs s1 with an identity (wrong) match "
          "[negative control, expect ~0 and p_population not small]:")
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
    save_fig(cabana.plots.plot_event_raster(session, pe, top_cell, top_state,
                                            mask=session.valid_mask(["social_scored"])),
             out / "11_event_raster_top_social_cell.png")
    save_fig(cabana.plots.plot_tuning_heatmap(mps_res, sort_by="peak"),
             out / "12_mean_per_state_social.png")
    place_arr = np.array(gt["place_cells"])
    pc = int(place_arr[np.nanargmax(np.abs(sc.values[place_arr]))])
    fig, axes = plt.subplots(1, 2, figsize=(10, 3.8), layout="constrained")
    cabana.plots.plot_shuffle_distribution(sc, pc, ax=axes[0])
    axes[0].set_title(f"speed correlation, place cell {pc}")
    cabana.plots.plot_shuffle_distribution(sc, int(untuned[0]), ax=axes[1])
    axes[1].set_title(f"speed correlation, untuned cell {int(untuned[0])}")
    save_fig(fig, out / "13_speed_correlation_shuffle.png")
    save_fig(cabana.plots.plot_population_matrix(pca, cmap="magma"), out / "14_pca_distances_social.png")
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

    print("\nGround-truth recovery (fraction significant, alpha=0.05):")
    print(summary.to_string(index=False, float_format=lambda v: f"{v:.2f}"))
    print("\nGLM unique contributions (population pipeline, Poisson, held-out blocks):")
    print(glm_table(session, glm).to_string(index=False, float_format=lambda v: f"{v:.2f}"))
    print("\nDecoder accuracy vs null (label_shuffle):")
    print(pd.DataFrame({"state": dec.state_names, "balanced_acc": dec.values,
                        "null_hi": dec.shuffle.null_hi, "p": dec.shuffle.p_value})
          .to_string(index=False, float_format=lambda v: f"{v:.3f}"))
    print("\nRecovery by analysis (relevant vs untuned = false-positive rate):")
    print(recovery_table(session, results).to_string(index=False, float_format=lambda v: f"{v:.2f}"))
    print(f"\nTotal runtime: {time.perf_counter() - t0:.1f} s. Outputs in {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
