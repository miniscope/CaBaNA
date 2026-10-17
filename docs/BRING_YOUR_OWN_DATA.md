# Bring your own data

This guide takes you from arrays you already have (calcium traces, a DeepLabCut
position file, a BORIS export, a distance trace, maybe syllable labels) to
results with p-values. If your files come from Minian, CaImAn, DeepLabCut, BORIS,
Keypoint-MoSeq or CaMAP, see [Loading common formats](#loading-common-formats);
otherwise you read your files with pandas or h5py and hand CaBaNA plain arrays.
Every code block below runs in order as one script, on simulated stand-ins for
your files.

If a word is unfamiliar, see [`GLOSSARY.md`](GLOSSARY.md); for how to read the
p-values, see [`STATISTICS.md`](STATISTICS.md).

## Loading common formats

`cabana.loaders` has readers for Minian, CaImAn and `.camap` activity and for
BORIS, DeepLabCut and Keypoint-MoSeq behavior (`load_minian`, `load_caiman`,
`load_camap`, `load_boris`, `load_dlc`, `load_moseq`). Each returns the object
used below: a `Session` for activity, a `BoutTable`, `ContinuousSignal` or
`LabelSeries` for behavior, which you put in `session.behavior`. Behavior files
count time from the start of the video, so the loaders take `t_offset_s`, the
imaging start in video time, and compute `t_neural = t_video - t_offset_s`.
[`LOADERS.md`](LOADERS.md) lists what each reads, the optional dependencies and
the `pip` extras, the clock convention with a worked example, and the caveats.
The rest of this guide builds the same objects by hand.

## 1. The clock convention

Everything is measured in **seconds on the neural clock**: `Session.t` holds
the time of each imaging frame, and every behavior input must use the same time
base. The origin does not matter (frame 0 can be 0 s, or a wall-clock offset),
and behavior may start before or end after imaging. A DeepLabCut file that
starts 0.8 s before the first frame is fine: `resample_signal` interpolates it
onto `t` and marks frames outside its range (and NaN tracking frames) as
missing. What you must do yourself is express every timestamp on one base, for
example by subtracting the imaging start time from your behavior timestamps.

`fs` is the imaging rate in Hz. It should match the spacing of `t`; a mismatch
of more than 5% gives a warning.

## 2. Build the raw inputs

The first block stands in for your loaders. Replace it with your own reading
code; the names `act`, `t`, `bouts_df`, `xy_t`, `xy` and so on are what you
need to produce.

```python
from pathlib import Path

import numpy as np

import cabana
from cabana import BoutTable, ContinuousSignal, LabelSeries, Session

out = Path("cabana_out")
out.mkdir(exist_ok=True)
FS, DUR = 15.0, 600.0


def load_session(seed, n_cells=120, prefix="mA"):
    """Stand-in for your loaders: returns the arrays you would read from disk."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(FS * DUR)) / FS  # imaging frame times (s)
    act = (rng.random((n_cells, t.size)) < 0.03) * rng.lognormal(0, 0.3, (n_cells, t.size))

    # BORIS-like table: behavior name, start, stop (s on the same clock)
    rows = []
    for name, rate, dur in [("sniff", 1 / 20, 3), ("attack", 1 / 60, 5), ("groom", 1 / 40, 6)]:
        s = 60.0
        while s < 540:
            s += rng.exponential(1 / rate)
            d = rng.lognormal(np.log(dur), 0.4)
            if s + d < 540:
                rows.append((name, s, s + d))
    labels, starts, stops = zip(*rows)

    # DeepLabCut-like position at 30 Hz, starting 0.8 s before imaging, with NaN frames
    xy_t = np.arange(-0.8, DUR + 1, 1 / 30)
    xy = 150 + 140 * np.sin(np.cumsum(rng.normal(0, 3, (xy_t.size, 2)), axis=0) / 200)
    xy[rng.choice(xy_t.size, 12, replace=False)] = np.nan
    dist = np.abs(rng.normal(100, 40, (xy_t.size, 1)))  # distance to partner (mm)

    # syllable labels at 10 Hz, -1 where unknown
    syl_t = np.arange(0, DUR, 0.1)
    syl = np.repeat(rng.integers(0, 4, syl_t.size // 20 + 1), 20)[: syl_t.size]
    syl[rng.random(syl_t.size) < 0.02] = -1
    return dict(act=act, t=t, labels=list(labels), starts=np.array(starts), stops=np.array(stops),
                xy_t=xy_t, xy=xy, dist=dist, syl_t=syl_t, syl=syl,
                cell_ids=[f"{prefix}_c{i:03d}" for i in range(n_cells)])
```

## 3. Assemble a `Session`

```python
def make_session(d, animal="mA"):
    bouts = BoutTable(
        labels=d["labels"], start_s=d["starts"], stop_s=d["stops"],
        scored_start_s=60.0, scored_stop_s=540.0,  # the span you actually scored
    )
    position = ContinuousSignal(t=d["xy_t"], values=d["xy"], channel_names=["x", "y"], units="mm")
    distance = ContinuousSignal(t=d["xy_t"], values=d["dist"], channel_names=["distance"], units="mm")
    syllables = LabelSeries(t=d["syl_t"], labels=d["syl"], label_names=["still", "walk", "run", "turn"])
    return Session(
        activity=d["act"],            # (n_cells, n_time)
        t=d["t"],                     # (n_time,) seconds, neural clock
        fs=FS,
        activity_kind="deconvolved",  # or "dff", "spike_counts", "raw", "zscored"
        cell_ids=d["cell_ids"],
        behavior={"social": bouts, "position": position, "partner_dist": distance,
                  "syllables": syllables},
        meta={"animal": animal},
    )


session = make_session(load_session(0))
print(cabana.__version__, session.activity.shape)
```

Notes on the inputs:

- **`activity_kind`** tells CaBaNA how to re-bin (counts are summed, traces are
  averaged) and is recorded with every result. A `Session` warns if
  deconvolved or spike-count activity contains negative values, which usually
  means you passed dF/F or z-scored traces under the wrong label.
- **`BoutTable`**: one row per bout. Behaviors may overlap. `scored_start_s` and
  `scored_stop_s` say where scoring covered the recording; frames outside are
  *unknown*, not "no behavior". Leave them `None` only if the whole session was
  scored.
- **`ContinuousSignal`**: `values` is `(n_samples, n_channels)`; NaN marks
  dropped samples. `units` is a label and nothing converts it, so make sure your
  `bin_size` and `min_speed` are in the same units.
- **`LabelSeries`**: integer labels indexing `label_names`; `-1` means no
  label, and those frames are outside that state space's support.

## 4. Transforms: behavior to state spaces

A pipeline's `transforms` put behavior on the neural clock and build the
`StateSpace`s that metrics test against. Here is the whole recipe; the notes
after it explain the choices.

```python
transforms = [
    {"name": "resample_signal", "source": "position"},    # writes signals x, y
    {"name": "speed"},                                     # signals["speed"], mm/s
    {"name": "resample_signal", "source": "partner_dist"}, # signals["distance"]
    # spatial grid; give `extent` so every session uses identical bins
    {"name": "bin_grid", "signals": ["x", "y"], "bin_size": 20.0,
     "extent": [(0, 300), (0, 300)], "output": "position"},
    # overlapping bouts (sniff during attack is allowed)
    {"name": "bouts_to_states", "source": "social", "output": "social"},
    # one state per frame, plus "rest" = scored but no behavior
    {"name": "bouts_to_states", "source": "social", "exclusive": True, "add_rest": True,
     "output": "social_ex"},
    {"name": "labels_to_states", "source": "syllables", "output": "syllables"},
]
preprocess = [{"name": "speed_threshold", "min_speed": 20.0}]  # writes masks["speed"]
```

- **`extent` on `bin_grid`.** Without it the grid spans each session's own data
  range, so two sessions get different bins and cross-session comparisons
  fail or lie. Always pass the arena extent in the same units as your signal.
- **Exclusive versus non-exclusive bouts.** A non-exclusive space has one
  boolean column per behavior and frames may be in several at once (or none).
  An exclusive space has exactly one state per frame; overlaps are resolved by
  the order of `behaviors`, and `add_rest=True` adds a state for scored frames
  with no behavior. Use both: they answer different questions.
- **Which metrics need which.**

  | needs an exclusive space | works with overlapping bouts |
  | --- | --- |
  | `information_content`, `mutual_information`, `bayesian_decoder`, `decode_states` with `mode="multiclass"` | `auroc`, `mean_per_state`, `peth`, `decode_states` (default one-vs-rest), `split_half_stability`, population metrics, `signal_*` |

  A metric that needs exclusivity raises an error naming `exclusive=True`.
- **`peth` and "rest".** `peth` treats every state as a behavior and aligns to
  its onsets, so on the exclusive-with-rest space you would get a PETH for
  "rest" as if it were a behavior. Run `peth` on the non-exclusive space.

## 5. Masks and support

Every analysis runs on a set of frames: the **support** of its target AND any
masks you list.

- **Automatic.** A `StateSpace` carries a `support`: the frames where it is
  defined. `bin_grid` sets it to frames that were tracked and inside the
  extent (and also writes `{output}_valid`), `bouts_to_states` to the scored
  span (also `{output}_scored`), `labels_to_states` to the span covered by
  labels (also `{output}_covered`). You do not list these.
- **Yours.** Add masks only for criteria the state space cannot know, such as
  the speed threshold for place analyses: `masks=["speed"]`.
- `masks=None` and `masks=[]` both mean "support only". Do not put a speed
  mask on social analyses unless you mean it: huddling is stationary.
- Signals have no support, so a `signal=` analysis uses only the masks you
  list. `resample_signal` writes `{source}_covered` for this purpose.

## 6. A pipeline with named analyses

```python
from cabana import AnalysisSpec, Pipeline, ShuffleConfig

# circular shift (default null); max_stat corrects across a cell's states (see below)
circ = ShuffleConfig(n_shuffles=100, min_shift_s=20.0, correction="max_stat")
bouts_null = ShuffleConfig(n_shuffles=100, null={"name": "bout_shuffle"})

pipe = Pipeline(
    transforms=transforms,
    preprocess=preprocess,
    analyses=[
        AnalysisSpec(metric={"name": "auroc"}, states="social", shuffle=circ),
        AnalysisSpec(name="auroc_bout_null", metric={"name": "auroc"}, states="social",
                     shuffle=bouts_null),
        AnalysisSpec(metric={"name": "information_content", "smooth_sigma_bins": 1.0},
                     states="position", shuffle=circ, masks=["speed"]),
        AnalysisSpec(metric={"name": "split_half_stability"}, states="position",
                     shuffle=circ, masks=["speed"]),
        AnalysisSpec(metric={"name": "peth", "pre_s": 4, "post_s": 4, "baseline_s": (-4, -1),
                             "response_s": (0, 1.5)}, states="social", shuffle=circ),
        AnalysisSpec(metric={"name": "decode_states"}, states="social_ex",
                     shuffle=ShuffleConfig(n_shuffles=20, null={"name": "label_shuffle", "block_s": 5.0})),
        AnalysisSpec(metric={"name": "signal_correlation"}, signal="distance", shuffle=circ),
    ],
)
session, results = pipe.run(session)
print(results.names())
```

**Multiple comparisons.** A cell that is "significant in any of its states" has
more chances to be a false positive the more states there are (on noise, 17-29%
of cells at alpha 0.05 with 4-6 states). `correction="max_stat"` in the
`ShuffleConfig` above fills `p_adj` and `significant_adj` next to the raw
`p_value` and `significant`, correcting across the states of each cell from the
null draws themselves, at almost no cost; `"bh"` and `"bonferroni"` with
`correction_scope="cells"` correct across cells instead. A result with no state
axis (such as the 1-D `information_content`) is left unchanged and
`correction_note` says so. `significant_cells` and the classification below use
the adjusted values by default whenever a correction was run. Details and
numbers in [`STATISTICS.md`](STATISTICS.md).

Each analysis has a **name**. If you give none it is `metric[target]`, with
`#<null>` and then `#2`, `#3` appended when that collides: a second, unnamed
AUROC on `social` with a bout-shuffle null would be `auroc[social]#bout_shuffle`.
Here we named it ourselves. Names are how you pick results back out:

```python
au = results["auroc[social]"]                       # by name
ic = results.get("information_content", "position") # by metric and target
print(au.provenance["n_frames_used"], au.provenance["support_used"], au.provenance["seed"])
```

`get` raises a `KeyError` listing the names when metric and target match more
than one analysis. `provenance` records the version, seed, null, masks, number
of frames used and parameters; `session.meta["transforms"]` logs the
transforms that built the states.

### Choosing bin size and smoothing

Do not copy `bin_size=20` and `smooth_sigma_bins=1.0` from the examples: both depend on your arena, your animal and your frame rate, and smoothing in particular changes which cells pass (a few percent of cells change classification between neighbouring reasonable values). Give the bin size in physical units, at most a quarter of the expected field width. Let the data choose the smoothing with a selector, which runs before the analyses and never sees a p-value:

```python
pipe = Pipeline(
    selectors=[
        {"name": "auto_smooth_sigma", "states": "position"},  # held-out score, one-SE rule
        {"name": "auto_null_timescale"},                      # min_shift_s from autocorrelation
    ],
    transforms=transforms, preprocess=preprocess,
    analyses=[AnalysisSpec(metric={"name": "information_content"}, states="position",
                           shuffle=circ, masks=["speed"])],       # no smooth_sigma_bins typed
)
session, results = pipe.run(session)
print(results.selections)             # path, value, method, criterion, candidates, scores
```

Then look at what the choice does: `cabana.sweep(session, pipe, {"analyses.*.metric.smooth_sigma_bins": [0, 1, 2, 4]}, shuffle=False)` is fast (observed values only) and feeds `plots.plot_sweep_gallery` (one cell across the values); rerun it with the shuffle on and `plots.plot_sweep_stability` shows how many cells flip classification. A sweep can be turned into a recorded choice with `SweepResult.pick`, which refuses to choose by p-values or by the number of significant cells; to set a value yourself use `pipe.set_param(path, value, method="user_pick", note=...)`. Report the chosen values (they are saved with the pipeline and in each result's `provenance["selections"]`). The rules, their caveats and the numbers are in [`STATISTICS.md`](STATISTICS.md) ("Where the defaults come from", "Automatic smoothing", "Sweeps"); `examples/demo.py` (figures 28 and 29) and the notebook section "Choosing parameters" run them end to end.

## 7. Calling the shuffle engine directly

A pipeline is a convenience. To test one metric on arrays you already have:

```python
from cabana import build, shuffle_test

metric = build("metric", {"name": "auroc"})
states = session.states["social"]
mask = states.support & session.masks["speed"]  # the frames you want counted
sr = shuffle_test(metric, session.activity, states, mask, ShuffleConfig(n_shuffles=50), session.fs)
print(sr.observed.shape, sr.p_value.shape, sr.significant.sum())
```

The call is `shuffle_test(metric, activity, target, mask, config, fs)`. Pass
`ShuffleConfig(keep_null="none")` to drop the null matrix (it is the largest
thing in a result) when you only need p-values.

## 8. Tidy table and cell sets

```python
df = results.to_dataframe()
print(df.columns.tolist())
print(df[df.analysis == "auroc[social]"].head(3))

sniff = cabana.significant_cells(au, state="sniff")
attack = cabana.significant_cells(au, state="attack")
ov = cabana.overlap_vs_chance(sniff, attack)
print(sniff.sum(), attack.sum(), ov.n_both, ov.p_value)
```

The table has one row per cell and state with `value`, `p_value`,
`significant`, `p_adj`, `significant_adj`, and the columns `analysis`, `null` and `n_shuffles` so results
from different nulls stay separable.

## 9. Classifying cells

A rule such as "place cell" or "excited by sniffing" is a `Criteria`: a few
`Clause`s, each one test on one analysis, combined with `all_of`, `any_of` and
`none_of`. `classify` evaluates them on the `ResultSet` and returns one boolean
label per cell and class.

```python
from cabana import Clause, Criteria, classify, place_cell_criteria, responsive_cell_criteria

place = place_cell_criteria("position")  # information AND split-half stability significant
# excited / inhibited per state of auroc[social]; `get` is ambiguous here (two auroc analyses on
# social), so enumerate the states from that one result
excited = responsive_cell_criteria(cabana.ResultSet(results=[results["auroc[social]"]]), "social")
# or by hand: significant, positive, in any state, on the adjusted p-values
any_social = Criteria(
    name="social_responsive",
    all_of=[Clause(analysis="auroc[social]", state="any", test="significant",
                   sign="positive", adjusted=True)],
)
cls = classify(results, {"place_cell": place, **excited, "social_responsive": any_social})
print(cls.counts())
print(cls.table().head(3))
print(cabana.overlap_vs_chance(cls.labels["place_cell"], cls.labels["social_responsive"]).p_value)
print(Criteria.from_yaml(place.to_yaml()) == place)  # rules round-trip through YAML
cabana.plots.plot_classification(cls)
```

How the tests are defined:

- A cell x state result needs `state="<name>"` (or an index) or `state="any"`
  (OR over states); a 1-D result such as `information_content` takes none.
- `test="significant"` uses the permutation p (adjusted when the result has a
  correction, unless you set `adjusted=False`; `adjusted=True` on a result
  without `p_adj` raises); `test="value"` compares the observed value with a
  `threshold`; `test="percentile"` asks whether the observed value is beyond
  that percentile of the null draws, which needs `keep_null="full"`.
- `sign` is relative to `reference`, which defaults to the cell's null median.
  `responsive_cell_criteria` encodes the usual auROC rule: excited above the 97.5th
  null percentile, inhibited below the 2.5th (`use_p=True` uses p-values instead).
- `classify(..., exclusive=True)` gives each cell the first matching class and
  adds `unclassified`. `cls.fractions()` and `cls.label_per_cell()` summarise;
  `classification_table` and `fraction_classified_by_animal` pool several
  sessions per animal. The boolean labels go straight into `overlap_vs_chance`
  and `overlap_matrix`.
- `place_cell_criteria` does not include field-size criteria.

## 10. Saving and loading

```python
pipe.to_yaml(out / "pipeline.yaml")                  # the recipe, as text
pipe2 = cabana.Pipeline.from_yaml(out / "pipeline.yaml")
results.save(out / "results.zip")                    # manifest.json + npz
results2 = cabana.ResultSet.load(out / "results.zip")
session.save(out / "session.zip")
session2 = Session.load(out / "session.zip")
df.to_csv(out / "results.csv", index=False)
print(len(pipe2.analyses), len(results2), results2.names() == results.names())
```

`save` accepts a `.zip` or a directory name. The null distribution is stored
as float32. A pipeline that uses a custom metric (section 12) can be loaded
only after that class is registered in the loading process.

## 11. Several sessions and animals

Run the same pipeline on every session, then pool on the animal. The unit of
inference is the animal, not the cell.

```python
from cabana import CellMatch, cohort_table

small = Pipeline(
    transforms=transforms,
    preprocess=preprocess,
    analyses=[
        AnalysisSpec(metric={"name": "auroc"}, states="social",
                     shuffle=ShuffleConfig(n_shuffles=50)),
        AnalysisSpec(metric={"name": "information_content"}, states="position",
                     shuffle=ShuffleConfig(n_shuffles=50), masks=["speed"]),
    ],
)
animal_of = {"A_d1": "A", "A_d2": "A", "B_d1": "B"}
runs = {}
for sid, seed, n, prefix in [("A_d1", 1, 120, "A1"), ("A_d2", 2, 120, "A2"), ("B_d1", 3, 100, "B1")]:
    _, runs[sid] = small.run(make_session(load_session(seed, n, prefix), animal_of[sid]))

table = cohort_table(runs, animal_of)  # adds `session` and `animal` columns
print(cabana.fraction_significant_by_animal(table, analysis="auroc[social]"))
print(cabana.per_animal_summary(table, analysis="information_content[position]"))
```

`fraction_significant_by_animal`, `per_animal_summary` and
`compare_states_across_animals` select an analysis with `analysis=` (its name)
or with `metric=` and `target=`. `fraction_significant_by_animal` and
`per_animal_summary` also take `adjusted=`: by default they use the
multiplicity-adjusted decision (`significant_adj`) when the analysis was run
with a correction, `adjusted=False` forces the raw one.

> **Caveat: repeated cells.** These functions pool every cell of every session
> of an animal. If the same neuron is recorded on several days (A_d1 and A_d2
> above), it is counted once per day, and the per-animal fraction leans on
> cells that are not independent. Either keep one session per animal, treat
> *sessions* as the unit (give each session its own id in the `animal` mapping),
> or drop duplicate cells using a `CellMatch` before pooling. The animal-level
> tests (`compare_states_across_animals`, `hierarchical_bootstrap`) are only as
> independent as your units are.

Cross-session map correlation needs the same grid in both sessions (hence
`extent`) and a `CellMatch` from your registration tool (CellReg or similar):
`pairs[k] = (cell index in session a, cell index in session b)`.

```python
rng = np.random.default_rng(0)
pairs = np.stack([rng.choice(100, 80, replace=False), rng.choice(100, 80, replace=False)], axis=1)
match = CellMatch(session_a="A_d1", session_b="A_d2", pairs=pairs)
cs = cabana.cross_session_map_correlation(
    runs["A_d1"]["information_content[position]"], runs["A_d2"]["information_content[position]"], match
)
print(cs.median_observed, np.median(cs.null_median), cs.p_population)
```

A `SessionSet` bundles sessions, the animal mapping and matches if you want a
single object to pass around.

### Speed

Shuffle tests are the slow part. `ShuffleConfig(n_jobs=4)` (or `-1` for all cores,
or `pipe.run(session, n_jobs=4)` to override a saved pipeline for one run) spreads
batches of shuffles over threads, and the numbers are identical to `n_jobs=1`.
Gains are largest for `label_shuffle` / `bout_shuffle` (several times faster on 4
cores); `circular_shift` with the built-in metrics is already fast. Parallelism is
per batch, so keep `n_shuffles / batch_size` at least `n_jobs`. For many sessions,
`run_set(pipe, sessions, n_jobs=4, out_dir="runs/")` runs sessions in separate
processes, saves each as it finishes and skips finished ones on a rerun. Colab
gives you 2 cores, so `n_jobs=2` is the most you will gain there.

## 12. A custom metric

A metric is a pydantic class registered by name. Implement `compute` and return
`(n_cells,)` or `(n_cells, n_states)`. Override `check_target` if the metric
needs a particular kind of state space.

```python
from typing import ClassVar

from cabana import Metric, register


@register("metric")
class FracActive(Metric):
    """Fraction of frames with activity above zero, per cell and state."""

    name: ClassVar[str] = "frac_active"

    def check_target(self, target):
        super().check_target(target)
        # e.g. self.require_exclusive(target) if the metric needs one state per frame

    def compute(self, activity, states, mask, fs):
        m = states.masked(mask)  # (n_time, n_states) float, already restricted to the mask
        return (activity > 0).astype(float) @ m / np.maximum(m.sum(0), 1)


custom = Pipeline(
    transforms=[t for t in transforms if t.get("output") == "social"],
    analyses=[AnalysisSpec(metric={"name": "frac_active"}, states="social",
                           shuffle=ShuffleConfig(n_shuffles=50))],
)
_, r = custom.run(make_session(load_session(5)))
print(r.names(), r["frac_active[social]"].values.shape)
```

A metric can also define `compute_shifted` for a fast circular-shift null
(see `information_content` for the pattern); without it the engine recomputes
`compute` on every shuffle, which is correct but slower.

## Where to go next

- [`DESIGN.md`](DESIGN.md) for how the pieces fit, [`GLOSSARY.md`](GLOSSARY.md)
  for terms, [`STATISTICS.md`](STATISTICS.md) for choosing a null.
- `examples/demo.py` and `notebooks/cabana_demo.ipynb` for plots, decoders,
  population analyses and the GLM.
