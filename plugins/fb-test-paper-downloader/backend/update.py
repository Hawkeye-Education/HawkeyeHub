"""The Update run: save the Files tab, scan the group feed newest first, then download new posts.

Facebook itself is behind `FilesTab` and `Feed`, so this runs against stand-ins in tests: no test
opens Facebook.
"""

import random
import re
import threading
from collections.abc import Callable, Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal, Protocol

from classify import is_incomplete, is_not_paper, post_title
from files import FileRow, FilesTab, file_dest, write_file
from hawkeye_hub import Model, RpcError
from playwright._impl._errors import TargetClosedError  # the closed-window error, as browser.py
from posts import Stopped, known_post_ids, write_post
from pydantic import Field

GroupId = str  # digits only: what `group_id` returns


def group_id(group: str) -> GroupId:
    """The id in a full group URL or a bare id, as staff typed it."""
    m = re.fullmatch(
        r"\s*(?:(?:https?://)?(?:(?:www|m|web)\.)?facebook\.com/groups/)?(\d+)(?:[/?#]\S*)?\s*",
        group,
    )
    if m is None:
        raise RpcError("group-invalid", f"{group!r} is not a Facebook group URL or id")
    return m.group(1)


# Fixed, as fb_papers.py ran them; not staff settings.
POSTS_PER_RUN = 30  # papers queued and downloaded per run, to keep each session gentle
KNOWN_STREAK = 15  # known posts in a row that end the scan when staff stop at known posts
BAD_STREAK = 4  # incomplete or failed posts in a row: Facebook is limiting the account
DELAY_SECONDS = 3.0  # between two posts, stretched by up to 60% at random


@dataclass(frozen=True)
class FeedPost:
    post_id: str
    photo_url: str
    text: str
    shown: int  # images the feed showed for the post: the viewer should give about as many


class Feed(Protocol):
    """Facebook, as the run sees it."""

    def scan(self) -> Iterator[Sequence[FeedPost]]:
        """The posts each scroll of the feed reveals, newest first, until it stops growing."""
        ...

    def images(self, post: FeedPost) -> list[str]:
        """The post's image URLs, from its photo viewer. Raises Stopped once stopping."""
        ...

    def fetch(self, src: str) -> bytes: ...


class Saved(Model):
    kind: Literal["saved"]


class SkippedNotPaper(Model):
    kind: Literal["skipped-not-paper"]


class Incomplete(Model):
    kind: Literal["incomplete"]
    saved: int
    shown: int


class Failed(Model):
    kind: Literal["failed"]
    detail: str


class SkippedKnown(Model):
    kind: Literal["skipped-known"]  # a file of that name is already on disk


PostResult = Saved | SkippedNotPaper | Incomplete | Failed
FileResult = Saved | SkippedKnown | Failed


class FilesProgress(Model):
    phase: Literal["files"]
    done: int
    total: int
    item: str  # the file's name
    result: Annotated[FileResult, Field(discriminator="kind")]


class ScanProgress(Model):
    phase: Literal["scan"]
    found: int  # new posts queued so far; the feed's length is unknown until the scan ends


class PostProgress(Model):
    phase: Literal["posts"]
    done: int
    total: int
    item: str  # the post's title
    result: Annotated[PostResult, Field(discriminator="kind")]


Progress = FilesProgress | ScanProgress | PostProgress
Outcome = Literal["finished", "cancelled", "bad-streak"]


class UpdateResult(Model):
    files_saved: int
    files_known: int
    files_failed: int
    saved: int
    skipped_not_paper: int
    incomplete: int
    failed: int
    # bad-streak: BAD_STREAK bad posts in a row ended it; cancelled: Stop, shutdown or a closed Edge
    outcome: Outcome


