// The Plugin UI through the DOM and a fake window.hub, as staff and the Hub use it (§9.1).

import { installFakeHub, type FakeHub } from "@hawkeye-hub/fake-hub";
import JSZip from "jszip";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import manifest from "../manifest.json";
import { installCanvasDouble, jpegSize, photo } from "./canvas-double";
import page from "./index.html?raw";

// The page's body only: happy-dom would fetch the head's stylesheet and script.
const html = page.slice(
  page.indexOf("<body>") + "<body>".length,
  page.indexOf("</body>"),
);

// The test names the element type it knows index.html gives that id.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`no #${id}`);
  return el as T;
};
const text = (id: string): string => $(id).textContent;

/** What Save handed the Hub's save dialog. */
interface Download {
  name: string;
  blob: Blob;
}
let downloads: Download[];

beforeEach(() => {
  vi.resetModules();
  installCanvasDouble();
  downloads = [];
  const blobs = new Map<string, Blob>();
  const createObjectURL = URL.createObjectURL.bind(URL);
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    const url = createObjectURL(blob);
    if (blob instanceof Blob) blobs.set(url, blob);
    return url;
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    const blob = blobs.get(this.href);
    if (blob === undefined) throw new Error(`no blob at ${this.href}`);
    downloads.push({ name: this.download, blob });
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Opens the Plugin UI against a fresh fake Hub. */
async function open(displayLanguage = "en-HK"): Promise<FakeHub> {
  const fake = installFakeHub({ manifest, displayLanguage });
  document.body.innerHTML = html;
  await import("./main");
  return fake;
}

/** Picks `files` with the file picker. */
function pick(files: File[]): void {
  const input = $<HTMLInputElement>("files");
  Object.defineProperty(input, "files", { value: files, configurable: true });
  input.dispatchEvent(new Event("change"));
}

/** Drops `files` onto the page. */
function drop(files: File[]): void {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files } });
  $("list").dispatchEvent(event);
}

/** Clicks Run and waits for the summary. */
async function run(fake: FakeHub): Promise<void> {
  $("run").click();
  await vi.waitFor(() => {
    expect(text("summary")).not.toBe("");
  });
  await fake.settle();
}

/** Clicks Save and returns what went to the save dialog. */
async function save(): Promise<Download> {
  $("save").click();
  await vi.waitFor(() => {
    expect(downloads).toHaveLength(1);
  });
  const [download] = downloads;
  if (download === undefined) throw new Error("no download");
  return download;
}

/** The list as staff read it: each file's name, its flag if it failed, and its thumbnail. */
function listed(): {
  name: string | undefined;
  flag: string | null;
  thumbnail: boolean;
}[] {
  return [...$("list").children].map((item) => ({
    name: item.querySelector("span")?.textContent,
    flag: item.querySelector("strong")?.textContent ?? null,
    thumbnail: item.querySelector("img") !== null,
  }));
}

/** One page of the saved document: its paragraph and the receipt on it. */
interface DocxPage {
  align: string;
  pageBreakBefore: boolean;
  /** The receipt's size on the page, in EMU (360 000 per cm). */
  extent: { cx: number; cy: number };
  image: { width: number; height: number };
}

async function readDocx(blob: Blob): Promise<{
  pageSize: string;
  margins: string;
  pages: DocxPage[];
}> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const read = async (path: string): Promise<string> => {
    const file = zip.file(path);
    if (file === null) throw new Error(`no ${path} in the .docx`);
    return file.async("string");
  };
  const xml = await read("word/document.xml");
  const rels = await read("word/_rels/document.xml.rels");
  const attr = (tag: string, from: string): string => {
    const match = new RegExp(`<${tag}\\b[^>]*/?>`).exec(from);
    if (match === null) throw new Error(`no <${tag}>`);
    return match[0];
  };
  const paragraphs = [
    ...xml.matchAll(/<w:p>[\s\S]*?<\/w:p>|<w:p [\s\S]*?<\/w:p>/g),
  ].map((m) => m[0]);
  const pages = await Promise.all(
    paragraphs
      .filter((p) => p.includes("<a:blip"))
      .map(async (p) => {
        const extent = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(p);
        const embed = /r:embed="([^"]+)"/.exec(p);
        if (extent === null || embed === null) throw new Error("no image");
        const target = new RegExp(
          `Id="${embed[1] ?? ""}"[^>]*Target="([^"]+)"`,
        ).exec(rels);
        const media = zip.file(`word/${target?.[1] ?? ""}`);
        if (media === null) throw new Error("no media");
        return {
          align: /<w:jc w:val="(\w+)"/.exec(p)?.[1] ?? "none",
          pageBreakBefore: p.includes("<w:pageBreakBefore"),
          extent: { cx: Number(extent[1]), cy: Number(extent[2]) },
          image: await jpegSize(await media.async("uint8array")),
        };
      }),
  );
  return {
    pageSize: attr("w:pgSz", xml),
    margins: attr("w:pgMar", xml),
    pages,
  };
}

