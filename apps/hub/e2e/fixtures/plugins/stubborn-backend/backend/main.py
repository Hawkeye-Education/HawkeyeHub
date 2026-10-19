"""A fixture Backend that will not stop: standard-library Python speaking raw JSON-RPC on stdio.

As it starts it launches a child process that sleeps, as a Backend that launched a browser would.
It answers `report` with its own pid and its child's, and logs `shutdown` to stderr but carries on,
so only the Hub's kill ends it. When stdin closes it exits and leaves its child behind: only the
Hub's tree kill ends that.
"""

import json
import os
import subprocess
import sys
from typing import Any

# No LANG, so the Backend sets its own stdio encoding (PLUGIN_STANDARD.md §5.5).
sys.stdin.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
sys.stdout.reconfigure(encoding="utf-8", newline="\n")  # type: ignore[union-attr]


def send(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


# Not on the Backend's stdio, or the Hub would wait for the child to let go of it.
child = subprocess.Popen(
    [sys.executable, "-c", "import time; time.sleep(600)"],
    stdin=subprocess.DEVNULL,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)

for line in sys.stdin:
    message = json.loads(line)
    method = message["method"]
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": message["id"], "result": {}})
    elif method == "report":
        report = {"pid": os.getpid(), "childPid": child.pid}
        send({"jsonrpc": "2.0", "id": message["id"], "result": report})
    elif method == "shutdown":
        print("ignoring shutdown", file=sys.stderr, flush=True)
