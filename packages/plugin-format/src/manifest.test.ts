import { expect, test } from "vitest";
import { parseManifest } from "./manifest";

// PLUGIN_STANDARD.md §3's example.
function eraserManifest(): Record<string, unknown> {
  return {
    id: "pdf-watermark-eraser",
    version: "1.0.0",
    hubApi: "^1.0.0",
    name: { "en-HK": "PDF Watermark Eraser", "zh-HK": "PDF 水印清除" },
    description: {
      "en-HK": "Remove a text watermark from every PDF in a folder.",
      "zh-HK": "移除資料夾內所有 PDF 的文字水印。",
    },
    platforms: ["win32-x64", "darwin-arm64"],
    identity: { kind: "none" },
    stores: [],
    backend: { kind: "python", python: "3.12" },
    assistant: {
      kind: "enabled",
      templates: [
        {
          label: { "en-HK": "Draft a watermark regex" },
          text: "Draft a Python regex for this page text.",
        },
      ],
    },
  };
}

test("a valid Manifest parses", () => {
  const result = parseManifest(eraserManifest());

  expect(result).toEqual({ kind: "valid", manifest: eraserManifest() });
});

function expectInvalid(json: unknown, reasonMentions: string): void {
  const result = parseManifest(json);
  if (result.kind !== "invalid") {
    throw new Error(`expected invalid, got ${JSON.stringify(result)}`);
  }
  expect(result.reason).toContain(reasonMentions);
}

test.each([
  "id",
  "version",
  "hubApi",
  "name",
  "description",
  "platforms",
  "identity",
  "stores",
  "backend",
  "assistant",
])("a Manifest missing %s is refused", (field) => {
  const manifest = Object.fromEntries(
    Object.entries(eraserManifest()).filter(([key]) => key !== field),
  );

  expectInvalid(manifest, field);
});

test.each([
  ["the top level", { permissions: [] }, "permissions"],
  ["identity", { identity: { kind: "none", roles: [] } }, "roles"],
  [
    "backend",
    { backend: { kind: "python", python: "3.12", entry: "app.py" } },
    "entry",
  ],
  [
    "a Prompt Template",
    {
      assistant: {
        kind: "enabled",
        templates: [{ label: "Draft", text: "Draft it", icon: "pen" }],
      },
    },
    "icon",
  ],
  ["display text", { name: { "en-HK": "Eraser", colour: "red" } }, "colour"],
])("an unknown key in %s is refused", (_where, change, key) => {
  expectInvalid({ ...eraserManifest(), ...change }, key);
});

test.each(["identity", "backend", "assistant"])(
  "an unknown %s kind is refused",
  (field) => {
    expectInvalid(
      { ...eraserManifest(), [field]: { kind: "optional" } },
      field,
    );
  },
);

test("display text accepts a plain English string", () => {
  const manifest = { ...eraserManifest(), name: "PDF Watermark Eraser" };

  expect(parseManifest(manifest)).toEqual({ kind: "valid", manifest });
});

test("display text accepts a map holding only en-HK", () => {
  const manifest = {
    ...eraserManifest(),
    name: { "en-HK": "PDF Watermark Eraser" },
  };

  expect(parseManifest(manifest)).toEqual({ kind: "valid", manifest });
});

test("display text refuses a map without en-HK", () => {
  expectInvalid(
    { ...eraserManifest(), name: { "zh-HK": "PDF 水印清除" } },
    "en-HK",
  );
});

test("display text refuses an unknown tag, even a near miss", () => {
  expectInvalid(
    {
      ...eraserManifest(),
      description: { "en-HK": "Eraser", "zh-TW": "清除" },
    },
    "zh-TW",
  );
});
