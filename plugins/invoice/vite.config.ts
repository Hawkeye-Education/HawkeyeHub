import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "ui-src",
  base: "./", // the Hub serves the UI from hawkeye-plugin://<id>/, so asset URLs must be relative
  build: { outDir: "../ui", emptyOutDir: true, target: "esnext" }, // one known Chromium; top-level await is fine
  // A Plugin UI test's environment (PLUGIN_STANDARD.md §9.1): window.hub lives on a DOM window.
  test: { environment: "happy-dom" },
});
