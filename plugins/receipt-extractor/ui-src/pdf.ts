// A PDF staff handed over, read page by page into the bitmaps its receipts are cut from, as
// `page_to_image` in receipts_to_word.py does (spec #159).

// The legacy build: the modern one needs Promise.try and Uint8Array.toHex, which the Node the
// tests run on lacks (probed), and the Plugin UI should run the pdf.js its tests ran.
import {
  getDocument,
  GlobalWorkerOptions,
  ImageKind,
  InvalidPDFException,
  OPS,
  PasswordException,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import workerSrc from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { context } from "./offscreen";
import type { FailReason } from "./receipt";

GlobalWorkerOptions.workerSrc = workerSrc;

/** The resolution a page without exactly one image is rendered at. */
const DPI = 300;
const POINTS_PER_INCH = 72;

const PAINTS_IMAGE: ReadonlySet<number> = new Set([
  OPS.paintImageXObject,
  OPS.paintImageXObjectRepeat,
  OPS.paintInlineImageXObject,
  OPS.paintInlineImageXObjectGroup,
  OPS.paintImageMaskXObject,
  OPS.paintImageMaskXObjectGroup,
  OPS.paintImageMaskXObjectRepeat,
  OPS.paintSolidColorImageMask,
]);

export type OpenedPdf =
  | { readonly kind: "open"; readonly pdf: PDFDocumentProxy }
  | {
      readonly kind: "failed";
      readonly reason: Exclude<FailReason, "unsupported">;
    };

/**
 * Whether pdf.js's worker failed on the file. Every error the worker sends back is rebuilt by
 * `wrapReason` (pdfjs-dist 6.4.299, legacy/build/pdf.mjs) as one of pdf.js's own exceptions, a
 * parser's own error (a corrupt file) as an UnknownErrorException, which pdf.js does not export,
 * so it is known by the `name` pdf.js's BaseException gives it.
 */
function workerFailed(error: unknown): boolean {
  return (
    error instanceof InvalidPDFException ||
    (error instanceof Error && error.name === "UnknownErrorException")
  );
}

export async function openPdf(bytes: Uint8Array): Promise<OpenedPdf> {
  try {
    const pdf = await getDocument({
      data: bytes,
      // Images decoded to plain pixels in the worker, in Chromium as under Node, so a scan's
      // image reaches `imageOf` in the shapes the tests cover.
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
    }).promise;
    return { kind: "open", pdf };
  } catch (error) {
    // pdf.js asks for a password only through onPassword, which is not given, so a PDF with a
    // user password rejects with PasswordException (probed).
    if (error instanceof PasswordException)
      return { kind: "failed", reason: "encrypted" };
    if (workerFailed(error)) return { kind: "failed", reason: "unreadable" };
    throw error;
  }
}

/**
 * Page `number` (from 1): its one image at full resolution when it holds exactly one, as a
 * Genius Scan export does, otherwise the whole page rendered at 300 DPI; or "unreadable" when
 * pdf.js can't read or draw the page.
 */
export async function pageBitmap(
  pdf: PDFDocumentProxy,
  number: number,
): Promise<ImageBitmap | "unreadable"> {
  let page: PDFPageProxy;
  let operators: Awaited<ReturnType<PDFPageProxy["getOperatorList"]>>;
  try {
    page = await pdf.getPage(number);
    operators = await page.getOperatorList();
  } catch (error) {
    if (workerFailed(error)) return "unreadable";
    throw error;
  }
  const { fnArray, argsArray } = operators;
  const paints = fnArray.flatMap((fn, i) => {
    const args: unknown = argsArray[i];
    return PAINTS_IMAGE.has(fn) ? [{ fn, args }] : [];
  });
  const [only, ...others] = paints;
  if (only?.fn === OPS.paintImageXObject && others.length === 0) {
    const image = await imageOf(page, only.args);
    if (image !== "not-pixels") return createImageBitmap(image);
  }
  const canvas = await rendered(page);
  return canvas === "unreadable" ? canvas : createImageBitmap(canvas);
}

/** The image a paintImageXObject draws, on a canvas of its own size, or why it can't be. */
async function imageOf(
  page: PDFPageProxy,
  args: unknown,
): Promise<OffscreenCanvas | "not-pixels"> {
  if (!Array.isArray(args) || typeof args[0] !== "string")
    throw new Error("pdf.js painted an image without an object id");
  const id = args[0];
  // An image shared between pages lives with the document, not the page, as pdf.js's own
  // paintImageXObject tells them apart (same file, CanvasGraphics).
  const objs = id.startsWith("g_") ? page.commonObjs : page.objs;
  // The worker may still be sending the image when the operator list arrives (probed with a
  // 1-bit scan); a callback waits for it.
  const image = await new Promise<unknown>((resolve) => {
    objs.get(id, resolve);
  });
  if (
    typeof image !== "object" ||
    image === null ||
    !("width" in image && typeof image.width === "number") ||
    !("height" in image && typeof image.height === "number") ||
    !("kind" in image && typeof image.kind === "number") ||
    // A Uint8Array for an image pdf.js passes on undecoded, as a 1-bit one (probed).
    !(
      "data" in image &&
      (image.data instanceof Uint8ClampedArray ||
        image.data instanceof Uint8Array)
    )
  )
    return "not-pixels";
  const { width, height, kind, data } = image;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = context(canvas);
  const pixels = ctx.createImageData(width, height);
  switch (kind) {
    case ImageKind.RGBA_32BPP:
      pixels.data.set(data);
      break;
    case ImageKind.RGB_24BPP:
      if (data.length !== width * height * 3)
        throw new Error("pdf.js gave an RGB image of the wrong length");
      for (let p = 0; p < width * height; p++) {
        // `?? 0` never applies: the length is checked above.
        pixels.data[p * 4] = data[p * 3] ?? 0;
        pixels.data[p * 4 + 1] = data[p * 3 + 1] ?? 0;
        pixels.data[p * 4 + 2] = data[p * 3 + 2] ?? 0;
        pixels.data[p * 4 + 3] = 255;
      }
      break;
    case ImageKind.GRAYSCALE_1BPP: {
      // Rows of bits, most significant first, each row padded to a whole byte; a set bit is
      // white, as pdf.js's own convertBlackAndWhiteToRGBA draws it (its worker has already
      // applied the image's Decode).
      const rowBytes = Math.ceil(width / 8);
      if (data.length !== rowBytes * height)
        throw new Error("pdf.js gave a 1-bit image of the wrong length");
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          // `?? 0` never applies: the length is checked above.
          const bit =
            ((data[y * rowBytes + (x >> 3)] ?? 0) >> (7 - (x & 7))) & 1;
          const p = (y * width + x) * 4;
          pixels.data.fill(bit * 255, p, p + 3);
          pixels.data[p + 3] = 255;
        }
      break;
    }
    default:
      return "not-pixels";
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

async function rendered(
  page: PDFPageProxy,
): Promise<OffscreenCanvas | "unreadable"> {
  const viewport = page.getViewport({ scale: DPI / POINTS_PER_INCH });
  const canvas = new OffscreenCanvas(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height),
  );
  // pdf.js types its context as a DOM canvas's. An OffscreenCanvas's has the same drawing API
  // (https://developer.mozilla.org/docs/Web/API/OffscreenCanvasRenderingContext2D), and pdf.js
  // reads only its canvas's width and height and draws that canvas onto itself, which an
  // OffscreenCanvas allows (pdfjs-dist 6.4.299, legacy/build/pdf.mjs, CanvasGraphics).
  const canvasContext = context(canvas) as unknown as CanvasRenderingContext2D;
  // ponytail: no cMapUrl or standardFontDataUrl, so a drawn PDF whose text uses a predefined CJK
  // CMap or an unembedded font may lose that text; ship pdfjs-dist's cmaps/ and standard_fonts/
  // if e-receipts need it. Scans, the Plugin's input, have no such text.
  try {
    await page.render({ canvas: null, canvasContext, viewport }).promise;
  } catch {
    // The try holds pdf.js's drawing of the page alone, which rejects with whatever the page's
    // content made it throw (InternalRenderTask, same file): the page is flagged on its own.
    return "unreadable";
  }
  return canvas;
}
