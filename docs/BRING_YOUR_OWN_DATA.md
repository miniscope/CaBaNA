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
For a folder of files described by a YAML, `load_session_dir` builds the whole `Session` in one call.
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

### Two clocks and dropped frames

The miniscope and the behavior camera are separate recorders. First find out how
their clocks relate, then check each for dropped frames, then resample.

```python
from cabana import loaders

t_n = loaders.load_miniscope_timestamps("neural_timestamps.csv")      # seconds
t_b = loaders.load_miniscope_timestamps("behavior_timestamps.csv")
report = loaders.timing_report(t_n, 30.0)      # n_dropped_frames, gaps, jitter, fs_mean
print(report, loaders.timing_report(t_b, 50.0))

# 1. Same acquisition system, shared axis: use the stamps as they are.
# 2. Video clock starting elsewhere, one known offset: t_neural = t_video - t_offset_s.
# 3. Two free-running clocks: fit offset and drift from paired sync events.
offset_s, scale = loaders.fit_clock(led_times_video, led_times_neural)
t_b = loaders.apply_clock(t_b, offset_s, scale)

t_pos, xy = loaders.load_position_csv("position.csv", timestamps=t_b)   # -1 -> NaN
position = ContinuousSignal(t=t_pos, values=xy, channel_names=["x", "y"], units="cm")
session = Session(activity=act, t=t_n, fs=report["fs_mean"], behavior={"position": position})

transforms = [
    {"name": "resample_signal", "source": "position", "max_gap_s": 0.5},  # no bridging
    {"name": "interpolate_gaps", "signal": ["x", "y"], "max_gap_s": 0.5},
]
preprocess = [
    {"name": "timing_check"},                         # meta["timing"], warns on drops
    {"name": "trim_to_overlap", "signals": ["position"]},   # contiguous covered span
]
```

(`transforms` run before `preprocess` in a `Pipeline`, so the steps above see the
resampled signals.) Why each step: dropped neural frames make `Session.t` irregular, but metrics,
shuffles and rebinning treat frames as evenly spaced, so a few missing frames
are tolerable (`timing_check` warns above 1%) and many are not. A behavior gap
longer than `max_gap_s` should stay NaN rather than be interpolated into a
straight line across the animal's missing path. `trim_to_overlap` keeps the
longest contiguous stretch covered by every behavior input. When you need a
different rate, `Session.rebin` (integer ratios) is exact; the `resample` step
(`fs_target`) handles non-integer ratios by interpolation and warns that it is
approximate.

## 2. Build the raw inputs

The first block stands in for your loaders. Replace it with your own reading
code; the names `act`, `t`, `bouts_df`, `xy_t`, `xy` and so on are what you
need to produce.

```python
from pathlib import Path

import numpy as np

import cabana
from cabana import BoutTable, ContinuousSignal, LabelSeries, Session, SessionInfo

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
                cell_ids=[f"{prefix}_c{i:03d}" for i in range(n_cells)],
                snr=rng.gamma(4.0, 1.0, n_cells))
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
        activity_kind="deconvolved",  # or "dff", "spike_counts", "binary", "raw", "denoised", "zscored"
        cell_ids=d["cell_ids"],
        behavior={"social": bouts, "position": position, "partner_dist": distance,
                  "syllables": syllables},
        meta={},
        info=SessionInfo(animal=animal, date="2026-03-14", condition="social", group="control"),
        # optional per-cell columns (length n_cells; numeric, bool or string)
        cell_meta={"snr": d["snr"], "accepted": d["snr"] > 3.0},
        # footprints=d["footprints"],  # optional dense (n_cells, H, W); downsample large fields
    )


session = make_session(load_session(0))
print(cabana.__version__, session.activity.shape)
```

Notes on the inputs:

- **`info` and `cell_meta`**: `SessionInfo` holds animal, date (ISO), condition,
  group, sex, genotype, rig and `session_id`; `SessionSet.from_sessions` reads
  `animal` from it. `cell_meta` columns (`snr`, `r_values`, `cnn_preds`,
  `accepted`, `pve`, `alpha`, `baseline`, `tau_*_s`, `centroid_x/y`, ...) travel
  with the cells: `session.cell_table()` shows them and
  `session.select_cells(mask_or_ids)` subsets cells, metadata and footprints
  together. `select_frames(...)` does the same for time.

