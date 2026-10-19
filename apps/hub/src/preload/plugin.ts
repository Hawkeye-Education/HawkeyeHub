// The Plugin preload: builds each Plugin UI's one frozen `window.hub` (ADR 0009) before any Plugin
// code runs. Sandboxed, so it may import only `electron` (anything else is bundled) and is built as
// CommonJS. `displayLanguage`, `busy`, and `backend` when the Plugin has one.

import type {
  HubBackend,
  HubBusy,
  HubError,
  RpcError,
} from "@hawkeye-hub/hub-api";
import { contextBridge, ipcRenderer } from "electron";
import {
  BACKEND_PORT,
  BUSY,
  DISPLAY_LANGUAGE_ARG,
  HAS_BACKEND_ARG,
} from "../shared/plugin-preload";

/** A JSON-RPC response or notification from the Backend, as main relays it. */
type BackendMessage =
  | { id: number; result: unknown }
  | { id: number; error: RpcError }
  | { method: string; params: unknown };

// Main passes the Display Language as an argument, so it is here synchronously, before the page
// parses: fixed for this open's lifetime.
const displayLanguage = process.argv
  .find((arg) => arg.startsWith(DISPLAY_LANGUAGE_ARG))
  ?.slice(DISPLAY_LANGUAGE_ARG.length);
if (displayLanguage === undefined) {
  throw new Error(`The Plugin preload needs ${DISPLAY_LANGUAGE_ARG}`);
}

// `hub.busy`: main keeps the latest reason and shows it when staff close the Plugin or quit.
const busy: HubBusy = {
  set: async (reason) => {
    await ipcRenderer.invoke(BUSY, reason);
  },
  clear: async () => {
    await ipcRenderer.invoke(BUSY, null);
  },
};

contextBridge.exposeInMainWorld(
  "hub",
  Object.freeze(
    process.argv.includes(HAS_BACKEND_ARG)
      ? { displayLanguage, busy, backend: connectBackend() }
      : { displayLanguage, busy },
  ),
);

/**
 * `hub.backend`: a JSON-RPC client over the MessagePort main hands over once the Backend's
 * `initialize` has succeeded. Until then every message waits on that port, in order, so a request
 * sent at page load is queued rather than failed (ADR 0009). The port stays here: it cannot cross
 * the context bridge.
 */
function connectBackend(): HubBackend {
  const port = new Promise<MessagePort>((resolve) => {
    ipcRenderer.once(BACKEND_PORT, ({ ports: [received] }) => {
      if (received === undefined)
        throw new Error(`${BACKEND_PORT} carries a port`);
      resolve(received);
    });
  });
  ipcRenderer.send(BACKEND_PORT);

  const answers = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (error: HubError) => void }
  >();
  const handlers = new Map<string, Set<(params: unknown) => void>>();
  let lastId = 0;

  void port.then((received) => {
    // Main relays only well-formed JSON-RPC responses and notifications (src/main/backend.ts).
    received.onmessage = ({ data }: MessageEvent<BackendMessage>) => {
      if (!("id" in data)) {
        for (const handler of handlers.get(data.method) ?? [])
          handler(data.params);
        return;
      }
      const answer = answers.get(data.id);
      if (answer === undefined)
        throw new Error(`No request has the id ${String(data.id)}`);
      answers.delete(data.id);
      if ("error" in data)
        answer.reject({ code: "backend-error", rpc: data.error });
      else answer.resolve(data.result);
    };
  });
  // Serialised here, so a value JSON cannot carry fails in the Plugin's own call.
  const post = (message: object): Promise<void> => {
    const line = JSON.stringify({ jsonrpc: "2.0", ...message });
    return port.then((received) => {
      received.postMessage(line);
    });
  };

  return {
    request(method, params) {
      lastId += 1;
      const id = lastId;
      return new Promise((resolve, reject) => {
        answers.set(id, { resolve, reject });
        post({ id, method, params }).catch(reject);
      });
    },
    notify: (method, params) => post({ method, params }),
    onNotification(method, handler) {
      const forMethod = handlers.get(method) ?? new Set();
      handlers.set(method, forMethod.add(handler));
      return () => {
        forMethod.delete(handler);
      };
    },
  };
}

// window.open is refused (spec #44). Main denies every new window, but cannot tell window.open from
// an `<a target=_blank>`, which opens https in the system browser, so window.open stops here and
// opens nothing. Plugins are trusted (ADR 0009): a page that calls a subframe's open still reaches
// main's rule, which only ever opens https in the system browser.
contextBridge.executeInMainWorld({
  func: () => {
    Object.defineProperty(window, "open", {
      value: () => null,
      writable: false,
      configurable: false,
    });
  },
});

// The preload runs before the parser has made `<html>` (documentElement is null then; the smoke
// suite proves it), so the lang is set as the element is inserted. Mutation observers run at the
// microtask checkpoint before the parser runs any script, so Plugin code already sees it, and it
// wins over a lang the page's own `<html>` carries.
const observer = new MutationObserver(() => {
  // Not documentElement: its typings say it is never null, which is untrue before the parser runs.
  const root = document.querySelector("html");
  if (root === null) return;
  root.lang = displayLanguage;
  observer.disconnect();
});
observer.observe(document, { childList: true });
