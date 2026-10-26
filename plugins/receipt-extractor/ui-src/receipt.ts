// One file staff handed over, turned into receipts for the document (spec #159): a photo into
// one, a PDF into one per page.

import type { Crop } from "./crop";
import { context } from "./offscreen";
import { openPdf, pageBitmap } from "./pdf";

/** A receipt ready for the document: an upright JPEG and its size in pixels. */
export interface Receipt {
  readonly jpeg: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
}

/** Why a file or page gave no receipt. */
export type FailReason = "unsupported" | "encrypted" | "unreadable";

export type Extracted =
  /** The receipt cropped out of its photo or page. */
  | { readonly kind: "receipt"; readonly receipt: Receipt }
  /** No receipt was found, so it is the whole photo or page. */
  | { readonly kind: "uncropped"; readonly receipt: Receipt }
  | { readonly kind: "failed"; readonly reason: FailReason };

/** What one file gave: one result for a photo or a file that failed whole, else one per page. */
export type FileExtracted =
  | { readonly kind: "whole"; readonly extracted: Extracted }
  | { readonly kind: "pages"; readonly pages: readonly Extracted[] };

const JPEG_QUALITY = 0.9;

/** "%PDF-", by content, as for photos below. */
function isPdf(b: Uint8Array): boolean {
  return (
    b[0] === 0x25 &&
    b[1] === 0x50 &&
    b[2] === 0x44 &&
    b[3] === 0x46 &&
    b[4] === 0x2d
  );
}

type Box = Omit<Extract<Crop, { kind: "box" }>, "kind">;

/** JPEG (FF D8 FF) or PNG (89 'P' 'N' 'G'), by content: a file's name and type are only claims. */
function isJpegOrPng(b: Uint8Array): boolean {
  return (
    (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ||
    (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
  );
}

/** The `area` of the photo on a canvas of its own. */
function draw(bitmap: ImageBitmap, area: Box): OffscreenCanvas {
  const canvas = new OffscreenCanvas(area.width, area.height);
  const ctx = context(canvas);
  // White under the photo, so a PNG's transparent parts print as paper rather than black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, area.width, area.height);
  ctx.drawImage(
    bitmap,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    area.width,
    area.height,
  );
  return canvas;
}

/** The auto-crop, run in a Web Worker of its own: hidden Plugin UIs are throttled (§4.2). */
function cropInWorker(pixels: ImageData): Promise<Crop> {
  const worker = new Worker(new URL("./crop.worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise<Crop>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<Crop>) => {
      resolve(event.data);
    };
    worker.onerror = (event) => {
      reject(new Error(`the crop worker failed: ${event.message}`));
    };
    worker.postMessage(pixels, [pixels.data.buffer]);
  }).finally(() => {
    worker.terminate();
  });
}

const UNREADABLE: Extracted = { kind: "failed", reason: "unreadable" };

function oneResult(extracted: Extracted): FileExtracted {
  return { kind: "whole", extracted };
}

export async function extract(file: File): Promise<FileExtracted> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    // A file that vanished is flagged in the list, and the run carries on.
    return oneResult(UNREADABLE);
  }
  if (isPdf(bytes)) return extractPdf(bytes);
  if (!isJpegOrPng(bytes))
    return oneResult({ kind: "failed", reason: "unsupported" });
  let bitmap: ImageBitmap;
  try {
    // "from-image" turns a photo upright by its EXIF orientation, as the HTML spec defines it:
    // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-imageorientation-from-image
    bitmap = await createImageBitmap(new Blob([bytes]), {
      imageOrientation: "from-image",
    });
  } catch {
    // A corrupt image is flagged in the list, and the run carries on.
    return oneResult(UNREADABLE);
  }
  return oneResult(await receiptOf(bitmap));
}

async function extractPdf(bytes: Uint8Array): Promise<FileExtracted> {
  const opened = await openPdf(bytes);
  switch (opened.kind) {
    case "failed":
      return oneResult({ kind: "failed", reason: opened.reason });
    case "open":
      break;
    default:
      opened satisfies never;
      throw new Error("unreachable");
  }
  const { pdf } = opened;
  try {
    const pages: Extracted[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const bitmap = await pageBitmap(pdf, number);
      // A page pdf.js can't read is flagged on its own; the rest of the PDF carries on.
      pages.push(
        bitmap === "unreadable" ? UNREADABLE : await receiptOf(bitmap),
      );
    }
    return { kind: "pages", pages };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/** A photo or PDF page, upright and auto-cropped, as the JPEG the document holds. */
async function receiptOf(bitmap: ImageBitmap): Promise<Extracted> {
  const whole = { x: 0, y: 0, width: bitmap.width, height: bitmap.height };
  let canvas = draw(bitmap, whole);
  const crop = await cropInWorker(
    context(canvas).getImageData(0, 0, whole.width, whole.height),
  );
  if (crop.kind === "box") canvas = draw(bitmap, crop);
  bitmap.close();
  const jpeg = await canvas.convertToBlob({
    type: "image/jpeg",
    quality: JPEG_QUALITY,
  });
  return {
    kind: crop.kind === "box" ? "receipt" : "uncropped",
    receipt: {
      jpeg: new Uint8Array(await jpeg.arrayBuffer()),
      width: canvas.width,
      height: canvas.height,
    },
  };
}
