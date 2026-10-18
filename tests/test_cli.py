"""Command-line interface (F3): exit codes, progress output, saved results."""

from __future__ import annotations

import json
import signal
import subprocess
import sys
from pathlib import Path

import pytest

import cabana
from cabana import _cli
from cabana._cli import main

PIPE_YAML = """\
analyses:
  - metric: {name: information_content}
    states: position
    shuffle: {n_shuffles: 10, min_shift_s: 1.0, seed: 1, batch_size: 2}
"""


@pytest.fixture()
def pipe_yaml(tmp_path: Path) -> Path:
    p = tmp_path / "pipe.yaml"
    p.write_text(PIPE_YAML)
    return p


@pytest.fixture()
def zip_a(tmp_path: Path, small_session: cabana.Session) -> Path:
    p = tmp_path / "a.zip"
    small_session.model_copy(
        update={"info": small_session.info.model_copy(update={"session_id": "sa", "animal": "m1"})}
    ).save(p)
    return p


def test_version(capsys):
    assert main(["version"]) == 0
    assert capsys.readouterr().out.strip() == cabana.__version__


def test_run_out_creates_loadable_zip(tmp_path, pipe_yaml, zip_a, capsys):
    out = tmp_path / "out"
    assert main(["run", str(pipe_yaml), "--session", str(zip_a), "--out", str(out)]) == 0
    rs = cabana.ResultSet.load(out / "sa.results.zip")
    assert rs.status == "ok" and len(list(rs)) == 1
    assert (out / "run_set.json").exists()


def test_run_stdout_single_session(pipe_yaml, zip_a, capsys):
    assert main(["run", str(pipe_yaml), "--session", str(zip_a)]) == 0
    assert "sa" in capsys.readouterr().out


def test_progress_jsonl_ends_with_done(tmp_path, pipe_yaml, zip_a, capsys):
    f = tmp_path / "prog.jsonl"
    code = main(
        [
            "run",
            str(pipe_yaml),
            "--session",
            str(zip_a),
            "--out",
            str(tmp_path / "o"),
            "--progress",
            "jsonl",
            "--progress-file",
            str(f),
        ]
    )
    assert code == 0
    lines = [json.loads(x) for x in f.read_text().splitlines()]
    assert lines[-1]["event"] == "done" and lines[-1]["status"] == "ok"
    assert lines[-1]["elapsed_s"] >= 0
    prog = [x for x in lines if x["event"] == "progress"]
    assert prog and {"stage", "name", "fraction", "shuffles_done", "message"} <= prog[0].keys()
    assert any(x["stage"] == "shuffle" for x in prog)


def test_progress_jsonl_stderr_and_text(tmp_path, pipe_yaml, zip_a, capsys):
    main(["run", str(pipe_yaml), "--session", str(zip_a), "--progress", "jsonl"])
    err = capsys.readouterr().err.strip().splitlines()
    assert json.loads(err[-1])["event"] == "done"
    main(["run", str(pipe_yaml), "--session", str(zip_a), "--progress", "text"])
    assert "[" in capsys.readouterr().err


def test_sigint_cancels_and_saves_partial(tmp_path, pipe_yaml, zip_a, monkeypatch, capsys):
    holder = {}
    orig_enter = _cli._Canceller.__enter__

    def enter(self):
        holder["c"] = self
        return orig_enter(self)

    monkeypatch.setattr(_cli._Canceller, "__enter__", enter)
    orig_to_dict = cabana.ProgressEvent.to_dict

    def to_dict(self):
        if self.stage == "shuffle" and not holder["c"].requested:
            holder["c"].handler(signal.SIGINT, None)  # first Ctrl-C
        return orig_to_dict(self)

    monkeypatch.setattr(cabana.ProgressEvent, "to_dict", to_dict)
    out = tmp_path / "out"
    code = main(
        ["run", str(pipe_yaml), "--session", str(zip_a), "--out", str(out), "--progress", "jsonl"]
    )
    assert code == 3
    rs = cabana.ResultSet.load(out / "sa.results.cancelled.zip")
    assert rs.status == "cancelled"
    assert json.loads(capsys.readouterr().err.strip().splitlines()[-1])["status"] == "cancelled"


def test_second_sigint_raises():
    c = _cli._Canceller()
    c.handler(signal.SIGINT, None)
    assert c() is True
    with pytest.raises(KeyboardInterrupt):
        c.handler(signal.SIGINT, None)


