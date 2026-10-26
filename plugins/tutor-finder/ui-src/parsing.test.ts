// The parsing rules the source app's SPEC §3 fixes, each pinned to the rule it protects. Ported
// from its tests/test_parsing.py, on synthetic rows only.

import { describe, expect, test } from "vitest";
import {
  canonicalDistrict,
  displayName,
  findLevel,
  parseOfferings,
  parseRows,
  splitLines,
} from "./parsing";

describe("3.1 offerings", () => {
  test("splits on semicolons and newlines", () => {
    expect(splitLines("IB Physics; IB Chemistry\nIB Biology")).toEqual([
      "IB Physics",
      "IB Chemistry",
      "IB Biology",
    ]);
  });

  test("never splits on a comma", () => {
    expect(splitLines("HKDSE BAFS (Accounting, Business Management)")).toEqual([
      "HKDSE BAFS (Accounting, Business Management)",
    ]);
  });

  test("pairs an offering to a price by exact normalised match", () => {
    const offerings = parseOfferings(
      "IB Physics\nIB Chemistry",
      "IB Physics\tHKD $450\nIB Chemistry\tHKD $500",
    );
    expect(offerings.map((o) => [o.level, o.price])).toEqual([
      ["IB", 450],
      ["IB", 500],
    ]);
  });

  test.each([
    ["Primary Maths: HKD $300", 300],
    ["Primary Maths     HK$300", 300],
    ["Primary Maths\t$1,200", 1200],
    ["Primary Maths 350", 350], // bare number fallback
  ])("the price in %j anchors on the currency marker", (line, price) => {
    expect(parseOfferings("Primary Maths", line)[0]?.price).toBe(price);
  });
});

describe("3.2 levels", () => {
  test.each([
    ["IGCSE Maths", "IGCSE"], // IGCSE tested before GCSE
    ["GCSE Maths", "GCSE"],
    ["IB Maths", "IB"],
    ["IA_Level Physics", "A-Level"], // A-Level tested before the bare IB check
    ["A_Level Physics", "A-Level"],
    ["DSE Chinese", "HKDSE"],
    ["小學數學", "Primary"],
    ["中學英文", "Secondary"],
    ["大學數學", "University"],
    ["University Entry Exam STEP", "University"],
    ["IELTS speaking", "IELTS"],
    ["SAT Maths", "SAT"],
  ])("%j is %s", (text, level) => {
    expect(findLevel(text)).toBe(level);
  });

  test("an unlevelled offering keeps no level but keeps its price", () => {
    // It matches every level filter rather than none (SPEC §3.4).
    expect(parseOfferings("Cooking", "Cooking $200")).toEqual([
      { level: null, text: "Cooking", price: 200 },
    ]);
  });
});

describe("3.3 districts", () => {
  test.each([
    ["沙田區", "sha_tin"],
    ["Sha Tin District", "sha_tin"],
    ["Wan Chai", "wan_chai"], // the optional " District"
    ["Wan Chai District", "wan_chai"],
    ["", null],
    ["Atlantis", null],
  ])("%j is %s", (raw, district) => {
    expect(canonicalDistrict(raw)).toBe(district);
  });
});

describe("3.5 names", () => {
  test.each([
    ["Tai Man", "Chan", "Male", "Mr Chan"],
    ["Tai Man", "Chan", "Female", "Miss Chan"],
    ["Tai Man", "Chan", "Prefer_not_to_say", "Tai Man Chan"],
    ["Tai Man", "", "Male", "Mr Tai Man"], // falls back to the first name
  ])("%s %s (%s) shows as %j", (first, last, gender, shown) => {
    expect(displayName(first, last, gender)).toBe(shown);
  });
});

describe("2 and 4.5 the sheet as a whole", () => {
  const HEADER = [
    "FirstName",
    "LastName",
    "Gender",
    "Phone",
    "tutoring_method",
    "District",
    "tutoring_language",
    "Subject",
    "Expect Salary",
    "Interview remark",
    "Status",
  ] as const;
  type Column = (typeof HEADER)[number];

  /** A synthetic tutor row in HEADER's column order. */
  function row(overrides: Partial<Record<Column, string>> = {}): string[] {
    const cells: Record<Column, string> = {
      FirstName: "Tai Man",
      LastName: "Chan",
      Gender: "Male",
      Phone: "9000 0001",
      tutoring_method: "Online",
      District: "",
      tutoring_language: "English",
      Subject: "IB Maths",
      "Expect Salary": "IB Maths $400",
      "Interview remark": "",
      Status: "",
      ...overrides,
    };
    return HEADER.map((c) => cells[c]);
  }

  test("hidden statuses never reach the roster", () => {
    const tutors = parseRows([
      [...HEADER],
      row({ Status: "Blacklisted" }),
      row({ Status: "Can't reached" }),
      row({ Status: "No longer available" }),
      row({ Status: "typo'd value" }),
      row(),
    ]);
    expect(tutors.map((t) => t.status)).toEqual([
      { kind: "no-longer-available" },
      { kind: "other", text: "typo'd value" },
      { kind: "available" },
    ]);
  });

  test("a missing column reads blank for every tutor", () => {
    const header = HEADER.filter((c) => c !== "Status");
    const full = row();
    const tutors = parseRows([
      header,
      header.map((c) => full[HEADER.indexOf(c)] ?? ""),
    ]);
    expect(tutors[0]?.status).toEqual({ kind: "available" });
  });

  test("a short row, as the Sheets API sends with trailing blanks cut, reads blank past its end", () => {
    const tutors = parseRows([[...HEADER], row().slice(0, 4)]);
    expect(tutors[0]?.offerings).toEqual([]);
    expect(tutors[0]?.status).toEqual({ kind: "available" });
  });

  test("blank rows are skipped and each tutor keeps its sheet row number", () => {
    const tutors = parseRows([[...HEADER], [], row(), ["", " "], row()]);
    expect(tutors.map((t) => t.row)).toEqual([3, 5]);
  });

  test("face-to-face implies online capability", () => {
    const [tutor] = parseRows([
      [...HEADER],
      row({ tutoring_method: "Face-to-face" }),
    ]);
    expect(tutor).toMatchObject({
      faceToFace: true,
      online: true,
      zoomOnly: false,
    });
  });

  test("an online-only tutor is zoom only and keeps a filled-in district for display", () => {
    // The roster never counts it against a district filter.
    const [tutor] = parseRows([
      [...HEADER],
      row({ tutoring_method: "Online", District: "Wan Chai District" }),
    ]);
    expect(tutor).toMatchObject({
      faceToFace: false,
      zoomOnly: true,
      district: "wan_chai",
    });
  });

  test("the phone is carried in memory for the phone list message", () => {
    expect(parseRows([[...HEADER], row()])[0]?.phone).toBe("9000 0001");
  });

  test("names, languages and the introduction come from their columns", () => {
    const header = [
      ...HEADER,
      "Self_introduction_chi",
      "Self_introduction_eng",
      "our_version_description",
    ];
    const [tutor] = parseRows([
      header,
      [
        ...row({
          Gender: "Female",
          tutoring_language: "Cantonese, English",
          "Interview remark": " Punctual ",
        }),
        "中文介紹",
        "English intro",
        "",
      ],
    ]);
    expect(tutor).toMatchObject({
      name: "Miss Chan",
      fullName: "Tai Man Chan",
      languages: ["Cantonese", "English"],
      intro: "中文介紹",
      remark: "Punctual",
    });
  });

  test("an empty sheet has no tutors", () => {
    expect(parseRows([])).toEqual([]);
  });
});
