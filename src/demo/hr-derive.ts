/** HR views — computed on read, never stored (A3).
 *
 *  Payroll is the place where a stored number does the most damage: a figure
 *  that disagrees with the days behind it is somebody's wages being wrong, and
 *  nobody finds out until they count their money. So a payroll line is derived
 *  from attendance and approved overtime every time it is read, and the run
 *  stores only the period, the status and who said yes.
 */
import type { DemoState } from "./state";
import { settingNumber } from "./settings";
import { officeToday } from "@/lib/office";
import { personWork, workAttribution } from "./production-derive";
import type {
  Employee, TimesheetDay, DayState, ScanSlot, DayPay, DayMark,
  OvertimeSheet, OvertimeStage, PayrollLine, PayrollView, PayrollRun,
  PayslipDay, AdjustmentKind,
  PayRules, PayRuleSet, WorkSchedule, ScheduleHours, OvertimeTier, OvertimePart, HourlyBasis,
  AllowanceWithholding, AllowanceWithholdingView,
  ContributionScheme, ContributionRate, Enrolment, ContributionLine, ContributionRoll,
  Task, TaskView, TaskRoutine, TaskRoutineView, KpiMeasure, KpiView,
  EmployeeFileView, EmployeeDocSlot, EmployeeDocument, EmployeeDocumentView,
  LeaveBalance, LeaveRequest, LeaveRequestView,
} from "@/services/hr/contracts";
import {
  ADJUSTMENT_LABEL, DAY_MARK_SHORT,
  EMPLOYEE_DOC_CHECKLIST, EMPLOYEE_DOC_LABEL, SENSITIVE_DOC_KINDS, DOC_NO_DIGITS, maskDocNo,
  SCHEME_LABEL, COMPUTED_SCHEMES,
} from "@/services/hr/contracts";
import { scheduleHoursOf } from "@/services/hr/schedule-rules";
import {
  addDays, taskPeriodStart, taskPeriodEnd, taskPeriodLabel,
} from "@/services/hr/task-periods";

const HOURS = 3_600_000;

/** Hours between two stamps, to two decimals. Crossing midnight is normal —
 *  the security shift starts at 19:00 and ends at 07:00. */
function hoursBetween(from: string, to: string): number {
  let ms = Date.parse(to) - Date.parse(from);
  if (ms < 0) ms += 24 * HOURS;
  return Math.round((ms / HOURS) * 100) / 100;
}

/** Taps a person made on one day, de-duplicated.
 *
 *  A reader scanned twice in the same minute is one arrival, not two — the
 *  real export has 29 of them. Two minutes is the window: it is long enough to
 *  swallow a finger that did not take the first time, and short enough to keep
 *  a genuine second tap eleven minutes later, which is a different event
 *  somebody has to look at (D141).
 */
function tapsOf(state: DemoState, employeeId: string, workDate: string) {
  const rows = state.attendance_scans
    .filter((r) => r.employee_id === employeeId && r.work_date === workDate)
    .sort((a, b) => a.at.localeCompare(b.at));
  const kept: typeof rows = [];
  for (const r of rows) {
    const last = kept[kept.length - 1];
    if (last && Math.abs(Date.parse(r.at) - Date.parse(last.at)) < 120_000) continue;
    kept.push(r);
  }
  return kept;
}

const hhmm = (iso: string) => iso.slice(11, 16);
const minutes = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));

/** Is the doctor's letter behind this mark?
 *
 *  Evidence reaches a record the same way everywhere in this system: through
 *  an attachment link declared by a person (ADR-010). So *sakit dibayar kalau
 *  ada surat dokter* is not a boolean somebody ticks — it is whether a
 *  `Surat Dokter` is linked to that mark, by name, with a date (D144).
 */
function suratDokter(state: DemoState, mark: DayMark): boolean {
  return state.attachment_links.some(
    (l) => l.entity === "day_mark" && l.entity_no === mark.id && l.kind === "Surat Dokter",
  );
}

/** Paid leave already taken this calendar year, before `workDate`.
 *
 *  Counted rather than stored. A stored "sisa cuti" is a number that drifts
 *  the first time a mark is removed, and the person it drifts against is the
 *  one who loses a paid day (A3). The order is the year's own: the first days
 *  of the entitlement are the paid ones, and once it is spent the rest are
 *  recorded and unpaid (D144).
 */
function leaveTakenBefore(state: DemoState, employeeId: string, workDate: string): number {
  const year = workDate.slice(0, 4);
  return state.day_marks.filter(
    (m) => m.kind === "leave"
      && m.employee_id === employeeId
      && m.work_date.slice(0, 4) === year
      && m.work_date < workDate,
  ).length;
}

/** What a marked day is worth, and why — the sentence an employee asks for.
 *
 *  Answering Q33 (owner, 2026-09-11): *sakit* is paid when the surat dokter is
 *  there, *cuti* is paid out of that person's own balance, and everything else
 *  is recorded without being paid. Nothing here refuses a mark: a day taken
 *  with no letter and no balance left is still a fact about that person's
 *  month, and hiding it would only move the argument to payday (D144).
 */
function payOfMark(
  state: DemoState,
  employee: Employee,
  mark: DayMark,
  workHours: number,
): DayPay {
  switch (mark.kind) {
    case "half_day":
      return { value: 0.5, why: "Setengah hari — dibayar 0,5 hari.", fixable: null };
    case "holiday":
      return {
        value: 0,
        why: workHours > 0
          ? "Tanggal merah — jam yang dikerjakan dihitung lembur, harinya sendiri tidak."
          : "Tanggal merah — bukan hari kerja.",
        fixable: null,
      };
    case "sick": {
      if (suratDokter(state, mark)) {
        return { value: 1, why: "Sakit dengan surat dokter — dibayar penuh.", fixable: null };
      }
      return {
        value: 0,
        why: "Sakit tanpa surat dokter — tidak dibayar.",
        fixable: "Lampirkan surat dokter dan hari ini terhitung dibayar.",
      };
    }
    case "leave": {
      const taken = leaveTakenBefore(state, employee.id, mark.work_date);
      const left = employee.paid_leave_days - taken;
      if (left > 0) {
        return {
          value: 1,
          why: `Cuti berbayar — sisa hak cuti ${left} hari sebelum hari ini, dari ${employee.paid_leave_days}.`,
          fixable: null,
        };
      }
      return {
        value: 0,
        why: `Cuti di luar hak — jatah ${employee.paid_leave_days} hari tahun ini sudah habis.`,
        fixable: null,
      };
    }
    case "permit":
      return { value: 0, why: "Izin — tercatat, tidak dibayar.", fixable: null };
    case "absent":
    default:
      return { value: 0, why: "Tidak masuk tanpa keterangan — tidak dibayar.", fixable: null };
  }
}

/** Reading a day's taps against the six slots.
 *
 *  The rule is written here rather than buried, because it is a **reading**
 *  and every reading can be wrong: the first tap is `masuk`, a tap in the
 *  middle of the day is the break going out and coming back, the first tap
 *  after mid-afternoon is `pulang`, and a pair after that is the lembur.
 *
 *  What matters more than the rule is what happens when it does not fit.
 *  Anything left over, or any slot the rule cannot fill, makes the day
 *  `review` — never a guess. On the export this was built against that is 48
 *  days out of 227, and each of them is somebody's wages (D141).
 */
