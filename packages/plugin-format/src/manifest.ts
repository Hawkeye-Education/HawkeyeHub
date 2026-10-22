// The Manifest (ADR 0010, PLUGIN_STANDARD.md §3): every field required, no extra keys, closed
// `{kind}` unions. This schema is the one source of truth; the `Manifest` type is inferred from it.

import semver from "semver";
import { z } from "zod";

// PLUGIN_STANDARD.md §2: lowercase kebab-case, at most 64 characters. Shared Store names too.
export const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const ID_MAX_LENGTH = 64;
const kebabName = z.string().max(ID_MAX_LENGTH).regex(KEBAB_CASE);

// The one definition of a Plugin id and version: the Hub parses its own inputs with these too.
export const PluginId = kebabName.brand<"PluginId">();
export const StoreName = kebabName.brand<"StoreName">();
export const PluginVersion = z
  .string()
  .refine((raw) => semver.valid(raw) === raw, "must be a semver version")
  .brand<"PluginVersion">();
const HubApiRange = z
  .string()
  .refine((raw) => semver.validRange(raw) !== null, "must be a semver range")
  .brand<"HubApiRange">();
// A Python minor, such as "3.12", which `requires-python` must agree with.
const PythonMinor = z
  .string()
  .regex(/^3\.(0|[1-9]\d*)$/)
  .brand<"PythonMinor">();
const RoleName = z.string().min(1).brand<"RoleName">();

// Display text (ADR 0007): a plain English string, or a map of exact Display Language tags that
// includes `en-HK`. `zh-HK` is absent until a translation exists.
const text = z.string().min(1);
const DisplayText = z.union(
  [text, z.strictObject({ "en-HK": text, "zh-HK": text.exactOptional() })],
  {
    error:
      "Display text must be a plain English string, or a map holding en-HK and optionally zh-HK",
  },
);

const Manifest = z.strictObject({
  id: PluginId,
  version: PluginVersion,
  hubApi: HubApiRange,
  name: DisplayText,
  description: DisplayText,
  platforms: z.array(z.enum(["win32-x64", "darwin-arm64"])).min(1),
  identity: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }),
    z.strictObject({ kind: z.literal("required"), roles: z.array(RoleName) }),
  ]),
  stores: z.array(StoreName),
  backend: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }),
    z.strictObject({ kind: z.literal("python"), python: PythonMinor }),
  ]),
  assistant: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("none") }),
    z.strictObject({
      kind: z.literal("enabled"),
      templates: z.array(
        z.strictObject({ label: DisplayText, text: DisplayText }),
      ),
    }),
  ]),
});

export type Manifest = z.infer<typeof Manifest>;
export type PluginId = z.infer<typeof PluginId>;
export type PluginVersion = z.infer<typeof PluginVersion>;
export type StoreName = z.infer<typeof StoreName>;
export type PythonMinor = z.infer<typeof PythonMinor>;
export type DisplayText = z.infer<typeof DisplayText>;

export type ManifestParse =
  { kind: "valid"; manifest: Manifest } | { kind: "invalid"; reason: string };

/** Parses the contents of a `manifest.json`, already read as JSON. */
export function parseManifest(json: unknown): ManifestParse {
  const result = Manifest.safeParse(json);
  return result.success
    ? { kind: "valid", manifest: result.data }
    : { kind: "invalid", reason: z.prettifyError(result.error) };
}
