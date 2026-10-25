// The call module (spec #101, ADR 0009 §7): one chat with an AI Provider from Hub Settings,
// through the Vercel AI SDK, streaming text only: `startAiChat`. `hub.ai` (`serveAi` below) and
// the Assistant Panel both call it from main.

import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { AiProviderInfo } from "@hawkeye-hub/hub-api";
import { APICallError, streamText, type LanguageModel } from "ai";
import type { WebContents } from "electron";
import { z } from "zod";
import {
  AiChatCallSchema,
  type AiChatRequest,
  type AiFailure,
  type AiModelChoice,
} from "../shared/ai-call";
import {
  AI_CANCEL,
  AI_CHAT,
  AI_CHAT_EVENT,
  AI_PROVIDERS,
  type AiChatEvent,
} from "../shared/plugin-preload";
import type { AiProvider, HubSettings } from "../shared/hub-settings";
import type { AiKeys, AiProviderKey } from "./ai-keys";
import type { HubEvent } from "./diagnostics";

export type {
  AiChatRequest,
  AiFailure,
  AiModelChoice,
} from "../shared/ai-call";

/** What a chat's `done` rejects with, and its `text` throws, when it fails. */
export class AiCallFailed extends Error {
  constructor(readonly failure: AiFailure) {
    super(`AI call failed: ${failure.code}`);
  }
}

export interface AiCallDeps {
  /** The saved Hub Settings, and the keys saved with them. */
  settings: HubSettings;
  keys: AiKeys;
  fetch: typeof globalThis.fetch;
  /** Told of a rejected or unreachable call, for hub.log. */
  recordHubEvent: (event: HubEvent) => void;
}

export interface AiChat {
  /** The reply as it streams. Throws as `done` rejects. */
  text: AsyncIterable<string>;
  /** The whole reply; after `cancel`, what had arrived. */
  done: Promise<string>;
  cancel(): void;
}

/** A provider's label and models: what a model picker offers. No key, no Base URL. */
export function labelAndModels({
  label,
  models,
}: AiProvider): Pick<AiProvider, "label" | "models"> {
  return { label, models };
}

/** What `hub.ai.providers()` lists: no key, no Base URL. */
export function aiProvidersOf({ aiProviders }: HubSettings): AiProviderInfo[] {
  // `hub.ai` is unchanged by model inputs (spec #142): text and images only.
  return aiProviders.map(({ label, endpoint, models }) => ({
    label,
    kind: endpoint.kind,
    models: models.map(({ id, inputs }) => ({
      id,
      acceptsImages: inputs.includes("image"),
    })),
  }));
}

/** The provider and model a chat uses, or why there is none. */
export type Target =
  | { kind: "found"; provider: AiProvider; model: AiProvider["models"][number] }
  | {
      kind: "failed";
      failure: Extract<AiFailure, { code: "no-provider" | "provider-missing" }>;
    };

/**
 * A model choice resolved against the saved Hub Settings: the one resolver, for a chat and for the
 * Assistant Panel's current model alike.
 */
export function targetOf(settings: HubSettings, model: AiModelChoice): Target {
  const chosen = model.kind === "default" ? settings.defaultAiProvider : model;
  if (chosen.kind === "none") {
    return { kind: "failed", failure: { code: "no-provider" } };
  }
  const provider = settings.aiProviders.find(
    ({ label }) => label === chosen.provider,
  );
  const found = provider?.models.find(({ id }) => id === chosen.model);
  return provider === undefined || found === undefined
    ? { kind: "failed", failure: { code: "provider-missing" } }
    : { kind: "found", provider, model: found };
}

/**
 * Starts one chat. Every failure, including no provider set up, arrives through `done` and
 * `text`. A part of an input the model does not accept throws here, before any call: the model's
 * `inputs` (and `hub.ai.providers()`) say which it does.
 */
export function startAiChat(deps: AiCallDeps, request: AiChatRequest): AiChat {
  const target = targetOf(deps.settings, request.model);
  if (target.kind === "found") {
    const { id, inputs } = target.model;
    for (const { content } of request.messages) {
      for (const { type } of content) {
        if (type !== "text" && !inputs.includes(type)) {
          throw new Error(`${id} does not accept ${type} parts`);
        }
      }
    }
  }
  const abort = new AbortController();
  // Two readers of one stream: `done` reads the whole reply even if nobody reads `text`.
  const [forText, forDone] = ReadableStream.from(
    deltasOf(deps, target, request, abort.signal),
  ).tee();
  const done = (async () => {
    let reply = "";
    for await (const delta of forDone) reply += delta;
    return reply;
  })();
  // Not swallowed: `done` still rejects for whoever awaits it. Every failure reaches `text` too,
  // so a caller that reads only `text` must not crash the Hub with an unhandled rejection.
  done.catch(() => undefined);
  return {
    text: forText,
    done,
    cancel: () => {
      abort.abort();
    },
  };
}

