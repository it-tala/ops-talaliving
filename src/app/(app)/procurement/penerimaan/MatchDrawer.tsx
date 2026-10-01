"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Banknote, Plus, Receipt as ReceiptIcon, Search, Trash2, Truck } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/drawer";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { NumberInput } from "@/components/ui/number-input";
import { MoneyInput } from "@/components/ui/money-input";
import { ImageTiles } from "@/components/ui/image-tiles";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { inventory, procurement } from "@/demo/api";
import {
  RECEIPT_CONDITIONS,
  type Item, type ReceiptCondition, type ReceivingInboxRow, type ReceivingLineInput,
  type ReceivingMatchResult,
} from "@/services/procurement/contracts";
import type { AssetCategory } from "@/services/inventory/contracts";
import { useToast } from "@/store/toast";
import { useTr, type Tr } from "@/lib/i18n";

/** What each file of the message is. A tanda terima only means something
 *  against an order; against money already paid the signed sheet is the
 *  ledger's *Receiving Report*. */
type Role = "photo" | "report" | "note" | "skip";

interface LineDraft {
  key: number;
  kind: "material" | "asset";
  /** What the AI read, kept beside the pick so the person sees what to look for. */
  read: string;
  item_code: string;
  item_name: string;
  qty: number;
  name: string;
  category_code: string;
  count: number;
  unit_cost: number;
}

let seq = 0;
const blankLine = (read = "", qty = 0): LineDraft => ({
  key: ++seq, kind: "material", read, item_code: "", item_name: "", qty,
  name: read, category_code: "", count: 1, unit_cost: 0,
});

