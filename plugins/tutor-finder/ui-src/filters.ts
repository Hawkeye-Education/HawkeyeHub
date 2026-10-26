// The filters in the left column (source SPEC §4), in its order: level, how they teach, district,
// language. Status is not a filter: parseRows already drops the statuses that never appear, and
// the table pins the rest (SPEC §4.5). There is no subject filter (SPEC §12).

import { t } from "./i18n";
import {
  DISTRICTS,
  LANGUAGES,
  LEVELS,
  REGIONS,
  matching,
  type DistrictId,
  type Language,
  type Level,
  type Region,
  type Tutor,
} from "./parsing";
import { MAP_HEIGHT, PLATES, RIDGE } from "./plates";
import type { ShownTutor } from "./table";

/** Face-to-face: the tutor must travel to the client. Online: anyone will do, the default (SPEC §4.2). */
const METHODS = ["face-to-face", "online"] as const;
type Method = (typeof METHODS)[number];

// Object.keys is typed string[]; PLATES is a Record<DistrictId, …>, so its keys are exactly DistrictId.
const DISTRICT_IDS = Object.keys(PLATES) as DistrictId[];

/** Where a tutor may travel. Only Face-to-face can set it, and leaving it clears it (SPEC §4.3). */
interface DistrictFilter {
  /** The districts a tutor may travel to. */
  districts: ReadonlySet<DistrictId>;
  /** Also keep tutors who travel but recorded no district. */
  noDistrict: boolean;
}

/** The district filter that narrows nothing. */
const ANY_DISTRICT: DistrictFilter = {
  districts: new Set(),
  noDistrict: false,
};

/** Whether `filter` narrows the roster. */
const narrows = (filter: DistrictFilter): boolean =>
  filter.districts.size > 0 || filter.noDistrict;

interface Filters {
  /** null: All levels. */
  level: Level | null;
  method: Method;
  /** Empty: no language filter. */
  languages: ReadonlySet<Language>;
  district: DistrictFilter;
}

/** What the filters let through, and how many online-only tutors the district filter is hiding. */
export interface Filtered {
  shown: ShownTutor[];
  suppressed: number;
}

/** The tutors `filters` let through, each with only the offerings that match its level. */
function applyFilters(
  tutors: readonly Tutor[],
  filters: Filters,
): ShownTutor[] {
  const { level, method, languages, district } = filters;
  const districtOn = narrows(district);
  return tutors.flatMap((tutor) => {
    const offerings = matching(tutor, level);
    const keep =
      (level === null || offerings.length > 0) &&
      (method === "online" || tutor.faceToFace) && // face-to-face implies online (SPEC §4.2)
      (languages.size === 0 || tutor.languages.some((l) => languages.has(l))) &&
      // Only Face-to-face selects a district, so an online-only tutor never satisfies one,
      // whatever their District cell says (SPEC §4.3).
      (!districtOn ||
        (tutor.district === null
          ? district.noDistrict
          : district.districts.has(tutor.district)));
    return keep ? [{ tutor, offerings }] : [];
  });
}

function fieldset(legend: string, ...controls: Element[]): HTMLFieldSetElement {
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

/** An SVG `<tag>` with `attrs` set. */
function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const created = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attrs))
    created.setAttribute(name, String(value));
  return created;
}

/** The filter column: `apply` narrows a roster and redraws the district counts for it. */
export interface FilterColumn {
  apply: (tutors: readonly Tutor[]) => Filtered;
  /** The level chosen now. null: All levels. */
  level: () => Level | null;
}

