import { join } from "node:path";
import { defineConfig } from "electron-vite";

// The default entries: src/main/index.ts and src/renderer/index.html. Preloads are named entries.
export default defineConfig(({ command }) => {
  // `pnpm dev` keeps the Hub's on-disk state in a gitignored folder, so the OS default folders stay
  // untouched and the smoke test that guards them keeps checking. electron-vite spawns Electron
  // with this process's environment.
  if (command === "serve") {
    process.env["HAWKEYE_HUB_DATA_DIR"] ??= join(
      import.meta.dirname,
      ".hub-data",
    );
  }
  return {
    main: {},
    preload: {
      build: {
        rollupOptions: {
          input: {
            "hub-chrome": join(
              import.meta.dirname,
              "src/preload/hub-chrome.ts",
            ),
            plugin: join(import.meta.dirname, "src/preload/plugin.ts"),
          },
          // A sandboxed preload runs as a plain script, never as ESM, and this package is
          // "type": "module", so the output must be CommonJS with a .cjs name.
          output: { format: "cjs", entryFileNames: "[name].cjs" },
        },
      },
    },
    renderer: {},
  };
});
