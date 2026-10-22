// The Plugin Catalogue, drawn in the content area while the open Plugins run hidden behind them:
// every Plugin the Registry offers, with its name, description and icon, its installed version, and
// **Install**, *Installing…*, an install's failure, **Uninstall**, *Uninstalling…*, or why it
// cannot be installed (spec #91). No
// Theme yet (ADR 0006).

import { LitElement, css, html, nothing } from "lit";
import type {
  Catalogue,
  CataloguePlugin,
  HubChromeApi,
} from "../shared/hub-chrome-ipc";
import type { Strings } from "./strings";

/** As in the Plugin Switcher: the icon URL for the `li::before` mask, set through the CSSOM. */
function iconStyle({ iconUrl }: CataloguePlugin): string {
  return `--icon: url("${iconUrl}")`;
}

export class PluginCatalogue extends LitElement {
  static override styles = css`
    :host {
      display: block;
      height: 100%;
      overflow-y: auto;
      padding: 24px;
      box-sizing: border-box;
    }
    h2 {
      margin: 0 0 16px;
      font-size: 20px;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    li {
      display: flex;
      gap: 12px;
      padding: 8px 0;
    }
    h3 {
      margin: 0;
      font-size: 16px;
    }
    p {
      margin: 4px 0 0;
    }
    .reason {
      color: #666;
      font-size: smaller;
    }
    .entry {
      flex: 1;
    }
    .action {
      flex: none;
      align-self: start;
    }
    /* The Registry's icon.svg as a mask over currentColor, as in the Plugin Switcher. */
    li::before {
      content: "";
      flex: none;
      width: 32px;
      height: 32px;
      background-color: currentColor;
      mask-size: contain;
      mask-repeat: no-repeat;
      mask-position: center;
      mask-image: var(--icon);
    }
  `;

  static override properties = {
    strings: { attribute: false },
    catalogue: { attribute: false },
    hub: { attribute: false },
  };
  // `declare`: a class field would shadow Lit's reactive accessor. The Hub Chrome sets them all.
  declare strings: Strings;
  declare catalogue: Catalogue;
  declare hub: HubChromeApi;

  override render() {
    return html`<h2>${this.strings.catalogue}</h2>
      ${this.renderBody()}`;
  }

  private renderBody() {
    const { strings, catalogue } = this;
    switch (catalogue.kind) {
      case "off":
        // The Hub Chrome draws no way here in dev mode.
        throw new Error("Dev mode has no Plugin Catalogue");
      case "checking":
        return html`<p role="status">${strings.checkingRegistry}</p>`;
      case "unreachable":
        return html`<p role="alert">${strings.registryUnreachable}</p>
          <button
            @click=${() => {
              this.hub.retryRegistry();
            }}
          >
            ${strings.retry}
          </button>`;
      case "listed":
        return catalogue.plugins.length === 0
          ? html`<p>${strings.noPluginsOffered}</p>`
          : html`<ul>
              ${catalogue.plugins.map(
                (plugin) =>
                  html`<li .style=${iconStyle(plugin)}>
                    <div class="entry">
                      <h3>${plugin.name}</h3>
                      <p>${plugin.description}</p>
                      ${
                        plugin.installed.kind === "installed"
                          ? html`<p class="reason">
                              ${strings.installedVersion(
                                plugin.installed.version,
                              )}
                            </p>`
                          : nothing
                      }
                      ${
                        plugin.access.kind === "blocked"
                          ? html`<p class="reason">
                              ${strings.blocked[plugin.access.reason]}
                            </p>`
                          : nothing
                      }
                      ${this.renderJob(plugin)}
                    </div>
                    ${this.renderAction(plugin)}
                  </li>`,
              )}
            </ul>`;
      default:
        return catalogue satisfies never;
    }
  }

  private renderJob({ job }: CataloguePlugin) {
    const { strings } = this;
    switch (job.kind) {
      case "none":
        return nothing;
      case "installing":
        return html`<p role="status">${strings.installing}</p>`;
      case "uninstalling":
        return html`<p role="status">${strings.uninstalling}</p>`;
      case "install-failed":
        return html`<p role="alert">${strings.installFailed[job.cause]}</p>
          <button
            @click=${() => {
              this.hub.exportDiagnostics();
            }}
          >
            ${strings.exportDiagnostics}
          </button>`;
      default:
        return job satisfies never;
    }
  }

  // **Uninstall** for an installed Plugin with no job; **Install** for an installable Plugin not
  // installed and not installing.
  private renderAction({ id, access, installed, job }: CataloguePlugin) {
    if (installed.kind === "installed") {
      return job.kind === "none"
        ? html`<button
            class="action"
            @click=${() => {
              this.hub.uninstall(id);
            }}
          >
            ${this.strings.uninstall}
          </button>`
        : nothing;
    }
    if (access.kind === "blocked" || job.kind === "installing") {
      return nothing;
    }
    return html`<button
      class="action"
      @click=${() => {
        this.hub.install(id);
      }}
    >
      ${this.strings.install}
    </button>`;
  }
}

customElements.define("plugin-catalogue", PluginCatalogue);

declare global {
  interface HTMLElementTagNameMap {
    "plugin-catalogue": PluginCatalogue;
  }
}
