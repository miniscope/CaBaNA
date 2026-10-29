# simulated_frame_labels

**Simulated.** A 5-minute open-field session with behavior scored per camera frame in one file. 40 cells imaged
at 30 Hz, camera at 20 Hz. Made by `../make_examples.py new` (fixed seed). **The labels disagree and some
frames are missing on purpose**, to test the frame-label import.

| | |
|---|---|
| Cells | 40: 10 respond to grooming, 10 to rearing, the rest baseline. Two are very noisy |
| Disagreements | 5 frames where the binary `grooming` column contradicts `behavior == "grooming"`: frames 1242, 2740, 2971, 3526, 5596 |
| One source only | frames with no `behavior` value have a blank `rearing` and `grooming` = 0, so they are not conflicts |
| Missing frames | 98 of the 6000 camera frames are not in the file (two stretches plus single frames); they are unscored |

## Files

| file | contents |
|---|---|
| `neural_raw.npy`, `neural_deconvolved.npy` | cells x frames (40 x 9000), float32 |
| `neural_timestamps.csv`, `behavior_timestamps.csv` | Miniscope timestamp format |
| `frame_labels.csv` | `frame`, `x`, `y` (cm), `grooming` and `rearing` (0/1, blank = missing), `behavior` (text: grooming, rearing, blank = unlabeled) |
| `config.yaml` | session settings; the file also serves as the position file |

The framework does not read frame labels yet, so `config.yaml` lists the file only as position. Load it
through the GUI's frame-labels slot.
