# Statistics guide

How CaBaNA turns a metric into a p-value, and what to do with the p-values.
Numbers in brackets refer to [`REFERENCES.md`](REFERENCES.md).

## Which null to use

A null is a way of breaking the link between activity and behavior while
keeping everything else. It is chosen in `ShuffleConfig`.

| null | what it does | use it for |
| --- | --- | --- |
| `circular_shift` (default) | rolls each cell's activity in time by a random offset (at least `min_shift_s`) | single-cell questions: it keeps the autocorrelation of both the activity and the behavior, which a plain permutation would destroy |
| `label_shuffle` | permutes the target in time blocks, within the mask | population and decoder questions (decoding, PV distances, PCA separation), where cell-to-cell structure must stay intact |
| `bout_shuffle` | re-places scored bouts at random times inside the mask | bout-structured behavior; preserves bout count, durations and exclusivity |

These are the original three; "Choosing a null" below adds the covariate-matched shift, the cell shift and the within-state shuffle. Changing the null is one line:

```python
shuf = ShuffleConfig(n_shuffles=1000, null={"name": "bout_shuffle"})
```

The circular shift is the usual choice in the surveyed literature for
auROC, tuning, correlation and rate-map information [see ANALYSIS_COVERAGE.md].

To compare nulls on the same metric and target, put both analyses in one
pipeline and name them (`AnalysisSpec(name="auroc_bout", ...)`; unnamed ones become
`auroc[social]` and `auroc[social]#bout_shuffle`). The tidy table then has an
`analysis` and a `null` column, and `fraction_significant_by_animal(...,
analysis="auroc_bout")` and the other cohort functions select one without mixing
them.

The full null matrix can be large (`n_cells x n_states x n_shuffles`, or
`n_shuffles` times a population output such as a confusion matrix). When you only
need p-values and the null's bounds, set `ShuffleConfig(keep_null="none")`: the
p-values, `null_lo`/`null_hi`, `null_median` and `null_mean` are kept and the
matrix is dropped, so results stay small in memory and in `ResultSet.save`.
Plots that draw the null histogram need `keep_null="full"` (the default).

### Choosing a null

Six nulls are registered (`cabana.available("null")`). The three in the table
above break the link between activity and behavior in different ways; the other
three answer questions the first three cannot.

| null | what it breaks | what it preserves | use it for | fast path | caveats |
| --- | --- | --- | --- | --- | --- |
| `circular_shift` | the alignment of every cell with the behavior (all cells rolled by the same offset) | each cell's autocorrelation, the behavior's autocorrelation, cell-to-cell structure | single-cell tuning: auROC, information, mean per state, signal tuning, `place_fields`, `circular_tuning`, `decode_signal` | yes | leaves population statistics unchanged (correlations, participation ratio); cannot separate a state from a covariate that rides on it (speed) |
| `label_shuffle` | the target, permuted in time blocks inside the mask | the activity untouched, so cell-to-cell structure; block-level autocorrelation of the target | decoders, PV distances, PCA separation | no (loops over `compute`) | blocks shorter than the behavior's timescale give an optimistic null (`block_s`) |
| `bout_shuffle` | bout timing: bouts are re-placed at random times inside the mask | bout count, durations and exclusivity | bout-structured behavior | no | warns when the space is too dense to place bouts without overlap |
| `covariate_matched_shift` | the alignment, as `circular_shift`, but only for shifts that keep a covariate (speed) balanced | everything `circular_shift` keeps, plus the covariate's distribution within each state | state or signal tuning when the state is confounded with speed | yes | costs more draws; raises if no shift can be matched; tolerance needs tuning (below) |
| `cell_shift` | cell-to-cell coordination: every cell rolled by its own offset | each cell's autocorrelation and marginal distribution; the behavior target | population metrics: `pairwise_correlation`, `participation_ratio`, PV metrics | no | slower than the fast path; needs enough distinct shifts for the number of cells |
| `within_state_shuffle` | the order of frames inside each state | each state's frame set and activity sums (so state means are invariant) | order-dependent metrics: `split_half_stability`, within-state `signal_correlation`, `decode_signal` | no | exclusive state spaces only; leaves `mean_per_state`, `auroc`, `information_content` and `tuning_selectivity` exactly unchanged, so their p-values mean nothing (a warning says so) |

**The covariate-matched null.** If a cell fires faster when the animal runs and
the animal runs faster in state A than in state B, a cell with no interest in A
or B will still show a state preference, and the plain circular shift will call
it significant: every shift scrambles the alignment between speed and the state
labels, so the null has no speed-driven preference while the observed data do. `covariate_matched_shift` keeps only the shifts under
which, for every state with at least `min_frames` masked frames, the covariate
seen by the shifted activity over that state has the same distribution as the
observed covariate there. "Same" is measured by `statistic`: `ks` (the
Kolmogorov-Smirnov distance, 0 to 1) or `mean` (`|difference of means| / pooled
sd`). A candidate is accepted when the statistic is at most `tolerance` in every
state, and candidates are drawn in random order without replacement until
`n_shuffles` are accepted. The surrogate is still a roll, so the fast path
applies; only the draw is more expensive.

