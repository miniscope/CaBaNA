# CaBaNA roadmap: review-panel synthesis (2026-10-16)

Six independent reviews of the `framework-demo` branch (infrastructure, metrics
and nulls, plotting, preprocessing, CaLab porting, parameter selection) were
merged into this document. Each reviewer read the code and docs; the plotting
reviewer rendered and inspected the demo figures; the parameter reviewer ran a
smoothing × bin-size sweep on the simulator. Claims that change priorities were
spot-checked against the code by the coordinator.

## 0. Status (updated 2026-10-17)

| Phase | State | Commits | Notes |
|---|---|---|---|
| A: safety net and contracts | done | `2a1e940`, `0af355a` | CI, format 2 persistence, per-analysis seeds, provenance, `n_jobs`, resumable `run_set`, golden and property tests |
| B: parameters, sweeps, provenance | done | `26aca15`, `1326010`, `d660898` | `_kernels`, `Selection` + parameter paths, `Selector` stage, `cabana.sweep` with guard rail, `auto_smooth_sigma`, `auto_null_timescale`, demo figures 28–29, notebook section 5. F1 (kernels) and F4 (tuning export: partially, via `Selection`) pulled forward |
| C: real data in | done except C8 layers | `3d01847`, `3a3b22b`, `bd70127` | cell metadata and QC, activity conditioning, mask composition, behaviour transforms, alignment, Miniscope-format loaders, `load_calab`, `load_session_dir`, three-chamber fixture, `PLUGINS.md` + `check_plugin`. Deferred: `Session.layers` (multiple activity representations side by side); "preprocess before transforms" resolved by writing Transforms instead |
| D: evidence-first presentation | done (2026-10-17) | `ab98aed`, `76cd2c2`, `ae4116a` | `_data` companion for every plot (versioned contract, strict JSON), plot registry with `default_plots`, `result.plot` / `plot_all`, shared style, per-cell evidence cards, raster / population tuning / session QA / analysis agreement views, and the D6 figure fixes; guide in `docs/PLOTS.md` |
| E: metrics and nulls | done (2026-10-17), except `rsa` / `cross_decode` | `4a72905`, `6c871be`, `9de64cd` | speed-matched, per-cell and within-state nulls; `place_fields`, `tuning_selectivity`, `circular_tuning`, `decode_signal`, `pairwise_correlation`, `participation_ratio`; `null_std`, `z_score`, `bias_corrected`, `null_info`; PETH null band and latency; five new figures. Deferred: `rsa`, `cross_decode` |
| F: CaLab integration | done | `c63ecd9`, `49e15a6` | F2–F6 landed 2026-10-17 (schema, CLI + StudySpec, tuning export, `analyze()` front door, memory); licence decision still pending; interactive `tune()` waits for the CaLab slider |

