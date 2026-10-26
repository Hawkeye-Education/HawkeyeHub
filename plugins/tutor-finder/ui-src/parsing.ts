// Turns the tutor sheet's raw rows into tutor records, by the rules the source app's SPEC §3 fixes
// (ported from its app/parsing.py). Parse forgivingly: a tutor never disappears from search
// because of a formatting quirk. Pure: rows in, records out, nothing logged.
//
// JS `\b` is ASCII-only where Python's is Unicode, so a level word run straight into Chinese
// ("IB數學") is found here where the source missed it. That is the forgiving direction.

/** The eleven canonical levels (SPEC §3.2), in the order the level filter lists them. */
export const LEVELS = [
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
] as const;
export type Level = (typeof LEVELS)[number];

// The level token is the first of these to match, so order matters: IGCSE before GCSE, A-Level
// before the bare IB check.
const LEVEL_PATTERNS: readonly (readonly [Level, RegExp])[] = [
  ["SAT", /\bsat\b/],
  ["AP", /\bap\b(?!p)/],
  ["IELTS", /\bielts\b/],
  ["IGCSE", /igcse/],
  ["GCSE", /(?<!i)gcse/],
  ["HKDSE", /hkdse|\bdse\b/],
  ["A-Level", /\bi?a[\s_-]?levels?\b|\bgce\b|\bials?\b/],
  ["IB", /\bib\b|\bibdp\b|\bmyp\b/],
  ["Primary", /\bprimary\b|小學|小学/],
  ["Secondary", /\bsecondary\b|中學|中学|\bjunior\s+form/],
  ["University", /\buniversity\b|\buni\b|大學|大学|\bundergrad/],
];

// Anchor the price on the currency marker, not on whitespace: Expect Salary separates label from
// price with a tab, spaces, a colon or alignment padding.
const PRICE = /(?:hkd|hk\$|\$)\s*\$?\s*([\d,]{2,6})/i;
const BARE_PRICE = /\b([\d,]{3,6})\b/;

// Semicolons and newlines only, never a comma: the two comma-containing cells disagree about
// what the comma means, so no shape-based rule can separate them (SPEC §3.1).
const SPLIT = /[;\n\r]+/;

export const REGIONS = [
  "Hong Kong Island",
  "Kowloon",
  "New Territories",
] as const;
export type Region = (typeof REGIONS)[number];

/** The 18 districts (SPEC §3.3). The map draws every one, tutors or not. */
export const DISTRICTS = {
  central_western: {
    en: "Central and Western",
    zh: "中西區",
    region: "Hong Kong Island",
  },
  wan_chai: { en: "Wan Chai", zh: "灣仔區", region: "Hong Kong Island" },
  eastern: { en: "Eastern", zh: "東區", region: "Hong Kong Island" },
  southern: { en: "Southern", zh: "南區", region: "Hong Kong Island" },
  yau_tsim_mong: { en: "Yau Tsim Mong", zh: "油尖旺區", region: "Kowloon" },
  sham_shui_po: { en: "Sham Shui Po", zh: "深水埗區", region: "Kowloon" },
  kowloon_city: { en: "Kowloon City", zh: "九龍城區", region: "Kowloon" },
  wong_tai_sin: { en: "Wong Tai Sin", zh: "黃大仙區", region: "Kowloon" },
  kwun_tong: { en: "Kwun Tong", zh: "觀塘區", region: "Kowloon" },
  kwai_tsing: { en: "Kwai Tsing", zh: "葵青區", region: "New Territories" },
  tsuen_wan: { en: "Tsuen Wan", zh: "荃灣區", region: "New Territories" },
  tuen_mun: { en: "Tuen Mun", zh: "屯門區", region: "New Territories" },
  yuen_long: { en: "Yuen Long", zh: "元朗區", region: "New Territories" },
  north: { en: "North", zh: "北區", region: "New Territories" },
  tai_po: { en: "Tai Po", zh: "大埔區", region: "New Territories" },
  sha_tin: { en: "Sha Tin", zh: "沙田區", region: "New Territories" },
  sai_kung: { en: "Sai Kung", zh: "西貢區", region: "New Territories" },
  islands: { en: "Islands", zh: "離島區", region: "New Territories" },
} as const satisfies Record<string, { en: string; zh: string; region: Region }>;
export type DistrictId = keyof typeof DISTRICTS;

