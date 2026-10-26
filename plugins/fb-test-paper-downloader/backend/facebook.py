"""The group feed and photo viewer in the Plugin's Edge: `update.Feed`, ported from fb_papers.py.

It reads Facebook's live DOM, so it has no unit tests: saved DOM fixtures would pass while the
live site breaks. A dev-mode run against the live group before each release covers it.
"""

import logging
import random
import re
import threading
import time
from collections.abc import Callable, Iterator, Sequence
from urllib.parse import parse_qs, urlparse

from hawkeye_hub import Model, RpcError
from playwright._impl._errors import TargetClosedError  # the closed-window error, as browser.py
from playwright.sync_api import BrowserContext, Page
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import TimeoutError as PlaywrightTimeout
from posts import Stopped
from update import FeedPost, GroupId

log = logging.getLogger(__name__)

BASE = "https://www.facebook.com"
IDLE_ROUNDS = 8  # scrolls in a row that reveal nothing new: the feed has ended
CHECK_EVERY = 20  # scrolls between two checks for a sign-out, checkpoint or block
VIEWER_CAP = 300  # images per post, against a viewer that never loops back
RETRIES = 3  # Facebook's CDN sometimes drops connections

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
      if (m) { postId = m[1]; photoUrl = a.href; break; }
    }
    if (!postId && photoLinks.length) {
      const m = photoLinks[0].href.match(/[?&]fbid=(\d+)/);
      if (m) { postId = 'photo_' + m[1]; photoUrl = photoLinks[0].href; }
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


class _FeedItem(Model):
    """What _JS_FEED_POSTS returns for one post: parsed, since the page is Facebook's."""

    post_id: str
    photo_url: str
    text: str
    shown: int


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
        _retry(lambda: page.goto(f"{BASE}/groups/{self._group}/?sorting_setting=CHRONOLOGICAL"))
        time.sleep(5)
        self._check()
        _dismiss_popups(page)
        idle = rounds = 0
        while idle < IDLE_ROUNDS:
            raw: list[object] = page.evaluate(_JS_FEED_POSTS)
            items = [_FeedItem.model_validate(item) for item in raw]
            idle = 0 if items else idle + 1
            yield [FeedPost(i.post_id, i.photo_url, i.text, i.shown) for i in items]
            rounds += 1
            page.mouse.wheel(0, 5000)
            page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
            time.sleep(random.uniform(2.0, 3.5))
            if rounds % CHECK_EVERY == 0:
                self._check()

    def images(self, post: FeedPost) -> list[str]:
        page = self._page
        _retry(lambda: page.goto(post.photo_url))
        time.sleep(3)
        self._check()
        srcs: list[str] = []
        seen_photos: set[str] = set()
        seen_images: set[str] = set()
        prev: str | None = None  # none before the first photo
        for _ in range(VIEWER_CAP):
            if self._stopping.is_set():
                raise Stopped()
            photo = parse_qs(urlparse(page.url).query).get("fbid", [page.url])[0]
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
            time.sleep(random.uniform(0.9, 1.6))
        return srcs

    def fetch(self, src: str) -> bytes:
        response = _retry(lambda: self._window.request.get(src, timeout=60_000))
        if not response.ok:
            raise RuntimeError(f"the image answered HTTP {response.status}")
        time.sleep(random.uniform(0.2, 0.5))
        return response.body()

    def _main_image(self, prev: str | None, seen: set[str]) -> str | None:
        """This photo's image once it is stable (up to ~10 s), or None when it never changes."""
        page = self._page
        for _ in range(25):
            src: str | None = page.evaluate(_JS_MAIN_IMAGE)
            if src is not None and src != prev and _image_key(src) not in seen:
                time.sleep(0.4)  # make sure it is stable, not mid-transition
                if page.evaluate(_JS_MAIN_IMAGE) == src:
                    return src
            time.sleep(0.4)
        return None

    def _check(self) -> None:
        """Ends the run when Facebook has signed staff out, wants a checkpoint, or blocked them."""
        url = self._page.url
        if "/login" in url or "login.php" in url:
            raise RpcError("signed-out", f"Facebook sent the Plugin's Edge to {url}")
        if "/checkpoint/" in url:
            raise RpcError("checkpoint", f"Facebook is showing a security checkpoint at {url}")
        try:
            text = self._page.locator("body").inner_text(timeout=3000)[:3000]
        except PlaywrightTimeout:  # a page still loading cannot say it is blocked
            return
        if any(s in text for s in _BLOCKED):
            raise RpcError("blocked", "Facebook says this account is temporarily blocked")


def _image_key(src: str) -> str:
    return urlparse(src).path.rsplit("/", 1)[-1]


def _next_photo(page: Page) -> bool:
    """Moves the viewer to the next photo; False when there is none."""
    old = page.url
    page.keyboard.press("ArrowRight")
    try:
        page.wait_for_url(lambda u: u != old, timeout=6000)
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
        nxt.first.click(timeout=3000)
        page.wait_for_url(lambda u: u != old, timeout=6000)
        return True
    except PlaywrightTimeout:
        return False


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
            target.first.click(timeout=2000)
            time.sleep(1)
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
            wait = 10 * attempt**2
            log.warning("network hiccup (%s), retrying in %ss", str(e).splitlines()[0], wait)
            time.sleep(wait)
    raise AssertionError("unreachable: the last attempt returns or raises")
