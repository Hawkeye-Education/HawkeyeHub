// What the Plugin preload sends on `SECRETS`: the schema main parses it with, and the type inferred
// from it. The preload imports only the type, so zod stays out of its bundle.

import { z } from "zod";

// The page's own arguments, so a Plugin's mistake, such as a number for a value, fails its call.
export const SecretCall = z.discriminatedUnion("call", [
  z.strictObject({ call: z.literal("get"), name: z.string() }),
  z.strictObject({
    call: z.literal("set"),
    name: z.string(),
    value: z.string(),
  }),
  z.strictObject({ call: z.literal("remove"), name: z.string() }),
]);
export type SecretCall = z.infer<typeof SecretCall>;
