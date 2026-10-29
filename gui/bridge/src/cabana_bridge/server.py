"""HTTP API (plan section 5, P2). Loopback only, per-launch secret, stdlib server."""

from __future__ import annotations

import hmac
import io
import json
import re
import traceback
import zipfile
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs, urlparse

import yaml

from . import __version__
from . import capabilities as caps_mod
from . import pipeline_prep as prep
from . import serialize
from .runner import Refused, Runner
from .store import BadRequest, Project, check_id

PREFIX = "/api/cabana/v1"
JSON_LIMIT = 10 * 1024 * 1024
INPUT_LIMIT = 4 * 1024**3
DEFAULT_ORIGINS = ("http://localhost:5199", "http://localhost:5173", "http://127.0.0.1:5199", "http://127.0.0.1:5173")


class App:
    """State shared by all requests."""

    def __init__(self, project: Project, secret: str, origins: tuple[str, ...] = DEFAULT_ORIGINS) -> None:
        self.project, self.secret, self.origins = project, secret, origins
        self.capabilities = caps_mod.Capabilities()
        self.sessions = prep.SessionCache(project)
        self.runner = Runner(project, self.capabilities, self.sessions)
        self._describe: Any = None


class Handler(BaseHTTPRequestHandler):
    app: App
    server_version = "cabana-bridge"

    # -- plumbing ----------------------------------------------------------------------
    def log_message(self, *args: Any) -> None:  # keep the console quiet
        pass

    def _cors(self) -> None:
        origin = self.headers.get("Origin")
        if origin in self.app.origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Bridge-Secret")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, HEAD, OPTIONS")

    def _send(self, status: int, body: bytes = b"", ctype: str = "application/json", headers: dict | None = None) -> None:
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, obj: Any, status: int = 200) -> None:
        self._send(status, json.dumps(obj, default=str, allow_nan=False).encode())

    def _body_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length > JSON_LIMIT:
            raise BadRequest("body too large")
        return json.loads(self.rfile.read(length) or b"{}")

    def _authorized(self) -> bool:
        host = (self.headers.get("Host") or "").split(":")[0]
        if host not in {"127.0.0.1", "localhost", "[::1]"}:
            return False
        got = self.headers.get("X-Bridge-Secret") or parse_qs(urlparse(self.path).query).get("token", [""])[0]
        return hmac.compare_digest(got.encode(), self.app.secret.encode())

    def _dispatch(self) -> None:
        if self.command == "OPTIONS":
            self._send(204)
            return
        parsed = urlparse(self.path)
        if not parsed.path.startswith(PREFIX):
            self._json({"error": "not found"}, 404)
            return
        if not self._authorized():
            self._json({"error": "forbidden"}, 403)
            return
        route = parsed.path[len(PREFIX):]
        query = parse_qs(parsed.query)
        for method, pattern, fn in ROUTES:
            m = re.fullmatch(pattern, route)
            if m and (method == self.command or (method == "GET" and self.command == "HEAD")):
                try:
                    fn(self, query, *m.groups())
                except BadRequest as exc:
                    self._json({"error": str(exc)}, 400)
                except FileNotFoundError as exc:
                    self._json({"error": f"not found: {exc}"}, 404)
                except KeyError as exc:
                    self._json({"error": f"not found: {exc}"}, 404)
                except Refused as exc:
                    self._json(exc.payload, 409)
                except serialize.UnsupportedResults as exc:
                    self._json({"error": f"Saved by a newer framework. Update the framework to open. ({exc})"}, 422)
                except Exception as exc:
                    self._json({"error": str(exc), "traceback": traceback.format_exc()}, 500)
                return
        self._json({"error": "not found"}, 404)

    do_GET = do_POST = do_PUT = do_DELETE = do_HEAD = do_OPTIONS = _dispatch

    # -- helpers used by routes --------------------------------------------------------
    @property
    def project(self) -> Project:
        return self.app.project

    def results_zip(self, run_id: str) -> tuple[dict, Path]:
        rec = self.project.read_run(check_id(run_id))
        if not rec.get("results_file"):
            raise FileNotFoundError(f"run {run_id} has no results")
        return rec, self.project.run_dir(run_id) / rec["results_file"]


# -- routes ------------------------------------------------------------------------------
def health(h: Handler, q: dict) -> None:
    h._json({"ok": True, "bridge_version": __version__, **h.app.capabilities.info})


def capabilities(h: Handler, q: dict) -> None:
    h._json({**h.app.capabilities.flags, "_info": h.app.capabilities.info})


def describe(h: Handler, q: dict) -> None:
    if h.app._describe is None:
        from cabana import describe as framework_describe

        h.app._describe = json.loads(json.dumps(framework_describe(), default=str))
    h._json(h.app._describe)


