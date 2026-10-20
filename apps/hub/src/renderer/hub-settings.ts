// Hub Settings, drawn in the content area while the open Plugins run hidden behind them: one
// scrolling page of sections. No Theme yet (ADR 0006).

import { LitElement, css, html, nothing } from "lit";
import {
  COLOUR_SCHEMES,
  DISPLAY_LANGUAGES,
  type DisplayLanguage,
  type HubChromeApi,
  type HubSettings as Settings,
  type HubVersion,
  type ThemeName,
} from "../shared/hub-chrome-ipc";
import type { Strings } from "./strings";

// Each language in itself, whatever the Hub Chrome is drawn in, so staff find theirs (spec #71).
const LANGUAGE_NAMES = {
  "en-HK": "English",
  "zh-HK": "繁體中文",
} satisfies Record<DisplayLanguage, string>;
// A Theme's own name, the same in every Display Language.
const THEME_LABELS = new Map([["hawkeye", "Hawkeye"]]);

function themeLabel(name: ThemeName): string {
  const label = THEME_LABELS.get(name);
  if (label === undefined) throw new Error(`No label for the Theme ${name}`);
  return label;
}

export class HubSettings extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
      overflow-y: auto;
      padding: 24px;
      box-sizing: border-box;
    }
    h2 {
      margin: 0 0 16px;
      font-size: 20px;
    }
    h3 {
      margin: 0 0 8px;
      font-size: 16px;
    }
    dl {
      display: flex;
      gap: 8px;
    }
    dd {
      margin: 0;
    }
    fieldset {
      display: flex;
      gap: 16px;
      border: none;
      padding: 0;
      margin: 0;
    }
    legend {
      padding: 0;
      margin-bottom: 8px;
    }
    .actions {
      display: flex;
      gap: 8px;
      margin: 16px 0 32px;
    }
  `;

  static override properties = {
    strings: { attribute: false },
    hubVersion: { attribute: false },
    theme: { attribute: false },
    themes: { attribute: false },
    form: { attribute: false },
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
  declare form: Settings;
  declare languageNoteShowing: boolean;
  declare hub: HubChromeApi;

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
