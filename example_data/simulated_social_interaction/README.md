# simulated_social_interaction

**Simulated.** A 10-minute direct interaction: 150 cells imaged at 30 Hz while the subject and a partner move
in a 50 x 50 cm arena, tracked at 25 Hz (subject only). Social behaviors are annotated as epochs. Made by
`../make_examples.py` (fixed seed). **The annotations contain three mistakes on purpose**, to test the Data QC
alerts.

| | |
|---|---|
| Cells | 150: 25 respond to face sniffing, 20 to anogenital sniffing, 12 to following, 20 are speed cells, the rest baseline. Six are very noisy. Three overlapping pairs share signal (cells 3 and 4, 41 and 42, 81 and 82) |
| Calcium | rise 0.15 s, decay 1.0 s (GCaMP6s-like) |
| Annotations | sniff_face, sniff_anogenital (within 6 cm), follow (within 12 cm, both faster than 8 cm/s) |
| Annotation mistakes | two sniff_face epochs overlap; one follow epoch ends 5 s after the session; one sniff_anogenital epoch lasts 20 ms |
| Tracker problems | about 1% of frames lost (-1) |

## Files

| file | contents |
|---|---|
| `neural_raw.npy`, `neural_denoised.npy`, `neural_deconvolved.npy` | cells x frames (150 x 18000), float32 |
| `footprints.npy` | cells x height x width (150 x 160 x 160) |
| `neural_timestamps.csv`, `behavior_timestamps.csv` | Miniscope timestamp format |
| `position.csv` | subject `frame`, `x`, `y` in cm; -1 marks a lost frame |
| `social_annotations.csv` | `label`, `start_s`, `stop_s` |
| `config.yaml` | arena |
| `arena_frame.png`, `arena_video.mp4` | for the Arena step: a picture of the empty arena and a 12 s video of the animal in it, at 10 pixels per cm with a 40 pixel margin. The animal is 8 cm from nose to tail base. Arena corner (0, 0) is at the lower left, as in `position.csv` |
