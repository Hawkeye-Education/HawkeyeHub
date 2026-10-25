/// <reference types="electron-vite/node" />
// `hawkeye-hub-kit://fonts/<file>`: the Hawkeye Theme's fonts (ADR 0006), from the Hub's own build
// output, so a packaged Hub serves them offline from its bundle. The Plugin preload's stylesheet
// names them (src/hub-kit/hawkeye.css). Registered on each Plugin's partition, and on the Hub
// Chrome's default session.

import { readFile } from "node:fs/promises";
import type { Session } from "electron";
import inter from "../hub-kit/fonts/Inter.woff2?asset";
import notoSansTc from "../hub-kit/fonts/NotoSansTC.woff2?asset";

/** A view or window background that shows what is behind it. */
export const TRANSPARENT = "#00000000";

/**
 * The Hawkeye Theme's solid tint, which the window shows behind every view where the OS has no
 * material (ADR 0006). Main paints it, so it lives here rather than in hawkeye.css. Light is the
 * middle of `prototype/hawkeye-theme`'s gradient; dark is "Near-black" (#145).
 */
export const HAWKEYE_TINT = { light: "#f3ece5", dark: "#0c0c0c" } as const;

/** Its privileges are granted in index.ts, in the Hub's one registerSchemesAsPrivileged call. */
export const HUB_KIT_SCHEME = "hawkeye-hub-kit";

const FONTS: ReadonlyMap<string, string> = new Map([
  [`${HUB_KIT_SCHEME}://fonts/Inter.woff2`, inter],
  [`${HUB_KIT_SCHEME}://fonts/NotoSansTC.woff2`, notoSansTc],
]);

/** Serves the fonts on `session`; a session keeps its handler across opens. */
export function serveHubKit(session: Session): void {
  if (session.protocol.isProtocolHandled(HUB_KIT_SCHEME)) return;
  session.protocol.handle(HUB_KIT_SCHEME, async ({ url }) => {
    const file = FONTS.get(url);
    if (file === undefined) return new Response(null, { status: 404 });
    // Fonts are fetched in CORS mode from the Plugin's own origin, hence the CORS header.
    return new Response(await readFile(file), {
      headers: {
        "content-type": "font/woff2",
        "access-control-allow-origin": "*",
      },
    });
  });
}
