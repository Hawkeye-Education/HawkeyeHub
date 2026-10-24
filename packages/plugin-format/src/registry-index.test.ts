import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { expect, test } from "vitest";
import { eraserManifest } from "./fixture-plugin";
import {
  RegistryIndex,
  registryIndexFrom,
  type PluginRelease,
} from "./registry-index";

const DOWNLOAD =
  "https://github.com/Hawkeye-Education/HawkeyeHub/releases/download";

function release(version: string): PluginRelease {
  const tag = `plugin/pdf-watermark-eraser@${version}`;
  return {
    tag,
    packageUrl: `${DOWNLOAD}/${encodeURIComponent(tag)}/pdf-watermark-eraser-${version}.zip`,
    iconUrl: `${DOWNLOAD}/${encodeURIComponent(tag)}/icon.svg`,
    packageZip: zipSync({
      "manifest.json": strToU8(
        JSON.stringify({ ...eraserManifest(), version }),
      ),
      "icon.svg": strToU8("<svg/>"),
    }),
  };
}

test("index.json lists every release, newest first, and the Hub's RegistryIndex parses it", () => {
  const one = release("1.0.0");

  const index = registryIndexFrom([one, release("1.1.0")]);

  const parsed = RegistryIndex.parse(JSON.parse(index));
  expect(Object.keys(parsed.plugins)).toEqual(["pdf-watermark-eraser"]);
  const entries = Object.values(parsed.plugins)[0];
  expect(entries?.map((entry) => entry.url)).toEqual([
    `${DOWNLOAD}/plugin%2Fpdf-watermark-eraser%401.1.0/pdf-watermark-eraser-1.1.0.zip`,
    `${DOWNLOAD}/plugin%2Fpdf-watermark-eraser%401.0.0/pdf-watermark-eraser-1.0.0.zip`,
  ]);
  expect(entries?.[1]).toEqual({
    manifest: eraserManifest(),
    url: one.packageUrl,
    sha256: createHash("sha256").update(one.packageZip).digest("hex"),
    iconUrl: one.iconUrl,
  });
});

test("the same releases in any order give the same index.json", () => {
  const releases = [release("1.0.0"), release("2.0.0"), release("1.10.0")];

  expect(registryIndexFrom(releases)).toBe(
    registryIndexFrom([...releases].reverse()),
  );
});

test("a release whose tag disagrees with its packed Manifest is refused", () => {
  const bad = { ...release("1.0.0"), tag: "plugin/pdf-watermark-eraser@1.0.1" };

  expect(() => registryIndexFrom([bad])).toThrow(
    "plugin/pdf-watermark-eraser@1.0.1 holds pdf-watermark-eraser 1.0.0",
  );
});

test("a release whose package has an invalid Manifest is refused", () => {
  const bad = {
    ...release("1.0.0"),
    packageZip: zipSync({ "manifest.json": strToU8('{"id": "x"}') }),
  };

  expect(() => registryIndexFrom([bad])).toThrow(
    "plugin/pdf-watermark-eraser@1.0.0 has an invalid manifest.json",
  );
});