/** Match one Chat message to what it was (0203, D358). */
export function MatchDrawer({ row, onClose, onMatched }: {
  row: ReceivingInboxRow; onClose: () => void; onMatched: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [mode, setMode] = useState<"trx" | "po">(row.extracted?.po_number ? "po" : "trx");
  const [roles, setRoles] = useState<Record<string, Role>>(
    () => Object.fromEntries(row.files.map((f) => [f.attachment_id, "photo" as Role])),
  );
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<string | null>(null);
  const [cands, reloadCands] = useLoad(() => procurement.receivingCandidates(row.rr_no, search), [row.rr_no, search]);
  const [trxNo, setTrxNo] = useState("");
  const [poNo, setPoNo] = useState("");
  const [poQty, setPoQty] = useState<Record<string, number>>({});
  const [poCond, setPoCond] = useState<Record<string, ReceiptCondition>>({});
  const [lines, setLines] = useState<LineDraft[]>(
    () => (row.extracted?.lines ?? []).filter((l) => l.item).map((l) => blankLine(l.item ?? "", l.received_qty ?? 0)),
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<ReceivingMatchResult | null>(null);

  const of = (r: Role) => row.files.filter((f) => roles[f.attachment_id] === r).map((f) => f.attachment_id);
  const photos = of("photo");

  /* Against money already paid there is no tanda terima road: a file marked so
     goes back to being the receiving report. */
  useEffect(() => {
    if (mode !== "trx") return;
    setRoles((cur) => Object.fromEntries(Object.entries(cur).map(([k, v]) => [k, v === "note" ? "report" : v])));
  }, [mode]);

  async function submit() {
    setBusy(true);
    const res = mode === "trx"
      ? await procurement.matchReceivingToTrx({
        rr_no: row.rr_no, trx_no: trxNo, photos, reports: of("report"),
        lines: lines.map((l): ReceivingLineInput => l.kind === "material"
          ? { kind: "material", item_code: l.item_code, qty: l.qty }
          : { kind: "asset", name: l.name, category_code: l.category_code, count: l.count, unit_cost: l.unit_cost || null }),
        note: note || null,
      })
      : await procurement.matchReceivingToPo({
        rr_no: row.rr_no, po_no: poNo, photos, notes: of("note"), reports: of("report"),
        lines: Object.entries(poQty).filter(([, q]) => q > 0)
          .map(([po_line_id, qty]) => ({ po_line_id, qty, condition: poCond[po_line_id] ?? "GOOD" })),
        note: note || null,
      });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not matched", "Belum dicocokkan"), res.error.message);
      return;
    }
    toast("success", tr(`${row.rr_no} matched`, `${row.rr_no} dicocokkan`),
      res.data.matched_to === "po" ? res.data.po_no ?? "" : res.data.trx_no ?? "");
    onMatched();
    if (res.data.matched_to === "po") setDone(res.data);
    else onClose();
  }

  const poQtyTotal = Object.values(poQty).reduce((s, q) => s + (q > 0 ? q : 0), 0);
  const ready = photos.length > 0 && (mode === "trx"
    ? !!trxNo && lines.every((l) => l.kind === "material" ? !!l.item_code && l.qty > 0 : !!l.name.trim() && !!l.category_code && l.count >= 1)
    : !!poNo && poQtyTotal > 0);

  return (
    <Drawer
      open onClose={onClose} width="max-w-2xl"
      title={tr(`Match ${row.rr_no}`, `Cocokkan ${row.rr_no}`)}
      subtitle={row.message ?? undefined}
      footer={done ? undefined : (
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-slate-500">
            {photos.length === 0
              ? tr("Mark at least one photo of the goods.", "Tandai minimal satu foto barang.")
              : mode === "po" && of("note").length === 0
                ? tr("Without the tanda terima it is recorded as reported, not yet counted.", "Tanpa tanda terima tercatat sebagai dilaporkan, belum terhitung.")
                : ""}
          </span>
          <Button className="ml-auto" disabled={!ready || busy} onClick={submit}>
            {busy ? tr("Saving…", "Menyimpan…") : tr("Match", "Cocokkan")}
          </Button>
        </div>
      )}
    >
      {done ? (
        <AfterPo result={done} onClose={onClose} />
      ) : (
        <div className="space-y-5">
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{tr("The files", "File-nya")}</h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {row.files.map((f) => (
                <li key={f.attachment_id} className="flex gap-2 rounded-lg border border-slate-200 p-2">
                  <ImageTiles className="w-20 shrink-0" files={[{ id: f.attachment_id, filename: f.filename, mime: f.mime, url: f.url }]} />
                  <div className="flex flex-wrap content-start gap-1">
                    {roleOptions(tr, mode).map(([r, label]) => (
                      <button
                        key={r} type="button"
                        onClick={() => setRoles((cur) => ({ ...cur, [f.attachment_id]: r }))}
                        className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                          roles[f.attachment_id] === r ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50")}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <div className="mb-2 flex gap-1">
              {([["trx", tr("Bought & paid (transaction)", "Dibeli & dibayar (transaksi)"), ReceiptIcon],
                 ["po", tr("Against a purchase order", "Dari Purchase Order"), Truck]] as const).map(([m, label, Icon]) => (
                <button
                  key={m} type="button" onClick={() => setMode(m)}
                  className={cn("inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium",
                    mode === m ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")}
                >
                  <Icon className="h-3.5 w-3.5" />{label}
                </button>
              ))}
            </div>
            <form
              className="mb-2 flex gap-2"
              onSubmit={(e) => { e.preventDefault(); setSearch(query.trim() || null); }}
            >
              <input
                value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={mode === "trx"
                  ? tr("Search all dates: trx no., description, vendor", "Cari semua tanggal: no. trx, deskripsi, vendor")
                  : tr("Search PO no. or vendor", "Cari no. PO atau vendor")}
                className="h-8 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
              />
              <Button size="sm" variant="outline" icon={Search} type="submit">{tr("Search", "Cari")}</Button>
            </form>
            <Loaded state={cands} onRetry={reloadCands}>
              {(c) => mode === "trx" ? (
                c.transactions.length === 0 ? (
                  <p className="text-[12px] text-slate-500">{tr("No purchase near that date. Search by name.", "Tidak ada pembelian di sekitar tanggal itu. Cari dengan nama.")}</p>
                ) : (
                  <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                    {c.transactions.map((t) => (
                      <li key={t.trx_no}>
                        <label className={cn("flex cursor-pointer items-start gap-2 px-3 py-2 text-[12px]", trxNo === t.trx_no && "bg-brand-50")}>
                          <input type="radio" name="trx" className="mt-0.5" checked={trxNo === t.trx_no} onChange={() => setTrxNo(t.trx_no)} />
                          <span className="min-w-0 flex-1">
                            <span className="font-medium text-slate-800">{t.description}</span>
                            <span className="block text-slate-500">
                              <span className="font-mono">{t.trx_no}</span> · {t.trx_date} · {t.account_code}
                              {t.vendor_name && <> · {t.vendor_name}</>}
                            </span>
                          </span>
                          <span className="text-right">
                            <span className="block font-semibold tabular-nums">{formatIDR(t.amount_idr)}</span>
                            {t.vendor_hit && <Badge tone="violet">{tr("vendor matches", "vendor cocok")}</Badge>}
                            {t.has_item_photo && <Badge tone="slate">{tr("has photo", "sudah ada foto")}</Badge>}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                c.orders.length === 0 ? (
                  <p className="text-[12px] text-slate-500">{tr("No issued order is waiting for goods.", "Tidak ada PO terbit yang menunggu barang.")}</p>
                ) : (
                  <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                    {c.orders.map((o) => (
                      <li key={o.po_no} className={cn(poNo === o.po_no && "bg-brand-50")}>
                        <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[12px]">
                          <input type="radio" name="po" checked={poNo === o.po_no}
                            onChange={() => { setPoNo(o.po_no); setPoQty({}); setPoCond({}); }} />
                          <span className="font-mono">{o.po_no}</span>
                          <span className="flex-1 font-medium text-slate-800">{o.vendor_name}</span>
                          {o.po_hit && <Badge tone="violet">{tr("PO no. read", "no. PO terbaca")}</Badge>}
                          {o.vendor_hit && <Badge tone="violet">{tr("vendor matches", "vendor cocok")}</Badge>}
                          <Badge tone="slate">{o.delivery_state.toLowerCase()}</Badge>
                        </label>
                        {poNo === o.po_no && (
                          <table className="mx-3 mb-2 w-[calc(100%-1.5rem)] text-[12px]">
                            <thead className="text-left text-[11px] text-slate-400">
                              <tr><th className="py-1">{tr("Line", "Baris")}</th><th>{tr("Ordered / in", "Dipesan / masuk")}</th><th className="w-24">{tr("Arrived now", "Tiba sekarang")}</th><th className="w-36">{tr("Condition", "Kondisi")}</th></tr>
                            </thead>
                            <tbody>
                              {o.lines.map((l) => (
                                <tr key={l.po_line_id} className="border-t border-slate-100">
                                  <td className="py-1 pr-2">{l.line_no}. {l.description}</td>
                                  <td className="pr-2 tabular-nums text-slate-500">{formatNumber(l.qty)} / {formatNumber(l.received)} {l.uom ?? ""}</td>
                                  <td className="pr-2">
                                    <NumberInput value={poQty[l.po_line_id] ?? 0} min={0}
                                      onChange={(v) => setPoQty((cur) => ({ ...cur, [l.po_line_id]: v }))} />
                                  </td>
                                  <td>
                                    <select
                                      value={poCond[l.po_line_id] ?? "GOOD"}
                                      onChange={(e) => setPoCond((cur) => ({ ...cur, [l.po_line_id]: e.target.value as ReceiptCondition }))}
                                      className="h-8 w-full rounded-lg border border-slate-200 bg-white px-1 text-[12px]"
                                    >
                                      {RECEIPT_CONDITIONS.map((k) => <option key={k} value={k}>{k}</option>)}
                                    </select>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </li>
                    ))}
                  </ul>
                )
              )}
            </Loaded>
          </section>

          {mode === "trx" && <GoodsLines lines={lines} setLines={setLines} />}

          <section>
            <label htmlFor="rr-note" className="block text-xs text-slate-500">{tr("Note (optional)", "Catatan (opsional)")}</label>
            <input id="rr-note" value={note} onChange={(e) => setNote(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none" />
          </section>
        </div>
      )}
    </Drawer>
  );
}

function roleOptions(tr: Tr, mode: "trx" | "po"): [Role, string][] {
  return [
    ["photo", tr("Item photo", "Foto barang")],
    ...(mode === "po" ? [["note", tr("Tanda terima", "Tanda terima")] as [Role, string]] : []),
    ["report", tr("Receiving report", "Receiving report")],
    ["skip", tr("Not used", "Tidak dipakai")],
  ];
}

/** Where the goods go: a counted material onto the rack, or an asset into
 *  the register. Nothing is also an answer — a stamp, a service. */
function GoodsLines({ lines, setLines }: { lines: LineDraft[]; setLines: (f: (cur: LineDraft[]) => LineDraft[]) => void }) {
  const tr = useTr();
  const [cats] = useLoad(() => inventory.listAssetCategories(), []);
  const patch = (key: number, p: Partial<LineDraft>) => setLines((cur) => cur.map((l) => l.key === key ? { ...l, ...p } : l));
  const activeCats: AssetCategory[] = cats.status === "ready" ? cats.data.filter((c) => c.is_active) : [];

  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {tr("Into inventory", "Masuk inventory")}
      </h3>
      <p className="mb-2 text-[12px] text-slate-500">
        {tr(
          "Materials go onto the rack, assets into the register. Leave it empty for something that is not kept (a stamp, a service).",
          "Material masuk rak, aset masuk daftar aset. Kosongkan untuk barang yang tidak disimpan (meterai, jasa).",
        )}
      </p>
      <ul className="space-y-2">
        {lines.map((l) => (
          <li key={l.key} className="rounded-lg border border-slate-200 p-2">
            <div className="mb-1 flex items-center gap-2">
              {(["material", "asset"] as const).map((k) => (
                <button key={k} type="button" onClick={() => patch(l.key, { kind: k })}
                  className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
                    l.kind === k ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200")}>
                  {k === "material" ? tr("Material", "Material") : tr("Asset", "Aset")}
                </button>
              ))}
              {l.read && <span className="truncate text-[11px] text-violet-700">AI: {l.read}</span>}
              <button type="button" className="ml-auto text-slate-400 hover:text-rose-600" aria-label={tr("Remove", "Hapus")}
                onClick={() => setLines((cur) => cur.filter((x) => x.key !== l.key))}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {l.kind === "material" ? (
              <div className="grid gap-2 sm:grid-cols-[1fr_7rem]">
                <ItemPick initial={l.read} code={l.item_code} name={l.item_name}
                  onPick={(it) => patch(l.key, { item_code: it.code, item_name: `${it.name} (${it.base_uom})` })} />
                <NumberInput value={l.qty} min={0} onChange={(v) => patch(l.key, { qty: v })} />
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-[1fr_10rem_5rem_9rem]">
                <input value={l.name} onChange={(e) => patch(l.key, { name: e.target.value })}
                  placeholder={tr("Asset name", "Nama aset")}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none" />
                <select value={l.category_code} onChange={(e) => patch(l.key, { category_code: e.target.value })}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm">
                  <option value="">{tr("Category…", "Kategori…")}</option>
                  {activeCats.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                </select>
                <NumberInput value={l.count} min={1} max={50} onChange={(v) => patch(l.key, { count: v })} />
                <MoneyInput value={l.unit_cost} onChange={(v) => patch(l.key, { unit_cost: v })} placeholder={tr("Cost / unit", "Harga / unit")} />
              </div>
            )}
          </li>
        ))}
      </ul>
      <Button size="sm" variant="outline" icon={Plus} className="mt-2" onClick={() => setLines((cur) => [...cur, blankLine()])}>
        {tr("Add a line", "Tambah baris")}
      </Button>
    </section>
  );
}

/** A catalogue item by name. Only counted items can go onto the rack; the
 *  database says so by name if the one picked is not. */
function ItemPick({ initial, code, name, onPick }: {
  initial: string; code: string; name: string; onPick: (it: Item) => void;
}) {
  const tr = useTr();
  const [q, setQ] = useState(initial);
  const [hits, setHits] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2 || !open) { setHits([]); return; }
    const t = setTimeout(() => {
      void procurement.listItems({ q: term }).then((r) => setHits((r.data ?? []).filter((i) => i.kind === "goods").slice(0, 12)));
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);

  const label = useMemo(() => code ? `${code} · ${name}` : "", [code, name]);

  return (
    <div className="relative">
      <input
        value={open ? q : label || q}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => setQ(e.target.value)}
        placeholder={tr("Find the catalogue item…", "Cari item katalog…")}
        className={cn("h-9 w-full rounded-lg border bg-white px-2 text-sm focus:border-brand-400 focus:outline-none",
          code ? "border-slate-200" : "border-amber-300")}
      />
      {open && hits.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {hits.map((it) => (
            <li key={it.id}>
              <button type="button" className="block w-full px-2 py-1.5 text-left text-[12px] hover:bg-slate-50"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onPick(it); setQ(it.name); setOpen(false); }}>
                <span className="font-mono text-slate-500">{it.code}</span> {it.name}
                <span className="text-slate-400"> · {it.base_uom}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** After an order delivery: the payment it earned can be asked for now, as a
 *  request line against the order (0203). Paying that line pays the order. */
function AfterPo({ result, onClose }: { result: ReceivingMatchResult; onClose: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState<string | null>(null);
  const billable = result.billable_now ?? 0;

  async function ask() {
    if (!result.po_no) return;
    setBusy(true);
    const res = await procurement.requestPoPayment({ po_no: result.po_no });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not requested", "Tidak diajukan"), res.error.message); return; }
    setAsked(res.data.line_no);
    toast("success", tr(`Requested as ${res.data.line_no}`, `Diajukan sebagai ${res.data.line_no}`), formatIDR(res.data.amount));
  }

  return (
    <div className="space-y-3 text-[13px]">
      <p>
        {result.status === "CONFIRMED"
          ? tr("Received and confirmed against", "Diterima dan dikonfirmasi pada")
          : tr("Reported against", "Dilaporkan pada")}{" "}
        <Link className="font-mono underline" href={`/procurement/po/${result.po_no}`}>{result.po_no}</Link>
        {" "}({(result.receipt_nos ?? []).join(", ")}).
      </p>
      {result.status === "REPORTED" && (
        <p className="text-amber-800">
          {tr("Without the tanda terima it does not count yet — complete it below in the morning list.",
            "Tanpa tanda terima belum terhitung — lengkapi di daftar di bawah.")}
        </p>
      )}
      {asked ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">
          {tr(`Payment request ${asked} is on the meeting board. Once it is approved and paid, the order reads paid.`,
            `Pengajuan pembayaran ${asked} sudah masuk papan meeting. Setelah disetujui dan dibayar, PO ikut tercatat dibayar.`)}
        </p>
      ) : billable > 0 ? (
        <div className="rounded-lg border border-brand-200 bg-brand-50/50 px-3 py-3">
          <p className="mb-2">
            {tr(`${formatIDR(billable)} is billable on this order now.`, `${formatIDR(billable)} bisa ditagihkan pada PO ini sekarang.`)}
          </p>
          <Button icon={Banknote} disabled={busy} onClick={ask}>
            {busy ? tr("Requesting…", "Mengajukan…") : tr("Request payment (PR)", "Ajukan pembayaran (PR)")}
          </Button>
        </div>
      ) : null}
      <Button variant="outline" onClick={onClose}>{tr("Close", "Tutup")}</Button>
    </div>
  );
}
