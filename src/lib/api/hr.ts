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
  ContractKind, ContractStatus, ClauseKind, ClauseChecklistItem,
  ContractView, ContractDetail, ContractClause, ClauseCoverage, ClauseConflict,
  PayRules, PayRuleSetView, TimesheetTotal, EffectiveDaysCalendar,
  PayrollRun, PayrollView, PayrollLine, PayrollAdjustmentView,
  AdjustmentKind, ContributionScheme,
  LeaveKind, LeaveStatus, LeaveRequestView, LeaveBalance,
} from "@/services/hr/contracts";
import {
  EMPLOYEE_DOC_CHECKLIST, EMPLOYEE_DOC_LABEL, SENSITIVE_DOC_KINDS,
  ADJUSTMENT_LABEL, SCHEME_LABEL,
} from "@/services/hr/contracts";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fromSeam, fromRows, notFound, invalid, ok, type Result } from "./_kit";

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
/* Cuti — pengajuan dan keputusan                                      */
/* ------------------------------------------------------------------ */
//
// `/hrd/cuti` was dark for a different reason from the payroll screens: they
// had a seam short of its contract, this had **no table at all**. `0123` adds
// one, and keeps it apart from `day_marks` (D142) — a mark is what the
// timesheet reads, a request is a decision with a name and a sentence on it.

export async function listLeaveRequests(): Promise<Result<LeaveRequestView[]>> {
  /* Waiting first, then newest: a queue is not a filing cabinet. Ordered by
     the database rather than re-sorted here, so the demo and the real client
     hand the screen the same order. */
  const { data, error } = await db()
    .from("v_leave_request")
    .select("*")
    .order("status", { ascending: true })
    .order("from_date", { ascending: false });
  if (error) return fromRows<LeaveRequestView[]>(SERVICE, null as never, error);

  const rows = ((data ?? []) as unknown as LeaveRequestView[]).slice().sort((a, b) => {
    if ((a.status === "PENDING") !== (b.status === "PENDING")) return a.status === "PENDING" ? -1 : 1;
    return b.from_date.localeCompare(a.from_date);
  });
  return fromRows<LeaveRequestView[]>(SERVICE, rows as never, null);
}

export async function listLeaveBalances(): Promise<Result<LeaveBalance[]>> {
  const { data, error } = await db().rpc("leave_balances", { p_year: null });
  return fromRows<LeaveBalance[]>(SERVICE, data as never, error);
}

export async function requestLeave(
  input: { employee_no: string; kind: LeaveKind; from_date: string; to_date: string; reason: string },
  idempotencyKey?: string,
): Promise<Result<LeaveRequestView>> {
  const { data, error } = await db().rpc("request_leave", {
    p_employee_no: input.employee_no, p_kind: input.kind,
    p_from: input.from_date, p_to: input.to_date,
    p_reason: input.reason, p_key: idempotencyKey ?? null,
  });
  const made = fromSeam<{ request_no: string }>(SERVICE, data, error);
  if (made.error) return made as unknown as Result<LeaveRequestView>;

  /* Read back through the view rather than assembling the row here: the
     paid/unpaid split and the clashing days are derived, and a client that
     computed them would be a second opinion about somebody's entitlement. */
  const { data: row, error: readErr } = await db()
    .from("v_leave_request").select("*")
    .eq("request_no", made.data.request_no).maybeSingle();
  if (readErr) return fromRows<LeaveRequestView>(SERVICE, null as never, readErr);
  if (!row) {
    return notFound(SERVICE, "request_not_found",
      `Pengajuan ${made.data.request_no} tersimpan tapi tidak terbaca kembali.`);
  }
  return ok(SERVICE, row as unknown as LeaveRequestView);
}

