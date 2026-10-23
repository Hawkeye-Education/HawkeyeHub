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
import type { Branded } from "./branded";

export type AiProviderLabel = Branded<string, "AiProviderLabel">;

const NonBlank = z.string().refine((raw) => raw.trim() !== "", "blank");
/** As with a ThemeName below, the check makes it the type, and the `as` grants the brand. */
export const AiProviderLabelSchema = NonBlank.transform(
  (raw) => raw as AiProviderLabel,
);

/**
 * Strict throughout: a field this Hub does not know makes the whole value invalid. Every field
 * always holds a value: following the company or the OS is a value of its own, never an absent
 * field. The regex makes a name a ThemeName, and the `as` after it grants the brand, as in
 * `ids.ts`.
 */
export const HubSettingsSchema = z
  .strictObject({
    theme: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("company") }),
      z.strictObject({
        kind: z.literal("chosen"),
        name: z
          .string()
          .regex(KEBAB_CASE)
          .transform((raw) => raw as ThemeName),
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
    // An AI Provider's key is never here: it lives in the key store (`main/ai-keys.ts`).
    aiProviders: z.array(
      z.strictObject({
        label: AiProviderLabelSchema,
        endpoint: z.discriminatedUnion("kind", [
          z.strictObject({
            kind: z.literal("openai-compatible"),
            baseUrl: z.url(),
          }),
          z.strictObject({ kind: z.literal("anthropic") }),
        ]),
        models: z
          .array(z.strictObject({ id: NonBlank, acceptsImages: z.boolean() }))
          .min(1),
      }),
    ),
    defaultAiProvider: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("none") }),
      z.strictObject({
        kind: z.literal("chosen"),
        provider: AiProviderLabelSchema,
        model: NonBlank,
      }),
    ]),
  })
  .superRefine(({ aiProviders, defaultAiProvider }, context) => {
    const labels = aiProviders.map(({ label }) => label);
    if (new Set(labels).size !== labels.length) {
      context.addIssue({
        code: "custom",
        message: "AI Provider labels repeat",
      });
    }
    if (defaultAiProvider.kind === "chosen") {
      const { provider, model } = defaultAiProvider;
      const named = aiProviders.find(({ label }) => label === provider);
      if (named?.models.some(({ id }) => id === model) !== true) {
        context.addIssue({
          code: "custom",
          message:
            "The Default AI Provider names no configured provider and model",
        });
      }
    }
  });

export type HubSettings = z.infer<typeof HubSettingsSchema>;
export type AiProvider = HubSettings["aiProviders"][number];
export type AiProviderKind = AiProvider["endpoint"]["kind"];
