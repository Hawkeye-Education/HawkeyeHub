// Test doubles of Chromium's `createImageBitmap` and `OffscreenCanvas` for happy-dom, which has
// neither. They decode and encode with Skia through @napi-rs/canvas, which, like Chromium, turns a
// photo upright by its EXIF orientation (probed: an orientation-6 40×20 JPEG loads as 20×40).
// pdfjs-dist draws on the double's 2d context, the same Skia context it uses under Node.

import {
  createCanvas,
  loadImage,
  type Canvas,
  type Image,
} from "@napi-rs/canvas";
import { PDFDocument, PDFHexString, rgb } from "pdf-lib";

class FakeOffscreenCanvas {
  readonly #canvas;

  /** What `createImageBitmap(canvas)` gives: Skia draws a canvas as it draws an image. */
  static bitmapOf(of: FakeOffscreenCanvas): Canvas {
    return of.#canvas;
  }

  constructor(width: number, height: number) {
    this.#canvas = createCanvas(width, height);
  }

  get width(): number {
    return this.#canvas.width;
  }

  get height(): number {
    return this.#canvas.height;
  }

  getContext(kind: "2d") {
    return this.#canvas.getContext(kind);
  }

  convertToBlob(options: { type: string; quality: number }): Promise<Blob> {
    if (options.type !== "image/jpeg")
      throw new Error(`double encodes JPEG only, not ${options.type}`);
    const bytes = this.#canvas.encodeSync("jpeg", options.quality * 100);
    return Promise.resolve(
      new Blob([Uint8Array.from(bytes)], { type: options.type }),
    );
  }
}

async function fakeCreateImageBitmap(
  source: Blob | FakeOffscreenCanvas,
  options?: { imageOrientation: string },
): Promise<(Image | Canvas) & { close(): void }> {
  if (source instanceof FakeOffscreenCanvas)
    return Object.assign(FakeOffscreenCanvas.bitmapOf(source), {
      close: () => undefined,
    });
  // Chromium's default for a Blob is upright too; the double insists the UI asks for it.
  if (options?.imageOrientation !== "from-image")
    throw new Error("the Plugin must ask for EXIF orientation");
  const image = await loadImage(Buffer.from(await source.arrayBuffer()));
  return Object.assign(image, { close: () => undefined });
}

/** Puts the doubles on `globalThis`, where the Plugin UI finds Chromium's. */
export function installCanvasDouble(): void {
  Object.assign(globalThis, {
    OffscreenCanvas: FakeOffscreenCanvas,
    createImageBitmap: fakeCreateImageBitmap,
  });
}

/** A synthetic receipt photo: white paper with a dark block on its left half. */
export function photo(
  name: string,
  width: number,
  height: number,
  format: "jpeg" | "png",
  orientation: "upright" | "exif-6" = "upright",
): File {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width / 2, height);
  const encoded =
    format === "jpeg"
      ? canvas.encodeSync("jpeg", 95)
      : canvas.encodeSync("png");
  const bytes =
    orientation === "exif-6"
      ? withOrientation6(encoded)
      : Uint8Array.from(encoded);
  return new File([bytes], name, { type: `image/${format}` });
}

/** The JPEG with an APP1 Exif segment after SOI saying "rotate 90° clockwise to view". */
function withOrientation6(jpeg: Uint8Array): Uint8Array<ArrayBuffer> {
  // Big-endian TIFF header, then IFD0 with one entry: Orientation (0x0112), SHORT, 1 value, 6.
  const tiff = [
    0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0,
    0, 0, 0, 0, 0,
  ];
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
  const length = payload.length + 2;
  const app1 = [0xff, 0xe1, length >> 8, length & 0xff, ...payload];
  return Uint8Array.from([
    ...jpeg.subarray(0, 2),
    ...app1,
    ...jpeg.subarray(2),
  ]);
}

/** A JPEG's width and height, decoded the way Word would. */
export async function jpegSize(
  bytes: Uint8Array,
): Promise<{ width: number; height: number }> {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("not a JPEG");
  const image = await loadImage(Buffer.from(bytes));
  return { width: image.width, height: image.height };
}

/** One page of a synthetic PDF: a scan (one JPEG photo, drawn small) or a vector drawing. */
export type PdfPage =
  | { readonly kind: "scan"; readonly width: number; readonly height: number }
  | {
      readonly kind: "drawing";
      readonly widthPt: number;
      readonly heightPt: number;
    };

/** A PDF built with pdf-lib, as Genius Scan or an accounts system would export it. */
export async function pdf(
  name: string,
  pages: readonly PdfPage[],
  protection: "open" | "password" = "open",
): Promise<File> {
  const doc = await PDFDocument.create();
  for (const page of pages) {
    switch (page.kind) {
      case "scan": {
        const scan = photo("scan.jpg", page.width, page.height, "jpeg");
        const image = await doc.embedJpg(await scan.arrayBuffer());
        // Drawn small on an A4 page: only the image's own pixels give its resolution.
        doc
          .addPage([595, 842])
          .drawImage(image, { x: 20, y: 20, width: 200, height: 300 });
        break;
      }
      case "drawing": {
        const sheet = doc.addPage([page.widthPt, page.heightPt]);
        sheet.drawRectangle({
          x: 0,
          y: 0,
          width: page.widthPt / 2,
          height: page.heightPt,
          color: rgb(0, 0, 0),
        });
        break;
      }
      default:
        page satisfies never;
    }
  }
  if (protection === "password") {
    // pdf-lib cannot encrypt, so this adds a Standard security handler whose user password is
    // not empty: no reader opens it without asking for one, as with a password-protected export.
    const ctx = doc.context;
    ctx.trailerInfo.Encrypt = ctx.register(
      ctx.obj({
        Filter: "Standard",
        V: 2,
        R: 3,
        Length: 128,
        P: -4,
        O: PDFHexString.of("11".repeat(32)),
        U: PDFHexString.of("22".repeat(32)),
      }),
    );
    const id = PDFHexString.of("33".repeat(16));
    ctx.trailerInfo.ID = ctx.obj([id, id]);
  }
  return new File([Uint8Array.from(await doc.save())], name, {
    type: "application/pdf",
  });
}
