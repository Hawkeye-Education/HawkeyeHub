// The Hub Chrome's root element: the Plugin Switcher down the side and the content area beside it.
// It draws the latest snapshot of the lifecycle state held in main, built from the Theme (ADR 0006).
// Loaded with #dialog it is the dialog overlay instead, above every Plugin UI, and draws only the
// pending dialog.

import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { keyed } from "lit/directives/keyed.js";
import {
  ASSISTANT_PANEL_WIDTH_PX,
  SWITCHER_WIDTH_PX,
  type HubChromeApi,
  type HubChromeSnapshot,
} from "../shared/hub-chrome-ipc";
import "./assistant-panel";
import "./hub-dialog";
import "./hub-settings";
import "./plugin-catalogue";
import "./plugin-switcher";
import { STRINGS, type Strings } from "./strings";
import { native } from "./theme";

const IS_OVERLAY = location.hash === "#dialog";

export class HubChrome extends LitElement {
  static override styles = [
    native,
    css`
      :host {
        display: grid;
        grid-template-columns: ${unsafeCSS(SWITCHER_WIDTH_PX)}px 1fr;
        height: 100vh;
      }
      aside {
        display: flex;
        flex-direction: column;
        border-right: 1px solid var(--hub-color-line);
        min-height: 0;
      }
      plugin-switcher {
        flex: 1;
        overflow-y: auto;
      }
      h1 {
        padding: var(--hub-space-4);
      }
      .gear {
        border: none;
        border-top: 1px solid var(--hub-color-line);
        border-radius: 0;
        background: none;
        padding: var(--hub-space-3) var(--hub-space-4);
        text-align: start;
      }
      .gear[aria-current="page"],
      .gear[aria-pressed="true"] {
        color: var(--hub-color-accent);
        font-weight: var(--hub-weight-strong);
      }
      :host([panel]) {
        grid-template-columns:
          ${unsafeCSS(SWITCHER_WIDTH_PX)}px 1fr
          ${unsafeCSS(ASSISTANT_PANEL_WIDTH_PX)}px;
      }
      main {
        min-height: 0;
      }
      .empty {
        display: grid;
        place-items: center;
        height: 100%;
      }
    `,
  ];

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
    const { content, foreground, assistant } = this.snapshot;
    const settingsShowing = content.kind === "settings";
    // The front Plugin's, while it shows.
    const front =
      content.kind === "plugin" && foreground !== null ? foreground : null;
    const panel = front === null ? { kind: "none" as const } : assistant;
    this.toggleAttribute("panel", panel.kind === "open");
    return html`<aside>
        <h1>Hawkeye Hub</h1>
        <plugin-switcher
          .strings=${strings}
          .plugins=${this.snapshot.plugins}
          .open=${this.snapshot.open}
          .closing=${this.snapshot.closing}
          .foreground=${content.kind === "plugin" ? foreground : null}
          .hub=${window.hubChrome}
        ></plugin-switcher>
        ${
          front === null || panel.kind === "none"
            ? nothing
            : html`<button
                class="gear"
                aria-pressed=${panel.kind === "open" ? "true" : "false"}
                @click=${() => {
                  window.hubChrome.toggleAssistant(front);
                }}
              >
                ${strings.assistant}
              </button>`
        }
        ${
          // Dev mode has no Catalogue (PLUGIN_STANDARD §9.4).
          this.snapshot.catalogue.kind === "off"
            ? nothing
            : html`<button
                class="gear"
                aria-current=${content.kind === "catalogue" ? "page" : nothing}
                @click=${() => {
                  window.hubChrome.showCatalogue();
                }}
              >
                <span aria-hidden="true">＋</span> ${strings.catalogue}
              </button>`
        }
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
      <main>${this.renderContent(strings)}</main>
      ${
        front === null || panel.kind !== "open"
          ? nothing
          : // Keyed, so one Plugin's unsent draft never shows in another's Panel.
            keyed(
              front,
              html`<assistant-panel
                .strings=${strings}
                .pluginId=${front}
                .conversation=${panel.conversation}
                .templates=${panel.templates}
                .model=${panel.model}
                .providers=${panel.providers}
                .hub=${window.hubChrome}
              ></assistant-panel>`,
            )
      }`;
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
          .theme=${this.snapshot.theme}
          .themes=${this.snapshot.themes}
          .form=${content.form}
          .keysSet=${content.keysSet}
          .savable=${content.savable}
          .languageNoteShowing=${content.languageNoteShowing}
          .hub=${window.hubChrome}
        ></hub-settings>`;
      case "catalogue":
        return html`<plugin-catalogue
          .strings=${strings}
          .catalogue=${this.snapshot.catalogue}
          .hub=${window.hubChrome}
        ></plugin-catalogue>`;
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
