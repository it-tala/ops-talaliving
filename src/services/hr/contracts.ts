/** HR contracts — cut to `docs/plan/02-database.md`, schema `hr`.
 *
 *  A sixth service (D136). It could have been folded into `identity` — both
 *  are about people — but they answer to different rooms: identity says who
 *  may open which screen, HR says what somebody is owed. Payroll is the most
 *  access-controlled data in the company and the most likely to need a
 *  different retention rule, and merging it into the table that holds logins
 *  makes both harder to reason about.
 *
 *  **What is deliberately not here: deductions.** BPJS Kesehatan, BPJS
 *  Ketenagakerjaan and PPh 21 all apply to this business and none of them has
 *  been described to us. Payroll computes **gross** and says plainly that it
 *  stops there (Q30–Q32). A wrong deduction is worse than a missing one: the
 *  missing one is obvious on the payslip, the wrong one is discovered by an
 *  employee who is short.
 */

/** How somebody is paid. Both exist here: staff on a monthly salary, and
 *  workshop people paid for the days they actually worked (owner). */
export type PayBasis = "monthly" | "daily" | "hourly";

export interface Employee {
  id: string;
  /** The number on the biometric machine and on every payslip. */
  employee_no: string;
  full_name: string;
  position: string;
  /** Which part of the business — used to group a payroll run, nothing more. */
  unit: string;
  /** The working pattern this person is on (Q44/Q53, D274, D279).
   *
   *  *Setiap karyawan akan punya jadwal kerja tertaut* — so this is HR's to
   *  set on everybody, not an override for the unusual few. Null still means
   *  *nobody has linked one*, and that is now a **gap HR is asked to close**
   *  rather than a quiet fall-back: the screen counts the unlinked and names
   *  them. What it must never become is an assumption, because a person
   *  assumed onto the office clock is the mistake Q44 was raised about (F70). */
  schedule_code?: string | null;
  pay_basis: PayBasis;
  /** **Pokok only**, per month, per day or per hour, matching `pay_basis`.
   *  Whole rupiah. */
  base_rate: number;
  /** **Tunjangan, per day the person was actually here** — the same unit for
   *  everybody regardless of `pay_basis`, because that is how the owner
   *  described it: *allowance dibayar per hari* (D250).
   *
   *  Zero is the honest default and means exactly what it says: this person's
   *  pay has not been split yet. Nothing about their figures changes while it
   *  is zero, which is the property that let this field be added to a system
   *  already paying people. */
  allowance_rate: number;
  /** Standard hours in a working day. Overtime is what goes past it. */
  daily_hours: number;
  joined_on: string;
  /** Paid leave this person is entitled to in a calendar year, in days.
   *
   *  **Per person, deliberately** (owner, answering Q33): length of service,
   *  what was agreed when they were hired, and whether they are staff or
   *  workshop all move it, so a company-wide constant would be wrong for
   *  almost everybody. Days beyond it are still taken and still recorded —
   *  they are simply not paid, and the timesheet says which is which (D144). */
  paid_leave_days: number;
  active: boolean;
  /** Set when somebody leaves. Their records stay — a payslip from March is
   *  still a fact in June (A5). */
  left_on: string | null;
  note: string | null;
}

/** Where a scan came from. `import` is the machine's own export; `manual` is a
 *  person putting in what the machine missed, which always carries a reason
 *  (D137). */
export type ScanSource = "import" | "manual";

/** One tap on the reader.
 *
 *  This is what the machine actually produces — a person, a moment, and how
 *  they were recognised. **Not** a check-in and a check-out: the export from
 *  the real device is one row per tap, four on an ordinary day and six when
 *  somebody works late, and which tap means *istirahat keluar* is our reading
 *  of it rather than something the machine says (D141).
 */
export interface AttendanceScan {
  id: string;
  employee_id: string;
  /** Office day this tap belongs to, WITA. */
  work_date: string;
  at: string;
  /** `FACE`, `FP`, whatever the device calls it. Carried verbatim. */
  verify: string;
  location: string | null;
  source: ScanSource;
  /** The import that brought it in, so a re-upload is a no-op rather than a
   *  second day. */
  import_id: string | null;
  reason: string | null;
  recorded_by: string | null;
  recorded_at: string;
}

/** The six things a full day is made of, in the order they happen. */
export const SCAN_SLOTS = ["in", "break_out", "break_in", "out", "ot_start", "ot_end"] as const;
export type ScanSlot = (typeof SCAN_SLOTS)[number];

export const SLOT_LABEL: Record<ScanSlot, string> = {
  in: "Masuk",
  break_out: "Istirahat keluar",
  break_in: "Istirahat masuk",
  out: "Pulang",
  ot_start: "Lembur mulai",
  ot_end: "Lembur selesai",
};

/** What HRD says about a day, when the machine alone cannot say it.
 *
 *  These are not corrections to the scans — they are facts about the day that
 *  no reader can know: that it was a public holiday, that the office sent
 *  everybody home at noon, that somebody was ill. A mark never deletes a scan
 *  and a scan never overrides a mark (D142).
 */
export type DayMarkKind =
  | "holiday"     // tanggal merah — being here at all is overtime
  | "half_day"    // acara kantor, kecelakaan, blackout
  | "absent"      // tidak masuk, tanpa keterangan
  | "sick"        // sakit
  | "leave"       // cuti
  | "permit";     // izin

export const DAY_MARK_LABEL: Record<DayMarkKind, string> = {
  holiday: "Tanggal merah",
  half_day: "Setengah hari",
  absent: "Tidak masuk",
  sick: "Sakit",
  leave: "Cuti",
  permit: "Izin",
};

/** The same six, short enough for a cell in a grid forty people wide. */
export const DAY_MARK_SHORT: Record<DayMarkKind, string> = {
  holiday: "merah",
  half_day: "½ hari",
  absent: "absen",
  sick: "sakit",
  leave: "cuti",
  permit: "izin",
};

export interface DayMark {
  id: string;
  /** Null means everybody — a public holiday is not marked person by person. */
  employee_id: string | null;
  work_date: string;
  kind: DayMarkKind;
  reason: string;
  marked_by: string;
  marked_at: string;
}

/** Whether a marked day reaches the payslip, and why.
 *
 *  Answering Q33 (owner): **sakit is paid when the doctor's letter is
 *  behind it**, and **cuti is paid only out of what that person has left** —
 *  every one of them has a different number. Everything else stays unpaid
 *  (D144). The reason travels with the figure because "why is this day worth
 *  nothing" is the question an employee asks, and an app that cannot answer it
 *  makes HRD answer it from memory.
 */
export interface DayPay {
  /** What payroll counts this day as: 1, 0,5 or 0. */
  value: number;
  /** One sentence, in Indonesian, for the person whose day it is. */
  why: string;
  /** Set when the mark could be paid and something is missing — no surat
   *  dokter, no paid leave left. Never a refusal: the day is recorded either
   *  way, and this is what makes the unpaid one visible while it can still be
   *  fixed. */
  fixable: string | null;
}

