// Test doubles of Hub Kit v1's elements for happy-dom, where the Hub's preload never runs. They
// behave as apps/hub/src/hub-kit/components.ts does: Browse… calls `hub.files.pickFolder(label)`
// and fires `change`, and each log line is a `[data-tone]` element in the shadow root.
// Import it in a Plugin UI test as `@hawkeye-hub/fake-hub/hub-kit`.

import type {
  FolderFieldValue,
  HubFolderFieldElement,
  HubLogLine,
} from "@hawkeye-hub/hub-api/hub-kit";

class FolderField extends HTMLElement implements HubFolderFieldElement {
  label = "";
  value: FolderFieldValue = { kind: "none" };

  connectedCallback(): void {
    const browse = document.createElement("button");
    browse.textContent = "Browse…";
    browse.addEventListener("click", () => {
      void window.hub.files.pickFolder(this.label).then((picked) => {
        if (picked.kind === "cancelled") return;
        this.value = picked;
        this.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
    this.attachShadow({ mode: "open" }).append(browse);
  }
}

class Log extends HTMLElement {
  readonly #root = this.attachShadow({ mode: "open" });

  override append(...items: (HubLogLine | Node | string)[]): void {
    for (const item of items) {
      if (typeof item === "string" || item instanceof Node) continue;
      const line = document.createElement("div");
      line.dataset["tone"] = item.tone;
      line.textContent = item.text;
      this.#root.append(line);
    }
  }

  clear(): void {
    this.#root.replaceChildren();
  }
}

if (customElements.get("hub-folder-field") === undefined) {
  customElements.define("hub-folder-field", FolderField);
  customElements.define("hub-log", Log);
}

/** Clicks the field's Browse… button. */
export function browse(field: HubFolderFieldElement): void {
  field.shadowRoot?.querySelector("button")?.click();
}

/** The log's lines, as tone and text. */
export function logLines(log: Element): HubLogLine[] {
  return [...(log.shadowRoot?.querySelectorAll("div") ?? [])].map((line) => ({
    // Only `append` writes these, with a tone and text.
    tone: line.dataset["tone"] as HubLogLine["tone"],
    text: line.textContent,
  }));
}
