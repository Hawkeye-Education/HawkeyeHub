# Research: Saving many `.docx` files from a Plugin UI into one folder staff pick

Resolves #193. Feeds the Invoice plugin spec (#187). **Facts and trade-offs only. This doc makes no decision.**

Researched 2026-11-01 against `main` at `6a7f4ba`: Hub API 1.4.0 (`packages/hub-api/package.json`) and the Hub's Electron 44.5.1. Each claim is tagged **[source]** (read in this repo's code, ADRs or Electron's installed types, cited by file:line) or **[inferred]** (our reading; not run).

## TL;DR

- **No.** Under Hub API 1.x a Plugin UI with no Backend cannot write files into a folder from `hub.files.pickFolder` / `<hub-folder-field>`. `hub.files` only picks and reveals folders. The Backend does the I/O. **[source]**
- The one native way a Plugin UI writes a file is `<a download>`. The Hub answers each download with its own modal save dialog. So 100 Invoices means 100 dialogs. **[source]**
- The cheap ways out:
  1. **One zip** through a single save dialog. No Hub change. `jszip` is already in the repo.
  2. **A new Hub API call**, such as `hub.files.writeBytes(folder, name, bytes)`, as a Hub API 1.5.0 minor bump. Plugin code stays trivial, but the call is frozen until 2.0.
  3. **A minimal Python Backend**, which is what both existing folder-writing Plugins do. It works today, but it brings Python, uv and a JSON-RPC protocol to a Plugin that otherwise needs none.
- A fourth option, Chromium's `showDirectoryPicker`, is blocked today because the Hub denies the `fileSystem` permission. Granting it means changing the Hub and amending ADR 0009.

## 1. What Hub API 1.x gives a Plugin UI for files

- `HubFiles` has exactly two calls: `pickFolder(title)` and `openFolder(path)`. Its doc comment reads "The Backend does the I/O on a picked path." (`packages/hub-api/src/index.ts:105-111`). **[source]**
- `FolderPath` is an opaque branded string that "a Plugin keeps … and passes on" (`packages/hub-api/src/index.ts:93-98`). No Plugin UI call accepts one except `openFolder`. **[source]**
- `<hub-folder-field>` is only a label, a path and a **Browse…** button that calls `hub.files.pickFolder(label)` (`packages/hub-api/src/hub-kit.ts:8-21`, `apps/hub/src/hub-kit/components.ts:74`). **[source]**
- ADR 0009 says: "`hub.files` offers `pickFolder(title)` … and `openFolder(path)` … The Backend does the I/O on picked paths. `pickFiles` and similar calls join only when a Plugin needs them." (`docs/adr/0009-hub-api-is-one-window-hub-object-native-first.md:12`). **[source]**
- ADR 0008: "Plugin UIs, which have no filesystem access, get list, read, write and watch calls through the Hub API". Those calls work only on Shared Stores in app data, never on a staff-chosen folder (`docs/adr/0008-shared-stores-are-ownerless-folders-with-additive-formats.md:3`). `hub.stores.writeBytes` takes a store name and a relative path (`packages/hub-api/src/index.ts:73-81`). **[source]**
- PLUGIN_STANDARD says a Backend is added for "reading and writing folders staff picked" (`PLUGIN_STANDARD.md:17`). The UI is "a sandboxed renderer: it has no Node, no `require` and no filesystem" (`PLUGIN_STANDARD.md:120`). The table of native features lists `pickFolder` as "A folder the Backend should read or write" (`PLUGIN_STANDARD.md:134`). **[source]**
- The Hub's implementation matches the types. `serveFiles` registers only the `FILES_PICK_FOLDER` handler (`dialog.showOpenDialog` with `openDirectory`) and the `FILES_OPEN_FOLDER` handler (`shell.openPath`). It has no write handler (`apps/hub/src/main/files.ts:18-45`). The preload exposes only those two (`apps/hub/src/preload/plugin.ts:78-85`). The fake Hub mirrors this: `queuePick` and `opened` (`packages/fake-hub/src/index.test.ts:63-76`). **[source]**
- Precedent: both Plugins that write to a picked folder do it from a Python Backend. The PDF Watermark Eraser writes from `backend/erase.py:136`, and the FB Test Paper Downloader from `backend/facebook.py:275`. Each one's UI only holds the `<hub-folder-field>` (`plugins/pdf-watermark-eraser/ui-src/main.ts:28-29`, `plugins/fb-test-paper-downloader/ui-src/main.ts:30`). **[source]**

