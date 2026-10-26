// The Word document a run saves: one receipt per A4 page, at the top right (spec #159). The
// rest of each page is left empty for sticking the paper receipt beside its copy.

import { AlignmentType, Document, ImageRun, Packer, Paragraph } from "docx";
import type { Receipt } from "./receipt";

// A4 is 21 × 29.7 cm, which Word stores as 11906 × 16838 twips; 1.27 cm is 720 twips.
const A4_TWIPS = { width: 11906, height: 16838 };
const MARGIN_TWIPS = 720;
const EMU_PER_CM = 360_000;
// Each receipt is scaled to fit within 9 × 25 cm, keeping its shape.
const BOX_EMU = { width: 9 * EMU_PER_CM, height: 25 * EMU_PER_CM };
// docx takes an image's size in 96-DPI pixels and stores round(px × 9525) EMU.
const EMU_PER_PX = 9525;

export function buildDocx(receipts: readonly Receipt[]): Promise<Blob> {
  const margin = {
    top: MARGIN_TWIPS,
    right: MARGIN_TWIPS,
    bottom: MARGIN_TWIPS,
    left: MARGIN_TWIPS,
  };
  return Packer.toBlob(
    new Document({
      sections: [
        {
          properties: { page: { size: A4_TWIPS, margin } },
          children: receipts.map(
            (receipt, i) =>
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: { before: 0, after: 0 },
                pageBreakBefore: i > 0,
                children: [
                  new ImageRun({
                    type: "jpg",
                    data: receipt.jpeg,
                    transformation: fit(receipt),
                  }),
                ],
              }),
          ),
        },
      ],
    }),
  );
}

function fit(receipt: Receipt): { width: number; height: number } {
  const scale = Math.min(
    BOX_EMU.width / receipt.width,
    BOX_EMU.height / receipt.height,
  );
  return {
    width: Math.round(receipt.width * scale) / EMU_PER_PX,
    height: Math.round(receipt.height * scale) / EMU_PER_PX,
  };
}

/** `<stem>_receipts.docx` for one input, `receipts_<YYYY-MM-DD>.docx` (local date) for several. */
export function suggestedName(
  inputs: readonly [string, ...string[]],
  today: Date,
): string {
  if (inputs.length === 1) {
    const dot = inputs[0].lastIndexOf(".");
    return `${dot > 0 ? inputs[0].slice(0, dot) : inputs[0]}_receipts.docx`;
  }
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `receipts_${String(today.getFullYear())}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}.docx`;
}
