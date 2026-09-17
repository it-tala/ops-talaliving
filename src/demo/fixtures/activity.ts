import type { ActivityEvent, ActivityDaily } from "@/services/identity/contracts";
import type { AuditRow } from "../state";
import { officeDay } from "@/lib/office";

/** What the logs look like when somebody finally opens them (D188).
 *
 *  The audit trail is seeded with the shape that matters rather than with
 *  volume: a few ordinary approvals, one **refusal** — Andi trying to approve
 *  a line he has no authority for — and one **void** carrying the amount
 *  before and after. Those are the three rows anybody ever actually goes
 *  looking for.
 *
 *  The activity log is seeded across the retention boundary on purpose: events
 *  from today and yesterday, recaps going back past the thirty-day line, and
 *  one recap old enough to be due for deletion at six months. A retention rule
 *  nobody can see working is a rule nobody trusts.
 */
const DAY = 86_400_000;
const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
const day = (daysAgo: number) => officeDay(now - daysAgo * DAY);

export const AUDIT_SEED: AuditRow[] = [
  {
    id: "aud_s01", at: iso(2 * 3_600_000),
    actor_id: "usr_evin", actor_email: "evin@talaliving.com",
    service: "procurement", entity: "pr_line", entity_no: "pr-26-09-10_01/3",
    action: "approve", outcome: "ok", reason: null,
    detail: { step: "GOODS", qty: 12, amount: 3_420_000, channel: "meeting" },
  },
  {
    id: "aud_s02", at: iso(3 * 3_600_000),
    actor_id: "usr_andi", actor_email: "andi@talaliving.com",
    service: "procurement", entity: "pr_line", entity_no: "pr-26-09-10_01/3",
    action: "approve", outcome: "refused",
    reason: "tanpa authority approve_goods",
    detail: { required: "approve_goods", acting_as: "andi@talaliving.com" },
  },
  {
    id: "aud_s03", at: iso(26 * 3_600_000),
    actor_id: "usr_putri", actor_email: "putri@talaliving.com",
    service: "accounting", entity: "transaction", entity_no: "trx-26-09-09_004",
    action: "void", outcome: "ok",
    reason: "Salah akun — dicatat di BCA 271, seharusnya JAGO.",
    detail: { before: { amount_idr: 4_150_000, status: "COMPLETED" }, after: { amount_idr: 0, status: "VOID" } },
  },
  {
    id: "aud_s04", at: iso(28 * 3_600_000),
    actor_id: "usr_wulan", actor_email: "wulan@talaliving.com",
    service: "hr", entity: "payroll", entity_no: "pyr-26-09-06_01",
    action: "open", outcome: "ok", reason: null,
    detail: { period: "2026-08-31…2026-09-06", people: 40 },
  },
  /* The read that belongs in this trail rather than in the activity log: HRD
     opening a workshop hand's KTP number for a BPJS registration. Note what
     the detail says and what it does not — whose document and which kind,
     never the number (D196). */
  {
    id: "aud_s10", at: iso(5 * 3_600_000),
    actor_id: "usr_wulan", actor_email: "wulan@talaliving.com",
    service: "hr", entity: "employee_document", entity_no: "B-009",
    action: "reveal", outcome: "ok",
    reason: null,
    detail: { kind: "ktp", employee: "Karjo", by: "wulan@talaliving.com" },
  },
  {
    id: "aud_s11", at: iso(6 * 3_600_000),
    actor_id: "usr_wulan", actor_email: "wulan@talaliving.com",
    service: "hr", entity: "employee_document", entity_no: "B-006",
    action: "reveal", outcome: "ok",
    reason: null,
    detail: { kind: "kartu_keluarga", employee: "Sumiati", by: "wulan@talaliving.com" },
  },
  /* And the one that was stopped: Andi has no HR module, so opening somebody's
     KTP is refused — and the refusal is a row like any other. */
  {
    id: "aud_s12", at: iso(7 * 3_600_000),
    actor_id: "usr_andi", actor_email: "andi@talaliving.com",
    service: "hr", entity: "employee_document", entity_no: "B-009",
    action: "reveal", outcome: "refused",
    reason: "tanpa akses modul hrd",
    detail: { required: "hrd", acting_as: "andi@talaliving.com" },
  },
  {
    id: "aud_s05", at: iso(30 * 3_600_000),
    actor_id: "usr_made", actor_email: "made@talaliving.com",
    service: "inventory", entity: "stock_move", entity_no: "stk-26-09-05_01",
    action: "adjust", outcome: "ok",
    reason: "Opname 5 September: fisik 186, sistem 204.",
    detail: { item: "ITM-0024", qty: -18, location: "GUDANG" },
  },
  {
    id: "aud_s06", at: iso(50 * 3_600_000),
    actor_id: "usr_anggun", actor_email: "anggun@talaliving.com",
    service: "accounting", entity: "transaction", entity_no: "trx-26-09-08_002",
    action: "post", outcome: "duplicate", reason: null,
    detail: { idempotency_key: "post-trx-0908-002", note: "tombol ditekan dua kali" },
  },
];