/** Draws the filters into `aside` and calls `changed` on every change. */
export function createFilters(
  aside: HTMLElement,
  changed: () => void,
): FilterColumn {
  let level: Level | null = null;
  let method: Method = "online";
  const languages = new Set<Language>();
  let district = ANY_DISTRICT;

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
      // A district means the tutor travels, so leaving Face-to-face clears it (SPEC §4.3).
      if (method !== "face-to-face") {
        district = ANY_DISTRICT;
        noDistrictBox.checked = false;
      }
      changed();
    });
    return label;
  });

  // The district map: plates drawn by the Plugin, coloured by layout.css from --hub-* tokens only.
  // Stroke widths, dashes and label sizes are viewBox geometry, so they are set here, not in CSS.
  const map = svgElement("svg", {
    class: "map",
    viewBox: `-2 -2 104 ${String(MAP_HEIGHT)}`,
    role: "group",
    "aria-label": t("filters.district.map"),
  });
  const leads = svgElement("g", {});
  const shapes = svgElement("g", {});
  const labels = svgElement("g", { "aria-hidden": "true" });
  /** Sets the selected districts, keeping noDistrict. */
  const selectDistricts = (districts: ReadonlySet<DistrictId>): void => {
    district = { ...district, districts };
    changed();
  };
  const toggle = (id: DistrictId): void => {
    if (method !== "face-to-face") return; // the map is inert until Face-to-face arms it
    const districts = new Set(district.districts);
    if (districts.has(id)) districts.delete(id);
    else districts.add(id);
    selectDistricts(districts);
  };
  const plates = DISTRICT_IDS.map((id) => {
    const plate = PLATES[id];
    if (plate.lead !== null)
      leads.append(
        svgElement("line", {
          class: "lead",
          x1: plate.lead[0],
          y1: plate.lead[1],
          x2: plate.cx,
          y2: plate.top,
          "stroke-width": 0.3,
          "stroke-dasharray": "1.1 1.3",
        }),
      );
    const shape = svgElement("path", {
      class: "plate",
      d: plate.d,
      "data-district": id,
      role: "button",
      "aria-label": t(`district.${id}`),
      "stroke-width": 0.5,
    });
    shape.addEventListener("click", () => {
      toggle(id);
    });
    shape.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      toggle(id);
    });
    shapes.append(shape);
    const name = svgElement("text", {
      class: "plate-name",
      x: plate.cx,
      y: plate.cy,
      "font-size": 2.9,
    });
    name.textContent = t(`plate.${id}`);
    const count = svgElement("text", {
      class: "plate-count",
      x: plate.cx,
      y: plate.cy + 4,
      "font-size": 3.6,
    });
    labels.append(name, count);
    return { id, shape, name, count };
  });
  const ridgeLabel = svgElement("text", {
    class: "ridge-label",
    x: 50,
    y: RIDGE - 1.6,
    "font-size": 2.6,
  });
  ridgeLabel.textContent = t("filters.district.ridge");
  map.append(
    leads,
    shapes,
    svgElement("line", {
      class: "ridge",
      x1: 0,
      y1: RIDGE,
      x2: 100,
      y2: RIDGE,
      "stroke-width": 0.35,
      "stroke-dasharray": "3.2 2.2",
    }),
    ridgeLabel,
    labels,
  );

  const regionButtons = REGIONS.map((region: Region) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = t("filters.district.region", {
      region: t(`region.${region}`),
    });
    button.addEventListener("click", () => {
      // Adds the whole region, or takes it away again once all of it is selected.
      const ids = DISTRICT_IDS.filter((id) => DISTRICTS[id].region === region);
      const districts = new Set(district.districts);
      if (ids.every((id) => districts.has(id)))
        for (const id of ids) districts.delete(id);
      else for (const id of ids) districts.add(id);
      selectDistricts(districts);
    });
    return button;
  });
  const regions = document.createElement("div");
  regions.className = "row";
  regions.append(...regionButtons);

  // Off by default, and not a 19th district (SPEC §4.3).
  const [noDistrictLabel, noDistrictBox] = choice(
    "checkbox",
    "no-district",
    "no-district",
    t("filters.district.none"),
  );
  const noDistrictHint = document.createElement("small");
  noDistrictHint.className = "muted";
  noDistrictLabel.lastElementChild?.append(noDistrictHint);
  noDistrictBox.addEventListener("change", () => {
    district = { ...district, noDistrict: noDistrictBox.checked };
    changed();
  });

  const why = document.createElement("p");
  why.className = "muted";
  why.textContent = t("filters.district.why");
  const districtSet = fieldset(
    t("filters.district.title"),
    why,
    map,
    regions,
    noDistrictLabel,
  );

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
    districtSet,
    fieldset(t("filters.languages.title"), ...languageBoxes),
  );

  const apply = (tutors: readonly Tutor[]): Filtered => {
    const filters: Filters = { level, method, languages, district };
    const armed = method === "face-to-face";
    // What each plate would add: the tutors who travel and match every other filter.
    const travellers = applyFilters(tutors, {
      ...filters,
      method: "face-to-face",
      district: ANY_DISTRICT,
    });
    // The fieldset dims the map; each control is disabled too, as `.disabled` reads only its own.
    districtSet.disabled = !armed;
    for (const control of [...regionButtons, noDistrictBox])
      control.disabled = !armed;
    why.hidden = armed;
    for (const { id, shape, name, count } of plates) {
      const matches = travellers.filter((s) => s.tutor.district === id).length;
      const selected = district.districts.has(id);
      // Zero-match districts stay tappable: the map never blocks a tap it could explain.
      for (const part of [shape, name, count]) {
        part.classList.toggle("sel", selected);
        part.classList.toggle("zero", matches === 0);
      }
      shape.setAttribute("aria-pressed", String(selected));
      shape.setAttribute("aria-disabled", String(!armed));
      shape.setAttribute("tabindex", armed ? "0" : "-1");
      count.textContent = String(matches);
    }
    noDistrictHint.textContent = t("filters.district.noneHint", {
      count: travellers.filter((s) => s.tutor.district === null).length,
    });

    // What the district filter costs: tutors matching level and language who cannot travel.
    const suppressed = narrows(district)
      ? applyFilters(tutors, {
          ...filters,
          method: "online",
          district: ANY_DISTRICT,
        }).filter((s) => s.tutor.zoomOnly).length
      : 0;
    return { shown: applyFilters(tutors, filters), suppressed };
  };
  return { apply, level: () => level };
}
