"""The Update run's feed scan and post download, against a stand-in feed: no test opens Facebook.

Cancel and `shutdown` mid-run are tested here rather than over stdio (a documented deviation from
PLUGIN_STANDARD.md §9.2): no run can start without Facebook. Both set the same `stopping` event.
"""

import io
import threading
from collections.abc import Callable, Iterator, Sequence
from pathlib import Path

import pytest
from hawkeye_hub import RpcError
from PIL import Image
from playwright._impl._errors import TargetClosedError
from posts import Stopped, known_post_ids, write_post
from update import (
    BAD_STREAK,
    KNOWN_STREAK,
    POSTS_PER_RUN,
    FeedPost,
    Progress,
    UpdateResult,
    group_id,
    run_update,
)

GROUP = "460403882433823"


def png() -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (20, 30), "white").save(out, "PNG")
    return out.getvalue()


PNG = png()


def paper(post_id: str, text: str = "P3 數學 測驗", shown: int = 2) -> FeedPost:
    return FeedPost(
        post_id=post_id, photo_url=f"https://fb/photo/?set=pcb.{post_id}", text=text, shown=shown
    )


class FakeFeed:
    """Yields `batches` as scroll rounds. A post's viewer shows `shown` images, or `viewer`'s."""

    def __init__(self, batches: Sequence[Sequence[FeedPost]], stopping: threading.Event) -> None:
        self.batches = batches
        self.stopping = stopping
        self.rounds = 0
        self.opened: list[str] = []
        self.viewer: dict[str, list[str] | Exception] = {}  # what opening a post gives
        self.fetcher: Callable[[str], bytes] = lambda src: PNG

    def scan(self) -> Iterator[Sequence[FeedPost]]:
        for batch in self.batches:
            self.rounds += 1
            yield batch

    def images(self, post: FeedPost) -> list[str]:
        self.opened.append(post.post_id)
        if post.post_id in self.viewer:
            shows = self.viewer[post.post_id]
            if isinstance(shows, Exception):
                raise shows
            return shows
        return [f"https://cdn/{post.post_id}/{i}" for i in range(post.shown)]

    def fetch(self, src: str) -> bytes:
        return self.fetcher(src)


class Run:
    def __init__(self, tmp_path: Path, batches: Sequence[Sequence[FeedPost]]) -> None:
        self.posts = tmp_path / "posts"
        self.stopping = threading.Event()
        self.feed = FakeFeed(batches, self.stopping)
        self.progress: list[Progress] = []
        self.on_progress: Callable[[Progress], None] = lambda p: None

    def __call__(self, stop_at_known: bool = True) -> UpdateResult:
        return run_update(
            self.feed, self.posts, GROUP, stop_at_known, self.stopping, self.notify, 0
        )

    def notify(self, progress: Progress) -> None:
        self.progress.append(progress)
        self.on_progress(progress)

    def results(self) -> list[tuple[str, str]]:
        return [(p.item, p.result.kind) for p in self.progress if p.phase == "posts"]


def done(post_id: str, posts: Path) -> None:
    """A post an earlier run saved."""
    write_post(posts, post_id, "u", "P1 中文", ["x"], lambda src: PNG, threading.Event())


@pytest.mark.parametrize(
    "group",
    [
        "460403882433823",
        " 460403882433823 ",
        "https://www.facebook.com/groups/460403882433823",
        "https://www.facebook.com/groups/460403882433823/?sorting_setting=CHRONOLOGICAL",
        "facebook.com/groups/460403882433823/",
        "https://m.facebook.com/groups/460403882433823/posts/123/",
    ],
)
def test_a_group_url_or_bare_id_gives_the_group_id(group: str) -> None:
    assert group_id(group) == "460403882433823"


def test_saves_new_papers_newest_first_and_logs_one_line_per_post(tmp_path: Path) -> None:
    run = Run(
        tmp_path,
        [
            [paper("111", "P2 英文 默書"), paper("222", "歡迎新成員", shown=1)],
            [paper("333", "小六 中文 試卷")],
        ],
    )

    result = run()

    assert result == UpdateResult(
        saved=2, skipped_not_paper=1, incomplete=0, failed=0, outcome="finished"
    )
    assert run.results() == [
        ("P2 英文 默書", "saved"),
        ("歡迎新成員", "skipped-not-paper"),
        ("小六 中文 試卷", "saved"),
    ]
    assert [(p.done, p.total) for p in run.progress if p.phase == "posts"] == [
        (1, 3),
        (2, 3),
        (3, 3),
    ]
    assert [p.found for p in run.progress if p.phase == "scan"] == [2, 3]
    assert run.feed.opened == ["111", "333"]  # a non-paper post is never opened
    assert known_post_ids(run.posts) == {"111", "333"}
    [saved] = (run.posts / "P2" / "英文").iterdir()
    assert saved.name == "P2 英文 默書_111"


def test_posts_already_on_disk_are_never_downloaded_again(tmp_path: Path) -> None:
    run = Run(tmp_path, [[paper("111"), paper("222")]])
    done("111", run.posts)

    run()

    assert run.feed.opened == ["222"]


def test_stop_at_known_ends_the_scan_at_posts_downloaded_before(tmp_path: Path) -> None:
    known = [paper(str(1000 + i)) for i in range(KNOWN_STREAK)]
    batches = [[paper("1")], known, [paper("2")]]
    run = Run(tmp_path, batches)
    for post in known:
        done(post.post_id, run.posts)

    run(stop_at_known=True)

    assert run.feed.opened == ["1"]
    assert run.feed.rounds == 2  # it stopped scrolling at the known posts