// Strip 區 from the Chinese and an optional " District" from the English, optional because
// Wan Chai appears both with and without it (SPEC §3.3).
const DISTRICT_LOOKUP = new Map<string, DistrictId>(
  // Object.keys is typed string[]; DISTRICTS is a literal object, so its keys are exactly DistrictId.
  (Object.keys(DISTRICTS) as DistrictId[]).flatMap((id) => {
    const { en, zh } = DISTRICTS[id];
    return [
      [en.toLowerCase(), id],
      [`${en} district`.toLowerCase(), id],
      [zh, id],
      [zh.replace(/區$/, ""), id],
    ] as const;
  }),
);

/** One line of a tutor's Subject cell. */
export interface Offering {
  /** null: an unlevelled offering, which matches every level filter (SPEC §3.4). */
  level: Level | null;
  text: string;
  /** HKD per hour; null where no Expect Salary line pairs with it. */
  price: number | null;
}

interface PriceLine {
  label: string;
  price: number;
  level: Level | null;
}

/** `s` with any of `chars` removed from both ends, like Python's `str.strip(chars)`. */
function strip(s: string, chars: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && chars.includes(s.charAt(start))) start++;
  while (end > start && chars.includes(s.charAt(end - 1))) end--;
  return s.slice(start, end);
}

