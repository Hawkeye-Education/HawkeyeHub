// The Facebook Test Paper Downloader's Plugin UI: plain DOM over native elements and the Hub Kit.

import { explain } from "./explain";
import { backend } from "./hub";
import { t } from "./i18n";
import { SignInResult } from "./protocol";
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

byId("span", "group-label").textContent = t("group");
output.label = t("output");
signIn.textContent = t("signIn");

// --- Plugin Data: what staff chose last time ---
const settings = loadSettings();
group.value = settings.group;
output.value = settings.output;

function save(): void {
  saveSettings({ v: 1, group: group.value, output: output.value });
}
group.addEventListener("change", save);
output.addEventListener("change", save);

// --- Sign in: one request; the Backend's Edge window resolves it ---
signIn.addEventListener("click", () => {
  void (async () => {
    signIn.disabled = true;
    status.textContent = t("signingIn");
    try {
      const { outcome } = SignInResult.parse(
        await backend.request("signIn", {}),
      );
      status.textContent = t(`outcome.${outcome}`);
    } catch (e) {
      status.textContent = explain(e);
    } finally {
      signIn.disabled = false;
    }
  })();
});
