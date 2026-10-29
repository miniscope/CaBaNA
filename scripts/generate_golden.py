"""Regenerate the golden regression files in ``tests/golden/``.

Usage (from the repo root)::

    .venv/bin/python scripts/generate_golden.py          # or: pytest tests/test_golden.py --update-golden

For each case this writes ``<case>.session.zip`` (the *processed-input* session: simulated
data only, no transforms applied), ``<case>.pipeline.yaml`` (the Pipeline, reloaded by the
test through ``Pipeline.from_yaml``) and ``<case>.results.zip`` (``ResultSet.save``), plus
``MANIFEST.json``.  Everything is seeded, so regenerating on unchanged code is a no-op up to
the manifest timestamp.

Metrics not covered (and why): none of the 15 registered metrics is skipped.  ``glm_encoding``
runs on the ``design`` signal built by the ``design_matrix`` transform; ``signal_tuning`` and
``signal_correlation`` run on the ``speed`` signal.  ``peth`` and the population metrics run on
the exclusive/overlapping ``social`` bout space.

Null coverage: ``circular_shift`` for most analyses, ``label_shuffle`` and ``bout_shuffle`` once
each (their numbers change whenever the per-surrogate seeding changes: refresh with this script),
``correction="max_stat"`` once and ``keep_null="none"`` once.
"""

from __future__ import annotations

import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path

import cabana
from cabana import Pipeline

GOLDEN_DIR = Path(__file__).resolve().parent.parent / "tests" / "golden"

N_SHUF = 50
CS = {"n_shuffles": N_SHUF, "min_shift_s": 10.0, "seed": 11}


def _sh(**kw):
    return {**CS, **kw}


_RAW = [
    {"name": "resample_signal", "source": "position"},
    {"name": "speed"},
]

