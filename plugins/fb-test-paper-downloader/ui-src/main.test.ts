// The Plugin UI through the DOM and a fake window.hub, as staff and the Hub use it (§9.1).

import {
  backendError,
  installFakeHub,
  type FakeHub,
} from "@hawkeye-hub/fake-hub";
import { browse, logLines } from "@hawkeye-hub/fake-hub/hub-kit";
import type { FolderPath } from "@hawkeye-hub/hub-api";
import type { HubFolderFieldElement } from "@hawkeye-hub/hub-api/hub-kit";
import { beforeEach, expect, test, vi } from "vitest";
import manifest from "../manifest.json";
import page from "./index.html?raw";

// The page's body only: happy-dom would fetch the head's stylesheet and script.
const html = page.slice(
  page.indexOf("<body>") + "<body>".length,
  page.indexOf("</body>"),
);
const OUT = "D:\\Test papers" as FolderPath;

// The test names the element type it knows index.html gives that id.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`no #${id}`);
  return el as T;
};
const text = (id: string): string => $(id).textContent;

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

/** Opens the Plugin UI against a fresh fake Hub. */
async function open(displayLanguage = "en-HK"): Promise<FakeHub> {
  const fake = installFakeHub({ manifest, displayLanguage });
  document.body.innerHTML = html;
  await import("./main");
  return fake;
}

async function signIn(fake: FakeHub): Promise<void> {
  $("sign-in").click();
  await fake.settle();
}

test("the first open shows the default group and no output folder", async () => {
  await open();

  expect($<HTMLInputElement>("group").value).toBe("460403882433823");
  expect($<HubFolderFieldElement>("output").value).toEqual({ kind: "none" });
  expect($<HTMLInputElement>("stop-at-known").checked).toBe(true);
});

test("Plugin Data from version 1 opens with stop-at-known on", async () => {
  localStorage.setItem(
    "settings",
    JSON.stringify({
      v: 1,
      group: "123",
      output: { kind: "chosen", path: OUT },
    }),
  );

  await open();

  expect($<HTMLInputElement>("group").value).toBe("123");
  expect($<HubFolderFieldElement>("output").value).toEqual({
    kind: "chosen",
    path: OUT,
  });
  expect($<HTMLInputElement>("stop-at-known").checked).toBe(true);
});

test("the stop-at-known checkbox survives closing and reopening the Plugin", async () => {
  await open();
  $<HTMLInputElement>("stop-at-known").click();

  vi.resetModules();
  await open();

  expect($<HTMLInputElement>("stop-at-known").checked).toBe(false);
});

/** Opens the Plugin UI with an output folder picked. */
async function openWithOutput(displayLanguage = "en-HK"): Promise<FakeHub> {
  const fake = await open(displayLanguage);
  fake.files.queuePick({ kind: "chosen", path: OUT });
  browse($<HubFolderFieldElement>("output"));
  await fake.settle();
  return fake;
}

const RESULT = {
  saved: 1,
  skippedNotPaper: 1,
  incomplete: 1,
  failed: 1,
  outcome: "finished",
};

