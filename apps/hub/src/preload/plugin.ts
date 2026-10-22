// The Plugin preload: builds each Plugin UI's one frozen `window.hub` (ADR 0009) before any Plugin
// code runs. Sandboxed, so it may import only `electron` (anything else is bundled) and is built as
// CommonJS. `displayLanguage`, `busy`, `backend` when the Plugin has one, and `stores` when it
// declares any.

import type {
  HubBackend,
  HubBusy,
  HubError,
  HubStores,
  RpcError,
  StoreChange,
} from "@hawkeye-hub/hub-api";
import { contextBridge, ipcRenderer } from "electron";
import {
  BACKEND_PORT,
  BUSY,
  DISPLAY_LANGUAGE_ARG,
  HAS_BACKEND_ARG,
  HAS_STORES_ARG,
  STORES,
  STORES_CHANGED,
  type BusyMessage,
  type StoreAnswer,
  type StoreCall,
  type StoreChanged,
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
    const message: BusyMessage = { kind: "busy", reason };
    await ipcRenderer.invoke(BUSY, message);
  },
  clear: async () => {
    const message: BusyMessage = { kind: "not-busy" };
    await ipcRenderer.invoke(BUSY, message);
  },
};

contextBridge.exposeInMainWorld(
  "hub",
  Object.freeze({
    displayLanguage,
    busy,
    ...(process.argv.includes(HAS_BACKEND_ARG)
      ? { backend: connectBackend() }
      : {}),
    ...(process.argv.includes(HAS_STORES_ARG)
      ? { stores: connectStores() }
      : {}),
  }),
);

/**
 * `hub.stores`: each call answered by main, which refuses what the Plugin got wrong with the
 * `HubError` the call rejects with. An Error thrown in main, or one thrown here synchronously,
 * would reach the page as a bare message (the smoke suite showed both), so every call is a promise.
 */
function connectStores(): HubStores {
  // Main is trusted, so its answer is not re-validated; `Value` is what main returns for `call`.
  const answer = async <Value>(call: StoreCall): Promise<Value> => {
    const answered = await ipcRenderer
      .invoke(STORES, call)
      .then((received: StoreAnswer<Value>) => received);
    // A HubError is a plain object by design (ADR 0009), as `hub.backend` rejects with too.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (answered.kind === "refused") throw answered.refusal;
    return answered.value;
  };

  const handlers = new Map<number, (change: StoreChange) => void>();
  ipcRenderer.on(STORES_CHANGED, (_event, { id, change }: StoreChanged) => {
    // A change sent before the stop arrived in main is dropped.
    handlers.get(id)?.(change);
  });
  let lastWatch = 0;

  return {
    list: (store) => answer({ call: "list", store }),
    readText: (store, path) => answer({ call: "readText", store, path }),
    readBytes: (store, path) => answer({ call: "readBytes", store, path }),
    writeText: (store, path, text) =>
      answer({ call: "writeText", store, path, text }),
    writeBytes: (store, path, bytes) =>
      answer({ call: "writeBytes", store, path, bytes }),
    async watch(store, handler) {
      lastWatch += 1;
      const id = lastWatch;
      // Set first: main may send a change before its answer arrives.
      handlers.set(id, handler);
      try {
        await answer({ call: "watch", store, id });
      } catch (refusal) {
        handlers.delete(id);
        throw refusal;
      }
      return () => {
        if (!handlers.delete(id)) return;
        void answer({ call: "unwatch", id });
      };
    },
  };
}

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
