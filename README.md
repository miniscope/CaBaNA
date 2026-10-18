# CaBaNA

[![CI](https://github.com/miniscope/CaBaNA/actions/workflows/ci.yml/badge.svg)](https://github.com/miniscope/CaBaNA/actions/workflows/ci.yml)

**Ca**lcium **B**ehavioral **a**nd **N**eural **A**nalysis: a pipeline for asking
how neural activity relates to behavioral states.

CaBaNA generalizes what [CaMAP](https://github.com/miniscope/CaMAP) (place
cells, spatial maps) and [CaSA](https://github.com/miniscope/CaSA) (social
behavior responses) each do separately. The observation behind it is that
every analysis in both reduces to three arrays on the neural clock:

| object | shape | meaning |
| --- | --- | --- |
| activity | `(n_cells, n_time)` | deconvolved calcium, dF/F, or binned spikes |
| states | `(n_time, n_states)` bool | which behavioral state(s) the animal is in |
| mask | `(n_time,)` bool | which frames count (speed threshold, scored coverage) |

Spatial bins, behavioral syllables, and scored social bouts are all ways of
filling the `states` matrix. Once behavior is in that form, information
content, split-half stability, AUROC, and population-vector analyses are the
same code regardless of experiment, and one circular-shift shuffle engine
gives any of them a null distribution.

```
 import ──► transform ──► preprocess ──► analyze ──► results ──► plots
 Session    behavior →     masks,        metric ×    tidy table   dispatch on
            StateSpace     smoothing     shuffle     + arrays     state kind
```

Each stage is a plugin point: a pydantic model whose fields are its
parameters, registered by name, so pipelines can be written as YAML and new
preprocessing steps or metrics drop in without touching the rest.

See [`docs/DESIGN.md`](docs/DESIGN.md) for the full design and
[`examples/demo.py`](examples/demo.py) / [`notebooks/cabana_demo.ipynb`](notebooks/cabana_demo.ipynb)
for an end-to-end run on simulated data with planted ground truth.

## Status

Early design demo, run and tested on simulated data with planted ground truth;
the `.camap` loader has only been tested on synthetic bundles. CaBaNA is intended
to become an app within [CaLab](https://github.com/miniscope/CaLab) and follows
its Python conventions.

Recent additions:

- **Multiple-comparison correction:** `ShuffleConfig(correction="max_stat" | "bh" | "bonferroni")` fills `p_adj` and `significant_adj`; on noise it cut the "significant in any state" rate from 29% to 8% (6 syllables).
- **Fast path for fine grids:** exclusive state spaces above 256 states use per-cell integer-label sums instead of a dense one-hot matmul (6400 states: about 28 s and 2.6 GB down to 0.9 s and 1.0 GB).
- **Cell classification:** `Criteria` / `Clause` rules (YAML round-trip), `classify`, `place_cell_criteria`, `responsive_cell_criteria` and `plots.plot_classification`.
- **Data-driven parameters and sweeps:** `selectors=[{"name": "auto_smooth_sigma"}, {"name": "auto_null_timescale"}]` choose spatial smoothing (held-out score, one-SE rule) and the circular-shift length from the data without seeing a p-value; `cabana.sweep` reruns a pipeline over a grid of values and reports how many cells change classification; every chosen value carries a `Selection` record (`results.selections`), and picking a value by significance is refused. The demo shows both (figures 28-29).
- **Confound-resistant nulls:** `covariate_matched_shift` (keeps speed balanced across states; reports its acceptance rate and balance), `cell_shift` (for population metrics) and `within_state_shuffle` (for order-dependent metrics), with `z_score` and `bias_corrected` effect sizes on every result. See "Choosing a null" in [`docs/STATISTICS.md`](docs/STATISTICS.md).
- **More metrics:** `place_fields`, `tuning_selectivity`, `circular_tuning` (mean vector length), `decode_signal` (ridge or kNN), `pairwise_correlation` (total, signal, noise), `participation_ratio`, and a PETH null band with response latency; five new figures. The demo's Phase E section runs them.
- **Loaders:** `cabana.loaders` reads Minian, CaImAn, DeepLabCut, BORIS, Keypoint-MoSeq and `.camap` files with one clock convention (`t_neural = t_video - t_offset_s`).
- **Run control:** `RunContext` gives progress callbacks, cancellation with partial results, recorded errors and captured warnings; also `run_set`, `Pipeline.iter_run` and `describe()` for a front end.

Implemented analyses (see [`docs/ANALYSIS_COVERAGE.md`](docs/ANALYSIS_COVERAGE.md)
for the survey they come from and what is still missing):

- **Single-cell tuning to states:** information content, split-half stability, AUROC,
  mean activity per state, mutual information between discretised amplitude levels
  and state (a state by level histogram per cell), and peri-event time histograms
  (PETH) with a pre/post test.
- **Continuous targets:** correlation with a signal such as speed (with lagged
  cross-correlation) and signal tuning curves.
- **Population analyses on re-binned data:** population-vector overlap, stability
  and distance, PCA, cross-validated state decoding, a naive-Bayes decoder
  (Gaussian, Poisson or empirical likelihood), and a GLM with a temporal basis
  that reports each regressor's unique contribution.
- **Null distributions as plugins:** circular shift, block label shuffle, bout
  shuffle, speed-matched shift, per-cell shift and within-state shuffle, chosen
  with one line of `ShuffleConfig`.
- **Across cells, sessions and animals:** overlap versus chance, response clustering,
  cross-session map and population-vector correlation, per-animal fractions and
  hierarchical bootstrap.

## Install (development)

```bash
python3.12 -m venv .venv
.venv/bin/pip install -e ".[dev,notebook]"
.venv/bin/pytest
.venv/bin/python examples/demo.py
```

For a reproducible install with the tested dependency versions, add `-c constraints.txt`:
`pip install -c constraints.txt -e ".[dev,loaders]"`.

In Colab or any environment without a checkout:

```bash
pip install "git+https://github.com/miniscope/CaBaNA.git@framework-demo"
```

The `@framework-demo` pin is needed only while the package lives on that
branch; it goes away after the merge to `main`. To read real files, add the
loader extras (`cabana[minian]`, `cabana[caiman]`, or `cabana[loaders]` for all):

```bash
pip install "cabana[loaders] @ git+https://github.com/miniscope/CaBaNA.git@framework-demo"
```

## Quick start

```python
import cabana

session = cabana.simulate_session()  # your own data: see docs/BRING_YOUR_OWN_DATA.md

# once: turn raw behavior into state spaces (grid bins, bouts, syllables)
session, _ = cabana.Pipeline(
    transforms=[
        {"name": "resample_signal", "source": "position"},
        {"name": "speed"},
        {"name": "bin_grid", "signals": ["x", "y"], "bin_size": 20.0, "output": "position"},
        {"name": "bouts_to_states", "source": "social", "output": "social"},
    ]
).run(session)

# one call per question: a recipe is a validated pipeline with sensible defaults
session, results = cabana.analyze(session, "place_cell", states="position")
print(results.summary())            # cells tested, significant fraction, median z per analysis
session, social = cabana.analyze(session, "social", states="social", out_dir="out/social")
```

`analyze` fills the recipe, runs `pipeline.validate(session)` first (it refuses to start when
a state space is missing or `n_shuffles` cannot reach `alpha`, and reports a time and memory
estimate), shows a tqdm bar if tqdm is installed (otherwise log lines on the `"cabana"`
logger), and with `out_dir=` saves `results.zip`, `pipeline.yaml` and `summary.csv`. Recipes:
`cabana.recipes()`; see [`docs/RECIPES.md`](docs/RECIPES.md). Every parameter is still
reachable, e.g. `analyze(session, "place_cell", states="position", n_shuffles=200,
**{"analyses.*.metric.min_occupancy_s": 0.1})`.

## Quick look

```python
import cabana
from cabana import Pipeline, AnalysisSpec, ShuffleConfig, simulate_session

session = simulate_session()  # 2D arena + social bouts + syllables, planted cells

# max_stat corrects "significant in any state" across each cell's states (see docs/STATISTICS.md)
shuf = ShuffleConfig(n_shuffles=1000, min_shift_s=20.0, correction="max_stat")

pipe = Pipeline(
    transforms=[
        {"name": "resample_signal", "source": "position"},
        {"name": "speed"},
        {"name": "bin_grid", "signals": ["x", "y"], "bin_size": 20.0, "output": "position"},
        {"name": "bouts_to_states", "source": "social", "output": "social"},
        {"name": "labels_to_states", "source": "syllables", "output": "syllables"},
    ],
    preprocess=[{"name": "speed_threshold", "min_speed": 20.0}],
    analyses=[
        # each analysis already runs on its target's support (tracked frames for the grid,
        # the scored span for bouts, the labelled span for syllables); `masks` adds to that,
        # here a speed filter for space only. Analyses get names like "auroc[social]".
        AnalysisSpec(metric={"name": "information_content", "smooth_sigma_bins": 1.0},
                     states="position", shuffle=shuf, masks=["speed"]),
        AnalysisSpec(metric={"name": "split_half_stability"},
                     states="position", shuffle=shuf, masks=["speed"]),
        AnalysisSpec(metric={"name": "information_content"},
                     states="syllables", shuffle=shuf),
        AnalysisSpec(metric={"name": "auroc"}, states="social", shuffle=shuf),
        # same states, other questions; the null is one line (circular_shift by default)
        AnalysisSpec(metric={"name": "peth", "pre_s": 4, "post_s": 4, "baseline_s": (-4, -1),
                             "response_s": (0, 1.5)}, states="social",
                     shuffle=ShuffleConfig(n_shuffles=1000, null={"name": "bout_shuffle"})),
        # a continuous target instead of a state space
        AnalysisSpec(metric={"name": "signal_correlation"}, signal="speed", shuffle=shuf),
    ],
)
session, results = pipe.run(session)
results["auroc[social]"]  # pick a result by its analysis name (see results.names())
results.to_dataframe()    # cell × state × metric, with p-values and an `analysis` column
results.save("results.zip")  # later: cabana.ResultSet.load("results.zip")
# a cell class from the results: place cells = information AND split-half stability significant
cabana.classify(results, [cabana.place_cell_criteria("position")]).counts()

# figures: every default plot of every analysis, then one evidence card per significant cell
results.plot_all(session, out_dir="figs")
cabana.plots.plot_cell_cards(session, results, cells="significant", out_dir="figs/cards")
```

[`docs/PLOTS.md`](docs/PLOTS.md) says what each figure shows and what to look for.

Give an analysis your own name with `AnalysisSpec(name="...", ...)`; otherwise it is
`metric[target]`, with `#<null>` or `#2` added when two analyses would collide.

For the full end-to-end run on simulated data with planted ground truth, try
`python examples/demo.py --quick` (about 20–40 s; writes figures, tables and the
pipeline YAML to `examples/output/`; the full run takes a few minutes) or open `notebooks/cabana_demo.ipynb`.

If your data is a session folder (activity, miniscope and camera timestamps, position, head orientation,
annotated epochs, a `session.yaml`), start with the social-behaviour walkthrough instead:
`python examples/three_chamber.py` (about 15 s, runs on the bundled simulated three-chamber session) or
`notebooks/three_chamber_walkthrough.ipynb`. It goes from the folder to QC, geometry-derived investigation,
a pipeline, cell classes and figures.

## Bring your own data

For Minian, CaImAn, DeepLabCut, BORIS, Keypoint-MoSeq and `.camap` files use
`cabana.loaders` ([`docs/LOADERS.md`](docs/LOADERS.md)). Otherwise build a `Session` from
arrays you read yourself:

```python
session = cabana.Session(
    activity=activity, t=t, fs=15.0, activity_kind="deconvolved", cell_ids=ids,
    behavior={
        "social": cabana.BoutTable(labels=labels, start_s=start_s, stop_s=stop_s,
                                   scored_start_s=60.0, scored_stop_s=540.0),
        "position": cabana.ContinuousSignal(t=t_xy, values=xy, channel_names=["x", "y"],
                                            units="mm"),
    },
)
```

`t` is in seconds on the neural clock (any origin); behavior inputs use the same
time base and may start before imaging. [`docs/BRING_YOUR_OWN_DATA.md`](docs/BRING_YOUR_OWN_DATA.md)
walks through BORIS bouts, DeepLabCut position, labels, grids with an explicit
`extent`, masks and support, which metrics need exclusive state spaces, saving and
loading, several sessions and animals, and writing a custom metric. Every code
block in it runs.

## Command line

`cabana run pipeline.yaml --session s.zip --out results/ --progress jsonl` runs a saved
pipeline headlessly; `cabana run study.yaml` runs a whole study; `cabana describe`,
`cabana schema NAME` and `cabana validate` print machine-readable information.
See [docs/CLI.md](docs/CLI.md).

## Documentation

- [`docs/RECIPES.md`](docs/RECIPES.md): the bundled recipes behind `cabana.analyze`, their placeholders, and how to write your own.
- [`docs/BRING_YOUR_OWN_DATA.md`](docs/BRING_YOUR_OWN_DATA.md): from your arrays to a `Session`, a pipeline and results; classifying cells.
- [`docs/PLOTS.md`](docs/PLOTS.md): what each figure shows and what to look for, `plot_all`, cell cards, the plot-data layer, adding a plot for your metric.
- [`docs/PLUGINS.md`](docs/PLUGINS.md): writing your own transform, preprocess step, metric, null or selector, and `check_plugin`.
- [`docs/LOADERS.md`](docs/LOADERS.md): reading Minian, CaImAn, DeepLabCut, BORIS, Keypoint-MoSeq and `.camap` files, and the clock convention.
- [`docs/DESIGN.md`](docs/DESIGN.md): architecture, module specs, design history.
- [`docs/ANALYSIS_COVERAGE.md`](docs/ANALYSIS_COVERAGE.md): survey of analyses in the literature and what is implemented.
- [`docs/STATISTICS.md`](docs/STATISTICS.md): choosing a null, reading p-values, multiple comparisons, per-animal inference.
- [`docs/GLOSSARY.md`](docs/GLOSSARY.md): the vocabulary used in the code and docs.
- [`docs/REFERENCES.md`](docs/REFERENCES.md): numbered references cited throughout.

## Citing

See [`CITATION.cff`](CITATION.cff) (GitHub's "Cite this repository" reads it).

## License

AGPL-3.0, see [LICENSE](LICENSE).
