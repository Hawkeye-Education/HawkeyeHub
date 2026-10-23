// The Assistant Panel (#108) against a local fake OpenAI-compatible server: open a fixture Plugin
// with an Assistant, toggle its Panel (which narrows the Plugin UI), send a message, watch the
// reply stream and stop it, then get a Markdown reply and copy its code block. Each branch of the
// conversation is a Vitest test of the lifecycle.

import { startFakeAiServer, writeAiProviders } from "./fake-ai-server";
import {
  displayLanguageOf,
  expect,
  fixtureInstall,
  installFixturePlugins,
  launchHub,
  pluginPage,
  test,
} from "./hub";

// The page's globals, for code evaluated in it.
declare const window: { innerWidth: number };

const LABELS = {
  "en-HK": {
    plugin: "Regex Helper",
    assistant: "Assistant",
    message: "Message",
    send: "Send",
    stop: "Stop",
    copy: "Copy",
  },
  "zh-HK": {
    plugin: "正則助手",
    assistant: "助理",
    message: "訊息",
    send: "傳送",
    stop: "停止",
    copy: "複製",
  },
};

test("the Assistant Panel streams a Markdown reply, stops one, and copies a code block", async ({
  dataDir,
}) => {
  const fake = await startFakeAiServer({ kind: "held", deltas: ["Thinking"] });
  writeAiProviders(dataDir, [
    {
      label: "Fake",
      baseUrl: fake.baseUrl,
      models: [{ id: "fake-model", acceptsImages: false }],
    },
  ]);
  installFixturePlugins(dataDir, [fixtureInstall("regex-helper")]);
  const hub = await launchHub(dataDir);
  try {
    const hubChrome = await hub.firstWindow();
    const labels = LABELS[await displayLanguageOf(hubChrome)];
    await hubChrome
      .getByRole("button", { name: labels.plugin, exact: true })
      .click();
    const page = await pluginPage(() => hub.windows(), "regex-helper");
    const fullWidth = await page.evaluate(() => window.innerWidth);

    const toggle = hubChrome.getByRole("button", {
      name: labels.assistant,
      exact: true,
    });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    // The Panel's ASSISTANT_PANEL_WIDTH_PX.
    await expect
      .poll(() => page.evaluate(() => window.innerWidth))
      .toBe(fullWidth - 400);

    const message = hubChrome.getByRole("textbox", { name: labels.message });
    await message.fill("Hi");
    await message.press("Enter");
    await expect(hubChrome.getByText("Thinking")).toBeVisible();
    // The context: the Hub preamble, assistant.md, then the Skill and its reference.
    expect(fake.requests[0]).toMatchObject({
      model: "fake-model",
      messages: [
        {
          role: "system",
          content: expect.stringMatching(
            /You advise.*draft regular expressions.*one regex in a fenced code block.*JavaScript regex syntax/s,
          ),
        },
        { role: "user", content: "Hi" },
      ],
    });
    await hubChrome.getByRole("button", { name: labels.stop }).click();
    await expect.poll(() => fake.openStreams()).toBe(0);
    await expect(
      hubChrome.getByRole("button", { name: labels.send }),
    ).toBeVisible();

    fake.answer = {
      kind: "reply",
      deltas: ["Try **this**:\n\n", "```\n^Page \\d+$\n```\n"],
    };
    await message.fill("A regex for page numbers, please");
    await hubChrome.getByRole("button", { name: labels.send }).click();
    await expect(
      hubChrome.locator("strong", { hasText: "this" }),
    ).toBeVisible();
    await expect(hubChrome.locator("pre code")).toHaveText("^Page \\d+$\n");
    // The second request carries the stopped reply.
    expect(fake.requests[1]).toMatchObject({
      messages: [
        { role: "system" },
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Thinking" },
        { role: "user", content: "A regex for page numbers, please" },
      ],
    });

    await hubChrome.getByRole("button", { name: labels.copy }).click();
    await expect
      .poll(() => hub.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe("^Page \\d+$");
  } finally {
    await hub.close();
    await fake.close();
  }
});
