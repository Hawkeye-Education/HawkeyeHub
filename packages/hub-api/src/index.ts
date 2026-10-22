// The Hub API as a Plugin UI sees it: one frozen `window.hub` (ADR 0009, PLUGIN_STANDARD.md §4).
// Types only. Each namespace or call added later is a minor bump of this package's version.

export type { DisplayText, Manifest } from "@hawkeye-hub/plugin-format";

/** A JSON-RPC error object, as the Backend sent it. */
export interface RpcError {
  readonly code: number;
  readonly message: string;
  /** JSON-RPC makes `data` optional; SDK Backends send `{reason}` (PLUGIN_STANDARD.md §5.3). */
  readonly data: unknown;
}

/** Every `window.hub` rejection. `code` is a closed union, so handle it with an exhaustive switch. */
export type HubError =
  | { readonly code: "backend-error"; readonly rpc: RpcError }
  /** The store is not in the Manifest's `stores`. */
  | { readonly code: "store-not-declared"; readonly store: string }
  /** Not a relative POSIX path inside the store: absolute, `..`, `.`, an empty segment, `\` or `:`. */
  | { readonly code: "bad-path"; readonly path: string }
  /** No file at that path in the store. */
  | {
      readonly code: "not-found";
      readonly store: string;
      readonly path: string;
    };

export interface HubBackend {
  /** Queued until the Backend's `initialize` succeeds. Rejects with a `HubError`. */
  request(method: string, params: unknown): Promise<unknown>;
  notify(method: string, params: unknown): Promise<void>;
  /** Returns the function that unsubscribes `handler`. */
  onNotification(
    method: string,
    handler: (params: unknown) => void,
  ): () => void;
}

export interface HubBusy {
  /** `reason` is already in the Display Language; the Hub shows it when staff close or quit. */
  set(reason: string): Promise<void>;
  clear(): Promise<void>;
}

/** What `hub.stores.watch` sends: a file in the store was written or replaced, or removed. */
export interface StoreChange {
  /** Relative to the store, POSIX-style. */
  readonly path: string;
  readonly kind: "changed" | "removed";
}

/**
 * The Shared Stores the Manifest declares (ADR 0008, PLUGIN_STANDARD.md §6). Paths are relative
 * and POSIX-style (`notes/2026/a.md`). Every call rejects with a `HubError`.
 */
export interface HubStores {
  /** Every file in the store, as relative POSIX paths. An empty store lists none. */
  list(store: string): Promise<readonly string[]>;
  readText(store: string, path: string): Promise<string>;
  readBytes(store: string, path: string): Promise<Uint8Array>;
  /** Replaces the file atomically (temp file, then rename), making its folders. Last writer wins. */
  writeText(store: string, path: string, text: string): Promise<void>;
  writeBytes(store: string, path: string, bytes: Uint8Array): Promise<void>;
  /**
   * Sends each change any Plugin or Backend makes in the store. Resolves, once watching, to the
   * function that stops it. A promise, not the function itself, so that an undeclared store can
   * reject with a `HubError`: a thrown one would reach the page as a bare `Error`.
   */
  watch(
    store: string,
    handler: (change: StoreChange) => void,
  ): Promise<() => void>;
}

export interface Hub {
  /** Fixed for the open's lifetime. May be a tag you have never heard of: fall back to `en-HK`. */
  readonly displayLanguage: string;
  /** Absent exactly when the Manifest's `backend` is `{kind: 'none'}`. */
  readonly backend?: HubBackend;
  readonly busy: HubBusy;
  /** Absent exactly when the Manifest's `stores` is empty. */
  readonly stores?: HubStores;
}

declare global {
  interface Window {
    readonly hub: Hub;
  }
}
