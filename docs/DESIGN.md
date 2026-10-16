# CaBaNA design

CaBaNA (Calcium Behavioral and Neural Analysis) is a pipeline for asking how
neural activity relates to behavioral *states*. It generalizes what CaMAP
(place cells) and CaSA (social behavior) each do separately.

## The one idea

Every analysis we have done so far reduces to three arrays on the neural clock:

| object | shape | meaning |
| --- | --- | --- |
| `Session.activity` | `(n_cells, n_time)` | deconvolved calcium, dF/F, or binned spike counts |
| `StateSpace.onehot` | `(n_time, n_states)` bool | which behavioral state(s) the animal is in each frame |
| `Session.valid_mask()` | `(n_time,)` bool | which frames count (speed threshold, scored coverage, ...) |

Spatial bins (1D/2D/3D), behavioral syllables, and manually scored bouts are
all just different ways of filling `onehot`. Once behavior is in that form,
information content, split-half stability, AUROC, and population-vector
analyses are the same code regardless of experiment. A circular-shift shuffle
engine wraps any of them to produce null distributions and p-values.

Preprocessing (what frames to keep, how to smooth) and plotting (how to show a
2D rate map vs. a bout ethogram) are where experiments differ, so those are
plugin points. The middle is shared.

## Pipeline stages

```
 import ──► transform ──► preprocess ──► analyze ──► results ──► plots
 loaders    behavior →     masks,        metric ×    tidy table   dispatch on
 → Session  StateSpace     smoothing     shuffle     + arrays     StateSpace.kind
```

1. **Import.** Loaders build a `Session`: activity, timestamps, `fs`,
   `activity_kind`, and raw behavior inputs on their own clocks
   (`ContinuousSignal`, `BoutTable`, `LabelSeries`). Ephys enters as spike
   times binned to a chosen `fs` with `activity_kind="spike_counts"`.
2. **Transform.** `Transform` plugins resample behavior onto the neural clock
   and build `StateSpace`s (bin position into a grid, turn bouts into boolean
   vectors, step-resample syllables). They also add per-frame `signals`
   (x, y, speed) and coverage `masks`.
3. **Preprocess.** `PreprocessStep` plugins add masks (speed threshold, time
   range) or modify activity (temporal smoothing, z-score, binarize).
4. **Analyze.** `Metric` plugins compute a statistic from `(activity, states,
   mask, fs)`. Optionally wrapped in `shuffle_test` for a null distribution.
   Each analysis chooses which masks apply: a speed threshold belongs on
   spatial metrics but not on social bouts (huddling is stationary), and a
   "still" syllable must not be filtered out by the speed mask.
5. **Results.** `MetricResult` / `ResultSet` with `to_dataframe()` for a tidy
   cell × state × metric table.
6. **Plots.** Functions in `_plots.py` that look at `StateSpace.kind` and
   `topology` to decide how to draw.

## Core objects (`src/cabana/_models.py`)

Read the module; docstrings are the spec. Key points:

- `Session` is immutable by convention. Stages return
  `session.model_copy(update=...)`; use `with_state`, `with_signal`,
  `with_mask`, `with_activity` helpers.
- `StateSpace.exclusive` is True for bins/syllables (one state per frame) and
  False for bouts (overlap allowed). `labels()` only works when exclusive.
- `StateSpace.topology` (a `GridTopology`) exists only for binned continuous
  variables. Metrics that smooth across neighbouring bins or detect fields
  need it; order-free metrics must work without it.
- `StateSpace.masked(mask)` returns `onehot & mask` as float64 — the matrix
  every metric multiplies activity against.
- Frames with no active state (unoccupied, unscored) have an all-False row and
  contribute nothing. Unscored ≠ "rest".

## Plugin contract (`src/cabana/_registry.py`)

Plugins are pydantic models whose fields are the parameters, registered by a
class-level `name`:

```python
@register("metric")
class InformationContent(Metric):
    name: ClassVar[str] = "information_content"
    min_occupancy_s: float = Field(0.05, ge=0)
    ...
    def compute(self, activity, states, mask, fs) -> np.ndarray: ...
    def compute_shifted(self, activity, states, mask, fs, shifts) -> np.ndarray | None: ...
    def extras(self, activity, states, mask, fs) -> dict[str, np.ndarray]: ...
```

`build("metric", {"name": "information_content", "min_occupancy_s": 0.1})`
reconstructs any plugin from a dict, so pipelines serialise to YAML/JSON.

