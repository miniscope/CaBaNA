"""Shared simulated sessions.

The fixtures are session-scoped and shared by every test module, so tests must treat
them as read-only: ``Session`` operations return new objects (``transform.apply``,
``rebin``, ``model_copy``), never mutate in place.
"""

from __future__ import annotations

import pytest

import cabana
from cabana import build


def _prepare(session: cabana.Session, bin_size: float) -> cabana.Session:
    """The standard chain: position grid (resample, speed, bin_grid), social bouts, syllables."""
    for spec in (
        {"name": "resample_signal", "source": "position"},
        {"name": "speed"},
        {"name": "bin_grid", "signals": ["x", "y"], "bin_size": bin_size, "output": "position"},
        {"name": "bouts_to_states", "source": "social"},
        {"name": "labels_to_states", "source": "syllables"},
    ):
        session = build("transform", spec).apply(session)
    return session


@pytest.fixture(scope="session")
def sim_session() -> cabana.Session:
    """600 s, 60 cells, seed 0; position grid (50 mm bins), ``social`` and ``syllables`` states."""
    return _prepare(cabana.simulate_session(duration_s=600, n_cells=60, seed=0), 50.0)


@pytest.fixture(scope="session")
def small_session() -> cabana.Session:
    """300 s, 20 cells, seed 0; same chain with coarse (100 mm) position bins."""
    return _prepare(cabana.simulate_session(duration_s=300, n_cells=20, seed=0), 100.0)


def pytest_addoption(parser: pytest.Parser) -> None:
    parser.addoption(
        "--update-golden",
        action="store_true",
        default=False,
        help="Regenerate tests/golden/* via scripts/generate_golden.py, then run the tests.",
    )


def pytest_configure(config: pytest.Config) -> None:
    if config.getoption("--update-golden", default=False):
        import importlib.util
        from pathlib import Path

        script = Path(__file__).resolve().parent.parent / "scripts" / "generate_golden.py"
        spec = importlib.util.spec_from_file_location("generate_golden", script)
        assert spec is not None and spec.loader is not None
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        mod.main()


# --- a test-only selector shared by test_selector.py and test_sweep.py -------------------
from typing import Any as _Any, ClassVar as _ClassVar  # noqa: E402

from cabana import Pipeline as _Pipeline, Selection as _Selection  # noqa: E402
from cabana._registry import Selector as _Selector, register as _register  # noqa: E402


@_register("selector")
class _FixedSigma(_Selector):
    """Sets smooth_sigma_bins on every analysis that has it (test fixture)."""

    name: _ClassVar[str] = "_test_fixed_sigma"
    sigma: float = 2.0

    def select(self, session: _Any, pipeline: _Pipeline) -> list[_Selection]:
        return [
            _Selection(
                path="analyses.*.metric.smooth_sigma_bins",
                value=self.sigma,
                method="auto_rule",
                criterion="test",
                candidates=[0.0, 1.0, 2.0],
                scores=[0.1, 0.5, 0.9],
            )
        ]


@pytest.fixture(scope="session")
def three_chamber_dir():
    """Directory of the slimmed lab dataset (``tests/data/simulated_3chamber``, first 75 s)."""
    from pathlib import Path

    d = Path(__file__).resolve().parent / "data" / "simulated_3chamber"
    assert (d / "neural_timestamps.csv").exists(), d
    return d
