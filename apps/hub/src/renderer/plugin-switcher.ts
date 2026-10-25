// The Plugin Switcher: every installed Plugin, down the side of the Hub window, in the order main
// sorted them. Clicking one opens it or brings it forward; the one in front is marked, and each open
// one has a close control. A closing one says so and cannot be clicked until it is gone. A Plugin
// the Hub cannot run shows why, and is not a control, so clicking it does nothing.

import { LitElement, css, html, nothing } from "lit";
import type { PluginId } from "@hawkeye-hub/plugin-format";
import type { HubChromeApi, SwitcherPlugin } from "../shared/hub-chrome-ipc";
import type { Strings } from "./strings";
import { native } from "./theme";

/**
 * Hands the icon URL to the `li::before` mask. Bound as the `.style` property, which sets it
 * through the CSSOM: the CSP refuses a `style` attribute, and Lit's styleMap writes one at first.
 */
function iconStyle({ iconUrl }: SwitcherPlugin): string {
  return `--icon: url("${iconUrl}")`;
}

export class PluginSwitcher extends LitElement {
  static override styles = [
    native,
    css`
      :host {
        display: block;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      li {
        display: flex;
        align-items: center;
        gap: var(--hub-space-1);
        padding-inline-start: var(--hub-space-4);
      }
      button {
        border: none;
        background: none;
        color: inherit;
        padding: var(--hub-space-2);
        text-align: start;
      }
      .name {
        flex: 1;
      }
      .closing {
        padding-inline-end: var(--hub-space-2);
        font-size: var(--hub-text-sm);
        color: var(--hub-color-fg-muted);
      }
      .blocked {
        padding: var(--hub-space-2);
        opacity: 0.5;
      }
      .reason {
        display: block;
        font-size: var(--hub-text-sm);
        color: var(--hub-color-warning);
      }
      [aria-current="page"] {
        font-weight: var(--hub-weight-strong);
      }
      /* The Plugin's icon.svg as a mask over currentColor: the SVG is only ever an image, never
         part of this page, so nothing in it runs, and it takes the text's colour. */
      li::before {
        content: "";
        flex: none;
        width: 24px;
        height: 24px;
        background-color: currentColor;
        mask-size: contain;
        mask-repeat: no-repeat;
        mask-position: center;
        mask-image: var(--icon);
      }
    `,
  ];

  static override properties = {
    strings: { attribute: false },
    plugins: { attribute: false },
    open: { attribute: false },
    closing: { attribute: false },
    foreground: { attribute: false },
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
  declare hub: HubChromeApi;

  override render() {
    const { strings } = this;
    return html`<nav aria-label=${strings.plugins}>
      <ul>
        ${this.plugins.map(
          (plugin) =>
            html`<li .style=${iconStyle(plugin)}>
              ${
                plugin.access.kind === "blocked"
                  ? html`<span class="name blocked">
                      ${plugin.name}
                      <span class="reason">
                        ${strings.blocked[plugin.access.reason]}
                      </span>
                    </span>`
                  : html`<button
                      class="name"
                      aria-current=${plugin.id === this.foreground ? "page" : nothing}
                      ?disabled=${this.closing.includes(plugin.id)}
                      @click=${() => {
                        this.hub.open(plugin.id);
                      }}
                    >
                      ${plugin.name}
                    </button>`
              }
              ${
                this.open.includes(plugin.id)
                  ? html`<button
                      aria-label=${strings.close(plugin.name)}
                      @click=${() => {
                        this.hub.close(plugin.id);
                      }}
                    >
                      ×
                    </button>`
                  : nothing
              }
              ${
                this.closing.includes(plugin.id)
                  ? html`<span class="closing">${strings.closing}</span>`
                  : nothing
              }
            </li>`,
        )}
      </ul>
    </nav>`;
  }
}

customElements.define("plugin-switcher", PluginSwitcher);

declare global {
  interface HTMLElementTagNameMap {
    "plugin-switcher": PluginSwitcher;
  }
}
