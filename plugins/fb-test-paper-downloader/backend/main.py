"""The Facebook Test Paper Downloader's Backend. The Hub runs it as a script with the venv's Python.

Its protocol's other half is ui-src/protocol.ts. Rejections carry a reason the Plugin UI translates
(PLUGIN_STANDARD.md §5.3).
"""

import threading
from typing import Literal

from browser import open_edge, wait_for_sign_in
from hawkeye_hub import Backend, Context, Model, RpcError
from playwright.sync_api import sync_playwright

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
        with sync_playwright() as pw:
            window = open_edge(pw, ctx.data_dir / "browser-profile")
            return SignInResult(outcome=wait_for_sign_in(window, stopping))
    finally:
        edge.release()


@app.notification("shutdown")
def on_shutdown(ctx: Context, p: Empty) -> None:
    stopping.set()  # Sign in closes its Edge window rather than keep the Backend alive


if __name__ == "__main__":
    app.serve()
