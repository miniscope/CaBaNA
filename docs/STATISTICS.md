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

Changing the null is one line:

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
| `n_shuffles` | `ShuffleConfig` | 1000 | convention | L (sets the p floor, see above) | fixed default |
| `min_shift_s` | `ShuffleConfig`, `circular_shift` | 20 s | arbitrary | M | should exceed the autocorrelation time; automatic rule planned |
| `block_s` | `label_shuffle` null | 1.0 s | arbitrary | M | automatic rule planned |
| `refractory_s` | `bout_shuffle` null | 2.0 s | arbitrary | L-M | fixed default |
| `alpha` / `correction` / `tail` | `ShuffleConfig` | 0.05 / `none` / the metric's default | convention | H for conclusions | pre-registered; see the correction section |
| `n_components` | `pca_population` | 10 | arbitrary | L | fixed default |
| cluster `k` | `response_clusters` | chosen by silhouette / BIC over a range | data-driven | M | automatic rule |

**Why smoothing defaults to 0.** The library applies no spatial smoothing unless
the user chooses it or an automatic rule selects it, because any non-zero value
is a scientific choice that changes which cells pass (6-11% of cells changed
classification between neighbouring reasonable settings on the simulator). The
demo sets `smooth_sigma_bins` to 1.0 explicitly. A default of 0 means the
library never smooths behind your back; it does not mean 0 is a good value.

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
set `informed_by_significance=True` so the record says so. The planned
`cabana.sweep` facility (roadmap B1) and the automatic smoothing step (B3, B4)
will enforce this and write the same record.
