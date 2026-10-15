# CaBaNA

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

**Ca**lcium **B**ehavioral **a**nd **N**eural **A**nalysis. How neural activity relates
to behavior.

CaBaNA is a tool for analyzing how neural activity relates to behavior. It takes extracted calcium traces and behavioral data from the same recording session and helps identify which neurons, and which patterns of activity across neurons, are associated with different behaviors.


## Proposed code structure

This is a starting point for how CaBaNA's code could be organized, how the different parts work together, and how new analyses can be added over time. 

The code has three levels:

- **Shared data.** A `Session` holds the neural data and a behavior table, aligned in time. Analyses work from this one structure and read the columns they need.
- **Reusable functions.** `structuring.py`, `processing.py` and `stats.py` hold operations that more than one analysis needs.
- **Analyses.** `analysis.py` combines those operations to answer specific questions about neural activity and behavior.

Common operations are kept separate from the analyses, so the same function is reused and not rewritten for each analysis. The main design choice is what is reusable and what belongs to one analysis. The five files are one way to organize that choice.

```
input files -> io -> structuring -> processing -> analysis -> results
                                                      ^
                                   stats (calculations that analyses share)
```

| file | purpose |
|---|---|
| `io.py` | load and check input data |
| `structuring.py` | organize and align data, convert between data formats, and select frames or time windows |
| `processing.py` | process data: smoothing, normalization, speed calculation, baseline correction |
| `stats.py` | shared calculations used across analyses: shuffling, p-values, AUC, occupancy |
| `analysis.py` | run analyses such as ROC, place cells, PETH and PCA, using functions from the other files |
| `session.py` | the `Session` class that holds the aligned data |

### Development approach

- Each analysis combines reusable functions to select and group data, then calculate statistics for individual neurons or neural populations.
- Functions are developed one at a time, with the code reviewed line by line and guided by established methods in the literature.
- Planned functions are outlined in each file's docstring before implementation, along with references to existing code and relevant publications. Example GitHub repositories are included as starting points, and additional references are welcome.

Written so far: `Session`, `io.load_timestamps` and `structuring.epochs_from_frame_labels`, each with tests. Every other function is a planned entry in its file's docstring. `example_data/` holds a simulated session in the form of real input files, so the functions can be run on realistic inputs as they are written.

## Install

```bash
git clone https://github.com/miniscope/CaBaNA.git
cd CaBaNA
uv venv --python 3.12
uv pip install -e ".[all]"
```

Run the tests with `.venv/bin/pytest`.

## Inputs

<!-- TODO: describe the input contract -->

- **Neural data**: extracted calcium traces (cells × frames), plus a neural timestamps file with one time per frame.
- **Behavioral data, tracked**: position from tracking software, one row per camera frame, plus a separate behavior timestamps file. The position file has a `frame` column that matches the timestamps file, and no time column.
- **Head orientation**: the Miniscope's `headOrientation.csv` (quaternions with a time stamp, one row per miniscope frame, on the neural clock).
- **Behavioral data, annotated**: epochs with a start and stop time (when the animal was in a zone, when it was investigating). The pipeline assumes these are already done; it does not work out zones from position.

Each clock has its own timestamps file, with a frame column and a time column (the Miniscope `timeStamps.csv` format). Annotations are always a start and a stop time in seconds. Neural and behavior are recorded at different
rates and are lined up later, in `cabana.structuring`.

## What the pipeline holds

A `Session` keeps the loaded data on one clock: the neural data, and a `behavior` table with one row per neural frame. The table holds whatever the analyses need, as columns: continuous measurements (x, y, speed, head orientation) and frame labels (zone, investigation, spatial bin). Analyses read the columns they use.

## Files

| file | what it is |
|---|---|
| `cabana/session.py` | `Session`, the aligned recording every analysis takes as input |
| `cabana/io.py` | read input files and validate them |
| `cabana/structuring.py` | change the form of the data: align, convert between epochs, frame labels and continuous variables, select frames, cut windows |
| `cabana/processing.py` | change the values: smoothing, z-score, speed, baseline correction |
| `cabana/stats.py` | array-level tools shared by all analyses: shuffles, p-values, AUC, occupancy, spatial information |
| `cabana/analysis.py` | one function per analysis (ROC, place cells, PETH, PCA) that composes the other modules |
| `example_data/` | small example datasets as plain input files, each with its own README |
| `tests/` | pytest tests |
| `LICENSE` | AGPL-3.0 |


## License

[AGPL-3.0](LICENSE).
