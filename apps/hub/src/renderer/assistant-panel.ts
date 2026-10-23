// The Assistant Panel (spec #101): the front Plugin's conversation with its Assistant, held in
// main and drawn from snapshots, and a composer. Replies are Markdown (`reply-markdown`), each
// code block with a copy button. No Theme yet (ADR 0006).

import type { PluginId } from "@hawkeye-hub/plugin-format";
import { LitElement, css, html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { AiContent, AiFailure } from "../shared/ai-call";
import type {
  Conversation,
  CurrentModel,
  HubChromeApi,
  PromptTemplate,
} from "../shared/hub-chrome-ipc";
import { replyHtml } from "./reply-markdown";
import type { Strings } from "./strings";

/** A paste longer than this many characters becomes a "Pasted text" chip. */
const LONG_PASTE_CHARS = 1000;

/** A reply's text: replies are text only. */
function textOf(content: AiContent): string {
  return content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n");
}

function dataUrlOf(image: Uint8Array, mediaType: string): string {
  let binary = "";
  // In slices, as spreading a whole screenshot overflows the call stack.
  for (let at = 0; at < image.length; at += 0x8000) {
    binary += String.fromCharCode(...image.subarray(at, at + 0x8000));
  }
  return `data:${mediaType};base64,${btoa(binary)}`;
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
    form > button {
      align-self: end;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .chips li {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px;
      border: 1px solid #ccc;
      border-radius: 8px;
    }
    img {
      max-width: 64px;
      max-height: 64px;
    }
    .user img {
      display: block;
      max-width: 100%;
      max-height: 200px;
    }
  `;

  static override properties = {
    strings: { attribute: false },
    pluginId: { attribute: false },
    conversation: { attribute: false },
    templates: { attribute: false },
    model: { attribute: false },
    hub: { attribute: false },
    draft: { state: true },
    chips: { state: true },
  };
  declare strings: Strings;
  declare pluginId: PluginId;
  declare conversation: Conversation;
  declare templates: PromptTemplate[];
  declare model: CurrentModel;
  declare hub: HubChromeApi;
  // What staff are typing. Kept here, not in main: a Hub Chrome reload loses only an unsent draft.
  declare draft: string;
  // Pasted, dropped or attached images and long pastes, sent after the draft.
  declare chips: AiContent;

  constructor() {
    super();
    this.draft = "";
    this.chips = [];
  }

  private contentOf(): AiContent {
    return [
      ...(this.draft.trim() === ""
        ? []
        : [{ type: "text" as const, text: this.draft }]),
      ...this.chips,
    ];
  }

  private send(): void {
    if (
      this.contentOf().length === 0 ||
      this.conversation.reply.kind === "streaming"
    )
      return;
    this.hub.sendToAssistant(this.pluginId, this.contentOf());
    this.draft = "";
    this.chips = [];
  }

  private acceptsImages(): boolean {
    return this.model.kind === "chosen" && this.model.acceptsImages;
  }

  /** Adds the images among `files` as chips, if the model accepts images. */
  private async attach(files: File[]): Promise<void> {
    if (!this.acceptsImages()) return;
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const image = new Uint8Array(await file.arrayBuffer());
      this.chips = [
        ...this.chips,
        { type: "image", image, mediaType: file.type },
      ];
    }
  }

  // An image becomes a chip, as does a long text; a short text pastes as usual.
  private readonly onPaste = (event: ClipboardEvent): void => {
    if (event.clipboardData === null) return;
    const images = [...event.clipboardData.files].filter(({ type }) =>
      type.startsWith("image/"),
    );
    if (images.length > 0 && this.acceptsImages()) {
      event.preventDefault();
      void this.attach(images);
      return;
    }
    const text = event.clipboardData.getData("text/plain");
    if (text.length > LONG_PASTE_CHARS) {
      event.preventDefault();
      this.chips = [...this.chips, { type: "text", text }];
    }
  };

  // Dropped files become chips; dropped text lands in the textarea as usual.
  private readonly onDrop = (event: DragEvent): void => {
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length === 0) return;
    // Even when the model takes no images: the Hub Chrome never opens a dropped file.
    event.preventDefault();
    void this.attach(files);
  };

  private partOf(part: AiContent[number]) {
    return part.type === "text"
      ? html`<div>${part.text}</div>`
      : html`<img
          alt=${this.strings.pastedImage}
          src=${dataUrlOf(part.image, part.mediaType)}
        />`;
  }

  private renderChips() {
    const { strings } = this;
    if (this.chips.length === 0) return nothing;
    return html`<ul class="chips">
      ${this.chips.map(
        (chip) =>
          html`<li>
            ${chip.type === "text" ? strings.pastedText : this.partOf(chip)}
            <button
              type="button"
              aria-label=${strings.remove}
              @click=${() => {
                this.chips = this.chips.filter((other) => other !== chip);
              }}
            >
              ×
            </button>
          </li>`,
      )}
    </ul>`;
  }

  private renderTemplates() {
    if (this.templates.length === 0) return nothing;
    return html`<div role="group" aria-label=${this.strings.promptTemplates}>
      ${this.templates.map(
        ({ label, text }) =>
          html`<button
            type="button"
            @click=${() => {
              this.draft = text;
            }}
          >
            ${label}
          </button>`,
      )}
    </div>`;
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
                ${content.map((part) => this.partOf(part))}
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
        @dragover=${(event: DragEvent) => {
          event.preventDefault();
        }}
        @drop=${this.onDrop}
      >
        ${this.renderTemplates()} ${this.renderChips()}
        <textarea
          aria-label=${strings.message}
          .value=${this.draft}
          @paste=${this.onPaste}
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
          this.acceptsImages()
            ? html`<input
                type="file"
                accept="image/*"
                multiple
                aria-label=${strings.attachImage}
                @change=${(event: Event) => {
                  if (!(event.target instanceof HTMLInputElement)) return;
                  void this.attach([...(event.target.files ?? [])]);
                  // So the same file can be attached again.
                  event.target.value = "";
                }}
              />`
            : nothing
        }
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
            : html`<button
                type="submit"
                ?disabled=${this.contentOf().length === 0}
              >
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
