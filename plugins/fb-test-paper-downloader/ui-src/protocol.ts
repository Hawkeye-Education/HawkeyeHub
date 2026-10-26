// The TypeScript half of the Plugin UI ↔ Backend protocol; backend/main.py's models are the other.
// Everything the Backend sends crosses a trust boundary, so it is parsed here.

import { z } from "zod";

export const SignInResult = z.strictObject({
  outcome: z.enum(["signed-in", "cancelled"]),
});

const Saved = z.strictObject({ kind: z.literal("saved") });
const Failed = z.strictObject({
  kind: z.literal("failed"),
  detail: z.string(),
});

const FileResult = z.discriminatedUnion("kind", [
  Saved,
  // a file of that name is already on disk
  z.strictObject({ kind: z.literal("skipped-known") }),
  Failed,
]);
export type FileResult = z.infer<typeof FileResult>;

const PostResult = z.discriminatedUnion("kind", [
  Saved,
  z.strictObject({ kind: z.literal("skipped-not-paper") }),
  z.strictObject({
    kind: z.literal("incomplete"),
    saved: z.number().int(),
    shown: z.number().int(),
  }),
  Failed,
]);
export type PostResult = z.infer<typeof PostResult>;

/** backend/update.py's FilesProgress | ScanProgress | PostProgress. */
export const Progress = z.discriminatedUnion("phase", [
  z.strictObject({
    phase: z.literal("files"),
    done: z.number().int(),
    total: z.number().int(),
    item: z.string(),
    result: FileResult,
  }),
  // new posts queued so far: the feed's length is unknown until the scan ends
  z.strictObject({ phase: z.literal("scan"), found: z.number().int() }),
  z.strictObject({
    phase: z.literal("posts"),
    done: z.number().int(),
    total: z.number().int(),
    item: z.string(),
    result: PostResult,
  }),
]);

export const UpdateResult = z.strictObject({
  filesSaved: z.number().int(),
  filesKnown: z.number().int(),
  filesFailed: z.number().int(),
  saved: z.number().int(),
  skippedNotPaper: z.number().int(),
  incomplete: z.number().int(),
  failed: z.number().int(),
  outcome: z.enum(["finished", "cancelled", "bad-streak"]),
});

// The Backend's own reasons, plus the three every SDK Backend can send.
export const Reason = z.enum([
  "browser-not-found",
  "signed-out",
  "checkpoint",
  "blocked",
  "folder-missing",
  "group-invalid",
  "already-running",
  "invalid-params",
  "method-not-found",
  "internal",
]);
export const RpcData = z.strictObject({ reason: Reason });
