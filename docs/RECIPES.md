# Recipes: `cabana.analyze`

A recipe is a pipeline YAML (the format `Pipeline.to_yaml` writes) with a `recipe:` header and
`${placeholders}` for what changes between datasets. `cabana.analyze(session, "place_cell",
states="position")` fills the placeholders, validates the result against your session, runs it
and returns `(session, results)`.

```python
import cabana

cabana.recipes()                  # names of the bundled recipes
cabana.recipe("social")           # parsed header + pipeline template
pipe = cabana.recipe_pipeline("social", states="social", n_shuffles=500)   # a plain Pipeline
session, results = cabana.analyze(session, "social", states="social")
results.summary()                 # one row per analysis (see below)
```

## The bundled recipes

| recipe | target | analyses | null and correction |
| --- | --- | --- | --- |
| `place_cell` | `states=` a grid state space | `information_content`, `split_half_stability`, `place_fields`; masks `["speed"]` | `circular_shift`, `correction: none`, 1000 shuffles; selectors `auto_smooth_sigma` and `auto_null_timescale` |
| `social` | `states=` bout state space | `auroc`, `mean_per_state` (`statistic: difference`) | `circular_shift`, `max_stat` across behaviors |
| `social_speed_matched` | `states=` bout state space | as `social` | `covariate_matched_shift` on `speed` (`statistic: mean`, tolerance 0.5, `min_frames` 100), `max_stat` |
| `syllables` | `states=` exclusive labels | `information_content`, `auroc`, `mutual_information` | `circular_shift`; `max_stat` on the auROC |
| `event_response` | `states=` any state space | `peth` on state onsets with `null_band: true` | none: the per-bin null band and latency are descriptive, there is no shuffle test (`n_shuffles=`, `min_shift_s=` and `masks=` raise) |
| `speed_tuning` | `signal=` a per-frame signal | `signal_correlation`, `signal_tuning` | `circular_shift` |
| `head_orientation` | none; signals `head_yaw`, `head_pitch`, `head_roll` (defaults of `${yaw}`, `${pitch}`, `${roll}`) | `circular_tuning` on yaw; `signal_correlation` and `signal_tuning` on pitch and on roll | `circular_shift` |
| `population` | `states=` any state space | `pv_stability`, `population_vector_overlap`, `decode_states`, `participation_ratio`; re-binned to 0.5 s | `cell_shift` (cells at least 1 s apart) for the PV, overlap and participation metrics; `label_shuffle` (block length from `auto_null_timescale`) for `decode_states`; 200 shuffles |

