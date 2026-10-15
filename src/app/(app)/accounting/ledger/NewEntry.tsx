"use client";

import { TypeOptions } from "@/components/ui/type-options";
import Link from "next/link";
import { useRef, useState } from "react";
import { Plus, Trash2, Upload, FileText, Save } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/drawer";
import { MoneyInput } from "@/components/ui/money-input";
import { NumberInput } from "@/components/ui/number-input";
import { useLoad } from "@/components/ui/loaded";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { accounting, documents, procurement } from "@/demo/api";
import {
  type Direction, type TransactionTypeCode,
} from "@/services/accounting/contracts";
import {
  DOC_KINDS, PRIMARY_DOC_KINDS, type DocKind,
} from "@/services/documents/contracts";
import { type UomCode } from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";
import { UomOptions } from "@/components/ui/uom-options";
import { useTr } from "@/lib/i18n";
import { BilledFields, LineKindSelect } from "@/components/accounting/line-kind";
import { ItemPicker } from "@/components/accounting/item-picker";
import { isPricedKind, lineSign, taxRateOf, type LineKind } from "@/services/accounting/lines";
import { TaxRateInput } from "@/components/accounting/tax-rate";

/** Writing a row into the ledger, with everything a row is supposed to have.
 *
 *  Two rules are enforced here rather than hoped for:
 *
 *  **No document, no row** (D85). At least one nota, transfer proof or photo
 *  of what arrived. A delivery note or the PO can come with it, but neither
 *  can stand alone — supporting is not proof. The files are uploaded and
 *  linked in the same act as the row, so an undocumented row never exists,
 *  not even for a moment.
 *
 *  **A purchase says what it bought** (D86): quantity, unit price and who it
 *  was bought from. An amount on its own cannot be compared to the last time
 *  we bought the same thing, which is the only way a price is ever found to
 *  be wrong.
 */
/** `amount` is typed only for a line that is not an item — a fee, the tax,
 *  the courier, a voucher. An item's amount is qty × unit price (D86). */
type DraftLine = { key: string; kind: LineKind; description: string; qty: number; uom: UomCode; unit_price: number; amount: number; item_id: string | null };
type DraftDoc = { attachment_id: string; filename: string; kind: DocKind };

function lineAmount(l: DraftLine): number {
  return isPricedKind(l.kind) ? Math.round(l.qty * l.unit_price) : Math.round(l.amount);
}
const blankLine = (key: string): DraftLine =>
  ({ key, kind: "item", description: "", qty: 1, uom: "pcs", unit_price: 0, amount: 0, item_id: null });