test("Update scans the feed, logs one line per post and sums up, while Busy", async () => {
  const fake = await openWithOutput();
  const during: unknown[] = [];
  fake.backend.handle("update", () => {
    during.push(fake.busy.state, $<HTMLButtonElement>("sign-in").disabled);
    fake.backend.emit("progress", { phase: "scan", found: 4 });
    during.push(text("status"));
    const post = { phase: "posts", total: 4 };
    fake.backend.emit("progress", {
      ...post,
      done: 1,
      item: "P2 數學 測驗",
      result: { kind: "saved" },
    });
    fake.backend.emit("progress", {
      ...post,
      done: 2,
      item: "歡迎新成員",
      result: { kind: "skipped-not-paper" },
    });
    fake.backend.emit("progress", {
      ...post,
      done: 3,
      item: "P3 英文",
      result: { kind: "incomplete", saved: 2, shown: 10 },
    });
    fake.backend.emit("progress", {
      ...post,
      done: 4,
      item: "P4 常識",
      result: { kind: "failed", detail: "the CDN dropped the connection" },
    });
    return RESULT;
  });

  $("update").click();
  await fake.settle();

  expect(fake.backend.requests.at(-1)).toEqual({
    method: "update",
    params: { group: "460403882433823", output: OUT, stopAtKnown: true },
  });
  expect(during).toEqual([
    {
      kind: "busy",
      reason:
        "Downloading test papers. Closing now stops the run; papers already saved are kept.",
    },
    true,
    "Scanning the group feed: 4 new posts found.",
  ]);
  expect(logLines($("log"))).toEqual([
    { tone: "success", text: "Saved       P2 數學 測驗" },
    { tone: "info", text: "Skipped     歡迎新成員: not a test paper" },
    {
      tone: "danger",
      text: "Incomplete  P3 英文: only 2 of about 10 images; retried next run",
    },
    {
      tone: "danger",
      text: "Failed      P4 常識: the CDN dropped the connection",
    },
  ]);
  expect($<HTMLProgressElement>("progress").value).toBe(1);
  expect(text("status")).toBe(
    "Done: 1 saved, 1 not papers, 1 incomplete, 1 failed.",
  );
  expect(fake.busy.state).toEqual({ kind: "idle" });
  expect($<HTMLButtonElement>("update").disabled).toBe(false);
  expect($<HTMLButtonElement>("sign-in").disabled).toBe(false);
});

test("Update sends the checkbox as staff left it", async () => {
  const fake = await openWithOutput();
  $<HTMLInputElement>("stop-at-known").click();
  fake.backend.handle("update", () => RESULT);

  $("update").click();
  await fake.settle();

  expect(fake.backend.requests.at(-1)).toMatchObject({
    params: { stopAtKnown: false },
  });
});

test("Update with no output folder asks for one and sends nothing", async () => {
  const fake = await open();

  $("update").click();
  await fake.settle();

  expect(text("status")).toBe("Choose an output folder first.");
  expect(fake.backend.requests).toEqual([]);
  expect(fake.busy.state).toEqual({ kind: "idle" });
});

test("Stop sends cancel, and the summary says the run stopped", async () => {
  const fake = await openWithOutput();
  const finish = Promise.withResolvers<unknown>();
  fake.backend.handle("update", () => finish.promise);

  $("update").click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect($("stop").hidden).toBe(false);
  expect(fake.busy.state.kind).toBe("busy");
  $("stop").click();
  expect(fake.backend.notifications).toEqual([
    { method: "cancel", params: {} },
  ]);
  finish.resolve({ ...RESULT, outcome: "cancelled" });
  await fake.settle();

  expect(text("status")).toBe(
    "Stopped: 1 saved, 1 not papers, 1 incomplete, 1 failed.",
  );
  expect($("stop").hidden).toBe(true);
  expect(fake.busy.state).toEqual({ kind: "idle" });
});

test("4 bad posts in a row say Facebook is limiting the account", async () => {
  const fake = await openWithOutput();
  fake.backend.handle("update", () => ({ ...RESULT, outcome: "bad-streak" }));

  $("update").click();
  await fake.settle();

  expect(text("status")).toBe(
    "Stopped after 4 bad posts in a row: Facebook is probably limiting this account. Wait several hours, then press Update again. (1 saved, 1 incomplete, 1 failed.)",
  );
});