export function timesheetDay(
  state: DemoState,
  employee: Employee,
  workDate: string,
): TimesheetDay {
  /* The book in force **on the day being read**, not today's — a day in August
     is read against August's rules, which is the whole reason the rule book is
     dated (D173). */
  const rules = activePayRules(state, workDate).rules;
  const taps = tapsOf(state, employee.id, workDate);
  const mark = state.day_marks.find(
    (m) => m.work_date === workDate
      && (m.employee_id === null || m.employee_id === employee.id),
  ) ?? null;

  const slots: Partial<Record<ScanSlot, string>> = {};
  const assigned = new Map<string, ScanSlot>();
  const issues: string[] = [];
  /* Things worth saying about a day the rule read fine. Never `issues`: an
     entry there means the reading failed and the day cannot be paid (D141). */
  const notes: string[] = [];

  const rest = [...taps];
  const take = (slot: ScanSlot, pick: (t: typeof taps[number]) => boolean) => {
    const i = rest.findIndex(pick);
    if (i === -1) return false;
    slots[slot] = rest[i].at;
    assigned.set(rest[i].id, slot);
    rest.splice(i, 1);
    return true;
  };

  if (taps.length > 0) {
    take("in", () => true);
    /* The middle of the day: out to eat, back from eating. */
    take("break_out", (t) => minutes(t.at) >= 11 * 60 && minutes(t.at) < 13 * 60 + 30);
    take("break_in", (t) => minutes(t.at) >= 11 * 60 + 30 && minutes(t.at) < 14 * 60 + 30);
    take("out", (t) => minutes(t.at) >= 14 * 60 + 30);
    take("ot_start", (t) => slots.out !== undefined && t.at > slots.out!);
    take("ot_end", (t) => slots.ot_start !== undefined && t.at > slots.ot_start!);
  }

  const worked = (a?: string, b?: string) =>
    a && b ? Math.max(Math.round(((Date.parse(b) - Date.parse(a)) / HOURS) * 100) / 100, 0) : 0;

  let break_hours = worked(slots.break_out, slots.break_in);
  const gross_hours = worked(slots.in, slots.out);
  let work_hours = Math.max(Math.round((gross_hours - break_hours) * 100) / 100, 0);
  let overtime_hours = worked(slots.ot_start, slots.ot_end);

  /* Anything the rule could not place. Left over taps are the loudest signal
     that this day needs a person: they are real events nobody has explained. */
  if (rest.length > 0) {
    issues.push(`${rest.length} tap(s) the rule could not place: ${rest.map((t) => hhmm(t.at)).join(", ")}`);
  }
  if (taps.length > 0) {
    if (!slots.out) issues.push("No pulang — the day has no end");
    if (!slots.break_out || !slots.break_in) issues.push("Istirahat incomplete");
    /* The allowance the owner set is 45 minutes (Q44, D270), and a break that
       ran past it is **reported, never deducted** — it is a fact about a day,
       and turning it into money is the same decision lateness has been waiting
       on since D251. Null means the business has not set one, which is not a
       break of zero, so nothing is said at all. */
    /* Friday's allowance differs from the rest of the week here, so it is
       looked up per date rather than per person (Q44, D274). */
    const allowed = breakAllowanceFor(rules, employee, workDate);
    if (allowed != null && break_hours * 60 > allowed) {
      notes.push(
        `Istirahat ${Math.round(break_hours * 60)} menit, lewat ${Math.round(break_hours * 60 - allowed)} menit dari jatah ${allowed} menit`,
      );
    }
    if (slots.ot_start && !slots.ot_end) issues.push("Lembur started and never finished");
  }

  let day_value = 0;
  let state_: DayState;
  let pay: DayPay;

  if (mark) {
    state_ = "marked";
    pay = payOfMark(state, employee, mark, work_hours);
    day_value = pay.value;
    if (mark.kind === "holiday") {
      /* Tanggal merah: being here at all is overtime (owner). The day itself
         is not a working day, so it adds no day_value — the hours do. */
      overtime_hours = work_hours > 0 ? work_hours : overtime_hours;
      work_hours = 0;
    } else if (mark.kind !== "half_day") {
      /* Away is away: no hours are counted for a day somebody did not work,
         whether or not it is paid. The taps themselves stay untouched below —
         it is the counting that stops, not the record (D142). */
      work_hours = 0;
      break_hours = 0;
      overtime_hours = 0;
    }
  } else if (taps.length === 0) {
    state_ = "off";
    pay = { value: 0, why: "Tidak ada absensi sama sekali pada hari ini.", fixable: "Tetapkan hari ini — libur, sakit, cuti atau tidak masuk." };
  } else if (issues.length > 0) {
    state_ = "review";
    pay = { value: 0, why: "Belum dibaca — absensi hari ini tidak lengkap, jadi belum bernilai.", fixable: "Lengkapi tap yang hilang, atau tetapkan hari ini." };
  } else {
    state_ = "complete";
    day_value = 1;
    pay = { value: 1, why: "Hari kerja penuh.", fixable: null };
  }

  return {
    employee_id: employee.id,
    employee_no: employee.employee_no,
    full_name: employee.full_name,
    work_date: workDate,
    scans: taps.map((t) => ({
      at: t.at, verify: t.verify, slot: assigned.get(t.id) ?? null, source: t.source,
    })),
    slots,
    state: state_,
    mark,
    work_hours,
    break_hours,
    overtime_hours,
    day_value,
    pay,
    issues,
    notes,
  };
}

/** Where a sheet has got to, and whether its hours reach a payslip.
 *
 *  Two paths, because the owner described two documents (D146):
 *
 *  - **Produksi** — HRD checks the hours, the signed sheet is attached, and
 *    leadership signs. Nothing is paid until all three.
 *  - **Staff** — HRD alone, and the default is **paid**: the person already
 *    stayed and their report is attached, so the decision HRD takes is whether
 *    to turn it off, not whether to turn it on.
 *
 *  Derived from the signatures and the attached paper rather than stored
 *  beside them, so a status can never disagree with what is under it (A3).
 */
export function overtimeStage(state: DemoState, sheet: OvertimeSheet): OvertimeStage {
  if (sheet.declined_reason) return "declined";

  if (sheet.kind === "staff") {
    if (!sheet.paid) return "unpaid";
    return sheet.hrd_checked_at ? "paid_checked" : "paid_default";
  }

  if (!sheet.hrd_checked_at) return "waiting_hrd";
  if (sheet.leader_approved_at) return "approved";
  return sheetEvidence(state, sheet.id, "Surat Lembur") ? "waiting_leader" : "waiting_surat";
}

/** The paper behind a sheet: the signed form for production, the screenshot
 *  report for a staff session. Both arrive as attachments on the same road as
 *  every other document here (ADR-010). */
export function sheetEvidence(state: DemoState, sheetId: string, kind?: string) {
  return state.attachment_links.find(
    (l) => l.entity === "overtime" && l.entity_no === sheetId
      && (kind ? l.kind === kind : l.kind === "Surat Lembur" || l.kind === "Laporan Lembur"),
  ) ?? null;
}

/** Do these hours reach a payslip as things stand? */
export function overtimePayable(state: DemoState, sheet: OvertimeSheet): boolean {
  const stage = overtimeStage(state, sheet);
  return stage === "approved" || stage === "paid_default" || stage === "paid_checked";
}

/** Every day of a period for one person, including the days with nothing on
 *  them — a day nobody scanned is a fact too. */
export function timesheet(
  state: DemoState,
  employee: Employee,
  from: string,
  to: string,
): TimesheetDay[] {
  const out: TimesheetDay[] = [];
  /* Walked as strings, in office days. Going through `Date` to build a key
     converts back via UTC and loses the last day of every period (F39). */
  for (let key = from; key <= to; key = nextDay(key)) {
    out.push(timesheetDay(state, employee, key));
  }
  return out;
}

/** The next office day, without going near a timezone. */
function nextDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** What one person is owed for a period, before any deduction.
 *
 *  **Gross only, deliberately.** BPJS Kesehatan, BPJS Ketenagakerjaan and PPh
 *  21 all apply to this business and none of them has been described to us
 *  (Q30–Q32). A missing deduction is obvious on a payslip; a wrong one is
 *  discovered by an employee who is short.
 */
