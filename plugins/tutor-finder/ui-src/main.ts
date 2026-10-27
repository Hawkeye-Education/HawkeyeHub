// Tutor Finder's Plugin UI: plain DOM over native elements. Setup asks for the service-account key
// once; every open then reads the sheet into memory and shows the roster. The roster lives only
// here: no Plugin Data, no Shared Store, and nothing from a row ever reaches `console`, which the
// Hub copies into the Diagnostics Bundle. The Plugin is never Busy: closing mid-read loses nothing.

import type { HubError } from "@hawkeye-hub/hub-api";
import {
  KEY_SECRET,
  parseKey,
  readSheet,
  SheetReadFailed,
  type ReadFailure,
  type ServiceAccountKey,
} from "./google";
import { createFilters } from "./filters";
import { t } from "./i18n";
import { phoneMessage, profileMessage } from "./messages";
import { matching, parseRows, type SheetRow, type Tutor } from "./parsing";
import { createTable } from "./table";

/** The element `#id` of class `type`, which index.html always has. */
function byId<T extends HTMLElement>(type: new () => T, id: string): T {
  const found = document.getElementById(id);
  if (!(found instanceof type))
    throw new Error(`index.html has no ${type.name} #${id}`);
  return found;
}

const hub = window.hub;
const status = byId(HTMLParagraphElement, "status");
const setup = byId(HTMLElement, "setup");
const keyFile = byId(HTMLInputElement, "key-file");
const setupError = byId(HTMLParagraphElement, "setup-error");
const roster = byId(HTMLElement, "roster");
const refresh = byId(HTMLButtonElement, "refresh");
const tally = byId(HTMLParagraphElement, "tally");
/** The Selection: the sheet rows of the tutors staff picked. It outlives every filter change. */
const selection = new Set<SheetRow>();
const table = createTable(
  byId(HTMLTableElement, "table"),
  selection,
  showSelection,
);
const writeMessages = byId(HTMLButtonElement, "write-messages");
const messages = byId(HTMLElement, "messages");
const profileText = byId(HTMLTextAreaElement, "profile-message");
const phoneText = byId(HTMLTextAreaElement, "phone-message");
const settings = byId(HTMLDetailsElement, "settings");
const problem = byId(HTMLElement, "problem");
const problemMessage = byId(HTMLParagraphElement, "problem-message");
const stale = byId(HTMLParagraphElement, "stale");
const retry = byId(HTMLButtonElement, "retry");
const replaceKey = byId(HTMLButtonElement, "replace-key");
const cancelSetup = byId(HTMLButtonElement, "cancel-setup");

byId(HTMLElement, "settings-label").textContent = t("settings");
byId(HTMLButtonElement, "settings-replace-key").textContent = t("replaceKey");
replaceKey.textContent = t("replaceKey");
retry.textContent = t("retry");
stale.textContent = t("failed.stale");
byId(HTMLHeadingElement, "setup-title").textContent = t("setup.title");
byId(HTMLParagraphElement, "setup-hint").textContent = t("setup.hint");
byId(HTMLSpanElement, "key-file-label").textContent = t("setup.file");
byId(HTMLHeadingElement, "title").textContent = t("title");
refresh.textContent = t("refresh");
cancelSetup.textContent = t("cancel");

/** The roster in memory: what the filters narrow and the table shows. */
let tutors: readonly Tutor[] = [];
const filters = createFilters(byId(HTMLElement, "filters"), showRoster);
/** Whether a read has worked since the Plugin opened, so a failed one leaves its table, marked stale. */
let loaded = false;

function showRoster(): void {
  const { shown, suppressed } = filters.apply(tutors);
  table.show(shown);
  const count = t("tally", { count: shown.length });
  tally.textContent =
    suppressed === 0
      ? count
      : `${count} · ${t("suppressed", { count: suppressed })}`;
}

/** Takes `key` as the one Refresh and Retry read with, and reads the sheet with it. */
async function start(key: ServiceAccountKey): Promise<void> {
  const reload = (): void => {
    void load(key);
  };
  refresh.onclick = reload;
  retry.onclick = reload;
  await load(key);
}

