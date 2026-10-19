// A Hub Chrome dialog, drawn on the dialog overlay: a modal <dialog> over a dimmed window. Its
// first button is **Keep open**, focused, so Enter picks it, and Esc picks it too.

import { LitElement, css, html } from "lit";
import type {
  DialogAnswer,
  HubChromeApi,
  HubChromeDialog,
} from "../shared/hub-chrome-ipc";
import type { Strings } from "./strings";

export class HubDialog extends LitElement {
  static override styles = css`
    dialog {
      max-width: 480px;
      border: none;
      border-radius: 8px;
      padding: 24px;
      font-family: system-ui, sans-serif;
    }
    dialog::backdrop {
      background: rgb(0 0 0 / 40%);
    }
    h2 {
      margin: 0 0 12px;
      font-size: 18px;
    }
    ul {
      padding-inline-start: 20px;
    }
    .buttons {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 20px;
    }
  `;

  static override properties = {
    dialog: { attribute: false },
    strings: { attribute: false },
    hub: { attribute: false },
  };
  // `declare`: a class field would shadow Lit's reactive accessor. The Hub Chrome sets them all
  // through its template before the first render.
  declare dialog: HubChromeDialog;
  declare strings: Strings;
  declare hub: HubChromeApi;

  override firstUpdated(): void {
    this.renderRoot.querySelector("dialog")?.showModal();
  }

  private answer(answer: DialogAnswer): void {
    this.hub.answer(answer);
  }

  override render() {
    const { dialog, strings } = this;
    const closing = dialog.kind === "busy-close";
    const heading = closing
      ? strings.closeQuestion(dialog.plugin.name)
      : strings.quitQuestion;
    const body = closing
      ? html`<p>${dialog.plugin.reason}</p>`
      : html`<p>${strings.busyPlugins}</p>
          <ul>
            ${dialog.plugins.map(
              ({ name, reason }) => html`<li><b>${name}</b>: ${reason}</li>`,
            )}
          </ul>`;
    const anyway: DialogAnswer = closing ? "close-anyway" : "quit-anyway";
    // Esc cancels the <dialog>: that is Keep open. Main then takes the overlay away.
    return html`<dialog
      aria-labelledby="heading"
      @cancel=${(event: Event) => {
        event.preventDefault();
        this.answer("keep-open");
      }}
    >
      <h2 id="heading">${heading}</h2>
      ${body}
      <div class="buttons">
        <button
          autofocus
          @click=${() => {
            this.answer("keep-open");
          }}
        >
          ${strings.keepOpen}
        </button>
        <button
          @click=${() => {
            this.answer(anyway);
          }}
        >
          ${closing ? strings.closeAnyway : strings.quitAnyway}
        </button>
      </div>
    </dialog>`;
  }
}

customElements.define("hub-dialog", HubDialog);

declare global {
  interface HTMLElementTagNameMap {
    "hub-dialog": HubDialog;
  }
}
