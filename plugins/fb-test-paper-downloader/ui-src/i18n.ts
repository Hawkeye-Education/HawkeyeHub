// The Plugin UI's own strings, in the Display Language (PLUGIN_STANDARD.md §4.4).

import i18next from "i18next";
import { hub } from "./hub";
import { enHK } from "./strings/en-HK";
import { zhHK } from "./strings/zh-HK";

declare module "i18next" {
  interface CustomTypeOptions {
    resources: { translation: typeof enHK };
  }
}

await i18next.init({
  lng: hub.displayLanguage, // fixed until staff reopen the Plugin, so there is no language-change handling
  fallbackLng: "en-HK", // any tag without a translation, including future ones
  load: "currentOnly", // exact tags only; zh-HK never falls to zh
  resources: {
    "en-HK": { translation: enHK },
    "zh-HK": { translation: zhHK },
  },
  interpolation: { escapeValue: false }, // strings go into textContent, never innerHTML
});

export const t = i18next.t;
