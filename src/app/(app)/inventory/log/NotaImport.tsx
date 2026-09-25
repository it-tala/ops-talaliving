"use client";

import { useRef, useState } from "react";
import { FileSearch, AlertTriangle, Camera, Check, Plus, Truck, TreePine, X } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { NumberInput } from "@/components/ui/number-input";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { officeToday } from "@/lib/office";
import { documents, inventory } from "@/demo/api";
import {
  LOG_COST_LABEL, type LogCostKind, type NotaCostLine, type NotaScan, type NotaTimberLine,
} from "@/services/inventory/contracts";
import { useToast } from "@/store/toast";
import { matchVendor, shrinkImage } from "./notaFile";

/** Reading a nota kayu — and deciding first that it *is* one.
 *
 *  The order on this screen is the whole design (D200). A nota kayu's thirty
 *  rows are **sizes out of one load**, and read the ordinary way they become
 *  thirty purchases in the ledger for one delivery of wood. So the reader
 *  answers *is this timber* before it answers *what is on it*, it shows the
 *  evidence in words a person can disagree with, and **nothing is written
 *  until somebody agrees**.
 *
 *  Two things changed (2026-09-24). The nota is usually **photographed**, not
 *  typed, so a photo or PDF can be read by a model — and its reading is shown
 *  row by row, **editable**, because a model misreading a handwritten 3 as 8 is
 *  the same mistake as a regex misreading a date, only harder to spot. And the
 *  truck and the sawmill send **their own notas**, so the second mode files a
 *  cost against a load that is already here, beside its invoice and never
 *  into it.
 *
 *  A third mode (2026-09-25): **no nota at all.** Opname week and any load
 *  whose paper is lost or was never photographed still need a way in, and
 *  routing them through a fake reading would say the screen recognised
 *  something it never saw. So `manual` skips reading entirely — rows start
 *  empty, added by hand — and files through the same `receiveLogs` the read
 *  path uses, because the load is exactly as real either way.
 */
type Mode = "kayu" | "biaya" | "manual";

type Row = NotaTimberLine & { key: number };
type CostRow = NotaCostLine & { key: number };

let seq = 0;
const key = () => ++seq;