CASES: dict[str, dict] = {
    # 2-D grid position space, speed mask, rebinned to 0.25 s.
    "grid": {
        "sim": {"duration_s": 180, "n_cells": 12, "seed": 3},
        "pipeline": {
            "transforms": [
                *_RAW,
                {
                    "name": "bin_grid",
                    "signals": ["x", "y"],
                    "bin_size": 100.0,
                    "output": "position",
                },
            ],
            "preprocess": [
                {"name": "speed_threshold", "min_speed": 5.0},
                {"name": "rebin_time", "bin_s": 0.25},
            ],
            "analyses": [
                {
                    "name": "info",
                    "metric": {"name": "information_content"},
                    "states": "position",
                    "masks": ["speed"],
                    "shuffle": _sh(),
                },
                {
                    "name": "info_smooth_maxstat",
                    "metric": {"name": "information_content", "smooth_sigma_bins": 1.0},
                    "states": "position",
                    "masks": ["speed"],
                    "shuffle": _sh(correction="max_stat", seed=12),
                },
                {
                    "name": "split_half",
                    "metric": {"name": "split_half_stability"},
                    "states": "position",
                    "masks": ["speed"],
                    "shuffle": _sh(),
                },
                {
                    "name": "mi",
                    "metric": {"name": "mutual_information"},
                    "states": "position",
                    "masks": ["speed"],
                    "shuffle": _sh(keep_null="none"),
                },
                {
                    "name": "mean_bh",
                    "metric": {"name": "mean_per_state"},
                    "states": "position",
                    "masks": ["speed"],
                    "shuffle": _sh(correction="bh"),
                },
                {
                    "name": "bayes",
                    "metric": {"name": "bayesian_decoder"},
                    "states": "position",
                    "masks": ["speed"],
                    "shuffle": _sh(),
                },
                {
                    "name": "decode",
                    "metric": {"name": "decode_states"},
                    "states": "position",
                    "masks": ["speed"],
                    "shuffle": _sh(),
                },
                {
                    "name": "pv_overlap",
                    "metric": {"name": "population_vector_overlap"},
                    "states": "position",
                    "masks": ["speed"],
                },
                {
                    "name": "pv_stab",
                    "metric": {"name": "pv_stability"},
                    "states": "position",
                    "masks": ["speed"],
                },
                {
                    "name": "speed_tuning",
                    "metric": {"name": "signal_tuning"},
                    "signal": "speed",
                    "masks": ["speed"],
                    "shuffle": _sh(),
                },
                {
                    "name": "speed_corr",
                    "metric": {"name": "signal_correlation"},
                    "signal": "speed",
                    "shuffle": _sh(),
                },
                {
                    "name": "info_label_shuffle",
                    "metric": {"name": "information_content"},
                    "states": "position",
                    "masks": ["speed"],
                    "shuffle": _sh(null={"name": "label_shuffle"}, seed=13),
                },
            ],
        },
    },
    # Social bouts (exclusive with rest) plus a design-matrix signal.
    "social": {
        "sim": {"duration_s": 180, "n_cells": 12, "seed": 4},
        "pipeline": {
            "transforms": [
                *_RAW,
                {"name": "bouts_to_states", "source": "social"},
                {
                    "name": "bouts_to_states",
                    "source": "social",
                    "exclusive": True,
                    "output": "social_x",
                },
                {"name": "design_matrix", "states": ["social"], "signals": ["speed"]},
            ],
            "preprocess": [],
            "analyses": [
                {
                    "name": "auroc",
                    "metric": {"name": "auroc"},
                    "states": "social",
                    "shuffle": _sh(),
                },
                {
                    "name": "auroc_bout_shuffle",
                    "metric": {"name": "auroc"},
                    "states": "social",
                    "shuffle": _sh(null={"name": "bout_shuffle"}, seed=14),
                },
                {
                    "name": "auroc_label_shuffle",
                    "metric": {"name": "auroc"},
                    "states": "social",
                    "shuffle": _sh(null={"name": "label_shuffle"}, seed=15),
                },
                {
                    "name": "mean",
                    "metric": {"name": "mean_per_state"},
                    "states": "social",
                    "shuffle": _sh(correction="bonferroni"),
                },
                {
                    "name": "mi",
                    "metric": {"name": "mutual_information"},
                    "states": "social_x",
                    "shuffle": _sh(),
                },
                {
                    "name": "peth",
                    "metric": {
                        "name": "peth",
                        "pre_s": 4.0,
                        "post_s": 4.0,
                        "baseline_s": [-4.0, -1.0],
                        "response_s": [0.0, 2.0],
                    },
                    "states": "social",
                    "shuffle": _sh(),
                },
                {
                    "name": "pv_overlap",
                    "metric": {"name": "population_vector_overlap"},
                    "states": "social",
                    "shuffle": _sh(),
                },
                {"name": "pv_stab", "metric": {"name": "pv_stability"}, "states": "social"},
                {
                    "name": "pop_dist",
                    "metric": {"name": "population_distance"},
                    "states": "social",
                    "shuffle": _sh(),
                },
                {"name": "pca", "metric": {"name": "pca_population"}, "states": "social"},
                {
                    "name": "decode",
                    "metric": {"name": "decode_states"},
                    "states": "social_x",
                    "shuffle": _sh(),
                },
                {
                    "name": "glm",
                    "metric": {"name": "glm_encoding"},
                    "signal": "design",
                    "shuffle": _sh(n_shuffles=20),
                },
            ],
        },
    },
    # Phase E: new metrics and nulls (fields, selectivity, pairwise, PR, decode_signal,
    # covariate-matched / cell-shift / within-state nulls, PETH null band).
    "phase_e": {
        "sim": {"duration_s": 180, "n_cells": 12, "seed": 6},
        "pipeline": {
            "transforms": [
                *_RAW,
                {
                    "name": "bin_grid",
                    "signals": ["x", "y"],
                    "bin_size": 100.0,
                    "output": "position",
                },
                {"name": "bouts_to_states", "source": "social"},
                {"name": "labels_to_states", "source": "syllables"},
            ],
            "preprocess": [],
            "analyses": [
                {
                    "name": "fields",
                    "metric": {"name": "place_fields", "min_field_bins": 1},
                    "states": "position",
                    "shuffle": _sh(),
                },
                {
                    "name": "selectivity",
                    "metric": {"name": "tuning_selectivity"},
                    "states": "syllables",
                    "shuffle": _sh(),
                },
                {
                    "name": "auroc_speed_matched",
                    "metric": {"name": "auroc"},
                    "states": "social",
                    "shuffle": _sh(
                        null={
                            "name": "covariate_matched_shift",
                            "covariate": "speed",
                            "statistic": "mean",
                            "tolerance": 0.5,
                            "min_frames": 100,
                            "max_tries": 100,
                            "min_shift_s": 10.0,
                        },
                        n_shuffles=20,
                        seed=16,
                    ),
                },
                {
                    "name": "pairwise",
                    "metric": {"name": "pairwise_correlation", "kind": "noise"},
                    "states": "syllables",
                    "shuffle": _sh(null={"name": "cell_shift"}, n_shuffles=20, seed=17),
                },
                {
                    "name": "pr",
                    "metric": {"name": "participation_ratio"},
                    "states": "syllables",
                    "shuffle": _sh(null={"name": "cell_shift"}, n_shuffles=20, seed=18),
                },
                {
                    "name": "split_half_within",
                    "metric": {"name": "split_half_stability"},
                    "states": "position",
                    "shuffle": _sh(null={"name": "within_state_shuffle"}, n_shuffles=20, seed=19),
                },
                {
                    "name": "decode_x",
                    "metric": {"name": "decode_signal", "n_folds": 3},
                    "signal": "x",
                    "shuffle": _sh(n_shuffles=20),
                },
                {
                    "name": "peth_band",
                    "metric": {"name": "peth", "null_band": True, "n_null": 50},
                    "states": "social",
                },
            ],
        },
    },
    # Categorical syllable labels.
    "syllables": {
        "sim": {"duration_s": 180, "n_cells": 12, "seed": 5},
        "pipeline": {
            "transforms": [{"name": "labels_to_states", "source": "syllables"}],
            "preprocess": [],
            "analyses": [
                {
                    "name": "mean",
                    "metric": {"name": "mean_per_state"},
                    "states": "syllables",
                    "shuffle": _sh(),
                },
                {
                    "name": "auroc",
                    "metric": {"name": "auroc"},
                    "states": "syllables",
                    "shuffle": _sh(correction="bh"),
                },
                {
                    "name": "auroc_label_shuffle",
                    "metric": {"name": "auroc"},
                    "states": "syllables",
                    "shuffle": _sh(null={"name": "label_shuffle"}, seed=16),
                },
                {
                    "name": "mi",
                    "metric": {"name": "mutual_information"},
                    "states": "syllables",
                    "shuffle": _sh(),
                },
                {
                    "name": "bayes",
                    "metric": {"name": "bayesian_decoder"},
                    "states": "syllables",
                    "shuffle": _sh(),
                },
            ],
        },
    },
}