- **`activity_kind`** tells CaBaNA how to re-bin and is recorded with every
  result. Event-like kinds (`deconvolved`, `spike_counts`, `binary`) are
  **summed** per bin, so a re-binned `binary` or event-onset series becomes an
  event count; trace-like kinds (`raw`, `denoised`, `dff`, `zscored`) are
  **averaged**. A `Session` warns if an event-like kind contains negative
  values, which usually means you passed dF/F or z-scored traces under the
  wrong label. Minian `C` and CaImAn `C` load as `denoised` (a smoothed
  fluorescence trace, not spikes and not dF/F).
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

### Behaviour recipes

Cleaning tracking, then using it. Positions are named by a prefix: `nose` means
the signals `nose_x`, `nose_y` (what `load_dlc` and `resample_signal` produce);
`""` means plain `x`, `y` (what `dlc_centroid` produces).

```python
transforms = [
    {"name": "resample_signal", "source": "dlc"},   # nose_x, nose_y, nose_likelihood, ...
    # 1. fill dropouts up to 0.5 s (longer ones stay NaN and drop out of the support)
    {"name": "interpolate_gaps", "signal": ["nose", "neck"], "max_gap_s": 0.5},
    # 2. NaN-aware median over 0.25 s (robust to tracking jumps)
    {"name": "smooth_signal", "signal": ["nose", "neck"], "method": "median", "window_s": 0.25},
    # 3. then speed (use one centroid, or smooth x and y first)
    {"name": "speed", "signals": ["neck_x", "neck_y"]},
    # head direction: 0 = +x, counter-clockwise, (-pi, pi]
    {"name": "head_direction", "front": "nose", "back": "neck", "units": "deg"},
    # distance to a partner (prefix mouse2_neck) or to a fixed point (a cup)
    {"name": "distance", "a": "neck", "b": "mouse2_neck", "output": "partner_dist"},
    {"name": "distance", "a": "neck", "point": [120.0, 40.0], "output": "cup_dist"},
]
preprocess = [  # keep only confident, nearby frames
    {"name": "mask_from_signal", "signal": "nose_likelihood", "min": 0.9, "output": "tracked"},
    {"name": "mask_from_signal", "signal": "partner_dist", "max": 50.0, "output": "close"},
]
```

Calibrate pixels first with `arena_transform` (`scale` as 1/px_per_mm, or four
`corners_px` with matching `corners_mm` for a homography that also removes
perspective). A three-chamber test becomes states with `zone_occupancy`:

```python
{"name": "arena_transform", "signals": ["neck"],
 "corners_px": [[100, 80], [520, 95], [500, 410], [90, 400]],
 "corners_mm": [[0, 0], [600, 0], [600, 200], [0, 200]]},
{"name": "zone_occupancy", "signal": "neck", "output": "chamber",
 "zones_rect": {"left": [0, 0, 200, 200], "middle": [200, 0, 400, 200],
                "right": [400, 0, 600, 200]}},
```

Frames in no chamber are "defined but in no state"; frames with a lost
position are outside the support. Zones may be polygons (`zones`) and may be
read from `session.meta["arena"]["zones"]` with `zones_from_meta=True`.
Miniscope V4 BNO orientation: `{"name": "head_direction", "quaternion": "imu",
"offset_deg": calib}` (w, x, y, z order; the zero is arbitrary until you
calibrate with `offset_deg`).

Bout cleanup (lab convention: merge gaps shorter than 0.5 s, then drop epochs
shorter than 0.5 s): `{"name": "bouts_to_states", "source": "social",
"merge_gap_s": 0.5, "min_duration_s": 0.5}`; BORIS POINT events become
windows with `point_event_window_s`. `min_gap_s` is the older rule that drops
the later bout; prefer `merge_gap_s`. For syllables,
`labels_to_states(mode_filter_s=0.2, min_run_s=0.1)` votes away single-frame
flicker. `cabana.states_to_bouts(states, fs, merge_gap_s=..., min_duration_s=...)`
turns any state space back into a `BoutTable` for export.

