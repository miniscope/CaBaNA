"""load_calab on a duck-typed CaDeconResult and on npz files (no calab dependency)."""

from __future__ import annotations

from typing import NamedTuple

import numpy as np
import pytest

from cabana import SessionInfo
from cabana import _loaders as loaders  # load_calab is exported from cabana.loaders by the facade


class FakeResult(NamedTuple):
    activity: np.ndarray
    alphas: np.ndarray
    baselines: np.ndarray
    pves: np.ndarray
    kernel_slow: np.ndarray
    kernel_fast: np.ndarray
    fs: float
    metadata: dict


def fake(n=4, T=80, meta=None):
    rng = np.random.default_rng(0)
    return FakeResult(
        activity=rng.random((n, T)).astype(np.float32),
        alphas=np.arange(1, n + 1, dtype=float),
        baselines=np.linspace(0, 1, n),
        pves=np.full(n, 0.5),
        kernel_slow=np.zeros(0, np.float32),
        kernel_fast=np.zeros(0, np.float32),
        fs=20.0,
        metadata={"tau_rise": 0.05, "tau_decay": 0.4, "beta": 1.2, "residual": 0.01}
        if meta is None
        else meta,
    )


def test_from_result():
    r = fake()
    s = loaders.load_calab(r, info=SessionInfo(animal="m1"))
    assert s.activity.dtype == np.float64 and s.activity_kind == "deconvolved"
    assert s.fs == 20.0 and s.n_cells == 4 and s.info.animal == "m1"
    np.testing.assert_allclose(s.t, np.arange(80) / 20.0)
    np.testing.assert_allclose(s.cell_meta["alpha"], [1, 2, 3, 4])
    assert set(s.cell_meta) == {"alpha", "baseline", "pve", "tau_rise_s", "tau_decay_s"}
    assert (s.cell_meta["tau_decay_s"] == 0.4).all()
    assert s.meta["source"] == "calab"
    assert s.meta["kernel"] == {
        "tau_rise_s": 0.05,
        "tau_decay_s": 0.4,
        "beta": 1.2,
        "residual": 0.01,
    }


def test_unfitted_kernel_and_options():
    r = fake(meta={"tau_rise": None, "tau_decay": None, "beta": None, "residual": None})
    s = loaders.load_calab(r, cell_ids=list("abcd"), t_offset_s=1.0)
    assert "tau_rise_s" not in s.cell_meta and s.meta["kernel"]["tau_decay_s"] is None
    assert s.cell_ids == list("abcd") and s.t[0] == -1.0
    with pytest.warns(UserWarning, match="differs"):
        assert loaders.load_calab(r, fs=10.0).fs == 10.0
    with pytest.warns(UserWarning, match="raw is not stored"):
        loaders.load_calab(r, raw=np.zeros((4, 80)))
    with pytest.raises(ValueError, match="raw has shape"):
        loaders.load_calab(r, raw=np.zeros((3, 80)))
    with pytest.raises(ValueError, match="no 'fs'|give t"):
        loaders.load_calab({"activity": np.ones((2, 10))})
    s = loaders.load_calab({"activity": np.ones((2, 10)), "fs": 5.0, "alphas": [1.0, 2.0]})
    assert s.fs == 5.0 and "alpha" in s.cell_meta
    with pytest.raises(ValueError, match="alphas"):
        loaders.load_calab({"activity": np.ones((2, 10)), "fs": 5.0, "alphas": [1.0]})


def test_from_npz(tmp_path):
    r = fake()
    f = tmp_path / "r.npz"
    np.savez(
        f, activity=r.activity, fs=r.fs, alphas=r.alphas, pves=r.pves, tau_rise=0.05, tau_decay=0.4
    )
    s = loaders.load_calab(f)
    assert s.fs == 20.0 and s.meta["file"] == str(f)
    assert set(s.cell_meta) == {"alpha", "pve", "tau_rise_s", "tau_decay_s"}
    assert s.meta["kernel"]["beta"] is None
    g = tmp_path / "plain.npz"
    np.savez(g, activity=r.activity, fs=r.fs)
    s = loaders.load_calab(g)
    assert s.cell_meta == {} and s.n_cells == 4
    np.savez(tmp_path / "bad.npz", x=np.ones(3))
    with pytest.raises(KeyError, match="activity"):
        loaders.load_calab(tmp_path / "bad.npz")
    with pytest.raises(FileNotFoundError):
        loaders.load_calab(tmp_path / "missing.npz")
