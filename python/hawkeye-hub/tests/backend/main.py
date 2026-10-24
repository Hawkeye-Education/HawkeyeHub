"""A fixture Backend on the SDK, driven by tests/test_sdk.py through hawkeye_hub.testing."""

import threading

from hawkeye_hub import Backend, Context, Model, RpcError

app = Backend()
released = threading.Event()


class Echo(Model):
    text: str
    repeat_count: int


class Echoed(Model):
    texts: list[str]


class Started(Model):
    data_dir: str
    stores: dict[str, str]
    hub_api: str


class Empty(Model):
    pass


class Ping(Model):
    n: int


@app.request("echo")
def echo(ctx: Context, p: Echo) -> Echoed:
    print("a stray print goes to stderr, not the protocol")
    return Echoed(texts=[p.text] * p.repeat_count)


@app.request("started")
def started(ctx: Context, p: Empty) -> Started:
    return Started(
        data_dir=str(ctx.data_dir),
        stores={name: str(path) for name, path in ctx.stores.items()},
        hub_api=ctx.hub_api,
    )


@app.request("fail")
def fail(ctx: Context, p: Empty) -> Empty:
    raise RpcError("asked-to-fail", "Asked to fail")


@app.request("crash")
def crash(ctx: Context, p: Empty) -> Empty:
    raise ValueError("a bug in the handler")


@app.request("waitForRelease")
def wait_for_release(ctx: Context, p: Empty) -> Empty:
    released.wait()
    return Empty()


@app.notification("release")
def on_release(ctx: Context, p: Empty) -> None:
    released.set()


@app.notification("ping")
def on_ping(ctx: Context, p: Ping) -> None:
    ctx.notify("pong", Ping(n=p.n + 1))


@app.notification("shutdown")
def on_shutdown(ctx: Context, p: Empty) -> None:
    (ctx.data_dir / "shut-down").write_text("✓", encoding="utf-8")


if __name__ == "__main__":
    app.serve()
