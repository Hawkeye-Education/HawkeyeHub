// The Hub Chrome's root element. A plain frame for now: the Theme and the Hub Kit come later (ADR 0006).

import { LitElement, css, html } from "lit";

export class HubChrome extends LitElement {
  static override styles = css`
    :host {
      display: block;
      padding: 16px;
      font-family: system-ui, sans-serif;
    }
    h1 {
      margin: 0;
      font-size: 20px;
    }
  `;

  override render() {
    return html`<h1>Hawkeye Hub</h1>`;
  }
}

customElements.define("hub-chrome", HubChrome);

declare global {
  interface HTMLElementTagNameMap {
    "hub-chrome": HubChrome;
  }
}
