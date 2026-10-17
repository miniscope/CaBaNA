# ruff: noqa: E402, E501, F811, F401, B905
"""``check_plugin`` on the docs/PLUGINS.md examples, built-ins and deliberately broken plugins.

The code between the ``# example: <kind>`` headers below is copied verbatim into
``docs/PLUGINS.md``; ``test_docs_examples_match`` fails if the two drift apart.
"""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np
import pytest

import cabana
from cabana import Pipeline, build, check_plugin

# example: preprocess
from typing import ClassVar

import numpy as np
from pydantic import Field

from cabana import PreprocessStep, register


@register("preprocess")
class MaskSpeedOutliers(PreprocessStep):
    """Mask frames whose speed exceeds a physical limit (tracking glitches)."""

    name: ClassVar[str] = "mask_speed_outliers"
    signal: str = Field("speed", description="Speed signal in session.signals.")
    max_speed: float = Field(..., gt=0, description="Largest plausible speed, signal units.")
    output: str = Field("speed_plausible", description="Name of the mask written.")

    def apply(self, session):
        if self.signal not in session.signals:
            raise KeyError(f"signal {self.signal!r} not in {sorted(session.signals)}")
        with np.errstate(invalid="ignore"):  # NaN compares False: frame excluded
            ok = np.asarray(session.signals[self.signal], float) <= self.max_speed
        return session.with_mask(self.output, ok, source=self.to_dict())


# example: transform
from typing import ClassVar

import numpy as np
from pydantic import Field

from cabana import Transform, register


@register("transform")
class DistanceToWall(Transform):
    """Distance from (x, y) to the nearest wall of the arena [0, width] x [0, height]."""

    name: ClassVar[str] = "distance_to_wall"
    width: float = Field(..., gt=0, description="Arena extent along x, in the signal's units.")
    height: float = Field(..., gt=0, description="Arena extent along y, in the signal's units.")
    output: str = Field(
        "wall_distance", description="Signal written; {output}_covered is the mask."
    )

    def apply(self, session):
        x, y = (np.asarray(session.signals[k], float) for k in ("x", "y"))  # NaN stays NaN
        d = np.clip(np.minimum.reduce([x, self.width - x, y, self.height - y]), 0, None)
        units = dict(session.meta.get("signal_units", {}))
        units[self.output] = units.get("x", "")
        out = session.with_signal(self.output, d).replace(
            meta={**session.meta, "signal_units": units}
        )
        return out.with_mask(f"{self.output}_covered", np.isfinite(d), source=self.to_dict())


# example: metric
from typing import ClassVar

import numpy as np
from pydantic import Field

from cabana import Metric, register
from cabana._results import Tail
from cabana._statesums import masked_counts, shifted_sums_for


def _active(activity, threshold):  # NaN stays NaN; roll(active) == active(roll)
    return np.where(np.isnan(activity), np.nan, activity > threshold)


@register("metric")
class ActiveFraction(Metric):
    """Fraction of in-state masked frames with activity above ``threshold``."""

    name: ClassVar[str] = "active_fraction"
    default_tail: ClassVar[Tail] = "upper"  # requires_topology stays False: any state space
    threshold: float = Field(0.0, description="Activity above this counts as active.")
    min_frames: int = Field(20, ge=1, description="Fewer masked frames in a state gives NaN.")

    def _finish(self, sums, n):  # sums: (..., n_cells, n_states); n: (n_states,)
        with np.errstate(invalid="ignore", divide="ignore"):
            return np.where(n >= self.min_frames, sums / n, np.nan)

    def compute(self, activity, states, mask, fs):
        m = states.masked(mask)  # dense (n_time, n_states) float, mask applied
        return self._finish(_active(activity, self.threshold) @ m, m.sum(axis=0))

    def compute_shifted(self, activity, states, mask, fs, shifts):
        sums = shifted_sums_for(_active(activity, self.threshold), states, mask, shifts)
        return self._finish(sums, masked_counts(states, mask))  # (n_shifts, n_cells, n_states)

    def extras(self, activity, states, mask, fs):
        return {"n_in_state": masked_counts(states, mask).astype(np.int64)}


# example: null
from typing import ClassVar

import numpy as np
from pydantic import Field

from cabana import Null, register


@register("null")
class IndependentShift(Null):
    """Roll every cell by its own random offset (breaks cell-cell timing too)."""

    name: ClassVar[str] = "independent_shift"
    perturbs: ClassVar[str] = "activity"  # the target is returned untouched
    min_shift_s: float = Field(5.0, ge=0, description="Smallest |offset|, seconds.")

    def surrogate(self, activity, target, mask, fs, rng):
        n_cells, n_time = activity.shape
        lo = int(np.ceil(self.min_shift_s * fs))
        if 2 * lo >= n_time:
            raise ValueError("min_shift_s is longer than half the session")
        k = rng.integers(lo, n_time - lo + 1, size=n_cells)  # only rng: parallel-safe
        return np.stack([np.roll(a, s) for a, s in zip(activity, k)]), target


# example: selector
from typing import ClassVar

