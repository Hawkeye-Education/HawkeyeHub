/** The 2d context of `canvas`, which an OffscreenCanvas in Chromium always has. */
export function context(
  canvas: OffscreenCanvas,
): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("OffscreenCanvas has no 2d context");
  return ctx;
}
