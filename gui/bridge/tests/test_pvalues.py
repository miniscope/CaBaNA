"""The stored p-values follow the framework's own definition, p = (count + 1) / (n_valid + 1).

Re-derived here from `values` and the saved shifted values (`sh_null`) of the GUI's fixture runs,
so a view that shows a p-value shows a number the saved draws support.
"""

import io
import zipfile
from pathlib import Path

import numpy as np
import pytest

FIXTURES = Path(__file__).resolve().parents[2] / "apps/cabana/src/__tests__/fixtures"


def _arrays(zip_name: str) -> dict[str, dict[str, np.ndarray]]:
    out = {}
    with zipfile.ZipFile(FIXTURES / zip_name) as z:
        import json

        for entry in json.loads(z.read("manifest.json"))["results"]:
            npz = np.load(io.BytesIO(z.read(entry["file"])))
            out[entry["name"]] = {key: npz[key] for key in npz.files}
            out[entry["name"]]["_tail"] = entry["shuffle"]["tail"]
    return out


def rederive(values: np.ndarray, null: np.ndarray, tail: str) -> np.ndarray:
    """(count + 1) / (n_valid + 1) over the finite shifted values; two-sided doubles the smaller count."""
    finite = np.isfinite(null)
    n_valid = finite.sum(axis=0)
    observed = values.astype(null.dtype)[None]  # the framework compares at the precision it saved
    ge = ((null >= observed) & finite).sum(axis=0)
    le = ((null <= observed) & finite).sum(axis=0)
    with np.errstate(invalid="ignore", divide="ignore"):
        if tail == "upper":
            p = (ge + 1) / (n_valid + 1)
        elif tail == "lower":
            p = (le + 1) / (n_valid + 1)
        else:
            p = 2 * (np.minimum(ge, le) + 1) / (n_valid + 1)
    p = np.clip(p, 0, 1)
    p[~np.isfinite(values) | (n_valid == 0)] = np.nan
    return p


CASES = [
    ("gui_place_cells.results.zip", ["information", "stability", "fields"]),
    ("gui_auroc_circular.results.zip", ["auroc"]),
    ("gui_auroc_speed_matched.results.zip", ["auroc"]),
]


@pytest.mark.parametrize(("zip_name", "names"), CASES)
def test_stored_p_values_follow_the_definition(zip_name, names):
    arrays = _arrays(zip_name)
    for name in names:
        a = arrays[name]
        assert a["sh_null"].shape[1:] == a["values"].shape, name
        want = rederive(a["values"], a["sh_null"], str(a["_tail"]))
        np.testing.assert_array_equal(a["sh_p_value"], want, err_msg=name)
        # smallest possible p is 1 / (n + 1) for one tail, 2 / (n + 1) for two
        n = a["sh_null"].shape[0]
        floor = (1 if a["_tail"] == "upper" else 2) / (n + 1)
        assert np.nanmin(a["sh_p_value"]) >= floor - 1e-12, name


def test_adjusted_p_is_never_below_raw():
    a = _arrays("gui_auroc_circular.results.zip")["auroc"]
    ok = np.isfinite(a["sh_p_value"])
    assert np.all(a["sh_p_adj"][ok] >= a["sh_p_value"][ok] - 1e-12)
