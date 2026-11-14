// Invoice's Plugin UI: plain DOM over native elements and the Hub Kit. This is the Settings strip:
// the key, the Cash Flow Sheet link, the Official Receipt template and the save folder. It opens
// itself naming what's missing, and collapses to one line once all are set. Nothing here logs.

import type { HubError } from "@hawkeye-hub/hub-api";
import { KEY_SECRET, parseKey, parseSheetLink, sheetLink } from "./google";
import { t } from "./i18n";
import { loadPluginData, savePluginData, type PluginData } from "./plugin-data";
import { checkTemplate, loadTemplate, saveTemplate } from "./template";

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

const hub = window.hub;
const settings = byId("details", "settings");
const summary = byId("summary", "settings-summary");
const keyFile = byId("input", "key-file");
const keyState = byId("span", "key-state");
const keyError = byId("span", "key-error");
const sheetInput = byId("input", "sheet-link");
const sheetError = byId("span", "sheet-error");
const templateFile = byId("input", "template-file");
const templateState = byId("span", "template-state");
const templateError = byId("span", "template-error");
const folder = byId("hub-folder-field", "folder");

byId("span", "key-label").textContent = t("key.label");
byId("span", "sheet-label").textContent = t("sheet.label");
byId("span", "template-label").textContent = t("template.label");
folder.label = t("folder");

let data: PluginData = loadPluginData();
function update(next: PluginData): void {
  data = next;
  savePluginData(data);
  show();
}

const stored = await hub.secrets.get(KEY_SECRET);
// The stored text passed parseKey before it was saved; parsed again here, at the boundary.
let keyStored =
  stored.kind === "stored" && parseKey(stored.value).kind === "valid";
let template = await loadTemplate();

sheetInput.value = data.sheet.kind === "set" ? sheetLink(data.sheet.id) : "";
folder.value = data.folder;

/** Whether everything was set at the last `show`, so Settings collapses only as the last one lands. */
let complete = false;
function show(): void {
  keyState.textContent = keyStored ? t("key.stored") : t("key.missing");
  templateState.textContent =
    template.kind === "imported"
      ? t("template.stored", { name: template.template.name })
      : t("template.missing");
  const missing = [
    ...(keyStored ? [] : [t("settings.item.key")]),
    ...(data.sheet.kind === "set" ? [] : [t("settings.item.sheet")]),
    ...(template.kind === "imported" ? [] : [t("settings.item.template")]),
    ...(data.folder.kind === "chosen" ? [] : [t("settings.item.folder")]),
  ];
  if (
    missing.length === 0 &&
    template.kind === "imported" &&
    data.folder.kind === "chosen"
  ) {
    summary.textContent = t("settings.done", {
      template: template.template.name,
      folder: data.folder.path,
    });
    if (!complete) settings.open = false;
    complete = true;
  } else {
    summary.textContent = t("settings.missing", { items: missing.join(", ") });
    settings.open = true;
    complete = false;
  }
}
show();

keyFile.addEventListener("change", () => {
  void (async () => {
    const file = keyFile.files?.[0];
    if (file === undefined) return; // the picker was cancelled
    const text = await file.text();
    keyFile.value = ""; // choosing the same file again fires change again
    if (parseKey(text).kind === "invalid") {
      keyError.textContent = t("key.invalid");
      return;
    }
    try {
      await hub.secrets.set(KEY_SECRET, text);
    } catch (e) {
      keyError.textContent = refusal(e);
      return;
    }
    keyError.textContent = "";
    keyStored = true;
    show();
  })();
});

sheetInput.addEventListener("change", () => {
  const parsed = parseSheetLink(sheetInput.value);
  if (parsed.kind === "invalid") {
    sheetError.textContent = t("sheet.invalid");
    return;
  }
  sheetError.textContent = "";
  sheetInput.value = sheetLink(parsed.id);
  update({ ...data, sheet: { kind: "set", id: parsed.id } });
});

templateFile.addEventListener("change", () => {
  void (async () => {
    const file = templateFile.files?.[0];
    if (file === undefined) return; // the picker was cancelled
    const bytes = new Uint8Array(await file.arrayBuffer());
    templateFile.value = "";
    const check = await checkTemplate(bytes);
    switch (check.kind) {
      case "not-docx":
        templateError.textContent = t("template.notDocx");
        return;
      case "placeholders":
        templateError.textContent = [
          ...(check.missing.length > 0
            ? [
                t("template.missingPlaceholders", {
                  names: braces(check.missing),
                }),
              ]
            : []),
          ...(check.unknown.length > 0
            ? [
                t("template.unknownPlaceholders", {
                  names: braces(check.unknown),
                }),
              ]
            : []),
          t("template.kept"),
        ].join(" ");
        return;
      case "valid":
        break;
      default:
        check satisfies never;
    }
    const imported = { name: file.name, bytes };
    await saveTemplate(imported);
    templateError.textContent = "";
    template = { kind: "imported", template: imported };
    show();
  })();
});

/** Placeholder names as staff type them in Word. */
function braces(names: readonly string[]): string {
  return names.map((name) => `{{${name}}}`).join(", ");
}

folder.addEventListener("change", () => {
  update({ ...data, folder: folder.value });
});

/** Why `hub.secrets.set` refused the key file. */
function refusal(e: unknown): string {
  // Every window.hub rejection is a HubError (ADR 0009); TypeScript cannot type a promise's rejection.
  const err = e as HubError;
  switch (err.code) {
    case "secret-too-large":
      return t("key.invalid"); // a real key is a few KiB, so this is the wrong file
    case "secret-name-invalid": // KEY_SECRET is a valid name
    case "backend-error":
    case "store-not-declared":
    case "bad-path":
    case "not-found":
    case "no-provider":
    case "provider-missing":
    case "provider-rejected":
    case "provider-unreachable":
    case "folder-not-opened":
    case "exists":
    case "write-failed":
      // hub.secrets.set raises none of these. The code only: the error names the secret.
      throw new Error(`hub.secrets.set refused with ${err.code}`);
    default: {
      const unreachable: never = err;
      throw new Error(`unhandled HubError ${String(unreachable)}`);
    }
  }
}
