// Constrained strings the Hub passes around. Each is only made by its parser, at the boundary.

declare const brand: unique symbol;
type Branded<T, Name extends string> = T & { readonly [brand]: Name };

export type PluginId = Branded<string, "PluginId">;
export type PluginVersion = Branded<string, "PluginVersion">;
export type AiProviderLabel = Branded<string, "AiProviderLabel">;

// PLUGIN_STANDARD.md "Ids".
const PLUGIN_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const PLUGIN_ID_MAX_LENGTH = 64;
// semver.org's suggested regex.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function parsePluginId(raw: string): PluginId {
  if (raw.length > PLUGIN_ID_MAX_LENGTH || !PLUGIN_ID.test(raw)) {
    throw new Error(`Not a Plugin id: ${JSON.stringify(raw)}`);
  }
  // The checks above are what makes a string a PluginId; a brand cannot be narrowed to.
  return raw as PluginId;
}

export function parsePluginVersion(raw: string): PluginVersion {
  if (!SEMVER.test(raw)) {
    throw new Error(`Not a Plugin version (semver): ${JSON.stringify(raw)}`);
  }
  // As above: the semver check is what makes it a PluginVersion.
  return raw as PluginVersion;
}

export function parseAiProviderLabel(raw: string): AiProviderLabel {
  if (raw.trim() === "") {
    throw new Error("An AI Provider label cannot be blank");
  }
  // As above: a non-blank label is an AiProviderLabel.
  return raw as AiProviderLabel;
}
