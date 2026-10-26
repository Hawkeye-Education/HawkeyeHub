// Tutor Finder's Plugin UI: plain DOM over native elements. A placeholder until the roster lands (#175).

import { t } from "./i18n";

function byId(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`index.html has no #${id}`);
  return found;
}

byId("title").textContent = t("title");
byId("placeholder").textContent = t("placeholder");