export async function decideLeave(
  input: { request_no: string; approved: boolean; note?: string | null },
): Promise<Result<{ request_no: string; status: LeaveStatus; marked: string[]; skipped: string[] }>> {
  const { data, error } = await db().rpc("decide_leave", {
    p_request_no: input.request_no, p_approved: input.approved,
    p_note: input.note ?? null, p_key: null,
  });
  /* `marked` and `skipped` come straight back from the seam. The screen needs
     both: approving days that already carry a mark is the one thing this can
     half-do, and reporting a clean success over a silent collision is how a
     tanggal merah quietly becomes somebody's cuti. */
  return fromSeam<{ request_no: string; status: LeaveStatus; marked: string[]; skipped: string[] }>(
    SERVICE, data, error);
}

/* ------------------------------------------------------------------ */
/* Payroll                                                             */
/* ------------------------------------------------------------------ */
//
// The eight functions the four payroll screens call, and the reason they did
// not exist until `0119`: `payroll_figures` was eighteen fields short of
// `PayrollLine`, so a live client could only have half-filled the contract and
// cast the gap away. `swap()` refused them by name instead, which is the right
// failure — a screen that renders with half its figures missing looks like a
// screen that works (ADR-009, and the `inventory` trap that file documents).
//
// **These assemble; they do not compute.** Every figure arrives from
// `run_lines`, `period_lines` and `payroll_totals`. The only thing added in the
// browser is a **word**: `ADJUSTMENT_LABEL` and `SCHEME_LABEL` turn a `kind`
// and a `scheme` into Indonesian. That is presentation, not arithmetic, and
// keeping it here is why the database does not store the same string twice.

/** One row of `run_lines`/`period_lines`, with the labels the contract wants
 *  put back on. The shape the database returns is deliberately label-free. */
function toPayrollLine(row: Record<string, unknown>): PayrollLine {
  const adjustments = (row.adjustments as { kind: AdjustmentKind; amount: number; reason: string }[] ?? [])
    .map((a) => ({ ...a, label: ADJUSTMENT_LABEL[a.kind] ?? a.kind }));
  const contributions = (row.contributions as {
    scheme: ContributionScheme; base: number; employee: number; employer: number;
  }[] ?? []).map((c) => ({ ...c, label: SCHEME_LABEL[c.scheme] ?? c.scheme }));

  return {
    ...(row as unknown as PayrollLine),
    /* `worked_days`/`days_worked` and `open_days`/`days_open` are the same two
       numbers under two spellings, and `0119` fills both. Read the contract's
       spelling and fall back to the older one, so a row from anywhere answers. */
    days_worked: (row.days_worked ?? row.worked_days) as number,
    days_open: (row.days_open ?? row.open_days) as number,
    adjustments,
    contributions,
  };
}

export async function listPayrollRuns(): Promise<Result<PayrollRun[]>> {
  const { data, error } = await db()
    .from("payroll_runs")
    .select("id, run_no, period_start, period_end, status, created_at, created_by, "
          + "approved_at, approved_by, paid_trx_no, note")
    .order("period_end", { ascending: false });
  return fromRows<PayrollRun[]>(SERVICE, data as never, error);
}

/** A period's figures, with or without a run behind them.
 *
 *  Shared by `getPayroll`, `previewPayroll` and the two writes, because all
 *  four answer the same question and only differ in which period they ask
 *  about. `run_no` null means *nobody has opened this week*: the lines still
 *  compute, because the figures come from the days either way (A3), and the
 *  adjustments are empty because an adjustment belongs to a run (D155).
 */
async function periodView(
  run: PayrollRun, useRunLines: boolean,
): Promise<Result<PayrollView>> {
  const lines = useRunLines
    ? await db().rpc("run_lines", { p_run_no: run.run_no })
    : await db().rpc("period_lines", {
        p_from: run.period_start, p_to: run.period_end, p_run_no: null,
      });
  if (lines.error) return fromRows<PayrollView>(SERVICE, null as never, lines.error);

  const totals = await db().rpc("payroll_totals", {
    p_from: run.period_start, p_to: run.period_end,
    p_run_no: run.run_no === "" ? null : run.run_no,
  });
  if (totals.error) return fromRows<PayrollView>(SERVICE, null as never, totals.error);

  /* The header figures come from the database rather than from summing the
     rows just handed over: two implementations adding up money is two chances
     to round it differently, which is what `payroll_totals` exists to stop. */
  const t = (Array.isArray(totals.data) ? totals.data[0] : totals.data) as {
    people: number; gross_total: number; adjustment_total: number;
    net_total: number; open_days: number; pending_overtime_hours: number;
  } | null;

  return ok(SERVICE, {
    ...run,
    lines: ((lines.data ?? []) as Record<string, unknown>[]).map(toPayrollLine),
    gross_total: t?.gross_total ?? 0,
    net_total: t?.net_total ?? 0,
    adjustment_total: t?.adjustment_total ?? 0,
    open_days: t?.open_days ?? 0,
    pending_overtime_hours: t?.pending_overtime_hours ?? 0,
  });
}

