// What a `hub.ai.chat` asks for: the schema main parses the Plugin preload's call with, and the
// type inferred from it, which the call module (`main/ai.ts`) takes from any caller. The preload
// imports only the type, so zod stays out of its bundle.

import type { HubError } from "@hawkeye-hub/hub-api";
import { z } from "zod";
import { AUDIO_MEDIA_TYPES } from "./hub-chrome-ipc";
import { AiProviderLabelSchema, ModelIdSchema } from "./hub-settings";

/** Why a chat failed, as `hub.ai` rejects with it. There is no fallback to another provider. */
export type AiFailure = Extract<
  HubError,
  {
    code:
      | "no-provider"
      | "provider-missing"
      | "provider-rejected"
      | "provider-unreachable";
  }
>;

export const AiModelChoiceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("default") }),
  z.strictObject({
    kind: z.literal("chosen"),
    provider: AiProviderLabelSchema,
    model: ModelIdSchema,
  }),
]);
export type AiModelChoice = z.infer<typeof AiModelChoiceSchema>;

// Not z.instanceof, which infers Uint8Array<ArrayBuffer>: the page may pass any.
const BYTES = z.custom<Uint8Array>((value) => value instanceof Uint8Array);
const TEXT_PART = z.strictObject({ type: z.literal("text"), text: z.string() });
const IMAGE_PART = z.strictObject({
  type: z.literal("image"),
  image: BYTES,
  mediaType: z.string(),
});

const AI_PART = z.discriminatedUnion("type", [
  TEXT_PART,
  IMAGE_PART,
  z.strictObject({
    type: z.literal("document"),
    data: BYTES,
    mediaType: z.literal("application/pdf"),
  }),
  z.strictObject({
    type: z.literal("audio"),
    data: BYTES,
    mediaType: z.enum(AUDIO_MEDIA_TYPES),
  }),
]);

/**
 * One message's content: text, and each other part (its `type` a `ModelInput`) only for a model
 * that accepts it.
 */
export const AiContentSchema = z.array(AI_PART);
export type AiContent = z.infer<typeof AiContentSchema>;

/**
 * What staff send the Assistant from the Hub Chrome: what they typed, and each file or long paste
 * they attached, under the name the Assistant Panel shows it by. The model gets only the parts.
 */
export const SentPartsSchema = z.array(
  z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("typed"), text: z.string() }),
    z.strictObject({
      kind: z.literal("attached"),
      name: z.string(),
      part: AI_PART,
    }),
  ]),
);
export type SentPart = z.infer<typeof SentPartsSchema>[number];
export type Attachment = Extract<SentPart, { kind: "attached" }>;

/** The content the model gets for what staff sent. */
export function contentOf(parts: SentPart[]): AiContent {
  return parts.map((sent) =>
    sent.kind === "typed" ? { type: "text", text: sent.text } : sent.part,
  );
}

const chatRequestSchema = <Content extends z.ZodType>(content: Content) =>
  z.strictObject({
    model: AiModelChoiceSchema,
    system: z.string(),
    messages: z.array(
      z.strictObject({ role: z.enum(["user", "assistant"]), content }),
    ),
  });

export const AiChatRequestSchema = chatRequestSchema(AiContentSchema);
export type AiChatRequest = z.infer<typeof AiChatRequestSchema>;
export type AiMessage = AiChatRequest["messages"][number];

/**
 * The preload's call on `AI_CHAT`: the request, under the id main tags its stream events with.
 * `hub.ai` sends only text and images (spec #142), so a document or audio part is refused here.
 */
export const AiChatCallSchema = z.strictObject({
  id: z.int(),
  request: chatRequestSchema(
    z.array(z.discriminatedUnion("type", [TEXT_PART, IMAGE_PART])),
  ),
});
export type AiChatCall = z.infer<typeof AiChatCallSchema>;
