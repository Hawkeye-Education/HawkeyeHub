import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  // Not *.test.ts or *.spec.ts, so Vitest's default include leaves the smoke suite alone.
  testMatch: "**/*.smoke.ts",
  // Fixture Backends need their venvs (uv must be on PATH).
  globalSetup: "./e2e/global-setup.ts",
  // One Hub at a time keeps window focus predictable.
  workers: 1,
  forbidOnly: process.env["CI"] !== undefined,
});
