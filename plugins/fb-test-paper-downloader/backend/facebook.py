"""The Files tab, group feed and photo viewer in the Plugin's Edge: `files.FilesTab` and
`update.Feed`, ported from fb_papers.py.

It reads Facebook's live DOM, so it has no unit tests: saved DOM fixtures would pass while the
live site breaks. A dev-mode run against the live group before each release covers it.
"""

import logging
import random
import re
import threading
import time
from collections.abc import Callable, Iterator, Sequence
from pathlib import Path
from typing import Annotated
from urllib.parse import parse_qs, unquote, urlparse

from files import FileRow
from hawkeye_hub import Model, RpcError
from playwright._impl._errors import TargetClosedError  # the closed-window error, as browser.py
from playwright.sync_api import APIResponse, BrowserContext, Page
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeout
from posts import Stopped
from pydantic import Field, TypeAdapter
from update import FeedPost, GroupId, PostId

log = logging.getLogger(__name__)

BASE = "https://www.facebook.com"
IDLE_ROUNDS = 8  # scrolls in a row that reveal nothing new: the feed has ended
CHECK_EVERY = 20  # scrolls between two checks for a sign-out, checkpoint or block
VIEWER_CAP = 300  # images per post, against a viewer that never loops back
RETRIES = 3  # Facebook's CDN sometimes drops connections
RETRY_WAIT_SECONDS = 10  # times the attempt number squared

# Waits, in seconds, as fb_papers.py tuned them against the live site.
FEED_SETTLE = 5  # after opening the feed
FILES_SETTLE = 4  # after opening the Files tab, or a file's post
VIEWER_SETTLE = 3  # after opening a post's photo viewer
SCROLL_WAIT = (2.0, 3.5)  # after each scroll, at random
PHOTO_WAIT = (0.9, 1.6)  # between two photos in the viewer, at random
FETCH_WAIT = (0.2, 0.5)  # after each image download, at random
SEE_MORE_SETTLE = 2  # after a "See more" click
POPUP_SETTLE = 1  # after closing a dialog
STABLE_POLLS = 25  # polls of the viewer's image before giving up (~10 s)
STABLE_POLL = 0.4  # between two polls

# Timeouts, in milliseconds.
IMAGE_TIMEOUT = 60_000
FILE_TIMEOUT = 120_000
MENU_TIMEOUT = 5_000
MENU_DOWNLOAD_TIMEOUT = 90_000
NEW_TAB_DOWNLOAD_TIMEOUT = 45_000
CLICK_TIMEOUT = 3_000
POPUP_CLICK_TIMEOUT = 2_000
BODY_TEXT_TIMEOUT = 3_000
NEXT_PHOTO_TIMEOUT = 6_000

_BLOCKED = (
    "暫時被封鎖",
    "暂时被限制",
    "You're Temporarily Blocked",
    "You’re Temporarily Blocked",  # noqa: RUF001 - Facebook's own apostrophe
)

