// The Hub Settings form (#106): Hub Settings as staff edit them, with AI Providers as drafts. Main
// makes the form from what is stored, and Save turns it back into Hub Settings, refusing a form
// that is not valid ones.

import {
  HubSettingsSchema,
  type AiProviderRow,
  type HubSettings,
  type HubSettingsForm,
} from "../shared/hub-settings";
import type { AiProviderKey, SavedProviderKey } from "./ai-keys";
import type { AiProviderLabel } from "./ids";

/** The form showing `settings`: each stored provider in a row of its own, numbered in order. */
export function formOf(settings: HubSettings): HubSettingsForm {
  // The index makes a row unique within the form, and the `as` grants the brand.
  const rowOf = (index: number) => String(index) as AiProviderRow;
  const { aiProviders, defaultAiProvider } = settings;
  return {
    ...settings,
    aiProviders: aiProviders.map(({ label, endpoint, models }, index) => ({
      row: rowOf(index),
      was: { kind: "stored", label },
      label,
      endpoint,
      models,
    })),
    defaultAiProvider:
      defaultAiProvider.kind === "none"
        ? defaultAiProvider
        : {
            kind: "chosen",
            provider: rowOf(
              aiProviders.findIndex(
                ({ label }) => label === defaultAiProvider.provider,
              ),
            ),
            model: defaultAiProvider.model,
          },
  };
}

/** The rows whose provider has a key: one typed for it, or the stored key of the provider it was. */
export function rowsWithKey(
  form: HubSettingsForm,
  typedKeys: ReadonlyMap<AiProviderRow, AiProviderKey>,
  keyed: ReadonlySet<AiProviderLabel>,
): AiProviderRow[] {
  return form.aiProviders.flatMap(({ row, was }) =>
    typedKeys.has(row) || (was.kind === "stored" && keyed.has(was.label))
      ? [row]
      : [],
  );
}

/**
 * The Hub Settings `form` saves as, and what happens to each provider's key, with the keys typed
 * by row and the labels with a stored key; `invalid` when the form is not valid Hub Settings, or
 * an Anthropic provider has no key (the SDK would otherwise read `ANTHROPIC_API_KEY`).
 */
export function settingsFrom(
  form: HubSettingsForm,
  typedKeys: ReadonlyMap<AiProviderRow, AiProviderKey>,
  keyed: ReadonlySet<AiProviderLabel>,
):
  | { kind: "valid"; settings: HubSettings; keys: SavedProviderKey[] }
  | { kind: "invalid" } {
  const withKey = rowsWithKey(form, typedKeys, keyed);
  if (
    form.aiProviders.some(
      ({ row, endpoint }) =>
        endpoint.kind === "anthropic" && !withKey.includes(row),
    )
  ) {
    return { kind: "invalid" };
  }
  const { defaultAiProvider } = form;
  const defaultLabel =
    defaultAiProvider.kind === "chosen"
      ? form.aiProviders.find(({ row }) => row === defaultAiProvider.provider)
          ?.label
      : undefined;
  const parsed = HubSettingsSchema.safeParse({
    ...form,
    aiProviders: form.aiProviders.map(({ label, endpoint, models }) => ({
      label,
      endpoint,
      models,
    })),
    defaultAiProvider:
      defaultAiProvider.kind === "none"
        ? defaultAiProvider
        : { ...defaultAiProvider, provider: defaultLabel },
  });
  if (!parsed.success) return { kind: "invalid" };
  const settings = parsed.data;
  return {
    kind: "valid",
    settings,
    keys: form.aiProviders.map(({ row, was }, index) => {
      const saved = settings.aiProviders[index];
      if (saved === undefined) throw new Error("unreachable: parsed in order");
      const typed = typedKeys.get(row);
      return {
        label: saved.label,
        was,
        key:
          typed === undefined
            ? { kind: "unchanged" }
            : { kind: "replaced", key: typed },
      };
    }),
  };
}
