// Tutor Finder's Plugin UI: plain DOM over native elements. Setup asks for the service-account key
// once; every open then reads the sheet into memory and shows the roster. The roster lives only
// here: no Plugin Data, no Shared Store, and nothing from a row ever reaches `console`, which the
// Hub copies into the Diagnostics Bundle. The Plugin is never Busy: closing mid-read loses nothing.

import type { HubError } from "@hawkeye-hub/hub-api";
import {
  KEY_SECRET,
  parseKey,
  readSheet,
  type ServiceAccountKey,
} from "./google";
import { t } from "./i18n";
import { parseRows, type Tutor } from "./parsing";
import { createTable } from "./table";

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
const status = byId("p", "status");
const setup = byId("section", "setup");
const keyFile = byId("input", "key-file");
const setupError = byId("p", "setup-error");
const roster = byId("section", "roster");
const refresh = byId("button", "refresh");
const tally = byId("p", "tally");
const table = createTable(byId("table", "table"));

byId("h1", "setup-title").textContent = t("setup.title");
byId("p", "setup-hint").textContent = t("setup.hint");
byId("span", "key-file-label").textContent = t("setup.file");
byId("h1", "title").textContent = t("title");
refresh.textContent = t("refresh");

let key: ServiceAccountKey | null = null; // null: no usable key stored yet
/** The roster in memory: what the table shows, and what the filters (#177) will narrow. */
let tutors: readonly Tutor[] = [];

function showRoster(): void {
  table.show(tutors.map((tutor) => ({ tutor, offerings: tutor.offerings })));
  tally.textContent = t("tally", { count: tutors.length });
}

/** Reads the sheet with `key` and shows it. Every open does this once; Refresh does it again. */
async function load(key: ServiceAccountKey): Promise<void> {
  setup.hidden = true;
  refresh.disabled = true;
  status.textContent = t("loading");
  try {
    tutors = parseRows(await readSheet(key));
    showRoster();
    roster.hidden = false;
    status.textContent = "";
  } catch {
    // Not logged: Google's errors may echo sheet data. #176 tells the failures apart.
    status.textContent = t("loadFailed");
  } finally {
    refresh.disabled = false;
  }
}

function askForKey(): void {
  roster.hidden = true;
  status.textContent = "";
  setup.hidden = false;
}

keyFile.addEventListener("change", () => {
  void (async () => {
    const file = keyFile.files?.[0];
    if (file === undefined) return; // the picker was cancelled
    const text = await file.text();
    keyFile.value = ""; // choosing the same file again fires change again
    const parsed = parseKey(text);
    if (parsed.kind === "invalid") {
      setupError.textContent = t("setup.invalid");
      return;
    }
    try {
      await hub.secrets.set(KEY_SECRET, text);
    } catch (e) {
      setupError.textContent = refusal(e);
      return;
    }
    setupError.textContent = "";
    key = parsed.key;
    await load(key);
  })();
});

/** Why `hub.secrets.set` refused the key file. */
function refusal(e: unknown): string {
  // Every window.hub rejection is a HubError (ADR 0009); TypeScript cannot type a promise's rejection.
  const err = e as HubError;
  switch (err.code) {
    case "secret-too-large":
      return t("setup.invalid"); // a real key is a few KiB, so this is the wrong file
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
      // hub.secrets.set raises none of these. The code only: the error names the secret, and an
      // uncaught error reaches the Plugin's log.
      throw new Error(`hub.secrets.set refused with ${err.code}`);
    default: {
      const unreachable: never = err;
      throw new Error(`unhandled HubError ${String(unreachable)}`);
    }
  }
}

refresh.addEventListener("click", () => {
  if (key !== null) void load(key); // Refresh shows only once a key has loaded the roster
});

const stored = await hub.secrets.get(KEY_SECRET);
switch (stored.kind) {
  case "missing":
    askForKey();
    break;
  case "stored": {
    // The stored text passed parseKey before it was saved; parsed again here, at the boundary.
    const parsed = parseKey(stored.value);
    if (parsed.kind === "invalid") askForKey();
    else {
      key = parsed.key;
      await load(key);
    }
    break;
  }
  default:
    stored satisfies never;
}
