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
  update: "更新",
  stopAtKnown: "遇到已下載的帖子便停止",
  stop: "停止",
  pickOutput: "請先選擇輸出資料夾。",
  busy: "正在下載試卷。現在關閉會停止下載；已儲存的試卷會保留。",
  savingFiles: "正在儲存「檔案」分頁：第 {{done}} 個檔案，共 {{total}} 個。",
  scanning: "正在掃描群組動態：找到 {{found}} 個新帖子。",
  downloading: "正在下載第 {{done}} 個帖子，共 {{total}} 個。",
  result: {
    saved: "已儲存　{{item}}",
    "skipped-not-paper": "已略過　{{item}}：不是試卷",
    "skipped-known": "已略過　{{item}}：已下載過",
    incomplete:
      "不完整　{{item}}：只取得 {{saved}} 張，約有 {{shown}} 張圖片；下次會再試",
    failed: "失敗　　{{item}}：{{detail}}",
  },
  summary: {
    finished:
      "完成：檔案已儲存 {{filesSaved}} 個，已下載過 {{filesKnown}} 個，失敗 {{filesFailed}} 個；帖子已儲存 {{saved}} 個，非試卷 {{skippedNotPaper}} 個，不完整 {{incomplete}} 個，失敗 {{failed}} 個。",
    cancelled:
      "已停止：檔案已儲存 {{filesSaved}} 個，已下載過 {{filesKnown}} 個，失敗 {{filesFailed}} 個；帖子已儲存 {{saved}} 個，非試卷 {{skippedNotPaper}} 個，不完整 {{incomplete}} 個，失敗 {{failed}} 個。",
    "bad-streak":
      "連續 4 個帖子下載失敗或不完整，已停止：Facebook 可能正在限制此帳戶。請等數小時後再按「更新」。（已儲存 {{saved}} 個，不完整 {{incomplete}} 個，失敗 {{failed}} 個。）",
  },
  error: {
    "browser-not-found":
      "無法啟動 Microsoft Edge。請安裝或修復 Edge，然後再試。（{{detail}}）",
    "signed-out":
      "Facebook 已登出此外掛。請按「登入 Facebook」，然後再按「更新」。",
    checkpoint:
      "Facebook 要求進行安全檢查。請按「登入 Facebook」完成檢查，等數小時後再按「更新」。",
    blocked:
      "Facebook 暫時封鎖了此帳戶。今天請先停止，稍後再按「更新」；已儲存的試卷會保留。",
    "folder-missing": "輸出資料夾已不存在，請重新選擇。",
    "group-invalid":
      "Facebook 群組必須是群組網址（facebook.com/groups/…）或其編號。",
    "already-running": "此外掛的 Edge 視窗已經開啟。",
    "invalid-params": "外掛收到無法處理的要求：{{detail}}",
    "method-not-found": "此版本的外掛不支援這項操作：{{detail}}",
    internal: "出現問題：{{detail}}",
  },
};
