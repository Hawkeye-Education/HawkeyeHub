"""The Plugin's own Edge: launched on a profile in Plugin Data, never staff's own (§5.6)."""

import threading
from collections.abc import Sequence
from pathlib import Path
from typing import Literal, Protocol

from hawkeye_hub import RpcError

# What a closed Edge window raises (probed with Playwright 1.64 and msedge). Playwright exports it
# only from _impl; catching it alone keeps a network failure an `internal` error, not a cancel.
from playwright._impl._errors import TargetClosedError
from playwright.sync_api import BrowserContext, Cookie, Playwright
from playwright.sync_api import Error as PlaywrightError

FACEBOOK = "https://www.facebook.com/"
SIGN_IN_POLL_SECONDS = 1.0

SignInOutcome = Literal["signed-in", "cancelled"]


def open_edge(pw: Playwright, profile: Path) -> BrowserContext:
    """A headed Edge on `profile`. There is no Chromium fallback and no `playwright install`."""
    try:
        return pw.chromium.launch_persistent_context(
            profile,
            channel="msedge",
            headless=False,
            accept_downloads=True,
            viewport={"width": 1280, "height": 900},
            locale="zh-HK",  # the group's Facebook UI, whose labels later scraping matches
            args=[
                "--disable-notifications",
                "--no-first-run",
                "--no-default-browser-check",
                "--hide-crash-restore-bubble",
                "--disable-session-crashed-bubble",
                "--disable-features=msEdgeWelcomePage,msImplicitSignin,msEdgeSidebarV2,EdgeCollections",
            ],
        )
    except PlaywrightError as e:
        raise RpcError("browser-not-found", str(e)) from e


class _Tab(Protocol):
    def goto(self, url: str) -> object: ...


class Window(Protocol):
    """What Sign in needs of a `BrowserContext`."""

    @property
    def pages(self) -> Sequence[_Tab]: ...
    def cookies(self, urls: str) -> list[Cookie]: ...
    def close(self) -> None: ...


def wait_for_sign_in(
    window: Window, stopping: threading.Event, poll_seconds: float = SIGN_IN_POLL_SECONDS
) -> SignInOutcome:
    """Opens Facebook and waits until it sets `c_user` (signed in) or staff close the window.

    `stopping` is the Backend's `shutdown`: the window is closed and Sign in is cancelled.
    """
    try:
        window.pages[0].goto(FACEBOOK)  # a persistent context opens with one tab
        while not stopping.is_set():
            if any(c.get("name") == "c_user" for c in window.cookies(FACEBOOK)):
                window.close()
                return "signed-in"
            stopping.wait(poll_seconds)
    except TargetClosedError:  # staff closed the Edge window
        return "cancelled"
    window.close()
    return "cancelled"
