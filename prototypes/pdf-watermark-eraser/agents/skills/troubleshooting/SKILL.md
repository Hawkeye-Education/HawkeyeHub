---
name: troubleshooting
description: What each PDF Watermark Eraser failure means and what staff can try next.
---

# Failures

- **No matching watermark text found**: no line on any page matched. Check the pattern against the page text, check **Regex** is ticked if the pattern uses `\s`, `|` or `\.`, and try **Ignore case**.
- **Password protected**: the eraser cannot open encrypted PDFs. Staff must remove the password first with the tool that set it.
- **Watermark still visible after cleaning**: the watermark is probably an **image** or vector drawing, not text. The eraser only removes text, so there is nothing to match. Selecting the watermark in a PDF viewer is a quick test: if it cannot be selected as text, it is not text.
- **Any other error** (a Python exception name and message): the file is probably damaged. Opening and re-saving it in a PDF viewer often repairs it.
- **Output folder must differ from the input folder**, or **must not be inside it**: pick a separate output folder so cleaned files never overwrite originals or get re-processed.
