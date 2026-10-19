// What a Plugin UI may reach beyond its own view (spec #44, ADRs 0003, 0006, 0009,
// PLUGIN_STANDARD §4.2): no windows of its own, no navigating away, https links in the system
// browser, downloads through the native save dialog, and no permission but the clipboard.

import { join } from "node:path";
import {
  app,
  dialog,
  shell,
  type BaseWindow,
  type DownloadItem,
  type Event,
  type WebContentsView,
} from "electron";
import { PLUGIN_SCHEME } from "./plugin-scheme";

/** Whether `url` is on Plugin `id`'s own origin, `hawkeye-plugin://<id>/`. */
export function staysInPlugin(id: string, url: string): boolean {
  const parsed = URL.parse(url);
  return parsed?.protocol === `${PLUGIN_SCHEME}:` && parsed.host === id;
}

/** Whether a link to `url` opens in the system browser: https only, every other scheme refused. */
export function opensInSystemBrowser(url: string): boolean {
  return URL.parse(url)?.protocol === "https:";
}

// PLUGIN_STANDARD §4.2 promises `navigator.clipboard`, which Chromium gates behind these two.
const GRANTED_PERMISSIONS: readonly string[] = [
  "clipboard-read",
  "clipboard-sanitized-write",
];

/** Whether Plugin `id`'s page at `requestingUrl` gets `permission`. Everything else is denied. */
export function grantsPermission(
  id: string,
  permission: string,
  requestingUrl: string,
): boolean {
  return (
    GRANTED_PERMISSIONS.includes(permission) && staysInPlugin(id, requestingUrl)
  );
}

/** Applies the rules above to Plugin `id`'s freshly created view in the Hub `window`. */
export function lockDown(
  view: WebContentsView,
  window: BaseWindow,
  id: string,
): void {
  const { webContents } = view;
  const { session } = webContents;

  // window.open and target=_blank both arrive here; neither ever gets an Electron window.
  webContents.setWindowOpenHandler(({ url }) => {
    if (opensInSystemBrowser(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  const stayPut = (event: { preventDefault(): void }, url: string) => {
    if (!staysInPlugin(id, url)) event.preventDefault();
  };
  webContents.on("will-frame-navigate", (event) => {
    if (event.isMainFrame) stayPut(event, event.url);
  });
  webContents.on("will-redirect", (event) => {
    if (event.isMainFrame) stayPut(event, event.url);
  });

  // The partition's session outlives this view, so these go when the view does. Each session
  // holds one Plugin's one view at a time.
  session.setPermissionRequestHandler(
    (_contents, permission, callback, { requestingUrl }) => {
      callback(grantsPermission(id, permission, requestingUrl));
    },
  );
  session.setPermissionCheckHandler((_contents, permission, requestingOrigin) =>
    grantsPermission(id, permission, requestingOrigin),
  );
  session.setDevicePermissionHandler(() => false);

  const onDownload = (event: Event, item: DownloadItem) => {
    // The save path must be set before this handler returns, hence the synchronous dialog.
    const path = dialog.showSaveDialogSync(window, {
      defaultPath: join(app.getPath("downloads"), item.getFilename()),
    });
    if (path === "") {
      event.preventDefault();
      return;
    }
    item.setSavePath(path);
  };
  session.on("will-download", onDownload);
  webContents.once("destroyed", () => {
    session.off("will-download", onDownload);
  });
}
