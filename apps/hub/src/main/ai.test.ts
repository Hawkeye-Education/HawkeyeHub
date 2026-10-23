import { expect, test } from "vitest";
import type { AiKeys } from "./ai-keys";
import { parseAiProviderKey } from "./ai-keys";
import { aiProvidersOf, startAiChat, type AiChatRequest } from "./ai";
import type { HubEvent } from "./diagnostics";
import { FIRST_LAUNCH_SETTINGS } from "./hub-settings";
import { parseAiProviderLabel } from "./ids";
import type { HubSettings } from "../shared/hub-settings";

const LOCAL = parseAiProviderLabel("Local");
const BASE_URL = "http://models.example/v1";
const KEY = parseAiProviderKey("sk-local-secret");

const settings: HubSettings = {
  ...FIRST_LAUNCH_SETTINGS,
  aiProviders: [
    {
      label: LOCAL,
      endpoint: { kind: "openai-compatible", baseUrl: BASE_URL },
      models: [
        { id: "text-model", acceptsImages: false },
        { id: "vision-model", acceptsImages: true },
      ],
    },
  ],
  defaultAiProvider: { kind: "chosen", provider: LOCAL, model: "text-model" },
};
const keys: AiKeys = new Map([[LOCAL, KEY]]);

const PROMPT = "Draft a watermark regex";
const request: AiChatRequest = {
  model: { kind: "default" },
  system: "You advise.",
  messages: [{ role: "user", content: [{ type: "text", text: PROMPT }] }],
};

