# CaBaNA

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

Early design demo. Synthetic data only; loaders for real formats (Minian,
CaImAn, DeepLabCut, BORIS, `.camap` bundles) are the next step. CaBaNA is
intended to become an app within [CaLab](https://github.com/miniscope/CaLab)
and follows its Python conventions.

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
- **Null distributions as plugins:** circular shift, block label shuffle and bout
  shuffle, chosen with one line of `ShuffleConfig`.
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

In Colab or any environment without a checkout:

```bash
pip install "git+https://github.com/miniscope/CaBaNA.git@framework-demo"
```

The `@framework-demo` pin is needed only while the package lives on that
branch; it goes away after the merge to `main`.

## Quick look

```python
import cabana
from cabana import Pipeline, AnalysisSpec, ShuffleConfig, simulate_session

session = simulate_session()  # 2D arena + social bouts + syllables, planted cells

shuf = ShuffleConfig(n_shuffles=1000, min_shift_s=20.0)

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
```

Give an analysis your own name with `AnalysisSpec(name="...", ...)`; otherwise it is
`metric[target]`, with `#<null>` or `#2` added when two analyses would collide.

For the full end-to-end run on simulated data with planted ground truth, try
`python examples/demo.py --quick` (about 20–40 s; writes figures, tables and the
pipeline YAML to `examples/output/`; the full run takes a few minutes) or open `notebooks/cabana_demo.ipynb`.

## Bring your own data

There are no file loaders yet, so you build a `Session` from arrays you read
yourself:

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

## Documentation

- [`docs/BRING_YOUR_OWN_DATA.md`](docs/BRING_YOUR_OWN_DATA.md): from your arrays to a `Session`, a pipeline and results.

- [`docs/DESIGN.md`](docs/DESIGN.md): architecture, module specs, design history.
- [`docs/ANALYSIS_COVERAGE.md`](docs/ANALYSIS_COVERAGE.md): survey of analyses in the literature and what is implemented.
- [`docs/STATISTICS.md`](docs/STATISTICS.md): choosing a null, reading p-values, multiple comparisons, per-animal inference.
- [`docs/GLOSSARY.md`](docs/GLOSSARY.md): the vocabulary used in the code and docs.
- [`docs/REFERENCES.md`](docs/REFERENCES.md): numbered references cited throughout.

## Citing

See [`CITATION.cff`](CITATION.cff) (GitHub's "Cite this repository" reads it).

## License

AGPL-3.0, see [LICENSE](LICENSE).
