# PROTOTYPE: PDF Watermark Eraser against the plugin contract

**Throwaway.** This answers [#13](https://github.com/Hawkeye-Education/HawkeyeHub/issues/13), *what does the reference plugin look like written against ADRs 0001–0009?* It lives only on the `prototype/pdf-watermark-eraser` branch and is never merged. The question is about contract shape, so this is a skeleton plugin with real stubs, not a UI-variants or state-machine demo.

## Run it

| What | How |
|---|---|
| Backend over real stdio JSON-RPC, with real PyMuPDF and asserts | `python _hub_stubs/drive_backend.py` (needs `pymupdf`) |
| Plugin UI against a fake `window.hub` | double-click `ui/index.html`; add `?lang=zh-HK` for Chinese |

The fake Hub prints every Hub API call in a panel at the bottom of the page.

## Layout = the Plugin Package

```
manifest.json            identity, hubApi, platforms, identity/backend/assistant kinds   ADR 0002, 0003, 0005
icon.svg                 monochrome, currentColor, so the Theme colours it                (new, see Gaps)
assistant.md             the Assistant's system prompt, named by the manifest             ADR 0004
skills/<name>/SKILL.md   the Playbook: two Agent Skills, standard frontmatter, no scripts ADR 0004
ui/index.html            Plugin UI entry, plain DOM, no build                             ADR 0003, 0006
ui/layout.css            layout-only CSS from --hub-* tokens                              ADR 0006
ui/strings.js            the Plugin's own en-HK / zh-HK strings, English fallback         ADR 0007
ui/main.js               window.hub calls: files, backend, busy; Plugin Data in storage   ADR 0008, 0009
backend/pyproject.toml   uv-built venv; depends on the hawkeye-hub SDK                    ADR 0003, 0005
backend/main.py          JSON-RPC methods listPdfs, pageText, run; cancel + shutdown      ADR 0003, 0009
backend/erase.py         the eraser, lifted unchanged from pdf_remove_water_mark/app.py
_hub_stubs/              NOT part of the package: Python SDK stub, hub.d.ts, fake Hub, driver
```

## The Plugin UI ↔ Backend protocol

| Direction | Method | Params → result |
|---|---|---|
| UI → Backend request | `listPdfs` | `{folder}` → `{files: [relPosixPath]}` |
| UI → Backend request | `pageText` | `{folder, file, page}` → `{pageCount, lines, repeated}` (`repeated` = lines on ≥ 80 % of the first 20 pages) |
| UI → Backend request | `run` | `{input, output, pattern, regex, ignoreCase}` → `{cleaned, failed, total, cancelled}` |
| UI → Backend notify | `cancel` | `{}`; stops between files |
| Backend → UI notify | `progress` | `{done, total, file, result: {kind: 'cleaned', removed} \| {kind: 'no-match'} \| {kind: 'password'} \| {kind: 'error', detail}}` |

Rejections are JSON-RPC errors with `data.reason` (`pattern-empty`, `pattern-invalid`, `same-folder`, `output-inside-input`, `folder-missing`, `password`, `already-running`, `bad-param`). The UI turns reasons into words, because a Backend has no Display Language (ADR 0007).

## Gaps this prototype exposed

Need a decision:

1. **Playbook folder name conflict.** ADR 0004 puts the Playbook at `skills/<name>/SKILL.md`, but ADR 0005 says the package holds `playbook/`. This prototype uses `skills/`.
2. **Manifest style.** Every field is required. Each part a Plugin may lack is a `kind` union: `identity: {kind: 'none'}`, `backend: {kind: 'python', python}`, `assistant: {kind: 'enabled', …}`. No field is left optional. Entry points are fixed by convention (`ui/index.html`, `backend/main.py`, `skills/`) rather than declared. There is no `permissions`, `locales` or `theme` field, because ADRs 0006, 0007 and 0009 rule each one out.
3. **Icon.** No ADR decides one, but the Plugin switcher and the Registry need one. The proposal: a required `icon.svg`, drawn single-colour in `currentColor`, so the Hub can theme it.
4. **Cancelling a request.** `hub.backend.request` has no cancel. This prototype uses a Plugin-defined `cancel` notification and adds no Hub API. The alternative is a standard `$/cancelRequest`, with `request` returning a handle the way `hub.ai.chat` does.
5. **Hub Kit v1 = `<hub-folder-field>` + `<hub-log>`.** The folder field carries the Hub-translated "Browse…" text and calls `pickFolder` itself. The log needs success and danger colours, which layout-only plugin CSS cannot set. Everything else is a native element (`<progress>`, checkbox, `<select>`, `<details>`, `<pre>`). The alternative to `<hub-log>` is a Hub-styled tone attribute on any native element.

Feeds other tickets, with no decision needed here:

6. **Python SDK concurrency** (→ Monorepo structure and coding standards). Each request runs on its own thread, and notifications run inline on the reader thread. Without that, a `cancel` cannot arrive during a `run`. It also needs a stdout write lock and UTF-8, `\n`-only stdio on Windows.
7. **Where `hawkeye-hub` (Python) is published** (→ Monorepo structure and coding standards): PyPI, or a git dependency pinned in `uv.lock`.
8. **`backend.python` lives in the manifest and in `requires-python` in `pyproject.toml`.** Packaging must check that they agree.
9. **There is no path from `<input type=file>` to a Backend.** Electron 32 removed `File.path`. A sample PDF is therefore picked by having the Backend list a picked folder. `hub.files.pickFiles` joins when a Plugin needs a single file (already anticipated in ADR 0009).
10. **Regex flavour.** Validation happens in the Backend (Python `re`), never with the UI's JS `RegExp`, and the Playbook pins Python syntax.
11. **Per-file exception text** (`{kind: 'error', detail}`) stays untranslated English. That is acceptable for a technical detail; the plugin standard should say so.
