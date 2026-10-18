import { join } from "node:path";
import { defineConfig } from "electron-vite";

// The default entries: src/main/index.ts and src/renderer/index.html. No preload yet.
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
  return { main: {}, renderer: {} };
});
