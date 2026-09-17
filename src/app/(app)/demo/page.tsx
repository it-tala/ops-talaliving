"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Database, ShieldAlert, Wallet, ListChecks, FileStack, GitBranch, RotateCcw, Footprints,
} from "lucide-react";
import {
  Badge, Button, Card, CardHeader, PageHeader, StatCard, type Tone,
} from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { formatIDR } from "@/lib/format";
import { useDemo, useDemoReset, useActingUser } from "@/demo/provider";
import { accountBalances, prLineView, poStatus, inboxHealth } from "@/demo/derive";
import { procurement, accounting, identity, production, hr, delivery, inventory, isOk } from "@/demo/api";
import { officeToday } from "@/lib/office";
import type { LineStatus } from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";
import { FLOW_B, tourHref } from "@/lib/tour";

/** M1 diagnostic surface.
 *
 *  Not a product screen — the real ones arrive from M2 onward. This exists so
 *  that day one has something to review: it shows what the demo store holds,
 *  what `derive.ts` computes from it, and — the part worth the most — that the
 *  refusals are real. A demo that only ever succeeds teaches every screen to
 *  be optimistic, and the real API then breaks all of them at once.
 *
 *  Delete this page when the screens it stands in for exist.
 */

const STATUS_TONE: Record<LineStatus, Tone> = {
  DRAFT: "slate",
  "WAITING FOR APPROVAL": "amber",
  APPROVED: "brand",
  PAID: "green",
  PARTIAL: "amber",
  COMPLETED: "green",
  REMOVED: "red",
};

interface Probe {
  name: string;
  expect: string;
  got?: string;
  pass?: boolean;
}

