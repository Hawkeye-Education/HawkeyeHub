// The Hub Chrome's root element: the Plugin Switcher down the side, and beside it the header strip
// above the content area and the Assistant Panel.
// It draws the latest snapshot of the lifecycle state held in main, built from the Theme (ADR 0006).
// Loaded with #dialog it is the dialog overlay instead, above every Plugin UI, and draws only the
// pending dialog.

import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { keyed } from "lit/directives/keyed.js";
import type { PluginId } from "@hawkeye-hub/plugin-format";
import {
  ASSISTANT_PANEL_WIDTH_PX,
  HEADER_STRIP_HEIGHT_PX,
  SWITCHER_WIDTH_PX,
  type HubChromeApi,
  type HubChromeSnapshot,
  type SwitcherPlugin,
} from "../shared/hub-chrome-ipc";
import "./assistant-panel";
import "./hub-dialog";
import "./hub-settings";
import "./plugin-catalogue";
import "./plugin-switcher";
import { icon } from "./icons";
import { STRINGS, type Strings } from "./strings";
import { native } from "./theme";

/** Hands the icon URL to the mask, through the CSSOM: the CSP refuses a `style` attribute. */
function iconStyle({ iconUrl }: SwitcherPlugin): string {
  return `--icon: url("${iconUrl}")`;
}

const IS_OVERLAY = location.hash === "#dialog";

export class HubChrome extends LitElement {
  static override styles = [
    native,
    css`
      :host {
        display: grid;
        grid-template-columns: ${unsafeCSS(SWITCHER_WIDTH_PX)}px 1fr;
        grid-template-rows: ${unsafeCSS(HEADER_STRIP_HEIGHT_PX)}px 1fr;
        height: 100vh;
      }
      aside {
        grid-row: 1 / -1;
        display: flex;
        flex-direction: column;
        border-right: 1px solid var(--hub-color-line);
        min-height: 0;
      }
      plugin-switcher {
        flex: 1;
      }
      :host([panel]) {
        grid-template-columns:
          ${unsafeCSS(SWITCHER_WIDTH_PX)}px 1fr
          ${unsafeCSS(ASSISTANT_PANEL_WIDTH_PX)}px;
      }
      /* Over the content area and the Assistant Panel. #153 puts the Switcher's collapse toggle
         first in this row, at its left. */
      header {
        grid-column: 2 / -1;
        display: flex;
        align-items: center;
        gap: var(--hub-space-2);
        padding-inline: var(--hub-space-3) var(--hub-space-2);
        min-width: 0;
      }
      .title {
        display: flex;
        align-items: center;
        gap: var(--hub-space-2);
        min-width: 0;
        font-weight: 500;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* The Plugin's icon.svg as a mask over the accent, as in the Plugin Switcher. */
      .plugin-icon {
        flex: none;
        width: 16px;
        height: 16px;
        background-color: var(--hub-color-accent);
        mask: var(--icon) center / contain no-repeat;
      }
      .assistant {
        margin-inline-start: auto;
        display: flex;
        align-items: center;
        gap: var(--hub-space-1);
        min-height: 28px;
        padding-block: 0;
        border: none;
        border-radius: var(--hub-radius-1);
        background: none;
        box-shadow: none;
      }
      .assistant .icon {
        width: 16px;
        height: 16px;
        color: var(--hub-color-accent);
      }
      .assistant[aria-pressed="true"] {
        background: color-mix(
          in srgb,
          var(--hub-color-accent) 15%,
          transparent
        );
        color: var(--hub-color-accent);
      }
      main,
      assistant-panel {
        grid-row: 2;
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
    // The front Plugin's, while it shows.
    const front =
      content.kind === "plugin" && foreground !== null ? foreground : null;
    const panel = front === null ? { kind: "none" as const } : assistant;
    this.toggleAttribute("panel", panel.kind === "open");
    return html`<aside>
        <plugin-switcher
          .strings=${strings}
          .plugins=${this.snapshot.plugins}
          .open=${this.snapshot.open}
          .closing=${this.snapshot.closing}
          .foreground=${content.kind === "plugin" ? foreground : null}
          .screen=${content.kind}
          .catalogueOn=${this.snapshot.catalogue.kind !== "off"}
          .hub=${window.hubChrome}
        ></plugin-switcher>
      </aside>
      <header>
        ${
          front === null
            ? html`<span class="title">${this.screenTitle(strings)}</span>`
            : html`<span class="title">
                <span
                  class="plugin-icon"
                  .style=${iconStyle(this.frontPlugin(front))}
                ></span>
                ${this.frontPlugin(front).name}
              </span>`
        }
        ${
          front === null || panel.kind === "none"
            ? nothing
            : html`<button
                class="assistant"
                aria-pressed=${panel.kind === "open" ? "true" : "false"}
                @click=${() => {
                  window.hubChrome.toggleAssistant(front);
                }}
              >
                ${icon("sparkles")} ${strings.assistant}
              </button>`
        }
      </header>
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

  /** The front Plugin's Switcher entry: main only ever puts an installed Plugin in front. */
  private frontPlugin(id: PluginId): SwitcherPlugin {
    const plugin = this.snapshot?.plugins.find((each) => each.id === id);
    if (plugin === undefined) {
      throw new Error(`Plugin ${id} is in front but not installed`);
    }
    return plugin;
  }

  /** The header strip's title with no Plugin in front. */
  private screenTitle(strings: Strings): string {
    if (this.snapshot === null) throw new Error("No snapshot to title");
    const { content } = this.snapshot;
    switch (content.kind) {
      case "settings":
        return strings.settings;
      case "catalogue":
        return strings.catalogue;
      case "plugin":
        return strings.hubName;
      default:
        return content satisfies never;
    }
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
