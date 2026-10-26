// The Plugin UI through the DOM and a fake window.hub, as staff and the Hub use it (§9.1).
// Google is a stubbed `fetch`; the key is generated here, never a real one, and every row is synthetic.

import { installFakeHub, type FakeHub } from "@hawkeye-hub/fake-hub";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import manifest from "../manifest.json";
import page from "./index.html?raw";

// The page's body only: happy-dom would fetch the head's stylesheet and script.
const html = page.slice(
  page.indexOf("<body>") + "<body>".length,
  page.indexOf("</body>"),
);

// The test names the element type it knows index.html gives that id.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`no #${id}`);
  return el as T;
};

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Opens the Plugin UI against a fresh fake Hub. */
async function open(fake: FakeHub): Promise<void> {
  document.body.innerHTML = html;
  await import("./main");
  await fake.settle();
}

test("with no key stored, the setup screen asks for the key file and the roster stays hidden", async () => {
  const fake = installFakeHub({ manifest, displayLanguage: "zh-HK" });
  await open(fake);

  expect($("setup").hidden).toBe(false);
  expect($("roster").hidden).toBe(true);
  expect($<HTMLInputElement>("key-file").type).toBe("file");
  expect($("setup-title").textContent).toBe("Connect the tutor sheet");
});

// --- A throwaway key and a stubbed Google -----------------------------------------------------

const EMAIL = "tutor-finder@example.iam.gserviceaccount.com";
const keys = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
);
const der = new Uint8Array(
  await crypto.subtle.exportKey("pkcs8", keys.privateKey),
);
const base64 = btoa(String.fromCharCode(...der));
const pem = `-----BEGIN PRIVATE KEY-----\n${(base64.match(/.{1,64}/g) ?? []).join("\n")}\n-----END PRIVATE KEY-----\n`;
const keyJson = JSON.stringify({
  type: "service_account",
  project_id: "example",
  client_email: EMAIL,
  private_key: pem,
});

const HEADER = [
  "FirstName",
  "LastName",
  "Phone",
  "Gender",
  "tutoring_method",
  "District",
  "tutoring_language",
  "Subject",
  "Expect Salary",
  "Interview remark",
  "Status",
];
// Synthetic tutors only. Ann is cheapest but No longer available, so she still sorts last.
const ROWS = [
  HEADER,
  [
    "Ann",
    "Au",
    "61110000",
    "Female",
    "Online",
    "",
    "English",
    "IB Maths",
    "IB Maths: $100",
    "",
    "No longer available",
  ],
  [
    "Ben",
    "Chan",
    "62220000",
    "Male",
    "Face-to-face, Online",
    "Sha Tin",
    "Cantonese, English",
    "HKDSE Maths; IB Physics",
    "HKDSE Maths: $300; IB Physics: $500",
    "Punctual",
    "",
  ],
  // Cut short, as Google sends a row whose trailing cells are blank.
  [
    "Cat",
    "Bo",
    "63330000",
    "Female",
    "Online",
    "",
    "Mandarin",
    "IELTS",
    "IELTS $250",
  ],
];

interface Google {
  tokenRequests: URLSearchParams[];
  valueReads: number;
}

/** Stubs `fetch` as Google: each values.get answers with the next of `sheets`, the last repeating. */
function stubGoogle(sheets: string[][][]): Google {
  const google: Google = { tokenRequests: [], valueReads: 0 };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      if (url === "https://oauth2.googleapis.com/token") {
        google.tokenRequests.push(init.body as URLSearchParams);
        return Promise.resolve(
          Response.json({ access_token: "ya29.test", expires_in: 3599 }),
        );
      }
      expect(url).toBe(
        "https://sheets.googleapis.com/v4/spreadsheets/1eMCPW0iBG8wdBCBiu7ueiUrdciWPCVkMGTIoboeeO1s/values/Sheet1",
      );
      expect(new Headers(init.headers).get("authorization")).toBe(
        "Bearer ya29.test",
      );
      const values = sheets[Math.min(google.valueReads, sheets.length - 1)];
      google.valueReads++;
      return Promise.resolve(Response.json({ range: "Sheet1", values }));
    }),
  );
  return google;
}

/** The table's body rows, top to bottom. */
const rows = (): HTMLTableRowElement[] => [
  ...$("table").querySelectorAll<HTMLTableRowElement>("tbody > tr"),
];
const cells = (row: HTMLTableRowElement | undefined): HTMLElement[] => [
  ...(row?.querySelectorAll<HTMLElement>(":scope > td") ?? []),
];
/** Each body row's display name, top to bottom. */
const names = (): string[] =>
  rows().map((r) => cells(r)[0]?.firstElementChild?.textContent ?? "");

function chooseFile(text: string): void {
  const input = $<HTMLInputElement>("key-file");
  Object.defineProperty(input, "files", {
    value: [new File([text], "key.json", { type: "application/json" })],
    configurable: true,
  });
  input.dispatchEvent(new Event("change"));
}

/** Opens the Plugin UI with the key already stored, and waits for the roster. */
async function openWithKey(sheets: string[][][]): Promise<[FakeHub, Google]> {
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  fake.secrets.stored.set("google-service-account", keyJson);
  const google = stubGoogle(sheets);
  await open(fake);
  await vi.waitFor(() => {
    expect($("roster").hidden).toBe(false);
  });
  return [fake, google];
}

