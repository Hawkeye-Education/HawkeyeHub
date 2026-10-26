// One photo staff handed over, turned into one receipt for the document (spec #159).

/** A receipt ready for the document: an upright JPEG and its size in pixels. */
export interface Receipt {
  readonly jpeg: Uint8Array<ArrayBuffer>;
  readonly width: number;
  readonly height: number;
}

export type Extracted =
  | { readonly kind: "receipt"; readonly receipt: Receipt }
  | { readonly kind: "failed"; readonly reason: "unsupported" | "unreadable" };

const JPEG_QUALITY = 0.9;

/** JPEG (FF D8 FF) or PNG (89 'P' 'N' 'G'), by content: a file's name and type are only claims. */
function isJpegOrPng(b: Uint8Array): boolean {
  return (
    (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ||
    (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
  );
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
