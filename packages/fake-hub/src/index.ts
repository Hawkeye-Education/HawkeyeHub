// A fake `window.hub` for Plugin UI tests under Vitest and happy-dom (PLUGIN_STANDARD.md §9.1).
// It covers `displayLanguage`, `backend`, `busy`, `files` and `ai`; other namespaces join when a
// Plugin needs them.

import type {
  AiChat,
  AiChatRequest,
  Hub,
  HubError,
  PickFolderResult,
} from "@hawkeye-hub/hub-api";
import { parseManifest } from "@hawkeye-hub/plugin-format";

/** What the UI sent: a request or a notification to the Backend. */
export interface BackendCall {
  readonly method: string;
  readonly params: unknown;
}

/** What `hub.busy` was last told. */
export type BusyState =
  | { readonly kind: "idle" }
  | { readonly kind: "busy"; readonly reason: string };

export interface FakeHub {
  readonly backend: {
    /** Answers `method` with what `fn` returns; a thrown `backendError` rejects the request. */
    handle(method: string, fn: (params: unknown) => unknown): void;
    /** Sends a Backend notification to the UI's `onNotification` handlers. */
    emit(method: string, params: unknown): void;
    readonly requests: readonly BackendCall[];
    readonly notifications: readonly BackendCall[];
  };
  readonly busy: { readonly state: BusyState };
  readonly files: {
    /** The next `pickFolder` answers with `result`; one queued pick per call. */
    queuePick(result: PickFolderResult): void;
    /** The next `openFolder` rejects with `error`, as when the OS cannot open the folder. */
    failNextOpen(error: HubError): void;
    /** Every path `openFolder` was called with, whether or not it opened. */
    readonly opened: readonly string[];
  };
  readonly ai: {
    /** The next `chat` streams `text` back word by word; one queued reply per chat. */
    queueReply(text: string): void;
    readonly chats: readonly AiChatRequest[];
  };
  /**
   * Waits until no Hub call is pending, then rejects if the UI made a call the test did not
   * script (a request with no handler, a pick or chat with nothing queued), even if the UI caught it.
   */
  settle(): Promise<void>;
}

/** The `HubError` a Backend's `RpcError(reason, message)` becomes (PLUGIN_STANDARD.md §5.3). */
export function backendError(reason: string, message: string): HubError {
  // -32000 is the SDK's SERVER_ERROR, the code every RpcError is sent with.
  return {
    code: "backend-error",
    rpc: { code: -32000, message, data: { reason } },
  };
}

