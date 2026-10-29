"""Regenerate ``tests/golden/kernels/*.npz``: inputs + expected outputs of the pure kernels.

Usage (repo root)::

    .venv/bin/python scripts/generate_kernel_golden.py

Everything is seeded and shifts are explicit, so a Rust/WASM port can load the same
files, feed the ``in_*`` arrays to its kernels and compare with the ``out_*`` arrays
(rtol 1e-12, NaN equal).  ``tests/test_kernels.py`` does this for the Python kernels.
Regenerate only for an intentional numeric change of a kernel.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np

from cabana import _kernels as K

OUT = Path(__file__).resolve().parent.parent / "tests" / "golden" / "kernels"
N_CELLS, N_TIME, N_STATES = 5, 400, 7
SHIFTS = np.array([0, 37, -53, 211, 399, 1234], dtype=np.int64)  # incl. negative and > n_time


def _activity(rng: np.random.Generator) -> np.ndarray:
    a = rng.gamma(0.3, 1.0, size=(N_CELLS, N_TIME)) * (rng.random((N_CELLS, N_TIME)) < 0.4)
    a[4] = 0.0  # all-silent cell
    return a


def _save(name: str, **arrays: np.ndarray) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(OUT / f"{name}.npz", **arrays)


def sums_case(rng: np.random.Generator) -> None:
    x = _activity(rng)
    labels = rng.integers(0, N_STATES, N_TIME).astype(np.int32)
    labels[rng.random(N_TIME) < 0.1] = -1  # frames with no state
    mask = rng.random(N_TIME) < 0.8  # masked-frame case
    lab_m = np.where(mask, labels, -1).astype(np.int32)
    onehot = np.zeros((N_TIME, N_STATES), dtype=bool)
    ok = labels >= 0
    onehot[np.flatnonzero(ok), labels[ok]] = True
    cols = (onehot & mask[:, None]).astype(np.float64)
    x_nan = x.copy()
    x_nan[2, 100] = np.nan  # poisons cell 2 in every state and shift
    _save(
        "sums",
        in_x=x,
        in_x_nan=x_nan,
        in_labels=labels,
        in_labels_masked=lab_m,
        in_mask=mask,
        in_onehot=onehot,
        in_columns=cols,
        in_shifts=SHIFTS,
        in_n_states=np.int64(N_STATES),
        out_shifted_sums=K.shifted_sums(x, cols, SHIFTS),
        out_shifted_label_sums=K.shifted_label_sums(x, lab_m, N_STATES, SHIFTS),
        out_shifted_label_sums_nan=K.shifted_label_sums(x_nan, lab_m, N_STATES, SHIFTS),
        out_shifted_sums_nan=K.shifted_sums(x_nan, cols, SHIFTS),
        out_masked_counts=K.masked_counts(labels, N_STATES, mask),
        out_masked_counts_onehot=K.masked_counts_onehot(onehot, mask),
    )


def ratemap_case(rng: np.random.Generator) -> None:
    shape = (6, 5)
    n = shape[0] * shape[1]
    occ = rng.integers(0, 60, n).astype(np.float64)
    occ[[3, 17]] = 0.0  # never visited
    sums = rng.gamma(2.0, 1.0, size=(3, n)) * (occ > 0)
    sums[2] = 0.0  # silent cell
    fs = 20.0
    rate, valid = K.rate_map(sums, occ, fs, 0.5)
    rate_s, valid_s = K.rate_map(sums, occ, fs, 0.5, shape, 1.0)
    grid_vals = rng.random((2, n))
    _save(
        "ratemap",
        in_sums=sums,
        in_occ=occ,
        in_fs=np.float64(fs),
        in_min_occ_s=np.float64(0.5),
        in_shape=np.array(shape, dtype=np.int64),
        in_sigma=np.float64(1.0),
        in_grid_values=grid_vals,
        in_mask=rng.random(100) < 0.7,
        out_rate=rate,
        out_valid=valid,
        out_rate_smooth=rate_s,
        out_valid_smooth=valid_s,
        out_smooth_grid=K.smooth_grid(grid_vals, valid, shape, 1.0),
        out_si_bits_per_event=K.skaggs_information(rate, occ, valid, False),
        out_si_bits_per_second=K.skaggs_information(rate, occ, valid, True),
        out_folds=K.contiguous_folds(23, 4),
    )


def levels_case(rng: np.random.Generator) -> None:
    x = _activity(rng)
    mask = rng.random(N_TIME) < 0.8
    labels = rng.integers(0, N_STATES, N_TIME).astype(np.int32)
    cols = np.zeros((N_TIME, N_STATES))
    cols[np.arange(N_TIME), labels] = 1.0
    cols *= mask[:, None]
    out: dict[str, np.ndarray] = {}
    for binning in ("quantile", "log", "linear", "binary"):
        edges = K.level_edges(x, mask, 3, binning)
        out[f"out_edges_{binning}"] = edges
        out[f"out_levels_{binning}"] = K.activity_levels(x, edges)
    levels = K.activity_levels(x, K.level_edges(x, mask, 3, "quantile"))
    counts = K.joint_counts(levels, cols, 3, SHIFTS)
    out["out_joint_counts"] = counts
    out["out_joint_counts_unshifted"] = K.joint_counts(levels, cols, 3)
    out["out_mi_none"] = K.mutual_information_from_counts(counts, "none")
    out["out_mi_miller_madow"] = K.mutual_information_from_counts(counts, "miller_madow")
    out["out_mi_empty"] = K.mutual_information_from_counts(np.zeros((2, 4, 3)))
    _save("levels", in_x=x, in_mask=mask, in_columns=cols, in_shifts=SHIFTS, **out)


def rank_case(rng: np.random.Generator) -> None:
    x = np.round(_activity(rng), 1)  # heavy ties
    x[3] = rng.normal(size=N_TIME)
    mask = rng.random(N_TIME) < 0.8
    labels = rng.integers(0, 3, N_TIME)
    onehot = np.zeros((N_TIME, 3))
    onehot[np.arange(N_TIME), labels] = 1.0
    idx = np.flatnonzero(mask)
    m = onehot[mask]
    half_n1 = 0.5 * m.sum(axis=0)
    dense, width = K.dense_ranks(x)
    r1 = np.stack(
        [K.masked_rank_sums_one_shift(dense, width, idx, int(k), m, half_n1) for k in SHIFTS]
    )
    n1 = m.sum(axis=0)
    n0 = mask.sum() - n1
    x_nan = x.copy()
    x_nan[1, 5] = np.nan
    _save(
        "rank",
        in_x=x,
        in_x_nan=x_nan,
        in_mask=mask,
        in_onehot=onehot,
        in_shifts=SHIFTS,
        in_min_frames=np.int64(20),
        out_average_ranks=K.average_ranks(x),
        out_average_ranks_nan=K.average_ranks(x_nan),
        out_dense=dense,
        out_width=np.int64(width),
        out_masked_rank_sums=r1,
        out_auroc=K.auroc_from_rank_sums(r1, n1, n0, 20),
    )


def label_case(rng: np.random.Generator) -> None:
    out: dict[str, np.ndarray] = {}
    for tag, shape, prob in (("2d", (14, 11), 0.5), ("3d", (6, 7, 5), 0.4)):
        mask = rng.random(shape) < prob
        values = rng.random(shape)
        out[f"in_mask_{tag}"] = mask
        out[f"in_values_{tag}"] = values
        for c in (1, 2):
            lab, n = K.label_components(mask, c)
            size, cen, peak = K.component_stats(lab, values, values)
            out[f"out_labels_{tag}_c{c}"] = lab
            out[f"out_n_{tag}_c{c}"] = np.int64(n)
            out[f"out_size_{tag}_c{c}"] = size
            out[f"out_centroid_{tag}_c{c}"] = cen
            out[f"out_peak_{tag}_c{c}"] = peak
    _save("label", **out)


def main() -> None:
    rng = np.random.default_rng(20261016)
    sums_case(rng)
    ratemap_case(rng)
    levels_case(rng)
    rank_case(rng)
    label_case(np.random.default_rng(20261017))  # own stream: added later, keeps older goldens
    for p in sorted(OUT.glob("*.npz")):
        print(p.relative_to(OUT.parent.parent.parent), p.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
