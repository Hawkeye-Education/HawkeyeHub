// The Display Language (ADR 0007). Until the settings spec adds the per-installation choice, the Hub
// follows the OS: its first preferred language that maps to one the Hub draws in, else en-HK.

import type { DisplayLanguage } from "../shared/hub-chrome-ipc";

const TRADITIONAL_CHINESE_REGIONS = new Set(["HK", "TW", "MO"]);

function mapLanguage(tag: string): DisplayLanguage | null {
  // The OS hands over BCP 47 tags; one Intl cannot parse is a broken OS and throws.
  const { language, script, region } = new Intl.Locale(tag);
  if (language === "en") return "en-HK";
  if (
    language === "zh" &&
    (script === "Hant" ||
      (region !== undefined && TRADITIONAL_CHINESE_REGIONS.has(region)))
  ) {
    return "zh-HK";
  }
  return null;
}

/** `preferred` is `app.getPreferredSystemLanguages()`, most preferred first. */
export function displayLanguageFor(
  preferred: readonly string[],
): DisplayLanguage {
  for (const tag of preferred) {
    const language = mapLanguage(tag);
    if (language !== null) return language;
  }
  return "en-HK";
}