/** An offering or price label for exact matching: lowercase, no punctuation, no currency, no per-hour filler. */
function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[:：;,.|()[\]/\\]/g, " ")
    .replace(/\b(hkd|per|hr|hour|each|lesson)\b/g, " ")
    .replace(/\$\s*[\d,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The first canonical level word in the text, or null for an unlevelled offering. */
export function findLevel(text: string): Level | null {
  const lower = text.toLowerCase();
  for (const [level, pattern] of LEVEL_PATTERNS)
    if (pattern.test(lower)) return level;
  return null;
}

/** A Subject or Expect Salary cell, split on semicolons and newlines only. */
export function splitLines(cell: string): string[] {
  return cell
    .split(SPLIT)
    .map((part) => strip(part, " ;\t"))
    .filter((part) => part !== "");
}

function parsePriceLine(line: string): PriceLine | null {
  const m = PRICE.exec(line) ?? BARE_PRICE.exec(line);
  // Both patterns have one capture group, so a match always has m[1].
  if (m?.[1] === undefined) return null;
  const label = line.slice(0, m.index);
  return {
    label: strip(label, " :：-\t"),
    price: Number(m[1].replaceAll(",", "")),
    level: findLevel(label) ?? findLevel(line),
  };
}

// Exact normalised match first. Containment and level-only are a safety net the source measured
// never firing on the real sheet (SPEC §3.1).
function matchPrice(
  offering: string,
  lines: readonly PriceLine[],
): PriceLine | null {
  const target = norm(offering);
  if (target !== "") {
    const exact = lines.find((p) => norm(p.label) === target);
    if (exact !== undefined) return exact;
    const contained = lines.find((p) => {
      const label = norm(p.label);
      return label !== "" && (label.includes(target) || target.includes(label));
    });
    if (contained !== undefined) return contained;
  }
  const level = findLevel(target);
  if (level !== null) {
    const sameLevel = lines.filter((p) => p.level === level);
    if (sameLevel.length === 1 && sameLevel[0] !== undefined)
      return sameLevel[0];
  }
  if (lines.length === 1 && lines[0] !== undefined) return lines[0];
  return null;
}

/** A raw District cell as one of the 18 ids, or null where it is blank or unknown. */
export function canonicalDistrict(raw: string): DistrictId | null {
  const value = raw.trim();
  return (
    DISTRICT_LOOKUP.get(value.toLowerCase()) ??
    DISTRICT_LOOKUP.get(value) ??
    null
  );
}

/** Mr/Miss <LastName>; the untitled full name where gender is withheld; the first name where
 * there is no last name (SPEC §3.5). */
export function displayName(
  first: string,
  last: string,
  gender: string,
): string {
  const surname = last.trim() === "" ? first.trim() : last.trim();
  switch (gender.trim()) {
    case "Male":
      return `Mr ${surname}`;
    case "Female":
      return `Miss ${surname}`;
    default:
      return fullName(first, last);
  }
}

function fullName(first: string, last: string): string {
  return [first.trim(), last.trim()].filter((p) => p !== "").join(" ");
}

/** The Status column, which is shown and never filtered on (SPEC §4.5). */
export type Status =
  | { kind: "available" } // blank, as every new row arrives
  | { kind: "no-longer-available" } // pinned last in every sort
  | { kind: "other"; text: string }; // shown as raw text, so a typo never hides a tutor

// Statuses that never reach the roster at all (SPEC §4.5).
const HIDDEN_STATUSES = new Set(["Blacklisted", "Can't reached"]);

export interface Tutor {
  /** The tutor's row number in the sheet, header row being 1. */
  row: number;
  /** Mr/Miss <LastName>, as the table and profile message show it. */
  name: string;
  /** <FirstName> <LastName>, as the phone list message shows it. */
  fullName: string;
  /** Lives in Plugin UI memory only: never stored, never logged. */
  phone: string;
  /** null where the District cell is blank or unknown. */
  district: DistrictId | null;
  faceToFace: boolean;
  /** Doing face-to-face implies being able to teach online. */
  online: boolean;
  zoomOnly: boolean;
  languages: string[];
  offerings: Offering[];
  status: Status;
  /** our_version_description, else Self_introduction_chi, else Self_introduction_eng. */
  intro: string;
  remark: string;
}

/**
 * The whole sheet as the tutors staff can search: `rows` is the Sheets API value grid, header row
 * first. Columns are found by header name, never by index, and a missing header or a row cut
 * short reads blank, which lets Status be inserted anywhere or removed (SPEC §2).
 */
export function parseRows(rows: readonly (readonly string[])[]): Tutor[] {
  const [header, ...body] = rows;
  if (header === undefined) return [];
  const index = new Map(header.map((name, i) => [name.trim(), i]));
  return body.flatMap((cells, i) => {
    const cell = (name: string): string => {
      const at = index.get(name);
      return (at === undefined ? undefined : cells[at]) ?? ""; // blank, by SPEC §2 above
    };
    if (cells.every((c) => c.trim() === "")) return [];
    const statusText = cell("Status").trim();
    if (HIDDEN_STATUSES.has(statusText)) return [];

    const first = cell("FirstName");
    const last = cell("LastName");
    const method = cell("tutoring_method");
    const faceToFace = method.includes("Face-to-face");
    // Some tutors ticked Face-to-face without Online; they are online-capable, not a third case.
    const online = method.includes("Online") || faceToFace;
    const intro = [
      "our_version_description",
      "Self_introduction_chi",
      "Self_introduction_eng",
    ]
      .map((name) => cell(name).trim())
      .find((text) => text !== "");
    return [
      {
        row: i + 2,
        name: displayName(first, last, cell("Gender")),
        fullName: fullName(first, last),
        phone: cell("Phone").trim(),
        district: canonicalDistrict(cell("District")),
        faceToFace,
        online,
        zoomOnly: online && !faceToFace,
        languages: cell("tutoring_language")
          .split(",")
          .map((l) => l.trim())
          .filter((l) => l !== ""),
        offerings: parseOfferings(cell("Subject"), cell("Expect Salary")),
        status: parseStatus(statusText),
        intro: intro ?? "", // a tutor who wrote no introduction has an empty one
        remark: cell("Interview remark").trim(),
      },
    ];
  });
}

function parseStatus(text: string): Status {
  switch (text) {
    case "":
      return { kind: "available" };
    case "No longer available":
      return { kind: "no-longer-available" };
    default:
      return { kind: "other", text };
  }
}

/** One offering per Subject line, priced from the paired Expect Salary line. */
export function parseOfferings(subject: string, salary: string): Offering[] {
  const lines = splitLines(salary).flatMap((line) => {
    const parsed = parsePriceLine(line);
    return parsed === null ? [] : [parsed];
  });
  return splitLines(subject).map((text) => ({
    level: findLevel(text),
    text,
    price: matchPrice(text, lines)?.price ?? null,
  }));
}