## 2. How Receipt Extractor saves its one file

- It builds the `.docx` as a `Blob`, points an `<a download=name>` at `URL.createObjectURL(docx)` and clicks it (`plugins/receipt-extractor/ui-src/main.ts:153-165`). **[source]**
- The Hub catches the download in `will-download`. It shows `dialog.showSaveDialogSync`, defaulting to the Downloads folder plus the suggested file name. Cancelling skips that file (`apps/hub/src/main/plugin-lockdown.ts:82-96`). The dialog is synchronous because the save path must be set before the handler returns (`plugin-lockdown.ts:83`). **[source]**
- PLUGIN_STANDARD's table: "Save a file staff choose | `<a download>` (the Hub opens a native save dialog)" (`PLUGIN_STANDARD.md:129`). **[source]**

## 3. Options

### A. One save dialog per file (works today)

- How: loop over the Invoices with one `<a download>` click each. **[inferred]**
- Cost: every click opens its own modal save dialog (`plugin-lockdown.ts:82-96`), so 100 Invoices means 100 dialogs. Each dialog starts at Downloads, not at the folder last chosen (`plugin-lockdown.ts:86`), and a `<hub-folder-field>` cannot preselect a folder. **[source]** It is also untested whether Chromium inside Electron throttles a burst of downloads with no user gesture behind them. **[inferred]**
- Verdict: fine for Fill-in mode (one Invoice), as in Receipt Extractor, but not usable for Import.

### B. One zip, one save dialog (works today)

