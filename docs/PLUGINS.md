# Writing plugins

CaBaNA has five plugin kinds, one per pipeline stage that is expected to grow:
`Transform`, `PreprocessStep`, `Selector`, `Metric` and `Null`. A plugin is a
pydantic class with a class-level `name`, registered with `@register(kind)`.
This guide gives the contract, one tested example per kind, and
`cabana.check_plugin`, which checks a plugin against the contract. Every
example below is copied from `tests/test_plugin_check.py`, where it is run
through `check_plugin` and a pipeline, so the code here cannot rot.

## 1. Rules that apply to every plugin

- **Fields are parameters.** A plugin's pydantic fields are its YAML
  parameters and the schema `cabana.describe()` hands to a front end. Give every
  field a `Field(..., description=..., ge=/gt=/le=)`; a UI builds its form from
  the description and bounds. `to_dict()` / `build(kind, spec)` must round-trip.
- **Names are unique per kind.** `register` raises `ValueError` if another
  class already uses the name (re-registering the same class is fine). A
  plugin is available only after its module is imported, so import it before
  `Pipeline.from_yaml(...)` or `Pipeline.from_dict(...)`; an unknown name raises
  `KeyError` listing what is registered. Underscore-prefixed names are a
  convention for test-only plugins.
- **Be pure.** Session plugins return a new `Session` through `session.replace`,
  `with_signal`, `with_mask`, `with_state` or `with_activity`, which share
  arrays; never write into an array you received. Metrics and nulls never
  mutate `activity`, `target` or `mask`.
- **Frame count.** `n_time` and `t` change only through `Session.rebin` or
  `Session.select_frames`, which resample every per-frame object together and
  log what they did in `meta` (`"rebin"`, `"frame_selection"`). A `Transform`
  never changes `activity` or `t` at all.
- **Missing data is NaN, never inf.** NaN must propagate: a frame where the
  input is NaN is NaN (or excluded by a mask) in the output, not zero.
- **Units.** Every new signal gets `meta["signal_units"][name]` (use `""` if
  unitless). Units are informational; nothing converts between them.
- **Mask origin.** Write masks with `session.with_mask(name, mask, source=self.to_dict())`
  so `meta["mask_info"]` records where the mask came from. Per-frame
  support of a continuous signal is a mask named `{output}_covered`
  (frames where the signal is defined); a `StateSpace` carries its own `support`.
- **Thread safety.** With `ShuffleConfig(n_jobs > 1)` the same metric and null
  instances run in several threads. Do not mutate `self` (or any module global)
  in `compute`, `surrogate` or `select`. Per-run state belongs in locals.

## 2. Stage order

`Pipeline.run` applies every **transform** in list order, then every
**preprocess** step, then the **selectors**, then every **analysis**. The
order across stages is fixed. If you need a "preprocess before transform"
effect (for example, clean a raw position before it becomes a grid), write it as
a `Transform` that runs earlier in the transforms list (the shipped
`interpolate_gaps` and `smooth_signal` are transforms that clean signals before
`bin_grid`), or trim frames with the `trim_to_overlap` preprocess step.

## 3. PreprocessStep: add a mask

`PreprocessStep.apply(session) -> Session` may add masks, replace
`activity` or signals, or (through `rebin` / `select_frames`) change the
frame count. This one adds a mask, so analyses opt in with `masks=["speed_plausible"]`.

```python
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
```

NaN speeds compare False, so those frames are excluded, which is the
right default for a mask. `source=self.to_dict()` makes the mask traceable.

## 4. Transform: a continuous signal with support

`Transform.apply(session) -> Session` reads `session.signals` / `behavior` and
adds `signals`, `states` and `masks`. A continuous output follows the same
three conventions as the shipped ones: the signal itself (NaN where undefined),
its units, and `{output}_covered`.

```python
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
```

Put it in `transforms` after the step that creates `x` and `y`
(`resample_signal`). To feed it to `signal_tuning`, name it as the analysis
`signal`; to make states from it, follow it with `bin_grid` or your own transform.

## 5. Metric: compute, fast path, tail, extras

`compute(activity, target, mask, fs)` returns an array whose leading axis is
`n_cells` for `level="cell"` (`(n_cells,)`, `(n_cells, n_states)` or
`(n_cells, k)`), anything for `level="population"`. `activity` is
`(n_cells, n_time)`; `target` is a `StateSpace` (`input="states"`, default) or a
float signal (`input="signal"`); `mask` is `(n_time,)` bool and masked-out frames
must not contribute to anything. Class attributes: `level`, `input`,
`default_tail` (`"upper"`, `"lower"` or `"two"`; override `resolve_tail(target)`
if it depends on the target), `requires_topology` (then `check_target` rejects
a state space without a `GridTopology`; order-free metrics accept any),
`accepts_kinds`. `extras` returns named side outputs for plots, computed once on
unshifted data. `configure(session, target_name)` is a hook to read session
metadata.

```python
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
```

**The fast path.** `compute_shifted(activity, target, mask, fs, shifts)` is
optional and used only by the default `circular_shift` null (every other null
loops over `compute`). It must equal
`np.stack([compute(np.roll(activity, k, axis=1), ...) for k in shifts])`: the
activity is rolled first, then masked. `shifted_sums_for` (or
`cabana.shifted_sums` for a dense indicator) computes per-state sums for all
shifts in one pass, with the label path for exclusive state spaces. Express
the statistic through such sums, as above (an indicator rolls with the data),
or leave `compute_shifted` out: it is correct but slower. `check_plugin` tests the
equivalence on three shifts.

## 6. Null: per-draw surrogates