async function* deltasOf(
  { keys, fetch, recordHubEvent }: AiCallDeps,
  target: Target,
  { system, messages }: AiChatRequest,
  abortSignal: AbortSignal,
): AsyncGenerator<string> {
  if (target.kind === "failed") throw new AiCallFailed(target.failure);
  const { provider, model } = target;
  const result = streamText({
    model: languageModelOf(provider, model.id, keys.get(provider.label), fetch),
    system,
    // An image, a document or audio goes as a file part, which both roles may hold.
    messages: messages.map(({ role, content }) => ({
      role,
      content: content.map((part) => {
        switch (part.type) {
          case "text":
            return part;
          case "image":
            return {
              type: "file" as const,
              data: part.image,
              mediaType: part.mediaType,
            };
          case "document":
          case "audio":
            return {
              type: "file" as const,
              data: part.data,
              mediaType: part.mediaType,
            };
          default:
            return part satisfies never;
        }
      }),
    })),
    // One call, so one hub.log line per failure, and staff see it at once.
    maxRetries: 0,
    abortSignal,
    // The error still arrives as the stream's error part below; the SDK's default would also
    // print it, with its URL and request body, to the console.
    onError: () => undefined,
  });
  // Only text: reasoning, and every other part, is dropped. A cancel ends the stream.
  // The SDK throws an error that stops the stream, and sends others as an error part.
  try {
    for await (const part of result.stream) {
      if (part.type === "text-delta") yield part.text;
      if (part.type === "error") throw part.error;
    }
  } catch (error) {
    const failure = failureOf(error);
    recordHubEvent({
      kind: "ai-provider-call-failed",
      provider: provider.label,
      outcome:
        failure.code === "provider-rejected"
          ? { kind: "http-status", status: failure.status }
          : { kind: "no-response" },
    });
    throw new AiCallFailed(failure);
  }
}

/**
 * `hub.ai` for one Plugin UI (`AI_PROVIDERS`, `AI_CHAT`, `AI_CANCEL`). `depsNow` is read per call,
 * so a chat uses the Hub Settings and keys saved by then. Closing the Plugin cancels its chats.
 */
export function serveAi(
  webContents: WebContents,
  depsNow: () => AiCallDeps,
): void {
  const chats = new Map<number, AiChat>();
  const send = (event: AiChatEvent): void => {
    if (!webContents.isDestroyed()) webContents.send(AI_CHAT_EVENT, event);
  };
  webContents.ipc.handle(AI_PROVIDERS, () => aiProvidersOf(depsNow().settings));
  webContents.ipc.handle(AI_CHAT, (_event, raw: unknown) => {
    const { id, request } = AiChatCallSchema.parse(raw);
    const chat = startAiChat(depsNow(), request);
    chats.set(id, chat);
    void (async () => {
      try {
        for await (const text of chat.text) send({ id, kind: "delta", text });
        send({ id, kind: "done", text: await chat.done });
      } catch (error) {
        // Anything but a failure is a Hub bug: an unhandled rejection, so a Hub crash.
        if (!(error instanceof AiCallFailed)) throw error;
        send({ id, kind: "failed", failure: error.failure });
      } finally {
        chats.delete(id);
      }
    })();
  });
  webContents.ipc.handle(AI_CANCEL, (_event, raw: unknown) => {
    chats.get(z.int().parse(raw))?.cancel();
  });
  webContents.once("destroyed", () => {
    for (const chat of chats.values()) chat.cancel();
  });
}

function languageModelOf(
  { endpoint }: AiProvider,
  model: string,
  // An OpenAI-compatible provider may have no key, such as a local Ollama.
  key: AiProviderKey | undefined,
  fetch: typeof globalThis.fetch,
): LanguageModel {
  switch (endpoint.kind) {
    case "openai-compatible":
      return createOpenAICompatible({
        name: "hub",
        baseURL: endpoint.baseUrl,
        fetch,
        ...(key === undefined ? {} : { apiKey: key }),
      }).chatModel(model);
    case "anthropic":
      // Save refuses an Anthropic provider with no key; only an unreadable key file leaves one.
      // It fails as Anthropic answers a missing key, without a call: given no key, the SDK would
      // read ANTHROPIC_API_KEY from the environment instead.
      if (key === undefined) {
        throw new AiCallFailed({ code: "provider-rejected", status: 401 });
      }
      return createAnthropic({ fetch, apiKey: key })(model);
    default:
      return endpoint satisfies never;
  }
}

/**
 * The SDK reports an HTTP error answer, and a fetch that failed to connect, as an APICallError,
 * the latter with no status (provider-utils' handleFetchError; ai.test.ts covers both). Anything
 * else is a Hub bug, and is thrown as one.
 */
function failureOf(error: unknown): AiFailure {
  if (!APICallError.isInstance(error)) throw error;
  return error.statusCode === undefined
    ? { code: "provider-unreachable" }
    : { code: "provider-rejected", status: error.statusCode };
}
