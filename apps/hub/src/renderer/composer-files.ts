// What the Assistant Panel's composer attaches (spec #142): a file of a kind the current model
// accepts, or a text file, which every model takes as text; up to 20 MB each.

import type { Attachment } from "../shared/ai-call";
import {
  AUDIO_MEDIA_TYPES,
  type AudioMediaType,
  type ModelInput,
} from "../shared/hub-chrome-ipc";

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const AUDIO_BY_EXTENSION = new Map(Object.entries(AUDIO_MEDIA_TYPES));
const TEXT_EXTENSIONS = ["txt", "md", "csv", "json"];

/** Why a file was not attached. */
export type Refusal =
  | { kind: "unknown-type"; name: string }
  | { kind: "too-big"; name: string; bytes: number }
  | { kind: "not-for-model"; name: string; input: ModelInput };

export type Picked =
  | { kind: "attached"; attachment: Attachment }
  | { kind: "refused"; refusal: Refusal };

/** A file's kind: a model input (audio with its media type), or `text`. */
type FileKind =
  | { input: Exclude<ModelInput, "audio"> | "text" }
  | { input: "audio"; mediaType: AudioMediaType };

/** The file's kind, or null for one the composer does not know. */
function kindOf(file: File): FileKind | null {
  const extension = file.name.toLowerCase().split(".").pop();
  if (IMAGE_TYPES.includes(file.type)) return { input: "image" };
  if (file.type === "application/pdf" || extension === "pdf")
    return { input: "document" };
  if (extension === undefined) return null;
  const mediaType = AUDIO_BY_EXTENSION.get(extension);
  if (mediaType !== undefined) return { input: "audio", mediaType };
  if (TEXT_EXTENSIONS.includes(extension)) return { input: "text" };
  return null;
}

/** Attaches `file` for a model that accepts `inputs`, or says why not. */
export async function attach(
  file: File,
  inputs: readonly ModelInput[],
): Promise<Picked> {
  const { name } = file;
  const kind = kindOf(file);
  const refused = (refusal: Refusal): Picked => ({ kind: "refused", refusal });
  if (kind === null) return refused({ kind: "unknown-type", name });
  if (file.size > MAX_ATTACHMENT_BYTES)
    return refused({ kind: "too-big", name, bytes: file.size });
  if (kind.input !== "text" && !inputs.includes(kind.input))
    return refused({ kind: "not-for-model", name, input: kind.input });
  const attached = (part: Attachment["part"]): Picked => ({
    kind: "attached",
    attachment: { kind: "attached", name, part },
  });
  switch (kind.input) {
    case "text":
      return attached({ type: "text", text: await file.text() });
    case "image":
      return attached({
        type: "image",
        image: new Uint8Array(await file.arrayBuffer()),
        mediaType: file.type,
      });
    case "document":
      return attached({
        type: "document",
        data: new Uint8Array(await file.arrayBuffer()),
        mediaType: "application/pdf",
      });
    case "audio":
      return attached({
        type: "audio",
        data: new Uint8Array(await file.arrayBuffer()),
        mediaType: kind.mediaType,
      });
    default:
      return kind satisfies never;
  }
}

/** The paperclip picker's `accept`: the model's inputs, then text files. */
export function pickerAccept(inputs: readonly ModelInput[]): string {
  const accepts = {
    image: IMAGE_TYPES,
    document: [".pdf"],
    audio: Object.keys(AUDIO_MEDIA_TYPES).map((extension) => `.${extension}`),
  } satisfies Record<ModelInput, string[]>;
  return [
    ...(["image", "document", "audio"] as const).flatMap((input) =>
      inputs.includes(input) ? accepts[input] : [],
    ),
    ...TEXT_EXTENSIONS.map((extension) => `.${extension}`),
  ].join(",");
}

/** Whether a model that accepts `inputs` can take this attachment. */
export function takes(
  inputs: readonly ModelInput[],
  { part }: Attachment,
): boolean {
  return part.type === "text" || inputs.includes(part.type);
}

/** A size as staff read it: "820 B", "4 KB", "1.2 MB". */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The bytes an attachment sends, for its chip. */
export function bytesOf({ part }: Attachment): number {
  switch (part.type) {
    case "text":
      return new TextEncoder().encode(part.text).length;
    case "image":
      return part.image.length;
    case "document":
    case "audio":
      return part.data.length;
    default:
      return part satisfies never;
  }
}
