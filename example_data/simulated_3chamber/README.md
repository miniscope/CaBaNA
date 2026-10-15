# simulated_3chamber

**Simulated data** from a 5-minute three-chamber social task, with calcium activity from 180 neurons recorded at 30 Hz and animal tracking at 50 Hz.

The arena is divided into left, center, and right chambers by two walls, with openings at the ends that allow the animal to move between chambers. Each end chamber contains a half-circle enclosure against the outer wall. The left enclosure contains a stimulus animal, while the right is empty. The subject can explore all three chambers but cannot enter the enclosures.


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
| Made by | a script that is not part of this repository, with a fixed random seed |

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

The three neural files hold the same simulated cells at three stages of processing.
Load one at a time and say which `neural_type` it is.

**Head orientation** (from the miniscope IMU, on the neural clock)

| file | contents |
|---|---|
| `headOrientation.csv` | Miniscope V4 BNO format: `Time Stamp (ms)`, then the unit quaternion `qw`, `qx`, `qy`, `qz`. One row per miniscope frame, same timestamps as `neural_timestamps.csv`. No dropouts. |

Head orientation is stored as raw, pitch and yaw (Miniscope V4). 

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

The annotations here are assumed to be made from manual annotations by a reseacher,  not from the tracker output, and
epochs shorter than 0.5 s are dropped and gaps under 0.5 s are merged, as a person
annotating would. 

**Settings**

| file | contents |
|---|---|
| `config.yaml` | arena size, zone boundaries, enclosure and divider positions, what each enclosure holds, head orientation convention |

## Epochs and frame labels

Behavioral annotations are provided as epochs (start and stop times), as they would be in a real dataset. The pipeline does not currently calculate zones or investigation from position and head orientation. Instead, it converts the epochs into frame labels (True/False for each behavioral frame) and back. Converting in both directions should recover the original epochs.

Position and head orientation are stored as continuous variables and used for analyses such as speed, place cells, and head direction tuning.

We might consider supporting functions within CaBaNA that generate behavioral epochs directly from position and head orientation data.