test("photos become one receipt per page in name order, fitted in 9 × 25 cm, while Busy", async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 26, 23, 30) });
  const fake = await open();
  pick([
    photo("receipt 10.png", 400, 100, "png"),
    photo("receipt 2.jpg", 100, 1000, "jpeg"),
  ]);
  expect($<HTMLButtonElement>("save").disabled).toBe(true);

  $("run").click();
  expect(fake.busy.state).toEqual({
    kind: "busy",
    reason: "Extracting receipts. Closing now loses this run.",
  });
  await vi.waitFor(() => {
    expect(text("summary")).toBe("Done: 2 of 2 photos extracted.");
  });
  await fake.settle();

  expect(fake.busy.state).toEqual({ kind: "idle" });
  expect(listed()).toEqual([
    { name: "receipt 2.jpg", flag: null, thumbnail: true },
    { name: "receipt 10.png", flag: null, thumbnail: true },
  ]);

  const download = await save();
  expect(download.name).toBe("receipts_2026-10-26.docx");
  const docx = await readDocx(download.blob);
  // A4 is 11906 × 16838 twips; 1.27 cm is 720 twips.
  expect(docx.pageSize).toMatch(/w:w="11906"/);
  expect(docx.pageSize).toMatch(/w:h="16838"/);
  for (const side of ["top", "right", "bottom", "left"])
    expect(docx.margins).toMatch(new RegExp(`w:${side}="720"`));
  expect(docx.pages).toEqual([
    // 100 × 1000 px is held by the 25 cm height: 2.5 × 25 cm.
    {
      align: "right",
      pageBreakBefore: false,
      extent: { cx: 900_000, cy: 9_000_000 },
      image: { width: 100, height: 1000 },
    },
    // 400 × 100 px is held by the 9 cm width: 9 × 2.25 cm.
    {
      align: "right",
      pageBreakBefore: true,
      extent: { cx: 3_240_000, cy: 810_000 },
      image: { width: 400, height: 100 },
    },
  ]);
});

test("a dropped photo is saved under its own name, turned upright by its EXIF orientation", async () => {
  const fake = await open();
  // Stored 40 × 20 px, to be turned 90° clockwise for viewing.
  drop([photo("IMG_0042.JPG", 40, 20, "jpeg", "exif-6")]);
  await run(fake);

  const download = await save();
  expect(download.name).toBe("IMG_0042_receipts.docx");
  const { pages } = await readDocx(download.blob);
  // Upright it is 20 × 40 px, held by the 9 cm width: 9 × 18 cm.
  expect(pages.map((p) => [p.image, p.extent])).toEqual([
    [
      { width: 20, height: 40 },
      { cx: 3_240_000, cy: 6_480_000 },
    ],
  ]);
});

test("a file that can't be read is flagged and the run carries on", async () => {
  const fake = await open();
  pick([
    new File(
      [Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])],
      "a broken.jpg",
      {
        type: "image/jpeg",
      },
    ),
    photo("b good.png", 50, 100, "png"),
    new File(["not a photo"], "c notes.heic", { type: "image/heic" }),
  ]);
  await run(fake);

  expect(text("summary")).toBe("Done: 1 of 3 photos extracted.");
  expect(listed()).toEqual([
    { name: "a broken.jpg", flag: "Could not be read", thumbnail: false },
    { name: "b good.png", flag: null, thumbnail: true },
    { name: "c notes.heic", flag: "Not a JPEG or PNG", thumbnail: false },
  ]);
  expect(fake.busy.state).toEqual({ kind: "idle" });
  const { pages } = await readDocx((await save()).blob);
  expect(pages.map((p) => p.image)).toEqual([{ width: 50, height: 100 }]);
});

test("Save stays off until a run makes at least one receipt", async () => {
  const fake = await open();
  expect($<HTMLButtonElement>("run").disabled).toBe(true);
  pick([new File(["junk"], "scan.txt")]);
  expect($<HTMLButtonElement>("save").disabled).toBe(true);

  await run(fake);

  expect(text("summary")).toBe("Done: 0 of 1 photos extracted.");
  expect($<HTMLButtonElement>("save").disabled).toBe(true);
  expect($<HTMLButtonElement>("run").disabled).toBe(false);
});

test("the Plugin UI reads in the Display Language", async () => {
  const fake = await open("zh-HK");
  pick([new File(["junk"], "scan.txt")]);
  await run(fake);

  expect(text("run")).toBe("擷取收據");
  expect(text("summary")).toBe("完成：已擷取 1 張相片中的 0 張。");
  expect(listed()).toEqual([
    { name: "scan.txt", flag: "不是 JPEG 或 PNG", thumbnail: false },
  ]);
});

test("an unknown Display Language falls back to English", async () => {
  await open("fr-FR");

  expect(text("run")).toBe("Extract receipts");
});
