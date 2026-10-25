// `hub.ai` (#107): a Plugin UI lists the AI Providers and streams a chat from a local fake
// OpenAI-compatible server, cancels one, and has one cancelled by closing. A 401 and a refused
// connection each write one hub.log line. Each branch of the call module is a Vitest test.

import { createServer } from "node:net";
import { _electron } from "@playwright/test";
import { startFakeAiServer, writeAiProviders } from "./fake-ai-server";
import {
  displayLanguageOf,
  expect,
  fixtureInstall,
  HUB_DIR,
  hubEnv,
  hubLogLines,
  installFixturePlugins,
  pluginPage,
  pluginPages,
  test,
} from "./hub";

interface AiChat {
  text: AsyncIterable<string>;
  done: Promise<string>;
  cancel(): void;
}
type Model =
  { kind: "default" } | { kind: "chosen"; provider: string; model: string };

// The page's globals, for code evaluated in it.
declare const window: {
  hub: {
    ai: {
      providers(): Promise<unknown>;
      chat(request: {
        model: Model;
        system: string;
        messages: { role: "user"; content: { type: "text"; text: string }[] }[];
      }): AiChat;
    };
  };
  held: AiChat;
  heldFirst: string;
};

/** A port nothing listens on, so connecting to it is refused. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("A TCP server has a port");
  }
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

test("a Plugin UI lists providers, streams, cancels and is cancelled by closing; failures log one line each", async ({
  dataDir,
}) => {
  const fake = await startFakeAiServer({
    kind: "reply",
    deltas: ["Hello", " there"],
  });
  const models = [{ id: "fake-model", inputs: [] }];
  writeAiProviders(dataDir, [
    { label: "Fake", baseUrl: fake.baseUrl, models },
    {
      label: "Offline",
      baseUrl: `http://127.0.0.1:${String(await closedPort())}/v1`,
      models,
    },
  ]);
  installFixturePlugins(dataDir, [fixtureInstall("attendance")]);
  const hub = await _electron.launch({ args: [HUB_DIR], env: hubEnv(dataDir) });
  try {
    const hubChrome = await hub.firstWindow();
    const language = await displayLanguageOf(hubChrome);
    const name = language === "zh-HK" ? "點名" : "Attendance";
    await hubChrome.getByRole("button", { name, exact: true }).click();
    const page = await pluginPage(() => hub.windows(), "attendance");

    expect(await page.evaluate(() => window.hub.ai.providers())).toEqual([
      { label: "Fake", kind: "openai-compatible", models },
      { label: "Offline", kind: "openai-compatible", models },
    ]);

    expect(
      await page.evaluate(async () => {
        const chat = window.hub.ai.chat({
          model: { kind: "default" },
          system: "You advise.",
          messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
        });
        const deltas: string[] = [];
        for await (const delta of chat.text) deltas.push(delta);
        return { deltas, done: await chat.done };
      }),
    ).toEqual({ deltas: ["Hello", " there"], done: "Hello there" });
    expect(fake.requests[0]).toMatchObject({
      model: "fake-model",
      messages: [
        { role: "system", content: "You advise." },
        { role: "user", content: "Hi" },
      ],
    });

    // Cancelled from the page: done keeps what had arrived, and the stream closes.
    fake.answer = { kind: "held", deltas: ["Partial"] };
    const startHeld = () =>
      page.evaluate(async () => {
        window.held = window.hub.ai.chat({
          model: { kind: "default" },
          system: "",
          messages: [{ role: "user", content: [{ type: "text", text: "Go" }] }],
        });
        const first = await window.held.text[Symbol.asyncIterator]().next();
        window.heldFirst = String(first.value);
      });
    await startHeld();
    expect(fake.openStreams()).toBe(1);
    expect(
      await page.evaluate(() => {
        window.held.cancel();
        return window.held.done;
      }),
    ).toBe("Partial");
    await expect.poll(() => fake.openStreams()).toBe(0);

    const failure = (provider: string) =>
      page.evaluate(
        (chosen) =>
          window.hub.ai
            .chat({
              model: { kind: "chosen", provider: chosen, model: "fake-model" },
              system: "",
              messages: [
                { role: "user", content: [{ type: "text", text: "Hi" }] },
              ],
            })
            .done.then(
              () => "resolved",
              (error: unknown) => error,
            ),
        provider,
      );
    fake.answer = { kind: "status", status: 401 };
    expect(await failure("Fake")).toEqual({
      code: "provider-rejected",
      status: 401,
    });
    expect(await failure("Offline")).toEqual({ code: "provider-unreachable" });
    expect(await failure("Gone")).toEqual({ code: "provider-missing" });

    // Closing the Plugin cancels its open chat.
    fake.answer = { kind: "held", deltas: ["Partial"] };
    await startHeld();
    expect(fake.openStreams()).toBe(1);
    await hubChrome
      .getByRole("button", {
        name: language === "zh-HK" ? `關閉 ${name}` : `Close ${name}`,
        exact: true,
      })
      .click();
    await expect
      .poll(() => pluginPages(hub.windows(), "attendance"))
      .toEqual([]);
    await expect.poll(() => fake.openStreams()).toBe(0);
  } finally {
    await hub.close();
    await fake.close();
  }
  expect(
    hubLogLines(dataDir).filter(
      (line) =>
        typeof line === "object" &&
        line !== null &&
        "message" in line &&
        String(line.message).startsWith("AI Provider call failed"),
    ),
  ).toEqual([
    expect.objectContaining({
      level: "warn",
      message: "AI Provider call failed: Fake returned HTTP 401",
    }),
    expect.objectContaining({
      level: "warn",
      message: "AI Provider call failed: Offline gave no response",
    }),
  ]);
});