# Marks each feed unit it has read, and prunes it (images unloaded, hidden) to keep Edge small.
_JS_FEED_POSTS = r"""
() => {
  const feed = document.querySelector('[role="feed"]');
  if (!feed) return [];
  const items = [];
  for (const unit of feed.children) {
    if (unit.hasAttribute('data-fbp-done')) continue;
    if (!(unit.innerText || '').trim()) continue;           // still a loading placeholder
    unit.setAttribute('data-fbp-done', '1');
    let postId = null, photoUrl = null;
    const photoLinks = [...unit.querySelectorAll('a[href*="/photo"]')];
    for (const a of photoLinks) {
      const m = a.href.match(/[?&]set=(?:pcb|gm|g)\.(\d+)/);
      if (m) { postId = { kind: 'post', id: m[1] }; photoUrl = a.href; break; }
    }
    if (!postId && photoLinks.length) {
      const m = photoLinks[0].href.match(/[?&]fbid=(\d+)/);
      if (m) { postId = { kind: 'photo', fbid: m[1] }; photoUrl = photoLinks[0].href; }
    }
    if (postId) {
      const msg = unit.querySelector(
        '[data-ad-rendering-role="story_message"], [data-ad-preview="message"], ' +
        '[data-ad-comet-preview="message"]');
      let text = msg ? msg.innerText : '';
      if (!text) {
        const blocks = [...unit.querySelectorAll('div[dir="auto"]')].map(d => d.innerText.trim())
          .filter(t => t && t.length > 3);
        text = blocks[0] || '';
      }
      const plus = [...unit.querySelectorAll('span, div')]
        .map(e => (e.childElementCount === 0 ? e.textContent.trim() : ''))
        .find(t => /^\+\d+$/.test(t));
      const distinct = new Set(
        photoLinks.map(a => (a.href.match(/fbid=(\d+)/) || [])[1]).filter(Boolean));
      items.push({ postId, photoUrl, text: text.slice(0, 2000),
                   shown: plus ? distinct.size - 1 + parseInt(plus.slice(1), 10) : distinct.size });
    }
    unit.querySelectorAll('img').forEach(i => { i.removeAttribute('srcset'); i.src = ''; });
    unit.style.display = 'none';
  }
  return items;
}
"""

# Facebook keeps pre-loaded neighbour photos in the page; take the one actually on screen.
_JS_MAIN_IMAGE = r"""
() => {
  const W = window.innerWidth, H = window.innerHeight;
  const visible = (img) => {
    const r = img.getBoundingClientRect();
    if (r.width < 250 || r.right <= 0 || r.left >= W || r.bottom <= 0 || r.top >= H) return 0;
    const cs = getComputedStyle(img);
    if (cs.visibility === 'hidden' || cs.display === 'none') return 0;
    if (parseFloat(cs.opacity) < 0.5) return 0;
    const x = Math.max(0, Math.min(r.right, W) - Math.max(r.left, 0));
    const y = Math.max(0, Math.min(r.bottom, H) - Math.max(r.top, 0));
    return x * y;
  };
  let best = null, area = 0;
  for (const sel of ['img[data-visualcompletion="media-vc-image"]', 'img']) {
    for (const img of document.querySelectorAll(sel)) {
      const src = img.currentSrc || img.src;
      if (!src || !/fbcdn|fbsbx/.test(src) || !img.complete) continue;
      const a = visible(img);
      if (a > area) { area = a; best = src; }
    }
    if (best) return best;
  }
  return null;
}
"""


# Marks each Files-tab row it has read, and the row's menu button for the Download route.
_JS_FILE_ROWS = r"""
() => {
  const extRe = /\.(pdf|docx?|xlsx?|pptx?|jpe?g|png|zip|rar)$/i;
  const countNames = (el) =>
    (el.innerText || '').split('\n').filter(l => extRe.test(l.trim())).length;
  const main = document.querySelector('[role="main"]') || document.body;
  const out = [];
  for (const el of main.querySelectorAll('a, span')) {
    if (el.closest('[data-fbp-row]')) continue;
    const t = (el.innerText || '').trim();
    if (!t || t.length > 200 || t.includes('\n') || !extRe.test(t)) continue;
    // climb to the row: stop at the first ancestor holding a menu button,
    // but never climb into a container that holds several file names
    let row = el, btn = null;
    for (let i = 0; i < 12 && row.parentElement; i++) {
      const up = row.parentElement;
      if (countNames(up) > 1) break;
      row = up;
      btn = row.querySelector('[aria-haspopup="menu"], [role="button"][aria-label]');
      if (btn) break;
    }
    if (row.hasAttribute('data-fbp-row')) continue;
    const id = 'r' + Math.random().toString(36).slice(2, 10);
    row.setAttribute('data-fbp-row', id);
    if (btn) btn.setAttribute('data-fbp-more', id);
    const a = el.closest('a[href]') || row.querySelector('a[href]');
    out.push({ rowId: id, name: t, href: a ? a.href : null });
  }
  return out;
}
"""