export function NewEntry({ onClose, onPosted }: { onClose: () => void; onPosted: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [accounts] = useLoad(() => accounting.listAccounts(), []);
  const [vendors] = useLoad(() => procurement.listVendors({}), []);
  const [types] = useLoad(() => accounting.listTypeRows(), []);

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [accountId, setAccountId] = useState("");
  const [direction, setDirection] = useState<Direction>("OUT");
  const [typeCode, setTypeCode] = useState<TransactionTypeCode>("SUPPLIERS");
  const [vendorId, setVendorId] = useState("");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([blankLine("l1")]);
  /* Tax is stored as an amount, never a rate (D435): it becomes a `tax` line
     on top of what the items say. A rate may be typed to work it out (D441). */
  const [tax, setTax] = useState(0);
  /* A bill written in USD and paid in rupiah keeps its own figure beside the
     rupiah (D435); the rate is shown, never typed. */
  const [billedOpen, setBilledOpen] = useState(false);
  const [billedCcy, setBilledCcy] = useState("USD");
  const [billedAmt, setBilledAmt] = useState(0);
  const [docs, setDocs] = useState<DraftDoc[]>([]);
  const [kind, setKind] = useState<DocKind>("Receipt / Invoice / Nota");
  const [busy, setBusy] = useState(false);
  const nextKey = useRef(2);
  const fileRef = useRef<HTMLInputElement>(null);

  const typeRow = types.status === "ready" ? types.data.find((t) => t.code === typeCode) : undefined;
  const isPurchase = typeRow?.is_purchase ?? false;
  /* Only where purchases of this kind create catalogue entries does the
     picker offer to add one (D86, 0272). */
  const createsItems = typeRow?.creates_catalog_item ?? false;
  /* Σ lines with the sign the kind carries (a discount counts minus), plus
     the tax typed below — the same sum the seam checks the amount against. */
  const linesTotal = lines.reduce((s, l) => s + lineSign(l.kind) * lineAmount(l), 0);
  const total = linesTotal + Math.round(tax);
  const goods = lines.filter((l) => isPricedKind(l.kind)).reduce((s, l) => s + lineAmount(l), 0);
  const billedValid = !billedOpen || (billedCcy.length === 3 && billedCcy !== "IDR" && billedAmt > 0);
  const hasPrimary = docs.some((d) => PRIMARY_DOC_KINDS.includes(d.kind));
  const payingAccounts = accounts.status === "ready" ? accounts.data.filter((a) => a.is_active !== false) : [];

  function patch(key: string, next: Partial<DraftLine>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...next } : l)));
  }

  async function addFile(file: File) {
    const up = await documents.upload({ file, kind });
    if (up.error) { toast("critical", tr("Upload failed", "Unggah gagal"), up.error.message); return; }
    setDocs((d) => [...d, { attachment_id: up.data.id, filename: file.name, kind }]);
    if (up.data.reused) {
      toast("info", tr("Already in Drive from Google Chat", "Sudah ada di Drive dari Google Chat"),
        tr("The same file was linked instead of uploaded again. Next time, book it from Verification.",
          "File yang sama ditautkan, tidak diunggah ulang. Lain kali bukukan dari Verifikasi."));
    } else if (up.data.duplicate_suspect) {
      toast("warning", tr("Identical bytes seen before", "Berkas identik pernah terlihat"), tr("Worth a look in case this is a duplicate.", "Perlu dicek, siapa tahu ini duplikat."));
    }
  }

  async function post() {
    setBusy(true);
    const res = await accounting.postTransaction({
      trx_date: date,
      account_id: accountId,
      direction,
      amount_idr: total,
      type_code: typeCode,
      vendor_id: vendorId || null,
      description: description.trim(),
      source_ref: `manual:${date}:${accountId}:${total}:${description.trim().slice(0, 24)}`,
      lines: [
        ...lines
          .filter((l) => l.description.trim())
          .map((l) => (isPricedKind(l.kind)
            ? { kind: l.kind, description: l.description.trim(), qty: l.qty, uom: l.uom,
                unit_price: l.unit_price, amount: lineAmount(l), item_id: l.item_id }
            : { kind: l.kind, description: l.description.trim(), amount: lineAmount(l) })),
        ...(tax > 0 ? [{ kind: "tax" as const, description: tr("Tax on the nota", "Pajak di nota"), amount: Math.round(tax) }] : []),
      ],
      documents: docs.map((d) => ({ attachment_id: d.attachment_id, kind: d.kind })),
      ...(billedOpen && billedValid ? { billed_currency: billedCcy, billed_amount: billedAmt } : {}),
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not posted", "Tidak diposting"), res.error.message);
      return;
    }
    toast("success", tr(`Posted ${res.data.trx_no}`, `${res.data.trx_no} diposting`), `${formatIDR(total)} · ${res.data.account_code}`);
    onPosted();
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={tr("New ledger entry", "Entri buku besar baru")}
      subtitle={tr("Money that already moved — never a plan", "Uang yang sudah bergerak — bukan rencana")}
      width="max-w-2xl"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="mr-auto text-[13px] tabular-nums text-slate-600">{formatIDR(total)}</span>
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>{tr("Cancel", "Batal")}</Button>
          <Button
            size="sm" icon={Save} disabled={busy || total <= 0 || !accountId || !hasPrimary || !description.trim() || !billedValid}
            onClick={post}
          >
            {busy ? tr("Posting…", "Memposting…") : tr("Post to the ledger", "Posting ke buku besar")}
          </Button>
        </div>
      }
    >
      <div className="space-y-5 text-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="ne-date" className="block text-xs text-slate-500">{tr("Date the money moved", "Tanggal uang bergerak")}</label>
            <input
              id="ne-date" type="date" value={date}
              onChange={(e) => setDate(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="ne-account" className="block text-xs text-slate-500">{tr("Account", "Rekening")}</label>
            <select
              id="ne-account" value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
            >
              <option value="">{tr("Choose…", "Pilih…")}</option>
              {payingAccounts.map((a) => (
                <option key={a.account_id} value={a.account_id}>{a.code} — {a.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ne-direction" className="block text-xs text-slate-500">{tr("In or out", "Masuk atau keluar")}</label>
            <select
              id="ne-direction" value={direction}
              onChange={(e) => setDirection(e.target.value as Direction)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
            >
              <option value="OUT">{tr("OUT — money left", "OUT — uang keluar")}</option>
              <option value="IN">{tr("IN — money arrived", "IN — uang masuk")}</option>
            </select>
          </div>
          <div>
            <label htmlFor="ne-type" className="block text-xs text-slate-500">{tr("Type", "Jenis")}</label>
            <select
              id="ne-type" value={typeCode}
              onChange={(e) => setTypeCode(e.target.value as TransactionTypeCode)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
            >
              <TypeOptions current={typeCode} />
            </select>
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="ne-desc" className="block text-xs text-slate-500">{tr("Description", "Deskripsi")}</label>
            <input
              id="ne-desc" value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={tr("e.g. AMPLAS 120 GRIT, 500 sheets", "mis. AMPLAS 120 GRIT, 500 lembar")}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="ne-vendor" className="block text-xs text-slate-500">
              Vendor {isPurchase && <span className="text-amber-700">{tr("— required for a purchase", "— wajib untuk pembelian")}</span>}
            </label>
            <select
              id="ne-vendor" value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              className={cn(
                "mt-1 h-9 w-full rounded-lg border bg-white px-2 text-sm focus:outline-none",
                isPurchase && !vendorId ? "border-amber-300" : "border-slate-200",
              )}
            >
              <option value="">{tr("Not a vendor purchase", "Bukan pembelian dari vendor")}</option>
              {vendors.status === "ready" && vendors.data.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* What was bought: quantity and price, because an amount alone cannot
            be compared to the last time we bought the same thing (D86). */}
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {tr("What the money was for", "Untuk apa uangnya")}
          </p>
          <div className="space-y-2">
            {lines.map((l) => (
              <div key={l.key} className="grid gap-2 rounded-lg border border-slate-200 px-3 py-2.5 sm:grid-cols-12">
                {/* What kind of money this line is (0271): an item has a
                    quantity and a price; a fee, a tax, the courier or a
                    voucher is an amount. */}
                <div className="sm:col-span-3">
                  <label className="block text-[11px] text-slate-500" htmlFor={`nl-k-${l.key}`}>{tr("Kind", "Jenis baris")}</label>
                  <LineKindSelect id={`nl-k-${l.key}`} size="sm" value={l.kind} className="mt-1"
                    onChange={(k) => patch(l.key, { kind: k })} />
                </div>
                <div className={isPricedKind(l.kind) ? "sm:col-span-9" : "sm:col-span-6"}>
                  <label className="block text-[11px] text-slate-500" htmlFor={`nl-d-${l.key}`}>
                    {isPricedKind(l.kind) ? tr("Item", "Barang") : tr("Description", "Keterangan")}
                  </label>
                  <input
                    id={`nl-d-${l.key}`} value={l.description}
                    onChange={(e) => patch(l.key, { description: e.target.value })}
                    placeholder={isPricedKind(l.kind) ? tr("what was bought", "apa yang dibeli") : tr("e.g. transfer admin fee", "mis. biaya admin transfer")}
                    className="mt-1 h-8 w-full rounded-lg border border-slate-200 px-2 text-[13px] focus:border-brand-400 focus:outline-none"
                  />
                </div>
                {isPricedKind(l.kind) ? (
                  <>
                    <div className="sm:col-span-3">
                      <label className="block text-[11px] text-slate-500" htmlFor={`nl-q-${l.key}`}>{tr("Qty", "Jml")}</label>
                      <NumberInput id={`nl-q-${l.key}`} size="sm" value={l.qty} min={0}
                        onChange={(v) => patch(l.key, { qty: v })} className="mt-1" />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-[11px] text-slate-500" htmlFor={`nl-u-${l.key}`}>{tr("Unit", "Satuan")}</label>
                      <select
                        id={`nl-u-${l.key}`} value={l.uom}
                        onChange={(e) => patch(l.key, { uom: e.target.value as UomCode })}
                        className="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-1.5 text-[13px] focus:border-brand-400 focus:outline-none"
                      >
                        <UomOptions current={l.uom} />
                      </select>
                    </div>
                    <div className="sm:col-span-6">
                      <label className="block text-[11px] text-slate-500" htmlFor={`nl-p-${l.key}`}>{tr("Unit price", "Harga satuan")}</label>
                      <MoneyInput id={`nl-p-${l.key}`} size="sm" value={l.unit_price}
                        onChange={(v) => patch(l.key, { unit_price: v })} className="mt-1" />
                    </div>
                    {/* Which catalogue entry this bought (0272): the price paid
                        becomes the item's last price. Optional — not in the
                        catalogue is an honest answer. */}
                    <div className="sm:col-span-12">
                      <label className="block text-[11px] text-slate-500" htmlFor={`nl-i-${l.key}`}>{tr("Catalogue item", "Item katalog")}</label>
                      <div className="mt-1">
                        <ItemPicker id={`nl-i-${l.key}`} value={l.item_id} hint={l.description} uom={l.uom} allowCreate={createsItems}
                          onChange={(item) => patch(l.key, {
                            item_id: item?.id ?? null,
                            ...(item && !l.description.trim() ? { description: item.name } : {}),
                            ...(item ? { uom: item.base_uom } : {}),
                          })} />
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="sm:col-span-3">
                    <label className="block text-[11px] text-slate-500" htmlFor={`nl-a-${l.key}`}>{tr("Amount", "Jumlah")}</label>
                    <MoneyInput id={`nl-a-${l.key}`} size="sm" value={l.amount}
                      onChange={(v) => patch(l.key, { amount: v })} className="mt-1" />
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 sm:col-span-12">
                  <span className="text-[12px] tabular-nums text-slate-600">
                    {l.kind === "discount" ? "− " : ""}{formatIDR(lineAmount(l))}
                  </span>
                  {lines.length > 1 && (
                    <Button variant="ghost" size="sm" icon={Trash2}
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                      {tr("Remove", "Hapus")}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <Button
            variant="outline" size="sm" icon={Plus} className="mt-2"
            onClick={() => {
              const key = `l${nextKey.current++}`;
              setLines((ls) => [...ls, blankLine(key)]);
            }}
          >
            {tr("Another line", "Tambah baris")}
          </Button>

          {/* The nota's tax, as the number printed on it (D435) or as a rate
              of the goods (D441); no default. It books as its own `tax` line. */}
          <div className="mt-3 grid grid-cols-12 gap-2">
            <div className="col-span-4 sm:col-span-2">
              <label className="block text-[11px] text-slate-500" htmlFor="ne-tax-pct">{tr("Tax (%)", "Pajak (%)")}</label>
              <div className="mt-1">
                <TaxRateInput id="ne-tax-pct" size="sm" taxAmount={Math.round(tax)} rate={taxRateOf(Math.round(tax), goods)}
                  onRate={(pct) => { const t = Math.round((goods * pct) / 100); setTax(t); return t; }} />
              </div>
            </div>
            <div className="col-span-8 sm:col-span-4">
              <label className="block text-[11px] text-slate-500" htmlFor="ne-tax">{tr("Tax on the nota (amount)", "Pajak di nota (nominal)")}</label>
              <MoneyInput id="ne-tax" size="sm" value={tax} onChange={setTax} className="mt-1" />
            </div>
            <div className="col-span-12 flex items-end sm:col-span-6">
              <p className="text-[12px] text-slate-500">
                {tax > 0
                  ? tr(`Books as a tax line. Lines ${formatIDR(linesTotal)} + tax ${formatIDR(Math.round(tax))} = ${formatIDR(total)}.`,
                      `Dibukukan sebagai baris pajak. Baris ${formatIDR(linesTotal)} + pajak ${formatIDR(Math.round(tax))} = ${formatIDR(total)}.`)
                  : tr("Type the rate (11, 12) and the amount is worked out from the items, or type the figure the nota prints.",
                      "Ketik tarifnya (11, 12) dan nominalnya dihitung dari barang, atau ketik angka yang tercetak di nota.")}
              </p>
            </div>
          </div>

          {/* A bill in another currency, paid in rupiah (D435). */}
          <div className="mt-3">
            <label className="inline-flex items-center gap-2 text-[12px] text-slate-600">
              <input id="ne-billed" type="checkbox" checked={billedOpen} onChange={(e) => setBilledOpen(e.target.checked)} />
              {tr("The bill was in another currency (USD, SGD…)", "Tagihannya dalam mata uang lain (USD, SGD…)")}
            </label>
            {billedOpen && (
              <div className="mt-2 rounded-lg border border-slate-200 px-3 py-2.5">
                <BilledFields idPrefix="ne-billed" size="sm" currency={billedCcy} amount={billedAmt} amountIdr={total}
                  onCurrency={setBilledCcy} onAmount={setBilledAmt} />
              </div>
            )}
          </div>
        </section>

        {/* No document, no row (D85). */}
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {tr("Documents", "Dokumen")}
          </p>
          {docs.length > 0 ? (
            <ul className="mb-2 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {docs.map((d) => (
                <li key={d.attachment_id} className="flex items-center gap-3 px-3 py-2">
                  <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-slate-700">{d.filename}</span>
                  <Badge tone={PRIMARY_DOC_KINDS.includes(d.kind) ? "violet" : "slate"}>{d.kind}</Badge>
                  <Button variant="ghost" size="sm" icon={Trash2}
                    onClick={() => setDocs((all) => all.filter((x) => x.attachment_id !== d.attachment_id))}>
                    {tr("Remove", "Hapus")}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-2 text-[13px] text-slate-500">{tr("Nothing attached yet.", "Belum ada lampiran.")}</p>
          )}

          {/* Sent to Google Chat already? It is waiting in Verifikasi with its
              file. Re-uploading it here put a second copy in Drive (F211). */}
          <p className="mb-2 rounded-lg bg-sky-50 px-3 py-2 text-[12px] text-sky-800">
            {tr("Already sent to the accounting chat? Book it from ", "Sudah dikirim ke chat accounting? Bukukan dari ")}
            <Link href="/accounting/verifikasi" className="font-medium underline">{tr("Verification", "Verifikasi")}</Link>
            {tr(" instead of uploading it again.", ", jangan diunggah ulang di sini.")}
          </p>

          <div className="rounded-lg border border-dashed border-slate-300 px-3 py-3">
            <label htmlFor="ne-kind" className="block text-xs text-slate-500">{tr("Document type", "Jenis dokumen")}</label>
            <select
              id="ne-kind" value={kind}
              onChange={(e) => setKind(e.target.value as DocKind)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
            >
              {DOC_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}{PRIMARY_DOC_KINDS.includes(k) ? "" : tr(" (supporting)", " (pendukung)")}
                </option>
              ))}
            </select>
            <input
              ref={fileRef} id="ne-file" type="file" className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void addFile(f);
                e.target.value = "";
              }}
            />
            <Button variant="outline" size="sm" icon={Upload} className="mt-2 w-full"
              onClick={() => fileRef.current?.click()}>
              {tr("Attach a file", "Lampirkan berkas")}
            </Button>
            <p className={cn("mt-2 text-[11px]", hasPrimary ? "text-slate-500" : "text-amber-700")}>
              {hasPrimary
                ? tr("At least one nota, transfer proof or photo is on file — the row can be posted.", "Setidaknya satu nota, bukti transfer, atau foto sudah terlampir — baris ini bisa diposting.")
                : tr("At least one nota, transfer proof or photo of what arrived is required. A delivery note or a PO can come with it, but supporting is not proof.", "Wajib ada setidaknya satu nota, bukti transfer, atau foto barang yang datang. Surat jalan atau PO boleh menyertainya, tetapi dokumen pendukung bukan bukti.")}
            </p>
          </div>
        </section>
      </div>
    </Drawer>
  );
}