def input_head(h: Handler, q: dict, sha: str) -> None:
    h._send(204 if h.project.input_file(sha) else 404)


def input_put(h: Handler, q: dict, sha: str) -> None:
    length = int(h.headers.get("Content-Length") or 0)
    if length > INPUT_LIMIT:
        raise BadRequest("input too large")
    created = h.project.put_input(sha, h.rfile, length, (q.get("name") or [""])[0])
    h._send(201 if created else 204)


def sessions_post(h: Handler, q: dict) -> None:
    body = h._body_json()
    session_id, info = h.project.register_session(body.get("config"), body.get("files") or {}, h.app.capabilities.flags)
    problems: list[str] = []
    try:
        h.app.sessions.get(session_id)
    except Exception as exc:
        problems.append(str(exc))
    h._json({"session_id": session_id, "problems": problems, "withheld": info["withheld"]})


def session_file(h: Handler, q: dict, session_id: str, sha: str) -> None:
    if sha not in h.project.session_inputs(session_id).values():
        raise FileNotFoundError(sha)
    path = h.project.input_file(sha)
    if path is None:
        raise FileNotFoundError(sha)
    h._send(200, path.read_bytes(), "application/octet-stream", {"X-Input-Name": h.project.input_meta(sha).get("name", "")})


def session_config(h: Handler, q: dict, session_id: str) -> None:
    h._json(json.loads((h.project.session_dir(session_id) / "config.full.json").read_text()))


def validate(h: Handler, q: dict) -> None:
    body = h._body_json()
    session = h.app.sessions.get(body["session_id"])
    pipeline_dict, notes = prep.prepare(session, body["pipeline"], body.get("rejected_cells"))
    try:
        pipeline = prep.to_pipeline(pipeline_dict)
    except Exception as exc:
        h._json({"issues": [{"level": "error", "analysis": None, "code": "invalid_pipeline", "message": str(exc)}]})
        return
    report = prep.validation_report(session, pipeline)
    for reason in prep.guard_bayesian(session, pipeline_dict):
        report["issues"].append({"level": "error", "analysis": None, "code": "bayes_input", "message": reason})
    missing = prep.missing_capabilities(body.get("requires"), h.app.capabilities.flags)
    if missing:
        report["issues"].append({"level": "error", "analysis": None, "code": "missing_capability",
                                 "message": "The installed framework lacks: " + ", ".join(missing)})
    report["missing_capabilities"] = missing
    report["rejected_cell_ids"] = notes["rejected_cell_ids"]
    h._json(report)


def runs_post(h: Handler, q: dict) -> None:
    h._json({"run_id": h.app.runner.submit(h._body_json())}, 202)


def runs_list(h: Handler, q: dict) -> None:
    h._json(h.project.list_runs((q.get("session_id") or [None])[0]))


def run_get(h: Handler, q: dict, run_id: str) -> None:
    after = int((q.get("events_after") or ["0"])[0])
    events, nxt = h.app.runner.events(check_id(run_id), after)
    h._json({"record": h.project.read_run(run_id), "events": events, "next": nxt})


def run_cancel(h: Handler, q: dict, run_id: str) -> None:
    h.app.runner.cancel(check_id(run_id))
    h._send(202)


def run_delete(h: Handler, q: dict, run_id: str) -> None:
    rec = h.project.read_run(check_id(run_id))
    if rec["status"] in {"queued", "running"}:
        raise BadRequest("cancel the run before deleting it")
    h.project.delete_run(run_id)
    h._send(204)


def manifest(h: Handler, q: dict, run_id: str) -> None:
    rec, zip_path = h.results_zip(run_id)
    h._json(serialize.manifest_view(zip_path, h.app.sessions.get(rec["session"]["session_id"])))


def array(h: Handler, q: dict, run_id: str, result: str, key: str) -> None:
    _, zip_path = h.results_zip(run_id)
    h._send(200, serialize.array_bytes(zip_path, result, key), "application/octet-stream")


def table(h: Handler, q: dict, run_id: str, result: str) -> None:
    _, zip_path = h.results_zip(run_id)
    h._send(200, serialize.table_csv(zip_path, result).encode(), "text/csv")


def summary(h: Handler, q: dict, run_id: str) -> None:
    _, zip_path = h.results_zip(run_id)
    h._json(serialize.summary_rows(zip_path))


def plotdata(h: Handler, q: dict, run_id: str, result: str, kind: str) -> None:
    rec, zip_path = h.results_zip(run_id)
    session = h.app.sessions.get(rec["session"]["session_id"])
    h._send(200, serialize.plot_data_json(zip_path, session, result, kind, **serialize.plot_kwargs(q)).encode())


