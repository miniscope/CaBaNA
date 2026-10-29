"""Write ``schemas/resultset-v1.json`` from ``cabana.resultset_schema()``."""

from __future__ import annotations

import json
from pathlib import Path

import cabana


def main() -> None:
    out = Path(__file__).resolve().parent.parent / "schemas" / "resultset-v1.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(cabana.resultset_schema(), indent=2, sort_keys=True) + "\n")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
