# Loading common formats

`cabana.loaders` reads the files your acquisition and tracking software write
and returns the objects a `Session` is built from. Optional dependencies are
imported only when you call a loader that needs them, and the error says which
extra to install. For what to do with the result, see
[`BRING_YOUR_OWN_DATA.md`](BRING_YOUR_OWN_DATA.md).

| loader | reads | returns | needs |
| --- | --- | --- | --- |
| `load_minian` | Minian zarr directory or store, or a netCDF file | `Session` | `xarray` and `zarr` or `netCDF4` (`cabana[minian]`) |
| `load_caiman` | CaImAn results `.hdf5` | `Session` | `h5py` (`cabana[caiman]`) |
| `load_calab` | CaLab `CaDeconResult` (or dict), or an `.npz` | `Session` | nothing extra (`calab` is not imported) |
| `load_camap` | CaMAP `.camap` bundle directory | `Session` | `pyarrow` for `canonical.parquet` (`cabana[loaders]`) |
| `load_boris` | BORIS events export, `.csv` or `.tsv` | `BoutTable` | nothing extra |
| `load_dlc` | DeepLabCut single- or multi-animal `.csv` or `.h5` | `ContinuousSignal` | `tables` for `.h5` (`cabana[loaders]`) |
| `load_moseq` | Keypoint-MoSeq `.csv` or `results.h5` | `LabelSeries` | `h5py` for `.h5` (`cabana[loaders]`) |
| `load_miniscope_timestamps` | Miniscope `timeStamps.csv` (`Frame Number`, `Time Stamp (ms)`, `Buffer Index`) | `ndarray` seconds | nothing extra |
| `load_head_orientation` | Miniscope V4 `headOrientation.csv` (`Time Stamp (ms)`, `qw`, `qx`, `qy`, `qz`) | `(t, quat)` | nothing extra |
| `load_position_csv` | `frame, x, y` table joined to a timestamps file by frame number | `(t, xy)` | nothing extra |
| `load_epochs_csv` | annotation epochs `label, start_s, stop_s` | `BoutTable` | nothing extra |

Helpers: `video_time_to_neural`, `infer_fs`, `validate_time`, `dlc_centroid`, `timing_report`,
`fit_clock`, `apply_clock`.

Install the extras the same way as the package itself:

```bash
pip install "cabana[loaders] @ git+https://github.com/miniscope/CaBaNA.git@framework-demo"
```

(`cabana[minian]` and `cabana[caiman]` install only what that one loader needs;
`cabana[loaders]` installs `xarray`, `zarr`, `h5py`, `tables` and `pyarrow`.)

## The clock convention

CaBaNA works in seconds on the **neural clock**: `Session.t` is the time of each
imaging frame. The behavior files (BORIS, DeepLabCut, Keypoint-MoSeq) count time
from the first frame of the behavior video. The loaders convert with one rule:

    t_neural = t_video - t_offset_s

where `t_offset_s` is **the moment imaging started, measured in video time**,
that is, how long the video had been running when the first imaging frame was
acquired. Use 0 if both were started together.

Worked example. The video was started 12.4 s before imaging (a trigger or an LED
flash in the video shows imaging began at 12.4 s of video time), so
`t_offset_s = 12.4`:

- a BORIS bout from 100.0 s to 104.0 s of video time lands at 87.6 to 91.6 s on
  the neural clock;
- DeepLabCut frame 0 (video time 0.0 s) lands at -12.4 s, before imaging; it is
  kept, and `resample_signal` later marks the frames outside the signal's range
  as missing;
- Keypoint-MoSeq frame 300 at 30 Hz (video time 10.0 s) lands at -2.4 s.

```python
from cabana import loaders

loaders.video_time_to_neural([100.0, 104.0], t_offset_s=12.4)  # array([87.6, 91.6])
```

`scored_span` for `load_boris` is **already on the neural clock** (after the
offset). `load_dlc` takes either `t` (one neural-clock time per row) or
`fs_video` with `t_offset_s`, but not `t` together with a non-zero `t_offset_s`.
`load_minian` uses a `t` you pass, else a timestamp coordinate on `frame`
(`t`, `time`, `timestamp`, `timestamps` or `timestamp_s`, in seconds), else
`fs`; `load_caiman` always uses `arange(n_frames) / fs`.

