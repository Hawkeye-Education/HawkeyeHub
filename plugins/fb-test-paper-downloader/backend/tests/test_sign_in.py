"""Sign in's wait for the `c_user` cookie, against a stand-in for Edge: no test opens Facebook."""

import threading
from collections.abc import Sequence
from pathlib import Path

import pytest
from browser import FACEBOOK, wait_for_sign_in
from hawkeye_hub.testing import BackendFailed, run_backend
from playwright._impl._errors import TargetClosedError
from playwright.sync_api import Cookie

BACKEND = Path(__file__).parent.parent


def cookie(name: str) -> Cookie:
    return {"name": name, "value": "1", "domain": ".facebook.com", "path": "/"}


class Tab:
    def __init__(self) -> None:
        self.visited: list[str] = []

    def goto(self, url: str) -> None:
        self.visited.append(url)


class FakeEdge:
    """Answers each `cookies` poll with the next jar; `None` is staff closing the window."""

    def __init__(self, jars: Sequence[list[Cookie] | None]) -> None:
        self.jars = list(jars)
        self.pages = [Tab()]
        self.closed = False

    def cookies(self, urls: str) -> list[Cookie]:
        assert urls == FACEBOOK
        jar = self.jars.pop(0)
        if jar is None:
            raise TargetClosedError()
        return jar

    def close(self) -> None:
        self.closed = True


def test_opens_facebook_and_resolves_signed_in_once_c_user_is_set() -> None:
    edge = FakeEdge([[], [cookie("datr")], [cookie("datr"), cookie("c_user")]])

    assert wait_for_sign_in(edge, threading.Event(), poll_seconds=0) == "signed-in"
    assert edge.pages[0].visited == [FACEBOOK]
    assert edge.closed


def test_closing_the_window_before_signing_in_cancels() -> None:
    edge = FakeEdge([[], None])

    assert wait_for_sign_in(edge, threading.Event(), poll_seconds=0) == "cancelled"


def test_shutdown_closes_the_window_and_cancels() -> None:
    edge = FakeEdge([[]])
    stopping = threading.Event()
    stopping.set()

    assert wait_for_sign_in(edge, stopping, poll_seconds=0) == "cancelled"
    assert edge.closed


def test_the_backend_starts_and_answers_over_stdio(tmp_path: Path) -> None:
    with run_backend(BACKEND, data_dir=tmp_path / "data", stores={}, hub_api="1.3.0") as backend:
        with pytest.raises(BackendFailed) as failed:
            backend.request("signIn", {"unexpected": True})
    assert failed.value.reason == "invalid-params"
