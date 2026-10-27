// The rules for a Plugin Secret (ADR 0013), shared by the Hub and `@hawkeye-hub/fake-hub` so the
// fake refuses exactly what the Hub refuses.

/** A secret's name: non-blank `[a-z0-9-]`. */
export const SECRET_NAME = /^[a-z0-9-]+$/;

/** The largest value `hub.secrets.set` stores, in UTF-8 bytes. */
export const MAX_SECRET_BYTES = 64 * 1024;

/** Whether `value` is small enough to store. */
export function fitsSecret(value: string): boolean {
  return new TextEncoder().encode(value).length <= MAX_SECRET_BYTES;
}