import numpy as np
from pydantic import Field

from cabana import Selection, Selector, register


@register("selector")
class MinFramesFromDuration(Selector):
    """Set min_frames so a state needs `min_state_s` seconds of masked data."""

    name: ClassVar[str] = "min_frames_from_duration"
    min_state_s: float = Field(2.0, gt=0, description="Shortest state dwell to trust, seconds.")

    def select(self, session, pipeline):
        k = int(np.ceil(self.min_state_s * session.fs))
        return [
            Selection(
                path="analyses.*.metric.min_frames",
                value=k,
                method="auto_rule",
                criterion=f"min_state_s * fs ({session.fs:g} Hz)",
            )
        ]


# end examples

from cabana import Null, PreprocessStep, Transform
from cabana._statesums import state_sums as _state_sums


# --- deliberately broken plugins ---------------------------------------------------------
@register("preprocess")
class _MutatesInput(PreprocessStep):
    name: ClassVar[str] = "_t_mutates_input"

    def apply(self, session):
        session.signals["x"][:] = 0.0  # in-place write to a shared array
        return session


@register("preprocess")
class _NonDeterministic(PreprocessStep):
    name: ClassVar[str] = "_t_nondeterministic"

    def apply(self, session):
        m = np.random.default_rng().random(session.n_time) > 0.5
        return session.with_mask("rnd", m, source="random")


@register("preprocess")
class _DropsFrames(PreprocessStep):
    name: ClassVar[str] = "_t_drops_frames"

    def apply(self, session):
        return session.select_frames(slice(0, 100)).replace(meta={**session.meta})


@register("transform")
class _NoBookkeeping(Transform):
    name: ClassVar[str] = "_t_no_bookkeeping"

    def apply(self, session):
        s = session.with_signal("new_sig", np.full(session.n_time, np.inf))
        return s.replace(masks={**s.masks, "new_mask": np.ones(s.n_time, bool)})


@register("metric")
class _WrongShape(Metric):
    name: ClassVar[str] = "_t_wrong_shape"

    def compute(self, activity, states, mask, fs):
        return activity.mean(axis=0)  # (n_time,), not (n_cells, ...)


@register("metric")
class _BadShifted(Metric):
    name: ClassVar[str] = "_t_bad_shifted"

    def compute(self, activity, states, mask, fs):
        return _state_sums(activity, states, mask)

    def compute_shifted(self, activity, states, mask, fs, shifts):
        return np.stack([self.compute(activity, states, mask, fs)] * len(shifts))  # forgets to roll


@register("metric")
class _CellCoupled(Metric):
    name: ClassVar[str] = "_t_cell_coupled"

    def compute(self, activity, states, mask, fs):
        return _state_sums(activity - activity[0], states, mask)  # depends on cell 0


@register("metric")
class _Mutating(Metric):
    name: ClassVar[str] = "_t_mutating"
    calls: int = 0

    def compute(self, activity, states, mask, fs):
        self.calls += 1
        return _state_sums(activity, states, mask) + self.calls


@register("null")
class _GlobalRng(Null):
    name: ClassVar[str] = "_t_global_rng"

    def surrogate(self, activity, target, mask, fs, rng):
        return np.roll(activity, int(np.random.randint(1, activity.shape[1])), axis=1), target


@register("null")
class _MutatesActivity(Null):
    name: ClassVar[str] = "_t_mutates_activity"

    def surrogate(self, activity, target, mask, fs, rng):
        activity[:] = activity[:, ::-1]
        return activity, target


@register("null")
class _WrongShapeNull(Null):
    name: ClassVar[str] = "_t_wrong_shape_null"

    def surrogate(self, activity, target, mask, fs, rng):
        return activity[:, :-1], target


@register("selector")
class _PeeksAtP(cabana.Selector):
    name: ClassVar[str] = "_t_peeks"

    def select(self, session, pipeline):
        p_values = 0.5  # a selector must not look at p-values
        return [
            Selection(
                path="analyses.*.metric.min_frames", value=int(p_values * 40), method="auto_rule"
            )
        ]


@register("selector")
class _BadPath(cabana.Selector):
    name: ClassVar[str] = "_t_bad_path"

    def select(self, session, pipeline):
        return [Selection(path="analyses.*.metric.no_such_field", value=1, method="auto_rule")]


def failed_names(report) -> set[str]:
    return {n for n, ok, _ in report.checks if not ok}


@pytest.fixture(scope="module")
def pipe():
    return Pipeline(analyses=[{"metric": {"name": "mean_per_state"}, "states": "position"}])


# --- docs examples and built-ins ---------------------------------------------------------
def test_docs_examples_pass(small_session, pipe):
    for plugin in (
        MaskSpeedOutliers(max_speed=500.0),
        DistanceToWall(width=300.0, height=160.0),
        ActiveFraction(threshold=0.0, min_frames=5),
        ActiveFraction(threshold=0.1, min_frames=5),
        IndependentShift(),
    ):
        rep = check_plugin(plugin, small_session)
        rep.raise_if_failed()
        assert rep.passed and "PASSED" in str(rep)
    check_plugin(MinFramesFromDuration(), small_session, pipeline=pipe).raise_if_failed()
    rep = check_plugin(ActiveFraction(min_frames=5), small_session)
    assert dict((n, m) for n, _, m in rep.checks)["compute_shifted"].startswith("matches")
    assert not rep.warnings


