// The Assistant Panel (spec #101): the front Plugin's conversation with its Assistant, held in
// main and drawn from snapshots, and a composer. Replies are Markdown (`reply-markdown`), each
// code block with a copy button. Its look is variant A of the Assistant Panel prototype (#145):
// a card composer with attachment chips, the model pill and Send, and bubbles for staff's messages.

import type { PluginId } from "@hawkeye-hub/plugin-format";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type {
  AiContent,
  AiFailure,
  AiModelChoice,
  Attachment,
  SentPart,
} from "../shared/ai-call";
import type {
  AssistantPanel as Panel,
  Conversation,
  CurrentModel,
  HubChromeApi,
  ModelInput,
  PromptTemplate,
} from "../shared/hub-chrome-ipc";
import {
  attach,
  bytesOf,
  pickerAccept,
  sizeText,
  takes,
  type Refusal,
} from "./composer-files";
import { icon, type IconName } from "./icons";
import { replyHtml } from "./reply-markdown";
import type { Strings } from "./strings";
import { native } from "./theme";

/** A paste longer than this many characters becomes a "Pasted text" chip. */
const LONG_PASTE_CHARS = 1000;

const KIND_ICONS = {
  image: "image",
  document: "file-text",
  audio: "audio-lines",
  text: "file-code",
} as const satisfies Record<ModelInput | "text", IconName>;

/** A reply's text: replies are text only. */
function textOf(content: AiContent): string {
  return content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n");
}

function sameChoice(a: AiModelChoice, b: AiModelChoice): boolean {
  if (a.kind === "default" || b.kind === "default") return a.kind === b.kind;
  return a.provider === b.provider && a.model === b.model;
}

/** An attachment waiting in the composer, under an id its thumbnail is kept by. */
interface Chip {
  id: number;
  attachment: Attachment;
}

