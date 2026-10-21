// A Hub Chrome dialog, drawn on the dialog overlay: a modal <dialog> over a dimmed window. Its
// first button keeps things as they are (**Keep open**, **Keep editing**, or a crash message's
// **OK**), focused, so Enter picks it, and Esc picks it too.

import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import {
  KEEP_ANSWERS,
  type DialogAnswer,
  type HubChromeApi,
  type HubChromeDialog,
} from "../shared/hub-chrome-ipc";
import type { Strings } from "./strings";

/** A dialog's secondary button: its label and what it does. */
interface Button {
  label: string;
  press: () => void;
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

  /**
   * The dialog's heading, its body, its first button's label, and its secondary button: what it
   * says and what it does. The first button answers `KEEP_ANSWERS`, as main expects.
   */
  private content(): {
    heading: string;
    body: TemplateResult | typeof nothing;
    keepLabel: string;
    secondary: Button;
  } {
    const { dialog, strings, hub } = this;
    const answering = (answer: DialogAnswer, label: string): Button => ({
      label,
      press: () => {
        hub.answer(answer);
      },
    });
    switch (dialog.kind) {
      case "busy-close":
        return {
          heading: strings.closeQuestion(dialog.plugin.name),
          body: html`<p>${dialog.plugin.reason}</p>`,
          keepLabel: strings.keepOpen,
          secondary: answering("close-anyway", strings.closeAnyway),
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
          keepLabel: strings.keepOpen,
          secondary: answering("quit-anyway", strings.quitAnyway),
        };
      case "discard-changes":
        return {
          heading: strings.discardQuestion,
          body: nothing,
          keepLabel: strings.keepEditing,
          secondary: answering("discard", strings.discard),
        };
      case "plugin-crashed":
        // Exporting leaves the message up: only **OK** dismisses it.
        return {
          heading: strings.stoppedUnexpectedly(dialog.plugin.name),
          body: html`<p>${strings.crashCauses[dialog.cause]}</p>`,
          keepLabel: strings.ok,
          secondary: {
            label: strings.exportDiagnostics,
            press: () => {
              hub.exportDiagnostics();
            },
          },
        };
      default:
        return dialog satisfies never;
    }
  }

  override render() {
    const { hub } = this;
    const { heading, body, keepLabel, secondary } = this.content();
    const keep = KEEP_ANSWERS[this.dialog.kind];
    // Esc cancels the <dialog>: that is the first button. Main then takes the overlay away.
    return html`<dialog
      aria-labelledby="heading"
      @cancel=${(event: Event) => {
        event.preventDefault();
        hub.answer(keep);
      }}
    >
      <h2 id="heading">${heading}</h2>
      ${body}
      <div class="buttons">
        <button
          autofocus
          @click=${() => {
            hub.answer(keep);
          }}
        >
          ${keepLabel}
        </button>
        <button @click=${secondary.press}>${secondary.label}</button>
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