def test_docs_examples_work_in_a_pipeline(small_session):
    p = Pipeline.from_yaml(
        Pipeline(
            transforms=[DistanceToWall(width=300.0, height=160.0)],
            preprocess=[MaskSpeedOutliers(max_speed=500.0)],
            selectors=[MinFramesFromDuration()],
            analyses=[
                {
                    "metric": {"name": "active_fraction"},
                    "states": "position",
                    "masks": ["speed_plausible"],
                    "shuffle": {"n_shuffles": 10, "null": {"name": "independent_shift"}},
                }
            ],
        ).to_yaml()
    )
    _, rs = p.run(small_session)
    assert rs.results[0].params["min_frames"] == 40
    for kind in ("transform", "preprocess", "metric", "null", "selector"):
        assert cabana.available(kind)
    from cabana import describe

    assert "active_fraction" in describe()["plugins"]["metric"]


def test_docs_examples_match():
    """Every ```python block headed ``# example: <kind>`` in PLUGINS.md is verbatim in this file."""
    doc = (Path(__file__).resolve().parent.parent / "docs" / "PLUGINS.md").read_text()
    src = Path(__file__).read_text()
    blocks = [
        b for b in re.findall(r"```python\n(.*?)```", doc, re.S) if b.startswith("# example:")
    ]
    assert len(blocks) == 5
    for b in blocks:
        assert b.strip() in src, f"docs example drifted from the tested code:\n{b[:200]}"


@pytest.mark.parametrize(
    "spec",
    [
        ("preprocess", {"name": "speed_threshold", "min_speed": 20.0}),
        (
            "transform",
            {"name": "bin_grid", "signals": ["x", "y"], "bin_size": 100.0, "output": "g2"},
        ),
        ("metric", {"name": "mean_per_state", "min_frames": 5}),
        ("metric", {"name": "information_content"}),
        ("null", {"name": "label_shuffle", "block_s": 2.0}),
        ("null", {"name": "circular_shift", "min_shift_s": 5.0}),
    ],
)
def test_builtins_pass(small_session, spec):
    check_plugin(build(*spec), small_session).raise_if_failed()


def test_builtin_selector_passes(small_session):
    p = Pipeline(
        analyses=[
            {
                "metric": {"name": "information_content"},
                "states": "position",
                "shuffle": {"n_shuffles": 10},
            }
        ]
    )
    rep = check_plugin(
        build("selector", {"name": "auto_null_timescale"}), small_session, pipeline=p
    )
    rep.raise_if_failed()


def test_signal_metric_default_target(small_session):
    rep = check_plugin(build("metric", {"name": "signal_correlation"}), small_session)
    rep.raise_if_failed()


# --- broken plugins ----------------------------------------------------------------------
@pytest.mark.parametrize(
    ("plugin", "check"),
    [
        (_MutatesInput(), "input_unchanged"),
        (_NonDeterministic(), "deterministic"),
        (_DropsFrames(), "frame_count"),
        (_NoBookkeeping(), "finite_or_nan"),
        (_NoBookkeeping(), "signal_units"),
        (_NoBookkeeping(), "mask_info"),
    ],
)
def test_broken_session_plugins(small_session, plugin, check):
    rep = check_plugin(plugin, small_session)
    assert check in failed_names(rep), str(rep)
    assert not rep.passed
    with pytest.raises(AssertionError, match=check):
        rep.raise_if_failed()


@pytest.mark.parametrize(
    ("plugin", "check"),
    [
        (_WrongShape(), "compute_shape"),
        (_BadShifted(), "compute_shifted"),
        (_CellCoupled(), "cell_permutation"),
        (_Mutating(), "self_unchanged"),
        (_GlobalRng(), "rng_discipline"),
        (_MutatesActivity(), "inputs_unchanged"),
        (_WrongShapeNull(), "surrogate_shapes"),
    ],
)
def test_broken_metrics_and_nulls(small_session, plugin, check):
    rep = check_plugin(plugin, small_session)
    assert check in failed_names(rep), str(rep)


def test_broken_selectors(small_session, pipe):
    rep = check_plugin(_BadPath(), small_session, pipeline=pipe)
    assert "paths_resolve" in failed_names(rep)
    rep = check_plugin(_PeeksAtP(), small_session, pipeline=pipe)
    assert rep.passed and any("p-values" in w for w in rep.warnings)
    assert any("skipped" in w for w in check_plugin(_PeeksAtP(), small_session).warnings)


def test_skip_and_type_errors(small_session):
    rep = check_plugin(_WrongShapeNull(), small_session, skip=("surrogate_shapes",))
    assert "surrogate_shapes" not in failed_names(rep)
    with pytest.raises(TypeError):
        check_plugin(object(), small_session)  # type: ignore[arg-type]
