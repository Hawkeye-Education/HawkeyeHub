// Hub Kit v1's elements as a Plugin UI sees them (ADR 0010, PLUGIN_STANDARD.md §4.3), defined by
// the Hub before any Plugin code runs. Types only. They need the DOM, which the Hub's main process
// does not have, hence their own entry, `@hawkeye-hub/hub-api/hub-kit`. Importing from it also types
// `document.createElement("hub-log")` and the like.

import type { FolderPath } from "./index";

/** A `<hub-folder-field>`'s folder: none until staff choose one. */
export type FolderFieldValue =
  | { readonly kind: "none" }
  | { readonly kind: "chosen"; readonly path: FolderPath };

/**
 * `<hub-folder-field>`: a label, the chosen path and a Hub-translated **Browse…** button that calls
 * `hub.files.pickFolder(label)`. Fires `change` when staff choose a folder; a cancelled dialog
 * changes nothing.
 */
export interface HubFolderFieldElement extends HTMLElement {
  /** Also the dialog's title. */
  label: string;
  value: FolderFieldValue;
}

export interface HubLogLine {
  readonly tone: "info" | "success" | "danger";
  readonly text: string;
}

/** `<hub-log>`: each line coloured by its tone, scrolled to the newest. */
export interface HubLogElement extends HTMLElement {
  append(line: HubLogLine): void;
  /** `Element.append`, kept so the element is still an `HTMLElement`: its children never show. */
  append(...nodes: (Node | string)[]): void;
  clear(): void;
}

declare global {
  interface HTMLElementTagNameMap {
    "hub-folder-field": HubFolderFieldElement;
    "hub-log": HubLogElement;
  }
}