## Two clocks, timestamps files and dropped frames

Miniscope and behavior-camera recordings usually each write a `timeStamps.csv`.
If both were stamped by one acquisition system their stamps are **already on one
shared axis** (milliseconds since the recording started; the first stamp is often
slightly negative), and nothing needs converting: use the stamps as they are and
leave `t_offset_s` alone. `t_offset_s` (above) is for a *video* clock that starts
at a different zero from imaging, where all you have is frame indices.

**`load_miniscope_timestamps(path)`** returns `Time Stamp (ms)` as float64
seconds. Frame numbers must be strictly increasing (the error names the first
offending frame); time stamps that go backwards give a warning naming the frame.
`Buffer Index` is ignored; a negative first stamp is kept.

**`timing_report(t, fs_nominal=None)`** (also fine on `Session.t`) returns a dict:
`n_frames`, `duration_s`, `fs_median`, `fs_mean`, `fs_nominal`, `fs_ratio`,
`n_dropped_frames`, `dropped_fraction`, `gap_index` / `gap_start_s` /
`gap_n_frames` (where each gap is and how many frames it hides), `jitter_sd_s` and
`first_t`. A frame counts as dropped when an interval exceeds 1.5 times the
median; a gap of `dt` hides `round(dt / median) - 1` frames. Prefer `fs_mean` for
`Session.fs` when stamps are rounded to whole milliseconds (33 and 34 ms
alternate at 30 Hz, so `fs_median` reads 30.3). The `timing_check` preprocess step
stores the report in `meta["timing"]` and warns above a dropped-frame fraction.

**`load_position_csv(path, *, timestamps, frame_column="frame",
columns=("x", "y"), missing_value=-1, units="cm")`** returns `(t, xy)`. The table
has no time column, so rows are matched to `timestamps` (a `timeStamps.csv` path,
or an array whose index is the frame number) by **frame number**, not row order;
frames missing from the timestamps are dropped with a warning. A row whose
coordinates all equal `missing_value` becomes NaN. Pass `units` on as
`ContinuousSignal(units=...)`; nothing converts units.

**`load_head_orientation(path, *, timestamps=None)`** returns `(t, quat)` with
`quat` `(n, 4)` in `w, x, y, z` order, on the neural clock. Stamps come from the
file unless `timestamps=` overrides them (a warning if they disagree by more than
1 ms). Put it in a `ContinuousSignal` whose channels are `head_w`, ...,
`head_z`, then `resample_signal` and `head_direction(quaternion="head")`. Name
the channels with a prefix: plain `x`, `y`, `z` would overwrite the position
signals. The zero of yaw is the sensor's power-on heading; calibrate it with
`offset_deg`. For roll, pitch and yaw use `head_orientation(quaternion="head")`
(`head_yaw`, `head_pitch`, `head_roll`, degrees; intrinsic Z-Y'-X'' angles in the sensor
axes, with yaw and roll ill-defined near pitch = +-90 degrees; `yaw_offset_deg` calibrates yaw;
x forward, y left, z up, pitch nose-up positive, positive roll right ear down). To test cells
against these angles, run `cabana.analyze(session, "head_orientation")` (see `RECIPES.md`): it adds
the two transforms itself when the raw `head_orientation` signal is in `session.behavior`, and
tests yaw by circular tuning and pitch and roll by correlation and tuning information.

**`load_epochs_csv(path, *, label_column="label", start_column="start_s",
stop_column="stop_s", scored_span=None)`** returns a `BoutTable`. Times are
already on the session clock (no offset applied). `stop >= start` is checked and
the row named if not; zero-length rows are point events. Pass `scored_span`, as
for `load_boris`.

**Aligning two clocks that really differ.** `fit_clock(t_a_events, t_b_events)`
fits `t_b = scale * (t_a - offset_s)` by least squares from paired sync events
(TTL pulses, LED flashes) and returns `(offset_s, scale)`;
`apply_clock(t, offset_s, scale)` applies it. With `scale = 1` this is the same
`t_neural = t_video - t_offset_s` rule as above, and `scale` absorbs drift. Align
the behavior times first, then `resample_signal`.

