import { describe, expect, it } from "vitest";
import { amountInWords, type HkdCents } from "./amountInWords";

const cases: [number, string][] = [
  [123400, "港幣壹仟貳佰叁拾肆元正"],
  [123456, "港幣壹仟貳佰叁拾肆元伍角陸分"],
  [10005, "港幣壹佰元零伍分"],
  [10050, "港幣壹佰元伍角"],
  [50, "港幣伍角"],
  [0, "港幣零元正"],
  [100500, "港幣壹仟零伍元正"],
  [1000000, "港幣壹萬元正"],
  [1000500, "港幣壹萬零伍元正"],
  [12345600, "港幣壹拾貳萬叁仟肆佰伍拾陸元正"],
  [100001000, "港幣壹佰萬零壹拾元正"],
  [1000000000000, "港幣壹佰億元正"],
];

describe("amountInWords", () => {
  it.each(cases)("%i cents reads %s", (cents, words) => {
    expect(amountInWords(cents as HkdCents)).toBe(words);
  });
});
