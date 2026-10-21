// Constrained strings the Hub passes around. Each is only made by its parser, at the boundary.

import { isAbsolute } from "node:path";
import { KEBAB_CASE } from "@hawkeye-hub/plugin-format";
import { z } from "zod";

// A Plugin id and version are the Manifest's own types, parsed with its schemas (plugin-format's
// `PluginId.parse`, `PluginVersion.parse`), so they are checked by one rule and parsed only once.
export type { PluginId, PluginVersion } from "@hawkeye-hub/plugin-format";
// Shared with the Hub Chrome, which shows it in About.
import type { HubVersion } from "../shared/hub-chrome-ipc";
export type { HubVersion };
import type { Branded } from "../shared/branded";

export type HubApiVersion = Branded<string, "HubApiVersion">;
export type PythonVersion = Branded<string, "PythonVersion">;
export type AiProviderLabel = Branded<string, "AiProviderLabel">;
export type AiProviderKind = Branded<string, "AiProviderKind">;
export type RpcErrorReason = Branded<string, "RpcErrorReason">;
export type AbsolutePath = Branded<string, "AbsolutePath">;

// semver.org's suggested regex.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
// A CPython release as uv names it: X.Y.Z, or a pre-release such as 3.14.0rc1.
const PYTHON_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:(?:a|b|rc)(0|[1-9]\d*))?$/;

// In every parser below, the check is what makes the string its type; a brand cannot be
// narrowed to, so the `as` after it is the one place the type is granted.

export function parseHubVersion(raw: string): HubVersion {
  if (!SEMVER.test(raw)) {
    throw new Error(`Not a Hub version (semver): ${JSON.stringify(raw)}`);
  }
  return raw as HubVersion;
}

export function parseHubApiVersion(raw: string): HubApiVersion {
  if (!SEMVER.test(raw)) {
    throw new Error(`Not a Hub API version (semver): ${JSON.stringify(raw)}`);
  }
  return raw as HubApiVersion;
}

export function parsePythonVersion(raw: string): PythonVersion {
  if (!PYTHON_VERSION.test(raw)) {
    throw new Error(`Not a Python version: ${JSON.stringify(raw)}`);
  }
  return raw as PythonVersion;
}

export function parseAiProviderLabel(raw: string): AiProviderLabel {
  if (raw.trim() === "") {
    throw new Error("An AI Provider label cannot be blank");
  }
  return raw as AiProviderLabel;
}

/** No ADR names the set of AI Provider kinds yet, so a kind is any kebab-case name. */
export function parseAiProviderKind(raw: string): AiProviderKind {
  if (!KEBAB_CASE.test(raw)) {
    throw new Error(`Not an AI Provider kind: ${JSON.stringify(raw)}`);
  }
  return raw as AiProviderKind;
}

/**
 * `error.data.reason` of a JSON-RPC error: the kebab-case code every SDK Backend sends. A schema,
 * not a parser, as it is read inside the Backend's error data, which zod parses whole. As above,
 * the regex makes it the type, and the `as` after it grants the brand.
 */
export const RpcErrorReason = z
  .string()
  .regex(KEBAB_CASE)
  .transform((raw) => raw as RpcErrorReason);

export function parseAbsolutePath(raw: string): AbsolutePath {
  if (!isAbsolute(raw)) {
    throw new Error(`Not an absolute path: ${JSON.stringify(raw)}`);
  }
  return raw as AbsolutePath;
}
