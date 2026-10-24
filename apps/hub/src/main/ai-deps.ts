// What the call module (`ai.ts`) needs in the running Hub: kept apart from it so its tests run
// without Electron.

import { net } from "electron";
import type { HubSettings } from "../shared/hub-settings";
import type { AiCallDeps } from "./ai";
import type { AiKeys } from "./ai-keys";
import type { Diagnostics } from "./diagnostics";

/**
 * What a chat with an AI Provider needs, for `hub.ai` and the Assistant Panel alike: the saved Hub
 * Settings, the keys main holds (loaded at start, refreshed on Save), and Chromium's fetch.
 */
export function aiCallDeps(
  diagnostics: Diagnostics,
  settings: HubSettings,
  keys: AiKeys,
): AiCallDeps {
  return {
    settings,
    keys,
    fetch: aiFetch,
    recordHubEvent: (event) => {
      diagnostics.recordHubEvent(event);
    },
  };
}

/**
 * Chromium's fetch, so AI calls go through the OS proxy as Registry checks do. It fails to connect
 * with an Error saying `net::ERR_…`, which the AI SDK does not know as a network failure, so it is
 * rethrown as Node's fetch throws one (`TypeError('fetch failed')` with the cause), which the SDK
 * does. An abort stays as it is. The smoke suite's refused connection covers it.
 */
const aiFetch: typeof globalThis.fetch = async (input, init) => {
  try {
    return await net.fetch(input instanceof URL ? input.href : input, init);
  } catch (error) {
    if (error instanceof Error && error.name !== "AbortError") {
      throw new TypeError("fetch failed", { cause: error });
    }
    throw error;
  }
};
