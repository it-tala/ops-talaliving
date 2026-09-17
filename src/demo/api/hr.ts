/** Implements `/api/v1/hr` from `03-api.md`. */
import { ok, invalid, notFound, noop, refused, type Result } from "@/services/_shared/envelope";
import type {
  Employee, AttendanceScan, TimesheetDay, DayMark, DayMarkKind,
  OvertimeSheet, OvertimeLine, OvertimeSheetView, OvertimeKind,
  PayrollRun, PayrollView, PayBasis,
  AdjustmentKind, PayrollAdjustmentView,
  PayRules, PayRuleSet, PayRuleSetView,
  EmployeeDocKind, EmployeeFileView, DocNoSource, LeaveBalance, LeaveKind, LeaveRequestView, LeaveStatus,
  AllowanceWithholding, AllowanceWithholdingView,
  ContributionScheme, ContributionRate, ContributionRoll, Enrolment,
  Task, TaskView, TaskRefKind, KpiView,
} from "@/services/hr/contracts";
import { SENSITIVE_DOC_KINDS, SCHEME_LABEL, maskDocNo } from "@/services/hr/contracts";
import type { DocKind } from "@/services/documents/contracts";
import type { DemoState } from "../state";
import { getState, apply, newId, nextDocNumber, writeAudit, writeOutbox } from "../store";
import {
  timesheet, timesheetDay, payrollView, overtimeStage, overtimePayable, sheetEvidence,
  activePayRules, payrollLine, payrollLineWith,
  employeeFile, leaveBalance, leaveRequestView, datesBetween,
  contributionRoll, allRolls,
  taskView, taskViews, kpiView, kpiViews,
} from "../hr-derive";
import { latency, actingUser, requireModule, requireLevel, requireAuthority, conflict, replayed, remember } from "./_kit";
import { officeToday as sharedOfficeToday } from "@/lib/office";

const SERVICE = "hr" as const;

/** A sheet with its lines, its stage and the paper behind it — how every
 *  screen wants it, and how nothing stores it (D146). */
function sheetView(state: ReturnType<typeof getState>, sheet: OvertimeSheet): OvertimeSheetView {
  const lines = state.overtime_lines
    .filter((l) => l.sheet_id === sheet.id)
    .map((l) => {
      const emp = state.employees.find((e) => e.id === l.employee_id);
      return { ...l, employee_no: emp?.employee_no ?? "—", full_name: emp?.full_name ?? "—" };
    });
  const link = sheetEvidence(state, sheet.id);
  const att = link ? state.attachments.find((a) => a.id === link.attachment_id) : null;
  return {
    ...sheet,
    lines,
    stage: overtimeStage(state, sheet),
    payable: overtimePayable(state, sheet),
    total_hours: Math.round(lines.reduce((a, l) => a + l.hours, 0) * 100) / 100,
    evidence: att && link
      ? { attachment_id: att.id, filename: att.filename, kind: link.kind }
      : null,
  };
}

export async function listEmployees(opts: { include_left?: boolean } = {}): Promise<Result<Employee[]>> {
  await latency();
  const rows = getState().employees
    .filter((e) => opts.include_left || e.active)
    .sort((a, b) => a.employee_no.localeCompare(b.employee_no));
  return ok(SERVICE, rows);
}

export async function getEmployee(employeeNo: string): Promise<Result<Employee>> {
  await latency();
  const found = getState().employees.find((e) => e.employee_no === employeeNo);
  if (!found) return notFound(SERVICE, "employee_not_found", `No employee ${employeeNo}.`);
  return ok(SERVICE, found);
}

/** Adding somebody, or changing what they are paid.
 *
 *  A rate change is append-only in spirit: the audit row carries the figure
 *  before and after, because "when did his rate go up, and who said so" is the
 *  question a payroll dispute turns on.
 */
