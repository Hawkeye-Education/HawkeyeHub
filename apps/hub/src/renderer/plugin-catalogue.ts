// The Plugin Catalogue, drawn in the content area while the open Plugins run hidden behind them:
// every Plugin the Registry offers as a tile, with its icon, name, the version Install would
// install and description, and **Install**, *Installing…*, an install's failure with **Retry**,
// **Uninstall**, *Uninstalling…*, or why it cannot be installed (spec #91; tiles, #142 variant A).

import { LitElement, css, html } from "lit";
import type {
  Catalogue,
  CataloguePlugin,
  HubChromeApi,
} from "../shared/hub-chrome-ipc";
import { icon, pluginIconMask, pluginIconStyle } from "./icons";
import type { Strings } from "./strings";
import { native } from "./theme";

const spinner = html`<span class="spinner" aria-hidden="true"></span>`;

export class PluginCatalogue extends LitElement {
  static override styles = [
    native,
    css`
      :host {
        display: block;
        height: 100%;
        overflow-y: auto;
        padding: var(--hub-space-5);
        box-sizing: border-box;
      }
      svg.icon {
        flex: none;
        width: 14px;
        height: 14px;
      }
      .spinner {
        flex: none;
        width: 12px;
        height: 12px;
        box-sizing: border-box;
        border-radius: 50%;
        border: 2px solid currentColor;
        border-right-color: transparent;
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
        gap: var(--hub-space-3);
      }
      li {
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--hub-space-2);
        padding: var(--hub-space-4);
        background: var(--hub-color-surface-raised);
        border: 1px solid var(--hub-color-line);
        border-radius: var(--hub-radius-2);
      }
      .top {
        display: flex;
        align-items: center;
        gap: var(--hub-space-3);
        min-width: 0;
      }
      .top > div {
        min-width: 0;
        display: grid;
      }
      /* The Registry's icon.svg as a 22px mask in the accent, on a 40px tile. */
      .tile {
        flex: none;
        width: 40px;
        height: 40px;
        display: grid;
        place-items: center;
        border-radius: var(--hub-radius-2);
        background: color-mix(
          in srgb,
          var(--hub-color-accent) 12%,
          transparent
        );
      }
      .tile::before {
        content: "";
        width: 22px;
        height: 22px;
        background-color: var(--hub-color-accent);
        ${pluginIconMask}
      }
      h3 {
        margin: 0;
        font-size: var(--hub-text-md);
        font-weight: var(--hub-weight-strong);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .version {
        font-size: 11px;
        color: var(--hub-color-fg-muted);
      }
      .description {
        margin: 0;
        color: var(--hub-color-fg-muted);
        line-height: 1.4;
        min-height: 2.8em;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        overflow: hidden;
      }
      .blocked .tile,
      .blocked h3 {
        opacity: 0.5;
      }
      .foot {
        margin-top: auto;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: var(--hub-space-2);
        min-height: 28px;
      }
      .status {
        margin-right: auto;
        display: flex;
        align-items: center;
        gap: var(--hub-space-1);
        font-size: var(--hub-text-sm);
        color: var(--hub-color-fg-muted);
      }
      .status.ok {
        color: var(--hub-color-success);
      }
      .status.warn {
        color: var(--hub-color-warning);
      }
      .status.err {
        color: var(--hub-color-danger);
      }
      /* Export diagnostics reads as a link, but is a button: it acts, it goes nowhere. */
      .link {
        border: 0;
        background: none;
        box-shadow: none;
        padding: 0;
        min-height: 0;
        color: var(--hub-color-accent);
        font-size: var(--hub-text-sm);
        text-decoration: underline;
        cursor: pointer;
      }
      .notice {
        display: grid;
        justify-items: center;
        gap: var(--hub-space-3);
        text-align: center;
        color: var(--hub-color-fg-muted);
        padding: var(--hub-space-6) 0;
      }
      .notice svg.icon,
      .notice .spinner {
        width: 32px;
        height: 32px;
      }
      .notice .spinner {
        border-width: 3px;
      }
    `,
  ];