async function runByNo(runNo: string): Promise<PayrollRun | null> {
  const { data } = await db()
    .from("payroll_runs")
    .select("id, run_no, period_start, period_end, status, created_at, created_by, "
          + "approved_at, approved_by, paid_trx_no, note")
    .eq("run_no", runNo).maybeSingle();
  return (data as PayrollRun | null) ?? null;
}

export async function getPayroll(runNo: string): Promise<Result<PayrollView>> {
  const run = await runByNo(runNo);
  if (!run) return notFound(SERVICE, "run_not_found", `Tidak ada run gaji ${runNo}.`);
  return periodView(run, true);
}

/** Any week, run or no run.
 *
 *  The workshop is paid weekly and the question HRD asks is *what does this
 *  week look like*, not *what does run pyr-26-09-06_01 look like* (owner). So
 *  a period reads on its own; opening a run adds a document, not a
 *  calculation. The empty `run_no` is deliberate — inventing one here would
 *  make a payslip printable for a run that does not exist.
 */
export async function previewPayroll(
  input: { period_start: string; period_end: string },
): Promise<Result<PayrollView & { opened: boolean }>> {
  if (input.period_end < input.period_start) {
    return invalid(SERVICE, "period_invalid", "Periodenya berakhir sebelum dimulai.",
                   { field: "period_end" });
  }
  const { data } = await db()
    .from("payroll_runs")
    .select("id, run_no, period_start, period_end, status, created_at, created_by, "
          + "approved_at, approved_by, paid_trx_no, note")
    .eq("period_start", input.period_start).eq("period_end", input.period_end)
    .maybeSingle();

  const existing = data as PayrollRun | null;
  const run: PayrollRun = existing ?? {
    id: "", run_no: "",
    period_start: input.period_start, period_end: input.period_end,
    status: "DRAFT", created_at: new Date().toISOString(), created_by: "",
    approved_at: null, approved_by: null, paid_trx_no: null, note: null,
  };
  const res = await periodView(run, existing !== null);
  if (res.error) return res as unknown as Result<PayrollView & { opened: boolean }>;
  return ok(SERVICE, { ...res.data, opened: existing !== null });
}

export async function openPayroll(
  input: { period_start: string; period_end: string; note?: string | null },
  idempotencyKey?: string,
): Promise<Result<PayrollView>> {
  const { data, error } = await db().rpc("open_payroll_run", {
    p_period_start: input.period_start, p_period_end: input.period_end,
    p_note: input.note ?? null, p_key: idempotencyKey ?? null,
  });
  const opened = fromSeam<{ run_no: string }>(SERVICE, data, error);
  if (opened.error) return opened as unknown as Result<PayrollView>;
  return getPayroll(opened.data.run_no);
}

export async function approvePayroll(runNo: string): Promise<Result<PayrollView>> {
  const { data, error } = await db().rpc("approve_payroll_run", { p_run_no: runNo });
  const done = fromSeam<{ run_no: string }>(SERVICE, data, error);
  if (done.error) return done as unknown as Result<PayrollView>;
  return getPayroll(runNo);
}

/* ── adjustments ──────────────────────────────────────────────────────── */

