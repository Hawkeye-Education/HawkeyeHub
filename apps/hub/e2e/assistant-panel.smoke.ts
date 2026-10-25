// The Assistant Panel (#108) against a local fake OpenAI-compatible server: open a fixture Plugin
// with an Assistant, toggle its Panel (which narrows the Plugin UI), send a message, watch the
// reply stream and stop it, then get a Markdown reply and copy its code block. Each branch of the
// conversation is a Vitest test of the lifecycle. Then the composer (#110): a Prompt Template, and
// images and a long text pasted from the system clipboard. Last, the model picker (#109) saves its
// choice at once.

import type { ElectronApplication } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
    model: "Model",
    pastedImage: "Pasted image",
    pastedText: "Pasted text",
    remove: "Remove",
  },
  "zh-HK": {
    plugin: "正則助手",
    assistant: "助理",
    message: "訊息",
    send: "傳送",
    stop: "停止",
    copy: "複製",
    model: "模型",
    pastedImage: "已貼上的圖片",
    pastedText: "已貼上的文字",
    remove: "移除",
  },
};

type Clip = "image" | { text: string };

/** Puts a 1×1 PNG, or this text, on the system clipboard. */
async function copy(hub: ElectronApplication, clip: Clip) {
  await hub.evaluate(
    ({ clipboard, ClipboardItem }, clip) =>
      clip === "image"
        ? clipboard.write([
            new ClipboardItem({
              "image/png": new Blob(
                [
                  Buffer.from(
                    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                    "base64",
                  ),
                ],
                { type: "image/png" },
              ),
            }),
          ])
        : clipboard.writeText(clip.text),
    clip,
  );
}

test("the Assistant Panel streams a Markdown reply, stops one, and copies a code block", async ({
  dataDir,
}) => {
  const fake = await startFakeAiServer({ kind: "held", deltas: ["Thinking"] });
  writeAiProviders(dataDir, [
    {
      label: "Fake",
      baseUrl: fake.baseUrl,
      models: [{ id: "fake-model", inputs: [] }],
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

    // This model does not accept images: a pasted one adds no chip, and pasted text still lands.
    await copy(hub, "image");
    await message.press("ControlOrMeta+V");
    await copy(hub, { text: "after" });
    await message.press("ControlOrMeta+V");
    await expect(message).toHaveValue("after");
    await expect(
      hubChrome.getByRole("img", { name: labels.pastedImage }),
    ).toHaveCount(0);

    await hubChrome
      .getByRole("combobox", { name: labels.model })
      .selectOption({ label: "Fake · fake-model" });
    await expect
      .poll((): unknown =>
        JSON.parse(
          readFileSync(join(dataDir, "assistant-models.json"), "utf8"),
        ),
      )
      .toEqual({
        "regex-helper": {
          kind: "chosen",
          provider: "Fake",
          model: "fake-model",
        },
      });
  } finally {
    await hub.close();
    await fake.close();
  }
});

test("the composer sends a Prompt Template, then a pasted image and a long paste as chips", async ({
  dataDir,
}) => {
  const fake = await startFakeAiServer({ kind: "reply", deltas: ["Done"] });
  writeAiProviders(dataDir, [
    {
      label: "Fake",
      baseUrl: fake.baseUrl,
      models: [{ id: "fake-vision", inputs: ["image"] }],
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
    await hubChrome
      .getByRole("button", { name: labels.assistant, exact: true })
      .click();
    const message = hubChrome.getByRole("textbox", { name: labels.message });

    // The fixture's one template: picking it fills the composer and sends nothing.
    await hubChrome.getByRole("button", { name: "Draft a regex" }).click();
    const template = "Draft a regex that matches <paste page text here>";
    await expect(message).toHaveValue(template);
    expect(fake.requests).toHaveLength(0);
    await message.press("Enter");
    await expect(hubChrome.getByText("Done")).toBeVisible();
    expect(fake.requests[0]).toMatchObject({
      messages: [{ role: "system" }, { role: "user", content: template }],
    });

    const paste = async (clip: Clip) => {
      await copy(hub, clip);
      await message.press("ControlOrMeta+V");
    };
    const composer = hubChrome.locator("form");
    const image = composer.getByRole("img", { name: labels.pastedImage });
    await paste("image");
    await expect(image).toBeVisible();
    // A chip comes off with its Remove button.
    await composer.getByRole("button", { name: labels.remove }).click();
    await expect(image).toHaveCount(0);
    await paste("image");
    await expect(image).toBeVisible();

    const long = "page text ".repeat(120);
    await paste({ text: long });
    await expect(composer.getByText(labels.pastedText)).toBeVisible();
    await expect(message).toHaveValue("");
    await paste({ text: "Short" });
    await expect(message).toHaveValue("Short");

    await message.press("Enter");
    await expect.poll(() => fake.requests.length).toBe(2);
    expect(fake.requests[1]).toMatchObject({
      model: "fake-vision",
      messages: [
        { role: "system" },
        { role: "user", content: template },
        { role: "assistant", content: "Done" },
        {
          role: "user",
          content: [
            { type: "text", text: "Short" },
            {
              type: "image_url",
              image_url: {
                url: expect.stringMatching(/^data:image\/png;base64,/),
              },
            },
            { type: "text", text: long },
          ],
        },
      ],
    });
    // The sent message shows its image, and the composer is empty again.
    await expect(
      hubChrome
        .locator("li.user")
        .getByRole("img", { name: labels.pastedImage }),
    ).toBeVisible();
    await expect(image).toHaveCount(0);
    await expect(composer.getByText(labels.pastedText)).toHaveCount(0);
  } finally {
    await hub.close();
    await fake.close();
  }
});
