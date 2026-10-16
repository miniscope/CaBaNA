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

## NaN semantics

If the observed metric is undefined (a silent cell, too few frames in a state)
or every surrogate is undefined, `p_value` is NaN and `significant` is False.
A NaN is "could not be tested", not "not significant"; count it separately.
Only finite surrogates enter the p-value, so a metric undefined on some shifts
is compared against the draws where it was defined.

## Multiple comparisons

The library applies no correction. A cell-by-state table with 200 cells and 400
states has 80,000 tests. Two reasonable options:

1. Report the fraction of cells that pass against the false-positive rate
   measured on a null population (cells with no planted or expected tuning,
   or surrogate sessions). This is what the demo's ground-truth plot does.
2. Control the false discovery rate across cells with Benjamini–Hochberg:

```python
import numpy as np
from scipy.stats import false_discovery_control

p = results.get("auroc", "social").shuffle.p_value  # (n_cells,) or (n_cells, n_states)
ok = np.isfinite(p)
q = np.full(p.shape, np.nan)
q[ok] = false_discovery_control(p[ok], method="bh")
significant_fdr = q < 0.05
```

(`statsmodels.stats.multitest.multipletests` does the same.) Note that a
permutation p-value is discrete, so many cells tie at the floor.

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
