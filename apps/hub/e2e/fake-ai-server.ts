// A local stand-in for an OpenAI-compatible AI Provider, for smoke tests of `hub.ai` and the
// Assistant Panel: it answers POST `/chat/completions` with whatever `answer` says at the time.
// Point a provider's Base URL at `baseUrl`, with `writeAiProviders` below.

import { writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

export type FakeAiAnswer =
  /** Streams a reasoning chunk (which the Hub drops), then each delta, then finishes. */
  | { kind: "reply"; deltas: string[] }
  /** Streams the deltas, then holds the stream open until the Hub drops the connection. */
  | { kind: "held"; deltas: string[] }
  /** Answers with this HTTP status and an OpenAI-style error body. */
  | { kind: "status"; status: number };

export interface FakeAiServer {
  /** Such as `http://127.0.0.1:52321/v1`. */
  readonly baseUrl: string;
  /** What the next request gets. */
  answer: FakeAiAnswer;
  /** Each request's parsed JSON body, in order: the model, messages and system prompt sent. */
  readonly requests: unknown[];
  /** How many streams are open now: a `held` answer stays open until the Hub cancels it. */
  openStreams(): number;
  close(): Promise<void>;
}

function chunk(delta: object, finishReason: "stop" | null): string {
  const body = {
    id: "fake",
    created: 0,
    model: "fake-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
  return `data: ${JSON.stringify(body)}\n\n`;
}

export async function startFakeAiServer(
  answer: FakeAiAnswer,
): Promise<FakeAiServer> {
  const requests: unknown[] = [];
  const open = new Set<ServerResponse>();
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (data: string) => {
      body += data;
    });
    request.on("end", () => {
      requests.push(JSON.parse(body));
      const now = fake.answer;
      if (now.kind === "status") {
        response.writeHead(now.status, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "fake refusal" } }));
        return;
      }
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(chunk({ reasoning_content: "Fake reasoning" }, null));
      for (const delta of now.deltas) {
        response.write(chunk({ content: delta }, null));
      }
      if (now.kind === "reply") {
        response.end(`${chunk({}, "stop")}data: [DONE]\n\n`);
        return;
      }
      open.add(response);
      response.on("close", () => open.delete(response));
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  const fake: FakeAiServer = {
    baseUrl: `http://127.0.0.1:${String(port)}/v1`,
    answer,
    requests,
    openStreams: () => open.size,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      }),
  };
  return fake;
}

export interface FakeProvider {
  label: string;
  baseUrl: string;
  models: { id: string; acceptsImages: boolean }[];
}

/**
 * Writes Hub Settings with these openai-compatible providers, and the first one's first model as
 * the Default AI Provider, before the Hub starts. No keys: the fake server wants none.
 */
export function writeAiProviders(
  dataDir: string,
  providers: FakeProvider[],
): void {
  const [first] = providers;
  const settings = {
    theme: { kind: "company" },
    colourScheme: "system",
    displayLanguage: { kind: "system" },
    aiProviders: providers.map(({ label, baseUrl, models }) => ({
      label,
      endpoint: { kind: "openai-compatible", baseUrl },
      models,
    })),
    defaultAiProvider:
      first?.models[0] === undefined
        ? { kind: "none" }
        : { kind: "chosen", provider: first.label, model: first.models[0].id },
  };
  // The Hub's SETTINGS_FILE (src/main/hub-settings.ts).
  writeFileSync(join(dataDir, "hub-settings.json"), JSON.stringify(settings));
}
