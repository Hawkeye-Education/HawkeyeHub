import type { enHK } from "./en-HK";

export const zhHK: typeof enHK = {
  files: "收據相片",
  hint: "選擇 JPEG 或 PNG 相片，或把相片拖放到這裏。相片按檔名次序放入文件，每頁一張收據。",
  run: "擷取收據",
  save: "儲存 Word 文件",
  busy: "正在擷取收據。現在關閉會失去這次的結果。",
  summary: "完成：已擷取 {{total}} 張相片中的 {{receipts}} 張。",
  failed: {
    unsupported: "不是 JPEG 或 PNG",
    unreadable: "無法讀取",
  },
};