export function payrollLine(
  state: DemoState,
  employee: Employee,
  from: string,
  to: string,
  /** Adjustments belong to a run, so the line has to know which one it is
   *  being computed for (D155). */
  runNo = "",
  /** A rule book to apply instead of the one in force. Only the preview uses
   *  it: *what would this multiplier do to this period* is a question worth
   *  answering before somebody commits to the answer (D175). */
  rulesOverride?: PayRules,
): PayrollLine {
  const days = timesheet(state, employee, from, to);
  /* A day is worth what the timesheet says it is worth: a full day, half of
     one when the office closed at noon, none at all when somebody was away
     (D142). */
  const counted = days.filter((d) => d.day_value > 0);
  const worked_days = days.reduce((s, d) => s + d.day_value, 0);
  const open = days.filter((d) => d.state === "review");

  /* Overtime arrives as sheets; a person's hours are their lines on the ones
     covering this period. Whether those hours are paid is a property of the
     sheet, not of the line (D146). */
  const myLines = state.overtime_lines
    .map((l) => ({ line: l, sheet: state.overtime_sheets.find((sh) => sh.id === l.sheet_id) }))
    .filter((x) => x.sheet
      && x.line.employee_id === employee.id
      && x.sheet.work_date >= from && x.sheet.work_date <= to);

  const payableLines = payableLinesOf(state, employee, from, to);
  const approvedOt = payableLines.reduce((s, x) => s + x.line.hours, 0);
  const pendingOt = myLines
    .filter((x) => !overtimePayable(state, x.sheet!) && !x.sheet!.declined_reason && x.sheet!.paid)
    .reduce((s, x) => s + x.line.hours, 0);

  const normal_hours = counted.reduce((s, d) => s + d.work_hours, 0);
  /* Hours the machine shows past the day, and the whole of a public holiday.
     Still not paid until a claim for them is approved (D138). */
  const shown_ot = days.reduce((s, d) => s + d.overtime_hours, 0);

  /* Monthly staff are paid the month whatever the machine says; a daily or
     hourly person is paid for what they were here for. That difference is the
     only place `pay_basis` is used, and it is why it exists. */
  const base_pay = employee.pay_basis === "monthly"
    ? employee.base_rate
    : employee.pay_basis === "daily"
      ? Math.round(worked_days * employee.base_rate)
      : Math.round(normal_hours * employee.base_rate);

  /* What an ordinary hour of this person's time is worth, and then the ladder
     the active rule book says to multiply it by (D173). Both come out of the
     rules — the monthly divisor is 173 because the regulation says so, not
     because the code does. */
  const rules = rulesOverride ?? activePayRules(state, from).rules;
  const rate = hourlyRate(employee, rules);
  const hourly = rate.hourly;
  const overtime_parts = overtimeParts(state, employee, from, to, rules, hourly);
  const overtime_pay = overtime_parts.reduce((s, p) => s + p.amount, 0);

  /* Hours short of the contracted day. Off by default: what a short hour costs
     here has not been stated, and a deduction invented by software reaches
     somebody's pocket (D174). */
  const under = undertimeOf(days, employee, rules, hourly);

  /* What the paid days are made of, so a payslip can say it rather than
     showing one total nobody can take apart (D144). */
  const marked = days.filter((d) => d.mark);
  const days_present = days
    .filter((d) => !d.mark && d.day_value > 0)
    .reduce((s, d) => s + d.day_value, 0)
    + marked.filter((d) => d.mark!.kind === "half_day").reduce((s, d) => s + d.day_value, 0);
  const days_sick_paid = marked.filter((d) => d.mark!.kind === "sick" && d.day_value > 0).length;
  const days_leave_paid = marked.filter((d) => d.mark!.kind === "leave" && d.day_value > 0).length;
  const days_unpaid = marked.filter((d) => d.day_value === 0 && d.mark!.kind !== "holiday").length;

  const warnings: string[] = [];
  if (open.length > 0) {
    warnings.push(`${open.length} day(s) need a person to read them — worth nothing until they do`);
  }
  if (shown_ot > 0 && shown_ot > approvedOt + pendingOt) {
    warnings.push(`${Math.round((shown_ot - approvedOt - pendingOt) * 10) / 10} hour(s) past the day on the machine that nobody has claimed`);
  }
  if (pendingOt > 0) {
    warnings.push(`${pendingOt} overtime hour(s) on a sheet nobody has finished signing — not in this figure`);
  }
  const noLetter = marked.filter((d) => d.mark!.kind === "sick" && d.day_value === 0).length;
  if (noLetter > 0) {
    warnings.push(`${noLetter} sick day(s) with no surat dokter — recorded, not paid. A letter makes them paid`);
  }
  const overLeave = marked.filter((d) => d.mark!.kind === "leave" && d.day_value === 0).length;
  if (overLeave > 0) {
    warnings.push(`${overLeave} day(s) of cuti beyond this person's ${employee.paid_leave_days}-day entitlement — recorded, not paid`);
  }
  if (employee.pay_basis !== "monthly" && worked_days === 0) {
    warnings.push("No day counted in this period");
  }

  /* Adjustments: what a person added or took off, each with its sentence
     (D155). Never invented — this system computes no deduction it was not
     told about. */
  const adjustments = state.payroll_adjustments
    .filter((a) => a.employee_id === employee.id && a.run_no === runNo)
    .map((a) => ({
      kind: a.kind as AdjustmentKind,
      label: ADJUSTMENT_LABEL[a.kind],
      amount: a.amount,
      reason: a.reason,
    }));
  const adjustment_total = adjustments.reduce((s, a) => s + a.amount, 0);

  /* Minutes late across the period, **past the grace the owner set** — fifteen
     of them by default (Q41, D251). The start of the day and the grace after it
     are two rules now; they were one number holding 480, which read as *late
     after 480 minutes* and meant *late after 08:00* (F70). */
  const lateBy = (d: (typeof days)[number]): number => {
    const inAt = d.slots.in;
    if (!inAt || d.mark) return 0;
    const mins = Number(inAt.slice(11, 13)) * 60 + Number(inAt.slice(14, 16));
    const start = dayStartFor(rules, employee);
    /* Nobody has said when this person's day starts, so nothing about this day
       is late. Not zero because they were punctual — zero because there is no
       threshold, and inventing one puts minutes on a payslip (D274). */
    if (start === null) return 0;
    return Math.max(mins - start - rules.late_grace_minutes, 0);
  };
  const late_minutes = days.reduce((s, d) => s + lateBy(d), 0);
  const late_days = days.filter((d) => lateBy(d) > 0).length;

  /* What the hours would cost — *potongannya jam saja* (D251). Computed
     whatever the mode, and **applied only when the mode says so**: the figure
     exists so the rule book can price it before anybody switches it on, and so
     a payslip can show what is not being deducted rather than leaving the
     minutes looking free (D174). */
  const late_priced = Math.round((late_minutes / 60) * hourly);
  const late_deduction = rules.late_mode === "pro_rata" ? late_priced : 0;

  /* Tunjangan: one day's worth for every day the person was actually here,
     less the days HRD took it off with a reason (D250). Marked days — sakit,
     cuti, tanggal merah — earn no allowance: it is paid for coming in, and
     paying it for a day somebody was at home would make it part of the salary
     under another name. */
  const withheldRows = withholdingsFor(state, employee.id, from, to);
  const withheldDates = new Set(withheldRows.map((w) => w.work_date));

  /* Which days earn it, and the split by `pay_basis` is the **same** split
     `base_pay` already makes twenty lines up, for the same stated reason: a
     monthly person is paid the month whatever the machine says, and a daily
     one is paid for what they were here for.
     
     Making the allowance depend on taps for everybody looked right and paid
     five office staff Rp 600.000 a month less than the day before, because the
     fingerprint reader is a workshop device and they do not use it (F72). No
     taps is not evidence of absence. So a monthly person earns it on the days
     the business works, and loses it the way the owner said they should — HRD
     deciding, with a reason.

     A **half day is present**, and since Q46 that is the owner's ruling rather
     than our reading of one: *tunjangan penuh kecuali HR mengabaikan* (D272).
     The person came in; presence is what earns it, and taking it away is
     HRD's separate decision with its own reason (D250). Sakit, cuti and
     tanggal merah are not presence. */
  const earnsAllowance = (d: (typeof days)[number]): boolean =>
    d.mark ? d.mark.kind === "half_day" : d.day_value > 0;
  const presentDays = employee.pay_basis === "monthly"
    ? days.filter((d) => (d.mark
      ? d.mark.kind === "half_day"
      : !isRestDay(state, rules, d.work_date)))
    : days.filter(earnsAllowance);
  const allowance_days = presentDays.filter((d) => !withheldDates.has(d.work_date)).length;
  const allowance_withheld_days = presentDays.filter((d) => withheldDates.has(d.work_date)).length;
  const allowance_pay = Math.round(allowance_days * employee.allowance_rate);
  const allowance_withheld_amount = Math.round(allowance_withheld_days * employee.allowance_rate);
  const nameOf = (id: string) => state.users.find((u) => u.id === id)?.full_name ?? id;
  const allowance_withheld = withheldRows
    .filter((w) => presentDays.some((d) => d.work_date === w.work_date))
    .map((w) => ({ work_date: w.work_date, reason: w.reason, by_name: nameOf(w.by) }));

  if (employee.allowance_rate > 0 && allowance_withheld_days > 0) {
    warnings.push(
      `${allowance_withheld_days} hari tanpa tunjangan — keputusan HRD, alasannya tercetak di slip`,
    );
  }
  if (late_minutes > 0 && rules.late_mode === "manual") {
    warnings.push(
      `${late_minutes} menit terlambat di luar toleransi — belum dipotong; Rp ${late_priced.toLocaleString("id-ID")} kalau aturannya dinyalakan`,
    );
  }

  const payslipDays: PayslipDay[] = days.map((d) => ({
    work_date: d.work_date,
    weekday: weekdayOf(d.work_date),
    in_at: d.slots.in ? d.slots.in.slice(11, 16) : null,
    out_at: d.slots.out ? d.slots.out.slice(11, 16) : null,
    work_hours: d.work_hours,
    overtime_hours: d.overtime_hours,
    mark: d.mark ? DAY_MARK_SHORT[d.mark.kind] : null,
    day_value: d.day_value,
    open: d.state === "review",
  }));

  const gross = base_pay + allowance_pay + overtime_pay - under.amount - late_deduction;

  /* The statutory half, and **only where HRD has entered an enrolment** (D259).
     No enrolment, no deduction — the data is the switch, so nobody is short a
     rupiah because software was updated. PPh 21 is never in here: it is
     recorded as an enrolment and not computed (D140). */
  const contributions = contributionsForPerson(state, employee, from.slice(0, 7));
  const contribution_total = contributions.reduce((a, c) => a + c.employee, 0);
  if (contributions.length === 0 && state.enrolments.some((en) => en.employee_id === employee.id)) {
    warnings.push("Terdaftar di iuran wajib tapi tidak ada tarif yang berlaku untuk periode ini — tidak dipotong apa pun.");
  }

  /* A hand-typed lateness deduction with no lateness behind it.
   *
   *  Not blocked — HRD may know something the machine does not, and the machine
   *  misses taps constantly (F40). But the slip must not print **TERLAMBAT —**
   *  above a line that takes money off for being late: that is one page
   *  contradicting itself, and the person holding it is right either way (F48's
   *  rule, in a new place). */
  const lateAdjustment = adjustments.find((a) => a.kind === "late" && a.amount < 0);
  if (lateAdjustment && late_minutes === 0) {
    warnings.push(
      "Potongan keterlambatan dicatat tangan, tapi absensi periode ini tidak menunjukkan keterlambatan di luar toleransi — salah satunya perlu dibetulkan",
    );
  }

  if (adjustment_total < 0) {
    warnings.push(`${adjustments.filter((a) => a.amount < 0).length} potongan dicatat tangan — lihat rinciannya di slip`);
  }

  return {
    employee_id: employee.id,
    employee_no: employee.employee_no,
    full_name: employee.full_name,
    position: employee.position,
    pay_basis: employee.pay_basis,
    base_rate: employee.base_rate,
    allowance_rate: employee.allowance_rate,
    days_worked: worked_days,
    days_open: open.length,
    days_present: Math.round(days_present * 100) / 100,
    days_sick_paid,
    days_leave_paid,
    days_unpaid,
    normal_hours: Math.round(normal_hours * 100) / 100,
    overtime_hours: approvedOt,
    overtime_pending_hours: pendingOt,
    base_pay,
    allowance_days,
    allowance_pay,
    allowance_withheld_days,
    allowance_withheld_amount,
    allowance_withheld,
    hourly,
    hourly_basis: rate.basis,
    company_hourly: rate.company,
    statutory_hourly: rate.statutory,
    annual_pay: rate.annual,
    overtime_pay,
    overtime_parts,
    undertime_hours: under.hours,
    undertime_amount: under.amount,
    /* Undertime is part of the gross, not an adjustment: it is arithmetic over
       recorded hours under a stated rule, while an adjustment is one person's
       decision about another (D155). */
    gross,
    adjustments,
    adjustment_total,
    /* **Derived from `gross`, never re-added.** These were two longhand sums of
       the same components, and adding the tunjangan to one of them left the
       other behind: the run showed a bruto of Rp 24.525.000 and a *diterima*
       of Rp 24.400.000 on a line with no adjustments at all (F73). Net is
       gross plus what a person decided, and there is now one place that
       says so. */
    net: gross + adjustment_total,
    contributions,
    contribution_total,
    /* What actually reaches a pocket. Equal to `net` for everybody HRD has not
       registered, which is most of this payroll and is said on the slip. */
    take_home: gross + adjustment_total - contribution_total,
    late_minutes,
    late_days,
    late_deduction,
    days: payslipDays,
    warnings,
  };
}


