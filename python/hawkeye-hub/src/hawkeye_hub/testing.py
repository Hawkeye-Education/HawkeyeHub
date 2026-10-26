"""Drives any Backend over real stdio, as the Hub does, whether or not it uses the SDK.

See PLUGIN_STANDARD.md §9.2.
"""

import json
import os
import subprocess
import sys
import threading
from collections.abc import Generator, Mapping
from contextlib import contextmanager
from pathlib import Path
from typing import IO, Any

__all__ = ["BackendFailed", "RunningBackend", "run_backend"]

# The Hub's own limits (apps/hub/src/main/backend.ts).
INITIALIZE_TIMEOUT_S = 10.0
SHUTDOWN_GRACE_S = 5.0
# How long a test waits for an answer before failing.
REQUEST_TIMEOUT_S = 30.0

INITIALIZE_ID = "hub-initialize"


class BackendFailed(Exception):
    """The Backend answered a request with a JSON-RPC error."""

    def __init__(self, code: int, reason: str | None, message: str) -> None:
        super().__init__(f"{code} {reason}: {message}")
        self.code = code
        # None: the Backend sent no `data.reason`, as a raw JSON-RPC Backend may.
        self.reason = reason
        self.message = message


class RunningBackend:
    """A Backend process, started and initialized by `run_backend`.

    Results and notification params are decoded JSON, so they are typed `Any` for the test to
    assert on.
    """

    def __init__(self, process: subprocess.Popen[bytes]) -> None:
        self._process = process
        self._stdin = _pipe(process.stdin)
        self._send_lock = threading.Lock()
        self._changed = threading.Condition()
        self._answers: dict[int | str, dict[str, Any]] = {}
        self._notifications: list[tuple[str, Any]] = []
        self._violations: list[str] = []
        self._stdout_closed = False
        self._stderr: list[str] = []
        self._next_id = 0
        self._readers = [
            threading.Thread(target=self._read_stdout, args=(_pipe(process.stdout),), daemon=True),
            threading.Thread(target=self._read_stderr, args=(_pipe(process.stderr),), daemon=True),
        ]
        for reader in self._readers:
            reader.start()

    def request(self, method: str, params: Mapping[str, object]) -> Any:
        """Sends a request and returns its result, or raises `BackendFailed`."""
        with self._changed:
            self._next_id += 1
            id = self._next_id
        return self._call(id, method, params, REQUEST_TIMEOUT_S)

    def notify(self, method: str, params: Mapping[str, object]) -> None:
        self._send({"jsonrpc": "2.0", "method": method, "params": params})

    def notifications(self, method: str) -> list[Any]:
        """The params of every `method` notification received so far."""
        with self._changed:
            return [params for name, params in self._notifications if name == method]

    def wait_for(self, method: str, count: int, timeout: float) -> list[Any]:
        """Waits until `count` `method` notifications have arrived, and returns them all."""
        with self._changed:
            if not self._changed.wait_for(
                lambda: len(self.notifications(method)) >= count, timeout
            ):
                raise TimeoutError(f"{count} {method!r} notifications did not arrive in {timeout}s")
            return self.notifications(method)

    @property
    def stderr(self) -> str:
        with self._changed:
            return "".join(self._stderr)

    def close_stdin(self) -> int:
        """Closes stdin, as a Hub that has gone does, and returns the exit code once the Backend has
        exited. Fails if it is still running after the Hub's shutdown grace period."""
        self._stdin.close()
        return self._wait_exit("stdin closed")

    def _call(
        self, id: int | str, method: str, params: Mapping[str, object], timeout: float
    ) -> Any:
        self._send({"jsonrpc": "2.0", "id": id, "method": method, "params": params})
        with self._changed:
            if not self._changed.wait_for(
                lambda: id in self._answers or self._stdout_closed, timeout
            ):
                raise TimeoutError(f"{method} was not answered in {timeout}s")
            self._check_protocol()
            if id not in self._answers:
                raise AssertionError(
                    f"The Backend exited before answering {method}:\n{self.stderr}"
                )
            answer = self._answers.pop(id)
        if "error" in answer:
            error = answer["error"]
            match error.get("data"):
                case {"reason": str() as reason}:
                    raise BackendFailed(error["code"], reason, error["message"])
                case _:
                    raise BackendFailed(error["code"], None, error["message"])
        return answer["result"]

    def _send(self, message: Mapping[str, object]) -> None:
        line = (json.dumps(message, ensure_ascii=False) + "\n").encode("utf-8")
        with self._send_lock:
            self._stdin.write(line)
            self._stdin.flush()

    def _read_stdout(self, stdout: IO[bytes]) -> None:
        for raw in stdout:
            line = raw.decode("utf-8")
            message = _decode(line)
            with self._changed:
                match message:
                    case {"jsonrpc": "2.0", "id": int() | str() as id, "result": _}:
                        self._answers[id] = message
                    case {
                        "jsonrpc": "2.0",
                        "id": int() | str() as id,
                        "error": {"code": int(), "message": str()},
                    }:
                        self._answers[id] = message
                    case {"jsonrpc": "2.0", "method": str() as method, **rest} if set(rest) <= {
                        "params"
                    }:
                        self._notifications.append((method, rest.get("params")))
                    case _:
                        self._violations.append(line)
                self._changed.notify_all()
        with self._changed:
            self._stdout_closed = True
            self._changed.notify_all()

    def _read_stderr(self, stderr: IO[bytes]) -> None:
        for raw in stderr:
            with self._changed:
                self._stderr.append(raw.decode("utf-8"))

    def _check_protocol(self) -> None:
        if self._violations:
            raise AssertionError(f"The Backend wrote non-JSON-RPC to stdout: {self._violations!r}")

    def _wait_exit(self, after: str) -> int:
        try:
            code = self._process.wait(SHUTDOWN_GRACE_S)
        except subprocess.TimeoutExpired:
            self._process.kill()
            self._process.wait()
            raise AssertionError(
                f"The Backend was still running {SHUTDOWN_GRACE_S}s after {after}"
            ) from None
        for reader in self._readers:
            reader.join()
        with self._changed:
            self._check_protocol()
        return code

    def _stop(self) -> None:
        if self._stdin.closed:
            return
        # Like the Hub, keep stdin open after `shutdown`: the Backend must exit on `shutdown` alone.
        # A closed stdout is a Backend already gone, as one that failed `initialize` is; writing
        # to it would fail before the test sees why.
        with self._changed:
            gone = self._stdout_closed
        if not gone and self._process.poll() is None:
            self.notify("shutdown", {})
        try:
            self._wait_exit("shutdown")
        finally:
            self._stdin.close()


