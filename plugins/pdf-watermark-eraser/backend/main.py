"""The PDF Watermark Eraser's Backend. The Hub runs it as a script with the venv's Python.

Its protocol's other half is ui-src/protocol.ts. Rejections carry a reason the Plugin UI translates
(PLUGIN_STANDARD.md §5.3).
"""

import re
import threading
from collections import Counter
from pathlib import Path
from typing import Annotated, Literal

from erase import PasswordProtected, open_pdf, page_lines, remove_watermark
from hawkeye_hub import Backend, Context, Model, RpcError
from pydantic import Field

app = Backend()
cancelled = threading.Event()
running = threading.Lock()


class Run(Model):
    input: Path
    output: Path
    pattern: str
    regex: bool
    ignore_case: bool


class RunResult(Model):
    cleaned: int
    failed: int
    total: int
    cancelled: bool


class Cleaned(Model):
    kind: Literal["cleaned"]
    removed: int


class NoMatch(Model):
    kind: Literal["no-match"]


class Password(Model):
    kind: Literal["password"]


class Failed(Model):
    kind: Literal["error"]
    detail: str


FileResult = Annotated[Cleaned | NoMatch | Password | Failed, Field(discriminator="kind")]


class Progress(Model):
    done: int
    total: int
    file: str
    result: FileResult


class Empty(Model):
    pass


def _folder(path: Path) -> Path:
    if not path.is_dir():
        raise RpcError("folder-missing", f"{path} is not a folder")
    return path


def _pdfs(folder: Path) -> list[Path]:
    return sorted(f for f in folder.rglob("*") if f.is_file() and f.suffix.lower() == ".pdf")


def _erase(src: Path, dst: Path, rx: re.Pattern[str]) -> Cleaned | NoMatch | Password | Failed:
    dst.parent.mkdir(parents=True, exist_ok=True)
    try:
        removed = remove_watermark(src, dst, rx)
    except PasswordProtected:
        return Password(kind="password")
    except Exception as e:  # noqa: BLE001 - reported to staff per file, so one damaged PDF doesn't stop the batch
        return Failed(kind="error", detail=f"{type(e).__name__}: {e}")
    return Cleaned(kind="cleaned", removed=removed) if removed else NoMatch(kind="no-match")


class ListPdfs(Model):
    folder: Path


class ListPdfsResult(Model):
    files: list[str]


@app.request("listPdfs")
def list_pdfs(ctx: Context, p: ListPdfs) -> ListPdfsResult:
    folder = _folder(p.folder)
    return ListPdfsResult(files=[f.relative_to(folder).as_posix() for f in _pdfs(folder)])


class PageText(Model):
    folder: Path
    file: str  # relative POSIX path, as listPdfs gave it
    page: int  # 0-based


class PageTextResult(Model):
    page_count: int
    lines: list[str]
    repeated: list[str]  # the page's lines found on most pages, usually the watermark


# ponytail: samples the first pages only; widen if watermarks appear late in long files.
REPEAT_SAMPLE_PAGES = 20
REPEAT_SHARE = 0.8


@app.request("pageText")
def page_text(ctx: Context, p: PageText) -> PageTextResult:
    folder = _folder(p.folder).resolve()
    path = (folder / p.file).resolve()
    if not (path.is_relative_to(folder) and path.is_file()):
        raise RpcError("invalid-params", f"{p.file} is not a file in {folder}")
    try:
        doc = open_pdf(path)
    except PasswordProtected as e:
        raise RpcError("password", f"{p.file} is password protected") from e
    try:
        if not 0 <= p.page < doc.page_count:
            raise RpcError("invalid-params", f"{p.file} has no page {p.page}")
        lines = list(page_lines(doc, p.page))
        sample = range(min(doc.page_count, REPEAT_SAMPLE_PAGES))
        seen = Counter(line for pno in sample for line in page_lines(doc, pno))
        repeated = [
            line for line in lines if len(sample) > 1 and seen[line] >= REPEAT_SHARE * len(sample)
        ]
        return PageTextResult(page_count=doc.page_count, lines=lines, repeated=repeated)
    finally:
        doc.close()


@app.request("run")
def run(ctx: Context, p: Run) -> RunResult:
    src = _folder(p.input)
    if not p.pattern.strip():
        raise RpcError("pattern-empty", "the pattern is empty")
    if src.resolve() == p.output.resolve():
        raise RpcError("same-folder", "input and output are the same folder")
    if src.resolve() in p.output.resolve().parents:
        raise RpcError("output-inside-input", "the output folder is inside the input folder")
    try:
        rx = re.compile(
            p.pattern if p.regex else re.escape(p.pattern), re.IGNORECASE if p.ignore_case else 0
        )
    except re.error as e:
        raise RpcError("pattern-invalid", str(e)) from e
    if not running.acquire(blocking=False):
        raise RpcError("already-running", "a run is already in progress")
    try:
        cancelled.clear()
        files = _pdfs(src)
        cleaned = done = 0
        for f in files:
            if cancelled.is_set():
                break
            rel = f.relative_to(src)  # the output keeps the input's subfolders
            result = _erase(f, p.output / rel, rx)
            cleaned += isinstance(result, Cleaned)
            done += 1
            ctx.notify(
                "progress",
                Progress(done=done, total=len(files), file=rel.as_posix(), result=result),
            )
        return RunResult(
            cleaned=cleaned, failed=done - cleaned, total=len(files), cancelled=cancelled.is_set()
        )
    finally:
        running.release()


@app.notification("cancel")
def on_cancel(ctx: Context, p: Empty) -> None:
    cancelled.set()


@app.notification("shutdown")
def on_shutdown(ctx: Context, p: Empty) -> None:
    cancelled.set()  # stop between files, so no half-written PDF is left behind


if __name__ == "__main__":
    app.serve()