/** How a day stands once the taps have been read against the six slots.
 *
 *  `review` is the honest state for what the real machine mostly produces: an
 *  odd number of taps, a missing *istirahat masuk*, a double tap eleven
 *  minutes apart. In the export this was built against, **48 of 227 days**
 *  land here, and guessing any of them would be guessing somebody's wages
 *  (D141).
 */
export type DayState = "complete" | "review" | "marked" | "off";

export interface TimesheetDay {
  employee_id: string;
  employee_no: string;
  full_name: string;
  work_date: string;
  /** Every tap, in order. The reading is derived; the taps are the record. */
  scans: { at: string; verify: string; slot: ScanSlot | null; source: ScanSource }[];
  slots: Partial<Record<ScanSlot, string>>;
  state: DayState;
  mark: DayMark | null;
  /** In the building, break subtracted. */
  work_hours: number;
  break_hours: number;
  /** From the lembur pair, or the whole day when it is a public holiday. */
  overtime_hours: number;
  /** 1 for a full day, 0.5 for a half day, 0 for absent — what payroll counts. */
  day_value: number;
  /** Why it is worth that, and what would change it (D144). */
  pay: DayPay;
  /** What a person has to **resolve**, in words. An entry here means the rule
   *  could not describe the day, so it goes to `review` and cannot be paid
   *  until somebody reads it (D141). */
  issues: string[];
  /** What is worth **saying** about a day the rule read perfectly well.
   *
   *  Separate from `issues` because the two do different work, and folding
   *  them together was caught the day the break allowance arrived (D270): a
   *  break that ran five minutes long is a readable day with a note on it, and
   *  putting it in `issues` sent it to review and stopped the day being paid.
   *  *The rule could not fit the taps* and *something here is worth a second
   *  look* are different sentences, and only the first one blocks. */
  notes: string[];
}

/** Overtime arrives as a **sheet**, and there are two kinds of sheet.
 *
 *  This is the owner's own description of the paper that already exists, and
 *  the two are genuinely different documents (D146):
 *
 *  - **Produksi.** One sheet, one night, **many names** — and against each
 *    name the job, the item, how far it got and how many. It is signed by
 *    leadership, because it is a batch of wages and a batch of production
 *    claims at once. It is also the only overtime that needs that signature.
 *  - **Staff.** One sheet **per session**, one person, with their own report
 *    of what they did — usually a screenshot of the work. No leadership
 *    signature: HRD decides whether it is paid, and **the default is yes**,
 *    because the person already stayed and the report is attached.
 *
 *  What the two share is that hours are never inferred from the reader (D138).
 *  What they do not share is who has to sign, and pretending otherwise is how
 *  a designer's Tuesday evening ends up waiting on the Direktur.
 */
export type OvertimeKind = "production" | "staff";

export const OVERTIME_KIND_LABEL: Record<OvertimeKind, string> = {
  production: "Lembur produksi",
  staff: "Lembur staff",
};

export interface OvertimeSheet {
  id: string;
  sheet_no: string;
  kind: OvertimeKind;
  /** The office day the work happened. One sheet covers one night. */
  work_date: string;
  /** Why there was overtime at all — the shift's own heading. */
  purpose: string;
  created_by: string;
  created_at: string;
  /** HRD checked the hours against the taps. Both kinds pass through here. */
  hrd_checked_by: string | null;
  hrd_checked_at: string | null;
  /** Leadership's signature. **Production only** (D146). */
  leader_approved_by: string | null;
  leader_approved_at: string | null;
  /** Staff sheets are paid unless HRD says otherwise — so this ships `true`
   *  and is only ever turned off deliberately, with a reason (D146). Not used
   *  by production sheets, whose payment is the leadership signature. */
  paid: boolean;
  unpaid_reason: string | null;
  declined_by: string | null;
  declined_reason: string | null;
}

/** One person's line on a sheet.
 *
 *  The production fields are why this module now touches `production`: *item
 *  apa, proses sampai mana, berapa*. They are carried as the work order's
 *  public number and a stage code, validated at the seam — never as a foreign
 *  key into another service (ADR-004, D147).
 */
export interface OvertimeLine {
  id: string;
  sheet_id: string;
  employee_id: string;
  hours: number;
  /** What they were doing, in the words on the sheet. */
  task: string;
  /** Production lines: which order, which stage, how many finished. */
  wo_no: string | null;
  stage: string | null;
  qty_done: number | null;
  /** The **GAJI** column of the paper form: what was written against this
   *  person's name and signed for (D154).
   *
   *  When it is there it is what payroll pays, because it is what the sheet
   *  says and what the man signed beside. The computed figure — hours × the
   *  ordinary hourly rate — is still shown next to it, and a difference
   *  between the two is displayed rather than resolved: one of them is wrong
   *  and only a person knows which. */
  form_amount: number | null;
}

/* ------------------------------------------------------------------ */
/* Tasks, and measuring people — the one module that scores a person    */
/* ------------------------------------------------------------------ */

/** Something one person is expected to do, by a date (D260).
 *
 *  The owner asked for a **task tracker and a KPI analyzer**, and the tracker
 *  has to come first, because a KPI over deliverables with no record of what
 *  was asked of anybody is a score over opinions.
 *
 *  `assignee_id` is a **real employee link**, unlike `worked_by` on a
 *  production entry or `assignee` on a design task — both of which are free
 *  text, on purpose, because a subcontractor is a legitimate answer there. That
 *  difference is why production work does **not** feed the score: matching
 *  people by name into a performance record is the kind of cleverness that ends
 *  with the wrong person's review (F81).
 */
export type TaskStatus = "OPEN" | "DONE" | "CANCELLED";

/** What a task is for. A public reference, validated at the seam and never
 *  joined across services (ADR-004). */
export type TaskRefKind = "none" | "work_order" | "project" | "purchase_request";

export interface Task {
  id: string;
  task_no: string;
  title: string;
  detail: string | null;
  /** Who it belongs to. Required — a task with no owner is a note. */
  assignee_id: string;
  assigned_by: string;
  assigned_at: string;
  /** Required. A task that cannot be late is one nobody can tell is late —
   *  the same rule the work order carries (D148). */
  due_date: string;
  ref_kind: TaskRefKind;
  ref_no: string | null;
  status: TaskStatus;
  done_at: string | null;
  done_by: string | null;
  /** Waiting on something outside the person's hands, with what it is waiting
   *  on.
   *
   *  **A blocked task never counts against the assignee**, and that is the
   *  single load-bearing rule of this whole module (D261). A tracker that
   *  punishes people for reporting blockers is a tracker that stops being told
   *  about blockers, and then it measures nothing at all. */
  blocked_reason: string | null;
  blocked_at: string | null;
  cancelled_reason: string | null;
}

