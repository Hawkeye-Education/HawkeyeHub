// The Plugin Switcher (variant A, "Flat list", of #144): the logo, wordmark, Catalogue and Settings
// on its top line, then the Favourites and every other installed Plugin, each in the order main
// sorted them. Clicking one opens it or brings it forward; the one in front is marked, and each
// open one has a dot and a close control. A closing one says so and cannot be clicked until it is
// gone. A Plugin the Hub cannot run shows why, and is not a control, so clicking it does nothing.
// The star on each row saves a Favourite at once.

import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import type { PluginId } from "@hawkeye-hub/plugin-format";
import type {
  HubChromeApi,
  HubChromeContent,
  SwitcherPlugin,
} from "../shared/hub-chrome-ipc";
import { icon } from "./icons";
import logoMark from "./logo-mark.png";
import type { Strings } from "./strings";
import { native } from "./theme";

/**
 * Hands the icon URL to the `.glyph` mask. Bound as the `.style` property, which sets it through
 * the CSSOM: the CSP refuses a `style` attribute, and Lit's styleMap writes one at first.
 */
function iconStyle({ iconUrl }: SwitcherPlugin): string {
  return `--icon: url("${iconUrl}")`;
}

export class PluginSwitcher extends LitElement {
  static override styles = [
    native,
    css`
      :host {
        --item-hover: color-mix(
          in srgb,
          var(--hub-color-accent) 8%,
          transparent
        );
        --item-front: color-mix(
          in srgb,
          var(--hub-color-accent) 15%,
          transparent
        );
        display: flex;
        flex-direction: column;
        min-height: 0;
        font-size: 13px;
      }
      /* Bare buttons: no native.css box. */
      .bare {
        border: 0;
        background: none;
        box-shadow: none;
        padding: 0;
        min-height: 0;
        color: inherit;
        border-radius: var(--hub-radius-1);
      }
      .bare:hover:not(:disabled) {
        background-image: none;
      }
      .bare:active:not(:disabled) {
        transform: none;
      }
      .brand {
        flex: none;
        display: flex;
        align-items: center;
        gap: var(--hub-space-2);
        height: 40px;
        padding: 0 var(--hub-space-1) 0 var(--hub-space-3);
      }
      .logo {
        position: relative;
        flex: none;
        width: 22px;
        height: 22px;
        border-radius: 6px;
        background: #ff6b35;
      }
      .logo::after {
        content: "";
        position: absolute;
        inset: 3px;
        background: #fff;
        mask: url(${unsafeCSS(logoMark)}) center / contain no-repeat;
      }
      .word {
        margin: 0;
        font-weight: 600;
        font-size: 14px;
        letter-spacing: -0.01em;
        white-space: nowrap;
      }
      .word span {
        font-weight: 400;
        color: var(--hub-color-fg-muted);
      }
      .acts {
        margin-inline-start: auto;
        display: flex;
        gap: 2px;
      }
      .ib {
        width: 28px;
        height: 28px;
        display: grid;
        place-items: center;
        color: var(--hub-color-fg-muted);
      }
      .ib:hover:not(:disabled) {
        background: var(--item-hover);
        color: var(--hub-color-fg);
      }
      .ib[aria-current] {
        background: var(--item-front);
        color: var(--hub-color-accent);
      }
      nav {
        flex: 1;
        overflow-y: auto;
        padding: 0 var(--hub-space-2) var(--hub-space-2);
      }
      h2 {
        margin: var(--hub-space-3) var(--hub-space-2) 2px;
        font-size: 11px;
        font-weight: 500;
        color: var(--hub-color-fg-muted);
      }
      .hint {
        margin: 0 var(--hub-space-2);
        font-size: var(--hub-text-sm);
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: 1px;
      }
      li {
        display: flex;
        align-items: center;
        gap: var(--hub-space-1);
        min-height: 28px;
        border-radius: var(--hub-radius-1);
        transition: background var(--hub-motion-fast) var(--hub-motion-ease);
      }
      li:hover {
        background: var(--item-hover);
      }
      li:has(> [aria-current]) {
        background: var(--item-front);
      }
      li:has(> [aria-current]) .name {
        font-weight: 500;
      }
      li:has(> [aria-current]) .glyph {
        background-color: var(--hub-color-accent);
      }
      .main {
        flex: 1;
        min-width: 0;
        min-height: 28px;
        display: flex;
        align-items: center;
        gap: var(--hub-space-2);
        padding: 0 4px 0 8px;
        text-align: start;
      }
      /* The Plugin's icon.svg as a mask over currentColor: the SVG is only ever an image, never
         part of this page, so nothing in it runs, and it takes the text's colour. */
      .glyph {
        flex: none;
        width: 16px;
        height: 16px;
        background-color: currentColor;
        mask-size: contain;
        mask-repeat: no-repeat;
        mask-position: center;
        mask-image: var(--icon);
      }
      .name {
        flex: 1;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .tag {
        flex: none;
        font-size: 11px;
        color: var(--hub-color-fg-muted);
      }
      .blocked .main,
      .closing .main {
        opacity: 0.5;
      }
      .blocked .tag {
        color: var(--hub-color-warning);
      }
      .dot {
        flex: none;
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: var(--hub-color-success);
      }
      .mini {
        flex: none;
        width: 22px;
        height: 22px;
        margin-inline-end: 2px;
        display: grid;
        place-items: center;
        color: var(--hub-color-fg-muted);
      }
      .mini:hover:not(:disabled) {
        background: var(--item-hover);
        color: var(--hub-color-fg);
      }
      svg.icon {
        flex: none;
        width: 16px;
        height: 16px;
      }
      .mini svg.icon {
        width: 14px;
        height: 14px;
      }
      .star {
        opacity: 0;
      }
      li:hover .star,
      li:focus-within .star {
        opacity: 1;
      }
      .star[aria-pressed="true"] svg {
        fill: var(--hub-color-accent);
        stroke: var(--hub-color-accent);
      }
    `,
  ];