The lab's `simulated_3chamber` dataset (`tests/data/simulated_3chamber`, see its
README and `tests/test_three_chamber.py`) uses all of these.

## What each loader reads

**Minian** (`load_minian(path, *, activity="S", fs=None, t=None)`). `path` is a
Minian output directory holding `S.zarr` / `C.zarr`, a zarr store with the whole
dataset, or a netCDF file. The variable (`S` deconvolved, `C` denoised
fluorescence) needs dims `unit_id` and `frame` in either order. `cell_ids` are the
`unit_id` values; `activity_kind` is `deconvolved` for `S` and `raw` for `C`.
`cell_meta` gets `unit_id` and, if the store has `A` (dims `unit_id`, `height`,
`width`) covering every unit, `centroid_x` / `centroid_y` in pixels (computed lazily
from row and column marginals). `footprints=True` also attaches `A` as
`Session.footprints` (float32), block-averaged by `footprint_downsample`
(default 1; centroid columns stay in original pixels). Off by default: dense
footprints are large.

**CaImAn** (`load_caiman(path, *, activity="S", fs, accepted_only=True)`).
Reads `estimates/S`, `estimates/C` or `estimates/F_dff` (`deconvolved`, `raw`,
`dff`), shaped `(n_components, n_frames)`. By default only the accepted components
in `estimates/idx_components` are kept and `cell_ids` are the original component
indices. `fs` is required; `params/data/fr` is stored in `meta` if present.

`accepted_only` semantics: the loader always builds the full session first, with
`cell_meta` columns `snr` (`SNR_comp`), `r_values`, `cnn_preds`, `accepted` (bool,
only if `idx_components` exists) and `centroid_x` / `centroid_y` (from the sparse
`A` and `params/data/dims`), each present only if the file has it. With
`accepted_only=True` it then calls `Session.select_cells`, so
`meta["cell_selection"]` records `n_before`, `n_after` and
`source={"loader": "caiman", "accepted_only": True}` and `cell_meta` stays aligned.
`accepted_only=False` returns every component; filter later with the
`select_cells` step (`require=["accepted"]`, `min_snr=...`). An empty
`idx_components` with `accepted_only=True` raises. `keep_idx_components` is a
deprecated alias.

**CaLab** (`load_calab(result_or_path, *, fs=None, t=None, t_offset_s=0.0,
raw=None, cell_ids=None, info=None)`). Takes a `calab.CaDeconResult` (any object
with `.activity` `(n_cells, n_time)` and `.fs`, optionally `.alphas`,
`.baselines`, `.pves`, `.metadata`), a dict with those keys, or an `.npz` with
`activity` and `fs` plus any of `alphas`/`alpha`, `baselines`/`baseline`,
`pves`/`pve`, `tau_rise`, `tau_decay`, `beta`, `residual` (CaLab has no native
result writer; `np.savez(path, activity=r.activity, fs=r.fs, alphas=r.alphas, ...)`
makes one). CaLab itself is never imported. `activity_kind="deconvolved"`; float32
is promoted to float64. `cell_meta`: `alpha`, `baseline`, `pve` when given, and
`tau_rise_s` / `tau_decay_s` (one fitted value per session, repeated per cell)
when the fit ran. `meta["kernel"]` holds `tau_rise_s`, `tau_decay_s`, `beta`,
`residual` (`None` if not fitted), `meta["source"]="calab"`, and
`meta["calab_version"]` if calab is installed. `raw` is validated and discarded
with a warning (one activity layer per session until roadmap C8).

**CaLab alphas make amplitudes incomparable across cells.** Each cell's activity
is scaled by its own `alpha`, so a larger deconvolved value in one cell does not
mean a larger event. Compare binary activity (`detect_events`), z-scored
activity, or divide by `cell_meta["alpha"]` first.

