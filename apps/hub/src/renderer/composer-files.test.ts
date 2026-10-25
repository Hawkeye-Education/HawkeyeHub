import { expect, test } from "vitest";
import { attach, pickerAccept } from "./composer-files";

const file = (name: string, type: string, body: string | Uint8Array = "x") =>
  new File([body], name, { type });

test("a file of an accepted kind attaches under its name, as the part the model gets", async () => {
  const inputs = ["image", "document", "audio"] as const;
  expect(await attach(file("scan.png", "image/png"), inputs)).toEqual({
    kind: "attached",
    attachment: {
      kind: "attached",
      name: "scan.png",
      part: {
        type: "image",
        image: new Uint8Array([120]),
        mediaType: "image/png",
      },
    },
  });
  expect(await attach(file("Worksheet.pdf", "application/pdf"), inputs)).toMatchObject({
    attachment: { part: { type: "document", mediaType: "application/pdf" } },
  });
  // Audio by its extension: browsers name a WAV's type several ways.
  expect(await attach(file("Oral.wav", "audio/x-wav"), inputs)).toMatchObject({
    attachment: { part: { type: "audio", mediaType: "audio/wav" } },
  });
  expect(await attach(file("Oral.MP3", ""), inputs)).toMatchObject({
    attachment: { part: { type: "audio", mediaType: "audio/mpeg" } },
  });
});

test("a text file attaches as text for any model, even one that takes nothing else", async () => {
  for (const name of ["notes.txt", "plan.md", "marks.csv", "data.json"]) {
    expect(await attach(file(name, "", "a,b"), [])).toEqual({
      kind: "attached",
      attachment: { kind: "attached", name, part: { type: "text", text: "a,b" } },
    });
  }
});

test("a file the model cannot take is refused, naming what it needs", async () => {
  expect(await attach(file("scan.png", "image/png"), ["document"])).toEqual({
    kind: "refused",
    refusal: { kind: "not-for-model", name: "scan.png", input: "image" },
  });
  expect(await attach(file("Oral.mp3", "audio/mpeg"), ["image"])).toEqual({
    kind: "refused",
    refusal: { kind: "not-for-model", name: "Oral.mp3", input: "audio" },
  });
});

test("a file of no kind the composer knows is refused, whatever the model takes", async () => {
  for (const unknown of [
    file("Notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    file("clip.bmp", "image/bmp"),
    file("README", ""),
  ]) {
    expect(await attach(unknown, ["image", "document", "audio"])).toEqual({
      kind: "refused",
      refusal: { kind: "unknown-type", name: unknown.name },
    });
  }
});

test("a file over 20 MB is refused with its size; 20 MB itself attaches", async () => {
  const limit = 20 * 1024 * 1024;
  expect(
    await attach(file("big.txt", "", new Uint8Array(limit + 1)), []),
  ).toEqual({
    kind: "refused",
    refusal: { kind: "too-big", name: "big.txt", bytes: limit + 1 },
  });
  expect(
    await attach(file("edge.txt", "", new Uint8Array(limit)), []),
  ).toMatchObject({ kind: "attached" });
});

test("the paperclip picker offers the model's inputs and text files", () => {
  expect(pickerAccept([])).toBe(".txt,.md,.csv,.json");
  expect(pickerAccept(["image", "audio"])).toBe(
    "image/png,image/jpeg,image/gif,image/webp,.wav,.mp3,.txt,.md,.csv,.json",
  );
  expect(pickerAccept(["document"])).toBe(".pdf,.txt,.md,.csv,.json");
});