export interface TaskView extends Task {
  assignee_name: string;
  assignee_no: string;
  assigned_by_name: string;
  /** Negative once the due date has passed. */
  days_left: number;
  /** Open, past its date, and not blocked. */
  overdue: boolean;
  /** Finished after its due date. */
  late: boolean;
  /** Days between the due date and completion; negative means early. Null
   *  while it is open. */
  days_early: number | null;
}

/** One measure of one person, over one period.
 *
 *  `value` is null when the data to compute it **does not exist** — and that is
 *  not a zero. The office does not use the fingerprint reader, so punctuality
 *  cannot be measured for office staff; scoring them 100% would be a
 *  compliment nobody earned, and scoring them 0% would be a slander (D261).
 */
export interface KpiMeasure {
  key: "punctuality" | "attendance" | "task_delivery";
  label: string;
  /** 0–100, or null where it could not be measured. */
  value: number | null;
  /** Why it could not be measured, in words. */
  unmeasured_reason: string | null;
  /** What the figure is over — *18 dari 20 hari*, so the number can be argued
   *  with rather than only believed. */
  basis: string;
  /** Where it came from, named: a score whose source is not printed is one
   *  nobody can check. */
  source: string;
  weight: number;
}

export interface KpiView {
  employee_id: string;
  employee_no: string;
  full_name: string;
  position: string;
  unit: string;
  period_start: string;
  period_end: string;
  measures: KpiMeasure[];
  /** Weighted mean over the **measured** measures only. Null where too few of
   *  them could be measured — a score over one axis out of three is not a
   *  performance score, it is that one axis wearing a costume (D261). */
  score: number | null;
  measured_count: number;
  measure_count: number;
  score_reason: string | null;
  /** Context, deliberately **not** scored: hours somebody worked late is a
   *  fact about the month, and turning it into a number that goes up when
   *  people stay late is how a business teaches itself the wrong thing. */
  overtime_hours: number;
  tasks_open: number;
  tasks_blocked: number;
  /** What this person actually **made** in the period, over the production
   *  entries somebody has linked to them (D264). Null where none are — which
   *  is *not attributed*, never zero.
   *
   *  Deliberately **not scored**, and for a different reason from the one that
   *  kept it out before. The old reason was that production work was recorded
   *  against a name and matching names is how the wrong review lands on the
   *  wrong person; W5 fixes that. The reason it stays unscored is arithmetic:
   *  **a piece is not a unit.** Eight nakas and four wardrobes do not add up,
   *  and dividing them by anything produces a number that looks like a
   *  performance figure and is not one. So it is shown as evidence — the
   *  *deliverable* half of what the owner asked for — beside the scores, and
   *  the card says why it is not in them. */
  work: {
    entries: number;
    qty: number;
    by_stage: { stage: string; name: string; qty: number }[];
    work_orders: { wo_no: string; product_name: string; qty: number }[];
    first: string;
    last: string;
  } | null;
  /** How much of the period's reported work can be read as **anybody's**.
   *
   *  Coverage is a property of the record, not of the person, and it is what
   *  makes the blank above legible: with 90% of entries resolved, no work
   *  against a name means that person reported none; with 40%, it means
   *  nothing at all. Without this figure the empty card is a silent accusation
   *  (D264). */
  work_attribution: {
    employee: number;
    not_a_person: number;
    unknown: number;
    /** 0–100. */
    coverage: number;
  };
  /** Said plainly under the score, including what it could not see. */
  notes: string[];
}

/* ------------------------------------------------------------------ */
/* Statutory contributions: who is enrolled, at what rate               */
/* ------------------------------------------------------------------ */

/** The schemes this business is in.
 *
 *  Q30 asked *which statutory deductions apply, and at what rate*. The owner's
 *  answer redefined the question, and redefined it better: **HRD enters who is
 *  enrolled, accounting audits it** — because the rates are public and the roll
 *  of names is not, and the leak he described is people who have left still
 *  being paid for (D259).
 *
 *  `PPH21` is here as an **enrolment only**. Recorded — who has an NPWP, which
 *  PTKP bracket — and **not computed**: PPh 21 is progressive over TER tables
 *  nobody has given us, and D140's rule holds exactly as it did. A missing
 *  deduction is obvious on a payslip; a wrong one is discovered by an employee
 *  who is short.
 */
export type ContributionScheme =
  | "BPJS_KESEHATAN"
  | "JHT"
  | "JP"
  | "JKK"
  | "JKM"
  | "PPH21";

export const SCHEME_LABEL: Record<ContributionScheme, string> = {
  BPJS_KESEHATAN: "BPJS Kesehatan",
  JHT: "BPJS TK — Jaminan Hari Tua",
  JP: "BPJS TK — Jaminan Pensiun",
  JKK: "BPJS TK — Jaminan Kecelakaan Kerja",
  JKM: "BPJS TK — Jaminan Kematian",
  PPH21: "PPh 21",
};

/** Schemes whose contribution this system will compute. `PPH21` is not one of
 *  them, and the screens say so rather than showing a blank column. */
export const COMPUTED_SCHEMES: ContributionScheme[] = [
  "BPJS_KESEHATAN", "JHT", "JP", "JKK", "JKM",
];

/** One dated version of a scheme's rate.
 *
 *  Dated for the same reason the pay rules are (D173): a contribution
 *  recomputed for March must use March's percentage. The percentages are
 *  public; the **risk class behind JKK is not** — it is set per employer by
 *  BPJS between 0,24% and 1,74%, and the seed carries a class-II figure marked
 *  as needing confirmation rather than a number presented as fact (Q49).
 */
export interface ContributionRate {
  id: string;
  scheme: ContributionScheme;
  effective_from: string;
  /** Percent of the base. The employer's share is a company cost; the
   *  employee's is a deduction on the payslip. Kept apart because they are two
   *  different facts, and the invoice is the sum of both. */
  employer_percent: number;
  employee_percent: number;
  /** Upper limit on the base, where the regulation sets one. Null means none.
   *  BPJS resets these annually, so the screen says when it was last set. */
  wage_ceiling: number | null;
  note: string;
  /** Set where the figure is the published national one, false where it is a
   *  stand-in this system chose and somebody has to confirm. The screen shows
   *  the difference — a rate nobody has checked must not look like one that
   *  has been. */
  confirmed: boolean;
  created_by: string;
  created_at: string;
}

/** One person, in one scheme, from one date.
 *
 *  **HRD's to enter** (owner). Append-only like everything else that records
 *  something that happened: ending an enrolment sets `ended_on`, it does not
 *  delete the row, because *was he covered in March* is the question this
 *  exists to answer (A5).
 */
