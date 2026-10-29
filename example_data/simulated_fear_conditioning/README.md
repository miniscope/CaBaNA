# simulated_fear_conditioning

**Simulated.** A 15-minute fear conditioning session: 80 cells imaged at 30 Hz with five 30 s tones, a 2 s
shock at the end of tones 3 to 5, and freezing annotated as epochs. Camera at 20 Hz. Made by
`../make_examples.py` (fixed seed). **Several files are missing on purpose**, to test how CaBaNA copes: there is
no position file, no footprints and no denoised traces.

| | |
|---|---|
| Cells | 80: 15 respond to the tone, 10 to the shock, 20 to freezing, the rest baseline. Three are very noisy |
| Calcium | rise 0.05 s, decay 0.3 s (jGCaMP8f-like) |
| Freezing | more likely during tones and for a minute afterwards |

## Files

| file | contents |
|---|---|
| `neural_raw.npy`, `neural_deconvolved.npy` | cells x frames (80 x 27000), float32 |
| `neural_timestamps.csv`, `behavior_timestamps.csv` | Miniscope timestamp format |
| `behavior_annotations.csv` | `label` (cs, us, freezing), `start_s`, `stop_s`. Freezing overlaps the tones, which is expected |
| `config.yaml` | session settings |
