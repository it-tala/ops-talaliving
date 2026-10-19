"use client";

import { TypeOptions } from "@/components/ui/type-options";
import { useEffect, useState } from "react";
import { BookOpen, Paperclip, AlertTriangle, ChevronLeft, ChevronRight, Plus, ArrowLeftRight } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Loaded, SourceBadge, useDebounced, useLoad } from "@/components/ui/loaded";
import { StatusPill } from "@/components/ui/status-pill";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { accounting, procurement } from "@/demo/api";
import { type TransactionView, type TransactionLineView } from "@/services/accounting/contracts";
import { LineKindBadge } from "@/components/accounting/line-kind";
import { CategoryOptions, categoryLabel } from "@/components/accounting/category";
import { isCategory } from "@/services/accounting/categories";
import type { Category } from "@/services/accounting/contracts";
import { TrxDrawer } from "./TrxDrawer";
import { CashPosition } from "./CashPosition";
import { NewEntry } from "./NewEntry";
import { TransferEntry } from "./TransferEntry";
import { DraftBand } from "./DraftBand";
import { useSession } from "@/store/session";
import { useTr } from "@/lib/i18n";
import { allPages } from "@/lib/xlsx-export";

/** The ledger: every row of money, and what each one is attached to.
 *
 *  It is a record of money that actually moved — never a budget, never a
 *  plan. So there is no "allocated" figure on a row (D88): the amount left the
 *  account, and the only question left is what it was for. A purchase that
 *  names no request line says so in one word, because that is the row worth
 *  asking about.
 *
 *  **Evidence** is the other column that earns its place: whether there is a
 *  document at all, on the row rather than in a folder somebody has to go and
 *  check. Since D85 a row cannot be posted without one, so this column is now
 *  mostly a record of history — the old rows that arrived before the rule.
 *
 *  Nothing is deleted from here. A wrong row is voided with a reason and stays
 *  visible (A5), because a row that is gone cannot be asked about — and the
 *  question always arrives later.
 */
const PAGE_SIZE = 25;

