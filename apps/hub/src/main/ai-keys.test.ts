import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import {
  KEYS_FILE,
  keysAfterSave,
  loadAiKeys,
  parseAiProviderKey,
  saveAiKeys,
  type KeyCipher,
} from "./ai-keys";
import type { HubEvent } from "./diagnostics";
import { FIRST_LAUNCH_SETTINGS, saveHubSettings } from "./hub-settings";
import {
  parseAbsolutePath,
  parseAiProviderLabel,
  parseModelId,
  type AbsolutePath,
} from "./ids";

// Stands in for Electron's safeStorage: reversible, and never leaves the text readable.
const cipher: KeyCipher = {
  encryptString: (plain) => Buffer.from(plain, "utf8").reverse(),
  decryptString: (encrypted) =>
    Buffer.from(encrypted).reverse().toString("utf8"),
};

let dataDir: AbsolutePath;

const unexpected = (event: HubEvent): never => {
  throw new Error(`Unexpected hub.log event ${event.kind}`);
};

beforeEach(() => {
  dataDir = parseAbsolutePath(mkdtempSync(join(tmpdir(), "hub-ai-keys-")));
});

const AZURE = parseAiProviderLabel("School Azure");
const CLAUDE = parseAiProviderLabel("Claude");
const AZURE_KEY = parseAiProviderKey("sk-azure-secret");
const CLAUDE_KEY = parseAiProviderKey("sk-ant-secret");

function filesText(): string {
  return readdirSync(dataDir)
    .map((name) => readFileSync(join(dataDir, name), "utf8"))
    .join("\n");
}

test("with no key file there are no keys", () => {
  expect(loadAiKeys(dataDir, cipher, unexpected)).toEqual(new Map());
});

test("saved keys load back the same, and are never written readable", () => {
  const keys = new Map([
    [AZURE, AZURE_KEY],
    [CLAUDE, CLAUDE_KEY],
  ]);
  saveAiKeys(dataDir, cipher, keys);
  expect(loadAiKeys(dataDir, cipher, unexpected)).toEqual(keys);
  expect(filesText()).not.toContain("secret");
});

test("a key file that cannot be decrypted holds no keys, and says so once in hub.log", () => {
  saveAiKeys(dataDir, cipher, new Map([[AZURE, AZURE_KEY]]));
  const otherUser: KeyCipher = {
    ...cipher,
    decryptString: () => {
      throw new Error("Error while decrypting the ciphertext provided");
    },
  };
  const events: HubEvent[] = [];
  expect(loadAiKeys(dataDir, otherUser, (event) => events.push(event))).toEqual(
    new Map(),
  );
  expect(events).toEqual([{ kind: "ai-keys-unreadable" }]);
});

test("a key file that decrypts to something else holds no keys", () => {
  writeFileSync(join(dataDir, KEYS_FILE), cipher.encryptString("{"));
  const events: HubEvent[] = [];
  expect(loadAiKeys(dataDir, cipher, (event) => events.push(event))).toEqual(
    new Map(),
  );
  expect(events).toEqual([{ kind: "ai-keys-unreadable" }]);
});

test("Save keeps unchanged keys, replaces typed ones, moves a renamed provider's key and drops a removed one", () => {
  const stored = new Map([
    [AZURE, AZURE_KEY],
    [CLAUDE, CLAUDE_KEY],
  ]);
  const renamed = parseAiProviderLabel("Azure (school)");
  const added = parseAiProviderLabel("Ollama");
  const newKey = parseAiProviderKey("sk-ant-new");

  expect(
    keysAfterSave(stored, [
      {
        label: renamed,
        was: { kind: "stored", label: AZURE },
        key: { kind: "unchanged" },
      },
      {
        label: CLAUDE,
        was: { kind: "stored", label: CLAUDE },
        key: { kind: "replaced", key: newKey },
      },
      { label: added, was: { kind: "added" }, key: { kind: "unchanged" } },
    ]),
  ).toEqual(
    new Map([
      [renamed, AZURE_KEY],
      [CLAUDE, newKey],
    ]),
  );
  expect(keysAfterSave(stored, [])).toEqual(new Map());
});

test("hub-settings.json never holds a key", () => {
  saveAiKeys(dataDir, cipher, new Map([[AZURE, AZURE_KEY]]));
  saveHubSettings(dataDir, {
    ...FIRST_LAUNCH_SETTINGS,
    aiProviders: [
      {
        label: AZURE,
        endpoint: { kind: "anthropic" },
        models: [{ id: parseModelId("claude-opus-5-5"), inputs: ["image"] }],
      },
    ],
  });
  expect(
    readFileSync(join(dataDir, "hub-settings.json"), "utf8"),
  ).not.toContain("secret");
});

test("a blank key is refused", () => {
  expect(() => parseAiProviderKey(" ")).toThrow();
});
