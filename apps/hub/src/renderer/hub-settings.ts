// Hub Settings, drawn in the content area while the open Plugins run hidden behind them: one
// scrolling page of sections. No Theme yet (ADR 0006).

import { LitElement, css, html } from "lit";
import {
  COLOUR_SCHEMES,
  type HubChromeApi,
  type HubSettings as Settings,
  type HubVersion,
} from "../shared/hub-chrome-ipc";
import type { Strings } from "./strings";

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
    form: { attribute: false },
    hub: { attribute: false },
  };
  // `declare`: a class field would shadow Lit's reactive accessor. The Hub Chrome sets them all
  // through its template before the first render.
  declare strings: Strings;
  declare hubVersion: HubVersion;
  /** The unsaved form, as main holds it: every control draws from it, and an edit goes to main. */
  declare form: Settings;
  declare hub: HubChromeApi;

  override render() {
    const { strings, form } = this;
    return html`<h2>${strings.settings}</h2>
      <section aria-labelledby="appearance">
        <h3 id="appearance">${strings.appearance}</h3>
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
