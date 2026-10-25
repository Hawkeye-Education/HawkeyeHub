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
    }
  /** `hub.ai`: no AI Provider is set up, or the Default AI Provider is `none`. */
  | { readonly code: "no-provider" }
  /** `hub.ai`: the chosen provider or model is not in Hub Settings. There is no fallback. */
  | { readonly code: "provider-missing" }
  /** `hub.ai`: the provider answered with this HTTP status, such as 401 for a bad key. */
  | { readonly code: "provider-rejected"; readonly status: number }
  /** `hub.ai`: the provider could not be reached. */
  | { readonly code: "provider-unreachable" }
  /** `hub.files.openFolder`: the OS could not open it; `message` is the OS's, in English. */
  | {
      readonly code: "folder-not-opened";
      readonly path: string;
      readonly message: string;
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

declare const folderPath: unique symbol;
/**
 * An absolute folder path on staff's machine, in the OS's own form. Only the Hub's folder dialog
 * makes one; a Plugin keeps it and passes it on.
 */
export type FolderPath = string & { readonly [folderPath]: "FolderPath" };

/** What `hub.files.pickFolder` comes to: the folder staff chose, or a cancelled dialog. */
export type PickFolderResult =
  | { readonly kind: "chosen"; readonly path: FolderPath }
  | { readonly kind: "cancelled" };

/** Folders on staff's machine (ADR 0009). The Backend does the I/O on a picked path. */
export interface HubFiles {
  /** Opens the OS folder dialog, modal to the Hub window, with `title` as its title. */
  pickFolder(title: string): Promise<PickFolderResult>;
  /** Reveals the folder in Explorer or Finder. Rejects with `folder-not-opened`. */
  openFolder(path: string): Promise<void>;
}

/** Which model a chat uses: the Default AI Provider, or a provider and model by name. */
export type AiModelChoice =
  | { readonly kind: "default" }
  | {
      readonly kind: "chosen";
      readonly provider: string;
      readonly model: string;
    };

/** An image part only for a model that `acceptsImages`: any other is refused before the call. */
export type AiPart =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "image";
      readonly image: Uint8Array;
      /** Such as `image/png`. */
      readonly mediaType: string;
    };

export interface AiMessage {
  readonly role: "user" | "assistant";
  readonly content: readonly AiPart[];
}

export interface AiChatRequest {
  readonly model: AiModelChoice;
  readonly system: string;
  readonly messages: readonly AiMessage[];
}

/** One streaming reply: text only, never reasoning. */
export interface AiChat {
  /** The reply as it streams. Throws the `HubError` that `done` rejects with. */
  readonly text: AsyncIterable<string>;
  /** The whole reply; after `cancel`, what had arrived. Rejects with a `HubError`. */
  readonly done: Promise<string>;
  cancel(): void;
}

/** An AI Provider as Hub Settings name it: never its key or Base URL. */
export interface AiProviderInfo {
  readonly label: string;
  readonly kind: "openai-compatible" | "anthropic";
  readonly models: readonly {
    readonly id: string;
    readonly acceptsImages: boolean;
  }[];
}

/** AI through the Hub's AI Providers (ADR 0009 §7). Closing the Plugin cancels its chats. */
export interface HubAi {
  providers(): Promise<readonly AiProviderInfo[]>;
  chat(request: AiChatRequest): AiChat;
}

export interface Hub {
  /** Fixed for the open's lifetime. May be a tag you have never heard of: fall back to `en-HK`. */
  readonly displayLanguage: string;
  /** Absent exactly when the Manifest's `backend` is `{kind: 'none'}`. */
  readonly backend?: HubBackend;
  readonly busy: HubBusy;
  /** Absent exactly when the Manifest's `stores` is empty. */
  readonly stores?: HubStores;
  readonly files: HubFiles;
  readonly ai: HubAi;
}

declare global {
  interface Window {
    readonly hub: Hub;
  }
}
