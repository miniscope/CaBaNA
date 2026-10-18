# Plots: what each figure shows and what to look for

Every figure in `cabana.plots` is built to answer one question about the
evidence behind a result. This page says what each one shows, what a good
result looks like, and how to draw them with one call. For the architecture see
"Plots" in [`DESIGN.md`](DESIGN.md); for how p-values are made see
[`STATISTICS.md`](STATISTICS.md).

## 1. Three ways to draw

```python
# 1. the figure a result's metric considers most informative
fig = results["information_content[position]"].plot(session)

# 2. any registered figure, with its own options
fig = cabana.plots.plot(ic, session, "rate_maps", cells=[3, 17, 41], max_cells=12)

# 3. everything, to disk: <analysis>__<plot>.png for every analysis
results.plot_all(session, out_dir="figs")
```

`result.plots(session)` lists what applies to a result;
`cabana.plots.available_plots()` lists every registered name. `plot_all` skips a
default figure whose requirements the result does not meet (for example a null
histogram when the null draws were not kept) instead of raising. Keyword
arguments given to `plot_all` go to every renderer that accepts them.

Every call returns a matplotlib `Figure` and never calls `plt.show()`. Close
figures you do not keep (`plt.close(fig)`); `out_dir=` does this for you.

**Cell cards.** The quickest way to judge a cell is one page with everything
about it:

```python
cabana.plots.plot_cell_card(session, results, cell="cell_009")
cabana.plots.plot_cell_cards(session, results, cells="significant",
                             max_cards=12, out_dir="figs/cards")   # cell_009.png, ...
```

`cells` may be `"significant"` (cells significant in any analysis, adjusted p
when a correction was used, most analyses first), `"all"`, an integer `k` (the
top `k`), or a list of cell ids.

## 2. What each figure shows

Each entry gives the "Look for" text from the function's docstring. Light-grey
bins in any map were never visited and are **not zero**.

### Per-cell evidence

- **`plot_cell_card`** (one cell, all analyses). Header, activity trace with
  behaviour ribbons and hatched excluded frames, one evidence panel per analysis
  (significant first), the null histogram beneath each, and a table of value, p,
  adjusted p and the cell's rank among all cells. *Look for:* a bold title
  (significant after any correction) **and** a picture that shows the claimed
  structure: a compact field, a bar clearly outside the grey null range, a PETH
  with the response inside the shaded window. A small p with an unremarkable
  picture, or a rank far from 1, deserves suspicion.
- **`plot_rate_maps`** (`cells=None`, `max_cells=24`, `page=0`,
  `show_occupancy=True`). One map per cell from `extras["rate_map"]`, with a
  colourbar and units, optionally an occupancy panel; bars per state for
  categorical targets. *Look for:* compact single fields (grids) or a bar peak at
  one state; a white dot marks a significant cell.
- **`plot_place_fields`** (`cells=None`, `max_cells=24`, `ncols=6`,
  `show_centroid=True`; takes a `place_fields` result). Rate maps with the
  detected field outlined and the centroid marked. *Look for:* one compact
  outline around the bright patch of the map (a clean place field), several
  outlines or a large outlined area (a diffuse or multi-peaked cell), and a
  centroid that sits inside the outline; light-grey bins were never visited and
  are not zero.
- **`plot_circular_tuning`** (`max_cells=16`, `ncols=4`, `polar=True`; takes a
  `circular_tuning` result). Per-cell tuning curve over angle with the preferred
  direction as an arrow. *Look for:* a single lobe pointing along a long arrow
  (strongly direction-tuned, high mean vector length) versus a near-circular
  curve with a short arrow (untuned); gaps in the curve are directions never
  sampled. Angle zero is at the right and increases counter-clockwise.
- **`plot_split_half_maps`**. The two half-session maps side by side, on one
  colour scale per cell. *Look for:* the same field in both halves (high r)
  versus a field that moves or vanishes.
- **`plot_shuffle_distribution`**. Null histogram for one cell (and state) with
  the observed value. *Look for:* the observed line outside the dashed null
  bounds; the title gives p and the tail.
