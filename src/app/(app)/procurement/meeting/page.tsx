"use client";

import { useState } from "react";
import {
  Send, Circle, Clock, AlertTriangle, ExternalLink, Check, ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { stripRefs } from "@/lib/refs";
import { StatusPill } from "@/components/ui/status-pill";
import { Link2 as LinkIcon } from "lucide-react";
import { MoneyInput } from "@/components/ui/money-input";
import { NumberInput } from "@/components/ui/number-input";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { identity, procurement } from "@/demo/api";
import type { PrLineView } from "@/services/procurement/contracts";
import type { Approver } from "@/services/identity/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";
import { LineDrawer } from "../pr/LineDrawer";
import { MoneyPanel } from "./MoneyPanel";
import { QuickAdd } from "./QuickAdd";

/** The leadership meeting, as a screen.
 *
 *  Everything here answers one of four questions, in the order a meeting asks
 *  them (D74):
 *
 *    1. What is waiting for a decision, and what would saying yes cost?
 *    2. What did we already approve that has not been paid?
 *    3. Is the money there — and if not, how much has to move into BCA 271?
 *    4. What else do we need? (added here, on the spot)
 *
 *  It is deliberately NOT the requests board. That board is the working
 *  surface — requesting, editing, attaching, paying — and it stays that way.
 *  This one is read in a room, once a week, by people deciding. Same data,
 *  same services; a different question.
 */
export default function MeetingBoardPage() {
  const { can, hasAuthority } = useSession();
  const { toast } = useToast();
  const [lines, reload] = useLoad(() => procurement.listOpenLines(), []);
  /* Who may be asked. Not a table read: `ops_core.user_authorities` is readable
     only for your own row unless you hold `it.manage_roles`, so until 0159 this
     screen could not name the approver at all — it sent the question and told
     you afterwards who had received it. */
  const [approvers] = useLoad(() => identity.listApprovers(), []);
  const [askTo, setAskTo] = useState<string | null>(null);
  const [selected, setSelected] = useState<PrLineView | null>(null);
  const [qtyDraft, setQtyDraft] = useState<Record<string, number>>({});
  const [amountDraft, setAmountDraft] = useState<Record<string, number>>({});
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  /* Ticking marks an intention, not a decision. Nothing is written until the
     one confirm at the top — so a meeting can go through the list, change its
     mind twice, and see the total before anything is committed (D77). */
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  const mayDecide = hasAuthority("approve_goods");
  const mayAsk = can("procurement.create");

  const goodsApprovers: Approver[] = approvers.status === "ready"
    ? approvers.data.filter((a) => a.authority === "approve_goods")
    : [];
  /* The seam picks the first holder by name when nobody is named, and this
     screen always names somebody instead — an implicit choice presented as a
     fact is the thing the owner objected to. Until the list has loaded there is
     nobody to name, and the send button says so rather than guessing. */
  const askingWho = goodsApprovers.find((a) => a.email === askTo) ?? goodsApprovers[0];

  const qtyOf = (l: PrLineView) => qtyDraft[l.id] ?? l.qty ?? 0;
  const amountOf = (l: PrLineView) => amountDraft[l.id] ?? l.item_total;
  /* What the room says about an item, typed while it is being discussed.
     Held as a draft, written when the decision is (D64) or carried with the
     question to the approver (D127) — never silently lost. */
  const noteOf = (l: PrLineView) => noteDraft[l.id] ?? "";

  /** Quantity and money move together: approving 40 of 60 litres approves
   *  two-thirds of the price, and asking a person to do that arithmetic in
   *  their head is how an approval ends up disagreeing with itself. */
  function setQty(l: PrLineView, v: number) {
    setQtyDraft((d) => ({ ...d, [l.id]: v }));
    if (l.unit_price != null) setAmountDraft((d) => ({ ...d, [l.id]: Math.round(v * l.unit_price!) }));
  }

  function toggle(l: PrLineView) {
    setPicked((p) => ({ ...p, [l.id]: !p[l.id] }));
  }

  /** Approve everything ticked, in one act.
   *
   *  Only for somebody who actually holds the authority. For everybody else
   *  the same selection goes to the approver's chat instead — the meeting
   *  usually runs on a laptop that is not theirs, and recording their yes
   *  under whoever logged in is the mistake the chat route exists to prevent
   *  (D69).
   */
  async function approveSelected(rows: PrLineView[]) {
    setBusy(true);
    let done = 0;
    for (const l of rows) {
      const res = await procurement.approveLine({
        line_no: l.line_no_full,
        approved: true,
        approved_qty: l.qty != null ? qtyOf(l) : null,
        approved_amount: amountOf(l),
        instructions: noteOf(l).trim() || null,
      });
      if (res.error) {
        toast(res.error.status === 403 ? "critical" : "warning", `Not approved · ${l.line_no_full}`, res.error.message);
        continue;
      }
      done += 1;
    }
    setBusy(false);
    if (done > 0) {
      toast("success", `Approved ${done} item(s)`, formatIDR(rows.reduce((s, l) => s + amountOf(l), 0)));
      setPicked({});
      reload();
    }
  }

  /** Recording an instruction on a line that is already approved. There is no
   *  decision left for it to ride along with, so it is written on its own. */
  async function saveNote(l: PrLineView) {
    setBusy(true);
    const res = await procurement.noteLine({
      line_no: l.line_no_full, instructions: noteOf(l).trim() || null,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Not recorded", res.error.message);
      return;
    }
    toast("success", `Instruction on ${l.line_no_full}`, noteOf(l).trim());
    setNoteDraft((d) => ({ ...d, [l.id]: "" }));
    reload();
  }

  async function sendSelected(rows: PrLineView[]) {
    const askable = rows.filter((l) => !l.pending_request);
    if (askable.length === 0) {
      toast("warning", "Nothing to send", "Every item you picked is already waiting for an answer.");
      return;
    }
    if (!askingWho) {
      toast("warning", "Nobody to ask",
        "No active account holds the authority to approve goods. IT grants it in Settings → People.");
      return;
    }
    setBusy(true);
    const res = await procurement.requestApproval({
      line_nos: askable.map((l) => l.line_no_full),
      to_email: askingWho.email,
      notes: Object.fromEntries(askable.map((l) => [l.line_no_full, noteOf(l).trim() || null])),
    });
    setBusy(false);
    if (res.error) { toast("warning", "Not sent", res.error.message); return; }
    toast(
      "success",
      `Sent ${res.data.items.length} item(s) as ${res.data.batch_no}`,
      `${formatIDR(res.data.requested_total)} for ${res.data.sent_to_email} to decide`,
    );
    setPicked({});
    setNoteDraft({});
    reload();
  }

  /* Shared by both tables — the meeting reads the same three things about
     every item, whichever pile it is in. */
  const itemColumn: Column<PrLineView> = {
    key: "item",
    header: "Item",
    className: "whitespace-normal",
    render: (l) => {
      const meta = [l.line_no_full, l.requested_by_name, l.project_code, l.vendor_name]
        .filter(Boolean).join(" · ");
      return (
        <div className="max-w-[420px] whitespace-normal break-words">
          <p className="font-medium leading-snug text-slate-800">{l.description}</p>
          {l.purpose
            ? <p className="text-[12px] leading-snug text-slate-500">{l.purpose}</p>
            : <p className="text-[12px] leading-snug text-amber-700">No note on what this is for.</p>}
          <p className="truncate font-mono text-[10px] text-slate-400" title={meta}>{meta}</p>
          {/* The refusal exists in the API either way; saying it here means
              nobody meets it mid-meeting (D125). */}
          {!l.has_support && !l.approval?.approved && (
            <p className="mt-1 flex items-center gap-1 text-[12px] text-amber-700">
              <LinkIcon className="h-3 w-3 shrink-0" />
              Nothing behind it yet — needs the shop link, the invoice or the bill.
            </p>
          )}
        </div>
      );
    },
  };

  /** What the room says about an item, in a column rather than behind a click.
   *
   *  It is said out loud while the item is being discussed, and anything that
   *  takes a click to reach is said and then lost (D127).
   *
   *  Two behaviours, because the two lists are at different moments. On a line
   *  still waiting, the text is a draft that rides along with whatever happens
   *  next — the approval records it as leadership's instruction (D64), or the
   *  chat request carries it as the meeting's words. On a line already
   *  approved there is no next decision to ride on, so it is saved on its own,
   *  which only an approver may do.
   */
  function instructionColumn(mode: "draft" | "save"): Column<PrLineView> {
    return {
      key: "instructions",
      header: "Instructions",
      className: "whitespace-normal",
      render: (l) => {
        const existing = l.note?.instructions;
        const pending = l.pending_request?.meeting_note;
        const editable = mode === "draft" ? (mayDecide || mayAsk) : mayDecide;
        return (
          /* The row opens a drawer; a control inside it must not. Without
             this, the first keystroke in an instruction opened the line
             behind it and took the focus with it (F36). */
          <div
            className="w-[220px] max-w-[220px]"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="presentation"
          >
            {editable ? (
              <>
                <textarea
                  id={`mi-${l.id}`}
                  value={noteOf(l)}
                  onChange={(e) => setNoteDraft((d) => ({ ...d, [l.id]: e.target.value }))}
                  rows={2}
                  placeholder={mode === "draft"
                    ? (mayDecide ? "e.g. only if they deliver before the 20th" : "what the room said — it goes with the question")
                    : "add an instruction to this one"}
                  className="w-full resize-y rounded-lg border border-slate-200 px-2 py-1 text-[12px] leading-snug focus:border-brand-400 focus:outline-none"
                />
                {noteOf(l).trim() && (
                  mode === "draft" ? (
                    <p className="text-[11px] text-amber-700">
                      {mayDecide ? "recorded when you approve" : "sent with the question"}
                    </p>
                  ) : (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => saveNote(l)}>
                      Record it
                    </Button>
                  )
                )}
              </>
            ) : (
              !existing && !pending && <span className="text-[11px] text-slate-400">—</span>
            )}
            {pending && !noteOf(l).trim() && (
              <p className="mt-0.5 text-[11px] text-slate-500">
                sent with the question: <span className="text-slate-700">{pending}</span>
              </p>
            )}
            {existing && (
              <p className="mt-0.5 text-[11px] text-slate-600">
                {existing}{" "}
                <span className="text-slate-400">— {l.note?.recorded_by_email.split("@")[0]}</span>
              </p>
            )}
          </div>
        );
      },
    };
  }

  const waitingColumns: Column<PrLineView>[] = [
    itemColumn,
    instructionColumn("draft"),
    {
      key: "qty",
      header: "Qty",
      align: "right",
      render: (l) => (
        <span className="whitespace-nowrap text-[12px] text-slate-600">
          {l.qty != null ? `${formatNumber(l.qty)} ${l.uom ?? ""}` : "—"}
        </span>
      ),
    },
    {
      key: "asked",
      header: "Asked for",
      align: "right",
      render: (l) => (
        <div className="whitespace-nowrap">
          <p className="tabular-nums font-medium text-slate-800">{formatIDR(l.item_total)}</p>
          {l.coverage.covered > 0 && (
            <p className="text-[11px] font-medium text-rose-600">
              {formatIDR(l.coverage.covered)} already paid
            </p>
          )}
        </div>
      ),
    },
    {
      key: "pick",
      header: "Pick",
      className: "whitespace-normal",
      render: (l) => {
        const on = picked[l.id] ?? false;
        return (
          /* Stops the click from opening the drawer: the row is a link, these
             controls are not. */
          <div className="w-[196px] space-y-1.5" onClick={(e) => e.stopPropagation()}>
            <label className="flex items-center gap-2 text-[13px] font-medium text-slate-700">
              <input
                id={`pick-${l.id}`}
                type="checkbox"
                checked={on}
                onChange={() => toggle(l)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
              />
              {mayDecide ? "Approve this" : "Include in the ask"}
            </label>

            {/* The amounts only matter once it is picked, and showing four
                fields per row on a list nobody has ticked is noise. */}
            {on && (
              <>
                {l.qty != null && (
                  <div className="flex items-center gap-1.5">
                    <NumberInput
                      id={`mq-${l.id}`}
                      size="sm"
                      value={qtyOf(l)}
                      onChange={(v) => setQty(l, v)}
                      min={0}
                      className="w-20 text-right"
                    />
                    <span className="text-[11px] text-slate-400">of {formatNumber(l.qty)} {l.uom ?? ""}</span>
                  </div>
                )}
                <MoneyInput
                  id={`ma-${l.id}`}
                  size="sm"
                  value={amountOf(l)}
                  onChange={(v) => setAmountDraft((d) => ({ ...d, [l.id]: v }))}
                />
                {amountOf(l) !== l.item_total && (
                  <p className={cn(
                    "text-[11px]",
                    amountOf(l) > l.item_total ? "text-amber-700" : "text-brand-700",
                  )}>
                    {formatIDR(Math.abs(amountOf(l) - l.item_total))}{" "}
                    {amountOf(l) > l.item_total ? "more" : "less"} than asked
                  </p>
                )}
              </>
            )}

            {!on && <StatusPill kind="line" status={l.status} />}
            {l.pending_request && (
              <p className="text-[11px] text-slate-500">
                asked {l.pending_request.sent_to_email.split("@")[0]} on chat ·{" "}
                {new Date(l.pending_request.sent_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
          </div>
        );
      },
    },
  ];

  const payColumns: Column<PrLineView>[] = [
    itemColumn,
    instructionColumn("save"),
    {
      key: "approved",
      header: "Approved",
      align: "right",
      render: (l) => (
        <div className="whitespace-nowrap">
          <p className="tabular-nums text-slate-700">
            {formatIDR(l.approval?.approved_amount ?? l.item_total)}
          </p>
          {l.approval && (
            <p className="text-[11px] text-slate-400">
              {l.approval.recorded_by_email.split("@")[0]} · {l.approval.channel}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "topay",
      header: "To pay",
      align: "right",
      render: (l) => (
        <div className="whitespace-nowrap">
          <p className="tabular-nums font-semibold text-slate-800">{formatIDR(l.coverage.remaining)}</p>
          {l.coverage.covered > 0 && (
            <p className="text-[11px] text-slate-500">{formatIDR(l.coverage.covered)} paid so far</p>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      /* One status for approved-and-unpaid, and no mention of which round the
         money came from. Cash is fungible: naming a round here would imply the
         money is being held for this line, and it is not (D126). */
      render: (l) => (
        <div className="whitespace-nowrap">
          <StatusPill kind="line" status={l.status} />
          <p className="mt-0.5 text-[11px] text-slate-500">not paid yet</p>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb="Procurement"
        title="Meeting board"
        description="What is waiting to be decided, what has already been approved and not paid, and whether BCA 271 can cover it. Read in the room; the working detail lives on the requests board."
        actions={
          <Link href="/procurement/pr">
            <Button variant="outline" icon={ExternalLink}>Requests board</Button>
          </Link>
        }
      />

      <Loaded state={lines} onRetry={reload}>
        {(all) => {
          const waiting = all.filter((l) => !l.approval?.approved && !l.removed_at);
          const toPay = all.filter((l) => l.approval?.approved && !l.coverage.settled && !l.removed_at);
          const paidUnapproved = waiting.filter((l) => l.coverage.covered > 0);
          const waitingTotal = waiting.reduce((s, l) => s + l.item_total, 0);
          const payTotal = toPay.reduce((s, l) => s + l.coverage.remaining, 0);

          const chosen = waiting.filter((l) => picked[l.id]);
          const chosenBare = chosen.filter((l) => !l.has_support);
          /* What is being approved and what still has to be paid are two
             different numbers, and on this board they are only the same when
             none of the picked lines has been paid already. A line bought
             first and approved later commits no new money: approving it is
             recording a decision about money that has gone (D124). */
          const chosenApproved = chosen.reduce((s, l) => s + amountOf(l), 0);
          const chosenTotal = chosen.reduce(
            (s, l) => s + Math.max(amountOf(l) - l.coverage.covered, 0), 0,
          );
          const chosenAlreadyPaid = chosenApproved - chosenTotal;

          return (
            <>
              <MoneyPanel lines={all} />

              {/* **Who decides, stated once and always visible.**
                  `ops_core.approvers()` is the only way a member of staff can
                  read this: `authorities_read` shows them their own row and
                  nothing else, so before 0159 the answer to *ke siapa?* did not
                  exist anywhere in the application. Both authorities are here
                  because both are asked for in this room — goods on this board,
                  funds on the payroll run and the funding round. */}
              {/* Not wrapped in `Loaded`: a five-row skeleton and a full-width
                  failure panel are the wrong weight for one line of context, and
                  the board is still usable without it. Absent while loading,
                  honest when it cannot be read — a board that silently stops
                  saying who decides is how this screen got here. */}
              {approvers.status === "failed" ? (
                <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-[12px] text-amber-800">
                  Could not read who holds the approval authorities, so this board cannot say who
                  to ask. {stripRefs(approvers.error.message)}
                </p>
              ) : approvers.status === "ready" ? (
                (() => {
                  const goods = approvers.data.filter((a) => a.authority === "approve_goods");
                  const funds = approvers.data.filter((a) => a.authority === "approve_funds");
                  return (
                    <div className="mb-4 flex flex-wrap items-start gap-x-6 gap-y-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[12px] shadow-card">
                      <span className="flex items-center gap-1.5 font-medium text-slate-700">
                        <ShieldCheck className="h-3.5 w-3.5 text-brand-600" />
                        Who decides
                      </span>
                      <span className="text-slate-600">
                        <span className="text-slate-400">goods · </span>
                        {goods.length > 0
                          ? goods.map((a) => a.full_name).join(", ")
                          : <span className="text-amber-700">nobody — nothing can be approved</span>}
                      </span>
                      <span className="text-slate-600">
                        <span className="text-slate-400">funds · </span>
                        {funds.length > 0
                          ? funds.map((a) => a.full_name).join(", ")
                          : <span className="text-amber-700">nobody</span>}
                      </span>
                      {/* An authority is granted in one place and read
                          everywhere; saying where it is granted stops this
                          becoming a list people ask IT to change by hand. */}
                      {can("it.read") && (
                        <Link
                          href="/it/pengguna"
                          className="ml-auto text-brand-700 underline-offset-2 hover:underline"
                        >
                          Change who holds it
                        </Link>
                      )}
                    </div>
                  );
                })()
              ) : null}

              {/* The confirm sits ABOVE the lists, with the total on it: a
                  meeting ticks its way down the page and then looks up to see
                  what it just committed to. Ticking writes nothing (D77). */}
              {chosen.length > 0 && (
                <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-brand-300 bg-brand-50 px-4 py-3 shadow-card">
                  <p className="text-[13px] text-brand-900">
                    <span className="text-xl font-bold tabular-nums">{chosen.length}</span>{" "}
                    item{chosen.length === 1 ? "" : "s"} picked
                  </p>
                  <p className="text-[13px] text-brand-900">
                    <span className="text-xl font-bold tabular-nums">{formatIDR(chosenTotal)}</span>{" "}
                    to pay if this goes through
                    {chosenAlreadyPaid > 0 && (
                      <span className="block text-[12px] text-brand-800">
                        {formatIDR(chosenApproved)} approved, of which{" "}
                        <strong className="tabular-nums">{formatIDR(chosenAlreadyPaid)}</strong> has
                        already left the account — approving it commits nothing more.
                      </span>
                    )}
                  </p>
                  {chosenBare.length > 0 && (
                    <p className="w-full text-[12px] text-amber-800">
                      {chosenBare.length === 1
                        ? "One of these has no document behind it and will be refused: "
                        : `${chosenBare.length} of these have no document behind them and will be refused: `}
                      {chosenBare.map((l) => l.line_no_full).join(", ")}. Attach the link or the
                      invoice on the requests board first.
                    </p>
                  )}
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setPicked({})} disabled={busy}>
                      Clear
                    </Button>
                    {mayDecide ? (
                      <Button size="sm" icon={Check} disabled={busy} onClick={() => approveSelected(chosen)}>
                        {busy ? "Recording…" : `Approve ${chosen.length} · ${formatIDR(chosenApproved)}`}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        icon={Send}
                        disabled={busy || !mayAsk || !askingWho}
                        onClick={() => sendSelected(chosen)}
                      >
                        {busy
                          ? "Sending…"
                          : askingWho
                            ? `Ask ${askingWho.full_name} on Chat · ${formatIDR(chosenTotal)}`
                            : "Nobody holds approve_goods"}
                      </Button>
                    )}
                  </div>
                  {!mayDecide && (
                    <div className="w-full space-y-1.5">
                      {/* **Who, before it is sent.** The board used to name the
                          recipient only in the toast afterwards, which is the
                          wrong moment: the question a person has as they reach
                          for the button is *who is this going to*. */}
                      {goodsApprovers.length > 1 ? (
                        <label
                          htmlFor="ask-to"
                          className="flex flex-wrap items-center gap-2 text-[12px] text-brand-900"
                        >
                          Ask
                          <select
                            id="ask-to"
                            value={askingWho?.email ?? ""}
                            onChange={(e) => setAskTo(e.target.value)}
                            className="rounded-lg border border-brand-300 bg-white px-2 py-1 text-[12px] text-slate-800 focus:border-brand-500 focus:outline-none"
                          >
                            {goodsApprovers.map((a) => (
                              <option key={a.email} value={a.email}>
                                {a.full_name} ({a.email})
                              </option>
                            ))}
                          </select>
                          — more than one person holds approve_goods, so the board does not
                          pick for you.
                        </label>
                      ) : askingWho ? (
                        <p className="text-[12px] text-brand-900">
                          Going to <strong>{askingWho.full_name}</strong>{" "}
                          <span className="text-brand-700">({askingWho.email})</span> — the only
                          account holding approve_goods.
                        </p>
                      ) : (
                        <p className="text-[12px] text-amber-800">
                          No active account holds approve_goods, so there is nobody this can be
                          sent to. IT grants it in Settings → People.
                        </p>
                      )}
                      <p className="text-[12px] text-brand-800">
                        You are not the approver, so this does not record a yes — it puts the
                        list in their chat with the amounts and what BCA 271 can cover, and
                        their answer is recorded as theirs.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {paidUnapproved.length > 0 && (
                <p className="mb-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  <span>
                    <strong>Money moved before anyone approved it</strong> on{" "}
                    {paidUnapproved.length} item(s), {formatIDR(paidUnapproved.reduce((s, l) => s + l.coverage.covered, 0))} in
                    total. They are in the first list, still waiting for a yes — paying
                    something is not deciding it.
                  </span>
                </p>
              )}

              <Card className="mb-5">
                <CardHeader
                  title="Waiting for a decision"
                  subtitle={`${waiting.length} item(s) · ${formatIDR(waitingTotal)} asked for. Nothing moves until these are decided.`}
                  icon={Circle}
                  action={
                    <div className="flex flex-wrap items-center gap-2">
                      <SourceBadge state={lines} />
                      {mayAsk && <QuickAdd onAdded={reload} />}
                    </div>
                  }
                />
                <DataTable
                  dense
                  columns={waitingColumns}
                  rows={waiting}
                  rowKey={(l) => l.id}
                  onRowClick={setSelected}
                  empty="Everything has been decided."
                />
              </Card>

              <Card>
                <CardHeader
                  title="Approved — not paid yet"
                  subtitle={`${toPay.length} item(s) · ${formatIDR(payTotal)} still to pay. This is the money that has to be in BCA 271.`}
                  icon={Clock}
                />
                {/* The total belongs at the top: it is the answer, and the
                    rows underneath are the working. */}
                {toPay.length > 0 && (
                  <div className="flex flex-wrap items-baseline gap-x-3 border-b border-slate-100 bg-slate-50/70 px-4 py-2.5">
                    <span className="text-[13px] text-slate-600">{toPay.length} item(s) to pay</span>
                    <span className="text-lg font-bold tabular-nums tracking-tight text-slate-800">
                      {formatIDR(payTotal)}
                    </span>
                  </div>
                )}
                <DataTable
                  dense
                  columns={payColumns}
                  rows={toPay}
                  rowKey={(l) => l.id}
                  onRowClick={setSelected}
                  empty="Nothing is approved and unpaid."
                />
              </Card>
            </>
          );
        }}
      </Loaded>

      <LineDrawer
        line={selected}
        others={lines.status === "ready" ? lines.data : undefined}
        onClose={() => setSelected(null)}
        onChanged={(l) => { setSelected(l); reload(); }}
        onRemove={async (l) => {
          const res = await procurement.removeLine({ line_no: l.line_no_full });
          if (res.error) { toast("warning", "Not removed", res.error.message); return; }
          toast("success", "Removed", `${l.line_no_full} is no longer needed.`);
          setSelected(null);
          reload();
        }}
      />
    </div>
  );
}
