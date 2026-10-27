// What main and the Plugin preload tell each other, shared by both. Types and constants only: the
// preload is sandboxed.

import type { HubError, StoreChange } from "@hawkeye-hub/hub-api";
import type { AiFailure } from "./ai-call";

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

/**
 * The `additionalArguments` entry present exactly when the Manifest declares a store, and so the
 * page has `hub.stores`.
 */
export const HAS_STORES_ARG = "--hawkeye-hub-has-stores";

/** The preload invokes this with a `StoreCall`, from `window.hub.stores`; main answers a `StoreAnswer`. */
export const STORES = "hub:stores";

/** Main sends this with a `StoreChanged` for each change a watch sees. */
export const STORES_CHANGED = "hub:stores-changed";

/** The preload invokes this with the dialog's title; main answers a `PickFolderResult`. */
export const FILES_PICK_FOLDER = "hub:files-pick-folder";

/** The preload invokes this with the folder's absolute path; main answers an `OpenFolderAnswer`. */
export const FILES_OPEN_FOLDER = "hub:files-open-folder";

/** Whether the OS opened the folder, or the message it failed with. */
export type OpenFolderAnswer =
  { kind: "opened" } | { kind: "failed"; message: string };

/** The preload invokes this for `hub.ai.providers()`; main answers `AiProviderInfo[]`. */
export const AI_PROVIDERS = "hub:ai-providers";

/**
 * The preload invokes this with an `AiChatCall`. Main then sends `AiChatEvent`s on
 * `AI_CHAT_EVENT`, ending with `done` or `failed`. It throws for an image part to a model that
 * does not accept images.
 */
export const AI_CHAT = "hub:ai-chat";

/** The preload invokes this with a chat's id to cancel it. */
export const AI_CANCEL = "hub:ai-cancel";

export const AI_CHAT_EVENT = "hub:ai-chat-event";

export type AiChatEvent = { id: number } & (
  | { kind: "delta"; text: string }
  | { kind: "done"; text: string }
  | { kind: "failed"; failure: AiFailure }
);

/** The preload invokes this with a `SecretCall`; main answers a `StoreAnswer`. */
export const SECRETS = "hub:secrets";

/**
 * What a `StoreCall` or `SecretCall` comes to: its value, or the `HubError` the page's call rejects
 * with.
 */
export type StoreAnswer<Value> =
  { kind: "done"; value: Value } | { kind: "refused"; refusal: HubError };

export interface StoreChanged {
  id: number;
  change: StoreChange;
}

/** The page's Busy: set, with the reason the page gave, or cleared. Main refuses an empty reason. */
export type BusyMessage =
  { kind: "busy"; reason: string } | { kind: "not-busy" };
