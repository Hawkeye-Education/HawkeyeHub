// Fixture Plugins for the check and pack tests: a Plugin is a map of POSIX paths to file contents.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export type PluginFiles = Record<string, string>;

/** PLUGIN_STANDARD.md §2's Eraser, with the development-only files `pack` must leave out. */
export function eraserPlugin(): PluginFiles {
  return {
    "manifest.json": JSON.stringify(eraserManifest()),
    "icon.svg":
      '<svg viewBox="0 0 24 24"><path stroke="currentColor" d="M0 0h24"/></svg>',
    "package.json": '{"name": "pdf-watermark-eraser", "private": true}',
    "vite.config.ts": "export default {};",
    "ui-src/main.ts": "export {};",
    "ui/index.html": "<!doctype html><title>Eraser</title>",
    "ui/assets/main.js": "console.log(1);",
    "backend/pyproject.toml": [
      "[project]",
      'name = "pdf-watermark-eraser"',
      'version = "1.0.0"',
      'requires-python = ">=3.12"',
    ].join("\n"),
    "backend/uv.lock": "version = 1",
    "backend/main.py": "print(1)",
    "backend/erase.py": "print(2)",
    "backend/tests/test_erase.py": "def test_x() -> None: ...",
    "backend/.venv/pyvenv.cfg": "home = x",
    "backend/__pycache__/erase.cpython-312.pyc": "x",
    "backend/.pytest_cache/README.md": "x",
    "backend/.ruff_cache/x": "x",
    "agents/assistant.md": "You help staff erase watermarks.",
    "agents/skills/draft-regex/SKILL.md": [
      "---",
      "name: draft-regex",
      "description: Draft a Python regex that matches only a watermark.",
      "---",
      "Draft the regex.",
    ].join("\n"),
  };
}

export function eraserManifest(): Record<string, unknown> {
  return {
    id: "pdf-watermark-eraser",
    version: "1.0.0",
    hubApi: "^1.3.0",
    name: { "en-HK": "PDF Watermark Eraser", "zh-HK": "PDF 水印清除" },
    description: "Remove a text watermark from every PDF in a folder.",
    platforms: ["win32-x64", "darwin-arm64"],
    identity: { kind: "none" },
    stores: [],
    backend: { kind: "python", python: "3.12" },
    assistant: {
      kind: "enabled",
      templates: [{ label: "Draft a watermark regex", text: "Draft a regex." }],
    },
  };
}

/** `files` written into a new temporary folder, which is returned. */
export function writePlugin(files: PluginFiles): string {
  const dir = mkdtempSync(join(tmpdir(), "plugin-format-"));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), contents);
  }
  return dir;
}
