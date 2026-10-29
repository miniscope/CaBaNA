# CaBaNA

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

**Ca**lcium **B**ehavioral **a**nd **N**eural **A**nalysis. How neural activity relates
to behavior.

An analysis pipeline for the Miniscope workshop. It takes extracted calcium traces and
behavioral data from the same session and asks which neurons, and which patterns of
neural population activity, go with which behaviors.

Early development. Nothing here is stable yet.

## GUI

`gui/` holds a browser interface for CaBaNA: load data, set up the experiment, check data
quality, preprocess, and run the place-cell and auROC analyses. See [gui/README.md](gui/README.md)
for how to run it and what is built.

## Example data

`example_data/` holds four simulated sessions, each with its own README and generator
scripts. They contain problems on purpose, for testing QC and corrections. The GUI loads
them as example data.

## Related

- [workshop-processing-and-analysis](https://github.com/miniscope/workshop-processing-and-analysis):
  the Miniscope workshop pipeline that produces the extracted traces.

## License

[AGPL-3.0](LICENSE).