Each metric has a class-level `default_tail` ("upper", "lower" or "two"). The
shuffle engine calls `Metric.resolve_tail(target)` when `ShuffleConfig.tail` is
`None`; the default returns `default_tail`, and `bayesian_decoder` overrides it
because its value is an error in physical units on a grid (smaller is better,
lower tail) but a per-state recall on categorical states (larger is better,
upper tail). One metric therefore serves both target types without a second
registration, and an explicit `ShuffleConfig.tail` still wins.

Metric output shapes: `(n_cells,)` or `(n_cells, n_states)` for
`level="cell"`; anything for `level="population"`.

## Shuffle engine (`src/cabana/_shuffle.py`)

`shuffle_test(metric, activity, states, mask, config, fs) -> ShuffleResult`.

- A shift `k` is `np.roll(activity, k, axis=1)` over the **full** session,
  **then** the mask is applied. (CaMAP shifts the speed-filtered subset,
  which ignores gaps; we do not copy that.)
- Shifts are drawn without replacement from `[min_shift, n_time - min_shift]`.
- `p = (count_extreme + 1) / (n_valid + 1)` over finite null draws; two-tailed
  doubles the smaller side. `null_lo`/`null_hi` are the percentile thresholds.
  An undefined observed value (e.g. a state with no frames inside the mask)
  gives `p = NaN` and `significant = False`, never a false positive.
- Fast path: `shifted_sums(x, columns, shifts) -> (n_shifts, n_cells, n_cols)`
  gives per-column sums of `x` for every shift with one matmul each. Rate
  maps, split-half maps and rank sums are all of this form, so every core
  metric implements `compute_shifted` with it. Equivalence with explicit
  rolling is tested.

## Module specs for the first demo

Everything below is on the neural clock unless stated. All functions take and
return the core objects above. NumPy-style docstrings, `from __future__ import
annotations`, ruff clean (line length 100).

### `_simulate.py` — synthetic session with ground truth

`SimulationConfig(BaseModel)` and `simulate_session(config) -> Session`.

Defaults: `fs=20`, `duration_s=1200`, `n_cells=200`, `seed=0`.

- **Arena & trajectory.** Square arena `arena_size_mm=400`. Smooth random walk
  (Ornstein–Uhlenbeck velocity, reflected at walls) sampled on a *behavior*
  clock `behavior_fs=30` that starts 2 s before and ends 2 s after the neural
  clock. Include occasional stationary pauses (speed ≈ 0 for 2–10 s) so a
  speed threshold has something to remove. Stored as
  `session.behavior["position"] = ContinuousSignal(channels ["x","y"], units "mm")`.
- **Social bouts.** `BoutTable` under `session.behavior["social"]` with
  behaviors `["sniff", "groom", "chase", "huddle"]`, Poisson-ish bout onsets
  with log-normal durations (means ~3, 6, 2, 10 s), a 2 s refractory gap
  between bouts of the same behavior, overlaps across behaviors allowed.
  Scored span is `[30 s, duration − 30 s]`.
- **Syllables.** `LabelSeries` under `session.behavior["syllables"]`, derived
  from the trajectory kinematics on the behavior clock: e.g. `still`,
  `walk`, `run`, `turn_left`, `turn_right` (6–8 labels). Optional via
  `include_syllables=True`.
- **Cells.** Log-normal baseline rates (median 0.2 Hz). Disjoint tuned
  populations: `frac_place=0.3` cells with 2D Gaussian fields (σ 30–60 mm,
  peak 3–8 Hz above baseline, gated by speed > 20 mm/s); `frac_social=0.2`
  cells each tied to one behavior, half excited (×3–5) and half inhibited
  (×0.2); `frac_syllable=0.1` cells tuned to one syllable (×3). Remaining
  cells untuned.
- **Activity.** Rate → Poisson counts per neural frame → multiply by a
  per-event log-normal amplitude (σ 0.3) to mimic deconvolved calcium.
  `activity_kind="deconvolved"`. A parameter `kind="spike_counts"` skips the
  amplitude step to mimic ephys.
- **Ground truth** in `session.meta["ground_truth"]`: `place_cells` (indices),
  `field_centers_mm` (n_place, 2), `social_cells` (list of
  `{"cell", "behavior", "sign"}`), `syllable_cells`, `speed_gate_mm_s`.
  `session.meta["simulation"] = config.model_dump()`.

### `_transform.py` — behavior → state spaces

