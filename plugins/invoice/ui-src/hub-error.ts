// window.hub's rejections (ADR 0009). Each caller handles the codes its call raises and hands the
// rest to `refused`, the one switch that lists every code, so a new code is one edit here.

import type { HubError } from "@hawkeye-hub/hub-api";

/** A window.hub rejection. Every one is a HubError (ADR 0009); TypeScript cannot type a promise's rejection. */
export const hubError = (e: unknown): HubError => e as HubError;

/** Throws for a code `call` never raises: a bug. The code only, since some errors name a secret. */
export function refused(call: string, err: HubError): never {
  switch (err.code) {
    case "backend-error":
    case "store-not-declared":
    case "bad-path":
    case "not-found":
    case "no-provider":
    case "provider-missing":
    case "provider-rejected":
    case "provider-unreachable":
    case "folder-not-opened":
    case "exists":
    case "write-failed":
    case "secret-name-invalid":
    case "secret-too-large":
      throw new Error(`${call} refused with ${err.code}`);
    default: {
      const unreachable: never = err;
      throw new Error(`unhandled HubError ${String(unreachable)}`);
    }
  }
}
