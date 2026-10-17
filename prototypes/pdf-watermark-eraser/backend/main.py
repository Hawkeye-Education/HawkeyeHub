"""PDF Watermark Eraser Backend. The Hub runs it as `<venv>/python backend/main.py`.

Errors carry a `reason` code, never English text: a Backend has no Display Language (ADR 0007),
so the Plugin UI turns the reason into words.
"""
import re
import threading
from collections import Counter
from pathlib import Path

import pymupdf
from hawkeye_hub import INVALID_PARAMS, Backend, Context, RpcError

from erase import PasswordProtected, page_lines, remove_watermark

app = Backend()
cancel = threading.Event()
running = threading.Lock()


def _arg(p: dict, key: str, kind: type):
    if not isinstance(p.get(key), kind):
        raise RpcError(INVALID_PARAMS, f"{key} must be {kind.__name__}", {"reason": "bad-param", "field": key})
    return p[key]


def _folder(p: dict, key: str) -> Path:
    path = Path(_arg(p, key, str))
    if not path.is_dir():
        raise RpcError(INVALID_PARAMS, f"{key} is not a folder", {"reason": "folder-missing", "field": key})
    return path


def _pdfs(src: Path) -> list[Path]:
    return sorted(f for f in src.rglob("*") if f.is_file() and f.suffix.lower() == ".pdf")


@app.request("listPdfs")
def list_pdfs(ctx: Context, p: dict) -> dict:
    src = _folder(p, "folder")
    return {"files": [f.relative_to(src).as_posix() for f in _pdfs(src)]}


@app.request("pageText")
def page_text(ctx: Context, p: dict) -> dict:
    """One page's text lines, plus the lines that appear on most pages (usually the watermark)."""
    path = _folder(p, "folder") / _arg(p, "file", str)
    page = _arg(p, "page", int)
    with pymupdf.open(path) as doc:
        if doc.needs_pass:
            raise RpcError(INVALID_PARAMS, "password protected", {"reason": "password"})
        if not 0 <= page < doc.page_count:
            raise RpcError(INVALID_PARAMS, "no such page", {"reason": "bad-param", "field": "page"})
        lines = list(page_lines(doc, page))
        # ponytail: samples the first 20 pages only; widen if watermarks appear late in long files
        sample = range(min(doc.page_count, 20))
        seen = Counter(line for pno in sample for line in page_lines(doc, pno))
        repeated = [l for l in lines if len(sample) > 1 and seen[l] >= 0.8 * len(sample)]
        return {"pageCount": doc.page_count, "lines": lines, "repeated": repeated}


@app.request("run")
def run(ctx: Context, p: dict) -> dict:
    src, dst = _folder(p, "input"), Path(_arg(p, "output", str))
    pattern = _arg(p, "pattern", str).strip()
    is_regex, ignore_case = _arg(p, "regex", bool), _arg(p, "ignoreCase", bool)
    if not pattern:
        raise RpcError(INVALID_PARAMS, "pattern is empty", {"reason": "pattern-empty"})
    if src.resolve() == dst.resolve():
        raise RpcError(INVALID_PARAMS, "same folder", {"reason": "same-folder"})
    if src.resolve() in dst.resolve().parents:
        raise RpcError(INVALID_PARAMS, "output inside input", {"reason": "output-inside-input"})
    try:
        rx = re.compile(pattern if is_regex else re.escape(pattern), re.I if ignore_case else 0)
    except re.error as e:
        raise RpcError(INVALID_PARAMS, str(e), {"reason": "pattern-invalid", "detail": str(e)})
    if not running.acquire(blocking=False):
        raise RpcError(INVALID_PARAMS, "already running", {"reason": "already-running"})
    try:
        cancel.clear()
        files = _pdfs(src)
        dst.mkdir(parents=True, exist_ok=True)
        cleaned = done = 0
        for f in files:
            if cancel.is_set():
                break
            rel = f.relative_to(src)  # keep subfolder structure in the output
            try:
                target = dst / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                if n := remove_watermark(f, target, rx):
                    cleaned += 1
                    result = {"kind": "cleaned", "removed": n}
                else:
                    result = {"kind": "no-match"}
            except PasswordProtected:
                result = {"kind": "password"}
            except Exception as e:
                result = {"kind": "error", "detail": f"{type(e).__name__}: {e}"}
            done += 1
            ctx.notify("progress", {"done": done, "total": len(files), "file": rel.as_posix(), "result": result})
        return {"cleaned": cleaned, "failed": done - cleaned, "total": len(files), "cancelled": cancel.is_set()}
    finally:
        running.release()


@app.notification("cancel")
def on_cancel(ctx: Context, p: dict) -> None:
    cancel.set()


@app.notification("shutdown")
def on_shutdown(ctx: Context, p: dict) -> None:
    cancel.set()  # stop between files so no half-written PDF is left behind


if __name__ == "__main__":
    app.serve()
