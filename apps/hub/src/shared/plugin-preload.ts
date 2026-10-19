// What main tells the Plugin preload, shared by both. Constants only: the preload is sandboxed.

/** Prefix of the `additionalArguments` entry that carries the Display Language to the preload. */
export const DISPLAY_LANGUAGE_ARG = "--hawkeye-hub-display-language=";

/** The `additionalArguments` entry present exactly when the Plugin has a Backend. */
export const HAS_BACKEND_ARG = "--hawkeye-hub-has-backend";

/**
 * The preload sends this to ask for its Backend's MessagePort; main answers on the same channel
 * with the port, once the Backend's `initialize` has succeeded.
 */
export const BACKEND_PORT = "hub:backend-port";

/** The preload invokes this with a Busy reason, or with null to clear Busy (`window.hub.busy`). */
export const BUSY = "hub:busy";
