// The Hub Chrome's root element: the Plugin Switcher down the side and the content area beside it.
// It draws the latest snapshot of the lifecycle state held in main. No Theme yet (ADR 0006).
// Loaded with #dialog it is the dialog overlay instead, above every Plugin UI, and draws only the
// pending dialog.

import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import {
  SWITCHER_WIDTH_PX,
  type HubChromeApi,
  type HubChromeSnapshot,
} from "../shared/hub-chrome-ipc";
import "./hub-dialog";
import "./hub-settings";
import "./plugin-switcher";
import { STRINGS, type Strings } from "./strings";

const IS_OVERLAY = location.hash === "#dialog";

export class HubChrome extends LitElement {
  static override styles = css`
    :host {
      display: grid;
      grid-template-columns: ${unsafeCSS(SWITCHER_WIDTH_PX)}px 1fr;
      height: 100vh;
      font-family: system-ui, sans-serif;
    }
    aside {
      display: flex;
      flex-direction: column;
      border-right: 1px solid #ccc;
      min-height: 0;
    }
    plugin-switcher {
      flex: 1;
      overflow-y: auto;
    }
    h1 {
      margin: 0;
      padding: 16px;
      font-size: 20px;
    }
    .gear {
      font: inherit;
      border: none;
      border-top: 1px solid #ccc;
      background: none;
      padding: 12px 16px;
      text-align: start;
      cursor: pointer;
    }
    .gear[aria-current="page"] {
      font-weight: bold;
    }
    main {
      min-height: 0;
    }
    .empty {
      display: grid;
      place-items: center;
      height: 100%;
      margin: 0;
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
    if (IS_OVERLAY) {
      // Main takes the overlay away once the dialog is answered or gone.
      return this.snapshot.dialog === null
        ? nothing
        : html`<hub-dialog
            .dialog=${this.snapshot.dialog}
            .strings=${strings}
            .hub=${window.hubChrome}
          ></hub-dialog>`;
    }
    const { content, foreground } = this.snapshot;
    const settingsShowing = content.kind === "settings";
    return html`<aside>
        <h1>Hawkeye Hub</h1>
        <plugin-switcher
          .strings=${strings}
          .plugins=${this.snapshot.plugins}
          .open=${this.snapshot.open}
          .closing=${this.snapshot.closing}
          .foreground=${settingsShowing ? null : foreground}
          .hub=${window.hubChrome}
        ></plugin-switcher>
        <button
          class="gear"
          aria-current=${settingsShowing ? "page" : nothing}
          @click=${() => {
            window.hubChrome.showSettings();
          }}
        >
          <span aria-hidden="true">⚙</span> ${strings.settings}
        </button>
      </aside>
      <main>${this.renderContent(strings)}</main>`;
  }

  // The front Plugin's UI is a view main lays over the content area, so with one in front this
  // draws nothing.
  private renderContent(strings: Strings) {
    if (this.snapshot === null) return nothing;
    const { content } = this.snapshot;
    switch (content.kind) {
      case "settings":
        return html`<hub-settings
          .strings=${strings}
          .hubVersion=${this.snapshot.hubVersion}
          .form=${content.form}
          .languageNoteShowing=${content.languageNoteShowing}
          .hub=${window.hubChrome}
        ></hub-settings>`;
      case "plugin":
        return this.snapshot.foreground === null
          ? html`<p class="empty">${strings.noPluginOpen}</p>`
          : nothing;
      default:
        return content satisfies never;
    }
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