### Social behaviour vocabulary

How a lab's words map onto the framework (`load_session_dir` does most of it from one config,
see [`LOADERS.md`](LOADERS.md#a-session-folder-with-a-config)):

| lab term | framework |
|---|---|
| zone / chamber (left, centre, right) | arena zones in `meta["arena"]["zones"]`; `zone_occupancy` makes a categorical `StateSpace` from position, an annotated zone file makes one through `bouts_to_states(exclusive=True)` |
| investigation, epoch, frame labels (`label, start_s, stop_s`) | a `BoutTable` (`load_epochs_csv`) turned into a boolean `StateSpace` by `bouts_to_states`; `states_to_bouts` goes back |
| derived investigation | `investigation_from_geometry`: within `max_distance` of an enclosure edge and heading within `max_angle_deg` of it; one state per enclosure |
| cup / enclosure | `meta["enclosures"]` (`center`, `radius`, `contents`); distance is measured to its edge |
| stimulus animal, focal animal | `meta["subjects"]` and `info` (`animal` = focal, `extra["stimulus"]`) |
| "frames x cells" | activity is cells x time: `orientation: frames_x_cells` transposes on load |
| `-1` for a lost position | NaN (`missing_value: -1`); lost frames are outside the state support |
| frame number | an index, not a time: join to the timestamps file by frame number |

Investigation from geometry (the lab's annotation rule, "within 4 cm of an enclosure, head
within 45 degrees"):

```python
ses = build("transform", {"name": "investigation_from_geometry", "max_distance": 4.0,
                          "max_angle_deg": 45.0, "output": "investigation_geo"}).apply(ses)
```

Heading uses the `head_direction` convention (0 = +x, counter-clockwise); calibrate a
quaternion's arbitrary zero with `head_direction(offset_deg=...)` first. On the simulated
three-chamber slice it agrees with the annotations on 99.9 to 100 % of frames and finds every
annotated bout within 0.5 s (zero offset needed).

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

### Activity conditioning

Steps that change `activity` set the kind to what the output really is. All
propagate NaN frames (never zero-fill). Typical dF/F pipeline:

```python
preprocess = [
    {"name": "compute_dff", "baseline": "rolling_percentile", "percentile": 8, "window_s": 60},  # raw/denoised -> dff
    {"name": "detrend", "method": "highpass", "cutoff_hz": 0.01},   # optional; refused on event kinds
    {"name": "bandpass_activity", "high_hz": 5.0},                   # zero-phase Butterworth
    {"name": "detect_events", "k": 3.0, "noise": "diff_mad",         # -> kind "binary"
     "min_duration_s": 0.1, "refractory_s": 0.2, "output": "onsets"},
]
```

- `compute_dff`: `(F - F0) / max(F0, eps)`; `F0` from `percentile` (one value
  per cell), `mean`, or `rolling_percentile` / `rolling_min` over `window_s`
  (also removes bleaching). Needs `raw` or `denoised` input (`force=True` to
  override). The 8th percentile and 60 s window are conventions, not derived.
- `detect_events`: threshold `= median + k * noise` per cell, where `noise` is
  the MAD of first differences / sqrt(2) (`diff_mad`, default), `mad` or `psd`.
  `output="binary"` marks frames in an event, `"onsets"` only the first frame
  of each event (re-binning gives counts), `"amplitude"` keeps the trace value
  inside events and labels it `deconvolved`. Per-cell noise and threshold are
  recorded in `session.meta["detect_events"]`. Use `refractory_s` to stop noise
  re-crossing during a transient's decay from counting as new events.
- `clip_activity` (`min=0` default) removes negative values from deconvolved or
  dF/F traces before metrics that need non-negative input; it biases noisy
  dF/F upward, so prefer `detect_events` for dF/F.
- `zscore_activity(by="cell"|"global", mask_names=[...], baseline_window_s=(t0, t1))`:
  with `mask_names=None` the statistics use all masks present, so the result
  depends on step order; name the masks explicitly. The previous kind is kept in
  `meta["zscore_source_kind"]`.
- `binarize_activity` (one absolute threshold, kind becomes `binary`) is
  deprecated in favour of `detect_events`.

### Cell QC

Loaders fill `Session.cell_meta` (SNR, `accepted`, alpha, ...; see LOADERS.md).
Look before choosing thresholds, then drop cells with the `select_cells` step:

```python
import cabana

# DataFrame: cell_meta plus fraction_finite, n_events, mean_rate_hz
print(cabana.cell_qc_table(session).describe())

preprocess = [
    {"name": "select_cells", "require": ["accepted"], "min_snr": 3.0,
     "min_events": 10, "min_fraction_finite": 0.9, "keep_at_least": 5},
    ...
]
```

A criterion whose column is missing is skipped with a warning (it does not pass
everything silently). The dropped ids and the step's parameters are in
`meta["cell_selection"]`, and `provenance["n_cells"]` shows the effect. `n_events`
and `mean_rate_hz` are computed for `binary`, `deconvolved` and `spike_counts`
activity only (over finite frames inside the masks); run `detect_events` first for
traces. CaLab `alpha` rescales each cell's deconvolved amplitudes, so do not rank
cells by raw amplitude: use binary or z-scored activity, or divide by alpha.

### Building masks

Four preprocess steps write named masks (each records its parameters in
`session.meta["mask_info"]`); list the result in `masks=[...]`.

```python
preprocess = [
    {"name": "speed_threshold", "min_speed": 20.0},                    # masks["speed"]
    # Recipe 1: exclude a behaviour (frames outside the scored span stay False)
    {"name": "mask_from_state", "states": "social", "include": ["sniff"],
     "invert": True, "output": "no_sniff"},
    # Recipe 2: require speed AND not grooming
    {"name": "mask_from_state", "states": "social", "include": ["groom"],
     "invert": True, "output": "not_grooming"},
    {"name": "combine_masks", "expr": "speed & not_grooming", "output": "moving_ok"},
    # Recipe 3: clean a jittery mask (fill gaps < 0.5 s, then drop runs < 1 s)
    {"name": "clean_mask", "mask": "moving_ok", "min_false_s": 0.5, "min_true_s": 1.0},
    # Any signal: close to the partner, or confident DLC tracking
    {"name": "mask_from_signal", "signal": "partner_dist", "max": 50.0, "output": "close"},
]
```

- `mask_from_state`: `include=None` means any state is active. With
  `require_support=True` (default) the result is ANDed with the state space's
  support, so unscored frames are False even when `invert=True`; set it False
  to let inverted masks include them.
- `combine_masks` expressions use mask names, `~` (not), `&`, `|` and
  parentheses; `~` binds tightest, then `&`, then `|`. Unknown names raise.
- `clean_mask` applies, in order: fill interior False gaps shorter than
  `min_false_s`, drop True runs shorter than `min_true_s`, erode by `erode_s`,
  dilate by `dilate_s` (durations round to whole frames). `output=None`
  overwrites the input mask.
- `mask_from_signal`: inclusive `min`/`max`, `nan_is` sets NaN frames
  (default False), `channel` picks a column of a 2-D signal.

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

## 12. Your own metric, null, transform or step

Every stage is a registered plugin: a pydantic class with a `name`, `@register(kind)`
and one method to implement (`compute`, `surrogate`, `apply` or `select`). See
[`PLUGINS.md`](PLUGINS.md) for the contract, one tested example per kind (including
a metric with the fast circular-shift path) and `cabana.check_plugin`, which checks
a plugin before you trust its numbers.

## Where to go next

- [`PLUGINS.md`](PLUGINS.md) to write your own plugins; [`DESIGN.md`](DESIGN.md) for how the pieces fit, [`GLOSSARY.md`](GLOSSARY.md)
  for terms, [`STATISTICS.md`](STATISTICS.md) for choosing a null.
- `examples/demo.py` and `notebooks/cabana_demo.ipynb` for plots, decoders,
  population analyses and the GLM.
