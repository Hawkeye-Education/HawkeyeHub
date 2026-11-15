// A synthetic, unbranded Official Receipt template for tests, built in code so no binary is
// committed and the real template never is. The line-item placeholders sit in one table row, as
// the real template's do.

import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
import { PLACEHOLDERS } from "./template";

const ROW = new Set(["item_description", "item_amount"]);

/** A `.docx` holding `{{name}}` for each of `names`; by default, every placeholder. */
export async function fixtureTemplate(
  names: readonly string[] = PLACEHOLDERS,
): Promise<Uint8Array<ArrayBuffer>> {
  const cell = (name: string): TableCell =>
    new TableCell({ children: [new Paragraph(`{{${name}}}`)] });
  const rowNames = names.filter((name) => ROW.has(name));
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [new TextRun("OFFICIAL RECEIPT 正式收據")],
          }),
          ...names
            .filter((name) => !ROW.has(name))
            .map((name) => new Paragraph(`${name}: {{${name}}}`)),
          ...(rowNames.length > 0
            ? [
                new Table({
                  rows: [new TableRow({ children: rowNames.map(cell) })],
                }),
              ]
            : []),
        ],
      },
    ],
  });
  return new Uint8Array(await Packer.toArrayBuffer(doc));
}
