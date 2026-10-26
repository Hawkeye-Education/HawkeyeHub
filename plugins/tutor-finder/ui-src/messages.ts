// The two WhatsApp messages (source SPEC §6), ported from the source app's app.js. The templates
// (`<level>導師`, the `---` divider, the `+852` lines) are the client-facing text and stay word for
// word whatever the Display Language. Pure: tutors in, text out, nothing logged.

import type { Level } from "./parsing";
import { cheapest, type ShownTutor } from "./table";

/** The level the profile names: the cheapest matching offering's, else any matching one's, else
 * any of the tutor's. null: no offering has a level at all. */
function profileLevel({ tutor, offerings }: ShownTutor): Level | null {
  const price = cheapest(offerings);
  const levelled = [
    offerings.find((o) => o.price === price && o.level !== null),
    offerings.find((o) => o.level !== null),
    tutor.offerings.find((o) => o.level !== null),
  ].find((o) => o !== undefined);
  return levelled?.level ?? null; // undefined: none of the three found one
}

function profileBlock(shown: ShownTutor): string {
  const { tutor, offerings } = shown;
  // Where the offering could not be levelled or priced, the hole is visible, not silent.
  const price = cheapest(offerings);
  const level = profileLevel(shown);
  const title = level === null ? "導師" : `${level}導師`; // the source prints a bare 導師
  const shownPrice = price === null ? "$?/hr" : `$${String(price)}/hr`;
  // No section skeleton: whatever the tutor left on the form, verbatim.
  const intro = tutor.intro ?? "(no self-introduction on file)";
  return `${[tutor.name, title, shownPrice].join(" | ")}\n${intro}`;
}

/** One block per tutor, joined by a `---` divider. */
export function profileMessage(selected: readonly ShownTutor[]): string {
  return selected.map(profileBlock).join("\n---\n");
}

/** One `<FirstName> <LastName>: +852 <number>` line per tutor; `?` where no number is on file. */
export function phoneMessage(selected: readonly ShownTutor[]): string {
  return selected
    .map(({ tutor }) => `${tutor.fullName}: +852 ${tutor.phone ?? "?"}`)
    .join("\n");
}
