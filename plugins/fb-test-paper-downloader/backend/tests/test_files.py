"""The Files-tab writer: a file lands under its final name whole, or not at all."""

from pathlib import Path

import pytest
from files import write_file


def files_under(folder: Path) -> list[str]:
    return sorted(p.relative_to(folder).as_posix() for p in folder.rglob("*") if p.is_file())


def test_a_saved_file_lands_under_its_final_name(tmp_path: Path) -> None:
    dest = tmp_path / "files" / "P4" / "數學" / "P.4考試二.數學卷.pdf"

    write_file(dest, lambda to: to.write_bytes(b"%PDF-1.7"))

    assert dest.read_bytes() == b"%PDF-1.7"
    assert files_under(tmp_path) == ["files/P4/數學/P.4考試二.數學卷.pdf"]


def test_an_interrupted_download_leaves_no_partial_file(tmp_path: Path) -> None:
    dest = tmp_path / "files" / "P4" / "數學" / "卷.pdf"

    def half_then_drop(to: Path) -> None:
        to.write_bytes(b"%PDF-1.7 half")
        raise ConnectionError("the download was cut off")

    with pytest.raises(ConnectionError):
        write_file(dest, half_then_drop)

    assert files_under(tmp_path) == []


def test_a_file_left_half_written_by_a_killed_backend_is_written_afresh(tmp_path: Path) -> None:
    dest = tmp_path / "卷.pdf"
    (tmp_path / ".partial-卷.pdf").write_bytes(b"stale")

    write_file(dest, lambda to: to.write_bytes(b"whole"))

    assert files_under(tmp_path) == ["卷.pdf"]
    assert dest.read_bytes() == b"whole"
