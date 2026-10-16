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
  mean activity per state, and peri-event time histograms (PETH) with a pre/post test.
- **Continuous targets:** correlation with a signal such as speed (with lagged
  cross-correlation) and signal tuning curves.
- **Population analyses on re-binned data:** population-vector overlap, stability
  and distance, PCA, cross-validated state decoding, and a GLM with a temporal basis
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
        # masks are chosen per analysis: speed filter for space, scored window for social
        AnalysisSpec(metric={"name": "information_content", "smooth_sigma_bins": 1.0},
                     states="position", shuffle=shuf, masks=["speed"]),
        AnalysisSpec(metric={"name": "information_content"},
                     states="syllables", shuffle=shuf, masks=[]),
        AnalysisSpec(metric={"name": "auroc"}, states="social",
                     shuffle=shuf, masks=["social_scored"]),
        # same states, other questions; the null is one line (circular_shift by default)
        AnalysisSpec(metric={"name": "peth", "pre_s": 4, "post_s": 4, "baseline_s": (-4, -1),
                             "response_s": (0, 1.5)}, states="social",
                     shuffle=ShuffleConfig(n_shuffles=1000, null={"name": "bout_shuffle"}),
                     masks=["social_scored"]),
        # a continuous target instead of a state space
        AnalysisSpec(metric={"name": "signal_correlation"}, signal="speed", shuffle=shuf, masks=[]),
    ],
)
session, results = pipe.run(session)
results.to_dataframe()  # cell × state × metric, with p-values
```

For the full end-to-end run on simulated data with planted ground truth, try
`python examples/demo.py --quick` (about 10 s; writes figures, tables and the
pipeline YAML to `examples/output/`; the full run takes a couple of minutes) or open `notebooks/cabana_demo.ipynb`.

## License

AGPL-3.0, see [LICENSE](LICENSE).
