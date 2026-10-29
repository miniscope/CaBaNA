# simulated_open_field

**Simulated.** A 10-minute open field session: 120 cells imaged at 30 Hz in a 40 x 40 cm arena, tracked at
30 Hz on a separate clock. Made by `../make_examples.py` (fixed seed). **The tracking is poor on purpose**, to
test the Data QC alerts.

| | |
|---|---|
| Cells | 120: 48 place cells, 18 speed cells, 12 border cells, the rest baseline. Four are very noisy. Three pairs of overlapping cells share signal (cells 1 and 2, 11 and 12, 21 and 22) |
| Calcium | rise 0.08 s, decay 0.5 s |
| Tracker problems | about 12.6% of frames lost (one 70 s dropout plus scattered frames), written as -1; five jumps to the other side of the arena |

## Files

| file | contents |
|---|---|
| `neural_raw.npy`, `neural_denoised.npy`, `neural_deconvolved.npy` | cells x frames (120 x 18000), float32. Denoised and deconvolved are estimated from the noisy trace, so they contain small false events, as real output does |
| `footprints.npy` | cells x height x width (120 x 160 x 160) |
| `neural_timestamps.csv`, `behavior_timestamps.csv` | Miniscope timestamp format |
| `position.csv` | `frame`, `x`, `y` in cm; -1 marks a lost frame |
| `zone_annotations.csv` | `label` (center, periphery), `start_s`, `stop_s` |
| `config.yaml` | arena and zones |
| `arena_frame.png`, `arena_video.mp4` | for the Arena step: a picture of the empty arena and a 12 s video of the animal in it, at 10 pixels per cm with a 40 pixel margin. The animal is 8 cm from nose to tail base. Arena corner (0, 0) is at the lower left, as in `position.csv` |
