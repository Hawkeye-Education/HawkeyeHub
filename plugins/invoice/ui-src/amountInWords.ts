/** A non-negative whole number of Hong Kong cents. */
export type HkdCents = number & { readonly __brand: "HkdCents" };

const DIGITS = "零壹貳叁肆伍陸柒捌玖";
const PLACES = ["", "拾", "佰", "仟"];
const GROUPS = ["", "萬", "億", "萬億"];

function digit(n: number): string {
  // DIGITS has an entry for every 0-9; the type system cannot see that.
  return DIGITS.charAt(n);
}

/** Reads a whole number of dollars in financial numerals, e.g. 10005 → 壹萬零伍. */
function dollarsInWords(dollars: number): string {
  if (dollars === 0) return digit(0);
  let words = "";
  let pendingZero = false;
  const digits = String(dollars);
  for (let i = 0; i < digits.length; i++) {
    const place = digits.length - 1 - i;
    const d = Number(digits[i]);
    if (d === 0) {
      pendingZero = true;
    } else {
      if (pendingZero) words += digit(0);
      pendingZero = false;
      words += digit(d) + (PLACES[place % 4] ?? "");
    }
    if (place % 4 === 0 && place > 0) {
      const group = digits.slice(Math.max(0, i - 3), i + 1);
      if (Number(group) > 0) words += GROUPS[place / 4] ?? "";
    }
  }
  return words;
}

/** Total → 大寫 with a 港幣 prefix: 港幣壹佰元零伍分, 港幣壹仟貳佰叁拾肆元正. */
export function amountInWords(total: HkdCents): string {
  if (!Number.isInteger(total) || total < 0) {
    throw new Error(`Not a whole non-negative cent amount: ${String(total)}`);
  }
  const dollars = Math.floor(total / 100);
  const jiao = Math.floor((total % 100) / 10);
  const fen = total % 10;
  let words = "港幣";
  if (dollars > 0 || total === 0) words += `${dollarsInWords(dollars)}元`;
  if (jiao === 0 && fen === 0) return `${words}正`;
  if (jiao > 0) words += `${digit(jiao)}角`;
  else if (dollars > 0) words += digit(0);
  if (fen > 0) words += `${digit(fen)}分`;
  return words;
}
