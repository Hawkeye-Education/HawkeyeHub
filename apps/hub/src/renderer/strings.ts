// Everything the Hub Chrome says, in each Display Language (ADR 0007).

import type { BlockedReason, DisplayLanguage } from "../shared/hub-chrome-ipc";

export const STRINGS = {
  "en-HK": {
    plugins: "Plugins",
    noPluginOpen: "No Plugin is open",
    close: (name: string) => `Close ${name}`,
    blocked: {
      "needs-sign-in": "Needs sign-in",
      "needs-different-hub": "Needs a different Hub",
    } satisfies Record<BlockedReason, string>,
  },
  "zh-HK": {
    plugins: "外掛程式",
    noPluginOpen: "未有開啟任何外掛程式",
    close: (name: string) => `關閉 ${name}`,
    blocked: {
      "needs-sign-in": "需要登入",
      "needs-different-hub": "需要另一版本的 Hawkeye Hub",
    } satisfies Record<BlockedReason, string>,
  },
} satisfies Record<DisplayLanguage, unknown>;