- **`plot_peth`** (`sort_by="response"` or `"latency"`). Cells by time heatmap of
  the event-averaged response with a mean trace below and a colourbar. *Look for:*
  a band of cells that rise or fall after the dashed onset line, a latency
  staircase when sorted by latency, and whether significant cells are the
  strongest responders.
  With `peth(null_band=True)` the mean trace is drawn with the per-bin
  circular-shift band (2.5 to 97.5 percentile) and `sort_by="latency"` orders
  cells by `latency_s`, the first time the observed PETH leaves the band for
  `min_latency_bins` consecutive bins (without the band, by the time of the peak
  response). The band is
  descriptive and independent of the `ShuffleConfig` null; see "The PETH null
  band" in [`STATISTICS.md`](STATISTICS.md).
- **`plot_event_raster`**. Single events of one cell as an image plus the mean.
  *Look for:* a response on most single events rather than a few.
- **`plot_joint_histogram`** (`normalize="lift"` by default). State by activity
  level for one cell. *Look for:* a column that differs from its neighbours, i.e.
  the level distribution changes with state even where mean activity is flat.
- **`plot_decoded_trajectory`** (`states` optional). True versus decoded position
  over time, in the arena, and the error distribution. *Look for:* the decoded
  path hugging the true path, accuracy that is not confined to one corner, and
  the median error left of the chance line. On coarse grids the decoded path is
  honest but busy, because it jumps between bin centres.

### Population

- **`plot_tuning_heatmap`**. Cells by states heatmap of `values` with
  significance dots (AUROC is centred on 0.5). *Look for:* blocks of cells lit in
  one column.
- **`plot_population_tuning`** (`sort_by="peak"`, `normalize=True`). Rows
  peak-normalised and sorted by preferred state, with cell ids. *Look for:* a
  diagonal ridge (the population tiles the state space) versus a smear at one
  edge.
- **`plot_activity_raster`**. Cells by time with a behaviour ribbon under it.
  *Look for:* bursts that line up with a behaviour colour, and whether excluded
  (grey) stretches coincide with the activity you are about to interpret.
- **`plot_pairwise_matrix`** (`order="cluster"`, `"none"` or `"state"`; takes a
  `pairwise_correlation` result). Cell-by-cell correlation matrix, reordered so
  correlated cells are adjacent, significant pairs marked. *Look for:* blocks of
  red along the diagonal (assemblies of co-active cells) rather than a uniform
  wash; a near-zero mean off-diagonal with scattered pairs is weak coupling. The
  diagonal is left grey because self-correlation carries no information. Test
  these with `cell_shift`, not the default null.
- **`plot_participation_ratio`** (takes a `participation_ratio` result).
  Eigen-spectrum of the population covariance with cumulative variance
  explained. *Look for:* a spectrum dominated by a few components with the
  cumulative line rising steeply (low-dimensional activity, small participation
  ratio) versus a flat spectrum and a slowly rising line (activity spread over
  many dimensions); compare the value with the null band in the title.
- **`plot_decode_signal`** (`t_range=None`, `channels=None`; needs the session
  for the true signal). Held-out prediction of a continuous signal from the
  population, one row per channel: true and predicted traces and a
  true-versus-predicted scatter, annotated with the per-fold score, the MAE and the chance MAE. *Look for:* the
  coloured prediction following the grey true trace (not just its slow drift), a
  scatter that hugs the identity line, and a mean absolute error well below the
  chance error (the error of always predicting the training mean).
- **`plot_population_matrix`**. State by state matrix (for example population
  vector overlap). *Look for:* block structure and a strong diagonal.
- **`plot_metric_strip`**. Per-cell values of a 1-D result against the null band,
  significant cells marked. *Look for:* values rising above the band; a long flat
  run inside it means most cells cannot be told from chance.
- **`plot_metric_scatter`** and **`plot_information_comparison`**. Two metrics per
  cell, coloured by joint significance, or each minus its null mean. *Look for:*
  cells significant on only one metric.

### Session quality

- **`plot_session_qa`**. Six panels: occupancy, bouts, masks, timing, cells,
  summary. *Look for:* states that are barely occupied, few or very short bouts,
  masks that remove most frames, a tail of dropped frames in the frame-interval
  histogram.
- **`plot_behavior_overview`**. Trajectory, speed with the speed mask, ethograms
  and label strips. *Look for:* arena coverage and whether scored behaviours are
  spread across the session.
- **`plot_ground_truth_recovery`** (simulated data). Fraction of each planted
  population detected. *Look for:* tall bars for planted cells and `untuned` at
  or below the alpha line; where a correction was applied the hatched bar is the
  adjusted false-positive rate.

### Sweeps and parameter choice

