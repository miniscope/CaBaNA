# simulated_3chamber

**Simulated.** A 5-minute three-chamber social task: 180 cells imaged at 30 Hz
while an animal moves between the left, center and right chambers, tracked at 50 Hz.
The arena has a half-disc enclosure against each end wall. A stimulus animal is in the
left enclosure and the right enclosure is empty. The subject cannot enter either one.
Two walls divide the arena into three chambers. Each wall stops short of an arena wall,
so the subject goes around its end through the doorway to reach the next chamber. The
subject's speed is at most 14.5 cm/s. Investigation means the animal is within 4 cm of an
enclosure with its head pointing at it. It is annotated separately for the stimulus
animal and for the empty enclosure.

| | |
|---|---|
| Duration | 300 s |
| Cells | 180: 20 respond to investigating the stimulus animal, 10 to investigating the empty enclosure, 25 are place cells, 125 fire at baseline (which cells is not recorded) |
| Miniscope | 30 Hz |
| Behavior camera | 50 Hz, a separate clock from the miniscope |
| Arena | 60 x 30 cm; zones on x: left 0-20, center 20-40, right 40-60 |
| Enclosures | half-discs of radius 9 cm centered on the end walls at y = 15. The subject cannot enter them |
| Dividers | walls at x = 20 and x = 40. The left wall covers y 9-30, so its doorway is at the bottom. The right wall covers y 0-21, so its doorway is at the top |
| Movement | mean speed about 5.5 cm/s, never above 14.5. It moves in stop-and-go bouts along curved paths. The animal visits about 83% of the open 2 cm bins (each for at least 0.1 s) |
| Investigation | stimulus animal about 19% of the session, empty enclosure about 8%, in epochs of a few seconds |
| Tracker dropouts | about 1% of behavior frames, written as -1 |
| Made by | a script that is not part of this repository, with a fixed random seed (`footprints.npy` by `make_footprints.py`, also fixed seed) |

## Files

These are the inputs to the pipeline. They are what a user would bring: tracked
position from tracking software, head orientation from the miniscope, and annotations from a person
or annotation tool.

**Time**

Both timestamps files use one shared time axis: milliseconds since the recording started. Like a real
session, each file's first frame is a few ms before zero (about -22 ms for the miniscope, -18 ms
for the camera) and `Buffer Index` is 0. The frame number and the time stamp in each row are the
only link between frames and times; annotation times are compared against them directly.

**Neural**

| file | contents |
|---|---|
| `neural_raw.npy` | raw fluorescence, cells x frames (180 x 9000), float32 |
| `neural_denoised.npy` | denoised calcium trace, same shape |
| `neural_deconvolved.npy` | deconvolved event estimate, same shape |
| `neural_timestamps.csv` | one row per miniscope frame, in the Miniscope `timeStamps.csv` format: `Frame Number`, `Time Stamp (ms)`, `Buffer Index` |
| `footprints.npy` | cell footprints, cells x height x width (180 x 160 x 160), float32. Made by `make_footprints.py`: random positions kept apart, unrelated to the traces, with three pairs deliberately overlapping |

The three neural files hold the same simulated cells at three stages of processing.
Load one at a time and say which `neural_type` it is.

**Head orientation** (from the miniscope IMU, on the neural clock)

| file | contents |
|---|---|
| `headOrientation.csv` | Miniscope V4 BNO format: `Time Stamp (ms)`, then the unit quaternion `qw`, `qx`, `qy`, `qz`. One row per miniscope frame, same timestamps as `neural_timestamps.csv`. No dropouts. |

Head orientation is not stored as an angle. It is the yaw of the quaternion (rotation about
the vertical axis; 0 = east, counterclockwise). Pitch and roll vary a little.

**Behavior, tracked** (one row per behavior-camera frame)

| file | contents |
|---|---|
| `behavior_timestamps.csv` | same format, for the behavior camera |
| `position.csv` | `frame`, `x`, `y` in cm. -1 marks a lost frame. `frame` matches `Frame Number` in `behavior_timestamps.csv`. |

`position.csv` has no time column; times come from the timestamps file.

**Behavior, annotated** (epochs with a start and a stop time, in seconds)

| file | contents |
|---|---|
| `zone_annotations.csv` | `label` (left, center, right), `start_s`, `stop_s`: each stretch in a zone |
| `investigation_annotations.csv` | `label` (`investigate_stimulus` or `investigate_empty`), `start_s`, `stop_s`: each stretch of investigating the stimulus animal or the empty enclosure |

The annotations are made from the true behavior, not from the tracker output, and
epochs shorter than 0.5 s are dropped and gaps under 0.5 s are merged, as a person
annotating would. They will not exactly match what you derive from `position.csv` and
`headOrientation.csv`.

**Settings**

| file | contents |
|---|---|
| `config.yaml` | arena size, zone boundaries, enclosure and divider positions, what each enclosure holds, head orientation convention |

## Epochs and frame labels

The annotation files are epochs (a start and a stop). They are made ahead of time, the
way a user would bring them, so the pipeline does not work out zones or investigation
from position and head orientation. It converts the epochs to frame labels (one yes/no
per behavior frame) and back again, so a round trip should return the same epochs.
Position and head orientation are continuous variables, used for speed, place cells
and head orientation tuning.