Registered `Transform`s (each has an `output: str` naming what it writes):

| name | params | writes |
| --- | --- | --- |
| `resample_signal` | `source` (behavior key of a `ContinuousSignal`), `channels: list[str] \| None` | `signals[channel]` by `np.interp` onto `session.t`, NaN outside the source range; `masks[f"{source}_covered"]` |
| `speed` | `signals=["x","y"]`, `window_s=0.25`, `output="speed"` | `signals["speed"]` in units/s via centered difference over the window |
| `bin_grid` | `signals=["x","y"]`, `bin_size: float \| None`, `n_bins: int \| list[int] \| None`, `extent: list[tuple[float,float]] \| None` (default from data range), `output="position"` | `StateSpace(kind="grid", exclusive=True, topology=GridTopology)`; NaN frames get no state; `state_names` like `"x03_y07"` |
| `bouts_to_states` | `source`, `behaviors: list[str] \| None`, `exclusive=False`, `add_rest=False`, `rest_name="rest"`, `output="social"` | `StateSpace(kind="bouts")`; frame active when `start_s <= t < stop_s`; if `exclusive`, overlaps resolve by order in `behaviors`; `rest` = scored & no behavior; `masks[f"{output}_scored"]` from the scored span |
| `labels_to_states` | `source`, `output="syllables"` | step (previous-sample) resample of `LabelSeries` onto `session.t`; `StateSpace(kind="categorical", exclusive=True)`; `-1` → no state; `masks[f"{output}_covered"]` |

### `_preprocess.py` — masks and signal conditioning

| name | params | effect |
| --- | --- | --- |
| `speed_threshold` | `signal="speed"`, `min_speed`, `max_speed=None`, `output="speed"` | `masks[output] = (speed >= min) & (speed <= max)`; NaN → False |
| `time_range` | `start_s`, `stop_s`, `output="time_range"` | mask on `session.t` |
| `smooth_activity` | `sigma_s` | Gaussian along time, per cell |
| `zscore_activity` | — | per-cell z-score within `valid_mask()`; keeps `activity_kind` |
| `binarize_activity` | `threshold=0.0` | `activity > threshold` as float |

### `_pipeline.py` — declarative chaining

```python
class AnalysisSpec(BaseModel):
    metric: dict | Metric          # built via build("metric", ...)
    states: str                    # StateSpace name
    shuffle: ShuffleConfig | None  # None = observed only
    masks: list[str] | None        # which session.masks to AND; None = all, [] = none

class Pipeline(BaseModel):
    transforms: list[dict | Transform] = []
    preprocess: list[dict | PreprocessStep] = []
    analyses: list[AnalysisSpec] = []

    def run(self, session, progress=False) -> tuple[Session, ResultSet]
    def to_dict(self) -> dict ; @classmethod from_dict(cls, d) ; to_yaml/from_yaml (optional, pyyaml if present)
```

`run` applies transforms then preprocess, then for each analysis takes
`mask = session.valid_mask(spec.masks)`, runs `shuffle_test` or `metric.compute`, calls
`metric.extras`, and appends a `MetricResult` carrying `cell_ids`,
`state_names`, `params=metric.to_dict()`.

### `_metrics/` — the core four (plus one)

All implement `compute_shifted` via `shifted_sums`. "Rate map" below means
`sum(activity in state) / occupancy_s`, computed on masked frames; states
with `occupancy_s < min_occupancy_s` are NaN/invalid. When `smooth_sigma_bins
> 0` the sums and occupancy are reshaped to `topology.shape`, Gaussian
filtered with zero padding and divided by the filtered valid mask (CaMAP /
Skaggs convention), then divided. Smoothing with no topology raises.