export async function saveEmployee(
  input: {
    employee_no: string;
    full_name: string;
    position: string;
    unit: string;
    pay_basis: PayBasis;
    base_rate: number;
    /** Tunjangan harian. Optional, and **absent means unchanged** rather than
     *  zero: a save that forgot this field must not quietly stop paying
     *  somebody's allowance (D250). */
    allowance_rate?: number;
    daily_hours?: number;
    paid_leave_days?: number;
    joined_on?: string;
    note?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<Employee>> {
  await latency();
  const cached = replayed<Employee>(SERVICE, "saveEmployee", idempotencyKey);
  if (cached) return cached;

  const denied = requireModule(SERVICE, "hrd");
  if (denied) return denied;

  if (!input.full_name.trim()) {
    return invalid(SERVICE, "name_required", "Somebody's name is the one thing a payslip cannot do without.", { field: "full_name" });
  }
  if (!input.employee_no.trim()) {
    return invalid(SERVICE, "employee_no_required", "The number on the fingerprint machine — it is how attendance finds them.", { field: "employee_no" });
  }
  if (!input.base_rate || input.base_rate <= 0) {
    return invalid(SERVICE, "rate_required", "A rate of zero is not a rate. Put what they are actually paid.", { field: "base_rate" });
  }
  if (input.allowance_rate != null && input.allowance_rate < 0) {
    return invalid(SERVICE, "allowance_negative", "Tunjangan tidak bisa negatif. Potongan ditulis sebagai potongan, dengan alasannya.", { field: "allowance_rate" });
  }

  const state = getState();
  const existing = state.employees.find((e) => e.employee_no === input.employee_no.trim());
  const user = actingUser();
  let saved: Employee | null = null;

  apply((draft) => {
    if (existing) {
      const row = draft.employees.find((e) => e.employee_no === existing.employee_no);
      if (!row) return;
      const before = { base_rate: row.base_rate, allowance_rate: row.allowance_rate, pay_basis: row.pay_basis, position: row.position };
      Object.assign(row, {
        full_name: input.full_name.trim(),
        position: input.position.trim() || row.position,
        unit: input.unit.trim() || row.unit,
        pay_basis: input.pay_basis,
        base_rate: Math.round(input.base_rate),
        allowance_rate: input.allowance_rate != null ? Math.round(input.allowance_rate) : row.allowance_rate,
        daily_hours: input.daily_hours ?? row.daily_hours,
        paid_leave_days: input.paid_leave_days ?? row.paid_leave_days,
        note: input.note?.trim() ?? row.note,
      });
      saved = row;
      writeAudit(draft, {
        service: SERVICE, entity: "employee", entity_no: row.employee_no,
        action: "update", outcome: "ok", reason: null,
        detail: { before, after: { base_rate: row.base_rate, allowance_rate: row.allowance_rate, pay_basis: row.pay_basis, position: row.position }, by: user.email },
      });
    } else {
      const row: Employee = {
        id: newId("emp"),
        employee_no: input.employee_no.trim(),
        full_name: input.full_name.trim(),
        position: input.position.trim(),
        unit: input.unit.trim() || "Workshop",
        pay_basis: input.pay_basis,
        base_rate: Math.round(input.base_rate),
        allowance_rate: Math.round(input.allowance_rate ?? 0),
        daily_hours: input.daily_hours ?? 8,
        paid_leave_days: input.paid_leave_days ?? 12,
        joined_on: input.joined_on ?? new Date().toISOString().slice(0, 10),
        active: true,
        left_on: null,
        note: input.note?.trim() || null,
      };
      draft.employees.push(row);
      saved = row;
      writeAudit(draft, {
        service: SERVICE, entity: "employee", entity_no: row.employee_no,
        action: "create", outcome: "ok", reason: null,
        detail: { pay_basis: row.pay_basis, base_rate: row.base_rate, allowance_rate: row.allowance_rate, by: user.email },
      });
    }
  });
  const view = saved as Employee | null;
  if (!view) return invalid(SERVICE, "not_saved", "The record could not be written.", { field: "employee_no" });
  remember(SERVICE, "saveEmployee", idempotencyKey, view);
  return ok(SERVICE, view);
}

export async function attendanceFor(
  input: { employee_no: string; from: string; to: string },
): Promise<Result<TimesheetDay[]>> {
  await latency();
  const state = getState();
  const emp = state.employees.find((e) => e.employee_no === input.employee_no);
  if (!emp) return notFound(SERVICE, "employee_not_found", `No employee ${input.employee_no}.`);
  return ok(SERVICE, timesheet(state, emp, input.from, input.to));
}

/** The whole workshop for a week, one row per person per day.
 *
 *  This is the screen the payroll depends on: until a person has read every
 *  day the machine could not, the figures below are arithmetic rather than
 *  wages (D141).
 */
export async function getTimesheet(
  input: { from: string; to: string; unit?: string },
): Promise<Result<{
  days: TimesheetDay[];
  dates: string[];
  employees: { employee_no: string; full_name: string; pay_basis: PayBasis }[];
  needs_review: number;
  marked: number;
}>> {
  await latency();
  const state = getState();
  const people = state.employees.filter(
    (e) => e.active && (!input.unit || e.unit === input.unit),
  );
  const days = people.flatMap((e) => timesheet(state, e, input.from, input.to));
  const dates = [...new Set(days.map((d) => d.work_date))].sort();
  return ok(SERVICE, {
    days,
    dates,
    employees: people.map((e) => ({
      employee_no: e.employee_no, full_name: e.full_name, pay_basis: e.pay_basis,
    })),
    needs_review: days.filter((d) => d.state === "review").length,
    marked: days.filter((d) => d.state === "marked").length,
  });
}

/** One day, in full — every tap and how the rule read it. */
export async function getDay(
  input: { employee_no: string; work_date: string },
): Promise<Result<TimesheetDay>> {
  await latency();
  const state = getState();
  const emp = state.employees.find((e) => e.employee_no === input.employee_no);
  if (!emp) return notFound(SERVICE, "employee_not_found", `No employee ${input.employee_no}.`);
  return ok(SERVICE, timesheetDay(state, emp, input.work_date));
}

/** Taking the machine's export.
 *
 *  The file is one row per tap, `Date/Time` as `DD/MM/YYYY HH:MM:SS`, and the
 *  employee is the machine's own `No.` — which is why an employee carries that
 *  number rather than a name match. Nothing is invented: a number the system
 *  does not know is **reported back, not created**, because a person the
 *  payroll has never heard of is a question, not a row (D143).
 *
 *  Re-uploading the same file changes nothing. A tap is identified by who, and
 *  when, to the second.
 */
export async function importScans(
  input: { filename: string; rows: { employee_ref: string; at: string; verify: string; location?: string | null }[] },
  idempotencyKey?: string,
): Promise<Result<{ import_id: string; added: number; duplicates: number; unknown: { ref: string; count: number }[] }>> {
  await latency();
  const cached = replayed<{ import_id: string; added: number; duplicates: number; unknown: { ref: string; count: number }[] }>(
    SERVICE, "importScans", idempotencyKey,
  );
  if (cached) return cached;

  const denied = requireModule(SERVICE, "hrd");
  if (denied) return denied;
  if (input.rows.length === 0) {
    return invalid(SERVICE, "empty_file", "That file has no scans in it.", { field: "rows" });
  }

  const state = getState();
  const byRef = new Map(state.employees.map((e) => [e.employee_no.replace(/^B-0*/, ""), e]));
  const seen = new Set(state.attendance_scans.map((s) => `${s.employee_id}|${s.at}`));

  const user = actingUser();
  const importId = newId("imp");
  let added = 0;
  let duplicates = 0;
  const unknown = new Map<string, number>();

  apply((draft) => {
    for (const row of input.rows) {
      const emp = byRef.get(row.employee_ref.replace(/^0+/, ""));
      if (!emp) {
        unknown.set(row.employee_ref, (unknown.get(row.employee_ref) ?? 0) + 1);
        continue;
      }
      const key = `${emp.id}|${row.at}`;
      if (seen.has(key)) { duplicates += 1; continue; }
      seen.add(key);
      added += 1;
      draft.attendance_scans.push({
        id: newId("scn"),
        employee_id: emp.id,
        work_date: row.at.slice(0, 10),
        at: row.at,
        verify: row.verify,
        location: row.location ?? null,
        source: "import",
        import_id: importId,
        reason: null,
        recorded_by: user.id,
        recorded_at: new Date().toISOString(),
      });
    }
    writeAudit(draft, {
      service: SERVICE, entity: "attendance_import", entity_no: importId,
      action: "import", outcome: "ok", reason: input.filename,
      detail: {
        rows: input.rows.length, added, duplicates,
        unknown: [...unknown.keys()], by: user.email,
      },
    });
  });

  const result = {
    import_id: importId, added, duplicates,
    unknown: [...unknown.entries()].map(([ref, count]) => ({ ref, count })),
  };
  remember(SERVICE, "importScans", idempotencyKey, result);
  return ok(SERVICE, result);
}

/** Putting in a tap the machine did not record.
 *
 *  Always by hand, always with a reason. The reason is what separates a
 *  correction from a favour three months later (D137).
 */
export async function addScan(
  input: { employee_no: string; work_date: string; time: string; reason: string },
): Promise<Result<AttendanceScan>> {
  await latency();
  const denied = requireModule(SERVICE, "hrd");
  if (denied) return denied;

  const state = getState();
  const emp = state.employees.find((e) => e.employee_no === input.employee_no);
  if (!emp) return notFound(SERVICE, "employee_not_found", `No employee ${input.employee_no}.`);
  if (!input.reason.trim()) {
    return invalid(
      SERVICE, "reason_required",
      "A time somebody typed needs to say why the machine missed it.",
      { field: "reason" },
    );
  }

  const user = actingUser();
  let row: AttendanceScan | null = null;
  apply((draft) => {
    row = {
      id: newId("scn"),
      employee_id: emp.id,
      work_date: input.work_date,
      at: `${input.work_date}T${input.time}:00+08:00`,
      verify: "MANUAL",
      location: null,
      source: "manual",
      import_id: null,
      reason: input.reason.trim(),
      recorded_by: user.id,
      recorded_at: new Date().toISOString(),
    };
    draft.attendance_scans.push(row);
    writeAudit(draft, {
      service: SERVICE, entity: "attendance", entity_no: `${emp.employee_no}/${input.work_date}`,
      action: "add_scan", outcome: "ok", reason: input.reason.trim(),
      detail: { at: input.time, by: user.email },
    });
  });
  return ok(SERVICE, row as unknown as AttendanceScan);
}

/** What HRD says about a day the reader cannot describe.
 *
 *  A public holiday, an afternoon the power went, somebody off sick. Marking
 *  is not editing: the taps stay exactly as they were, and a mark for
 *  everybody carries no employee at all (D142).
 */
export async function markDay(
  input: { work_date: string; kind: DayMarkKind; reason: string; employee_no?: string | null },
): Promise<Result<DayMark>> {
  await latency();
  const denied = requireModule(SERVICE, "hrd");
  if (denied) return denied;

  if (!input.reason.trim()) {
    return invalid(
      SERVICE, "reason_required",
      "Say what happened. *Setengah hari* with no reason is a decision nobody can check in six months.",
      { field: "reason" },
    );
  }
  const state = getState();
  const emp = input.employee_no
    ? state.employees.find((e) => e.employee_no === input.employee_no)
    : null;
  if (input.employee_no && !emp) {
    return notFound(SERVICE, "employee_not_found", `No employee ${input.employee_no}.`);
  }
  const clash = state.day_marks.find(
    (m) => m.work_date === input.work_date && (m.employee_id ?? null) === (emp?.id ?? null),
  );
  if (clash) {
    return conflict(
      SERVICE, "already_marked",
      `${input.work_date} is already marked as ${clash.kind}${emp ? ` for ${emp.full_name}` : " for everybody"}.`,
    );
  }

  const user = actingUser();
  let mark: DayMark | null = null;
  apply((draft) => {
    mark = {
      id: newId("dmk"),
      employee_id: emp?.id ?? null,
      work_date: input.work_date,
      kind: input.kind,
      reason: input.reason.trim(),
      marked_by: user.id,
      marked_at: new Date().toISOString(),
    };
    draft.day_marks.push(mark);
    writeAudit(draft, {
      service: SERVICE, entity: "day_mark", entity_no: `${input.work_date}/${emp?.employee_no ?? "ALL"}`,
      action: "mark", outcome: "ok", reason: input.reason.trim(),
      detail: { kind: input.kind, by: user.email },
    });
  });
  return ok(SERVICE, mark as unknown as DayMark);
}

/** Taking a mark off. It happens — the holiday was the Tuesday, not the
 *  Monday — and it is an act with a name on it like any other. */
/** HRD saying one person does not get one day's tunjangan, and why (D250).
 *
 *  Deliberately **not** a day mark. A mark says what the day was; this says
 *  what somebody decided about the money, and the two come apart on the case
 *  the owner named first: a WFH day was worked, the timesheet is right, and
 *  the allowance is still not paid. Folding it into the mark would make the
 *  timesheet lie about the day in order to get the pay right.
 *
 *  It refuses on a day already inside an approved run, for the reason every
 *  refusal in this module gives: that figure has been signed.
 */
export async function withholdAllowance(
  input: { employee_no: string; work_date: string; reason: string },
  idempotencyKey?: string,
): Promise<Result<AllowanceWithholdingView>> {
  await latency();
  const cached = replayed<AllowanceWithholdingView>(SERVICE, "withholdAllowance", idempotencyKey);
  if (cached) return cached;

  const denied = requireModule(SERVICE, "hrd");
  if (denied) return denied;

  if (!input.reason.trim()) {
    return invalid(
      SERVICE, "reason_required",
      "Tunjangan yang hilang tanpa alasan tertulis adalah pertanyaan yang tidak bisa dijawab tiga bulan lagi. Tulis sebabnya — WFH, setengah hari, apa pun.",
      { field: "reason" },
    );
  }

  const state = getState();
  const emp = state.employees.find((e) => e.employee_no === input.employee_no);
  if (!emp) return notFound(SERVICE, "employee_not_found", `No employee ${input.employee_no}.`);

  const locked = state.payroll_runs.find(
    (r) => r.status === "APPROVED" && input.work_date >= r.period_start && input.work_date <= r.period_end,
  );
  if (locked) {
    return conflict(
      SERVICE, "run_approved",
      `${input.work_date} sudah masuk run ${locked.run_no} yang disetujui. Angkanya sudah ditandatangani — koreksinya lewat penyesuaian di run berikutnya, bukan dengan mengubah yang lalu.`,
    );
  }

  const already = state.allowance_withholdings.find(
    (w) => w.employee_id === emp.id && w.work_date === input.work_date && w.restored_by === null,
  );
  if (already) {
    return conflict(
      SERVICE, "already_withheld",
      `Tunjangan ${emp.full_name} tanggal ${input.work_date} sudah ditahan: ${already.reason}`,
    );
  }

  const user = actingUser();
  let row: AllowanceWithholding | null = null;
  apply((draft) => {
    row = {
      id: newId("awh"),
      employee_id: emp.id,
      work_date: input.work_date,
      reason: input.reason.trim(),
      by: user.id,
      at: new Date().toISOString(),
      restored_by: null, restored_at: null, restored_reason: null,
    };
    draft.allowance_withholdings.push(row);
    writeAudit(draft, {
      service: SERVICE, entity: "allowance_withholding", entity_no: `${input.work_date}/${emp.employee_no}`,
      action: "withhold", outcome: "ok", reason: input.reason.trim(),
      detail: { amount: emp.allowance_rate, by: user.email },
    });
  });
  const result = ok(SERVICE, viewWithholding(getState(), row as unknown as AllowanceWithholding));
  remember(SERVICE, "withholdAllowance", idempotencyKey, result);
  return result;
}

/** Putting it back. The row stays — restoring is a second decision, not an
 *  erasure, and *why was this not paid* must stay answerable after somebody
 *  changes their mind (A5). */
export async function restoreAllowance(
  input: { id: string; reason: string },
): Promise<Result<AllowanceWithholdingView>> {
  await latency();
  const denied = requireModule(SERVICE, "hrd");
  if (denied) return denied;

  if (!input.reason.trim()) {
    return invalid(
      SERVICE, "reason_required",
      "Mengembalikan tunjangan juga sebuah keputusan. Tulis kenapa — biasanya karena yang pertama salah baca.",
      { field: "reason" },
    );
  }

  const state = getState();
  const found = state.allowance_withholdings.find((w) => w.id === input.id);
  if (!found) return notFound(SERVICE, "withholding_not_found", `No withholding ${input.id}.`);
  if (found.restored_by) {
    /* Already put back. Nothing to do and nothing to complain about — the
       answer is the row itself, marked `noop`. */
    return noop(SERVICE, viewWithholding(state, found));
  }

  const user = actingUser();
  apply((draft) => {
    const row = draft.allowance_withholdings.find((w) => w.id === input.id);
    if (!row) return;
    row.restored_by = user.id;
    row.restored_at = new Date().toISOString();
    row.restored_reason = input.reason.trim();
    const emp = draft.employees.find((e) => e.id === row.employee_id);
    writeAudit(draft, {
      service: SERVICE, entity: "allowance_withholding",
      entity_no: `${row.work_date}/${emp?.employee_no ?? row.employee_id}`,
      action: "restore", outcome: "ok", reason: input.reason.trim(),
      detail: { by: user.email },
    });
  });
  const after = getState().allowance_withholdings.find((w) => w.id === input.id)!;
  return ok(SERVICE, viewWithholding(getState(), after));
}

/** Every decision, restored ones included — the list is the record. */
export async function listWithholdings(
  opts: { employee_no?: string; from?: string; to?: string } = {},
): Promise<Result<AllowanceWithholdingView[]>> {
  await latency();
  const denied = requireModule(SERVICE, "hrd");
  if (denied) return denied;
  const state = getState();
  const emp = opts.employee_no
    ? state.employees.find((e) => e.employee_no === opts.employee_no)
    : null;
  const rows = state.allowance_withholdings
    .filter((w) => (!emp || w.employee_id === emp.id)
      && (!opts.from || w.work_date >= opts.from)
      && (!opts.to || w.work_date <= opts.to))
    .map((w) => viewWithholding(state, w))
    .sort((a, b) => b.work_date.localeCompare(a.work_date));
  return ok(SERVICE, rows);
}

function viewWithholding(state: DemoState, w: AllowanceWithholding): AllowanceWithholdingView {
  const emp = state.employees.find((e) => e.id === w.employee_id);
  const name = (id: string | null) => id ? state.users.find((u) => u.id === id)?.full_name ?? id : null;
  return {
    ...w,
    employee_no: emp?.employee_no ?? "—",
    full_name: emp?.full_name ?? "—",
    by_name: name(w.by) ?? w.by,
    restored_by_name: name(w.restored_by),
    /* The person's rate **as it stands**, not as it stood. Said in the contract
       and worth repeating: this is context for the decision, not a stored
       amount, and a rate that has since changed will move it. */
    amount: emp?.allowance_rate ?? 0,
  };
}

export async function unmarkDay(markId: string): Promise<Result<{ removed: string }>> {
  await latency();
  const denied = requireModule(SERVICE, "hrd");
  if (denied) return denied;

  const state = getState();
  const mark = state.day_marks.find((m) => m.id === markId);
  if (!mark) return notFound(SERVICE, "mark_not_found", "No such mark.");

  const user = actingUser();
  apply((draft) => {
    draft.day_marks = draft.day_marks.filter((m) => m.id !== markId);
    writeAudit(draft, {
      service: SERVICE, entity: "day_mark", entity_no: `${mark.work_date}/${mark.employee_id ?? "ALL"}`,
      action: "unmark", outcome: "ok", reason: mark.reason,
      detail: { kind: mark.kind, by: user.email },
    });
  });
  return ok(SERVICE, { removed: markId });
}

/** Opening a sheet.
 *
 *  A **production** sheet is one night with many names on it; a **staff**
 *  sheet is one session with one name and that person's own report (D146).
 *  The kind is chosen when the sheet is opened because it decides who has to
 *  sign — and that is not a detail to discover at the end.
 */
export async function createOvertimeSheet(
  input: { kind: OvertimeKind; work_date: string; purpose: string },
  idempotencyKey?: string,
): Promise<Result<OvertimeSheetView>> {
  await latency();
  const cached = replayed<OvertimeSheetView>(SERVICE, "createOvertimeSheet", idempotencyKey);
  if (cached) return cached;

  const denied = requireModule(SERVICE, "hrd");
  if (denied) return denied;
  if (!input.purpose.trim()) {
    return invalid(
      SERVICE, "purpose_required",
      "Kenapa ada lembur malam itu? Lembur tanpa alasan adalah kebiasaan, bukan keputusan.",
      { field: "purpose" },
    );
  }

  const user = actingUser();
  let sheetNo = "";
  let id = "";
  apply((draft) => {
    sheetNo = nextDocNumber(draft, "lbr");
    id = newId("lbr");
    draft.overtime_sheets.push({
      id, sheet_no: sheetNo, kind: input.kind,
      work_date: input.work_date,
      purpose: input.purpose.trim(),
      created_by: user.id, created_at: new Date().toISOString(),
      hrd_checked_by: null, hrd_checked_at: null,
      leader_approved_by: null, leader_approved_at: null,
      /* Staff sessions ship paid; production sheets are paid by the
         leadership signature, and this flag is not what decides them. */
      paid: true, unpaid_reason: null,
      declined_by: null, declined_reason: null,
    });
    writeAudit(draft, {
      service: SERVICE, entity: "overtime_sheet", entity_no: sheetNo,
      action: "create", outcome: "ok", reason: input.purpose.trim(),
      detail: { kind: input.kind, work_date: input.work_date, by: user.email },
    });
  });
  const state = getState();
  const view = sheetView(state, state.overtime_sheets.find((x) => x.id === id)!);
  remember(SERVICE, "createOvertimeSheet", idempotencyKey, view);
  return ok(SERVICE, view);
}

/** Adding a name to a sheet.
 *
 *  On a production sheet the line also carries **what was made**: the work
 *  order, the stage and how many. Those three are the production report for
 *  that night, and the reason they are typed here rather than twice is that
 *  two copies of the same fact start disagreeing the week after (D147).
 */
export async function addOvertimeLine(
  input: {
    sheet_no: string;
    employee_no: string;
    hours: number;
    task: string;
    wo_no?: string | null;
    stage?: string | null;
    qty_done?: number | null;
    /** The GAJI column of the paper form, when the sheet carries one (D154). */
    form_amount?: number | null;
  },
): Promise<Result<OvertimeSheetView>> {
  await latency();
  const denied = requireModule(SERVICE, "hrd");
  if (denied) return denied;

  const state = getState();
  const sheet = state.overtime_sheets.find((x) => x.sheet_no === input.sheet_no);
  if (!sheet) return notFound(SERVICE, "sheet_not_found", `No sheet ${input.sheet_no}.`);
  if (sheet.leader_approved_at || sheet.hrd_checked_at) {
    return conflict(
      SERVICE, "sheet_closed",
      `${sheet.sheet_no} sudah diperiksa. Nama baru masuk lembar baru — menambah nama ke lembar yang sudah ditandatangani berarti tanda tangannya tidak lagi menunjuk apa yang ditandatangani.`,
    );
  }
  const emp = state.employees.find((e) => e.employee_no === input.employee_no);
  if (!emp) return notFound(SERVICE, "employee_not_found", `No employee ${input.employee_no}.`);
  if (input.hours <= 0) {
    return invalid(SERVICE, "hours_required", "Lembur nol jam bukan lembur.", { field: "hours" });
  }
  if (!input.task.trim()) {
    return invalid(SERVICE, "task_required", "Apa yang dikerjakan?", { field: "task" });
  }
  if (state.overtime_lines.some((l) => l.sheet_id === sheet.id && l.employee_id === emp.id)) {
    return conflict(SERVICE, "already_on_sheet", `${emp.full_name} sudah ada di lembar ini.`);
  }

  const user = actingUser();
  apply((draft) => {
    const row: OvertimeLine = {
      id: newId("lbl"), sheet_id: sheet.id, employee_id: emp.id,
      hours: input.hours, task: input.task.trim(),
      wo_no: input.wo_no?.trim() || null,
      stage: input.stage?.trim() || null,
      qty_done: input.qty_done ?? null,
      form_amount: input.form_amount ?? null,
    };
    draft.overtime_lines.push(row);
    writeAudit(draft, {
      service: SERVICE, entity: "overtime_sheet", entity_no: sheet.sheet_no,
      action: "add_line", outcome: "ok", reason: input.task.trim(),
      detail: { employee: emp.employee_no, hours: input.hours, wo_no: row.wo_no, stage: row.stage, qty: row.qty_done, by: user.email },
    });
  });
  return getOvertimeSheet(sheet.sheet_no);
}

/** Attaching the paper: the signed sheet for production, the work report —
 *  usually a screenshot — for a staff session (D146). */
export async function attachOvertimeDoc(
  input: { sheet_no: string; attachment_id: string },
): Promise<Result<OvertimeSheetView>> {
  await latency();
  const denied = requireModule(SERVICE, "hrd");
  if (denied) return denied;

  const state = getState();
  const sheet = state.overtime_sheets.find((x) => x.sheet_no === input.sheet_no);
  if (!sheet) return notFound(SERVICE, "sheet_not_found", `No sheet ${input.sheet_no}.`);
  if (!state.attachments.some((a) => a.id === input.attachment_id)) {
    return notFound(SERVICE, "attachment_not_found", "That file is not on the system.");
  }

  const user = actingUser();
  const kind = sheet.kind === "production" ? "Surat Lembur" : "Laporan Lembur";
  apply((draft) => {
    draft.attachment_links.push({
      id: newId("lnk"), attachment_id: input.attachment_id,
      entity: "overtime", entity_no: sheet.id, kind,
      linked_by: user.id, linked_at: new Date().toISOString(),
    });
    writeAudit(draft, {
      service: SERVICE, entity: "overtime_sheet", entity_no: sheet.sheet_no,
      action: "attach", outcome: "ok", reason: null,
      detail: { kind, attachment_id: input.attachment_id, by: user.email },
    });
  });
  return getOvertimeSheet(sheet.sheet_no);
}

/** Deciding a sheet.
 *
 *  Owner (2026-09-11): **only production overtime needs leadership.** A staff
 *  session is HRD's decision alone, and the default is yes — so `hrd` on a
 *  staff sheet means *I have looked*, and turning it down is a separate,
 *  explicit act carrying a reason.
 *
 *  On a production sheet the two steps check different things: HRD checks the
 *  hours against the taps, leadership signs the sheet — holding it, which is
 *  why the scan has to be attached before that signature is allowed (D146).
 */
export async function decideOvertimeSheet(
  input: {
    sheet_no: string;
    step: "hrd" | "leader";
    approved: boolean;
    reason?: string | null;
  },
): Promise<Result<OvertimeSheetView>> {
  await latency();
  const state0 = getState();
  const sheet0 = state0.overtime_sheets.find((x) => x.sheet_no === input.sheet_no);
  if (!sheet0) return notFound(SERVICE, "sheet_not_found", `No sheet ${input.sheet_no}.`);

  const denied = input.step === "hrd"
    ? requireModule(SERVICE, "hrd")
    : requireAuthority(SERVICE, "approve_overtime");
  if (denied) return denied;

  if (input.step === "leader" && sheet0.kind === "staff") {
    return invalid(
      SERVICE, "no_leader_needed",
      "Lembur staff tidak perlu tanda tangan pimpinan — HRD yang memutuskan (D146).",
      { field: "step" },
    );
  }
  if (sheet0.declined_reason) {
    return conflict(SERVICE, "already_decided", `${sheet0.sheet_no} sudah ditolak.`);
  }
  if (!input.approved && !input.reason?.trim()) {
    return invalid(
      SERVICE, "reason_required",
      "Menolak lembur yang sudah dikerjakan butuh satu kalimat.",
      { field: "reason" },
    );
  }
  if (state0.overtime_lines.filter((l) => l.sheet_id === sheet0.id).length === 0) {
    return invalid(SERVICE, "empty_sheet", "Lembar ini belum ada namanya.", { field: "lines" });
  }

  if (input.step === "leader") {
    if (!sheet0.hrd_checked_at) {
      return conflict(
        SERVICE, "hrd_first",
        "HRD belum memeriksa jamnya. Pimpinan menandatangani setelah HRD, bukan menggantikannya.",
      );
    }
    if (sheet0.leader_approved_at) {
      return conflict(SERVICE, "already_decided", "Pimpinan sudah menandatangani lembar ini.");
    }
    if (input.approved && !sheetEvidence(state0, sheet0.id, "Surat Lembur")) {
      return invalid(
        SERVICE, "surat_required",
        "Surat lembur belum dilampirkan. Pimpinan menandatangani suratnya — tanpa itu yang disetujui hanya angka.",
        { field: "surat_lembur" },
      );
    }
  }

  const user = actingUser();
  apply((draft) => {
    const row = draft.overtime_sheets.find((x) => x.sheet_no === input.sheet_no);
    if (!row) return;
    if (input.step === "hrd") {
      row.hrd_checked_by = user.id;
      row.hrd_checked_at = new Date().toISOString();
      if (row.kind === "staff") {
        row.paid = input.approved;
        row.unpaid_reason = input.approved ? null : input.reason?.trim() ?? null;
      } else if (!input.approved) {
        row.declined_by = user.id;
        row.declined_reason = input.reason?.trim() ?? null;
      }
    } else if (input.approved) {
      row.leader_approved_by = user.id;
      row.leader_approved_at = new Date().toISOString();
    } else {
      row.declined_by = user.id;
      row.declined_reason = input.reason?.trim() ?? null;
    }
    writeAudit(draft, {
      service: SERVICE, entity: "overtime_sheet", entity_no: row.sheet_no,
      action: `${input.approved ? "approve" : "decline"}_${input.step}`, outcome: "ok",
      reason: input.reason?.trim() ?? null,
      detail: { kind: row.kind, by: user.email },
    });
    if (input.approved && (input.step === "leader" || row.kind === "staff")) {
      writeOutbox(draft, {
        service: SERVICE, event_type: "hr.overtime.approved",
        payload: {
          sheet_no: row.sheet_no, kind: row.kind, work_date: row.work_date,
          /* Production lines carry what was made. A subscriber — today the
             screen, in Phase 2 the production service itself — turns these
             into progress entries against the work order (D147). */
          production: draft.overtime_lines
            .filter((l) => l.sheet_id === row.id && l.wo_no && l.qty_done)
            .map((l) => ({ wo_no: l.wo_no, stage: l.stage, qty: l.qty_done })),
        },
      });
    }
  });
  return getOvertimeSheet(input.sheet_no);
}

/** Reading the company's own overtime form.
 *
 *  The paper already exists — *FORM LEMBUR KARYAWAN PT TALAHOME*, with NO ·
 *  NAMA · DESCRIPTION · GAJI · JAM · TTD and twenty numbered rows — so the
 *  system reads that rather than asking anybody to retype it into a different
 *  shape (D154).
 *
 *  People are matched **by name**, which is the only identifier the form
 *  carries. A name nobody recognises is reported back, never created and never
 *  guessed at: two people called Sumiati is a question for HRD, not something
 *  for an importer to resolve (the same rule as D143 for machine numbers).
 */
export async function importOvertimeForm(
  input: {
    sheet_no: string;
    filename: string;
    rows: { no: string; name: string; description: string; gaji: number | null; jam: number | null }[];
  },
  idempotencyKey?: string,
): Promise<Result<{ added: number; skipped: number; unknown: string[]; sheet: OvertimeSheetView }>> {
  await latency();
  const cached = replayed<{ added: number; skipped: number; unknown: string[]; sheet: OvertimeSheetView }>(
    SERVICE, "importOvertimeForm", idempotencyKey,
  );
  if (cached) return cached;

  const denied = requireModule(SERVICE, "hrd");
  if (denied) return denied;

  const state = getState();
  const sheet = state.overtime_sheets.find((x) => x.sheet_no === input.sheet_no);
  if (!sheet) return notFound(SERVICE, "sheet_not_found", `No sheet ${input.sheet_no}.`);
  if (sheet.hrd_checked_at || sheet.leader_approved_at) {
    return conflict(
      SERVICE, "sheet_closed",
      `${sheet.sheet_no} sudah diperiksa — form baru masuk lembar baru.`,
    );
  }
  if (input.rows.length === 0) {
    return invalid(SERVICE, "empty_form", "Tidak ada baris berisi nama dan jam di form itu.", { field: "rows" });
  }

  /* Matched on a normalised name: the form is filled in by hand and the
     capitalisation is nobody's fault. */
  const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");
  const byName = new Map(state.employees.map((e) => [norm(e.full_name), e]));

  const user = actingUser();
  let added = 0;
  let skipped = 0;
  const unknown: string[] = [];

  apply((draft) => {
    for (const row of input.rows) {
      const emp = byName.get(norm(row.name));
      if (!emp) { unknown.push(row.name.trim()); continue; }
      if (draft.overtime_lines.some((l) => l.sheet_id === sheet.id && l.employee_id === emp.id)) {
        skipped += 1;
        continue;
      }
      added += 1;
      draft.overtime_lines.push({
        id: newId("lbl"), sheet_id: sheet.id, employee_id: emp.id,
        hours: row.jam ?? 0,
        task: row.description.trim() || "—",
        wo_no: null, stage: null, qty_done: null,
        form_amount: row.gaji ?? null,
      });
    }
    writeAudit(draft, {
      service: SERVICE, entity: "overtime_sheet", entity_no: sheet.sheet_no,
      action: "import_form", outcome: "ok", reason: input.filename,
      detail: { rows: input.rows.length, added, skipped, unknown, by: user.email },
    });
  });

  const after = await getOvertimeSheet(sheet.sheet_no);
  if (after.error) return after as unknown as Result<never>;
  const result = { added, skipped, unknown, sheet: after.data };
  remember(SERVICE, "importOvertimeForm", idempotencyKey, result);
  return ok(SERVICE, result);
}

/** Something added to or taken off one person's payslip, by a person, with a
 *  reason (D155).
 *
 *  The amount is **signed and typed**: this system computes no deduction it
 *  was not told about. What a minute of lateness costs, what an SP costs, what
 *  was left over last time — all of them are decisions, and a decision with no
 *  name and no sentence behind it is the thing an employee cannot argue with.
 */
export async function saveAdjustment(
  input: {
    run_no: string;
    employee_no: string;
    kind: AdjustmentKind;
    amount: number;
    reason: string;
    adjustment_id?: string | null;
  },
): Promise<Result<PayrollAdjustmentView[]>> {
  await latency();
  const denied = requireModule(SERVICE, "payroll");
  if (denied) return denied;

  const state = getState();
  const run = state.payroll_runs.find((r) => r.run_no === input.run_no);
  if (!run) return notFound(SERVICE, "run_not_found", `No payroll run ${input.run_no}.`);
  if (run.status !== "DRAFT") {
    return conflict(
      SERVICE, "run_closed",
      `${run.run_no} sudah ${run.status}. Perubahan setelah disetujui masuk periode berikutnya sebagai selisih.`,
    );
  }
  const emp = state.employees.find((e) => e.employee_no === input.employee_no);
  if (!emp) return notFound(SERVICE, "employee_not_found", `No employee ${input.employee_no}.`);
  if (!input.amount) {
    return invalid(SERVICE, "amount_required", "Nol bukan penyesuaian.", { field: "amount" });
  }
  if (!input.reason.trim()) {
    return invalid(
      SERVICE, "reason_required",
      "Potongan tanpa kalimat adalah potongan yang tidak bisa dibantah karyawan.",
      { field: "reason" },
    );
  }

  const user = actingUser();
  apply((draft) => {
    const row = input.adjustment_id
      ? draft.payroll_adjustments.find((a) => a.id === input.adjustment_id)
      : null;
    if (row) {
      row.kind = input.kind;
      row.amount = Math.round(input.amount);
      row.reason = input.reason.trim();
    } else {
      draft.payroll_adjustments.push({
        id: newId("adj"), run_no: run.run_no, employee_id: emp.id,
        kind: input.kind, amount: Math.round(input.amount),
        reason: input.reason.trim(),
        created_by: user.id, created_at: new Date().toISOString(),
      });
    }
    writeAudit(draft, {
      service: SERVICE, entity: "payroll", entity_no: run.run_no,
      action: row ? "update_adjustment" : "add_adjustment", outcome: "ok",
      reason: input.reason.trim(),
      detail: { employee: emp.employee_no, kind: input.kind, amount: input.amount, by: user.email },
    });
  });
  return listAdjustments(run.run_no);
}

export async function removeAdjustment(
  input: { run_no: string; adjustment_id: string },
): Promise<Result<PayrollAdjustmentView[]>> {
  await latency();
  const denied = requireModule(SERVICE, "payroll");
  if (denied) return denied;

  const state = getState();
  const row = state.payroll_adjustments.find((a) => a.id === input.adjustment_id);
  if (!row) return notFound(SERVICE, "adjustment_not_found", "Penyesuaian itu tidak ada.");
  const run = state.payroll_runs.find((r) => r.run_no === row.run_no);
  if (run && run.status !== "DRAFT") {
    return conflict(SERVICE, "run_closed", `${run.run_no} sudah ${run.status}.`);
  }

  const user = actingUser();
  apply((draft) => {
    draft.payroll_adjustments = draft.payroll_adjustments.filter((a) => a.id !== input.adjustment_id);
    writeAudit(draft, {
      service: SERVICE, entity: "payroll", entity_no: row.run_no,
      action: "remove_adjustment", outcome: "ok", reason: row.reason,
      detail: { kind: row.kind, amount: row.amount, by: user.email },
    });
  });
  return listAdjustments(input.run_no);
}

export async function listAdjustments(runNo: string): Promise<Result<PayrollAdjustmentView[]>> {
  await latency();
  const state = getState();
  const rows = state.payroll_adjustments
    .filter((a) => a.run_no === runNo)
    .map((a) => {
      const emp = state.employees.find((e) => e.id === a.employee_id);
      return { ...a, employee_no: emp?.employee_no ?? "—", full_name: emp?.full_name ?? "—" };
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  return ok(SERVICE, rows);
}

export async function listOvertimeSheets(): Promise<Result<OvertimeSheetView[]>> {
  await latency();
  const state = getState();
  const rows = state.overtime_sheets
    .map((sh) => sheetView(state, sh))
    .sort((a, b) => {
      /* Anything still waiting for somebody, first. */
      const open = (v: OvertimeSheetView) =>
        v.stage === "waiting_hrd" || v.stage === "waiting_surat" || v.stage === "waiting_leader"
          || v.stage === "paid_default" ? 0 : 1;
      if (open(a) !== open(b)) return open(a) - open(b);
      return b.work_date.localeCompare(a.work_date);
    });
  return ok(SERVICE, rows);
}

export async function getOvertimeSheet(sheetNo: string): Promise<Result<OvertimeSheetView>> {
  await latency();
  const state = getState();
  const sheet = state.overtime_sheets.find((x) => x.sheet_no === sheetNo);
  if (!sheet) return notFound(SERVICE, "sheet_not_found", `No sheet ${sheetNo}.`);
  return ok(SERVICE, sheetView(state, sheet));
}

/** Attaching the surat dokter to a day somebody was ill.
 *
 *  This is what turns *sakit* into a paid day (D144) — so it is an act with a
 *  name and a time on it, not a checkbox. Nothing is recomputed and stored:
 *  the timesheet reads the link the next time it is asked.
 */
export async function attachSuratDokter(
  input: { mark_id: string; attachment_id: string },
): Promise<Result<{ mark_id: string; attachment_id: string }>> {
  await latency();
  const denied = requireModule(SERVICE, "hrd");
  if (denied) return denied;

  const state = getState();
  const mark = state.day_marks.find((m) => m.id === input.mark_id);
  if (!mark) return notFound(SERVICE, "mark_not_found", "No such mark.");
  if (mark.kind !== "sick") {
    return invalid(
      SERVICE, "not_a_sick_day",
      "A surat dokter belongs to a day marked sakit. This day is marked something else.",
      { field: "mark_id" },
    );
  }
  if (!state.attachments.some((a) => a.id === input.attachment_id)) {
    return notFound(SERVICE, "attachment_not_found", "That file is not on the system.");
  }

  const user = actingUser();
  apply((draft) => {
    draft.attachment_links.push({
      id: newId("lnk"),
      attachment_id: input.attachment_id,
      entity: "day_mark",
      entity_no: mark.id,
      kind: "Surat Dokter",
      linked_by: user.id,
      linked_at: new Date().toISOString(),
    });
    writeAudit(draft, {
      service: SERVICE, entity: "day_mark", entity_no: `${mark.work_date}/${mark.employee_id ?? "ALL"}`,
      action: "attach_surat_dokter", outcome: "ok", reason: mark.reason,
      detail: { attachment_id: input.attachment_id, by: user.email },
    });
  });
  return ok(SERVICE, { mark_id: mark.id, attachment_id: input.attachment_id });
}

/* ── Berkas 201 ───────────────────────────────────────────────────────────
 *
 *  A file is a checklist, not a folder (D177). The list of what is **missing**
 *  is the reason this exists, and it is computed rather than tracked: adding a
 *  required document to the checklist makes every incomplete file say so the
 *  same day, with nothing to back-fill.
 */
export async function listEmployeeFiles(): Promise<Result<EmployeeFileView[]>> {
  await latency();
  const state = getState();
  const today = officeToday();
  return ok(SERVICE, state.employees
    .filter((e) => e.active)
    .map((e) => employeeFile(state, e, today))
    /* Incomplete first, then whatever expires soonest: the two reasons anybody
       opens this screen. */
    .sort((a, b) => {
      if (a.complete !== b.complete) return a.complete ? 1 : -1;
      const ax = a.expiring[0]?.days ?? 9999;
      const bx = b.expiring[0]?.days ?? 9999;
      if (ax !== bx) return ax - bx;
      return a.full_name.localeCompare(b.full_name);
    }));
}

export async function getEmployeeFile(employeeNo: string): Promise<Result<EmployeeFileView>> {
  await latency();
  const state = getState();
  const emp = state.employees.find((e) => e.employee_no === employeeNo);
  if (!emp) return notFound(SERVICE, "employee_not_found", `No employee ${employeeNo}.`);
  return ok(SERVICE, employeeFile(state, emp, officeToday()));
}

/** Filing a document. A number with no scan is still a record — the number is
 *  usually what somebody needs — so neither is required, but one of them is. */
export async function saveEmployeeDocument(
  input: {
    employee_no: string; kind: EmployeeDocKind;
    attachment_id?: string | null; doc_no?: string | null;
    doc_no_source?: DocNoSource;
    issued_on?: string | null; expires_on?: string | null; note?: string | null;
  },
): Promise<Result<EmployeeFileView>> {
  await latency();
  const denied = requireModule(SERVICE, "hrd");
  if (denied) return denied;

  const state = getState();
  const emp = state.employees.find((e) => e.employee_no === input.employee_no);
  if (!emp) return notFound(SERVICE, "employee_not_found", `No employee ${input.employee_no}.`);
  if (!input.attachment_id && !input.doc_no?.trim()) {
    return invalid(
      SERVICE, "nothing_to_file",
      "Lampirkan berkasnya atau tulis nomornya. Satu baris kosong bukan dokumen.",
      { field: "doc_no" },
    );
  }
  /* A number cannot have been read out of a file that is not there. The demo
     seeds made exactly this claim before it was caught (F57) — seventeen rows
     saying *terbaca dari berkas* beside *berkas belum dipindai*. It reads as a
     detail and it is not: the whole point of recording provenance is that
     somebody later trusts a number because of where it came from. */
  if (input.doc_no_source === "extracted" && !input.attachment_id) {
    return invalid(
      SERVICE, "extracted_without_file",
      "Nomor tidak bisa ditandai terbaca dari berkas kalau berkasnya tidak ada. Lampirkan berkasnya, atau tandai diketik.",
      { field: "doc_no_source" },
    );
  }
  if (input.expires_on && input.issued_on && input.expires_on < input.issued_on) {
    return invalid(SERVICE, "expiry_before_issue", "Tanggal berakhir mendahului tanggal terbit.", { field: "expires_on" });
  }

  const user = actingUser();
  apply((draft) => {
    draft.employee_documents.push({
      id: newId("edc"),
      employee_id: emp.id,
      kind: input.kind,
      attachment_id: input.attachment_id ?? null,
      doc_no: input.doc_no?.trim() || null,
      /* Where the number came from, recorded at the moment it arrives. A scan
         filed with no number is **pending**, not blank-because-nobody-cared:
         the difference is whether anybody is expected to come back to it. */
      doc_no_source: input.doc_no?.trim()
        ? (input.doc_no_source ?? "typed")
        : (input.attachment_id ? "pending" : null),
      issued_on: input.issued_on || null,
      expires_on: input.expires_on || null,
      note: input.note?.trim() || null,
      recorded_by: user.id,
      recorded_at: new Date().toISOString(),
    });
    if (input.attachment_id) {
      draft.attachment_links.push({
        id: newId("lnk"), attachment_id: input.attachment_id,
        entity: "employee", entity_no: emp.employee_no,
        kind: EMPLOYEE_DOC_TO_DOC_KIND[input.kind],
        linked_by: user.id, linked_at: new Date().toISOString(),
      });
    }
    writeAudit(draft, {
      service: SERVICE, entity: "employee_document", entity_no: emp.employee_no,
      action: "file", outcome: "ok", reason: null,
      /* Same rule as the reveal: the trail says a number was filed, never what
         it is. An audit row nobody may delete is the worst place to keep one. */
      detail: {
        kind: input.kind,
        doc_no: SENSITIVE_DOC_KINDS.has(input.kind)
          ? (input.doc_no ? "(disamarkan)" : null)
          : (input.doc_no ?? null),
        expires_on: input.expires_on ?? null, by: user.email,
      },
    });
  });
  return getEmployeeFile(emp.employee_no);
}

/** Reading somebody's identity number — the one act on this screen that is a
 *  **read** and still belongs in the audit trail.
 *
 *  Two rules hold it together, and the second is the one that is easy to get
 *  wrong:
 *
 *  1. **It is written to `audit_log`, not to the activity log.** The activity
 *     log keeps detail for thirty days (D188), and *who looked at Karjo's KTP*
 *     is a question asked months later, usually by Karjo. The audit trail is
 *     never deleted, so that is where it goes — and D188's line between the two
 *     is amended accordingly: the audit log holds **acts**, of which changing a
 *     row is the commonest, not changes alone (D197).
 *
 *  2. **The audit row must not contain the number.** A log of who read a
 *     secret that stores the secret has multiplied the thing it was protecting
 *     — and the audit trail is the one table nobody may ever delete from. What
 *     it records is whose document, which kind, and who looked.
 */
export async function revealEmployeeDocNo(
  docId: string,
): Promise<Result<{ doc_id: string; doc_no: string; revealed_at: string }>> {
  await latency();
  const denied = requireModule(SERVICE, "hrd");
  if (denied) return denied;

  const state = getState();
  const doc = state.employee_documents.find((d) => d.id === docId);
  if (!doc) return notFound(SERVICE, "document_not_found", "Dokumen tidak ada.");
  if (!doc.doc_no) {
    return invalid(SERVICE, "no_number", "Dokumen ini belum punya nomor untuk dibuka.", { field: "doc_no" });
  }
  const emp = state.employees.find((e) => e.id === doc.employee_id);
  const user = actingUser();
  const at = new Date().toISOString();

  apply((draft) => {
    writeAudit(draft, {
      service: SERVICE, entity: "employee_document", entity_no: emp?.employee_no ?? doc.employee_id,
      action: "reveal", outcome: "ok",
      reason: null,
      /* Whose, and which kind. Never the number itself. */
      detail: { kind: doc.kind, employee: emp?.full_name ?? doc.employee_id, by: user.email },
    });
  });

  return ok(SERVICE, { doc_id: doc.id, doc_no: doc.doc_no, revealed_at: at });
}

/** Which document kind a personnel record travels under on the evidence road.
 *  One map, so a KTP is filed as a KTP everywhere it appears (ADR-010). */
const EMPLOYEE_DOC_TO_DOC_KIND: Record<EmployeeDocKind, DocKind> = {
  ktp: "KTP",
  kartu_keluarga: "Kartu Keluarga",
  ijazah: "Ijazah",
  cv: "CV",
  kontrak_kerja: "Kontrak Kerja",
  npwp: "NPWP",
  bpjs_kesehatan: "BPJS",
  bpjs_tk: "BPJS",
  foto: "Foto",
  sertifikat: "Sertifikat",
  sp: "Surat Peringatan",
  lainnya: "Others",
};

/* ── Cuti & izin ──────────────────────────────────────────────────────────
 *
 *  The half that happens before the timesheet mark: somebody asks, somebody
 *  decides, and approving is what writes the mark (D178).
 */
export async function listLeaveBalances(): Promise<Result<LeaveBalance[]>> {
  await latency();
  const state = getState();
  const year = officeToday().slice(0, 4);
  return ok(SERVICE, state.employees
    .filter((e) => e.active)
    .map((e) => leaveBalance(state, e, year))
    .sort((a, b) => a.remaining - b.remaining || a.full_name.localeCompare(b.full_name)));
}

export async function listLeaveRequests(): Promise<Result<LeaveRequestView[]>> {
  await latency();
  const state = getState();
  return ok(SERVICE, [...state.leave_requests]
    .sort((a, b) => {
      /* Waiting first — a queue is not a filing cabinet. */
      if ((a.status === "PENDING") !== (b.status === "PENDING")) return a.status === "PENDING" ? -1 : 1;
      return b.requested_at.localeCompare(a.requested_at);
    })
    .map((r) => leaveRequestView(state, r)));
}

/** Asking. Never refused for being over the balance — days beyond it are taken
 *  and recorded, they are simply not paid (D144). The screen says which. */
export async function requestLeave(
  input: { employee_no: string; kind: LeaveKind; from_date: string; to_date: string; reason: string },
  idempotencyKey?: string,
): Promise<Result<LeaveRequestView>> {
  await latency();
  const cached = replayed<LeaveRequestView>(SERVICE, "requestLeave", idempotencyKey);
  if (cached) return cached;

  const denied = requireModule(SERVICE, "hrd");
  if (denied) return denied;

  const state = getState();
  const emp = state.employees.find((e) => e.employee_no === input.employee_no);
  if (!emp) return notFound(SERVICE, "employee_not_found", `No employee ${input.employee_no}.`);
  if (input.to_date < input.from_date) {
    return invalid(SERVICE, "range_invalid", "Tanggal selesai mendahului tanggal mulai.", { field: "to_date" });
  }
  if (!input.reason.trim()) {
    return invalid(SERVICE, "reason_required", "Tulis alasannya — itu yang dibaca saat diputuskan.", { field: "reason" });
  }
  const overlap = state.leave_requests.find(
    (r) => r.employee_id === emp.id
      && (r.status === "PENDING" || r.status === "APPROVED")
      && r.from_date <= input.to_date && r.to_date >= input.from_date,
  );
  if (overlap) {
    return conflict(
      SERVICE, "overlaps_existing",
      `${overlap.request_no} sudah menutupi ${overlap.from_date} → ${overlap.to_date} untuk orang yang sama.`,
    );
  }

  const user = actingUser();
  let created = "";
  apply((draft) => {
    const no = nextDocNumber(draft, "izn");
    created = no;
    draft.leave_requests.push({
      id: newId("lvr"), request_no: no, employee_id: emp.id,
      kind: input.kind, from_date: input.from_date, to_date: input.to_date,
      days: datesBetween(input.from_date, input.to_date).length,
      reason: input.reason.trim(),
      status: "PENDING",
      requested_by: user.id, requested_at: new Date().toISOString(),
      decided_by: null, decided_at: null, decision_note: null,
    });
    writeAudit(draft, {
      service: SERVICE, entity: "leave_request", entity_no: no,
      action: "request", outcome: "ok", reason: input.reason.trim(),
      detail: { employee: emp.employee_no, kind: input.kind, from: input.from_date, to: input.to_date, by: user.email },
    });
  });

  const view = leaveRequestView(getState(), getState().leave_requests.find((r) => r.request_no === created)!);
  remember(SERVICE, "requestLeave", idempotencyKey, view);
  return ok(SERVICE, view);
}

/** Deciding. Approval **writes the timesheet marks** — that is what makes the
 *  request more than a note (D178). A refusal needs a sentence.
 *
 *  Days that already carry a mark are skipped rather than overwritten: a public
 *  holiday inside somebody's leave is still a public holiday, and a mark typed
 *  by a person at six in the morning outranks a batch write.
 */
export async function decideLeave(
  input: { request_no: string; approved: boolean; note?: string | null },
): Promise<Result<{ request_no: string; status: LeaveStatus; marked: string[]; skipped: string[] }>> {
  await latency();
  const denied = requireModule(SERVICE, "hrd");
  if (denied) return denied;

  const state = getState();
  const req = state.leave_requests.find((r) => r.request_no === input.request_no);
  if (!req) return notFound(SERVICE, "request_not_found", `No leave request ${input.request_no}.`);
  if (req.status !== "PENDING") {
    return conflict(SERVICE, "already_decided", `${req.request_no} sudah ${req.status.toLowerCase()} — tidak ada yang berubah.`);
  }
  if (!input.approved && !input.note?.trim()) {
    return invalid(
      SERVICE, "reason_required",
      "Penolakan harus punya alasan. Yang ditolak tanpa kalimat tidak bisa dibantah orangnya.",
      { field: "note" },
    );
  }

  const emp = state.employees.find((e) => e.id === req.employee_id);
  const user = actingUser();
  const marked: string[] = [];
  const skipped: string[] = [];

  apply((draft) => {
    const row = draft.leave_requests.find((r) => r.request_no === input.request_no);
    if (!row || !emp) return;
    row.status = input.approved ? "APPROVED" : "REJECTED";
    row.decided_by = user.id;
    row.decided_at = new Date().toISOString();
    row.decision_note = input.note?.trim() || null;

    if (input.approved) {
      const kind: DayMarkKind = row.kind === "cuti" ? "leave" : row.kind === "izin" ? "permit" : "sick";
      for (const date of datesBetween(row.from_date, row.to_date)) {
        const clash = draft.day_marks.find(
          (m) => m.work_date === date && (m.employee_id === emp.id || m.employee_id === null),
        );
        if (clash) { skipped.push(date); continue; }
        draft.day_marks.push({
          id: newId("dmk"), employee_id: emp.id, work_date: date, kind,
          reason: `${row.request_no}: ${row.reason}`,
          marked_by: user.id, marked_at: new Date().toISOString(),
        });
        marked.push(date);
      }
    }

    writeAudit(draft, {
      service: SERVICE, entity: "leave_request", entity_no: row.request_no,
      action: input.approved ? "approve" : "reject",
      outcome: "ok", reason: row.decision_note,
      detail: { employee: emp.employee_no, marked, skipped, by: user.email },
    });
    writeOutbox(draft, {
      service: SERVICE, event_type: input.approved ? "hr.leave.approved" : "hr.leave.rejected",
      payload: { request_no: row.request_no, employee: emp.employee_no, days: row.days },
    });
  });

  return ok(SERVICE, {
    request_no: req.request_no,
    status: input.approved ? "APPROVED" : "REJECTED",
    marked, skipped,
  });
}

/** The office day, WITA. Not the browser's day (F17); one definition for the
 *  whole system (F63). */
function officeToday(): string {
  return sharedOfficeToday();
}

/* ── Pay rules ────────────────────────────────────────────────────────────
 *
 *  The policy, as data (D168). Nothing here computes anything: these endpoints
 *  read the rule book and write the next version of it. What the rules *do* is
 *  in `payrollLine`, which is the only place that should know.
 */
/* ── Tugas dan penilaian ──────────────────────────────────────────────────── */

export async function listTasks(
  filter: { assignee_no?: string; status?: Task["status"] } = {},
): Promise<Result<TaskView[]>> {
  await latency();
  const denied = requireModule(SERVICE, "hrd");
  if (denied) return denied;
  return ok(SERVICE, taskViews(getState(), filter));
}

/** Asking somebody to do something, by a date.
 *
 *  Both required, and both for the same reason: a task with no owner is a note,
 *  and a task with no date is one nobody can tell is late (D260).
 */
export async function createTask(
  input: {
    assignee_no: string;
    title: string;
    due_date: string;
    detail?: string | null;
    ref_kind?: TaskRefKind;
    ref_no?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<TaskView>> {
  await latency();
  const cached = replayed<TaskView>(SERVICE, "createTask", idempotencyKey);
  if (cached) return cached;

  const denied = requireModule(SERVICE, "hrd");
  if (denied) return denied;

  const state = getState();
  const emp = state.employees.find((e) => e.employee_no === input.assignee_no);
  if (!emp) return notFound(SERVICE, "employee_not_found", `No employee ${input.assignee_no}.`);
  if (!emp.active) {
    return conflict(SERVICE, "employee_left", `${emp.full_name} sudah tidak aktif.`);
  }
  if (!input.title.trim()) {
    return invalid(SERVICE, "title_required", "Tugasnya apa?", { field: "title" });
  }
  if (!input.due_date) {
    return invalid(
      SERVICE, "due_date_required",
      "Tugas tanpa tanggal tidak bisa terlambat, yang berarti tidak ada yang bisa tahu kapan ia terlambat.",
      { field: "due_date" },
    );
  }

  const user = actingUser();
  let no = "";
  apply((draft) => {
    no = nextDocNumber(draft, "tgs");
    draft.tasks.push({
      id: newId("tsk"), task_no: no,
      title: input.title.trim(),
      detail: input.detail?.trim() || null,
      assignee_id: emp.id,
      assigned_by: user.id,
      assigned_at: new Date().toISOString(),
      due_date: input.due_date,
      ref_kind: input.ref_kind ?? "none",
      ref_no: input.ref_no?.trim() || null,
      status: "OPEN",
      done_at: null, done_by: null,
      blocked_reason: null, blocked_at: null,
      cancelled_reason: null,
    });
    writeAudit(draft, {
      service: SERVICE, entity: "task", entity_no: no,
      action: "create", outcome: "ok", reason: null,
      detail: { assignee: emp.employee_no, due: input.due_date, by: user.email },
    });
  });
  const state2 = getState();
  const row = state2.tasks.find((t) => t.task_no === no)!;
  const view = taskView(state2, row);
  remember(SERVICE, "createTask", idempotencyKey, view);
  return ok(SERVICE, view);
}

/** Done, blocked, unblocked or cancelled — the four things that happen to a
 *  task, each carrying what it needs.
 *
 *  **Blocking requires a reason**, because a blocked task is removed from the
 *  assignee's score (D261) and something that lifts a penalty has to say why.
 *  It is also the sentence somebody else reads when they are the blocker.
 */
export async function updateTask(
  input: {
    task_no: string;
    action: "done" | "block" | "unblock" | "cancel";
    reason?: string | null;
    done_on?: string | null;
  },
): Promise<Result<TaskView>> {
  await latency();
  const denied = requireModule(SERVICE, "hrd");
  if (denied) return denied;

  const state = getState();
  const t = state.tasks.find((x) => x.task_no === input.task_no);
  if (!t) return notFound(SERVICE, "task_not_found", `No task ${input.task_no}.`);
  if (t.status !== "OPEN" && input.action !== "done") {
    return conflict(SERVICE, "task_closed", `${t.task_no} sudah ${t.status}.`);
  }
  if ((input.action === "block" || input.action === "cancel") && !input.reason?.trim()) {
    return invalid(
      SERVICE, "reason_required",
      input.action === "block"
        ? "Tertahan menunggu apa? Tugas yang tertahan dikeluarkan dari penilaian orangnya — yang menghapus beban harus menyebut alasannya, dan kalimat ini juga yang dibaca pihak yang menahannya."
        : "Kenapa dibatalkan? Tugas yang dibatalkan tidak dihitung sebagai berhasil maupun gagal, jadi alasannya adalah satu-satunya jejak yang tersisa.",
      { field: "reason" },
    );
  }
  if (input.action === "unblock" && t.blocked_reason === null) {
    return noop(SERVICE, taskView(state, t));
  }
  if (input.action === "done" && t.status === "DONE") {
    return noop(SERVICE, taskView(state, t));
  }

  const user = actingUser();
  apply((draft) => {
    const row = draft.tasks.find((x) => x.task_no === input.task_no);
    if (!row) return;
    if (input.action === "done") {
      row.status = "DONE";
      /* The day it was finished, not the day it was typed — the same rule the
         production board follows (D148). */
      row.done_at = input.done_on
        ? `${input.done_on}T12:00:00+08:00`
        : new Date().toISOString();
      row.done_by = user.id;
      row.blocked_reason = null;
      row.blocked_at = null;
    } else if (input.action === "block") {
      row.blocked_reason = input.reason!.trim();
      row.blocked_at = new Date().toISOString();
    } else if (input.action === "unblock") {
      row.blocked_reason = null;
      row.blocked_at = null;
    } else {
      row.status = "CANCELLED";
      row.cancelled_reason = input.reason!.trim();
    }
    writeAudit(draft, {
      service: SERVICE, entity: "task", entity_no: row.task_no,
      action: input.action, outcome: "ok", reason: input.reason?.trim() || null,
      detail: { by: user.email },
    });
  });
  const after = getState();
  return ok(SERVICE, taskView(after, after.tasks.find((x) => x.task_no === input.task_no)!));
}

/** The analyzer. **Payroll-level**, like the payslips: this is the most
 *  personal reading the system produces about anybody. */
export async function getKpi(
  input: { period_start: string; period_end: string; employee_no?: string },
): Promise<Result<KpiView[]>> {
  await latency();
  const denied = requireModule(SERVICE, "payroll");
  if (denied) return denied;
  const state = getState();
  if (input.employee_no) {
    const emp = state.employees.find((e) => e.employee_no === input.employee_no);
    if (!emp) return notFound(SERVICE, "employee_not_found", `No employee ${input.employee_no}.`);
    return ok(SERVICE, [kpiView(state, emp, input.period_start, input.period_end)]);
  }
  return ok(SERVICE, kpiViews(state, input.period_start, input.period_end));
}

/* ── Iuran wajib ──────────────────────────────────────────────────────────── */

/** The roll of names for one scheme and month — HRD's register, read. */
export async function getContributionRoll(
  input: { scheme: ContributionScheme; month: string },
): Promise<Result<ContributionRoll>> {
  await latency();
  const denied = requireModule(SERVICE, "payroll");
  if (denied) return denied;
  return ok(SERVICE, contributionRoll(getState(), input.scheme, input.month));
}

/** Every computed scheme for a month, for the screen that shows them together.
 *  **Accounting may read this**, because auditing the invoice against the roll
 *  is the whole point (owner, D259) — and what it gets back carries masked
 *  member numbers and no pay figures beyond the contribution base, which is
 *  what the invoice is computed on anyway. */
export async function listContributionRolls(
  month: string,
): Promise<Result<ContributionRoll[]>> {
  await latency();
  const user = actingUser();
  const mayRead = user.modules.some((m) => m.module === "payroll" || m.module === "hrd" || m.module === "accounting");
  if (!mayRead) {
    return refused(
      SERVICE, "module_required",
      "Daftar iuran dibaca HRD, payroll dan akunting. Akunting ada di sini karena memeriksa tagihan terhadap daftar namanya memang tugasnya.",
      { required: "payroll|hrd|accounting", acting_as: user.email },
    );
  }
  return ok(SERVICE, allRolls(getState(), month));
}

export async function listEnrolments(
  opts: { employee_no?: string; scheme?: ContributionScheme } = {},
): Promise<Result<(Enrolment & { employee_no: string; full_name: string; member_no_masked: string | null })[]>> {
  await latency();
  const denied = requireModule(SERVICE, "hrd");
  if (denied) return denied;
  const state = getState();
  const emp = opts.employee_no
    ? state.employees.find((e) => e.employee_no === opts.employee_no)
    : null;
  const rows = state.enrolments
    .filter((en) => (!emp || en.employee_id === emp.id) && (!opts.scheme || en.scheme === opts.scheme))
    .map((en) => {
      const e = state.employees.find((x) => x.id === en.employee_id);
      return {
        ...en,
        /* Masked on read, like every other card number (D196). The full number
           needs an explicit reveal and the reveal is logged. */
        member_no: null,
        member_no_masked: en.member_no ? maskDocNo(en.member_no) : null,
        employee_no: e?.employee_no ?? "—",
        full_name: e?.full_name ?? "—",
      };
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name) || a.scheme.localeCompare(b.scheme));
  return ok(SERVICE, rows);
}

/** Registering somebody. **HRD's act** (owner, D259). */
export async function enrol(
  input: {
    employee_no: string;
    scheme: ContributionScheme;
    member_no?: string | null;
    enrolled_on: string;
    declared_base?: number | null;
    note?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<Enrolment>> {
  await latency();
  const cached = replayed<Enrolment>(SERVICE, "enrol", idempotencyKey);
  if (cached) return cached;

  const denied = requireModule(SERVICE, "hrd");
  if (denied) return denied;

  const state = getState();
  const emp = state.employees.find((e) => e.employee_no === input.employee_no);
  if (!emp) return notFound(SERVICE, "employee_not_found", `No employee ${input.employee_no}.`);
  if (!input.enrolled_on) {
    return invalid(
      SERVICE, "date_required",
      "Sejak kapan dia terdaftar? Tanpa tanggal, tidak ada yang bisa menjawab apakah bulan Maret dia sudah ditanggung.",
      { field: "enrolled_on" },
    );
  }
  if (input.enrolled_on < emp.joined_on) {
    return invalid(
      SERVICE, "before_joining",
      `${emp.full_name} baru masuk ${emp.joined_on}; tidak bisa terdaftar sejak ${input.enrolled_on}.`,
      { field: "enrolled_on" },
    );
  }
  if (input.declared_base != null && input.declared_base <= 0) {
    return invalid(SERVICE, "base_invalid", "Upah yang didaftarkan harus lebih dari nol.", { field: "declared_base" });
  }
  const open = state.enrolments.find(
    (en) => en.employee_id === emp.id && en.scheme === input.scheme && en.ended_on === null,
  );
  if (open) {
    return conflict(
      SERVICE, "already_enrolled",
      `${emp.full_name} sudah terdaftar di ${SCHEME_LABEL[input.scheme]} sejak ${open.enrolled_on}. Akhiri dulu yang lama kalau memang didaftarkan ulang.`,
    );
  }

  const user = actingUser();
  let row: Enrolment | null = null;
  apply((draft) => {
    row = {
      id: newId("enr"),
      employee_id: emp.id, scheme: input.scheme,
      member_no: input.member_no?.trim() || null,
      enrolled_on: input.enrolled_on,
      ended_on: null, ended_reason: null,
      declared_base: input.declared_base ?? null,
      note: input.note?.trim() || null,
      by: user.id, at: new Date().toISOString(),
    };
    draft.enrolments.push(row);
    writeAudit(draft, {
      service: SERVICE, entity: "enrolment", entity_no: `${emp.employee_no}/${input.scheme}`,
      action: "enrol", outcome: "ok", reason: input.note?.trim() || null,
      detail: { from: input.enrolled_on, declared_base: input.declared_base ?? null, by: user.email },
    });
  });
  const saved = row as unknown as Enrolment;
  remember(SERVICE, "enrol", idempotencyKey, saved);
  return ok(SERVICE, saved);
}

/** Taking somebody off. **The row stays** — *was he covered in July* is the
 *  question this register exists to answer (A5) — and the reason is required,
 *  because an invoice that keeps charging for somebody who came off the roll is
 *  the leak the owner described and the sentence is how it gets traced. */
export async function endEnrolment(
  input: { id: string; ended_on: string; reason: string },
): Promise<Result<Enrolment>> {
  await latency();
  const denied = requireModule(SERVICE, "hrd");
  if (denied) return denied;

  if (!input.reason.trim()) {
    return invalid(
      SERVICE, "reason_required",
      "Kenapa berhenti? Ini kalimat yang dibaca akunting waktu tagihan bulan depan ternyata masih memuat namanya.",
      { field: "reason" },
    );
  }
  const state = getState();
  const found = state.enrolments.find((en) => en.id === input.id);
  if (!found) return notFound(SERVICE, "enrolment_not_found", `No enrolment ${input.id}.`);
  if (found.ended_on) {
    return noop(SERVICE, found);
  }
  if (input.ended_on < found.enrolled_on) {
    return invalid(
      SERVICE, "before_enrolment",
      `Tanggal berhenti ${input.ended_on} lebih awal dari tanggal daftar ${found.enrolled_on}.`,
      { field: "ended_on" },
    );
  }

  const user = actingUser();
  apply((draft) => {
    const row = draft.enrolments.find((en) => en.id === input.id);
    if (!row) return;
    row.ended_on = input.ended_on;
    row.ended_reason = input.reason.trim();
    const emp = draft.employees.find((e) => e.id === row.employee_id);
    writeAudit(draft, {
      service: SERVICE, entity: "enrolment",
      entity_no: `${emp?.employee_no ?? row.employee_id}/${row.scheme}`,
      action: "end", outcome: "ok", reason: input.reason.trim(),
      detail: { ended_on: input.ended_on, by: user.email },
    });
  });
  return ok(SERVICE, getState().enrolments.find((en) => en.id === input.id)!);
}

export async function listContributionRates(): Promise<Result<ContributionRate[]>> {
  await latency();
  const denied = requireModule(SERVICE, "payroll");
  if (denied) return denied;
  return ok(SERVICE, [...getState().contribution_rates]
    .sort((a, b) => a.scheme.localeCompare(b.scheme) || b.effective_from.localeCompare(a.effective_from)));
}

/** A new dated rate. **IT writes, HRD reads** — the same split as the pay rule
 *  book (D193), for the same reason: one number here moves every payslip and
 *  every invoice at once. */
export async function saveContributionRate(
  input: {
    scheme: ContributionScheme;
    effective_from: string;
    employer_percent: number;
    employee_percent: number;
    wage_ceiling?: number | null;
    note: string;
    confirmed?: boolean;
  },
): Promise<Result<ContributionRate>> {
  await latency();
  const denied = requireLevel(SERVICE, "it", "write");
  if (denied) return denied;

  if (!input.note.trim()) {
    return invalid(SERVICE, "note_required", "Dari mana angkanya? Tarif tanpa sumber tidak bisa diperiksa.", { field: "note" });
  }
  if (input.employer_percent < 0 || input.employee_percent < 0) {
    return invalid(SERVICE, "percent_invalid", "Persentase tidak bisa negatif.", { field: "employer_percent" });
  }
  const state = getState();
  const latest = state.contribution_rates
    .filter((r) => r.scheme === input.scheme)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  if (latest && input.effective_from <= latest.effective_from) {
    return conflict(
      SERVICE, "not_forward",
      `Versi terakhir ${SCHEME_LABEL[input.scheme]} berlaku sejak ${latest.effective_from}. Versi baru harus mulai setelahnya — iuran bulan lalu dihitung dengan tarif bulan lalu.`,
    );
  }

  const user = actingUser();
  let row: ContributionRate | null = null;
  apply((draft) => {
    row = {
      id: newId("crt"), scheme: input.scheme,
      effective_from: input.effective_from,
      employer_percent: input.employer_percent,
      employee_percent: input.employee_percent,
      wage_ceiling: input.wage_ceiling ?? null,
      note: input.note.trim(),
      confirmed: input.confirmed ?? false,
      created_by: user.id, created_at: new Date().toISOString(),
    };
    draft.contribution_rates.push(row);
    writeAudit(draft, {
      service: SERVICE, entity: "contribution_rate", entity_no: input.scheme,
      action: "create_version", outcome: "ok", reason: input.note.trim(),
      detail: {
        from: input.effective_from,
        employer: input.employer_percent, employee: input.employee_percent,
        by: user.email,
      },
    });
  });
  return ok(SERVICE, row as unknown as ContributionRate);
}

export async function listPayRules(): Promise<Result<PayRuleSetView[]>> {
  await latency();
  const state = getState();
  const today = sharedOfficeToday();
  const current = activePayRules(state, today);
  return ok(SERVICE, [...state.pay_rule_sets]
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))
    .map((r) => ({
      ...r,
      created_by_name: state.users.find((u) => u.id === r.created_by)?.full_name ?? "—",
      is_current: r.id === current.id,
    })));
}

/** Changing the rules writes the **next** version, from a date forward.
 *
 *  Never an edit, for the reason the whole model exists: a payslip already
 *  given to somebody must stay recomputable under the rule it was computed
 *  under (D173). So this refuses a date that is not in the future of the
 *  latest version — backdating would rewrite payslips that have been handed
 *  out, which is the one thing a pay system must not do quietly.
 */
export async function savePayRules(
  input: { effective_from: string; note: string; rules: PayRules },
  idempotencyKey?: string,
): Promise<Result<PayRuleSetView>> {
  await latency();
  const cached = replayed<PayRuleSetView>(SERVICE, "savePayRules", idempotencyKey);
  if (cached) return cached;

  /* HRD reads the rule book; **IT changes it** (owner, D193). Not because HRD
     is not trusted with the numbers — they are the ones who know them — but
     because a pay rule is the one piece of configuration that reaches every
     payslip at once, and the people whose pay it computes should not be the
     people who can change it without a second pair of hands. The proposal
     comes from HRD; the change is made by IT, with the note attached. */
  const denied = requireLevel(SERVICE, "it", "write");
  if (denied) return denied;
  if (!input.note?.trim()) {
    return invalid(
      SERVICE, "note_required",
      "Tulis alasannya. Aturan gaji yang berubah tanpa keterangan adalah aturan yang tidak bisa dijelaskan ke karyawan.",
      { field: "note" },
    );
  }

  const state = getState();
  const latest = [...state.pay_rule_sets].sort((a, b) => a.effective_from.localeCompare(b.effective_from)).pop();
  if (latest && input.effective_from <= latest.effective_from) {
    return invalid(
      SERVICE, "effective_from_backdated",
      `Versi terakhir berlaku sejak ${latest.effective_from}. Aturan baru harus berlaku setelahnya.`,
      { field: "effective_from" },
    );
  }
  /* Never into the past. Days that have already been worked were worked under
     a rule somebody could have read at the time; changing what they are worth
     afterwards is the one thing a pay system must not do quietly (D173). */
  const today = sharedOfficeToday();
  if (input.effective_from < today) {
    return invalid(
      SERVICE, "effective_from_in_past",
      `${input.effective_from} sudah lewat. Aturan gaji berlaku ke depan — hari yang sudah dikerjakan dihitung dengan aturan yang berlaku saat itu.`,
      { field: "effective_from" },
    );
  }
  /* And never *inside* an open period, whatever its status. A version dated
     mid-period is silently ignored by the payroll — which picks the rule in
     force when the period opened — so it would look applied and do nothing. */
  const clash = state.payroll_runs.find(
    (r) => input.effective_from > r.period_start && input.effective_from <= r.period_end,
  );
  if (clash) {
    return conflict(
      SERVICE, "inside_existing_run",
      `${clash.run_no} berjalan ${clash.period_start} → ${clash.period_end}, dan periode itu dihitung dengan aturan yang berlaku saat dibuka. Pilih tanggal setelah ${clash.period_end}.`,
    );
  }

  const user = actingUser();
  let created: PayRuleSet | null = null;
  apply((draft) => {
    const version = Math.max(0, ...draft.pay_rule_sets.map((r) => r.version)) + 1;
    const row: PayRuleSet = {
      id: newId("prs"), version,
      effective_from: input.effective_from,
      note: input.note.trim(),
      rules: input.rules,
      created_by: user.id,
      created_at: new Date().toISOString(),
    };
    draft.pay_rule_sets.push(row);
    created = row;
    writeAudit(draft, {
      service: SERVICE, entity: "pay_rules", entity_no: `v${version}`,
      action: "create_version", outcome: "ok", reason: row.note,
      detail: { effective_from: row.effective_from, rules: row.rules, by: user.email },
    });
    writeOutbox(draft, {
      service: SERVICE, event_type: "hr.pay_rules.changed",
      payload: { version, effective_from: row.effective_from, note: row.note },
    });
  });

  const row = created as unknown as PayRuleSet;
  const view: PayRuleSetView = {
    ...row,
    created_by_name: user.full_name,
    is_current: true,
  };
  remember(SERVICE, "savePayRules", idempotencyKey, view);
  return ok(SERVICE, view);
}

/** What a proposed rule book would do to a period, person by person.
 *
 *  The whole reason this exists: a multiplier is an abstraction until somebody
 *  sees that it moves Karjo from Rp 210.000 to Rp 245.000. Nothing is saved —
 *  the rules are applied to the same days and the same approved sheets, and the
 *  difference is shown before anybody commits to it (D175).
 */
export async function previewPayRules(
  input: { rules: PayRules; period_start: string; period_end: string },
): Promise<Result<{
  period: string;
  before_total: number;
  after_total: number;
  lines: { employee_no: string; full_name: string; before: number; after: number; note: string }[];
}>> {
  await latency();
  const state = getState();
  const people = state.employees.filter(
    (e) => e.joined_on <= input.period_end && (e.left_on === null || e.left_on >= input.period_start),
  );

  const lines = people.map((e) => {
    const current = payrollLine(state, e, input.period_start, input.period_end);
    const proposed = payrollLineWith(state, e, input.period_start, input.period_end, input.rules);
    const notes: string[] = [];
    if (proposed.overtime_pay !== current.overtime_pay) {
      notes.push(`lembur ${formatDelta(current.overtime_pay, proposed.overtime_pay)}`);
    }
    if (proposed.undertime_amount !== current.undertime_amount) {
      notes.push(`undertime ${formatDelta(-current.undertime_amount, -proposed.undertime_amount)}`);
    }
    /* The three the pay split introduced. Each named separately rather than
       rolled into one delta: *your wage changed* is not a sentence anybody can
       check, and these are exactly the changes people will argue about. */
    if (proposed.allowance_pay !== current.allowance_pay) {
      notes.push(`tunjangan ${formatDelta(current.allowance_pay, proposed.allowance_pay)}`);
    }
    if (proposed.late_deduction !== current.late_deduction) {
      notes.push(`potongan terlambat ${formatDelta(-current.late_deduction, -proposed.late_deduction)}`);
    }
    if (proposed.hourly !== current.hourly) {
      notes.push(`upah/jam ${formatDelta(current.hourly, proposed.hourly)}`);
    }
    return {
      employee_no: e.employee_no,
      full_name: e.full_name,
      before: current.gross,
      after: proposed.gross,
      note: notes.join(" · ") || "tidak berubah",
    };
  });

  return ok(SERVICE, {
    period: `${input.period_start} → ${input.period_end}`,
    before_total: lines.reduce((s, l) => s + l.before, 0),
    after_total: lines.reduce((s, l) => s + l.after, 0),
    lines: lines.filter((l) => l.before !== l.after),
  });
}

function formatDelta(before: number, after: number): string {
  const d = after - before;
  return `${d > 0 ? "+" : ""}${new Intl.NumberFormat("id-ID").format(d)}`;
}

export async function listPayrollRuns(): Promise<Result<PayrollRun[]>> {
  await latency();
  return ok(SERVICE, [...getState().payroll_runs].sort((a, b) => b.period_end.localeCompare(a.period_end)));
}

export async function getPayroll(runNo: string): Promise<Result<PayrollView>> {
  await latency();
  const state = getState();
  const run = state.payroll_runs.find((r) => r.run_no === runNo);
  if (!run) return notFound(SERVICE, "run_not_found", `No payroll run ${runNo}.`);
  return ok(SERVICE, payrollView(state, run));
}

/** Any week, run or no run.
 *
 *  The workshop is paid weekly, and the question HRD actually asks is *what
 *  does this week look like* — not *what does run pyr-26-09-06_01 look like*
 *  (owner). So a period can be read on its own: the figures are derived from
 *  the days either way (A3), and opening a run adds a document, not a
 *  calculation.
 *
 *  When a run already covers the period, that run is returned — with its
 *  status and its hand-written adjustments, which belong to the run and not to
 *  the week (D155). Otherwise the same figures come back under an empty run
 *  number, and the screen says plainly that nothing has been opened yet.
 */
export async function previewPayroll(
  input: { period_start: string; period_end: string },
): Promise<Result<PayrollView & { opened: boolean }>> {
  await latency();
  if (input.period_end < input.period_start) {
    return invalid(SERVICE, "period_invalid", "The period ends before it starts.", { field: "period_end" });
  }
  const state = getState();
  const run = state.payroll_runs.find(
    (r) => r.period_start === input.period_start && r.period_end === input.period_end,
  );
  if (run) return ok(SERVICE, { ...payrollView(state, run), opened: true });

  /* A period nobody has opened. The run number is empty on purpose: there is
     no document, and inventing one here would make a payslip printable for a
     run that does not exist. */
  const virtual: PayrollRun = {
    id: "", run_no: "",
    period_start: input.period_start, period_end: input.period_end,
    status: "DRAFT",
    created_at: new Date().toISOString(), created_by: "",
    approved_at: null, approved_by: null, paid_trx_no: null,
    note: null,
  };
  return ok(SERVICE, { ...payrollView(state, virtual), opened: false });
}

/** Opening a run for a period. It computes immediately — there is nothing to
 *  "generate", because the figures are derived from the days (A3). */
export async function openPayroll(
  input: { period_start: string; period_end: string; note?: string | null },
  idempotencyKey?: string,
): Promise<Result<PayrollView>> {
  await latency();
  const cached = replayed<PayrollView>(SERVICE, "openPayroll", idempotencyKey);
  if (cached) return cached;

  const denied = requireModule(SERVICE, "payroll");
  if (denied) return denied;

  if (input.period_end < input.period_start) {
    return invalid(SERVICE, "period_invalid", "The period ends before it starts.", { field: "period_end" });
  }
  const state = getState();
  const clash = state.payroll_runs.find(
    (r) => r.period_start === input.period_start && r.period_end === input.period_end,
  );
  if (clash) {
    return conflict(SERVICE, "period_already_run", `${clash.run_no} already covers that period.`);
  }

  const user = actingUser();
  let runNo = "";
  apply((draft) => {
    runNo = nextDocNumber(draft, "pyr");
    draft.payroll_runs.unshift({
      id: newId("pay"), run_no: runNo,
      period_start: input.period_start, period_end: input.period_end,
      status: "DRAFT",
      created_at: new Date().toISOString(), created_by: user.id,
      approved_at: null, approved_by: null, paid_trx_no: null,
      note: input.note?.trim() || null,
    });
    writeAudit(draft, {
      service: SERVICE, entity: "payroll", entity_no: runNo,
      action: "open", outcome: "ok", reason: null,
      detail: { period: `${input.period_start}…${input.period_end}`, by: user.email },
    });
  });
  const view = await getPayroll(runNo);
  if (view.data) remember(SERVICE, "openPayroll", idempotencyKey, view.data);
  return view;
}

/** Approving a run.
 *
 *  Refused while any day in the period is still open. A payroll computed over
 *  days nobody finished recording is a number that looks exact and is not, and
 *  the people it is wrong about are the ones least able to argue (D139).
 */
export async function approvePayroll(runNo: string): Promise<Result<PayrollView>> {
  await latency();
  const denied = requireAuthority(SERVICE, "approve_funds");
  if (denied) return denied;

  const state = getState();
  const run = state.payroll_runs.find((r) => r.run_no === runNo);
  if (!run) return notFound(SERVICE, "run_not_found", `No payroll run ${runNo}.`);
  if (run.status !== "DRAFT") {
    return conflict(SERVICE, "already_decided", `${runNo} is ${run.status}.`);
  }
  const view = payrollView(state, run);
  if (view.open_days > 0) {
    return invalid(
      SERVICE, "open_days",
      `${view.open_days} day(s) in this period are still unread — the machine left them incomplete and nobody has said what happened. Read them on the timesheet first: a payroll over days nobody finished recording is wrong about the people least able to argue.`,
      { field: "open_days" },
    );
  }

  const user = actingUser();
  apply((draft) => {
    const row = draft.payroll_runs.find((r) => r.run_no === runNo);
    if (!row) return;
    row.status = "APPROVED";
    row.approved_at = new Date().toISOString();
    row.approved_by = user.id;
    writeAudit(draft, {
      service: SERVICE, entity: "payroll", entity_no: runNo,
      action: "approve", outcome: "ok", reason: null,
      detail: { gross_total: view.gross_total, people: view.lines.length, by: user.email },
    });
    writeOutbox(draft, {
      service: SERVICE, event_type: "hr.payroll.approved",
      payload: { run_no: runNo, gross_total: view.gross_total, people: view.lines.length },
    });
  });
  return getPayroll(runNo);
}


