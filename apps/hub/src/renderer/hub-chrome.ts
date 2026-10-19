// The Hub Chrome's root element: the Plugin Switcher down the side and the content area beside it.
// It draws the latest snapshot of the lifecycle state held in main. No Theme yet (ADR 0006).

import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import {
  SWITCHER_WIDTH_PX,
  type HubChromeApi,
  type HubChromeSnapshot,
} from "../shared/hub-chrome-ipc";
import "./plugin-switcher";
import { STRINGS } from "./strings";

export class HubChrome extends LitElement {
  static override styles = css`
    :host {
      display: grid;
      grid-template-columns: ${unsafeCSS(SWITCHER_WIDTH_PX)}px 1fr;
      height: 100vh;
      font-family: system-ui, sans-serif;
    }
    aside {
      border-right: 1px solid #ccc;
      overflow-y: auto;
    }
    h1 {
      margin: 0;
      padding: 16px;
      font-size: 20px;
    }
    main {
      display: grid;
      place-items: center;
      color: #666;
    }
  `;

  static override properties = { snapshot: { state: true } };
  // Null until the preload delivers the first snapshot: a real state, drawn as nothing.
  // `declare` and set in the constructor: a class field would shadow Lit's reactive accessor.
  declare snapshot: HubChromeSnapshot | null;

  constructor() {
    super();
    this.snapshot = null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    window.hubChrome.subscribe((snapshot) => {
      document.documentElement.lang = snapshot.displayLanguage;
      this.snapshot = snapshot;
    });
  }

  override render() {
    if (this.snapshot === null) return nothing;
    const strings = STRINGS[this.snapshot.displayLanguage];
    return html`<aside>
        <h1>Hawkeye Hub</h1>
        <plugin-switcher
          .label=${strings.plugins}
          .closeLabel=${strings.close}
          .closingLabel=${strings.closing}
          .plugins=${this.snapshot.plugins}
          .open=${this.snapshot.open}
          .closing=${this.snapshot.closing}
          .foreground=${this.snapshot.foreground}
          .hub=${window.hubChrome}
        ></plugin-switcher>
      </aside>
      <main>
        ${
          this.snapshot.foreground === null
            ? html`<p>${strings.noPluginOpen}</p>`
            : nothing
        }
      </main>`;
  }
}

customElements.define("hub-chrome", HubChrome);

declare global {
  interface HTMLElementTagNameMap {
    "hub-chrome": HubChrome;
  }
  interface Window {
    readonly hubChrome: HubChromeApi;
  }
}