export interface Enrolment {
  id: string;
  employee_id: string;
  scheme: ContributionScheme;
  /** The number on the card. Sensitive like the 201 documents, so it is
   *  **masked on read** and revealing it is logged (D196). */
  member_no: string | null;
  enrolled_on: string;
  ended_on: string | null;
  ended_reason: string | null;
  /** The wage the contribution is computed on, where it differs from what the
   *  person is actually paid.
   *
   *  It differs more often than not, and that is the point of the field rather
   *  than an edge case: BPJS is registered against a **declared** wage, and the
   *  gap between the declared wage and the real one is a thing the business
   *  should be able to see rather than discover. Null means *use the pay
   *  record* — pokok + tunjangan (D250). */
  declared_base: number | null;
  note: string | null;
  by: string;
  at: string;
}

/** What one person costs one scheme in one month. Computed on read (A3). */
export interface ContributionLine {
  employee_id: string;
  employee_no: string;
  full_name: string;
  scheme: ContributionScheme;
  /** Masked. The full number needs an explicit reveal, which is logged. */
  member_no_masked: string | null;
  /** What the contribution was computed on, and whether a ceiling cut it. */
  base: number;
  base_source: "declared" | "pay_record";
  capped_from: number | null;
  employer: number;
  employee: number;
  total: number;
  /** Enrolled part-way through the month, or ended part-way through it. The
   *  contribution is **not** pro-rated — BPJS charges the month — and the line
   *  says so rather than quietly showing a full month as though the person had
   *  been there for all of it. */
  partial_month: string | null;
}

/** One scheme, one month: the roll of names, and what it should come to. */
export interface ContributionRoll {
  scheme: ContributionScheme;
  month: string;
  /** Null when no rate version covers this month — and null is not zero. The
   *  screen says the rate is missing rather than showing an invoice of nil. */
  rate: ContributionRate | null;
  lines: ContributionLine[];
  headcount: number;
  employer_total: number;
  employee_total: number;
  /** What the invoice should say: employer + employee. */
  expected_total: number;
  /** Last month's figure and the names behind the change — the audit the owner
   *  actually described: *bandingkan dengan transaksi sebelumnya* (D259). */
  last_month_total: number | null;
  joined: string[];
  left: string[];
}

/** One **invoice**, audited: the schemes it pays, what the roll of names says
 *  they should come to, and what actually left.
 *
 *  Grouped by the cash line rather than by scheme, because one BPJS
 *  Ketenagakerjaan invoice covers JHT, JP, JKK and JKM at once. Auditing per
 *  scheme made the other three read *no cash line tied to this* while their
 *  money was going out on the line beside them — four red rows describing one
 *  healthy payment (D259).
 */
export interface ContributionAuditGroup {
  /** Null for schemes with nobody's invoice behind them yet. */
  component_id: string | null;
  component_name: string | null;
  schemes: ContributionScheme[];
  expected: number | null;
  planned: number | null;
  paid: number;
  difference: number | null;
  unusual: boolean;
  /** Distinct people across the schemes on this invoice — a person in JHT and
   *  JP is one person, not two. */
  headcount: number;
  trx_nos: string[];
  verdict: string;
}

/** Something added to or taken off a payslip by a person, with a reason.
 *
 *  Distinct from the statutory deductions this system still refuses to invent
 *  (D140): BPJS and PPh 21 are rules nobody has given us, while these are the
 *  company's own decisions about one person and one period — a late arrival, a
 *  written warning, money left over from the last run. Each one is typed by
 *  somebody, carries a sentence, and appears on the payslip in words (D155).
 */
export type AdjustmentKind = "late" | "sp" | "carry_over" | "advance" | "bonus" | "other";

export const ADJUSTMENT_LABEL: Record<AdjustmentKind, string> = {
  late: "Keterlambatan",
  sp: "Surat peringatan",
  carry_over: "Selisih periode lalu",
  advance: "Kasbon / potongan pinjaman",
  bonus: "Tambahan",
  other: "Lain-lain",
};

export interface PayrollAdjustment {
  id: string;
  /** The run it belongs to. An adjustment is always about one period. */
  run_no: string;
  employee_id: string;
  kind: AdjustmentKind;
  /** **Signed.** Negative takes money off, positive adds it — including a
   *  carry-over, which goes either way depending on who owes whom. */
  amount: number;
  reason: string;
  created_by: string;
  created_at: string;
}

export interface PayrollAdjustmentView extends PayrollAdjustment {
  employee_no: string;
  full_name: string;
}

/** Where a sheet has got to. Derived from the signatures and the attached
 *  paper, never stored beside them (A3). */
export type OvertimeStage =
  | "waiting_hrd"      // nobody has checked the hours yet
  | "waiting_surat"    // production: the signed sheet is not attached
  | "waiting_leader"   // production: the letter is there, leadership has not signed
  | "approved"         // production: both signatures — it reaches a payslip
  | "paid_default"     // staff: paid because nobody said otherwise
  | "paid_checked"     // staff: HRD looked and said yes
  | "unpaid"           // staff: HRD looked and said no, with a reason
  | "declined";

export const OVERTIME_STAGE_LABEL: Record<OvertimeStage, string> = {
  waiting_hrd: "Menunggu HRD",
  waiting_surat: "Menunggu surat lembur",
  waiting_leader: "Menunggu pimpinan",
  approved: "Disetujui pimpinan",
  paid_default: "Dibayar — belum ditinjau",
  paid_checked: "Dibayar — ditinjau HRD",
  unpaid: "Tidak dibayar",
  declined: "Ditolak",
};

export interface OvertimeLineView extends OvertimeLine {
  employee_no: string;
  full_name: string;
}

export interface OvertimeSheetView extends OvertimeSheet {
  lines: OvertimeLineView[];
  stage: OvertimeStage;
  /** True when the hours on this sheet reach a payslip as they stand. */
  payable: boolean;
  total_hours: number;
  /** The signed sheet (production) or the work report (staff). */
  evidence: { attachment_id: string; filename: string; kind: string } | null;
}

export type PayrollStatus = "DRAFT" | "APPROVED" | "PAID";

export interface PayrollRun {
  id: string;
  run_no: string;
  /** Inclusive, `YYYY-MM-DD`. Weekly for the workshop, monthly for staff —
   *  the period is on the run, not assumed by the code. */
  period_start: string;
  period_end: string;
  status: PayrollStatus;
  created_at: string;
  created_by: string;
  approved_at: string | null;
  approved_by: string | null;
  /** The ledger row that paid it, once it has been paid. */
  paid_trx_no: string | null;
  note: string | null;
}

/* ── Berkas 201: somebody's own file ──────────────────────────────────────
 *
 *  The dossier every Indonesian HR department keeps: KTP, kartu keluarga,
 *  ijazah, the signed contract, NPWP, BPJS, a photograph. Today it is a folder
 *  on a laptop and a drawer in the office, and the only way to find out whether
 *  somebody's contract has expired is to open both (D177).
 *
 *  Two things make this worth building rather than a shared drive:
 *
 *  - **The system can say what is missing.** A checklist with `required` on it
 *    turns "Karjo's file" from a folder into a question with an answer — the
 *    same move as a product's gambar kerja (D150).
 *  - **Documents expire.** A PKWT contract, a BPJS card, a safety certificate:
 *    each has a date after which it is no longer true, and nobody notices a
 *    date inside a scan. A file that knows its own expiry can be asked.
 */
