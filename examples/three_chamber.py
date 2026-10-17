"""Three-chamber social walkthrough: from a session folder to results and figures.

Starts from a real-world-shaped session folder (activity, two clocks, position, head
orientation quaternions, annotated epochs, a ``session.yaml`` saying what is what) and ends
at a results table, cell classes and figures:

    1. load the folder with ``cabana.loaders.load_session_dir`` and print both clocks' timing
    2. behaviour overview figure (trajectory, zones, cups, head direction, timelines)
    3. derive zones and investigation from the geometry and compare them with the hand
       annotations (frame agreement and bout counts)
    4. cell QC with ``select_cells`` (before / after, dropped ids)
    5. one pipeline: investigation (auroc, mean activity, PETH), place coding (information,
       split-half stability on a 5 cm grid, moving frames only) and zone information
    6. figures 02 to 06, results.csv / results.zip / session.zip / selections.json

    python examples/three_chamber.py                       # the fixture, about 1 minute
    python examples/three_chamber.py --quick               # 50 shuffles
    python examples/three_chamber.py --session my_session --out my_out

To run on your own data: write a ``session.yaml`` from the template
(``cabana.loaders.write_session_dir_template``), point ``--session`` at the folder, and adjust
the zones and enclosures (and the state names used below if yours differ).
"""

from __future__ import annotations

import argparse
import json
import time
import warnings
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib.patches import Circle, Rectangle  # noqa: E402

import cabana  # noqa: E402
from cabana import AnalysisSpec, Pipeline, ShuffleConfig, build  # noqa: E402
from cabana.loaders import load_session_dir  # noqa: E402

FIXTURE = Path(__file__).resolve().parents[1] / "tests" / "data" / "simulated_3chamber"
# which investigation state (annotated) corresponds to which enclosure (geometry-derived)
PAIR = {"left_cup": "investigate_stimulus", "right_cup": "investigate_empty"}


def save_fig(fig, path: Path) -> None:
    fig.savefig(path, dpi=130, bbox_inches="tight")
    plt.close(fig)
    print(f"  wrote {path}")


def _bout_match(pred, ref, tol: float) -> int:
    """Number of ``pred`` bouts with a ``ref`` bout whose start and stop are both within tol s."""
    return sum(
        any(abs(a - c) <= tol and abs(b - d) <= tol for c, d in zip(*ref, strict=True))
        for a, b in zip(*pred, strict=True)
    )


def agreement(ses, geo_name: str, ann_name: str, tol: float = 0.5) -> pd.DataFrame:
    """Frame agreement and bout counts of a derived state space against an annotated one."""
    from cabana import states_to_bouts

    geo, ann = ses.states[geo_name], ses.states[ann_name]
    gb = states_to_bouts(geo, ses.fs, t0=ses.t[0])
    ab = states_to_bouts(ann, ses.fs, t0=ses.t[0])
    ok = geo.support & ann.support
    rows = []
    for tgt, lab in PAIR.items():
        g = geo.onehot[:, geo.state_names.index(tgt)]
        a = ann.onehot[:, ann.state_names.index(lab)]
        gi = [i for i, n in enumerate(gb.labels) if n == tgt]
        ai = [i for i, n in enumerate(ab.labels) if n == lab]
        gs, as_ = (gb.start_s[gi], gb.stop_s[gi]), (ab.start_s[ai], ab.stop_s[ai])
        rows.append(
            {
                "enclosure": tgt,
                "annotation": lab,
                "frame_agreement": float((g[ok] == a[ok]).mean()),
                "frames_geometry": int(g[ok].sum()),
                "frames_annotated": int(a[ok].sum()),
                "bouts_geometry": len(gi),
                "bouts_annotated": len(ai),
                "geometry_bouts_found_in_annotation": _bout_match(gs, as_, tol),
                "annotated_bouts_found_in_geometry": _bout_match(as_, gs, tol),
            }
        )
    return pd.DataFrame(rows)


def zone_agreement(ses, geo_name: str, ann_name: str) -> float:
    z, a = ses.states[geo_name], ses.states[ann_name]
    cols = [a.state_names.index(n) for n in z.state_names]
    ao = a.onehot[:, cols]
    cover = z.support & a.support & ao.any(axis=1) & z.onehot.any(axis=1)
    return float((ao[cover] == z.onehot[cover]).all(axis=1).mean())


