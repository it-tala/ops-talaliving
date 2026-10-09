/** What a personnel record may say about how to reach somebody, who to call
 *  in an emergency (D406), and when their paid leave starts (D349).
 *
 *  Owner (HRD evaluation, 2026-09-30): *new employee tambahkan alamat email dan
 *  nomor HP* and *paid leave entitlement, per year — harus dimasukkan oleh HR
 *  setelah 1 tahun.* So:
 *
 *   - **email and phone** are optional (the floor often has no email), and a
 *     value that is there has to be one somebody can actually use. A phone is
 *     kept as its digits, with a leading `+` if given, so *0812-3456 7890* and
 *     *081234567890* are the same number.
 *   - **paid leave** starts at nought. HRD fills it in once the start date is a
 *     year behind; before that the seam refuses a number above nought, and a
 *     person with no start date cannot be judged, so they are refused too.
 *     Lowering it, or leaving it as it was, is never refused — an edit to
 *     somebody's position must not fail over a number nobody touched.
 *
 *  The emergency contact (0251, owner 2026-10-09: *tambahkan kontak darurat*)
 *  is a name and a number together, a relation if known, and never the
 *  person's own number — the day it is needed is the day that phone is not
 *  answering.
 *
 *  `ops_hr.save_employee` (0198, 0251) makes the same refusals with the same codes
 *  (its comments say D348: written before that number went to inventory —
 *  F202)
 *  and sentences; the demo reads them from here (ADR-009). Pure, imports
 *  nothing.
 */

/** A year of service before paid leave, in years. */
export const LEAVE_AFTER_YEARS = 1;

export const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const PHONE_SHAPE = /^\+?[0-9]{8,15}$/;

/** The phone as stored: spaces, dashes, dots and brackets dropped. */
export function normalPhone(raw: string): string {
  return raw.trim().replace(/[\s().-]/g, "");
}

export function normalEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export interface RuleProblem {
  code: string;
  message: string;
  field: string;
}

/** Null when both are blank or usable. Blank means *none*. */
export function contactProblem(email: string | null | undefined, phone: string | null | undefined): RuleProblem | null {
  const e = email == null ? "" : normalEmail(email);
  if (e && !EMAIL_SHAPE.test(e)) {
    return { code: "email_invalid", message: `${email!.trim()} bukan alamat email.`, field: "email" };
  }
  const p = phone == null ? "" : normalPhone(phone);
  if (p && !PHONE_SHAPE.test(p)) {
    return {
      code: "phone_invalid",
      message: `${phone!.trim()} bukan nomor HP — tulis 8 sampai 15 angka, boleh diawali +.`,
      field: "phone",
    };
  }
  return null;
}

/** The emergency contact as stored: blank is none, runs of spaces are one. */
export function normalText(raw: string | null | undefined): string | null {
  return (raw ?? "").trim().replace(/\s+/g, " ") || null;
}

export interface EmergencyContact {
  emergency_name?: string | null;
  emergency_relation?: string | null;
  emergency_phone?: string | null;
}

/** The emergency contact as it will be after a save (D406): **absent keeps
 *  what is stored, blank clears** — the same as email and phone. */
export function emergencyAfter(stored: EmergencyContact | null | undefined, sent: EmergencyContact): {
  name: string | null; relation: string | null; phone: string | null;
} {
  return {
    name: sent.emergency_name === undefined ? stored?.emergency_name ?? null : normalText(sent.emergency_name),
    relation: sent.emergency_relation === undefined ? stored?.emergency_relation ?? null : normalText(sent.emergency_relation),
    phone: sent.emergency_phone === undefined
      ? stored?.emergency_phone ?? null
      : normalPhone(sent.emergency_phone ?? "") || null,
  };
}

/** Null when the contact is usable or there is none (D406). `ownPhone` is the
 *  person's own number as it will be stored. A name and a number together; the
 *  relation cannot stand alone; never the person's own number. */
export function emergencyProblem(
  c: { name: string | null; relation: string | null; phone: string | null },
  ownPhone: string | null | undefined,
  typedPhone?: string | null,
): RuleProblem | null {
  if (c.phone && !PHONE_SHAPE.test(c.phone)) {
    return {
      code: "emergency_phone_invalid",
      message: `${(typedPhone ?? c.phone).trim()} bukan nomor HP — tulis 8 sampai 15 angka, boleh diawali +.`,
      field: "emergency_phone",
    };
  }
  if (c.phone && !c.name) {
    return {
      code: "emergency_name_required",
      message: "Kontak darurat perlu nama — siapa yang dicari saat nomor itu ditelepon.",
      field: "emergency_name",
    };
  }
  if (!c.phone && (c.name || c.relation)) {
    return {
      code: "emergency_phone_required",
      message: "Kontak darurat perlu nomor yang bisa dihubungi.",
      field: "emergency_phone",
    };
  }
  if (c.name && c.name.length > 120) {
    return { code: "emergency_name_too_long", message: "Nama kontak darurat paling panjang 120 huruf.", field: "emergency_name" };
  }
  if (c.relation && c.relation.length > 40) {
    return { code: "emergency_relation_too_long", message: "Hubungan ditulis singkat — paling panjang 40 huruf.", field: "emergency_relation" };
  }
  const own = ownPhone ? normalPhone(ownPhone) : "";
  if (c.phone && own && c.phone === own) {
    return {
      code: "emergency_is_own_phone",
      message: "Nomor darurat sama dengan nomor HP orang ini — saat darurat, justru nomor itu yang tidak menjawab.",
      field: "emergency_phone",
    };
  }
  return null;
}

/** The day a start date is a year behind, the way Postgres adds a year: the
 *  29th of February lands on the 28th. Null for no start date. */
export function leaveFrom(joinedOn: string | null | undefined): string | null {
  if (!joinedOn) return null;
  const [y, m, d] = joinedOn.split("-").map(Number);
  const year = y + LEAVE_AFTER_YEARS;
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const day = Math.min(d, last);
  return `${year}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export type LeaveStanding =
  /** No start date, so nobody can say when the year is up. */
  | { kind: "no_start" }
  /** Not a year yet; entitled from `from`. */
  | { kind: "waiting"; from: string }
  /** A year is up and HRD has not filled it in. */
  | { kind: "due"; from: string }
  | { kind: "set"; days: number };

export function leaveStanding(
  e: { joined_on: string | null | undefined; paid_leave_days: number },
  today: string,
): LeaveStanding {
  if (e.paid_leave_days > 0) return { kind: "set", days: e.paid_leave_days };
  const from = leaveFrom(e.joined_on);
  if (!from) return { kind: "no_start" };
  return from <= today ? { kind: "due", from } : { kind: "waiting", from };
}

/** Whether HRD may write `next` days. `current` is what is stored (null for a
 *  new person); `joinedOn` is the start date as it will be after the save. */
export function leaveProblem(
  joinedOn: string | null | undefined,
  current: number | null,
  next: number | null | undefined,
  today: string,
): RuleProblem | null {
  if (next == null || next <= 0 || next === current) return null;
  const from = leaveFrom(joinedOn);
  if (!from) {
    return {
      code: "leave_needs_start_date",
      message: "Hak cuti dihitung dari tanggal masuk — isi tanggal masuknya dulu.",
      field: "paid_leave_days",
    };
  }
  if (from > today) {
    return {
      code: "leave_before_one_year",
      message: `Hak cuti diisi setelah 1 tahun bekerja — orang ini berhak mulai ${from}.`,
      field: "paid_leave_days",
    };
  }
  return null;
}
