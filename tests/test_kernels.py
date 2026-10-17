"""Pure-kernel tests: numpy-only import allow-list and golden vectors (rtol 1e-12, NaN equal)."""

from __future__ import annotations

import ast
from pathlib import Path

import numpy as np
import pytest
from scipy.stats import rankdata

from cabana import _kernels as K

KDIR = Path(K.__file__).parent
GOLD = Path(__file__).parent / "golden" / "kernels"
ALLOWED = {"numpy", "__future__", "typing"}
ALLOWED_BY_MODULE = {"_smooth.py": ALLOWED | {"scipy.ndimage"}}


def _imports(path: Path) -> set[str]:
    found: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Import):
            found |= {a.name for a in node.names}
        elif isinstance(node, ast.ImportFrom):
            if node.level:  # relative: only sibling kernel modules
                assert node.module is None or node.module.startswith("_"), path
                continue
            found.add(node.module or "")
    return found


@pytest.mark.parametrize("path", sorted(KDIR.glob("*.py")), ids=lambda p: p.name)
def test_kernels_import_only_numpy(path):
    allowed = ALLOWED_BY_MODULE.get(path.name, ALLOWED)
    bad = {m for m in _imports(path) if m not in allowed}
    assert not bad, f"{path.name} imports {sorted(bad)}; allowed: {sorted(allowed)}"


def _load(name):
    with np.load(GOLD / f"{name}.npz", allow_pickle=False) as z:
        return {k: z[k] for k in z.files}


def _eq(got, want):
    got = np.asarray(got)
    assert got.shape == want.shape
    if want.dtype.kind in "iub":
        np.testing.assert_array_equal(got, want)
    else:
        np.testing.assert_allclose(got, want, rtol=1e-12, atol=0, equal_nan=True)


def test_golden_sums():
    g = _load("sums")
    n = int(g["in_n_states"])
    _eq(K.shifted_sums(g["in_x"], g["in_columns"], g["in_shifts"]), g["out_shifted_sums"])
    _eq(
        K.shifted_label_sums(g["in_x"], g["in_labels_masked"], n, g["in_shifts"]),
        g["out_shifted_label_sums"],
    )
    _eq(
        K.shifted_label_sums(g["in_x_nan"], g["in_labels_masked"], n, g["in_shifts"]),
        g["out_shifted_label_sums_nan"],
    )
    _eq(K.shifted_sums(g["in_x_nan"], g["in_columns"], g["in_shifts"]), g["out_shifted_sums_nan"])
    _eq(K.masked_counts(g["in_labels"], n, g["in_mask"]), g["out_masked_counts"])
    _eq(K.masked_counts_onehot(g["in_onehot"], g["in_mask"]), g["out_masked_counts_onehot"])
    # label path == dense path (the contract a port must keep), NaN cell included
    _eq(g["out_shifted_label_sums"], g["out_shifted_sums"])
    _eq(g["out_shifted_label_sums_nan"], g["out_shifted_sums_nan"])
    assert np.isnan(g["out_shifted_label_sums_nan"][:, 2]).all()
    assert (g["out_shifted_label_sums"][:, 4] == 0).all()  # silent cell
    assert not g["in_mask"].all() and (g["in_labels"] < 0).any()


def test_golden_ratemap():
    g = _load("ratemap")
    shape = tuple(int(s) for s in g["in_shape"])
    fs, mo, sg = float(g["in_fs"]), float(g["in_min_occ_s"]), float(g["in_sigma"])
    rate, valid = K.rate_map(g["in_sums"], g["in_occ"], fs, mo)
    _eq(rate, g["out_rate"])
    _eq(valid, g["out_valid"])
    rate_s, valid_s = K.rate_map(g["in_sums"], g["in_occ"], fs, mo, shape, sg)
    _eq(rate_s, g["out_rate_smooth"])
    _eq(valid_s, g["out_valid_smooth"])
    _eq(K.smooth_grid(g["in_grid_values"], valid, shape, sg), g["out_smooth_grid"])
    _eq(K.skaggs_information(rate, g["in_occ"], valid, False), g["out_si_bits_per_event"])
    _eq(K.skaggs_information(rate, g["in_occ"], valid, True), g["out_si_bits_per_second"])
    _eq(K.contiguous_folds(23, 4), g["out_folds"])
    assert np.isnan(g["out_si_bits_per_event"][2])  # silent cell
    a, b = K.split_half_masks(g["in_mask"], 4)
    assert not (a & b).any() and ((a | b) == g["in_mask"]).all()


def test_golden_levels():
    g = _load("levels")
    x, mask = g["in_x"], g["in_mask"]
    for binning in ("quantile", "log", "linear", "binary"):
        edges = K.level_edges(x, mask, 3, binning)
        _eq(edges, g[f"out_edges_{binning}"])
        _eq(K.activity_levels(x, edges), g[f"out_levels_{binning}"])
    levels = K.activity_levels(x, K.level_edges(x, mask, 3, "quantile"))
    counts = K.joint_counts(levels, g["in_columns"], 3, g["in_shifts"])
    _eq(counts, g["out_joint_counts"])
    _eq(K.joint_counts(levels, g["in_columns"], 3), g["out_joint_counts_unshifted"])
    _eq(K.mutual_information_from_counts(counts, "none"), g["out_mi_none"])
    _eq(K.mutual_information_from_counts(counts, "miller_madow"), g["out_mi_miller_madow"])
    _eq(K.mutual_information_from_counts(np.zeros((2, 4, 3))), g["out_mi_empty"])
    assert np.isnan(g["out_mi_empty"]).all()
    assert (levels[4] == 0).all()  # silent cell: every frame is level 0


def test_golden_rank():
    g = _load("rank")
    _eq(K.average_ranks(g["in_x"]), g["out_average_ranks"])
    _eq(K.average_ranks(g["in_x_nan"]), g["out_average_ranks_nan"])
    # independent oracle: scipy
    _eq(K.average_ranks(g["in_x"]), rankdata(g["in_x"], axis=1))
    dense, width = K.dense_ranks(g["in_x"])
    _eq(dense, g["out_dense"])
    assert width == int(g["out_width"])
    mask, shifts = g["in_mask"], g["in_shifts"]
    idx = np.flatnonzero(mask)
    m = g["in_onehot"][mask]
    half = 0.5 * m.sum(axis=0)
    r1 = np.stack(
        [K.masked_rank_sums_one_shift(dense, width, idx, int(k), m, half) for k in shifts]
    )
    _eq(r1, g["out_masked_rank_sums"])
    # brute force: rank the rolled, masked series directly
    for i, k in enumerate(shifts):
        rolled = np.roll(g["in_x"], int(k), axis=1)[:, mask]
        _eq(rankdata(rolled, axis=1) @ m, g["out_masked_rank_sums"][i])
    n1 = m.sum(axis=0)
    _eq(K.auroc_from_rank_sums(r1, n1, mask.sum() - n1, int(g["in_min_frames"])), g["out_auroc"])
