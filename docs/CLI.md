# Command line

The `cabana` command (installed with the package; also `python -m cabana._cli`) runs
pipelines and studies without writing Python.

```
cabana run SPEC [--session PATH]... [--out DIR] [--progress {none,text,jsonl}]
                [--progress-file PATH] [--n-jobs N] [--no-resume] [--on-error {raise,record}]
cabana describe [--probe] [--indent N]
cabana schema NAME [--indent N]
cabana validate SPEC --session PATH
cabana version
```

`--debug` (any command) prints a traceback instead of a one-line error.

## Exit codes

| code | meaning |
|------|---------|
| 0 | ok |
| 1 | error (message on stderr) |
| 2 | usage error (bad arguments, unknown schema name) |
| 3 | cancelled (Ctrl-C / SIGINT, or workers killed by a terminal Ctrl-C); partial results are saved only with `--out` (otherwise a note says they were not) |
| 4 | completed, but `--on-error record` stored failed analyses (`status == "partial"`) |

## `cabana run`

`SPEC` is either a **pipeline YAML** (`Pipeline.to_yaml`) or a **study YAML**
(`kind: cabana.Study`, or any mapping with a `sessions` key).

Pipeline YAML: give one or more `--session PATH`; each is a `Session.save` zip/folder or
a session folder holding `session.yaml` (`cabana.loaders.load_session_dir`).  A session's
id is its `info.session_id`, else the file or folder name.  With `--out DIR` the command
writes `<session_id>.results.zip` and `run_set.json` (per-session status).  Without
`--out`, a single session prints the head of `ResultSet.to_dataframe()` and the summary.

Study YAML: `--session` is not allowed; `--out` overrides the study's `out_dir`.

Rerunning with the same `--out` reuses finished sessions (`--no-resume` recomputes).
`--n-jobs N` processes sessions in parallel.  A study loads every session up front, so
memory scales with the number of sessions even with `--n-jobs 1`.

### Cancellation

The first Ctrl-C stops after the current step; results so far are kept as
`<session_id>.results.cancelled.zip` (status `cancelled`; never reused by resume; listed
as `"file"` in `run_set.json` / `study.json`; deleted when the session later completes into
the same `--out`) and the exit code is 3.  Without `--out` nothing is saved.  A second Ctrl-C raises `KeyboardInterrupt` immediately.

### Progress

`--progress text` prints the human stage lines to stderr.  `--progress jsonl` writes one
JSON object per line to stderr, or to `--progress-file` (which implies `--progress jsonl`).
In jsonl mode every message is a JSON line with an `"event"` key:

| event | fields |
|-------|--------|
| `progress` | `ProgressEvent.to_dict()` (below) |
| `log` | `message` (e.g. the Ctrl-C notice, "results were not saved ...") |
| `warning` | `category`, `message` (Python warnings raised in the CLI process) |
| `error` | `type`, `message` (fatal error; followed by `done` with status `error`) |
| `done` | `status`, `elapsed_s` (always the last line) |

Warnings raised inside `--n-jobs` worker processes bypass this stream, so a consumer
should still defensively skip lines that are not JSON.

Progress line (`ProgressEvent.to_dict()` plus `"event": "progress"`):

```json
{"event": "progress", "stage": "shuffle", "name": "information_content[position]",
 "index": 0, "total": 2, "fraction": 0.31, "shuffles_done": 200, "shuffles_total": 1000,
 "elapsed_s": 4.2, "message": "sa"}
```

`stage` is `transform`, `preprocess`, `select`, `analysis`, `shuffle` or `done`;
`fraction` is the overall 0-1 estimate (across all sessions of a study); `shuffles_*` are
null outside `shuffle` events; `message` is prefixed `"<session id>: "`.

The last line is always

```json
{"event": "done", "status": "ok", "elapsed_s": 12.3}
```

with `status` one of `ok`, `partial`, `cancelled`, or `error`.

`ProgressEvent.to_bridge()` gives the same event in the CaLab bridge payload
(`iteration`, `max_iterations`, `phase` = `"<stage>:<name>"`, `phase_progress`,
`status` = `running`/`done`, and the full `to_dict()` under `"cabana"`); CaLab can apply it
to a parsed jsonl line with `ProgressEvent(**{k: v for k, v in line.items() if k != "event"})`.

## `cabana describe`, `schema`, `validate`

`describe` prints `cabana.describe(probe=...)` as strict JSON (`--probe` also runs every
metric once on a tiny simulated session to report their output arrays).  `schema NAME` prints a JSON Schema: `resultset`, `pipeline`,
`analysis_spec`, `shuffle_config`, `selection`, `study`, `tuning_export`, `describe`
(unknown name: exit 2).  `validate SPEC --session PATH` runs `Pipeline.validate` on the
session and exits 1 when the report is not ok.

## Study YAML

```yaml
kind: cabana.Study
name: social-preference
sessions:                       # id -> source
  m1_day1: {path: sessions/m1_day1.zip, animal: m1}
  m2_day1: {path: sessions/m2_day1}          # folder with session.yaml -> session_dir loader
  m3_day1: {path: sessions/m3, loader: session_dir}
animal: {m2_day1: m2}           # optional; overrides per-source animal; default = own id
pipeline: pipeline.yaml         # path (relative to this file) or an inline mapping
criteria:                       # class name -> inline Criteria or path to criteria YAML
  place: place_cell.yaml
out_dir: results                # relative to this file
n_jobs: 2
resume: true
```

`loader` is `session` (`Session.load`: `.zip` or folder with `manifest.json`),
`session_dir` (folder with `session.yaml`), or omitted to detect.  Output: per-session
results zips, `run_set.json`, and `study.json` (status per session, pipeline sha256,
cabana version, timestamp, classification counts).  From Python:

```python
spec = cabana.StudySpec.from_yaml("study.yaml")
result = cabana.run_study(spec)      # StudyResult: run, classifications, status
result.classification_table()
```

## Calling from CaLab

CaLab runs the command as a subprocess and reads stderr line by line:

```python
proc = subprocess.Popen(
    ["cabana", "run", "pipeline.yaml", "--session", "s.zip", "--out", out,
     "--progress", "jsonl"],
    stderr=subprocess.PIPE, text=True)
for line in proc.stderr:
    msg = json.loads(line)       # event: progress, log, warning, error or done
proc.wait()                      # 0 ok, 3 cancelled, 4 partial, 1 error
```

Cancel by sending `SIGINT` to the process (once for a graceful stop with partial
results), then read the results zips from `out`.  Use `--progress-file` to keep the
event stream apart from other stderr output.