test.each([
  [
    "browser-not-found",
    "Microsoft Edge could not be started. Install or repair Edge, then try again. (detail)",
  ],
  [
    "signed-out",
    "Facebook has signed the Plugin out. Press Sign in to Facebook, then Update again.",
  ],
  [
    "checkpoint",
    "Facebook is asking for a security check. Press Sign in to Facebook and complete it, wait a few hours, then Update again.",
  ],
  [
    "blocked",
    "Facebook has temporarily blocked this account. Stop for today and Update again later; papers already saved are kept.",
  ],
  ["folder-missing", "The output folder no longer exists. Choose it again."],
  [
    "group-invalid",
    "The Facebook group must be a group URL (facebook.com/groups/…) or its number.",
  ],
  ["already-running", "Edge is already open for this Plugin."],
  ["invalid-params", "The Plugin was asked something it cannot do: detail"],
  ["method-not-found", "This version of the Plugin cannot do that: detail"],
  ["internal", "Something went wrong: detail"],
])(
  "an Update rejected with %s says why and clears Busy",
  async (reason, words) => {
    const fake = await openWithOutput();
    fake.backend.handle("update", () => {
      // A HubError is a plain object by contract (hub-api), so this throws no Error.
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw backendError(reason, "detail");
    });

    $("update").click();
    await fake.settle();

    expect(text("status")).toBe(words);
    expect(fake.busy.state).toEqual({ kind: "idle" });
    expect($<HTMLButtonElement>("update").disabled).toBe(false);
    expect($("stop").hidden).toBe(true);
  },
);

test("the group and output folder survive closing and reopening the Plugin", async () => {
  const first = await open();
  const group = $<HTMLInputElement>("group");
  group.value = "https://www.facebook.com/groups/123456789";
  group.dispatchEvent(new Event("change"));
  first.files.queuePick({ kind: "chosen", path: OUT });
  browse($<HubFolderFieldElement>("output"));
  await first.settle();

  vi.resetModules();
  await open();

  expect($<HTMLInputElement>("group").value).toBe(
    "https://www.facebook.com/groups/123456789",
  );
  expect($<HubFolderFieldElement>("output").value).toEqual({
    kind: "chosen",
    path: OUT,
  });
});

test("corrupt Plugin Data fails the open rather than being guessed at", async () => {
  localStorage.setItem("settings", JSON.stringify({ v: 1, group: 7 }));

  await expect(open()).rejects.toThrow();
});

test("Sign in sends one signIn request and says when staff are signed in", async () => {
  const fake = await open();
  const disabledDuring: boolean[] = [];
  fake.backend.handle("signIn", () => {
    disabledDuring.push($<HTMLButtonElement>("sign-in").disabled);
    return { outcome: "signed-in" };
  });

  await signIn(fake);

  expect(fake.backend.requests).toEqual([{ method: "signIn", params: {} }]);
  expect(disabledDuring).toEqual([true]);
  expect($<HTMLButtonElement>("sign-in").disabled).toBe(false);
  expect(text("status")).toBe("Signed in to Facebook.");
});

test("closing the Edge window cancels Sign in", async () => {
  const fake = await open();
  fake.backend.handle("signIn", () => ({ outcome: "cancelled" }));

  await signIn(fake);

  expect(text("status")).toBe(
    "Sign in cancelled: the Edge window was closed before you signed in.",
  );
});

test.each([
  [
    "browser-not-found",
    "Microsoft Edge could not be started. Install or repair Edge, then try again. (no msedge)",
  ],
  ["already-running", "Edge is already open for this Plugin."],
  ["invalid-params", "The Plugin was asked something it cannot do: no msedge"],
  ["method-not-found", "This version of the Plugin cannot do that: no msedge"],
  ["internal", "Something went wrong: no msedge"],
])("a Sign in rejected with %s says why", async (reason, words) => {
  const fake = await open();
  fake.backend.handle("signIn", () => {
    // A HubError is a plain object by contract (hub-api), so this throws no Error.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw backendError(reason, "no msedge");
  });

  await signIn(fake);

  expect(text("status")).toBe(words);
  expect($<HTMLButtonElement>("sign-in").disabled).toBe(false);
});

test("the Plugin UI reads in the Display Language", async () => {
  const fake = await open("zh-HK");
  fake.backend.handle("signIn", () => {
    // A HubError is a plain object by contract (hub-api), so this throws no Error.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw backendError("browser-not-found", "no msedge");
  });

  await signIn(fake);

  expect(text("sign-in")).toBe("登入 Facebook");
  expect(text("status")).toBe(
    "無法啟動 Microsoft Edge。請安裝或修復 Edge，然後再試。（no msedge）",
  );
});
