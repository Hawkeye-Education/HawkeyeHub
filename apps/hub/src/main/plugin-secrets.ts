// Plugin Secrets (ADR 0013): each Plugin's named strings, kept in one file in the Hub's data folder,
// `plugin-secrets/<plugin-id>.bin`, encrypted whole with `safeStorage` as `ai-keys.ts` keeps AI
// Provider keys. Read once per open; the Plugin UI changes them through `hub.secrets`, and the
// Backend gets them in `initialize`. No name or value is ever logged.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HubError, SecretLookup } from "@hawkeye-hub/hub-api";
import type { PluginId } from "@hawkeye-hub/plugin-format";
import type { WebContents } from "electron";
import { z } from "zod";
import type { Branded } from "../shared/branded";
import { SECRETS, type StoreAnswer } from "../shared/plugin-preload";
import { SecretCall } from "../shared/secret-call";
import type { KeyCipher } from "./ai-keys";
import type { HubEvent, PluginRef } from "./diagnostics";
import { errorCode } from "./error-code";
import type { AbsolutePath } from "./ids";

/** The largest value `hub.secrets.set` stores, in UTF-8 bytes (ADR 0013). */
export const MAX_SECRET_BYTES = 64 * 1024;

export type SecretName = Branded<string, "SecretName">;

// The check makes it the type, and the `as` grants the brand.
const SecretNameSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .transform((raw) => raw as SecretName);

const SecretsFileSchema = z.array(z.tuple([SecretNameSchema, z.string()]));

/** The Plugin's own mistake in a `hub.secrets` call; the preload rejects with its `refusal`. */
export class SecretRefused extends Error {
  constructor(
    readonly refusal: Extract<
      HubError,
      { code: "secret-name-invalid" | "secret-too-large" }
    >,
  ) {
    // The name only: never the value.
    super(
      `Secret call refused: ${refusal.code} ${JSON.stringify(refusal.name)}`,
    );
  }
}

export function pluginSecretsFile(
  hubDataDir: AbsolutePath,
  id: PluginId,
): string {
  return join(hubDataDir, "plugin-secrets", `${id}.bin`);
}

export interface PluginSecrets {
  get(name: string): SecretLookup;
  set(name: string, value: string): void;
  remove(name: string): void;
  /** Every stored secret, as `initialize` sends them. */
  readonly stored: ReadonlyMap<SecretName, string>;
}

/**
 * The Plugin's secrets as stored now. A missing file is none. One that cannot be decrypted or
 * parsed (another OS user's, or one cut short) is none too, recorded once in hub.log without its
 * contents, and the Plugin asks staff again.
 */
export function openPluginSecrets(
  hubDataDir: AbsolutePath,
  plugin: PluginRef,
  cipher: KeyCipher,
  recordHubEvent: (event: HubEvent) => void,
): PluginSecrets {
  const file = pluginSecretsFile(hubDataDir, plugin.id);
  const stored = new Map(
    load(file, cipher, () => {
      recordHubEvent({ kind: "plugin-secrets-unreadable", plugin });
    }),
  );
  const nameOf = (raw: string): SecretName => {
    const parsed = SecretNameSchema.safeParse(raw);
    if (!parsed.success) {
      throw new SecretRefused({ code: "secret-name-invalid", name: raw });
    }
    return parsed.data;
  };
  // Replaced whole through a temporary file, as `saveAiKeys` does.
  const save = (): void => {
    mkdirSync(join(hubDataDir, "plugin-secrets"), { recursive: true });
    writeFileSync(
      `${file}.tmp`,
      cipher.encryptString(JSON.stringify([...stored])),
    );
    renameSync(`${file}.tmp`, file);
  };
  return {
    get(raw) {
      const value = stored.get(nameOf(raw));
      return value === undefined
        ? { kind: "missing" }
        : { kind: "stored", value };
    },
    set(raw, value) {
      const name = nameOf(raw);
      if (Buffer.byteLength(value, "utf8") > MAX_SECRET_BYTES) {
        throw new SecretRefused({ code: "secret-too-large", name });
      }
      stored.set(name, value);
      save();
    },
    remove(raw) {
      if (stored.delete(nameOf(raw))) save();
    },
    stored,
  };
}

function load(
  file: string,
  cipher: KeyCipher,
  unreadable: () => void,
): [SecretName, string][] {
  let encrypted: Buffer;
  try {
    encrypted = readFileSync(file);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
  try {
    return SecretsFileSchema.parse(JSON.parse(cipher.decryptString(encrypted)));
  } catch {
    unreadable();
    return [];
  }
}

/** Serves `hub.secrets` to one Plugin UI's page over the Plugin preload's `SECRETS` channel. */
export function serveSecrets(
  webContents: WebContents,
  secrets: PluginSecrets,
): void {
  const answer = (call: SecretCall): unknown => {
    switch (call.call) {
      case "get":
        return secrets.get(call.name);
      case "set":
        secrets.set(call.name, call.value);
        return null;
      case "remove":
        secrets.remove(call.name);
        return null;
      default:
        return call satisfies never;
    }
  };
  webContents.ipc.handle(
    SECRETS,
    (_event, raw: unknown): StoreAnswer<unknown> => {
      try {
        return { kind: "done", value: answer(SecretCall.parse(raw)) };
      } catch (error) {
        // A refusal is the Plugin's to handle; anything else rejects as the Hub failure it is.
        if (error instanceof SecretRefused) {
          return { kind: "refused", refusal: error.refusal };
        }
        throw error;
      }
    },
  );
}
