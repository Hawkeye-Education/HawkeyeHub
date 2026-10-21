// How the Hub was started: as installed, or in dev mode (PLUGIN_STANDARD §9.4), running Plugins
// named on the command line. Parsed once, at the top of the main process.

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { PluginId } from "@hawkeye-hub/plugin-format";
import { parseAbsolutePath, type AbsolutePath } from "./ids";

export type HubMode =
  | { kind: "installed" }
  /** Each id's Plugin is the folder `<pluginsDir>/<id>`. */
  | { kind: "dev"; pluginsDir: AbsolutePath; ids: PluginId[] };

/**
 * Dev mode is at least one `--plugin <id>` in an unpackaged Hub, with `--plugins-dir <folder>`
 * resolved against `cwd`. A packaged Hub ignores both, so staff can never side-load a Plugin.
 * A malformed dev-mode command line throws with why.
 */
export function parseHubMode(
  argv: string[],
  isPackaged: boolean,
  cwd: AbsolutePath,
): HubMode {
  if (isPackaged) return { kind: "installed" };
  const { values } = parseArgs({
    args: argv,
    // Not strict: argv also holds Electron's binary, the app's folder and Chromium switches.
    strict: false,
    allowPositionals: true,
    options: {
      plugin: { type: "string", multiple: true },
      "plugins-dir": { type: "string" },
    },
  });
  const { plugin, "plugins-dir": pluginsDir } = values;
  if (plugin === undefined) return { kind: "installed" };
  if (typeof pluginsDir !== "string") {
    throw new Error("Dev mode needs --plugins-dir <folder>");
  }
  const ids: PluginId[] = [];
  for (const raw of plugin) {
    if (typeof raw !== "string") throw new Error("--plugin needs a Plugin id");
    const parsed = PluginId.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`Not a Plugin id: ${JSON.stringify(raw)}`);
    }
    if (ids.includes(parsed.data)) {
      throw new Error(`--plugin ${JSON.stringify(raw)} is named twice`);
    }
    ids.push(parsed.data);
  }
  return {
    kind: "dev",
    pluginsDir: parseAbsolutePath(resolve(cwd, pluginsDir)),
    ids,
  };
}
