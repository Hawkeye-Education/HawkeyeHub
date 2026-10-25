import { defineConfig } from "vitest/config";

// A Plugin UI test's environment (PLUGIN_STANDARD.md §9.1): window.hub lives on a DOM window.
export default defineConfig({ test: { environment: "happy-dom" } });
