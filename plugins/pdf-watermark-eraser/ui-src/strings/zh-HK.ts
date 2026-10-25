// Typed by the English strings, so a missing key fails the typecheck.
import type { enHK } from "./en-HK";

export const zhHK: typeof enHK = {
  input: "輸入資料夾",
  output: "輸出資料夾",
  pattern: "水印文字",
  regex: "正規表示式",
  ignoreCase: "不分大小寫",
  finder: "尋找水印文字",
  finderHint:
    "選擇 PDF 和頁數，複製頁面文字，再用「草擬水印正規表示式」貼到助手。大部分頁面都重複出現的行通常就是水印。",
  file: "PDF",
  page: "頁",
  show: "顯示文字",
  copy: "複製頁面文字",
  copied: "已複製",
  repeated: "大部分頁面重複出現：{{lines}}",
  noPdfs: "此資料夾沒有 PDF",
  run: "移除水印",
  cancel: "取消",
  openOutput: "開啟輸出資料夾",
  pickFolders: "請先選擇輸入及輸出資料夾。",
  busy: "正在移除水印。現在關閉會中途停止。",
  summary: "完成：{{cleaned}} 個已清除，{{failed}} 個失敗，共 {{total}} 個。",
  summaryCancelled: "已取消，完成 {{done}} / {{total}} 個檔案。",
  result: {
    // Chinese has one plural form, so _one repeats _other.
    cleaned_one: "成功  {{file}}：移除了 {{count}} 個物件",
    cleaned_other: "成功  {{file}}：移除了 {{count}} 個物件",
    "no-match": "失敗  {{file}}：找不到相符的水印文字",
    password: "失敗  {{file}}：受密碼保護",
    error: "失敗  {{file}}：{{detail}}",
  },
  error: {
    "pattern-empty": "水印文字是空的。",
    "pattern-invalid": "正規表示式無效：{{detail}}",
    "same-folder": "輸入及輸出資料夾必須不同。",
    "output-inside-input": "輸出資料夾不可在輸入資料夾之內。",
    "folder-missing": "該資料夾已不存在。",
    password: "該 PDF 受密碼保護。",
    "already-running": "已在處理中。",
    "invalid-params": "清除工具收到無法處理的要求：{{detail}}",
    "method-not-found": "此版本的清除工具不支援這項操作：{{detail}}",
    internal: "出現問題：{{detail}}",
    "folder-not-opened": "無法開啟資料夾：{{detail}}",
  },
};
