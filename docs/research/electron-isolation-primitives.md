# Research: Electron isolation primitives for lazy-loaded mini-apps

Resolves #2. Feeds the plugin-runtime-model decision. **Facts and trade-offs only. This doc makes no decision.**

Researched 2026-10-16. Electron stable is 44 (Chromium M152, Node 24.18); 45 ships 2026-10-20; 42–44 are supported ([schedule](https://releases.electronjs.org/schedule)). Unless noted, the facts below hold for Electron ≥30.

## TL;DR

- **UI hosts:** `WebContentsView` (Electron 30+) is the supported main-process primitive. `BrowserView` is deprecated and is now a shim over it. `<webview>` is officially discouraged. A sandboxed `iframe` is the cheapest option but gives the weakest per-mini-app control.
- **Logic hosts:** `utilityProcess` (Electron 22+) is Electron's recommended replacement for `child_process.fork` for Node code, and it can talk to renderers directly over `MessagePort`. Python backends cannot run inside it, so they still need `child_process.spawn`.
- **Unloading:** memory is reclaimed only when the OS process exits. For a `WebContentsView` that means calling `webContents.close()` explicitly; removing the view or closing a `BaseWindow` does not close it, and the docs warn this leaks. For child processes, `kill()` does not reliably kill grandchildren (relevant to PyInstaller one-file, which runs two processes).
- **Memory numbers:** no primary source gives per-renderer or per-process figures. Chromium says only that each process carries "some memory overhead". We would need to measure with `app.getAppMetrics()`.
- **Prior art splits two ways.** WeChat runs one WebView per page plus a separate logic thread, with Native relaying messages. VS Code runs extensions in one shared extension-host `utilityProcess`, renders webviews in iframes, and only activates extensions lazily. Raycast runs one Node child process with a worker-thread isolate per extension, and unloads it on close. Obsidian has no isolation at all and depends on the `onunload` discipline of each plugin.

## 1. Primitive-by-primitive

### 1.1 `WebContentsView` (and deprecated `BrowserView`)

- **What it is:** "A View that displays a WebContents." You create it in the main process, then attach it with `win.contentView.addChildView(view)` and position it with `setBounds` ([docs](https://www.electronjs.org/docs/latest/api/web-contents-view)). It cannot be used before `app` `ready`.
- **Version:** added in Electron 30 alongside `BaseWindow`. In 30, "BrowserView is now a shim over WebContentsView and the old implementation has been removed" ([Electron 30 blog](https://www.electronjs.org/blog/electron-30-0)). `BrowserView` has been deprecated since 29/30 ([BrowserView docs](https://www.electronjs.org/docs/latest/api/browser-view); [migration guide](https://www.electronjs.org/blog/migrate-to-webcontentsview)).
- **Process model:** each WebContents has its own renderer process. Per the [process model](https://www.electronjs.org/docs/latest/tutorial/process-model), Electron "spawns a separate renderer process for each open BrowserWindow (and each web embed)". Process sharing still happens. `forcefullyCrashRenderer()` warns that "some webContents share renderer processes" ([webContents](https://www.electronjs.org/docs/latest/api/web-contents)). Chromium reuses same-site processes once it passes a soft process limit ([Chromium process model](https://chromium.googlesource.com/chromium/src/+/main/docs/process_model_and_site_isolation.md)).
- **Isolation:** it takes full per-view `webPreferences`: `sandbox` (default `true` since Electron 20), `contextIsolation` (default `true` since 12), `preload`, `partition`/`session`, and `backgroundThrottling` (default `true`) ([WebPreferences](https://www.electronjs.org/docs/latest/api/structures/web-preferences)). A per-mini-app `partition` gives separate storage and cookies. Custom protocols are registered per session, so each partition must register the scheme again ([protocol](https://www.electronjs.org/docs/latest/api/protocol)).
- **Unload:** "When you add a WebContentsView to a BaseWindow and the BaseWindow is closed, the webContents of the WebContentsView are not destroyed automatically … Unlike with a BrowserWindow, if you don't explicitly close the webContents, you'll encounter memory leaks" ([BaseWindow – Resource management](https://www.electronjs.org/docs/latest/api/base-window)). `webContents.close()` destroys it, so it is "no longer usable" ([webContents](https://www.electronjs.org/docs/latest/api/web-contents)). Hiding or detaching a view keeps its renderer alive.
- **Cost / ergonomics:** the docs say it gives "the greatest control", but "positioning them accurately with respect to DOM content requires coordination between the Main and Renderer processes" ([Web embeds](https://www.electronjs.org/docs/latest/tutorial/web-embeds)). It is a native layer drawn over the shell window's DOM, not a part of that DOM.

### 1.2 `<webview>`

- It is disabled by default since Electron 5 and needs `webviewTag: true` to turn on ([webview tag](https://www.electronjs.org/docs/latest/api/webview-tag)).
- Official stance: "We currently recommend to not use the `webview` tag and to consider alternatives, like `iframe`, a `WebContentsView`, or an architecture that avoids embedded content altogether." The reason given is that Chromium's webview "is undergoing dramatic architectural changes", which "impacts the stability … including rendering, navigation, and event routing" (same page).
- It is implemented on OOPIFs, so the guest runs in a separate process and communication with it is asynchronous. The docs describe it as "slightly slower" than an iframe ([Web embeds](https://www.electronjs.org/docs/latest/tutorial/web-embeds)).
- Two items on the security checklist are specific to webview: do not use `allowpopups`, and verify options and params ([security](https://www.electronjs.org/docs/latest/tutorial/security)).

### 1.3 Sandboxed `iframe`

- "Iframes in Electron behave like iframes in regular browsers". Use the `sandbox` attribute and allow only the capabilities you need ([Web embeds](https://www.electronjs.org/docs/latest/tutorial/web-embeds)).
- **Process:** Chromium Site Isolation keys processes by *site* (scheme + eTLD+1). A cross-site frame needs a new process, and same-site frames can share one ([Chromium process model](https://chromium.googlesource.com/chromium/src/+/main/docs/process_model_and_site_isolation.md)). Joplin's spec (first-party for Joplin) says that serving its note-viewer iframe from a *different custom protocol* moves it into a separate process and blocks `window.top` access ([Joplin note viewer isolation](https://joplinapp.org/help/dev/spec/note_viewer_isolation)). **Not verified in Electron's docs:** whether `hawkeye-app-<id>://` style per-app schemes reliably get OOPIFs, and how `registerSchemesAsPrivileged` interacts with that. A spike would need to confirm it.
- **Privileged APIs:** a preload does not run in subframes unless you set `nodeIntegrationInSubFrames`, which is documented as "Experimental" ([WebPreferences](https://www.electronjs.org/docs/latest/api/structures/web-preferences)). The usual pattern is for the host page to bridge calls via `postMessage`, the way VS Code webviews do (§2.2).
- **Unload:** removing the iframe from the DOM ends it. The process is reclaimed only if no other frame is using it.
- **Cost:** it has the lowest orchestration cost, since it is plain DOM layout. Isolation and lifecycle are coarser than with a `WebContentsView`, because there is no per-frame `session`, `webPreferences` or `sandbox` flag beyond the HTML `sandbox` attribute.

### 1.4 `utilityProcess`

- Added in Electron 22. It is a "lightweight Chromium child process with only Node.js integration while also allowing communication with a sandboxed renderer using `MessageChannel`". It is modelled on `child_process.fork`, except that "`modulePath` must be from within the packaged application to allow only for trusted scripts to be loaded" ([Electron 22 blog](https://www.electronjs.org/blog/electron-22-0)).
- The process-model doc tells apps to prefer it over `child_process.fork` because it "can establish a communication channel with a renderer process using" MessagePorts. It names hosting "untrusted services, CPU intensive tasks or crash prone components" as use cases ([process model](https://www.electronjs.org/docs/latest/tutorial/process-model)).
- **API:** `utilityProcess.fork(modulePath, args, { serviceName, env, execArgv, cwd, stdio, allowLoadingUnsignedLibraries (macOS), respondToAuthRequestsFromMainProcess, ... })`. It can only be called after `app` `ready`. stdin must be `'ignore'`. Messaging uses `child.postMessage(msg, [MessagePortMain])` and `process.parentPort`. `kill()` "will ensure the process is reaped on exit". It also has `exit` and an experimental `error` event, and `pid` is `undefined` once the process exits ([utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)).
- **Observability:** it appears in `app.getAppMetrics()` as type `Utility` with its `serviceName`, along with per-process `memory` and `cpu`. Crashes surface through `child-process-gone`, which has reasons including `oom` and `killed` ([app](https://www.electronjs.org/docs/latest/api/app), [ProcessMetric](https://www.electronjs.org/docs/latest/api/structures/process-metric)).
- **Limits:** it runs Node and has no DOM or UI. It cannot host Python directly. A utility process can itself call `child_process.spawn`, and VS Code lists "child process support" as a requirement it met ([VS Code sandbox blog](https://code.visualstudio.com/blogs/2022/11/28/vscode-sandbox)).

### 1.5 `child_process` (`spawn` / `fork`)

- This is the only option for a non-Node backend such as Python with PyMuPDF.
- **Windows kill semantics:** "On Windows, where POSIX signals do not exist … `'SIGKILL'`, `'SIGTERM'`, `'SIGINT'` and `'SIGQUIT'` terminate the process forcefully and abruptly". There is no graceful-shutdown signal. Grandchildren are not killed when the parent is ("child processes of child processes will not be terminated when attempting to kill their parent", especially through a shell). `windowsHide` defaults to `false`, so a console window can flash. `.bat` and `.cmd` files need `cmd.exe` ([Node child_process](https://nodejs.org/api/child_process.html)).
- **PyInstaller packaging interaction:** in one-file mode the bootloader runs as two processes. The first extracts to `_MEIxxxx`, then runs and waits on a child copy of itself. One-file is "a little slower to start" than one-dir, and the temp folder is left behind if the app is killed ([operating mode](https://pyinstaller.org/en/stable/operating-mode.html), [advanced topics](https://pyinstaller.org/en/stable/advanced-topics.html)). Combined with Node's kill semantics, a plain `subprocess.kill()` may leave the Python worker orphaned. **Not documented:** what happens to PyInstaller's child process when the parent is killed on Windows.
- **IPC:** stdio pipes or a local socket/HTTP connection. Electron `MessagePort`s cannot reach it directly, so the main process or a utility process has to bridge.

## 2. IPC options

| Mechanism | Endpoints | Notes |
|---|---|---|
| `ipcRenderer.invoke` / `ipcMain.handle` | renderer ⇄ main | Request/response. Errors thrown in the handler are "not transparent" ([IPC](https://www.electronjs.org/docs/latest/tutorial/ipc)). |
| `ipcRenderer.send` / `webContents.send` | one-way | Avoid `sendSync` because it blocks the renderer. |
| `MessageChannelMain` + `postMessage` transfer | renderer ⇄ renderer, renderer ⇄ utilityProcess | Main creates the pair and hands out the ports; after that, traffic does not go through main. The port gets a `close` event when the other end goes away ([MessagePorts](https://www.electronjs.org/docs/latest/tutorial/message-ports), [utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)). `send`/`invoke` cannot transfer ports. |
| `contextBridge.exposeInMainWorld` | preload → page | Expose one function per message. Exposing raw `ipcRenderer.send` "would allow any website to send arbitrary IPC messages" ([context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)). |
| stdio / socket | main or utility ⇄ child_process | The only path to Python. |

All Electron IPC uses the Structured Clone Algorithm, so DOM objects and C++-backed objects cannot be sent. Security checklist items that apply to every option: validate `sender` on every IPC message, use custom protocols instead of `file://`, set a CSP, and limit navigation and new windows ([security](https://www.electronjs.org/docs/latest/tutorial/security)). A sandboxed preload can only `require` `contextBridge`, `crashReporter`, `ipcRenderer`, `nativeImage`, `webFrame`, `webUtils`, `events`, `timers` and `url` ([sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox)).

## 3. Comparison matrix

| | WebContentsView | `<webview>` | sandboxed iframe | utilityProcess | child_process |
|---|---|---|---|---|---|
| Hosts | UI (+ JS) | UI (+ JS) | UI (+ JS) | Node logic | any binary (Python) |
| Process per mini-app | Yes, own renderer (sharing is possible) | Yes (OOPIF) | Only if cross-site; same-site frames share | Yes | Yes (+ grandchildren) |
| Per-app sandbox / contextIsolation / preload / session | Yes, all per view | Yes, via attributes | HTML `sandbox` only; preload is experimental | n/a (Node, trusted path only) | n/a (OS process) |
| True unload | Only after explicit `webContents.close()` | Remove the element | Remove the element (process freed if unshared) | `kill()` reaps | `kill()` is abrupt on Windows; grandchildren may survive |
| IPC | ipc + MessagePort | async IPC | `postMessage` to host page | MessagePort to renderer, `parentPort` | stdio / socket |
| Official status | Recommended | **Discouraged** | Supported | Recommended over `fork` | Node core |
| Layout cost | Main-process bounds sync | DOM | DOM | — | — |

**Idle/active memory and startup latency:** none of the sources above publish numbers. Chromium says only that process isolation comes "at the cost of some memory overhead for each process". The Electron performance guide says to "profile the running code" and to load modules "just in time" ([performance](https://www.electronjs.org/docs/latest/tutorial/performance)). Real figures need a spike on our target machines. The spike would open N mini-apps of each kind, read `app.getAppMetrics()` (`memory`, `type`, `pid`), then close them and check that the PIDs disappear.

## 4. Prior art

### WeChat mini-programs (dual-thread)
- The rendering layer (WXML/WXSS) runs in WebViews: "There are multiple interfaces in an Mini Program, so there are multiple WebView threads in the rendering layer". The logic layer runs JS on a separate JsCore thread, and Native relays between the two ([framework](https://developers.weixin.qq.com/miniprogram/en/dev/framework/quickstart/framework.html)).
- Engines per platform: iOS and macOS use JavaScriptCore with WKWebView. Android uses V8 with XWeb. **Windows uses Chromium for both layers.** The devtools use NW.js or Electron ([runtime env](https://developers.weixin.qq.com/miniprogram/dev/framework/runtime/env.html)).
- The stated rationale is that the design weighs "both performance and security" (性能与安全). The costs of the old model, which the newer Skyline engine removes, are a new JS engine instance (WebView) per page plus JSBridge communication overhead ([Skyline intro](https://developers.weixin.qq.com/miniprogram/dev/framework/runtime/skyline/introduction.html)). Per the [setData guide](https://developers.weixin.qq.com/miniprogram/dev/framework/performance/tips/runtime_setData.html), `setData` cost scales with data volume and tree size, so send only the fields that changed.
- **Lifecycle (closest analogue to lazy load and unload):** "closing" a mini-program sends it to the background. After 5 s the JS thread is suspended. After 30 min in the background, or under resource pressure, the mini-program is destroyed, and the next open is a cold start ([operating mechanism](https://developers.weixin.qq.com/miniprogram/dev/framework/runtime/operating-mechanism.html)).

### VS Code
- Extensions run in an Extension Host. It can be local Node.js, a web worker, or remote, and it exists to keep a misbehaving extension from hurting startup and the UI ([extension host](https://code.visualstudio.com/api/advanced-topics/extension-host)).
- Loading is lazy through Activation Events. `activate()` runs once, and `deactivate()` runs on shutdown. **There is no documented per-extension unload during a session** ([activation events](https://code.visualstudio.com/api/references/activation-events)).
- VS Code moved the extension host out of the renderer into an Electron **utility process**, an API the VS Code team contributed to Electron. It uses MessagePorts because sandboxed renderers cannot use Node sockets, and because "a busy main process can result in an unresponsive user interface" ([sandbox blog, 2022](https://code.visualstudio.com/blogs/2022/11/28/vscode-sandbox)). All extensions share that one host process.
- Extension UI runs in webviews, which are iframes. They talk to the extension only via `postMessage`, and their state survives through `getState`/`setState`. `retainContextWhenHidden` "has high memory overhead". The default is to destroy hidden webview content and restore it from state ([webview guide](https://code.visualstudio.com/api/extension-guides/webview)).

### Raycast
- Raycast "launches a single child Node.js process where extensions get loaded and unloaded as needed". Each extension "runs in its own v8 isolate (worker thread)" with a limited heap, and talks to Raycast over a thin RPC protocol. Extensions are "not further sandboxed" for file I/O or network ([security](https://developers.raycast.com/information/security)).
- When a command closes, "Raycast unloads the entire command from memory". Exceeding the memory limit terminates the command ([lifecycle](https://developers.raycast.com/information/lifecycle)).

### Obsidian
- Plugins run in the app with full privileges: they "can access files", "connect to internet", and "install additional programs". Obsidian "cannot reliably restrict plugins". Restricted Mode is on by default ([plugin security](https://obsidian.md/help/plugin-security)).
- Unload depends on discipline. `onunload` runs when a plugin is disabled, and "any resources … must be released here" ([anatomy](https://docs.obsidian.md/Plugins/Getting+started/Anatomy+of+a+plugin)). `Component.register*` helpers detach events, DOM listeners and intervals "when unloading" ([Component API](https://docs.obsidian.md/Reference/TypeScript+API/Component)).

## 5. Trade-offs to weigh in the runtime-model decision (not decided here)

1. **Isolation granularity versus process count.** A process per mini-app (WebContentsView or a cross-site iframe for UI, plus a utilityProcess or child_process for logic) gives true unload and crash isolation, but each process carries overhead. A shared host (VS Code, Raycast) uses fewer processes, but unloading becomes a code-discipline problem inside that host, and one bad plugin can take down the others.
2. **UI host:** WebContentsView gives full per-app `webPreferences`/`session` and clean close semantics, at the cost of syncing bounds from main. An iframe is simple DOM, but its isolation depends on scheme/site behaviour that is not verified here.
3. **Python backends force `child_process`.** Unload reliability on Windows depends on killing the process tree; PyInstaller one-file adds a second process. PyInstaller one-dir avoids the extraction step at startup.
4. **IPC topology:** MessagePorts let a mini-app's UI and its Node logic talk without going through main, which keeps main responsive, as VS Code found. Python needs a bridge.
5. **Suspend versus destroy:** WeChat's background → suspend (5 s) → destroy (30 min) is an established middle ground between instant unload and keeping apps warm.

## Open questions / gaps

- Per-process idle and active memory, and cold-start latency, on our staff hardware. No primary source has these, so they need a measurement spike.
- Whether per-mini-app custom schemes reliably produce OOPIFs in Electron 4x.
- How to kill a Python process tree reliably on Windows (for example with job objects or `taskkill /T`); not researched here.
