// Everything the Hub Chrome says, in each Display Language (ADR 0007).

import type { DisplayLanguage } from "../shared/hub-chrome-ipc";

export const STRINGS = {
  "en-HK": {
    plugins: "Plugins",
    noPluginOpen: "No Plugin is open",
  },
  "zh-HK": {
    plugins: "外掛程式",
    noPluginOpen: "未有開啟任何外掛程式",
  },
} satisfies Record<DisplayLanguage, unknown>;
