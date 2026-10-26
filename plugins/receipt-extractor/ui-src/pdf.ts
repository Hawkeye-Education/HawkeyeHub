// A PDF staff handed over, read page by page into the bitmaps its receipts are cut from, as
// `page_to_image` in receipts_to_word.py does (spec #159).

// The legacy build: the modern one needs Promise.try and Uint8Array.toHex, which the Node the
// tests run on lacks (probed), and the Plugin UI should run the pdf.js its tests ran.
import {
  getDocument,
  GlobalWorkerOptions,
  ImageKind,
  OPS,
  PasswordException,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import workerSrc from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

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
  | { readonly kind: "failed"; readonly reason: "encrypted" | "unreadable" };

export async function openPdf(bytes: Uint8Array): Promise<OpenedPdf> {
  try {
    const pdf = await getDocument({
      data: bytes,
      // Images decoded to plain pixels in the worker, in Chromium as under Node, so a scan's
      // image reaches `imageOf` in the one shape the tests cover.
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
    }).promise;
    return { kind: "open", pdf };
  } catch (error) {
    // pdf.js asks for a password only through onPassword, which is not given, so a PDF with a
    // user password rejects with PasswordException (probed). Anything else is a corrupt file.
    return {
      kind: "failed",
      reason: error instanceof PasswordException ? "encrypted" : "unreadable",
    };
  }
}

/**
 * Page `number` (from 1): its one image at full resolution when it holds exactly one, as a
 * Genius Scan export does, otherwise the whole page rendered at 300 DPI.
 */
export async function pageBitmap(
  pdf: PDFDocumentProxy,
  number: number,
): Promise<ImageBitmap> {
  const page = await pdf.getPage(number);
  const { fnArray, argsArray } = await page.getOperatorList();
  const paints = fnArray.flatMap((fn, i) => {
    const args: unknown = argsArray[i];
    return PAINTS_IMAGE.has(fn) ? [{ fn, args }] : [];
  });
  const [only, ...others] = paints;
  if (only?.fn === OPS.paintImageXObject && others.length === 0) {
    const image = imageOf(page, only.args);
    if (image !== "not-pixels") return createImageBitmap(image);
  }
  return createImageBitmap(await rendered(page));
}

/** The image a paintImageXObject draws, on a canvas of its own size, or why it can't be. */
function imageOf(
  page: PDFPageProxy,
  args: unknown,
): OffscreenCanvas | "not-pixels" {
  if (!Array.isArray(args) || typeof args[0] !== "string")
    throw new Error("pdf.js painted an image without an object id");
  const id = args[0];
  // An image shared between pages lives with the document, not the page (its id starts "g_").
  const objs = page.objs.has(id) ? page.objs : page.commonObjs;
  const image: unknown = objs.get(id);
  if (
    typeof image !== "object" ||
    image === null ||
    !("width" in image && typeof image.width === "number") ||
    !("height" in image && typeof image.height === "number") ||
    !("kind" in image && typeof image.kind === "number") ||
    !("data" in image && image.data instanceof Uint8ClampedArray)
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
    default:
      // ponytail: a 1-bit scan (GRAYSCALE_1BPP) is rendered at 300 DPI instead of unpacked;
      // unpack its bits here if black-and-white scans need their full resolution.
      return "not-pixels";
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

async function rendered(page: PDFPageProxy): Promise<OffscreenCanvas> {
  const viewport = page.getViewport({ scale: DPI / POINTS_PER_INCH });
  const canvas = new OffscreenCanvas(
    Math.ceil(viewport.width),
    Math.ceil(viewport.height),
  );
  // ponytail: no cMapUrl or standardFontDataUrl, so a drawn PDF whose text uses a predefined CJK
  // CMap or an unembedded font may lose that text; ship pdfjs-dist's cmaps/ and standard_fonts/
  // if e-receipts need it. Scans, the Plugin's input, have no such text.
  await page.render({
    canvas: null,
    // pdf.js types its context as a DOM canvas's; an OffscreenCanvas's has the same drawing API.
    canvasContext: context(canvas) as unknown as CanvasRenderingContext2D,
    viewport,
  }).promise;
  return canvas;
}

function context(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("OffscreenCanvas has no 2d context");
  return ctx;
}