def test_sigint_handler_restored():
    before = signal.getsignal(signal.SIGINT)
    with _cli._Canceller():
        assert signal.getsignal(signal.SIGINT) != before
    assert signal.getsignal(signal.SIGINT) == before


def test_on_error_record_exit_4(tmp_path, zip_a, capsys):
    p = tmp_path / "bad.yaml"
    p.write_text("analyses:\n  - metric: {name: information_content}\n    states: nope\n")
    assert main(["run", str(p), "--session", str(zip_a)]) == 1
    assert main(["run", str(p), "--session", str(zip_a), "--on-error", "record"]) == 4


def test_describe_strict_json(capsys):
    assert main(["describe"]) == 0
    d = json.loads(capsys.readouterr().out, parse_constant=lambda c: pytest.fail(c))
    assert "plugins" in d


def test_schema_with_fake(monkeypatch, capsys):
    import cabana._schema as sch

    def fake(name):
        if name == "pipeline":
            return {"title": "Pipeline"}
        raise KeyError(name)

    monkeypatch.setattr(sch, "schema", fake)
    assert main(["schema", "pipeline", "--indent", "0"]) == 0
    assert json.loads(capsys.readouterr().out) == {"title": "Pipeline"}
    assert main(["schema", "bogus"]) == 2
    assert "resultset" in capsys.readouterr().err


def test_schema_real_study(capsys):
    from cabana import _schema

    try:
        _schema.schema("study")
    except NotImplementedError:
        pytest.skip("schema() not implemented yet")
    assert main(["schema", "study"]) == 0
    assert isinstance(json.loads(capsys.readouterr().out), dict)


def test_validate_monkeypatched(monkeypatch, pipe_yaml, zip_a, capsys):
    class Rep:
        ok = False

        def to_dict(self):
            return {"ok": False, "issues": []}

    monkeypatch.setattr(cabana.Pipeline, "validate", lambda self, s, **kw: Rep())
    assert main(["validate", str(pipe_yaml), "--session", str(zip_a)]) == 1
    assert json.loads(capsys.readouterr().out)["ok"] is False

    class Ok:
        ok = True

        def __str__(self):
            return "fine"

    monkeypatch.setattr(cabana.Pipeline, "validate", lambda self, s, **kw: Ok())
    assert main(["validate", str(pipe_yaml), "--session", str(zip_a)]) == 0
    assert "fine" in capsys.readouterr().out


def test_bad_args_exit_2(pipe_yaml, capsys):
    assert main([]) == 2
    assert main(["bogus"]) == 2
    assert main(["run", str(pipe_yaml), "--progress", "xml"]) == 2
    assert main(["run", str(pipe_yaml)]) == 2  # pipeline without --session
    assert main(["describe", "--indent", "x"]) == 2


def test_missing_files_exit_1(tmp_path, pipe_yaml, capsys):
    assert main(["run", str(tmp_path / "nope.yaml"), "--session", "x"]) == 1
    assert main(["run", str(pipe_yaml), "--session", str(tmp_path / "nope.zip")]) == 1
    assert "error" in capsys.readouterr().err


def test_study_yaml_via_cli(tmp_path, small_session, capsys):
    small_session.save(tmp_path / "s1.zip")
    (tmp_path / "pipe.yaml").write_text(PIPE_YAML)
    (tmp_path / "study.yaml").write_text(
        "kind: cabana.Study\nname: t\nsessions:\n  s1: {path: s1.zip, animal: m1}\n"
        "pipeline: pipe.yaml\nout_dir: out\n"
    )
    assert main(["run", str(tmp_path / "study.yaml")]) == 0
    assert (tmp_path / "out" / "s1.results.zip").exists()
    assert (tmp_path / "out" / "study.json").exists()
    assert main(["run", str(tmp_path / "study.yaml"), "--session", "x"]) == 2


def test_entry_point_subprocess():
    exe = Path(sys.executable).parent / "cabana"
    if not exe.exists():
        pytest.skip("cabana entry point not installed")
    r = subprocess.run([str(exe), "version"], capture_output=True, text=True, timeout=60)
    assert r.returncode == 0 and r.stdout.strip() == cabana.__version__