@contextmanager
def run_backend(
    backend_dir: Path,
    *,
    data_dir: Path,
    stores: Mapping[str, Path],
    secrets: Mapping[str, str],
    hub_api: str,
) -> Generator[RunningBackend]:
    """Starts `backend_dir/main.py` with the current interpreter, without LANG or LC_*, sends
    `initialize`, and on exit sends `shutdown`. The data and store folders are made, as the Hub
    makes them, and `secrets` is left out of `initialize` when empty, as the Hub leaves it out."""
    data_dir.mkdir(parents=True, exist_ok=True)
    for folder in stores.values():
        folder.mkdir(parents=True, exist_ok=True)
    env = {k: v for k, v in os.environ.items() if k != "LANG" and not k.startswith("LC_")}
    process = subprocess.Popen(
        [sys.executable, "main.py"],
        cwd=backend_dir,
        env=env,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    backend = RunningBackend(process)
    try:
        backend._call(  # pyright: ignore[reportPrivateUsage]
            INITIALIZE_ID,
            "initialize",
            {
                "dataDir": str(data_dir),
                "stores": {name: str(path) for name, path in stores.items()},
                "hubApi": hub_api,
                **({"secrets": dict(secrets)} if secrets else {}),
            },
            INITIALIZE_TIMEOUT_S,
        )
        yield backend
    finally:
        backend._stop()  # pyright: ignore[reportPrivateUsage]


def _decode(line: str) -> Any:
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        return line  # matches no message shape, so it is recorded as a violation


def _pipe[T](pipe: T | None) -> T:
    # Popen's pipes are typed optional, and are set when PIPE is passed, as run_backend does.
    if pipe is None:
        raise RuntimeError("The Backend was started without a pipe")
    return pipe
