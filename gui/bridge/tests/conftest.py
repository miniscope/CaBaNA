import hashlib
import json
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest
import yaml

from cabana_bridge.server import App, make_server
from cabana_bridge.store import Project

EXAMPLES = Path(__file__).resolve().parents[3] / "example_data"
SECRET = "test-secret"


class Client:
    def __init__(self, port: int) -> None:
        self.base = f"http://127.0.0.1:{port}/api/cabana/v1"

    def call(self, method, path, body=None, raw=None, headers=None, secret=SECRET):
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(self.base + path, data=data, method=method)
        if secret:
            req.add_header("X-Bridge-Secret", secret)
        for k, v in (headers or {}).items():
            req.add_header(k, v)
        try:
            with urllib.request.urlopen(req) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read()

    def json(self, method, path, body=None, **kw):
        status, data = self.call(method, path, body, **kw)
        return status, (json.loads(data) if data else None)

    def upload(self, path: Path) -> str:
        data = path.read_bytes()
        sha = hashlib.sha256(data).hexdigest()
        status, _ = self.call("PUT", f"/inputs/{sha}?name={path.name}", raw=data)
        assert status in (201, 204)
        return sha

    def register_example(self, name: str) -> str:
        folder = EXAMPLES / name
        config = yaml.safe_load((folder / "config.yaml").read_text())
        files = {}

        def walk(node, trail):
            if isinstance(node, dict):
                for k, v in node.items():
                    if k in ("file", "timestamps") and isinstance(v, str):
                        files[".".join(trail + [k])] = self.upload(folder / v)
                    elif k == "alternatives":
                        continue
                    else:
                        walk(v, trail + [k])

        walk(config, [])
        config.get("neural", {}).pop("alternatives", None)
        status, out = self.json("POST", "/sessions", {"config": config, "files": files})
        assert status == 200, out
        assert out["problems"] == [], out
        return out["session_id"]

    def wait(self, run_id, timeout=240):
        t0 = time.time()
        while time.time() - t0 < timeout:
            _, out = self.json("GET", f"/runs/{run_id}")
            if out["record"]["status"] in {"ok", "partial", "cancelled", "failed"}:
                return out["record"]
            time.sleep(0.3)
        raise TimeoutError(run_id)


@pytest.fixture()
def project(tmp_path):
    return Project(tmp_path / "project")


@pytest.fixture()
def bridge(project):
    app = App(project, SECRET)
    server = make_server(app, 0)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield Client(server.server_address[1]), app
    server.shutdown()