export type EmployeeDocKind =
  | "ktp" | "kartu_keluarga" | "ijazah" | "cv" | "kontrak_kerja"
  | "npwp" | "bpjs_kesehatan" | "bpjs_tk" | "foto" | "sertifikat" | "sp" | "lainnya";

export const EMPLOYEE_DOC_LABEL: Record<EmployeeDocKind, string> = {
  ktp: "KTP",
  kartu_keluarga: "Kartu Keluarga",
  ijazah: "Ijazah",
  cv: "CV / riwayat kerja",
  kontrak_kerja: "Kontrak kerja",
  npwp: "NPWP",
  bpjs_kesehatan: "BPJS Kesehatan",
  bpjs_tk: "BPJS Ketenagakerjaan",
  foto: "Pas foto",
  sertifikat: "Sertifikat / pelatihan",
  sp: "Surat peringatan",
  lainnya: "Lain-lain",
};

/** What a complete file is. `required` is the list HRD is asked about; the rest
 *  are kept when they exist and never nagged for. */
export const EMPLOYEE_DOC_CHECKLIST: { kind: EmployeeDocKind; required: boolean; note: string }[] = [
  { kind: "ktp", required: true, note: "Identitas dasar — dipakai di kontrak dan BPJS." },
  { kind: "kartu_keluarga", required: true, note: "Untuk BPJS Kesehatan dan tunjangan." },
  { kind: "kontrak_kerja", required: true, note: "Yang ditandatangani. PKWT punya tanggal berakhir." },
  { kind: "foto", required: true, note: "Untuk ID dan berkas." },
  { kind: "ijazah", required: false, note: "Kalau posisinya mensyaratkan." },
  { kind: "cv", required: false, note: "" },
  { kind: "npwp", required: false, note: "Kalau punya." },
  { kind: "bpjs_kesehatan", required: false, note: "Nomor kepesertaan." },
  { kind: "bpjs_tk", required: false, note: "Nomor kepesertaan." },
  { kind: "sertifikat", required: false, note: "K3, las, forklift — yang ada masa berlakunya." },
  { kind: "sp", required: false, note: "Surat peringatan yang pernah diterbitkan." },
];

/** The kinds whose number is an **identity number**, and the only ones masked.
 *
 *  A contract number, a certificate number and an ijazah number identify a
 *  document. A NIK, a KK number, an NPWP and a BPJS membership number identify
 *  a **person**, and are enough on their own to open an account somewhere in
 *  their name. Masking the first group too would be ritual, and a screen full
 *  of rituals stops being read — which is how the masking on the second group
 *  would come to be clicked through without thinking.
 */
export const SENSITIVE_DOC_KINDS = new Set<EmployeeDocKind>([
  "ktp", "kartu_keluarga", "npwp", "bpjs_kesehatan", "bpjs_tk",
]);

/** How many digits the number should have, where the format is fixed. Used to
 *  say *this reading is wrong* without showing a single digit of it — a
 *  fifteen-digit NIK is a failed extraction, and that is a fact about the
 *  machine, not about the person. Null where the format is not fixed. */
export const DOC_NO_DIGITS: Partial<Record<EmployeeDocKind, number>> = {
  ktp: 16,
  kartu_keluarga: 16,
  npwp: 15,
  bpjs_kesehatan: 13,
  bpjs_tk: 11,
};

/** Where the number came from. The document goes to Drive and the number is
 *  read out of it (owner) — so the number has a provenance, and a number
 *  nobody has read yet is **absent**, never guessed. */
export type DocNoSource =
  /** Read out of the scan. */
  | "extracted"
  /** Somebody typed it. */
  | "typed"
  /** The scan is filed and the number has not been read from it yet. */
  | "pending";

export const DOC_NO_SOURCE_LABEL: Record<DocNoSource, string> = {
  extracted: "terbaca dari berkas",
  typed: "diketik",
  pending: "menunggu dibaca",
};

/** Every character of a number, replaced — separators kept so the shape and
 *  the **length** survive. Length is the one thing worth showing: it says
 *  whether the reading is plausible without saying what it is.
 *
 *  The alternative offered was a visible prefix (`332006***********`). It is
 *  rejected: the first six digits of a NIK are province, city and district, so
 *  a prefix tells the room where every employee is from — and it buys nothing,
 *  because there is one KTP per person and the row already says whose it is.
 *  Nothing on this screen needs the digits to tell two rows apart (D195).
 */
export function maskDocNo(docNo: string): string {
  return docNo.replace(/[0-9A-Za-z]/g, "•");
}

export interface EmployeeDocument {
  id: string;
  employee_id: string;
  kind: EmployeeDocKind;
  /** The file itself, on the same road as every other document (ADR-010). A
   *  document with a number but no scan is still a record — the number is
   *  often what somebody actually needs. */
  attachment_id: string | null;
  /** KTP number, contract number, BPJS membership number.
   *
   *  **Never sent to a screen for a kind in `SENSITIVE_DOC_KINDS`.** The list
   *  carries `doc_no_masked` and the real number comes back only from
   *  `revealEmployeeDocNo`, which writes an audit row. If the view carried the
   *  number and the screen merely hid it, the reveal log would be theatre —
   *  the number would already be in the browser (D196). */
  doc_no: string | null;
  doc_no_source: DocNoSource | null;
  issued_on: string | null;
  /** After this it is no longer true. Null where it never expires. */
  expires_on: string | null;
  note: string | null;
  recorded_by: string;
  recorded_at: string;
}

/** What a screen is allowed to see. The sensitive number is **not here** —
 *  only its mask, its length, and whether that length is what the kind wants. */
export interface EmployeeDocumentView extends Omit<EmployeeDocument, "doc_no"> {
  /** The plain number, for kinds that are not identity numbers. Null for the
   *  sensitive ones — those come back only from a reveal. */
  doc_no: string | null;
  sensitive: boolean;
  /** `••••••••••••••••`, or null where there is no number at all. */
  doc_no_masked: string | null;
  doc_no_length: number | null;
  /** False when the length is not what this kind should have — a reading to
   *  check, said without showing a digit. Null where the kind has no fixed
   *  format, or there is no number. */
  doc_no_length_ok: boolean | null;
}

export interface EmployeeDocSlot {
  kind: EmployeeDocKind;
  label: string;
  required: boolean;
  note: string;
  documents: EmployeeDocumentView[];
  /** Days until the soonest expiry, negative when it has already passed. Null
   *  when nothing in this slot expires. */
  expires_in_days: number | null;
}

export interface EmployeeFileView {
  employee_id: string;
  employee_no: string;
  full_name: string;
  position: string;
  unit: string;
  joined_on: string;
  active: boolean;
  slots: EmployeeDocSlot[];
  /** Required kinds with nothing filed. The question this screen exists to
   *  answer. */
  missing: EmployeeDocKind[];
  /** Anything already expired, or expiring inside 60 days. */
  expiring: { kind: EmployeeDocKind; label: string; expires_on: string; days: number }[];
  complete: boolean;
}