export class AssistantPanel extends LitElement {
  static override styles = [
    native,
    css`
      :host {
        --hover: color-mix(in srgb, var(--hub-color-accent) 8%, transparent);
        display: flex;
        flex-direction: column;
        min-height: 0;
        /* 380px wide in its 400px column, as its own card beside the Plugin UI. */
        margin: 0 var(--hub-space-2) var(--hub-space-2) var(--hub-space-3);
        background: var(--hub-color-surface);
        border: 1px solid var(--hub-color-line);
        border-radius: var(--hub-radius-3);
      }
      svg.icon {
        flex: none;
        width: 18px;
        height: 18px;
      }
      .flat {
        border: 0;
        background: none;
        box-shadow: none;
        padding: 0;
        min-height: 0;
        color: inherit;
      }
      .flat:hover:not(:disabled) {
        background-image: none;
      }
      header {
        flex: none;
        display: flex;
        align-items: center;
        gap: var(--hub-space-2);
        padding: var(--hub-space-3) var(--hub-space-4) var(--hub-space-2);
      }
      header > .icon {
        color: var(--hub-color-accent);
      }
      h2 {
        flex: 1;
        margin: 0;
        font-size: inherit;
        font-weight: 600;
      }
      .icon-button {
        width: 30px;
        height: 30px;
        border-radius: var(--hub-radius-2);
        display: grid;
        place-items: center;
        color: var(--hub-color-fg-muted);
      }
      .icon-button:hover:not(:disabled) {
        background: var(--hover);
        color: var(--hub-color-fg);
      }
      ol {
        flex: 1;
        overflow-y: auto;
        list-style: none;
        margin: 0;
        padding: var(--hub-space-2) var(--hub-space-4);
        display: flex;
        flex-direction: column;
        gap: var(--hub-space-4);
      }
      .hello {
        margin: auto 0;
        text-align: center;
        color: var(--hub-color-fg-muted);
        display: grid;
        gap: var(--hub-space-2);
        justify-items: center;
      }
      .hello .icon {
        width: 28px;
        height: 28px;
        color: var(--hub-color-accent);
      }
      .hello b {
        color: var(--hub-color-fg);
        font-size: var(--hub-text-lg);
      }
      .user {
        align-self: flex-end;
        max-width: 85%;
        display: grid;
        gap: 6px;
        justify-items: end;
      }
      .bubble {
        padding: var(--hub-space-2) var(--hub-space-3);
        border-radius: 16px 16px 4px 16px;
        background: color-mix(
          in srgb,
          var(--hub-color-accent) 17%,
          transparent
        );
        white-space: pre-wrap;
      }
      .reply {
        line-height: 1.55;
      }
      .reply > :first-child {
        margin-top: 0;
      }
      .reply > :last-child {
        margin-bottom: 0;
      }
      .reply[aria-busy="true"]::after {
        content: "";
        display: inline-block;
        width: 8px;
        height: 8px;
        margin-left: 4px;
        border-radius: 50%;
        background: var(--hub-color-accent);
        animation: pulse 1s infinite;
      }
      @keyframes pulse {
        50% {
          opacity: 0.25;
        }
      }
      .code {
        position: relative;
      }
      pre {
        overflow-x: auto;
      }
      .copy {
        position: absolute;
        top: var(--hub-space-1);
        right: var(--hub-space-1);
      }

      .chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--hub-space-2);
      }
      .user .chips {
        justify-content: flex-end;
      }
      .chip {
        position: relative;
        display: flex;
        align-items: center;
        gap: var(--hub-space-2);
        min-width: 0;
        max-width: 220px;
        box-sizing: border-box;
        padding: 6px 28px 6px 6px;
        border-radius: var(--hub-radius-2);
        background: var(--hub-color-surface);
        border: 1px solid var(--hub-color-line);
      }
      .tile {
        flex: none;
        width: 34px;
        height: 34px;
        border-radius: 8px;
        display: grid;
        place-items: center;
        color: #fff;
      }
      .tile.document {
        background: #d4493b;
      }
      .tile.audio {
        background: #7a5af5;
      }
      .tile.text {
        background: #3b82c4;
      }
      .meta {
        display: grid;
        min-width: 0;
        line-height: 1.25;
      }
      .name {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: var(--hub-text-sm);
        font-weight: 600;
      }
      .size {
        font-size: 11px;
        color: var(--hub-color-fg-muted);
      }
      .thumb {
        position: relative;
        flex: none;
        width: 64px;
        height: 64px;
        border-radius: var(--hub-radius-2);
        overflow: hidden;
        border: 1px solid var(--hub-color-line);
      }
      .thumb img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .remove {
        position: absolute;
        top: 4px;
        right: 4px;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: rgb(0 0 0 / 0.62);
        color: #fff;
      }
      .remove .icon {
        width: 12px;
        height: 12px;
      }
      .chip .remove {
        top: 50%;
        transform: translateY(-50%);
        background: none;
        color: var(--hub-color-fg-muted);
      }
      .chip .remove:hover {
        color: var(--hub-color-fg);
        background: var(--hover);
      }
      .not-for-model {
        border-color: var(--hub-color-warning);
        box-shadow: 0 0 0 1px var(--hub-color-warning);
      }
      .not-for-model .size {
        color: var(--hub-color-warning);
      }
      .not-for-model.thumb img {
        opacity: 0.4;
      }
      .band {
        position: absolute;
        inset: auto 0 0;
        padding: 2px;
        font-size: var(--hub-text-sm);
        line-height: 1.2;
        text-align: center;
        background: var(--hub-color-warning);
        color: var(--hub-color-on-accent);
      }
      .sent .chip {
        padding-right: var(--hub-space-2);
      }
      .sent .thumb {
        width: 52px;
        height: 52px;
      }

      .foot {
        flex: none;
        display: grid;
        gap: var(--hub-space-2);
        padding: var(--hub-space-2) var(--hub-space-3) var(--hub-space-3);
      }
      .templates {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .templates button {
        border-radius: 999px;
        min-height: 0;
        padding: 5px 12px;
        font-size: var(--hub-text-sm);
      }
      form {
        display: grid;
        gap: var(--hub-space-2);
        padding: var(--hub-space-2);
        border-radius: var(--hub-radius-3);
        background: var(--hub-color-surface-raised);
        border: 1px solid var(--hub-color-line);
        box-shadow: var(--hub-shadow-1);
      }
      form:focus-within {
        border-color: color-mix(
          in srgb,
          var(--hub-color-accent) 50%,
          var(--hub-color-line)
        );
      }
      textarea,
      textarea:focus,
      textarea:focus-visible {
        field-sizing: content;
        min-height: 44px;
        max-height: 200px;
        resize: none;
        width: 100%;
        box-sizing: border-box;
        border: 0;
        background: none;
        box-shadow: none;
        outline: none;
        padding: 4px 6px;
        line-height: 1.45;
      }
      .tools {
        display: flex;
        align-items: center;
        gap: var(--hub-space-1);
      }
      .grow {
        flex: 1;
      }
      .pill {
        anchor-name: --model-pill;
        display: flex;
        align-items: center;
        gap: 4px;
        height: 30px;
        min-height: 0;
        max-width: 170px;
        padding: 0 8px 0 12px;
        border-radius: 999px;
        border: 1px solid var(--hub-color-line);
        background: none;
        box-shadow: none;
        font-size: var(--hub-text-sm);
        color: var(--hub-color-fg-muted);
      }
      .pill:hover:not(:disabled) {
        background: var(--hover);
        color: var(--hub-color-fg);
      }
      .pill span {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .pill .icon {
        width: 14px;
        height: 14px;
      }
      .send {
        width: 32px;
        height: 32px;
        min-height: 0;
        padding: 0;
        border-radius: 50%;
        display: grid;
        place-items: center;
        border: 0;
        background: var(--hub-color-accent);
        color: var(--hub-color-on-accent);
      }
      .send:disabled {
        background: var(--hub-color-line);
        color: var(--hub-color-fg-muted);
        opacity: 1;
      }
      .send .icon {
        width: 16px;
        height: 16px;
        stroke-width: 2.4;
      }
      .send.stop .icon {
        width: 12px;
        height: 12px;
        fill: currentColor;
      }
      .refusal {
        display: flex;
        gap: 6px;
        align-items: flex-start;
        font-size: var(--hub-text-sm);
        line-height: 1.35;
        color: var(--hub-color-warning);
      }
      .refusal .icon {
        width: 14px;
        height: 14px;
        margin-top: 1px;
      }

      /* The model menu, above the pill. */
      [popover] {
        position-anchor: --model-pill;
        inset: auto;
        right: anchor(right);
        bottom: anchor(top);
        margin: 0 0 var(--hub-space-1);
        min-width: 250px;
        padding: 6px;
        border-radius: var(--hub-radius-2);
        background: var(--hub-color-surface-raised);
        border: 1px solid var(--hub-color-line);
        box-shadow: var(--hub-shadow-2);
        backdrop-filter: blur(var(--hub-glass-blur));
        color: var(--hub-color-fg);
      }
      .group {
        padding: 6px 8px 2px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--hub-color-fg-muted);
      }
      [role="menuitemradio"] {
        width: 100%;
        display: flex;
        align-items: center;
        gap: var(--hub-space-2);
        padding: 7px 8px;
        border-radius: var(--hub-radius-1);
        text-align: start;
      }
      [role="menuitemradio"]:hover {
        background: var(--hover);
      }
      .checked {
        width: 16px;
        height: 16px;
        color: var(--hub-color-accent);
      }
      .model-name {
        flex: 1;
      }
      .inputs {
        display: flex;
        gap: 4px;
        font-size: 11px;
        color: var(--hub-color-fg-muted);
      }
      .inputs .icon {
        width: 13px;
        height: 13px;
      }
    `,
  ];

