// Hub Settings (spec #71): the schema main parses the file and the Hub Chrome's edits with, and
// the type inferred from it. The Hub Chrome and its preload import only the type, so zod stays out
// of their bundles.

import { KEBAB_CASE } from "@hawkeye-hub/plugin-format";
import { z } from "zod";
import {
  COLOUR_SCHEMES,
  DISPLAY_LANGUAGES,
  type ThemeName,
} from "./hub-chrome-ipc";

/**
 * A Theme's name, which need not be one this Hub has. The regex makes a name a ThemeName, and the
 * `as` after it grants the brand, as in `ids.ts`.
 */
export const ThemeNameSchema = z
  .string()
  .regex(KEBAB_CASE)
  .transform((raw) => raw as ThemeName);

/**
 * Strict throughout: a field this Hub does not know makes the whole value invalid. Every field
 * always holds a value: following the company or the OS is a value of its own, never an absent
 * field.
 */
export const HubSettingsSchema = z.strictObject({
  theme: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("company") }),
    z.strictObject({
      kind: z.literal("chosen"),
      name: ThemeNameSchema,
    }),
  ]),
  colourScheme: z.enum(COLOUR_SCHEMES),
  displayLanguage: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("system") }),
    z.strictObject({
      kind: z.literal("chosen"),
      language: z.enum(DISPLAY_LANGUAGES),
    }),
  ]),
});

export type HubSettings = z.infer<typeof HubSettingsSchema>;
