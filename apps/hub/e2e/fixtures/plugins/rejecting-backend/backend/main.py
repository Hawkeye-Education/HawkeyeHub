"""A fixture Backend: standard-library Python speaking raw newline-delimited JSON-RPC on stdio.

It answers `initialize` with a JSON-RPC error, then exits on `shutdown` or when stdin closes.
"""

import json
import sys
from typing import Any

# No LANG, so the Backend sets its own stdio encoding (PLUGIN_STANDARD.md §5.5).
sys.stdin.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
sys.stdout.reconfigure(encoding="utf-8", newline="\n")  # type: ignore[union-attr]


def send(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


for line in sys.stdin:
    message = json.loads(line)
    method = message["method"]
    if method == "initialize":
        error = {
            "code": -32000,
            "message": "Cannot start",
            "data": {"reason": "cannot-start"},
        }
        send({"jsonrpc": "2.0", "id": message["id"], "error": error})
    elif method == "shutdown":
        break
