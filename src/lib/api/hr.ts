/** Implements `/api/v1/hr` against the database — the chain HRD actually works:
 *  enter somebody, their terms and their berkas, read the machine's file, mark
 *  the days nobody can describe, and the payroll follows from all of it.
 *
 *  The same rules as the other real clients. **Nothing derived is computed
 *  here**, no permission is checked here, and no refusal is reworded here: the
 *  seams decide, `0057` supplies the reads, and this file's job is **assembly**
 *  — the contracts hand the screens nested shapes (`EmployeeFileView` carries
 *  its slots, `TimesheetDay` carries its scans) and PostgREST hands back flat
 *  rows.
 *
 *  Where the line sits, since it is the one worth policing: grouping rows into
 *  a shape is assembly; working out a number is not. Every figure below came
 *  out of a view, a function or a seam's envelope — `expires_in_days`,
 *  `fixable`, `weekly_hours`, `day_value`, every payroll total — and the
 *  arithmetic in this file is `??`, `Boolean()` and one array `.length`.
 *
 *  ## Two places this file resolves a uuid, and why
 *
 *  The contracts pass fixture ids the demo happens to have — `unmarkDay(markId)`,
 *  `restoreAllowance({id})`, `attachSuratDokter({mark_id})` — while every seam
 *  in this system is addressed by a **public code**, because that is what
 *  survives a service being split out and what the team says out loud (ADR-004,
 *  C17). Until the contract catches up the signatures here match the demo
 *  exactly and the uuid is resolved with one extra read. It costs a round trip
 *  and buys the property the whole swap rests on: a screen cannot tell which
 *  implementation it got (ADR-009).
 *
 *  ## One place the contract had to move, and it was not cosmetic
 *
 *  `unmarkDay` took an id and nothing else, because the demo **deleted the
 *  row**. The database does not: `0053` made a day mark withdrawable and never
 *  deletable, since *why was the fourteenth marked sick and then not* is asked
 *  three months later by the person whose payslip it is (A2, F123). A
 *  withdrawal with no sentence is refused, so the signature grew a `reason` —
 *  C19, and the demo grew the same parameter and stopped splicing.
 */
import type {
  Employee, PayBasis, EmployeeFileView, EmployeeDocKind, EmployeeDocumentView,
  EmployeeDocSlot, DocNoSource, AttendanceScan, DayMark, DayMarkKind,
  AllowanceWithholdingView, TimesheetDay, ScanSlot, ScanSource, DayState,
  OvertimeSheetView, OvertimeLineView, WorkSchedule, ScheduleHours,
} from "@/services/hr/contracts";
import {
  EMPLOYEE_DOC_CHECKLIST, EMPLOYEE_DOC_LABEL, SENSITIVE_DOC_KINDS,
} from "@/services/hr/contracts";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fromSeam, fromRows, notFound, ok, type Result } from "./_kit";

const SERVICE = "hr" as const;

/** Every object this module touches lives in `ops_hr`, and PostgREST has to be
 *  told so on every request — see the long note in `accounting.ts`. */
const db = () => supabaseBrowser().schema("ops_hr");
/** The evidence road and the document register are `ops_core`'s. */
const core = () => supabaseBrowser().schema("ops_core");

/** The employee columns the contract has. `select("*")` would also fetch
 *  `created_at`/`updated_at`, which nothing reads and which would make the cast
 *  below a lie by omission in the other direction. */
const EMPLOYEE_COLS =
  "id,employee_no,full_name,position,unit,schedule_code,pay_basis,base_rate,"
  + "allowance_rate,daily_hours,joined_on,paid_leave_days,active,left_on,note";

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

export async function listEmployees(
  opts: { include_left?: boolean } = {},
): Promise<Result<Employee[]>> {
  let q = db().from("employees").select(EMPLOYEE_COLS).order("employee_no");
  if (!opts.include_left) q = q.eq("active", true);
  const { data, error } = await q;
  return fromRows<Employee[]>(SERVICE, data as unknown as Employee[], error);
}

