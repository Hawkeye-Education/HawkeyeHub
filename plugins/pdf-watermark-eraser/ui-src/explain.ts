// A window.hub rejection in staff's words (PLUGIN_STANDARD.md §4.6).

import type { HubError } from "@hawkeye-hub/hub-api";
import { t } from "./i18n";
import { RpcData } from "./protocol";

export function explain(e: unknown): string {
  // Every window.hub rejection is a HubError (ADR 0009); TypeScript cannot type a promise's rejection.
  const err = e as HubError;
  switch (err.code) {
    case "backend-error": {
      const { reason } = RpcData.parse(err.rpc.data);
      return t(`error.${reason}`, { detail: err.rpc.message });
    }
    case "folder-not-opened":
      return t("error.folder-not-opened", { detail: err.message });
    case "store-not-declared":
    case "bad-path":
    case "not-found":
    case "no-provider":
    case "provider-missing":
    case "provider-rejected":
    case "provider-unreachable":
    case "secret-name-invalid":
    case "secret-too-large":
      // This Plugin declares no stores, makes no AI calls and keeps no secrets. A HubError is a plain object by
      // contract (hub-api), so this throws no Error.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw err;
    default: {
      const unreachable: never = err;
      throw new Error(`unhandled HubError ${JSON.stringify(unreachable)}`);
    }
  }
}
