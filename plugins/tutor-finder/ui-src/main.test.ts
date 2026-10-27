// The Plugin UI through the DOM and a fake window.hub, as staff and the Hub use it (§9.1).
// Google is a stubbed `fetch`; the key is generated here, never a real one, and every row is synthetic.

import { installFakeHub, type FakeHub } from "@hawkeye-hub/fake-hub";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import manifest from "../manifest.json";
import page from "./index.html?raw";
import layout from "./layout.css?raw";
import { PLATES } from "./plates";

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

/** How Google answers one read: the sheet, an HTTP error at one step, or no network at all. */
type Answer =
  string[][] | { step: "token" | "values"; status: number } | "offline";

/** Stubs `fetch` as Google: each read (a token request, then values.get) answers with the next of
 * `answers`, the last repeating. */
function stubGoogle(answers: Answer[]): Google {
  const google: Google = { tokenRequests: [], valueReads: 0 };
  const current = (): Answer =>
    answers[Math.min(google.tokenRequests.length, answers.length) - 1] ??
    "offline";
  /** The error response `step` answers with now, or null when it succeeds. */
  const failure = (step: "token" | "values"): Promise<Response> | null => {
    const answer = current();
    if (answer === "offline")
      return Promise.reject(new TypeError("Failed to fetch"));
    if (Array.isArray(answer) || answer.step !== step) return null;
    return Promise.resolve(
      Response.json({ error: "synthetic" }, { status: answer.status }),
    );
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      if (url === "https://oauth2.googleapis.com/token") {
        google.tokenRequests.push(init.body as URLSearchParams);
        return (
          failure("token") ??
          Promise.resolve(
            Response.json({ access_token: "ya29.test", expires_in: 3599 }),
          )
        );
      }
      expect(url).toBe(
        "https://sheets.googleapis.com/v4/spreadsheets/1eMCPW0iBG8wdBCBiu7ueiUrdciWPCVkMGTIoboeeO1s/values/Sheet1",
      );
      expect(new Headers(init.headers).get("authorization")).toBe(
        "Bearer ya29.test",
      );
      google.valueReads++;
      const failed = failure("values");
      if (failed !== null) return failed;
      const values = current();
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
  ...(row?.querySelectorAll<HTMLElement>(":scope > td:not(.pick)") ?? []),
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
async function openWithKey(answers: Answer[]): Promise<[FakeHub, Google]> {
  const opened = await openWithStoredKey(answers);
  expect($("roster").hidden).toBe(false);
  return opened;
}

/** Opens the Plugin UI with the key already stored, and waits for the first read to finish. */
async function openWithStoredKey(
  answers: Answer[],
): Promise<[FakeHub, Google]> {
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  fake.secrets.stored.set("google-service-account", keyJson);
  const google = stubGoogle(answers);
  await open(fake);
  await vi.waitFor(() => {
    expect(google.tokenRequests).toHaveLength(1);
    expect($<HTMLButtonElement>("refresh").disabled).toBe(false);
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

test("blanks sort last ascending and first descending, as the source app sorts them", async () => {
  const eve = [
    "Eve",
    "Ho",
    "65550000",
    "Female",
    "Online",
    "",
    "English",
    "Piano",
    "",
  ];
  await openWithKey([[...ROWS, eve]]);

  expect(names()).toEqual(["Miss Bo", "Mr Chan", "Miss Ho", "Miss Au"]);
  $<HTMLTableElement>("table")
    .querySelector<HTMLButtonElement>("[data-column=price]")
    ?.click();
  expect(names()).toEqual(["Miss Ho", "Mr Chan", "Miss Bo", "Miss Au"]);
});

test("the name column sorts by last name, also for a tutor shown untitled", async () => {
  const dee = [
    "Dee",
    "Aa",
    "64440000",
    "Prefer_not_to_say",
    "Online",
    "",
    "English",
    "SAT",
    "SAT $400",
  ];
  await openWithKey([[...ROWS, dee]]);

  $<HTMLTableElement>("table")
    .querySelector<HTMLButtonElement>("[data-column=name]")
    ?.click();
  expect(names()).toEqual(["Dee Aa", "Miss Bo", "Mr Chan", "Miss Au"]);
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

// --- Filters (source SPEC §4) -----------------------------------------------------------------

/** Sets a filter control and fires the change event staff would. */
function change(el: HTMLInputElement | HTMLSelectElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event("change"));
}
function tick(el: HTMLInputElement, checked: boolean): void {
  el.checked = checked;
  el.dispatchEvent(new Event("change"));
}
// The test names the element type it knows the filters give that selector.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
const filter = <T extends HTMLElement>(selector: string): T => {
  const el = $("filters").querySelector<T>(selector);
  if (el === null) throw new Error(`no ${selector} in #filters`);
  return el;
};
const level = (): HTMLSelectElement => filter("select");
const method = (value: string): HTMLInputElement =>
  filter(`input[type=radio][value=${value}]`);
const language = (name: string): HTMLInputElement =>
  filter(`input[type=checkbox][value=${name}]`);

test("the filters sit in order: level, how they teach, district, language", async () => {
  await openWithKey([ROWS]);

  const controls = [...$("filters").querySelectorAll("select, input")].map(
    (c) => (c instanceof HTMLInputElement ? `${c.type}:${c.value}` : "select"),
  );
  expect(controls).toEqual([
    "select",
    "radio:face-to-face",
    "radio:online",
    "checkbox:no-district",
    "checkbox:Cantonese",
    "checkbox:English",
    "checkbox:Mandarin",
  ]);
  expect([...level().options].map((o) => o.textContent)).toEqual([
    "All levels",
    "Primary",
    "Secondary",
    "HKDSE",
    "IGCSE",
    "GCSE",
    "IB",
    "A-Level",
    "University",
    "SAT",
    "AP",
    "IELTS",
  ]);
  expect(level().value).toBe("");
  expect(method("online").checked).toBe(true);
  expect($("filters").textContent).toContain("How they teach");
});

test("a level shows only tutors with a matching offering, and only those offerings; unlevelled ones match every level", async () => {
  const eve = [
    "Eve",
    "Ho",
    "65550000",
    "Female",
    "Online",
    "",
    "English",
    "Piano",
    "Piano $200",
  ];
  await openWithKey([[...ROWS, eve]]);

  change(level(), "IB");
  expect(names()).toEqual(["Miss Ho", "Mr Chan", "Miss Au"]);
  const chan = rows()[1];
  expect(
    [...(chan?.querySelectorAll(".offering") ?? [])].map((o) => o.textContent),
  ).toEqual(["IBIB PhysicsHK$500"]);
  expect($("tally").textContent).toBe("3 tutors");

  change(level(), "IELTS");
  expect(names()).toEqual(["Miss Ho", "Miss Bo"]);

  change(level(), "");
  expect(names()).toEqual(["Miss Ho", "Miss Bo", "Mr Chan", "Miss Au"]);
});

test("Face-to-face keeps only tutors who travel; Online, the default, is everyone", async () => {
  await openWithKey([ROWS]);

  tick(method("face-to-face"), true);
  expect(names()).toEqual(["Mr Chan"]);
  expect($("tally").textContent).toBe("1 tutor");

  tick(method("online"), true);
  expect(names()).toEqual(["Miss Bo", "Mr Chan", "Miss Au"]);
});

test("languages match a tutor who speaks any ticked one", async () => {
  await openWithKey([ROWS]);

  tick(language("Mandarin"), true);
  expect(names()).toEqual(["Miss Bo"]);
  tick(language("Cantonese"), true);
  expect(names()).toEqual(["Miss Bo", "Mr Chan"]);
  tick(language("Mandarin"), false);
  expect(names()).toEqual(["Mr Chan"]);
  expect($("tally").textContent).toBe("1 tutor");
  tick(language("Cantonese"), false);
  expect(names()).toHaveLength(3);
});

test("filters combine, and Refresh keeps them", async () => {
  const dee = [
    "Dee",
    "Ng",
    "64440000",
    "Female",
    "Face-to-face",
    "Tai Po",
    "English",
    "IB Chemistry",
    "IB Chemistry $350",
  ];
  await openWithKey([ROWS, [...ROWS, dee]]);

  change(level(), "IB");
  tick(language("English"), true);
  tick(method("face-to-face"), true);
  expect(names()).toEqual(["Mr Chan"]);

  $("refresh").click();
  await vi.waitFor(() => {
    expect(names()).toEqual(["Miss Ng", "Mr Chan"]);
  });
});

// --- When the read fails ------------------------------------------------------------------------

/** The buttons the failure message offers, by their text. */
const actions = (): string[] =>
  [...$("problem").querySelectorAll<HTMLButtonElement>("button")]
    .filter((b) => b.hidden === false)
    .map((b) => b.textContent);

test.each([
  ["the token exchange answers invalid_grant", { step: "token", status: 400 }],
  ["the token exchange answers 401", { step: "token", status: 401 }],
  ["values.get answers 401", { step: "values", status: 401 }],
] as const)(
  "when %s, the key isn't valid and Replace key leads to setup",
  async (_, answer) => {
    await openWithStoredKey([answer]);

    expect($("problem").hidden).toBe(false);
    expect($("problem-message").textContent).toBe(
      "The key isn't valid: Google refused it. Replace it with a current key for the service account.",
    );
    expect(actions()).toEqual(["Replace key"]);
    expect($("roster").hidden).toBe(true);

    $("replace-key").click();
    expect($("setup").hidden).toBe(false);
    expect($("problem").hidden).toBe(true);
  },
);

test("a stored key whose private_key can't be imported isn't valid, and Replace key leads to setup", async () => {
  const fake = installFakeHub({ manifest, displayLanguage: "en-HK" });
  fake.secrets.stored.set(
    "google-service-account",
    JSON.stringify({
      type: "service_account",
      client_email: EMAIL,
      private_key:
        "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----\n",
    }),
  );
  const google = stubGoogle([ROWS]);
  await open(fake);
  await vi.waitFor(() => {
    expect($("problem").hidden).toBe(false);
  });

  expect($("problem-message").textContent).toBe(
    "The key isn't valid: Google refused it. Replace it with a current key for the service account.",
  );
  expect(actions()).toEqual(["Replace key"]);
  expect(google.tokenRequests).toHaveLength(0);
});

test.each([403, 404])(
  "when values.get answers %i, the message names the key's client_email to share the sheet with",
  async (status) => {
    await openWithStoredKey([{ step: "values", status }]);

    expect($("problem-message").textContent).toBe(
      `This key can't see the tutor sheet. Share the sheet with ${EMAIL}, then Retry.`,
    );
    expect(actions()).toEqual(["Retry"]);
    expect($("roster").hidden).toBe(true);
  },
);

test.each([
  ["there is no network", "offline"],
  ["Google answers 503", { step: "values", status: 503 }],
  ["the token exchange answers 500", { step: "token", status: 500 }],
] as const)("when %s, Retry reads the sheet again", async (_, answer) => {
  const [, google] = await openWithStoredKey([answer, ROWS]);

  expect($("problem-message").textContent).toBe(
    "The tutor sheet couldn't be reached. Check the internet connection, then Retry.",
  );
  expect(actions()).toEqual(["Retry"]);
  expect($("roster").hidden).toBe(true);

  $("retry").click();
  await vi.waitFor(() => {
    expect($("roster").hidden).toBe(false);
  });
  expect($("problem").hidden).toBe(true);
  expect(names()).toEqual(["Miss Bo", "Mr Chan", "Miss Au"]);
  expect(google.tokenRequests).toHaveLength(2);
});

test("a failed Refresh keeps the last good table and shows the stale banner, until a read succeeds", async () => {
  await openWithKey([ROWS, "offline", [HEADER, ROWS[3] ?? []]]);
  expect($("stale").hidden).toBe(true);

  $("refresh").click();
  await vi.waitFor(() => {
    expect($("problem").hidden).toBe(false);
  });
  expect($("roster").hidden).toBe(false);
  expect(names()).toEqual(["Miss Bo", "Mr Chan", "Miss Au"]);
  expect($("stale").hidden).toBe(false);
  expect($("stale").textContent).toBe(
    "Refresh failed, so this is the roster as it was last read.",
  );
  expect(actions()).toEqual(["Retry"]);

  $("retry").click();
  await vi.waitFor(() => {
    expect(names()).toEqual(["Miss Bo"]);
  });
  expect($("problem").hidden).toBe(true);
});

test("Replace key under Settings leads to setup, and the new key replaces the old one", async () => {
  const [fake, google] = await openWithKey([ROWS]);
  expect($("settings").hidden).toBe(false);

  $("settings-replace-key").click();
  expect($("setup").hidden).toBe(false);
  expect($("roster").hidden).toBe(true);
  expect($("settings").hidden).toBe(true);

  const newKey = JSON.stringify({
    ...(JSON.parse(keyJson) as object),
    client_email: "other@example.iam.gserviceaccount.com",
  });
  chooseFile(newKey);
  await vi.waitFor(() => {
    expect($("roster").hidden).toBe(false);
  });
  expect(fake.secrets.stored).toEqual(
    new Map([["google-service-account", newKey]]),
  );
  expect(google.tokenRequests).toHaveLength(2);
});

test("Cancel on setup reached from Settings goes back to the roster, keeping the stored key", async () => {
  const [fake] = await openWithKey([ROWS]);

  $("settings-replace-key").click();
  expect($("cancel-setup").hidden).toBe(false);
  $("cancel-setup").click();

  expect($("setup").hidden).toBe(true);
  expect($("roster").hidden).toBe(false);
  expect($("settings").hidden).toBe(false);
  expect(names()).toEqual(["Miss Bo", "Mr Chan", "Miss Au"]);
  expect(fake.secrets.stored.get("google-service-account")).toBe(keyJson);
});

test("first-run setup offers no Cancel, since there is no roster to go back to", async () => {
  await open(installFakeHub({ manifest, displayLanguage: "en-HK" }));

  expect($("setup").hidden).toBe(false);
  expect($("cancel-setup").hidden).toBe(true);
});

test("a failed read logs nothing", async () => {
  const logged = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m),
  );
  await openWithStoredKey([{ step: "values", status: 403 }]);
  $("retry").click();
  await vi.waitFor(() => {
    expect($<HTMLButtonElement>("refresh").disabled).toBe(false);
  });
  for (const spy of logged) expect(spy).not.toHaveBeenCalled();
});

// --- District map (source SPEC §4.3) ------------------------------------------------------------

describe("the district map", () => {
  // Synthetic tutors who travel: Dee to Tai Po, Fay with no district recorded, Gus to Central.
  const travellers = [
    [
      "Dee",
      "Ng",
      "64440000",
      "Female",
      "Face-to-face",
      "Tai Po",
      "English",
      "SAT",
      "SAT $400",
    ],
    [
      "Fay",
      "Lo",
      "66660000",
      "Female",
      "Face-to-face, Online",
      "",
      "English",
      "SAT",
      "SAT $250",
    ],
    [
      "Gus",
      "Ip",
      "67770000",
      "Male",
      "Face-to-face",
      "Central and Western",
      "Cantonese",
      "SAT",
      "SAT $200",
    ],
  ];
  const roster = [...ROWS, ...travellers];

  const plate = (id: string): SVGPathElement => {
    const el = $("filters").querySelector<SVGPathElement>(
      `svg path[data-district=${id}]`,
    );
    if (el === null) throw new Error(`no plate ${id}`);
    return el;
  };
  const tap = (id: string): void => {
    plate(id).dispatchEvent(new MouseEvent("click", { bubbles: true }));
  };
  const region = (name: string): HTMLButtonElement => {
    const found = [
      ...$("filters").querySelectorAll<HTMLButtonElement>("button"),
    ].find((b) => b.textContent === `+ ${name}`);
    if (found === undefined) throw new Error(`no + ${name} button`);
    return found;
  };
  const noDistrict = (): HTMLInputElement =>
    filter("input[type=checkbox][value=no-district]");

  test("every plate is drawn as an inline SVG coloured only by --hub-* tokens", async () => {
    await openWithKey([roster]);

    const svg = filter("svg");
    const plates = [...svg.querySelectorAll("path[data-district]")];
    expect(plates.map((p) => p.getAttribute("data-district"))).toEqual(
      Object.keys(PLATES),
    );
    expect(plates.map((p) => p.getAttribute("d"))).toEqual(
      Object.values(PLATES).map((p) => p.d),
    );
    expect(svg.querySelector("[fill], [stroke], [style]")).toBeNull();
    expect(layout).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  });

  test("the map is armed only by Face-to-face, and leaving Face-to-face clears it", async () => {
    await openWithKey([roster]);

    expect(plate("sha_tin").getAttribute("aria-disabled")).toBe("true");
    expect(region("New Territories").disabled).toBe(true);
    expect(noDistrict().disabled).toBe(true);
    tap("sha_tin");
    expect(names()).toHaveLength(6);

    tick(method("face-to-face"), true);
    expect(plate("sha_tin").getAttribute("aria-disabled")).toBe("false");
    tap("sha_tin");
    expect(plate("sha_tin").getAttribute("aria-pressed")).toBe("true");
    expect(names()).toEqual(["Mr Chan"]);
    // Ann and Cat match level and language but cannot travel.
    expect($("tally").textContent).toBe(
      "1 tutor · 2 online-only hidden by district",
    );

    tick(method("online"), true);
    expect(names()).toHaveLength(6);
    expect($("tally").textContent).toBe("6 tutors");
    tick(method("face-to-face"), true);
    expect(plate("sha_tin").getAttribute("aria-pressed")).toBe("false");
    expect(names()).toHaveLength(4);
  });

  test("a region shortcut selects its districts and again clears them; zero-match districts can still be tapped", async () => {
    await openWithKey([roster]);
    tick(method("face-to-face"), true);

    region("New Territories").click();
    expect(plate("tai_po").getAttribute("aria-pressed")).toBe("true");
    expect(plate("islands").getAttribute("aria-pressed")).toBe("true");
    expect(names()).toEqual(["Mr Chan", "Miss Ng"]);
    region("New Territories").click();
    expect(plate("tai_po").getAttribute("aria-pressed")).toBe("false");
    expect(names()).toHaveLength(4);

    expect(plate("islands").classList.contains("zero")).toBe(true);
    expect(plate("sha_tin").classList.contains("zero")).toBe(false);
    tap("islands");
    expect(names()).toEqual([]);
    expect($("tally").textContent).toBe(
      "0 tutors · 2 online-only hidden by district",
    );
  });

  test("the no-district checkbox adds the tutors who travel but recorded no district", async () => {
    await openWithKey([roster]);
    tick(method("face-to-face"), true);

    expect(noDistrict().checked).toBe(false);
    expect($("filters").textContent).toContain(
      "1 can travel but never filled the field",
    );
    tick(noDistrict(), true);
    expect(names()).toEqual(["Miss Lo"]);
    tap("sha_tin");
    expect(names()).toEqual(["Miss Lo", "Mr Chan"]);

    tick(method("online"), true);
    tick(method("face-to-face"), true);
    expect(noDistrict().checked).toBe(false);
  });
});

// --- Selection and the two WhatsApp messages (source SPEC §5–6) ------------------------------

describe("Selection and messages", () => {
  /** The checkbox that picks the tutor shown as `name`. */
  const pick = (name: string): HTMLInputElement => {
    const row = rows().find(
      (r) => cells(r)[0]?.firstElementChild?.textContent === name,
    );
    const box = row?.querySelector<HTMLInputElement>("input[type=checkbox]");
    if (box === null || box === undefined) throw new Error(`no ${name} row`);
    return box;
  };

  test("a Selection survives filter changes and is counted on the messages button", async () => {
    await openWithKey([ROWS]);
    const write = $<HTMLButtonElement>("write-messages");
    expect(write.disabled).toBe(true);

    tick(pick("Mr Chan"), true);
    tick(pick("Miss Bo"), true);
    expect(write.disabled).toBe(false);
    expect(write.textContent).toBe("Write messages (2 selected)");

    tick(language("Mandarin"), true);
    expect(names()).toEqual(["Miss Bo"]);
    tick(language("Mandarin"), false);
    expect(pick("Mr Chan").checked).toBe(true);
    expect(pick("Miss Bo").checked).toBe(true);
    expect(pick("Miss Au").checked).toBe(false);

    tick(pick("Miss Bo"), false);
    expect(write.textContent).toBe("Write messages (1 selected)");
  });

  const INTRO_HEADER = [
    ...HEADER,
    "Self_introduction_chi",
    "Self_introduction_eng",
    "our_version_description",
  ];
  const chan = [
    ...(ROWS[2] ?? []),
    "我教數學。\n十年經驗。",
    "I teach maths.",
    "",
  ];
  const lam = [
    "Fay",
    "Lam",
    "+852 6777 0000",
    "Female",
    "Online",
    "",
    "English",
    "Piano; IB Maths",
    "",
    "",
    "",
    "原文",
    "",
    "Polished by us.",
  ];
  const wu = [
    "Gus",
    "Wu",
    "",
    "Male",
    "Online",
    "",
    "English",
    "HKDSE Chemistry",
    "$280",
  ];
  const PROFILES = [
    "Mr Chan | IB導師 | $500/hr",
    "我教數學。",
    "十年經驗。",
    "---",
    "Miss Lam | IB導師 | $?/hr",
    "Polished by us.",
    "---",
    "Mr Wu | HKDSE導師 | $?/hr",
    "(no self-introduction on file)",
  ].join("\n");
  const PHONES = [
    "Ben Chan: +852 62220000",
    "Fay Lam: +852 6777 0000",
    "Gus Wu: +852 ?",
  ].join("\n");

  /** Opens on the three tutors above, picks them all, then filters to IB, which hides Mr Wu. */
  async function pickThenFilter(): Promise<void> {
    await openWithKey([[INTRO_HEADER, chan, lam, wu]]);
    for (const name of ["Mr Wu", "Mr Chan", "Miss Lam"]) tick(pick(name), true);
    change(level(), "IB");
    expect(names()).toEqual(["Mr Chan", "Miss Lam"]);
  }

  test("the messages view shows both messages for the Selection, in table order, priced by the level filter", async () => {
    await pickThenFilter();

    $("write-messages").click();
    expect($("messages").hidden).toBe(false);
    expect($("roster").hidden).toBe(true);
    expect($<HTMLTextAreaElement>("profile-message").value).toBe(PROFILES);
    expect($<HTMLTextAreaElement>("phone-message").value).toBe(PHONES);
  });

  test("copy writes the edited text; Back keeps the Selection and filters; re-entering regenerates", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    await pickThenFilter();
    $("write-messages").click();

    const profile = $<HTMLTextAreaElement>("profile-message");
    profile.value = "Edited by staff";
    profile.dispatchEvent(new Event("input"));
    $("copy-profile").click();
    expect(writeText).toHaveBeenLastCalledWith("Edited by staff");
    $("copy-phones").click();
    expect(writeText).toHaveBeenLastCalledWith(PHONES);

    $("back").click();
    expect($("messages").hidden).toBe(true);
    expect($("roster").hidden).toBe(false);
    expect(level().value).toBe("IB");
    expect(names()).toEqual(["Mr Chan", "Miss Lam"]);
    expect(pick("Mr Chan").checked).toBe(true);

    $("write-messages").click();
    expect(profile.value).toBe(PROFILES);
  });
});