/* ── Cuti & izin ──────────────────────────────────────────────────────────
 *
 *  A day off has two halves and until now this system only had the second: the
 *  **mark** on the timesheet saying what happened (D142). What was missing is
 *  the half that happens first — somebody asks, somebody decides — and with it
 *  the only number an employee actually wants: how many days they have left
 *  (D178).
 *
 *  Approving a request is what writes the mark. There is no second road: a mark
 *  typed straight onto the timesheet is still allowed (things happen at six in
 *  the morning), and it simply has no request behind it, which the screen says.
 */
export type LeaveKind = "cuti" | "izin" | "sakit";

export const LEAVE_KIND_LABEL: Record<LeaveKind, string> = {
  cuti: "Cuti",
  izin: "Izin",
  sakit: "Sakit",
};

export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export interface LeaveRequest {
  id: string;
  request_no: string;
  employee_id: string;
  kind: LeaveKind;
  from_date: string;
  to_date: string;
  /** Calendar days in the range. Half days are not modelled: a half day is a
   *  timesheet mark, not a request (D142). */
  days: number;
  reason: string;
  status: LeaveStatus;
  requested_by: string;
  requested_at: string;
  decided_by: string | null;
  decided_at: string | null;
  /** Required on a rejection. A refusal an employee cannot read is one they
   *  cannot argue with (A7). */
  decision_note: string | null;
}

export interface LeaveRequestView extends LeaveRequest {
  employee_no: string;
  full_name: string;
  decided_by_name: string | null;
  /** How the days would be paid if this were approved today — the balance is
   *  read at decision time, and a request that would run past the entitlement
   *  says so **before** the decision, not on the payslip (D178). */
  paid_days: number;
  unpaid_days: number;
  /** Set when the person already has a mark on one of these days. */
  clashes: string[];
}

/** What somebody has left. Computed from the marks, never stored — the same
 *  rule as everything else that can be derived (A3). */
export interface LeaveBalance {
  employee_id: string;
  employee_no: string;
  full_name: string;
  /** Per person, deliberately (D144). */
  entitlement: number;
  taken: number;
  /** Approved requests in the future that have not become marks yet. */
  booked: number;
  remaining: number;
  /** Days recorded as cuti beyond the entitlement — taken and not paid. */
  over: number;
  sick_days: number;
  sick_without_letter: number;
  permit_days: number;
}

/* ── Pay rules: the policy, as data ───────────────────────────────────────
 *
 *  Four situations exist in this workshop and every one of them is a **policy
 *  that changes without the software changing** (D168): a day's wage, an
 *  hour's wage, what an overtime hour multiplies by, and what a short day
 *  costs. Hard-coding any of them means a policy change arrives as a
 *  deployment — and, worse, that nobody can see what the rule *is* without
 *  reading TypeScript.
 *
 *  So the rules are rows, they are **dated**, and they are never edited:
 *  changing one writes a new version from a date forward. A payslip from March
 *  must be recomputable under March's rule, which is not possible if today's
 *  edit reached backwards.
 */

/** How an overtime hour is priced. */
export type OvertimeMode =
  /** The national formula: the first hour at 1,5×, the rest at 2×, and a rest
   *  day on its own ladder (Kepmenaker 102/2004). What this business uses
   *  (owner, answering Q31). */
  | "statutory"
  /** One multiplier for every hour, whatever the day. Some workshops pay this
   *  way; it stays available because switching should be a setting, not a
   *  rewrite. */
  | "flat"
  /** Pay only what the paper form says, and nothing where it says nothing
   *  (D154). */
  | "form_only";

/** A step in the ladder: from `after_hours` onward, each hour multiplies by
 *  this. `{after_hours: 0, multiplier: 1.5}` then `{after_hours: 1,
 *  multiplier: 2}` is the ordinary Indonesian working day. */
export interface OvertimeTier {
  after_hours: number;
  multiplier: number;
}

/** What a short day costs. */
export type UndertimeMode =
  /** Nothing is deducted automatically. The default, because what a short day
   *  costs here has not been stated, and a deduction invented by software
   *  reaches somebody's pocket (D174). */
  | "off"
  /** Every hour short, at the ordinary hourly rate. */
  | "pro_rata"
  /** Short by more than half a day costs half a day; less costs nothing. */
  | "half_day_step";

/** What lateness costs.
 *
 *  The owner stated the rule at last (Q41, D251): past the grace period the
 *  deduction is **hours, at the hourly rate** — *potongannya jam saja*. It
 *  still ships `manual`, for D174's reason rather than for want of a rule: a
 *  deduction that starts appearing on payslips because software was updated is
 *  one nobody agreed to. The rule-book screen prices `pro_rata` against a real
 *  week first, per person, and somebody turns it on having seen it. */
export type LateMode = "manual" | "pro_rata";

/** Which divisor turns a wage into an hour of it. */
export type HourlyBasis =
  /** The owner's own arithmetic (D249): a year of pay ÷ the days this business
   *  actually works ÷ the hours in its day. */
  | "company"
  /** The Kepmenaker figure, 1/173 of a month. Correct for the statutory
   *  overtime ladder and **not** an answer to *what is an hour worth here*,
   *  because this office does not work a 40-hour week. */
  | "statutory";

/** HRD deciding that one person does not get one day's tunjangan, and saying
 *  why (D250).
 *
 *  Its own record rather than a flag on the day mark, because the owner asked
 *  for it that way and the reason is sound: a day mark says **what the day
 *  was** — sakit, cuti, setengah hari, tanggal merah — and this says what
 *  somebody **decided about the money**. WFH is the case that proves it: the
 *  day was worked, the timesheet is right, nothing about it is exceptional,
 *  and the allowance is still not paid because the allowance is for coming in.
 *  Folding that into the mark would make the timesheet lie about the day in
 *  order to get the pay right.
 *
 *  Append-only, like everything else here: restoring writes `restored_by`
 *  rather than deleting the row, so *why was this not paid* stays answerable
 *  after somebody changes their mind (A5).
 */
export interface AllowanceWithholding {
  id: string;
  employee_id: string;
  work_date: string;
  /** Required. A deduction with no sentence beside it is one nobody can argue
   *  with three months later (D155). */
  reason: string;
  by: string;
  at: string;
  restored_by: string | null;
  restored_at: string | null;
  restored_reason: string | null;
}

export interface AllowanceWithholdingView extends AllowanceWithholding {
  employee_no: string;
  full_name: string;
  by_name: string;
  restored_by_name: string | null;
  /** What this one day of tunjangan was worth when it was withheld. Computed
   *  on read from the person's current rate, and labelled as such — it is
   *  context for the decision, not a stored amount. */
  amount: number;
}

