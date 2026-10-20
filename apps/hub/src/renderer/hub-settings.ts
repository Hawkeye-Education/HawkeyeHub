// Hub Settings, drawn in the content area while the open Plugins run hidden behind them: one
// scrolling page of sections. No Theme yet (ADR 0006).

import { LitElement, css, html } from "lit";
import type { HubChromeApi, HubVersion } from "../shared/hub-chrome-ipc";
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
  `;

  static override properties = {
    strings: { attribute: false },
    hubVersion: { attribute: false },
    hub: { attribute: false },
  };
  // `declare`: a class field would shadow Lit's reactive accessor. The Hub Chrome sets them all
  // through its template before the first render.
  declare strings: Strings;
  declare hubVersion: HubVersion;
  declare hub: HubChromeApi;

  override render() {
    const { strings } = this;
    return html`<h2>${strings.settings}</h2>
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
