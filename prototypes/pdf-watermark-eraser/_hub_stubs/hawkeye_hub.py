"""PROTOTYPE stub of the Hub's Python SDK. The real one is the `hawkeye-hub` package a Backend depends on.

Speaks newline-delimited JSON-RPC 2.0 on the real stdout and moves sys.stdout to stderr so a
stray print() can't corrupt the protocol (ADR 0003). It answers the Hub's `initialize` request
itself and gives every handler the typed Context it carried (ADR 0009). After that, only the
Plugin UI sends requests; the Backend may only send notifications.

Each request runs on its own thread, so a long `run` doesn't block a `cancel` notification.
Notification handlers run on the reader thread and must return quickly.
"""
import json
import sys
import threading
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

sys.stdin.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8", errors="replace")
_out = sys.stdout
_out.reconfigure(encoding="utf-8", newline="\n")
sys.stdout = sys.stderr
_lock = threading.Lock()

# JSON-RPC error codes
INVALID_PARAMS = -32602
METHOD_NOT_FOUND = -32601
INTERNAL_ERROR = -32603
NOT_INITIALIZED = -32002


def _send(msg: dict) -> None:
    with _lock:
        _out.write(json.dumps({"jsonrpc": "2.0", **msg}, ensure_ascii=False) + "\n")
        _out.flush()


class RpcError(Exception):
    """Raise from a handler to reject the request; the Plugin UI sees it as HubError('backend-error').rpc."""

    def __init__(self, code: int, message: str, data: Any = None):
        super().__init__(message)
        self.code, self.message, self.data = code, message, data


@dataclass(frozen=True)
class Context:
    data_dir: Path  # this Plugin's private Plugin Data folder (ADR 0008)
    stores: dict[str, Path]  # declared Shared Store name -> folder
    hub_api: str  # the Hub API version the Hub implements

    def notify(self, method: str, params: dict) -> None:
        _send({"method": method, "params": params})


Handler = Callable[[Context, dict], Any]


class Backend:
    def __init__(self) -> None:
        self._requests: dict[str, Handler] = {}
        self._notifications: dict[str, Handler] = {}

    def request(self, method: str) -> Callable[[Handler], Handler]:
        def register(fn: Handler) -> Handler:
            self._requests[method] = fn
            return fn
        return register

    def notification(self, method: str) -> Callable[[Handler], Handler]:
        def register(fn: Handler) -> Handler:
            self._notifications[method] = fn
            return fn
        return register

    def serve(self) -> None:
        ctx: Context | None = None
        for line in sys.stdin:
            if not line.strip():
                continue
            msg = json.loads(line)
            method, mid, params = msg.get("method"), msg.get("id"), msg.get("params") or {}
            if method == "initialize":
                ctx = Context(Path(params["dataDir"]), {k: Path(v) for k, v in params["stores"].items()},
                              params["hubApi"])
                _send({"id": mid, "result": {}})
            elif method == "shutdown":
                if fn := self._notifications.get("shutdown"):
                    fn(ctx, params)
                return  # daemon request threads die with the process; the Hub kills the tree after ~5 s anyway
            elif ctx is None:
                if mid is not None:
                    _send({"id": mid, "error": {"code": NOT_INITIALIZED, "message": "not initialized"}})
            elif mid is None:
                if fn := self._notifications.get(method):
                    fn(ctx, params)
            elif fn := self._requests.get(method):
                threading.Thread(target=self._answer, args=(fn, ctx, mid, params), daemon=True).start()
            else:
                _send({"id": mid, "error": {"code": METHOD_NOT_FOUND, "message": f"no method {method}"}})

    @staticmethod
    def _answer(fn: Handler, ctx: Context, mid: Any, params: dict) -> None:
        try:
            _send({"id": mid, "result": fn(ctx, params)})
        except RpcError as e:
            _send({"id": mid, "error": {"code": e.code, "message": e.message, "data": e.data}})
        except Exception as e:
            traceback.print_exc()  # stderr is the Backend's log
            _send({"id": mid, "error": {"code": INTERNAL_ERROR, "message": f"{type(e).__name__}: {e}"}})