- How: build every `.docx` in the UI, pack them with `jszip`, and save the zip once with `<a download="invoices-….zip">`. `jszip` is already a pinned dependency in this repo (`plugins/receipt-extractor/package.json:18`), and `docx@9` depends on it anyway. **[source]**
- Cost: no Hub change and no Backend. Staff must unzip, and the Plugin cannot see whether a file of that name already exists in the target folder (an open question in #187). `hub.files.openFolder` cannot reveal the result, because a download gives the UI no path. **[inferred]**
- Verdict: the cheapest batch path, but every import adds an unzip step for staff.

### C. A minimal Python Backend (works today; the pattern ADR 0009 intends)

- How: declare `"backend": {"kind": "python", "python": "3.12"}` (`PLUGIN_STANDARD.md:69,94`). The UI keeps building the `.docx` bytes with `docx` and sends them to one Backend method, such as `saveInvoices({folder, files: [{name, base64}]})`. The method writes each file atomically into the picked folder. The JSON-RPC wire is newline-delimited JSON (`apps/hub/src/main/backend.ts:303`), so bytes must travel as base64 or similar. **[source]** At roughly 30 KB per `.docx`, 100 files is about 4 MB on the wire, which is fine. **[inferred]**
- Cost:
  - A `backend/` folder with `pyproject.toml`, `uv.lock` and `main.py` (`PLUGIN_STANDARD.md:35,46`).
  - A zod protocol module (`PLUGIN_STANDARD.md:232-263`).
  - Busy handling, plus no half-written output on `shutdown` (`PLUGIN_STANDARD.md:295-311`).
  - Python tests.
  - Staff machines without a Python Plugin would gain uv, Python and the SDK at install (ADR 0011, `docs/adr/0011-one-monorepo-and-python-only-arrives-with-a-python-plugin.md:1-3`). Both existing Backend Plugins already need this, so it is probably not new for the staff who have them. **[inferred]**
- Gains: Python can check for existing files and decide whether to overwrite, skip or rename, and `openFolder` can reveal the folder afterwards. **[inferred]**
- Verdict: unblocked today and matches the standard, but it is the heaviest option for writing a few bytes.

### D. A new Hub API call (Hub change, minor bump to 1.5.0)

- How: add something like `hub.files.writeBytes(folder: FolderPath, name: string, bytes: Uint8Array)`. ADR 0009 expects this kind of growth: "Each future addition is a minor bump … more file pickers" (`docs/adr/0009-…:19`) and "`pickFiles` and similar calls join only when a Plugin needs them" (`:12`). **[source]**
- Cost, from the code it touches:
  - `packages/hub-api/src/index.ts` (types, plus a new `HubError` code for write failures, `index.ts:35-37` style).
  - `apps/hub/src/main/files.ts`, a third `ipc.handle`, `apps/hub/src/preload/plugin.ts` and `apps/hub/src/shared/plugin-preload.ts`.
  - `packages/fake-hub`.
  - `PLUGIN_STANDARD.md` §4 table and ADR 0009's `hub.files` line.
  - The package version bump, with the Invoice Manifest set to `"hubApi": "^1.5.0"`. **[source]**
- Design points the ADR would have to settle **[inferred]**:
  - `name` must be one file name, with no separators and no `..`.
  - Choose between atomic replace and failing when the file exists. The second answers #187's open question on file collisions.
  - Whether `folder` is trusted. `FolderPath` is only a type brand, and main receives a raw string (`files.ts:16`, `ids.ts` `parseAbsolutePath`). Plugins are trusted (ADR 0003). Restricting writes to folders picked in this session would break the remembered-folder pattern, where both existing Plugins keep a `FolderPath` in Plugin Data (`plugins/fb-test-paper-downloader/ui-src/settings.ts:12`).
- Verdict: the least Plugin code, with one dialog (`<hub-folder-field>`) and real files in place. It is a permanent public API surface, and building it is Hub work before the Invoice plugin can ship.

### E. Chromium's File System Access API (`showDirectoryPicker`): blocked today

- The Hub grants Plugin views only `clipboard-read` and `clipboard-sanitized-write`. Every other permission is denied (`apps/hub/src/main/plugin-lockdown.ts:30-44`). Electron 44 routes File System Access requests through the permission handler as `'fileSystem'`, with `fileAccessType: 'writable' | 'readable'` (`node_modules/electron/electron.d.ts:8597-8612, 13550`). So writing to a picked directory is denied. **[source]** This was not run to confirm whether the picker opens before the denial. **[inferred]**
- Cost to enable: add `'fileSystem'` to `GRANTED_PERMISSIONS`, and amend ADR 0009's native-features list (`:3`), which does not name it today. It adds no `hub.*` surface. But it uses Chromium's picker instead of the Hub's `<hub-folder-field>`, gives no `FolderPath`, and remembering a folder across opens needs a handle kept in IndexedDB that may prompt for permission again. **[inferred]**

## 4. Summary table

| Option | Works on 1.4 today | Dialogs per Import | Hub change | Plugin weight |
| --- | --- | --- | --- | --- |
| A. `<a download>` per file | yes | ~100 | none | trivial |
| B. One zip | yes | 1 (+ unzip) | none | small (`jszip`) |
| C. Minimal Backend | yes | 1 (`<hub-folder-field>`) | none | Python Backend + protocol + tests |
| D. `hub.files.writeBytes` | no (1.5.0) | 1 (`<hub-folder-field>`) | new API call, frozen to 2.0 | trivial |
| E. `showDirectoryPicker` | no | 1 (Chromium picker) | grant `fileSystem`, amend ADR 0009 | small |
