/** A container number, as 0259 reads one (ISO 6346).
 *
 *  Four letters — the owner code and a category letter U, J or Z — then six
 *  digits of serial and one check digit. People type it from a photo of the
 *  door, with spaces and dashes; those are dropped. The check digit is
 *  computed and a mismatch **warned**, not refused (A6): the number on the
 *  door is more often right than a rule applied to a typo-free copy of it. */

/** Spaces, dashes and case dropped; null when nothing is left. */
export function cleanContainerNo(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return s || null;
}

/** The right shape: three letters, U/J/Z, seven digits. */
export function containerNoShapeOk(no: string): boolean {
  return /^[A-Z]{3}[UJZ][0-9]{7}$/.test(no);
}

const LETTER = [10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 34, 35, 36, 37, 38];

/** ISO 6346's check digit for a number of the right shape; null otherwise.
 *  The same arithmetic as `ops_dlv.container_check_digit`. */
export function containerCheckDigit(no: string): number | null {
  if (!/^[A-Z]{4}[0-9]{7}$/.test(no)) return null;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = no[i];
    const v = i < 4 ? LETTER[ch.charCodeAt(0) - 65] : Number(ch);
    sum += v * 2 ** i;
  }
  return (sum % 11) % 10;
}

/** The warning a mismatching check digit earns, or null. */
export function checkDigitWarning(no: string): string | null {
  const d = containerCheckDigit(no);
  if (d == null || d === Number(no[10])) return null;
  return `Angka terakhir ${no} tidak cocok dengan rumus ISO (seharusnya ${d}). Cek lagi foto pintu kontainernya.`;
}
