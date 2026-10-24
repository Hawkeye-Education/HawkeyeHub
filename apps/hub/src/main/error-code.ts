/**
 * The `code` Node and Electron put on their errors (`ESRCH`, `EPIPE`, `ERR_ABORTED`), or undefined
 * for an error that has none: a real answer, since any thrown value may lack one.
 */
export function errorCode(error: unknown): string | undefined {
  return error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}