def test_without_stop_at_known_the_scan_reaches_older_new_posts(tmp_path: Path) -> None:
    known = [paper(str(1000 + i)) for i in range(KNOWN_STREAK)]
    run = Run(tmp_path, [[paper("1")], known, [paper("2")]])
    for post in known:
        done(post.post_id, run.posts)

    run(stop_at_known=False)

    assert run.feed.opened == ["1", "2"]


def test_a_run_downloads_at_most_its_quota_of_papers(tmp_path: Path) -> None:
    feed = [[paper(str(i))] for i in range(POSTS_PER_RUN + 5)]
    run = Run(tmp_path, feed)

    result = run()

    assert result.saved == POSTS_PER_RUN
    assert run.feed.rounds == POSTS_PER_RUN  # the scan stopped once the quota was queued


def test_an_incomplete_post_is_discarded_so_the_next_run_retries_it(tmp_path: Path) -> None:
    run = Run(tmp_path, [[paper("111", shown=10), paper("222")]])
    run.feed.viewer["111"] = ["https://cdn/111/0", "https://cdn/111/1"]  # the viewer cut it short

    result = run()

    assert run.results() == [("P3 數學 測驗", "incomplete"), ("P3 數學 測驗", "saved")]
    assert (result.incomplete, result.saved) == (1, 1)
    assert known_post_ids(run.posts) == {"222"}


def test_a_failed_post_is_reported_and_the_run_goes_on(tmp_path: Path) -> None:
    run = Run(tmp_path, [[paper("111"), paper("222")]])

    def drop(src: str) -> bytes:
        if "/111/" in src:
            raise ConnectionError("the CDN dropped the connection")
        return PNG

    run.feed.fetcher = drop

    result = run()

    [first, _] = [p for p in run.progress if p.phase == "posts"]
    assert first.result.kind == "failed"
    assert "the CDN dropped the connection" in first.result.detail
    assert (result.failed, result.saved) == (1, 1)
    assert known_post_ids(run.posts) == {"222"}


def test_a_post_with_no_images_in_the_viewer_fails(tmp_path: Path) -> None:
    run = Run(tmp_path, [[paper("111")]])
    run.feed.viewer["111"] = []

    assert run().failed == 1


def test_bad_posts_in_a_row_stop_the_run(tmp_path: Path) -> None:
    bad = [paper(str(i)) for i in range(BAD_STREAK)]
    run = Run(tmp_path, [[paper("ok"), *bad, paper("after")]])
    for post in bad:
        run.feed.viewer[post.post_id] = []

    result = run()

    assert result.outcome == "bad-streak"
    assert "after" not in run.feed.opened


def test_a_saved_post_resets_the_bad_streak(tmp_path: Path) -> None:
    almost = [paper(str(i)) for i in range(BAD_STREAK - 1)]
    more = [paper(str(10 + i)) for i in range(BAD_STREAK - 1)]
    run = Run(tmp_path, [[*almost, paper("ok"), *more]])
    for post in [*almost, *more]:
        run.feed.viewer[post.post_id] = []

    assert run().outcome == "finished"


def test_cancel_or_shutdown_mid_post_keeps_no_partial_post_and_stops(tmp_path: Path) -> None:
    run = Run(tmp_path, [[paper("111", shown=3), paper("222")]])

    def stop_during_first(src: str) -> bytes:
        run.stopping.set()  # `cancel` or `shutdown` arrives between two images
        return PNG

    run.feed.fetcher = stop_during_first

    result = run()

    assert result == UpdateResult(
        saved=0, skipped_not_paper=0, incomplete=0, failed=0, outcome="cancelled"
    )
    assert run.feed.opened == ["111"]
    assert known_post_ids(run.posts) == set()
    assert [p for p in run.posts.rglob("*") if p.is_file()] == []


def test_cancel_between_posts_stops_before_the_next(tmp_path: Path) -> None:
    run = Run(tmp_path, [[paper("111"), paper("222")]])
    run.on_progress = lambda p: run.stopping.set() if p.phase == "posts" else None

    result = run()

    assert result.outcome == "cancelled"
    assert run.feed.opened == ["111"]
    assert known_post_ids(run.posts) == {"111"}


def test_cancel_during_the_scan_downloads_nothing(tmp_path: Path) -> None:
    run = Run(tmp_path, [[paper("111")], [paper("222")]])
    run.stopping.set()

    result = run()

    assert result.outcome == "cancelled"
    assert run.feed.opened == []


def test_closing_the_edge_window_ends_the_run_as_cancelled(tmp_path: Path) -> None:
    run = Run(tmp_path, [[paper("111"), paper("222")]])

    run.feed.viewer["111"] = TargetClosedError()

    assert run().outcome == "cancelled"


def test_signed_out_checkpoint_and_blocked_stop_the_run(tmp_path: Path) -> None:
    run = Run(tmp_path, [[paper("111"), paper("222")]])

    run.feed.viewer["111"] = RpcError(
        "blocked", "Facebook says this account is temporarily blocked"
    )

    with pytest.raises(RpcError) as raised:
        run()
    assert raised.value.reason == "blocked"


def test_stopped_is_what_a_viewer_raises_when_stopping(tmp_path: Path) -> None:
    run = Run(tmp_path, [[paper("111"), paper("222")]])

    run.feed.viewer["111"] = Stopped()

    assert run().outcome == "cancelled"