Open decisions: licence (AGPL-3.0 vs CaLab's MIT); `auto_null_timescale` floor (5 s) vs the 20–30 s convention.

## 1. Where the framework stands

The plugin/spec/criteria layers are judged sound by every reviewer. The gaps are
at the edges: getting real data in, choosing and recording parameters, showing
evidence per cell, and an execution layer (serial, shared seed, dense nulls in
RAM, unversioned format) that will hit walls before the statistics do.

Three findings recur across reviews and should be read as the shape of the
next increment:

1. **Parameters are fixed numbers with no record of why.** Smoothing, bin size,
   speed cutoff, event threshold and occupancy floor are all arbitrary or tuned
   on the simulator. Library defaults disagree with the demo (`smooth_sigma_bins`
   is 0 in every metric, 1 in the demo). Nothing records how a value was chosen.
2. **Nothing is language-neutral yet.** Results, plots, progress and the saved
   format are Python-shaped. The saved npz holds `<U` string arrays that
   CaLab's `@calab/io` cannot parse, and the manifest is written with
   `allow_nan=True`, which `JSON.parse` rejects.
3. **The bridge from upstream tools to the three arrays is thin.** Loaders drop
   SNR, accepted flags, footprints and CaLab kernel/alpha; there is no dF/F,
   detrend or noise-based event detection; DLC jitter flows straight into speed.

## 2. Decisions needed from the project lead

| Decision | Why it blocks | Recommendation |
|---|---|---|
| **Licence.** CaBaNA is AGPL-3.0; CaLab is MIT. | No code can be ported or vendored into CaLab until resolved. | Relicense to MIT now (sole author, no external contributions yet). |
| **Integration shape.** Browser-only (Rust/WASM) vs Python engine vs hybrid. | Determines which kernels need extraction and whether a CLI/job server is built. | Hybrid: port the shift-sum family to Rust/WASM for interactive use and single-metric shuffle tests; keep GLM/PCA/Bayes/cohort stats in Python behind a `cabana serve` job route. Python stays the reference implementation. |
| **Seed policy.** Per-analysis derived seeds change every number once. | Must be done before golden regression files are frozen. | Do it in the same increment as the golden files and `n_jobs`. |
| **Parameter-selection policy.** Auto-pick vs sweep-and-report vs user pick. | Shapes the sweep API, provenance record and the future CaTune-like app. | All three, with a `Selection` provenance record and a hard rule that selection criteria never see p-values (section 6). |

## 3. Phased plan

Effort: S = under a day, M = a few days, L = a week or more (coordinator plus
subagents). Phases are ordered by dependency, not importance.

### Phase A: safety net and contracts (do first, mostly S)

| # | Item | Effort | Source |
|---|---|---|---|
| A1 | Licence decision; `license` field, classifiers, version bump, `calab` optional extra in `pyproject.toml` | S | CaLab |
| A2 | GitHub Actions CI: py3.11–3.13 × (min, latest) numpy/pydantic, ruff, pytest, notebook via nbclient; lockfile or constraints file; `__version__` from tags | S | Infra |
| A3 | Persistence: check `format` on load, `_MIGRATIONS` table, error on newer format; move `cell_ids`/state names into `manifest.json`; `allow_nan=False` with null/sentinel for non-finite; dtype contract (f8/f4, bool, i4); test that saved files load strictly | S–M | Infra, CaLab |
| A4 | Golden numeric regression files (`tests/golden/`, seeded sessions, saved ResultSets, `assert_allclose` rtol 1e-9, `--update-golden`) plus Hypothesis properties (dense == label path, cell-permutation invariance, shift 0 == observed, p in (0,1]) | M | Infra, CaLab |
| A5 | Seeding: pipeline-level seed, per-analysis `SeedSequence([seed, name])`; provenance gains package versions, pipeline hash, session content hash; log preprocess steps into `meta["preprocess"]` (transforms already are); masks carry origin | S | Infra, Preproc |
| A6 | `n_jobs` for shuffle batches (threads) and `run_set` (processes) with pre-spawned child seeds; regression test `n_jobs=1 == n_jobs=4`; `run_set(out_dir=)` writes per-session zips and resumes | M | Infra |

### Phase B: parameters, sweeps and provenance (the smoothing question)

| # | Item | Effort | Source |
|---|---|---|---|
| B1 | `cabana.sweep(session, pipeline, over={"transform.bin_size": [...], "metric.smooth_sigma_bins": [...]}, shuffle=None)` in a new `_sweep.py`: Cartesian product of dotted-path overrides, tidy long table (param values × cell × state × value × p), stability readout (per-cell flip count, modal class, unstable-cell list), `shuffle=None` fast mode for interactive use; `levels_sweep` in the demo becomes a call to it | M | Params, Plots, CaLab |
| B2 | `Selection` provenance record on `Pipeline` and in `ResultSet.provenance["selections"]`: path, chosen value, method (`literature_default` / `auto_cv` / `user_pick` / `fixed_apriori`), candidates, criterion and scores, split hash, flag `informed_by_significance` | S | Params, Preproc |
| B3 | Automatic smoothing and bin size: session-level held-out Poisson log-likelihood over a sigma grid with contiguous folds (reuse `contiguous_folds`), one-SE rule toward smaller sigma, expressed in mm so it is portable across bin sizes; bin size fixed at ≤ ¼ expected field width. Implemented as a fit-then-freeze `PreprocessStep` (`AutoSmoothSigma`) that writes `meta["auto_params"]` and a `Selection`; `"auto"` field values are sugar for that step | M | Params, Preproc |
| B4 | Guard rail: `criterion` must be a held-out or reliability score, never `p`/`significant`/`n_significant`; optional select-on-odd-folds, test-on-even mode; a report-only mode that flags parameter-sensitive cells instead of picking | S–M | Params |
| B5 | Reconcile defaults: library `smooth_sigma_bins` to match the demo or document why 0; standardise `n_folds`; document the origin of every default in `docs/STATISTICS.md` | S | Params |
| B6 | Sweep plots: `plot_sweep_gallery` (one cell, one column per value, shared colour scale), `plot_sweep_stability` (fraction significant with binomial CI, flip matrix sorted by flip point, Spearman between adjacent values), generalised `plot_sweep(df, x, hue, panels)` replacing the hard-wired `plot_level_sweep` | S–M | Plots |
| B7 | Auto `min_shift_s` and `block_s` from activity/behaviour autocorrelation time | M | Params |

### Phase C: real data in (preprocessing and data model)

| # | Item | Effort | Source |
|---|---|---|---|
| C1 | `Session.cell_meta: dict[str, ndarray]` (+ optional footprints), `select_cells`, `SelectCells` QC step (min SNR, min events, accepted-only); loaders populate SNR, r_values, cnn_preds, accepted; CaImAn loader stops hard-filtering at load | M+S | Preproc |
| C2 | `load_calab` carrying kernel taus, alpha, pve, baseline; note that per-cell alpha rescaling makes deconvolved amplitudes incomparable across cells | S–M | Preproc, CaLab |
| C3 | Activity steps with correct `activity_kind` semantics: `ComputeDff`, `Detrend`/`Bandpass`, `DetectEvents` (k·σ_noise per cell, MAD or diff/√2, min duration, refractory) producing `spike_counts` or a new `binary` kind; fix `BinarizeActivity` kind; `Clip(min=0)`; relabel Minian `C` from `raw` to `denoised` | M | Preproc |
| C4 | Behaviour signal steps: keep DLC likelihood as a channel, `InterpolateGaps(max_gap_s)`, `SmoothSignal`, `HeadDirection`, `Distance(a, b)`, `ArenaTransform`, multi-animal DLC | M | Preproc |
| C5 | Alignment: `timing_report` (dropped frames, jitter), `AlignClock(offset, scale)` / TTL sync, `TrimToOverlap`, `ResampleSignal(max_gap_s, method)`, non-integer `Resample(fs_target)` | M | Preproc |
| C6 | Masks: `MaskFromState`, `CombineMasks(expr)`, `MinBoutMask`; `ZscoreActivity(by="cell"|"global", mask_names=)` to remove order-dependence | S | Preproc |
| C7 | Bouts: `merge_gap_s` (current `min_gap_s` drops rather than merges), `point_event_window_s`, `ModeFilterLabels` | S | Preproc |
| C8 | `SessionInfo` submodel (animal, date, condition, group) read by `Cohort.from_sessions`; multiple activity layers (`Session.layers`, `AnalysisSpec.layer`) | S + M | Preproc, Infra |
| C9 | Docs: worked custom `PreprocessStep` and `Transform`, `check_plugin` conformance helper; allow preprocess before transforms | S | Preproc |

### Phase D: evidence-first presentation

| # | Item | Effort | Source | Status |
|---|---|---|---|---|
| D1 | `plot_data` layer: `<plot>_data(...) -> dict` of JSON-serialisable arrays, labels, units, state colours, significance; matplotlib functions become renderers; versioned alongside the results schema | M–L | Plots, CaLab | done: every plot has a `_data` companion; `check_plot_data` in the tests |
| D2 | Plot registry: `Metric.default_plots`, `cabana.plots.plot(result, session)`, `result.plot()`, `ResultSet.plot_all()`, `save_figures` | S–M | Plots | done |
| D3 | `plot_cell_card(session, results, cell)`: rate map or tuning, null histogram per analysis with raw and adjusted p, PETH/raster if events, metric strip, trace with behaviour shading; `plot_cell_cards(cells="significant")` | M | Plots | done: `plot_cell_card`, `plot_cell_cards` |
| D4 | Shared style: `use_style()`, `state_colors(session)` memoised per state space, one significance marker, unit-bearing axis labels, colour-blind-safe palette, warn above 20 states | S | Plots | done |
| D5 | Missing views: `plot_activity_raster` with behaviour ribbon, `plot_population_tuning` sorted by peak with cell IDs, `plot_session_qa` (occupancy, bout counts, excluded fraction, dropped frames), `plot_analysis_agreement` (UpSet/Jaccard, −log10 p_adj grid) | M | Plots | done |
| D6 | Specific fixes: rate maps need colourbar/occupancy/units and an explanation of the p floor; PETH sorted by latency with colourbar and SEM; decoded trajectory as 2-D path plus posterior heatmap; joint histogram per-panel or lift scaling by default; NaN drawn as unvisited rather than 0; `max_cells` paging; ground-truth figure overlays adjusted FPR | S each | Plots | done; the decoded-trajectory path is honest but busy on coarse grids |

### Phase E: metrics and nulls

| # | Item | Fast path | Effort | Source | Status |
|---|---|---|---|---|---|
| E1 | Covariate-matched (speed-matched) null: accept only shifts whose per-state covariate distribution matches the observed one; balance diagnostic in provenance | yes | M | Metrics | done: `covariate_matched_shift`; acceptance rate and balance in `ShuffleResult.null_info` |
| E2 | `cell_shift` / `cell_permutation` null (independent roll per cell) plus `pairwise_correlation` (signal and noise, state-conditioned) and `participation_ratio` | no | M | Metrics | done: `cell_shift`, `pairwise_correlation`, `participation_ratio` |
| E3 | `place_fields` (threshold + connected components: count, area, centroid, in/out ratio) and `tuning_selectivity` (selectivity index, lifetime sparseness, preferred state) | yes | M + S | Metrics | done: `place_fields`, `tuning_selectivity` |
| E4 | Null-normalised z-score and `shuffle_mean` bias correction on `ShuffleResult` | yes | S | Metrics | done: `null_std`, `z_score`, `bias_corrected`, `z` column |
| E5 | `within_state_shuffle`, `rsa`/`cross_decode`, `circular_tuning` (mean vector length), `decode_signal` (ridge/kNN, closed-form ridge for shuffles), PETH per-bin null band and latency | mixed | M each | Metrics | done except `rsa` and `cross_decode`, deferred: `within_state_shuffle`, `circular_tuning`, `decode_signal`, PETH `null_band` and `latency_s` |

### Phase F: CaLab integration

| # | Item | Effort | Source | Status |
|---|---|---|---|---|
| F1 | `cabana/_kernels/`: pure-numpy `shifted_sums`, `state_label_sums`, `rate_map(sums, occ, …, sigma)`, `skaggs_info`, `joint_counts`, `auroc_ranks`; canonical input `labels: int32 (n_time,)` + `n_states`; lint that `_kernels` imports only numpy; golden vectors with explicit shifts (RNG becomes a boundary: null plan is a first-class array) | M–L | CaLab |
| F2 | Results JSON Schema (`schemas/resultset-v1.json`, semver `schema_version`, per-array shape/dtype/axes), `describe()` gains output metadata and `ui` hints (`group`, `sweepable`, `unit`); test every plugin yields strict JSON schema with descriptions | M | CaLab, Infra |
| F3 | Headless CLI: `cabana run spec.yaml --session s.zip --out dir/ --progress jsonl`, `cabana describe`, `cabana schema`; `ProgressEvent.to_dict()` mapped to the bridge progress payload; SIGINT → `should_cancel`; `StudySpec` (sessions, loaders, animal map, pipeline, criteria, out_dir) | M | CaLab, Infra |
| F4 | Tuning export v1 mirroring CaTune's export (`chosen`, `swept`, `criterion`, `session_hash`), `Pipeline.apply_tuning(export)` writing `Selection` records; `cabana.tune()` modelled on `calab.tune()` | S–M | CaLab, Params |
| F5 | Researcher front door: `cabana.analyze(session, "place_cell", states="position")` backed by YAML recipes; `ResultSet.summary()`; `logging.getLogger("cabana")`, tqdm adapter, `pipeline.validate(session)` preflight with time/memory estimate | M | Infra |
| F6 | Memory: do not allocate the full null when `keep_null="none"`; float32 null; cache state labels and masked counts per (states, mask) across analyses; `memory_estimate` | M | Infra |

## 4. Suggested order of increments

1. **Phase A** in full. It is cheap, and everything after it changes numbers or formats.
2. **B1–B5** (sweep, selection record, auto smoothing, guard rail, reconciled defaults) together with **F1** (kernels), because the interactive sweep needs the same pure kernels the Rust port needs.
3. **C1–C5** (cell metadata, CaLab loader, event detection, behaviour cleanup, alignment) so a lab member can run a real Minian + DLC + BORIS session end to end.
4. **D1–D4** (plot-data layer, registry, cell card, style) so the results of step 3 are readable per cell.
5. **E1–E3** (speed-matched null, cell-independent null and correlations, fields and selectivity).
6. **F2–F4** (schemas, CLI, tuning export) once the contracts have settled.

## 5. Where the reviewers disagreed

- **Split-half reliability as the smoothing criterion.** The preprocessing reviewer proposed it; the parameter reviewer measured it and found it monotone in sigma (0.33 → 0.94 at 20 mm bins from sigma 0 to 3), so it rewards over-smoothing. Resolution: use held-out likelihood to choose, report reliability alongside.
- **Where "auto" lives.** The preprocessing reviewer wants explicit fit-then-freeze steps; the parameter reviewer is comfortable with `"auto"` field values. Resolution: steps are canonical, `"auto"` expands to the step, both write the same `Selection` record.
- **Path A vs B for CaLab.** Neither pure path fits. Path A as originally conceived needs a reverse RPC the bridge does not have; path B cannot carry scipy/sklearn metrics. The hybrid in section 2 is the consensus.

## 6. The smoothing answer in one paragraph

Spatial smoothing should be chosen by a data-driven rule that never sees the
null test, shown to the user as a sweep so they can override it, and recorded
in provenance whichever way it was set. Concretely: an `AutoSmoothSigma` step
picks the sigma (in mm) that maximises held-out Poisson log-likelihood across
contiguous folds, pooled over cells, with a one-standard-error preference for
less smoothing; `cabana.sweep` over sigma and bin size shows rate maps for
example cells and how many cells flip classification between neighbouring
settings (6–11% of cells flipped between reasonable settings on the simulator
even when the total count was stable); a `Selection` record stores the method,
candidates, criterion and chosen value, and flags any user pick made after
seeing p-values. The same sweep, run without shuffles, is fast enough (tens of
milliseconds per setting from cached state sums) to drive a CaTune-style slider
later, and its export format should mirror CaTune's so chosen values flow back
into an `AnalysisSpec`.

## 7. Simulator sweep data (parameter reviewer, 80 cells, 600 s, 100 shuffles)

| bin (mm) | sigma (bins) | detection | FPR | split-half r | n significant |
|---|---|---|---|---|---|
| 10 | 0 | 0.38 | 0.03 | 0.18 | 12 |
| 10 | 1 | 1.00 | 0.09 | 0.66 | 30 |
| 20 | 0 | 1.00 | 0.03 | 0.33 | 29 |
| 20 | 1 | 1.00 | 0.12 | 0.87 | 31 |
| 20 | 2 | 1.00 | 0.09 | 0.93 | 29 |
| 20 | 3 | 1.00 | 0.06 | 0.94 | 29 |
| 40 | 0 | 1.00 | 0.03 | 0.60 | 28 |
| 40 | 3 | 0.96 | 0.06 | 0.95 | 28 |

Detection and FPR are against planted ground truth (24 place cells, 33 untuned),
so FPR resolution is about 3 percentage points. Fields are Gaussian and
noise-free, so real data will be more sensitive.