type E = [hoursAgo: number, actor: string, email: string, kind: string, target: string, label: string];

const EVENTS: E[] = [
  [1, "usr_wulan", "wulan@talaliving.com", "view", "/hrd/payroll/pyr-26-09-06_01", "Payroll — pyr-26-09-06_01"],
  [1.2, "usr_wulan", "wulan@talaliving.com", "print", "/hrd/payroll/pyr-26-09-06_01/payslip", "Cetak slip gaji"],
  [2, "usr_wulan", "wulan@talaliving.com", "view", "/hrd/absensi", "Absensi"],
  [3, "usr_wulan", "wulan@talaliving.com", "view", "/hrd/cuti", "Cuti & izin"],
  [2.5, "usr_putri", "putri@talaliving.com", "view", "/accounting/ledger", "Ledger"],
  [2.7, "usr_putri", "putri@talaliving.com", "export", "/accounting/ledger", "Export ledger CSV"],
  [4, "usr_putri", "putri@talaliving.com", "view", "/accounting/rekening-koran", "Rekening koran"],
  [5, "usr_andi", "andi@talaliving.com", "view", "/procurement/pr", "Permintaan pembelian"],
  [5.4, "usr_andi", "andi@talaliving.com", "view", "/procurement/tracker", "Tracker vendor"],
  [6, "usr_made", "made@talaliving.com", "view", "/inventory/material", "Stok bahan"],
  [6.2, "usr_made", "made@talaliving.com", "view", "/produksi/jadwal", "Papan produksi"],
  [26, "usr_wulan", "wulan@talaliving.com", "view", "/hrd/karyawan", "Karyawan"],
  [27, "usr_evin", "evin@talaliving.com", "view", "/procurement/meeting", "Papan rapat"],
  [27.5, "usr_evin", "evin@talaliving.com", "view", "/dashboard", "Dashboard"],
];

export const ACTIVITY_EVENTS: ActivityEvent[] = EVENTS.map(([h, actor_id, actor_email, kind, target, label], i) => ({
  id: `act_${String(i + 1).padStart(3, "0")}`,
  at: iso(h * 3_600_000),
  actor_id, actor_email, kind, target, label,
}));

type D = [daysAgo: number, actor: string, email: string, name: string, events: number, changes: number, refusals: number, reveals: number, top: [string, number][]];

const DAILIES: D[] = [
  [1, "usr_wulan", "wulan@talaliving.com", "Wulan Sari", 34, 11, 0, 3, [["Absensi", 14], ["Payroll", 9], ["Cuti & izin", 6]]],
  [1, "usr_putri", "putri@talaliving.com", "Putri Handayani", 41, 17, 0, 0, [["Ledger", 19], ["Verifikasi", 12], ["Rekening koran", 5]]],
  [1, "usr_andi", "andi@talaliving.com", "Andi Prasetyo", 22, 6, 2, 0, [["Permintaan pembelian", 12], ["Tracker vendor", 7]]],
  [2, "usr_wulan", "wulan@talaliving.com", "Wulan Sari", 28, 8, 0, 1, [["Absensi", 15], ["Lembur", 7]]],
  [2, "usr_made", "made@talaliving.com", "Made Suparta", 19, 9, 0, 0, [["Stok bahan", 9], ["Papan produksi", 6]]],
  [9, "usr_putri", "putri@talaliving.com", "Putri Handayani", 37, 14, 1, 0, [["Ledger", 18], ["Kalender pembayaran", 9]]],
  /* Just inside six months — the next sweep takes it. */
  [178, "usr_evin", "evin@talaliving.com", "Evin Jonathan", 12, 3, 0, 0, [["Papan rapat", 8]]],
  /* Past six months: due for deletion, and the screen says so. */
  [186, "usr_anggun", "anggun@talaliving.com", "Anggun Lestari", 26, 12, 0, 0, [["Verifikasi", 14], ["Ledger", 8]]],
];

export const ACTIVITY_DAILY: ActivityDaily[] = DAILIES.map(
  ([d, actor_id, actor_email, full_name, events, changes, refusals, reveals, top], i) => ({
    id: `acd_${String(i + 1).padStart(3, "0")}`,
    day: day(d),
    actor_id, actor_email, full_name,
    events,
    first_at: `${day(d)}T08:${String(10 + i).padStart(2, "0")}:00+08:00`,
    last_at: `${day(d)}T17:${String(20 + i).padStart(2, "0")}:00+08:00`,
    top_screens: top.map(([label, count]) => ({ label, count })),
    changes, refusals, reveals,
  }),
);
