"""A fixture Backend: standard-library Python speaking raw newline-delimited JSON-RPC on stdio.

It answers `initialize`, then breaks when asked: `exit` exits with code 3 without answering,
`fail-loudly` does the same after a stderr line, and `garbage` writes a stdout line that is not
JSON-RPC. It exits on `shutdown` or when stdin closes.
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
        send({"jsonrpc": "2.0", "id": message["id"], "result": {}})
    elif method == "exit":
        sys.exit(3)
    elif method == "fail-loudly":
        print("backend failing loudly", file=sys.stderr, flush=True)
        sys.exit(3)
    elif method == "garbage":
        sys.stdout.write("this is not JSON-RPC\n")
        sys.stdout.flush()
    elif method == "shutdown":
        break
