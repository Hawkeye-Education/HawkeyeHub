"""The eraser itself, lifted unchanged from pdf_remove_water_mark/app.py; only the tkinter UI is gone."""
import re
from collections import Counter

import pymupdf

pymupdf.TOOLS.mupdf_display_errors(False)  # silence harmless MuPDF repair warnings (e.g. ICC profile N=3)

# ponytail: naive tokenizer - a literal "BT"/"ET" inside a string or inline image
# mis-splits the stream; the differential check below then just rejects that block.
# Swap for pikepdf.parse_content_stream if real files get missed.
BT_ET = re.compile(rb"\bBT\b.*?\bET\b", re.S)


class PasswordProtected(Exception):
    pass


def page_lines(doc, pno):
    return Counter(s for l in doc[pno].get_text().splitlines() if (s := l.strip()))


def strip_stream(doc, pno, xref, rx):
    """Delete the text blocks of one content stream that hold only watermark text.

    Text in a stream is font-encoded, so instead of decoding it we cut blocks out,
    re-extract the page text and see which lines vanished (bisecting to stay fast).
    A block goes only if every line it contributed matches rx.
    """
    raw = doc.xref_stream(xref)
    spans = [m.span() for m in BT_ET.finditer(raw or b"")]
    if not spans:
        return 0
    base = page_lines(doc, pno)

    def cut(idx):
        out = bytearray(raw)
        for i in sorted(idx, reverse=True):
            a, b = spans[i]
            out[a:b] = b""
        return bytes(out)

    def find(idx):
        doc.update_stream(xref, cut(idx))
        gone = base - page_lines(doc, pno)
        if not any(rx.search(l) for l in gone):
            return []
        if len(idx) == 1:
            return idx if all(rx.search(l) for l in gone) else []
        mid = len(idx) // 2
        return find(idx[:mid]) + find(idx[mid:])

    hits = find(list(range(len(spans))))
    doc.update_stream(xref, cut(hits))
    return len(hits)


def used_xobjects(doc, page):
    """Form XObject xrefs this page really draws, following 'Do' calls into nested forms."""
    xo = page.get_xobjects()  # (xref, name, invoker_xref, bbox); invoker 0 = the page itself
    keep, seen = [], set()

    def walk(parent, stream_xrefs):
        cont = b"".join(doc.xref_stream(c) or b"" for c in stream_xrefs)
        called = set(re.findall(rb"/([^\s/\[\]()<>{}%]+)\s+Do\b", cont))
        for x in xo:
            if x[2] == parent and x[0] not in seen and x[1].encode("latin-1", "replace") in called:
                seen.add(x[0])
                keep.append(x[0])
                walk(x[0], [x[0]])

    walk(0, page.get_contents())
    if not keep:  # unusual naming/escaping: fall back to checking every form once
        return list(dict.fromkeys(x[0] for x in xo))
    return keep


def clean_page(doc, pno, rx):
    page = doc[pno]
    n = 0
    for xref in [a.xref for a in page.annots() or [] if rx.search(a.info.get("content", "") + "\n" + a.get_text())]:
        page.delete_annot(page.load_annot(xref))
        n += 1
    # form XObjects first: that is where most tools put the watermark
    for xref in used_xobjects(doc, page) + page.get_contents():
        if not any(rx.search(l) for l in page_lines(doc, pno)):
            break
        n += strip_stream(doc, pno, xref, rx)
    return n


def remove_watermark(src, dst, rx):
    """Returns number of objects removed; writes dst only if something was removed."""
    with pymupdf.open(src) as doc:
        if doc.needs_pass:
            raise PasswordProtected()
        n = sum(clean_page(doc, pno, rx) for pno in range(doc.page_count))
        if n:
            doc.save(dst, garbage=3, deflate=True)
    return n