- **`plot_sweep`**, **`plot_sweep_gallery`**, **`plot_sweep_stability`**,
  **`plot_level_sweep`**. Detection, one cell, or classification stability along
  a swept parameter. *Look for:* a plateau; a field that appears or dissolves as
  the value changes; a flat left panel hiding a busy middle one (cells swapping
  in and out). See "Sweeps" in [`STATISTICS.md`](STATISTICS.md).

### Cohort and post hoc

- **`plot_analysis_agreement`** (`kind="jaccard"`, `"upset"`, `"pgrid"`). How much
  analyses agree on which cells are significant. *Look for:* pairs with a low
  Jaccard index (a cell called by one analysis alone is weak evidence) and cells
  significant in many analyses.
- **`plot_classification`**, **`plot_overlap`**, **`plot_overlap_matrix`**,
  **`plot_clusters`**. Class counts, overlap against independence, response
  clusters. *Look for:* classes with very few cells, odds ratios away from 1.
- **`plot_cohort_fractions`**, **`plot_cross_session`**,
  **`plot_hierarchical_bootstrap`**. Per-animal fractions, map stability across
  sessions, naive versus hierarchical intervals. *Look for:* consistent slopes
  across animals, observed r right of the null, and the naive interval being
  narrower than the hierarchical one.

## 3. The data layer

Every `plot_<x>` has a companion `plot_<x>_data(...)` that returns a plain dict
holding everything the figure shows: arrays, labels, units, colours,
significance flags. The renderer draws from that dict alone. This is what lets
CaLab (TypeScript) draw the same figure from the same numbers, and what lets a
test check a plot without rendering it.

```python
import json
import cabana

data = cabana.plots.plot_rate_maps_data(session, ic, cells=[3, 17, 41])
data["kind"], data["version"]            # ("rate_maps", 1)
text = cabana.plots.to_json(data)        # strict JSON, NaN as {"__float__": "nan"}
back = cabana.plots.from_json(text)      # same dict, arrays as nested lists
open("rate_maps.json", "w").write(text)
cabana.plots.check_plot_data(data)       # the contract, as used in the test-suite
```

The contract: a `"kind"` (the plot name) and a `"version"`
(`cabana.plots.PLOT_DATA_VERSION`); values are arrays, scalars, strings, bools,
`None`, dicts or lists, never a `Figure`, a DataFrame or a `Session`; NaN means
"no data" and is drawn as unvisited, never as zero.

## 4. Shared style

All figures use one look so that two figures read alike.

- `with cabana.plots.use_style(): ...` wraps your own matplotlib code in the same
  rcParams. `plot`, `plot_all` and `result.plot` already do this.
- `cabana.plots.state_colors(space)` gives one colour per state name, the same
  every time: Okabe-Ito (colour-blind safe) up to 8 states, `tab20` up to 20, and a
  warning above 20 because no categorical palette stays readable.
- **One significance marker**: a white dot with a black edge
  (`mark_significant`, `SIGNIFICANCE_MARKER`). Nothing else uses it. In card and
  strip titles, bold means significant.
- **NaN is light grey** (unvisited bin, untested cell, under-sampled state),
  never zero.
- **p-values** are formatted by `fmt_p`: `p=0.023`, `p<0.001`, or
  `p=0.001 (floor)`. "(floor)" means no surrogate reached the observed value: a
  test with `n` shuffles cannot report p below `1/(n+1)` (two-tailed `2/(n+1)`),
  so the p is limited by `n_shuffles`, not measured. Use more shuffles if you
  need a smaller p.