/* ── The rule book ─────────────────────────────────────────────────────────
 *
 *  Which version applies is decided by the **period's start**, not by today:
 *  recomputing an August payslip in December must produce August's figure
 *  (D173). A rule that changed mid-period does not split a payslip in two —
 *  the version in force when the period opened governs all of it, which is
 *  what a person who has already been paid would expect.
 */
export function activePayRules(state: DemoState, onDate: string): PayRuleSet {
  /* Sorted by date **and then by version**. Sorting by date alone left the
     winner depending on the order the rows happened to arrive in, which is
     fine until two books share an effective date — and one does, because v4
     corrects v3 from the day v3 itself began rather than changing policy from
     today (D270). A rule book whose answer depends on array order is not a
     dated rule book. */
  const sets = [...state.pay_rule_sets].sort((a, b) =>
    a.effective_from.localeCompare(b.effective_from) || a.version - b.version);
  const found = sets.filter((r) => r.effective_from <= onDate).pop();
  /* Before the first version there is no policy, and the honest fallback is
     the earliest one somebody wrote down rather than an invented default. */
  return found ?? sets[0];
}

/** Whether a date is a weekly rest day under the active pattern, or a public
 *  holiday somebody marked. Both take the steeper ladder. */
function isRestDay(state: DemoState, rules: PayRules, date: string): boolean {
  const marked = state.day_marks.some((m) => m.work_date === date && m.employee_id === null && m.kind === "holiday");
  if (marked) return true;
  const wd = weekdayOf(date);
  return rules.week_pattern === "5day" ? wd >= 6 : wd === 7;
}

/** The ladder, applied to one night's hours.
 *
 *  Returns the parts rather than a total, because the total is the thing
 *  nobody can check: *3 jam lembur = Rp 91.000* invites an argument, while
 *  *jam ke-1 × 1,5 + 2 jam × 2 = 5,5 jam × Rp 16.500* ends one (D173).
 */
function tierParts(hours: number, tiers: OvertimeTier[]): { hours: number; multiplier: number; from: number }[] {
  const ladder = [...tiers].sort((a, b) => a.after_hours - b.after_hours);
  const parts: { hours: number; multiplier: number; from: number }[] = [];
  let taken = 0;
  for (let i = 0; i < ladder.length && taken < hours; i += 1) {
    const from = ladder[i].after_hours;
    const to = i + 1 < ladder.length ? ladder[i + 1].after_hours : Infinity;
    const slice = Math.min(hours, to) - Math.max(taken, from);
    if (slice > 0) {
      parts.push({ hours: Math.round(slice * 100) / 100, multiplier: ladder[i].multiplier, from });
      taken = Math.max(taken, from) + slice;
    }
  }
  return parts;
}

/** `jam ke-1`, `jam 2–7`, `jam 8 ke atas` — how the ladder reads on paper. */
function tierLabel(restDay: boolean, from: number, hours: number): string {
  const day = restDay ? "Hari libur" : "Hari kerja";
  const first = from + 1;
  const last = from + hours;
  const span = hours <= 1 || first === last
    ? `jam ke-${Math.round(first)}`
    : `jam ${Math.round(first)}–${Math.round(last)}`;
  return `${day} · ${span}`;
}

/** Rounding, where the rule asks for it. Zero minutes means exact — the figure
 *  the machine produced, not one somebody negotiated. */
function roundHours(hours: number, minutes: number): number {
  if (!minutes) return hours;
  const step = minutes / 60;
  return Math.round(hours / step) * step;
}


/** The overtime lines that reach a payslip: on sheets covering the period,
 *  belonging to this person, and signed all the way (D146). */
function payableLinesOf(state: DemoState, employee: Employee, from: string, to: string) {
  return state.overtime_lines
    .map((l) => ({ line: l, sheet: state.overtime_sheets.find((sh) => sh.id === l.sheet_id) }))
    .filter((x) => x.sheet
      && x.line.employee_id === employee.id
      && x.sheet.work_date >= from && x.sheet.work_date <= to
      && overtimePayable(state, x.sheet))
    .map((x) => ({ line: x.line, sheet: x.sheet! }));
}

export interface HourlyRate {
  /** The one the payslip uses. */
  hourly: number;
  basis: HourlyBasis;
  /** A year of pay ÷ the days this business works ÷ the hours in its day — the
   *  owner's own arithmetic (D249). */
  company: number;
  /** 1/173 of a month. The statute's figure for the overtime ladder. */
  statutory: number;
  /** What the year came to, under the active rules. */
  annual: number;
  /** Pokok + tunjangan, or pokok alone (D250). */
  includes_allowance: boolean;
}

/* ── Tugas, dan mengukur orang ─────────────────────────────────────────────── */

/** When this person's day starts, in minutes from midnight.
 *
 *  One business, two schedules: the workshop taps in at 07.30 and the office at
 *  08.00 (Q44, D270). A single start time meant the workshop was measured
 *  against the office's — which, with the owner's fifteen-minute grace on top,
 *  made it arithmetically impossible for anybody in the building to be late
 *  (F70). A unit nobody has set a time for falls back to the stated company
 *  time, which is the honest default: unset is not a licence to arrive whenever.
 */
/** Minutes-from-midnight as a clock face. Not `hhmm` — that name is already
 *  taken above by the one that slices a tap's ISO string, and two functions
 *  with one name is how a wrong number gets formatted correctly. */
