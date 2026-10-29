# simulated_3chamber (test fixture)

The first 75 s of the lab's simulated three-chamber social task (180 cells, miniscope at
about 30 Hz, behavior camera at about 50 Hz on a separate clock). The full 300 s dataset is
by a lab member and lives on the remote branch `origin/samaramaxine-proposed-code-structure`
under `example_data/simulated_3chamber/` (its README describes the task, the arena and how
the data were simulated). This copy is cut by `scripts/slim_three_chamber.py`, which
reproduces it from the full folder:

- neural frames whose time stamp is at most 75 s (`neural_deconvolved.npy`, float32,
  cells x frames, and `neural_timestamps.csv`); `neural_raw.npy` and `neural_denoised.npy`
  are not included;
- behavior frames likewise (`behavior_timestamps.csv`, and the rows of `position.csv` with
  those frame numbers);
- `headOrientation.csv` rows up to 75 s;
- the two annotation files clipped to the first time stamp and 75 s;
- `config.yaml` unchanged.

Files and clocks:

| file | contents |
|---|---|
| `neural_timestamps.csv`, `behavior_timestamps.csv` | Miniscope `timeStamps.csv` format: `Frame Number`, `Time Stamp (ms)`, `Buffer Index`. Both are on one shared axis (ms since the recording started; the first stamp is slightly negative). |
| `position.csv` | `frame, x, y` in cm; `-1,-1` marks a lost frame (about 1%). No time column: join to `behavior_timestamps.csv` by frame number. |
| `headOrientation.csv` | `Time Stamp (ms), qw, qx, qy, qz`: the unit quaternion from the miniscope IMU, one row per miniscope frame (neural clock). Yaw about z, 0 = east, counter-clockwise. It holds quaternions, not pitch and yaw. |
| `zone_annotations.csv`, `investigation_annotations.csv` | `label, start_s, stop_s` on the shared axis, as a person would score them (epochs under 0.5 s dropped, gaps under 0.5 s merged). |
| `config.yaml` | arena (60 x 30 cm), zones on x, enclosures, dividers, head-orientation and investigation conventions. |

Load it with `cabana.loaders` (`load_miniscope_timestamps`, `load_position_csv`,
`load_head_orientation`, `load_epochs_csv`); `tests/test_three_chamber.py` is the worked
example. Treat the files as read-only.
