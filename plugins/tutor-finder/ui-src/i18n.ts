// The Plugin UI's own strings, in the Display Language (PLUGIN_STANDARD.md §4.4). Tutor Finder is
// English only, so every Display Language falls back to en-HK.

import i18next from "i18next";
import { enHK } from "./strings/en-HK";

declare module "i18next" {
  interface CustomTypeOptions {
    resources: { translation: typeof enHK };
  }
}

await i18next.init({
  lng: window.hub.displayLanguage, // fixed until staff reopen the Plugin, so there is no language-change handling
  fallbackLng: "en-HK", // every tag but en-HK, since there is no other translation
  load: "currentOnly", // exact tags only
  resources: { "en-HK": { translation: enHK } },
  interpolation: { escapeValue: false }, // strings go into textContent, never innerHTML
});

export const t = i18next.t;
