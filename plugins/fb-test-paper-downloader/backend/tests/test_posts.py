"""The post store: which posts are known, and the atomic writer. Images are made, never fetched."""

import io
import json
import re
import shutil
import threading
from collections.abc import Callable
from pathlib import Path

import pytest
from PIL import Image
from posts import Stopped, known_post_ids, write_post

URL = "https://www.facebook.com/groups/1/posts/111/"


def png(colour: str) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (40, 60), colour).save(out, "PNG")
    return out.getvalue()


IMAGES = {"https://cdn/a": png("red"), "https://cdn/b": png("green"), "https://cdn/c": png("blue")}


def fetch(src: str) -> bytes:
    return IMAGES[src]


def write(posts: Path, post_id: str, text: str, fetcher: Callable[[str], bytes] = fetch) -> Path:
    return write_post(
        posts,
        post_id=post_id,
        url=URL,
        text=text,
        images=list(IMAGES),
        fetch=fetcher,
        stopping=threading.Event(),
    )


def pdf_pages(pdf: Path) -> int:
    return len(re.findall(rb"/Type\s*/Page(?!s)", pdf.read_bytes()))


def files_under(folder: Path) -> list[str]:
    return sorted(p.relative_to(folder).as_posix() for p in folder.rglob("*") if p.is_file())


def test_writes_one_pdf_and_post_json_in_the_level_and_subject_folder(tmp_path: Path) -> None:
    posts = tmp_path / "posts"

    folder = write(posts, "111", "#P2 數學\n上學期試卷")

    assert folder == posts / "P2" / "數學" / "P2 數學 上學期試卷_111"
    assert files_under(posts) == [
        "P2/數學/P2 數學 上學期試卷_111/paper.pdf",
        "P2/數學/P2 數學 上學期試卷_111/post.json",
    ]
    assert pdf_pages(folder / "paper.pdf") == 3
    assert json.loads((folder / "post.json").read_text(encoding="utf-8")) == {
        "v": 1,
        "postId": "111",
        "url": URL,
        "text": "#P2 數學\n上學期試卷",
        "pages": 3,
    }


def test_known_post_ids_finds_posts_at_any_level_and_subject(tmp_path: Path) -> None:
    posts = tmp_path / "posts"
    write(posts, "111", "P1 Maths")
    write(posts, "222", "小六 中文")
    write(posts, "333", "有冇人有試卷")

    assert known_post_ids(posts) == {"111", "222", "333"}


def test_known_post_ids_follows_folders_staff_re_filed(tmp_path: Path) -> None:
    posts = tmp_path / "posts"
    folder = write(posts, "111", "P1 Maths")
    (posts / "P3" / "常識").mkdir(parents=True)
    shutil.move(folder, posts / "P3" / "常識" / "renamed by staff")

    assert known_post_ids(posts) == {"111"}


def test_known_post_ids_of_a_new_folder_is_empty(tmp_path: Path) -> None:
    assert known_post_ids(tmp_path / "posts") == set()


def failing_on(src: str) -> Callable[[str], bytes]:
    def fetcher(s: str) -> bytes:
        if s == src:
            raise ConnectionError("the CDN dropped the connection")
        return fetch(s)

    return fetcher


def test_a_writer_interrupted_midway_leaves_no_finished_post(tmp_path: Path) -> None:
    posts = tmp_path / "posts"

    with pytest.raises(ConnectionError):
        write(posts, "111", "P1 Maths", failing_on("https://cdn/b"))

    assert known_post_ids(posts) == set()
    assert [f for f in files_under(posts) if not f.startswith(".partial-")] == []


def test_stopping_between_images_leaves_no_finished_post(tmp_path: Path) -> None:
    posts = tmp_path / "posts"
    stopping = threading.Event()

    def stop_after_first(src: str) -> bytes:
        stopping.set()
        return fetch(src)

    with pytest.raises(Stopped):
        write_post(
            posts,
            post_id="111",
            url=URL,
            text="P1 Maths",
            images=list(IMAGES),
            fetch=stop_after_first,
            stopping=stopping,
        )

    assert known_post_ids(posts) == set()
    assert [f for f in files_under(posts) if not f.startswith(".partial-")] == []


def test_a_post_left_half_written_by_a_killed_backend_is_written_afresh(tmp_path: Path) -> None:
    posts = tmp_path / "posts"
    stale = posts / ".partial-111"
    stale.mkdir(parents=True)
    (stale / "post.json").write_text("{}", encoding="utf-8")  # the Backend died before os.replace
    assert known_post_ids(posts) == set()

    folder = write(posts, "111", "P1 Maths")

    assert known_post_ids(posts) == {"111"}
    assert files_under(posts) == [
        f"P1/數學/{folder.name}/paper.pdf",
        f"P1/數學/{folder.name}/post.json",
    ]


def test_a_leftover_folder_with_no_post_json_under_the_post_s_name_is_replaced(
    tmp_path: Path,
) -> None:
    posts = tmp_path / "posts"
    leftover = posts / "P1" / "數學" / "P1 Maths_111"
    leftover.mkdir(parents=True)
    (leftover / "paper.pdf").write_bytes(b"half a copy")  # no post.json: not a done post

    folder = write(posts, "111", "P1 Maths")

    assert folder == leftover
    assert known_post_ids(posts) == {"111"}
    assert files_under(posts) == [
        "P1/數學/P1 Maths_111/paper.pdf",
        "P1/數學/P1 Maths_111/post.json",
    ]
    assert pdf_pages(folder / "paper.pdf") == 3


def test_a_folder_holding_another_post_s_post_json_is_never_overwritten(tmp_path: Path) -> None:
    posts = tmp_path / "posts"
    other = write(posts, "222", "P1 Maths")
    other.rename(posts / "P1" / "數學" / "P1 Maths_111")  # staff gave 222's folder 111's name

    with pytest.raises(FileExistsError):
        write(posts, "111", "P1 Maths")

    assert known_post_ids(posts) == {"222"}
