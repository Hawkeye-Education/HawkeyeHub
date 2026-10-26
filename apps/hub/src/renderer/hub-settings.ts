// Hub Settings, drawn in the content area while the open Plugins run hidden behind them: one
// scrolling page of sections. Its Theme section picks among the Themes this Hub has (ADR 0006).

import { LitElement, css, html, nothing } from "lit";
import {
  COLOUR_SCHEMES,
  DISPLAY_LANGUAGES,
  MODEL_INPUTS,
  inputsFor,
  type DisplayLanguage,
  type AiProviderRow,
  type HubChromeApi,
  type HubSettingsForm as SettingsForm,
  type HubVersion,
  type ThemeName,
} from "../shared/hub-chrome-ipc";
import type { AiProviderDraft, AiProviderKind } from "../shared/hub-settings";
import type { Strings } from "./strings";
import { native } from "./theme";

// Each language in itself, whatever the Hub Chrome is drawn in, so staff find theirs (spec #71).
const LANGUAGE_NAMES = {
  "en-HK": "English",
  "zh-HK": "繁體中文",
} satisfies Record<DisplayLanguage, string>;
// A Theme's own name, the same in every Display Language.
const THEME_LABELS = new Map([["hawkeye", "Hawkeye"]]);

// Every handler using these is bound to an <input> or <select>, the event's target.
function inputOf(event: Event): HTMLInputElement {
  return event.target as HTMLInputElement;
}
function valueOf(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement).value;
}

/**
 * The AI Provider kinds, from the names Strings gives each: a `Record<AiProviderKind, string>`
 * checked with `satisfies`, so it has exactly the schema's kinds. Object.keys widens them to string,
 * so the `as` narrows them back.
 */
function kindsOf(names: Record<AiProviderKind, string>): AiProviderKind[] {
  return Object.keys(names) as AiProviderKind[];
}

/** The kind the select chose: one of its own options, so anything else is a bug. */
function chosenKind(
  event: Event,
  names: Record<AiProviderKind, string>,
): AiProviderKind {
  const value = valueOf(event);
  const kind = kindsOf(names).find((each) => each === value);
  if (kind === undefined)
    throw new Error(`No AI Provider kind is called ${value}`);
  return kind;
}

function themeLabel(name: ThemeName): string {
  const label = THEME_LABELS.get(name);
  if (label === undefined) throw new Error(`No label for the Theme ${name}`);
  return label;
}

export class HubSettings extends LitElement {
  static override styles = [
    native,
    css`
      :host {
        display: block;
        height: 100%;
        overflow-y: auto;
        padding: var(--hub-space-5);
        box-sizing: border-box;
      }
      h2 {
        margin: 0 0 var(--hub-space-4);
        font-size: var(--hub-text-xl);
      }
      h3 {
        margin: 0 0 var(--hub-space-2);
        font-size: var(--hub-text-lg);
        font-weight: var(--hub-weight-strong);
      }
      dl {
        display: flex;
        gap: var(--hub-space-2);
      }
      dd {
        margin: 0;
      }
      fieldset {
        display: flex;
        gap: var(--hub-space-4);
        border: none;
        padding: 0;
        margin: 0;
      }
      legend {
        padding: 0;
        margin-bottom: var(--hub-space-2);
      }
      label {
        display: inline-flex;
        align-items: center;
        gap: var(--hub-space-2);
      }
      .provider {
        flex-direction: column;
        align-items: flex-start;
        gap: var(--hub-space-2);
        margin-bottom: var(--hub-space-4);
      }
      .model {
        display: flex;
        align-items: center;
        gap: var(--hub-space-2);
      }
      .actions {
        display: flex;
        gap: var(--hub-space-2);
        margin: var(--hub-space-4) 0 var(--hub-space-6);
      }
    `,
  ];

  static override properties = {
    strings: { attribute: false },
    hubVersion: { attribute: false },
    theme: { attribute: false },
    themes: { attribute: false },
    form: { attribute: false },
    keysSet: { attribute: false },
    savable: { attribute: false },
    languageNoteShowing: { attribute: false },
    hub: { attribute: false },
  };
  // `declare`: a class field would shadow Lit's reactive accessor. The Hub Chrome sets them all
  // through its template before the first render.
  declare strings: Strings;
  declare hubVersion: HubVersion;
  /** The Theme the Hub resolved from what is stored. */
  declare theme: ThemeName;
  /** The Themes this Hub has. */
  declare themes: ThemeName[];
  /** The unsaved form, as main holds it: every control draws from it, and an edit goes to main. */
  declare form: SettingsForm;
  /** The rows whose provider has a key: the key itself never reaches the Hub Chrome. */
  declare keysSet: AiProviderRow[];
  declare savable: boolean;
  declare languageNoteShowing: boolean;
  declare hub: HubChromeApi;

  /** Edits the provider at `index` in the form. */
  private editProvider(
    index: number,
    edit: (provider: AiProviderDraft) => AiProviderDraft,
  ) {
    this.hub.editSettings({
      ...this.form,
      aiProviders: this.form.aiProviders.map((provider, at) =>
        at === index ? edit(provider) : provider,
      ),
    });
  }