Read two numbers in `ShuffleResult.null_info`. `acceptance_rate` is the fraction
of candidate shifts that passed: it is low when the covariate is strongly tied to
the state labels, and it says how much freedom the null had. `balance_max` is the
largest statistic over all accepted shifts and states; it never exceeds
`tolerance`, and `balance_mean` is the average worst-state value. A very low
acceptance rate with a tight `balance_max` is a null drawn from a handful of
shifts: the p-values then rest on few distinct surrogates, so check
`n_candidates` and loosen `tolerance` before trusting them. On the demo's simulated
session, `social` bouts against speed with `statistic="mean"`, tolerance 0.5,
`min_frames=100` and `max_tries=100` accepted about a quarter of the candidates.

Tolerance must scale with the size of the state. A state with few frames has a
noisy covariate distribution even under a perfect null, so a tolerance that is
easy to meet for a state with thousands of frames can be impossible for one with
a hundred. Start from `statistic="mean"` with a tolerance of 0.3 to 0.5, raise
`min_frames` so that states too small to match are left out of the matching
(they are not matched at all, which is a weaker null for them), and watch the
acceptance rate.

If no shift passes, the null raises instead of returning a weak result. That is
the right answer when the states are *defined by* the covariate: the simulator's
syllables are defined by speed, so no shift can keep the speed distribution of
every syllable and still move the activity; asking for a speed-matched null there
raises, and it should. The question has no answer under that confound. The same
holds for any state built from the covariate (a "running" and a "still" state
under a speed-matched null). Use `circular_shift` and report that speed and state
are not separable, or add speed as a regressor in `glm_encoding`.

**`cell_shift` for population metrics.** A common circular shift rolls every cell
by the same amount, so it leaves every cell-to-cell correlation, the covariance
spectrum and the participation ratio exactly as observed. Its p-values for those
metrics are meaningless. `cell_shift` rolls each cell by its own offset, drawn
without replacement so that no two cells share one, which keeps each cell's
autocorrelation and rate but removes the co-fluctuation. The question it answers
is "are these cells coordinated beyond what their own statistics imply". Two
cells with shifts a few frames apart stay almost aligned, so set
`min_pair_separation_s` (for example a few seconds) to require every pair of
shifts to differ by at least that long; with many cells and a short session this
may be unsatisfiable, in which case a warning is issued and only distinctness is
kept. `signal` correlations are the exception: a common shift breaks the link to
the state labels and does test them.

**`within_state_shuffle`.** It permutes the activity frames within each state of
an exclusive state space (all cells together, so cell-to-cell structure at a frame
is kept), optionally in blocks of `block_s` seconds. It is exactly invariant for
metrics that depend only on the multiset of activity values in each state:
`mean_per_state`, `auroc`, `information_content` and `tuning_selectivity`. It is
informative for metrics that depend on order: `split_half_stability` (is the
stability more than exchangeable frames would give), PETH timing,
within-state `signal_correlation` and `decode_signal`. It tests "is there
structure inside the state beyond exchangeability", not "is the cell tuned to the
state".

### Effect sizes

A p-value is floored at `1 / (n_shuffles + 1)` and says nothing about size, so
`ShuffleResult` also gives two effect sizes computed from the null draws, both
kept when `keep_null="none"`:

- `z_score` is `(observed - null_mean) / null_std`, with `null_std` the standard
  deviation of the finite null draws (ddof 1). It puts auROC, information,
  correlation and MVL on one scale and is independent of `n_shuffles` apart from
  sampling noise, whereas p cannot go below the floor: two cells at the floor can
  have z of 4 and z of 12. It is NaN where the null is constant (a state-mean
  metric under `within_state_shuffle`, a silent cell), where the null has fewer
  than two finite draws, or where the observed value is undefined. The tidy table
  has a `z` column. Treat z as a descriptive effect size, not a Gaussian test: null
  distributions of ranks and bounded statistics are not normal, and a large z with
  `p` at the floor means only that the observed value is far outside the draws you
  made.
- `bias_corrected` is `observed - null_mean`: the metric with its chance level
  removed. For Skaggs information this removes the positive bias of a short
  session (see "Bias in mutual information" below); it is the quantity to compare
  across cells with different amounts of data.

`null_std` and `null_info` are stored with the result and saved by
`ResultSet.save`.

### The PETH null band

