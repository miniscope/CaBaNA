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
the any-state false-positive rate went from 0.21 to 0.11 for `auroc[social]`,
0.17 to 0.06 for `auroc[syllables]`, 0.21 to 0.07 for `mean_per_state[social]`
and 0.10 to 0.04 for `peth[social]`; the dedicated noise-session measurement
above came out at 0.02 to 0.08. Rules based on null percentiles (for example
`responsive_cell_criteria` with the default `use_p=False`) are not adjusted:
in the demo they flagged 17 untuned cells against 9 with the adjusted p-value
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
