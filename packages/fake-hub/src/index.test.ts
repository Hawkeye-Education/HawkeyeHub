import { expect, test } from "vitest";
import type { FolderPath } from "@hawkeye-hub/hub-api";
import { backendError, installFakeHub } from "./index";

const manifest = {
  id: "fixture",
  version: "1.0.0",
  hubApi: "^1.3.0",
  name: "Fixture",
  description: "A fixture Plugin",
  platforms: ["win32-x64"],
  identity: { kind: "none" },
  stores: [],
  backend: { kind: "python", python: "3.12" },
  assistant: { kind: "none" },
};

test("a scripted Backend request answers the UI and is recorded", async () => {
  const fake = installFakeHub({ manifest, displayLanguage: "zh-HK" });
  fake.backend.handle("listPdfs", (params) => ({ echoed: params }));

  expect(window.hub.displayLanguage).toBe("zh-HK");
  await expect(
    window.hub.backend?.request("listPdfs", { folder: "C:\\pdfs" }),
  ).resolves.toEqual({ echoed: { folder: "C:\\pdfs" } });
  expect(fake.backend.requests).toEqual([
    { method: "listPdfs", params: { folder: "C:\\pdfs" } },
  ]);
});

test("a Backend notification reaches the UI's subscribers until it unsubscribes", async () => {
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  const seen: unknown[] = [];
  const unsubscribe = window.hub.backend?.onNotification("progress", (p) =>
    seen.push(p),
  );

  fake.backend.emit("progress", { done: 1 });
  unsubscribe?.();
  fake.backend.emit("progress", { done: 2 });
  await window.hub.backend?.notify("cancel", { run: 1 });

  expect(seen).toEqual([{ done: 1 }]);
  expect(fake.backend.notifications).toEqual([
    { method: "cancel", params: { run: 1 } },
  ]);
});

test("Busy is set with its reason and cleared", async () => {
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  expect(fake.busy.state).toEqual({ kind: "idle" });

  await window.hub.busy.set("Removing watermarks");
  expect(fake.busy.state).toEqual({
    kind: "busy",
    reason: "Removing watermarks",
  });

  await window.hub.busy.clear();
  expect(fake.busy.state).toEqual({ kind: "idle" });
});

test("pickFolder answers with each queued pick in turn, and opened folders are recorded", async () => {
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  fake.files.queuePick({ kind: "chosen", path: "C:\\pdfs" as FolderPath });
  fake.files.queuePick({ kind: "cancelled" });

  await expect(window.hub.files.pickFolder("Input folder")).resolves.toEqual({
    kind: "chosen",
    path: "C:\\pdfs",
  });
  await expect(window.hub.files.pickFolder("Output folder")).resolves.toEqual({
    kind: "cancelled",
  });
  await window.hub.files.openFolder("C:\\out");
  expect(fake.files.opened).toEqual(["C:\\out"]);
});

test("openFolder rejects with the HubError scripted for the next open only", async () => {
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  const denied = {
    code: "folder-not-opened",
    path: "C:\\out",
    message: "Access denied",
  } as const;
  fake.files.failNextOpen(denied);

  await expect(window.hub.files.openFolder("C:\\out")).rejects.toEqual(denied);
  await window.hub.files.openFolder("C:\\out");
  expect(fake.files.opened).toEqual(["C:\\out", "C:\\out"]);
});

const chatRequest = {
  model: { kind: "default" },
  system: "Draft a regex.",
  messages: [
    { role: "user", content: [{ type: "text", text: "CONFIDENTIAL" }] },
  ],
} as const;

test("ai.chat streams the queued reply in pieces and records the chat", async () => {
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  fake.ai.queueReply("Try ^CONFIDENTIAL$ here");

  const chat = window.hub.ai.chat(chatRequest);
  const pieces: string[] = [];
  for await (const piece of chat.text) pieces.push(piece);

  expect(pieces.length).toBeGreaterThan(1);
  expect(pieces.join("")).toBe("Try ^CONFIDENTIAL$ here");
  await expect(chat.done).resolves.toBe("Try ^CONFIDENTIAL$ here");
  expect(fake.ai.chats).toEqual([chatRequest]);
});

