import { expect, test } from "vitest";
import { displayLanguageFor } from "./display-language";

test.each([
  [["zh-HK"], "zh-HK"],
  [["zh-TW"], "zh-HK"],
  [["zh-MO"], "zh-HK"],
  [["zh-Hant"], "zh-HK"],
  [["zh-Hant-CN"], "zh-HK"],
  [["en-US"], "en-HK"],
  [["en"], "en-HK"],
  [["en-GB", "zh-HK"], "en-HK"],
  // Simplified Chinese and French map to neither, so the next language decides.
  [["zh-CN", "fr-FR", "zh-Hant-HK"], "zh-HK"],
  [["zh-Hans-SG", "en-AU"], "en-HK"],
  [["ja-JP", "fr-FR"], "en-HK"],
  [[], "en-HK"],
])("the OS languages %j give %s", (preferred, expected) => {
  expect(displayLanguageFor(preferred)).toBe(expected);
});
