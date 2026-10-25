// The TypeScript half of the Plugin UI ↔ Backend protocol; backend/main.py's models are the other.
// Everything the Backend sends crosses a trust boundary, so it is parsed here.

import { z } from "zod";

export const ListPdfsResult = z.strictObject({ files: z.array(z.string()) });

export const PageTextResult = z.strictObject({
  pageCount: z.number().int(),
  lines: z.array(z.string()),
  repeated: z.array(z.string()),
});

export const RunResult = z.strictObject({
  cleaned: z.number().int(),
  failed: z.number().int(),
  total: z.number().int(),
  cancelled: z.boolean(),
});

const FileResult = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("cleaned"), removed: z.number().int() }),
  z.strictObject({ kind: z.literal("no-match") }),
  z.strictObject({ kind: z.literal("password") }),
  z.strictObject({ kind: z.literal("error"), detail: z.string() }),
]);

export const Progress = z.strictObject({
  done: z.number().int(),
  total: z.number().int(),
  file: z.string(),
  result: FileResult,
});

// The Backend's own reasons, plus the three every SDK Backend can send.
export const Reason = z.enum([
  "pattern-empty",
  "pattern-invalid",
  "same-folder",
  "output-inside-input",
  "folder-missing",
  "password",
  "already-running",
  "invalid-params",
  "method-not-found",
  "internal",
]);
export const RpcData = z.strictObject({ reason: Reason });
