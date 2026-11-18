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

## Projects

A project is a folder under the projects root (`--projects-root`, default `~/CaBaNA Projects`,
created on first write). `project.yaml` is its entry file. Projects opened from another place are
remembered in `<root>/recent.json`. All paths below start with `/api/cabana/v1`; every request
needs the `X-Bridge-Secret` header. Errors are `{"error": "..."}`: 400 bad request, 404 unknown
project or file, 409 clash or run in progress, 501 needs macOS.

```
M24 social preference/
  project.yaml  experiment.yaml  processing.yaml  analysis.yaml
  history/   changes.jsonl, snapshots/<stamp>/, last-valid/
  runs/<run id>/
  processed/   inputs/ and sessions/ cache; regenerable
```

`project.yaml`: `format` (1), `id` (12 hex characters, stable across renames), `name`, `created`,
`modified` (UTC ISO), `save_mode` (`auto` | `manual`), `retention` (`every` | `latest3` |
`current`), `copy_data` (false), `data` (list of data file references).

With no project open, the `--project-dir` workspace stays the store (`inputs/`, `sessions/`,
`runs/`). With one open, runs go to `<project>/runs/`, and inputs and sessions to
`<project>/processed/`. Opening, closing, renaming (when open) and deleting (when open) are
refused with 409 while a run is queued or running.

A project summary (used by every response below that says "project"):
`{id, name, path, created, modified, kinds: ["neural"|"position"|"behavior"], file_count,
size_bytes, missing_count, readable, save_mode, retention, copy_data}`. `kinds` come from the data
slot ids (the GUI's `SlotId`): `neural_*` and `footprints` are neural, `position` and
`head_orientation` are position, `behavior_timestamps`, `zone_annotations`,
`behavior_annotations`, `time_markers` and `frame_labels` are behavior. `missing_count` counts
files whose recorded path no longer exists. `readable` is false for a remembered project whose
folder cannot be read (drive unplugged).

### Lifecycle

| Request | Body | Response |
|---|---|---|
| `GET /projects` | | `{root, projects: [project]}`, newest modified first |
| `POST /projects` | `{name, parent?}` | 201 project. The folder is `<parent or root>/<name>`, made filesystem-safe, with " 2", " 3" added when taken. `name` in the response is the folder name. |
| `POST /projects/open` | `{id}` or `{path}` (the folder or its `project.yaml`) | project, now the engine's current project |
| `POST /projects/close` | | `{project: null}`, back to the workspace |
| `GET /projects/current` | | `{project: project or null}` |
| `POST /projects/{id}/rename` | `{name}` | project. The folder is renamed too; 409 if the name is taken. The id does not change. |
| `POST /projects/{id}/duplicate` | `{name?}` (default "<name> copy") | 201 project (new id). Copies configuration, history and data references, not runs or `processed/`. |
| `DELETE /projects/{id}` | | `{trashed_to}`. Moves the folder to `~/.Trash`. Original data is outside the folder and untouched. |
| `POST /projects/{id}/reveal` | | 204. Runs `open -R <folder>`; 501 off macOS. |

### Configuration files

The four names are `project.yaml`, `experiment.yaml`, `processing.yaml`, `analysis.yaml`. New
projects start with `{}` in the last three.

| Request | Body | Response |
|---|---|---|
| `GET /projects/{id}/files/{name}` | | `{name, text, modified, valid, error: {line, message} or null, in_use: "this" or "last-valid"}` |
| `PUT /projects/{id}/files/{name}` | `{data}` (object) or `{text}` (YAML), `summary` | `{saved_at}`. 400 when the text is not valid YAML or not a mapping (message starts "Line N:"). `project.yaml` must keep its `id`. |
| `GET /projects/{id}/files/{name}/compare?run={run id}` | | `{name, run, identical, changes: [{op, run_lines: [first, last], current_lines: [first, last], run: [lines], current: [lines]}]}` against `runs/<run id>/config/<name>`; 404 when the run has no frozen copy |

A file edited outside CaBaNA is parsed on every read. On an error, `valid` is false, `error` names
the line, and the engine keeps using the last valid copy (`history/last-valid/<name>`, refreshed
on each valid read or write). Writes go through a temp file and a rename. Only the four names
are accepted, so nothing outside the project folder can be written.

### History

| Request | Response |
|---|---|
| `GET /projects/{id}/history` | `{changes: [{time, file, summary}] oldest first, snapshots: [{id, time, reason}] newest first}` |
| `POST /projects/{id}/history/{snapshot}/restore` | `{restored, saved_at}`. Restores the three yaml files only (never results, never `project.yaml`), after snapshotting the current state, and logs it. |

Every `PUT` appends `{time, file, summary}` to `history/changes.jsonl` (`summary` is the GUI's
own words, for example "Event smoothing 0.20 s (was off)"). A snapshot of the three yaml files
(`history/snapshots/<UTC stamp>/`) is taken before an edit when the last one is 30 minutes old or
more; reason is `edit`, or `before restore`.

### Data referenced by path

Data stays where it is. `slot` is one of the GUI's `SlotId` values (`neural_timestamps`,
`neural_deconvolved`, `neural_denoised`, `neural_raw`, `footprints`, `behavior_timestamps`,
`position`, `head_orientation`, `zone_annotations`, `behavior_annotations`, `time_markers`,
`frame_labels`, `config`). Each project.yaml `data` entry is
`{slot, path, size, mtime, sha256}`, plus `copied: "data/<slot>-<name>"` when `copy_data` is true
(the file is also copied into the project, for archiving).