  static override properties = {
    strings: { attribute: false },
    plugins: { attribute: false },
    open: { attribute: false },
    closing: { attribute: false },
    foreground: { attribute: false },
    screen: { attribute: false },
    catalogueOn: { attribute: false },
    hub: { attribute: false },
  };
  // `declare`: a class field would shadow Lit's reactive accessor. The Hub Chrome sets them all
  // through its template before the first render.
  declare strings: Strings;
  declare plugins: SwitcherPlugin[];
  declare open: PluginId[];
  declare closing: PluginId[];
  /** Null when no Plugin is in front. */
  declare foreground: PluginId | null;
  /** What the content area shows, so Catalogue or Settings is marked while it does. */
  declare screen: HubChromeContent["kind"];
  /** Dev mode has no Catalogue (PLUGIN_STANDARD §9.4). */
  declare catalogueOn: boolean;
  declare hub: HubChromeApi;

  override render() {
    const { strings, hub } = this;
    const favourites = this.plugins.filter(({ favourite }) => favourite);
    const rest = this.plugins.filter(({ favourite }) => !favourite);
    return html`<div class="brand">
        <span class="logo" aria-hidden="true"></span>
        <h1 class="word">Hawkeye <span>Hub</span></h1>
        <span class="acts">
          ${
            this.catalogueOn
              ? html`<button
                  class="bare ib"
                  aria-label=${strings.catalogue}
                  title=${strings.catalogue}
                  aria-current=${this.screen === "catalogue" ? "page" : nothing}
                  @click=${() => {
                    hub.showCatalogue();
                  }}
                >
                  ${icon("layout-grid")}
                </button>`
              : nothing
          }
          <button
            class="bare ib"
            aria-label=${strings.settings}
            title=${strings.settings}
            aria-current=${this.screen === "settings" ? "page" : nothing}
            @click=${() => {
              hub.showSettings();
            }}
          >
            ${icon("settings")}
          </button>
        </span>
      </div>
      <nav aria-label=${strings.plugins}>
        <h2>${strings.favourites}</h2>
        ${
          favourites.length === 0
            ? html`<p class="hint">${strings.noFavourites}</p>`
            : html`<ul>
                ${favourites.map((plugin) => this.renderRow(plugin))}
              </ul>`
        }
        <h2>${strings.plugins}</h2>
        <ul>
          ${rest.map((plugin) => this.renderRow(plugin))}
        </ul>
      </nav>`;
  }

  private renderRow(plugin: SwitcherPlugin) {
    const { strings, hub } = this;
    const open = this.open.includes(plugin.id);
    const closing = this.closing.includes(plugin.id);
    const blocked = plugin.access.kind === "blocked";
    const name = html`<span class="glyph"></span>
      <span class="name">${plugin.name}</span>`;
    return html`<li
      class=${blocked ? "blocked" : closing ? "closing" : ""}
      .style=${iconStyle(plugin)}
    >
      ${
        plugin.access.kind === "blocked"
          ? html`<span class="main">${name}</span>
              <span class="tag">${strings.blocked[plugin.access.reason]}</span>`
          : html`<button
              class="bare main"
              aria-current=${plugin.id === this.foreground ? "page" : nothing}
              ?disabled=${closing}
              @click=${() => {
                hub.open(plugin.id);
              }}
            >
              ${name}
            </button>`
      }
      ${closing ? html`<span class="tag">${strings.closing}</span>` : nothing}
      ${
        open
          ? html`<span
              class="dot"
              role="img"
              aria-label=${strings.open}
              title=${strings.open}
            ></span>`
          : nothing
      }
      <button
        class="bare mini star"
        aria-pressed=${plugin.favourite ? "true" : "false"}
        aria-label=${
          plugin.favourite
            ? strings.removeFavourite(plugin.name)
            : strings.addFavourite(plugin.name)
        }
        title=${
          plugin.favourite
            ? strings.removeFavourite(plugin.name)
            : strings.addFavourite(plugin.name)
        }
        @click=${() => {
          hub.toggleFavourite(plugin.id);
        }}
      >
        ${icon("star")}
      </button>
      ${
        open
          ? html`<button
              class="bare mini"
              aria-label=${strings.close(plugin.name)}
              title=${strings.close(plugin.name)}
              @click=${() => {
                hub.close(plugin.id);
              }}
            >
              ${icon("x")}
            </button>`
          : nothing
      }
    </li>`;
  }
}

customElements.define("plugin-switcher", PluginSwitcher);

declare global {
  interface HTMLElementTagNameMap {
    "plugin-switcher": PluginSwitcher;
  }
}