/** Reads the sheet with `key` and shows it. Every open does this once; Refresh and Retry do it again. */
async function load(key: ServiceAccountKey): Promise<void> {
  setup.hidden = true;
  settings.hidden = false;
  refresh.disabled = true;
  retry.disabled = true;
  status.textContent = t("loading");
  try {
    tutors = parseRows(await readSheet(key));
    loaded = true;
    showRoster();
    roster.hidden = false;
    problem.hidden = true;
  } catch (e) {
    // Not logged: Google's errors may echo sheet data. Anything else is a bug, and propagates.
    if (!(e instanceof SheetReadFailed)) throw e;
    showProblem(e.failure, key);
  } finally {
    status.textContent = "";
    refresh.disabled = false;
    retry.disabled = false;
  }
}

/** Says why the read failed and offers what fixes it. Once a read has worked, its table stays, marked stale. */
function showProblem(failure: ReadFailure, key: ServiceAccountKey): void {
  switch (failure) {
    case "keyRejected":
      problemMessage.textContent = t("failed.keyRejected");
      break;
    case "noAccess":
      problemMessage.textContent = t("failed.noAccess", {
        email: key.client_email,
      });
      break;
    case "unreachable":
      problemMessage.textContent = t("failed.unreachable");
      break;
    default:
      failure satisfies never;
  }
  retry.hidden = failure === "keyRejected"; // the same key would fail the same way
  replaceKey.hidden = failure !== "keyRejected";
  stale.hidden = !loaded;
  roster.hidden = !loaded;
  problem.hidden = false;
}

function showSelection(): void {
  writeMessages.disabled = selection.size === 0;
  writeMessages.textContent = t("messages.open", { count: selection.size });
}
showSelection();

byId(HTMLButtonElement, "back").textContent = t("messages.back");
byId(HTMLSpanElement, "profile-label").textContent = t("messages.profile");
byId(HTMLSpanElement, "phones-label").textContent = t("messages.phones");
for (const [button, text] of [
  ["copy-profile", profileText],
  ["copy-phones", phoneText],
] as const) {
  const copy = byId(HTMLButtonElement, button);
  copy.textContent = t("messages.copy");
  copy.addEventListener("click", () => {
    // The text as staff edited it. A refusal propagates: there is nothing to retry here.
    void navigator.clipboard.writeText(text.value);
  });
}

/** Whether the failure message was up when staff left the results, so Back brings it back. */
let problemShown = false;
writeMessages.addEventListener("click", () => {
  // Regenerated on every entry, in table order, priced by the level filter now. A picked tutor the
  // filters hide is still in the messages.
  const level = filters.level();
  const picked = tutors
    .filter((tutor) => selection.has(tutor.row))
    .map((tutor) => ({ tutor, offerings: matching(tutor, level) }));
  const ordered = table.sorted(picked);
  profileText.value = profileMessage(ordered);
  phoneText.value = phoneMessage(ordered);
  problemShown = problem.hidden === false; // hidden may also be "until-found"
  roster.hidden = true;
  problem.hidden = true;
  messages.hidden = false;
});
byId(HTMLButtonElement, "back").addEventListener("click", () => {
  messages.hidden = true;
  roster.hidden = false;
  problem.hidden = !problemShown;
});

function askForKey(): void {
  messages.hidden = true;
  roster.hidden = true;
  problem.hidden = true;
  settings.hidden = true;
  settings.open = false;
  status.textContent = "";
  cancelSetup.hidden = true;
  setup.hidden = false;
}

replaceKey.addEventListener("click", askForKey);
byId(HTMLButtonElement, "settings-replace-key").addEventListener(
  "click",
  () => {
    // The stored key still works here, so Cancel puts back whichever views were up.
    const restore = [roster, problem, messages].map((view) => {
      const hidden = view.hidden;
      return (): void => {
        view.hidden = hidden;
      };
    });
    cancelSetup.onclick = () => {
      setup.hidden = true;
      setupError.textContent = "";
      settings.hidden = false;
      for (const view of restore) view();
    };
    askForKey();
    cancelSetup.hidden = false;
  },
);

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
    await start(parsed.key);
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

const stored = await hub.secrets.get(KEY_SECRET);
switch (stored.kind) {
  case "missing":
    askForKey();
    break;
  case "stored": {
    // The stored text passed parseKey before it was saved; parsed again here, at the boundary.
    const parsed = parseKey(stored.value);
    if (parsed.kind === "invalid") askForKey();
    else await start(parsed.key);
    break;
  }
  default:
    stored satisfies never;
}
