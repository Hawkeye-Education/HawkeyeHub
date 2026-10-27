// Plugin Secrets (ADR 0013): each Plugin's named strings, kept in one file in the Hub's data
// folder, `plugin-secrets/<plugin-id>.bin`, encrypted whole with `safeStorage` as `ai-keys.ts`
// keeps AI Provider keys. Read at each open; the Plugin UI changes them through `hub.secrets`, and
// the Backend gets them in `initialize`. No name or value is ever logged.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HubError, SecretLookup } from "@hawkeye-hub/hub-api";
import type { PluginId } from "@hawkeye-hub/plugin-format";
import { fitsSecret, SECRET_NAME } from "@hawkeye-hub/plugin-format/secrets";
import type { WebContents } from "electron";
import { z } from "zod";
import type { Branded } from "../shared/branded";
import { SECRETS, type StoreAnswer } from "../shared/plugin-preload";
import { SecretCall } from "../shared/secret-call";
import type { KeyCipher } from "./ai-keys";
import type { HubEvent, PluginRef } from "./diagnostics";
import { errorCode } from "./error-code";
import type { AbsolutePath } from "./ids";

export type SecretName = Branded<string, "SecretName">;

// The check makes it the type, and the `as` grants the brand.
const SecretNameSchema = z
  .string()
  .regex(SECRET_NAME)
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
    // Never the name or value: an Error's message may reach a log.
    super(`Secret call refused: ${refusal.code}`);
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
 * Every Plugin's secrets, for one Hub run. `open` reads a Plugin's as stored now. A missing file is
 * none. One that cannot be decrypted or parsed (another OS user's, or one cut short) is none too,
 * recorded in hub.log without its contents once per Plugin per Hub run, and the Plugin asks staff
 * again.
 */
export function createPluginSecrets(
  hubDataDir: AbsolutePath,
  cipher: KeyCipher,
  recordHubEvent: (event: HubEvent) => void,
): { open(plugin: PluginRef): PluginSecrets } {
  const recorded = new Set<PluginId>();
  return {
    open: (plugin) =>
      openPluginSecrets(hubDataDir, plugin.id, cipher, () => {
        if (recorded.has(plugin.id)) return;
        recorded.add(plugin.id);
        recordHubEvent({ kind: "plugin-secrets-unreadable", plugin });
      }),
  };
}

function openPluginSecrets(
  hubDataDir: AbsolutePath,
  id: PluginId,
  cipher: KeyCipher,
  unreadable: () => void,
): PluginSecrets {
  const file = pluginSecretsFile(hubDataDir, id);
  const stored = new Map(load(file, cipher, unreadable));
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
      if (!fitsSecret(value)) {
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
  // Each step fails only on data that is not a secrets file; anything else propagates.
  let text: string;
  try {
    // safeStorage throws an Error for ciphertext it cannot decrypt, such as another OS user's.
    text = cipher.decryptString(encrypted);
  } catch {
    unreadable();
    return [];
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    unreadable();
    return [];
  }
  const parsed = SecretsFileSchema.safeParse(json);
  if (parsed.success) return parsed.data;
  unreadable();
  return [];
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
        return undefined;
      case "remove":
        secrets.remove(call.name);
        return undefined;
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
        // A refusal is the Plugin's to handle; anything else, such as a failed write, rejects as
        // the Hub failure it is, as `hub.stores` does.
        if (error instanceof SecretRefused) {
          return { kind: "refused", refusal: error.refusal };
        }
        throw error;
      }
    },
  );
}
