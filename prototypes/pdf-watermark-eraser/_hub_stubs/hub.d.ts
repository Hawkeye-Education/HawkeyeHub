// PROTOTYPE of the types-only npm package (version = Hub API version), transcribed from ADR 0009.
// Plus the two Hub Kit v1 elements this prototype proposes (ADR 0006).

export type HubErrorCode =
  | 'store-not-declared'
  | 'provider-missing'
  | 'backend-error'
  | 'bad-path';

export interface HubError extends Error {
  code: HubErrorCode;
  /** The Backend's JSON-RPC error, when code is 'backend-error'. */
  rpc?: { code: number; message: string; data?: unknown };
}

export type PickResult = { kind: 'chosen'; path: string } | { kind: 'cancelled' };
export type ModelChoice = { kind: 'default' } | { kind: 'chosen'; provider: string; model: string };
export type ChatPart = { kind: 'text'; text: string } | { kind: 'image'; mediaType: string; data: string };

export interface Hub {
  readonly displayLanguage: string;
  /** Absent unless the manifest's identity is required. */
  readonly identity?: { id: string; name: string; email: string; roles: readonly string[] };
  /** Absent unless the manifest declares a Backend. */
  readonly backend?: {
    request<T = unknown>(method: string, params: object): Promise<T>;
    notify(method: string, params: object): Promise<void>;
    onNotification(method: string, handler: (params: any) => void): () => void;
  };
  readonly files: {
    pickFolder(title: string): Promise<PickResult>;
    openFolder(path: string): Promise<void>;
  };
  readonly stores: {
    list(store: string, dir: string): Promise<{ name: string; kind: 'file' | 'folder' }[]>;
    readText(store: string, path: string): Promise<string>;
    readBytes(store: string, path: string): Promise<Uint8Array>;
    writeText(store: string, path: string, text: string): Promise<void>;
    writeBytes(store: string, path: string, bytes: Uint8Array): Promise<void>;
    remove(store: string, path: string): Promise<void>;
    watch(store: string, handler: (e: { path: string; kind: 'changed' | 'removed' }) => void): () => void;
  };
  readonly ai: {
    providers(): Promise<{ label: string; kind: string; models: string[] }[]>;
    chat(req: { model: ModelChoice; system: string; messages: { role: 'user' | 'assistant'; parts: ChatPart[] }[] }): {
      text: AsyncIterable<string>;
      done: Promise<string>;
      cancel(): void;
    };
  };
  readonly busy: {
    set(reason: string): Promise<void>;
    clear(): Promise<void>;
  };
}

/** PROPOSED Hub Kit v1. Labels are the Plugin's (already translated); built-in text like "Browse" is the Hub's. */
export interface HubFolderField extends HTMLElement {
  /** Shown above the path, and as the folder dialog's title. */
  label: string;
  /** The chosen path, or '' when none. Fires `change` when staff pick a new one. */
  value: string;
}
export interface HubLog extends HTMLElement {
  append(entry: { tone: 'info' | 'success' | 'danger'; text: string }): void;
  clear(): void;
}

declare global {
  interface Window { readonly hub: Hub }
  interface HTMLElementTagNameMap {
    'hub-folder-field': HubFolderField;
    'hub-log': HubLog;
  }
}