export async function listAdjustments(runNo: string): Promise<Result<PayrollAdjustmentView[]>> {
  const { data, error } = await db()
    .from("payroll_adjustments")
    .select("id, run_no, employee_id, kind, amount, reason, created_by, created_at, "
          + "employees!inner(employee_no, full_name)")
    .eq("run_no", runNo).is("withdrawn_at", null)
    .order("created_at");
  if (error) return fromRows<PayrollAdjustmentView[]>(SERVICE, null as never, error);

  /* Through `unknown`: the embed makes PostgREST's generated row type a union
     the compiler will not narrow, and `as` on it would be a claim rather than
     a check either way. The shape is asserted by what is read below. */
  const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
    const e = r.employees as { employee_no: string; full_name: string } | null;
    const { employees: _e, ...rest } = r;
    return { ...rest, employee_no: e?.employee_no ?? "", full_name: e?.full_name ?? "" };
  });
  return fromRows<PayrollAdjustmentView[]>(SERVICE, rows as never, null);
}

export async function saveAdjustment(
  input: {
    run_no: string; employee_no: string; kind: AdjustmentKind;
    amount: number; reason: string;
  },
  idempotencyKey?: string,
): Promise<Result<PayrollAdjustmentView[]>> {
  const { data, error } = await db().rpc("add_adjustment", {
    p_run_no: input.run_no, p_employee_no: input.employee_no, p_kind: input.kind,
    p_amount: input.amount, p_reason: input.reason, p_key: idempotencyKey ?? null,
  });
  const added = fromSeam<unknown>(SERVICE, data, error);
  if (added.error) return added as unknown as Result<PayrollAdjustmentView[]>;
  return listAdjustments(input.run_no);
}

/** Taking one back.
 *
 *  The seam takes `adj_no` and the screen holds the row's `id`, because
 *  `PayrollAdjustment` carries the uuid and not the public number (ADR-004
 *  going the other way for once). Looked up rather than added to the contract:
 *  a second identifier on every adjustment, for the sake of one call, is a
 *  field every client would then have to carry and none would read.
 */
