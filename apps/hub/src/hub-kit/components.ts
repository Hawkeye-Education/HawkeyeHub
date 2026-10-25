// Hub Kit v1's components (ADR 0010), `<hub-folder-field>` and `<hub-log>`, typed in
// `@hawkeye-hub/hub-api`. A page script: the Plugin preload runs it in the page's own world before
// any Plugin code, so it reaches `window.hub` as the Plugin does. Styled only from the `--hub-*`
// tokens, with the native-element stylesheet inside each Shadow DOM for its button.

import type {
  FolderFieldValue,
  HubFolderFieldElement,
  HubLogElement,
  HubLogLine,
} from "@hawkeye-hub/hub-api/hub-kit";
import { LitElement, css, html, unsafeCSS } from "lit";
import type { DisplayLanguage } from "../shared/hub-chrome-ipc";
import nativeCss from "./native.css?raw";

const BROWSE = {
  "en-HK": "Browse…",
  "zh-HK": "瀏覽…",
} satisfies Record<DisplayLanguage, string>;

function isDisplayLanguage(tag: string): tag is DisplayLanguage {
  return Object.hasOwn(BROWSE, tag);
}

// The preload is handed the Hub's own Display Language, so any other is the Hub's bug.
const language = window.hub.displayLanguage;
if (!isDisplayLanguage(language)) {
  throw new Error(`The Hub Kit has no strings for ${language}`);
}
const browse = BROWSE[language];

const native = unsafeCSS(nativeCss);

class HubFolderField extends LitElement implements HubFolderFieldElement {
  static override styles = [
    native,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--hub-space-1);
      }
      .label {
        font-weight: var(--hub-weight-strong);
      }
      .row {
        display: flex;
        align-items: center;
        gap: var(--hub-space-3);
      }
      .path {
        flex: 1;
        min-width: 0;
        overflow-wrap: anywhere;
        color: var(--hub-color-fg-muted);
      }
    `,
  ];

  static override properties = {
    label: {},
    value: { attribute: false },
  };
  // `declare`: a class field would shadow Lit's reactive accessor.
  declare label: string;
  declare value: FolderFieldValue;

  constructor() {
    super();
    this.value = { kind: "none" };
  }

  private async browse(): Promise<void> {
    const picked = await window.hub.files.pickFolder(this.label);
    switch (picked.kind) {
      case "cancelled":
        return;
      case "chosen":
        this.value = { kind: "chosen", path: picked.path };
        this.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      default:
        picked satisfies never;
    }
  }

  override render() {
    return html`
      <span class="label">${this.label}</span>
      <div class="row">
        <span class="path"
          >${this.value.kind === "chosen" ? this.value.path : ""}</span
        >
        <button type="button" @click=${() => void this.browse()}>
          ${browse}
        </button>
      </div>
    `;
  }
}

class HubLog extends LitElement implements HubLogElement {
  static override styles = css`
    :host {
      display: block;
      box-sizing: border-box;
      overflow: auto;
      padding: var(--hub-space-2) var(--hub-space-3);
      background: var(--hub-color-surface);
      border: 1px solid var(--hub-color-line);
      border-radius: var(--hub-radius-2);
      font-family: var(--hub-font-mono);
      font-size: var(--hub-text-sm);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    [data-tone="info"] {
      color: var(--hub-color-fg);
    }
    [data-tone="success"] {
      color: var(--hub-color-success);
    }
    [data-tone="danger"] {
      color: var(--hub-color-danger);
    }
  `;

  private lines: HubLogLine[] = [];

  override append(line: HubLogLine): void;
  override append(...nodes: (Node | string)[]): void;
  override append(...items: (HubLogLine | Node | string)[]): void {
    const [line] = items;
    if (items.length === 1 && isLine(line)) {
      this.lines = [...this.lines, line];
      this.requestUpdate();
      return;
    }
    // Every item is a Node or a string unless the one item is a line.
    super.append(...(items as (Node | string)[]));
  }

  clear(): void {
    this.lines = [];
    this.requestUpdate();
  }

  override render() {
    return html`<div role="log">
      ${this.lines.map(
        ({ tone, text }) => html`<div data-tone=${tone}>${text}</div>`,
      )}
    </div>`;
  }

  // The newest line in view after every append.
  override updated(): void {
    this.scrollTop = this.scrollHeight;
  }
}

function isLine(
  item: HubLogLine | Node | string | undefined,
): item is HubLogLine {
  return typeof item === "object" && !(item instanceof Node);
}

customElements.define("hub-folder-field", HubFolderField);
customElements.define("hub-log", HubLog);
