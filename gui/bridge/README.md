# cabana-bridge

A local server that runs the CaBaNA framework for the GUI. The GUI sends session files and a
pipeline; the bridge runs `cabana run` (the same command as the CLI), keeps the results, and
serves arrays, tables and the framework's own figures. It contains no analysis code.

## Start

```bash
uv run --project gui/bridge cabana-bridge --project-dir gui/.project-dev --port 8765
```

It prints the URL to open the GUI with (`?bridge=http://127.0.0.1:8765&bridge_secret=...`).
`--project-dir` is required: inputs, sessions, runs and `project.json` live there. The framework
is pinned to a commit in `pyproject.toml`. To use a local checkout instead:

```bash
uv run --project gui/bridge --with-editable "$CABANA_FRAMEWORK_PATH" cabana-bridge --project-dir gui/.project-dev
```

The repository root also has a package named `cabana`. The bridge needs the framework's, so it
checks at startup that `cabana.recipe_pipeline` exists and exits with an explanation if not.

## Project directory

| Folder | Holds |
|---|---|
| `inputs/` | each uploaded file once, named by its SHA-256 |
| `sessions/<id>/` | `config.yaml` (what the framework loads), `config.full.json` (what the GUI sent), `inputs.json`, `info.json` |
| `runs/<id>/` | `run.json`, `pipeline.yaml`, `reproduce.sh`, `progress.jsonl`, `out/<session>.results.zip` |

Raw data is never changed. `config.yaml` leaves out sections the installed framework cannot read
(`metadata`, `behavior.markers`, `behavior.frame_labels`); `info.json` and `run.json` list what
was left out, and `config.full.json` keeps everything.

## Capabilities

`GET /capabilities` reports, by feature detection, which framework contracts exist (F0a to F9 in
`outputs/claude/CABANA_GUI_IMPLEMENTATION_PLAN.md`, section 7). The framework version string is the
same for every commit, so versions cannot tell features apart. Edit `capabilities.py` if a
contract names a field differently.

## Tests

```bash
uv run --project gui/bridge pytest -q          # all, about 1 minute
uv run --project gui/bridge pytest -q -m "not slow"
uv run --project gui/bridge python gui/bridge/scripts/make_fixture_results.py   # regenerate GUI fixtures
```
