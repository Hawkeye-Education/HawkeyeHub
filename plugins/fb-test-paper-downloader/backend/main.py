"""The Facebook Test Paper Downloader's Backend. The Hub runs it as a script with the venv's Python.

Its protocol's other half is ui-src/protocol.ts. Rejections carry a reason the Plugin UI translates
(PLUGIN_STANDARD.md §5.3).
"""

import threading
from pathlib import Path
from typing import Literal

from browser import open_edge, wait_for_sign_in
from facebook import Facebook
from hawkeye_hub import Backend, Context, Model, RpcError
from playwright.sync_api import sync_playwright
from update import DELAY_SECONDS, UpdateResult, group_id, run_update

app = Backend()
# The browser profile is one Edge at a time, so Sign in (and the Update run) holds this throughout.
edge = threading.Lock()
stopping = threading.Event()


class Empty(Model):
    pass


class SignInResult(Model):
    outcome: Literal["signed-in", "cancelled"]


@app.request("signIn")
def sign_in(ctx: Context, p: Empty) -> SignInResult:
    if not edge.acquire(blocking=False):
        raise RpcError("already-running", "Edge is already open for this Plugin")
    try:
        stopping.clear()  # a Stop from an earlier Update run
        with sync_playwright() as pw:
            window = open_edge(pw, ctx.data_dir / "browser-profile")
            return SignInResult(outcome=wait_for_sign_in(window, stopping))
    finally:
        edge.release()


class Update(Model):
    group: str  # what staff typed: a group URL or a bare id
    output: Path
    stop_at_known: bool


@app.request("update")
def update(ctx: Context, p: Update) -> UpdateResult:
    if not p.output.is_dir():
        raise RpcError("folder-missing", f"{p.output} is not a folder")
    group = group_id(p.group)
    if not edge.acquire(blocking=False):
        raise RpcError("already-running", "Edge is already open for this Plugin")
    try:
        stopping.clear()  # a Stop from an earlier run
        with sync_playwright() as pw:
            window = open_edge(pw, ctx.data_dir / "browser-profile")
            try:
                facebook = Facebook(window, group, stopping)
                return run_update(
                    feed=facebook,
                    tab=facebook,
                    output=p.output,
                    group=group,
                    stop_at_known=p.stop_at_known,
                    stopping=stopping,
                    notify=lambda progress: ctx.notify("progress", progress),
                    delay_seconds=DELAY_SECONDS,
                )
            finally:
                # A no-op once staff have closed it (BrowserContext.close returns when
                # _closing_or_closed, which its close event sets; read in Playwright 1.64's source).
                window.close()
    finally:
        edge.release()


@app.notification("cancel")
def on_cancel(ctx: Context, p: Empty) -> None:
    stopping.set()  # the run stops between files, between posts, or between a post's images


@app.notification("shutdown")
def on_shutdown(ctx: Context, p: Empty) -> None:
    stopping.set()  # as cancel; Sign in closes its Edge window rather than keep the Backend alive


if __name__ == "__main__":
    app.serve()
