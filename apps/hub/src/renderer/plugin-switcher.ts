// The Plugin Switcher: every installed Plugin, down the side of the Hub window, in the order main
// sorted them. No Theme yet (ADR 0006). Opening, closing and blocked reasons arrive in later tickets.

import { LitElement, css, html } from "lit";
import type { SwitcherPlugin } from "../shared/hub-chrome-ipc";

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
      padding: 8px 16px;
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
        ${this.plugins.map((plugin) => html`<li>${plugin.name}</li>`)}
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
