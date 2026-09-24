/** Taking our own bookkeeping out of what a person reads.
 *
 *  Decisions, findings and ADRs are cited by code — D144, F70, A6, ADR-010 —
 *  and the citation belongs next to the rule in the code and the database,
 *  where the next person changing it needs to find why. It does not belong in
 *  a toast or a settings hint: to the person reading it, "(D144)" is noise
 *  that looks like an error code.
 *
 *  Much of that text comes from the database (a refusal raised by a seam, a
 *  setting's help line), so it is stripped where it is shown rather than
 *  rewritten in every migration. Only a parenthesis that is a citation is
 *  removed; "(A4)" is a paper size and "(10 lembar)" is content, and both stay.
 */
const CODE = String.raw`(?:D\d{1,3}|F\d{1,3}|Q\d{1,3}|B\d{1,2}|A(?![345]\b)\d{1,2}|ADR-?\d{1,3})\b`;
/* A parenthesis that opens with a code — "(D144)", "(D155, Q41)", "(D283,
   superseding D188's 30)" — or that closes with one after a comma — "(owner,
   D231)". Both are citations; neither says anything the sentence needs. */
const PAREN = new RegExp(
  String.raw`\s*\((?:\s*${CODE}[^()]*|[^()]*,\s*${CODE}\s*)\)`,
  "g",
);

export function stripRefs<T extends string | null | undefined>(text: T): T {
  if (!text) return text;
  return text.replace(PAREN, "") as T;
}