def run_update(
    feed: Feed,
    tab: FilesTab,
    output: Path,
    group: GroupId,
    stop_at_known: bool,
    stopping: threading.Event,
    notify: Callable[[Progress], None],
    delay_seconds: float,
) -> UpdateResult:
    """Saves the Files tab into output/files, then scans the feed and downloads into output/posts.
    The queue lives only here: disk is the resume state.

    signed-out, checkpoint and blocked (RpcError) propagate and end the run.
    """
    files: list[FileResult] = []
    results: list[PostResult] = []

    def ended(outcome: Outcome) -> UpdateResult:
        def count(kind: type[PostResult]) -> int:
            return sum(isinstance(r, kind) for r in results)

        def count_files(kind: type[FileResult]) -> int:
            return sum(isinstance(r, kind) for r in files)

        return UpdateResult(
            files_saved=count_files(Saved),
            files_known=count_files(SkippedKnown),
            files_failed=count_files(Failed),
            saved=count(Saved),
            skipped_not_paper=count(SkippedNotPaper),
            incomplete=count(Incomplete),
            failed=count(Failed),
            outcome=outcome,
        )

    posts = output / "posts"
    try:
        rows = _file_rows(tab, stopping)
        for done, row in enumerate(rows, 1):
            if stopping.is_set():
                return ended("cancelled")
            dest = file_dest(output / "files", row.name)
            # ponytail: a name on disk is done, so distinct files sharing a name are skipped
            result = SkippedKnown(kind="skipped-known") if dest.exists() else _save(tab, row, dest)
            files.append(result)
            notify(
                FilesProgress(
                    phase="files", done=done, total=len(rows), item=row.name, result=result
                )
            )
            if not isinstance(result, SkippedKnown) and done < len(rows):
                stopping.wait(random.uniform(delay_seconds, delay_seconds * 1.6))
        if stopping.is_set():
            return ended("cancelled")
        queue = _scan(feed, known_post_ids(posts), stop_at_known, stopping, notify)
        bad = 0
        for done, post in enumerate(queue, 1):
            if stopping.is_set():
                return ended("cancelled")
            result = _download(feed, posts, group, post, stopping)
            results.append(result)
            item = post_title(post.text)
            notify(
                PostProgress(phase="posts", done=done, total=len(queue), item=item, result=result)
            )
            if isinstance(result, SkippedNotPaper):
                continue
            bad = bad + 1 if isinstance(result, Incomplete | Failed) else 0
            if bad >= BAD_STREAK:
                return ended("bad-streak")
            if done < len(queue):
                stopping.wait(random.uniform(delay_seconds, delay_seconds * 1.6))
        return ended("cancelled" if stopping.is_set() else "finished")
    except (Stopped, TargetClosedError):  # Stop or shutdown mid-post, or staff closed Edge
        return ended("cancelled")


def _file_rows(tab: FilesTab, stopping: threading.Event) -> list[FileRow]:
    """Every row of the Files tab, once each. Raises Stopped once stopping."""
    rows: dict[tuple[str, str], FileRow] = {}
    for batch in tab.file_rows():
        if stopping.is_set():
            raise Stopped()
        for row in batch:
            rows.setdefault((row.name, row.href), row)
    return list(rows.values())


def _save(tab: FilesTab, row: FileRow, dest: Path) -> FileResult:
    try:
        write_file(dest, lambda to: tab.save_file(row, to))
        return Saved(kind="saved")
    except (RpcError, TargetClosedError):
        raise
    except Exception as e:  # noqa: BLE001 - reported to staff per file, so one bad file does not stop the run
        return Failed(kind="failed", detail=f"{type(e).__name__}: {e}")


def _scan(
    feed: Feed,
    known: set[str],
    stop_at_known: bool,
    stopping: threading.Event,
    notify: Callable[[Progress], None],
) -> list[FeedPost]:
    """The new posts to download, up to POSTS_PER_RUN papers. Raises Stopped once stopping."""
    queue: list[FeedPost] = []
    seen = set(known)
    papers = known_streak = 0
    for batch in feed.scan():
        if stopping.is_set():
            raise Stopped()
        for post in batch:
            if post.post_id in seen:
                known_streak += 1
                continue
            known_streak = 0
            seen.add(post.post_id)
            queue.append(post)
            papers += not is_not_paper(post.text, post.shown)
            if papers >= POSTS_PER_RUN:
                break
        notify(ScanProgress(phase="scan", found=len(queue)))
        if papers >= POSTS_PER_RUN or (stop_at_known and known_streak >= KNOWN_STREAK):
            break
    return queue


def _download(
    feed: Feed, posts: Path, group: GroupId, post: FeedPost, stopping: threading.Event
) -> PostResult:
    if is_not_paper(post.text, post.shown):
        return SkippedNotPaper(kind="skipped-not-paper")
    try:
        images = feed.images(post)
        if not images:
            return Failed(kind="failed", detail="no images found in the photo viewer")
        if is_incomplete(len(images), post.shown):  # nothing is written: the next run retries it
            return Incomplete(kind="incomplete", saved=len(images), shown=post.shown)
        url = (
            f"https://www.facebook.com/groups/{group}/posts/{post.post_id}/"
            if post.post_id.isdigit()
            else post.photo_url  # a single-photo post has no post id, only its photo's
        )
        write_post(posts, post.post_id, url, post.text, images, feed.fetch, stopping)
        return Saved(kind="saved")
    except (RpcError, Stopped, TargetClosedError):
        raise
    except Exception as e:  # noqa: BLE001 - reported to staff per post, so one bad post does not stop the run
        return Failed(kind="failed", detail=f"{type(e).__name__}: {e}")
