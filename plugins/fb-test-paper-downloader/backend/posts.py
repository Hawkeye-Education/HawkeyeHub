"""The post store: posts/<Level>/<Subject>/<title>_<postId>/{paper.pdf, post.json}.

Disk is the Update run's only resume state: a post is done once its post.json exists, wherever
staff have since re-filed its folder. Each post is built in posts/.partial-<postId>/ and renamed
into place whole, so a stopped or killed run never leaves a done post with missing pages.
"""

import os
import shutil
import threading
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Literal

from classify import classify_level, classify_subject, post_title
from hawkeye_hub import Model
from PIL import Image


class PostJson(Model):
    """post.json, version 1. It replaces fb_papers.py's info.txt, which nothing reads."""

    v: Literal[1]
    post_id: str
    url: str
    text: str
    pages: int


class Stopped(Exception):
    """`cancel` or `shutdown` arrived between two images; nothing of the post was kept."""


def known_post_ids(posts: Path) -> set[str]:
    # Three levels deep only, so posts/.partial-*/post.json never counts.
    return {
        PostJson.model_validate_json(f.read_bytes()).post_id for f in posts.glob("*/*/*/post.json")
    }


def write_post(
    posts: Path,
    *,
    post_id: str,
    url: str,
    text: str,
    images: Sequence[str],
    fetch: Callable[[str], bytes],
    stopping: threading.Event,
) -> Path:
    """Downloads `images` with `fetch` into one paper.pdf, writes post.json, and returns the folder.

    Raises Stopped once `stopping` is set; any error from `fetch` propagates. Either way the
    partial folder is removed and no post is left behind.
    """
    partial = posts / f".partial-{post_id}"
    if partial.exists():  # left by a Backend killed mid-post
        shutil.rmtree(partial)
    try:
        pages = partial / "images"
        pages.mkdir(parents=True)
        paths: list[Path] = []
        for i, src in enumerate(images, 1):
            if stopping.is_set():
                raise Stopped()
            path = pages / f"{i:03d}"  # Pillow reads the format from the bytes, not the name
            path.write_bytes(fetch(src))
            paths.append(path)
        _merge_pdf(paths, partial / "paper.pdf")
        shutil.rmtree(pages)
        post = PostJson(v=1, post_id=post_id, url=url, text=text, pages=len(paths))
        (partial / "post.json").write_text(post.model_dump_json(by_alias=True), encoding="utf-8")
        folder = (
            posts / classify_level(text) / classify_subject(text) / f"{post_title(text)}_{post_id}"
        )
        folder.parent.mkdir(parents=True, exist_ok=True)
        _clear_leftover(folder)
        os.replace(partial, folder)
        return folder
    except BaseException:
        if partial.exists():
            shutil.rmtree(partial)
        raise


def _clear_leftover(folder: Path) -> None:
    """Removes a folder already at the post's name with no post.json in it (a copy cut short, or
    one staff emptied): it is no done post, and os.replace cannot rename onto it. A folder that
    holds a post.json is another post's (this one is not known), so it is never removed."""
    if not folder.exists():
        return
    if (folder / "post.json").exists():
        raise FileExistsError(f"{folder} already holds another post")
    shutil.rmtree(folder)


def _merge_pdf(paths: Sequence[Path], pdf: Path) -> None:
    pages: list[Image.Image] = []
    for path in paths:
        with Image.open(path) as image:  # closed now, so Windows lets the images be deleted
            pages.append(image.convert("RGB"))
    pages[0].save(pdf, "PDF", save_all=True, append_images=pages[1:], resolution=150)