**CaMAP** (`load_camap(path)`). Reads the layout written by CaMAP's
`save_bundle`: `metadata.json`, `config.yaml` (`neural.fps` gives `fs`) and
`data_config.yaml` are kept in `meta["camap"]`. `canonical.parquet` is preferred:
its `s_unit_<id>` columns become `activity` (`deconvolved`), `neural_time` becomes
`t`, and every other numeric column (`x`, `y`, `speed`, ...) becomes a
`Session.signals` entry on the neural clock. If the parquet is missing or
`pyarrow` is not installed, `deconv.npz` is used with a warning: activity only,
`t = arange(n) / fps`, no behavior signals. Not read: `footprints.nc`,
`traces.nc`, `unit_results/`, `spatial.npz`, `figures/`.

**BORIS** (`load_boris(path, *, t_offset_s=0.0, subject=None, behaviors=None,
scored_span=None)`). Two layouts, columns matched case-insensitively:
aggregated (`Behavior`, `Start (s)`, `Stop (s)`, optional `Subject`) and raw
events (`Time`, `Behavior`, `Status` with START / STOP / POINT rows, START and STOP
paired per subject and behavior). `subject=` and `behaviors=` filter.

**DeepLabCut** (`load_dlc(path, *, fs_video=None, t=None, t_offset_s=0.0,
bodyparts=None, likelihood_min=0.6, keep_likelihood=True, individuals=None,
units="px", px_per_mm=None)`). Single-animal CSV (three header rows) or H5.
Channels are `<bodypart>_x` and `<bodypart>_y`; samples below `likelihood_min`
become NaN in both coordinate channels (`likelihood_min=None` keeps everything);
`px_per_mm` converts to mm. With `keep_likelihood` (default) the raw likelihood is
also stored as one channel `<bodypart>_likelihood` per bodypart (not NaN-ed and
not scaled), so after `resample_signal` it is a session signal that
`mask_from_signal` can re-threshold (`min=0.9`) without reloading.

Multi-animal files (an `individuals` header level, four header rows in CSV) are
read too: channels are `<individual>_<bodypart>_x`, `_y`, `_likelihood`, and
`individuals=["mouse1"]` keeps a subset (DLC's `single` pseudo-individual holds
unique bodyparts). Use the prefix `<individual>_<bodypart>` wherever a transform
asks for a position (`head_direction`, `distance`, `zone_occupancy`). Passing
`individuals` for a single-animal file raises. `dlc_centroid(signal, ["nose",
"tail"])` returns the mean position as channels `x` and `y`, which is what
`speed` and `bin_grid` look for by default.

H5 files need `trusted_hdf=True`: `pandas.read_hdf` unpickles object columns, so a file from an untrusted source could execute code when read. Only pass it for files you produced yourself; the CSV export is always safe.

**Keypoint-MoSeq** (`load_moseq(path, *, fs_video, t_offset_s=0.0, key=None,
names=None)`). A CSV with `syllable` and `frame_index` (or `frame`) columns, or
a `results.h5` with one `<recording>/syllable` dataset per recording; `key`
selects the recording. Frames without a syllable are `-1`; default names are
`syl00`, `syl01`, ....

## Per-cell metadata by loader

| loader | `cell_meta` columns |
| --- | --- |
| `load_minian` | `unit_id`; `centroid_x`, `centroid_y` if `A` is present |
| `load_caiman` | `snr`, `r_values`, `cnn_preds`, `accepted`, `centroid_x`, `centroid_y` (each if in the file) |
| `load_calab` | `alpha`, `baseline`, `pve`, `tau_rise_s`, `tau_decay_s` (each if available) |
| `detect_events` step | `noise_sd`, `event_threshold`, `n_events` |

`cell_qc_table(session)` (plus computed `fraction_finite`, `n_events`,
`mean_rate_hz`) shows them for choosing `select_cells` thresholds.

## A session folder with a config

When a recording is a folder of files (activity, two timestamp files, position, head
orientation, annotations) a YAML next to them says what is what, and one call builds the
`Session`:

```python
from cabana.loaders import load_session_dir, write_session_dir_template

write_session_dir_template("my_session")      # writes my_session/session.yaml, commented
ses = load_session_dir("my_session")          # folder holding session.yaml / config.yaml, or the yaml
```

