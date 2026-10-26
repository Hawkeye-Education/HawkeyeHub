// The two WhatsApp messages (source SPEC §6), ported from the source app's app.js. The templates
// (`<level>導師`, the `---` divider, the `+852` lines) are the client-facing text and stay word for
// word whatever the Display Language. Pure: tutors in, text out, nothing logged.

import type { Level, Offering, Tutor } from "./parsing";
import { cheapest, type ShownTutor } from "./table";

/** The tutor's offerings that match `level`; an unlevelled one matches every level (SPEC §3.4). */
export function matching(tutor: Tutor, level: Level | null): Offering[] {
  return level === null
    ? tutor.offerings
    : tutor.offerings.filter((o) => o.level === level || o.level === null);
}

function profileBlock({ tutor, offerings }: ShownTutor): string {
  // Level and price both come from the cheapest matching offering. Where the offering could not
  // be levelled or priced, print $?/hr so the hole is visible, not silent.
  const price = cheapest(offerings);
  const level =
    offerings.find((o) => o.price === price && o.level !== null)?.level ??
    offerings.find((o) => o.level !== null)?.level ??
    tutor.offerings.find((o) => o.level !== null)?.level ??
    ""; // the source prints a bare 導師 when no offering has a level at all
  const shown = price === null ? "$?/hr" : `$${String(price)}/hr`;
  // No section skeleton: whatever the tutor left on the form, verbatim.
  const intro =
    tutor.intro === "" ? "(no self-introduction on file)" : tutor.intro;
  return `${[tutor.name, `${level}導師`, shown].join(" | ")}\n${intro}`;
}

/** One block per tutor, joined by a `---` divider. */
export function profileMessage(selected: readonly ShownTutor[]): string {
  return selected.map(profileBlock).join("\n---\n");
}

/** One `<FirstName> <LastName>: +852 <number>` line per tutor. */
export function phoneMessage(selected: readonly ShownTutor[]): string {
  return selected
    .map(({ tutor }) => {
      const number = tutor.phone.replace(/^\+?852\s*/, "").trim();
      return `${tutor.fullName}: +852 ${number === "" ? "?" : number}`;
    })
    .join("\n");
}
