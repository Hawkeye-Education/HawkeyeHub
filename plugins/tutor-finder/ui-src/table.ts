// The dense results table (source SPEC §5): one row per tutor, every shown offering on its own
// line and never collapsed, click-sortable columns, and `No longer available` pinned last in every
// sort. It only draws what it is given; which tutors and offerings match is the filters' job.

import { t } from "./i18n";
import type { Offering, SheetRow, Tutor } from "./parsing";

/** A tutor as the table shows them, with the offerings that match the filters. */
export interface ShownTutor {
  tutor: Tutor;
  offerings: readonly Offering[];
}

const COLUMNS = [
  "name",
  "price",
  "district",
  "lang",
  "status",
  "remark",
] as const;
type Column = (typeof COLUMNS)[number];
type Direction = 1 | -1;

/** The cheapest priced offering: the price sort key and the number the message quotes. null: none priced. */
export function cheapest(offerings: readonly Offering[]): number | null {
  const prices = offerings.flatMap((o) => (o.price === null ? [] : [o.price]));
  return prices.length === 0 ? null : Math.min(...prices);
}

/** What a column sorts by. null: nothing to sort on, which sorts after every value, so last
 * ascending and first descending, as the source app sorts blanks. */
function sortKey(row: ShownTutor, column: Column): string | number | null {
  const { tutor } = row;
  switch (column) {
    case "name":
      return tutor.surname;
    case "price":
      return cheapest(row.offerings);
    case "district":
      return tutor.district === null ? null : t(`district.${tutor.district}`);
    case "lang":
      return initials(tutor);
    case "status":
      return statusText(tutor);
    case "remark":
      return tutor.remark;
    default:
      return column satisfies never;
  }
}

function compareKeys(
  a: string | number | null,
  b: string | number | null,
  dir: Direction,
): number {
  const order =
    a === null || b === null
      ? (a === null ? 1 : 0) - (b === null ? 1 : 0)
      : typeof a === "number" && typeof b === "number"
        ? a - b
        : String(a).localeCompare(String(b), undefined, {
            sensitivity: "base",
          });
  return order * dir;
}

const pinnedLast = (row: ShownTutor): number =>
  row.tutor.status.kind === "no-longer-available" ? 1 : 0;

/** `rows` in table order: `No longer available` last, then the column, then sheet order. */
export function sortRows(
  rows: readonly ShownTutor[],
  column: Column,
  dir: Direction,
): ShownTutor[] {
  return rows.toSorted(
    (a, b) =>
      pinnedLast(a) - pinnedLast(b) ||
      compareKeys(sortKey(a, column), sortKey(b, column), dir) ||
      a.tutor.row - b.tutor.row,
  );
}

function initials(tutor: Tutor): string {
  return tutor.languages.map((l) => l.charAt(0)).join("");
}

/** null: available, which the column leaves blank. */
function statusText(tutor: Tutor): string | null {
  switch (tutor.status.kind) {
    case "available":
      return null;
    case "no-longer-available":
      return t("status.noLongerAvailable");
    case "other":
      return tutor.status.text;
    default:
      return tutor.status satisfies never;
  }
}

/** A `<tag>` holding `text`; null: an empty one. */
function element(
  tag: keyof HTMLElementTagNameMap,
  text: string | null,
  ...classes: string[]
): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = text;
  node.classList.add(...classes);
  return node;
}

/**
 * The table drawn into `table`; `show` redraws it with new rows, keeping the sort staff chose, and
 * `sorted` puts any rows in that order. Each row's checkbox adds or removes the tutor's sheet row in
 * `selection`, then calls `selected`.
 */
export function createTable(
  table: HTMLTableElement,
  selection: Set<SheetRow>,
  selected: () => void,
): {
  show(rows: readonly ShownTutor[]): void;
  sorted(rows: readonly ShownTutor[]): ShownTutor[];
} {
  const price = new Intl.NumberFormat(window.hub.displayLanguage, {
    style: "currency",
    currency: "HKD",
    maximumFractionDigits: 0,
  });
  let column: Column = "price"; // cheapest first, by SPEC §5
  let dir: Direction = 1;
  let shown: readonly ShownTutor[] = [];

  function header(): HTMLTableSectionElement {
    const head = document.createElement("thead");
    const tr = head.insertRow();
    const pick = document.createElement("th");
    pick.scope = "col";
    pick.textContent = t("column.select");
    tr.append(pick);
    for (const c of COLUMNS) {
      const th = document.createElement("th");
      th.scope = "col";
      if (c === column)
        th.setAttribute("aria-sort", dir === 1 ? "ascending" : "descending");
      const button = element("button", t(`column.${c}`));
      button.dataset["column"] = c;
      button.addEventListener("click", () => {
        dir = c === column ? (dir === 1 ? -1 : 1) : 1;
        column = c;
        draw();
      });
      th.append(button);
      tr.append(th);
    }
    return head;
  }

  function offeringsCell(offerings: readonly Offering[]): HTMLElement {
    const low = cheapest(offerings);
    const td = document.createElement("td");
    for (const o of offerings) {
      const line = element("div", null, "offering");
      line.append(
        element("span", o.level ?? t("unlevelled"), "muted"),
        element("span", o.text),
        element(
          "span",
          o.price === null ? t("blank") : price.format(o.price),
          ...(o.price !== null && o.price === low ? ["cheapest"] : []),
        ),
      );
      td.append(line);
    }
    return td;
  }

  function bodyRow(tbody: HTMLTableSectionElement, row: ShownTutor): void {
    const { tutor } = row;
    const tr = tbody.insertRow();
    if (tutor.status.kind === "no-longer-available") tr.className = "gone";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = selection.has(tutor.row);
    box.setAttribute("aria-label", t("select", { name: tutor.name }));
    box.addEventListener("change", () => {
      if (box.checked) selection.add(tutor.row);
      else selection.delete(tutor.row);
      selected();
    });
    const pick = element("td", null, "pick");
    pick.append(box);
    const name = element("td", null);
    name.append(
      element("div", tutor.name),
      element("div", tutor.fullName, "muted"),
    );
    const district = element(
      "td",
      tutor.district === null ? t("blank") : t(`district.${tutor.district}`),
    );
    if (tutor.zoomOnly) district.append(element("div", t("zoomOnly"), "muted"));
    tr.append(
      pick,
      name,
      offeringsCell(row.offerings),
      district,
      element("td", initials(tutor)),
      element("td", statusText(tutor)),
      element("td", tutor.remark),
    );
  }

  function draw(): void {
    const tbody = document.createElement("tbody");
    for (const row of sortRows(shown, column, dir)) bodyRow(tbody, row);
    table.replaceChildren(header(), tbody);
  }

  return {
    show(rows) {
      shown = rows;
      draw();
    },
    sorted: (rows) => sortRows(rows, column, dir),
  };
}
