"""A stand-in for Playwright, put first on the Backend's PYTHONPATH by test_update.py, so a run can
hold the Edge lock over real stdio without opening Edge or Facebook.

Launching Edge marks `FAKE_EDGE_DIR/launched`, waits for `FAKE_EDGE_DIR/release`, then fails as a
missing Edge does. Only the names the Backend imports exist.
"""

import os
import time
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path

APIResponse = object
Cookie = dict
BrowserContext = object
Page = object
Playwright = object


class Error(Exception):
    pass


class TimeoutError(Error):
    pass


class _Chromium:
    def launch_persistent_context(self, *args: object, **kwargs: object) -> object:
        folder = Path(os.environ["FAKE_EDGE_DIR"])
        (folder / "launched").touch()
        deadline = time.monotonic() + 30
        while not (folder / "release").exists() and time.monotonic() < deadline:
            time.sleep(0.05)
        raise Error("fake Edge: not installed")


class _Playwright:
    chromium = _Chromium()


@contextmanager
def sync_playwright() -> Generator[_Playwright]:
    yield _Playwright()
