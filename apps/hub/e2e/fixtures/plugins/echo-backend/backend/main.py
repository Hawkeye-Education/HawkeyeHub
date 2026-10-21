"""A fixture Backend: standard-library Python speaking raw newline-delimited JSON-RPC on stdio.

It sends a `hello` notification right after answering `initialize`, before the Plugin UI can
have its port. It answers `initialize` only after a pause, so the page has registered its
handlers by the time the port, and the queued `hello`, reach it. It answers `report` with what it saw at start, `ping` with a `pong` notification
and then its params, `fail` with a JSON-RPC error, and `say` by writing its `text` to stderr. It logs `shutdown` to stderr and exits, and exits when
stdin closes.
"""

import json
import os
import sys
import time
from typing import Any

# No LANG, so the Backend sets its own stdio encoding (PLUGIN_STANDARD.md §5.5).
sys.stdin.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
sys.stdout.reconfigure(encoding="utf-8", newline="\n")  # type: ignore[union-attr]


def send(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


# With no locale set, Python itself sets LC_CTYPE to one of these at startup (PEP 538), as it does
# on macOS. The Hub passes none of them: its own locale is en_US.UTF-8 in the smoke test.
PYTHON_COERCED_LOCALES = {("LC_CTYPE", "C.UTF-8"), ("LC_CTYPE", "C.utf8"), ("LC_CTYPE", "UTF-8")}

INITIALIZE_PAUSE_SECONDS = 1

started: dict[str, Any] = {}

for line in sys.stdin:
    message = json.loads(line)
    method = message["method"]
    if method == "initialize":
        params = message["params"]
        started = {
            "initialize": params,
            "dataDirExists": os.path.isdir(params["dataDir"]),
            "storesExist": {
                name: os.path.isdir(path) for name, path in params["stores"].items()
            },
            "cwd": os.getcwd(),
            "localeVariables": sorted(
                name
                for name, value in os.environ.items()
                if (name == "LANG" or name.startswith("LC_"))
                and (name, value) not in PYTHON_COERCED_LOCALES
            ),
            "pid": os.getpid(),
        }
        # The page registers its handlers as it parses, which can take longer than a Backend that
        # answers at once: macOS CI dropped `hello` for want of a handler without this pause.
        time.sleep(INITIALIZE_PAUSE_SECONDS)
        send({"jsonrpc": "2.0", "id": message["id"], "result": {}})
        send({"jsonrpc": "2.0", "method": "hello", "params": {"early": True}})
    elif method == "report":
        send({"jsonrpc": "2.0", "id": message["id"], "result": started})
    elif method == "ping":
        send({"jsonrpc": "2.0", "method": "pong", "params": message["params"]})
        send({"jsonrpc": "2.0", "id": message["id"], "result": message["params"]})
    elif method == "fail":
        error = {
            "code": -32000,
            "message": "Asked to fail",
            "data": {"reason": "asked-to-fail"},
        }
        send({"jsonrpc": "2.0", "id": message["id"], "error": error})
    elif method == "say":
        print(message["params"]["text"], file=sys.stderr, flush=True)
        send({"jsonrpc": "2.0", "id": message["id"], "result": {}})
    elif method == "shutdown":
        print("got shutdown", file=sys.stderr, flush=True)
        break
