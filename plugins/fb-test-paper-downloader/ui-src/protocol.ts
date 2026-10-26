// The TypeScript half of the Plugin UI ↔ Backend protocol; backend/main.py's models are the other.
// Everything the Backend sends crosses a trust boundary, so it is parsed here.

import { z } from "zod";

export const SignInResult = z.strictObject({
  outcome: z.enum(["signed-in", "cancelled"]),
});

const PostResult = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("saved") }),
  z.strictObject({ kind: z.literal("skipped-not-paper") }),
  z.strictObject({
    kind: z.literal("incomplete"),
    saved: z.number().int(),
    shown: z.number().int(),
  }),
  z.strictObject({ kind: z.literal("failed"), detail: z.string() }),
]);
export type PostResult = z.infer<typeof PostResult>;

/** backend/update.py's ScanProgress | PostProgress. */
export const Progress = z.discriminatedUnion("phase", [
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
