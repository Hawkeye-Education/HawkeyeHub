// The Plugin Switcher: every installed Plugin, down the side of the Hub window, in the order main
// sorted them. No Theme yet (ADR 0006). Opening, closing and blocked reasons arrive in later tickets.

import { LitElement, css, html } from "lit";
import type { SwitcherPlugin } from "../shared/hub-chrome-ipc";

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
      gap: 12px;
      padding: 8px 16px;
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
    plugins: { attribute: false },
  };
  // `declare`: a class field would shadow Lit's reactive accessor. The Hub Chrome sets both
  // through its template before the first render.
  /** The navigation landmark's accessible name, in the Display Language. */
  declare label: string;
  declare plugins: SwitcherPlugin[];

  override render() {
    return html`<nav aria-label=${this.label}>
      <ul>
        ${this.plugins.map(
          (plugin) => html`<li .style=${iconStyle(plugin)}>${plugin.name}</li>`,
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
