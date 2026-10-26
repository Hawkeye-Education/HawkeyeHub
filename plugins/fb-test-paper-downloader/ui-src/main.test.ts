// The Plugin UI through the DOM and a fake window.hub, as staff and the Hub use it (§9.1).

import {
  backendError,
  installFakeHub,
  type FakeHub,
} from "@hawkeye-hub/fake-hub";
import { browse } from "@hawkeye-hub/fake-hub/hub-kit";
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
});

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
