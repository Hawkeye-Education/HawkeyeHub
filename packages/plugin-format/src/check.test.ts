import { expect, test, vi } from "vitest";
import { checkPlugin, type CheckContext } from "./check";
import {
  eraserManifest,
  eraserPlugin,
  writePlugin,
  type PluginFiles,
} from "./fixture-plugin";

// Every check with an Assistant runs skills-ref through uvx, whose first run downloads it.
vi.setConfig({ testTimeout: 60_000 });

const context: CheckContext = {
  hubApiVersion: "1.3.0",
  tag: { kind: "none" },
  storesDir: writePlugin({}),
};

function withManifest(changes: Record<string, unknown>): PluginFiles {
  return {
    ...eraserPlugin(),
    "manifest.json": JSON.stringify({ ...eraserManifest(), ...changes }),
  };
}

function without(files: PluginFiles, prefix: string): PluginFiles {
  return Object.fromEntries(
    Object.entries(files).filter(([path]) => !path.startsWith(prefix)),
  );
}

/** The one problem `check` reports for `files`. */
function problemOf(files: PluginFiles, given: CheckContext = context): string {
  const problems = checkPlugin(writePlugin(files), given);
  expect(problems).toHaveLength(1);
  return problems[0] ?? "";
}

test("a Plugin laid out to PLUGIN_STANDARD passes", () => {
  expect(checkPlugin(writePlugin(eraserPlugin()), context)).toEqual([]);
});

test("a Manifest that fails the schema is refused", () => {
  expect(problemOf(withManifest({ version: "1.0" }))).toMatch(
    /manifest\.json.*version/s,
  );
});

test.each([
  "manifest.json",
  "icon.svg",
  "ui/index.html",
  "backend/pyproject.toml",
  "backend/uv.lock",
  "backend/main.py",
  "agents/assistant.md",
  "agents/skills",
])("a missing %s is refused", (path) => {
  expect(problemOf(without(eraserPlugin(), path))).toContain(path);
});

test("backend/ without a declared Backend is refused", () => {
  expect(problemOf(withManifest({ backend: { kind: "none" } }))).toContain(
    "backend/",
  );
});

test("agents/ without an enabled Assistant is refused", () => {
  expect(problemOf(withManifest({ assistant: { kind: "none" } }))).toContain(
    "agents/",
  );
});

function withPyproject(version: string, requiresPython: string): PluginFiles {
  return {
    ...eraserPlugin(),
    "backend/pyproject.toml": [
      "[project]",
      'name = "pdf-watermark-eraser"',
      `version = "${version}"`,
      `requires-python = "${requiresPython}"`,
    ].join("\n"),
  };
}

test.each([">=3.11", "<3.13", ">=3.13", "==3.11.*"])(
  "requires-python %s disagreeing with backend.python 3.12 is refused",
  (requiresPython) => {
    expect(problemOf(withPyproject("1.0.0", requiresPython))).toContain(
      "requires-python",
    );
  },
);

test.each(["==3.12.*", "~=3.12", ">=3.12,<3.14"])(
  "requires-python %s agrees with backend.python 3.12",
  (requiresPython) => {
    const dir = writePlugin(withPyproject("1.0.0", requiresPython));

    expect(checkPlugin(dir, context)).toEqual([]);
  },
);

test("a pyproject.toml without requires-python is refused", () => {
  const files = {
    ...eraserPlugin(),
    "backend/pyproject.toml": '[project]\nname = "x"\nversion = "1.0.0"',
  };

  expect(problemOf(files)).toContain("requires-python");
});

test("a pyproject.toml version disagreeing with the Manifest is refused", () => {
  expect(problemOf(withPyproject("1.0.1", ">=3.12"))).toMatch(
    /pyproject\.toml.*1\.0\.1.*1\.0\.0/,
  );
});

function withLockedSource(source: string): PluginFiles {
  return {
    ...eraserPlugin(),
    "backend/uv.lock": [
      "version = 1",
      "[[package]]",
      'name = "hawkeye-hub"',
      `source = ${source}`,
    ].join("\n"),
  };
}

test.each([
  '{ directory = "../../../python/hawkeye-hub" }',
  '{ editable = "../sdk" }',
  '{ path = "../sdk/hawkeye_hub-1.0.0-py3-none-any.whl" }',
  '{ git = "https://github.com/x/y" }',
])("a uv.lock installing from %s is refused", (source) => {
  expect(problemOf(withLockedSource(source))).toContain("hawkeye-hub");
});

test.each([
  '{ registry = "https://pypi.org/simple" }',
  '{ url = "https://files.example/hawkeye_hub-1.0.0-py3-none-any.whl" }',
])("a uv.lock installing from %s passes", (source) => {
  expect(checkPlugin(writePlugin(withLockedSource(source)), context)).toEqual(
    [],
  );
});

test("a tag disagreeing with the Manifest is refused", () => {
  const tag = {
    kind: "given",
    tag: "plugin/pdf-watermark-eraser@1.0.1",
  } as const;

  expect(problemOf(eraserPlugin(), { ...context, tag })).toContain(tag.tag);
});

test("the tag plugin/<id>@<version> passes", () => {
  const tag = {
    kind: "given",
    tag: "plugin/pdf-watermark-eraser@1.0.0",
  } as const;

  expect(checkPlugin(writePlugin(eraserPlugin()), { ...context, tag })).toEqual(
    [],
  );
});

test.each(["^1.4.0", ">=2.0.0 <1.0.0"])(
  "a hubApi range %s that Hub API 1.3.0 does not satisfy is refused",
  (hubApi) => {
    expect(problemOf(withManifest({ hubApi }))).toContain("hubApi");
  },
);

test("a declared store without stores/<name>.md is refused", () => {
  expect(problemOf(withManifest({ stores: ["kb"] }))).toContain("stores/kb.md");
});

test("a declared store with stores/<name>.md passes", () => {
  const storesDir = writePlugin({ "kb.md": "# kb" });
  const dir = writePlugin(withManifest({ stores: ["kb"] }));

  expect(checkPlugin(dir, { ...context, storesDir })).toEqual([]);
});

test("a Skill failing skills-ref validate is refused", () => {
  const files = {
    ...eraserPlugin(),
    "agents/skills/draft-regex/SKILL.md":
      "---\nname: Draft Regex\n---\nDraft it.",
  };

  expect(problemOf(files)).toMatch(/agents\/skills\/draft-regex.*skills-ref/s);
});

test("a UI-only Plugin with neither backend/ nor agents/ passes", () => {
  const files = withManifest({
    backend: { kind: "none" },
    assistant: { kind: "none" },
  });
  const uiOnly = without(without(files, "backend/"), "agents/");

  expect(checkPlugin(writePlugin(uiOnly), context)).toEqual([]);
});
