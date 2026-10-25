"""The eraser: removes the text objects of a PDF whose every line matches a pattern."""

import os
import re
from collections import Counter
from pathlib import Path
from typing import Any

import pymupdf

# PyMuPDF ships no types for most of its API, so its module and documents are Any.
pdf: Any = pymupdf
Doc = Any

pdf.TOOLS.mupdf_display_errors(False)  # silence harmless MuPDF repair warnings (ICC N=3 etc.)

# ponytail: naive tokenizer. A literal "BT"/"ET" inside a string or inline image mis-splits the
# stream, and the differential check below then just rejects that block. Swap for
# pikepdf.parse_content_stream if real files get missed.
BT_ET = re.compile(rb"\bBT\b.*?\bET\b", re.S)
DO_CALL = re.compile(rb"/([^\s/\[\]()<>{}%]+)\s+Do\b")


class PasswordProtected(Exception):
    pass


def open_pdf(path: Path) -> Doc:
    """Opens `path`, refusing an encrypted PDF with `PasswordProtected`."""
    doc: Doc = pdf.open(path)
    if doc.needs_pass:
        doc.close()
        raise PasswordProtected()
    return doc


def page_lines(doc: Doc, pno: int) -> Counter[str]:
    text: str = doc[pno].get_text()
    return Counter(s for line in text.splitlines() if (s := line.strip()))


def _strip_stream(doc: Doc, pno: int, xref: int, rx: re.Pattern[str]) -> int:
    """Deletes the text blocks of one content stream that hold only watermark text.

    Text in a stream is font-encoded, so instead of decoding it we cut blocks out, re-extract the
    page text and see which lines vanished, bisecting to stay fast. A block goes only if every
    line it contributed matches `rx`.
    """
    raw: bytes | None = doc.xref_stream(xref)
    if raw is None:
        # A Contents or form entry that is no stream draws nothing; PyMuPDF answers None for it
        # (probed: a page whose /Contents names a plain dict reads as no text).
        return 0
    spans = [m.span() for m in BT_ET.finditer(raw)]
    if not spans:
        return 0
    base = page_lines(doc, pno)

    def cut(idx: list[int]) -> bytes:
        out = bytearray(raw)
        for i in sorted(idx, reverse=True):
            a, b = spans[i]
            out[a:b] = b""
        return bytes(out)

    def find(idx: list[int]) -> list[int]:
        doc.update_stream(xref, cut(idx))
        gone = base - page_lines(doc, pno)
        if not any(rx.search(line) for line in gone):
            return []
        if len(idx) == 1:
            return idx if all(rx.search(line) for line in gone) else []
        mid = len(idx) // 2
        return find(idx[:mid]) + find(idx[mid:])

    hits = find(list(range(len(spans))))
    doc.update_stream(xref, cut(hits))
    return len(hits)


def _used_xobjects(doc: Doc, pno: int) -> list[int]:
    """Form XObject xrefs the page really draws, following `Do` calls into nested forms."""
    page = doc[pno]
    # (xref, name, invoker_xref, bbox); invoker 0 is the page itself.
    xobjects: list[tuple[int, str, int, Any]] = page.get_xobjects()
    keep: list[int] = []
    seen: set[int] = set()

    def walk(parent: int, stream_xrefs: list[int]) -> None:
        # A stream xref that is no stream (None, see `_strip_stream`) calls nothing.
        streams: list[bytes | None] = [doc.xref_stream(x) for x in stream_xrefs]
        content = b"".join(s for s in streams if s is not None)
        called = set(DO_CALL.findall(content))
        for xref, name, invoker, _ in xobjects:
            if (
                invoker == parent
                and xref not in seen
                and name.encode("latin-1", "replace") in called
            ):
                seen.add(xref)
                keep.append(xref)
                walk(xref, [xref])

    walk(0, page.get_contents())
    if not keep:  # unusual naming or escaping: check every form once
        return list(dict.fromkeys(xref for xref, _, _, _ in xobjects))
    return keep


def _clean_page(doc: Doc, pno: int, rx: re.Pattern[str]) -> int:
    page = doc[pno]
    removed = 0
    # By xref, collected first: deleting an annotation invalidates the page's annotation iterator.
    matching: list[int] = [
        a.xref for a in page.annots() if rx.search(a.info["content"] + "\n" + a.get_text())
    ]
    for xref in matching:
        page.delete_annot(page.load_annot(xref))
        removed += 1
    # Form XObjects first: that is where most tools put the watermark.
    contents: list[int] = page.get_contents()
    for xref in _used_xobjects(doc, pno) + contents:
        if not any(rx.search(line) for line in page_lines(doc, pno)):
            break
        removed += _strip_stream(doc, pno, xref, rx)
    return removed


def remove_watermark(src: Path, dst: Path, rx: re.Pattern[str]) -> int:
    """The number of objects removed. Writes `dst` whole, and only if something was removed."""
    doc = open_pdf(src)
    try:
        removed = sum(_clean_page(doc, pno, rx) for pno in range(doc.page_count))
        if removed:
            tmp = dst.with_name(dst.name + ".part")
            doc.save(tmp, garbage=3, deflate=True)
            os.replace(tmp, dst)
        return removed
    finally:
        doc.close()
