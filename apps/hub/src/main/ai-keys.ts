// The AI Provider key store (spec #101): one file in the Hub's data folder, encrypted whole with
// Electron's `safeStorage`, holding each provider's key by its label. It is written on Save beside
// `hub-settings.json`, which never holds a key. Keys stay in main: the Hub Chrome only ever learns
// whether a label has one.

import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Branded } from "../shared/branded";
import { AiProviderLabelSchema } from "../shared/hub-settings";
import { errorCode } from "./error-code";
import type { AbsolutePath, AiProviderLabel } from "./ids";

export const KEYS_FILE = "ai-provider-keys.bin";

export type AiProviderKey = Branded<string, "AiProviderKey">;

// As in `ids.ts`, the check makes it the type, and the `as` grants the brand.
const AiProviderKeySchema = z
  .string()
  .refine((raw) => raw.trim() !== "", "blank")
  .transform((raw) => raw as AiProviderKey);

export function parseAiProviderKey(raw: string): AiProviderKey {
  return AiProviderKeySchema.parse(raw);
}

/** The part of Electron's `safeStorage` the key store uses. */
export interface KeyCipher {
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export type AiKeys = ReadonlyMap<AiProviderLabel, AiProviderKey>;

const KeysFileSchema = z.array(
  z.tuple([AiProviderLabelSchema, AiProviderKeySchema]),
);

/**
 * The stored keys. A missing file is no keys. One that cannot be decrypted (another OS user's, say)
 * or parsed throws: losing every key silently would look like none was ever set.
 */
export function loadAiKeys(dataDir: AbsolutePath, cipher: KeyCipher): AiKeys {
  let encrypted: Buffer;
  try {
    encrypted = readFileSync(join(dataDir, KEYS_FILE));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return new Map();
    throw error;
  }
  return new Map(
    KeysFileSchema.parse(JSON.parse(cipher.decryptString(encrypted))),
  );
}

/** Writes every key, through a temporary file as `saveHubSettings` does. */
export function saveAiKeys(
  dataDir: AbsolutePath,
  cipher: KeyCipher,
  keys: AiKeys,
): void {
  const path = join(dataDir, KEYS_FILE);
  writeFileSync(`${path}.tmp`, cipher.encryptString(JSON.stringify([...keys])));
  renameSync(`${path}.tmp`, path);
}

/** What the form did to one provider's key: staff type a new key to replace it, or leave it. */
export type AiKeyEdit =
  { kind: "unchanged" } | { kind: "replaced"; key: AiProviderKey };

/** A provider in the saved form: its label now, the stored label it was edited from, and its key. */
export interface SavedProviderKey {
  label: AiProviderLabel;
  was: { kind: "added" } | { kind: "stored"; label: AiProviderLabel };
  key: AiKeyEdit;
}

/**
 * The keys after Save: an unchanged key stays with its provider, under a new label if renamed; a
 * typed key replaces it; a removed provider's key is dropped.
 */
export function keysAfterSave(
  stored: AiKeys,
  providers: readonly SavedProviderKey[],
): AiKeys {
  const keys = new Map<AiProviderLabel, AiProviderKey>();
  for (const { label, was, key } of providers) {
    switch (key.kind) {
      case "replaced":
        keys.set(label, key.key);
        break;
      case "unchanged": {
        const kept = was.kind === "stored" ? stored.get(was.label) : undefined;
        if (kept !== undefined) keys.set(label, kept);
        break;
      }
      default:
        key satisfies never;
    }
  }
  return keys;
}