def test_jsonl_stderr_is_pure_json_with_warning(tmp_path, zip_a, capsys, monkeypatch):
    import warnings

    p = tmp_path / "w.yaml"
    p.write_text(PIPE_YAML)
    orig = cabana.Pipeline.from_yaml

    def noisy(*a, **k):
        warnings.warn("synthetic library warning", UserWarning, stacklevel=1)
        return orig(*a, **k)

    monkeypatch.setattr(cabana.Pipeline, "from_yaml", staticmethod(noisy))
    assert main(["run", str(p), "--session", str(zip_a), "--progress", "jsonl"]) == 0
    lines = [json.loads(x) for x in capsys.readouterr().err.splitlines()]
    assert lines[-1]["event"] == "done"
    warn = [x for x in lines if x["event"] == "warning"]
    assert warn and warn[0]["category"] == "UserWarning" and "synthetic" in warn[0]["message"]


def test_jsonl_error_event_before_done(tmp_path, zip_a, capsys):
    code = main(
        ["run", str(tmp_path / "nope.yaml"), "--session", str(zip_a), "--progress", "jsonl"]
    )
    assert code == 1
    lines = [json.loads(x) for x in capsys.readouterr().err.splitlines()]
    assert [x["event"] for x in lines] == ["error", "done"]
    assert lines[0]["type"] == "FileNotFoundError" and lines[1]["status"] == "error"


def test_sigint_notice_is_log_event_in_jsonl(capsys):
    from cabana._cli import _Progress

    pr = _Progress("jsonl", None)
    c = _cli._Canceller(notify=pr.log)
    c.handler(signal.SIGINT, None)
    ev = json.loads(capsys.readouterr().err)
    assert ev["event"] == "log" and "cancelling" in ev["message"]


def test_progress_file_implies_jsonl(tmp_path, pipe_yaml, zip_a, capsys):
    f = tmp_path / "p.jsonl"
    code = main(["run", str(pipe_yaml), "--session", str(zip_a), "--progress-file", str(f)])
    assert code == 0
    lines = [json.loads(x) for x in f.read_text().splitlines()]
    assert lines[-1]["event"] == "done"


def test_broken_process_pool_exits_cancelled(tmp_path, pipe_yaml, zip_a, monkeypatch, capsys):
    from concurrent.futures.process import BrokenProcessPool

    def boom(*a, **k):
        raise BrokenProcessPool("dead")

    monkeypatch.setattr(_cli, "run_set", boom)
    assert main(["run", str(pipe_yaml), "--session", str(zip_a), "--n-jobs", "2"]) == 3
    assert "workers interrupted" in capsys.readouterr().err


def test_cancelled_without_out_notes_not_saved(pipe_yaml, zip_a, capsys, monkeypatch):
    monkeypatch.setattr(_cli, "_status_code", lambda s: 3)
    orig = _cli.run_set

    def cancelled_run(*a, **k):
        k["context"].should_cancel = lambda: True
        return orig(*a, **k)

    monkeypatch.setattr(_cli, "run_set", cancelled_run)
    assert main(["run", str(pipe_yaml), "--session", str(zip_a)]) == 3
    assert "--out was not given" in capsys.readouterr().err


def test_cancelled_zip_removed_when_session_completes(tmp_path, pipe_yaml, zip_a, capsys):
    out = tmp_path / "out"
    out.mkdir()
    stale = out / "sa.results.cancelled.zip"
    stale.write_bytes(b"x")
    assert main(["run", str(pipe_yaml), "--session", str(zip_a), "--out", str(out)]) == 0
    assert not stale.exists()


def test_cancelled_zip_listed_in_run_set_json(tmp_path, pipe_yaml, zip_a, monkeypatch, capsys):
    orig = _cli.run_set

    def cancelled_run(*a, **k):
        n = {"k": 0}

        def cancel():
            n["k"] += 1
            return n["k"] > 3

        k["context"].should_cancel = cancel
        return orig(*a, **k)

    monkeypatch.setattr(_cli, "run_set", cancelled_run)
    out = tmp_path / "out"
    assert main(["run", str(pipe_yaml), "--session", str(zip_a), "--out", str(out)]) == 3
    meta = json.loads((out / "run_set.json").read_text())
    assert meta["sessions"]["sa"]["file"] == "sa.results.cancelled.zip"
    assert "pipeline_sha256" in meta


def test_schema_sorted_matches_snapshot(capsys):
    assert main(["schema", "resultset"]) == 0
    root = Path(__file__).resolve().parent.parent
    assert capsys.readouterr().out == (root / "schemas" / "resultset-v1.json").read_text()


def test_broken_pipe_exit_0(monkeypatch, capsys):
    def pipe(args):
        raise BrokenPipeError

    monkeypatch.setattr(_cli, "_cmd_version", pipe)
    p = _cli._build_parser()
    monkeypatch.setattr(_cli, "_build_parser", lambda: p)
    assert main(["version"]) == 0