- **Adjusted p is used whenever a correction was applied** (for example
  `max_stat` across a cell's states): significance dots, bold titles, counts in
  `plot_analysis_agreement` and card selection all follow `p_adj`, and the card
  table shows both columns.
- Axis labels carry units in parentheses (`axis_label`, `metric_label`).

## 5. Adding a plot for your own metric

Register a renderer, give it a data function, and name it in the metric's
`default_plots`. This example was run against a simulated session; it assumes a metric
called `active_fraction` (see [`PLUGINS.md`](PLUGINS.md), section 5).

```python
from typing import ClassVar

import matplotlib.pyplot as plt
import numpy as np

import cabana
from cabana import Metric, register
from cabana.plots import PLOT_DATA_VERSION, metric_label, register_plot, state_colors


def active_fraction_bars_data(result, cells=None):
    """Everything the figure shows: no matplotlib in here."""
    cells = list(range(min(10, result.values.shape[0]))) if cells is None else list(cells)
    return {
        "kind": "active_fraction_bars",
        "version": PLOT_DATA_VERSION,
        "cells": cells,
        "state_names": list(result.state_names),
        "values": result.values[cells],          # (n_cells_shown, n_states), NaN = no data
        "ylabel": metric_label(result.metric),   # unknown metrics fall back to the name
    }


def _defaults(result, session):
    """Keyword arguments the caller did not give (here: the first five cells)."""
    return {"cells": list(range(5))}


@register_plot(
    "active_fraction_bars",
    data=active_fraction_bars_data,
    level="cell",                  # only cell-level results
    requires=("values:2d",),       # checked by plots_for; others: "shuffle", "null",
    defaults=_defaults,            #   "extras:<key>", "topology", "ground_truth"
)
def plot_active_fraction_bars(result, cells=None):
    """Active fraction per cell and state. Look for: bars that differ between states."""
    d = active_fraction_bars_data(result, cells)
    colors = state_colors(d["state_names"])
    fig, ax = plt.subplots(figsize=(6, 3.5), layout="constrained")
    w = 0.8 / len(d["state_names"])
    x = np.arange(len(d["cells"]))
    for j, name in enumerate(d["state_names"]):
        ax.bar(x + j * w, d["values"][:, j], w, color=colors[name], label=name)
    ax.set_xticks(x + 0.4, [str(c) for c in d["cells"]])
    ax.set_ylabel(d["ylabel"])
    ax.legend(frameon=False)
    return fig


# on the metric class (the metric from PLUGINS.md section 5):
#     default_plots: ClassVar[tuple[str, ...]] = ("active_fraction_bars", "tuning_heatmap")
```

Then `result.plot(session)` draws the bars, and `results.plot_all(session,
out_dir="figs")` writes them next to the generic views. Pass `needs_session=True`
and take `(result, session, ...)` when the figure reads state spaces or
signals. A metric with no `default_plots` falls back to `tuning_heatmap` (2-D
cell values), `metric_strip` (1-D), `shuffle_distribution` (null draws kept) and
`population_matrix` (2-D population values). Re-registering a name replaces the
built-in renderer.

Keep to the style rules above (state colours, one significance marker, NaN as
unvisited grey) and return a plain dict from the `_data` function so the same
figure can be drawn elsewhere.

## 6. Default figures per metric

First entry is what `result.plot(session)` draws.

| Metric | `default_plots` |
|---|---|
| `information_content` | `rate_maps`, `metric_strip`, `shuffle_distribution` |
| `split_half_stability` | `split_half_maps`, `metric_strip`, `shuffle_distribution` |
| `mutual_information` | `joint_histogram`, `metric_strip`, `shuffle_distribution` |
| `auroc` | `tuning_heatmap`, `shuffle_distribution` |
| `mean_per_state` | `tuning_heatmap`, `shuffle_distribution` |
| `glm_encoding` | `tuning_heatmap`, `shuffle_distribution` |
| `signal_correlation` | `metric_strip`, `shuffle_distribution` |
| `signal_tuning` | `metric_strip`, `shuffle_distribution` |
| `decode_states` | `metric_strip` |
| `peth` | `peth`, `event_raster` |
| `place_fields` | `place_fields`, `rate_maps`, `metric_strip`, `shuffle_distribution` |
| `tuning_selectivity` | `metric_strip`, `tuning_heatmap`, `shuffle_distribution` |
| `circular_tuning` | `circular_tuning`, `metric_strip`, `shuffle_distribution` |
| `decode_signal` | `decode_signal`, `metric_strip` |
| `pairwise_correlation` | `pairwise_matrix`, `population_matrix` |
| `participation_ratio` | `participation_ratio`, `metric_strip` |
| `bayesian_decoder` | `decoded_trajectory`, `population_matrix` |
| `population_vector_overlap` | `population_matrix` |
| `pv_stability` | `population_matrix` |
| `pca_population` | `population_matrix` |
| `population_distance` | `population_matrix` |

`population_tuning` is registered but is not a default of any metric; call it
with `result.plot(session, "population_tuning")` on a cell by state result.
`plot_cell_card`, `plot_activity_raster`, `plot_session_qa` and
`plot_analysis_agreement` take a session or a whole result set, so they are called
directly rather than through a single result.
