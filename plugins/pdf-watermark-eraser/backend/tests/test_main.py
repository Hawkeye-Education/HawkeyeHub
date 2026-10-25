"""The Backend through its protocol, over real stdio, as the Hub drives it (§9.2)."""

import threading
from collections.abc import Generator
from pathlib import Path
from typing import Any

import pymupdf
import pytest
from hawkeye_hub.testing import BackendFailed, RunningBackend, run_backend

BACKEND = Path(__file__).parent.parent
pdf: Any = pymupdf  # PyMuPDF ships no types for most of its API, as erase.py notes
WATERMARK = "Provided by dse.life"
BODY = "Quarterly report"


def make_pdf(path: Path, *, pages: int = 1, watermark: str = WATERMARK) -> None:
    doc = pdf.open()
    for _ in range(pages):
        page = doc.new_page()
        page.insert_text((72, 100), BODY)
        page.insert_text((100, 500), watermark, fontsize=40)
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(path)


def text_of(path: Path) -> str:
    with pdf.open(path) as doc:
        return "".join(page.get_text() for page in doc)


@pytest.fixture
def backend(tmp_path: Path) -> Generator[RunningBackend]:
    with run_backend(BACKEND, data_dir=tmp_path / "data", stores={}, hub_api="1.3.0") as running:
        yield running


def run_params(src: Path, dst: Path, pattern: str, *, regex: bool = True) -> dict[str, object]:
    return {
        "input": str(src),
        "output": str(dst),
        "pattern": pattern,
        "regex": regex,
        "ignoreCase": False,
    }


def test_run_erases_the_watermark_from_nested_pdfs_into_the_output_folder(
    tmp_path: Path, backend: RunningBackend
) -> None:
    make_pdf(tmp_path / "in" / "sub" / "a.pdf")

    result = backend.request(
        "run", run_params(tmp_path / "in", tmp_path / "out", r"Provided\s+by\s+dse\.life")
    )

    assert result == {"cleaned": 1, "failed": 0, "total": 1, "cancelled": False}
    assert backend.notifications("progress") == [
        {"done": 1, "total": 1, "file": "sub/a.pdf", "result": {"kind": "cleaned", "removed": 1}}
    ]
    cleaned = text_of(tmp_path / "out" / "sub" / "a.pdf")
    assert BODY in cleaned
    assert "dse.life" not in cleaned


def save_locked(path: Path, text: str) -> None:
    doc = pdf.open()
    doc.new_page().insert_text((72, 100), text)
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(path, encryption=pdf.PDF_ENCRYPT_AES_256, user_pw="u", owner_pw="o")


def test_run_reports_each_file_that_cannot_be_cleaned_and_writes_none_of_them(
    tmp_path: Path, backend: RunningBackend
) -> None:
    make_pdf(tmp_path / "in" / "a.pdf", watermark="Something else")
    save_locked(tmp_path / "in" / "b.pdf", WATERMARK)
    (tmp_path / "in" / "c.pdf").write_bytes(b"not a pdf")

    result = backend.request("run", run_params(tmp_path / "in", tmp_path / "out", "dse.life"))

    assert result == {"cleaned": 0, "failed": 3, "total": 3, "cancelled": False}
    kinds = [(n["file"], n["result"]["kind"]) for n in backend.notifications("progress")]
    assert kinds == [("a.pdf", "no-match"), ("b.pdf", "password"), ("c.pdf", "error")]
    assert list((tmp_path / "out").rglob("*.pdf")) == []


def test_a_literal_pattern_is_not_a_regex(tmp_path: Path, backend: RunningBackend) -> None:
    make_pdf(tmp_path / "in" / "a.pdf", watermark="dseXlife")

    result = backend.request(
        "run", run_params(tmp_path / "in", tmp_path / "out", "dse.life", regex=False)
    )

    assert result["cleaned"] == 0


@pytest.mark.parametrize(
    ("output", "pattern", "reason"),
    [
        ("out", "", "pattern-empty"),
        ("out", "  ", "pattern-empty"),
        ("out", "(unclosed", "pattern-invalid"),
        ("in", "x", "same-folder"),
        ("in/out", "x", "output-inside-input"),
    ],
)
def test_run_refuses_bad_input(
    tmp_path: Path, backend: RunningBackend, output: str, pattern: str, reason: str
) -> None:
    (tmp_path / "in").mkdir()

    with pytest.raises(BackendFailed) as failed:
        backend.request("run", run_params(tmp_path / "in", tmp_path / output, pattern))

    assert failed.value.reason == reason