| name | level | output | definition | default tail |
| --- | --- | --- | --- | --- |
| `information_content` | cell | `(n_cells,)` | Skaggs: `Σ_i P_i (λ_i/λ̄) log2(λ_i/λ̄)` over valid states with `λ_i>0`; `P_i = occ_i/Σocc`, `λ̄ = Σ P_i λ_i`. `units="bits_per_event"` (default) or `"bits_per_second"` (multiply by λ̄). `weight="amplitude"` uses activity as-is, `"binary"` uses `activity > 0`. **Requires `exclusive`** (error otherwise, pointing at `bouts_to_states(exclusive=True)`). Extras: `rate_map (n_cells,n_states)`, `occupancy_s`, `valid_states`. | upper |
| `split_half_stability` | cell | `(n_cells,)` | Split masked time into `n_blocks` contiguous blocks (default 2); even blocks → half A, odd → half B (so `n_blocks=10` is interleaved). Pearson r between the two rate maps over states valid in both halves (≥3 states else NaN). Extras: `rate_map_a`, `rate_map_b`, `valid_states`. Shifted: columns `[M_A | M_B]`. | upper |
| `auroc` | cell | `(n_cells, n_states)` | Mann–Whitney AUROC of activity in state vs. out of state among masked frames: `(R1 − n1(n1+1)/2) / (n1 n0)` with `R1` = rank sum (average ties) in state. `min_frames=20` per side else NaN. Shifted: rank the rolled activity over masked frames (`scipy.stats.rankdata(axis=1)` on the batch), then `shifted_sums`-style matmul; when `mask.all()` rank once. Extras: `n_in_state`. | two |
| `population_vector_overlap` | population | `(n_states, n_states)` | Rate maps `(n_cells, n_states)`; `similarity="cosine"` (default) or `"pearson"` between every pair of state population vectors; `normalize_cells=True` divides each cell's map by its max first; invalid states NaN. Extras: `rate_map`. No `compute_shifted` (a common shift does not break cell–cell structure in a useful way here). | upper |
| `pv_stability` | population | `(n_states,)` | Per state: Pearson r across cells between half-A and half-B population vectors (same halves as `split_half_stability`). Shifted via `[M_A \| M_B]` — a common shift keeps cell–cell structure and breaks the behavior link, which is the right null for "is the population code for this state stable". | upper |

### `_plots.py` — matplotlib

All return a `Figure` (accept `ax=None` where single-panel). Dispatch on
`StateSpace.kind` / `topology`.

- `plot_behavior_overview(session, *, position_signals=("x","y"), states=None)`:
  trajectory (if x,y), speed trace with the speed mask shaded, ethogram raster
  for each `bouts` state space, label strip for each `categorical` one.
- `plot_rate_maps(session, result, cells, ncols=6)`: grid → `imshow` of
  `extras["rate_map"]` reshaped to `topology.shape` (NaN transparent),
  annotated with value and p; otherwise bar chart per state.
- `plot_shuffle_distribution(result, cell, state=None, ax=None)`: null
  histogram, observed line, `null_lo/null_hi` lines, p in title.
- `plot_tuning_heatmap(result, sort_by=None)`: cells × states heatmap of
  `values` with significance markers; for `auroc` center the colormap at 0.5.
- `plot_metric_scatter(result_x, result_y, ax=None)`: e.g. information vs
  stability, points colored by joint significance (CaMAP summary scatter).
- `plot_population_matrix(result)`: `imshow` of a population-level matrix with
  state names on both axes.
- `plot_ground_truth_recovery(session, resultset)`: for each planted
  population, fraction detected vs. false-positive rate among untuned cells.

### `examples/demo.py`, `notebooks/cabana_demo.ipynb`, `tests/`

The demo simulates one session, runs **one pipeline** that produces three
state spaces (2D grid, social bouts, syllables) from the same activity, runs
the core metrics on each where applicable, writes figures to
`examples/output/`, and prints a ground-truth recovery table. The notebook is
the same flow with prose. Tests: contract tests for models/registry, shuffle
engine equivalence and false-positive rate, each metric against a hand
computation on a tiny example and against planted ground truth on a short
simulation.

## Conventions

Follow CaLab's Python conventions: src layout, underscore-private modules
with a flat public API in `cabana/__init__.py`, pydantic v2 configs with
`Field(..., description=...)`, NumPy-style docstrings, `py.typed`, ruff with
line length 100, flat `tests/`. `fs` is always Hz; arrays are
`(n_cells, n_time)`.

## Non-goals for the first demo

Loaders for real formats (Minian, CaImAn, DLC, BORIS, `.camap`), temporal
re-binning that changes `n_time`, PETHs, decoders, place-field detection,
multi-session/cohort statistics. All have an obvious home in the structure
above and are listed so reviewers know they were deferred, not forgotten.

## Second increment (after Samara's survey)

The survey in `ANALYSIS_COVERAGE.md` changed four contracts and added
modules. Contract changes:

- **Targets.** A metric declares `input = "states"` (gets a `StateSpace`) or
  `input = "signal"` (gets a `(n_time,)` or `(n_time, d)` array from
  `session.signals`). `AnalysisSpec` takes exactly one of `states=` /
  `signal=`. `MetricResult.target` names it, `target_kind` says which.