class _FileItem(Model):
    """What _JS_FILE_ROWS returns for one row: parsed, since the page is Facebook's."""

    row_id: str
    name: str
    href: Annotated[str, Field(min_length=1)] | None  # None: the row has no link


class _FeedItem(Model):
    """What _JS_FEED_POSTS returns for one post: parsed, since the page is Facebook's."""

    post_id: PostId
    photo_url: str
    text: str
    shown: int


# What the other scripts return, parsed for the same reason.
_LINKS = TypeAdapter(list[str])
_IMAGE = TypeAdapter(str | None)  # None: no photo on screen yet


class Facebook:
    def __init__(self, window: BrowserContext, group: GroupId, stopping: threading.Event) -> None:
        self._window = window
        self._group = group
        self._stopping = stopping
        self._page = window.pages[0]  # a persistent context opens with one tab
        for extra in window.pages[1:]:  # welcome or restore tabs Edge opened
            extra.close()

    def scan(self) -> Iterator[Sequence[FeedPost]]:
        page = self._page
        self._open(f"{BASE}/groups/{self._group}/?sorting_setting=CHRONOLOGICAL", FEED_SETTLE)
        _dismiss_popups(page)
        idle = rounds = 0
        while idle < IDLE_ROUNDS:
            raw: list[object] = page.evaluate(_JS_FEED_POSTS)
            items = [_FeedItem.model_validate(item) for item in raw]
            idle = 0 if items else idle + 1
            yield [FeedPost(i.post_id, i.photo_url, i.text, i.shown) for i in items]
            rounds += 1
            _scroll_down(page)
            if rounds % CHECK_EVERY == 0:
                self._check()

    def images(self, post: FeedPost) -> list[str]:
        page = self._page
        self._open(post.photo_url, VIEWER_SETTLE)
        srcs: list[str] = []
        seen_photos: set[str] = set()
        seen_images: set[str] = set()
        prev: str | None = None  # none before the first photo
        for _ in range(VIEWER_CAP):
            if self._stopping.is_set():
                raise Stopped()
            fbids = parse_qs(urlparse(page.url).query).get("fbid")
            # A viewer URL with no fbid names its photo in the path: the whole URL is its id.
            photo = page.url if fbids is None else fbids[0]
            if photo in seen_photos:
                break  # looped back to the first photo
            src = self._main_image(prev, seen_images)
            if src is None:
                break
            seen_photos.add(photo)
            seen_images.add(_image_key(src))
            srcs.append(src)
            prev = src
            if not _next_photo(page):
                break
            time.sleep(random.uniform(*PHOTO_WAIT))
        return srcs

    def fetch(self, src: str) -> bytes:
        response = _retry(lambda: self._window.request.get(src, timeout=IMAGE_TIMEOUT))
        if not response.ok:
            raise RuntimeError(f"the image answered HTTP {response.status}")
        time.sleep(random.uniform(*FETCH_WAIT))
        return response.body()

    def file_rows(self) -> Iterator[Sequence[FileRow]]:
        page = self._page
        self._open(f"{BASE}/groups/{self._group}/files/files", FILES_SETTLE)
        _dismiss_popups(page)
        idle = 0
        while idle < IDLE_ROUNDS:
            raw: list[object] = page.evaluate(_JS_FILE_ROWS)
            items = [_FileItem.model_validate(item) for item in raw]
            idle = 0 if items else idle + 1
            yield [FileRow(i.row_id, i.name, i.href) for i in items]
            _scroll_down(page)
            more = page.get_by_role("button", name=re.compile(r"^(查看更多|顯示更多|See more)$"))
            if more.count():
                try:
                    more.first.click(timeout=CLICK_TIMEOUT)
                    time.sleep(SEE_MORE_SETTLE)
                except PlaywrightTimeout:
                    pass  # the button went away as the list grew: the next scroll goes on
            self._check()

    def save_file(self, row: FileRow, to: Path) -> None:
        """Tries each route fb_papers.py found Facebook to need, most direct first."""
        if row.href is None:
            if self._save_via_menu(row.row_id, to):
                return
            raise RuntimeError("the row has no link and its Download menu did not work")
        href = _resolve_href(row.href)
        if "facebook.com/groups/" not in href and self._save_via_request(href, to):
            return
        if self._save_via_menu(row.row_id, to):
            return
        if ("/permalink/" in href or "/posts/" in href) and self._save_via_post_page(
            href, row.name, to
        ):
            return
        if self._save_via_new_tab(href, to):
            return
        raise RuntimeError("no download route worked")

    def _save_via_request(self, url: str, to: Path) -> bool:
        response = _retry(lambda: self._window.request.get(url, timeout=FILE_TIMEOUT))
        if not response.ok:
            return False
        body = response.body()
        if len(body) < 500 or _looks_like_html(response, body):  # a login or error page
            return False
        to.write_bytes(body)
        return True

    def _save_via_menu(self, row_id: str, to: Path) -> bool:
        page = self._page
        more = page.locator(f'[data-fbp-more="{row_id}"]')
        if not more.count():
            return False
        more.first.scroll_into_view_if_needed()
        more.first.click()
        item = (
            page.get_by_role("menuitem")
            .filter(has_text=re.compile(r"下載|下载|Download", re.I))
            .first
        )
        try:
            item.wait_for(timeout=MENU_TIMEOUT)
            with page.expect_download(timeout=MENU_DOWNLOAD_TIMEOUT) as download:
                item.click()
            download.value.save_as(to)
            return True
        except PlaywrightTimeout:
            page.keyboard.press("Escape")
            return False

    def _save_via_post_page(self, href: str, name: str, to: Path) -> bool:
        """Some rows link to the post the file was attached to: take the file link from there."""
        tab = self._window.new_page()
        try:
            _retry(lambda: tab.goto(href))
            time.sleep(FILES_SETTLE)
            links = _LINKS.validate_python(
                tab.evaluate("() => [...document.querySelectorAll('a[href]')].map(a => a.href)")
            )
        finally:
            tab.close()
        stem = Path(name).stem.lower()
        found = [
            real
            for real in map(_resolve_href, links)
            if "fbsbx.com" in real or "/download/" in real
        ]
        found.sort(key=lambda real: stem not in unquote(real).lower())  # its own name first
        return any(self._save_via_request(real, to) for real in found)

    def _save_via_new_tab(self, href: str, to: Path) -> bool:
        tab = self._window.new_page()
        try:
            with tab.expect_download(timeout=NEW_TAB_DOWNLOAD_TIMEOUT) as download:
                try:
                    tab.goto(href)
                except PlaywrightError as e:
                    # A link that starts a download fails its navigation with this message: read
                    # in Playwright 1.64's driver (coreBundle.js, CRPage _navigate), whose own
                    # download handling checks for the same text. Anything else is a real failure.
                    if "Download is starting" not in str(e):
                        raise
            download.value.save_as(to)
            return True
        except PlaywrightTimeout:
            return False
        finally:
            tab.close()

    def _main_image(self, prev: str | None, seen: set[str]) -> str | None:
        """This photo's image once it is stable (up to ~10 s), or None when it never changes."""
        page = self._page
        for _ in range(STABLE_POLLS):
            src = _IMAGE.validate_python(page.evaluate(_JS_MAIN_IMAGE))
            if src is not None and src != prev and _image_key(src) not in seen:
                time.sleep(STABLE_POLL)  # make sure it is stable, not mid-transition
                if _IMAGE.validate_python(page.evaluate(_JS_MAIN_IMAGE)) == src:
                    return src
            time.sleep(STABLE_POLL)
        return None

    def _open(self, url: str, settle: float) -> None:
        """Opens `url` in the run's tab, waits `settle` seconds, then checks it was let in."""
        _retry(lambda: self._page.goto(url))
        time.sleep(settle)
        self._check()

    def _check(self) -> None:
        """Ends the run when Facebook has signed staff out, wants a checkpoint, or blocked them."""
        url = self._page.url
        if "/login" in url or "login.php" in url:
            raise RpcError("signed-out", f"Facebook sent the Plugin's Edge to {url}")
        if "/checkpoint/" in url:
            raise RpcError("checkpoint", f"Facebook is showing a security checkpoint at {url}")
        try:
            text = self._page.locator("body").inner_text(timeout=BODY_TEXT_TIMEOUT)[:3000]
        except PlaywrightTimeout:  # a page still loading cannot say it is blocked
            log.info("%s was still loading, so it was not checked for a block", url)
            return
        if any(s in text for s in _BLOCKED):
            raise RpcError("blocked", "Facebook says this account is temporarily blocked")


