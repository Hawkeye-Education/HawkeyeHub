// What main and the Plugin preload tell each other, shared by both. Types and constants only: the
// preload is sandboxed.

/** Prefix of the `additionalArguments` entry that carries the Display Language to the preload. */
export const DISPLAY_LANGUAGE_ARG = "--hawkeye-hub-display-language=";

/** The `additionalArguments` entry present exactly when the Plugin has a Backend. */
export const HAS_BACKEND_ARG = "--hawkeye-hub-has-backend";

/**
 * The preload sends this to ask for its Backend's MessagePort; main answers on the same channel
 * with the port, once the Backend's `initialize` has succeeded.
 */
export const BACKEND_PORT = "hub:backend-port";

/** The preload invokes this with a `BusyMessage`, from `window.hub.busy`. */
export const BUSY = "hub:busy";

/** The page's Busy: set, with the reason the page gave, or cleared. Main refuses an empty reason. */
export type BusyMessage =
  { kind: "busy"; reason: string } | { kind: "not-busy" };