/** An OpenAI-compatible streamed reply: each chunk's delta, then `[DONE]`. */
function sse(deltas: object[]): Response {
  const lines = [
    ...deltas.map((delta) => chunk(delta, null)),
    chunk({}, "stop"),
  ];
  return new Response(`${lines.join("")}data: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });
}

function chunk(delta: object, finishReason: "stop" | null): string {
  return `data: ${JSON.stringify({
    id: "c",
    created: 0,
    model: "text-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

/** Runs one chat against `answer`, recording the requests it made and the hub.log events. */
function chatWith(
  answer: (url: string) => Response | Promise<Response>,
  chosen: AiChatRequest = request,
  using: HubSettings = settings,
) {
  const requests: { url: string; headers: Headers; body: string }[] = [];
  const events: HubEvent[] = [];
  const chat = startAiChat(
    {
      settings: using,
      keys,
      fetch: async (input, init) => {
        const url = input instanceof Request ? input.url : String(input);
        requests.push({
          url,
          headers: new Headers(init?.headers),
          // The SDK sends JSON text.
          body: init?.body as string,
        });
        return answer(url);
      },
      recordHubEvent: (event) => events.push(event),
    },
    chosen,
  );
  return { chat, requests, events };
}

async function collect(text: AsyncIterable<string>): Promise<string[]> {
  const deltas: string[] = [];
  for await (const delta of text) deltas.push(delta);
  return deltas;
}

test("streams the reply's text from the default provider, dropping reasoning", async () => {
  const { chat, requests } = chatWith(() =>
    sse([
      { reasoning_content: "Thinking about it" },
      { content: "Try " },
      { content: "`\\d+`" },
    ]),
  );
  expect(await collect(chat.text)).toEqual(["Try ", "`\\d+`"]);
  expect(await chat.done).toBe("Try `\\d+`");
  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe(`${BASE_URL}/chat/completions`);
  expect(requests[0]?.headers.get("authorization")).toBe(`Bearer ${KEY}`);
  expect(JSON.parse(requests[0]?.body ?? "")).toMatchObject({
    model: "text-model",
  });
});

test("done gets the whole reply even when nobody reads the text", async () => {
  const { chat } = chatWith(() => sse([{ content: "a" }, { content: "b" }]));
  expect(await chat.done).toBe("ab");
});

test("a chosen provider and model is used instead of the default", async () => {
  const { chat, requests } = chatWith(() => sse([{ content: "ok" }]), {
    ...request,
    model: { kind: "chosen", provider: LOCAL, model: "vision-model" },
  });
  expect(await chat.done).toBe("ok");
  expect(JSON.parse(requests[0]?.body ?? "")).toMatchObject({
    model: "vision-model",
  });
});

test("no-provider when the Default AI Provider is none, without calling anyone", async () => {
  const { chat, requests } = chatWith(() => sse([]), request, {
    ...settings,
    defaultAiProvider: { kind: "none" },
  });
  await expect(chat.done).rejects.toMatchObject({
    failure: { code: "no-provider" },
  });
  await expect(collect(chat.text)).rejects.toMatchObject({
    failure: { code: "no-provider" },
  });
  expect(requests).toEqual([]);
});

test("provider-missing when the chosen provider or model is not there: no fallback", async () => {
  for (const model of [
    { kind: "chosen", provider: parseAiProviderLabel("Gone"), model: "x" },
    { kind: "chosen", provider: LOCAL, model: "gone-model" },
  ] as const) {
    const { chat, requests } = chatWith(() => sse([]), { ...request, model });
    await expect(chat.done).rejects.toMatchObject({
      failure: { code: "provider-missing" },
    });
    expect(requests).toEqual([]);
  }
});

test("provider-rejected carries the HTTP status, and logs only the label and status", async () => {
  const { chat, events, requests } = chatWith(
    () => new Response(`{"error":{"message":"bad key"}}`, { status: 401 }),
  );
  await expect(chat.done).rejects.toMatchObject({
    failure: { code: "provider-rejected", status: 401 },
  });
  // No retry: one call, one hub.log line.
  expect(requests).toHaveLength(1);
  expect(events).toEqual([
    {
      kind: "ai-provider-call-failed",
      provider: LOCAL,
      outcome: { kind: "http-status", status: 401 },
    },
  ]);
  const logged = JSON.stringify(events);
  for (const secret of [KEY, BASE_URL, "models.example", PROMPT, "bad key"]) {
    expect(logged).not.toContain(secret);
  }
});

test("provider-unreachable when the connection fails, logged as no response", async () => {
  const { chat, events } = chatWith(() => {
    // As Node's fetch fails on a refused connection.
    throw new TypeError("fetch failed", {
      cause: new Error("connect ECONNREFUSED 127.0.0.1:9"),
    });
  });
  await expect(chat.done).rejects.toMatchObject({
    failure: { code: "provider-unreachable" },
  });
  expect(events).toEqual([
    {
      kind: "ai-provider-call-failed",
      provider: LOCAL,
      outcome: { kind: "no-response" },
    },
  ]);
});

test("an image for a model that does not accept images is refused before the call", async () => {
  const withImage: AiChatRequest = {
    ...request,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "image", image: new Uint8Array([1]), mediaType: "image/png" },
        ],
      },
    ],
  };
  let called = false;
  expect(() =>
    chatWith(() => {
      called = true;
      return sse([{ content: "no" }]);
    }, withImage),
  ).toThrow(/does not accept images/);
  expect(called).toBe(false);

  const accepted = chatWith(() => sse([{ content: "yes" }]), {
    ...withImage,
    model: { kind: "chosen", provider: LOCAL, model: "vision-model" },
  });
  expect(await accepted.chat.done).toBe("yes");
});

test("cancel stops the stream, and done keeps what had arrived", async () => {
  let push: (line: string) => void = () => undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (line) => {
        controller.enqueue(new TextEncoder().encode(line));
      };
    },
  });
  const { chat } = chatWith(
    () =>
      new Response(body, { headers: { "content-type": "text/event-stream" } }),
  );
  const text = chat.text[Symbol.asyncIterator]();
  push(chunk({ content: "first" }, null));
  expect(await text.next()).toEqual({ done: false, value: "first" });
  chat.cancel();
  expect(await chat.done).toBe("first");
});

test("providers lists labels, kinds and models, never a key or Base URL", () => {
  expect(aiProvidersOf(settings)).toEqual([
    {
      label: LOCAL,
      kind: "openai-compatible",
      models: [
        { id: "text-model", acceptsImages: false },
        { id: "vision-model", acceptsImages: true },
      ],
    },
  ]);
});
