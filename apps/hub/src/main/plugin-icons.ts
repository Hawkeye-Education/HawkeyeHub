// Plugin icons for the Hub Chrome (spec #44 story 53). A read-only scheme on the Hub Chrome's
// session serves each installed Plugin's `icon.svg` and nothing else. The Hub Chrome draws it as a
// CSS mask, so Plugin SVG is never parsed into the Hub Chrome's page and its scripts never run.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { InstalledPlugin } from "./installed-plugins";

export const PLUGIN_ICON_SCHEME = "hawkeye-icon";

export function pluginIconUrl(id: string): string {
  return `${PLUGIN_ICON_SCHEME}://${id}/icon.svg`;
}

/**
 * The scheme's handler. It answers only a GET of an installed Plugin's exact icon URL, so no path
 * can reach any other file. Masks are fetched in CORS mode, hence the CORS header.
 */
export function servePluginIcons(
  installed: readonly InstalledPlugin[],
): (request: Request) => Promise<Response> {
  const files = new Map(
    installed.map(({ folder, manifest }) => [
      pluginIconUrl(manifest.id),
      join(folder, "icon.svg"),
    ]),
  );
  return async (request) => {
    const file = files.get(request.url);
    if (request.method !== "GET" || file === undefined) {
      return new Response(null, { status: 404 });
    }
    // A missing icon.svg rejects, which fails the request: the switcher then draws no icon.
    return new Response(await readFile(file), {
      headers: {
        "content-type": "image/svg+xml",
        "access-control-allow-origin": "*",
      },
    });
  };
}
