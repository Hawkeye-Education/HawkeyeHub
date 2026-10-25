---
name: watermark-regex
description: How the PDF Watermark Eraser matches text, and how to write a pattern that removes the watermark and nothing else.
---

# Writing a watermark pattern

## How matching works

- The eraser extracts each page's text **line by line** and tests every line with Python's `re.search`. Patterns use **Python `re` syntax**, not JavaScript or PCRE.
- With **Regex** off, the text is matched literally (it is passed through `re.escape`).
- **Ignore case** adds `re.IGNORECASE`.
- A block of PDF text is removed only if **every** line it contributes matches. A pattern that also matches body text is therefore usually harmless, but a pattern that matches only part of a multi-line watermark leaves the whole watermark in place.

## Recipes

- Spaces vary between files: use `\s+` between words, not a literal space. `Provided\s+by\s+dse\.life`
- Escape dots and other punctuation in URLs and domains: `dse\.life`, not `dse.life`.
- Watermark split over two lines (`Provided by` / `dse.life`): match each line, `Provided\s+by|dse\.life`.
- Rotated or spaced-out watermarks sometimes extract one character per line (`C`, `O`, `N`...). Say so and suggest a pattern for the whole word with optional spaces: `C\s*O\s*N\s*F\s*I\s*D\s*E\s*N\s*T\s*I\s*A\s*L`.
- Avoid `.*` on its own and very short patterns (one or two letters). They match every line, so the eraser removes nothing and reports the file as failed rather than doing harm, but staff lose time.
- Prefer anchoring to the watermark's distinctive words (the domain, the company name) over generic words like `Confidential` when the document might contain that word in its body.

## What staff can see

The Plugin UI shows a chosen page's text and highlights **lines that repeat on most pages**: those are usually the watermark. Staff copy the page text and paste it to you.
