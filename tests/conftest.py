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
