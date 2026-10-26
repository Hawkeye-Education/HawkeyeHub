// Typed by the English strings, so a missing key fails the typecheck.
import type { enHK } from "./en-HK";

export const zhHK: typeof enHK = {
  group: "Facebook 群組（網址或編號）",
  output: "輸出資料夾",
  signIn: "登入 Facebook",
  signingIn: "請在 Edge 視窗登入 Facebook，登入後視窗會自動關閉。",
  outcome: {
    "signed-in": "已登入 Facebook。",
    cancelled: "已取消登入：Edge 視窗在登入前被關閉。",
  },
  error: {
    "browser-not-found":
      "無法啟動 Microsoft Edge。請安裝或修復 Edge，然後再試。（{{detail}}）",
    "already-running": "此外掛的 Edge 視窗已經開啟。",
    "invalid-params": "外掛收到無法處理的要求：{{detail}}",
    "method-not-found": "此版本的外掛不支援這項操作：{{detail}}",
    internal: "出現問題：{{detail}}",
  },
};
