// pdfjs-dist ships no types for its worker module; the tests only hand it back to pdf.js.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
