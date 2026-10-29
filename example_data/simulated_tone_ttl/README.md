# simulated_tone_ttl

**Simulated.** A 5-minute fear-conditioning-like session: 40 cells imaged at 30 Hz, six 20 s tones and a
shock at the end of the last three tones. Tones and shocks are time markers (as from a TTL log); freezing
is annotated as epochs. Camera at 20 Hz. Made by `../make_examples.py new` (fixed seed).

| | |
|---|---|
| Cells | 40: 8 respond to tone onset, 6 to the shock, 10 to freezing, the rest baseline. Two are very noisy |
| Calcium | rise 0.05 s, decay 0.3 s |
| Tones | onsets at 40, 80, 120, 160, 200, 240 s |
| Shocks | 1 s before the end of tones 4 to 6 (179, 219, 259 s) |
| Marker outside the recording | one `tone` at 315 s, after the session ends, on purpose |

## Files

| file | contents |
|---|---|
| `neural_raw.npy`, `neural_deconvolved.npy` | cells x frames (40 x 9000), float32 |
| `neural_timestamps.csv`, `behavior_timestamps.csv` | Miniscope timestamp format |
| `time_markers.csv` | `label` (tone, shock), `time_s` on the session clock |
| `behavior_annotations.csv` | `label` (freezing), `start_s`, `stop_s` |
| `config.yaml` | session settings |

`time_markers.csv` is not listed in `config.yaml`: the framework rejects a `markers:` key until it supports
time markers. Load it through the GUI's time-markers slot.
