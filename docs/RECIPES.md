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
| `event_response` | `states=` any state space | `peth` on state onsets with `null_band: true` | none (descriptive band and latency) |
| `speed_tuning` | `signal=` a per-frame signal | `signal_correlation`, `signal_tuning` | `circular_shift` |
| `population` | `states=` any state space | `pv_stability`, `population_vector_overlap`, `decode_states`, `participation_ratio`; re-binned to 0.5 s | `cell_shift`, 200 shuffles |

`social_speed_matched` is the variant to use when a behavior rides on locomotion: a plain
circular shift scrambles the speed-to-state alignment, so a cell that simply tracks speed
passes as a behavior cell. The matched null keeps only shifts that leave the speed distribution
inside each behavior unchanged. It raises when no shift can be matched, which is the right
answer when states are defined by speed (the simulator's syllables are); see "Choosing a null"
in [`STATISTICS.md`](STATISTICS.md).

## Placeholders

| name | meaning | default |
| --- | --- | --- |
| `${states}`, `${signal}` | the target; required when the recipe's `targets:` lists it | none |
| `${masks}` | session masks ANDed into every analysis that uses it | recipe default (`place_cell`: `["speed"]`) |
| `${n_shuffles}` | surrogates per test | recipe default (1000; `population` 200) |
| `${seed}` | base shuffle seed | 0 |
| `${min_shift_s}` | smallest circular shift (s) | 20; replaced by `auto_null_timescale` unless you pass it |

Passing `min_shift_s=` explicitly removes the recipe's `auto_null_timescale` selector: an
explicit value wins over the data-driven one. A missing required target fails early with what the
recipe needs and what the session has:

```
ValueError: recipe 'place_cell' needs states= (a StateSpace with a grid topology ...);
session has states=['position', 'social', 'syllables'], signals=['speed', 'x', 'y']
```

A recipe may declare `ensure_masks:` (`place_cell` does for `speed`): when the session lacks that
mask but has the named signal, `analyze` prepends the standard preprocess step (a speed threshold at
5 units/s) so the first run works on a session that only went through the transforms. Override
it with `**{"preprocess.speed.min_speed": 20.0}`.

## Overrides

Everything else is reachable with `Pipeline.set_param` paths passed as keyword arguments:

```python
cabana.analyze(session, "place_cell", states="position",
               **{"analyses.*.shuffle.n_shuffles": 200,
                  "analyses.fields.metric.smooth_sigma_bins": 2.0})
```

Each override is recorded as a `user_pick` selection with the note `analyze() override`, and
appears in `results.selections` and every result's provenance. `masks=`, `n_shuffles=`, `seed=`
and `min_shift_s=` are shortcuts for the common ones and, for a `Pipeline` passed instead of a
recipe name, are applied the same way.

## What `analyze` does

1. Resolve `recipe` (a name, a path to a recipe or plain pipeline YAML, or a `Pipeline`).
2. Substitute placeholders and build the `Pipeline`.
3. Apply overrides.
4. `pipeline.validate(session)`: errors raise `ValueError` with the report; warnings go to the
   `"cabana"` logger. See below.
5. Run with a progress display (`progress=True`: a tqdm bar if tqdm is importable, else INFO log
   lines; `False`: silent). `context=` adds your own callbacks, merged with the display.
   Failed analyses are recorded in `results.errors` unless your `context` says `on_error="raise"`.
6. With `out_dir=`: `results.zip`, `pipeline.yaml` (the substituted pipeline) and `summary.csv`.

To see log output: `logging.basicConfig(level=logging.INFO)`; shuffle batches log at DEBUG.

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
| error | `degenerate_null` | `within_state_shuffle` with `mean_per_state`, `auroc`, `information_content` or `tuning_selectivity` |
| error | `null_incompatible`, `null_config`, `prepare_failed`, `check_failed` | the null, a transform or a check raised |
| warning | `little_data`, `empty_states` | under 60 s of data left; states with no frames after masking |
| warning | `min_shift_long` | `min_shift_s` over a quarter of the session |
| warning | `cell_shift_cell_level` | `cell_shift` equals `circular_shift` per cell for a cell-level metric |
| warning | `correction_floor`, `selectors_failed` | Bonferroni floor above alpha; selectors raised, checks ran without them |
| info | `no_correction` | several states tested with `correction: none`: consider `max_stat` |
| info | `prefer_cell_shift` | a population metric under a common circular shift is unchanged: use `cell_shift` |

The report has `ok`, `errors`, `warnings`, `issues`, `estimates[analysis] = {n_frames_used,
time_s, memory_bytes}`, `total_time_s`, `peak_memory_bytes`, `to_dict()` and a readable `str()`.
Time is extrapolated from one `compute` plus a batch of five shifts to `n_shuffles` (divided by the
usable workers); once `time_budget_s` is spent, later analyses are not timed (`time_s` is `None`).
Memory comes from `cabana.memory_estimate`.

## Summaries

`results.summary()` (`cabana.summarize`) gives one row per analysis: `analysis, metric, target,
level, null, n_shuffles, correction, n_tested, n_significant, frac_significant,
n_significant_adj, frac_significant_adj, median_z, max_z, median_value, n_warnings, error`.
For a cell-level result with a state axis a cell counts as tested or significant when any
state does, and the z columns use each cell's largest z. `by="state"` gives one row per
analysis and state; `alpha=` recomputes significance from the p-values. Failed analyses appear
with their message in `error`. `cabana.format_summary(df)` renders a plain-text table.

## Writing your own recipe

Copy a bundled one (`importlib.resources.files("cabana") / "recipes"`) and pass its path:
`cabana.analyze(session, "my_recipe.yaml", states="position")`. A plain pipeline YAML (no
header) also works; its placeholders, if any, are filled from the same arguments. Quote the
key `'null'` in a `shuffle:` block (bare `null:` is YAML's null), and write placeholders inside
block mappings, not flow `{...}` ones.
