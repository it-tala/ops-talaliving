"use client";

import { useState } from "react";
import { Check, X, ChevronRight, FileStack, Link2, ArrowLeftRight, BadgeCheck, Scissors } from "lucide-react";
import { Button, Card, CardHeader } from "@/components/ui/primitives";
import { useLoad } from "@/components/ui/loaded";
import { usePaged } from "@/components/ui/pager";
import { MoneyInput } from "@/components/ui/money-input";
import { DocumentPreview } from "@/components/ui/doc-preview";
import { ExcelTable } from "@/components/ui/excel-export";
import { TypeOptions } from "@/components/ui/type-options";
import { driveOpenUrl } from "@/lib/drive-links";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { accounting, documents, procurement } from "@/demo/api";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";
import { useTr, type Tr } from "@/lib/i18n";
import { LineKindBadge } from "@/components/accounting/line-kind";
import { normVendor, shownOf } from "@/services/accounting/drafts";
import { signedTotal } from "@/services/accounting/lines";
import type { DraftLevel, LedgerDraft, DraftDocRole } from "@/services/accounting/contracts";

/** The drafts on top of the ledger (D445, `0286`).
 *
 *  Every document from Chat that is still undecided, grouped into one row
 *  per transaction by `buildDrafts`: the nota, its payment proof and the
 *  photo of the goods that were sent apart, booked together. A row is ticked
 *  (✓ — it becomes a ledger row, with every document on it) or crossed (✕ —
 *  not ours, not a transaction, or grouped wrongly; nothing is deleted).
 *  The amount and the account can be changed before ticking; everything
 *  else is in the row's detail.
 *
 *  **Drafts are not in any balance.** They sit apart from the rows below,
 *  and the cash position only says what a balance *would* be (review §1).
 *  Colour is never the only signal: every row says its level in words and
 *  lists its reasons (review, the four levels). */

const LEVEL: Record<DraftLevel, { en: string; id: string; row: string; stripe: string; text: string; dot: string }> = {
  hi:    { en: "Sure",  id: "Yakin",    row: "bg-emerald-50/60", stripe: "border-l-emerald-500", text: "text-emerald-700", dot: "bg-emerald-500" },
  mid:   { en: "Check", id: "Periksa",  row: "bg-amber-50/70",   stripe: "border-l-amber-500",   text: "text-amber-700",   dot: "bg-amber-500" },
  lo:    { en: "Doubt", id: "Ragu",     row: "bg-rose-50/60",    stripe: "border-l-rose-500",    text: "text-rose-700",    dot: "bg-rose-500" },
  loose: { en: "Loose", id: "Lepas",    row: "bg-slate-50",      stripe: "border-l-slate-400 border-dashed", text: "text-slate-500", dot: "bg-slate-400" },
};

const ROLE: Record<DraftDocRole, { en: string; id: string }> = {
  payment: { en: "Payment proof", id: "Bukti bayar" },
  nota:    { en: "Nota", id: "Nota" },
  photo:   { en: "Goods photo", id: "Foto barang" },
  other:   { en: "Document", id: "Dokumen" },
};

interface Edit {
  amount: number;
  account_id: string;
  to_account_id: string;
  fee: number;
  trx_date: string;
  type_code: string;
  vendor_id: string;
  project_id: string;
  description: string;
  link_trx_no: string;
  line_no: string;
}

