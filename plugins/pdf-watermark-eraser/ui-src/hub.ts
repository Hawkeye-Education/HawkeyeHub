// window.hub, read once at startup (PLUGIN_STANDARD.md §4.2).

export const hub = window.hub;
const maybeBackend = hub.backend;
if (maybeBackend === undefined)
  throw new Error("manifest declares a Backend but hub.backend is absent");
export const backend = maybeBackend;
