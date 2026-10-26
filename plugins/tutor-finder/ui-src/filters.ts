// The filters in the left column (source SPEC §4), in its order: level, how they teach, language.
// The district map (#178) slots in between how they teach and language. Status is not a filter:
// parseRows already drops the statuses that never appear, and the table pins the rest (SPEC §4.5).
// There is no subject filter (SPEC §12).

import { t } from "./i18n";
import { LEVELS, type Level, type Tutor } from "./parsing";
import type { ShownTutor } from "./table";

/** The three tutoring_language values (SPEC §4.4). */
export const LANGUAGES = ["Cantonese", "English", "Mandarin"] as const;

/** Face-to-face: the tutor must travel to the client. Online: anyone will do, the default (SPEC §4.2). */
const METHODS = ["face-to-face", "online"] as const;
type Method = (typeof METHODS)[number];

export interface Filters {
  /** null: All levels. */
  level: Level | null;
  method: Method;
  /** Empty: no language filter. */
  languages: ReadonlySet<string>;
}

/** The tutors `filters` let through, each with only the offerings that match its level. */
export function applyFilters(
  tutors: readonly Tutor[],
  filters: Filters,
): ShownTutor[] {
  const { level, method, languages } = filters;
  return tutors.flatMap((tutor) => {
    // An unlevelled offering matches every level: over-including costs a line, under-including
    // loses a tutor (SPEC §3.4).
    const offerings =
      level === null
        ? tutor.offerings
        : tutor.offerings.filter((o) => o.level === level || o.level === null);
    const keep =
      (level === null || offerings.length > 0) &&
      (method === "online" || tutor.faceToFace) && // face-to-face implies online (SPEC §4.2)
      (languages.size === 0 || tutor.languages.some((l) => languages.has(l)));
    return keep ? [{ tutor, offerings }] : [];
  });
}

function fieldset(legend: string, ...controls: HTMLElement[]): HTMLElement {
  const set = document.createElement("fieldset");
  set.className = "stack-tight";
  const title = document.createElement("legend");
  title.textContent = legend;
  set.append(title, ...controls);
  return set;
}

function choice(
  type: "radio" | "checkbox",
  name: string,
  value: string,
  text: string,
): [HTMLLabelElement, HTMLInputElement] {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = type;
  input.name = name;
  input.value = value;
  const span = document.createElement("span");
  span.textContent = text;
  label.append(input, span);
  return [label, input];
}

/** Draws the filters into `aside` and calls `changed` on every change; the result reads them now. */
export function createFilters(
  aside: HTMLElement,
  changed: () => void,
): () => Filters {
  let level: Level | null = null;
  let method: Method = "online";
  const languages = new Set<string>();

  // A native <select> deliberately: the control to change if multi-level matching is wanted (SPEC §4.1).
  const levelLabel = document.createElement("label");
  levelLabel.className = "stack-tight";
  const levelText = document.createElement("span");
  levelText.textContent = t("filters.level");
  const select = document.createElement("select");
  const options: [string, string][] = [
    ["", t("filters.allLevels")],
    ...LEVELS.map((l): [string, string] => [l, l]),
  ];
  for (const [value, text] of options) {
    const option = document.createElement("option"); // not new Option(): happy-dom lacks it
    option.value = value;
    option.textContent = text;
    select.append(option);
  }
  select.addEventListener("change", () => {
    // The options are "" and LEVELS, so the value is one of them.
    level = LEVELS.find((l) => l === select.value) ?? null; // "" is All levels
    changed();
  });
  levelLabel.append(levelText, select);

  const methods = METHODS.map((value) => {
    const [label, input] = choice(
      "radio",
      "method",
      value,
      t(`filters.method.${value}`),
    );
    input.checked = value === method;
    input.addEventListener("change", () => {
      method = value;
      changed();
    });
    return label;
  });

  const languageBoxes = LANGUAGES.map((language) => {
    const [label, input] = choice(
      "checkbox",
      "language",
      language,
      t(`filters.languages.${language}`),
    );
    input.addEventListener("change", () => {
      if (input.checked) languages.add(language);
      else languages.delete(language);
      changed();
    });
    return label;
  });

  aside.replaceChildren(
    levelLabel,
    fieldset(t("filters.method.title"), ...methods),
    fieldset(t("filters.languages.title"), ...languageBoxes),
  );
  return () => ({ level, method, languages });
}
