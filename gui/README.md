# CaBaNA GUI

A browser-based interface to Daniel's CaBaNA analysis framework demo.

The GUI brings the framework's workflow into an interactive workspace for loading calcium-imaging and behavioral data, reviewing data quality, configuring preprocessing, and exploring analysis results without writing code.

The browser calculations are implemented in TypeScript, following the Python framework's `framework-demo` branch. Reference tests compare browser implementations with framework outputs at commit `57c0c4b`. The GUI does not currently execute the Python package directly.

The repository includes simulated demo sessions from several kinds of neurobehavioral experiments. Most contain problems on purpose, such as lost tracking, overlapping cells or mistaken annotations, so each QC and correction feature can be tested as it is developed (see [Example data](#example-data)).

## Current status

Implemented interfaces include data loading, experimental setup, visualization, QC, preprocessing, and dedicated place-cell and auROC analysis workspaces. Each analysis includes configurable settings, multiple results views, run details, and CSV and run-metadata exports.

Development status: some QC and spatial calculations remain placeholders. Framework comparisons currently use synthetic data; validation on real recordings is still needed. See [Framework correspondence and validation](#framework-correspondence-and-validation) before interpreting results.

Planned features include PETH, decoding, population and custom analyses, a Plotting workspace, and a combined Export step.

## Getting started

Requires Node.js 22 or newer. From a terminal:

```bash
git clone https://github.com/miniscope/CaBaNA.git
cd CaBaNA/gui
npm install
npm run dev
```

Open [http://localhost:5173/CaBaNA/](http://localhost:5173/CaBaNA/) and keep the terminal running.

Select **Example data** and choose a simulated session to explore the workflow. You can also load your own files or a folder. Everything runs locally in the browser; no files are uploaded.

The sidebar provides access to both implemented analyses. A step-by-step layout is also available, but currently reaches only place-cell analysis.

## Workflow

| Stage | Available features |
| --- | --- |
| **Load data** | Load files, a folder, or example data; preview inputs; assign unrecognized files; specify the experimental paradigm, source software, and units. An input checklist distinguishes required, recommended, and optional files. |
| **Experimental setup** | Describe subjects and session structure, check frame rates and duration, configure arena geometry and scale, review tracking coordinates, and record stimuli and neural-acquisition information. Export `config.yaml`. |
| **Data visualization** | Explore cells and footprints, inspect neural and behavioral signals on a shared timeline, and view trajectories and occupancy maps. |
| **Data QC** | Review neural and behavioral checks separately, adjust thresholds, and apply supported corrections. Some checks remain placeholders; see [validation details](#framework-correspondence-and-validation). |
| **Preprocess** | Configure neural smoothing, position smoothing and speed filtering, behavior-bout padding, and spatial-map settings. Review previews and the data passed to analysis. Export `preprocess.yaml`. |
| **Analyze** | Open a dedicated place-cell or auROC workspace to configure a run, inspect results, and export results and metadata. |

### Corrections and visualization

Available corrections include median filtering and gap filling for position, rejecting selected cells, and merging nearby behavioral epochs or removing short ones. Analyses use corrected inputs and exclude rejected cells.

The session view aligns individual-cell traces, a population heatmap, behavior annotations, zones, position, and speed. Hover readouts support inspection at specific times.

## Analysis workspaces

Each analysis has its own setup and results views. A run-details drawer records the settings and diagnostics associated with the completed run. CSV exports contain results; JSON metadata records run settings.

Analyses use preprocessed neural events and the effective frame selection from Preprocess. Speed filtering applies when enabled in Preprocess; place-cell analysis also has its own minimum speed, and the higher of the two is used. Place-cell analysis additionally uses position aligned to the neural frames.

### Place cells

Build spatial event-rate maps and evaluate spatial information and spatial stability against circularly time-shifted neural data. Under the current rule, a cell meets place-cell criteria when both tests are significant.

Place-field boundaries and inside/outside rate measurements are reported separately and do not determine classification. Stability currently compares maps from the first and second halves of the recording.

Setup groups controls into spatial maps, spatial tuning, and place-field boundaries, with an occupancy preview. Results include:

- Cell inspector: spatial maps, stability comparisons, and per-cell statistics.
- Map gallery: browse spatial maps across cells.
- Population overview: inspect score distributions and population spatial tuning.
- Map appearance controls: adjust how results are displayed.
- Run details: review settings and automatic parameter selections.

### auROC

Compare each cell's neural values during a behavior with values outside that behavior. Each selected behavior is tested against all other included frames, including unlabeled frames. Overlapping behaviors are tested independently.

An auROC above 0.5 indicates a tendency toward higher activity during the behavior; below 0.5 indicates lower activity. Direction alone does not establish significance. Significance is evaluated against time-shifted data, with optional speed matching.

The GUI defaults to max-stat correction across selected behaviors within each cell. This does not correct across cells. Changing behaviors included in a new run can change adjusted p-values; filtering completed results does not change the analysis.

Results include:

- Cell inspector: observed auROC, time-shifted reference distributions, and responses across behaviors.
- Tuning heatmap: auROC and significance across cells and behaviors.
- Behavior summary: response counts and fractions, distinguishing significant cell–behavior pairs from unique responsive cells.
- Run details: frame selection, correction, shifts, and speed-matching diagnostics.

Significant pairs are labeled Excited or Inhibited. Other pairs are Not significant or Not evaluated, with the reason available. These labels describe recorded activity relative to behavior; they do not identify excitatory or inhibitory cell types or establish causation.

## Framework correspondence and validation

The analysis foundation is Daniel's CaBaNA framework demo on the `framework-demo` branch of [miniscope/CaBaNA](https://github.com/miniscope/CaBaNA). The current reference point is commit `57c0c4b`.

### Browser implementations

| Component | Framework relationship | Verification and limits |
| --- | --- | --- |
| Preprocessing, position corrections, and timing utilities | Browser implementations in `apps/cabana/src/lib/framework.ts` | Reference tests compare outputs for covered inputs and edge cases. |
| Place-cell analysis | Browser calculations in `apps/cabana/src/lib/placecells.ts` | Framework reference comparisons; these do not establish validation of the full workflow on real recordings. |
| auROC and speed matching | Browser calculations in `apps/cabana/src/lib/auroc.ts` and `speed-match.ts` | Compared with framework outputs on synthetic data. Real-recording validation remains outstanding. |
| Session and preprocessing configuration | `apps/cabana/src/lib/session-config.ts` exports framework-format YAML | Uses framework step and field names. Import support is currently partial. |
| Remaining QC checks | Placeholder calculations | Not validated for scientific reporting. |
| Arena, bin, and occupancy calculations | Provisional spatial calculations | Require further verification, including real-data coordinate handling. These calculations affect spatial results. |

Reference comparisons cover the tested cases; they are not a guarantee of equivalence for every possible input. Results depending on placeholder calculations should not be used for scientific reporting.

`framework.ts` includes browser versions of `interpolate_gaps`, `smooth_signal`, `smooth_activity`, `resample_signal`, `speed`, `bouts_to_states`, `clean_mask`, and `timing_report`.

Reference-generation scripts are in `apps/cabana/src/__tests__/`:

- `make_framework_reference.py`
- `make_placecells_reference.py`
- `make_auroc_reference.py`

Run these using a Python environment containing the corresponding `framework-demo` checkout to regenerate reference outputs.

## Example data

Four simulated sessions are provided in [`../example_data/`](../example_data/). Each has a README documenting its files and simulated conditions. Sessions are generated by `../example_data/make_examples.py`.

| Session | Purpose |
| --- | --- |
| `simulated_3chamber` | Reference session with minor imperfections, including approximately 1% lost tracking. Deconvolved events are the simulated true events. |
| `simulated_open_field` | Tracking failures, a long dropout, position jumps, overlapping cells, and noisy cells for testing QC and corrections. |
| `simulated_social_interaction` | Annotation problems, including overlapping epochs, an epoch beyond the session boundary, and a very short epoch, alongside overlapping and noisy cells. |
| `simulated_fear_conditioning` | Missing position, footprints, and denoised traces, plus noisy cells, for testing incomplete inputs. |

In the open-field and social sessions, denoised and deconvolved data are estimated from noisy traces and include estimation errors.

The GUI accesses these files through `apps/cabana/public/example_data`, a symlink to the shared example-data directory.

`../example_data/hipp CA2 social behavior/` holds a real recording (one three-chamber trial, 148 cells). It is gitignored, so it is not in the repository, and it is not in the GUI's example list.

## Validation and limitations

### Incomplete functionality

- PETH, decoding, population, and custom analyses are not implemented.
- A Plotting workspace and combined Export step are planned. Current exports are per-analysis CSV and run metadata; plot appearance controls are available within place-cell results.
- Direct readers for DeepLabCut CSV, BORIS, BENTO, CaImAn, and Minian outputs are not implemented. Experimental setup provides conversion guidance.
- Sidebar icons, multi-session selection, and arena zoom controls from design concepts are not implemented.
- Existing `config.yaml` imports currently read only `arena_cm`; zones and other fields are not restored.
- The trace-smoothing setting is recorded as a note in `preprocess.yaml`; current analyses use events rather than traces.
- auROC is currently available only through the sidebar layout.

### Scientific and data-handling limits

- **QC:** remaining position-jump, lost-frame, cell-score, footprint-overlap, deconvolution, and annotation checks are placeholders.
- **Spatial coordinates:** occupancy overlays assume centimeter coordinates originate at the arena's lower-left corner. Pixel positions are converted using the drawn arena; this workflow has not been tested on real data.
- **Bin size:** the initial value is 3 cm. It is a starting setting, not a universal recommendation. Choose resolution with the occupancy preview and the spatial patterns of interest in mind.
- **Minimum occupancy:** framework defaults are 0.05 s for information and stability and 0.1 s for field boundaries. They are method settings, not guarantees of reliable sampling. Automatic smoothing selection currently uses 0.05 s regardless of the configured occupancy value.
- **Place-cell criteria:** the current framework uses one first-half/second-half stability comparison. This differs from CaMAP's requirement to pass multiple splits. A qualifying field is not required under the current rule; the group has not finalized which criteria to adopt.
- **auROC:** correction is across selected behaviors within each cell, not across cells. Speed-matching defaults (KS distance, tolerance 0.10, and 20 candidates) require evaluation for the intended data. No low-acceptance cutoff is established; a run stops if no shift can be matched. Histogram values are recomputed from stored shifts.
- **Indicator presets:** approximate rise and decay values still require verification against their source publications.
- **Video:** playback depends on browser codec support; MP4/H.264 is currently supported by the documented workflow.

## Open questions

- **Layout:** keep both the step-by-step and sidebar layouts, or pick one? Steps guide a first-time user through the order; the sidebar is faster for jumping between panels.
- **Route into CaLab:** whether the GUI is merged into CaLab as `apps/cabana` (see [License and origin](#license-and-origin)).
- **Python versus WASM:** whether the framework runs in the browser through Rust/WASM, after the remaining checks move into the Python framework, or the GUI calls Python directly.

## Roadmap

- Replace remaining placeholder checks with reviewed framework implementations.
- Validate spatial calculations and both analyses on real recordings.
- Resolve place-cell classification criteria and occupancy-setting consistency.
- Add the remaining analyses and improve input-format support.
- Add a Plotting workspace for customizing figures from completed runs and exporting SVG, PDF, and PNG.
- Extend reusable, expandable plot-reading guidance across analysis views.
- Evaluate a browser-executable framework backend and the longer-term relationship with CaLab.

## Development

The GUI uses SolidJS, TypeScript, Vite, and uPlot. Analysis runs use background workers to keep the interface responsive.

Run commands from `gui/`:

| Command | Purpose |
| --- | --- |
| `npm test` | Run unit tests |
| `npm run typecheck` | Check TypeScript types |
| `npm run lint` | Run ESLint |
| `npm run format` | Format with Prettier |
| `npm run build` | Build into `apps/cabana/dist/` |

### Code organization

```text
gui/
  apps/cabana/
    src/lib/        State, preprocessing, QC, analyses, and exports
    src/workers/    Background analysis workers
    src/panels/     Workflow panels, settings, and results
    src/shell/      Sidebar and step-by-step layouts
    src/__tests__/  Unit tests and framework reference generation
  packages/         Shared CaLab components and utilities
```

| Shared package | Purpose |
| --- | --- |
| `core` | Shared types |
| `compute` | Trace utilities |
| `io` | Reading and checking `.npy` files |
| `ui` | Layout, plots, color maps, and tutorial components |
| `tutorials` | Guided tours |
| `vite-config` | Build configuration |

### Interface conventions

- Explanations appear in collapsible **Note** sections.
- Required fields have a red asterisk.
- Plots include a color bar whenever color carries meaning.
- Interface text never uses "I", "we" or "my".

## License and origin

The GUI was first developed inside a fork of [miniscope/CaLab](https://github.com/miniscope/CaLab) as `apps/cabana`, created with `npm run new-app`, to reuse CaLab's components and build setup. It has since been moved into CaBaNA alongside the Python package, with the CaLab parts it does not use removed. Its calculations follow the Python framework (see above).

The `LICENSE` file in this folder is CaLab's MIT license (Copyright 2025 Daniel Aharoni), which applies to the reused CaLab code. The rest of CaBaNA is licensed under AGPL-3.0.

**Removed from the CaLab version:**

- `community` and `community-ui`: sign-in, feedback, analytics and dataset submission, which depend on Supabase
- The Rust/WASM solver and its build step
- Other CaLab apps, tests, documentation, scripts and CI

### Moving the GUI back into CaLab

If the GUI is merged into CaLab, it goes back in as `apps/cabana`. To restore:

1. Add `@calab/community` and `@calab/community-ui` to `apps/cabana/package.json`.
2. Call `initCommunityStore()` and `initSession()` in `src/index.tsx`.
3. Handle `isAuthCallback()` in `src/App.tsx`.
4. Restore `FeedbackMenu` and `CommunityAuthMenu` in `src/components/Header.tsx`.
5. Fill in the `calab` block in `package.json` for the landing-page card.
6. Replace the example-data symlink with the datasets to ship with the hosted version.

## Terminology

- Epoch/bout: a behavioral interval with a start and stop time.
- Frame labels: behavior membership or categories aligned to individual frames.
- Event: a deconvolved neural event; not an independently measured spike.
- Neural activity: a general description. Plots should identify the actual signal and units, such as deconvolved event magnitude, event rate, or fluorescence.
- Excited/inhibited: significant higher/lower recorded activity for a specific cell–behavior pair under the selected analysis settings.