  // Text edits go to main on `change`, not on each keystroke, so a snapshot answering an earlier
  // edit never overwrites what staff are still typing.
  private renderAiProviders() {
    const { strings, form } = this;
    const { defaultAiProvider } = form;
    // Each default option's value is its provider's and model's places in the form.
    const choices = form.aiProviders.flatMap(({ row, label, models }) =>
      models.map(({ id }) => ({ row, label, id })),
    );
    // None when the default is `none`, or names a model since renamed (Save then refuses).
    const chosen =
      defaultAiProvider.kind === "chosen"
        ? choices.find(
            ({ row, id }) =>
              row === defaultAiProvider.provider &&
              id === defaultAiProvider.model,
          )
        : undefined;
    return html`<section aria-labelledby="ai-providers">
      <h3 id="ai-providers">${strings.aiProviders}</h3>
      ${form.aiProviders.map(
        (provider, index) =>
          html`<fieldset class="provider">
            <label>
              ${strings.providerLabel}
              <input
                .value=${provider.label}
                @change=${(event: Event) => {
                  const label = valueOf(event);
                  this.editProvider(index, (each) => ({ ...each, label }));
                }}
              />
            </label>
            <label>
              ${strings.providerKind}
              <select
                @change=${(event: Event) => {
                  const kind = chosenKind(event, strings.providerKinds);
                  // An input the new kind cannot send (audio, for Anthropic) is dropped.
                  const offered = inputsFor(kind);
                  this.editProvider(index, (each) => ({
                    ...each,
                    endpoint:
                      kind === "anthropic"
                        ? { kind: "anthropic" }
                        : { kind: "openai-compatible", baseUrl: "" },
                    models: each.models.map((model) => ({
                      ...model,
                      inputs: model.inputs.filter((input) =>
                        offered.includes(input),
                      ),
                    })),
                  }));
                }}
              >
                ${kindsOf(strings.providerKinds).map(
                  (kind) =>
                    html`<option
                      value=${kind}
                      ?selected=${provider.endpoint.kind === kind}
                    >
                      ${strings.providerKinds[kind]}
                    </option>`,
                )}
              </select>
            </label>
            ${
              provider.endpoint.kind === "openai-compatible"
                ? html`<label>
                    ${strings.baseUrl}
                    <input
                      type="url"
                      .value=${provider.endpoint.baseUrl}
                      @change=${(event: Event) => {
                        const baseUrl = valueOf(event);
                        this.editProvider(index, (each) => ({
                          ...each,
                          endpoint: { kind: "openai-compatible", baseUrl },
                        }));
                      }}
                    />
                  </label>`
                : nothing
            }
            <label>
              ${strings.key}
              <input
                type="password"
                autocomplete="off"
                @change=${(event: Event) => {
                  const input = inputOf(event);
                  if (input.value.trim() !== "") {
                    this.hub.typeAiKey(provider.row, input.value);
                  }
                  input.value = "";
                }}
              />
              ${
                this.keysSet.includes(provider.row)
                  ? strings.keySet
                  : strings.noKey
              }
            </label>
            ${provider.models.map(
              (model, modelIndex) =>
                html`<div class="model">
                  <label>
                    ${strings.model}
                    <input
                      .value=${model.id}
                      @change=${(event: Event) => {
                        const id = valueOf(event);
                        this.editProvider(index, (each) => ({
                          ...each,
                          models: each.models.map((other, at) =>
                            at === modelIndex ? { ...other, id } : other,
                          ),
                        }));
                      }}
                    />
                  </label>
                  ${inputsFor(provider.endpoint.kind).map(
                    (input) =>
                      html`<label>
                        <input
                          type="checkbox"
                          .checked=${model.inputs.includes(input)}
                          @change=${(event: Event) => {
                            const { checked } = inputOf(event);
                            this.editProvider(index, (each) => ({
                              ...each,
                              models: each.models.map((other, at) =>
                                at === modelIndex
                                  ? {
                                      ...other,
                                      inputs: MODEL_INPUTS.filter((kept) =>
                                        kept === input
                                          ? checked
                                          : other.inputs.includes(kept),
                                      ),
                                    }
                                  : other,
                              ),
                            }));
                          }}
                        />
                        ${strings.modelInputs[input]}
                      </label>`,
                  )}
                  <button
                    @click=${() => {
                      this.editProvider(index, (each) => ({
                        ...each,
                        models: each.models.filter(
                          (_, at) => at !== modelIndex,
                        ),
                      }));
                    }}
                  >
                    ${strings.removeModel}
                  </button>
                </div>`,
            )}
            ${
              provider.endpoint.kind === "anthropic" &&
              provider.models.length > 0
                ? html`<span>${strings.noAudioForAnthropic}</span>`
                : nothing
            }
            <button
              @click=${() => {
                this.editProvider(index, (each) => ({
                  ...each,
                  models: [...each.models, { id: "", inputs: [] }],
                }));
              }}
            >
              ${strings.addModel}
            </button>
            <button
              @click=${() => {
                this.hub.editSettings({
                  ...form,
                  aiProviders: form.aiProviders.filter((_, at) => at !== index),
                });
              }}
            >
              ${strings.removeProvider}
            </button>
          </fieldset>`,
      )}
      <button
        @click=${() => {
          this.hub.editSettings({
            ...form,
            aiProviders: [
              ...form.aiProviders,
              {
                // The `as` grants the brand: a fresh UUID is unique in the form.
                row: crypto.randomUUID() as AiProviderRow,
                was: { kind: "added" },
                label: "",
                endpoint: { kind: "openai-compatible", baseUrl: "" },
                models: [{ id: "", inputs: [] }],
              },
            ],
          });
        }}
      >
        ${strings.addProvider}
      </button>
      <label>
        ${strings.defaultAiProvider}
        <select
          @change=${(event: Event) => {
            const choice = choices[Number(valueOf(event))];
            this.hub.editSettings({
              ...form,
              defaultAiProvider:
                choice === undefined
                  ? { kind: "none" }
                  : { kind: "chosen", provider: choice.row, model: choice.id },
            });
          }}
        >
          <option value="none" ?selected=${chosen === undefined}>
            ${strings.noDefaultAiProvider}
          </option>
          ${choices.map(
            (choice, index) =>
              html`<option value=${index} ?selected=${choice === chosen}>
                ${choice.label} · ${choice.id}
              </option>`,
          )}
        </select>
      </label>
    </section>`;
  }

