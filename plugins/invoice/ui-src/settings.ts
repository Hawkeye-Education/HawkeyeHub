// The Settings strip: the key, the Cash Flow Sheet link, the Official Receipt template and the save
// folder. It opens itself naming what's missing, and collapses to one line once all are set. It owns
// Plugin Data, the key and the template; the tabs read them from here. Nothing here logs.

import {
  KEY_SECRET,
  parseKey,
  parseSheetLink,
  sheetLink,
  type KeyParse,
} from "./google";
import { byId } from "./dom";
import { hubError, refused } from "./hub-error";
import { t } from "./i18n";
import { loadPluginData, savePluginData, type PluginData } from "./plugin-data";
import {
  checkTemplate,
  loadTemplate,
  saveTemplate,
  type StoredTemplate,
} from "./template";

export interface Settings {
  /** Plugin Data as last saved. */
  data(): PluginData;
  /** Saves `next` as Plugin Data and shows it. */
  update(next: PluginData): void;
  key(): KeyParse;
  template(): StoredTemplate;
  /** Shows the strip for what is set now. */
  show(): void;
}

export interface SettingsEvents {
  /** Anything in Settings changed, so what Save needs may have too. */
  changed(): void;
  /** The key or the sheet link was just set, so the sheet may be readable now. */
  readable(): void;
  /** A template was just imported. */
  templateImported(template: StoredTemplate): void;
}

export async function createSettings(on: SettingsEvents): Promise<Settings> {
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
  const stored = await hub.secrets.get(KEY_SECRET);
  // The stored text passed parseKey before it was saved; parsed again here, at the boundary.
  let key: KeyParse =
    stored.kind === "stored" ? parseKey(stored.value) : { kind: "invalid" };
  let keyStored = key.kind === "valid";
  let template = await loadTemplate();

  function update(next: PluginData): void {
    data = next;
    savePluginData(data);
    show();
  }

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
      summary.textContent = t("settings.missing", {
        items: missing.join(", "),
      });
      settings.open = true;
      complete = false;
    }
    on.changed();
  }

  sheetInput.value = data.sheet.kind === "set" ? sheetLink(data.sheet.id) : "";
  folder.value = data.folder;

  keyFile.addEventListener("change", () => {
    void (async () => {
      const file = keyFile.files?.[0];
      if (file === undefined) return; // the picker was cancelled
      const text = await file.text();
      keyFile.value = ""; // choosing the same file again fires change again
      const picked = parseKey(text);
      if (picked.kind === "invalid") {
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
      key = picked;
      keyStored = true;
      show();
      on.readable();
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
    on.readable();
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
      on.templateImported(template);
      show();
    })();
  });

  folder.addEventListener("change", () => {
    update({ ...data, folder: folder.value });
  });

  return {
    data: () => data,
    update,
    key: () => key,
    template: () => template,
    show,
  };
}

/** Placeholder names as staff type them in Word. */
function braces(names: readonly string[]): string {
  return names.map((name) => `{{${name}}}`).join(", ");
}

/** Why `hub.secrets.set` refused the key file. */
function refusal(e: unknown): string {
  const err = hubError(e);
  // A real key is a few KiB, so a key too large is the wrong file.
  if (err.code === "secret-too-large") return t("key.invalid");
  return refused("hub.secrets.set", err); // secret-name-invalid too: KEY_SECRET is a valid name
}
