// Downloads to a file, hashing as it writes: Plugin Packages (spec #91 step 1) and uv (ADR 0011).

import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { open } from "node:fs/promises";
import type { RegistryFetch, Sha256, WebUrl } from "./registry";

/** How long a download may take before it counts as failed. */
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

/** `download` says why, for a log line. */
export type DownloadOutcome =
  | { kind: "downloaded" }
  | { kind: "failed"; cause: "download"; reason: string }
  | { kind: "failed"; cause: "checksum" };

/** Downloads `url` to `file` and checks its sha256. A failure leaves no `file`. */
export async function downloadChecked(
  fetch: RegistryFetch,
  url: WebUrl,
  sha256: Sha256,
  file: string,
): Promise<DownloadOutcome> {
  const hash = createHash("sha256");
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok || response.body === null) {
      return {
        kind: "failed",
        cause: "download",
        reason: `HTTP ${String(response.status)}`,
      };
    }
    const handle = await open(file, "w");
    try {
      await response.body.pipeTo(
        new WritableStream<Uint8Array>({
          write: async (chunk) => {
            hash.update(chunk);
            await handle.write(chunk);
          },
        }),
      );
    } finally {
      await handle.close();
    }
  } catch (error) {
    // Not swallowed: any failure to get the whole file onto disk is the `download` outcome, which
    // the caller logs. fetch and its body reject with a TypeError, or an abort's DOMException, and
    // a write with a Node system error (such as a full disk); each is staff's to retry.
    rmSync(file, { force: true });
    return { kind: "failed", cause: "download", reason: String(error) };
  }
  if (hash.digest("hex") !== sha256) {
    rmSync(file);
    return { kind: "failed", cause: "checksum" };
  }
  return { kind: "downloaded" };
}
