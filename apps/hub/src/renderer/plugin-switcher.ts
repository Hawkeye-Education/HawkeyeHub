// The Plugin Switcher (variant A, "Flat list", of #144): the logo, wordmark, Catalogue and Settings
// on its top line, then the Favourites and every other installed Plugin, each in the order main
// sorted them. Clicking one opens it or brings it forward; the one in front is marked, and each
// open one has a dot and a close control. A closing one says so and cannot be clicked until it is
// gone. A Plugin the Hub cannot run shows why, and is not a control, so clicking it does nothing.
// The star on each row saves a Favourite at once.
// Collapsed, it is the icon rail (#144): the logo mark, each Plugin as an icon with its name and
// status as a tooltip, the Favourites above a divider, and Catalogue and Settings at the bottom.

import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import type { PluginId } from "@hawkeye-hub/plugin-format";
import type {
  HubChromeApi,
  HubChromeContent,
  SwitcherPlugin,
} from "../shared/hub-chrome-ipc";
import { icon, pluginIconMask, pluginIconStyle } from "./icons";
import logoMark from "./logo-mark.png";
import type { Strings } from "./strings";
import { native } from "./theme";

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
      .plain-button {
        border: 0;
        background: none;
        box-shadow: none;
        padding: 0;
        min-height: 0;
        color: inherit;
        border-radius: var(--hub-radius-1);
      }
      .plain-button:hover:not(:disabled) {
        background-image: none;
      }
      .plain-button:active:not(:disabled) {
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
      .icon-button {
        width: 28px;
        height: 28px;
        display: grid;
        place-items: center;
        color: var(--hub-color-fg-muted);
      }
      .icon-button:hover:not(:disabled) {
        background: var(--item-hover);
        color: var(--hub-color-fg);
      }
      .icon-button[aria-current] {
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
      /* The Plugin's icon.svg over currentColor, so it takes the text's colour. */
      .glyph {
        flex: none;
        width: 16px;
        height: 16px;
        background-color: currentColor;
        ${pluginIconMask}
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
      li.blocked,
      li.closing {
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
      .row-action {
        flex: none;
        width: 22px;
        height: 22px;
        margin-inline-end: 2px;
        display: grid;
        place-items: center;
        color: var(--hub-color-fg-muted);
      }
      .row-action:hover:not(:disabled) {
        background: var(--item-hover);
        color: var(--hub-color-fg);
      }
      svg.icon {
        flex: none;
        width: 16px;
        height: 16px;
      }
      .row-action svg.icon {
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
      /* The icon rail. */
      :host([collapsed]) .brand {
        padding: 0;
        justify-content: center;
      }
      :host([collapsed]) nav,
      :host([collapsed]) .foot {
        display: grid;
        justify-items: center;
        align-content: start;
        gap: 1px;
      }
      :host([collapsed]) nav {
        padding: 0 0 var(--hub-space-2);
        scrollbar-width: none;
      }
      :host([collapsed]) hr {
        width: 20px;
        margin: 4px 0;
        border: 0;
        border-top: 1px solid var(--hub-color-line);
      }
      :host([collapsed]) .foot {
        flex: none;
        border-top: 1px solid var(--hub-color-line);
        padding: var(--hub-space-1) 0;
      }
      .rail-item {
        position: relative;
        width: 32px;
        height: 32px;
        display: grid;
        place-items: center;
        border-radius: var(--hub-radius-1);
        color: inherit;
      }
      .rail-item:hover:not(:disabled) {
        background: var(--item-hover);
      }
      .rail-item[aria-current] {
        background: var(--item-front);
        color: var(--hub-color-accent);
      }
      .rail-item.blocked,
      .rail-item:disabled {
        opacity: 0.5;
      }
      .rail-item .dot {
        position: absolute;
        right: 4px;
        bottom: 5px;
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
    collapsed: { attribute: false },
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
  /** Drawn as the icon rail. */
  declare collapsed: boolean;
  declare hub: HubChromeApi;

  override render() {
    const { strings, hub } = this;
    const favourites = this.plugins.filter(({ favourite }) => favourite);
    const rest = this.plugins.filter(({ favourite }) => !favourite);
    this.toggleAttribute("collapsed", this.collapsed);
    if (this.collapsed) return this.renderRail(favourites, rest);
    const { wordmark: word } = strings;
    const wordmark = html`${word.name} <span>${word.product}</span>`;
    return html`<div class="brand">
        <span class="logo" aria-hidden="true"></span>
        <h1 class="word">${wordmark}</h1>
        <span class="acts">
          ${
            this.catalogueOn
              ? html`<button
                  class="plain-button icon-button"
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
            class="plain-button icon-button"
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
        ${
          rest.length === 0
            ? nothing
            : html`<h2>${strings.plugins}</h2>
                <ul>
                  ${rest.map((plugin) => this.renderRow(plugin))}
                </ul>`
        }
      </nav>`;
  }

  private renderRail(favourites: SwitcherPlugin[], rest: SwitcherPlugin[]) {
    const { strings, hub } = this;
    const screenButton = (
      screen: "catalogue" | "settings",
      label: string,
      show: () => void,
    ) =>
      html`<button
        class="plain-button rail-item"
        aria-label=${label}
        title=${label}
        aria-current=${this.screen === screen ? "page" : nothing}
        @click=${show}
      >
        ${icon(screen === "catalogue" ? "layout-grid" : "settings")}
      </button>`;
    return html`<div class="brand">
        <span class="logo" aria-hidden="true"></span>
      </div>
      <nav aria-label=${strings.plugins}>
        ${favourites.map((plugin) => this.renderRailItem(plugin))}
        ${favourites.length === 0 ? nothing : html`<hr />`}
        ${rest.map((plugin) => this.renderRailItem(plugin))}
      </nav>
      <div class="foot">
        ${
          this.catalogueOn
            ? screenButton("catalogue", strings.catalogue, () => {
                hub.showCatalogue();
              })
            : nothing
        }
        ${screenButton("settings", strings.settings, () => {
          hub.showSettings();
        })}
      </div>`;
  }

  private renderRailItem(plugin: SwitcherPlugin) {
    const { strings, hub } = this;
    const open = this.open.includes(plugin.id);
    const closing = this.closing.includes(plugin.id);
    const status =
      plugin.access.kind === "blocked"
        ? strings.blocked[plugin.access.reason]
        : closing
          ? strings.closing
          : open
            ? strings.open
            : null;
    const tip = status === null ? plugin.name : `${plugin.name} · ${status}`;
    const inner = html`<span class="glyph"></span>
      ${open && !closing ? html`<span class="dot"></span>` : nothing}`;
    // A Plugin the Hub cannot run is not a control, as in the list.
    return plugin.access.kind === "blocked"
      ? html`<span
          class="rail-item blocked"
          role="img"
          aria-label=${tip}
          title=${tip}
          .style=${pluginIconStyle(plugin)}
          >${inner}</span
        >`
      : html`<button
          class="plain-button rail-item"
          aria-label=${tip}
          title=${tip}
          aria-current=${plugin.id === this.foreground ? "page" : nothing}
          ?disabled=${closing}
          .style=${pluginIconStyle(plugin)}
          @click=${() => {
            hub.open(plugin.id);
          }}
        >
          ${inner}
        </button>`;
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
      .style=${pluginIconStyle(plugin)}
    >
      ${
        plugin.access.kind === "blocked"
          ? html`<span class="main">${name}</span>
              <span class="tag">${strings.blocked[plugin.access.reason]}</span>`
          : html`<button
              class="plain-button main"
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
        class="plain-button row-action star"
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
              class="plain-button row-action"
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
