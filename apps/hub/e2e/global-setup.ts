// Gives each fixture Backend the per-Plugin venv an install would build (ADR 0003): `uv venv`
// on the Manifest's Python, with no packages, since fixture Backends use the standard library
// only. Made once per run, inside the fixture, so installFixturePlugins copies it with the rest.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const FIXTURE_PLUGINS = join(import.meta.dirname, "fixtures", "plugins");

export default function globalSetup(): void {
  for (const fixture of readdirSync(FIXTURE_PLUGINS)) {
    const folder = join(FIXTURE_PLUGINS, fixture);
    if (!existsSync(join(folder, "backend"))) continue;
    // A fixture with a backend folder has a valid Manifest with a Python Backend. Not parsed
    // with plugin-format: Playwright's loader fails on semver's circular requires.
    const manifest = JSON.parse(
      readFileSync(join(folder, "manifest.json"), "utf8"),
    ) as { backend: { python: string } };
    const venv = join(folder, "backend", ".venv");
    // A fresh venv every run, so a stale one from another Python never lingers.
    rmSync(venv, { recursive: true, force: true });
    execFileSync(
      "uv",
      ["venv", "--quiet", "--python", manifest.backend.python, venv],
      { stdio: "inherit" },
    );
  }
}