`peth` can draw a per-bin null band for the event-averaged response
(`null_band=True`, `n_null` shifts, `null_seed`). It rolls the activity by
`n_null` circular shifts with event times fixed and takes the 2.5 and 97.5
percentiles of the shifted PETH in every bin, and it reports `latency_s`, the
first time at or after onset at which the observed PETH stays outside the band
for `min_latency_bins` consecutive bins. The band is descriptive. It is computed
inside the metric's extras with its own seed and shifts, independently of the
`ShuffleConfig` null (so it does not change with `ShuffleConfig.null` or
`seed`), it is not corrected for the many bins and cells, and it does not
change the tested statistic, which is still response minus baseline. Use it to
see when a response departs from chance and to sort cells by latency; use the
shuffle p-value for the claim.

## Reading a result

Each cell/state row carries:

- `p_value`: permutation p-value, `(k + 1) / (n_shuffles + 1)` where `k` is the
  number of null draws at least as extreme as the observed value.
- `null_lo`, `null_hi`: the null's percentile bounds at `alpha` (for a
  two-sided test, `alpha/2` and `1 - alpha/2`). They are for plotting and sanity
  checks; `significant` is decided by `p_value`.
- `significant`: `p_value < alpha` (default `alpha = 0.05`).
- `tail`: which direction counts as extreme. `upper` for information-like
  metrics, `lower` for decoding error, `two` for AUROC and correlation. It
  defaults to the metric's own choice and can be overridden in `ShuffleConfig`.

## The p-value floor

The smallest possible p is `1 / (n_shuffles + 1)`. With 1000 shuffles that is
about 0.001; with 20 shuffles it is 1/21 = 0.048, so almost nothing can pass a
stricter threshold than 0.05. Use at least 1000 shuffles for reported results
and fewer only for quick looks.

For a two-sided test the one-sided count is doubled, `2 (min(k_upper, k_lower) + 1) / (n + 1)`,
and clipped to 1, so the floor is `2 / (n_shuffles + 1)`.

## Seeding

`ShuffleConfig.seed` is a *base* seed (default 0; `None` draws fresh entropy).
A direct `shuffle_test(..., ShuffleConfig(seed=s))` call uses it as is, via
`default_rng(SeedSequence(s))`, which is bit-identical to `default_rng(s)`.

Inside a `Pipeline` each analysis gets its own stream:
`effective_seed = SeedSequence([seed, crc32(name)]).generate_state(1, uint64)[0]`,
where `name` is the resolved analysis name (`information_content[position]`,
`...#2`, or an explicit `AnalysisSpec.name`). This is deterministic across runs
and machines, differs between analyses, and does not change when an unrelated
analysis is added. Without it every analysis drew the identical shift sequence,
which correlates the nulls across analyses and makes "significant in A and B"
criteria and `overlap_vs_chance` too optimistic about independence. Provenance
records both `seed` (base) and `effective_seed`.

`derive_seeds=False` restores the shared stream. Use it never, except to
reproduce results from before per-analysis seeding. Numbers from earlier runs
differ from current ones for that reason (p-values move within sampling noise).
Renaming an analysis changes its stream.

**Per-surrogate child seeds (target-perturbing nulls).** `label_shuffle` and
`bout_shuffle` no longer draw from one lazily consumed generator. `shuffle_test`
spawns `SeedSequence(seed).spawn(n_shuffles)` and surrogate `i` uses
`default_rng(children[i])`, so a surrogate is a pure function of `(seed, i)`:
it does not depend on batching, on `n_jobs`, or on the order in which batches
finish. This changed the label_shuffle and bout_shuffle numbers once (still valid
draws from the same null, p-values move within sampling noise). `circular_shift`
is untouched: its shifts are drawn up front from the main generator exactly as
before. A third-party null that implements only `surrogates(...)` keeps the old
single-generator behaviour and runs serially; implement
`Null.surrogate(activity, target, mask, fs, rng)` to get per-draw seeds and
parallelism.

**Parallel determinism.** `ShuffleConfig.n_jobs` (`-1` = all cores) runs batches
of shuffles on a thread pool. Because the shifts and child seeds are fixed before
any batch starts and each batch writes its own slice of the null array, results
(`observed`, `null`, `p_value`, `shifts`) are bit-identical for every `n_jobs`;
this is regression-tested. `batch_size` is the unit of parallelism and of
cancellation (in-flight batches finish, nothing new is submitted). AUROC's own
internal thread pool over shifts is disabled inside shuffle workers, so
`n_jobs > 1` does not oversubscribe the machine.

## NaN semantics

If the observed metric is undefined (a silent cell, too few frames in a state)
or every surrogate is undefined, `p_value` is NaN and `significant` is False.
A NaN is "could not be tested", not "not significant"; count it separately.
Only finite surrogates enter the p-value, so a metric undefined on some shifts
is compared against the draws where it was defined.

