// Plugin icons for the Hub Chrome (spec #44 story 53). A read-only scheme on the Hub Chrome's
// session serves each installed Plugin's `icon.svg` and nothing else. The Hub Chrome draws it as a
// CSS mask, so Plugin SVG is never parsed into the Hub Chrome's page and its scripts never run.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginId } from "@hawkeye-hub/plugin-format";
import type { InstalledPlugin } from "./installed-plugins";
import type { RegistryFetch } from "./registry";

export const PLUGIN_ICON_SCHEME = "hawkeye-icon";

export function pluginIconUrl(id: PluginId): string {
  return `${PLUGIN_ICON_SCHEME}://${id}/icon.svg`;
}

/** The icon the Registry offers for Plugin `id`, which the Plugin Catalogue shows. */
export function registryIconUrl(id: PluginId): string {
  return `${PLUGIN_ICON_SCHEME}://${id}/registry.svg`;
}

/**
 * The scheme's handler. It answers only a GET of an installed Plugin's exact icon URL, or of the
 * exact Registry icon URL of a Plugin the latest Registry check offered, so no path can reach any
 * other file. `registryIcons` maps each `registryIconUrl` to the Registry's own icon URL, which is
 * fetched from main so the Hub Chrome's CSP stays closed to the web. Masks are fetched in CORS
 * mode, hence the CORS header.
 */
export function servePluginIcons(
  installed: readonly InstalledPlugin[],
  registryIcons: () => ReadonlyMap<string, string>,
  fetch: RegistryFetch,
): (request: Request) => Promise<Response> {
  const files = new Map(
    installed.map(({ folder, manifest }) => [
      pluginIconUrl(manifest.id),
      join(folder, "icon.svg"),
    ]),
  );
  const svg = (body: Buffer | ArrayBuffer): Response =>
    new Response(body, {
      headers: {
        "content-type": "image/svg+xml",
        "access-control-allow-origin": "*",
      },
    });
  return async (request) => {
    if (request.method !== "GET") return new Response(null, { status: 404 });
    const file = files.get(request.url);
    // A missing icon.svg rejects, which fails the request: the switcher then draws no icon.
    if (file !== undefined) return svg(await readFile(file));
    const remote = registryIcons().get(request.url);
    if (remote === undefined) return new Response(null, { status: 404 });
    // No response rejects, as a missing file does: the Catalogue then draws no icon.
    const response = await fetch(remote, {
      signal: AbortSignal.timeout(REGISTRY_ICON_TIMEOUT_MS),
    });
    if (!response.ok) return new Response(null, { status: 404 });
    return svg(await response.arrayBuffer());
  };
}

const REGISTRY_ICON_TIMEOUT_MS = 30_000;