`social_speed_matched` is the variant to use when a behavior rides on locomotion: a plain
circular shift scrambles the speed-to-state alignment, so a cell that simply tracks speed
passes as a behavior cell. The matched null keeps only shifts that leave the speed distribution
inside each behavior unchanged. It raises when no shift can be matched, which is the right
answer when states are defined by speed (the simulator's syllables are), but `validate` cannot
predict it, so the failure shows up in `results.errors` and the warning after the run. The recipe
has no `auto_null_timescale` selector (it only acts on `circular_shift` and `label_shuffle`), so
`min_shift_s` stays at 20 s unless you pass it; see "Choosing a null" in
[`STATISTICS.md`](STATISTICS.md).

`population` uses two nulls because the questions differ: a decoder asks whether the activity
predicts the states, which a per-cell roll does not test, so `decode_states` permutes the states
in blocks (`label_shuffle`), while the PV, overlap and participation metrics are about
cell-to-cell coordination, which only `cell_shift` breaks.

### A PETH with a shuffle test

`event_response` is descriptive. To test the response, copy it and add a `shuffle:` block, as in
this recipe (save it as `peth_shuffle.yaml` and call
`cabana.analyze(session, "peth_shuffle.yaml", states="social")`):

```yaml
recipe:
  name: peth_shuffle
  targets:
    states: a StateSpace whose state onsets are the events
  defaults: {n_shuffles: 500, seed: 0, min_shift_s: 20.0}
pipeline:
  selectors:
  - name: auto_null_timescale
  analyses:
  - name: peth
    metric:
      name: peth
      null_band: true
      null_seed: ${seed}
    states: ${states}
    shuffle:
      n_shuffles: ${n_shuffles}
      min_shift_s: ${min_shift_s}
      seed: ${seed}
      correction: max_stat
```

## Placeholders

| name | meaning | default |
| --- | --- | --- |
| `${states}`, `${signal}` | the target; required when the recipe's `targets:` lists it | none |
| `${masks}` | session masks ANDed into every analysis that uses it | recipe default (`place_cell`: `["speed"]`) |
| `${n_shuffles}` | surrogates per test | recipe default (1000; `population` 200) |
| `${seed}` | base shuffle seed | 0 |
| `${min_shift_s}` | smallest circular shift (s) | 20; replaced by `auto_null_timescale` unless you pass it |

Passing `min_shift_s=` explicitly stops the recipe's `auto_null_timescale` selector from setting
the shift (it may still choose `label_shuffle` block lengths): an explicit value wins over the
data-driven one. A shortcut only works when the recipe has the placeholder: `masks=` on `social`
(no `${masks}`) or `n_shuffles=` on `event_response` raises `ValueError` naming the shortcut and
the recipe instead of being ignored, and a placeholder with no value and no default
(`${n_shuffles}` in a recipe of your own) says which shortcut to pass. A missing required target
fails early with what the recipe needs and what the session has:

```
ValueError: recipe 'place_cell' needs states= (a StateSpace with a grid topology ...);
session has states=['position', 'social', 'syllables'], signals=['speed', 'x', 'y']
```

A recipe may declare `ensure_masks:` (`place_cell` does for `speed`): when the session lacks that
mask but has the named signal, `analyze` prepends the standard preprocess step (a speed threshold)
so the first run works on a session that only went through the transforms. The threshold follows
the position unit, read from `session.meta["signal_units"]` (`speed`, `x`, `y`), `meta["arena"]
["units"]` or the `units` of the `ContinuousSignal` in `session.behavior`: 20 mm/s for mm, 2 cm/s for
cm. When the unit cannot be determined the gate is 2 position-units/s and `analyze` warns; set it
with `**{"preprocess.speed.min_speed": 20.0}` (which also silences the warning). A session with
neither the mask nor the `speed` signal fails validation with a hint to run `resample_signal` and
`speed` first.

A recipe may also declare `ensure_signals:` (`head_orientation` does for the three angle signals):
when the pipeline uses a signal the session lacks and the raw signal named by `source:` is in
`session.behavior`, `analyze` prepends the listed transforms (for `head_orientation`:
`resample_signal(source="head_orientation")` then `head_orientation`). Without the raw signal
validation fails with a hint to add the transforms. The recipe targets yaw (circular tuning:
Rayleigh length and preferred direction), pitch and roll (cross-correlation first, since their
coding is often monotonic, plus binned tuning information). Conventions: head frame x forward,
y left, z up; yaw 0 is +x, positive counter-clockwise from above; pitch is nose-up positive
(rearing gives positive pitch); positive roll is right ear down. A real sensor's yaw zero is
its power-on heading, so set `yaw_offset_deg` on the `head_orientation` transform (add the
transforms yourself to do so). Use other signal names with
`cabana.recipe_pipeline("head_orientation", yaw=..., pitch=..., roll=...)`.

## Overrides

Everything else is reachable with `Pipeline.set_param` paths passed as keyword arguments:

```python
cabana.analyze(session, "place_cell", states="position",
               **{"analyses.*.shuffle.n_shuffles": 200,
                  "analyses.fields.metric.smooth_sigma_bins": 2.0})
```

Each override is recorded as a `user_pick` selection with the note `analyze() override`, and
appears in `results.selections` and every result's provenance. A `user_pick` is never overwritten
by a selector: here `smooth_sigma_bins` stays 2.0 although `auto_smooth_sigma` is in the recipe
(the selector's choice for that parameter is skipped and logged), and `results.selections` lists
only your value for it. `masks=`, `n_shuffles=`, `seed=` and `min_shift_s=` are shortcuts for the
common ones and, for a `Pipeline` passed instead of a recipe name, are applied the same way
(`min_shift_s=` is written into an explicit `shuffle.null` that has the field and raises for one
that does not); a shortcut that matches nothing raises.

## What `analyze` does

1. Resolve `recipe` (a name, a path to a recipe or plain pipeline YAML, or a `Pipeline`).
2. Substitute placeholders and build the `Pipeline`.
3. Apply overrides.
4. `pipeline.validate(session)`: errors raise `ValueError` with the report; warnings are issued
   with `warnings.warn` (`UserWarning`) and logged on the `"cabana"` logger. See below.
5. Run with a progress display (`progress=True`: one line with the estimate, `estimated 7.0 s, peak
   420 MB, 3 analyses on 1200 frames`, then a tqdm bar if tqdm is importable, else stage lines on
   stdout; `False`: silent). `context=` adds your own callbacks, merged with the display.
   `on_error="record"` (the default, and it wins over `context.on_error`) stores a failed analysis
   in `results.errors`, and after the run one `UserWarning` lists them (`2 of 3 analyses failed:
   name: ErrorType: message`); `on_error="raise"` stops at the first.
6. With `out_dir=`: `results.zip`, `pipeline.yaml` (the substituted pipeline) and `summary.csv`.

The same lines are available from the `"cabana"` logger (`logging.basicConfig(level=logging.INFO)`;
shuffle batches log at DEBUG) when you run a pipeline yourself with `cabana.log_context()`.

## Preflight: `pipeline.validate(session)`

`validate_pipeline(pipeline, session, time_budget_s=2.0)` runs the transforms, preprocess
steps and selectors (they define the exact state spaces; a slow selector makes validation
slow) and then checks every analysis without running it.

| level | code | meaning |
| --- | --- | --- |
| error | `missing_target`, `target_kind`, `needs_topology`, `activity_kind`, `bad_target` | the target does not exist or does not fit the metric |
| error | `missing_mask`, `no_frames` | a named mask is absent, or support and masks leave no frame |
| error | `cannot_reach_alpha` | `1/(n_shuffles+1)` (two-tailed `2/(n_shuffles+1)`) is not below `alpha` |
| error | `min_shift_too_long` | `min_shift_s` is at least half the session |
| error | `degenerate_null` | `within_state_shuffle` with a metric it leaves unchanged: `mean_per_state`, `auroc`, `information_content`, `tuning_selectivity`, `mutual_information`, `place_fields`, `population_vector_overlap`, `population_distance`, `pairwise_correlation`, `participation_ratio`, `pca_population` |
| error | `null_incompatible`, `null_config`, `prepare_failed`, `check_failed` | the null, a transform or a check raised |
| warning | `little_data`, `empty_states` | under 60 s of data left; states with no frames after masking |
| warning | `min_shift_long` | `min_shift_s` over a quarter of the session |
| warning | `cell_shift_cell_level` | `cell_shift` equals `circular_shift` per cell for a cell-level metric |
| warning | `correction_floor`, `selectors_failed` | Bonferroni over the real family (the cells for a per-cell result or `correction_scope: cells`, the states for a cell-by-state result) puts the p-value floor above alpha; selectors raised, checks ran without them |
| info | `no_correction` | a cell-level result with a state axis tested with `correction: none`: consider `max_stat` (not suggested for per-state population vectors, where it does nothing) |
| info | `prefer_cell_shift` | `participation_ratio` / `pairwise_correlation` are unchanged by a common circular shift; `pv_stability` / `population_vector_overlap` only test the alignment with the states: use `cell_shift` |

The report has `ok`, `errors`, `warnings`, `issues`, `estimates[analysis] = {n_frames_used,
time_s, memory_bytes}`, `total_time_s`, `peak_memory_bytes`, `to_dict()` and a readable `str()`.
Time is extrapolated from one `compute` plus a batch of five shifts to `n_shuffles` (divided by the
usable workers); once `time_budget_s` is spent, later analyses are not timed (`time_s` is `None`),
`time_is_lower_bound` is True and `str(report)` shows `Total time >= ...`, but every other check
(null configuration, correction hints) still runs. Memory comes from `cabana.memory_estimate`.

## Summaries

`results.summary()` (`cabana.summarize`) gives one row per analysis: `analysis, metric, target,
level, null, n_shuffles, correction, n_tested, n_significant, frac_significant,
n_significant_adj, frac_significant_adj, median_z, max_z, median_value, n_warnings, error`.
For a cell-level result with a state axis a cell counts as tested or significant when any
state does, and the z columns use each cell's largest z. The z columns are oriented toward the
tested tail (`|z|` for two-tailed, `-z` for lower-tail, `z` for upper-tail results), so inhibited
cells are not hidden. A square population matrix (state-by-state, cell-by-cell) counts each pair
once (upper triangle without the diagonal). When any result used a correction the adjusted
columns come before the raw ones. `by="state"` gives one row per analysis and state; `alpha=`
recomputes significance from the p-values. Failed analyses appear
with their message in `error`. `cabana.format_summary(df)` renders a plain-text table.

## Writing your own recipe

Copy a bundled one (`importlib.resources.files("cabana") / "recipes"`) and pass its path:
`cabana.analyze(session, "my_recipe.yaml", states="position")`. A plain pipeline YAML (no
header) also works; its placeholders, if any, are filled from the same arguments. Quote the
key `'null'` in a `shuffle:` block (bare `null:` is YAML's null), and write placeholders inside
block mappings, not flow `{...}` ones.