def build_session(case: str) -> cabana.Session:
    return cabana.simulate_session(**CASES[case]["sim"])


def storable(rs: cabana.ResultSet) -> cabana.ResultSet:
    """Convert any object-dtype extras to fixed-width unicode so ``ResultSet.save`` accepts them.

    Built-in metrics no longer emit object arrays; this guards third-party metrics and
    keeps the generator and the test applying the same conversion.
    """
    for r in rs:
        for k, v in list(r.extras.items()):
            if v.dtype.kind == "O":
                r.extras[k] = v.astype(str)
    return rs


def main(out_dir: Path = GOLDEN_DIR, cases: list[str] | None = None) -> None:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "cabana_version": cabana.__version__,
        "generated": datetime.now(UTC).isoformat(timespec="seconds"),
        "cases": {},
    }
    t0 = time.time()
    for case in cases or list(CASES):
        session = build_session(case)
        pipe = Pipeline.from_dict(CASES[case]["pipeline"])
        session.save(out_dir / f"{case}.session.zip")
        (out_dir / f"{case}.pipeline.yaml").write_text(pipe.to_yaml())
        _, rs = pipe.run(session)
        storable(rs).save(out_dir / f"{case}.results.zip")
        manifest["cases"][case] = {
            a.name: {
                "metric": a.metric.name,
                "target": a.target,
                "null": "none"
                if a.shuffle is None
                else (a.shuffle.null.name if a.shuffle.null else "circular_shift"),
                "keep_null": None if a.shuffle is None else a.shuffle.keep_null,
                "correction": None if a.shuffle is None else a.shuffle.correction,
            }
            for a in pipe.analyses
        }
    (out_dir / "MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"golden files written to {out_dir} in {time.time() - t0:.1f} s", file=sys.stderr)


if __name__ == "__main__":
    main()