export function clockOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}.${String(minutes % 60).padStart(2, "0")}`;
}

/** The working pattern this person is on (Q44, D274).
 *
 *  Person first, then their unit, then nothing — and *nothing* is a real
 *  answer here rather than a default: it returns null, and every reader has to
 *  decide what to do about a person whose hours nobody has written down. The
 *  one thing none of them may do is assume they are on the office clock, which
 *  is precisely the assumption that made it impossible for the workshop to be
 *  late (F70).
 */
export function scheduleFor(rules: PayRules, employee: Employee): WorkSchedule | null {
  const byPerson = employee.schedule_code
    ? rules.schedules?.find((sc) => sc.code === employee.schedule_code)
    : undefined;
  if (byPerson) return byPerson;
  const code = rules.schedule_by_unit?.[employee.unit];
  return (code ? rules.schedules?.find((sc) => sc.code === code) : undefined) ?? null;
}

/** When this person's day starts, or **null when nobody has said**.
 *
 *  The guard works twelve hours from a time nobody has fixed. A number here
 *  would be an invention, and an invented threshold produces a lateness figure
 *  that looks measured — which is worse than no figure at all.
 */
export function dayStartFor(rules: PayRules, employee: Employee): number | null {
  const sc = scheduleFor(rules, employee);
  if (sc) return sc.start_minutes;
  /* No schedule at all: the company's stated start, which is what the rule
     book says when it says nothing more specific. */
  return rules.day_starts_minutes;
}

/** A schedule's week and month, worked out rather than stored (Q53, D279).
 *
 *  Null propagates deliberately. The guard's twelve hours have no start, so no
 *  day, so no week, so no month — and every one of those is *belum ditetapkan*
 *  rather than zero. A zero here would be a figure HR could plan against, and
 *  it would be a figure about a person nobody has written the hours down for.
 */
export function scheduleHours(rules: PayRules, sc: WorkSchedule): ScheduleHours {
  /* The arithmetic itself moved to `@/services/hr/schedule-rules`, because
     `/it/aturan-gaji` needs it for a row nobody has saved yet and a third copy
     of the Friday rule is how two of three come to agree. What stays here is
     the one thing that is about the rule *book* rather than the pattern: how
     many days the week has. */
  return scheduleHoursOf(sc, rules.week_pattern === "5day" ? 5 : 6);
}

/** The break this schedule allows on this date — Friday differs here. Null
 *  means nobody has set one, which is not a break of zero. */
export function breakAllowanceFor(
  rules: PayRules, employee: Employee, workDate: string,
): number | null {
  const sc = scheduleFor(rules, employee);
  if (!sc) return null;
  return weekdayOf(workDate) === 5 ? (sc.friday_break_minutes ?? sc.break_minutes) : sc.break_minutes;
}

/** What somebody has to deal with, first: overdue, then what must be asked
 *  for today, then blocked, then by date, then the finished ones.
 *
 *  Chasing sits **above** blocked and below overdue on purpose — a blocked task
 *  needs somebody else to move, and a chase is the one thing on this list the
 *  reader can do right now. Transcribed from `v_task`'s `queue_rank`, and the
 *  numbers are the same numbers on both sides so a screen can compare them.
 */
function queueRank(t: TaskView): number {
  if (t.status !== "OPEN") return 4;
  if (t.overdue) return 0;
  if (t.chase_due) return 1;
  if (t.blocked_reason) return 2;
  return 3;
}

export function taskView(state: DemoState, t: Task, today = officeToday()): TaskView {
  const emp = state.employees.find((e) => e.id === t.assignee_id);
  const by = state.users.find((u) => u.id === t.assigned_by);
  const chaser = t.chased_by ? state.users.find((u) => u.id === t.chased_by) : null;
  const routine = t.routine_id
    ? state.task_routines.find((r) => r.id === t.routine_id)
    : null;
  const days_left = daysBetweenDates(today, t.due_date);
  const doneDay = t.done_at?.slice(0, 10) ?? null;
  return {
    ...t,
    assignee_name: emp?.full_name ?? "—",
    assignee_no: emp?.employee_no ?? "—",
    assigned_by_name: by?.full_name ?? t.assigned_by,
    chased_by_name: chaser?.full_name ?? t.chased_by ?? null,
    routine_no: routine?.routine_no ?? null,
    routine_cadence: routine?.cadence ?? null,
    days_left,
    /* Blocked is not overdue. A task waiting on somebody else has not been
       failed by the person holding it (D261). */
    overdue: t.status === "OPEN" && t.blocked_reason === null && days_left < 0,
    late: t.status === "DONE" && doneDay !== null && doneDay > t.due_date,
    days_early: doneDay === null ? null : daysBetweenDates(doneDay, t.due_date),
    acknowledged: t.acknowledged_at !== null,
    /* Due to be **asked for**, today. Blocked is excluded for the same reason
       it is excluded from `overdue`: chasing somebody for work that is waiting
       on a third party is how a tracker teaches people to stop reporting
       blockers (D261). It goes false when somebody records that they asked,
       not when the work arrives — two different events, and only one of them
       belongs to whoever is reading this list. */
    chase_due: t.status === "OPEN" && t.blocked_reason === null
      && t.chase_date !== null && t.chased_at === null && t.chase_date <= today,
    days_to_chase: t.chase_date === null ? null : daysBetweenDates(today, t.chase_date),
    period_label: t.period_start === null || t.period_end === null ? null
      : routine ? taskPeriodLabel(routine.cadence, t.period_start)
      : `${t.period_start} – ${t.period_end}`,
  };
}

/** A routine as a person reads it — the definition beside what it would raise
 *  for the period it is in right now, so *setiap tanggal 5* can be checked
 *  against a real date before anybody commits to it. */
export function taskRoutineView(
  state: DemoState, r: TaskRoutine, today = officeToday(),
): TaskRoutineView {
  const emp = state.employees.find((e) => e.id === r.assignee_id);
  const start = taskPeriodStart(r.cadence, today);
  const raised = state.tasks.filter((t) => t.routine_id === r.id);
  return {
    ...r,
    assignee_name: emp?.full_name ?? "—",
    assignee_no: emp?.employee_no ?? "—",
    live: r.ends_on === null || r.ends_on >= today,
    current_period_start: start,
    current_period: taskPeriodLabel(r.cadence, start),
    current_due: addDays(taskPeriodEnd(r.cadence, start), r.due_offset_days),
    raised_count: raised.length,
    open_count: raised.filter((t) => t.status === "OPEN").length,
  };
}

export function taskRoutineViews(
  state: DemoState, today = officeToday(),
): TaskRoutineView[] {
  return state.task_routines
    .map((r) => taskRoutineView(state, r, today))
    /* Live first, then by number. A stopped routine is history and belongs
       under the ones still expected, not mixed among them. */
    .sort((a, b) => Number(b.live) - Number(a.live) || a.routine_no.localeCompare(b.routine_no));
}

export function taskViews(
  state: DemoState,
  filter: { assignee_no?: string; status?: Task["status"] } = {},
  today = officeToday(),
): TaskView[] {
  const emp = filter.assignee_no
    ? state.employees.find((e) => e.employee_no === filter.assignee_no)
    : null;
  return state.tasks
    .filter((t) => (!emp || t.assignee_id === emp.id) && (!filter.status || t.status === filter.status))
    .map((t) => taskView(state, t, today))
    .sort((a, b) => queueRank(a) - queueRank(b) || a.due_date.localeCompare(b.due_date));
}

function daysBetweenDates(from: string, to: string): number {
  const [ay, am, ad] = from.split("-").map(Number);
  const [by, bm, bd] = to.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** One person, measured over a period (D261).
 *
 *  Three rules hold this together and each one exists because its opposite
 *  would quietly hurt somebody.
 *
 *  **Unmeasured is not zero.** The office does not use the fingerprint reader,
 *  so punctuality cannot be measured for office staff. Scoring them 100% is a
 *  compliment nobody earned; scoring them 0% is a slander. The measure carries
 *  null and the reason.
 *
 *  **A blocked task is not a failure.** It is a fact about the workshop, and a
 *  tracker that punishes people for reporting blockers stops being told about
 *  them.
 *
 *  **Entitlements are not absences.** Sakit with a letter and cuti out of the
 *  balance are days somebody is owed; counting them against attendance would
 *  make taking your own leave lower your score.
 */
export function kpiView(
  state: DemoState,
  employee: Employee,
  from: string,
  to: string,
): KpiView {
  const days = timesheet(state, employee, from, to);
  const rules = activePayRules(state, from).rules;
  const notes: string[] = [];

  /* ── Ketepatan waktu, from the taps ─────────────────────────────────── */
  const tapped = days.filter((d) => d.slots.in && !d.mark);
  /* Each day against **the book in force on that day**, not the one in force
     when the window opens. The period here is chosen by the reader and can sit
     across a rule change — and reading a September day against August's start
     time is the same shape of error as F68: one value doing a job it was never
     asked to do, correct until somebody picks a range that spans the boundary
     (F89). The threshold each day was judged by is printed in the basis below,
     so a reader can see which book they are looking at. */
  const startOn = (d: (typeof days)[number]) =>
    dayStartFor(activePayRules(state, d.work_date).rules, employee);
  const lateOn = (d: (typeof days)[number]): boolean => {
    const inAt = d.slots.in!;
    const mins = Number(inAt.slice(11, 13)) * 60 + Number(inAt.slice(14, 16));
    const r = activePayRules(state, d.work_date).rules;
    const start = startOn(d);
    return start !== null && mins - start - r.late_grace_minutes > 0;
  };
  /* Days whose schedule has no start time cannot be judged, so they leave the
     arithmetic entirely rather than counting as punctual (D261's rule, in a
     new place): a guard on an unstated shift must not score 100%. */
  const judgeable = tapped.filter((d) => startOn(d) !== null);
  const lateDays = judgeable.filter(lateOn).length;
  /* The thresholds actually applied across the window — usually one, and named
     as several when the window spans a change rather than quietly averaged. */
  const startsUsed = [...new Set(judgeable.map((d) => {
    const r = activePayRules(state, d.work_date).rules;
    return `${clockOf(startOn(d) as number)}+${r.late_grace_minutes}m`;
  }))];
  const minDaysTaps = settingNumber(state, "kpi.min_days_recorded", 5);
  const thinTaps = tapped.length < minDaysTaps;
  const punctuality: KpiMeasure = {
    key: "punctuality",
    label: "Ketepatan waktu masuk",
    value: thinTaps ? null : Math.round(((tapped.length - lateDays) / tapped.length) * 100),
    unmeasured_reason: !thinTaps ? null
      : tapped.length === 0
        ? "Tidak ada satu pun tap mesin absensi pada periode ini. Mesinnya alat bengkel; staf kantor tidak memakainya, dan tidak terukur bukan berarti seratus persen."
        : `Baru ${tapped.length} hari dengan tap, di bawah ambang ${minDaysTaps} hari.`,
    basis: thinTaps
      ? `${tapped.length} hari dengan tap`
      /* The start time is part of the basis, not a constant behind it: with two
         schedules in one business, *tepat waktu* means a different clock for
         the workshop and the office, and a figure whose threshold is invisible
         cannot be argued with (D261, D270). */
      : `${tapped.length - lateDays} dari ${tapped.length} hari tepat waktu (masuk ${startsUsed.join(" dan ")})`,
    source: "Mesin absensi · aturan penggajian yang berlaku",
    weight: settingNumber(state, "kpi.weight_punctuality", 25),
  };

  /* ── Kehadiran ──────────────────────────────────────────────────────── */
  /* Measured over **the days the system has a record for**, not over a
     calendar.
     
     The first version divided by scheduled working days and rated every office
     worker at 4% present — one day out of twenty-five — because attendance
     comes from taps and the office does not use the fingerprint reader. That is
     F72 exactly, two days later, in the one module where it would have ended up
     in somebody's review: **no taps is not evidence of absence** (F81).
     
     There is no honest percentage over a calendar here. A monthly person's
     calendar exists but the machine does not record them; a daily person is
     recorded but was never *scheduled* — they are called in. So the denominator
     is what is actually known: days carrying a tap or a mark. The numerator is
     days HRD marked **absent without explanation**, which is a fact somebody
     asserted rather than one inferred from silence. */
  /* `slots` is a **partial** record, so an absent tap is `undefined`, not
     `null` — and `undefined !== null` is true, so the first version counted
     every calendar day as recorded and rated all forty people at 100%. The
     same missing-data question answered wrongly in the opposite direction from
     the version before it (F81). Loose equality here, deliberately: it is the
     one comparison that means *has a value*. */
  const recorded = days.filter((d) => d.slots.in != null || d.mark != null);
  const unexplained = recorded.filter((d) => d.mark?.kind === "absent").length;
  /* A figure over two days is not the same claim as a figure over thirty, and
     presenting them identically lets a two-day sample carry a quarter of
     somebody's score. Below the floor the measure is **unmeasured**, not
     confidently 100%. */
  const minDays = settingNumber(state, "kpi.min_days_recorded", 5);
  const thin = recorded.length < minDays;
  const attendance: KpiMeasure = {
    key: "attendance",
    label: "Hadir tanpa mangkir",
    value: thin ? null : Math.round(((recorded.length - unexplained) / recorded.length) * 100),
    unmeasured_reason: !thin ? null
      : recorded.length === 0
        ? "Tidak ada satu hari pun pada periode ini yang punya catatan — tidak ada tap mesin dan tidak ada tanda hari dari HRD. Tidak ada catatan bukan berarti tidak masuk."
        : `Baru ${recorded.length} hari yang punya catatan, di bawah ambang ${minDays} hari. Persentase atas dua hari bukan persentase yang sama dengan atas tiga puluh.`,
    basis: thin
      ? `${recorded.length} hari tercatat`
      : `${recorded.length - unexplained} dari ${recorded.length} hari yang tercatat · hanya hari yang ditandai HRD sebagai mangkir yang dihitung; sakit bersurat dan cuti tidak pernah`,
    source: "Timesheet · tanda hari dari HRD",
    weight: settingNumber(state, "kpi.weight_attendance", 25),
  };

  /* ── Penyelesaian tugas ─────────────────────────────────────────────── */
  const mine = state.tasks.filter((t) => t.assignee_id === employee.id);
  const dueHere = mine.filter((t) => t.due_date >= from && t.due_date <= to);
  /* Cancelled is neither a success nor a failure; blocked is not the person's.
     Both leave the arithmetic rather than landing on one side of it. */
  const counted = dueHere.filter((t) => t.status !== "CANCELLED" && t.blocked_reason === null);
  const onTime = counted.filter((t) => {
    if (t.status !== "DONE") return false;
    return (t.done_at?.slice(0, 10) ?? "9999-12-31") <= t.due_date;
  }).length;
  const blocked = dueHere.filter((t) => t.blocked_reason !== null).length;
  const task_delivery: KpiMeasure = {
    key: "task_delivery",
    label: "Tugas selesai tepat waktu",
    value: counted.length === 0 ? null : Math.round((onTime / counted.length) * 100),
    unmeasured_reason: counted.length === 0
      ? dueHere.length === 0
        ? "Tidak ada tugas yang jatuh tempo pada periode ini. Tidak ada tugas bukan nilai nol — tidak ada yang diukur."
        : "Semua tugas periode ini dibatalkan atau tertahan menunggu pihak lain, jadi tidak ada yang bisa dinilai."
      : null,
    basis: counted.length === 0
      ? `${dueHere.length} tugas jatuh tempo, tidak ada yang dihitung`
      : `${onTime} dari ${counted.length} tugas${blocked > 0 ? ` · ${blocked} tertahan, tidak dihitung` : ""}`,
    source: "Task tracker",
    weight: settingNumber(state, "kpi.weight_tasks", 50),
  };

  const measures = [punctuality, attendance, task_delivery];
  const measured = measures.filter((m) => m.value !== null);
  const minMeasures = settingNumber(state, "kpi.min_measures", 2);

  /* A score over one axis out of three is that one axis wearing a costume. */
  const totalWeight = measured.reduce((a, m) => a + m.weight, 0);
  const score = measured.length < minMeasures || totalWeight === 0
    ? null
    : Math.round(measured.reduce((a, m) => a + (m.value ?? 0) * m.weight, 0) / totalWeight);
  const score_reason = score !== null ? null
    : `Baru ${measured.length} dari ${measures.length} ukuran yang bisa dihitung; nilai gabungan baru ditampilkan mulai ${minMeasures}. Angka gabungan dari satu ukuran hanya ukuran itu sendiri dengan nama lain.`;

  if (tapped.length === 0) {
    notes.push("Tidak ada data absensi mesin untuk orang ini pada periode ini.");
  }
  if (blocked > 0) {
    notes.push(`${blocked} tugas tertahan menunggu pihak lain — tidak dihitung sebagai kegagalan orang ini.`);
  }
  /* Production work: shown, attributed, and deliberately not scored (D264).
     The old note apologised in the abstract — *recorded against a name, not a
     person* — which was true and useless, because it told nobody what to do
     about it. Now the card says what this person made, how much of the
     period's work anybody can read at all, and how many names are waiting for
     an answer, which is a sentence somebody can act on. */
  const work = personWork(state, employee.id, from, to);
  const attribution = workAttribution(state, from, to);
  const coverage = Math.round(attribution.coverage * 100);

  if (work === null && attribution.unknown > 0) {
    notes.push(
      `Tidak ada pekerjaan produksi yang tertaut ke orang ini — dan ${attribution.unknown} entri periode ini masih atas nama yang belum ditautkan, jadi kosong di sini belum tentu berarti tidak mengerjakan apa pun.`,
    );
  } else if (work === null) {
    notes.push("Tidak ada pekerjaan produksi atas nama orang ini pada periode ini.");
  }
  if (work !== null) {
    notes.push("Hasil produksi ditampilkan sebagai bukti, bukan sebagai nilai: satu lemari dan satu nakas tidak bisa dijumlahkan, jadi jumlah potong bukan ukuran kinerja.");
  }

  return {
    employee_id: employee.id,
    employee_no: employee.employee_no,
    full_name: employee.full_name,
    position: employee.position,
    unit: employee.unit,
    period_start: from,
    period_end: to,
    measures,
    score,
    measured_count: measured.length,
    measure_count: measures.length,
    score_reason,
    overtime_hours: Math.round(days.reduce((a, d) => a + d.overtime_hours, 0) * 10) / 10,
    tasks_open: mine.filter((t) => t.status === "OPEN").length,
    tasks_blocked: mine.filter((t) => t.status === "OPEN" && t.blocked_reason !== null).length,
    work,
    work_attribution: {
      employee: attribution.employee,
      not_a_person: attribution.not_a_person,
      unknown: attribution.unknown,
      coverage,
    },
    notes,
  };
}

export function kpiViews(state: DemoState, from: string, to: string): KpiView[] {
  return state.employees
    .filter((e) => e.active)
    .map((e) => kpiView(state, e, from, to))
    /* Unscored last, then lowest first: the board's job is to put the person
       somebody has to talk to at the top — not to rank everybody. */
    .sort((a, b) => {
      if ((a.score === null) !== (b.score === null)) return a.score === null ? 1 : -1;
      return (a.score ?? 0) - (b.score ?? 0);
    });
}

/* ── Iuran wajib: siapa terdaftar, berapa tarifnya ────────────────────────── */

/** The rate version in force for a month — the latest one whose date is on or
 *  before the month's **first day**, the same rule the pay rules follow (D173).
 *  Null where none covers it, and null is not zero: an invoice of nil for a
 *  scheme everybody is enrolled in would be the quietest possible lie. */
export function rateFor(
  state: DemoState,
  scheme: ContributionScheme,
  month: string,
): ContributionRate | null {
  const first = `${month}-01`;
  return state.contribution_rates
    .filter((r) => r.scheme === scheme && r.effective_from <= first)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;
}

/** Was this person in this scheme at any point in this month?
 *
 *  **At any point**, not on the first of the month — because BPJS charges the
 *  month, so somebody who joined on the 20th is on that month's invoice. The
 *  line says which case it is rather than leaving a full month's charge looking
 *  like a full month's cover. */
function enrolledIn(month: string, en: Enrolment): boolean {
  const first = `${month}-01`;
  const last = `${month}-31`;
  if (en.enrolled_on > last) return false;
  if (en.ended_on && en.ended_on < first) return false;
  return true;
}

/** What a person's contribution is computed on.
 *
 *  The declared wage where one was registered, otherwise the pay record —
 *  **pokok + tunjangan** (D250), converted to a month for people paid by the
 *  day so that a daily worker and a salaried one are measured the same way. */
function contributionBase(state: DemoState, employee: Employee, month: string, en: Enrolment): {
  base: number;
  source: "declared" | "pay_record";
} {
  if (en.declared_base != null) return { base: en.declared_base, source: "declared" };
  const rules = activePayRules(state, `${month}-01`).rules;
  const days = Math.max(rules.effective_days_per_year, 1) / 12;
  const monthly = employee.pay_basis === "monthly"
    ? employee.base_rate + employee.allowance_rate * days
    : employee.pay_basis === "daily"
      ? (employee.base_rate + employee.allowance_rate) * days
      : employee.base_rate * employee.daily_hours * days + employee.allowance_rate * days;
  return { base: Math.round(monthly), source: "pay_record" };
}

/** One scheme, one month, name by name — the owner's own audit: *daftar nama
 *  terdaftar × biaya per orang* (D259). */
export function contributionRoll(
  state: DemoState,
  scheme: ContributionScheme,
  month: string,
): ContributionRoll {
  const rate = rateFor(state, scheme, month);
  const prev = previousMonthKey(month);

  const build = (m: string): ContributionLine[] => {
    const r = rateFor(state, scheme, m);
    return state.enrolments
      .filter((en) => en.scheme === scheme && enrolledIn(m, en))
      .map((en) => {
        const emp = state.employees.find((x) => x.id === en.employee_id);
        if (!emp) return null;
        const { base, source } = contributionBase(state, emp, m, en);
        const ceiling = r?.wage_ceiling ?? null;
        const capped = ceiling != null && base > ceiling;
        const applied = capped ? ceiling : base;
        /* No rate for the month means no figure, not a figure of zero. */
        const employer = r ? Math.round((applied * r.employer_percent) / 100) : 0;
        const employee = r ? Math.round((applied * r.employee_percent) / 100) : 0;
        const joinedHere = en.enrolled_on.slice(0, 7) === m;
        const leftHere = en.ended_on?.slice(0, 7) === m;
        return {
          employee_id: emp.id,
          employee_no: emp.employee_no,
          full_name: emp.full_name,
          scheme,
          member_no_masked: en.member_no ? maskDocNo(en.member_no) : null,
          base: applied,
          base_source: source,
          capped_from: capped ? base : null,
          employer, employee, total: employer + employee,
          /* BPJS charges the month whole, so a part-month is a full charge with
             a sentence rather than a pro-rated figure nobody agreed. */
          partial_month: joinedHere
            ? `Masuk ${en.enrolled_on} — iuran tetap sebulan penuh.`
            : leftHere
              ? `Berhenti ${en.ended_on} — bulan ini masih ditagih penuh.`
              : null,
        } satisfies ContributionLine;
      })
      .filter((x): x is ContributionLine => x !== null)
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  };

  const lines = build(month);
  const before = build(prev);
  const beforeNames = new Set(before.map((l) => l.employee_id));
  const nowNames = new Set(lines.map((l) => l.employee_id));

  const employer_total = lines.reduce((a, l) => a + l.employer, 0);
  const employee_total = lines.reduce((a, l) => a + l.employee, 0);

  return {
    scheme, month, rate, lines,
    headcount: lines.length,
    employer_total, employee_total,
    expected_total: employer_total + employee_total,
    /* Null where last month had nobody at all — a first month is not a
       hundred-per-cent increase (D228's rule, in a new place). */
    last_month_total: before.length === 0 ? null : before.reduce((a, l) => a + l.total, 0),
    joined: lines.filter((l) => !beforeNames.has(l.employee_id)).map((l) => l.full_name),
    left: before.filter((l) => !nowNames.has(l.employee_id)).map((l) => l.full_name),
  };
}

/** Every computed scheme for a month, for the screen that shows them together.
 *  `PPH21` is excluded deliberately — it is an enrolment, never a figure. */
export function allRolls(state: DemoState, month: string): ContributionRoll[] {
  return COMPUTED_SCHEMES.map((s) => contributionRoll(state, s, month));
}

/** The employee half, for one person, for the month a payroll period falls in.
 *
 *  Only the schemes they are **actually enrolled in**. A person with no
 *  enrolment row gets no deduction, and that is the gate: nothing appears on
 *  anybody's payslip because software was updated (D140, D259). */
export function contributionsForPerson(
  state: DemoState,
  employee: Employee,
  month: string,
): PayrollLine["contributions"] {
  return state.enrolments
    .filter((en) => en.employee_id === employee.id
      && COMPUTED_SCHEMES.includes(en.scheme)
      && enrolledIn(month, en))
    .map((en) => {
      const r = rateFor(state, en.scheme, month);
      if (!r) return null;
      const { base } = contributionBase(state, employee, month, en);
      const applied = r.wage_ceiling != null && base > r.wage_ceiling ? r.wage_ceiling : base;
      return {
        scheme: en.scheme,
        label: SCHEME_LABEL[en.scheme],
        base: applied,
        employee: Math.round((applied * r.employee_percent) / 100),
        employer: Math.round((applied * r.employer_percent) / 100),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.label.localeCompare(b.label));
}

function previousMonthKey(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** What one ordinary hour of this person is worth — **both answers**, and which
 *  one is in force.
 *
 *  Two arithmetics that used to be one number:
 *
 *  - **company** is `setahun gaji ÷ hari kerja efektif ÷ jam sehari`, which is
 *    how the owner works it out, and takes the tunjangan with it where the
 *    rules say to (*pakai pokok+allowance untuk perhitungan semua*).
 *  - **statutory** is a month over 173 — 40 hours × 52 weeks ÷ 12. It is right
 *    for the overtime ladder, which is written against it, and wrong as an
 *    answer to *what is an hour worth here*, because this office does not work
 *    a 40-hour week (D249).
 *
 *  Both are returned always. The figure in force is a rule, and a payslip that
 *  carried only it would hide the choice behind it — which is the thing the
 *  owner asked about in the first place: *dari mana pembagian 173 itu?*
 */
export function hourlyRate(employee: Employee, rules: PayRules): HourlyRate {
  const days = Math.max(rules.effective_days_per_year, 1);
  const hoursPerDay = Math.max(employee.daily_hours, 1);
  const withAllowance = rules.hourly_includes_allowance;
  const allowancePerDay = withAllowance ? employee.allowance_rate : 0;

  /* A year of this person's pay, however their pokok is quoted. The allowance
     is per day here (D250), so it enters the year multiplied by the days the
     business works and never by twelve. */
  const annual = employee.pay_basis === "monthly"
    ? employee.base_rate * 12 + allowancePerDay * days
    : employee.pay_basis === "daily"
      ? (employee.base_rate + allowancePerDay) * days
      : employee.base_rate * hoursPerDay * days + allowancePerDay * days;

  const company = Math.round(annual / days / hoursPerDay);

  /* The statutory divisor only means anything against a **monthly** wage.
     For somebody paid by the day or the hour there is no month to divide, so
     the two answers are the same answer — said here rather than left as a
     coincidence a reader has to work out. */
  const statutory = employee.pay_basis === "monthly"
    ? Math.round((employee.base_rate + (allowancePerDay * days) / 12) / Math.max(rules.monthly_divisor, 1))
    : company;

  return {
    hourly: rules.hourly_basis === "statutory" ? statutory : company,
    basis: rules.hourly_basis,
    company,
    statutory,
    annual: Math.round(annual),
    includes_allowance: withAllowance,
  };
}

/** Days in the period HRD has taken the tunjangan off, for one person.
 *
 *  A restored row is not one of them — it stays in the data and out of the
 *  arithmetic, which is what `restored_by` is for (A5). */
export function withholdingsFor(
  state: DemoState,
  employeeId: string,
  from: string,
  to: string,
): AllowanceWithholding[] {
  return state.allowance_withholdings
    .filter((w) => w.employee_id === employeeId
      && w.restored_by === null
      && w.work_date >= from && w.work_date <= to)
    .sort((a, b) => a.work_date.localeCompare(b.work_date));
}

/** Overtime, night by night and tier by tier.
 *
 *  Three rules meet here and the order matters:
 *
 *  1. **The paper wins where it speaks.** A GAJI figure written on the form is
 *     what the man signed for, and is paid as written (D154) — no ladder, no
 *     recomputation. A system that quietly pays a different number because its
 *     own multiplication came out differently is wrong even when its arithmetic
 *     is right.
 *  2. **Otherwise the ladder applies**, per night, because "the first hour" is
 *     the first hour of *that* night and not of the fortnight.
 *  3. **A rest day takes the steeper ladder**, and a tanggal merah counts as
 *     one (D173).
 */
export function overtimeParts(
  state: DemoState,
  employee: Employee,
  from: string,
  to: string,
  rules: PayRules,
  hourly: number,
): OvertimePart[] {
  const out: OvertimePart[] = [];

  for (const { line, sheet } of payableLinesOf(state, employee, from, to)) {
    if (line.form_amount != null) {
      out.push({
        source: sheet.sheet_no, work_date: sheet.work_date,
        hours: line.hours, multiplier: 0, hourly,
        amount: line.form_amount, label: "Sesuai form lembur",
      });
      continue;
    }
    if (rules.overtime_mode === "form_only") {
      out.push({
        source: sheet.sheet_no, work_date: sheet.work_date,
        hours: line.hours, multiplier: 0, hourly, amount: 0,
        label: "Tidak ada angka di form — tidak dibayar",
      });
      continue;
    }

    const hours = roundHours(line.hours, rules.overtime_rounding_minutes);
    const restDay = isRestDay(state, rules, sheet.work_date);
    const tiers = rules.overtime_mode === "flat"
      ? [{ after_hours: 0, multiplier: rules.flat_multiplier }]
      : restDay ? rules.restday_tiers : rules.workday_tiers;

    for (const part of tierParts(hours, tiers)) {
      out.push({
        source: sheet.sheet_no, work_date: sheet.work_date,
        hours: part.hours, multiplier: part.multiplier, hourly,
        amount: Math.round(part.hours * part.multiplier * hourly),
        label: rules.overtime_mode === "flat"
          ? `Tarif rata ${part.multiplier}×`
          : tierLabel(restDay, part.from, part.hours),
      });
    }
  }
  return out;
}

/** Hours short of the contracted day, and what the rule says they cost.
 *
 *  Only for people paid **by the day**: an hourly person is already paid for
 *  the hours they were here, and a monthly salary is a month. Days that are
 *  marked — sakit, cuti, tanggal merah — are not short days, they are
 *  different days, and counting them here would deduct twice (D174).
 */
export function undertimeOf(
  days: TimesheetDay[],
  employee: Employee,
  rules: PayRules,
  hourly: number,
): { hours: number; amount: number } {
  if (rules.undertime_mode === "off" || employee.pay_basis !== "daily") {
    return { hours: 0, amount: 0 };
  }
  const grace = rules.undertime_grace_minutes / 60;
  let short = 0;
  let halfDays = 0;
  for (const d of days) {
    if (d.mark || d.state !== "complete") continue;
    const gap = employee.daily_hours - d.work_hours;
    if (gap <= grace) continue;
    short += gap;
    if (gap > employee.daily_hours / 2) halfDays += 1;
  }
  short = Math.round(short * 100) / 100;
  if (rules.undertime_mode === "half_day_step") {
    return { hours: short, amount: Math.round(halfDays * (employee.base_rate / 2)) };
  }
  return { hours: short, amount: Math.round(short * hourly) };
}

/* The office day used to start at 08:00 in a constant here. It is a policy,
   not a fact, so it moved into the rule book where somebody can change it
   without a deployment — `rules.late_after_minutes` (D168, D173). */

/** 1 Monday … 7 Sunday, from a `YYYY-MM-DD` string without going near a
 *  timezone (F39). */
/** ISO weekday: Monday 1 … Sunday 7, matching `extract(isodow)` so the two
 *  implementations compare the same numbers. Exported because the effective
 *  days calendar needs it too, and a third copy of a day-of-week rule is a
 *  third chance to get Sunday wrong. */
export function weekdayOf(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

/** The same line under a rule book that is not in force. Preview only. */
export function payrollLineWith(
  state: DemoState, employee: Employee, from: string, to: string, rules: PayRules,
): PayrollLine {
  return payrollLine(state, employee, from, to, "", rules);
}

export function payrollView(state: DemoState, run: PayrollRun): PayrollView {
  /* Anybody employed during the period, including somebody who left inside
     it — their last week is still owed. */
  const people = state.employees.filter(
    (e) => e.joined_on <= run.period_end && (e.left_on === null || e.left_on >= run.period_start),
  );
  const lines = people.map((e) => payrollLine(state, e, run.period_start, run.period_end, run.run_no));

  return {
    ...run,
    lines,
    gross_total: lines.reduce((s, l) => s + l.gross, 0),
    net_total: lines.reduce((s, l) => s + l.net, 0),
    adjustment_total: lines.reduce((s, l) => s + l.adjustment_total, 0),
    open_days: lines.reduce((s, l) => s + l.days_open, 0),
    pending_overtime_hours: lines.reduce((s, l) => s + l.overtime_pending_hours, 0),
  };
}

/* ── Berkas 201 and leave ─────────────────────────────────────────────────── */

/** Somebody's file, slot by slot, with what is missing named (D177).
 *
 *  The checklist is the point. A folder answers "what is in here"; a checklist
 *  answers "what is not", which is the only version of the question anybody
 *  ever actually needs — before a BPJS registration, before an audit, before
 *  paying somebody whose contract ran out last month.
 */
/** What leaves the store for a screen.
 *
 *  The sensitive number is dropped here rather than hidden later, which is the
 *  whole difference between a reveal log that means something and one that
 *  records a click (D196). Everything a screen legitimately needs about the
 *  number — is there one, how long is it, is that length right — survives.
 */
export function docView(d: EmployeeDocument): EmployeeDocumentView {
  const sensitive = SENSITIVE_DOC_KINDS.has(d.kind);
  const digits = d.doc_no ? d.doc_no.replace(/[^0-9A-Za-z]/g, "").length : null;
  const want = DOC_NO_DIGITS[d.kind] ?? null;
  return {
    ...d,
    doc_no: sensitive ? null : d.doc_no,
    sensitive,
    doc_no_masked: d.doc_no ? maskDocNo(d.doc_no) : null,
    doc_no_length: digits,
    doc_no_length_ok: digits != null && want != null ? digits === want : null,
  };
}

export function employeeFile(state: DemoState, employee: Employee, today: string): EmployeeFileView {
  const mine = state.employee_documents.filter((d) => d.employee_id === employee.id);

  const slots: EmployeeDocSlot[] = EMPLOYEE_DOC_CHECKLIST.map((c) => {
    const documents = mine
      .filter((d) => d.kind === c.kind)
      .sort((a, b) => (b.issued_on ?? "").localeCompare(a.issued_on ?? ""))
      .map(docView);
    const expiries = documents.map((d) => d.expires_on).filter((x): x is string => !!x);
    const soonest = expiries.sort()[0] ?? null;
    return {
      kind: c.kind,
      label: EMPLOYEE_DOC_LABEL[c.kind],
      required: c.required,
      note: c.note,
      documents,
      expires_in_days: soonest ? daysBetween(today, soonest) : null,
    };
  });

  const missing = slots.filter((s) => s.required && s.documents.length === 0).map((s) => s.kind);
  /* Already expired, or expiring inside the warning window. Sixty days by
     default, because a PKWT renewal takes a conversation, not an afternoon —
     and it is a setting now, because how much notice this office wants is not
     a thing code should decide (D216). */
  const warnDays = settingNumber(state, "ops.doc_expiry_warning_days", 60);
  const expiring = slots
    .filter((s) => s.expires_in_days != null && s.expires_in_days <= warnDays)
    .map((s) => ({
      kind: s.kind,
      label: s.label,
      expires_on: s.documents.map((d) => d.expires_on).filter((x): x is string => !!x).sort()[0],
      days: s.expires_in_days as number,
    }));

  return {
    employee_id: employee.id,
    employee_no: employee.employee_no,
    full_name: employee.full_name,
    position: employee.position,
    unit: employee.unit,
    joined_on: employee.joined_on,
    active: employee.active,
    slots,
    missing,
    expiring,
    complete: missing.length === 0,
  };
}

/** Whole days between two `YYYY-MM-DD` strings, walked in UTC so the office day
 *  is not the browser's (F17, F39). */
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** Every date in an inclusive range. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const [y, m, d] = from.split("-").map(Number);
  let t = Date.UTC(y, m - 1, d);
  const end = (() => { const [ey, em, ed] = to.split("-").map(Number); return Date.UTC(ey, em - 1, ed); })();
  while (t <= end) {
    out.push(new Date(t).toISOString().slice(0, 10));
    t += 86_400_000;
  }
  return out;
}

/** What somebody has left, computed from the marks (A3, D178).
 *
 *  `taken` counts the days already marked; `booked` counts approved requests
 *  that have not become the past yet. Both matter: an employee asking on the
 *  first of the month wants to know what is left **after** the week they have
 *  already been given.
 */
export function leaveBalance(state: DemoState, employee: Employee, year: string): LeaveBalance {
  const marks = state.day_marks.filter(
    (m) => m.employee_id === employee.id && m.work_date.startsWith(year),
  );
  const leaveDays = marks.filter((m) => m.kind === "leave");
  const taken = leaveDays.length;
  const entitlement = employee.paid_leave_days;

  const booked = state.leave_requests
    .filter((r) => r.employee_id === employee.id && r.status === "APPROVED" && r.kind === "cuti")
    .flatMap((r) => datesBetween(r.from_date, r.to_date))
    .filter((d) => d.startsWith(year))
    /* Only the ones that have not already become marks — otherwise the same
       day is counted twice, which is how a balance ends up wrong in the
       employee's favour and nobody notices until December. */
    .filter((d) => !marks.some((m) => m.work_date === d && m.kind === "leave"))
    .length;

  const sick = marks.filter((m) => m.kind === "sick");
  return {
    employee_id: employee.id,
    employee_no: employee.employee_no,
    full_name: employee.full_name,
    entitlement,
    taken,
    booked,
    remaining: Math.max(entitlement - taken - booked, 0),
    over: Math.max(taken + booked - entitlement, 0),
    sick_days: sick.length,
    sick_without_letter: sick.filter((m) => !suratDokter(state, m)).length,
    permit_days: marks.filter((m) => m.kind === "permit").length,
  };
}

/** A request, with what it would cost before anybody decides (D178). */
export function leaveRequestView(state: DemoState, r: LeaveRequest): LeaveRequestView {
  const employee = state.employees.find((e) => e.id === r.employee_id);
  const dates = datesBetween(r.from_date, r.to_date);

  /* How these days would land if approved. Cuti is paid out of the balance and
     nothing else is (D144), so the split is known before the decision rather
     than after the payslip. */
  let paid = 0;
  if (employee && r.kind === "cuti") {
    const bal = leaveBalance(state, employee, r.from_date.slice(0, 4));
    paid = Math.min(dates.length, bal.remaining);
  } else if (r.kind === "sakit") {
    /* Sick is paid only with the letter, and the letter arrives with the day —
       not with the request. So a request cannot promise it. */
    paid = 0;
  }

  return {
    ...r,
    employee_no: employee?.employee_no ?? "—",
    full_name: employee?.full_name ?? "—",
    decided_by_name: r.decided_by
      ? state.users.find((u) => u.id === r.decided_by)?.full_name ?? null
      : null,
    paid_days: paid,
    unpaid_days: dates.length - paid,
    clashes: dates.filter((d) => state.day_marks.some(
      (m) => m.work_date === d && (m.employee_id === r.employee_id || m.employee_id === null),
    )),
  };
}
