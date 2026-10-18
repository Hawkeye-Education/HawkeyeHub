// Constrained strings the Hub passes around. Each is only made by its parser, at the boundary.

import { isAbsolute } from "node:path";

declare const brand: unique symbol;
type Branded<T, Name extends string> = T & { readonly [brand]: Name };

export type PluginId = Branded<string, "PluginId">;
export type PluginVersion = Branded<string, "PluginVersion">;
export type HubVersion = Branded<string, "HubVersion">;
export type PythonVersion = Branded<string, "PythonVersion">;
export type AiProviderLabel = Branded<string, "AiProviderLabel">;
export type AiProviderKind = Branded<string, "AiProviderKind">;
export type RpcErrorReason = Branded<string, "RpcErrorReason">;
export type AbsolutePath = Branded<string, "AbsolutePath">;

const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
// PLUGIN_STANDARD.md "Ids": kebab-case, at most 64 characters.
const PLUGIN_ID_MAX_LENGTH = 64;
// semver.org's suggested regex.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
// A CPython release as uv names it: X.Y.Z, or a pre-release such as 3.14.0rc1.
const PYTHON_VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:(?:a|b|rc)(0|[1-9]\d*))?$/;

// In every parser below, the check is what makes the string its type; a brand cannot be
// narrowed to, so the `as` after it is the one place the type is granted.

export function parsePluginId(raw: string): PluginId {
  if (raw.length > PLUGIN_ID_MAX_LENGTH || !KEBAB_CASE.test(raw)) {
    throw new Error(`Not a Plugin id: ${JSON.stringify(raw)}`);
  }
  return raw as PluginId;
}

export function parsePluginVersion(raw: string): PluginVersion {
  if (!SEMVER.test(raw)) {
    throw new Error(`Not a Plugin version (semver): ${JSON.stringify(raw)}`);
  }
  return raw as PluginVersion;
}

export function parseHubVersion(raw: string): HubVersion {
  if (!SEMVER.test(raw)) {
    throw new Error(`Not a Hub version (semver): ${JSON.stringify(raw)}`);
  }
  return raw as HubVersion;
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

/** `error.data.reason` of a JSON-RPC error: the kebab-case code every SDK Backend sends. */
export function parseRpcErrorReason(raw: string): RpcErrorReason {
  if (!KEBAB_CASE.test(raw)) {
    throw new Error(`Not a JSON-RPC error reason: ${JSON.stringify(raw)}`);
  }
  return raw as RpcErrorReason;
}

export function parseAbsolutePath(raw: string): AbsolutePath {
  if (!isAbsolute(raw)) {
    throw new Error(`Not an absolute path: ${JSON.stringify(raw)}`);
  }
  return raw as AbsolutePath;
}
