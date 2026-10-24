"""The Hawkeye Hub Python SDK: a Backend's side of the stdio JSON-RPC protocol.

The contract is the wire protocol (ADRs 0003, 0009, 0011); this SDK is a convenience over it.
See PLUGIN_STANDARD.md §5 for how a Backend uses it.
"""

import inspect
import json
import logging
import os
import sys
import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType
from typing import Any, Literal, TypeVar, get_type_hints

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError
from pydantic.alias_generators import to_camel

__all__ = ["Backend", "Context", "Model", "RpcError"]

log = logging.getLogger("hawkeye_hub")

# JSON-RPC error codes. The `data.reason` is what a Plugin UI reads (PLUGIN_STANDARD.md §5.3).
SERVER_ERROR = -32000
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603


class Model(BaseModel):
    """Structured data on the wire: frozen, no extra keys, snake_case in Python, camelCase on the
    wire. Incoming params are validated by their camelCase names only."""

    model_config = ConfigDict(
        frozen=True,
        extra="forbid",
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
    )


class RpcError(Exception):
    """Rejects a request: `reason` is a kebab-case code the Plugin UI translates, `message` is
    technical English."""

    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason
        self.message = message


Message = Mapping[str, object]


@dataclass(frozen=True)
class Context:
    """What the Hub sent in `initialize`, and the way to notify the Plugin UI."""

    data_dir: Path
    stores: Mapping[str, Path]
    hub_api: str
    _write: Callable[[Message], None] = field(repr=False)

    def notify(self, method: str, params: Model) -> None:
        self._write({"jsonrpc": "2.0", "method": method, "params": _dump(params)})


class _Wire(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class _Request(_Wire):
    jsonrpc: Literal["2.0"]
    id: int | str
    method: str
    # JSON-RPC makes params optional; absent params are no params, which a handler's model then
    # validates like `{}`. The Hub sends `shutdown` with none.
    params: dict[str, Any] = Field(default_factory=dict[str, Any])


class _Notification(_Wire):
    jsonrpc: Literal["2.0"]
    method: str
    # As for _Request.
    params: dict[str, Any] = Field(default_factory=dict[str, Any])


_incoming: TypeAdapter[_Request | _Notification] = TypeAdapter(_Request | _Notification)


class _Initialize(Model):
    data_dir: Path
    stores: dict[str, Path]
    hub_api: str


@dataclass(frozen=True)
class _Handler:
    params: type[Model]
    run: Callable[[Context, Any], object]


P = TypeVar("P", bound=Model)
R = TypeVar("R", bound=Model)


class Backend:
    """A Backend's handlers. Each request runs on its own thread; each notification runs inline on
    the reader thread, so a `cancel` notification reaches a running request."""

    def __init__(self) -> None:
        self._requests: dict[str, _Handler] = {}
        self._notifications: dict[str, _Handler] = {}

    def request(
        self, method: str
    ) -> Callable[[Callable[[Context, P], R]], Callable[[Context, P], R]]:
        def register(fn: Callable[[Context, P], R]) -> Callable[[Context, P], R]:
            self._requests[method] = _Handler(_params_model(fn), fn)
            return fn

        return register

    def notification(
        self, method: str
    ) -> Callable[[Callable[[Context, P], None]], Callable[[Context, P], None]]:
        def register(fn: Callable[[Context, P], None]) -> Callable[[Context, P], None]:
            self._notifications[method] = _Handler(_params_model(fn), fn)
            return fn

        return register

    def serve(self) -> None:
        """Answers the Hub on stdio until `shutdown` (after in-flight requests finish) or until
        stdin closes (the Hub is gone, so no `shutdown` will come)."""
        sys.stdout.flush()
        # stdout is the protocol. Keep it to ourselves, and point fd 1 and sys.stdout at stderr so
        # a stray print() is harmless. The Backend gets no LANG, so set UTF-8 ourselves.
        out = open(os.dup(1), "w", encoding="utf-8", newline="\n")
        os.dup2(2, 1)
        sys.stderr = open(
            2, "w", encoding="utf-8", errors="backslashreplace", buffering=1, closefd=False
        )
        sys.stdout = sys.stderr
        stdin = open(0, encoding="utf-8", closefd=False)
        lock = threading.Lock()

        def write(message: Message) -> None:
            line = json.dumps(message, ensure_ascii=False) + "\n"
            with lock:
                out.write(line)
                out.flush()

        lines = iter(stdin)
        first = next(lines, None)
        if first is None:
            return
        initialize = _Request.model_validate_json(first)
        if initialize.method != "initialize":
            raise RuntimeError(f"The Hub's first message is {initialize.method!r}, not initialize")
        started = _Initialize.model_validate(initialize.params, by_name=False)
        ctx = Context(
            data_dir=started.data_dir,
            stores=MappingProxyType(dict(started.stores)),
            hub_api=started.hub_api,
            _write=write,
        )
        write({"jsonrpc": "2.0", "id": initialize.id, "result": {}})

        running: list[threading.Thread] = []
        for line in lines:
            message = _incoming.validate_json(line)
            if isinstance(message, _Request):
                thread = threading.Thread(
                    target=self._answer, args=(ctx, message, write), daemon=True
                )
                thread.start()
                running = [t for t in running if t.is_alive()] + [thread]
                continue
            handler = self._notifications.get(message.method)
            if handler is not None:
                handler.run(ctx, handler.params.model_validate(message.params, by_name=False))
            elif message.method != "shutdown":
                log.warning("No handler for notification %r", message.method)
            if message.method == "shutdown":
                for thread in running:
                    thread.join()
                return

    def _answer(self, ctx: Context, request: _Request, write: Callable[[Message], None]) -> None:
        def error(code: int, reason: str, message: str) -> None:
            write(
                {
                    "jsonrpc": "2.0",
                    "id": request.id,
                    "error": {"code": code, "message": message, "data": {"reason": reason}},
                }
            )

        handler = self._requests.get(request.method)
        if handler is None:
            error(METHOD_NOT_FOUND, "method-not-found", f"No method {request.method!r}")
            return
        try:
            params = handler.params.model_validate(request.params, by_name=False)
        except ValidationError as e:
            error(INVALID_PARAMS, "invalid-params", str(e))
            return
        try:
            result = handler.run(ctx, params)
        except RpcError as e:
            error(SERVER_ERROR, e.reason, e.message)
            return
        except Exception as e:
            # A bug in the handler: the traceback goes to stderr, the Backend's log, and the Plugin
            # UI gets `internal`. The process keeps serving other requests.
            log.exception("%s failed", request.method)
            error(INTERNAL_ERROR, "internal", f"{type(e).__name__}: {e}")
            return
        if not isinstance(result, Model):
            raise TypeError(f"{request.method} returned {type(result).__name__}, not a Model")
        write({"jsonrpc": "2.0", "id": request.id, "result": _dump(result)})


def _dump(model: Model) -> dict[str, Any]:
    return model.model_dump(mode="json", by_alias=True)


def _params_model(fn: Callable[..., object]) -> type[Model]:
    names = list(inspect.signature(fn).parameters)
    model = get_type_hints(fn).get(names[1]) if len(names) == 2 else None
    if not (isinstance(model, type) and issubclass(model, Model)):
        raise TypeError(
            f"{fn.__qualname__} must take (ctx: Context, params: <a hawkeye_hub.Model>)"
        )
    return model