`surrogate(activity, target, mask, fs, rng) -> (activity_s, target_s)` returns
**one** surrogate and draws only from the `rng` it is given. `shuffle_test`
gives draw `i` its own generator spawned from the seed, so results do not
depend on `n_jobs` or batching, and draws can run in parallel threads. Set
`perturbs` to `"activity"` or `"target"` for what you change (return the
other untouched). The older `surrogates(..., n, rng)` generator (one shared
`rng`) still works but forces serial execution and makes draw `i` depend on draw
`i-1`; implement `surrogate` unless you need that. Override
`check_target(metric, target)` if the null needs a particular target.

```python
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
```

Do not call `np.random.*`, read the clock, or keep state on `self`: two
calls with the same seed must give the same surrogate. A target-shuffling null
should keep per-state masked frame counts (as `label_shuffle` does).

## 7. Selector: choose a parameter, record why

`Selector.select(session, pipeline) -> list[Selection]` runs after
preprocessing; the pipeline applies each `Selection` to a per-run copy with
`set_param`, so the consuming plugin only ever sees a plain number and the
choice lands in `provenance["selections"]`. The path grammar is
`analyses.*.metric.<field>` (`*` = every analysis with that field); see
`docs/STATISTICS.md`, "Recording how a value was chosen". **A selector must never
read p-values, nulls or significant counts**; choose on a criterion independent of
the test (held-out likelihood, map reliability, autocorrelation, a data statistic).
If you knowingly break this, set `informed_by_significance=True`.

```python
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
```

If your rule adds a new tunable, add a row to the "Where the defaults come
from" table in `docs/STATISTICS.md` (module, default, origin, sensitivity,
recommended selection) and state it in your methods.

## 8. check_plugin

```python
import cabana
report = cabana.check_plugin(MaskSpeedOutliers(max_speed=500.0), session)
print(report)              # table of checks
report.raise_if_failed()   # in a test suite
```

`check_plugin(plugin, session, *, target=None, n_shuffles=10, pipeline=None, skip=())`
never modifies `session`. It takes a plugin *instance* and returns a
`PluginReport` with `passed`, `checks` (`(name, ok, message)`), `warnings`,
`__str__` and `raise_if_failed()`. `skip=("check_name",)` waives a check you
break on purpose. Pass `pipeline=` for selectors (paths are resolved in it).

| Kind | Checks |
|---|---|
| all | `round_trip` (`to_dict` -> `build`); warnings for fields without a description or a failing JSON schema |
| Transform, PreprocessStep | `apply`, `input_unchanged` (deep), `frame_count` (changes only via `rebin`/`select_frames`; never for a Transform), `finite_or_nan`, `masks_bool`, `signal_units`, `mask_info`, `deterministic` |
| Metric | `check_target` (also rejects the wrong target kind), `compute_shape`, `inputs_unchanged`, `self_unchanged`, `deterministic`, `cell_permutation` (cell level), `compute_shifted` equals looping `compute` over `np.roll` for 3 shifts, `extras`, `resolve_tail`, `shuffle_engine` (`n_jobs=1` equals `n_jobs=2`) |
| Null | `implements_surrogate`, `surrogate_shapes`, `inputs_unchanged`, `rng_discipline` (same seed equal even if the global RNG differs; other seeds differ), `frame_counts` (activity untouched / target untouched / per-state counts kept), `check_target`, `shuffle_engine` |
| Selector | `select` returns `Selection`s, `pure`, `paths_resolve` (`get_param` and `set_param` accept them), `deterministic`, `no_significance`; a warning if the code mentions p-values |

Metrics and nulls run on the first state space the plugin accepts (a 1-D
float signal for `input="signal"`), with a mask that drops every tenth frame
to exercise masking; pass `target=` to choose.

## 9. Testing your plugin

- Use a small simulated session: `cabana.simulate_session(duration_s=300, n_cells=20, seed=0)`
  plus the transforms you need (`tests/conftest.py::small_session` is the standard
  one), and call `check_plugin(...).raise_if_failed()`.
- Add property checks for what the contract does not cover: a metric on shuffled
  cell order, a null whose surrogate keeps a marginal it promises, a selector's
  value on data with a known answer.
- Compare against a slow reference: run the metric through a hand-written loop
  and `assert_allclose` (rtol 1e-9, as the golden suite does).
- For results that must stay stable, add a golden file (see "Golden regression
  suite" in `docs/DESIGN.md`).

## Plots for your metric

A metric with no plots falls back to generic views. To give yours its own, write
a `plot_<x>_data(result, ...) -> dict` function and a renderer that draws from
it, register the renderer, and name it in the metric:

```python
from cabana.plots import register_plot

@register_plot("active_fraction_bars", data=active_fraction_bars_data,
               level="cell", requires=("values:2d",))
def plot_active_fraction_bars(result, cells=None): ...   # returns a Figure

class ActiveFraction(Metric):
    default_plots: ClassVar[tuple[str, ...]] = ("active_fraction_bars", "tuning_heatmap")
```

`result.plot(session)` and `results.plot_all(session, out_dir=...)` then draw it.
A complete, tested example, the `requires` conditions, the `defaults` hook and the
style rules (`state_colors`, one significance marker, NaN as unvisited grey) are in
[`PLOTS.md`](PLOTS.md), section 5.

## 10. What a front end sees

`cabana.describe()` returns `plugins[kind][name]` with the pydantic JSON schema
(your fields, descriptions, bounds, defaults and enums) and the class
docstring; metrics add `level`, `input`, `default_tail` and `requires_topology`.
A registered plugin appears there with no extra work, so a future UI can offer
it, render its parameter form and explain it from the docstring. Write the first
line of the docstring as a sentence a user can read, and describe parameters
in the field descriptions rather than only in the docstring.
