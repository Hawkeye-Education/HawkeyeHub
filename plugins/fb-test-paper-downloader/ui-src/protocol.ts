// The TypeScript half of the Plugin UI ↔ Backend protocol; backend/main.py's models are the other.
// Everything the Backend sends crosses a trust boundary, so it is parsed here.

import { z } from "zod";

export const SignInResult = z.strictObject({
  outcome: z.enum(["signed-in", "cancelled"]),
});

// The Backend's own reasons, plus the three every SDK Backend can send.
export const Reason = z.enum([
  "browser-not-found",
  "already-running",
  "invalid-params",
  "method-not-found",
  "internal",
]);
export const RpcData = z.strictObject({ reason: Reason });