async function readEmployee(employeeNo: string): Promise<Result<Employee>> {
  const { data, error } = await db()
    .from("employees").select(EMPLOYEE_COLS).eq("employee_no", employeeNo).maybeSingle();
  if (error) return fromRows<Employee>(SERVICE, null, error);
  if (!data) return notFound(SERVICE, "employee_not_found", `No employee ${employeeNo}.`);
  return ok(SERVICE, data as unknown as Employee);
}

/** One form for the new hire and the change of terms, which is what the screen
 *  has. The seam answers with a summary of what it wrote; the screen redraws a
 *  whole `Employee`, so the row is read back.
 *
 *  `p_set_schedule` carries the difference SQL cannot: **absent** leaves the
 *  working pattern alone, **null** is a deliberate unlink (D279).
 */
export async function saveEmployee(
  input: {
    employee_no: string;
    full_name: string;
    position: string;
    unit: string;
    pay_basis: PayBasis;
    base_rate: number;
    allowance_rate?: number;
    daily_hours?: number;
    schedule_code?: string | null;
    paid_leave_days?: number;
    joined_on?: string;
    note?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<Employee>> {
  const { data, error } = await db().rpc("save_employee", {
    p_employee_no: input.employee_no,
    p_full_name: input.full_name,
    p_position: input.position,
    p_unit: input.unit,
    p_pay_basis: input.pay_basis,
    p_base_rate: input.base_rate,
    p_allowance_rate: input.allowance_rate ?? null,
    p_daily_hours: input.daily_hours ?? null,
    p_schedule_code: input.schedule_code ?? null,
    p_set_schedule: "schedule_code" in input,
    p_paid_leave_days: input.paid_leave_days ?? null,
    p_joined_on: input.joined_on ?? null,
    p_note: input.note ?? null,
    p_key: idempotencyKey ?? null,
  });
  const said = fromSeam<{ employee_no: string }>(SERVICE, data, error);
  if (said.error) return said as unknown as Result<Employee>;
  return readEmployee(said.data.employee_no);
}

export async function setEmployeeSchedule(
  input: { employee_no: string; schedule_code: string | null },
): Promise<Result<Employee>> {
  const { data, error } = await db().rpc("set_employee_schedule", {
    p_employee_no: input.employee_no,
    p_schedule_code: input.schedule_code,
    p_key: null,
  });
  const said = fromSeam<{ employee_no: string }>(SERVICE, data, error);
  /* A noop is a success with nothing written — the pattern was already that —
     and the screen still redraws the person. */
  if (said.error) return said as unknown as Result<Employee>;
  return readEmployee(input.employee_no);
}

/** The working patterns, with the three states Q53 asks about. One read: every
 *  count, every name and the hours come out of `schedule_roll()`, because
 *  *how many people are on this pattern only because their unit says so* is a
 *  derivation and derivations do not live in a browser. */
export async function listSchedules(): Promise<Result<{
  schedules: (WorkSchedule & {
    hours: ScheduleHours;
    assigned: number;
    inherited: number;
    units: string[];
  })[];
  unlinked: { employee_no: string; full_name: string; unit: string }[];
  inherited: { employee_no: string; full_name: string; unit: string; schedule_code: string }[];
  week_pattern: string;
}>> {
  const { data, error } = await db().rpc("schedule_roll");
  return fromRows(SERVICE, data as never, error);
}

/* ------------------------------------------------------------------ */
/* Berkas 201                                                          */
/* ------------------------------------------------------------------ */

/** A row as `employee_documents_of()` answers it. The number for a sensitive
 *  kind is **not in it** — the database blanked it before it left (D196). */
interface DocRow {
  id: string;
  doc_ref: string;
  employee_id: string;
  employee_no: string;
  kind: EmployeeDocKind;
  attachment_id: string | null;
  doc_no: string | null;
  sensitive: boolean;
  doc_no_masked: string | null;
  doc_no_length: number | null;
  doc_no_length_ok: boolean | null;
  doc_no_source: DocNoSource | null;
  issued_on: string | null;
  expires_on: string | null;
  expires_in_days: number | null;
  note: string | null;
  recorded_by: string;
  recorded_at: string;
}

/** The berkas is a **checklist**, not a folder (D177): the list of what is
 *  missing is why the screen exists. The checklist itself is a constant in the
 *  contracts, read by both implementations, which is why grouping against it
 *  here is assembly rather than a second copy of a rule — adding a required
 *  kind makes every incomplete file say so the same day, in both clients, with
 *  nothing to back-fill. */
function buildFile(
  emp: Employee,
  docs: DocRow[],
): EmployeeFileView {
  const mine = docs.filter((d) => d.employee_no === emp.employee_no);
  const slots: EmployeeDocSlot[] = EMPLOYEE_DOC_CHECKLIST.map((c) => {
    const documents = mine
      .filter((d) => d.kind === c.kind)
      .map((d): EmployeeDocumentView => ({
        id: d.doc_ref,
        employee_id: d.employee_id,
        kind: d.kind,
        attachment_id: d.attachment_id,
        doc_no: d.doc_no,
        sensitive: d.sensitive,
        doc_no_masked: d.doc_no_masked,
        doc_no_length: d.doc_no_length,
        doc_no_length_ok: d.doc_no_length_ok,
        doc_no_source: d.doc_no_source,
        issued_on: d.issued_on,
        expires_on: d.expires_on,
        note: d.note,
        recorded_by: d.recorded_by,
        recorded_at: d.recorded_at,
      }));
    /* The soonest expiry in the slot. The number itself is the database's —
       counted from the office's today, not the viewer's browser (F17). */
    const soonest = mine
      .filter((d) => d.kind === c.kind && d.expires_in_days != null)
      .map((d) => d.expires_in_days as number)
      .sort((a, b) => a - b)[0];
    return {
      kind: c.kind,
      label: EMPLOYEE_DOC_LABEL[c.kind],
      required: c.required,
      note: c.note,
      documents,
      expires_in_days: soonest ?? null,
    };
  });

  const missing = slots.filter((s) => s.required && s.documents.length === 0).map((s) => s.kind);
  const expiring = mine
    .filter((d) => d.expires_in_days != null && (d.expires_in_days as number) <= 60)
    .map((d) => ({
      kind: d.kind,
      label: EMPLOYEE_DOC_LABEL[d.kind],
      expires_on: d.expires_on as string,
      days: d.expires_in_days as number,
    }))
    .sort((a, b) => a.days - b.days);

  return {
    employee_id: emp.id,
    employee_no: emp.employee_no,
    full_name: emp.full_name,
    position: emp.position,
    unit: emp.unit,
    joined_on: emp.joined_on,
    active: emp.active,
    slots,
    missing,
    expiring,
    complete: missing.length === 0,
  };
}

/** Two reads for the whole screen — one for the people, one for every document
 *  — rather than one per person. */
export async function listEmployeeFiles(): Promise<Result<EmployeeFileView[]>> {
  const people = await listEmployees();
  if (people.error) return people as unknown as Result<EmployeeFileView[]>;
  const { data, error } = await db().rpc("employee_documents_of", { p_employee_no: null });
  if (error) return fromRows<EmployeeFileView[]>(SERVICE, null, error);

  const docs = (data ?? []) as DocRow[];
  const files = people.data.map((e) => buildFile(e, docs));
  /* Incomplete first, then whatever expires soonest: the two reasons anybody
     opens this screen. */
  files.sort((a, b) => {
    if (a.complete !== b.complete) return a.complete ? 1 : -1;
    const ax = a.expiring[0]?.days ?? 9999;
    const bx = b.expiring[0]?.days ?? 9999;
    if (ax !== bx) return ax - bx;
    return a.full_name.localeCompare(b.full_name);
  });
  return ok(SERVICE, files);
}

export async function getEmployeeFile(employeeNo: string): Promise<Result<EmployeeFileView>> {
  const emp = await readEmployee(employeeNo);
  if (emp.error) return emp as unknown as Result<EmployeeFileView>;
  const { data, error } = await db().rpc("employee_documents_of", { p_employee_no: employeeNo });
  if (error) return fromRows<EmployeeFileView>(SERVICE, null, error);
  return ok(SERVICE, buildFile(emp.data, (data ?? []) as DocRow[]));
}

/** Filing one. The seam puts the file on the evidence road itself — one road on
 *  and one road off (ADR-010) — so this passes the attachment and nothing here
 *  writes a link. */
export async function saveEmployeeDocument(
  input: {
    employee_no: string; kind: EmployeeDocKind;
    attachment_id?: string | null; doc_no?: string | null;
    doc_no_source?: DocNoSource;
    issued_on?: string | null; expires_on?: string | null; note?: string | null;
  },
): Promise<Result<EmployeeFileView>> {
  const { data, error } = await db().rpc("file_employee_document", {
    p_employee_no: input.employee_no,
    p_kind: input.kind,
    p_attachment_id: input.attachment_id ?? null,
    p_doc_no: input.doc_no ?? null,
    p_doc_no_source: input.doc_no_source ?? null,
    p_issued_on: input.issued_on ?? null,
    p_expires_on: input.expires_on ?? null,
    p_note: input.note ?? null,
    p_key: null,
  });
  const said = fromSeam<{ doc_ref: string }>(SERVICE, data, error);
  if (said.error) return said as unknown as Result<EmployeeFileView>;
  return getEmployeeFile(input.employee_no);
}

/** Opening one number, on purpose, and writing a row that says who looked and
 *  never at what (D196, D197). `docId` is the document's public reference here,
 *  which is what `EmployeeDocumentView.id` carries. */
export async function revealEmployeeDocNo(
  docId: string,
): Promise<Result<{ doc_id: string; doc_no: string; revealed_at: string }>> {
  const { data, error } = await db().rpc("reveal_employee_doc_no", {
    p_doc_ref: docId, p_key: null,
  });
  const said = fromSeam<{ doc_ref: string; doc_no: string; revealed_at: string }>(
    SERVICE, data, error);
  if (said.error) return said as unknown as Result<{ doc_id: string; doc_no: string; revealed_at: string }>;
  return ok(SERVICE, {
    doc_id: said.data.doc_ref,
    doc_no: said.data.doc_no,
    revealed_at: said.data.revealed_at,
  });
}

/* ------------------------------------------------------------------ */
/* Attendance                                                          */
/* ------------------------------------------------------------------ */

export async function importScans(
  input: {
    filename: string;
    rows: { employee_ref: string; at: string; verify: string; location?: string | null }[];
  },
  idempotencyKey?: string,
): Promise<Result<{
  import_id: string; added: number; duplicates: number;
  unknown: { ref: string; count: number }[];
}>> {
  const { data, error } = await db().rpc("import_scans", {
    p_filename: input.filename,
    p_rows: input.rows,
    p_key: idempotencyKey ?? null,
  });
  return fromSeam(SERVICE, data, error);
}

export async function addScan(
  input: { employee_no: string; work_date: string; time: string; reason: string },
): Promise<Result<AttendanceScan>> {
  /* The contract carries the day and the clock time apart, because that is how
     somebody types it off a note; the seam takes the instant. WITA is the
     office's zone and the one the machine prints in (F17). */
  const { data, error } = await db().rpc("add_scan", {
    p_employee_no: input.employee_no,
    p_at: `${input.work_date}T${input.time}:00+08`,
    p_reason: input.reason,
    p_key: null,
  });
  const said = fromSeam<{ scan_id: string }>(SERVICE, data, error);
  if (said.error) return said as unknown as Result<AttendanceScan>;
  const { data: row, error: e2 } = await db()
    .from("attendance_scans")
    .select("id,employee_id,work_date,at,verify,location,source,import_id,reason,recorded_by,recorded_at")
    .eq("id", said.data.scan_id).single();
  return fromRows<AttendanceScan>(SERVICE, row as unknown as AttendanceScan, e2);
}

export async function markDay(
  input: { work_date: string; kind: DayMarkKind; reason: string; employee_no?: string | null },
): Promise<Result<DayMark>> {
  const { data, error } = await db().rpc("mark_day", {
    p_work_date: input.work_date,
    p_kind: input.kind,
    p_reason: input.reason,
    p_employee_no: input.employee_no ?? null,
    p_key: null,
  });
  const said = fromSeam<{ mark_no: string }>(SERVICE, data, error);
  if (said.error) return said as unknown as Result<DayMark>;
  const { data: row, error: e2 } = await db()
    .from("day_marks")
    .select("id,employee_id,work_date,kind,reason,marked_by,marked_at")
    .eq("mark_no", said.data.mark_no).single();
  return fromRows<DayMark>(SERVICE, row as unknown as DayMark, e2);
}

/** **Withdrawn, never deleted** (A2) — see the note at the top of this file for
 *  why the signature carries a reason the demo's did not. `markId` is the
 *  mark's uuid, as the screen holds it; the seam is addressed by `mark_no`. */
export async function unmarkDay(markId: string, reason: string): Promise<Result<{ removed: string }>> {
  const { data: mark, error: e1 } = await db()
    .from("day_marks").select("mark_no").eq("id", markId).maybeSingle();
  if (e1) return fromRows<{ removed: string }>(SERVICE, null, e1);
  if (!mark) return notFound(SERVICE, "mark_not_found", "No such mark.");

  const { data, error } = await db().rpc("withdraw_mark", {
    p_mark_no: (mark as { mark_no: string }).mark_no,
    p_reason: reason,
    p_key: null,
  });
  const said = fromSeam<unknown>(SERVICE, data, error);
  if (said.error) return said as unknown as Result<{ removed: string }>;
  return ok(SERVICE, { removed: markId });
}

export async function withholdAllowance(
  input: { employee_no: string; work_date: string; reason: string },
  idempotencyKey?: string,
): Promise<Result<AllowanceWithholdingView>> {
  const { data, error } = await db().rpc("withhold_allowance", {
    p_employee_no: input.employee_no,
    p_work_date: input.work_date,
    p_reason: input.reason,
    p_key: idempotencyKey ?? null,
  });
  const said = fromSeam<unknown>(SERVICE, data, error);
  if (said.error) return said as unknown as Result<AllowanceWithholdingView>;
  return readWithholding(input.employee_no, input.work_date);
}

/** The contract addresses this one by id, which is the demo's fixture id; the
 *  seam takes the person and the day (ADR-004, C17), so the id is resolved
 *  first. */
export async function restoreAllowance(
  input: { id: string; reason: string },
): Promise<Result<AllowanceWithholdingView>> {
  const { data: row, error: e1 } = await db()
    .from("allowance_withholdings").select("employee_id,work_date").eq("id", input.id).maybeSingle();
  if (e1) return fromRows<AllowanceWithholdingView>(SERVICE, null, e1);
  if (!row) return notFound(SERVICE, "withholding_not_found", "Tidak ada pemotongan itu.");

  const { data: emp, error: e2 } = await db()
    .from("employees").select("employee_no")
    .eq("id", (row as { employee_id: string }).employee_id).single();
  if (e2) return fromRows<AllowanceWithholdingView>(SERVICE, null, e2);

  const workDate = (row as { work_date: string }).work_date;
  const { data, error } = await db().rpc("restore_allowance", {
    p_employee_no: (emp as { employee_no: string }).employee_no,
    p_work_date: workDate,
    p_reason: input.reason,
    p_key: null,
  });
  const said = fromSeam<unknown>(SERVICE, data, error);
  if (said.error) return said as unknown as Result<AllowanceWithholdingView>;
  return readWithholding((emp as { employee_no: string }).employee_no, workDate);
}

async function readWithholding(
  employeeNo: string, workDate: string,
): Promise<Result<AllowanceWithholdingView>> {
  const { data, error } = await db()
    .from("v_allowance_withholding").select("*")
    .eq("employee_no", employeeNo).eq("work_date", workDate).single();
  return fromRows<AllowanceWithholdingView>(
    SERVICE, data as unknown as AllowanceWithholdingView, error);
}

export async function listWithholdings(
  opts: { employee_no?: string; from?: string; to?: string } = {},
): Promise<Result<AllowanceWithholdingView[]>> {
  let q = db().from("v_allowance_withholding").select("*")
    .order("work_date", { ascending: false });
  if (opts.employee_no) q = q.eq("employee_no", opts.employee_no);
  if (opts.from) q = q.gte("work_date", opts.from);
  if (opts.to) q = q.lte("work_date", opts.to);
  const { data, error } = await q;
  return fromRows<AllowanceWithholdingView[]>(
    SERVICE, data as unknown as AllowanceWithholdingView[], error);
}

/** The letter that makes a sick day paid. The rule that it belongs to a day
 *  marked *sakit* is the seam's, not this file's (`0057`); the filing itself
 *  goes down the evidence road like every other document. */
export async function attachSuratDokter(
  input: { mark_id: string; attachment_id: string },
): Promise<Result<{ mark_id: string; attachment_id: string }>> {
  const { data: mark, error: e1 } = await db()
    .from("day_marks").select("mark_no").eq("id", input.mark_id).maybeSingle();
  if (e1) return fromRows<{ mark_id: string; attachment_id: string }>(SERVICE, null, e1);
  if (!mark) return notFound(SERVICE, "mark_not_found", "No such mark.");

  const { data, error } = await db().rpc("attach_surat_dokter", {
    p_mark_no: (mark as { mark_no: string }).mark_no,
    p_attachment_id: input.attachment_id,
    p_key: null,
  });
  const said = fromSeam<unknown>(SERVICE, data, error);
  if (said.error) return said as unknown as Result<{ mark_id: string; attachment_id: string }>;
  return ok(SERVICE, { mark_id: input.mark_id, attachment_id: input.attachment_id });
}

/* ------------------------------------------------------------------ */
/* The timesheet                                                       */
/* ------------------------------------------------------------------ */

/** One day as `timesheet_rows()` answers it: the reading, plus whether an
 *  unpaid day is still fixable. */
interface DayRow {
  employee_id: string;
  employee_no: string;
  full_name: string;
  work_date: string;
  in_at: string | null;
  break_out_at: string | null;
  break_in_at: string | null;
  out_at: string | null;
  ot_start_at: string | null;
  ot_end_at: string | null;
  work_hours: number;
  break_hours: number;
  overtime_hours: number;
  day_value: number;
  state: DayState;
  mark_no: string | null;
  mark_kind: string | null;
  why: string;
  fixable: string | null;
  issues: string[];
  notes: string[];
}

interface ScanRow {
  id: string; employee_id: string; work_date: string; at: string;
  verify: string | null; source: ScanSource;
}

/** Which slot a tap was placed in. **Read off the reading, not worked out
 *  again**: the slot rule is sequential and lives in `read_day`, so matching a
 *  tap to the instants the reading reports is how this file learns the answer
 *  rather than deciding it a second time (D141). */
function slotOf(row: DayRow, at: string): ScanSlot | null {
  if (row.in_at === at) return "in";
  if (row.break_out_at === at) return "break_out";
  if (row.break_in_at === at) return "break_in";
  if (row.out_at === at) return "out";
  if (row.ot_start_at === at) return "ot_start";
  if (row.ot_end_at === at) return "ot_end";
  return null;
}

function buildDay(row: DayRow, scans: ScanRow[], marks: DayMark[]): TimesheetDay {
  const mine = scans.filter(
    (s) => s.employee_id === row.employee_id && s.work_date === row.work_date);
  const slots: Partial<Record<ScanSlot, string>> = {};
  if (row.in_at) slots.in = row.in_at;
  if (row.break_out_at) slots.break_out = row.break_out_at;
  if (row.break_in_at) slots.break_in = row.break_in_at;
  if (row.out_at) slots.out = row.out_at;
  if (row.ot_start_at) slots.ot_start = row.ot_start_at;
  if (row.ot_end_at) slots.ot_end = row.ot_end_at;

  const mark = row.mark_no
    ? marks.find((m) => m.work_date === row.work_date
        && (m.employee_id === row.employee_id || m.employee_id === null)) ?? null
    : null;

  return {
    employee_id: row.employee_id,
    employee_no: row.employee_no,
    full_name: row.full_name,
    work_date: row.work_date,
    scans: mine
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((s) => ({
        at: s.at, verify: s.verify ?? "", slot: slotOf(row, s.at), source: s.source,
      })),
    slots,
    state: row.state,
    mark,
    work_hours: row.work_hours,
    break_hours: row.break_hours,
    overtime_hours: row.overtime_hours,
    day_value: row.day_value,
    pay: { value: row.day_value, why: row.why, fixable: row.fixable },
    issues: row.issues ?? [],
    notes: row.notes ?? [],
  };
}

/** The three reads a range of days is made of, done once for the whole range:
 *  the readings, the taps behind them and the marks on them. One query per
 *  table, not per day. */
async function readDays(
  from: string, to: string, unit?: string, employeeNo?: string,
): Promise<Result<TimesheetDay[]>> {
  const { data, error } = await db().rpc("timesheet_rows", {
    p_from: from, p_to: to, p_unit: unit ?? null, p_employee_no: employeeNo ?? null,
  });
  if (error) return fromRows<TimesheetDay[]>(SERVICE, null, error);
  const rows = (data ?? []) as DayRow[];

  const { data: scans, error: e2 } = await db()
    .from("attendance_scans").select("id,employee_id,work_date,at,verify,source")
    .gte("work_date", from).lte("work_date", to);
  if (e2) return fromRows<TimesheetDay[]>(SERVICE, null, e2);

  const { data: marks, error: e3 } = await db()
    .from("day_marks").select("id,employee_id,work_date,kind,reason,marked_by,marked_at")
    .gte("work_date", from).lte("work_date", to).is("withdrawn_at", null);
  if (e3) return fromRows<TimesheetDay[]>(SERVICE, null, e3);

  return ok(SERVICE, rows.map(
    (r) => buildDay(r, (scans ?? []) as ScanRow[], (marks ?? []) as unknown as DayMark[])));
}

export async function attendanceFor(
  input: { employee_no: string; from: string; to: string },
): Promise<Result<TimesheetDay[]>> {
  return readDays(input.from, input.to, undefined, input.employee_no);
}

export async function getTimesheet(
  input: { from: string; to: string; unit?: string },
): Promise<Result<{
  days: TimesheetDay[];
  dates: string[];
  employees: { employee_no: string; full_name: string; pay_basis: PayBasis }[];
  needs_review: number;
  marked: number;
}>> {
  const read = await readDays(input.from, input.to, input.unit);
  if (read.error) return read as unknown as Result<never>;
  const days = read.data;

  let q = db().from("employees").select("employee_no,full_name,pay_basis")
    .eq("active", true).order("employee_no");
  if (input.unit) q = q.eq("unit", input.unit);
  const { data: people, error } = await q;
  if (error) {
    return fromRows<{
      days: TimesheetDay[]; dates: string[];
      employees: { employee_no: string; full_name: string; pay_basis: PayBasis }[];
      needs_review: number; marked: number;
    }>(SERVICE, null, error);
  }

  return ok(SERVICE, {
    days,
    dates: [...new Set(days.map((d) => d.work_date))].sort(),
    employees: (people ?? []) as { employee_no: string; full_name: string; pay_basis: PayBasis }[],
    /* Counting rows this function was just handed is not deriving a figure —
       every day's own `state` came out of `read_day`. */
    needs_review: days.filter((d) => d.state === "review").length,
    marked: days.filter((d) => d.state === "marked").length,
  });
}

export async function getDay(
  input: { employee_no: string; work_date: string },
): Promise<Result<TimesheetDay>> {
  const read = await readDays(input.work_date, input.work_date, undefined, input.employee_no);
  if (read.error) return read as unknown as Result<TimesheetDay>;
  const day = read.data[0];
  if (!day) return notFound(SERVICE, "employee_not_found", `No employee ${input.employee_no}.`);
  return ok(SERVICE, day);
}

/* ------------------------------------------------------------------ */
/* Overtime, as the attendance screen lists it                         */
/* ------------------------------------------------------------------ */

export async function listOvertimeSheets(): Promise<Result<OvertimeSheetView[]>> {
  const { data: sheets, error } = await db()
    .from("overtime_sheets").select("*").order("work_date", { ascending: false });
  if (error) return fromRows<OvertimeSheetView[]>(SERVICE, null, error);

  const { data: claims, error: e2 } = await db()
    .from("v_overtime_claim").select("sheet_no,stage,payable,hours");
  if (e2) return fromRows<OvertimeSheetView[]>(SERVICE, null, e2);

  const { data: lines, error: e3 } = await db()
    .from("overtime_lines").select("*");
  if (e3) return fromRows<OvertimeSheetView[]>(SERVICE, null, e3);

  const { data: people, error: e4 } = await db()
    .from("employees").select("id,employee_no,full_name");
  if (e4) return fromRows<OvertimeSheetView[]>(SERVICE, null, e4);

  /* The signed form, on the evidence road. One read for every sheet rather
     than one per sheet. */
  const { data: links, error: e5 } = await core()
    .from("attachment_links")
    .select("entity_no,kind,attachment_id,attachments(filename)")
    .eq("entity", "overtime_sheet").is("unlinked_at", null);
  if (e5) return fromRows<OvertimeSheetView[]>(SERVICE, null, e5);

  const byId = new Map(
    ((people ?? []) as { id: string; employee_no: string; full_name: string }[])
      .map((p) => [p.id, p]));
  const claimOf = new Map(
    ((claims ?? []) as { sheet_no: string; stage: string; payable: boolean; hours: number }[])
      .map((c) => [c.sheet_no, c]));
  const linkOf = new Map(
    ((links ?? []) as unknown as {
      entity_no: string; kind: string; attachment_id: string;
      attachments: { filename: string } | null;
    }[]).map((l) => [l.entity_no, l]));

  const rows = ((sheets ?? []) as unknown as (OvertimeSheetView & { id: string })[]).map((s) => {
    const claim = claimOf.get(s.sheet_no);
    const link = linkOf.get(s.sheet_no);
    return {
      ...s,
      lines: ((lines ?? []) as unknown as (OvertimeLineView & { sheet_id: string })[])
        .filter((l) => l.sheet_id === s.id)
        .map((l): OvertimeLineView => ({
          ...l,
          employee_no: byId.get((l as unknown as { employee_id: string }).employee_id)?.employee_no ?? "",
          full_name: byId.get((l as unknown as { employee_id: string }).employee_id)?.full_name ?? "",
        })),
      stage: claim?.stage as OvertimeSheetView["stage"],
      payable: claim?.payable ?? false,
      total_hours: claim?.hours ?? 0,
      evidence: link
        ? {
            attachment_id: link.attachment_id,
            filename: link.attachments?.filename ?? "",
            kind: link.kind,
          }
        : null,
    } as OvertimeSheetView;
  });
  return ok(SERVICE, rows);
}
