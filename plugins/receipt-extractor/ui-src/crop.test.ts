// The auto-crop on synthetic paper: white with dark blocks as the receipt and specks as dust.
// Each expected box is worked by hand from the steps in spec #159, not from OpenCV.

import { expect, test } from "vitest";
import { cropBox } from "./crop";

interface Block {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** White RGBA paper, `width` × `height`, with each block painted black. */
function paper(width: number, height: number, blocks: Block[]) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const b of blocks)
    for (let y = b.y; y < b.y + b.height; y++)
      for (let x = b.x; x < b.x + b.width; x++)
        data.fill(0, (y * width + x) * 4, (y * width + x) * 4 + 3);
  return { data, width, height };
}

// 1000 × 1000 px: k = max(15, 30) = 30, so dilating reaches 14 px before and 15 px after a mark
// (OpenCV's anchor sits at k/2); k/2 = 15; the pad is 1.5% of 1000 = 15; dust is anything under
// 0.2% of the area, 2000 px.

test("the box is the receipt plus its pad, ignoring dust", () => {
  const pixels = paper(1000, 1000, [
    { x: 300, y: 100, width: 400, height: 800 }, // the receipt
    { x: 50, y: 50, width: 2, height: 2 }, // a speck the 3 × 3 opening removes
    { x: 50, y: 950, width: 4, height: 4 }, // a speck that dilates to 33 × 33 = 1089 px, under 2000
  ]);
  // Dilated, the receipt spans x 286..714 and y 86..914 inclusive. Shrunk by 15, padded by 15:
  // x0 = 286, x1 = 715, y0 = 86, y1 = 915.
  expect(cropBox(pixels)).toEqual({
    kind: "box",
    x: 286,
    y: 86,
    width: 429,
    height: 829,
  });
});

test("a receipt in parts is boxed as their union", () => {
  const pixels = paper(1000, 1000, [
    { x: 200, y: 100, width: 300, height: 100 }, // the shop's name
    { x: 400, y: 500, width: 400, height: 300 }, // the items, far enough to stay apart
  ]);
  // x0 = 200 - 14 = 186, x1 = 800 + 15 = 815, y0 = 100 - 14 = 86, y1 = 800 + 15 = 815.
  expect(cropBox(pixels)).toEqual({
    kind: "box",
    x: 186,
    y: 86,
    width: 629,
    height: 729,
  });
});

test("a box clipped by the photo's edge stays inside it", () => {
  // 100 × 200 px: k = 15 (7 each way), k/2 = 7, pad = 3. The receipt touches the left and top.
  const pixels = paper(100, 200, [{ x: 0, y: 0, width: 50, height: 150 }]);
  // Dilated: x 0..56, y 0..156. x0 = 0 + 7 - 3 = 4, x1 = 57 - 7 + 3 = 53, y0 = 4, y1 = 153.
  expect(cropBox(pixels)).toEqual({
    kind: "box",
    x: 4,
    y: 4,
    width: 49,
    height: 149,
  });
});

test("a box under 10% of the width keeps the whole photo as a fallback", () => {
  // Dilated: x 466..534, 69 px wide, kept as it is over 2000 px; its box is 69 px, under 100.
  const pixels = paper(1000, 1000, [
    { x: 480, y: 100, width: 40, height: 800 },
  ]);
  expect(cropBox(pixels)).toEqual({ kind: "fallback" });
});

test("a box under 10% of the height keeps the whole photo as a fallback", () => {
  const pixels = paper(1000, 1000, [
    { x: 100, y: 480, width: 800, height: 40 },
  ]);
  expect(cropBox(pixels)).toEqual({ kind: "fallback" });
});

test("blank paper keeps the whole photo as a fallback", () => {
  expect(cropBox(paper(300, 300, []))).toEqual({ kind: "fallback" });
});
