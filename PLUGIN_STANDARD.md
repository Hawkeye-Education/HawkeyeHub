# Plugin Standard

How to build a **Plugin** for the HawkeyeHub. Read [`CODING_STANDARDS.md`](CODING_STANDARDS.md) first, because every rule there applies to Plugin code, and use [`CONTEXT.md`](CONTEXT.md) for the vocabulary. This file adds what is specific to Plugins. The ADRs in [`docs/adr/`](docs/adr/) hold the reasons; each section links the ones it rests on.

The worked example throughout is the **PDF Watermark Eraser**: a Plugin UI, a Python Backend using PyMuPDF, and an Assistant that drafts watermark regexes. The [prototype](https://github.com/Hawkeye-Education/HawkeyeHub/tree/prototype/pdf-watermark-eraser/prototypes/pdf-watermark-eraser) shows the whole Plugin, but it predates the coding standard: it is plain JS, its handlers take raw `dict`s, and it has no tests. Where it differs from the excerpts below, the excerpts are right.

## 1. The shape of a Plugin

A Plugin is up to three parts, each optional except the first (ADRs 0003, 0004, 0010):

| Part | What it is | Runs as |
|---|---|---|
| **Plugin UI** (required) | TypeScript web content built into `ui/` | its own `WebContentsView`, a sandboxed Chromium renderer with no Node |
| **Backend** | Python, `backend/main.py` | its own OS process, started when the Plugin opens, speaking JSON-RPC over stdio |
| **Assistant** | Markdown in `agents/` | nothing of the Plugin's runs; the Hub reads the folder into the model's context |

Start UI-only. Add a Backend when the Plugin needs work its Plugin UI cannot do: a Python-only library (PyMuPDF, OpenCV, Playwright), or reading and writing folders staff picked. CPU-heavy work that needs no Python belongs in a Web Worker. Add an Assistant when staff need help *using* the Plugin; it advises and never acts (ADR 0001).

Lifecycle: nothing runs until staff open the Plugin. An open Plugin keeps running in the background when staff switch away, and only staff close it. Closing destroys the Plugin UI at once and sends the Backend `shutdown`, then kills its process tree about 5 s later. If any part crashes, the whole Plugin closes, and nothing restarts. So a Plugin never has to handle a half-alive state, and anything that must survive a close is written to disk as it happens.

## 2. Folder layout and ids

Every Plugin lives in the monorepo at `plugins/<id>/` (ADR 0011). Paths are fixed by convention, not declared (ADR 0010):

```
plugins/pdf-watermark-eraser/
  manifest.json          the Manifest (§3)
  icon.svg               required, single colour, currentColor only
  package.json           development only: scripts and devDependencies; never packed, no version
  vite.config.ts
  ui-src/                TypeScript source of the Plugin UI, plus its *.test.ts
  ui/                    Vite build output, gitignored; this is what ships
  backend/               only when manifest backend.kind is 'python'
    pyproject.toml
    uv.lock
    main.py              the entry point; the Hub runs it as a script with the venv's Python
    erase.py             any other modules
    tests/
  agents/                only when manifest assistant.kind is 'enabled'
    assistant.md
    skills/<name>/SKILL.md
```

`backend/` exists exactly when the Manifest declares a Backend, and `agents/` exactly when it enables an Assistant. Packaging refuses either mismatch.

**Ids.** A Plugin id is lowercase kebab-case, `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`, at most 64 characters, and never changes once published. It names the folder, the release tag (`plugin/<id>@<version>`), the Plugin's storage partition and its data folder. Shared Store names follow the same pattern.

**Icon.** A 24×24 `viewBox`, drawn with `stroke="currentColor"` or `fill="currentColor"` and no other colour, so the Hub tints it for the Theme and Colour Scheme.

## 3. The Manifest

`manifest.json` is the Plugin's only declaration (ADR 0010). Every field is required, and no other keys are allowed. A part the Plugin lacks is stated as `{"kind": "none"}`, never omitted. The zod schema in `packages/plugin-format` is the source of truth; the repo's `.vscode/settings.json` maps the generated `manifest.schema.json` onto `plugins/*/manifest.json`, so editors validate as you type. Packaging validates against the same schema.

```json
{
  "id": "pdf-watermark-eraser",
  "version": "1.0.0",
  "hubApi": "^1.0.0",
  "name": { "en-HK": "PDF Watermark Eraser", "zh-HK": "PDF 水印清除" },
  "description": {
    "en-HK": "Remove a text watermark from every PDF in a folder, keeping the folder structure.",
    "zh-HK": "移除資料夾內所有 PDF 的文字水印，並保留資料夾結構。"
  },
  "platforms": ["win32-x64", "darwin-arm64"],
  "identity": { "kind": "none" },
  "stores": [],
  "backend": { "kind": "python", "python": "3.12" },
  "assistant": {
    "kind": "enabled",
    "templates": [
      {
        "label": { "en-HK": "Draft a watermark regex", "zh-HK": "草擬水印正規表示式" },
        "text": {
          "en-HK": "Draft a Python regex that matches only the watermark in this page text, and nothing in the real content. Here is the page text I copied:\n\n<paste the page text here>",
          "zh-HK": "請草擬一個 Python 正規表示式，只配對以下頁面文字中的水印，不要配對正文。這是我複製的頁面文字：\n\n<在此貼上頁面文字>"
        }
      }
    ]
  }
}
```

| Field | Rule | ADR |
|---|---|---|
| `id` | See §2. | 0010 |
| `version` | Semver, and the only Plugin version. Each release is higher than the last. `backend/pyproject.toml`'s `version` and the release tag must equal it. | 0011 |
| `hubApi` | Semver range of Hub API versions the Plugin works with. Write `^1.N.0`, where `1.N` is the newest minor whose features you use. | 0005, 0009 |
| `name`, `description` | **Display text**: a plain English string, or a map of exact Display Language tags (`en-HK`, `zh-HK`). A map must include `en-HK` and holds no other tags. The Hub shows these in its Chrome and the Registry. | 0007 |
| `platforms` | The Supported Platforms the Plugin runs on: `win32-x64`, `darwin-arm64`. List only those you have tested; CI runs your tests on each. | 0003, 0005 |
| `identity` | `{"kind": "none"}`, or `{"kind": "required", "roles": [...]}` when the Plugin needs to know who is using it. An empty `roles` means any signed-in staff member. Roles are names from the company's Role Mapping. | 0002 |
| `stores` | Names of the Shared Stores the Plugin reads or writes. Each needs a format document in `stores/<name>.md` (§6). | 0008 |
| `backend` | `{"kind": "none"}`, or `{"kind": "python", "python": "3.12"}`. The minor must agree with `requires-python` in `backend/pyproject.toml`. | 0003, 0010 |
| `assistant` | `{"kind": "none"}`, or `{"kind": "enabled", "templates": [...]}`, where each Prompt Template has a display-text `label` and `text`. | 0004, 0010 |

There are no fields for permissions, locales or styling. Plugins are trusted, so a permission would gate nothing (ADR 0009). The Plugin UI handles its own languages (§4.4), and the Hub owns every visual (§4.3).

## 4. The Plugin UI

### 4.1 Build

The Plugin UI is TypeScript built by Vite from `ui-src/` into `ui/`, with any framework or none (ADR 0006). The PDF Watermark Eraser uses plain DOM. Reach for Lit, which the Hub Kit and Hub Chrome are built with, when a screen's state outgrows hand-written DOM updates.

```ts
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'ui-src',
  base: './', // the Hub serves the UI from hawkeye-plugin://<id>/, so asset URLs must be relative
  build: { outDir: '../ui', emptyOutDir: true, target: 'esnext' }, // one known Chromium; top-level await is fine
});
```

`package.json` scripts: `build` (`vite build`), `dev` (`vite build --watch`), `test` (`vitest run`) and `typecheck` (`tsc --noEmit`, extending the shared `tsconfig`). Lint and format run from the repo root. The types for `window.hub`, the Hub Kit elements and the `Manifest` come from the `@hawkeye-hub/hub-api` workspace package; add it as a devDependency.

### 4.2 What the page gets

Before your code runs, the Hub preload has set `<html lang>`, loaded the `--hub-*` tokens, the native-element stylesheet and the Hub Kit, and exposed the **Hub API** as `window.hub` (ADR 0009). The page is a sandboxed renderer: it has no Node, no `require` and no filesystem.

**Native features first.** Use the platform for anything it already does. The Hub API covers only the rest:

| Need | Use |
|---|---|
| HTTP | `fetch` (CORS applies) |
| Clipboard | `navigator.clipboard` |
| Let staff hand over file *contents* | `<input type=file>`, drag-drop |
| Save a file staff choose | `<a download>` (the Hub opens a native save dialog) |
| Open a web page | `<a href="https://…" target="_blank">` (opens in the system browser) |
| Notice the Plugin going to the background or closing | `visibilitychange`, `pagehide` |
| Long CPU work | a Web Worker; hidden Plugin UIs are throttled |
| A folder the Backend should read or write | `hub.files.pickFolder(title)` |
| Reveal a folder in Explorer or Finder | `hub.files.openFolder(path)` |
| Talk to your Backend | `hub.backend` |
| Read or write a Shared Store | `hub.stores` |
| Call an AI model from your own UI | `hub.ai` |
| Warn staff before they close mid-work | `hub.busy` |
| Who is using the Plugin | `hub.identity` |

`<input type=file>` gives a `File`, never a path, so a Backend cannot open it. When the Backend needs files, pick a folder and let the Backend list it, as the eraser does. A namespace exists only when the Manifest gives it a reason: there is no `hub.backend` without a Backend and no `hub.identity` unless identity is required. Read them once at startup:

```ts
// ui-src/hub.ts
export const hub = window.hub;
const maybeBackend = hub.backend;
if (maybeBackend === undefined) throw new Error('manifest declares a Backend but hub.backend is absent');
export const backend = maybeBackend;
```

The Plugin UI cannot open windows (`window.open` is refused), add to the Hub Chrome or reach Electron. All dialogs are the Hub's.

### 4.3 Styling

The Hub owns every visual, so the Plugin looks right in every Theme and Colour Scheme with no work from you (ADR 0006).

- Compose the screen from **native elements**, which the Hub stylesheet already styles, and the **Hub Kit**. Mark the screen's one main action with `<button data-variant="primary">`; every other button stays plain.
- Write **layout CSS**: `display`, flex and grid, `gap`, `margin`, `padding`, sizes, `overflow`, `position`. Take spacing from `--hub-space-*`.
- When you must build a widget that neither offers, take every visual value (colour, background, border, font, radius, shadow, glass, transition timing) from a `--hub-*` token, written as `var(--hub-…)`; ADR 0006 lists them. Plugin CSS never contains a literal colour, font family, radius or shadow. When a second Plugin needs the same widget, propose it for the Hub Kit instead.

Hub Kit v1 (ADR 0010):

| Element | API |
|---|---|
| `<hub-folder-field>` | `label` (string; also the dialog title). `value`: `{kind: 'none'} \| {kind: 'chosen', path}`. Its Hub-translated **Browse…** button calls `hub.files.pickFolder` and fires `change`. |
| `<hub-log>` | `append({tone: 'info' \| 'success' \| 'danger', text})`, `clear()`. Auto-scrolls. Use it wherever success or failure needs colour. |

```css
/* ui-src/layout.css */
main { padding: var(--hub-space-4); max-width: 60rem; }
.stack { display: flex; flex-direction: column; gap: var(--hub-space-3); }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--hub-space-3); }
hub-log { height: 14rem; }
```

### 4.4 Translation

The Plugin UI translates its own strings with **i18next** (ADR 0007). The Hub translates only what it draws: the Hub Chrome, the Hub Kit's built-in text and the Manifest's display text. Every Plugin ships English (`en-HK`); other Display Languages are added as translations exist.

```ts
// ui-src/strings/en-HK.ts
export const enHK = {
  input: 'Input folder',
  run: 'Remove watermarks',
  busy: 'Removing watermarks. Closing now stops the run part-way.',
  summary: 'Done: {{cleaned}} cleaned, {{failed}} failed, {{total}} total.',
  result: { removed_one: 'OK    {{file}}: removed {{count}} object', removed_other: 'OK    {{file}}: removed {{count}} objects' },
  error: { 'same-folder': 'Input and output folders must differ.', internal: 'Something went wrong: {{detail}}' },
};
```

```ts
// ui-src/strings/zh-HK.ts — typed by the English strings, so a missing key fails the typecheck
import type { enHK } from './en-HK';

export const zhHK: typeof enHK = {
  input: '輸入資料夾',
  // …every key in enHK
};
```

```ts
// ui-src/i18n.ts
import i18next from 'i18next';
import { hub } from './hub';
import { enHK } from './strings/en-HK';
import { zhHK } from './strings/zh-HK';

declare module 'i18next' {
  interface CustomTypeOptions { resources: { translation: typeof enHK } }
}

await i18next.init({
  lng: hub.displayLanguage, // fixed until staff reopen the Plugin, so there is no language-change handling
  fallbackLng: 'en-HK', // any tag you have no translation for, including future ones
  load: 'currentOnly', // exact tags only; zh-HK never falls to zh
  resources: { 'en-HK': { translation: enHK }, 'zh-HK': { translation: zhHK } },
  interpolation: { escapeValue: false }, // strings go into textContent, never innerHTML
});
```

- Write text into the DOM with `textContent`, never `innerHTML`.
- Plurals use i18next's `_one` / `_other` keys, chosen by `Intl.PluralRules`. A language with fewer plural forms repeats its `_other` text under the other keys.
- Format dates, numbers and HKD amounts with `Intl` and `hub.displayLanguage` (`new Intl.NumberFormat(hub.displayLanguage, {style: 'currency', currency: 'HKD'})`).
- `hub.displayLanguage` may be a tag you have never heard of. The fallback handles it.
- A Backend has no language. When it must produce staff-facing text, pass the language as an ordinary request parameter. Otherwise it returns reason codes that the UI translates (§5.3).
- Text the UI hands the Hub, such as the `hub.busy.set` reason, is already translated.
- The Assistant replies in the staff member's language by itself; Playbooks stay in English.

### 4.5 Talking to the Backend

`hub.backend.request(method, params)` returns `unknown` in practice: the Backend is across a trust boundary. Parse every result and notification with zod in one module, `ui-src/protocol.ts`, which is the TypeScript half of the Plugin's protocol. The Python models (§5.2) are the other half. Names on the wire are camelCase.

```ts
// ui-src/protocol.ts
import { z } from 'zod';

export const ListPdfsResult = z.object({ files: z.array(z.string()) }).strict();

export const FileResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cleaned'), removed: z.number().int() }).strict(),
  z.object({ kind: z.literal('no-match') }).strict(),
  z.object({ kind: z.literal('password') }).strict(),
  z.object({ kind: z.literal('error'), detail: z.string() }).strict(),
]);
export const Progress = z.object({ done: z.number().int(), total: z.number().int(), file: z.string(), result: FileResult }).strict();

// The Plugin's own reasons, plus the three every SDK Backend can send.
export const Reason = z.enum([
  'pattern-empty', 'pattern-invalid', 'same-folder', 'output-inside-input', 'folder-missing', 'password', 'already-running',
  'invalid-params', 'method-not-found', 'internal',
]);
export const RpcData = z.object({ reason: Reason }).strict();
```

```ts
const { files } = ListPdfsResult.parse(await backend.request('listPdfs', { folder }));
const unsubscribe = backend.onNotification('progress', (raw) => showProgress(Progress.parse(raw)));
```

Only the Plugin UI sends requests; the Backend only sends notifications. Requests made before the Backend has started are queued by the Hub.

### 4.6 Errors

Every `window.hub` rejection is a `HubError` whose `code` is a closed union (ADR 0009). Handle it with an exhaustive `switch`. A code that cannot happen in your Plugin is rethrown, not ignored:

```ts
import type { HubError } from '@hawkeye-hub/hub-api';
import i18next from 'i18next';
import { RpcData } from './protocol';

export function explain(e: unknown): string {
  // Every window.hub rejection is a HubError (ADR 0009); TypeScript cannot type a promise's rejection.
  const err = e as HubError;
  switch (err.code) {
    case 'backend-error': {
      const { reason } = RpcData.parse(err.rpc.data);
      return i18next.t(`error.${reason}`, { detail: err.rpc.message });
    }
    case 'store-not-declared':
    case 'provider-missing':
    case 'bad-path':
      throw err; // this Plugin declares no stores and makes no AI calls
    default: {
      const unreachable: never = err;
      throw new Error(`unhandled HubError ${JSON.stringify(unreachable)}`);
    }
  }
}
```

### 4.7 Busy

While closing would lose work, mark the Plugin Busy, and clear it in a `finally`:

```ts
await hub.busy.set(i18next.t('busy'));
try {
  const result = RunResult.parse(await backend.request('run', params));
  showSummary(result);
} catch (e) {
  showMessage(explain(e));
} finally {
  await hub.busy.clear();
}
```

Staff can still close a Busy Plugin after confirming, so the Backend must leave no half-written output when it gets `shutdown` (§5.4).

### 4.8 Plugin Data

The Plugin UI keeps its own data in web storage (`localStorage`, IndexedDB). The Hub gives each Plugin a persistent partition, so the data is private to the Plugin and survives updates (ADR 0008). Stored data is a trust boundary like any other:

- Store a version with the data, and parse it with zod at open.
- **Migrate forward only, at open.** There is no rollback, so a Plugin never meets data from a newer version of itself. Keep every old version's schema and a step to the next.
- An absent key is the first open, a real state with its own initial value. Corrupt data throws: staff can recover with uninstall plus "delete my data". The code never guesses.

```ts
// ui-src/settings.ts
import { z } from 'zod';

const Folder = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z.object({ kind: z.literal('chosen'), path: z.string() }).strict(),
]);
const V1 = z.object({ v: z.literal(1), input: Folder, output: Folder, pattern: z.string(), regex: z.boolean(), ignoreCase: z.boolean() }).strict();
const Stored = z.discriminatedUnion('v', [V1]);
export type Settings = z.infer<typeof V1>; // always the newest version

const KEY = 'settings';
const FIRST_OPEN: Settings = { v: 1, input: { kind: 'none' }, output: { kind: 'none' }, pattern: '', regex: false, ignoreCase: true };

export function loadSettings(): Settings {
  const raw = localStorage.getItem(KEY);
  if (raw === null) return FIRST_OPEN;
  return migrate(Stored.parse(JSON.parse(raw)));
}

function migrate(stored: z.infer<typeof Stored>): Settings {
  switch (stored.v) {
    case 1:
      return stored; // when V2 lands: case 1: return migrate(v1ToV2(stored));
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(settings));
}
```

The Backend's private folder is `ctx.data_dir` (§5.5). Plugin Data belongs to the OS user, never leaves the machine and is never synced.

### 4.9 AI from the Plugin UI

`hub.ai.chat` lets the Plugin UI call a model for its own features, separately from the Assistant. Use `{kind: 'default'}` unless staff chose a model in your UI from `hub.ai.providers()`. There is no tool calling and no structured output. Parse what comes back as untrusted text. Backends never call AI: the UI calls it and passes the result over the protocol.

## 5. The Backend

### 5.1 Project

`backend/` is a standalone uv project with its own `uv.lock`; it is not a uv-workspace member (ADR 0011). It depends on the `hawkeye-hub` SDK from PyPI, whose major version equals the Hub API major. The SDK is optional, since the contract is the wire protocol, but every Plugin in this repo uses it.

```toml
# backend/pyproject.toml
[project]
name = "pdf-watermark-eraser-backend"
version = "1.0.0"            # equals the Manifest version
requires-python = "==3.12.*" # agrees with the Manifest's backend.python
dependencies = ["pymupdf>=1.24", "hawkeye-hub>=1.0,<2"]

[dependency-groups]
dev = ["pytest", "pyright", "ruff"] # never installed for staff: the Hub runs `uv sync --frozen --no-dev`
```

Run `uv sync` in `backend/` to build `backend/.venv` for development, tests and dev mode. Commit `uv.lock`. The Hub builds staff's venv from it.

### 5.2 Handlers

Each request handler takes the `Context` and one frozen model, and returns a model. Subclass `hawkeye_hub.Model`: it is frozen, forbids extra keys, and maps snake_case fields to camelCase on the wire. The SDK validates incoming `params` against the handler's annotation and answers bad input with `-32602`, `data.reason: 'invalid-params'`.

```python
# backend/main.py
import re
import threading
from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field

from erase import PasswordProtected, remove_watermark
from hawkeye_hub import Backend, Context, Model, RpcError

app = Backend()
cancelled = threading.Event()
running = threading.Lock()


class Run(Model):
    input: Path
    output: Path
    pattern: str
    regex: bool
    ignore_case: bool


class RunResult(Model):
    cleaned: int
    failed: int
    total: int
    cancelled: bool


class Cleaned(Model):
    kind: Literal["cleaned"]
    removed: int


class NoMatch(Model):
    kind: Literal["no-match"]


class Password(Model):
    kind: Literal["password"]


class Failed(Model):
    kind: Literal["error"]
    detail: str


class Progress(Model):
    done: int
    total: int
    file: str
    result: Annotated[Cleaned | NoMatch | Password | Failed, Field(discriminator="kind")]


class Empty(Model):
    pass


@app.request("run")
def run(ctx: Context, p: Run) -> RunResult:
    if not p.input.is_dir():
        raise RpcError("folder-missing", f"{p.input} is not a folder")
    if p.input.resolve() == p.output.resolve():
        raise RpcError("same-folder", "input and output are the same folder")
    try:
        rx = re.compile(p.pattern if p.regex else re.escape(p.pattern), re.I if p.ignore_case else 0)
    except re.error as e:
        raise RpcError("pattern-invalid", str(e)) from e
    if not running.acquire(blocking=False):
        raise RpcError("already-running", "a run is already in progress")
    try:
        cancelled.clear()
        files = sorted(f for f in p.input.rglob("*") if f.is_file() and f.suffix.lower() == ".pdf")
        cleaned = done = 0
        for f in files:
            if cancelled.is_set():
                break
            rel = f.relative_to(p.input)
            target = p.output / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            result: Cleaned | NoMatch | Password | Failed
            try:
                removed = remove_watermark(f, target, rx)  # saves to a temp file, then os.replace
                result = Cleaned(kind="cleaned", removed=removed) if removed else NoMatch(kind="no-match")
            except PasswordProtected:
                result = Password(kind="password")
            except Exception as e:  # reported to staff per file, so one damaged PDF doesn't stop the batch
                result = Failed(kind="error", detail=f"{type(e).__name__}: {e}")
            cleaned += isinstance(result, Cleaned)
            done += 1
            ctx.notify("progress", Progress(done=done, total=len(files), file=rel.as_posix(), result=result))
        return RunResult(cleaned=cleaned, failed=done - cleaned, total=len(files), cancelled=cancelled.is_set())
    finally:
        running.release()


@app.notification("cancel")
def on_cancel(ctx: Context, p: Empty) -> None:
    cancelled.set()


@app.notification("shutdown")
def on_shutdown(ctx: Context, p: Empty) -> None:
    cancelled.set()  # stop between files, so no half-written PDF is left behind


if __name__ == "__main__":
    app.serve()
```

- Each request runs on its own thread, and each notification runs inline on the reader thread. That is how `cancel` reaches a running `run`. Keep notification handlers short, and guard shared state with a lock.
- **Validate in the Backend's own language.** A regex is compiled with Python `re`, the flavour that will run it, never checked with the UI's JS `RegExp`. The Playbook pins Python syntax to match.
- Push a long job's progress with `ctx.notify`. A notification's params are a `Model` too, mirrored in `protocol.ts`.

### 5.3 Errors

Reject a request with `RpcError(reason, message)`. The `reason` is a kebab-case code that the UI translates. The `message` is technical English, which may reach staff as `{{detail}}`, so it is fine for exception text. Every reason you raise appears in the `Reason` enum in `protocol.ts`. The SDK adds three reasons of its own: `invalid-params`, `method-not-found`, and `internal` for an uncaught exception, whose traceback goes to stderr.

### 5.4 Cancel and shutdown

- A request longer than a few seconds checks a Plugin-defined `cancel` notification between units of work, such as files. There is no Hub-level cancel (ADR 0010).
- Handle `shutdown` as a cancel. After your handler returns and in-flight requests finish, the SDK exits the process. Whatever is still running about 5 s after `shutdown` is killed with its whole process tree, including any browser Playwright launched.
- Write each output file whole or not at all: write to a temp file beside the target, then `os.replace` it.

### 5.5 Files, stores and processes

- `ctx.data_dir` is the Backend's private Plugin Data folder. `ctx.stores` maps each declared Shared Store to its folder. `ctx.hub_api` is the Hub API version the Hub implements.
- Read and write staff's files only under folders the Plugin UI picked with `hub.files.pickFolder` and passed in a request.
- stdout is the protocol. The SDK moves `sys.stdout` to stderr, so a stray `print()` is harmless, and stderr is the Backend's log. Log with `logging` to stderr.
- Reach other programs as child processes. The Backend never listens on a port: no local HTTP servers, no sockets (ADR 0003).
- Never rely on the process locale. The Backend gets no `LANG`, and the SDK sets UTF-8 stdio itself.

### 5.6 Driving a browser

A Playwright Backend drives the browser staff already have, never a downloaded one. The Hub ships no browser and sets no `PLAYWRIGHT_BROWSERS_PATH`, so never run `playwright install` (ADR 0003).

- Use `channel="msedge"` on `win32-x64`, where Edge is always installed, and `channel="chrome"` on `darwin-arm64`.
- Launch with `launch_persistent_context` and a profile under `ctx.data_dir`, so a sign-in survives between runs and stays in the Plugin's private data. Never point it at staff's own browser profile.
- When the browser is missing, the launch fails. Raise `RpcError("browser-not-found", ...)` and let the UI tell staff which browser to install. The Manifest says nothing about browsers.
- A headed window is fine when staff must sign in or watch. It is a website, not Plugin UI, so ADR 0006's no-windows rule does not cover it.

```python
import sys

from playwright.sync_api import Error as PlaywrightError, sync_playwright

channel = "msedge" if sys.platform == "win32" else "chrome"
with sync_playwright() as p:
    try:
        browser = p.chromium.launch_persistent_context(
            ctx.data_dir / "browser-profile", channel=channel, headless=False
        )
    except PlaywrightError as e:
        raise RpcError("browser-not-found", str(e)) from e
```

## 6. Shared Stores

A Shared Store is how two Plugins work on the same data: an ownerless folder that every Plugin declaring it may read and write (ADR 0008).

- **Declaring.** Add the name to the Manifest's `stores`. The first Plugin to declare a new store also adds `stores/<name>.md` in the same PR, describing its layout and every file format. Packaging refuses a store without its document.
- **Formats change additively.** New files and new fields are fine, and older readers ignore them. Renaming, removing or retyping is a breaking change, which means a new store name (`kb-2`) that Plugins move to when ready. Update `stores/<name>.md` with every change.
- **Writes are atomic, and the last writer wins.** The Plugin UI's `hub.stores.writeText` / `writeBytes` already replace atomically. A Backend writes a temp file in the same folder, then calls `os.replace`. There are no locks: lay out data that must merge as one item per file (one note per file, one receipt per file), never one shared index that two Plugins rewrite.
- **Paths** given to `hub.stores` are relative and POSIX-style (`notes/2026/a.md`). `..` and absolute paths are refused.
- Watch with `hub.stores.watch(store, handler)`, which sends `{path, kind: 'changed' | 'removed'}`, and call the returned function to stop.
- A store whose other Plugins aren't installed is simply empty. Handle the empty folder as a normal state.

## 7. Identity and Roles

Declare `identity: {"kind": "required", "roles": [...]}` only when the Plugin uses who is signed in, or must be limited to some staff (ADR 0002). Then `hub.identity` is `{id, name, email, roles}`, fixed for the open. The Plugin never sees a credential. Without an Auth Provider, such a Plugin cannot be installed or opened. Roles are a soft gate that decides what staff see, not what code can reach, so data that is truly sensitive is protected at its source. A Plugin with `identity: none` never gets `hub.identity`.

## 8. The Assistant

Enable an Assistant when staff need advice while using the Plugin: drafting a regex, explaining a failure. It cannot see staff's files, run the Plugin or call tools. It sees only `agents/` and what staff paste into the chat (ADRs 0001, 0004, 0010).

- **`agents/assistant.md`** is the system prompt: what the Plugin does, what the Assistant is for, and the shape of a good answer. The Hub puts its own preamble before it.
- **`agents/skills/<name>/SKILL.md`** is the Playbook, in the open Agent Skills format. The frontmatter has `name` (equal to the folder name) and `description`, plus `license`, `compatibility` or `metadata` if you need them. `allowed-tools` and vendor keys (Claude's `model`, Codex's `agents/openai.yaml`) are refused, because Assistants have no tools. A Skill may hold `references/` and text `assets/`, and never `scripts/`. Packaging runs `skills-ref validate` plus these checks.
- The Hub loads every Skill whole into every conversation, so `description` is documentation, not a trigger. Keep the Playbook small; the provider's context limit is the only cap.
- Write Playbooks in English, and test them in any Agent Skills client by pointing it at `agents/skills/`.
- **Prompt Templates** live in the Manifest (§3). Staff pick one, edit it and send it themselves. Mark where staff should paste with `<paste … here>`. The Plugin UI cannot send to the Assistant Panel or pre-fill it, so the UI helps staff *copy* what the Assistant needs instead, as the eraser's "Copy page text" button does.
- The Manifest names no model. The Assistant uses the installation's Default AI Provider unless staff choose another.
- Nothing outside `agents/` ever reaches a model.

## 9. Testing

Every part a Plugin has must have at least one test, and publishing refuses on any failure (CODING_STANDARDS.md). Test behaviour through the protocol and the DOM, the way staff and the Hub use the Plugin.

### 9.1 Plugin UI: Vitest + `@hawkeye-hub/fake-hub`

Plugin UI tests run under happy-dom against a fake `window.hub`. `installFakeHub` builds it from your Manifest, so namespaces are present or absent exactly as in the Hub. Every call is recorded, and a request with no handler fails the test.

```ts
// ui-src/main.test.ts
import { backendError, installFakeHub } from '@hawkeye-hub/fake-hub';
import { expect, test } from 'vitest';
import manifest from '../manifest.json';
import html from './index.html?raw';

test('a rejected run shows the translated reason and clears Busy', async () => {
  const fake = installFakeHub({ manifest, displayLanguage: 'zh-HK', identity: { kind: 'none' } });
  fake.backend.handle('listPdfs', () => ({ files: ['a.pdf'] }));
  fake.backend.handle('run', () => { throw backendError('same-folder', 'input and output are the same folder'); });
  document.body.innerHTML = html;
  await import('./main');

  fake.files.queuePick({ kind: 'chosen', path: 'C:\\pdfs' });
  // …pick both folders, enter a pattern, click Remove watermarks
  await fake.settle();

  expect(document.querySelector('#summary')?.textContent).toBe('輸入及輸出資料夾必須不同。');
  expect(fake.busy.state).toEqual({ kind: 'idle' });
});
```

The fake's surface: `installFakeHub({manifest, displayLanguage, identity})`, where `identity` is `{kind: 'none'}` or `{kind: 'signed-in', identity}` and must match the Manifest. `fake.backend.handle(method, fn)`, `fake.backend.emit(method, params)` (a Backend notification), `fake.backend.requests` and `fake.backend.notifications` (what the UI sent). `fake.files.queuePick(result)` and `fake.files.opened`. `fake.stores.files(store)` (an in-memory `Map` of path to contents). `fake.ai.queueReply(text)` and `fake.ai.chats`. `fake.busy.state`. `fake.settle()` waits for pending Hub calls. `backendError(reason, message)` builds the `HubError` a Backend rejection becomes.

Test at least one path per `Reason` the UI can show, and the Plugin Data migration from every older version.

### 9.2 Backend: pytest + `hawkeye_hub.testing`

Backend tests drive the real `main.py` over real stdio, exactly as the Hub does. `run_backend` sends `initialize`, and on exit sends `shutdown`. The test fails if the process is still alive after the Hub's grace period.

```python
# backend/tests/test_run.py
from pathlib import Path

import pymupdf
import pytest

from hawkeye_hub.testing import BackendFailed, run_backend

BACKEND = Path(__file__).parent.parent


def make_pdf(path: Path, watermark: str) -> None:
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 100), "Quarterly report")
    page.insert_text((100, 500), watermark, fontsize=40)
    path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(path)


def test_run_cleans_nested_pdfs_and_reports_progress(tmp_path: Path) -> None:
    make_pdf(tmp_path / "in" / "sub" / "a.pdf", "Provided by dse.life")
    with run_backend(BACKEND, data_dir=tmp_path / "data", stores={}, hub_api="1.0.0") as backend:
        result = backend.request("run", {
            "input": str(tmp_path / "in"), "output": str(tmp_path / "out"),
            "pattern": r"Provided\s+by\s+dse\.life", "regex": True, "ignoreCase": False,
        })
        assert result == {"cleaned": 1, "failed": 0, "total": 1, "cancelled": False}
        assert [n["file"] for n in backend.notifications("progress")] == ["sub/a.pdf"]
    assert (tmp_path / "out" / "sub" / "a.pdf").exists()


def test_run_refuses_the_same_folder(tmp_path: Path) -> None:
    (tmp_path / "in").mkdir()
    with run_backend(BACKEND, data_dir=tmp_path / "data", stores={}, hub_api="1.0.0") as backend:
        with pytest.raises(BackendFailed) as failed:
            backend.request("run", {
                "input": str(tmp_path / "in"), "output": str(tmp_path / "in"),
                "pattern": "x", "regex": False, "ignoreCase": False,
            })
    assert failed.value.reason == "same-folder"
```

The harness's surface: `run_backend(backend_dir, *, data_dir, stores, hub_api)` starts `main.py` with the current interpreter, which is `backend/.venv`'s Python under `uv run pytest`. The running Backend offers `request(method, params)`, which returns the decoded result or raises `BackendFailed(code, reason, message)`; `notify(method, params)`; `notifications(method)`, the params received so far; `wait_for(method, count, timeout)`; and `stderr`. Build test files in code, as above, rather than committing binaries, unless a real-world sample is the point of the test.

Test every reason the Backend raises, cancel mid-run, and `shutdown` mid-run leaving no partial file.

### 9.3 Running checks

```
pnpm --filter pdf-watermark-eraser typecheck
pnpm --filter pdf-watermark-eraser test
pnpm lint                                    # ESLint + Prettier, repo-wide
cd plugins/pdf-watermark-eraser/backend && uv run pytest && uv run pyright && uv run ruff check && uv run ruff format --check
pnpm --filter pdf-watermark-eraser build && pnpm plugin-format check plugins/pdf-watermark-eraser
```

CI runs all of these on every PR.

### 9.4 In the real Hub: dev mode

Run the Plugin in the real Hub before publishing:

```
cd plugins/pdf-watermark-eraser && pnpm dev               # vite build --watch into ui/
cd plugins/pdf-watermark-eraser/backend && uv sync        # builds backend/.venv
pnpm dev --plugin pdf-watermark-eraser                    # from the repo root; repeat --plugin for more
```

Dev mode starts a development build of the Hub that treats each named `plugins/<id>/` folder as installed:

- It runs `plugin-format check` on each Plugin first, then applies the install gates (Supported Platforms, identity and Roles, `hubApi`), and refuses as a real install would.
- It uses its own app data folder, so dev data never mixes with an installed Hub, and the Registry is off: no installs and no updates.
- The Plugin UI is served from `plugins/<id>/ui/` and the Backend runs from `backend/.venv`. Close and reopen the Plugin to load changes to either.
- Plugin UIs get DevTools (Ctrl+Shift+I, or Cmd+Option+I on macOS). Each Backend's stderr is printed in the terminal, prefixed with the Plugin id.
- It signs in with the Company Configuration from the Registry. Pass `--company-config <file>` to test identity against a local Keycloak instead (ADR 0002). AI Providers are configured in the dev Hub's settings, as on any installation.

## 10. Publishing

1. Bump `version` in `manifest.json`, and in `backend/pyproject.toml` if there is a Backend. If you now use a newer Hub API minor, raise the `hubApi` range to it.
2. Merge the change to `main` by squashed PR with CI green.
3. Tag the merge commit `plugin/<id>@<version>` and push the tag.

CI then builds `ui/`, runs `plugin-format check`, runs the tests on one runner per Supported Platform, packs the Plugin Package and publishes it to the Registry. It refuses on any failure (ADR 0011). The Plugin Package is one platform-neutral zip holding `manifest.json`, `icon.svg`, `ui/`, `agents/`, and `backend/` without `.venv/`, `tests/` or caches. Wheels are never vendored: the Hub builds the venv from `uv.lock` on each machine (ADR 0005).

`plugin-format check` refuses a Manifest that fails the schema, a missing or unexpected fixed path, `backend.python` disagreeing with `requires-python`, a version disagreeing with `pyproject.toml` or the tag, an unsatisfiable `hubApi` range, a declared store without `stores/<name>.md`, and a Skill failing `skills-ref validate`.

Updates reach staff silently, installed side by side and swapped in while the Plugin is closed. Staff cannot pin or roll back, so a bad release is fixed by publishing a higher version. Make every release open cleanly on data any earlier version wrote (§4.8).

## 11. Review checklist

`/code-review` checks a Plugin diff against CODING_STANDARDS.md and this list:

- Manifest validates. Every `kind` is stated. `version`, `pyproject.toml` and `hubApi` agree with what the code uses.
- The Plugin UI uses a native feature wherever one exists, and parses every Backend result, notification, stored value and `rpc.data` with zod in one place.
- `HubError` codes are handled with an exhaustive switch.
- CSS is layout plus `var(--hub-*)` tokens, with no literal colour, font, radius or shadow. The screen is built from native elements and the Hub Kit.
- Every staff-facing string goes through i18next with an `en-HK` entry. `zh-HK` typechecks against it. Text goes into `textContent`.
- Long work sets and clears Busy in a `finally`.
- Handlers take a frozen `Model`. Every raised reason is in `protocol.ts`. Regexes and other input are validated in Python.
- Long requests check `cancel`. `shutdown` stops work cleanly. Output files and store writes are atomic replaces.
- A Playwright Backend uses `channel=` with a profile under `ctx.data_dir`, never `playwright install`, and reports `browser-not-found`.
- Shared Store changes are additive and documented in `stores/<name>.md`.
- Skills use only the allowed frontmatter and contain no `scripts/`. Nothing the Assistant needs lives outside `agents/`.
- Each part has a test. New reasons and migrations have tests.
