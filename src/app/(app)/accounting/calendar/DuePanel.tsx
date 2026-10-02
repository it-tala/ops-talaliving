"use client";

import { useState } from "react";
import { Bell, CircleDollarSign, Link2, Search } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/drawer";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { formatIDR } from "@/lib/format";
import { officeToday } from "@/lib/office";
import { cn } from "@/lib/cn";
import { accounting } from "@/demo/api";
import type { CashDue } from "@/services/accounting/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";
import { isSubscriptionLine } from "@/services/accounting/subscriptions";
import { PayModal } from "../langganan/PayModal";

/** The reminder half of the calendar.
 *
 *  A budget nobody looks at on the 24th is a document; the same list, sorted
 *  by the day each bill falls due, is the thing that gets the electricity
 *  paid. Overdue first, because that is the one that costs money.
 */
export function DuePanel({ onChanged }: { onChanged: () => void }) {
  const tr = useTr();
  const [due, reload] = useLoad(() => accounting.listDue(), []);
  const [linking, setLinking] = useState<CashDue | null>(null);
  const [paying, setPaying] = useState<CashDue | null>(null);

  return (
    <>
      <Card className="mb-4">
        <CardHeader
          title={tr("Due next", "Jatuh tempo berikutnya")}
          subtitle={tr("The next three weeks, and anything already late — the same movements the month expansion shows, sorted by date.", "Tiga minggu ke depan, dan apa pun yang sudah terlambat — pergerakan yang sama dengan rincian bulan, diurutkan menurut tanggal.")}
          icon={Bell}
        />
        <Loaded state={due} onRetry={reload}>
          {(rows) => rows.length === 0 ? (
            <p className="px-5 py-6 text-[13px] text-slate-500">{tr("Nothing falls due in the next three weeks.", "Tidak ada yang jatuh tempo dalam tiga minggu ke depan.")}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {rows.map((d) => (
                <li key={`${d.component_id}:${d.date}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5">
                  <span className="w-[86px] shrink-0 font-mono text-[12px] text-slate-500">{d.date}</span>
                  <span className="min-w-[180px] flex-1 text-[13px] font-medium text-slate-800">
                    {d.name}
                    {d.vendor_name && <span className="font-normal text-slate-500"> · {d.vendor_name}</span>}
                    {d.frequency === "once" && !isSubscriptionLine(d.component_id) && (
                      <span className="ml-1.5 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-normal text-violet-700">
                        {tr("one-off", "sekali")}
                      </span>
                    )}
                    {d.amount_kind === "estimate" && (
                      <span className="ml-1.5 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-normal text-sky-700" title={tr("An estimate — any matched payment settles it", "Perkiraan — pembayaran apa pun yang cocok melunasinya")}>
                        {tr("estimate", "perkiraan")}
                      </span>
                    )}
                    {isSubscriptionLine(d.component_id) && d.reason && (
                      <span className="block text-[11px] font-normal text-slate-500">{d.reason}</span>
                    )}
                  </span>
                  <span className={cn(
                    "w-[120px] text-right text-[13px] tabular-nums",
                    d.direction === "IN" ? "text-emerald-700" : "text-slate-800",
                  )}>
                    {d.direction === "IN" ? "+ " : ""}{formatIDR(d.planned)}
                  </span>
                  <DueBadge d={d} />
                  {/* A subscription is settled by the payment recorded on it, not by
                      a ledger row — so it gets its own action (`0208`). */}
                  {d.direction === "OUT" && (isSubscriptionLine(d.component_id) ? (
                    <Button variant="ghost" size="sm" icon={CircleDollarSign} onClick={() => setPaying(d)}>
                      {tr("Record payment", "Catat pembayaran")}
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" icon={Link2} onClick={() => setLinking(d)}>
                      {tr("Link a payment", "Tautkan pembayaran")}
                    </Button>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </Loaded>
      </Card>

      {paying && (
        <PayModal
          subscriptionId={paying.component_id.slice(4)} period={paying.month}
          onClose={() => setPaying(null)}
          onSaved={() => { setPaying(null); reload(); onChanged(); }}
        />
      )}

      {linking && (
        <LinkPayment
          due={linking}
          onClose={() => setLinking(null)}
          onLinked={() => { setLinking(null); reload(); onChanged(); }}
        />
      )}
    </>
  );
}

function DueBadge({ d }: { d: CashDue }) {
  const tr = useTr();
  if (d.state === "OVERDUE") {
    return <Badge tone="red">{d.days_away === 0 ? tr("due today", "jatuh tempo hari ini") : tr(`${Math.abs(d.days_away)} day(s) late`, `terlambat ${Math.abs(d.days_away)} hari`)}</Badge>;
  }
  if (d.state === "PARTIAL") {
    return <Badge tone="amber">{tr(`part paid — ${formatIDR(d.actual)} so far`, `terbayar sebagian — ${formatIDR(d.actual)} sejauh ini`)}</Badge>;
  }
  if (d.days_away === 0) return <Badge tone="amber">{tr("due today", "jatuh tempo hari ini")}</Badge>;
  return <Badge tone={d.days_away <= 7 ? "amber" : "slate"}>{tr(`in ${d.days_away} day(s)`, `dalam ${d.days_away} hari`)}</Badge>;
}

const LINK_PAGE_SIZE = 10;

/** How far back the picker looks, and how many rows it will show at most.
 *  A payment is linked soon after it is made; two weeks covers the week it
 *  left and the week after, and sixty rows is a fortnight of this ledger. */
const LINK_WINDOW_DAYS = 14;
const LINK_MAX_ROWS = 60;

function daysBefore(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Pointing at the ledger row that paid a bill.
 *
 *  The calendar guesses by category, and says when it is guessing. This is how
 *  somebody replaces the guess with a fact — and the ledger stays the only
 *  place a payment is recorded, because a calendar that could post its own
 *  transactions would be a second books nobody reconciles. */
function LinkPayment({ due, onClose, onLinked }: { due: CashDue; onClose: () => void; onLinked: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  /* The last two weeks of outgoing rows, newest first and at most sixty,
     asked of the database directly. The search box and the sort below work
     on that small set in the browser, without a round trip per letter. */
  const since = daysBefore(officeToday(), LINK_WINDOW_DAYS);
  const [rows, reloadRows] = useLoad(() => accounting.listTransactions({
    direction: "OUT", from: since, limit: LINK_MAX_ROWS,
  }), [since]);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  async function link(trxNo: string) {
    setBusy(true);
    const res = await accounting.linkPayment({
      component_id: due.component_id, month: due.month, trx_no: trxNo,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", tr("Not linked", "Tidak ditautkan"), res.error.message);
      return;
    }
    toast("success", tr("Linked", "Ditautkan"), tr(`${trxNo} now counts against ${due.name}.`, `${trxNo} sekarang dihitung untuk ${due.name}.`));
    onLinked();
  }

  return (
    <Modal open onClose={onClose} width="max-w-2xl" title={tr(`Which row paid ${due.name}?`, `Baris mana yang membayar ${due.name}?`)}>
      <p className="mb-3 text-[13px] text-slate-600">
        {tr(
          `${due.month} · planned ${formatIDR(due.planned)}. Money out in the last ${LINK_WINDOW_DAYS} days (max. ${LINK_MAX_ROWS} transactions) — a payment is recorded in the ledger first, with its evidence, and named here afterwards.`,
          `${due.month} · direncanakan ${formatIDR(due.planned)}. Uang keluar ${LINK_WINDOW_DAYS} hari terakhir (maks. ${LINK_MAX_ROWS} transaksi) — pembayaran dicatat di buku besar lebih dulu, beserta buktinya, lalu disebutkan di sini.`,
        )}
      </p>
      <label className="relative mb-3 block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input
          value={q} onChange={(e) => setQ(e.target.value)} autoFocus
          placeholder={tr("Search description, number, type, account, or amount…", "Cari deskripsi, nomor, tipe, akun, atau nominal…")}
          className="h-9 w-full rounded-lg border border-slate-200 pl-8 pr-2 text-sm focus:border-brand-400 focus:outline-none"
        />
      </label>
      <Loaded state={rows} onRetry={reloadRows}>
        {(all) => {
          /* The row that paid a bill is almost always the one whose amount is
           * nearest the plan, so that one goes first; the date breaks ties,
           * newest first, the way the ledger reads. */
          const needle = q.trim().toLowerCase();
          const digits = needle.replace(/[^0-9]/g, "");
          const candidates = all
            .filter((t) => !needle
              || [t.description, t.trx_no, t.type_code, t.account_code]
                .some((f) => f?.toLowerCase().includes(needle))
              || (digits !== "" && /^(rp\s*)?[\d.,\s]+$/.test(needle) && String(Math.round(t.amount_idr)).includes(digits)))
            .sort((a, b) =>
              Math.abs(a.amount_idr - due.planned) - Math.abs(b.amount_idr - due.planned)
              || b.trx_date.localeCompare(a.trx_date));
          if (all.length === 0) {
            return (
              <p className="text-[13px] text-amber-700">
                {tr(
                  `No money went out in the last ${LINK_WINDOW_DAYS} days. Record the payment in the ledger first, then come back here.`,
                  `Tidak ada uang keluar dalam ${LINK_WINDOW_DAYS} hari terakhir. Catat pembayarannya di buku besar dulu, lalu kembali ke sini.`,
                )}
              </p>
            );
          }
          const cut = rows.status === "ready" && rows.page?.has_more
            ? <p className="mb-2 text-[12px] text-amber-700">
                {tr(
                  `Showing the ${LINK_MAX_ROWS} newest of ${rows.page.total} transactions in the last ${LINK_WINDOW_DAYS} days; older ones are not here.`,
                  `${LINK_MAX_ROWS} transaksi terbaru dari ${rows.page.total} dalam ${LINK_WINDOW_DAYS} hari terakhir yang ditampilkan; yang lebih lama tidak ada di sini.`,
                )}
              </p>
            : null;
          return candidates.length === 0 ? (
            <p className="text-[13px] text-slate-500">{tr(`No transaction matches “${q}”.`, `Tidak ada transaksi yang cocok dengan “${q}”.`)}</p>
          ) : (
            /* Ten at a time, at a fixed height: sixty rows in one list is a
             * modal that grows past the screen and pushes its own title and
             * close button off it. */
            <>
            {cut}
            <Paged rows={candidates} pageSize={LINK_PAGE_SIZE} unit={tr("transactions", "transaksi")}>
              {(shown) => (
                <ul className="-mx-5 h-[480px] divide-y divide-slate-100 overflow-y-auto border-t border-slate-100 px-5">
                  {shown.map((t) => (
                    <li key={t.trx_no} className="flex h-12 items-center gap-3">
                      <span className="w-[76px] shrink-0 font-mono text-[11px] text-slate-500">{t.trx_date}</span>
                      <span className="min-w-0 flex-1 text-[13px] text-slate-700">
                        <span className="block truncate" title={t.description}>{t.description}</span>
                        <span className="block truncate text-[11px] text-slate-500">
                          {t.type_code} · {t.account_code}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block tabular-nums text-[13px] text-slate-800">{formatIDR(t.amount_idr)}</span>
                        <AmountGap amount={t.amount_idr} planned={due.planned} />
                      </span>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => link(t.trx_no)}>
                        {tr("This one", "Yang ini")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Paged>
            </>
          );
        }}
      </Loaded>
    </Modal>
  );
}

/** How far a ledger row sits from the plan — the reason it is where it is in
 *  the list. */
function AmountGap({ amount, planned }: { amount: number; planned: number }) {
  const tr = useTr();
  const gap = amount - planned;
  if (Math.abs(gap) < 1) {
    return <span className="block text-[11px] font-medium text-emerald-700">{tr("exact match", "sama persis")}</span>;
  }
  return (
    <span className="block text-[11px] tabular-nums text-slate-400">
      {gap > 0 ? "+" : "−"}{formatIDR(Math.abs(gap))}
    </span>
  );
}
