// The dense results table (source SPEC §5): one row per tutor, every shown offering on its own
// line and never collapsed, click-sortable columns, and `No longer available` pinned last in every
// sort. It only draws what it is given; which tutors and offerings match is the filters' job.

import { t } from "./i18n";
import { DISTRICTS, type Offering, type Tutor } from "./parsing";

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

/** What a column sorts by. null: nothing to sort on, which sorts last whichever way. */
function sortKey(row: ShownTutor, column: Column): string | number | null {
  const { tutor } = row;
  switch (column) {
    case "name":
      return tutor.name.replace(/^(Mr|Miss) /, ""); // by surname, as staff read the column
    case "price":
      return cheapest(row.offerings);
    case "district":
      return tutor.district === null ? null : DISTRICTS[tutor.district].en;
    case "lang":
      return initials(tutor);
    case "status":
      return tutor.status.kind === "available" ? null : statusText(tutor);
    case "remark":
      return tutor.remark === "" ? null : tutor.remark;
    default:
      return column satisfies never;
  }
}

function compareKeys(
  a: string | number | null,
  b: string | number | null,
  dir: Direction,
): number {
  if (a === null || b === null)
    return (a === null ? 1 : 0) - (b === null ? 1 : 0);
  const order =
    typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
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

function statusText(tutor: Tutor): string {
  switch (tutor.status.kind) {
    case "available":
      return "";
    case "no-longer-available":
      return t("status.noLongerAvailable");
    case "other":
      return tutor.status.text;
    default:
      return tutor.status satisfies never;
  }
}

function el(
  tag: keyof HTMLElementTagNameMap,
  text: string,
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
  selection: Set<number>,
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
      const button = el("button", t(`column.${c}`));
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
      const line = el("div", "", "offering");
      line.append(
        el("span", o.level ?? t("unlevelled"), "muted"),
        el("span", o.text),
        el(
          "span",
          o.price === null ? "—" : price.format(o.price),
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
    const pick = el("td", "", "pick");
    pick.append(box);
    const name = el("td", "");
    name.append(el("div", tutor.name), el("div", tutor.fullName, "muted"));
    const district = el(
      "td",
      tutor.district === null ? "—" : DISTRICTS[tutor.district].en,
    );
    if (tutor.zoomOnly) district.append(el("div", t("zoomOnly"), "muted"));
    tr.append(
      pick,
      name,
      offeringsCell(row.offerings),
      district,
      el("td", initials(tutor)),
      el("td", statusText(tutor)),
      el("td", tutor.remark),
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