  override render() {
    const { strings, form } = this;
    // Following the company, or a stored name this Hub lacks, shows the Theme it resolved to.
    const selected =
      form.theme.kind === "chosen" && this.themes.includes(form.theme.name)
        ? form.theme.name
        : this.theme;
    return html`<h2>${strings.settings}</h2>
      <section aria-labelledby="appearance">
        <h3 id="appearance">${strings.appearance}</h3>
        <fieldset>
          <legend>${strings.theme}</legend>
          ${this.themes.map(
            (name) =>
              html`<label>
                <input
                  type="radio"
                  name="theme"
                  .checked=${selected === name}
                  @change=${() => {
                    this.hub.editSettings({
                      ...form,
                      theme: { kind: "chosen", name },
                    });
                  }}
                />
                ${themeLabel(name)}
              </label>`,
          )}
        </fieldset>
        <fieldset>
          <legend>${strings.colourScheme}</legend>
          ${COLOUR_SCHEMES.map(
            (scheme) =>
              html`<label>
                <input
                  type="radio"
                  name="colour-scheme"
                  .checked=${form.colourScheme === scheme}
                  @change=${() => {
                    this.hub.editSettings({ ...form, colourScheme: scheme });
                  }}
                />
                ${strings.colourSchemes[scheme]}
              </label>`,
          )}
        </fieldset>
      </section>
      <section aria-labelledby="language">
        <h3 id="language">${strings.language}</h3>
        <fieldset>
          <legend>${strings.displayLanguage}</legend>
          <label>
            <input
              type="radio"
              name="display-language"
              .checked=${form.displayLanguage.kind === "system"}
              @change=${() => {
                this.hub.editSettings({
                  ...form,
                  displayLanguage: { kind: "system" },
                });
              }}
            />
            ${strings.systemLanguage}
          </label>
          ${DISPLAY_LANGUAGES.map(
            (language) =>
              html`<label lang=${language}>
                <input
                  type="radio"
                  name="display-language"
                  .checked=${
                    form.displayLanguage.kind === "chosen" &&
                    form.displayLanguage.language === language
                  }
                  @change=${() => {
                    this.hub.editSettings({
                      ...form,
                      displayLanguage: { kind: "chosen", language },
                    });
                  }}
                />
                ${LANGUAGE_NAMES[language]}
              </label>`,
          )}
        </fieldset>
      </section>
      ${this.renderAiProviders()}
      ${
        this.savable
          ? nothing
          : html`<p role="status">${strings.notSavable}</p>`
      }
      <div class="actions">
        <button
          data-variant="primary"
          @click=${() => {
            this.hub.saveSettings();
          }}
        >
          ${strings.save}
        </button>
        <button
          @click=${() => {
            this.hub.cancelSettings();
          }}
        >
          ${strings.cancel}
        </button>
      </div>
      ${
        this.languageNoteShowing
          ? html`<p role="status">${strings.languageNote}</p>`
          : nothing
      }
      <section aria-labelledby="about">
        <h3 id="about">${strings.about}</h3>
        <dl>
          <dt>${strings.hubVersion}</dt>
          <dd>${this.hubVersion}</dd>
        </dl>
        <button
          @click=${() => {
            this.hub.exportDiagnostics();
          }}
        >
          ${strings.exportDiagnostics}
        </button>
      </section>`;
  }
}

customElements.define("hub-settings", HubSettings);

declare global {
  interface HTMLElementTagNameMap {
    "hub-settings": HubSettings;
  }
}
