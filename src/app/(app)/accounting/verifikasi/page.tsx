"use client";

import { TypeOptions } from "@/components/ui/type-options";
import { useCallback, useEffect, useState } from "react";
import {
  Inbox, FileText, Receipt, Undo2, Link2, StickyNote, XCircle, AlertTriangle, Check,
  RefreshCw,
} from "lucide-react";
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad, usePoll } from "@/components/ui/loaded";
import { usePaged } from "@/components/ui/pager";
import { MoneyInput } from "@/components/ui/money-input";
import { NumberInput } from "@/components/ui/number-input";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { officeClock, officeToday } from "@/lib/office";
import { accounting, documents, procurement } from "@/demo/api";
import { DocumentPreview } from "@/components/ui/doc-preview";
import type { EvidenceInboxRow, TransactionTypeCode, Direction, DocumentCoverage } from "@/services/accounting/contracts";
import type { AttachmentView } from "@/services/documents/contracts";
import { type UomCode } from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";
import { UomOptions } from "@/components/ui/uom-options";

/** The narrow road: documents whose parent is genuinely unknown.
 *
 *  Everything else in this system is attached **from** the record it belongs
 *  to (ADR-010). This queue exists for the case that road cannot serve:
 *  somebody bought first, photographed the nota in a chat thread, and there
 *  is nothing yet for the file to be attached to.
 *
 *  Five ways out, and **none of them throws anything away** (A16):
 *
 *    Make a transaction   it becomes a ledger row, with this file as its proof
 *    Retro request line   the request nobody raised, written after the fact,
 *                         then paid — so the board can show it as what it is
 *    Link                 the money is already booked; this is its missing proof
 *    Note                 not a company transaction. Kept, never posted
 *    Reject               not ours, or unreadable. Kept with a reason
 *
 *  The last two are the opposite of a ledger row, and worth saying plainly:
 *  rejecting is how you record that **no money of ours moved here** (D94). The
 *  file stays either way, because the question "what did we decide about that
 *  photo" arrives months later.
 *
 *  If this queue grows, people are routing around the main road — which is why
 *  the weekly arrival count sits at the top rather than in a report.
 */
type Road = "transaction" | "retro_pr_line" | "link" | "note" | "reject";

const ROADS: { key: Road; label: string; icon: typeof Receipt; hint: string }[] = [
  { key: "transaction", label: "Make a transaction", icon: Receipt, hint: "money left, nobody raised a request" },
  { key: "retro_pr_line", label: "Retro request line", icon: Undo2, hint: "write the request that should have existed" },
  { key: "link", label: "Link to a row", icon: Link2, hint: "already booked — this is its proof" },
  { key: "note", label: "Note", icon: StickyNote, hint: "not a transaction" },
  { key: "reject", label: "Reject", icon: XCircle, hint: "not ours" },
];