export function NotaImport({ vendors, loads, onCreated }: {
  vendors: { id: string; name: string }[];
  /** Loads already recorded, newest first — what a transport nota is for. */
  loads: { purchase_no: string; label: string }[];
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("kayu");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [scan, setScan] = useState<NotaScan | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [confirmed, setConfirmed] = useState(false);

  const [vendorId, setVendorId] = useState("");
  const [receivedOn, setReceivedOn] = useState(officeToday());
  const [species, setSpecies] = useState("");
  const [total, setTotal] = useState(0);

  const [purchaseNo, setPurchaseNo] = useState("");
  const [payee, setPayee] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setFile(null); setText(""); setScan(null); setRows([]); setCosts([]);
    setConfirmed(false); setTotal(0); setSpecies(""); setPayee("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function read() {
    setBusy(true);
    const res = file
      ? await inventory.readNotaImage(await shrinkImage(file))
      : await inventory.readNota(text);
    setBusy(false);
    if (res.error) { toast("warning", "Tidak terbaca", res.error.message); return; }
    const s = res.data;
    setScan(s);
    setConfirmed(false);
    setRows(s.lines.map((l) => ({ ...l, key: key() })));
    const costSum = s.costs.reduce((a, c) => a + c.amount, 0);

    if (mode === "kayu") {
      setCosts(s.costs.map((c) => ({ ...c, key: key() })));
      /* The printed total usually includes the charges on the same paper.
         The wood's own figure is the total without them — proposed, and
         editable, because some notas print them outside the total. */
      setTotal(s.total_guess ? (costSum > 0 && s.total_guess > costSum ? s.total_guess - costSum : s.total_guess) : 0);
      setSpecies(s.species_guess ?? "");
      const v = matchVendor(s.vendor_guess, vendors);
      if (v) setVendorId(v.id);
    } else {
      setCosts(s.costs.length > 0
        ? s.costs.map((c) => ({ ...c, key: key() }))
        : [{ raw: "total nota", kind: "angkut", amount: s.total_guess ?? 0, key: key() }]);
      setPayee(s.vendor_guess ?? "");
    }
    if (s.date_guess) setReceivedOn(s.date_guess);
  }

  /** The photo on the evidence road, as the person (ADR-010). A failed upload
   *  does not stop the filing: a load that arrived is a fact whether or not the
   *  paper reached Drive (A6) — the screen says so and the nota can be
   *  attached later. */
  async function fileEvidence(): Promise<string | null> {
    if (!file) return null;
    const up = await documents.upload({ file, kind: "Receipt / Invoice / Nota" });
    if (up.error) {
      toast("warning", "Foto nota tidak tersimpan", `${up.error.message} Data tetap dicatat; notanya bisa dilampirkan nanti.`);
      return null;
    }
    return up.data.id;
  }

  async function fileTimber() {
    setBusy(true);
    const notaId = await fileEvidence();
    const vendor = vendors.find((v) => v.id === vendorId);
    const res = await inventory.receiveLogs({
      vendor_id: vendorId,
      received_on: receivedOn,
      species: species.trim(),
      total_cost: total,
      nota_attachment_id: notaId,
      boards: rows.filter((l) => l.kind === "board").map((l) => ({
        thickness_mm: l.thickness_mm!, width_mm: l.width_mm!, length_mm: l.length_mm!, qty: l.qty,
      })),
      /* One row of `Ø32 × 250  3 btg` is three sticks, each measured. */
      logs: rows.filter((l) => l.kind === "log").flatMap((l) =>
        Array.from({ length: l.qty }, () => ({ diameter_cm: l.diameter_cm!, length_cm: l.length_cm! }))),
    });
    if (res.error) { setBusy(false); toast("warning", "Tidak tersimpan", res.error.message); return; }

    /* Charges on the same paper are the load's costs, paid to the same seller. */
    let filedCosts = 0;
    for (const c of costs.filter((c) => c.amount > 0)) {
      const cr = await inventory.addLogCost({
        purchase_no: res.data.purchase_no, kind: c.kind, amount: c.amount,
        incurred_on: receivedOn, payee: vendor?.name ?? null, vendor_id: vendorId || null,
        note: c.raw,
      });
      if (cr.error) toast("warning", `Biaya ${LOG_COST_LABEL[c.kind]} tidak tersimpan`, cr.error.message);
      else filedCosts += 1;
    }
    setBusy(false);
    toast("success", `Kiriman ${res.data.purchase_no}`,
      `${rows.length} baris ${mode === "manual" ? "diisi manual" : "nota"} masuk sebagai kayu, bukan sebagai transaksi`
      + (filedCosts > 0 ? `, dan ${filedCosts} biaya di luar kayu.` : "."));
    reset();
    onCreated();
  }

  async function fileCosts() {
    setBusy(true);
    const notaId = await fileEvidence();
    let filed = 0;
    for (const c of costs.filter((c) => c.amount > 0)) {
      const res = await inventory.addLogCost({
        purchase_no: purchaseNo, kind: c.kind, amount: c.amount, incurred_on: receivedOn,
        payee: payee.trim() || null, nota_attachment_id: notaId,
        note: c.raw === "total nota" ? null : c.raw,
      });
      if (res.error) { toast("warning", "Tidak tersimpan", res.error.message); continue; }
      filed += 1;
    }
    setBusy(false);
    if (filed === 0) return;
    toast("success", `${filed} biaya tercatat`, `Untuk kiriman ${purchaseNo} — di samping nilai kayunya, tidak menambah nota kayu.`);
    reset();
    onCreated();
  }

  const boards = rows.filter((l) => l.kind === "board");
  const logs = rows.filter((l) => l.kind === "log");
  const costTotal = costs.reduce((a, c) => a + c.amount, 0);
  const boardM3 = boards.reduce((a, l) =>
    a + (l.thickness_mm! / 1000) * (l.width_mm! / 1000) * (l.length_mm! / 1000) * l.qty, 0);
  const boardM2 = boards.reduce((a, l) => a + (l.width_mm! / 1000) * (l.length_mm! / 1000) * l.qty, 0);
  const agreed = mode === "manual" || (scan != null && (scan.is_timber || confirmed));
  const mayFileTimber = agreed && rows.length > 0 && !!vendorId && total > 0 && species.trim().length > 0;
  const mayFileCosts = !!purchaseNo && costs.some((c) => c.amount > 0);

  const patch = (k: number, p: Partial<Row>) => setRows(rows.map((r) => (r.key === k ? { ...r, ...p } : r)));
  const patchCost = (k: number, p: Partial<CostRow>) => setCosts(costs.map((c) => (c.key === k ? { ...c, ...p } : c)));
  const addRow = (kind: Row["kind"]) => setRows([...rows, kind === "board"
    ? { raw: "Ditambahkan manual", kind, species: null, thickness_mm: 30, width_mm: 200, length_mm: 3000, diameter_cm: null, length_cm: null, qty: 1, amount: null, key: key() }
    : { raw: "Ditambahkan manual", kind, species: null, thickness_mm: null, width_mm: null, length_mm: null, diameter_cm: 30, length_cm: 300, qty: 1, amount: null, key: key() }]);

  return (
    <Card>
      <CardHeader
        title="Masukkan dari nota"
        subtitle="Foto atau PDF nota dibaca dulu, lalu diperiksa baris per baris sebelum disimpan. Nota kayu dan nota biaya (angkut, potong) dicatat terpisah — atau isi langsung kalau notanya tidak ada."
        icon={FileSearch}
      />
      <div className="space-y-3 px-5 py-4">
        <div className="flex flex-wrap gap-1.5">
          {([
            ["kayu", "Nota kayu", TreePine],
            ["biaya", "Nota biaya (angkut, potong, …)", Truck],
            ["manual", "Tanpa nota", Plus],
          ] as const).map(([m, label, icon]) => (
            <Button key={m} size="sm" icon={icon} variant={mode === m ? "primary" : "outline"}
              onClick={() => { setMode(m); reset(); }}>
              {label}
            </Button>
          ))}
        </div>

        {mode !== "manual" && (
          <>
            <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
              <div>
                <input
                  ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" className="hidden"
                  onChange={(e) => { setFile(e.target.files?.[0] ?? null); setScan(null); }}
                />
                <button
                  type="button" onClick={() => fileRef.current?.click()}
                  className={cn(
                    "flex h-full min-h-[120px] w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-3 py-4 text-center text-[12px]",
                    file ? "border-brand-300 bg-brand-50/50 text-brand-800" : "border-slate-300 text-slate-500 hover:bg-slate-50",
                  )}
                >
                  <Camera className="h-5 w-5" />
                  {file ? (
                    <>
                      <span className="max-w-full truncate font-medium">{file.name}</span>
                      <span className="text-[11px] text-slate-500">ketuk untuk ganti</span>
                    </>
                  ) : (
                    <>
                      <span className="font-medium">Foto / PDF nota</span>
                      <span className="text-[11px]">dibaca oleh model bahasa</span>
                    </>
                  )}
                </button>
              </div>
              <label className="block text-[12px] text-slate-500">
                …atau tempel isi nota
                <textarea
                  value={text} onChange={(e) => { setText(e.target.value); setScan(null); }}
                  rows={6} disabled={!!file}
                  placeholder={mode === "kayu"
                    ? "CV SUMBER KAYU JATI\nNota 2209 — 12/09/2026\nKayu jati\n3 x 20 x 300  8 lbr\n3 x 22 x 280  9 lbr\n4 x 25 x 320  7 lbr\nOngkos angkut 1.500.000\nTotal 56.200.000"
                    : "EKSPEDISI BORNEO TRANS\n05/08/2026\nOngkos angkut kayu Kotabaru–Banjarmasin 2.400.000"}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 font-mono text-[12px] focus:border-brand-400 focus:outline-none disabled:bg-slate-50"
                />
              </label>
            </div>

            <div className="flex gap-2">
              <Button size="sm" icon={FileSearch} disabled={busy || (!file && !text.trim())} onClick={read}>
                {busy && !scan ? "Membaca…" : "Baca notanya"}
              </Button>
              {(scan || file) && <Button size="sm" variant="ghost" onClick={reset}>Ulangi</Button>}
            </div>
          </>
        )}

        {mode === "manual" && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
            Tanpa nota berarti tidak ada kertas untuk dicocokkan nanti — pastikan jumlah dan ukurannya
            benar-benar dari yang diukur di lapangan, bukan tebakan.
          </p>
        )}

        {(scan || mode === "manual") && (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
            {mode !== "manual" && scan && (
              <div className="flex flex-wrap items-center gap-2">
                {mode === "kayu" && (scan.is_timber ? (
                  <Badge tone="green"><Check className="mr-1 inline h-3 w-3" />Terbaca sebagai nota kayu</Badge>
                ) : (
                  <Badge tone="slate"><X className="mr-1 inline h-3 w-3" />Belum yakin ini nota kayu</Badge>
                ))}
                <Badge tone="slate">{scan.source === "image" ? "dibaca dari foto" : "dibaca dari teks"}</Badge>
                {scan.species_guess && <Badge tone="brand">{scan.species_guess}</Badge>}
                {scan.vendor_guess && <span className="text-[11px] text-slate-500">{scan.vendor_guess}</span>}
              </div>
            )}

            {mode === "manual" && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" icon={Plus} onClick={() => addRow("log")}>Baris log</Button>
                <Button size="sm" variant="outline" icon={Plus} onClick={() => addRow("board")}>Baris papan</Button>
              </div>
            )}

            {/* `scan!` below: this whole card only renders for "kayu" without
                `scan` when the outer condition's other arm (`mode === "manual"`)
                is what let it through, and none of these branches are reachable
                in that case — the runtime guard TypeScript cannot see from here. */}
            {mode === "kayu" && (
              <div className="grid gap-2 text-[12px] sm:grid-cols-2">
                <div>
                  <p className="mb-0.5 text-[11px] uppercase tracking-wide text-slate-400">Alasannya</p>
                  <ul className="space-y-0.5 text-emerald-800">
                    {scan!.signals.map((s) => <li key={s}>· {s}</li>)}
                    {scan!.signals.length === 0 && <li className="text-slate-400">tidak ada</li>}
                  </ul>
                </div>
                <div>
                  <p className="mb-0.5 text-[11px] uppercase tracking-wide text-slate-400">Yang melemahkan</p>
                  <ul className="space-y-0.5 text-slate-600">
                    {scan!.against.map((s) => <li key={s}>· {s}</li>)}
                    {scan!.against.length === 0 && <li className="text-slate-400">tidak ada</li>}
                  </ul>
                </div>
              </div>
            )}

            {mode === "kayu" && !scan!.is_timber && rows.length === 0 && scan!.costs.length > 0 && (
              <p className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-3 py-2 text-[12px] text-slate-700">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                Ini terbaca seperti nota biaya, bukan nota kayu.
                <Button size="sm" variant="outline" icon={Truck} onClick={() => { setMode("biaya"); setScan(null); }}>
                  Catat sebagai nota biaya
                </Button>
              </p>
            )}

            {mode === "kayu" && !scan!.is_timber && rows.length > 0 && (
              <label className="flex items-start gap-2 rounded-lg bg-white px-3 py-2 text-[12px] text-slate-700">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
                <span>
                  Saya sudah mencocokkan baris di bawah dengan notanya — ini memang nota kayu, dan tiap baris
                  ukuran adalah kayu, bukan barang terpisah.
                </span>
              </label>
            )}

            {scan && scan.unread.length > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                {scan.unread.length} baris tidak terbaca dan tidak dibuang — periksa di notanya:{" "}
                <span className="font-mono text-[11px]">{scan.unread.slice(0, 4).join(" · ")}</span>
                {scan.unread.length > 4 && " …"}
              </p>
            )}

            {(mode === "kayu" || mode === "manual") && rows.length > 0 && (
              <div className="max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full min-w-[560px] border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 text-[10px] uppercase tracking-wide text-slate-500">
                      <th className="px-3 py-1.5 text-left">{mode === "manual" ? "Ditambahkan" : "Baris di nota"}</th>
                      <th className="px-2 py-1.5 text-left">Dibaca sebagai</th>
                      <th className="px-2 py-1.5 text-right">Jml</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((l) => (
                      <tr key={l.key} className="border-b border-slate-100 align-top">
                        <td className="px-3 py-1.5 font-mono text-[11px] text-slate-500">{l.raw}</td>
                        <td className="px-2 py-1">
                          {l.kind === "board" ? (
                            <div className="flex items-center gap-1 text-[11px] text-slate-500">
                              <span>Papan</span>
                              <NumberInput size="sm" value={l.thickness_mm!} min={1} max={300} onChange={(v) => patch(l.key, { thickness_mm: v })} />
                              <span>×</span>
                              <NumberInput size="sm" value={l.width_mm!} min={1} max={2000} onChange={(v) => patch(l.key, { width_mm: v })} />
                              <span>×</span>
                              <NumberInput size="sm" value={l.length_mm!} min={1} max={12000} onChange={(v) => patch(l.key, { length_mm: v })} />
                              <span>mm</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 text-[11px] text-slate-500">
                              <span>Log Ø</span>
                              <NumberInput size="sm" value={l.diameter_cm!} min={1} max={300} onChange={(v) => patch(l.key, { diameter_cm: v })} />
                              <span>× p</span>
                              <NumberInput size="sm" value={l.length_cm!} min={1} max={2000} onChange={(v) => patch(l.key, { length_cm: v })} />
                              <span>cm</span>
                            </div>
                          )}
                        </td>
                        <td className="w-20 px-2 py-1">
                          <NumberInput size="sm" value={l.qty} min={1} max={9999} onChange={(v) => patch(l.key, { qty: v })} />
                        </td>
                        <td className="px-1 py-1">
                          <button type="button" aria-label="Buang baris" onClick={() => setRows(rows.filter((r) => r.key !== l.key))}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* The charges — on the same timber nota, or the whole of a cost nota. */}
            {(mode === "biaya" || mode === "manual" || costs.length > 0) && (
              <div className="rounded-lg border border-slate-200 bg-white">
                <p className="border-b border-slate-100 px-3 py-1.5 text-[11px] uppercase tracking-wide text-slate-400">
                  {mode === "biaya" ? "Biaya pada nota ini" : "Biaya di luar kayu (angkut, potong, …)"}
                </p>
                <ul className="divide-y divide-slate-100">
                  {costs.map((c) => (
                    <li key={c.key} className="grid items-center gap-2 px-3 py-1.5 sm:grid-cols-[1fr_150px_160px_28px]">
                      <span className="truncate font-mono text-[11px] text-slate-500">{c.raw}</span>
                      <select
                        value={c.kind} onChange={(e) => patchCost(c.key, { kind: e.target.value as LogCostKind })}
                        aria-label="Jenis biaya"
                        className="h-8 rounded-lg border border-slate-200 px-2 text-[12px] focus:border-brand-400 focus:outline-none"
                      >
                        {(Object.keys(LOG_COST_LABEL) as LogCostKind[]).map((k) => (
                          <option key={k} value={k}>{LOG_COST_LABEL[k]}</option>
                        ))}
                      </select>
                      <MoneyInput size="sm" value={c.amount} onChange={(v) => patchCost(c.key, { amount: v })} />
                      <button type="button" aria-label="Buang biaya" onClick={() => setCosts(costs.filter((x) => x.key !== c.key))}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center justify-between px-3 py-1.5">
                  <Button size="sm" variant="ghost" icon={Plus}
                    onClick={() => setCosts([...costs, { raw: "ditambahkan manual", kind: "angkut", amount: 0, key: key() }])}>
                    Baris biaya
                  </Button>
                  {costTotal > 0 && <span className="text-[12px] tabular-nums text-slate-600">{formatIDR(costTotal)}</span>}
                </div>
              </div>
            )}

            {(mode === "kayu" || mode === "manual") && agreed && (
              <>
                <div className="grid gap-2 sm:grid-cols-4">
                  <label className="text-[11px] text-slate-500">
                    Vendor kayu
                    <select
                      value={vendorId} onChange={(e) => setVendorId(e.target.value)}
                      className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                    >
                      <option value="">— pilih —</option>
                      {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </label>
                  <label className="text-[11px] text-slate-500">
                    Jenis kayu
                    <input
                      value={species} onChange={(e) => setSpecies(e.target.value)} placeholder="Jati, Mahoni, …"
                      className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                    />
                  </label>
                  <label className="text-[11px] text-slate-500">
                    Tanggal terima
                    <input
                      type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)}
                      className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                    />
                  </label>
                  <label className="text-[11px] text-slate-500">
                    Nilai kayu (tanpa biaya)
                    <MoneyInput value={total} onChange={setTotal} />
                  </label>
                </div>
                {scan?.total_guess != null && costTotal > 0 && (
                  <p className="text-[11px] text-slate-500">
                    Total tercetak {formatIDR(scan.total_guess)}; biaya di luar kayu {formatIDR(costTotal)} dicatat
                    terpisah. Kalau biaya itu tidak termasuk dalam total nota, betulkan nilai kayunya.
                  </p>
                )}
                {!vendorId && scan?.vendor_guess && (
                  <p className="text-[11px] text-amber-800">
                    “{scan.vendor_guess}” tidak cocok dengan vendor mana pun — pilih manual, atau daftarkan dulu di master vendor.
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" disabled={busy || !mayFileTimber} onClick={fileTimber}>
                    {busy ? "Menyimpan…" : `Catat ${rows.length} baris sebagai kayu`}
                  </Button>
                  <span className="text-[11px] text-slate-500">
                    {total > 0 && boards.length > 0 && (
                      <>
                        {formatIDR(total + costTotal)} untuk {formatNumber(boardM3)} m³ · {formatNumber(boardM2)} m² papan
                        {" "}≈ {formatIDR(Math.round((total + costTotal) / boardM3))}/m³ ·{" "}
                        {formatIDR(Math.round((total + costTotal) / boardM2))}/m²
                      </>
                    )}
                    {logs.length > 0 && ` · ${logs.reduce((a, l) => a + l.qty, 0)} batang log`}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Yang masuk ke akunting tetap <strong className="font-medium">satu angka</strong> — nilai notanya.
                  Baris ukuran tidak pernah menjadi baris transaksi.
                </p>
              </>
            )}

            {mode === "biaya" && (
              <>
                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="text-[11px] text-slate-500">
                    Untuk kiriman
                    <select
                      value={purchaseNo} onChange={(e) => setPurchaseNo(e.target.value)}
                      className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                    >
                      <option value="">— pilih kiriman —</option>
                      {loads.map((l) => <option key={l.purchase_no} value={l.purchase_no}>{l.label}</option>)}
                    </select>
                  </label>
                  <label className="text-[11px] text-slate-500">
                    Dibayar ke
                    <input
                      value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="Pak Darto (truk), Sawmill …"
                      className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                    />
                  </label>
                  <label className="text-[11px] text-slate-500">
                    Tanggal
                    <input
                      type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)}
                      className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                    />
                  </label>
                </div>
                <Button size="sm" disabled={busy || !mayFileCosts} onClick={fileCosts}>
                  {busy ? "Menyimpan…" : `Catat ${formatIDR(costTotal)} sebagai biaya kiriman`}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