- **Nulls are plugins.** `ShuffleConfig.null` is a `Null` plugin:
  `circular_shift` (default; shifts activity, fast path via
  `compute_shifted`), `label_shuffle` (permutes the target in time blocks, within the mask),
  `bout_shuffle` (re-places bouts inside the mask, preserving count,
  durations and exclusivity; warns when the space is too dense to avoid
  overlap). Nulls
  that perturb the target loop over `metric.compute`.
- **Re-binning.** `Session.rebin(bin_s)` resamples every per-frame object
  together (activity summed or averaged by kind, masks and states by
  occupancy fraction). `rebin_time` is the preprocess step. Population
  analyses run on re-binned sessions.
- **Activity kinds.** `Metric.accepts_kinds` lets a metric refuse a trace
  type it is not defined for (Skaggs information on z-scored dF/F).

New metrics: `mean_per_state`, `peth` (with a paired pre/post Wilcoxon in
extras), `signal_correlation` (with lagged cross-correlation),
`signal_tuning`, `pca_population`, `population_distance`, `decode_states`
(contiguous-block cross-validation), `glm_encoding`. The third increment adds
`mutual_information` and `bayesian_decoder` (below).

Results-level functions (`_posthoc.py`): `significant_cells`,
`overlap_vs_chance` (hypergeometric), `overlap_matrix`, `response_features`,
`response_clusters`.

### Design matrix and GLM (`_design.py`, `_metrics/_glm.py`)

