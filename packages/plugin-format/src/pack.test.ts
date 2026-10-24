import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { unzipSync } from "fflate";
import { expect, test } from "vitest";
import { eraserPlugin, writePlugin } from "./fixture-plugin";
import { packPlugin } from "./pack";

test("pack zips exactly the Plugin Package's paths and reports its sha256", () => {
  const outDir = writePlugin({});

  const { file, sha256 } = packPlugin(writePlugin(eraserPlugin()), outDir);

  expect(basename(file)).toBe("pdf-watermark-eraser-1.0.0.zip");
  const zip = readFileSync(file);
  expect(Object.keys(unzipSync(zip)).sort()).toEqual([
    "agents/assistant.md",
    "agents/skills/draft-regex/SKILL.md",
    "backend/erase.py",
    "backend/main.py",
    "backend/pyproject.toml",
    "backend/uv.lock",
    "icon.svg",
    "manifest.json",
    "ui/assets/main.js",
    "ui/index.html",
  ]);
  expect(sha256).toBe(createHash("sha256").update(zip).digest("hex"));
});