/** The rule book, as it stands on one date. */
/** One working pattern (Q44, D274).
 *
 *  Five of them in this business and no two alike, which is why this is a row
 *  rather than a pair of numbers. What matters about the shape:
 *
 *  - **`start_minutes` is nullable.** The guard works twelve hours and nobody
 *    has said from when. A schedule with no start cannot measure lateness, and
 *    that reads as *tidak terukur* with the reason — never as *never late*,
 *    which is the error Q44 was raised about in the first place (F70).
 *  - **`end_minutes` is nullable** for the same reason and separately: 07.30
 *    to 16.30 is nine hours with 45 minutes out of it; 08.00 to 17.15 is nine
 *    and a quarter with an hour. Those are the same working day by different
 *    arithmetic, and neither can be derived from the other.
 *  - **Friday has its own break**, because it does here — a longer midday
 *    break, the same for everybody who has one. Null means Friday is like any
 *    other day for this schedule, which is a different fact from *nobody has
 *    said*, and the seed distinguishes them.
 */
export interface WorkSchedule {
  code: string;
  name: string;
  /** Minutes from midnight. Null where nobody has stated it. */
  start_minutes: number | null;
  end_minutes: number | null;
  break_minutes: number | null;
  /** Friday's break where it differs. Null = no separate Friday rule stated. */
  friday_break_minutes: number | null;
  /** What is known about it that the numbers do not say — a twelve-hour shift
   *  that may or may not rotate, an end time nobody has fixed. */
  note: string | null;
}

/** A schedule with its week and month worked out (Q53, D279).
 *
 *  HR asked to see total hours per week and per month, and both are
 *  **derived** — the schedule holds times, not totals, because two stored
 *  numbers that must agree is how bruto and diterima drifted apart (F73).
 *
 *  Everything here is null the moment the schedule is missing a piece: a
 *  pattern with no end time has no daily hours, and a pattern with no daily
 *  hours has no week. Null propagates instead of being papered over with a
 *  zero, because *belum ditetapkan* and *tidak bekerja* are different answers
 *  and only one of them is somebody's to fix.
 */
export interface ScheduleHours {
  /** Working hours in one ordinary day: end − start − break. */
  daily_hours: number | null;
  /** Friday, where its break differs. Null when no separate Friday rule. */
  friday_hours: number | null;
  /** Working days a week, from the rule book's `week_pattern`. */
  days_per_week: number;
  /** The week, Friday counted at its own length where it has one. */
  weekly_hours: number | null;
  /** `weekly_hours × 52 ÷ 12`, and the arithmetic is printed beside it. */
  monthly_hours: number | null;
  /** What is stopping the figures, in words, where they are null. */
  blocked_by: string | null;
}

export interface PayRules {
  overtime_mode: OvertimeMode;
  /** Ordinary working day. */
  workday_tiers: OvertimeTier[];
  /** Weekly rest day and tanggal merah — a different, steeper ladder. */
  restday_tiers: OvertimeTier[];
  /** Used when `overtime_mode` is `flat`. */
  flat_multiplier: number;
  /** A monthly salary divided by this is an hour of it. 173 is the figure the
   *  regulation uses (40 hours × 52 weeks ÷ 12). Used only when `hourly_basis`
   *  is `statutory`; kept regardless, because it is what the overtime ladder
   *  is written against and the two figures are worth seeing side by side. */
  monthly_divisor: number;
  /** Which of the two the payslip actually uses (D249). */
  hourly_basis: HourlyBasis;
  /** Days this business actually works in a year — the denominator in the
   *  owner's own formula, and a number nobody can derive for somebody else.
   *  Six days a week is 312 before a single national holiday comes off it, and
   *  what comes off it here is this company's own calendar. */
  effective_days_per_year: number;
  /** The same figure per month, and **derived, never stored** (Q45, D271):
   *  `effective_days_per_year / 12`. The owner asked for the monthly average
   *  because that is the number a person checks a payslip against, and two
   *  stored figures that must agree are how F73 happened. It is computed
   *  wherever it is shown. */
  /** Whether the tunjangan counts towards an hour of somebody's time.
   *
   *  **True**, on the owner's instruction: *pakai pokok+allowance untuk
   *  perhitungan semua*. The flag exists because of the sentence that followed
   *  it — the business may one day price overtime off pokok alone — and the
   *  owner was explicit that this is **a note, not a decision** (D250). So it
   *  is a switch that is on, with the note beside it, rather than a second
   *  scheme half-built against a change nobody has made. */
  hourly_includes_allowance: boolean;
  /** Which days count as the weekly rest day: `6day` means Sunday only,
   *  `5day` means Saturday and Sunday. */
  week_pattern: "6day" | "5day";
  /** Overtime is rounded to this many minutes before it is priced. 0 is exact
   *  — a figure the machine produced, not one somebody negotiated. */
  overtime_rounding_minutes: number;
  undertime_mode: UndertimeMode;
  /** Minutes short before undertime counts at all. */
  undertime_grace_minutes: number;
  /** When the office day starts, in minutes from midnight. 480 is 08:00.
   *
   *  This and the grace period below were **one field** until D251, called
   *  `late_after_minutes` and holding 480 — which read as *late after 480
   *  minutes* and meant *late after 08:00*. One number answering two questions
   *  again (F62), and the one it was not answering is the one the owner
   *  actually set: fifteen minutes. */
  day_starts_minutes: number;
  /** The working patterns this business actually runs (Q44, D274).
   *
   *  It was `day_start_by_unit` — a start time per unit — for one day, and the
   *  owner's fuller answer broke it: there is not a start time per unit, there
   *  are **shifts**, and they differ in more than when they begin. Production
   *  is 07.30–16.30 with 45 minutes of break; the office 08.00–17.15 with an
   *  hour; **Friday is a longer break for everybody**; the guard works a
   *  twelve-hour shift; the house assistant starts at two in the afternoon. A
   *  map of numbers cannot hold any of that.
   *
   *  Kept in the rule book rather than on the employee for the reason every
   *  rule here is: it is versioned by date (D173), so changing the workshop's
   *  hours next March must not rewrite what last March was measured against.
   *  Which schedule a person is on **is** on the employee, because that is a
   *  fact about the person and it changes when they move jobs. */
  schedules: WorkSchedule[];
  /** The schedule a unit is on when nobody has said otherwise. An employee's
   *  own `schedule_code` wins over this, and this wins over nothing at all —
   *  a unit with no schedule falls back to `day_starts_minutes` and says so. */
  schedule_by_unit: Record<string, string>;
  /** Minutes after the start of the day before lateness counts at all. The
   *  owner's figure is 15 (Q41, D251) and it is a rule rather than a constant
   *  precisely because he said *atau bisa di custom*. */
  late_grace_minutes: number;
  /** `manual` means the minutes are shown and the rupiah is typed by a person
   *  with a reason (D155). `pro_rata` prices them by the hour (D251). */
  late_mode: LateMode;
  /** Whether being late also costs the day's tunjangan.
   *
   *  **False**, and this one is a correction the owner made to himself. The
   *  first answer was that the allowance is lost when somebody is more than
   *  fifteen minutes late; the second was sharper — *potongannya jam saja,
   *  allowance masih diberikan jika hadir*. Being late costs hours. Losing the
   *  allowance is a **separate decision, made by HRD, with its own reason**
   *  (D250), not a second penalty riding on the same event. */
  late_forfeits_allowance: boolean;
}

