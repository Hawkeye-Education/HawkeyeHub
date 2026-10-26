// One file staff handed over, turned into receipts for the document (spec #159): a photo into
// one, a PDF into one per page.

import { openPdf, pageBitmap } from "./pdf";

/** A receipt ready for the document: an upright JPEG and its size in pixels. */
export interface Receipt {
  readonly jpeg: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
}

export type Extracted =
  | { readonly kind: "receipt"; readonly receipt: Receipt }
  | {
      readonly kind: "failed";
      readonly reason: "unsupported" | "encrypted" | "unreadable";
    };

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

/** JPEG (FF D8 FF) or PNG (89 'P' 'N' 'G'), by content: a file's name and type are only claims. */
function isJpegOrPng(b: Uint8Array): boolean {
  return (
    (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ||
    (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
  );
}

const UNREADABLE: Extracted = { kind: "failed", reason: "unreadable" };

function whole(extracted: Extracted): FileExtracted {
  return { kind: "whole", extracted };
}

export async function extract(file: File): Promise<FileExtracted> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    // A file that vanished is flagged in the list, and the run carries on.
    return whole(UNREADABLE);
  }
  if (isPdf(bytes)) return extractPdf(bytes);
  if (!isJpegOrPng(bytes))
    return whole({ kind: "failed", reason: "unsupported" });
  let bitmap: ImageBitmap;
  try {
    // "from-image" turns a photo upright by its EXIF orientation, as the HTML spec defines it:
    // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-imageorientation-from-image
    bitmap = await createImageBitmap(new Blob([bytes]), {
      imageOrientation: "from-image",
    });
  } catch {
    // A corrupt image is flagged in the list, and the run carries on.
    return whole(UNREADABLE);
  }
  return whole(await receiptOf(bitmap));
}

async function extractPdf(bytes: Uint8Array): Promise<FileExtracted> {
  const opened = await openPdf(bytes);
  switch (opened.kind) {
    case "failed":
      return whole({ kind: "failed", reason: opened.reason });
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
      let bitmap: ImageBitmap;
      try {
        bitmap = await pageBitmap(pdf, number);
      } catch {
        // A page pdf.js can't draw is flagged on its own; the rest of the PDF carries on.
        pages.push(UNREADABLE);
        continue;
      }
      pages.push(await receiptOf(bitmap));
    }
    return { kind: "pages", pages };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

/** A photo or PDF page, upright, as the JPEG the document holds. */
async function receiptOf(bitmap: ImageBitmap): Promise<Extracted> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("OffscreenCanvas has no 2d context");
  // White under the photo, so a PNG's transparent parts print as paper rather than black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const jpeg = await canvas.convertToBlob({
    type: "image/jpeg",
    quality: JPEG_QUALITY,
  });
  return {
    kind: "receipt",
    receipt: {
      jpeg: new Uint8Array(await jpeg.arrayBuffer()),
      width: canvas.width,
      height: canvas.height,
    },
  };
}
