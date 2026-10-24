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

export const NonBlank = z.string().refine((raw) => raw.trim() !== "", "blank");
/** As with a ThemeName below, the check makes it the type, and the `as` grants the brand. */
export const AiProviderLabelSchema = NonBlank.transform(
  (raw) => raw as AiProviderLabel,
);

/** A model's id at its AI Provider, such as `claude-opus-5-5`. */
export type ModelId = Branded<string, "ModelId">;
/** As above, the check makes it the type, and the `as` grants the brand. */
export const ModelIdSchema = NonBlank.transform((raw) => raw as ModelId);

// An AI Provider's endpoint, stored with a valid Base URL and drafted with any text.
const endpointSchema = <BaseUrl extends z.ZodType<string>>(baseUrl: BaseUrl) =>
  z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("openai-compatible"), baseUrl }),
    z.strictObject({ kind: z.literal("anthropic") }),
  ]);

// The Default AI Provider: none, or a provider (by label when stored, by row in the form) and model.
const defaultSchema = <Provider extends z.ZodType, Model extends z.ZodType>(
  provider: Provider,
  model: Model,
) =>
  z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }),
    z.strictObject({ kind: z.literal("chosen"), provider, model }),
  ]);

// The settings the form holds just as they are stored.
const APPEARANCE_AND_LANGUAGE = {
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
};

/**
 * Strict throughout: a field this Hub does not know makes the whole value invalid. Every field
 * always holds a value: following the company or the OS is a value of its own, never an absent
 * field. The regex makes a name a ThemeName, and the `as` after it grants the brand, as in
 * `ids.ts`.
 */
export const HubSettingsSchema = z
  .strictObject({
    ...APPEARANCE_AND_LANGUAGE,
    // An AI Provider's key is never here: it lives in the key store (`main/ai-keys.ts`).
    aiProviders: z.array(
      z.strictObject({
        label: AiProviderLabelSchema,
        endpoint: endpointSchema(z.url()),
        models: z
          .array(
            z.strictObject({ id: ModelIdSchema, acceptsImages: z.boolean() }),
          )
          .min(1),
      }),
    ),
    defaultAiProvider: defaultSchema(AiProviderLabelSchema, ModelIdSchema),
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

/** A provider's row in the Settings form, so a key typed for it follows it through edits. */
export type AiProviderRow = Branded<string, "AiProviderRow">;
export const AiProviderRowSchema = NonBlank.transform(
  (raw) => raw as AiProviderRow,
);

/**
 * The Hub Settings form, as main holds it while staff edit and the Hub Chrome draws it. AI
 * Providers are drafts, as typed, so they may be invalid: Save refuses the form until it parses as
 * `HubSettings`. `was` is the stored provider a row was edited from, so a rename moves its key. The
 * Default AI Provider names its provider by row, so renaming the provider keeps it. No key is here.
 */
export const HubSettingsFormSchema = z.strictObject({
  ...APPEARANCE_AND_LANGUAGE,
  aiProviders: z
    .array(
      z.strictObject({
        row: AiProviderRowSchema,
        was: z.discriminatedUnion("kind", [
          z.strictObject({ kind: z.literal("added") }),
          z.strictObject({
            kind: z.literal("stored"),
            label: AiProviderLabelSchema,
          }),
        ]),
        label: z.string(),
        endpoint: endpointSchema(z.string()),
        models: z.array(
          z.strictObject({ id: z.string(), acceptsImages: z.boolean() }),
        ),
      }),
    )
    .refine(
      (rows) => new Set(rows.map(({ row }) => row)).size === rows.length,
      "AI Provider rows repeat",
    ),
  defaultAiProvider: defaultSchema(AiProviderRowSchema, z.string()),
});

export type HubSettingsForm = z.infer<typeof HubSettingsFormSchema>;
export type AiProviderDraft = HubSettingsForm["aiProviders"][number];