export default function DemoDiagnosticsPage() {
  const router = useRouter();
  const state = useDemo();
  const reset = useDemoReset();
  const acting = useActingUser();
  const { toast } = useToast();
  const [probes, setProbes] = useState<Probe[]>([]);
  const [running, setRunning] = useState(false);

  const balances = accountBalances(state);
  const lines = state.pr_lines.map((l) => prLineView(state, l));
  const health = inboxHealth(state);

  const byStatus = lines.reduce<Record<string, number>>((acc, l) => {
    acc[l.status] = (acc[l.status] ?? 0) + 1;
    return acc;
  }, {});

  /* Every one of these is a rule from `00-context.md` §A or a decision from
   * `06-decisions.md`, exercised against the demo API rather than described. */
  /** The probes switch the acting user as they go, so **two of them running at
   *  once corrupt each other**: one run's `actAs(original)` lands in the middle
   *  of the other's, and a check that expected the CEO gets refused for not
   *  being the CEO. It happens because `reactStrictMode` invokes the mount
   *  effect twice in development — so the self-check ran twice, raced itself,
   *  and reported a failure that was not there, intermittently (F79).
   *
   *  The guard is a **ref, not the `running` state**: state updates land on the
   *  next render, and the second caller is already inside the function by
   *  then. */
  const inFlight = useRef(false);

  async function runProbes() {
    if (inFlight.current) return;
    inFlight.current = true;
    setRunning(true);
    const results: Probe[] = [];
    const original = state.session_user_id;

    await identity.actAs("usr_evin");
    /* This slot used to assert a cap on approving above what was requested.
       D76 deleted that rule — prices move between the request and the meeting
       — and the probe went on asserting it, quietly failing, testing a past
       that no longer exists (F33). Replaced with the rule that now stands. */
    const bare = await procurement.approveLine({
      line_no: "pr-26-09-10_01-L03", approved: true,
    });
    results.push({
      name: "D125 — approving a request with no document behind it",
      expect: "422 support_required",
      got: bare.error ? `${bare.error.status} ${bare.error.code}` : "accepted",
      pass: bare.error?.status === 422 && bare.error.code === "support_required",
    });

    await identity.actAs("usr_andi");
    const noAuth = await procurement.approveLine({ line_no: "pr-26-09-10_01-L01", approved: true });
    results.push({
      name: "D19 — approving without the approve_goods authority",
      expect: "403 authority_required",
      got: noAuth.error ? `${noAuth.error.status} ${noAuth.error.code}` : "accepted",
      pass: noAuth.error?.status === 403 && noAuth.error.code === "authority_required",
    });

    const removePaid = await procurement.removeLine({ line_no: "pr-26-08-18_01-L01" });
    results.push({
      name: "D29 — removing a line that money has reached",
      expect: "409 money_already_allocated",
      got: removePaid.error ? `${removePaid.error.status} ${removePaid.error.code}` : "accepted",
      pass: removePaid.error?.status === 409 && removePaid.error.code === "money_already_allocated",
    });

    await identity.actAs("usr_putri");
    const over = await accounting.allocate({
      trx_no: "trx-26-08-20_003", pr_line_no: "pr-26-08-27_01-L01", amount: 900_000_000,
    });
    results.push({
      name: "A9 — allocating more than the transaction moved",
      expect: "422 over_allocated",
      got: over.error ? `${over.error.status} ${over.error.code}` : "accepted",
      pass: over.error?.status === 422 && over.error.code === "over_allocated",
    });

    const key = `probe-${Date.now()}`;
    const first = await procurement.createVendor({ name: `UD PROBE ${Date.now()}` }, key);
    const second = await procurement.createVendor({ name: `UD PROBE ${Date.now()}` }, key);
    results.push({
      name: "Idempotency — the same key sent twice",
      expect: "duplicate, no second row",
      got: `${second.meta.outcome}${isOk(first) && isOk(second) && first.data.id === second.data.id ? ", same id" : ""}`,
      pass: second.meta.outcome === "duplicate",
    });

    const badLine = await accounting.allocate({
      trx_no: "trx-26-08-20_003", pr_line_no: "pr-99-99-99_01-L01", amount: 1_000,
    });
    results.push({
      name: "ADR-004 — allocating to a PR line that does not exist",
      expect: "422 pr_line_not_found (validated at the seam)",
      got: badLine.error ? `${badLine.error.status} ${badLine.error.code}` : "accepted",
      pass: badLine.error?.code === "pr_line_not_found",
    });

    /* The two the production routes added (D254, D255). Both are about a
       **place**, not a number, which is why they refuse where the rest of
       production merely warns: nobody sanded ten shelves that are in somebody
       else's workshop. */
    await identity.actAs("usr_made");
    const offRoute = await production.recordProgress({
      /* `PEMBUATAN` is a retired stage since D275 — the business buys its rough
         pieces in, so it is on no route at all now. The guard is the same one
         and still the only thing standing between a board and work reported
         against a step nobody does. */
      wo_no: "spk-26-09-02_01", stage: "PEMBUATAN", qty: 1, work_date: officeToday(),
    });
    /* D278 — the product's own stages. A dining table has no lamps in it, so
       reporting *Machinery / instalasi* against one is not a mis-keyed number,
       it is work on a step that does not exist for this thing. */
    const notOnProduct = await production.recordProgress({
      wo_no: "spk-26-08-24_01", stage: "MACHINERY", qty: 1, work_date: officeToday(),
    });
    results.push({
      name: "D278 — reporting a stage the product does not go through",
      expect: "422 stage_not_on_product",
      got: notOnProduct.error ? `${notOnProduct.error.status} ${notOnProduct.error.code}` : "accepted",
      pass: notOnProduct.error?.status === 422 && notOnProduct.error.code === "stage_not_on_product",
    });

    results.push({
      /* `stage_not_on_route` is unreachable since D275 — both routes carry the
         same four stages now — so what this probe reaches is the guard one
         step earlier, and that is the one worth proving: a board must refuse
         work reported against a step the business no longer has. */
      name: "D254/D275 — reporting work against a step the business no longer has",
      expect: "422 unknown_stage",
      got: offRoute.error ? `${offRoute.error.status} ${offRoute.error.code}` : "accepted",
      pass: offRoute.error?.status === 422 && offRoute.error.code === "unknown_stage",
    });

    const atVendor = await production.recordProgress({
      wo_no: "spk-26-09-01_01", stage: "FINISHING", qty: 1, work_date: officeToday(),
    });
    results.push({
      name: "D255 — reporting work on goods still at the vendor",
      expect: "409 still_at_vendor",
      got: atVendor.error ? `${atVendor.error.status} ${atVendor.error.code}` : "accepted",
      pass: atVendor.error?.status === 409 && atVendor.error.code === "still_at_vendor",
    });

    /* The revision rules (D256). Both are about a version that must stay
       exactly as it was released, because a work order points at it. */
    const editReleased = await production.saveBomComponent({
      product_code: "PRD-KR-STD", component_id: "bom_011", kind: "material",
      ref_code: "ITM-0006", qty: 99, uom: "lembar",
    });
    results.push({
      name: "D256 — editing a line on a released BOM revision",
      expect: "409 revision_released",
      got: editReleased.error ? `${editReleased.error.status} ${editReleased.error.code}` : "accepted",
      pass: editReleased.error?.status === 409 && editReleased.error.code === "revision_released",
    });

    const emptyRelease = await production.releaseBom({
      product_code: "PRD-MJ-220", note: "",
    });
    results.push({
      name: "D256 — releasing a revision with no reason for it",
      expect: "422 note_required",
      got: emptyRelease.error ? `${emptyRelease.error.status} ${emptyRelease.error.code}` : "accepted",
      pass: emptyRelease.error?.status === 422 && emptyRelease.error.code === "note_required",
    });

    /* The layered BOM (D257). A wardrobe contains drawer boxes; a drawer box
       cannot contain the wardrobe, and the walk must terminate on data that
       says otherwise. */
    const cycle = await production.saveBomComponent({
      product_code: "PRD-SUB-LACI", kind: "product",
      ref_code: "PRD-LM-3P", qty: 1, uom: "unit",
    });
    results.push({
      name: "D257 — a BOM component that would close a loop",
      expect: "422 bom_cycle",
      got: cycle.error ? `${cycle.error.status} ${cycle.error.code}` : "accepted",
      pass: cycle.error?.status === 422 && cycle.error.code === "bom_cycle",
    });

    /* And the walk itself: the wardrobe's materials must contain the plywood
       its drawer boxes are made of, which a one-level read never returned. */
    const walked = await production.materialsFor({ product_code: "PRD-LM-3P", qty: 1 });
    const hasSubMaterial = !walked.error
      && walked.data.lines.some((l) => l.via.length > 0 && l.via.some((v) => v.includes("PRD-SUB-LACI")));
    results.push({
      name: "D257 — a run's materials include what its sub-assemblies are made of",
      expect: "lines reached through PRD-SUB-LACI",
      got: walked.error
        ? `${walked.error.status} ${walked.error.code}`
        : `${walked.data.lines.length} baris, ${walked.data.sub_assemblies.length} sub-rakitan`,
      pass: hasSubMaterial,
    });

    /* The enrolment register (D259). HRD's to write; the register refuses a
       second open row for the same person and scheme, because two would make
       *is he covered* ambiguous. */
    await identity.actAs("usr_wulan");
    const twice = await hr.enrol({
      employee_no: "K-004", scheme: "BPJS_KESEHATAN", enrolled_on: "2026-09-01",
    });
    results.push({
      name: "D259 — enrolling somebody who is already in that scheme",
      expect: "409 already_enrolled",
      got: twice.error ? `${twice.error.status} ${twice.error.code}` : "accepted",
      pass: twice.error?.status === 409 && twice.error.code === "already_enrolled",
    });

    const noReason = await hr.endEnrolment({ id: "enr_001", ended_on: "2026-09-30", reason: "" });
    results.push({
      name: "D259 — ending an enrolment with no reason",
      expect: "422 reason_required",
      got: noReason.error ? `${noReason.error.status} ${noReason.error.code}` : "accepted",
      pass: noReason.error?.status === 422 && noReason.error.code === "reason_required",
    });

    /* The rule the whole KPI module rests on (D261): blocking a task lifts it
       out of the assignee's score, so something that removes a penalty has to
       say why. */
    const blockBlind = await hr.updateTask({ task_no: "tgs-26-09-06_01", action: "block", reason: "" });
    results.push({
      name: "D261 — blocking a task without saying what it waits on",
      expect: "422 reason_required",
      got: blockBlind.error ? `${blockBlind.error.status} ${blockBlind.error.code}` : "accepted",
      pass: blockBlind.error?.status === 422 && blockBlind.error.code === "reason_required",
    });

    const noDate = await hr.createTask({
      assignee_no: "K-004", title: "Tugas tanpa tanggal", due_date: "",
    });
    results.push({
      name: "D260 — a task nobody can tell is late",
      expect: "422 due_date_required",
      got: noDate.error ? `${noDate.error.status} ${noDate.error.code}` : "accepted",
      pass: noDate.error?.status === 422 && noDate.error.code === "due_date_required",
    });

    /* Back to the workshop manager: the box endpoints sit behind the `project`
       module, and a 403 from the guard would hide the rule underneath it. */
    await identity.actAs("usr_made");

    /* D267 — the whole reason the chat road exists: a leadership meeting runs
       on one laptop, and an answer given from somebody else's account recorded
       as theirs is the mistake this route was built to prevent (D69, one level
       up from a request line). */
    const wrongHands = await procurement.answerPoFromChat({
      token: "potok_seed_02",
      answered_by_email: "putri@talaliving.com",
      approved: true,
    });
    results.push({
      name: "D267 — confirming a purchase order from somebody else's chat account",
      expect: "403 not_the_addressee",
      got: wrongHands.error ? `${wrongHands.error.status} ${wrongHands.error.code}` : "accepted",
      pass: wrongHands.error?.status === 403 && wrongHands.error.code === "not_the_addressee",
    });

    /* Turning an order down needs a sentence: somebody has to tell the
       supplier something. */
    const blindDecline = await procurement.answerPoFromChat({
      token: "potok_seed_02",
      answered_by_email: "evin@talaliving.com",
      approved: false,
    });
    results.push({
      name: "D267 — declining a purchase order with nothing to tell the supplier",
      expect: "422 reason_required",
      got: blindDecline.error ? `${blindDecline.error.status} ${blindDecline.error.code}` : "accepted",
      pass: blindDecline.error?.status === 422 && blindDecline.error.code === "reason_required",
    });

    /* D266 — the BOM proposes and the storeman disposes, so an issue with
       every line at zero is a trip nobody made. Refused rather than posted as
       an empty document. */
    const emptyIssue = await inventory.issueForWorkOrder({
      wo_no: "spk-26-08-28_01", location: "GUDANG",
      lines: [{ item_code: "ITM-0007", qty: 0 }],
    });
    results.push({
      name: "D266 — issuing a work order's material with every line at zero",
      expect: "422 nothing_to_issue",
      got: emptyIssue.error ? `${emptyIssue.error.status} ${emptyIssue.error.code}` : "accepted",
      pass: emptyIssue.error?.status === 422 && emptyIssue.error.code === "nothing_to_issue",
    });

    /* Every line is checked before any is written: half an issue posted and
       half refused would leave the rack describing a trip that did not happen. */
    const notStocked = await inventory.issueForWorkOrder({
      wo_no: "spk-26-08-28_01", location: "GUDANG",
      lines: [{ item_code: "ITM-0007", qty: 1 }, { item_code: "ITM-0039", qty: 1 }],
    });
    results.push({
      name: "D266 — issuing a mixed list where one line is a service, not stock",
      expect: "422 not_stocked",
      got: notStocked.error ? `${notStocked.error.status} ${notStocked.error.code}` : "accepted",
      pass: notStocked.error?.status === 422 && notStocked.error.code === "not_stocked",
    });

    /* D264 — one name cannot be both a person and not a person. Refused rather
       than silently preferring one, because either choice would be the software
       deciding who did the work. */
    const bothAnswers = await production.resolveWorkName({
      name: "Pranowo", employee_id: "emp_w015", not_a_person: true,
    });
    results.push({
      name: "D264 — resolving a name as an employee AND as not-a-person at once",
      expect: "422 one_answer_only",
      got: bothAnswers.error ? `${bothAnswers.error.status} ${bothAnswers.error.code}` : "accepted",
      pass: bothAnswers.error?.status === 422 && bothAnswers.error.code === "one_answer_only",
    });

    /* And neither is not an answer either: the row stays unresolved, which is
       a state somebody has to leave on purpose rather than by submitting. */
    const noAnswer = await production.resolveWorkName({ name: "Pranowo" });
    results.push({
      name: "D264 — resolving a name without saying who it is",
      expect: "422 answer_required",
      got: noAnswer.error ? `${noAnswer.error.status} ${noAnswer.error.code}` : "accepted",
      pass: noAnswer.error?.status === 422 && noAnswer.error.code === "answer_required",
    });

    /* D262 — a box cannot be fitted before anybody has seen it. The same rule
       the installation endpoint holds one level up, and the one refusal in the
       whole box flow: everything else about a box warns. */
    const notSeen = await delivery.markBoxInstalled({ box_no: "kol-26-09-08_01" });
    results.push({
      name: "D262 — marking a box installed that nobody has scanned on site",
      expect: "409 not_on_site",
      got: notSeen.error ? `${notSeen.error.status} ${notSeen.error.code}` : "accepted",
      pass: notSeen.error?.status === 409 && notSeen.error.code === "not_on_site",
    });

    /* A red flag with no sentence on it cannot be acted on by anybody in the
       workshop, and the person who saw the problem is the only one who knows. */
    const blindFlag = await delivery.flagBoxProblem({ box_no: "kol-26-09-08_01", problem_note: "" });
    results.push({
      name: "D262 — flagging a box as a problem with nothing written on it",
      expect: "422 problem_note_required",
      got: blindFlag.error ? `${blindFlag.error.status} ${blindFlag.error.code}` : "accepted",
      pass: blindFlag.error?.status === 422 && blindFlag.error.code === "problem_note_required",
    });

    /* A label with no room on it moves the job of opening the crate to the
       site, which is the entire thing this record exists to stop. */
    const noRoom = await delivery.packBox({
      project_code: "25009", destination: "",
      lines: [{ description: "Nakas jati kecil", qty: 1, uom: "unit" }],
    });
    results.push({
      name: "D262 — packing a box with no destination inside the building",
      expect: "422 destination_required",
      got: noRoom.error ? `${noRoom.error.status} ${noRoom.error.code}` : "accepted",
      pass: noRoom.error?.status === 422 && noRoom.error.code === "destination_required",
    });

    await identity.actAs(original);
    setProbes(results);
    setRunning(false);
    inFlight.current = false;
    const failed = results.filter((r) => !r.pass).length;
    if (failed === 0) toast("success", "Every refusal behaved correctly", `${results.length} checks passed.`);
    else toast("critical", `${failed} check(s) failed`, "See the table below.");
  }

  useEffect(() => {
    void runProbes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lineColumns: Column<(typeof lines)[number]>[] = [
    { key: "no", header: "Line", render: (r) => <span className="font-mono text-xs font-semibold text-brand-700">{r.line_no_full}</span> },
    { key: "desc", header: "Description", className: "max-w-[240px] truncate", render: (r) => <span className="text-slate-700">{r.description}</span> },
    { key: "total", header: "Requested", align: "right", render: (r) => formatIDR(r.item_total) },
    { key: "cov", header: "Covered", align: "right", render: (r) => <span className={r.coverage.covered > 0 ? "text-emerald-700" : "text-slate-400"}>{formatIDR(r.coverage.covered)}</span> },
    { key: "status", header: "Status", render: (r) => <Badge tone={STATUS_TONE[r.status]} dot>{r.status}</Badge> },
  ];

  const probeColumns: Column<Probe>[] = [
    {
      key: "name",
      header: "Rule",
      className: "whitespace-normal",
      render: (r) => (
        <div className="max-w-md">
          <p className="text-slate-700">{r.name}</p>
          <p className="mt-0.5 font-mono text-[11px] text-slate-400">expected {r.expect}</p>
        </div>
      ),
    },
    { key: "got", header: "Result", render: (r) => <span className="font-mono text-xs text-slate-700">{r.got ?? "—"}</span> },
    { key: "pass", header: "", align: "right", render: (r) => <Badge tone={r.pass ? "green" : "red"}>{r.pass ? "pass" : "fail"}</Badge> },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb="M1 · Demo data layer"
        title="Demo diagnostics"
        description="A working page, not a product page. What the store holds, what derive.ts computes from it, and proof that the refusals are real."
        actions={
          <>
            <Button variant="outline" size="sm" icon={Footprints} onClick={() => router.push(tourHref(FLOW_B, 0))}>
              Walk Flow B
            </Button>
            <Button variant="outline" size="sm" icon={RotateCcw} onClick={() => { reset(); toast("info", "Demo data reset", "The sandbox is back to its starting state."); }}>
              Reset demo data
            </Button>
            <Button size="sm" icon={ShieldAlert} onClick={runProbes} disabled={running}>
              {running ? "Testing…" : "Test refusals"}
            </Button>
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="PR lines" value={state.pr_lines.length} icon={ListChecks} hint={`${state.pr_documents.length} documents`} />
        <StatCard label="Ledger rows" value={state.transactions.length} icon={Wallet} tone="green" hint={`${state.payment_allocations.length} allocations`} />
        <StatCard label="Evidence files" value={state.attachments.length} icon={FileStack} tone="violet" hint={`${state.attachment_links.length} links`} />
        <StatCard
          label="Unparented documents"
          value={health.unresolved}
          icon={GitBranch}
          tone={health.unresolved > 5 ? "red" : "amber"}
          hint="The exception road — should stay small"
        />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="The refusals are real"
            subtitle="Each row is a binding rule, exercised against the demo API rather than described."
            icon={ShieldAlert}
          />
          <DataTable columns={probeColumns} rows={probes} rowKey={(r) => r.name} dense empty="Running checks…" />
        </Card>

        <Card>
          <CardHeader title="Balance per account" subtitle="Computed from rows, never stored" icon={Wallet} />
          <div className="divide-y divide-slate-100">
            {balances.map((b) => (
              <div key={b.account_id} className="flex items-baseline justify-between px-5 py-3">
                <div>
                  <p className="font-mono text-xs font-semibold text-slate-700">{b.code}</p>
                  <p className="text-xs text-slate-400">{b.custody === "leadership" ? "leadership custody" : "accounting custody"}</p>
                </div>
                <span className="text-sm font-semibold tabular-nums text-slate-800">{formatIDR(b.balance)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader
          title="The status ladder — all eight values appear in the fixtures"
          subtitle="Recomputed on every render by derive.ts. There is no stored status column that could disagree with it."
          icon={Database}
          action={
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(byStatus).map(([s, n]) => (
                <Badge key={s} tone={STATUS_TONE[s as LineStatus]}>{s} · {n}</Badge>
              ))}
            </div>
          }
        />
        <DataTable columns={lineColumns} rows={lines} rowKey={(r) => r.id} dense empty="The sandbox holds no request lines. Reset the demo data to bring the fixtures back." />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="PO — two axes, never collapsed" subtitle="Money and goods are computed apart and stay apart" icon={GitBranch} />
          <div className="divide-y divide-slate-100">
            {state.purchase_orders.map((po) => {
              const s = poStatus(state, po.id);
              return (
                <div key={po.id} className="px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-xs font-semibold text-brand-700">{po.po_no}</span>
                    <Badge tone={po.status === "ISSUED" ? "brand" : "slate"}>{po.status}</Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-slate-400">Payment</p>
                      <p className="font-semibold text-slate-700">{s.payment_state}</p>
                      <p className="tabular-nums text-slate-500">{formatIDR(s.paid_to_date)} / {formatIDR(s.contract_value)}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Delivery</p>
                      <p className="font-semibold text-slate-700">{s.delivery_state}</p>
                      <p className="tabular-nums text-slate-500">received {formatIDR(s.value_received)}</p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    Exposure {formatIDR(s.exposure)} —{" "}
                    {s.exposure > 0
                      ? "we are carrying the vendor’s risk."
                      : s.exposure < 0
                        ? "goods have arrived beyond what was paid; this is a payable."
                        : "balanced."}
                  </p>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader title="Demo session" subtitle="Module access and authority are separate grants — D22 to D24" icon={ShieldAlert} />
          <div className="space-y-4 px-5 py-4">
            <div>
              <p className="text-xs text-slate-400">Acting as</p>
              <p className="text-sm font-semibold text-slate-800">{acting.full_name}</p>
              <p className="font-mono text-xs text-slate-500">{acting.email}</p>
            </div>
            <div>
              <p className="mb-1.5 text-xs text-slate-400">Modules</p>
              <div className="flex flex-wrap gap-1.5">
                {acting.modules.map((m) => (
                  <Badge key={m.module} tone="slate">{m.module} · {m.level}</Badge>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs text-slate-400">Authorities</p>
              <div className="flex flex-wrap gap-1.5">
                {acting.authorities.length === 0
                  ? <span className="text-xs text-slate-400">none — can raise a request, cannot decide one</span>
                  : acting.authorities.map((a) => <Badge key={a} tone="brand">{a}</Badge>)}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 border-t border-slate-100 pt-4">
              {state.users.map((u) => (
                <Button
                  key={u.id}
                  size="sm"
                  variant={u.id === acting.id ? "secondary" : "ghost"}
                  onClick={() => void identity.actAs(u.id)}
                >
                  {u.full_name.split(" ")[0]}
                </Button>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