  static override properties = {
    strings: { attribute: false },
    pluginId: { attribute: false },
    conversation: { attribute: false },
    templates: { attribute: false },
    model: { attribute: false },
    providers: { attribute: false },
    hub: { attribute: false },
    draft: { state: true },
    chips: { state: true },
    refusals: { state: true },
  };
  declare strings: Strings;
  declare pluginId: PluginId;
  declare conversation: Conversation;
  declare templates: PromptTemplate[];
  declare model: CurrentModel;
  declare providers: Extract<Panel, { kind: "open" }>["providers"];
  declare hub: HubChromeApi;
  // What staff are typing. Kept here, not in main: a Hub Chrome reload loses only an unsent draft.
  declare draft: string;
  // Attached files and long pastes, sent after the draft.
  declare chips: Chip[];
  // Why the files last pasted, dropped or picked were not attached, until the next attach.
  declare refusals: Refusal[];
  private nextChip = 0;
  // Image thumbnails as blob: URLs, made once each: every snapshot brings fresh copies of the
  // conversation's images. Keyed `chip:<id>` and `sent:<message>.<part>`.
  private readonly thumbnails = new Map<string, string>();

  constructor() {
    super();
    this.draft = "";
    this.chips = [];
    this.refusals = [];
    // Dropped files become chips, anywhere on the Panel; dropped text lands in the textarea as
    // usual. Even a refused file: the Hub Chrome never opens a dropped file.
    this.addEventListener("dragover", (event) => {
      event.preventDefault();
    });
    this.addEventListener("drop", (event) => {
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length === 0) return;
      event.preventDefault();
      void this.attachAll(files);
    });
  }

  override willUpdate(changed: PropertyValues<this>): void {
    const before = changed.get("model");
    if (before !== undefined && !sameChoice(before.choice, this.model.choice)) {
      this.refusals = [];
    }
    if (this.conversation.messages.length === 0) this.forget("sent:");
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.forget("");
  }

  private forget(prefix: string): void {
    for (const [key, url] of this.thumbnails) {
      if (!key.startsWith(prefix)) continue;
      URL.revokeObjectURL(url);
      this.thumbnails.delete(key);
    }
  }

  private thumbnail(key: string, image: Uint8Array, mediaType: string): string {
    const made = this.thumbnails.get(key);
    if (made !== undefined) return made;
    const url = URL.createObjectURL(
      new Blob([image.slice()], { type: mediaType }),
    );
    this.thumbnails.set(key, url);
    return url;
  }

  /** What the current model accepts besides text: nothing while there is no model. */
  private inputs(): ModelInput[] {
    return this.model.kind === "chosen" ? this.model.inputs : [];
  }

  /** The current model's name, as the pill shows it. */
  private modelName(): string {
    if (this.model.kind === "chosen") return this.model.model;
    const { choice } = this.model;
    return choice.kind === "default" ? this.strings.defaultModel : choice.model;
  }

  private sentParts(): SentPart[] {
    return [
      ...(this.draft.trim() === ""
        ? []
        : [{ kind: "typed" as const, text: this.draft }]),
      ...this.chips.map(({ attachment }) => attachment),
    ];
  }

  private blocked(): Chip[] {
    const inputs = this.inputs();
    return this.chips.filter(({ attachment }) => !takes(inputs, attachment));
  }

  private send(): void {
    if (
      this.sentParts().length === 0 ||
      this.blocked().length > 0 ||
      this.conversation.reply.kind === "streaming"
    )
      return;
    this.hub.sendToAssistant(this.pluginId, this.sentParts());
    this.draft = "";
    this.chips = [];
    this.refusals = [];
    this.forget("chip:");
  }

  private addChips(attachments: Attachment[]): void {
    this.chips = [
      ...this.chips,
      ...attachments.map((attachment) => ({
        id: this.nextChip++,
        attachment,
      })),
    ];
  }

  /** Attaches what the current model can take of `files`, and says why the rest were not. */
  private async attachAll(files: File[]): Promise<void> {
    const inputs = this.inputs();
    const picked = await Promise.all(files.map((file) => attach(file, inputs)));
    this.addChips(
      picked.flatMap((one) =>
        one.kind === "attached" ? [one.attachment] : [],
      ),
    );
    this.refusals = picked.flatMap((one) =>
      one.kind === "refused" ? [one.refusal] : [],
    );
  }

  // A file becomes a chip, as does a long text; a short text pastes as usual.
  private readonly onPaste = (event: ClipboardEvent): void => {
    if (event.clipboardData === null) return;
    const files = [...event.clipboardData.files];
    if (files.length > 0) {
      event.preventDefault();
      void this.attachAll(files);
      return;
    }
    const text = event.clipboardData.getData("text/plain");
    if (text.length > LONG_PASTE_CHARS) {
      event.preventDefault();
      this.addChips([
        {
          kind: "attached",
          name: this.strings.pastedText,
          part: { type: "text", text },
        },
      ]);
    }
  };

  /** A chip: a thumbnail for an image, else a type tile, name and size. `remove` is null once sent. */
  private chip(
    key: string,
    attachment: Attachment,
    remove: (() => void) | null,
  ) {
    const { strings } = this;
    const { name, part } = attachment;
    // A sent attachment went to the model it was sent to.
    const notForModel = remove !== null && !takes(this.inputs(), attachment);
    const removeButton =
      remove === null
        ? nothing
        : html`<button
            type="button"
            class="flat remove"
            aria-label=${strings.remove(name)}
            @click=${remove}
          >
            ${icon("x")}
          </button>`;
    if (part.type === "image") {
      return html`<div
        class="thumb ${notForModel ? "not-for-model" : ""}"
        title=${name}
      >
        <img
          alt=${name}
          src=${this.thumbnail(key, part.image, part.mediaType)}
        />
        ${notForModel ? html`<span class="band">${strings.notForThisModel}</span>` : nothing}
        ${removeButton}
      </div>`;
    }
    return html`<div
      class="chip ${notForModel ? "not-for-model" : ""}"
      title=${name}
    >
      <span class="tile ${part.type}">${icon(KIND_ICONS[part.type])}</span>
      <span class="meta">
        <span class="name">${name}</span>
        <span class="size">
          ${
            notForModel
              ? strings.notForThisModel
              : `${strings.fileKinds[part.type]} · ${sizeText(bytesOf(attachment))}`
          }
        </span>
      </span>
      ${removeButton}
    </div>`;
  }

  private renderChips() {
    if (this.chips.length === 0) return nothing;
    return html`<div class="chips">
      ${this.chips.map(({ id, attachment }) =>
        this.chip(`chip:${String(id)}`, attachment, () => {
          this.chips = this.chips.filter((chip) => chip.id !== id);
          this.refusals = [];
          this.forget(`chip:${String(id)}`);
        }),
      )}
    </div>`;
  }

  private renderUserMessage(parts: SentPart[], index: number) {
    const typed = parts.flatMap((sent) =>
      sent.kind === "typed" ? [sent.text] : [],
    );
    return html`<li class="user" aria-label=${this.strings.you}>
      ${
        parts.some(({ kind }) => kind === "attached")
          ? html`<div class="chips sent">
              ${parts.map((sent, at) =>
                sent.kind === "attached"
                  ? this.chip(`sent:${String(index)}.${String(at)}`, sent, null)
                  : nothing,
              )}
            </div>`
          : nothing
      }
      ${
        typed.length === 0
          ? nothing
          : html`<div class="bubble">${typed.join("\n\n")}</div>`
      }
    </li>`;
  }

  private refusalLine() {
    const { strings } = this;
    const blocked = this.blocked();
    const text =
      blocked.length > 0
        ? strings.cantRead(this.modelName(), [
            ...new Set(
              blocked.flatMap(({ attachment: { part } }) =>
                part.type === "text" ? [] : [part.type],
              ),
            ),
          ])
        : this.refusals
            .map((refusal) => strings.refused(refusal, this.modelName()))
            .join(" ");
    if (text === "") return nothing;
    return html`<div class="refusal" role="status">
      ${icon("alert-triangle")}<span>${text}</span>
    </div>`;
  }

  private renderTemplates() {
    if (this.templates.length === 0) return nothing;
    return html`<div
      class="templates"
      role="group"
      aria-label=${this.strings.promptTemplates}
    >
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

  private menuItem(
    choice: AiModelChoice,
    label: string,
    inputs: ModelInput[] | null,
  ) {
    const checked = sameChoice(choice, this.model.choice);
    return html`<button
      type="button"
      class="flat"
      role="menuitemradio"
      aria-checked=${checked ? "true" : "false"}
      popovertarget="models"
      popovertargetaction="hide"
      @click=${() => {
        this.hub.chooseModel(this.pluginId, choice);
      }}
    >
      <span class="checked">${checked ? icon("check") : nothing}</span>
      <span class="model-name">${label}</span>
      ${
        inputs === null
          ? nothing
          : html`<span class="inputs">
              ${
                inputs.length === 0
                  ? this.strings.textOnly
                  : inputs.map((input) => icon(KIND_ICONS[input]))
              }
            </span>`
      }
    </button>`;
  }

  // Default, every saved provider's models grouped by provider, and the Plugin's choice if it has
  // since been removed, so staff see which one fails (no silent switch).
  private modelMenu() {
    const { strings } = this;
    const { choice } = this.model;
    const listed = this.providers.some(({ label, models }) =>
      models.some(({ id }) =>
        sameChoice(choice, { kind: "chosen", provider: label, model: id }),
      ),
    );
    return html`<div
      popover
      id="models"
      role="menu"
      aria-label=${strings.model}
    >
      ${this.menuItem({ kind: "default" }, strings.defaultModel, null)}
      ${this.providers.map(
        ({ label, models }) =>
          html`<div class="group">${label}</div>
            ${models.map(({ id, inputs }) =>
              this.menuItem(
                { kind: "chosen", provider: label, model: id },
                id,
                inputs,
              ),
            )}`,
      )}
      ${
        choice.kind === "default" || listed
          ? nothing
          : html`<div class="group">${choice.provider}</div>
              ${this.menuItem(choice, choice.model, null)}`
      }
    </div>`;
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
    const { reply, messages } = conversation;
    const streaming = reply.kind === "streaming";
    const empty = messages.length === 0 && !streaming;
    return html`<header>
        ${icon("sparkles")}
        <h2>${strings.assistant}</h2>
        ${
          messages.length === 0
            ? nothing
            : html`<button
                type="button"
                class="flat icon-button"
                aria-label=${strings.newConversation}
                title=${strings.newConversation}
                @click=${() => {
                  this.hub.newConversation(this.pluginId);
                }}
              >
                ${icon("trash")}
              </button>`
        }
        <button
          type="button"
          class="flat icon-button"
          aria-label=${strings.closePanel}
          title=${strings.closePanel}
          @click=${() => {
            this.hub.toggleAssistant(this.pluginId);
          }}
        >
          ${icon("panel-right-close")}
        </button>
      </header>
      <ol @click=${this.onReplyClick}>
        ${
          empty
            ? html`<li class="hello">
                ${icon("sparkles")}<b>${strings.howCanIHelp}</b>
                <span>${strings.canAttach(this.inputs())}</span>
              </li>`
            : nothing
        }
        ${messages.map((message, index) =>
          message.role === "user"
            ? this.renderUserMessage(message.parts, index)
            : html`<li class="reply">
                ${unsafeHTML(replyHtml(textOf(message.content), strings.copy))}
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
      <div class="foot">
        ${empty ? this.renderTemplates() : nothing}
        <form
          @submit=${(event: SubmitEvent) => {
            event.preventDefault();
            this.send();
          }}
        >
          ${this.renderChips()}
          <textarea
            rows="1"
            aria-label=${strings.message}
            placeholder=${strings.askAssistant}
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
          <div class="tools">
            <button
              type="button"
              class="flat icon-button"
              aria-label=${strings.attachFiles}
              title=${strings.attachFiles}
              @click=${() => {
                this.renderRoot.querySelector("input")?.click();
              }}
            >
              ${icon("paperclip")}
            </button>
            <input
              type="file"
              hidden
              multiple
              accept=${pickerAccept(this.inputs())}
              @change=${(event: Event) => {
                if (!(event.target instanceof HTMLInputElement)) return;
                void this.attachAll([...(event.target.files ?? [])]);
                // So the same file can be attached again.
                event.target.value = "";
              }}
            />
            <span class="grow"></span>
            <button
              type="button"
              class="pill"
              popovertarget="models"
              aria-haspopup="menu"
              aria-label=${strings.model}
              title=${strings.model}
            >
              <span>${this.modelName()}</span>${icon("chevron-down")}
            </button>
            ${
              streaming
                ? html`<button
                    type="button"
                    class="send stop"
                    aria-label=${strings.stop}
                    @click=${() => {
                      this.hub.stopAssistant(this.pluginId);
                    }}
                  >
                    ${icon("square")}
                  </button>`
                : html`<button
                    type="submit"
                    class="send"
                    aria-label=${strings.send}
                    ?disabled=${
                      this.sentParts().length === 0 || this.blocked().length > 0
                    }
                  >
                    ${icon("arrow-up")}
                  </button>`
            }
          </div>
        </form>
        ${this.refusalLine()} ${this.modelMenu()}
      </div>`;
  }
}

customElements.define("assistant-panel", AssistantPanel);

declare global {
  interface HTMLElementTagNameMap {
    "assistant-panel": AssistantPanel;
  }
}