`design_matrix` is a transform that writes `signals[output]` as an
`(n_time, n_regressors)` float array built from named state spaces (one
column per state; for an *exclusive* space one reference state is dropped,
`rest` if present else the last, because a complete one-hot set plus the
intercept is collinear and every state's unique contribution would be zero),
named signals (standardized), optional temporal basis
expansion (raised cosines over `[-pre_s, post_s]` for state columns) and an
intercept handled by the model. Column names are deterministic:
`"{states}:{state}"` then `"{signal}"`, with basis columns suffixed
`"@{k}"`; the transform records them in `session.meta["design_columns"][output]`
and `glm_encoding` reads them back through the `Metric.configure(session,
target_name)` hook, which the pipeline calls before `compute` so a metric can
pick up session metadata the arrays alone do not carry. `design_matrix` is
also registered as a preprocess step so it can run *after* `rebin_time`.

`glm_encoding` (metric, `input = "signal"`, level cell): Poisson (default for
event-like kinds) or Gaussian ridge regression of each cell on the design
matrix, fitted for all cells at once (batched IRLS in numpy; the design is
shared, only the weights differ per cell). Contiguous-block cross-validation.
Values `(n_cells, n_groups)`: unique contribution of each regressor group
(columns sharing a prefix before `:` or `@`) as the drop in held-out
deviance explained when the group is removed. Extras: `weights`,
`deviance_explained` (full model), `kernels` when a basis is used.

### Across sessions and animals (`_cross_session.py`, `_cohort.py`)

`CellMatch(session_a, session_b, pairs (n_pairs, 2), confidence)` records a
registration (CellReg-style). `SessionSet(sessions: dict[str, Session],
animal: dict[str, str], matches: list[CellMatch])` holds a cohort.

Cross-session functions take two `MetricResult`s computed on the same state
space definition (`GridTopology` edges must match) plus a `CellMatch`:
`cross_session_map_correlation` (per matched cell, Pearson r between maps;
null = pair the cell with every *other* matched cell, the survey's
"shuffled-cell null", computed exactly so the smallest per-cell p is
`1/n_pairs`; a permutation null is used only for the population median), `cross_session_pv_correlation` (per state, across
matched cells), and `remapping_summary`.

Cohort functions operate on a long table built by `cohort_table(results_by_session,
animal)`: `fraction_significant_by_animal`, `compare_states_across_animals`
(paired Wilcoxon across animals, e.g. behavior vs control), and
`hierarchical_bootstrap` (resample animals, then cells within animal). The
animal is the statistical unit, as in CaSA.

## Third increment: amplitude as a dimension

New modules: `_metrics/_discretize.py` (shared level discretiser),
`_metrics/_mutual_information.py` (`mutual_information`, cell level),
`_metrics/_bayes.py` (`bayesian_decoder`, population level), and the plot
functions `plot_joint_histogram`, `plot_information_comparison` and
`plot_level_sweep` in `cabana.plots`.

**Motivation.** Skaggs information and rate maps collapse a cell's activity in a
state to its mean. A cell whose amplitude distribution changes with state but
whose mean barely does, or whose mean is inflated by rare large transients, is
described poorly by that one number, and Climer & Dombeck (2021) and Souza et
al. (2018) document how calcium kinetics and event amplitude distort
Skaggs-style measures. Adding a discretised amplitude axis turns the 1-D tuning
curve into a 2-D state by level histogram. Mutual information over that
histogram measures everything the amplitude distribution says about the state,
not only its mean. If amplitude carries nothing beyond field membership, the
in-field columns of the conditional histogram are identical to each other (not
uniform: deconvolved activity is zero-dominated), so the useful view is
p(level | state), exposed as the `conditional` extra, rather than raw counts.

**One histogram, two consumers.** The same state by level histogram is the
empirical likelihood table of a naive-Bayes decoder: P(level | state) per cell.
That is why both plugins share `_discretize.py`. Zero is its own "silent" level
for non-negative data; the remaining edges come from quantile, log, linear or
binary rules computed per cell on masked, unshifted frames and then reused for
every surrogate, so the shuffle changes only the alignment of activity and
state, never the binning. Joint counts cost one indicator matmul per level
through `shifted_sums`, so `compute_shifted` accumulates one level at a time
(about 1.1 s per 100 shifts on the default simulated session).

**`mutual_information`.** Plug-in I(level; state) in bits per cell. Extras:
`joint`, `conditional`, `edges`, `occupancy_s`, `valid`. The optional
Miller-Madow correction (Miller 1955; see Treves & Panzeri 1995 on the bias) is
off by default, because the shuffle null has the same occupancy and the same
activity marginal and so carries the same finite-sampling bias; subtracting it
twice would only add noise.

**`bayesian_decoder`.** Cross-validated naive Bayes with contiguous folds.
`likelihood` selects `gaussian` (Shuman et al. 2020: binarized activity,
per-block mean and s.d. maps with an s.d. floor, 0.25 s test window, occupancy
prior), `poisson` (Zhang et al. 1998) or `empirical` (per-cell P(level | state)
tables from the discretiser with a Dirichlet pseudocount).
`smooth_sigma_bins` smooths the training maps over a `GridTopology` and applies
to all three likelihoods. The value is the per-state median decoding error in
physical units on a grid (lower tail) or the per-state recall on categorical
states (upper tail), chosen by `resolve_tail`. Extras: `confusion`, `decoded`,
`error`, `error_overall`, `accuracy_overall`, `chance_error` (always guess the
prior's mode), `n_frames`, `posterior_mean_confidence`. On the default
simulation (400 bins of 20 mm, 400 mm arena, chance error 247 mm) the Gaussian
likelihood with Shuman's per-state sigma reaches 85 mm with one bin of
smoothing, Poisson 45 mm, and the Gaussian with a pooled sigma (`sigma="pooled"`,
one within-state sigma per cell, LDA-style) also 45 mm. Per-state sigma fails
outright on unbalanced categorical states: on the simulator's exclusive social
space (rest and huddle hold three quarters of the frames) rare states get a wide
sigma and a flat Gaussian, so the flattest state wins whenever a cell is active,
and accuracy is 0.06 against 0.42 for pooled sigma and 0.50 for Poisson. Spatial
bins have similar occupancy, which is why the per-state form works in the paper.
The empirical likelihood shows the data-sufficiency problem made concrete: with
the same smoothing and a pseudocount of 0.1 it reaches 100 mm with two levels
(silent / active) but only 118 mm with five, because the few positive frames
per bin are split across four levels; with a pseudocount of 1 the five-level
version sits at chance (255 mm), since the pseudocount swamps the smoothed
counts. Both trail Poisson, which scores a 0.25 s window of activity rather
than one frame's level.

**Costs, and when amplitude pays.** Joint bins multiply (n_states by
n_levels), so finite-sample bias and variance both rise and many cells will have
empty or near-empty cells in the histogram. The shuffle null absorbs the bias.
Whether amplitude is worth it is a per-dataset question with two checks: the
demo's levels sweep (detection and false-positive rate of `mutual_information`
against `n_levels` in {2, 3, 5, 8} and session length in {300, 600, 1200} s on
the simulator's planted place cells), and, on real data, whether I(levels)
exceeds I(binary) by more than the null spread for the cells of interest. If it
does not, binary activity and the Skaggs form are the better-powered choice.