test("a cancelled chat is done with what had arrived", async () => {
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  fake.ai.queueReply("one two three");

  const chat = window.hub.ai.chat(chatRequest);
  const pieces: string[] = [];
  for await (const piece of chat.text) {
    pieces.push(piece);
    chat.cancel();
  }

  expect(pieces).toEqual(["one "]);
  await expect(chat.done).resolves.toBe("one ");
});

test("a Backend rejection reaches the UI as the HubError backendError builds", async () => {
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  fake.backend.handle("run", () => {
    // A HubError is a plain object by contract (hub-api), so this throws no Error.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw backendError("same-folder", "input and output are the same folder");
  });

  await expect(window.hub.backend?.request("run", {})).rejects.toEqual({
    code: "backend-error",
    rpc: {
      code: -32000,
      message: "input and output are the same folder",
      data: { reason: "same-folder" },
    },
  });
});

test("settle waits for pending Hub calls and what the UI does with them", async () => {
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  fake.backend.handle(
    "slow",
    () =>
      new Promise((resolve) =>
        setTimeout(() => {
          resolve("ready");
        }, 20),
      ),
  );
  fake.ai.queueReply("drafted regex");
  const shown: unknown[] = [];
  void window.hub.backend?.request("slow", {}).then((r) => shown.push(r));
  void window.hub.ai.chat(chatRequest).done.then((r) => shown.push(r));

  await fake.settle();

  expect(shown).toEqual(["drafted regex", "ready"]);
});

test("a request with no handler fails settle, even when the UI catches it", async () => {
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  window.hub.backend?.request("unscripted", {}).catch(() => undefined);

  await expect(fake.settle()).rejects.toThrow("unscripted");
});

test("a Manifest without a Backend gives no hub.backend", () => {
  installFakeHub({
    manifest: { ...manifest, backend: { kind: "none" } },
    displayLanguage: "en-HK",
  });
  expect(window.hub.backend).toBeUndefined();
});

test("an invalid Manifest is refused", () => {
  expect(() =>
    installFakeHub({ manifest: { id: "fixture" }, displayLanguage: "en-HK" }),
  ).toThrow();
});

test("a Manifest declaring Shared Stores is refused until the fake has them", () => {
  expect(() =>
    installFakeHub({
      manifest: { ...manifest, stores: ["notes"] },
      displayLanguage: "en-HK",
    }),
  ).toThrow("stores");
});

test("secrets seeded by the test read back, and what the UI sets or removes shows in the store", async () => {
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  fake.secrets.stored.set("sheets-key", "pk-seeded");

  await expect(window.hub.secrets.get("sheets-key")).resolves.toEqual({
    kind: "stored",
    value: "pk-seeded",
  });
  await expect(window.hub.secrets.get("sheet-id")).resolves.toEqual({
    kind: "missing",
  });
  await window.hub.secrets.set("sheet-id", "abc");
  await window.hub.secrets.remove("sheets-key");

  expect(fake.secrets.stored).toEqual(new Map([["sheet-id", "abc"]]));
});

test("secrets refuse a bad name and a value over 64 KiB, as the Hub does", async () => {
  installFakeHub({ manifest, displayLanguage: "en-HK" });

  await expect(window.hub.secrets.get("Sheets Key")).rejects.toEqual({
    code: "secret-name-invalid",
    name: "Sheets Key",
  });
  await expect(
    window.hub.secrets.set("big", "密".repeat(21_846)),
  ).rejects.toEqual({ code: "secret-too-large", name: "big" });
  await expect(
    window.hub.secrets.set("big", "x".repeat(64 * 1024)),
  ).resolves.toBeUndefined();
});
