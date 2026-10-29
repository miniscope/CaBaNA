"""`cabana-bridge --project-dir DIR [--port 8765]`."""

from __future__ import annotations

import argparse
import secrets
import sys
from pathlib import Path


def assert_framework() -> None:
    """The repo's own `cabana` package has the same import name but no pipeline API."""
    import cabana

    missing = [n for n in ("recipe_pipeline", "analyze") if not hasattr(cabana, n)]
    if missing:
        raise SystemExit(
            f"The installed 'cabana' ({cabana.__file__}) lacks {', '.join(missing)}. "
            "The bridge needs the framework, not this repository's package. "
            "Run it with: uv run --project gui/bridge cabana-bridge ..."
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="cabana-bridge", description=__doc__)
    parser.add_argument("--project-dir", required=True, type=Path, help="workspace for inputs, sessions and runs")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--secret", default=None, help="default: generated and printed")
    args = parser.parse_args(argv)

    assert_framework()
    from .server import App, make_server
    from .store import Project

    secret = args.secret or secrets.token_urlsafe(16)
    app = App(Project(args.project_dir), secret)
    server = make_server(app, args.port)
    print(f"cabana-bridge listening on http://127.0.0.1:{args.port}")
    print(f"open the GUI with ?bridge=http://127.0.0.1:{args.port}&bridge_secret={secret}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