def figure(h: Handler, q: dict, run_id: str, result: str, kind: str, fmt: str) -> None:
    rec, zip_path = h.results_zip(run_id)
    session = h.app.sessions.get(rec["session"]["session_id"])
    data = serialize.figure_bytes(zip_path, session, result, kind, fmt, **serialize.plot_kwargs(q))
    h._send(200, data, "image/svg+xml" if fmt == "svg" else "image/png")


def bundle(h: Handler, q: dict, run_id: str) -> None:
    rec, zip_path = h.results_zip(run_id)
    folder = h.project.run_dir(run_id)
    session_id = rec["session"]["session_id"]
    full_config = json.loads((h.project.session_dir(session_id) / "config.full.json").read_text())
    inputs = "\n".join(f"{i['name']}  sha256={i['sha256']}" for i in rec["session"]["inputs"])
    readme = (
        "CaBaNA run bundle\n\nrun.json            run record (settings, inputs, framework version)\n"
        "pipeline.yaml       the pipeline that ran (cabana run pipeline.yaml --session <folder>)\n"
        "config.yaml         the session config the GUI exported\n"
        "results.zip         framework results (ResultSet.load)\nreproduce.sh        re-runs the analysis\n\n"
        "Input files are not included. Name and SHA-256:\n" + inputs + "\n"
    )
    if rec.get("scope") == "preview":
        readme += "\nPRELIMINARY: quick preview run with reduced shuffles.\n"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("run.json", json.dumps(rec, indent=2, default=str))
        z.write(folder / "pipeline.yaml", "pipeline.yaml")
        z.writestr("config.yaml", yaml.safe_dump(full_config, sort_keys=False))
        z.write(zip_path, "results.zip")
        z.write(folder / "reproduce.sh", "reproduce.sh")
        z.writestr("README.txt", readme)
    h._send(200, buf.getvalue(), "application/zip")


def run_records_post(h: Handler, q: dict) -> None:
    """Stores a browser-engine (PETH) record and its exported files."""
    body = h._body_json()
    record = body["record"]
    run_id = check_id(record["run_id"])
    if record.get("engine") != "browser-ts":
        raise BadRequest("only browser-engine records are accepted here")
    folder = h.project.run_dir(run_id)
    for name, text in (body.get("files") or {}).items():
        target = h.project.inside(folder / "files" / Path(name).name)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
    record["files"] = sorted(Path(n).name for n in (body.get("files") or {}))
    h.project.write_run(run_id, record)
    h._json({"run_id": run_id}, 201)


def run_file(h: Handler, q: dict, run_id: str, name: str) -> None:
    path = h.project.inside(h.project.run_dir(run_id) / "files" / Path(name).name)
    h._send(200, path.read_bytes(), "text/plain; charset=utf-8")


def project_get(h: Handler, q: dict) -> None:
    h._json(h.project.read_project())


def project_put(h: Handler, q: dict) -> None:
    h.project.write_project(h._body_json())
    h._send(204)


Route = tuple[str, str, Callable[..., None]]
ID = r"([0-9a-zA-Z_-]{8,64})"
ROUTES: list[Route] = [
    ("GET", r"/health", health),
    ("GET", r"/capabilities", capabilities),
    ("GET", r"/describe", describe),
    ("GET", r"/inputs/([0-9a-f]{64})", input_head),
    ("PUT", r"/inputs/([0-9a-f]{64})", input_put),
    ("POST", r"/sessions", sessions_post),
    ("GET", rf"/sessions/{ID}/files/([0-9a-f]{{64}})", session_file),
    ("GET", rf"/sessions/{ID}/config", session_config),
    ("POST", r"/validate", validate),
    ("POST", r"/runs", runs_post),
    ("GET", r"/runs", runs_list),
    ("GET", rf"/runs/{ID}", run_get),
    ("POST", rf"/runs/{ID}/cancel", run_cancel),
    ("DELETE", rf"/runs/{ID}", run_delete),
    ("GET", rf"/runs/{ID}/manifest", manifest),
    ("GET", rf"/runs/{ID}/arrays/([^/]+)/([^/]+)\.npy", array),
    ("GET", rf"/runs/{ID}/table/([^/]+)\.csv", table),
    ("GET", rf"/runs/{ID}/summary", summary),
    ("GET", rf"/runs/{ID}/plotdata/([^/]+)/([^/]+)", plotdata),
    ("GET", rf"/runs/{ID}/figure/([^/]+)/([^/]+)\.(svg|png)", figure),
    ("GET", rf"/runs/{ID}/bundle\.zip", bundle),
    ("GET", rf"/runs/{ID}/files/([^/]+)", run_file),
    ("POST", r"/run-records", run_records_post),
    ("GET", r"/project", project_get),
    ("PUT", r"/project", project_put),
]


def make_server(app: App, port: int) -> ThreadingHTTPServer:
    handler = type("BoundHandler", (Handler,), {"app": app})
    return ThreadingHTTPServer(("127.0.0.1", port), handler)
