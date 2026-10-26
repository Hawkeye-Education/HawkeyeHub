import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginId, PluginVersion } from "@hawkeye-hub/plugin-format";
import { beforeEach, expect, test } from "vitest";
import type { KeyCipher } from "./ai-keys";
import type { HubEvent } from "./diagnostics";
import { parseAbsolutePath, type AbsolutePath } from "./ids";
import {
  createPluginSecrets,
  pluginSecretsFile,
  SecretRefused,
} from "./plugin-secrets";

// Stands in for Electron's safeStorage: reversible, and never leaves the text readable.
const cipher: KeyCipher = {
  encryptString: (plain) => Buffer.from(plain, "utf8").reverse(),
  decryptString: (encrypted) =>
    Buffer.from(encrypted).reverse().toString("utf8"),
};
const unexpected = (event: HubEvent): never => {
  throw new Error(`Unexpected hub.log event ${event.kind}`);
};

const TUTORS = {
  id: PluginId.parse("tutor-finder"),
  version: PluginVersion.parse("1.0.0"),
};
let dataDir: AbsolutePath;
beforeEach(() => {
  dataDir = parseAbsolutePath(mkdtempSync(join(tmpdir(), "hub-secrets-")));
});

// A fresh Hub run each time.
const open = (events: (event: HubEvent) => void = unexpected) =>
  createPluginSecrets(dataDir, cipher, events).open(TUTORS);

test("a secret never set is missing", () => {
  expect(open().get("sheets-key")).toEqual({ kind: "missing" });
});

test("a set secret reads back, also at the next open, and is never written readable", () => {
  open().set("sheets-key", '{"private_key":"pk-secret"}');

  expect(open().get("sheets-key")).toEqual({
    kind: "stored",
    value: '{"private_key":"pk-secret"}',
  });
  const file = readFileSync(pluginSecretsFile(dataDir, TUTORS.id), "utf8");
  expect(file).not.toContain("pk-secret");
  expect(file).not.toContain("sheets-key");
});

test("set replaces, and remove forgets, only the named secret", () => {
  const secrets = open();
  secrets.set("sheets-key", "old");
  secrets.set("sheet-id", "abc");
  secrets.set("sheets-key", "new");
  secrets.remove("sheet-id");
  secrets.remove("never-set");

  expect(open().stored).toEqual(new Map([["sheets-key", "new"]]));
});

test("a name that is blank or not lowercase kebab characters is refused", () => {
  const secrets = open();
  for (const name of ["", "Sheets", "sheets_key", "a b", "密碼"]) {
    expect(() => secrets.get(name)).toThrow(
      new SecretRefused({ code: "secret-name-invalid", name }),
    );
    expect(() => {
      secrets.set(name, "x");
    }).toThrow(SecretRefused);
    expect(() => {
      secrets.remove(name);
    }).toThrow(SecretRefused);
  }
});

test("a refusal's message never carries the name, which only the refusal itself holds", () => {
  const refused = new SecretRefused({
    code: "secret-name-invalid",
    name: "Sheets Key",
  });
  expect(refused.message).not.toContain("Sheets Key");
  expect(refused.refusal.name).toBe("Sheets Key");
});

test("a value over 64 KiB of UTF-8 is refused, and one of exactly 64 KiB is stored", () => {
  const secrets = open();
  // 3 bytes each in UTF-8: 21,846 of them are 65,538 bytes.
  expect(() => {
    secrets.set("big", "密".repeat(21_846));
  }).toThrow(new SecretRefused({ code: "secret-too-large", name: "big" }));
  expect(secrets.get("big")).toEqual({ kind: "missing" });

  secrets.set("big", "x".repeat(64 * 1024));
  expect(open().get("big")).toEqual({
    kind: "stored",
    value: "x".repeat(64 * 1024),
  });
});

test("a file that cannot be decrypted is no secrets, recorded once per Hub run without its contents", () => {
  open().set("sheets-key", "pk-secret");
  const otherUser: KeyCipher = {
    ...cipher,
    decryptString: () => {
      throw new Error("Error while decrypting the ciphertext provided");
    },
  };
  const events: HubEvent[] = [];
  const hubRun = createPluginSecrets(dataDir, otherUser, (event) =>
    events.push(event),
  );

  expect(hubRun.open(TUTORS).get("sheets-key")).toEqual({ kind: "missing" });
  expect(hubRun.open(TUTORS).get("sheets-key")).toEqual({ kind: "missing" });
  expect(events).toEqual([
    {
      kind: "plugin-secrets-unreadable",
      plugin: TUTORS,
    },
  ]);
});

test.each(['[["Bad Name","x"]]', '[["sheets-key"', "{}"])(
  "a file that decrypts to something else, %s, is no secrets",
  (contents) => {
    mkdirSync(join(dataDir, "plugin-secrets"));
    writeFileSync(
      pluginSecretsFile(dataDir, TUTORS.id),
      cipher.encryptString(contents),
    );
    const events: HubEvent[] = [];

    expect(open((event) => events.push(event)).stored).toEqual(new Map());
    expect(events).toHaveLength(1);
  },
);