/** One dated version of the rule book. Never edited — a change writes the next
 *  one, and the old one keeps its payslips honest (D173). */
export interface PayRuleSet {
  id: string;
  version: number;
  /** Inclusive. The version in force for a period is the latest one whose date
   *  is on or before the period's **start**: a rule that changed mid-week does
   *  not split a payslip in two. */
  effective_from: string;
  note: string;
  rules: PayRules;
  created_by: string;
  created_at: string;
}

export interface PayRuleSetView extends PayRuleSet {
  created_by_name: string;
  /** True for the version a payroll run today would use. */
  is_current: boolean;
}

/** One line of the overtime sum, so a payslip can show the ladder instead of
 *  a total nobody can take apart (D144, D173). */
export interface OvertimePart {
  /** `lbr-26-09-02_01`, or `form` where the paper carried its own figure. */
  source: string;
  work_date: string;
  hours: number;
  multiplier: number;
  /** What an ordinary hour of this person's time is worth. */
  hourly: number;
  amount: number;
  /** `Hari kerja · jam ke-1`, `Hari libur · jam 1–7`, `Sesuai form`. */
  label: string;
}

export interface PayrollLine {
  employee_id: string;
  employee_no: string;
  full_name: string;
  position: string;
  pay_basis: PayBasis;
  base_rate: number;
  /** Per day here, whatever the basis of the pokok is (D250). */
  allowance_rate: number;
  /** Days present, and of those, how many are still open. */
  days_worked: number;
  days_open: number;
  /** The paid days that were not worked, kept apart so a payslip can say what
   *  it is paying for: sakit with a letter, cuti out of the balance (D144). */
  days_present: number;
  days_sick_paid: number;
  days_leave_paid: number;
  /** Recorded, and not paid — the line an employee will ask about. */
  days_unpaid: number;
  normal_hours: number;
  /** Approved only — claimed-but-unapproved hours are listed apart. */
  overtime_hours: number;
  overtime_pending_hours: number;
  /** **Pokok only.** The allowance is its own figure and its own line on the
   *  slip: a total that silently contains both is one nobody can check against
   *  what they were told they earn (D250). */
  base_pay: number;
  /** Days that earned the tunjangan — present days, less whatever HRD
   *  withheld. */
  allowance_days: number;
  allowance_pay: number;
  /** Days HRD took it off, what that came to, and every reason. Listed on the
   *  slip rather than netted into one number: *kenapa tunjangan saya kurang
   *  dua hari* is the question this exists to answer. */
  allowance_withheld_days: number;
  allowance_withheld_amount: number;
  allowance_withheld: { work_date: string; reason: string; by_name: string }[];
  /** What one ordinary hour of this person is worth, which rule produced it,
   *  and what the other rule would have produced. Both are carried because
   *  they differ — 1/173 of a month is not a year of pay over the days this
   *  business works — and a payslip that showed only the one in force would
   *  make the choice invisible (D249). */
  hourly: number;
  hourly_basis: HourlyBasis;
  company_hourly: number;
  statutory_hourly: number;
  /** What the hourly rate was computed over: a year of pay under the active
   *  rules, allowance included or not. */
  annual_pay: number;
  overtime_pay: number;
  /** The overtime sum, tier by tier — what makes the figure arguable (D173). */
  overtime_parts: OvertimePart[];
  /** Hours short of the contracted day, and what the active rule says that
   *  costs. Zero when the rule is `off`, which is the default (D174). */
  undertime_hours: number;
  undertime_amount: number;
  gross: number;
  /** What was added or taken off by hand, each with its reason (D155). */
  adjustments: { kind: AdjustmentKind; label: string; amount: number; reason: string }[];
  /** Σ adjustments — negative when more was taken off than added. */
  adjustment_total: number;
  /** `gross + adjustment_total`. Still before any statutory deduction, which
   *  this system does not compute (D140). */
  net: number;
  /** The statutory deductions — the **employee half only**, and only for the
   *  schemes this person is actually enrolled in (D259). Empty where HRD has
   *  entered no enrolment, which is the honest state of most of this payroll
   *  and is said on the slip rather than left as a blank line.
   *
   *  D140 still stands where it applies: nothing here is invented. A person
   *  with no enrolment row gets no deduction, and PPh 21 is recorded as an
   *  enrolment and never computed. */
  contributions: {
    scheme: ContributionScheme;
    label: string;
    base: number;
    employee: number;
    employer: number;
  }[];
  contribution_total: number;
  /** `net − contribution_total`. The figure that actually reaches a pocket,
   *  and null-free: it is only different from `net` where a real enrolment
   *  exists. */
  take_home: number;
  /** Minutes late across the period, from the taps — **past the grace period**,
   *  not past the start of the day. */
  late_minutes: number;
  /** Days with any lateness at all, and what the `pro_rata` rule would take
   *  off for them. `late_deduction` is **zero while `late_mode` is manual**,
   *  which is the shipped default: the figure is computed so the rule-book
   *  screen can price it before anybody turns it on, and so a payslip can show
   *  what is *not* being deducted (D174, D251). */
  late_days: number;
  late_deduction: number;
  /** Every day of the period, for the weekly recap on the payslip (D156). */
  days: PayslipDay[];
  /** Anything a person cannot resolve from the figures alone. */
  warnings: string[];
}

/** One day, as a payslip prints it — the owner's own sketch: masuk, pulang,
 *  jam, and the overtime under it (D156). */
export interface PayslipDay {
  work_date: string;
  /** 1 Monday … 7 Sunday. */
  weekday: number;
  in_at: string | null;
  out_at: string | null;
  work_hours: number;
  overtime_hours: number;
  /** `merah`, `sakit`, `cuti` — the short mark, when there is one. */
  mark: string | null;
  day_value: number;
  /** The machine's record of this day is incomplete and nobody has read it, so
   *  it counts for nothing yet. Printed on the slip rather than hidden: a day
   *  with hours beside it that adds nothing to the total is the one an
   *  employee is right to argue about (D156). */
  open: boolean;
}

export interface PayrollView extends PayrollRun {
  lines: PayrollLine[];
  gross_total: number;
  /** Gross plus everything added or taken off by hand (D155). */
  net_total: number;
  adjustment_total: number;
  /** Days inside the period that nobody has closed. A run with open days is
   *  computable and not trustworthy, and the screen says which. */
  open_days: number;
  pending_overtime_hours: number;
}