def _resolve_href(href: str) -> str:
    """The target of an l.facebook.com/l.php?u=... redirect link, or the link itself."""
    u = urlparse(href)
    if u.netloc.startswith("l.facebook.com") or u.path == "/l.php":
        # parse_qs decodes values and drops blank ones, so a list here holds the target.
        targets = parse_qs(u.query).get("u")
        return href if targets is None else targets[0]
    return href


def _looks_like_html(response: APIResponse, body: bytes) -> bool:
    head = body[:200].lstrip().lower()
    content_type = response.headers.get("content-type")  # None: the server sent no type
    is_html = content_type is not None and "text/html" in content_type.lower()
    return is_html or head.startswith((b"<!doctype", b"<html"))


def _image_key(src: str) -> str:
    return urlparse(src).path.rsplit("/", 1)[-1]


def _next_photo(page: Page) -> bool:
    """Moves the viewer to the next photo; False when there is none."""
    old = page.url
    page.keyboard.press("ArrowRight")
    try:
        page.wait_for_url(lambda u: u != old, timeout=NEXT_PHOTO_TIMEOUT)
        return True
    except PlaywrightTimeout:
        pass  # the arrow key did nothing: try the viewer's Next button
    nxt = page.locator(
        '[aria-label*="下一張"], [aria-label*="下一张"], '
        '[aria-label="Next photo"], [aria-label="Next"]'
    )
    if not nxt.count():
        return False
    try:
        nxt.first.click(timeout=CLICK_TIMEOUT)
        page.wait_for_url(lambda u: u != old, timeout=NEXT_PHOTO_TIMEOUT)
        return True
    except PlaywrightTimeout:
        return False


