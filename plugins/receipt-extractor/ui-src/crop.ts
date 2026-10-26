// The auto-crop: a step-by-step port of `crop_receipt` in receipts_to_word.py (spec #159), which
// finds the receipt in a photo by its ink. It runs in crop.worker.ts, off the UI thread.

/** RGBA pixels, as `getImageData` returns them. */
export interface Pixels {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** Where the receipt is, or `fallback`: none was found, so the whole photo is kept. */
export type Crop =
  | {
      readonly kind: "box";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }
  | { readonly kind: "fallback" };

// Indexing a typed array inside its bounds still types as `number | undefined` under
// noUncheckedIndexedAccess, so in-bounds reads below say `?? 0`; every index is in bounds.

const DUST_SHARE = 0.002;
const PAD_SHARE = 0.015;
const MIN_BOX_SHARE = 0.1;

export function cropBox({ data, width: w, height: h }: Pixels): Crop {
  // 1. Otsu threshold, inverted: ink is anything at or below the threshold.
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++)
    // OpenCV's BGR2GRAY weights.
    gray[i] = Math.round(
      0.299 * (data[i * 4] ?? 0) +
        0.587 * (data[i * 4 + 1] ?? 0) +
        0.114 * (data[i * 4 + 2] ?? 0),
    );
  const t = otsu(gray);
  let mask: Uint8Array = gray.map((v) => (v <= t ? 1 : 0));

  // 2. A 3 × 3 opening clears specks too thin to be ink.
  mask = dilate(erode(mask, w, h, 1, 1), w, h, 1, 1);

  // 3. Dilating by k merges the receipt's lines into blocks. OpenCV anchors a k × k kernel at
  // floor(k/2), so a mark grows k - 1 - floor(k/2) px before and floor(k/2) px after itself.
  const k = Math.max(15, Math.floor(Math.min(w, h) * 0.03));
  const g = Math.floor(k / 2);
  const blob = dilate(mask, w, h, g, k - 1 - g);

  // 4 and 5. The union box of the blocks that aren't dust.
  const minArea = w * h * DUST_SHARE;
  const kept = components(blob, w, h).filter((c) => c.area >= minArea);
  if (kept.length === 0) return { kind: "fallback" }; // blank paper
  // Undo the dilation's growth, then pad.
  const pad = Math.floor(Math.max(w, h) * PAD_SHARE);
  const x0 = Math.max(0, Math.min(...kept.map((c) => c.x0)) + g - pad);
  const y0 = Math.max(0, Math.min(...kept.map((c) => c.y0)) + g - pad);
  const x1 = Math.min(w, Math.max(...kept.map((c) => c.x1)) - g + pad);
  const y1 = Math.min(h, Math.max(...kept.map((c) => c.y1)) - g + pad);

  // 6. A box this small is a bad detection.
  if (x1 - x0 < w * MIN_BOX_SHARE || y1 - y0 < h * MIN_BOX_SHARE)
    return { kind: "fallback" };
  return { kind: "box", x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** The threshold maximising the between-class variance; the first one on ties, as OpenCV. */
function otsu(gray: Uint8Array): number {
  const hist = new Array<number>(256).fill(0);
  for (const v of gray) hist[v] = (hist[v] ?? 0) + 1;
  const total = gray.length;
  let sumAll = 0;
  for (let v = 0; v < 256; v++) sumAll += v * (hist[v] ?? 0);
  let best = 0;
  let bestSigma = 0;
  let n0 = 0;
  let sum0 = 0;
  for (let t = 0; t < 256; t++) {
    n0 += hist[t] ?? 0;
    sum0 += t * (hist[t] ?? 0);
    const n1 = total - n0;
    if (n0 === 0 || n1 === 0) continue;
    const diff = sum0 / n0 - (sumAll - sum0) / n1;
    const sigma = n0 * n1 * diff * diff;
    if (sigma > bestSigma) {
      bestSigma = sigma;
      best = t;
    }
  }
  return best;
}

// Erode and dilate look at a window `before` px up/left and `after` px down/right of each pixel,
// clipped to the photo (OpenCV's default border never counts as ink, nor stops an erosion). A
// rectangle is two passes of a line, each counting the ink in its window with a running sum.

function erode(
  mask: Uint8Array,
  w: number,
  h: number,
  before: number,
  after: number,
): Uint8Array {
  return rect(mask, w, h, before, after, (count, size) => count === size);
}

function dilate(
  mask: Uint8Array,
  w: number,
  h: number,
  before: number,
  after: number,
): Uint8Array {
  return rect(mask, w, h, before, after, (count) => count > 0);
}

function rect(
  mask: Uint8Array,
  w: number,
  h: number,
  before: number,
  after: number,
  keep: (count: number, size: number) => boolean,
): Uint8Array {
  const rows = line(mask, w, h, 1, w, before, after, keep);
  return line(rows, h, w, w, 1, before, after, keep);
}

/** For each of `lines` lines of `length` pixels, `step` apart within a line and `stride` apart between lines. */
function line(
  src: Uint8Array,
  length: number,
  lines: number,
  step: number,
  stride: number,
  before: number,
  after: number,
  keep: (count: number, size: number) => boolean,
): Uint8Array {
  const out = new Uint8Array(src.length);
  const prefix = new Int32Array(length + 1);
  for (let l = 0; l < lines; l++) {
    const start = l * stride;
    for (let i = 0; i < length; i++)
      prefix[i + 1] = (prefix[i] ?? 0) + (src[start + i * step] ?? 0);
    for (let i = 0; i < length; i++) {
      const lo = Math.max(0, i - before);
      const hi = Math.min(length, i + after + 1);
      const count = (prefix[hi] ?? 0) - (prefix[lo] ?? 0);
      out[start + i * step] = keep(count, hi - lo) ? 1 : 0;
    }
  }
  return out;
}

interface Component {
  area: number;
  x0: number;
  y0: number;
  /** One past the right edge. */
  x1: number;
  /** One past the bottom edge. */
  y1: number;
}

/** The 8-connected ink regions, with their pixel count and bounding box. */
function components(mask: Uint8Array, w: number, h: number): Component[] {
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const found: Component[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || seen[start] === 1) continue;
    const c = { area: 0, x0: w, y0: h, x1: 0, y1: 0 };
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const p = stack[--top] ?? 0;
      const x = p % w;
      const y = (p - x) / w;
      c.area++;
      c.x0 = Math.min(c.x0, x);
      c.y0 = Math.min(c.y0, y);
      c.x1 = Math.max(c.x1, x + 1);
      c.y1 = Math.max(c.y1, y + 1);
      for (let ny = Math.max(0, y - 1); ny <= Math.min(h - 1, y + 1); ny++)
        for (let nx = Math.max(0, x - 1); nx <= Math.min(w - 1, x + 1); nx++) {
          const q = ny * w + nx;
          if (mask[q] === 1 && seen[q] === 0) {
            seen[q] = 1;
            stack[top++] = q;
          }
        }
    }
    found.push(c);
  }
  return found;
}
