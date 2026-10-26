// One photo staff handed over, turned into one receipt for the document (spec #159).

import type { Crop } from "./crop";

/** A receipt ready for the document: an upright JPEG and its size in pixels. */
export interface Receipt {
  readonly jpeg: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
}

export type Extracted =
  | {
      readonly kind: "receipt";
      readonly receipt: Receipt;
      /** No receipt was found in the photo, so it is the whole photo. */
      readonly fallback: boolean;
    }
  | { readonly kind: "failed"; readonly reason: "unsupported" | "unreadable" };

const JPEG_QUALITY = 0.9;

type Box = Omit<Extract<Crop, { kind: "box" }>, "kind">;

/** JPEG (FF D8 FF) or PNG (89 'P' 'N' 'G'), by content: a file's name and type are only claims. */
function isJpegOrPng(b: Uint8Array): boolean {
  return (
    (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ||
    (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
  );
}

function context(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("OffscreenCanvas has no 2d context");
  return ctx;
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

export async function extract(file: File): Promise<Extracted> {
  let bitmap: ImageBitmap;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isJpegOrPng(bytes)) return { kind: "failed", reason: "unsupported" };
    // "from-image" turns a photo upright by its EXIF orientation, as the HTML spec defines it:
    // https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-imageorientation-from-image
    bitmap = await createImageBitmap(new Blob([bytes]), {
      imageOrientation: "from-image",
    });
  } catch {
    // A file that vanished or a corrupt image is flagged in the list, and the run carries on.
    return { kind: "failed", reason: "unreadable" };
  }
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
    kind: "receipt",
    fallback: crop.kind === "fallback",
    receipt: {
      jpeg: new Uint8Array(await jpeg.arrayBuffer()),
      width: canvas.width,
      height: canvas.height,
    },
  };
}
