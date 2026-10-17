# Plugins own their translation; the Hub translates only what it draws

The Hub translates everything it draws: the **Hub Chrome**, the text built into **Hub Kit** components, and the manifest text it shows (Plugin name, description, **Prompt Template** labels and text, also published in the Registry's `index.json`). Each of those manifest fields is a plain English string or a map keyed by exact **Display Language** tags (`en-HK`, `zh-HK` at launch), and packaging fails if a map lacks `en-HK` or holds an unknown tag. A **Plugin UI** translates its own strings with whatever library it likes; the Hub API only gives it a read-only `displayLanguage` and sets `<html lang>` before plugin code runs. **Backends** get no language at all: if one ever produces text, the Plugin UI passes the language as an ordinary JSON-RPC parameter. English is the one language every Plugin must ship, and anything missing falls back to it.

We chose this over a Hub `t()` function with a Hub-defined string-bundle format because ADR 0006 already lets Plugins use any UI framework, each of which has its own i18n library, and a Hub-owned format would be one more piece of Hub API to freeze. We chose not to set the Backend's process locale (`LANG`/`LC_ALL`) because it silently changes encoding, sorting and the language Playwright's browser launches with.

## Consequences

- An open Plugin keeps the Display Language it was opened with until staff reopen it; the Hub Chrome switches at once and tells staff. There is no language-change event, so no Plugin ever shows a half-switched screen and Backends never need notifying.
- The set of Display Languages is not Hub API. Plugins must accept any tag, including future ones, and fall back to English, so adding a language is a Hub release, not a Hub API bump.
- Playbooks are not translated. The Hub preamble tells the **Assistant** to reply in the language staff write in, and in the Display Language before they have written or when it is unclear.
- Dates, numbers and HKD amounts are formatted with the platform's `Intl` and the Display Language tag; the Hub API has no formatting helpers and there is no separate region setting.
- Theme font tokens carry a font stack per language, chosen with `:lang()`, so `zh-HK` text gets Hong Kong glyph forms from system fonts.