export default function InboxPage() {
  const { hasAuthority } = useSession();
  const { toast } = useToast();
  const [rows, reload, refreshRows] = useLoad(() => accounting.listInbox(), []);
  const [everything, reloadAll, refreshAll] = useLoad(() => accounting.listInboxAll(), []);
  const [health, reloadHealth, refreshHealth] = useLoad(() => accounting.getInboxHealth(), []);
  const [attachments] = useLoad(() => documents.listAttachments(), []);
  const [selected, setSelected] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  /* The queue and the history both page: an inbox is read from the top, and
     a year of decided evidence is not something to render at once (D157, B4). */
  const { shown: queue, pager: queuePager } = usePaged(
    rows.status === "ready" ? rows.data : [],
    12,
  );
  /* B4's other half. Paging made the history usable; it never answered *how
     far back is worth showing*, and a list that quietly stops somewhere is a
     list that lies by omission.

     The answer is a window with an honest edge: ninety days by default,
     because the question this list gets asked — *what did we do with that
     photo* — is an accounting-rhythm question and a quarter covers last month
     and the month before. What makes the window safe rather than a hiding
     place is that the card **always says what is outside it**, and names the
     date the history actually starts, so nothing is invisible without being
     counted (D269). */
  const [windowDays, setWindowDays] = useState<number | null>(90);
  const allDecided = everything.status === "ready"
    ? everything.data.filter((r) => r.status !== "PENDING")
    : [];
  const cutoff = windowDays === null ? null : (() => {
    const d = new Date(`${officeToday()}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - windowDays);
    return d.toISOString().slice(0, 10);
  })();
  const decided = cutoff === null
    ? allDecided
    : allDecided.filter((r) => r.reported_at.slice(0, 10) >= cutoff);
  const olderCount = allDecided.length - decided.length;
  const oldest = allDecided.reduce<string | null>(
    (acc, r) => (acc === null || r.reported_at < acc ? r.reported_at : acc), null);
  const { shown: decidedPage, pager: decidedPager } = usePaged(decided, 12);
  const mayResolve = hasAuthority("resolve_inbox");

  function refresh() {
    reload();
    reloadHealth();
    reloadAll();
    setSelected(null);
  }

  /* ── Why this screen polls, and what it refuses to do while polling ──────
   *
   * Documents arrive here from Google Chat, not from anybody sitting at this
   * screen: somebody photographs a nota in Bali and a pipeline puts it in this
   * queue minutes later. A screen that only changes when it is reloaded is a
   * screen that is wrong most of the time it is open, and the person watching
   * it has no way to tell whether the queue is empty or the page is stale.
   *
   * Sixty seconds, not five: the documents come from a cycle that runs every
   * few minutes, so a faster poll costs reads and buys nothing. `usePoll`
   * pauses while the tab is in the background and asks again the moment it
   * comes forward, so returning to this tab shows something current.
   *
   * **Never while somebody is deciding.** A refresh that reorders the list
   * under an open confirmation is worse than a stale list — the row being
   * decided about would move, and `selected` is a ref_id that could vanish
   * from under a half-typed form. A minute of staleness is a smaller price
   * than that, so the poll stops for as long as a document is open.
   */
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);

  const poll = useCallback(async () => {
    const results = await Promise.all([refreshRows(), refreshAll(), refreshHealth()]);
    const ok = results.every(Boolean);
    setRefreshFailed(!ok);
    /* Only a clean pass moves the clock. A time that advances while one of the
       three reads is failing would be the screen saying "this is current" about
       something it could not check. */
    if (ok) setLastRefreshed(new Date());
  }, [refreshRows, refreshAll, refreshHealth]);

  usePoll(60_000, poll, { enabled: selected === null });

  return (
    <div>
      <PageHeader
        breadcrumb="Accounting"
        title="Purchase verification"
        description="Documents that arrived with nothing to attach them to — somebody bought first and photographed the nota. Everything here leaves by one of five roads, and none of them throws the file away."
      />

      {/* A screen that refreshes itself has to say when it last managed to.
          Otherwise "nothing new today" and "this stopped asking an hour ago"
          look identical — which is the failure this whole screen exists
          downstream of. */}
      <div className="mb-3 flex items-center gap-2 text-[12px] text-slate-500">
        <button
          type="button"
          onClick={() => { void poll(); }}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 font-medium text-slate-600 hover:bg-slate-100"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
        {refreshFailed ? (
          <span className="text-amber-700">
            Could not refresh just now — showing the last good read
            {lastRefreshed && ` from ${officeClock(lastRefreshed)}`}.
          </span>
        ) : lastRefreshed ? (
          <span>Refreshed {officeClock(lastRefreshed)} · checks again every minute</span>
        ) : (
          <span>Checks for new documents every minute</span>
        )}
        {selected !== null && (
          <span className="text-slate-400">· paused while a document is open</span>
        )}
      </div>

      {health.status === "ready" && (
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-card">
          <p className="text-[13px] text-slate-600">
            <span className="text-xl font-bold tabular-nums text-slate-800">{health.data.arrived}</span>{" "}
            arrived this way since {health.data.week_start}
          </p>
          <p className="text-[13px] text-slate-600">
            <span className="text-xl font-bold tabular-nums text-slate-800">{health.data.unresolved}</span>{" "}
            still waiting
          </p>
          <p className="text-[12px] text-slate-500">
            {health.data.by_origin.chat} from chat · {health.data.by_origin.web} from the app
          </p>
          {/* The number is here rather than in a report because it is a
              measure of the main road, not of this screen: a queue that grows
              means people are going around the front door. */}
          <p className="ml-auto max-w-md text-[12px] text-slate-500">
            This queue should stay small. Every row in it is a purchase that
            happened before anybody asked.
          </p>
        </div>
      )}

      <Loaded state={rows} onRetry={reload}>
        {(all) => all.length === 0 ? (
          <Card>
            <div className="p-5">
              <EmptyState
                icon={Check}
                title="Nothing waiting"
                description="Every document that arrived without a parent has been resolved. The main road is doing its job."
              />
            </div>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
            <Card className="h-fit">
              <CardHeader
                title={`${all.length} waiting`}
                subtitle="Oldest first — a queue is not a filing cabinet."
                icon={Inbox}
                action={<SourceBadge state={rows} />}
              />
              <ul className="divide-y divide-slate-100">
                {queue.map((r) => {
                  const on = selected === r.ref_id;
                  const file = attachments.status === "ready"
                    ? attachments.data.find((a) => a.id === r.attachment_id)
                    : undefined;
                  return (
                    <li key={r.id}>
                      <button
                        onClick={() => setSelected(on ? null : r.ref_id)}
                        className={cn(
                          "w-full px-4 py-3 text-left transition-colors hover:bg-slate-50",
                          on && "bg-brand-50",
                        )}
                      >
                        <p className="flex items-center gap-2 text-[13px] font-medium text-slate-800">
                          <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <span className="min-w-0 truncate">
                            {r.extracted.note ?? r.extracted.vendor_name ?? file?.filename ?? r.attachment_id}
                          </span>
                        </p>
                        <p className="mt-0.5 text-[12px] text-slate-600">
                          {r.extracted.vendor_name ?? "vendor not read"} ·{" "}
                          {r.extracted.amount_idr != null ? formatIDR(r.extracted.amount_idr) : "amount not read"}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {r.reported_at.slice(0, 10)} · {r.origin}
                          {r.reported_by_name != null && ` · from ${r.reported_by_name}`}
                          {r.extracted.confidence != null && ` · read ${r.extracted.confidence}% sure`}
                        </p>
                        {r.similar_trx_nos.length > 0 && (
                          <p className="mt-1 text-[11px] text-amber-700">
                            looks like {r.similar_trx_nos.join(", ")}
                          </p>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {queuePager}
            </Card>

            {selected
              ? (
                <ResolvePanel
                  /* Every field below is seeded from `row.extracted` in a
                     `useState` initializer, which only runs once per mounted
                     instance. Without a key here, picking a different row in
                     the queue reused the same `ResolvePanel` and kept the
                     previous row's amount/vendor/description on screen —
                     "pre-filled from the AI reading" only on the very first
                     row opened in a session, stale on every one after. */
                  key={selected}
                  row={all.find((r) => r.ref_id === selected)!}
                  file={attachments.status === "ready"
                    ? attachments.data.find((a) => a.id === all.find((r) => r.ref_id === selected)!.attachment_id)
                    : undefined}
                  mayResolve={mayResolve}
                  onDone={refresh}
                  toast={toast}
                />
              )
              : (
                <Card>
                  <div className="p-5">
                    <EmptyState
                      icon={Inbox}
                      title="Pick one"
                      description="The document on the left, what to do with it on the right."
                    />
                  </div>
                </Card>
              )}
          </div>
        )}
      </Loaded>

      {/* Resolved rows stay readable, including the two roads that never
          touched the ledger. "What did we decide about that photo" is asked
          months later, and a queue that empties into nothing cannot answer it
          (A16). */}
      <Loaded state={everything} onRetry={reloadAll}>
        {(all) => {
          const done = all.filter((r) => r.status !== "PENDING");
          if (done.length === 0) return <></>;
          return (
            <Card className="mt-4">
              <CardHeader
                title="Already decided"
                subtitle={
                  <>
                    Kept, whichever road they took — including the ones that never reached the ledger.{" "}
                    {windowDays === null
                      ? `Semuanya: ${allDecided.length} keputusan${oldest ? `, sejak ${oldest.slice(0, 10)}` : ""}.`
                      : <>
                          {decided.length} dari {allDecided.length} keputusan, dalam {windowDays} hari terakhir.{" "}
                          {olderCount > 0
                            ? <span className="text-amber-700">
                                {olderCount} lagi lebih lama dari itu{oldest ? `, yang tertua ${oldest.slice(0, 10)}` : ""} — belum ditampilkan.
                              </span>
                            : "Tidak ada yang lebih lama dari itu."}
                        </>}
                  </>
                }
                icon={StickyNote}
                action={
                  <div className="flex flex-wrap items-center gap-1">
                    {([[30, "30 hari"], [90, "90 hari"], [365, "1 tahun"], [null, "Semua"]] as const).map(([d, label]) => (
                      <button
                        key={label}
                        onClick={() => setWindowDays(d)}
                        className={cn(
                          "rounded-lg px-2.5 py-1 text-[12px] transition-colors",
                          windowDays === d
                            ? "bg-brand-600 text-white"
                            : "border border-slate-200 text-slate-600 hover:bg-slate-50",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                }
              />
              <ul className="divide-y divide-slate-100">
                {decidedPage.map((r) => {
                  const on = reviewing === r.ref_id;
                  const f = attachments.status === "ready"
                    ? attachments.data.find((a) => a.id === r.attachment_id)
                    : undefined;
                  return (
                    <li key={r.id}>
                      {/* A decided document is the one most worth looking at
                          again — *what did we do with that photo* is asked
                          months later, and it was previously answerable only
                          as a row of words (B3). */}
                      <button
                        onClick={() => setReviewing(on ? null : r.ref_id)}
                        className={cn(
                          "flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-left text-[13px] hover:bg-slate-50",
                          on && "bg-slate-50",
                        )}
                      >
                        <Badge tone={
                          r.status === "CONFIRMED" ? "green"
                            : r.status === "ATTACHED" ? "violet"
                              : r.status === "REJECTED" ? "red" : "slate"
                        }>
                          {r.status}
                        </Badge>
                        <span className="min-w-0 flex-1 text-slate-700">
                          {r.extracted.note ?? r.extracted.vendor_name ?? f?.filename ?? r.attachment_id}
                        </span>
                        {r.extracted.amount_idr != null && (
                          <span className="tabular-nums text-slate-500">{formatIDR(r.extracted.amount_idr)}</span>
                        )}
                        <span className="font-mono text-[11px] text-slate-400">
                          {r.produced_pr_line_no ?? (r.produced_trx_id ? "posted" : "no ledger row")}
                        </span>
                        <span className="text-[11px] text-slate-400">{r.reported_at.slice(0, 10)}</span>
                      </button>
                      {on && (
                        <div className="grid gap-3 bg-slate-50/70 px-5 pb-4 pt-1 lg:grid-cols-[320px_1fr]">
                          {f && (
                            <DocumentPreview
                              height={230}
                              doc={{
                                id: f.id, filename: f.filename, mime: f.mime, bytes: f.bytes,
                                url: f.url, uploaded_at: f.uploaded_at,
                                kind: f.links[0]?.kind ?? null, read: r.extracted,
                              }}
                            />
                          )}
                          <DecidedCoverage
                            attachmentId={r.attachment_id}
                            amount={r.extracted.amount_idr ?? null}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {decided.length === 0 && (
                <p className="px-5 py-4 text-[13px] text-slate-500">
                  Tidak ada keputusan dalam {windowDays} hari terakhir. {allDecided.length} keputusan lain
                  ada di luar jendela ini — lebarkan jendelanya untuk melihatnya.
                </p>
              )}
              {decidedPager}
            </Card>
          );
        }}
      </Loaded>
    </div>
  );
}

/** One row of what a nota says. `key` is a client-side identity so React can
 *  tell two lines apart while they are being typed — the database has no
 *  opinion about it and never sees it. */
interface LineDraft {
  key: number;
  description: string;
  qty: number;
  uom: UomCode;
  unit_price: number;
}

/** Qty × price, rounded once. The line's amount is never typed: a total that
 *  disagrees with its own two factors is a third number nobody can check. */
function lineAmount(l: LineDraft): number {
  return Math.round(l.qty * l.unit_price);
}

function ResolvePanel({
  row, file, mayResolve, onDone, toast,
}: {
  row: EvidenceInboxRow;
  file: AttachmentView | undefined;
  mayResolve: boolean;
  onDone: () => void;
  toast: (tone: "success" | "warning" | "critical" | "info", title: string, body?: string) => void;
}) {
  const [accounts] = useLoad(() => accounting.listAccounts(), []);
  const [vendors] = useLoad(() => procurement.listVendors({}), []);
  const [projects] = useLoad(() => procurement.listProjects(), []);
  const [recent] = useLoad(() => accounting.listTransactions({ limit: 40 }), []);
  const filename = file?.filename ?? row.attachment_id;
  /* Re-read on every document, because *what does this paper already cover*
     is the question that stops the same nota being booked twice (D206). */
  const [coverage] = useLoad(
    () => accounting.coverageForDocument(row.attachment_id, row.extracted.amount_idr ?? null),
    [row.attachment_id, row.extracted.amount_idr],
  );

  /* `Others` never reaches the ledger: it branches to notes before anything
     else is looked at (owner, 2026-08-27). */
  const isOthers = row.extracted.doc_type === "Others";
  const [road, setRoad] = useState<Road>(isOthers ? "note" : "transaction");
  const [busy, setBusy] = useState(false);

  const [date, setDate] = useState(row.extracted.document_date ?? new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState("");
  const [direction, setDirection] = useState<Direction>(row.money_direction ?? "OUT");
  const [typeCode, setTypeCode] = useState<TransactionTypeCode>("SUPPLIERS");
  const [vendorId, setVendorId] = useState("");
  const [description, setDescription] = useState(row.extracted.note ?? "");
  const [amount, setAmount] = useState(row.extracted.amount_idr ?? 0);
  const [projectId, setProjectId] = useState("");
  /* `qty`/`uom` belong to the **retro request line** road only: that road
     writes one `pr_line`, and one line has one quantity. The transaction road
     below carries its own list instead — see `lines`. */
  const [qty, setQty] = useState(1);
  const [uom, setUom] = useState<UomCode>("pcs");

  /* ── What the nota says, line by line ──────────────────────────────────
   *
   * Owner, 2026-09-23: *alih alih konfirmasi tiap baris, buat per dokumen
   * saja … beberapa line sekaligus berupa deskripsi, qty, satuan, harga —
   * sementara tanggal, vendor, dan project sama semua.*
   *
   * That is what a nota is: one header, several things bought. It starts as
   * one line carrying the whole reading, because most notas are one thing and
   * an empty grid is a form somebody has to fill before they can read it.
   *
   * **`unit_price` is typed, not derived.** Until now the screen computed it
   * as `amount / qty`, which is backwards from the paper — the price per item
   * is printed on the nota and the total is the sum. Deriving it meant two
   * lines at different prices could not be expressed at all. */
  const [lines, setLines] = useState<LineDraft[]>([
    { key: 1, description: row.extracted.note ?? "", qty: 1, uom: "pcs",
      unit_price: row.extracted.amount_idr ?? 0 },
  ]);
  const linesTotal = lines.reduce((n, l) => n + lineAmount(l), 0);
  /* Shown live rather than left to the seam's refusal. The refusal is the net
     that stops a nota read as 3 items of 5 being booked as whole (§14 in
     john-lau's backlog); this is so nobody meets it by surprise after filling
     the form. */
  const linesAgree = lines.length === 0 || linesTotal === amount;
  const [purpose, setPurpose] = useState("");
  const [trxNo, setTrxNo] = useState("");
  const [reason, setReason] = useState("");

  const accountRows = accounts.status === "ready" ? accounts.data.filter((a) => a.is_active !== false) : [];

  /* The reading proposed a vendor; the form offers it rather than making
     somebody retype a name that is already on the screen. Still a proposal:
     it is selected, not committed, and the posting is the person agreeing
     (A13). Only an exact match — a near-miss silently picking the wrong
     supplier would be worse than an empty field. */
  useEffect(() => {
    if (vendorId || vendors.status !== "ready" || !row.extracted.vendor_name) return;
    const guess = vendors.data.find(
      (v) => v.name.toLowerCase() === row.extracted.vendor_name!.toLowerCase(),
    );
    if (guess) setVendorId(guess.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendors.status, row.ref_id]);
  const unitPrice = qty > 0 ? Math.round(amount / qty) : amount;

  async function run() {
    setBusy(true);
    try {
      if (road === "note" || road === "reject") {
        const res = await accounting.resolveInbox({ ref_id: row.ref_id, resolution: road, reason });
        if (res.error) { toast("warning", "Not recorded", res.error.message); return; }
        toast("success", road === "note" ? "Kept as a note" : "Rejected, and kept", "No money was recorded either way.");
        onDone();
        return;
      }

      if (road === "link") {
        const link = await documents.link({
          attachment_id: row.attachment_id, entity: "transaction", entity_no: trxNo,
          kind: "Receipt / Invoice / Nota",
        });
        if (link.error && link.error.status !== 409) {
          toast("warning", "Not linked", link.error.message);
          return;
        }
        const res = await accounting.resolveInbox({ ref_id: row.ref_id, resolution: "link", trx_no: trxNo });
        if (res.error) { toast("warning", "Not recorded", res.error.message); return; }
        toast("success", "Linked", `${filename} now proves ${trxNo}.`);
        onDone();
        return;
      }

      /* Both remaining roads write a ledger row, and the document travels with
         it as its evidence — the rule that applies to every other posting
         (D85) applies here too. */
      let lineNo: string | undefined;
      if (road === "retro_pr_line") {
        const line = await procurement.quickAddLine({
          description: description.trim() || filename,
          qty, uom, unit_price: unitPrice,
          vendor_id: vendorId || null,
          purpose: purpose.trim() || "Bought before anybody asked — written after the fact",
        });
        if (line.error) { toast("warning", "Not created", line.error.message); return; }
        lineNo = line.data.line_no_full;
      }

      /* **One call, for the plain transaction road.**
       *
       * This used to be `postTransaction` and then `resolveInbox`, and the
       * toast below still carried the failure that shape allows: *Posted,
       * inbox unchanged* — a document already in the ledger and still in the
       * queue, which the next person confirms again. `bookEvidence` does both
       * or neither (0124).
       *
       * The retro road keeps the old two-step path on purpose: it also writes
       * a request line and allocates against it, and those are different acts
       * that `book_evidence` deliberately does not know about. */
      if (road === "transaction") {
        const booked = await accounting.bookEvidence({
          ref_id: row.ref_id,
          trx_date: date, account_id: accountId, direction, amount_idr: amount,
          type_code: typeCode, vendor_id: vendorId || null, project_id: projectId || null,
          description: description.trim() || filename,
          lines: lines.map((l) => ({
            description: l.description.trim() || description.trim() || filename,
            qty: l.qty, uom: l.uom, unit_price: l.unit_price, amount: lineAmount(l),
          })),
        });
        if (booked.error) { toast("warning", "Not booked", booked.error.message); return; }
        toast("success", `Posted ${booked.data.trx_no}`,
          `${formatIDR(amount)} · ${lines.length} baris`);
        onDone();
        return;
      }

      const posted = await accounting.postTransaction({
        trx_date: date, account_id: accountId, direction, amount_idr: amount,
        type_code: typeCode, vendor_id: vendorId || null, project_id: projectId || null,
        description: description.trim() || filename,
        source_ref: `inbox:${row.ref_id}`,
        lines: [{
          description: description.trim() || filename,
          qty, uom, unit_price: unitPrice, amount,
        }],
        documents: [{ attachment_id: row.attachment_id, kind: "Receipt / Invoice / Nota" }],
      });
      if (posted.error) { toast("warning", "Not posted", posted.error.message); return; }

      if (lineNo) {
        /* Allocating is what makes the board show it for what it is: paid,
           and never approved. */
        const alloc = await accounting.allocate({
          trx_no: posted.data.trx_no, pr_line_no: lineNo, amount, method: "cash",
        });
        if (alloc.error) toast("warning", "Posted, not allocated", alloc.error.message);
      }

      const res = await accounting.resolveInbox({
        ref_id: row.ref_id, resolution: road,
        trx_no: posted.data.trx_no, pr_line_no: lineNo,
      });
      if (res.error) { toast("warning", "Posted, inbox unchanged", res.error.message); return; }
      toast(
        "success",
        `Posted ${posted.data.trx_no}`,
        lineNo ? `${formatIDR(amount)} · request line ${lineNo} written after the fact` : formatIDR(amount),
      );
      onDone();
    } finally {
      setBusy(false);
    }
  }

  const canRun = mayResolve && (
    road === "note" || road === "reject" ? reason.trim().length > 0
      : road === "link" ? !!trxNo
        /* The button is disabled while the lines disagree, and the reason is
           shown beside them. The seam refuses this too — the screen refusing
           first is a courtesy, not the control (D220: the database decides). */
        : road === "transaction" ? !!accountId && amount > 0 && linesAgree
          : !!accountId && amount > 0
  );

  return (
    <Card>
      <CardHeader
        title={row.extracted.note ?? row.extracted.vendor_name ?? file?.filename ?? row.attachment_id}
        subtitle={`${row.origin} · ${row.reported_at.slice(0, 16).replace("T", " ")}`
          + (row.reported_by_name != null ? ` · from ${row.reported_by_name}` : "")
          + ` · read ${row.extracted.confidence ?? "—"}% sure`}
        icon={FileText}
        action={<Badge tone={row.money_direction === "IN" ? "green" : "slate"}>{row.money_direction ?? "OUT"}</Badge>}
      />

      <div className="space-y-4 px-5 py-4 text-sm">
        {/* The picture first. Verification is comparing the paper with the
            figures, and until now this screen asked for that from a filename
            (B3). Clicking another document in the queue swaps this in place —
            no modal, so the comparison survives the click. */}
        {file && (
          <DocumentPreview
            doc={{
              id: file.id, filename: file.filename, mime: file.mime, bytes: file.bytes,
              url: file.url, uploaded_at: file.uploaded_at,
              kind: file.links[0]?.kind ?? null,
              read: row.extracted,
            }}
          />
        )}

        <Loaded state={coverage}>
          {(c) => <Coverage c={c} />}
        </Loaded>

        {/* What the reading proposed. A proposal, never a posting (A13). */}
        <dl className="grid gap-x-6 gap-y-2 rounded-lg bg-slate-50 px-3 py-2.5 sm:grid-cols-4">
          {([
            ["Vendor", row.extracted.vendor_name ?? "not read"],
            ["Date", row.extracted.document_date ?? "not read"],
            ["Amount", row.extracted.amount_idr != null ? formatIDR(row.extracted.amount_idr) : "not read"],
            ["Type", row.extracted.doc_type ?? "not read"],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
              <dd className="text-[13px] text-slate-700">{v}</dd>
            </div>
          ))}
        </dl>
        {row.extracted.note && (
          <p className="text-[13px] text-slate-600">{row.extracted.note}</p>
        )}

        {row.similar_trx_nos.length > 0 && (
          /* Advisory, and it points at the road it suggests rather than
             refusing anything (A6). */
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              This looks like <span className="font-mono">{row.similar_trx_nos.join(", ")}</span>,
              already in the ledger. If it is the same money, the road is{" "}
              <button className="font-medium underline" onClick={() => { setRoad("link"); setTrxNo(row.similar_trx_nos[0]); }}>
                link to a row
              </button>{" "}
              — posting it again would invent money.
            </span>
          </p>
        )}

        {isOthers && (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[13px] text-slate-600">
            Read as <strong>Others</strong>, so it starts on the notes road: nothing
            that is not a company transaction should touch the ledger, even for a
            moment.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {ROADS.map((r) => {
            const Icon = r.icon;
            const on = road === r.key;
            return (
              <button
                key={r.key}
                onClick={() => setRoad(r.key)}
                title={r.hint}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] transition-colors",
                  on ? "border-brand-300 bg-brand-50 text-brand-800"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {r.label}
              </button>
            );
          })}
        </div>

        {(road === "transaction" || road === "retro_pr_line") && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="rv-date" className="block text-xs text-slate-500">Date the money moved</label>
              <input id="rv-date" type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none" />
            </div>
            <div>
              <label htmlFor="rv-account" className="block text-xs text-slate-500">Account</label>
              <select id="rv-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none">
                <option value="">Choose…</option>
                {accountRows.map((a) => <option key={a.account_id} value={a.account_id}>{a.code} — {a.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="rv-dir" className="block text-xs text-slate-500">In or out</label>
              <select id="rv-dir" value={direction} onChange={(e) => setDirection(e.target.value as Direction)}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none">
                <option value="OUT">OUT — money left</option>
                <option value="IN">IN — money arrived</option>
              </select>
            </div>
            <div>
              <label htmlFor="rv-type" className="block text-xs text-slate-500">Type</label>
              <select id="rv-type" value={typeCode} onChange={(e) => setTypeCode(e.target.value as TransactionTypeCode)}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none">
                <TypeOptions current={typeCode} />
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="rv-desc" className="block text-xs text-slate-500">What was bought</label>
              <input id="rv-desc" value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. PAKU 5CM, 4 kg"
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none" />
            </div>
            <div>
              <label htmlFor="rv-vendor" className="block text-xs text-slate-500">Vendor</label>
              <select id="rv-vendor" value={vendorId} onChange={(e) => setVendorId(e.target.value)}
                aria-describedby="rv-vendor-hint"
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none">
                <option value="">Not a vendor purchase</option>
                {vendors.status === "ready" && vendors.data.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
              {row.extracted.vendor_name && (
                <p id="rv-vendor-hint" className="mt-1 text-[11px] text-slate-500">
                  Read as <span className="text-slate-700">{row.extracted.vendor_name}</span>
                  {!vendorId && " — not a vendor we have on record; pick one or add it first"}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="rv-project" className="block text-xs text-slate-500">Project</label>
              <select id="rv-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none">
                <option value="">No project</option>
                {projects.status === "ready" && projects.data.map((pr) => (
                  <option key={pr.id} value={pr.id}>{pr.code} — {pr.name}</option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                One nota, one project — it is shared by every line below.
              </p>
            </div>
            {road === "retro_pr_line" && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="rv-qty" className="block text-xs text-slate-500">Qty</label>
                  <NumberInput id="rv-qty" value={qty} min={0} onChange={setQty} className="mt-1" />
                </div>
                <div>
                  <label htmlFor="rv-uom" className="block text-xs text-slate-500">Unit</label>
                  <select id="rv-uom" value={uom} onChange={(e) => setUom(e.target.value as UomCode)}
                    className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none">
                    <UomOptions current={uom} />
                  </select>
                </div>
              </div>
            )}
            <div className="sm:col-span-2">
              <label htmlFor="rv-amount" className="block text-xs text-slate-500">
                Amount <span className="text-slate-400">— the reading proposed {row.extracted.amount_idr != null ? formatIDR(row.extracted.amount_idr) : "nothing"}</span>
              </label>
              <MoneyInput id="rv-amount" value={amount} onChange={setAmount} className="mt-1" />
              <p className="mt-1 text-[11px] text-slate-500">
                {road === "retro_pr_line" && qty > 0 && `${qty} ${uom} × ${formatIDR(unitPrice)} — `}
                posting is you agreeing with the number, not the extraction being believed.
              </p>
            </div>
            {road === "transaction" && (
              <div className="sm:col-span-2">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-slate-500">What is on the nota</span>
                  <button type="button"
                    onClick={() => setLines((ls) => [
                      ...ls,
                      { key: Math.max(0, ...ls.map((l) => l.key)) + 1,
                        description: "", qty: 1, uom: "pcs", unit_price: 0 },
                    ])}
                    className="text-[11px] font-medium text-brand-700 hover:underline">
                    + baris
                  </button>
                </div>

                <div className="mt-1 space-y-2">
                  {lines.map((l, i) => (
                    <div key={l.key} className="grid grid-cols-12 items-end gap-1.5">
                      <div className="col-span-12 sm:col-span-5">
                        <label htmlFor={`rv-l-desc-${l.key}`} className="sr-only">Barang baris {i + 1}</label>
                        <input id={`rv-l-desc-${l.key}`} value={l.description}
                          placeholder="e.g. PAKU 5CM"
                          onChange={(e) => setLines((ls) => ls.map((x) =>
                            x.key === l.key ? { ...x, description: e.target.value } : x))}
                          className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-400 focus:outline-none" />
                      </div>
                      <div className="col-span-3 sm:col-span-2">
                        <label htmlFor={`rv-l-qty-${l.key}`} className="sr-only">Qty baris {i + 1}</label>
                        <NumberInput id={`rv-l-qty-${l.key}`} value={l.qty} min={0}
                          onChange={(v) => setLines((ls) => ls.map((x) =>
                            x.key === l.key ? { ...x, qty: v } : x))} />
                      </div>
                      <div className="col-span-3 sm:col-span-2">
                        <label htmlFor={`rv-l-uom-${l.key}`} className="sr-only">Satuan baris {i + 1}</label>
                        <select id={`rv-l-uom-${l.key}`} value={l.uom}
                          onChange={(e) => setLines((ls) => ls.map((x) =>
                            x.key === l.key ? { ...x, uom: e.target.value as UomCode } : x))}
                          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-1.5 text-sm focus:border-brand-400 focus:outline-none">
                          <UomOptions current={l.uom} />
                        </select>
                      </div>
                      <div className="col-span-5 sm:col-span-2">
                        <label htmlFor={`rv-l-price-${l.key}`} className="sr-only">Harga satuan baris {i + 1}</label>
                        <MoneyInput id={`rv-l-price-${l.key}`} value={l.unit_price}
                          onChange={(v) => setLines((ls) => ls.map((x) =>
                            x.key === l.key ? { ...x, unit_price: v } : x))} />
                      </div>
                      <div className="col-span-1 flex justify-end">
                        {lines.length > 1 && (
                          <button type="button" aria-label={`Hapus baris ${i + 1}`}
                            onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                            <XCircle className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {/* The sum, against the document total, always visible. A nota
                    read as 3 items of 5 is invisible line by line and obvious
                    here — which is the whole reason the unit of review moved
                    from the line to the document. */}
                <div className={cn(
                  "mt-2 flex items-center justify-between rounded-lg px-3 py-2 text-sm",
                  linesAgree ? "bg-slate-50 text-slate-600" : "bg-amber-50 text-amber-900",
                )}>
                  <span>
                    {lines.length} baris berjumlah <strong>{formatIDR(linesTotal)}</strong>
                  </span>
                  {linesAgree
                    ? <span className="inline-flex items-center gap-1 text-[12px]"><Check className="h-3.5 w-3.5" /> cocok</span>
                    : (
                      <span className="inline-flex items-center gap-1 text-[12px]">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        selisih {formatIDR(linesTotal - amount)} dari {formatIDR(amount)}
                      </span>
                    )}
                </div>
                {!linesAgree && (
                  <p className="mt-1 text-[11px] text-amber-800">
                    Tambahkan baris untuk sisanya, atau perbaiki salah satunya. Nota yang
                    terbaca sebagian tidak bisa dibukukan seolah-olah utuh.
                  </p>
                )}
              </div>
            )}

            {road === "retro_pr_line" && (
              <div className="sm:col-span-2">
                <label htmlFor="rv-purpose" className="block text-xs text-slate-500">What it was for</label>
                <input id="rv-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)}
                  placeholder="e.g. Bench repair, workshop"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none" />
                <p className="mt-1 text-[11px] text-slate-500">
                  The line is written unapproved on purpose: it will show on the board
                  as <em>paid, not approved</em>, which is what happened.
                </p>
              </div>
            )}
          </div>
        )}

        {road === "link" && (
          <div>
            <label htmlFor="rv-trx" className="block text-xs text-slate-500">Which ledger row is this the proof of?</label>
            <select id="rv-trx" value={trxNo} onChange={(e) => setTrxNo(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none">
              <option value="">Choose…</option>
              {recent.status === "ready" && recent.data.map((t) => (
                <option key={t.trx_no} value={t.trx_no}>
                  {t.trx_date} · {t.trx_no} · {formatIDR(t.amount_idr)} · {t.description.slice(0, 40)}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-500">
              No new money: the row already exists and was missing its document.
            </p>
            {/* The check that actually bites. The document in the queue is
                attached to nothing, so its own coverage decides nothing; what
                decides whether *link* is right is what the row already
                carries (D207). */}
            {trxNo && <TargetRow trxNo={trxNo} />}
          </div>
        )}

        {(road === "note" || road === "reject") && (
          <div>
            <label htmlFor="rv-reason" className="block text-xs text-slate-500">
              {road === "note" ? "What is this?" : "Why is this not ours?"}
            </label>
            <input id="rv-reason" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder={road === "note" ? "e.g. personal document, sent to the wrong thread" : "e.g. supplier sent somebody else's invoice"}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none" />
            <p className="mt-1 text-[11px] text-slate-500">
              Nothing reaches the ledger by this road, and the file is kept either
              way — the question &quot;what did we decide about that photo&quot; arrives months
              later.
            </p>
          </div>
        )}

        {!mayResolve && (
          <p className="text-[12px] text-slate-500">
            Resolving belongs to whoever holds <span className="font-mono text-[11px]">resolve_inbox</span>.
            You can read the queue either way.
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
        <Button size="sm" disabled={busy || !canRun} onClick={run}>
          {busy ? "Recording…" : ROADS.find((r) => r.key === road)!.label}
        </Button>
      </div>
    </Card>
  );
}

/** What this one piece of paper is already holding up.
 *
 *  Three shapes, and the screen has to be able to say all three out loud
 *  before anybody presses one of the five roads (D206):
 *
 *  - **one document, several ledger rows** — booking it again is the mistake
 *    this queue is most able to produce, and the only thing that prevents it
 *    is seeing what is already there;
 *  - **one transfer proof, several purchases** — where the figure that matters
 *    is the gap between what the paper says and what the rows under it add to;
 *  - **one purchase paid twice, cash and transfer** — two ledger rows on two
 *    accounts, correctly, shown here as one payment in two parts.
 *
 *  The gap is **blank rather than zero** when nobody has read the document's
 *  own value. A gap measured against an unknown is the whole amount wearing a
 *  different name.
 */
function Coverage({ c }: { c: DocumentCoverage }) {
  if (c.transactions.length === 0) {
    return (
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
        Dokumen ini belum menopang baris mana pun. Apa pun yang dipilih di bawah akan jadi
        yang pertama.
      </p>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-brand-200 bg-brand-50/50 px-3 py-2.5">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-slate-700">
        <Link2 className="h-3.5 w-3.5 text-brand-600" />
        <span>
          Sudah menopang <strong>{c.transactions.length} baris buku besar</strong>
          {c.lines.length > 0 && <> dan menyentuh <strong>{c.lines.length} baris permintaan</strong></>}
        </span>
        {c.shared && <Badge tone="amber">satu dokumen, banyak transaksi</Badge>}
      </p>

      <ul className="space-y-1">
        {c.transactions.map((t) => (
          <li key={t.trx_no} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
            <span className="font-mono text-[11px] text-slate-600">{t.trx_no}</span>
            <span className="text-slate-500">{t.account_code}</span>
            <span className="tabular-nums font-medium text-slate-800">{formatIDR(t.amount_idr)}</span>
            {t.status === "VOID" && <Badge tone="slate">VOID — nilainya nol</Badge>}
            {t.other_documents > 0 && (
              <span className="text-[11px] text-slate-400">
                +{t.other_documents} dokumen lain di baris yang sama
              </span>
            )}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-baseline gap-x-3 border-t border-brand-200/70 pt-1.5 text-[12px]">
        <span className="text-slate-500">Jumlah yang ditopang</span>
        <span className="tabular-nums font-semibold text-slate-900">{formatIDR(c.covered_total)}</span>
        {c.document_amount == null ? (
          <span className="text-amber-700">
            nilai dokumennya belum terbaca — selisihnya tidak bisa dihitung, dan nol di sini akan
            menyesatkan
          </span>
        ) : c.gap === 0 ? (
          <span className="text-emerald-700">pas dengan nilai dokumennya</span>
        ) : (
          <span className="text-amber-800">
            selisih {formatIDR(Math.abs(c.gap ?? 0))}{" "}
            {(c.gap ?? 0) > 0 ? "belum tercatat di mana pun" : "lebih besar dari nilai dokumennya"}
          </span>
        )}
      </div>

      {c.lines.length > 0 && (
        <ul className="space-y-1.5 border-t border-brand-200/70 pt-1.5">
          {c.lines.map((l) => (
            <li key={l.line_no_full} className="text-[12px]">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono text-[11px] text-slate-600">{l.line_no_full}</span>
                <span className="min-w-0 flex-1 truncate text-slate-700">{l.description}</span>
                <span className="tabular-nums text-slate-600">
                  {formatIDR(l.covered)} / {formatIDR(l.approved)}
                </span>
                {l.settled
                  ? <Badge tone="green">lunas</Badge>
                  : <Badge tone="amber">sisa {formatIDR(l.remaining)}</Badge>}
              </span>
              {/* More than one payment on a line **is** the split: part cash,
                  part transfer, two ledger rows, one purchase. */}
              {l.payments.length > 1 && (
                <span className="mt-0.5 block pl-2 text-[11px] text-slate-500">
                  dibayar {l.payments.length}×:{" "}
                  {l.payments.map((p, i) => (
                    <span key={`${p.trx_no}-${i}`}>
                      {i > 0 && " + "}
                      <span className={p.from_this_document ? "font-medium text-slate-700" : ""}>
                        {p.method} {formatIDR(p.amount)} ({p.account_code})
                      </span>
                      {!p.from_this_document && <span className="text-slate-400"> — dokumen lain</span>}
                    </span>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** What the row you are about to attach this document to already carries.
 *
 *  Read before pressing *link*, because the mistake this queue produces most
 *  easily is proving a row that was already proven — and the one after that is
 *  attaching a nota to a row whose money is pointed at four other purchases.
 *  Neither is visible from the document's side (D207).
 */
function TargetRow({ trxNo }: { trxNo: string }) {
  const [cov] = useLoad(() => accounting.coverageForTransaction(trxNo), [trxNo]);

  return (
    <Loaded state={cov}>
      {(c) => (
        <div className="mt-2 space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[12px]">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-mono text-[11px] text-slate-600">{c.trx_no}</span>
            <span className="text-slate-500">{c.account_code}</span>
            <span className="tabular-nums font-medium text-slate-800">{formatIDR(c.amount_idr)}</span>
            {c.status === "VOID" && <Badge tone="slate">VOID</Badge>}
          </p>

          {c.documents.length > 0 ? (
            <p className="text-slate-600">
              Sudah punya {c.documents.length} dokumen:{" "}
              <span className="text-slate-500">{c.documents.map((d) => `${d.filename} (${d.kind})`).join(" · ")}</span>
              {c.documents.length >= 2 && (
                <span className="block text-amber-800">
                  Dua dokumen di satu baris itu biasa — nota dan bukti transfernya. Yang ketiga
                  layak dilihat dulu: pastikan ini bukan nota yang sama yang dibukukan lagi.
                </span>
              )}
            </p>
          ) : (
            <p className="text-slate-500">Belum ada dokumen di baris ini.</p>
          )}

          {c.allocations.length > 0 && (
            <p className="text-slate-600">
              Uangnya menutup {c.allocations.length}{" "}
              {c.allocations.length > 1 ? "pembelian" : "pembelian"}:{" "}
              {c.allocations.map((a) => `${a.target} ${formatIDR(a.amount)} (${a.method})`).join(" · ")}
              {c.unallocated !== 0 && (
                <span className="block text-amber-800">
                  {formatIDR(Math.abs(c.unallocated))}{" "}
                  {c.unallocated > 0 ? "dari baris ini belum diarahkan ke pembelian mana pun" : "lebih banyak dialokasikan daripada nilai barisnya"}
                </span>
              )}
            </p>
          )}

          {c.lines.filter((l) => l.payments.length > 1).map((l) => (
            <p key={l.line_no_full} className="text-slate-600">
              <span className="font-mono text-[11px]">{l.line_no_full}</span> dibayar{" "}
              {l.payments.length}×:{" "}
              {l.payments.map((pm) => `${pm.method} ${formatIDR(pm.amount)} (${pm.account_code})`).join(" + ")}
              {l.settled && <> <Badge tone="green">lunas</Badge></>}
            </p>
          ))}
        </div>
      )}
    </Loaded>
  );
}

/** The coverage of a document that has already been decided. Same computation
 *  as the queue's, read months later, which is when it is actually wanted. */
function DecidedCoverage({ attachmentId, amount }: { attachmentId: string; amount: number | null }) {
  const [cov] = useLoad(() => accounting.coverageForDocument(attachmentId, amount), [attachmentId, amount]);
  return <Loaded state={cov}>{(c) => <Coverage c={c} />}</Loaded>;
}