def test_run_refuses_a_missing_input_folder(tmp_path: Path, backend: RunningBackend) -> None:
    with pytest.raises(BackendFailed) as failed:
        backend.request("run", run_params(tmp_path / "gone", tmp_path / "out", "x"))

    assert failed.value.reason == "folder-missing"


MANY = 40


def make_many(folder: Path) -> None:
    for i in range(MANY):
        make_pdf(folder / f"{i:02}.pdf", pages=5)


def start_run(backend: RunningBackend, src: Path, dst: Path) -> tuple[threading.Thread, list[Any]]:
    """Starts a run on its own thread, since `request` blocks; its result lands in the list."""
    answer: list[Any] = []
    thread = threading.Thread(
        target=lambda: answer.append(backend.request("run", run_params(src, dst, "dse"))),
    )
    thread.start()
    backend.wait_for("progress", 1, 30)
    return thread, answer


def test_cancel_stops_a_run_between_files(tmp_path: Path, backend: RunningBackend) -> None:
    make_many(tmp_path / "in")
    thread, answer = start_run(backend, tmp_path / "in", tmp_path / "out")

    backend.notify("cancel", {})
    thread.join()

    [result] = answer
    assert result["cancelled"] is True
    assert result["total"] == MANY
    assert result["cleaned"] < MANY


def test_a_second_run_is_refused_while_one_is_running(
    tmp_path: Path, backend: RunningBackend
) -> None:
    make_many(tmp_path / "in")
    thread, _ = start_run(backend, tmp_path / "in", tmp_path / "out")

    with pytest.raises(BackendFailed) as failed:
        backend.request("run", run_params(tmp_path / "in", tmp_path / "out2", "dse"))
    backend.notify("cancel", {})
    thread.join()

    assert failed.value.reason == "already-running"


def test_shutdown_mid_run_leaves_only_whole_pdfs(tmp_path: Path) -> None:
    make_many(tmp_path / "in")
    with run_backend(BACKEND, data_dir=tmp_path / "data", stores={}, hub_api="1.3.0") as backend:
        thread, _ = start_run(backend, tmp_path / "in", tmp_path / "out")
    thread.join()

    written = list((tmp_path / "out").iterdir())
    assert 0 < len(written) < MANY
    for path in written:
        assert path.suffix == ".pdf"
        assert BODY in text_of(path)


def test_list_pdfs_lists_every_pdf_under_the_folder(
    tmp_path: Path, backend: RunningBackend
) -> None:
    make_pdf(tmp_path / "in" / "b.PDF")
    make_pdf(tmp_path / "in" / "sub" / "a.pdf")
    (tmp_path / "in" / "notes.txt").write_text("not a pdf")

    assert backend.request("listPdfs", {"folder": str(tmp_path / "in")}) == {
        "files": ["b.PDF", "sub/a.pdf"]
    }


def test_page_text_gives_the_lines_and_those_repeated_on_most_pages(
    tmp_path: Path, backend: RunningBackend
) -> None:
    doc = pdf.open()
    for i in range(3):
        page = doc.new_page()
        page.insert_text((72, 100), f"Page {i} body")
        page.insert_text((100, 500), WATERMARK)
    (tmp_path / "in").mkdir()
    doc.save(tmp_path / "in" / "a.pdf")

    result = backend.request(
        "pageText", {"folder": str(tmp_path / "in"), "file": "a.pdf", "page": 1}
    )

    assert result == {"lines": ["Page 1 body", WATERMARK], "repeated": [WATERMARK]}


@pytest.mark.parametrize(("file", "page"), [("a.pdf", 1), ("../a.pdf", 0), ("b.pdf", 0)])
def test_page_text_refuses_a_page_or_file_that_is_not_there(
    tmp_path: Path, backend: RunningBackend, file: str, page: int
) -> None:
    make_pdf(tmp_path / "in" / "a.pdf")
    make_pdf(tmp_path / "a.pdf")

    with pytest.raises(BackendFailed) as failed:
        backend.request("pageText", {"folder": str(tmp_path / "in"), "file": file, "page": page})

    assert failed.value.reason == "invalid-params"


def test_page_text_refuses_a_password_protected_pdf(
    tmp_path: Path, backend: RunningBackend
) -> None:
    save_locked(tmp_path / "in" / "a.pdf", WATERMARK)

    with pytest.raises(BackendFailed) as failed:
        backend.request("pageText", {"folder": str(tmp_path / "in"), "file": "a.pdf", "page": 0})

    assert failed.value.reason == "password"
