import type { enHK } from "./en-HK";

export const zhHK: typeof enHK = {
  files: "收據相片及 PDF",
  hint: "選擇 JPEG 或 PNG 相片或 PDF，或把檔案拖放到這裏。檔案按檔名次序放入文件，PDF 逐頁放入，每頁一張收據。",
  run: "擷取收據",
  save: "儲存 Word 文件",
  busy: "正在擷取收據。現在關閉會失去這次的結果。",
  summary: "完成：已擷取 {{total}} 張收據中的 {{receipts}} 張。",
  page: "{{name}} 第 {{page}} 頁",
  fallback: "找不到收據：保留整張相片",
  failed: {
    unsupported: "不是 JPEG、PNG 或 PDF",
    encrypted: "設有密碼保護",
    unreadable: "無法讀取",
  },
};
