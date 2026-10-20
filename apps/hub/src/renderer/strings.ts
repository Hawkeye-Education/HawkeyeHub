// Everything the Hub Chrome says, in each Display Language (ADR 0007).

import type {
  BlockedReason,
  ColourScheme,
  DisplayLanguage,
} from "../shared/hub-chrome-ipc";

export const STRINGS = {
  "en-HK": {
    plugins: "Plugins",
    noPluginOpen: "No Plugin is open",
    close: (name: string) => `Close ${name}`,
    closing: "Closing…",
    closeQuestion: (name: string) => `Close ${name}?`,
    quitQuestion: "Quit Hawkeye Hub?",
    busyPlugins: "These Plugins are in the middle of work:",
    keepOpen: "Keep open",
    closeAnyway: "Close anyway",
    quitAnyway: "Quit anyway",
    settings: "Settings",
    appearance: "Appearance",
    theme: "Theme",
    colourScheme: "Colour Scheme",
    colourSchemes: {
      system: "System",
      light: "Light",
      dark: "Dark",
    } satisfies Record<ColourScheme, string>,
    save: "Save",
    cancel: "Cancel",
    about: "About",
    hubVersion: "Version",
    exportDiagnostics: "Export diagnostics",
    blocked: {
      "needs-sign-in": "Needs sign-in",
      "needs-different-hub": "Needs a different Hub",
    } satisfies Record<BlockedReason, string>,
  },
  "zh-HK": {
    plugins: "外掛程式",
    noPluginOpen: "未有開啟任何外掛程式",
    close: (name: string) => `關閉 ${name}`,
    closing: "正在關閉…",
    closeQuestion: (name: string) => `關閉 ${name}？`,
    quitQuestion: "結束 Hawkeye Hub？",
    busyPlugins: "以下外掛程式正在工作中：",
    keepOpen: "保持開啟",
    closeAnyway: "仍然關閉",
    quitAnyway: "仍然結束",
    settings: "設定",
    appearance: "外觀",
    theme: "主題",
    colourScheme: "色彩配置",
    colourSchemes: {
      system: "跟隨系統",
      light: "淺色",
      dark: "深色",
    } satisfies Record<ColourScheme, string>,
    save: "儲存",
    cancel: "取消",
    about: "關於",
    hubVersion: "版本",
    exportDiagnostics: "匯出診斷資料",
    blocked: {
      "needs-sign-in": "需要登入",
      "needs-different-hub": "需要另一版本的 Hawkeye Hub",
    } satisfies Record<BlockedReason, string>,
  },
} satisfies Record<DisplayLanguage, unknown>;

export type Strings = (typeof STRINGS)[DisplayLanguage];
