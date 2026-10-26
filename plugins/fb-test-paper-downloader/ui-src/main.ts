// The Facebook Test Paper Downloader's Plugin UI: plain DOM over native elements and the Hub Kit.

import type { FolderPath } from "@hawkeye-hub/hub-api";
import { explain } from "./explain";
import { backend, hub } from "./hub";
import { t } from "./i18n";
import {
  Progress,
  SignInResult,
  UpdateResult,
  type FileResult,
  type PostResult,
} from "./protocol";
import { loadSettings, saveSettings } from "./settings";

/** The element `<tag id=id>`, which index.html always has. */
function byId<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  id: string,
): HTMLElementTagNameMap[K] {
  const found = [...document.getElementsByTagName(tag)].find(
    (el) => el.id === id,
  );
  if (found === undefined)
    throw new Error(`index.html has no <${tag} id=${id}>`);
  return found;
}

const group = byId("input", "group");
const output = byId("hub-folder-field", "output");
const signIn = byId("button", "sign-in");
const status = byId("p", "status");
const update = byId("button", "update");
const stop = byId("button", "stop");
const stopAtKnown = byId("input", "stop-at-known");
const progress = byId("progress", "progress");
const log = byId("hub-log", "log");

byId("span", "group-label").textContent = t("group");
output.label = t("output");
signIn.textContent = t("signIn");
update.textContent = t("update");
stop.textContent = t("stop");
byId("span", "stop-at-known-label").textContent = t("stopAtKnown");

// --- Plugin Data: what staff chose last time ---
const settings = loadSettings();
group.value = settings.group;
output.value = settings.output;
stopAtKnown.checked = settings.stopAtKnown;

function save(): void {
  saveSettings({
    v: 1,
    group: group.value,
    output: output.value,
    stopAtKnown: stopAtKnown.checked,
  });
}
for (const el of [group, output, stopAtKnown]) {
  el.addEventListener("change", save);
}

/** Sign in and Update share the Plugin's one Edge, so only one runs at a time. */
function edgeInUse(inUse: boolean): void {
  signIn.disabled = inUse;
  update.disabled = inUse;
}

// --- Sign in: one request; the Backend's Edge window resolves it ---
signIn.addEventListener("click", () => {
  void (async () => {
    edgeInUse(true);
    status.textContent = t("signingIn");
    try {
      const { outcome } = SignInResult.parse(
        await backend.request("signIn", {}),
      );
      status.textContent = t(`outcome.${outcome}`);
    } catch (e) {
      status.textContent = explain(e);
    } finally {
      edgeInUse(false);
    }
  })();
});

// --- Update: one request, progress notifications, Busy throughout, Stop sends cancel ---
backend.onNotification("progress", (raw) => {
  const p = Progress.parse(raw);
  switch (p.phase) {
    case "files":
      progress.value = p.done / p.total;
      status.textContent = t("savingFiles", p);
      logResult(p.item, p.result);
      return;
    case "scan":
      status.textContent = t("scanning", { found: p.found });
      return;
    case "posts":
      progress.value = p.done / p.total;
      status.textContent = t("downloading", p);
      logResult(p.item, p.result);
      return;
    default:
      p satisfies never;
  }
});

/** One log line per file or post. */
function logResult(item: string, result: FileResult | PostResult): void {
  switch (result.kind) {
    case "saved":
      log.append({ tone: "success", text: t("result.saved", { item }) });
      return;
    case "skipped-known":
      log.append({ tone: "info", text: t("result.skipped-known", { item }) });
      return;
    case "skipped-not-paper":
      log.append({
        tone: "info",
        text: t("result.skipped-not-paper", { item }),
      });
      return;
    case "incomplete":
      log.append({
        tone: "danger",
        text: t("result.incomplete", { item, ...result }),
      });
      return;
    case "failed":
      log.append({
        tone: "danger",
        text: t("result.failed", { item, detail: result.detail }),
      });
      return;
    default:
      result satisfies never;
  }
}

async function runUpdate(folder: FolderPath): Promise<void> {
  log.clear();
  progress.value = 0;
  status.textContent = t("scanning", { found: 0 });
  edgeInUse(true);
  stop.hidden = false;
  await hub.busy.set(t("busy"));
  try {
    const result = UpdateResult.parse(
      await backend.request("update", {
        group: group.value,
        output: folder,
        stopAtKnown: stopAtKnown.checked,
      }),
    );
    status.textContent = t(`summary.${result.outcome}`, result);
  } catch (e) {
    status.textContent = explain(e);
  } finally {
    await hub.busy.clear();
    edgeInUse(false);
    stop.hidden = true;
  }
}

update.addEventListener("click", () => {
  save();
  if (output.value.kind === "none") {
    status.textContent = t("pickOutput");
    return;
  }
  void runUpdate(output.value.path);
});

stop.addEventListener("click", () => {
  void backend.notify("cancel", {});
});
