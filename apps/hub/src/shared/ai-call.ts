// What a `hub.ai.chat` asks for: the schema main parses the Plugin preload's call with, and the
// type inferred from it, which the call module (`main/ai.ts`) takes from any caller. The preload
// imports only the type, so zod stays out of its bundle.

import type { HubError } from "@hawkeye-hub/hub-api";
import { z } from "zod";
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

/** One message's content: text, and images for a model that accepts them. */
export const AiContentSchema = z.array(
  z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("text"), text: z.string() }),
    z.strictObject({
      type: z.literal("image"),
      // Not z.instanceof, which infers Uint8Array<ArrayBuffer>: the page may pass any.
      image: z.custom<Uint8Array>((value) => value instanceof Uint8Array),
      mediaType: z.string(),
    }),
  ]),
);
export type AiContent = z.infer<typeof AiContentSchema>;

export const AiChatRequestSchema = z.strictObject({
  model: AiModelChoiceSchema,
  system: z.string(),
  messages: z.array(
    z.strictObject({
      role: z.enum(["user", "assistant"]),
      content: AiContentSchema,
    }),
  ),
});
export type AiChatRequest = z.infer<typeof AiChatRequestSchema>;
export type AiMessage = AiChatRequest["messages"][number];

/** The preload's call on `AI_CHAT`: the request, under the id main tags its stream events with. */
export const AiChatCallSchema = z.strictObject({
  id: z.number(),
  request: AiChatRequestSchema,
});
export type AiChatCall = z.infer<typeof AiChatCallSchema>;
