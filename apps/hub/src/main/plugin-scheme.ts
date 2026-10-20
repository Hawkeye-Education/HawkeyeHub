// `hawkeye-plugin://<id>/`: each Plugin UI's own origin, serving only its `ui/` folder (spec #44).
// Registered on each Plugin's partition only, so no other page can load from it.

import { relative, resolve, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginId } from "@hawkeye-hub/plugin-format";
import { net, type Session } from "electron";

/** Its privileges are granted in index.ts, in the Hub's one registerSchemesAsPrivileged call. */
export const PLUGIN_SCHEME = "hawkeye-plugin";

/**
 * The file in `uiDir` that `url` names, or null when the URL is not on `id`'s host or would leave
 * `uiDir`: a refusal is a real answer here, served as 404.
 */
export function uiFileFor(
  uiDir: string,
  id: PluginId,
  url: string,
): string | null {
  const parsed = new URL(url);
  if (parsed.host !== id) return null;
  // Decoded after the URL parser has collapsed `..`, so encoded separators and dots are caught
  // by the containment check below rather than by the parser.
  const file = resolve(uiDir, `.${decodeURIComponent(parsed.pathname)}`);
  const inside = relative(uiDir, file);
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside))
    return null;
  return file;
}

/** Serves `uiDir` as `hawkeye-plugin://<id>/` on `session`, once per session per Hub run. */
export function servePluginUi(
  session: Session,
  id: PluginId,
  uiDir: string,
): void {
  // The partition's session outlives a close, so a reopen finds the scheme already handled.
  if (session.protocol.isProtocolHandled(PLUGIN_SCHEME)) return;
  session.protocol.handle(PLUGIN_SCHEME, (request) => {
    const file = uiFileFor(uiDir, id, request.url);
    if (file === null) return new Response(null, { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}