test.each([
  [
    "the wrong type",
    { type: "authorized_user", client_email: EMAIL, private_key: "x" },
  ],
  ["no private_key", { type: "service_account", client_email: EMAIL }],
  ["no client_email", { type: "service_account", private_key: "x" }],
])("a key file with %s is refused and nothing is stored", async (_, key) => {
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  const google = stubGoogle([ROWS]);
  await open(fake);

  chooseFile(JSON.stringify(key));
  await vi.waitFor(() => {
    expect($("setup-error").textContent).toBe(
      "That file isn't a Google service-account key. Choose the .json downloaded for the service account. Nothing was saved.",
    );
  });
  expect(fake.secrets.stored.size).toBe(0);
  expect($("setup").hidden).toBe(false);
  expect(google.valueReads).toBe(0);
});

test("a valid key file is stored as the Plugin Secret, then signs in to Google and loads the table", async () => {
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  const google = stubGoogle([ROWS]);
  await open(fake);

  chooseFile(keyJson);
  await vi.waitFor(() => {
    expect($("roster").hidden).toBe(false);
  });

  expect(fake.secrets.stored).toEqual(
    new Map([["google-service-account", keyJson]]),
  );
  expect($("setup").hidden).toBe(true);
  expect(names()).toEqual(["Miss Bo", "Mr Chan", "Miss Au"]);

  // The token request carries an RS256 JWT for the service account, signed by its key.
  const form = google.tokenRequests[0];
  expect(form?.get("grant_type")).toBe(
    "urn:ietf:params:oauth:grant-type:jwt-bearer",
  );
  const [head = "", claims = "", signature = ""] = (
    form?.get("assertion") ?? ""
  ).split(".");
  const bytes = (s: string): Uint8Array<ArrayBuffer> =>
    Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
      c.charCodeAt(0),
    );
  const json = (s: string): unknown =>
    JSON.parse(new TextDecoder().decode(bytes(s)));
  expect(json(head)).toEqual({ alg: "RS256", typ: "JWT" });
  const claimSet = json(claims) as { iat: number; exp: number };
  expect(claimSet).toMatchObject({
    iss: EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
  });
  expect(claimSet.exp - claimSet.iat).toBe(3600);
  await expect(
    crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      keys.publicKey,
      bytes(signature),
      new TextEncoder().encode(`${head}.${claims}`),
    ),
  ).resolves.toBe(true);
});

test("a stored key loads the roster on open: cheapest first, No longer available last, every offering shown, tallied", async () => {
  await openWithKey([ROWS]);

  expect($("setup").hidden).toBe(true);
  expect(names()).toEqual(["Miss Bo", "Mr Chan", "Miss Au"]);
  const [bo, chan, au] = rows();
  const texts = (row: HTMLTableRowElement | undefined): string[] =>
    cells(row).map((c) => c.textContent);
  expect(texts(chan)).toEqual([
    "Mr ChanBen Chan",
    "HKDSEHKDSE MathsHK$300IBIB PhysicsHK$500",
    "Sha Tin",
    "CE",
    "",
    "Punctual",
  ]);
  const offerings = [...(chan?.querySelectorAll(".offering") ?? [])];
  expect(offerings.map((o) => o.textContent)).toEqual([
    "HKDSEHKDSE MathsHK$300",
    "IBIB PhysicsHK$500",
  ]);
  expect(chan?.querySelector(".cheapest")?.textContent).toBe("HK$300");
  expect(texts(bo)[2]).toBe("—Zoom only");
  expect(au?.className).toBe("gone");
  expect(texts(au)[4]).toBe("No longer available");
  expect($("tally").textContent).toBe("3 tutors");
});

test("clicking a header sorts by that column and again reverses it, with No longer available still last", async () => {
  await openWithKey([ROWS]);
  const sortBy = (column: string): void => {
    $<HTMLTableElement>("table")
      .querySelector<HTMLButtonElement>(`[data-column=${column}]`)
      ?.click();
  };

  sortBy("name");
  expect(names()).toEqual(["Miss Bo", "Mr Chan", "Miss Au"]);
  sortBy("name");
  expect(names()).toEqual(["Mr Chan", "Miss Bo", "Miss Au"]);
  sortBy("price");
  expect(names()).toEqual(["Miss Bo", "Mr Chan", "Miss Au"]);
  sortBy("price");
  expect(names()).toEqual(["Mr Chan", "Miss Bo", "Miss Au"]);
});

test("Refresh reads the sheet again and shows what it holds now", async () => {
  const dee = [
    "Dee",
    "Ng",
    "64440000",
    "Female",
    "Online",
    "",
    "English",
    "SAT",
    "SAT $400",
  ];
  const [, google] = await openWithKey([ROWS, [HEADER, dee]]);

  $("refresh").click();
  await vi.waitFor(() => {
    expect(names()).toEqual(["Miss Ng"]);
  });
  expect(google.valueReads).toBe(2);
  expect($("tally").textContent).toBe("1 tutor");
});

test("the roster never reaches console or web storage, and the Plugin is never Busy", async () => {
  const logged = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m),
  );
  const [fake] = await openWithKey([ROWS]);
  $("refresh").click();
  await vi.waitFor(() => {
    expect($<HTMLButtonElement>("refresh").disabled).toBe(false);
  });

  expect(names()).toHaveLength(3);
  for (const spy of logged) expect(spy).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
  expect(fake.busy.state).toEqual({ kind: "idle" });
});
