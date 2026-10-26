"""The file store: files/<Level>/<Subject>/<name>, one file per Files-tab entry.

A file is done once it exists under its final name, so each is downloaded to a temp file beside
it and `os.replace`d into place: a stopped or killed run never leaves a partial file there.
"""

import os
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from classify import classify_level, classify_subject, safe_name


@dataclass(frozen=True)
class FileRow:
    row_id: str  # the mark the Files tab's script left on the row, for its Download menu
    name: str  # the file name Facebook shows
    href: str  # the row's link, as Facebook gave it


class FilesTab(Protocol):
    """The group's Files tab, as the run sees it."""

    def file_rows(self) -> Iterator[Sequence[FileRow]]:
        """The rows each scroll of the Files tab reveals, until it stops growing."""
        ...

    def save_file(self, row: FileRow, to: Path) -> None:
        """Downloads the row's file to `to`; raises when no download route worked."""
        ...


def file_dest(files: Path, name: str) -> Path:
    return files / classify_level(name) / classify_subject(name) / safe_name(name, 150)


def write_file(dest: Path, save: Callable[[Path], object]) -> None:
    """Runs `save` on a temp file beside `dest`, then renames it to `dest`. Any error from `save`
    propagates, and the temp file is removed."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    temp = dest.with_name(f".partial-{dest.name}")
    temp.unlink(missing_ok=True)  # left by a Backend killed mid-download
    try:
        save(temp)
        os.replace(temp, dest)
    except BaseException:
        temp.unlink(missing_ok=True)
        raise
