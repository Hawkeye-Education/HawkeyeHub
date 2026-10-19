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
export interface HubError {
  readonly code: "backend-error";
  readonly rpc: RpcError;
}

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

export interface Hub {
  /** Fixed for the open's lifetime. May be a tag you have never heard of: fall back to `en-HK`. */
  readonly displayLanguage: string;
  /** Absent exactly when the Manifest's `backend` is `{kind: 'none'}`. */
  readonly backend?: HubBackend;
  readonly busy: HubBusy;
}

declare global {
  interface Window {
    readonly hub: Hub;
  }
}