## Correcting across states and cells

A cell-by-state table has many tests, and asking "is this cell significant in
*any* state?" multiplies the false-positive rate. On pure noise (auroc, 200
shuffles, alpha 0.05) the fraction of untuned cells that are "significant in any
state" was:

| correction | 6 syllables | 4 social states |
| --- | --- | --- |
| none (raw) | 0.29 | 0.17 |
| `max_stat` | 0.08 | 0.02 |
| `bh` | 0.0 | 0.02 |

Planted cells were still detected (fraction at least 0.8) under every
correction. Correction reduces the inflation; it does not always remove it. In
the demo's full run (80 untuned cells, 1000 shuffles, `max_stat` across states)
the any-state false-positive rate went from 0.24 to 0.10 for `auroc[social]`,
0.17 to 0.06 for `auroc[syllables]`, 0.19 to 0.09 for `mean_per_state[social]`
and 0.10 to 0.04 for `peth[social]`; the dedicated noise-session measurement
above came out at 0.02 to 0.08. Rules based on null percentiles (for example
`responsive_cell_criteria` with the default `use_p=False`) are not adjusted:
in the demo they flagged 19 untuned cells against 8 with the adjusted p-value
rule. The library does not correct by default; ask for it in
`ShuffleConfig`:

```python
shuf = ShuffleConfig(n_shuffles=1000, correction="max_stat")  # correction_scope="states"
```

`correction` is one of `none` (default), `bh`, `bonferroni` or `max_stat`;
`correction_scope` says which tests form one family:

| scope | family | meaning |
| --- | --- | --- |
| `states` (default) | the states of one cell | "is this cell tuned to anything" |
| `cells` | the cells of one state | "which cells respond to this state" |
| `all` | every test of the result | one family for the whole table |

| method | controls | what it does |
| --- | --- | --- |
| `bh` | false discovery rate | Benjamini-Hochberg on the p-values of each family |
| `bonferroni` | family-wise error | `min(1, p * m)`, `m` = finite p-values in the family; the most conservative |
| `max_stat` | family-wise error | single-step max-statistic from the null draws themselves; `states` scope only |

`max_stat` standardises every state's observed value and null draws by that
cell-and-state's null mean and standard deviation (sign-flipped for a lower tail,
absolute value for a two-sided one), takes the most extreme standardised value
across the states of each surrogate, and counts how often that extreme reaches the
observed one. Because it uses the correlation between states in the null it is
less conservative than Bonferroni, and it costs only a maximum over an array the
test already has (about 0.05 s per 1000 shuffles). Asking for `max_stat` with
`correction_scope="cells"` or `"all"` raises a `ValueError` at construction; use `bh` or
`bonferroni` to correct across cells or all tests. The adjusted value is never smaller than the raw one.

Choosing:

