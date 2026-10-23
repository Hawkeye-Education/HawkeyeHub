// The Assistant Panel (spec #101): the front Plugin's conversation with its Assistant, held in
// main and drawn from snapshots, and a composer. Replies are Markdown (`reply-markdown`), each
// code block with a copy button. No Theme yet (ADR 0006).

import type { PluginId } from "@hawkeye-hub/plugin-format";
import { LitElement, css, html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { AiContent, AiFailure, AiModelChoice } from "../shared/ai-call";
import type {
  AssistantPanel as Panel,
  Conversation,
  HubChromeApi,
} from "../shared/hub-chrome-ipc";
import { replyHtml } from "./reply-markdown";
import type { Strings } from "./strings";

/** A message's text; other parts (images, #110) are not drawn yet. */
function textOf(content: AiContent): string {
  return content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n");
}

function sameChoice(a: AiModelChoice, b: AiModelChoice): boolean {
  if (a.kind === "default" || b.kind === "default") return a.kind === b.kind;
  return a.provider === b.provider && a.model === b.model;
}

export class AssistantPanel extends LitElement {
  static override styles = css`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      border-left: 1px solid #ccc;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      border-bottom: 1px solid #ccc;
    }
    h2 {
      margin: 0;
      font-size: 16px;
    }
    ol {
      flex: 1;
      overflow-y: auto;
      list-style: none;
      margin: 0;
      padding: 8px 16px;
    }
    li {
      margin-block: 8px;
    }
    .user {
      white-space: pre-wrap;
      background: #f0f0f0;
      padding: 8px;
      border-radius: 8px;
    }
    .code {
      position: relative;
    }
    pre {
      overflow-x: auto;
      background: #f6f6f6;
      padding: 8px;
    }
    .copy {
      position: absolute;
      top: 4px;
      right: 4px;
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px 16px 16px;
      border-top: 1px solid #ccc;
    }
    textarea {
      font: inherit;
      resize: vertical;
      min-height: 4lh;
    }
    form button {
      align-self: end;
    }
  `;

  static override properties = {
    strings: { attribute: false },
    pluginId: { attribute: false },
    conversation: { attribute: false },
    model: { attribute: false },
    providers: { attribute: false },
    hub: { attribute: false },
    draft: { state: true },
  };
  declare strings: Strings;
  declare pluginId: PluginId;
  declare conversation: Conversation;
  declare model: AiModelChoice;
  declare providers: Extract<Panel, { kind: "open" }>["providers"];
  declare hub: HubChromeApi;
  // What staff are typing. Kept here, not in main: a Hub Chrome reload loses only an unsent draft.
  declare draft: string;

  constructor() {
    super();
    this.draft = "";
  }

  // The composer's content as sent. Templates and paste chips (#110) add to it.
  private contentOf(): AiContent {
    return [{ type: "text", text: this.draft }];
  }

  private send(): void {
    if (
      this.draft.trim() === "" ||
      this.conversation.reply.kind === "streaming"
    )
      return;
    this.hub.sendToAssistant(this.pluginId, this.contentOf());
    this.draft = "";
  }

  // Copy buttons and links come from rendered Markdown, so their clicks are handled here.
  private readonly onReplyClick = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return;
    const copy = event.target.closest("button.copy");
    if (copy !== null) {
      // The fence rule puts the button right after its <pre>.
      const code = copy.previousElementSibling?.textContent;
      if (typeof code === "string") {
        // Without the block's last line break, so a regex pastes as one line. A rejection is a
        // Hub bug, logged in the Hub Chrome's console.
        void navigator.clipboard.writeText(code.replace(/\n$/, "")).then(() => {
          copy.textContent = this.strings.copied;
        });
      }
      return;
    }
    // ponytail: a link in a reply does nothing, so it never navigates the Hub Chrome; open it in the
    // browser through main if staff ask for it.
    if (event.target.closest("a") !== null) event.preventDefault();
  };

  // Default, every saved provider's models, and the Plugin's choice if it has since been removed,
  // so staff see which one fails (no silent switch).
  private modelPicker() {
    const { strings, model } = this;
    const listed: AiModelChoice[] = [
      { kind: "default" },
      ...this.providers.flatMap(({ label, models }) =>
        models.map(({ id }) => ({
          kind: "chosen" as const,
          provider: label,
          model: id,
        })),
      ),
    ];
    const choices = listed.some((choice) => sameChoice(choice, model))
      ? listed
      : [...listed, model];
    return html`<select
      aria-label=${strings.model}
      @change=${(event: Event) => {
        if (!(event.target instanceof HTMLSelectElement)) return;
        const choice = choices[event.target.selectedIndex];
        if (choice !== undefined) this.hub.chooseModel(this.pluginId, choice);
      }}
    >
      ${choices.map(
        (choice) =>
          html`<option ?selected=${sameChoice(choice, model)}>
            ${
              choice.kind === "default"
                ? strings.defaultModel
                : `${choice.provider} · ${choice.model}`
            }
          </option>`,
      )}
    </select>`;
  }

  private failureText(failure: AiFailure) {
    const { strings } = this;
    switch (failure.code) {
      case "no-provider":
        return html`${strings.noProvider}
          <button
            type="button"
            @click=${() => {
              this.hub.showSettings();
            }}
          >
            ${strings.openSettings}
          </button>`;
      case "provider-missing":
        return strings.providerMissing;
      case "provider-rejected":
        return strings.providerRejected(failure.status);
      case "provider-unreachable":
        return strings.providerUnreachable;
      default:
        return failure satisfies never;
    }
  }

  override render() {
    const { strings, conversation } = this;
    const { reply } = conversation;
    const streaming = reply.kind === "streaming";
    return html`<header>
        <h2>${strings.assistant}</h2>
        ${this.modelPicker()}
        <button
          type="button"
          @click=${() => {
            this.hub.newConversation(this.pluginId);
          }}
        >
          ${strings.newConversation}
        </button>
      </header>
      <ol @click=${this.onReplyClick}>
        ${conversation.messages.map(({ role, content }) =>
          role === "user"
            ? html`<li class="user" aria-label=${strings.you}>
                ${textOf(content)}
              </li>`
            : html`<li class="reply">
                ${unsafeHTML(replyHtml(textOf(content), strings.copy))}
              </li>`,
        )}
        ${
          streaming
            ? html`<li class="reply" aria-busy="true">
                ${unsafeHTML(replyHtml(reply.text, strings.copy))}
              </li>`
            : nothing
        }
        ${
          reply.kind === "failed"
            ? html`<li role="alert">${this.failureText(reply.failure)}</li>`
            : nothing
        }
      </ol>
      <form
        @submit=${(event: SubmitEvent) => {
          event.preventDefault();
          this.send();
        }}
      >
        <textarea
          aria-label=${strings.message}
          .value=${this.draft}
          @input=${(event: InputEvent) => {
            if (event.target instanceof HTMLTextAreaElement) {
              this.draft = event.target.value;
            }
          }}
          @keydown=${(event: KeyboardEvent) => {
            // Enter sends; Shift+Enter is a new line.
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.isComposing
            ) {
              event.preventDefault();
              this.send();
            }
          }}
        ></textarea>
        ${
          streaming
            ? html`<button
                type="button"
                @click=${() => {
                  this.hub.stopAssistant(this.pluginId);
                }}
              >
                ${strings.stop}
              </button>`
            : html`<button type="submit" ?disabled=${this.draft.trim() === ""}>
                ${strings.send}
              </button>`
        }
      </form>`;
  }
}

customElements.define("assistant-panel", AssistantPanel);

declare global {
  interface HTMLElementTagNameMap {
    "assistant-panel": AssistantPanel;
  }
}
