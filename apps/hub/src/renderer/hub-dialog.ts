// A Hub Chrome dialog, drawn on the dialog overlay: a modal <dialog> over a dimmed window. Its
// first button keeps things as they are (**Keep open**, or **Keep editing**), focused, so Enter
// picks it, and Esc picks it too.

import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import type {
  DialogAnswer,
  HubChromeApi,
  HubChromeDialog,
} from "../shared/hub-chrome-ipc";
import type { Strings } from "./strings";

/** A dialog button: its label and the answer it gives. */
interface Button {
  answer: DialogAnswer;
  label: string;
}

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

  /** The dialog's heading, its body, and its two buttons: what it says and what it answers. */
  private content(): {
    heading: string;
    body: TemplateResult | typeof nothing;
    keep: Button;
    anyway: Button;
  } {
    const { dialog, strings } = this;
    const keepOpen: Button = { answer: "keep-open", label: strings.keepOpen };
    switch (dialog.kind) {
      case "busy-close":
        return {
          heading: strings.closeQuestion(dialog.plugin.name),
          body: html`<p>${dialog.plugin.reason}</p>`,
          keep: keepOpen,
          anyway: { answer: "close-anyway", label: strings.closeAnyway },
        };
      case "busy-quit":
        return {
          heading: strings.quitQuestion,
          body: html`<p>${strings.busyPlugins}</p>
            <ul>
              ${dialog.plugins.map(
                ({ name, reason }) => html`<li><b>${name}</b>: ${reason}</li>`,
              )}
            </ul>`,
          keep: keepOpen,
          anyway: { answer: "quit-anyway", label: strings.quitAnyway },
        };
      case "discard-changes":
        return {
          heading: strings.discardQuestion,
          body: nothing,
          keep: { answer: "keep-editing", label: strings.keepEditing },
          anyway: { answer: "discard", label: strings.discard },
        };
      default:
        return dialog satisfies never;
    }
  }

  override render() {
    const { hub } = this;
    const { heading, body, keep, anyway } = this.content();
    // Esc cancels the <dialog>: that is the first button. Main then takes the overlay away.
    return html`<dialog
      aria-labelledby="heading"
      @cancel=${(event: Event) => {
        event.preventDefault();
        hub.answer(keep.answer);
      }}
    >
      <h2 id="heading">${heading}</h2>
      ${body}
      <div class="buttons">
        <button
          autofocus
          @click=${() => {
            hub.answer(keep.answer);
          }}
        >
          ${keep.label}
        </button>
        <button
          @click=${() => {
            hub.answer(anyway.answer);
          }}
        >
          ${anyway.label}
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