export async function removeAdjustment(
  input: { run_no: string; adjustment_id: string },
): Promise<Result<PayrollAdjustmentView[]>> {
  const { data: found } = await db()
    .from("payroll_adjustments").select("adj_no")
    .eq("id", input.adjustment_id).maybeSingle();
  const adjNo = (found as { adj_no: string } | null)?.adj_no;
  if (!adjNo) {
    return notFound(SERVICE, "adjustment_not_found", "Penyesuaian itu tidak ada.");
  }

  const { data, error } = await db().rpc("withdraw_adjustment", {
    p_adj_no: adjNo, p_reason: "dibatalkan dari layar payroll",
  });
  const gone = fromSeam<unknown>(SERVICE, data, error);
  if (gone.error) return gone as unknown as Result<PayrollAdjustmentView[]>;
  return listAdjustments(input.run_no);
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
  totals: TimesheetTotal[];
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
      totals: TimesheetTotal[]; needs_review: number; marked: number;
    }>(SERVICE, null, error);
  }

  /* Summed in the database, not here. Counting the rows below is counting what
     `read_day` already decided; adding hours up is arithmetic, and `0057`
     settled that one — two implementations doing it are two chances to round
     it differently. */
  const { data: totals, error: totErr } = await db().rpc("timesheet_totals", {
    p_from: input.from, p_to: input.to,
    p_unit: input.unit ?? null, p_employee_no: null,
  });
  if (totErr) {
    return fromRows<{
      days: TimesheetDay[]; dates: string[];
      employees: { employee_no: string; full_name: string; pay_basis: PayBasis }[];
      totals: TimesheetTotal[]; needs_review: number; marked: number;
    }>(SERVICE, null, totErr);
  }

  return ok(SERVICE, {
    days,
    totals: (totals ?? []) as unknown as TimesheetTotal[],
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

/* ------------------------------------------------------------------ */
/* Kontrak kerja                                                       */
/* ------------------------------------------------------------------ */

/** A contract as `v_contract` answers it, plus the two reads that hang off it.
 *
 *  Every figure here came out of the database: `ends_in_days` counted from the
 *  office's today, `probation_until` derived from the clause and the start
 *  date, the three counts computed against `clause_checklist`. This file only
 *  stitches the three reads into the one nested shape the screen takes.
 */
interface ContractRow {
  id: string;
  contract_no: string;
  employee_id: string;
  employee_no: string;
  full_name: string;
  kind: ContractKind;
  effective_from: string;
  ends_on: string | null;
  status: ContractStatus;
  sha256: string | null;
  attachment_id: string | null;
  superseded_by: string | null;
  ended_on: string | null;
  ended_reason: string | null;
  note: string | null;
  ends_in_days: number | null;
  probation_until: string | null;
  required_missing: number;
  clauses_confirmed: number;
  clauses_proposed: number;
  conflict_count: number;
}

interface ClauseRow {
  contract_no: string;
  kind: ClauseKind;
  quote: string;
  page: number | null;
  value: Record<string, string> | null;
  source: DocNoSource;
  confirmed_at: string | null;
  proposed_at: string;
}

function toClause(r: ClauseRow): ContractClause {
  return {
    contract_no: r.contract_no, kind: r.kind, quote: r.quote, page: r.page,
    value: r.value, source: r.source,
    confirmed: r.confirmed_at != null,
    confirmed_at: r.confirmed_at, proposed_at: r.proposed_at,
  };
}

/** The list of points every contract is asked about, and which are required.
 *  **Data, not a constant in this file**: adding one makes every contract
 *  report it the same day. */
export async function listClauseChecklist(): Promise<Result<ClauseChecklistItem[]>> {
  const { data, error } = await db()
    .from("clause_checklist").select("kind,required,what,bears_on,sort").order("sort");
  return fromRows<ClauseChecklistItem[]>(
    SERVICE, data as unknown as ClauseChecklistItem[], error);
}

export async function listContracts(
  opts: { employee_no?: string } = {},
): Promise<Result<ContractView[]>> {
  let q = db().from("v_contract").select("*")
    /* Incomplete first, then whatever expires soonest: the two reasons anybody
       opens this screen. Nulls last, because a PKWTT never expires. */
    .order("required_missing", { ascending: false })
    .order("ends_in_days", { ascending: true, nullsFirst: false })
    .order("full_name");
  if (opts.employee_no) q = q.eq("employee_no", opts.employee_no);
  const { data, error } = await q;
  return fromRows<ContractView[]>(SERVICE, data as unknown as ContractView[], error);
}

/** One contract, whole: the row, its clauses, the checklist it is measured
 *  against, and the differences against what is actually being run. Four reads
 *  rather than four round trips per clause. */
export async function getContract(contractNo: string): Promise<Result<ContractDetail>> {
  const { data: row, error } = await db()
    .from("v_contract").select("*").eq("contract_no", contractNo).maybeSingle();
  if (error) return fromRows<ContractDetail>(SERVICE, null, error);
  if (!row) return notFound(SERVICE, "contract_not_found", `Tidak ada kontrak ${contractNo}.`);

  const { data: clauses, error: e2 } = await db()
    .from("contract_clauses")
    .select("contract_no,kind,quote,page,value,source,confirmed_at,proposed_at")
    .eq("contract_no", contractNo);
  if (e2) return fromRows<ContractDetail>(SERVICE, null, e2);

  const { data: coverage, error: e3 } = await db()
    .rpc("contract_coverage", { p_contract_no: contractNo });
  if (e3) return fromRows<ContractDetail>(SERVICE, null, e3);

  const { data: conflicts, error: e4 } = await db()
    .rpc("contract_conflicts", { p_contract_no: contractNo });
  if (e4) return fromRows<ContractDetail>(SERVICE, null, e4);

  return ok(SERVICE, {
    ...(row as unknown as ContractRow),
    clauses: ((clauses ?? []) as unknown as ClauseRow[]).map(toClause),
    coverage: ((coverage ?? []) as unknown as (ClauseCoverage & { sort?: number })[])
      .map((c) => ({
        kind: c.kind, required: c.required, what: c.what,
        present: c.present, confirmed: c.confirmed, source: c.source,
      })),
    conflicts: (conflicts ?? []) as unknown as ClauseConflict[],
  });
}

export async function registerContract(
  input: {
    employee_no: string; kind: ContractKind; effective_from: string;
    ends_on?: string | null; attachment_id?: string | null;
    sha256?: string | null; note?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<ContractView>> {
  const { data, error } = await db().rpc("register_contract", {
    p_employee_no: input.employee_no,
    p_kind: input.kind,
    p_effective_from: input.effective_from,
    p_ends_on: input.ends_on ?? null,
    p_attachment_id: input.attachment_id ?? null,
    p_sha256: input.sha256 ?? null,
    p_note: input.note ?? null,
    p_key: idempotencyKey ?? null,
  });
  const said = fromSeam<{ contract_no: string }>(SERVICE, data, error);
  if (said.error) return said as unknown as Result<ContractView>;
  const list = await listContracts();
  if (list.error) return list as unknown as Result<ContractView>;
  const row = list.data.find((c) => c.contract_no === said.data.contract_no);
  if (!row) return notFound(SERVICE, "contract_not_found", said.data.contract_no);
  return ok(SERVICE, row);
}

/** The road for a machine — and there is no machine yet. What is here is the
 *  shape: a proposal is never born confirmed, and the seam refuses to write
 *  over a clause somebody has already signed. */
export async function proposeClause(
  input: {
    contract_no: string; kind: ClauseKind; quote: string;
    page?: number | null; value?: Record<string, string> | null;
  },
): Promise<Result<ContractDetail>> {
  const { data, error } = await db().rpc("propose_clause", {
    p_contract_no: input.contract_no,
    p_kind: input.kind,
    p_quote: input.quote,
    p_page: input.page ?? null,
    p_value: input.value ?? null,
    p_key: null,
  });
  const said = fromSeam<unknown>(SERVICE, data, error);
  if (said.error) return said as unknown as Result<ContractDetail>;
  return getContract(input.contract_no);
}

export async function confirmClause(
  input: {
    contract_no: string; kind: ClauseKind; quote: string;
    page?: number | null; value?: Record<string, string> | null;
  },
): Promise<Result<ContractDetail>> {
  const { data, error } = await db().rpc("confirm_clause", {
    p_contract_no: input.contract_no,
    p_kind: input.kind,
    p_quote: input.quote,
    p_page: input.page ?? null,
    p_value: input.value ?? null,
    p_key: null,
  });
  const said = fromSeam<unknown>(SERVICE, data, error);
  if (said.error) return said as unknown as Result<ContractDetail>;
  return getContract(input.contract_no);
}

/** The signed paper, linked to a draft after it was registered (F154, 0138).
 *  The register form has no file field — the scan comes back after signing —
 *  so without this road no contract registered on screen could go live. */
export async function attachContractPaper(
  input: { contract_no: string; attachment_id: string; sha256?: string | null },
): Promise<Result<ContractDetail>> {
  const { data, error } = await db().rpc("attach_contract_paper", {
    p_contract_no: input.contract_no,
    p_attachment_id: input.attachment_id,
    p_sha256: input.sha256 ?? null,
    p_key: null,
  });
  const said = fromSeam<unknown>(SERVICE, data, error);
  if (said.error) return said as unknown as Result<ContractDetail>;
  return getContract(input.contract_no);
}

export async function activateContract(
  contractNo: string, idempotencyKey?: string,
): Promise<Result<ContractDetail>> {
  const { data, error } = await db().rpc("activate_contract", {
    p_contract_no: contractNo, p_key: idempotencyKey ?? null,
  });
  const said = fromSeam<unknown>(SERVICE, data, error);
  if (said.error) return said as unknown as Result<ContractDetail>;
  return getContract(contractNo);
}

export async function endContract(
  input: { contract_no: string; ended_on: string; reason: string },
): Promise<Result<ContractView>> {
  const { data, error } = await db().rpc("end_contract", {
    p_contract_no: input.contract_no,
    p_ended_on: input.ended_on,
    p_reason: input.reason,
    p_key: null,
  });
  const said = fromSeam<unknown>(SERVICE, data, error);
  if (said.error) return said as unknown as Result<ContractView>;
  const list = await listContracts();
  if (list.error) return list as unknown as Result<ContractView>;
  const row = list.data.find((c) => c.contract_no === input.contract_no);
  if (!row) return notFound(SERVICE, "contract_not_found", input.contract_no);
  return ok(SERVICE, row);
}

/* ── the rule book ────────────────────────────────────────────────────────
 *
 *  Three functions, and the middle one is the reason `/it/aturan-gaji` sat
 *  dark for so long. A preview is the whole payroll computed twice — under the
 *  book in force and under one that **has not been saved** — and no client can
 *  do that by assembling reads: the candidate has to reach the arithmetic.
 *  `0059` lets it, through a transaction-local setting only `preview_pay_rules`
 *  sets, so the two-hundred-line payroll body is not copied a fourth time.
 *
 *  The screen will not enable *Simpan* until a preview has come back, which is
 *  the point of it: a pay rule reaches every payslip at once, and *save blind*
 *  is the failure it was built against.
 */
export async function listPayRules(): Promise<Result<PayRuleSetView[]>> {
  const { data, error } = await db()
    .from("v_pay_rule_set").select("*")
    /* Newest first, and within a date the correction above what it corrects
       (D270) — the same order `rules_on` resolves them in. */
    .order("effective_from", { ascending: false })
    .order("version", { ascending: false });
  return fromRows<PayRuleSetView[]>(SERVICE, data as unknown as PayRuleSetView[], error);
}

export async function previewPayRules(
  input: { rules: PayRules; period_start: string; period_end: string },
): Promise<Result<{
  period: string;
  before_total: number;
  after_total: number;
  /** Patterns this candidate book drops that people are still on, named with
   *  them — `null` when it strands nobody. Shown before save, because moving
   *  somebody off a pattern is work to do first, not a refusal to hit. */
  schedules_lost: string | null;
  lines: { employee_no: string; full_name: string; before: number; after: number; note: string }[];
}>> {
  const { data, error } = await db().rpc("preview_pay_rules", {
    p_rules: input.rules,
    p_from: input.period_start,
    p_to: input.period_end,
  });
  return fromSeam(SERVICE, data, error);
}

/** The calendar's own count, for the figure IT types (Q45, D292).
 *
 *  A read rather than part of `listPayRules`, because it is asked *about a
 *  candidate* — the draft on screen, whose `week_pattern` may differ from the
 *  book in force — and because counting a year of days is not something to do
 *  on every list. Null where the caller may not see it; the seam decides, not
 *  this function.
 */
export async function effectiveDaysCalendar(
  input: { rules: PayRules; year: number },
): Promise<Result<EffectiveDaysCalendar | null>> {
  const { data, error } = await db().rpc("effective_days_calendar", {
    p_rules: input.rules, p_year: input.year,
  });
  return fromRows(SERVICE, data as never, error);
}

export async function savePayRules(
  input: { effective_from: string; note: string; rules: PayRules },
  idempotencyKey?: string,
): Promise<Result<PayRuleSetView>> {
  const { data, error } = await db().rpc("save_pay_rules", {
    p_effective_from: input.effective_from,
    p_note: input.note,
    p_rules: input.rules,
    p_key: idempotencyKey ?? null,
  });
  const said = fromSeam<{ version: number }>(SERVICE, data, error);
  if (said.error) return said as unknown as Result<PayRuleSetView>;

  /* Read back rather than assembled here: `is_current` depends on the office
     day and on every other version, and a client that worked it out would be
     the second place that rule lives (A3). */
  const { data: row, error: readErr } = await db()
    .from("v_pay_rule_set").select("*").eq("version", said.data.version).maybeSingle();
  if (readErr) return fromRows<PayRuleSetView>(SERVICE, null, readErr);
  if (!row) return notFound(SERVICE, "pay_rules_not_found", String(said.data.version));
  return ok(SERVICE, row as unknown as PayRuleSetView);
}