  static override properties = {
    strings: { attribute: false },
    catalogue: { attribute: false },
    hub: { attribute: false },
  };
  // `declare`: a class field would shadow Lit's reactive accessor. The Hub Chrome sets them all.
  declare strings: Strings;
  declare catalogue: Catalogue;
  declare hub: HubChromeApi;

  // The header strip shows the title.
  override render() {
    const { strings, catalogue } = this;
    switch (catalogue.kind) {
      case "off":
        // The Hub Chrome draws no way here in dev mode.
        throw new Error("Dev mode has no Plugin Catalogue");
      case "checking":
        return html`<div class="notice">
          ${spinner}
          <span role="status">${strings.checkingRegistry}</span>
        </div>`;
      case "unreachable":
        return html`<div class="notice">
          ${icon("cloud-off")}
          <span role="alert">${strings.registryUnreachable}</span>
          <button
            @click=${() => {
              this.hub.retryRegistry();
            }}
          >
            ${strings.retry}
          </button>
        </div>`;
      case "listed":
        return catalogue.plugins.length === 0
          ? html`<div class="notice">
              ${icon("package")}
              <span>${strings.noPluginsOffered}</span>
            </div>`
          : html`<ul>
              ${catalogue.plugins.map((plugin) => this.renderTile(plugin))}
            </ul>`;
      default:
        return catalogue satisfies never;
    }
  }

  private renderTile(plugin: CataloguePlugin) {
    const blocked =
      plugin.access.kind === "blocked" &&
      plugin.installed.kind === "not-installed";
    return html`<li class=${blocked ? "blocked" : ""}>
      <div class="top">
        <span class="tile" .style=${pluginIconStyle(plugin)}></span>
        <div>
          <h3 title=${plugin.name}>${plugin.name}</h3>
          <span class="version">v${plugin.version}</span>
        </div>
      </div>
      <p class="description">${plugin.description}</p>
      <div class="foot">${this.renderFoot(plugin)}</div>
    </li>`;
  }

  // The status on the left and the one action on the right. A job comes first; then an installed
  // Plugin is **Uninstall**, whatever its access; then a blocked one says why; else **Install**.
  private renderFoot({ id, access, installed, job }: CataloguePlugin) {
    const { strings, hub } = this;
    switch (job.kind) {
      case "installing":
      case "uninstalling":
        return html`<span class="status" role="status"
          >${spinner}${
            job.kind === "installing"
              ? strings.installing
              : strings.uninstalling
          }</span
        >`;
      case "install-failed":
        return html`<span class="status err"
            >${icon("alert-triangle")}
            <span
              ><span role="alert">${strings.installFailed[job.cause]}</span> ·
              <button
                class="link"
                @click=${() => {
                  hub.exportDiagnostics();
                }}
              >
                ${strings.exportDiagnostics}
              </button></span
            ></span
          >
          <button
            @click=${() => {
              hub.install(id);
            }}
          >
            ${strings.retry}
          </button>`;
      case "none":
        break;
      default:
        return job satisfies never;
    }
    if (installed.kind === "installed") {
      return html`<span class="status ok"
          >${icon("check")}${strings.installed}</span
        >
        <button
          @click=${() => {
            hub.uninstall(id);
          }}
        >
          ${strings.uninstall}
        </button>`;
    }
    if (access.kind === "blocked") {
      return html`<span class="status warn"
        >${icon("lock")}${strings.blocked[access.reason]}</span
      >`;
    }
    return html`<button
      data-variant="primary"
      @click=${() => {
        hub.install(id);
      }}
    >
      ${strings.install}
    </button>`;
  }
}

customElements.define("plugin-catalogue", PluginCatalogue);

declare global {
  interface HTMLElementTagNameMap {
    "plugin-catalogue": PluginCatalogue;
  }
}