- **`max_stat` across states** when the question is per cell ("does this cell
  respond to any behavior"). It controls the family-wise error across the
  states of a cell at no extra computation. A result with a single state or no
  state axis gets no adjustment, and `correction_note` says so.
- **`bh` across cells** (`correction_scope="cells"`) for discovery, when you
  accept a controlled fraction of false positives among the cells you call
  responsive.
- **`bonferroni`** when a single false positive is costly and you accept the lost
  power; it ignores the correlation between tests.

What you get back. `ShuffleResult` keeps the raw `p_value` and `significant`
and adds `p_adj`, `significant_adj` (`p_adj < alpha`, False where NaN),
`correction`, `correction_scope` and `correction_note` (non-empty when the
correction was a no-op). With `correction="none"` the adjusted values equal the
raw ones. `ResultSet.to_dataframe()` has `p_adj` and `significant_adj` columns
next to `p_value` and `significant`.

```python
r = results["auroc[syllables]"]
r.shuffle.correction, r.shuffle.correction_scope, r.shuffle.correction_note
r.shuffle.p_adj          # same shape as r.values
df = results.to_dataframe()
df[["cell", "state", "p_value", "p_adj", "significant", "significant_adj"]].head()

cabana.significant_cells(r)                   # uses significant_adj when a correction was run
cabana.significant_cells(r, adjusted=False)   # force the raw p-values
cabana.significant_cells(r, adjusted=True)    # force p_adj; ValueError if the result has none
```

`significant_cells(..., adjusted=None)` (the default) uses the adjusted p-values
exactly when the result was run with a correction. The criteria layer
(`Clause(adjusted=...)`) follows the same rule. `adjusted=True` on a result
without `p_adj` raises.

To adjust p-values you already have, or to try another scope after the fact, call
`adjust_p_values(p, method, axis)`. `method` is `none`, `bh` or `bonferroni`
(`max_stat` needs the null draws, so it is only available through
`ShuffleConfig`); `axis` is the axis along which each family lies (`None` means one
family for the whole array); NaN stays NaN and is not counted:

```python
from cabana import adjust_p_values

p = results["auroc[social]"].shuffle.p_value        # (n_cells, n_states)
q_across_states = adjust_p_values(p, "bh", axis=1)  # one family per cell
q_across_cells = adjust_p_values(p, "bh", axis=0)   # one family per state
```

(`scipy.stats.false_discovery_control` and
`statsmodels.stats.multitest.multipletests` do the same for BH.) Two cautions.
A permutation p-value is discrete, so many cells tie at the floor
`1 / (n_shuffles + 1)`; Bonferroni with `m` tests needs
`n_shuffles + 1 > m / alpha` to be able to reject anything. And the cohort
functions (`fraction_significant_by_animal`, `per_animal_summary`) take
`adjusted=`: `None` (default) uses `significant_adj` when the analysis was run with
a correction (the table's `correction` column is not "none"), `True` forces the
adjusted column and `False` the raw one. `plot_ground_truth_recovery` follows the
same rule.

You can always compare against the false-positive rate on a null population
(cells with no planted or expected tuning, or surrogate sessions), which is what
the demo's recovery table reports as `fpr` (raw) and `fpr_adj` (adjusted).

## Per-animal versus per-cell inference

Cells from one animal are not independent. Per-cell p-values answer "is this
cell tuned"; they do not support a claim about animals. For group claims use
the animal as the unit:

- `cohort_table` stacks results from several sessions with an animal label.
- `fraction_significant_by_animal` gives one fraction per animal (and state).
- `compare_states_across_animals` runs a paired Wilcoxon across animals.
- `hierarchical_bootstrap` resamples animals, then cells within animals, for
  confidence intervals on any statistic of the table.

## Bias in mutual information

Plug-in mutual information is biased upward with limited data, and the bias
grows with the number of state-by-level bins [104, 105]. The shuffle null has
the same occupancy and activity marginal, so it carries the same bias and the
p-value is calibrated; the raw bits are not comparable across cells with
different amounts of data or across different `n_levels`. The optional
Miller–Madow correction (`mutual_information`) is off by default for that reason
[104]. Spatial information has analogous issues [102, 103].

## Where the defaults come from

Every free parameter below has a default that someone chose. The table says
where it lives, what the default is, where the number came from, how much the
conclusions depend on it (H/M/L) and how it should be chosen for real data.
"Demo" is `examples/demo.py`. "Tuned" means tuned on the simulator, which is not
a substitute for tuning on real data.

| Parameter | Module | Default | Origin | Sensitivity | Recommended selection |
|---|---|---|---|---|---|
| `bin_size` | `_transform.BinGrid` | none (give `bin_size` or `n_bins`); demo 20 mm | arbitrary | H | physical units; automatic rule (at most a quarter of the expected field width) or a reported sweep |
| `smooth_sigma_bins` | information, split-half, signal tuning, Bayesian decoder | 0 (demo 1.0) | convention | H | automatic held-out rule (`auto_cv`) plus a reported sweep |
| `min_occupancy_s` | information, MI, population metrics, split-half | 0.05 s; 0.1 s in `signal_tuning` | arbitrary | M | fixed default, with the occupancy diagnostic shown |
| speed `min_speed` | `_preprocess.SpeedThreshold` | required; demo 20 mm/s | none | H | user pick on the speed histogram |
| speed `window_s` | `_transform.Speed` | 0.25 s | arbitrary | L | fixed default |
| `max_gap_s` | `_transform_behavior.InterpolateGaps` | 0.5 s | convention | L-M | fixed default; report the filled fraction (`meta["interpolate_gaps"]`) |
| smoothing `window_s` | `_transform_behavior.SmoothSignal` | 0.25 s (median) | convention | L-M | fixed default, matched to the speed window |
| `merge_gap_s`, `min_duration_s` | `_transform.BoutsToStates` | 0 (off); lab convention 0.5 s / 0.5 s | convention | M | state in the methods |
| `mode_filter_s`, `min_run_s` | `_transform.LabelsToStates` | 0 (off) | arbitrary | L-M | state in the methods |
| `n_levels` / `binning` | `mutual_information`, Bayesian decoder (empirical) | 5, `quantile` | tuned | M-H | reported sweep |
| `pseudocount` | Bayesian decoder (empirical) | 0.1 | tuned | H for the empirical decoder | cross-validated |
| decoder `window_s` | `bayesian_decoder` | 0.25 s; demo 1.0 s | arbitrary | M | cross-validated |
| `n_folds` | `decode_states`, `glm_encoding`, `bayesian_decoder` | 5 (all three) | convention | L | fixed default |
| `n_blocks` | `split_half_stability`, `population_vector_stability` | 2 | convention | M | fixed default; report with 4 as a check |
| SVM `C` | `decode_states` | 1.0 | scikit-learn default | L-M | fixed default, or cross-validated |
| ridge `alpha` | `glm_encoding` | 1.0 | arbitrary | M-H | cross-validated |
| `min_frames` | `mean_per_state`/`auroc` 20, `pca_population` 20, `signal_tuning` 50, `glm_encoding` 100 | as listed | arbitrary | L | fixed default |
| PETH `baseline_s` / `response_s` | `peth` | (-5, -2) s / (0, 2) s | arbitrary | H | pre-registered before looking at results |
| temporal `sigma_s` | `_preprocess.SmoothActivity` | required | none | H | user pick, stated in the methods |
| `baseline` percentile | `_preprocess_activity.ComputeDff` | 8 (rolling window 60 s) | convention (common dF/F baseline choice); not derived | M | check the baseline against the trace; report it in the methods |
| event `k` | `_preprocess_activity.DetectEvents` | 3 | arbitrary (3 sigma; ~0.1% one-sided false positives on Gaussian noise, more on real traces) | H | pick on a few cells against known events; report a sweep of k |
| event `noise` | `_preprocess_activity.DetectEvents` | `diff_mad` | standard estimator: 1.4826 x MAD of first differences / sqrt(2) (Friedrich et al. 2017; CaImAn) | M | fixed default; `psd` as a check |
| event `min_duration_s` / `refractory_s` | `_preprocess_activity.DetectEvents` | 0 / 0 | none (off) | M | set from indicator kinetics (decay time) |
| `n_shuffles` | `ShuffleConfig` | 1000 | convention | L (sets the p floor, see above) | fixed default |
| `min_shift_s` | `ShuffleConfig`, `circular_shift` | 20 s | arbitrary | M | should exceed the autocorrelation time; automatic rule planned |
| `block_s` | `label_shuffle` null | 1.0 s | arbitrary | M | automatic rule planned |
| `refractory_s` | `bout_shuffle` null | 2.0 s | arbitrary | L-M | fixed default |
| `tolerance` / `statistic` | `covariate_matched_shift` | 0.1 / `ks` | arbitrary | H | scale to state size; check `null_info["acceptance_rate"]` and `balance_max` |
| `min_frames` / `max_tries` | `covariate_matched_shift` | 50 / 20 | arbitrary | M | raise `min_frames` so tiny states are not matched; raise `max_tries` if acceptance is low |
| `min_pair_separation_s` | `cell_shift` | 0 (distinct shifts only) | arbitrary | L-M | a few seconds for population metrics |
| `block_s` | `within_state_shuffle` | 0 (single frames) | arbitrary | M | the autocorrelation time of the activity |
| `n_null` / `null_seed` | `peth` null band | 200 / 0 | arbitrary | L (descriptive) | fixed default |
| `alpha` / `correction` / `tail` | `ShuffleConfig` | 0.05 / `none` / the metric's default | convention | H for conclusions | pre-registered; see the correction section |
| `n_components` | `pca_population` | 10 | arbitrary | L | fixed default |
| cluster `k` | `response_clusters` | chosen by silhouette / BIC over a range | data-driven | M | automatic rule |

**Why smoothing defaults to 0.** The library applies no spatial smoothing unless
the user chooses it or an automatic rule selects it, because any non-zero value
is a scientific choice that changes which cells pass (6-11% of cells changed
classification between neighbouring reasonable settings on the simulator). The
demo sets `smooth_sigma_bins` to 1.0 explicitly. A default of 0 means the
library never smooths behind your back; it does not mean 0 is a good value.

### Automatic smoothing

`smooth_sigma_bins` can be chosen by the `auto_smooth_sigma` selector
(`pipe = Pipeline(selectors=[{"name": "auto_smooth_sigma"}], analyses=[...])`),
which writes the value onto every analysis on the chosen state space that has
the field and records a `Selection` (`method="auto_cv"`,
`criterion="heldout_poisson_loglik"`).

**The rule.** The frames that count (state support AND the analysis masks) are
cut into `n_folds` (default 5) contiguous time blocks. For each candidate sigma
and each block, rate maps are built from the other blocks (smoothed with that
sigma, same `min_occupancy_s`) and the held-out block is scored with
`sum_t [x_t log(lambda_s(t) dt + eps) - lambda_s(t) dt]`, summed over cells
(one sigma for the whole population). Held-out frames whose state has no valid
training rate are skipped identically for every sigma. The mean over blocks is
the candidate's score and the standard error over blocks its uncertainty. The
**one-standard-error rule** then picks the smallest sigma whose score is within
one SE of the best (`one_se=False` takes the argmax). Candidates can be given in
bins or in mm (converted with the grid bin width, so the choice is portable
across bin sizes). Deconvolved activity is continuous and non-negative, so the
Poisson score is a scoring rule, not a likelihood proper; `likelihood="gaussian"`
(negative squared error) is the alternative for z-scored or dF/F traces.

**Why held-out likelihood and not reliability.** On the simulator (20 mm bins)
split-half reliability rises monotonically with sigma (0.33, 0.87, 0.93, 0.94 for
sigma 0, 1, 2, 3 bins), so as a criterion it always asks for more smoothing. A
held-out score penalises over-smoothing: it peaks at an interior sigma and falls
on both sides.

**Validity of the p-values.** The selector never imports the shuffle engine and
never sees a null or p-value; its inputs are the activity, the state labels and
masks, and time order. The shuffle test is then run with sigma as a fixed number,
so its false-positive guarantee holds given that sigma. Residual caveat: sigma is
chosen on the same session that is later tested, so it is tuned to the data, not
to the null. This cannot favour a particular cell being significant under the
null, but it does mean the chosen sigma should be reported (it is, in
`provenance["selections"]`), and that a different session may choose differently.
For a stricter protocol choose sigma on one session or half of the data and
test on the rest. `heldout_smoothing_scores` returns the whole score curve for
plotting or for a sweep.

### Recording how a value was chosen

Each chosen value can carry a `Selection` record (`cabana.Selection`): the
parameter `path`, the `value`, a `method` (`literature_default`,
`fixed_apriori`, `auto_cv`, `auto_rule`, `sweep_stability` or `user_pick`), the
`criterion` and the `candidates` with their `scores`, a description of the data
`split` used, `informed_by_significance` and a `note`. Rules, sweeps and manual
picks all write the same record.

A parameter path addresses one field of the pipeline:
`transforms.<key>.<field>`, `preprocess.<key>.<field>`,
`analyses.<key>.metric.<field>`, `analyses.<key>.shuffle.<field>` or
`analyses.<key>.<field>` (for example `masks`). `<key>` is an integer index, a
transform's `output` name (or a preprocess step's `name`), a resolved analysis
name (`Pipeline.resolved_names()`), or `*` for every element that has the field.

```python
pipe2 = pipe.set_param(
    "analyses.*.metric.smooth_sigma_bins", 1.0,
    method="user_pick", criterion="heldout_poisson_loglik", note="looked at the sweep",
)
pipe2.get_param("analyses.*.metric.smooth_sigma_bins")
```

`set_param` returns a modified copy, re-validates the plugin, and appends the
`Selection` to `Pipeline.selections`. Selections are saved with the pipeline
(`to_dict` / `to_yaml`) and copied into each result's
`provenance["selections"]` (pipeline-level ones to every result, analysis-level
ones to the analysis they name); `ResultSet.selections` lists them without
duplicates.

**A selection criterion must never be a p-value or a count of significant
cells.** Choosing a parameter by how many cells it makes significant biases the
null test in favour of the chosen value. Use a held-out score (cross-validated
likelihood, decoding accuracy on held-out folds) or a data-quality measure that
does not see the null. If a value was picked after looking at p-values anyway,
set `informed_by_significance=True` so the record says so. `SweepResult.pick`
(see "Sweeps" below) enforces this for sweeps and writes the same record.

### Automatic null timescales

`min_shift_s` (circular shift) and `block_s` (label shuffle) are timescales of the
data, so they can be read off the data. The selector `auto_null_timescale`
(`AutoNullTimescale`, roadmap B7) does this before the analyses run and records
each choice as a `Selection` with `method="auto_rule"`.

```python
pipe = Pipeline(selectors=[{"name": "auto_null_timescale"}], analyses=[...])
```

**Definition.** The autocorrelation time of a series is the smallest lag at which
its normalised autocorrelation first falls below 1/e. The autocorrelation uses
only the analysis's effective frames (state support AND listed masks), removes
the mean of those frames, ignores NaNs, is computed by FFT, and is searched up to
`max_lag_s` (60 s). If it never falls below 1/e the result is `max_lag_s` and a
warning is issued. White noise gives one frame. Plain functions
`autocorrelation_time` and `state_autocorrelation_time`
(`cabana._selectors_null`) expose the estimate for plotting.

- `tau_activity`: the median over cells (cells with zero variance skipped). For
  sparse deconvolved activity this is often one frame, so the behaviour usually
  sets the timescale.
- `tau_target`: for a state space, the occupancy-weighted mean of the
  autocorrelation time of each state's 0/1 indicator; for a continuous signal,
  its own autocorrelation time (first column if 2-D). With
  `block_rule="mean_bout"` the target timescale for `block_s` is instead the mean
  run length of the states.

**Rules.** For a `circular_shift` null, `min_shift_s = clip(multiple *
max(tau_activity, tau_target), min_shift_floor_s, max_fraction * duration)`,
with `multiple=3`, floor 5 s and `max_fraction=0.25` (the same one-quarter
session limit `draw_shifts` enforces, and more than the half-session it clamps
to would leave too few distinct shifts). For a `label_shuffle` null, `block_s =
clip(tau_target, block_floor_s, max_fraction * duration)`. Other nulls are not
touched. The value is written to `analyses.<name>.shuffle.min_shift_s` when the null
is the default, or to `analyses.<name>.shuffle.null` (a copy of the null with the
new field) when a null was given explicitly.

**Why three times.** After one autocorrelation time a signal has lost about 63%
of its self-similarity; after three, about 95%. A shift of at least 3 tau makes
the shifted activity nearly independent of the true alignment while the
within-signal structure is preserved, which is what the null needs. The factor is
a convention, not a derived optimum: change `multiple` and record why.

**Never sees the null.** The selector uses only autocorrelation of activity and
behaviour. It does not run a shuffle or read a result, so it cannot bias the test.

**When not to use it.** Slow drifts or non-stationary sessions (photobleaching,
state changes) make the autocorrelation not fall below 1/e, giving `max_lag_s`
and then the cap; fix the drift (detrend, mask) or set the value by hand. Short
sessions are capped at a quarter of the duration, where fewer than the requested
distinct shifts may exist. A very long autocorrelation time of the behaviour
(rare, long bouts) means the circular shift has little independent information
regardless of the setting.

### Sweeps

A sweep runs the same pipeline at every point of a grid of parameter values and shows how the conclusions move. `cabana.sweep(session, pipeline, over={"analyses.*.metric.smooth_sigma_bins": [0, 1, 2, 3]}, shuffle=False)` takes parameter paths (the `set_param` grammar above) and candidate lists; several paths give the Cartesian product. List candidates from simplest to most complex, because the one-SE and plateau rules read the order.

*Fast and full mode.* If no swept path starts with `transforms.` or `preprocess.`, transforms and preprocessing run once and each grid point reruns only the analyses on the prepared session. Otherwise (for example a bin-size sweep) the whole pipeline reruns per point. `shuffle=False` strips every shuffle, giving observed values only, which is cheap enough for interactive use (a 4-value sigma sweep on a 600 s, 60-cell session takes about 0.05 s). `shuffle=None` keeps each analysis's `ShuffleConfig`, and `shuffle=True` requires one. Without shuffles there are no p-values: `significant` is False and `frac_significant` is NaN.

*Reading a sweep.* `SweepResult.table` is one row per grid point, result, cell and state with the swept values, `value`, `p_value`, `p_adj` and the significance flags. `summary()` gives, per grid point and analysis, `n_cells`, `n_significant`, `frac_significant`, the median `value` (`median_value`, with `se_value`) and, for every per-cell scalar extra whose key ends in `_r` or is `stability`, `reliability` or `loglik`, its median (`median_<key>`, `se_<key>`). `stability()` counts, for each cell, how many times `significant` flips between neighbouring grid points (one step along one path, others fixed), its modal classification and whether it is `unstable` (at least one flip), plus the fraction of unstable cells and the Spearman rank correlation of `value` between neighbours. A stable total count can hide several percent of cells swapping in and out (6-11% on the simulator), which is why the flip readout exists. `plot_sweep_gallery` shows one cell's rate map across the candidates, `plot_sweep_stability` the three views, and `plot_sweep` any summary table.

*Guard rail.* `pick(criterion, ...)` chooses one value per swept path, but it refuses to choose by `p_value`, `p_adj`, `significant`, `significant_adj`, `n_significant`, `frac_significant`, or any column containing `sig` or starting with `p_`, and raises `ValueError`. Picking the setting that makes the most cells significant lets the data choose the analysis that favours the hypothesis (a researcher degree of freedom) and invalidates the null test for that choice. Use a value-based or reliability criterion (`median_value`, a split-half `r`, a held-out log-likelihood extra). Remember that raw reliability and information tend to rise monotonically with smoothing, so prefer a held-out score. `allow_significance=True` overrides the refusal and sets `informed_by_significance=True` on the record.

*From a pick to a Selection.* `rule="max"` or `"min"` takes the best score (`method="auto_rule"`); `"one_se"` takes the first candidate within one standard error of the best, and `"plateau"` the middle of the longest run of neighbours within one standard error (both `method="sweep_stability"`). Each pick is a `Selection` with `criterion`, the `candidates` and their `scores`, and the rule in `note`; `SweepResult.apply(pipeline)` writes them with `set_param`, so they appear in `Pipeline.selections` and in each result's provenance. Sweeps can be saved with `SweepResult.save(dir)` and reloaded with `SweepResult.load(dir)`.
