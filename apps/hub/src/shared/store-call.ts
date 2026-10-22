// What the Plugin preload sends on `STORES`: the schema main parses it with, and the type inferred
// from it. The preload imports only the type, so zod stays out of its bundle.

import { z } from "zod";

// The page's own arguments, so the Plugin's mistakes, such as a number for a path, fail its own
// call. `watch` and `unwatch` carry an id the preload numbers each watch with.
export const StoreCall = z.discriminatedUnion("call", [
  z.strictObject({ call: z.literal("list"), store: z.string() }),
  z.strictObject({
    call: z.literal("readText"),
    store: z.string(),
    path: z.string(),
  }),
  z.strictObject({
    call: z.literal("readBytes"),
    store: z.string(),
    path: z.string(),
  }),
  z.strictObject({
    call: z.literal("writeText"),
    store: z.string(),
    path: z.string(),
    text: z.string(),
  }),
  z.strictObject({
    call: z.literal("writeBytes"),
    store: z.string(),
    path: z.string(),
    // Not z.instanceof, which infers Uint8Array<ArrayBuffer>: the page may pass any Uint8Array.
    bytes: z.custom<Uint8Array>((value) => value instanceof Uint8Array),
  }),
  z.strictObject({
    call: z.literal("watch"),
    store: z.string(),
    id: z.number(),
  }),
  z.strictObject({ call: z.literal("unwatch"), id: z.number() }),
]);
export type StoreCall = z.infer<typeof StoreCall>;