| Request | Body | Response |
|---|---|---|
| `POST /dialog` | `{kind: "folder" or "files" or "save", title?, default_name?}` | `{paths: [...]}` or `{cancelled: true}`. Native macOS dialog through `osascript`; the request waits for the user. 501 off macOS. |
| `POST /scan` | `{paths: [...]}` | `{files: [{name, path, size, modified}]}`. A folder lists its files and the files of one level of subfolders (hidden files skipped); a file path lists itself. The GUI matches names to slots. |
| `POST /projects/{id}/data` | `{slot, path}` | 201 entry. Reads the file once for its SHA-256. A slot registered again is replaced. |
| `DELETE /projects/{id}/data/{slot}` | | 204 |
| `GET /projects/{id}/data` | | `{files: [entry + {name, status, last_seen_path}]}` |
| `GET /files/{sha256}` | | The bytes of a file registered in the open project; 404 for anything else or when no project is open. |

`status` is `present`; `changed` (a different file at the same path); `moved` (found again by
hash in the project folder, its `data/` folder, the original folder or its parent: the new path is
recorded and `moved` is reported once, with `last_seen_path` the old one); or `missing`
(`last_seen_path` is where it was).

With a project open, `HEAD /inputs/{sha}` is 204 for a registered file, `PUT /inputs/{sha}`
stores nothing for it, and sessions point at the file in place. Uploads of unregistered files
still go to `processed/inputs/`.

### Runs, storage, export

With a project open:
- `POST /sessions`: `position.exclude_frames` from `processing.yaml` is merged into the session
  config at `behavior.position.exclude_frames` (the framework sees the same config as before).
  A value already in the config sent by the GUI is kept. The merge happens when the session is
  registered, so register again after changing it.
- `POST /runs`: first snapshots the yaml files ("before run") and freezes copies of
  `experiment.yaml`, `processing.yaml` and `analysis.yaml` in `runs/<id>/config/`
  (used by the compare endpoint). When the run completes, the project's `retention` is applied
  to that analysis: `every` keeps all, `latest3` and `current` delete the large files of older
  completed non-preview runs. Records are never removed.

| Request | Body | Response |
|---|---|---|
| `GET /projects/{id}/storage` | | `{categories: [{id, label, bytes, deletable}], runs: [{run_id, analysis, scope, status, created, record_bytes, large_bytes, outputs_deleted}], total_bytes}`. Category ids: `config` (no), `processed`, `previews`, `figures`, `old_runs` (yes), `current_runs` (the newest completed run of each analysis; no), `data` (referenced originals; no). |
| `POST /projects/{id}/storage/delete` | `{category}` (`processed`, `previews`, `figures` or `old_runs`) | `{freed_bytes}`. 400 for other categories or while a run is active. `processed` keeps `project.json`. |
| `POST /runs/{id}/delete-outputs` | | `{freed_bytes}`. Deletes `out/`, `figures/` and `reproduced/`; keeps `run.json`, settings, `config/` and the summary table (`summary.json`, served by `GET /runs/{id}/summary`); sets `outputs_deleted: true`. Other results endpoints then return 404. |
| `POST /projects/{id}/export` | `{include: {results, figures, data}}` | Streams `<name>.cabana.zip`. Configuration and history are always in; `results` adds run folders, `figures` adds each run's figures, `data` adds the referenced files under `data/` (recorded as `copied`). |
| `POST /projects/import` | `{path}` | 201 project, unpacked into the projects root under a unique name. A project id that already exists gets a new one. 400 for a zip without `project.yaml` or with unsafe paths. |

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
