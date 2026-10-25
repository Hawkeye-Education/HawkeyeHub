import { join } from "node:path";
import { defineConfig } from "electron-vite";
import { build, type Plugin, type Rollup } from "vite";

const HUB_KIT = join(import.meta.dirname, "src/hub-kit");
const COMPONENTS_ID = "virtual:hub-kit-components";

/**
 * `virtual:hub-kit-components`: the Hub Kit's components bundled, Lit with them, into one script's
 * source, which the sandboxed Plugin preload runs in the page's world (src/preload/plugin.ts).
 */
function hubKitComponents(): Plugin {
  return {
    name: "hub-kit-components",
    resolveId: (source) =>
      source === COMPONENTS_ID ? `\0${COMPONENTS_ID}` : null,
    async load(resolved) {
      if (resolved !== `\0${COMPONENTS_ID}`) return null;
      // write: false builds in memory; one lib format gives one output, never a watcher.
      const built = (await build({
        configFile: false,
        logLevel: "warn",
        build: {
          write: false,
          minify: true,
          lib: {
            entry: join(HUB_KIT, "components.ts"),
            formats: ["iife"],
            name: "hubKit",
          },
        },
        // build() is typed as one output, an array or a watcher; a lib build makes rollup's output
        // an array (one per format) and returns an array, and no watch is set (read in Vite 7.3's
        // resolveBuildOutputs and build; the Hub Kit smoke tests load what it gives).
      })) as Rollup.RollupOutput[];
      const chunk = built[0]?.output[0];
      if (chunk === undefined) throw new Error("The Hub Kit built nothing");
      // So `pnpm dev` rebuilds the preload when the components change.
      this.addWatchFile(join(HUB_KIT, "components.ts"));
      this.addWatchFile(join(HUB_KIT, "native.css"));
      return `export default ${JSON.stringify(chunk.code)};`;
    },
  };
}

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
      plugins: [hubKitComponents()],
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
