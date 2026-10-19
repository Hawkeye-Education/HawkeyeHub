import { parseManifest, type Manifest } from "@hawkeye-hub/plugin-format";
import { expect, test } from "vitest";
import { parseAbsolutePath } from "./ids";
import { createLifecycle } from "./lifecycle";

function installed(id: string, name: unknown) {
  const parsed = parseManifest({
    id,
    version: "1.0.0",
    hubApi: "^1.0.0",
    name,
    description: "A fixture.",
    platforms: ["win32-x64"],
    identity: { kind: "none" },
    stores: [],
    backend: { kind: "none" },
    assistant: { kind: "none" },
  });
  if (parsed.kind === "invalid") throw new Error(parsed.reason);
  const manifest: Manifest = parsed.manifest;
  return { folder: parseAbsolutePath(`/plugins/${id}@1.0.0`), manifest };
}

const plugins = [
  installed("class-timer", { "en-HK": "Timer", "zh-HK": "計時器" }),
  installed("attendance", { "en-HK": "Attendance", "zh-HK": "點名" }),
  installed("seating-plan", "Seating Plan"),
];

test("the snapshot lists every installed Plugin by its en-HK name, sorted", () => {
  expect(createLifecycle("en-HK", plugins).snapshot()).toEqual({
    displayLanguage: "en-HK",
    plugins: [
      { id: "attendance", name: "Attendance", access: { kind: "openable" } },
      {
        id: "seating-plan",
        name: "Seating Plan",
        access: { kind: "openable" },
      },
      { id: "class-timer", name: "Timer", access: { kind: "openable" } },
    ],
  });
});

test("in zh-HK the snapshot uses zh-HK names, falls back to English, and sorts by them", () => {
  expect(
    createLifecycle("zh-HK", plugins)
      .snapshot()
      .plugins.map(({ name }) => name),
    // ICU's zh-HK collation: Han by stroke count (計 9, 點 17), then Latin.
  ).toEqual(["計時器", "點名", "Seating Plan"]);
});
