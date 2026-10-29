"""Pipelines used for the GUI test fixtures and the bridge tests (plan section 6.2, 6.3)."""

from __future__ import annotations

from typing import Any

CELL_SHIFT = {"name": "cell_shift", "min_shift_s": 20.0, "min_pair_separation_s": 1.0}


def _shuffle(null: dict[str, Any], n_shuffles: int, **extra: Any) -> dict[str, Any]:
    return {
        "n_shuffles": n_shuffles,
        "null": null,
        "seed": 0,
        "alpha": 0.05,
        "correction": "none",
        "n_jobs": -1,
        **extra,
    }


def population(n_shuffles: int = 50, states: str = "social") -> dict[str, Any]:
    """The five population analyses of plan section 6.3."""
    shuffle = _shuffle(CELL_SHIFT, n_shuffles)

    def analysis(name: str, metric: dict[str, Any], shuffled: bool = True) -> dict[str, Any]:
        spec: dict[str, Any] = {"name": name, "metric": metric, "states": states}
        if shuffled:
            spec["shuffle"] = dict(shuffle)
        return spec

    return {
        "preprocess": [
            {"name": "rebin_time", "bin_s": 0.5, "activity_method": "auto", "min_fraction": 0.5}
        ],
        "analyses": [
            analysis(
                "pv_similarity",
                {
                    "name": "population_vector_overlap",
                    "similarity": "cosine",
                    "min_occupancy_s": 0.05,
                    "normalize_cells": True,
                },
            ),
            analysis(
                "pv_stability",
                {"name": "pv_stability", "n_blocks": 2, "min_occupancy_s": 0.05},
            ),
            analysis(
                "state_separation",
                {
                    "name": "pca_population",
                    "n_components": 10,
                    "zscore": True,
                    "distance": "euclidean",
                    "min_frames": 20,
                },
            ),
            analysis(
                "dimensionality",
                {"name": "participation_ratio", "zscore": True, "min_frames": 50, "per_state": False},
            ),
            analysis(
                "pairwise",
                {
                    "name": "pairwise_correlation",
                    "kind": "total",
                    "method": "pearson",
                    "min_frames": 50,
                    "zscore": True,
                },
                shuffled=False,
            ),
        ],
    }


def pairwise(states: str = "social") -> dict[str, Any]:
    return {
        "analyses": [
            {
                "name": "pairwise",
                "metric": {"name": "pairwise_correlation", "kind": "total", "method": "pearson",
                           "min_frames": 50, "zscore": True},
                "states": states,
            }
        ]
    }


def bayesian_position(n_shuffles: int = 20) -> dict[str, Any]:
    """Bayesian position decoder on a 3 cm grid (plan section 6.2)."""
    return {
        "transforms": [{"name": "speed", "signals": ["x", "y"], "window_s": 0.5},
                       {"name": "bin_grid", "signals": ["x", "y"], "bin_size": 3.0, "output": "position"}],
        "preprocess": [{"name": "speed_threshold", "signal": "speed", "min_speed": 2.0,
                        "output": "speed"}],
        "analyses": [
            {
                "name": "decoding_position",
                "metric": {
                    "name": "bayesian_decoder", "likelihood": "gaussian", "binarize": True,
                    "window_s": 0.25, "smooth_sigma_bins": 0, "n_folds": 5,
                    "sigma": "per_state", "prior": "occupancy", "min_frames_per_class": 20,
                },
                "states": "position",
                "masks": ["speed"],
                "shuffle": _shuffle(
                    {"name": "label_shuffle", "block_s": 1.0}, n_shuffles,
                    correction="max_stat", correction_scope="states",
                ),
            }
        ],
    }


def decode_states_logistic(n_shuffles: int = 20, states: str = "social") -> dict[str, Any]:
    return {
        "analyses": [
            {
                "name": "decoding_behavior",
                "metric": {"name": "decode_states", "classifier": "logistic", "n_folds": 5,
                           "mode": "one_vs_rest"},
                "states": states,
                "shuffle": _shuffle({"name": "label_shuffle", "block_s": 1.0}, n_shuffles),
            }
        ]
    }
