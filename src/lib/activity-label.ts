import { NAV } from "./nav";

/** What a screen is called, for the activity trail.
 *
 *  The trail stores a **label as well as a path**, because a recap that reads
 *  `/hrd/payroll/pyr-26-09-06_01` four times is a recap nobody reads. The
 *  label is what makes `Payroll (12) · Pelacakan (3)` a sentence about somebody's
 *  day.
 *
 *  Three decisions here, and each one is about what the trail will still mean in
 *  six months.
 *
 *  **The English label, never the translated one.** `NAV` carries both — `label`
 *  and a `labelKey` into `MESSAGES.nav` — and the trail takes `label`. A label
 *  is written once and read much later, possibly by somebody else: storing the
 *  reader's language at the time of writing means one person's day reads
 *  *Payroll* and another's reads *Penggajian* for the same screen, and the
 *  recap groups them apart. The screen that displays it may translate; the row
 *  must not (D224 sets the language policy for the interface, not for stored
 *  data).
 *
 *  **Longest prefix, not exact match.** `/procurement/po/PO-26-0041` is not in
 *  the menu and never will be — the menu lists `/procurement/po`. Matching on a
 *  prefix means a detail screen is named after the list it belongs to, which is
 *  how a person describes it anyway. The match is on whole segments, so
 *  `/procurement/pot` never resolves to `/procurement/po`.
 *
 *  **The tail is kept, and it is not part of the label.** The path is stored
 *  beside the label and carries the document number, so *which* purchase order
 *  is answerable. Folding it into the label would make every detail view its own
 *  entry in `top_screens`, and the field whose whole purpose is *the five things
 *  they were in* would become a list of document numbers.
 */
const ENTRIES: { href: string; label: string }[] = NAV
  .flatMap((section) => section.items.map((i) => ({ href: i.href, label: i.label })))
  /* Longest first, so `/hrd/payroll/minggu` wins over `/hrd/payroll`. */
  .sort((a, b) => b.href.length - a.href.length);

/** Does `path` sit at or under `href`, on a segment boundary? */
function covers(href: string, path: string): boolean {
  return path === href || path.startsWith(`${href}/`);
}

export function labelFor(pathname: string): string {
  const hit = ENTRIES.find((e) => covers(e.href, pathname));
  if (hit) return hit.label;

  /* Not in the menu at all — `/no-access`, `/demo`, a screen added before its
     menu entry. Naming it after its path is honest; inventing a title from the
     segment would produce *Berkas 201* one day and *Berkas-201* the next, and
     the recap would count them as two screens. */
  return pathname;
}
