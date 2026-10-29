# simulated_clock_drift

**Simulated.** A 5-minute open-field session where the behavior camera's clock is wrong: it is offset by
0.35 s and runs 0.04% off. 40 cells imaged at 30 Hz, camera at 30 Hz. Made by `../make_examples.py new`
(fixed seed). Without the clock correction, place fields are blurred and shifted.

| | |
|---|---|
| Cells | 40: 24 place cells, the rest baseline. Two are very noisy |
| Clock | `behavior.clock: {offset_s: 0.35, scale: 1.0004}`, meaning neural time = scale * (camera time - offset_s) |

## Files

| file | contents |
|---|---|
| `neural_raw.npy`, `neural_deconvolved.npy` | cells x frames (40 x 9000), float32 |
| `neural_timestamps.csv` | Miniscope timestamp format |
| `behavior_timestamps.csv` | camera timestamps on the camera's own clock, uncorrected |
| `position.csv` | `frame`, `x`, `y` in cm |
| `config.yaml` | session settings, including the clock |