export default function LedgerPage() {
  const tr = useTr();
  const { hasAuthority } = useSession();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  /* Money between our own accounts, typed once (0282, L15). */
  const [transferring, setTransferring] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [typeCode, setTypeCode] = useState("");
  /* The effective category (0274), and a month the summary clicked through
     with: `/accounting/ringkasan` links a cell here as `?category=&month=`. */
  const [category, setCategory] = useState<Category | "">("");
  const [month, setMonth] = useState("");
  /* The project and the dates (0280, L7; kajian §6.5): both were on the
     service since 0033, neither on the screen. A date range typed here
     beats the month a summary cell clicked through with. */
  const [projectCode, setProjectCode] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [showVoid, setShowVoid] = useState(false);
  /* The a/b rows under each transaction (D437): shown by default, one
     checkbox to fold them away for a compact read. */
  const [showLines, setShowLines] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  /* `?trx=` opens that row — the item catalogue's purchase history links
     here. Read once from the address, like the items page's `?category=`. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const trx = params.get("trx");
    if (trx) setSelected(trx);
    const cat = params.get("category");
    if (cat && isCategory(cat)) setCategory(cat);
    const m = params.get("month");
    if (m && /^\d{4}-\d{2}$/.test(m)) setMonth(m);
    const p = params.get("project");
    if (p) setProjectCode(p);
  }, []);
  const monthBounds = month
    ? { from: `${month}-01`, to: `${month}-${String(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()).padStart(2, "0")}` }
    : {};
  const dateBounds = { ...monthBounds, ...(from ? { from } : {}), ...(to ? { to } : {}) };
  const [projectList] = useLoad(() => procurement.listProjects(), []);

  /* Paged at the service, not sliced in the browser: the real ledger is tens
     of thousands of rows and a screen that fetches them all to show 25 is a
     screen that will stop working on a phone. */
  /* The box updates as it is typed; the server is asked once the word settles. */
  const searched = useDebounced(q);
  const [rows, reload] = useLoad(
    () => accounting.listTransactions({
      account_id: accountId || undefined,
      type_code: typeCode || undefined,
      category: category || undefined,
      project_code: projectCode || undefined,
      ...dateBounds,
      q: searched || undefined,
      include_void: showVoid,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [accountId, typeCode, category, month, projectCode, from, to, searched, page, showVoid],
    { keepPrevious: true },
  );
  const mayPost = hasAuthority("post_ledger");
  /* The documents from Chat still undecided, grouped into one draft per
     transaction (D445). Above the table and outside every balance. */
  const [drafts, reloadDrafts] = useLoad(() => accounting.listDrafts(), [], { keepPrevious: true });
  const draftRows = drafts.status === "ready" ? drafts.data : [];
  const [booked, setBooked] = useState(0);
  /* One read for the page's lines, keyed by row — never a detail call per
     row. A single-line transaction shows no child: its parent is line a. */
  const pageNos = rows.status === "ready" ? rows.data.map((t) => t.trx_no) : [];
  const [lines] = useLoad(
    () => accounting.listTransactionLines(showLines ? pageNos : []),
    [pageNos.join(","), showLines],
    { keepPrevious: true },
  );
  const linesByTrx = new Map<string, TransactionLineView[]>();
  if (lines.status === "ready") {
    for (const l of lines.data) {
      const arr = linesByTrx.get(l.trx_no) ?? [];
      arr.push(l);
      linesByTrx.set(l.trx_no, arr);
    }
  }
  /* Which accounts hold cash. A card account owes money by design, so only a
     cash or bank account going below zero is the mark of a wrong figure. */
  const [accountList] = useLoad(() => accounting.listAccounts(), []);
  const cashAccounts = new Set(
    accountList.status === "ready"
      ? accountList.data.filter((a) => a.custody === "accounting").map((a) => a.account_id)
      : [],
  );

  function filter(next: () => void) {
    /* Any change of filter is a new first page — staying on page 4 of a list
       that no longer has four pages shows an empty table and no reason. */
    setPage(0);
    next();
  }

  function balanceCell(t: TransactionView, value: number | null) {
    /* Null on a VOID row, and on a row dated before the day balances begin
       (`ledger_balance_from`, 2026-10-12): the old rows were never checked
       against a bank, so no figure is printed beside them (D429). */
    if (value === null) {
      return (
        <span
          className="text-slate-300"
          title={t.status === "VOID"
            ? tr("Voided — moved no money", "Dibatalkan — tidak memindahkan uang")
            : tr("Before balances began on this ledger", "Sebelum saldo mulai dicatat di buku besar")}
        >—</span>
      );
    }
    const short = value < 0 && cashAccounts.has(t.account_id);
    return (
      <span
        title={short
          ? tr(`${t.account_code} below zero — check this amount, or a row missing before it`,
               `${t.account_code} minus — cek nominal ini, atau ada baris sebelumnya yang belum dicatat`)
          : t.account_code}
        className={cn("whitespace-nowrap tabular-nums text-[13px]", short ? "font-medium text-rose-700" : "text-slate-600")}
      >
        {formatIDR(value)}
      </span>
    );
  }

  const columns: Column<TransactionView>[] = [
    {
      key: "when",
      header: tr("Date", "Tanggal"),
      render: (t) => (
        <div className="whitespace-nowrap">
          <p className="text-[13px] text-slate-700">{t.trx_date}</p>
          <p className="font-mono text-[10px] text-slate-400">{t.trx_no}</p>
        </div>
      ),
    },
    {
      key: "what",
      header: tr("Description", "Deskripsi"),
      className: "whitespace-normal",
      render: (t) => (
        <div className="max-w-[380px] whitespace-normal break-words">
          <p className={cn("font-medium leading-snug text-slate-800", t.status === "VOID" && "line-through text-slate-400")}>
            {t.description}
          </p>
          <p className="text-[11px] text-slate-400">
            {t.account_code} · {t.type_code}
            {t.vendor_name && ` · ${t.vendor_name}`}
          </p>
          {t.void_reason && (
            <p className="mt-0.5 text-[11px] text-rose-700">{t.void_reason}</p>
          )}
        </div>
      ),
    },
    /* Which project the money was for (0280, L7): the name, the code under
       it, and nothing on a row that names none. */
    {
      key: "project",
      header: tr("Project", "Proyek"),
      render: (t) => t.project_code
        ? (
          <div className="max-w-[160px] whitespace-normal">
            <p className="text-[12px] leading-snug text-slate-700">{t.project_name ?? t.project_code}</p>
            {t.project_name && <p className="font-mono text-[10px] text-slate-400">{t.project_code}</p>}
          </div>
        )
        : <span className="text-slate-300">—</span>,
    },
    {
      key: "amount",
      header: tr("Amount", "Jumlah"),
      align: "right",
      render: (t) => (
        <div className="whitespace-nowrap">
          <p className={cn(
            "tabular-nums font-medium",
            t.direction === "IN" ? "text-emerald-700" : "text-slate-800",
          )}>
            {t.direction === "IN" ? "+" : "−"}{formatIDR(t.amount_idr)}
          </p>
          {/* A purchase that names no request, on the row rather than in a
              report nobody runs (D88). Not a budget figure — the money is
              gone either way; the question is what it was for. */}
          {t.unallocated > 0 && t.status !== "VOID" && t.expects_allocation && (
            <p className="text-[11px] text-amber-700">{tr("no request behind it", "tanpa permintaan di baliknya")}</p>
          )}
        </div>
      ),
    },
    /* The account's balance either side of the row, like the spreadsheet's
       balance columns (D429). Computed by the database, so a row posted late
       or corrected moves every balance after it. It is how a mistyped figure
       is found: the first row where ours stops agreeing with the bank. */
    {
      key: "balance_before",
      header: tr("Balance before", "Saldo sebelum"),
      align: "right",
      render: (t) => balanceCell(t, t.balance_before),
    },
    {
      key: "balance_after",
      header: tr("Balance after", "Saldo sesudah"),
      align: "right",
      render: (t) => balanceCell(t, t.balance_after),
    },
    {
      key: "evidence",
      header: tr("Evidence", "Bukti"),
      align: "center",
      render: (t) => t.evidence_count > 0
        ? (
          <span className="inline-flex items-center gap-1 text-[12px] text-slate-600">
            <Paperclip className="h-3.5 w-3.5 text-slate-400" />
            {t.evidence_count}
          </span>
        )
        : t.status === "VOID"
          ? <span className="text-slate-300">—</span>
          : <span className="inline-flex items-center gap-1 text-[12px] text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5" /> {tr("none", "tidak ada")}
            </span>,
    },
    {
      key: "status",
      header: tr("Status", "Status"),
      render: (t) => (
        <div className="space-y-0.5">
          <StatusPill kind="trx" status={t.status} />
          {t.pr_line_nos.length > 0 && (
            <p className="font-mono text-[10px] text-slate-400">{t.pr_line_nos[0]}</p>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Accounting", "Akuntansi")}
        title={tr("Ledger", "Buku besar")}
        description={tr("Money that actually moved, in and out, with what it was for and what proves it. Nothing is deleted here — a wrong row is voided with a reason and stays visible.", "Uang yang benar-benar bergerak, masuk dan keluar, beserta untuk apa dan apa buktinya. Tidak ada yang dihapus di sini — baris yang salah dibatalkan (void) dengan alasan dan tetap terlihat.")}
        actions={mayPost ? (
          <div className="flex gap-2">
            <Button variant="outline" icon={ArrowLeftRight} onClick={() => setTransferring(true)} data-testid="open-transfer">{tr("Move money", "Pindah dana")}</Button>
            <Button icon={Plus} onClick={() => setCreating(true)}>{tr("New entry", "Entri baru")}</Button>
          </div>
        ) : undefined}
      />

      <CashPosition active={accountId} onPick={(id) => filter(() => setAccountId(id))} drafts={draftRows} version={booked} />

      {drafts.status === "ready" && (
        <DraftBand
          drafts={draftRows}
          onChanged={() => { reloadDrafts(); setBooked((n) => n + 1); setPage(0); reload(); }}
          onOpenTrx={setSelected}
        />
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          id="f-type"
          value={typeCode}
          onChange={(e) => filter(() => setTypeCode(e.target.value))}
          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none"
        >
          <option value="">{tr("All types", "Semua jenis")}</option>
          <TypeOptions includeRetired />
        </select>
        <select
          id="f-category"
          value={category}
          onChange={(e) => filter(() => setCategory(e.target.value as Category | ""))}
          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none"
        >
          <CategoryOptions emptyLabel={tr("All categories", "Semua kategori")} />
        </select>
        <select
          id="f-project"
          value={projectCode}
          onChange={(e) => filter(() => setProjectCode(e.target.value))}
          className="h-9 max-w-[220px] rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none"
        >
          <option value="">{tr("All projects", "Semua proyek")}</option>
          {(projectList.status === "ready" ? projectList.data : []).map((p) => (
            <option key={p.id} value={p.code}>{p.code} · {p.name}</option>
          ))}
        </select>
        <input
          id="f-from"
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) => filter(() => setFrom(e.target.value))}
          title={tr("From date", "Dari tanggal")}
          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none"
        />
        <input
          id="f-to"
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => filter(() => setTo(e.target.value))}
          title={tr("To date", "Sampai tanggal")}
          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none"
        />
        {month && (
          <button
            type="button"
            id="f-month"
            onClick={() => filter(() => setMonth(""))}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-brand-200 bg-brand-50 px-2.5 text-xs font-medium text-brand-700"
            title={tr("Remove the month filter", "Lepas saringan bulan")}
          >
            {month} ×
          </button>
        )}
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <input
            id="f-void"
            type="checkbox"
            checked={showVoid}
            onChange={(e) => filter(() => setShowVoid(e.target.checked))}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          {tr("Include voided", "Sertakan yang dibatalkan")}
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-500">
          <input
            id="f-lines"
            type="checkbox"
            checked={showLines}
            onChange={(e) => setShowLines(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-slate-300"
          />
          {tr("Show a/b lines", "Tampilkan baris a/b")}
        </label>
        <input
          id="f-q"
          value={q}
          onChange={(e) => filter(() => setQ(e.target.value))}
          placeholder={tr("Description or number…", "Deskripsi atau nomor…")}
          className="ml-auto h-9 w-56 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none"
        />
      </div>

      <Loaded state={rows} onRetry={reload}>
        {(all) => {
          const visible = all;
          const out = visible.filter((t) => t.direction === "OUT").reduce((s, t) => s + t.amount_idr, 0);
          const inn = visible.filter((t) => t.direction === "IN").reduce((s, t) => s + t.amount_idr, 0);
          /* A purchase with no request behind it is the row worth finding.
             Payroll and the electricity bill are not that row (D83). */
          const unlinked = visible.filter((t) => t.expects_allocation && t.unallocated > 0 && t.status !== "VOID");
          const total = rows.status === "ready" ? rows.page?.total ?? visible.length : visible.length;
          const lastPage = Math.max(Math.ceil(total / PAGE_SIZE) - 1, 0);

          return (
            <Card>
              <CardHeader
                title={tr(`Page ${page + 1} of ${lastPage + 1}`, `Halaman ${page + 1} dari ${lastPage + 1}`)}
                subtitle={tr(
                  `${formatIDR(inn)} in · ${formatIDR(out)} out on this page${unlinked.length ? ` · ${unlinked.length} purchase(s) with no request behind them` : ""}`,
                  `${formatIDR(inn)} masuk · ${formatIDR(out)} keluar di halaman ini${unlinked.length ? ` · ${unlinked.length} pembelian tanpa permintaan di baliknya` : ""}`,
                )}
                icon={BookOpen}
                action={
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{tr(`${total} row(s)`, `${total} baris`)}</span>
                    <SourceBadge state={rows} />
                  </div>
                }
              />
              <DataTable
                dense
                columns={columns}
                rows={visible}
                rowKey={(t) => t.id}
                onRowClick={(t) => setSelected(t.trx_no)}
                /* The lines of a lumped-then-split row, under their parent
                   (D437): the letter, the kind, the description, the amount.
                   They open the same drawer — one transaction, one drawer. */
                renderAfter={(t) => {
                  const ls = showLines ? linesByTrx.get(t.trx_no) ?? [] : [];
                  if (ls.length < 2 || t.status === "VOID") return null;
                  return ls.map((l) => (
                    <tr key={l.id} data-no-export onClick={() => setSelected(t.trx_no)}
                      className="cursor-pointer bg-slate-50/60 text-[12px] text-slate-600 hover:bg-slate-100">
                      <td className="px-4 py-1 pl-10 whitespace-nowrap">
                        <span className="font-mono text-[10px] text-slate-400">{t.trx_no}-<span className="text-brand-700">{String.fromCharCode(96 + l.line_no)}</span></span>
                      </td>
                      <td className="px-4 py-1 whitespace-normal">
                        <span className="text-slate-700">{l.description}</span>
                        {" "}<LineKindBadge kind={l.kind} />
                        {l.item_code && <span className="ml-1 text-[10px] text-slate-400">· {l.item_name}</span>}
                      </td>
                      <td className={cn("px-4 py-1 text-right tabular-nums whitespace-nowrap", l.kind === "discount" ? "text-emerald-700" : "text-slate-600")}>
                        {l.kind === "discount" ? "+" : "−"}{formatIDR(l.amount)}
                      </td>
                      <td colSpan={4} className="px-4 py-1" />
                    </tr>
                  ));
                }}
                exportName={tr("Ledger", "Buku besar")}
                /* The screen holds one page; the file is every row under the
                   same filters. */
                exportRows={() => allPages((limit, offset) => accounting.listTransactions({
                  account_id: accountId || undefined,
                  type_code: typeCode || undefined,
                  category: category || undefined,
                  project_code: projectCode || undefined,
                  ...dateBounds,
                  q: searched || undefined,
                  include_void: showVoid,
                  limit,
                  offset,
                }))}
                empty={q || accountId || typeCode || category || month || projectCode || from || to ? tr("Nothing matches those filters.", "Tidak ada yang cocok dengan filter itu.") : tr("The ledger is empty.", "Buku besar masih kosong.")}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5">
                <p className="text-[12px] text-slate-500">
                  {tr(`Showing ${visible.length} of ${total}`, `Menampilkan ${visible.length} dari ${total}`)}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline" size="sm" icon={ChevronLeft}
                    disabled={page === 0}
                    onClick={() => setPage((n) => Math.max(n - 1, 0))}
                  >
                    {tr("Previous", "Sebelumnya")}
                  </Button>
                  <Button
                    variant="outline" size="sm"
                    disabled={page >= lastPage}
                    onClick={() => setPage((n) => Math.min(n + 1, lastPage))}
                  >
                    {tr("Next", "Berikutnya")} <ChevronRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </Card>
          );
        }}
      </Loaded>

      {creating && (
        <NewEntry
          onClose={() => setCreating(false)}
          onPosted={() => { setCreating(false); setPage(0); reload(); }}
        />
      )}
      {transferring && (
        <TransferEntry
          onClose={() => setTransferring(false)}
          onPosted={() => { setTransferring(false); setPage(0); reload(); }}
        />
      )}

      <TrxDrawer
        trxNo={selected}
        onClose={() => setSelected(null)}
        onChanged={reload}
        onOpen={setSelected}
      />
    </div>
  );
}