def overview_figure(ses, geo_name: str = "investigation_geo"):
    """Trajectory with zones, cups and head arrows, then timelines of zones and investigation."""
    arena = ses.meta["arena"]
    x, y, hd = ses.signals["x"], ses.signals["y"], ses.signals["head_direction"]
    fig = plt.figure(figsize=(11, 7.5), constrained_layout=True)
    gs = fig.add_gridspec(3, 2, height_ratios=[2.6, 1, 1], width_ratios=[1, 0.0001])
    ax = fig.add_subplot(gs[0, 0])
    w, h = arena["size"]
    zc = {"left": "#4c78a8", "center": "#bab0ac", "right": "#f58518"}
    for name, (x0, y0, x1, y1) in arena["zones"].items():
        ax.add_patch(Rectangle((x0, y0), x1 - x0, y1 - y0, fc=zc.get(name, "0.9"), alpha=0.18))
        ax.text((x0 + x1) / 2, h + 0.8, name, ha="center", va="bottom", fontsize=9)
    for name, e in arena["enclosures"].items():
        cx, cy = e["center"]
        ax.add_patch(Circle((cx, cy), e["radius"], fc="none", ec="k", lw=1.5, ls="--"))
        ax.text(cx, cy, f"{name}\n({e.get('contents', '')})", ha="center", va="center", fontsize=8)
    sc = ax.scatter(x, y, c=ses.t, s=2, cmap="viridis", zorder=3)
    k = np.arange(0, ses.n_time, 20)
    k = k[np.isfinite(x[k]) & np.isfinite(y[k]) & np.isfinite(hd[k])]
    ax.quiver(x[k], y[k], np.cos(hd[k]), np.sin(hd[k]), angles="xy", scale_units="xy",
              scale=0.45, width=0.003, color="crimson", alpha=0.7, zorder=4)  # fmt: skip
    ax.set_xlim(-10, w + 10)
    ax.set_ylim(-1, h + 5)
    ax.set_aspect("equal")
    ax.set_xlabel("x (cm)")
    ax.set_ylabel("y (cm)")
    ax.set_title(
        "Trajectory (colour = time), zones, enclosures, head direction (red, every 20th frame)"
    )
    fig.colorbar(sc, ax=ax, label="time (s)", shrink=0.7, pad=0.01)

    def strip(ax, space, title):
        oh = space.onehot
        for i in range(len(space.state_names)):
            on = oh[:, i] & space.support
            ax.fill_between(ses.t, i, i + 0.8, where=on, step="mid", color=f"C{i}")
        ax.set_yticks(np.arange(len(space.state_names)) + 0.4, space.state_names, fontsize=8)
        ax.set_ylim(0, len(space.state_names))
        ax.set_xlim(ses.t[0], ses.t[-1])
        ax.set_title(title, fontsize=9, loc="left")

    strip(fig.add_subplot(gs[1, 0]), ses.states["zones"], "annotated zones")
    ax3 = fig.add_subplot(gs[2, 0])
    ann, geo = ses.states["investigation"], ses.states[geo_name]
    for i, (n, sp, c) in enumerate(
        [
            ("annotated: stimulus", ann, "C3"),
            ("annotated: empty", ann, "C4"),
            ("geometry: left_cup", geo, "C3"),
            ("geometry: right_cup", geo, "C4"),
        ]  # fmt: skip
    ):
        key = n.split(": ")[1]
        key = {"stimulus": "investigate_stimulus", "empty": "investigate_empty"}.get(key, key)
        on = sp.onehot[:, sp.state_names.index(key)] & sp.support
        ax3.fill_between(ses.t, 3 - i, 3 - i + 0.8, where=on, step="mid", color=c,
                         alpha=1.0 if n.startswith("annotated") else 0.6)  # fmt: skip
    ax3.set_yticks([3.4, 2.4, 1.4, 0.4], ["annotated: stimulus", "annotated: empty",
                                           "geometry: left_cup", "geometry: right_cup"], fontsize=8)  # fmt: skip
    ax3.set_xlim(ses.t[0], ses.t[-1])
    ax3.set_xlabel("time (s)")
    ax3.set_title("investigation: hand annotations vs the geometry rule", fontsize=9, loc="left")
    return fig


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--session", type=Path, default=FIXTURE,
                    help="folder holding session.yaml (default: the simulated three-chamber fixture)")  # fmt: skip
    ap.add_argument("--out", type=Path, default=Path("examples/output_three_chamber"))
    ap.add_argument("--quick", action="store_true", help="50 shuffles instead of 200")
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args(argv)
    n_shuffles = 50 if args.quick else 200
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)
    pd.set_option("display.width", 200)
    pd.set_option("display.max_columns", 20)
    t_start = time.perf_counter()

    # ---- 1. load -------------------------------------------------------------------------
    print(f"== 1. Load {args.session}")
    ses = load_session_dir(args.session)
    for clock, rep in ses.meta["timing"].items():
        print(
            f"  {clock:8s} frames={rep['n_frames']}  fs_mean={rep['fs_mean']:.3f} Hz  "
            f"dropped={rep['n_dropped_frames']} ({rep['dropped_fraction']:.2%})  "
            f"jitter_sd={rep['jitter_sd_s'] * 1000:.2f} ms  first_t={rep['first_t']:.3f} s"
        )
    print("session.info:", ses.info)
    arena = ses.meta["arena"]
    print("arena:", {k: arena[k] for k in ("size", "units", "zones", "enclosures")})
    print(f"activity: {ses.n_cells} cells x {ses.n_time} frames, kind={ses.activity_kind}")
    print("\ncell_qc_table(session).describe():")
    print(cabana.cell_qc_table(ses).describe().round(3))
    print("\nstates in the session:", {k: v.state_names for k, v in ses.states.items()})

    # ---- 3. geometry-derived behaviour (before the overview, which draws it) --------------
    print("\n== 3. Behaviour derived from geometry vs hand annotations")
    ses = build("transform", {"name": "speed"}).apply(ses)
    ses = build(
        "transform",
        {"name": "zone_occupancy", "signal": "", "zones_from_meta": True, "output": "zones_geo"},
    ).apply(ses)
    ses = build(
        "transform", {"name": "investigation_from_geometry", "output": "investigation_geo"}
    ).apply(ses)
    print(
        f"zones: geometry vs annotated frame agreement = {zone_agreement(ses, 'zones_geo', 'zones'):.4f}"
    )
    ag = agreement(ses, "investigation_geo", "investigation")
    print(ag.round(4).to_string(index=False))
    print("(a bout counts as found when its start and stop are both within 0.5 s)")

    # ---- 2. overview ---------------------------------------------------------------------
    print("\n== 2. Figures")
    save_fig(overview_figure(ses), out / "01_behavior_overview.png")

    # ---- 4. QC ---------------------------------------------------------------------------
    print("\n== 4. Cell QC")
    qc = cabana.cell_qc_table(ses)
    thr = float(np.round(qc["mean_rate_hz"].quantile(0.05), 2))
    qc_step = {"name": "select_cells", "min_rate_hz": thr, "min_fraction_finite": 0.9,
               "keep_at_least": 10}  # fmt: skip
    qc_ses = build("preprocess", qc_step).apply(ses)
    sel = qc_ses.meta["cell_selection"]
    print(f"min_rate_hz >= {thr} Hz and fraction_finite >= 0.9: "
          f"{sel['n_before']} -> {sel['n_after']} cells")  # fmt: skip
    print("dropped ids:", sel["dropped_ids"])

    # ---- 5. pipeline ---------------------------------------------------------------------
    print(f"\n== 5. Pipeline ({n_shuffles} shuffles)")
    shuf = ShuffleConfig(n_shuffles=n_shuffles, min_shift_s=20.0, seed=args.seed,
                         correction="max_stat")  # fmt: skip
    bout = ShuffleConfig(n_shuffles=n_shuffles, null={"name": "bout_shuffle"}, seed=args.seed,
                         correction="max_stat")  # fmt: skip
    circ = ShuffleConfig(n_shuffles=n_shuffles, min_shift_s=20.0, seed=args.seed)
    w, h = arena["size"]
    pipe = Pipeline(
        selectors=[{"name": "auto_null_timescale"}],
        transforms=[
            {
                "name": "bin_grid",
                "signals": ["x", "y"],
                "bin_size": 5.0,
                "output": "position",
                "extent": [(0.0, float(w)), (0.0, float(h))],
            },
        ],  # fmt: skip
        preprocess=[
            {"name": "timing_check"},
            {"name": "trim_to_overlap", "signals": ["position_covered", "head_covered"]},
            qc_step,
            {"name": "speed_threshold", "min_speed": 2.0},
        ],
        analyses=[
            AnalysisSpec(metric={"name": "auroc"}, states="investigation", shuffle=bout),
            AnalysisSpec(
                metric={"name": "mean_per_state", "statistic": "difference"},
                states="investigation",
                shuffle=bout,
            ),  # fmt: skip
            AnalysisSpec(
                metric={
                    "name": "peth",
                    "pre_s": 4.0,
                    "post_s": 4.0,
                    "baseline_s": (-4.0, -1.0),
                    "response_s": (0.0, 1.5),
                    "min_duration_s": 1.0,
                    "min_gap_s": 1.0,
                },
                states="investigation",
                shuffle=shuf,
            ),  # fmt: skip
            AnalysisSpec(
                metric={"name": "information_content"},
                states="position",
                shuffle=circ,
                masks=["speed"],
            ),  # fmt: skip
            AnalysisSpec(
                metric={"name": "split_half_stability"},
                states="position",
                shuffle=circ,
                masks=["speed"],
            ),  # fmt: skip
            AnalysisSpec(metric={"name": "mutual_information"}, states="zones_geo", shuffle=shuf),
        ],
    )
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        session, rs = pipe.run(ses, progress=False)
    print(f"{session.n_cells} cells x {session.n_time} frames after preprocessing")
    df = rs.to_dataframe()
    rows = []
    for name in rs.names():
        d = df[df["analysis"] == name]
        # cells significant in at least one state (raw p, and corrected across states)
        row = {"analysis": name, "n_cells": d["cell"].nunique(),
               "n_significant_raw": int(d.groupby("cell")["significant"].any().sum())}  # fmt: skip
        if "significant_adj" in d:
            row["n_significant_adjusted"] = int(d.groupby("cell")["significant_adj"].any().sum())
        rows.append(row)
    summary = pd.DataFrame(rows)
    print("cells significant in at least one state, raw and corrected across states (max_stat):")
    print(summary.to_string(index=False))
    print("\nselections (values chosen from the data, never from p-values):")
    for s in rs.selections:
        print(f"  {s['path']} = {s['value']}  [{s['method']}]")
    msgs = sorted({str(c.message)[:160] for c in caught})
    print(f"\nwarnings ({len(msgs)} distinct):")
    for m in msgs:
        print("  -", m)

    # ---- 6. figures ----------------------------------------------------------------------
    au = rs["auroc[investigation]"]
    save_fig(
        cabana.plots.plot_tuning_heatmap(au, sort_by="peak"), out / "02_tuning_investigation.png"
    )
    strength = np.nanmax(np.abs(np.nan_to_num(au.values - 0.5)), axis=1)
    top3 = [int(i) for i in np.argsort(-strength)[:3]]
    fig, axes = plt.subplots(2, 3, figsize=(13, 6.5), constrained_layout=True)
    for j, c in enumerate(top3):
        k = int(np.nanargmax(np.abs(np.nan_to_num(au.values[c] - 0.5))))
        cabana.plots.plot_shuffle_distribution(au, c, state=k, ax=axes[0, j])
    ic = rs["information_content[position]"]
    # rank place-information cells: significant ones first, then by information
    order = np.lexsort((-np.nan_to_num(ic.values, nan=-np.inf), ~ic.shuffle.significant))
    top_place = [int(i) for i in order]
    for j, c in enumerate(top_place[:3]):
        cabana.plots.plot_shuffle_distribution(ic, int(c), ax=axes[1, j])
    fig.suptitle(
        "Top 3 investigation cells (auROC, top row) and top 3 place-information cells (bottom)"
    )
    save_fig(fig, out / "03_shuffle_distributions.png")
    pe = rs["peth[investigation]"]
    save_fig(cabana.plots.plot_peth(pe, session, ncols=4), out / "04_peth_investigation.png")
    top6 = top_place[:6]
    save_fig(
        cabana.plots.plot_rate_maps(session, ic, top6, ncols=3), out / "05_rate_maps_place.png"
    )

    tests = {"place_cell": cabana.place_cell_criteria("position")}
    tests.update(cabana.responsive_cell_criteria(cabana.ResultSet(results=[au]), "investigation"))
    cls = cabana.classify(rs, tests)
    print("\nClassification:", cls.counts())
    save_fig(cabana.plots.plot_classification(cls), out / "06_classification.png")

    # ---- 7. save -------------------------------------------------------------------------
    rs.save(out / "results.zip")
    session.save(out / "session.zip")
    df.to_csv(out / "results.csv", index=False)
    (out / "selections.json").write_text(json.dumps(rs.selections, indent=2, default=str))
    print(f"\nsaved results.zip, session.zip, results.csv, selections.json in {out}")

    print("\n== Summary")
    print(f"  cells: {ses.n_cells} loaded, {session.n_cells} after QC")
    print(f"  investigation: geometry vs annotation frame agreement "
          f"{ag['frame_agreement'].round(4).tolist()}")  # fmt: skip
    for r in rows:
        print(f"  {r['analysis']}: {r['n_significant_raw']} raw / "
              f"{r.get('n_significant_adjusted', 'n/a')} adjusted significant cells")  # fmt: skip
    print(f"  classes: {cls.counts()}")
    print(f"  total time {time.perf_counter() - t_start:.0f} s")
    print(
        "\nTo run on your own data:\n"
        "  1. write a session.yaml from the template: "
        "cabana.loaders.write_session_dir_template('my_session')\n"
        "     and point its file names at your activity, timestamps, position, head and "
        "annotation files\n"
        "  2. python examples/three_chamber.py --session my_session --out my_out\n"
        "  3. adjust arena.zones and arena.enclosures (cm, same frame as your position), "
        "and the PAIR mapping at the top of this script if your annotation labels differ"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