The folder is searched for `session.yaml`, then `config.yaml`; every path inside is relative to
the YAML. The schema is the pydantic model `cabana.loaders.SessionDirConfig` (unknown keys are an
error, so typos surface). Example, the simulated three-chamber fixture
(`tests/data/simulated_3chamber/session.yaml`):

```yaml
name: sim3ch
neural:
  file: neural_deconvolved.npy        # .npy, or .npz plus `key:`
  orientation: cells_x_frames         # or frames_x_cells (transposed on load)
  kind: deconvolved                   # deconvolved | denoised | raw | dff | spike_counts | binary
  timestamps: neural_timestamps.csv   # Miniscope timeStamps.csv; or omit and give `fs: 30.0`
  cell_ids: null                      # or a list, or a text / .npy file
  alternatives: {denoised: neural_denoised.npy}   # other layers; load_session_dir(activity="denoised")
behavior:
  timestamps: behavior_timestamps.csv # camera clock, same zero as the neural clock
  clock: {offset_s: 0.0, scale: 1.0}  # optional: scale * (t - offset_s), see apply_clock
  position: {file: position.csv, frame_column: frame, columns: [x, y], missing_value: -1, units: cm, max_gap_s: 0.5}
  head_orientation: {file: headOrientation.csv, format: quaternion_wxyz, output: head_direction, offset_deg: 0}
  signals: {wheel: {file: wheel.csv, columns: [speed]}}     # extra tables, joined like position
  epochs:
    zones: {file: zone_annotations.csv, exclusive: true, merge_gap_s: 0.5, min_duration_s: 0.5}
    investigation: {file: investigation_annotations.csv, exclusive: false, merge_gap_s: 0.5, min_duration_s: 0.5}
arena:
  size: [60, 30]
  units: cm
  zones: {left: [0, 20], center: [20, 40], right: [40, 60]}  # [x0,y0,x1,y1], polygon, or x-range
  enclosures: {left_cup: {center: [0, 15], radius: 9, contents: stimulus}}   # or [cx, cy, r]
  dividers: {left: [20, 9, 30]}                              # recorded only
subjects: {focal: sim3ch, stimulus: {left_cup: stimulus_mouse, right_cup: null}}
```

What the loader does, in order:

1. Reads both timestamps files (`load_miniscope_timestamps` rules) and requires strictly
   increasing time; the neural frame count must equal the activity's frames (a wrong
   `orientation` shows up here). Without `neural.timestamps`, `t = arange(n) / fs`.
   `Session.fs` is `fs_mean` of the neural stamps. With no `behavior.timestamps` the position
   frame numbers index the neural frames.