/** Builds a fake `window.hub` from a `manifest.json`'s contents and installs it on `window`. */
export function installFakeHub(options: {
  manifest: unknown;
  displayLanguage: string;
}): FakeHub {
  const parsed = parseManifest(options.manifest);
  if (parsed.kind === "invalid") throw new Error(parsed.reason);
  const manifest = parsed.manifest;
  // ponytail: identity and stores are not faked until a Plugin's tests need them.
  if (manifest.identity.kind !== "none" || manifest.stores.length > 0)
    throw new Error("fake-hub does not fake identity or stores yet");

  const handlers = new Map<string, (params: unknown) => unknown>();
  const requests: BackendCall[] = [];
  const notifications: BackendCall[] = [];
  const subscribers = new Set<{
    method: string;
    handler: (params: unknown) => void;
  }>();

  const picks: PickFolderResult[] = [];
  const opened: string[] = [];
  const openFailures: HubError[] = [];
  const replies: string[] = [];
  const chats: AiChatRequest[] = [];
  let busy: BusyState = { kind: "idle" };

  const pending = new Set<Promise<unknown>>();
  const track = <T>(call: Promise<T>): Promise<T> => {
    pending.add(call);
    const done = (): void => {
      pending.delete(call);
    };
    call.then(done, done);
    return call;
  };
  const unscripted: string[] = [];
  const fail = (what: string): Error => {
    unscripted.push(what);
    return new Error(`fake-hub: ${what}`);
  };

  const hub: Hub = {
    displayLanguage: options.displayLanguage,
    ...(manifest.backend.kind === "python" && {
      backend: Object.freeze({
        request: (method: string, params: unknown) => {
          requests.push({ method, params });
          const handler = handlers.get(method);
          if (handler === undefined)
            return Promise.reject(fail(`no handler for request ${method}`));
          return track(Promise.resolve(params).then(handler));
        },
        notify: (method: string, params: unknown) => {
          notifications.push({ method, params });
          return Promise.resolve();
        },
        onNotification: (
          method: string,
          handler: (params: unknown) => void,
        ) => {
          const subscriber = { method, handler };
          subscribers.add(subscriber);
          return () => subscribers.delete(subscriber);
        },
      }),
    }),
    busy: Object.freeze({
      set: (reason: string) => {
        busy = { kind: "busy", reason };
        return Promise.resolve();
      },
      clear: () => {
        busy = { kind: "idle" };
        return Promise.resolve();
      },
    }),
    files: Object.freeze({
      pickFolder: (title: string) => {
        const pick = picks.shift();
        if (pick === undefined)
          return Promise.reject(fail(`no queued pick for "${title}"`));
        return Promise.resolve(pick);
      },
      openFolder: (path: string) => {
        opened.push(path);
        const failure = openFailures.shift();
        if (failure === undefined) return Promise.resolve();
        // A HubError is a plain object by contract (hub-api).
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        return Promise.reject(failure);
      },
    }),
    ai: Object.freeze({
      // ponytail: not faked until a Plugin's tests need it.
      providers: () => Promise.reject(fail("hub.ai.providers is not faked")),
      chat: (request: AiChatRequest) => {
        chats.push(request);
        const reply = replies.shift();
        if (reply === undefined) throw fail("no queued AI reply");
        const chat = streamedChat(reply);
        void track(chat.done);
        return chat;
      },
    }),
  };
  // Configurable, so that the next test installs its own.
  Object.defineProperty(window, "hub", {
    value: Object.freeze(hub),
    configurable: true,
  });

  return {
    backend: {
      handle: (method, fn) => handlers.set(method, fn),
      emit: (method, params) => {
        for (const s of subscribers) if (s.method === method) s.handler(params);
      },
      requests,
      notifications,
    },
    busy: {
      get state() {
        return busy;
      },
    },
    files: {
      queuePick: (result) => picks.push(result),
      failNextOpen: (error) => openFailures.push(error),
      opened,
    },
    ai: { queueReply: (text) => replies.push(text), chats },
    settle: async () => {
      do {
        await Promise.allSettled(pending);
        // One macrotask, so that what the UI chains on a settled call runs too.
        await new Promise((resolve) => setTimeout(resolve, 0));
      } while (pending.size > 0);
      if (unscripted.length > 0)
        throw new Error(`fake-hub: ${unscripted.join("; ")}`);
    },
  };
}

/** Streams `reply` a word at a time, one macrotask apart, so a UI can cancel part-way. */
function streamedChat(reply: string): AiChat {
  const pieces = reply.split(/(?<=\s)/);
  const arrived: string[] = [];
  const cancelled = new AbortController();
  let finished = false;
  let changed = Promise.withResolvers<undefined>();
  const arrive = (): void => {
    changed.resolve(undefined);
    changed = Promise.withResolvers<undefined>();
  };

  const done = (async () => {
    for (const piece of pieces) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (cancelled.signal.aborted) break;
      arrived.push(piece);
      arrive();
    }
    finished = true;
    arrive();
    return arrived.join("");
  })();

  async function* text(): AsyncGenerator<string> {
    for (let next = 0; ;) {
      const piece = arrived[next];
      if (piece !== undefined) {
        next += 1;
        yield piece;
      } else if (finished) return;
      else await changed.promise;
    }
  }

  return {
    text: text(),
    done,
    cancel: () => {
      cancelled.abort();
    },
  };
}