export function DraftBand({
  drafts, onChanged, onOpenTrx,
}: {
  drafts: LedgerDraft[];
  onChanged: () => void;
  onOpenTrx: (trxNo: string) => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const { hasAuthority } = useSession();
  const mayDecide = hasAuthority("post_ledger") && hasAuthority("resolve_inbox");
  const [accounts] = useLoad(() => accounting.listAccountRows(), []);
  const [vendors] = useLoad(() => procurement.listVendors({}), []);
  const [types] = useLoad(() => accounting.listTypeRows(), []);
  const [open, setOpen] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, Partial<Edit>>>({});
  const { shown, pager, showAll } = usePaged(drafts, 25, tr("drafts", "draft"));

  const accountRows = accounts.status === "ready" ? accounts.data.filter((a) => a.is_active !== false) : [];
  const vendorRows = vendors.status === "ready" ? vendors.data : [];
  const typeRows = types.status === "ready" ? types.data : [];
  const idOfAccount = (code: string | null) => (code ? accountRows.find((a) => a.code.toLowerCase() === code.toLowerCase())?.id ?? "" : "");

  /* What the row would book, before and after the person's changes. */
  function valueOf(d: LedgerDraft): Edit {
    const e = edits[d.key] ?? {};
    const vendorGuess = d.vendor_name
      ? vendorRows.find((v) => normVendor(v.name) === normVendor(d.vendor_name))?.id ?? "" : "";
    const type = d.type_code && typeRows.some((t) => t.code === d.type_code) ? d.type_code : "SUPPLIERS";
    return {
      amount: e.amount ?? d.amount ?? 0,
      account_id: e.account_id ?? idOfAccount(d.account_code),
      to_account_id: e.to_account_id ?? idOfAccount(d.to_account_code),
      fee: e.fee ?? d.fee ?? 0,
      trx_date: e.trx_date ?? d.trx_date,
      type_code: e.type_code ?? type,
      vendor_id: e.vendor_id ?? vendorGuess,
      project_id: e.project_id ?? "",
      description: e.description ?? d.description,
      link_trx_no: e.link_trx_no ?? d.link_trx_no ?? "",
      line_no: e.line_no ?? d.pay_line_no ?? "",
    };
  }
  const set = (key: string, patch: Partial<Edit>) => setEdits((m) => ({ ...m, [key]: { ...m[key], ...patch } }));

  /* Why ✓ is locked, in words, or null when it is not. */
  function lockOf(d: LedgerDraft, v: Edit): string | null {
    if (d.road === "link") {
      return v.link_trx_no.trim() ? null
        : d.level === "loose" ? tr("A loose document: add it to a row (in its detail) or cross it", "Dokumen lepas: tempelkan ke transaksi (di rinciannya) atau silang")
          : tr("Say which row these documents prove", "Isi transaksi yang dibuktikan dokumen ini");
    }
    if (!(v.amount > 0)) return tr("Type the amount first", "Isi nilainya dulu");
    if (!v.account_id) return tr("Pick the account first", "Pilih rekening dulu");
    if (d.road === "transfer" && (!v.to_account_id || v.to_account_id === v.account_id)) return tr("Pick the other account", "Pilih rekening tujuan");
    if (d.road === "pay_line" && !v.line_no.trim()) return tr("Say which request line it pays", "Isi baris permintaan yang dibayar");
    const purchase = typeRows.find((t) => t.code === v.type_code)?.is_purchase ?? false;
    if (d.road === "transaction" && purchase && !v.vendor_id) return tr("A purchase needs its vendor — pick it in the detail", "Pembelian perlu vendor — pilih di rinciannya");
    return null;
  }

  async function confirm(d: LedgerDraft) {
    const v = valueOf(d);
    const linesFit = d.lines.length > 0 && signedTotal(d.lines) === v.amount;
    setBusy(d.key);
    const res = await accounting.confirmDraft({
      key: d.key,
      docs: d.docs.map((x) => x.ref_ids),
      road: d.road,
      account_id: v.account_id || null,
      to_account_id: v.to_account_id || null,
      amount: v.amount,
      trx_date: v.trx_date,
      direction: d.direction,
      type_code: v.type_code,
      description: v.description,
      vendor_id: v.vendor_id || null,
      project_id: v.project_id || null,
      lines: d.road === "transaction" && linesFit ? d.lines : [],
      remark: d.partial_of ? tr(`Part of a nota of ${formatIDR(d.partial_of)}`, `Sebagian dari nota ${formatIDR(d.partial_of)}`)
        : d.amount !== null && v.amount !== d.amount ? tr(`Amount changed from ${formatIDR(d.amount)} before confirming`, `Nilai diubah dari ${formatIDR(d.amount)} sebelum dikonfirmasi`)
          : null,
      fee: d.road === "transfer" ? v.fee || null : null,
      line_no: d.road === "pay_line" ? v.line_no : null,
      link_trx_no: d.road === "link" ? v.link_trx_no.trim() : null,
      shown: shownOf(d),
    }, `confirm-draft-${d.key}-${Date.now()}`);
    setBusy(null);
    if (res.error) { toast("warning", tr("Not booked", "Tidak dibukukan"), res.error.message); return; }
    toast("success",
      d.road === "link" ? tr(`Filed on ${res.data.trx_no}`, `Ditautkan ke ${res.data.trx_no}`) : tr(`Booked as ${res.data.trx_no}`, `Dibukukan sebagai ${res.data.trx_no}`),
      tr(`${res.data.documents} document(s) on the row.`, `${res.data.documents} dokumen di baris itu.`));
    setEdits((m) => { const n = { ...m }; delete n[d.key]; return n; });
    setOpen(null);
    onChanged();
    onOpenTrx(res.data.trx_no);
  }

  async function dismiss(d: LedgerDraft, road: "reject" | "note", reason: string) {
    setBusy(d.key);
    const res = await accounting.dismissDraft({ key: d.key, docs: d.docs.map((x) => x.ref_ids), road, reason, shown: shownOf(d) },
      `dismiss-draft-${d.key}-${Date.now()}`);
    setBusy(null);
    if (res.error) { toast("warning", tr("Not recorded", "Tidak dicatat"), res.error.message); return; }
    toast("success", road === "note" ? tr("Kept as a note", "Disimpan sebagai catatan") : tr("Rejected, and kept", "Ditolak, dan disimpan"),
      tr("No money was recorded. The documents stay on file.", "Tidak ada uang yang dicatat. Dokumennya tetap tersimpan."));
    setMenu(null);
    onChanged();
  }

  async function split(d: LedgerDraft, detach: number | null) {
    setBusy(d.key);
    const res = await accounting.splitDraft({ key: d.key, docs: d.docs.map((x) => x.ref_ids), detach, shown: shownOf(d) });
    setBusy(null);
    if (res.error) { toast("warning", tr("Not changed", "Tidak berubah"), res.error.message); return; }
    toast("success",
      detach === null ? tr("Taken apart", "Dilepas") : tr("Taken out of the draft", "Dikeluarkan dari draft"),
      tr("They will not be grouped together again.", "Tidak akan dikelompokkan bersama lagi."));
    setMenu(null);
    onChanged();
  }

  const counts = (["hi", "mid", "lo", "loose"] as DraftLevel[]).map((l) => [l, drafts.filter((d) => d.level === l).length] as const);

  return (
    <Card className="mb-4" data-testid="draft-band">
      <CardHeader
        title={tr(`Drafts from chat · ${drafts.length} waiting`, `Draft dari dokumen chat · ${drafts.length} menunggu`)}
        subtitle={tr("Grouped automatically, one row per transaction. Not in any balance until ticked. Click a row for its documents and why they were grouped.",
          "Dikelompokkan otomatis, satu baris per transaksi. Tidak masuk saldo sebelum dicentang. Klik baris untuk melihat dokumen dan alasan pengelompokannya.")}
        icon={FileStack}
        action={
          <div className="flex flex-wrap gap-1.5">
            {counts.map(([l, n]) => (
              <span key={l} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
                <span className={cn("h-2 w-2 rounded-full", LEVEL[l].dot)} />{tr(LEVEL[l].en, LEVEL[l].id)} <span className="tabular-nums text-slate-400">{n}</span>
              </span>
            ))}
          </div>
        }
      />
      {drafts.length === 0 ? (
        <p className="px-4 py-6 text-[13px] text-slate-500">
          {tr("No drafts. Documents sent to the accounting chat appear here, grouped into transactions.",
            "Tidak ada draft. Dokumen yang dikirim ke chat accounting muncul di sini, dikelompokkan per transaksi.")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <ExcelTable name={tr("Ledger drafts", "Draft buku besar")} showAll={showAll} barClassName="px-4 pt-2"
            className="w-full min-w-[980px] text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 font-semibold">{tr("Confidence", "Keyakinan")}</th>
                <th className="px-3 py-2 font-semibold">{tr("Date", "Tanggal")}</th>
                <th className="px-3 py-2 font-semibold">{tr("Description", "Deskripsi")}</th>
                <th className="px-3 py-2 font-semibold">{tr("Account", "Rekening")}</th>
                <th className="px-3 py-2 font-semibold">{tr("Documents", "Dokumen")}</th>
                <th className="px-3 py-2 text-right font-semibold">{tr("Amount", "Jumlah")}</th>
                <th className="px-3 py-2 font-semibold">{tr("Status", "Status")}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => {
                const v = valueOf(d);
                const lock = lockOf(d, v);
                const lv = LEVEL[d.level];
                const isOpen = open === d.key;
                const firstReason = d.reasons.find((r) => r.tone === "bad") ?? d.reasons.find((r) => r.tone === "check") ?? d.reasons[0];
                return [
                  <tr key={d.key} data-testid={`draft-${d.label}`} className={cn("border-b border-slate-100 align-top", lv.row)}>
                    <td className={cn("border-l-4 px-3 py-2.5 whitespace-nowrap", lv.stripe)}>
                      <span className={cn("inline-flex items-center gap-1.5 text-[12px] font-semibold", lv.text)}>
                        <span className={cn("h-2 w-2 rounded-full", lv.dot)} />
                        {tr(lv.en, lv.id)}{d.score !== null && <span className="tabular-nums font-normal">· {d.score}%</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums text-slate-600">{d.trx_date.slice(8, 10)}/{d.trx_date.slice(5, 7)}</td>
                    <td className="px-3 py-2.5">
                      <button type="button" onClick={() => setOpen(isOpen ? null : d.key)} aria-expanded={isOpen}
                        className="flex items-start gap-1 text-left" data-testid={`draft-open-${d.label}`}>
                        <ChevronRight className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform motion-reduce:transition-none", isOpen && "rotate-90")} />
                        <span>
                          <span className="font-semibold text-slate-800">{d.vendor_name ?? (d.road === "transfer" ? tr("Move between accounts", "Pindah dana") : d.description)}</span>
                          <RoadTag d={d} tr={tr} />
                          <span className="block text-[11px] text-slate-500">
                            <span className="font-mono">{d.label}</span>
                            {d.vendor_name && d.description !== d.vendor_name.toUpperCase() && <> · {d.description.replace(`${d.vendor_name.toUpperCase()} — `, "")}</>}
                          </span>
                          {firstReason && (
                            <span className={cn("block text-[12px]", firstReason.tone === "bad" ? "text-rose-700" : firstReason.tone === "check" ? "text-amber-700" : "text-emerald-700")}>
                              {tr(firstReason.en, firstReason.id)}
                            </span>
                          )}
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-2.5">
                      {d.road === "link" ? (
                        <span className="text-[12px] text-slate-400">—</span>
                      ) : (
                        <>
                          <select id={`draft-acct-${d.key}`} aria-label={tr("Account", "Rekening")} disabled={!mayDecide}
                            value={v.account_id} onChange={(e) => set(d.key, { account_id: e.target.value })}
                            className={cn("rounded-md border bg-white px-1.5 py-1 text-[12px]", v.account_id ? "border-slate-200" : "border-rose-300")}>
                            <option value="">{tr("pick…", "pilih…")}</option>
                            {accountRows.map((a) => <option key={a.id} value={a.id}>{a.code}</option>)}
                          </select>
                          {d.road === "transfer" && (
                            <span className="mt-1 block text-[11px] text-slate-500">→ {accountRows.find((a) => a.id === v.to_account_id)?.code ?? "?"}</span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {d.docs.map((x) => (
                          <span key={x.key} className="whitespace-nowrap rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-600 ring-1 ring-slate-200">{tr(ROLE[x.role].en, ROLE[x.role].id)}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {d.road === "link" ? (
                        <span className="tabular-nums text-slate-500">{d.amount !== null ? formatIDR(d.amount) : "—"}</span>
                      ) : (
                        <>
                          <MoneyInput id={`draft-amt-${d.key}`} size="sm" value={v.amount} disabled={!mayDecide}
                            onChange={(n) => set(d.key, { amount: n })} className="ml-auto w-32 text-right" />
                          {d.amount !== null && v.amount !== d.amount && (
                            <span className="mt-0.5 block text-[11px] text-amber-700">{tr(`was ${formatIDR(d.amount)}`, `diubah dari ${formatIDR(d.amount)}`)}</span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="rounded-full border border-dashed border-slate-400 bg-white px-2 py-0.5 text-[10px] font-semibold tracking-wide text-slate-500">DRAFT</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {mayDecide && (
                        <div className="flex justify-end gap-1.5">
                          <button type="button" data-testid={`draft-ok-${d.label}`}
                            disabled={!!lock || busy === d.key} onClick={() => confirm(d)}
                            title={lock ?? tr("Confirm: book it", "Konfirmasi: bukukan")} aria-label={lock ?? tr("Confirm", "Konfirmasi")}
                            className="grid h-8 w-8 place-items-center rounded-lg border border-emerald-500 bg-white text-emerald-700 transition-colors hover:bg-emerald-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-white disabled:hover:text-emerald-700">
                            <Check className="h-4 w-4" />
                          </button>
                          <button type="button" data-testid={`draft-no-${d.label}`}
                            disabled={busy === d.key} onClick={() => setMenu(menu === d.key ? null : d.key)}
                            title={tr("Cancel this draft", "Batalkan draft")} aria-label={tr("Cancel this draft", "Batalkan draft")} aria-expanded={menu === d.key}
                            className="grid h-8 w-8 place-items-center rounded-lg border border-rose-400 bg-white text-rose-600 transition-colors hover:bg-rose-600 hover:text-white">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                      {menu === d.key && (
                        <DismissMenu d={d} tr={tr} busy={busy === d.key}
                          onDismiss={(road, reason) => dismiss(d, road, reason)}
                          onSplit={() => split(d, null)} onClose={() => setMenu(null)} />
                      )}
                    </td>
                  </tr>,
                  isOpen && (
                    <tr key={`${d.key}-detail`} data-no-export className="border-b border-slate-200 bg-white">
                      <td colSpan={8} className="px-4 py-4">
                        <DraftDetail d={d} v={v} tr={tr} mayDecide={mayDecide} busy={busy === d.key}
                          accountRows={accountRows} vendorRows={vendorRows}
                          onSet={(p) => set(d.key, p)} onDetach={(i) => split(d, i)} />
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </ExcelTable>
        </div>
      )}
      {pager}
    </Card>
  );
}

function RoadTag({ d, tr }: { d: LedgerDraft; tr: Tr }) {
  const tag = d.road === "transfer" ? { icon: ArrowLeftRight, t: tr("move between accounts", "pindah dana") }
    : d.road === "pay_line" ? { icon: BadgeCheck, t: tr(`pays ${d.pay_line_no}`, `bayar ${d.pay_line_no}`) }
      : d.road === "link" && d.link_trx_no ? { icon: Link2, t: tr(`proof of ${d.link_trx_no}`, `bukti ${d.link_trx_no}`) }
        : null;
  if (!tag) return null;
  const Icon = tag.icon;
  return (
    <span className="ml-1.5 inline-flex items-center gap-1 rounded bg-white px-1.5 py-0.5 align-middle text-[10px] font-medium text-brand-700 ring-1 ring-brand-200">
      <Icon className="h-3 w-3" />{tag.t}
    </span>
  );
}

function DismissMenu({
  d, tr, busy, onDismiss, onSplit, onClose,
}: {
  d: LedgerDraft; tr: Tr; busy: boolean;
  onDismiss: (road: "reject" | "note", reason: string) => void;
  onSplit: () => void;
  onClose: () => void;
}) {
  const [road, setRoad] = useState<"reject" | "note" | null>(null);
  const [reason, setReason] = useState("");
  return (
    <div role="menu" className="mt-2 ml-auto grid w-72 gap-1.5 rounded-lg border border-rose-200 bg-white p-2.5 text-left shadow-card" data-testid={`draft-menu-${d.label}`}>
      {road === null ? (
        <>
          <button type="button" onClick={() => setRoad("reject")} className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left text-[12px] hover:border-rose-300">
            {tr("Not ours — reject", "Bukan milik kita — tolak")}
            <span className="block text-[11px] text-slate-500">{tr("kept on file with the reason", "dokumen disimpan dengan alasannya")}</span>
          </button>
          <button type="button" onClick={() => setRoad("note")} className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left text-[12px] hover:border-rose-300">
            {tr("Not a transaction — keep as a note", "Bukan transaksi — simpan sebagai catatan")}
            <span className="block text-[11px] text-slate-500">{tr("e.g. a balance screenshot", "mis. tangkapan saldo rekening")}</span>
          </button>
          {d.docs.length > 1 && (
            <button type="button" disabled={busy} onClick={onSplit} data-testid={`draft-split-${d.label}`}
              className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left text-[12px] hover:border-rose-300">
              <Scissors className="mr-1 inline h-3.5 w-3.5" />{tr("Grouped wrongly — take the documents apart", "Pengelompokan salah — lepas dokumennya")}
              <span className="block text-[11px] text-slate-500">{tr("each goes back to waiting on its own", "tiap dokumen kembali menunggu sendiri")}</span>
            </button>
          )}
          <button type="button" onClick={onClose} className="px-2.5 py-1 text-left text-[12px] text-slate-500">{tr("Back", "Kembali")}</button>
        </>
      ) : (
        <>
          <label htmlFor={`dismiss-reason-${d.key}`} className="text-[12px] font-medium text-slate-700">
            {road === "reject" ? tr("Why is it not ours?", "Kenapa bukan milik kita?") : tr("What is it?", "Dokumen apa ini?")}
          </label>
          <textarea id={`dismiss-reason-${d.key}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
            className="rounded-md border border-slate-200 px-2 py-1 text-[12px]" />
          <div className="flex gap-1.5">
            <Button size="sm" variant="danger" disabled={busy || !reason.trim()} onClick={() => onDismiss(road, reason)}>
              {road === "reject" ? tr("Reject", "Tolak") : tr("Keep as note", "Simpan catatan")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRoad(null)}>{tr("Back", "Kembali")}</Button>
          </div>
        </>
      )}
    </div>
  );
}

function DraftDetail({
  d, v, tr, mayDecide, busy, accountRows, vendorRows, onSet, onDetach,
}: {
  d: LedgerDraft; v: Edit; tr: Tr; mayDecide: boolean; busy: boolean;
  accountRows: { id: string; code: string }[];
  vendorRows: { id: string; name: string }[];
  onSet: (p: Partial<Edit>) => void;
  onDetach: (index: number) => void;
}) {
  const ids = d.docs.map((x) => x.attachment_id);
  const [files] = useLoad(() => documents.getAttachments(ids), [ids.join(",")]);
  const [projects] = useLoad(() => procurement.listProjects(), []);
  const fileOf = (id: string) => (files.status === "ready" ? files.data.find((f) => f.id === id) : undefined);
  const linesTotal = signedTotal(d.lines);
  const input = "w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[13px]";

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]" data-testid={`draft-detail-${d.label}`}>
      <div className="grid min-w-0 gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{tr("Documents in this draft", "Dokumen dalam draft ini")}</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {d.docs.map((x, i) => {
            const f = fileOf(x.attachment_id);
            return (
              <div key={x.key} className="grid min-w-0 gap-1.5 rounded-lg border border-slate-200 p-2">
                {f ? (
                  <DocumentPreview height={150} doc={{
                    id: f.id, filename: f.filename, mime: f.mime, bytes: f.bytes,
                    url: f.url, drive_link: f.url ? null : driveOpenUrl(f), uploaded_at: f.uploaded_at, kind: f.links[0]?.kind ?? null,
                    read: { ...x.rows[0].extracted, amount_idr: x.amount, vendor_name: x.vendor_name, document_date: x.document_date },
                  }} />
                ) : <div className="h-[150px] animate-pulse rounded bg-slate-100" />}
                <p className="text-[12px] font-semibold text-slate-700">{tr(ROLE[x.role].en, ROLE[x.role].id)}
                  {x.amount !== null && <span className="ml-1 font-normal tabular-nums text-slate-500">{formatIDR(x.amount)}</span>}</p>
                <p className="text-[11px] text-slate-500">{x.vendor_name ?? "—"} · {x.reported_by_name ?? "?"} · {x.reported_at.slice(8, 10)}/{x.reported_at.slice(5, 7)} {x.reported_at.slice(11, 16)}</p>
                {mayDecide && d.docs.length > 1 && (
                  <button type="button" disabled={busy} onClick={() => onDetach(i)} data-testid={`draft-detach-${d.label}-${i}`}
                    className="justify-self-start text-[11px] font-semibold text-brand-700 underline underline-offset-2 disabled:opacity-50">
                    {tr("Take out of this draft", "Keluarkan dari draft")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {d.lines.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{tr("Lines read from the nota", "Baris a/b dari nota")}</p>
            <table className="w-full text-[12px]">
              <tbody>
                {d.lines.map((l, i) => (
                  <tr key={i} className="border-b border-dashed border-slate-200">
                    <td className="py-1 pr-2 font-mono text-[11px] text-brand-700">{String.fromCharCode(97 + i)}</td>
                    <td className="py-1 pr-2"><LineKindBadge kind={l.kind} /></td>
                    <td className="py-1 pr-2 text-slate-700">{l.description}</td>
                    <td className="py-1 text-right tabular-nums">{l.kind === "discount" ? "−" : ""}{formatIDR(l.amount)}</td>
                  </tr>
                ))}
                <tr><td colSpan={3} className="py-1 text-slate-500">Σ</td><td className="py-1 text-right font-semibold tabular-nums">{formatIDR(linesTotal)}</td></tr>
              </tbody>
            </table>
            {linesTotal !== v.amount && (
              <p className="mt-1 text-[12px] text-amber-700">
                {tr("The lines no longer add up to the amount, so the row is booked without them; add the detail from the row's drawer afterwards.",
                  "Baris tidak lagi sama dengan jumlahnya, jadi dibukukan tanpa rincian; rincian bisa ditambah dari drawer barisnya sesudahnya.")}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="grid min-w-0 content-start gap-4">
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {tr("Why it was grouped this way", "Kenapa dikelompokkan begini")}{d.score !== null && ` · ${d.score}%`}
          </p>
          <ul className="grid gap-1 text-[12.5px]">
            {d.reasons.map((r, i) => (
              <li key={i} className="grid grid-cols-[16px_1fr] gap-1.5">
                <span className={cn("font-bold", r.tone === "ok" ? "text-emerald-600" : r.tone === "check" ? "text-amber-600" : "text-rose-600")}>
                  {r.tone === "ok" ? "✓" : r.tone === "check" ? "!" : "✕"}
                </span>
                <span className="text-slate-700">{tr(r.en, r.id)}</span>
              </li>
            ))}
          </ul>
        </div>

        {mayDecide && (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {d.road === "link" ? (
              <label className="grid gap-1 text-[12px] text-slate-600 sm:col-span-2">
                {tr("The ledger row these documents prove", "Transaksi yang dibuktikan dokumen ini")}
                <input id={`draft-link-${d.key}`} value={v.link_trx_no} placeholder="trx-26-10-18_002"
                  onChange={(e) => onSet({ link_trx_no: e.target.value })} className={cn(input, "font-mono")} />
              </label>
            ) : (
              <>
                <label className="grid gap-1 text-[12px] text-slate-600">
                  {tr("Date", "Tanggal")}
                  <input id={`draft-date-${d.key}`} type="date" value={v.trx_date} onChange={(e) => onSet({ trx_date: e.target.value })} className={input} />
                </label>
                {d.road === "transfer" ? (
                  <>
                    <label className="grid gap-1 text-[12px] text-slate-600">
                      {tr("To account", "Rekening tujuan")}
                      <select id={`draft-to-${d.key}`} value={v.to_account_id} onChange={(e) => onSet({ to_account_id: e.target.value })} className={input}>
                        <option value="">{tr("pick…", "pilih…")}</option>
                        {accountRows.map((a) => <option key={a.id} value={a.id}>{a.code}</option>)}
                      </select>
                    </label>
                    <label className="grid gap-1 text-[12px] text-slate-600">
                      {tr("Bank fee", "Biaya bank")}
                      <MoneyInput id={`draft-fee-${d.key}`} size="sm" value={v.fee} onChange={(n) => onSet({ fee: n })} />
                    </label>
                  </>
                ) : (
                  <>
                    {d.road === "pay_line" ? (
                      <label className="grid gap-1 text-[12px] text-slate-600">
                        {tr("Request line it pays", "Baris permintaan yang dibayar")}
                        <input id={`draft-line-${d.key}`} value={v.line_no} onChange={(e) => onSet({ line_no: e.target.value })} className={cn(input, "font-mono")} />
                      </label>
                    ) : (
                      <label className="grid gap-1 text-[12px] text-slate-600">
                        {tr("Type", "Jenis")}
                        <select id={`draft-type-${d.key}`} value={v.type_code} onChange={(e) => onSet({ type_code: e.target.value })} className={input}>
                          <TypeOptions current={v.type_code} />
                        </select>
                      </label>
                    )}
                    {d.road === "transaction" && (
                      <>
                        <label className="grid gap-1 text-[12px] text-slate-600">
                          {tr("Vendor", "Vendor")}{d.vendor_name && <span className="text-[11px] text-slate-400">{tr(`read: ${d.vendor_name}`, `terbaca: ${d.vendor_name}`)}</span>}
                          <select id={`draft-vendor-${d.key}`} value={v.vendor_id} onChange={(e) => onSet({ vendor_id: e.target.value })}
                            className={cn(input, !v.vendor_id && "border-amber-300")}>
                            <option value="">{tr("none", "tidak ada")}</option>
                            {vendorRows.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </select>
                        </label>
                        <label className="grid gap-1 text-[12px] text-slate-600">
                          {tr("Project", "Proyek")}
                          <select id={`draft-project-${d.key}`} value={v.project_id} onChange={(e) => onSet({ project_id: e.target.value })} className={input}>
                            <option value="">{tr("none", "tidak ada")}</option>
                            {projects.status === "ready" && projects.data.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                          </select>
                        </label>
                      </>
                    )}
                  </>
                )}
                <label className="grid gap-1 text-[12px] text-slate-600 sm:col-span-2">
                  {tr("Description", "Deskripsi")}
                  <input id={`draft-desc-${d.key}`} value={v.description} onChange={(e) => onSet({ description: e.target.value })} className={input} />
                </label>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