def _scroll_down(page: Page) -> None:
    """Scrolls to the bottom so Facebook loads more, then gives it time to."""
    page.mouse.wheel(0, 5000)
    page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
    time.sleep(random.uniform(*SCROLL_WAIT))


def _dismiss_popups(page: Page) -> None:
    """Closes Facebook's dialogs (notification nags, 'save login', cookie banners)."""
    for _ in range(3):
        close = page.locator(
            '[role="dialog"] [aria-label="關閉"], [role="dialog"] [aria-label="Close"], '
            '[role="dialog"] [aria-label="关闭"]'
        )
        decline = page.locator('[role="dialog"] [role="button"]').filter(
            has_text=re.compile(
                r"^(不用了|稍後再說|以後再說|Not now|拒絕選用 Cookie|Decline optional cookies)$"
            )
        )
        target = close if close.count() else decline if decline.count() else None
        if target is None:
            return
        try:
            target.first.click(timeout=POPUP_CLICK_TIMEOUT)
            time.sleep(POPUP_SETTLE)
        except PlaywrightTimeout:
            page.keyboard.press("Escape")
            return


def _retry[T](action: Callable[[], T]) -> T:
    for attempt in range(1, RETRIES + 1):
        try:
            return action()
        except TargetClosedError:  # staff closed Edge: nothing to retry
            raise
        except PlaywrightError as e:
            if attempt == RETRIES:
                raise
            wait = RETRY_WAIT_SECONDS * attempt**2
            log.warning("network hiccup (%s), retrying in %ss", str(e).splitlines()[0], wait)
            time.sleep(wait)
    raise AssertionError("unreachable: the last attempt returns or raises")
