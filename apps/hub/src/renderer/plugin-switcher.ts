// The Plugin Switcher: every installed Plugin, down the side of the Hub window, in the order main
// sorted them. Clicking one opens it or brings it forward; the one in front is marked, and each open
// one has a close control. No Theme yet (ADR 0006). Blocked reasons arrive in a later ticket.

import { LitElement, css, html, nothing } from "lit";
import type { HubChromeApi, SwitcherPlugin } from "../shared/hub-chrome-ipc";

/**
 * Hands the icon URL to the `li::before` mask. Bound as the `.style` property, which sets it
 * through the CSSOM: the CSP refuses a `style` attribute, and Lit's styleMap writes one at first.
 */
function iconStyle({ iconUrl }: SwitcherPlugin): string {
  return `--icon: url("${iconUrl}")`;
}

export class PluginSwitcher extends LitElement {
  static override styles = css`
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
      gap: 4px;
      padding-inline-start: 16px;
    }
    button {
      font: inherit;
      border: none;
      background: none;
      padding: 8px;
      text-align: start;
      cursor: pointer;
    }
    .name {
      flex: 1;
    }
    [aria-current="page"] {
      font-weight: bold;
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
  `;

  static override properties = {
    label: { attribute: false },
    closeLabel: { attribute: false },
    plugins: { attribute: false },
    open: { attribute: false },
    foreground: { attribute: false },
    hub: { attribute: false },
  };
  // `declare`: a class field would shadow Lit's reactive accessor. The Hub Chrome sets them all
  // through its template before the first render.
  /** The navigation landmark's accessible name, in the Display Language. */
  declare label: string;
  /** The close control's accessible name for a Plugin, in the Display Language. */
  declare closeLabel: (name: string) => string;
  declare plugins: SwitcherPlugin[];
  declare open: string[];
  /** Null when no Plugin is in front. */
  declare foreground: string | null;
  declare hub: HubChromeApi;

  override render() {
    return html`<nav aria-label=${this.label}>
      <ul>
        ${this.plugins.map(
          (plugin) =>
            html`<li .style=${iconStyle(plugin)}>
              <button
                class="name"
                aria-current=${plugin.id === this.foreground ? "page" : nothing}
                @click=${() => {
                  this.hub.open(plugin.id);
                }}
              >
                ${plugin.name}
              </button>
              ${
                this.open.includes(plugin.id)
                  ? html`<button
                      aria-label=${this.closeLabel(plugin.name)}
                      @click=${() => {
                        this.hub.close(plugin.id);
                      }}
                    >
                      ×
                    </button>`
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
