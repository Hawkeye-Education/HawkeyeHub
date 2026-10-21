// ADR 0012: a Plugin UI stopped responding when its `webContents` stays `unresponsive` for
// `UNRESPONSIVE_GRACE_MS` without a `responsive`.

import { UNRESPONSIVE_GRACE_MS } from "./backend";

/** The `webContents` events this watches: Electron's, or any emitter of the same names. */
export interface ResponsivenessEvents {
  on(event: "unresponsive" | "responsive", listener: () => void): unknown;
  once(event: "destroyed", listener: () => void): unknown;
}

/** Calls `stoppedResponding` once a Plugin UI has been unresponsive past the grace period. */
export function watchResponsiveness(
  webContents: ResponsivenessEvents,
  stoppedResponding: () => void,
): void {
  let grace: ReturnType<typeof setTimeout> | null = null;
  const cancel = (): void => {
    if (grace !== null) clearTimeout(grace);
    grace = null;
  };
  webContents.on("unresponsive", () => {
    // Electron can repeat it while the page stays hung; the first one starts the grace period.
    grace ??= setTimeout(() => {
      grace = null;
      stoppedResponding();
    }, UNRESPONSIVE_GRACE_MS);
  });
  webContents.on("responsive", cancel);
  webContents.once("destroyed", cancel);
}