2. Joins `position` (and each `signals` entry) to the behavior stamps by frame number
   (`load_position_csv`; the frame column must be a subset of the stamps' frame numbers), turns
   the `-1` sentinel into NaN, and applies `behavior.clock` to those times when given. Head
   orientation must have one row per neural frame. Epoch times are taken as already on the
   session clock (the clock is not applied to them). Epochs must stop at or after they start;
   the scored span is the neural time range.
3. With `resample=True` (default): resamples position and signals onto the neural frames
   (`resample_signal`, `max_gap_s`), writes `head_w/x/y/z` and `head_direction`
   (`head_direction(quaternion=...)`, with `offset_deg`) and, unless `euler: false`,
   `head_yaw/head_pitch/head_roll` (`head_orientation`, same offset on yaw), and turns each `epochs` entry into a
   `StateSpace` named by its key (`bouts_to_states` with that entry's cleanup). With
   `resample=False` only the raw inputs are put in `session.behavior`.

Where things are recorded:

| what | where |
|---|---|
| raw position, head quaternions, epoch tables | `session.behavior["position"]`, `["head"]`, `["<epochs key>_epochs"]` |
| x, y, extra columns, `head_*`, `head_direction` | `session.signals` (units in `meta["signal_units"]`) |
| epoch states | `session.states["zones"]`, `["investigation"]` (one per `epochs` key) |
| `timing_report` per clock | `meta["timing"]["neural"]`, `["behavior"]` (plus the behavior `clock`) |
| arena (x-range zones expanded to rects using `size`) | `meta["arena"]`, the layout `zone_occupancy(zones_from_meta=True)` reads |
| enclosures (`center`, `radius`, `contents`) | `meta["enclosures"]` (also in `meta["arena"]`), read by `investigation_from_geometry` |
| focal / stimulus animals | `meta["subjects"]`; `info.animal` (focal, else `name`), `info.session_id` (`name`), `info.extra["stimulus"]` |
| provenance | `meta["source"] == "session_dir"`, `meta["config_path"]`, `meta["neural_alternatives"]` |

`info=SessionInfo(...)` overrides the fields you set. Only one activity layer is loaded;
`activity="denoised"` loads that alternative instead. Every error names the config field and the
file (for example `behavior.position (position.csv): ... frame numbers ... are not in the
timestamps file`). Derived investigation without hand annotations:
`{"name": "investigation_from_geometry"}` reads `meta["enclosures"]` (see
`BRING_YOUR_OWN_DATA.md`).

## Caveats

- **Behavior times must be on the neural clock.** Get `t_offset_s` wrong and every
  state is shifted in time; the loaders cannot check it. Check it against an event you can see in both recordings.
- **Pass the scored span to `load_boris`.** Without `scored_span` the span defaults
  to the first start and last stop of the loaded bouts, with a warning, and time
  outside it is then treated as unscored rather than as absence of behavior.
- **BORIS POINT events** become zero-length bouts (`stop_s == start_s`), and
  `bouts_to_states` marks frames with `start <= t < stop`, so it ignores them. Use
  the bout starts directly (`bt.start_s`) for event-aligned work. A warning is
  issued when any exist.
- **Several BORIS subjects** are pooled by behavior name unless you pass
  `subject=` (with a warning).
- **Multi-animal DeepLabCut** files (four header rows) are not supported.
- **The `.camap` loader** was written against the `save_bundle` layout and tested
  only on synthetic bundles, not on bundles from a real CaMAP run. CaMAP binarises
  events inside its analysis; the loaded activity is the deconvolved amplitude, so
  use the `binarize` preprocess step to reproduce that.
- **`canonical.parquet` has gaps.** Frames outside behavior coverage are absent,
  so a `.camap` session's `t` may not be evenly spaced (the `fs` comes from
  `config.yaml`).

## A 15-line example

Neural data from CaImAn, behavior from DeepLabCut, BORIS and Keypoint-MoSeq,
all started 12.4 s before imaging:

```python
import cabana
from cabana import AnalysisSpec, Pipeline, ShuffleConfig, loaders

OFFSET = 12.4  # imaging started 12.4 s into the video (video time)
session = loaders.load_caiman("caiman.hdf5", activity="S", fs=15.0)
xy = loaders.dlc_centroid(
    loaders.load_dlc("dlc.csv", fs_video=30.0, t_offset_s=OFFSET, px_per_mm=2.5),
    ["nose", "tail"],
)
bouts = loaders.load_boris("boris.csv", t_offset_s=OFFSET, scored_span=(40 - OFFSET, 600 - OFFSET))
syllables = loaders.load_moseq("moseq.csv", fs_video=30.0, t_offset_s=OFFSET)
session.behavior.update(position=xy, social=bouts, syllables=syllables)

pipe = Pipeline(
    transforms=[{"name": "bouts_to_states", "source": "social", "output": "social"}],
    analyses=[AnalysisSpec(metric={"name": "auroc"}, states="social",
                           shuffle=ShuffleConfig(n_shuffles=500, correction="max_stat"))],
)
session, results = pipe.run(session)
```

Each loader's file name above is a placeholder; the example assumes a CaImAn
file with `estimates/S`, a DeepLabCut CSV with `nose` and
`tail`, a BORIS aggregated export and a MoSeq CSV. The snippet was run on small
synthetic versions of all four (the test file `tests/loaders/test_loaders.py` shows how
to build such files).

`session.behavior` holds raw behavior inputs on their own clocks; the pipeline's
`resample_signal`, `bouts_to_states` and `labels_to_states` transforms put them
on the neural clock and build the state spaces, as in
[`BRING_YOUR_OWN_DATA.md`](BRING_YOUR_OWN_DATA.md).
