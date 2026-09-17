"use client";

import { useState } from "react";
import { FileSearch, AlertTriangle, Check, X } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { formatIDR, formatNumber } from "@/lib/format";
import { inventory } from "@/demo/api";
import type { NotaScan } from "@/services/inventory/contracts";
import { useToast } from "@/store/toast";

/** Reading a nota kayu — and deciding first that it *is* one.
 *
 *  The order on this screen is the whole design (D200). The transaction is
 *  normally recorded before the paper ever reaches here, so what arrives is a
 *  document that already has a ledger row behind it. Every other nota in this
 *  business is read line by line into the things that were bought. A nota kayu
 *  is not that document: its thirty rows are **sizes out of one load**, and
 *  read the ordinary way they become thirty purchases in the ledger for one
 *  delivery of wood.
 *
 *  So the reader answers *is this timber* before it answers *what is on it*,
 *  it shows the evidence in words a person can disagree with, and **nothing is
 *  written until somebody agrees**. A confidence percentage would have been
 *  cheaper to compute and impossible to argue with.
 */
export function NotaImport({ vendors, onCreated }: {
  vendors: { id: string; name: string }[];
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [scan, setScan] = useState<NotaScan | null>(null);
  const [vendorId, setVendorId] = useState("");
  const [receivedOn, setReceivedOn] = useState("2026-09-12");
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);

  async function read() {
    setBusy(true);
    const res = await inventory.readNota(text);
    setBusy(false);
    if (res.error) { toast("warning", "Tidak terbaca", res.error.message); return; }
    setScan(res.data);
    if (res.data.total_guess) setTotal(res.data.total_guess);
  }

  async function file() {
    if (!scan) return;
    setBusy(true);
    const res = await inventory.receiveLogs({
      vendor_id: vendorId,
      received_on: receivedOn,
      species: scan.species_guess ?? "",
      total_cost: total,
      boards: scan.lines.filter((l) => l.kind === "board").map((l) => ({
        thickness_mm: l.thickness_mm!, width_mm: l.width_mm!, length_mm: l.length_mm!, qty: l.qty,
      })),
      logs: scan.lines.filter((l) => l.kind === "log").map((l) => ({
        diameter_cm: l.diameter_cm!, length_cm: l.length_cm!,
      })),
    });
    setBusy(false);
    if (res.error) { toast("warning", "Tidak tersimpan", res.error.message); return; }
    toast("success", `Kiriman ${res.data.purchase_no}`, `${scan.lines.length} baris nota masuk sebagai kayu, bukan sebagai transaksi.`);
    setText(""); setScan(null); setTotal(0);
    onCreated();
  }

  const boards = scan?.lines.filter((l) => l.kind === "board") ?? [];
  const logs = scan?.lines.filter((l) => l.kind === "log") ?? [];

  return (
    <Card>
      <CardHeader
        title="Masukkan kiriman dari notanya"
        subtitle="Kiriman log dicatat dari nota, bukan diketik dari ingatan. Notanya dibaca dulu untuk memastikan ini memang nota kayu."
        icon={FileSearch}
      />
      <div className="space-y-3 px-5 py-4">
        <label className="block text-[12px] text-slate-500">
          Isi nota
          <textarea
            value={text} onChange={(e) => { setText(e.target.value); setScan(null); }}
            rows={7} placeholder={"CV SUMBER KAYU JATI\nNota 2209 — 12/09/2026\nKayu jati\n3 x 20 x 300  8 lbr\n3 x 22 x 280  9 lbr\n4 x 25 x 320  7 lbr\nTotal 54.700.000"}
            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 font-mono text-[12px] focus:border-brand-400 focus:outline-none"
          />
        </label>
        <div className="flex gap-2">
          <Button size="sm" icon={FileSearch} disabled={busy || !text.trim()} onClick={read}>
            {busy ? "Membaca…" : "Baca notanya"}
          </Button>
          {scan && <Button size="sm" variant="ghost" onClick={() => setScan(null)}>Ulangi</Button>}
        </div>

        {scan && (
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              {scan.is_timber ? (
                <Badge tone="green"><Check className="mr-1 inline h-3 w-3" />Terbaca sebagai nota kayu</Badge>
              ) : (
                <Badge tone="slate"><X className="mr-1 inline h-3 w-3" />Bukan nota kayu</Badge>
              )}
              {scan.species_guess && <Badge tone="brand">{scan.species_guess}</Badge>}
            </div>

            <div className="grid gap-2 text-[12px] sm:grid-cols-2">
              <div>
                <p className="mb-0.5 text-[11px] uppercase tracking-wide text-slate-400">Alasannya</p>
                <ul className="space-y-0.5 text-emerald-800">
                  {scan.signals.map((s) => <li key={s}>· {s}</li>)}
                  {scan.signals.length === 0 && <li className="text-slate-400">tidak ada</li>}
                </ul>
              </div>
              <div>
                <p className="mb-0.5 text-[11px] uppercase tracking-wide text-slate-400">Yang melemahkan</p>
                <ul className="space-y-0.5 text-slate-600">
                  {scan.against.map((s) => <li key={s}>· {s}</li>)}
                  {scan.against.length === 0 && <li className="text-slate-400">tidak ada</li>}
                </ul>
              </div>
            </div>

            {scan.is_timber ? (
              <p className="rounded-lg bg-white px-3 py-2 text-[12px] text-slate-700">
                <strong className="font-medium">{boards.length} ukuran papan</strong>
                {logs.length > 0 && <> dan <strong className="font-medium">{logs.length} batang log</strong></>}
                {" "}akan masuk sebagai kayu di modul ini. Yang masuk ke akunting tetap{" "}
                <strong className="font-medium">satu angka</strong> — nilai notanya. Baris ukuran
                tidak pernah menjadi baris transaksi.
              </p>
            ) : (
              <p className="flex items-start gap-1.5 rounded-lg bg-white px-3 py-2 text-[12px] text-slate-700">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                Nota ini dibaca seperti nota biasa — tiap baris satu barang. Kalau ini sebenarnya
                nota kayu, tambahkan jenis kayunya atau periksa baris ukurannya, lalu baca ulang.
              </p>
            )}

            {scan.unread.length > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
                {scan.unread.length} baris tidak terbaca dan tidak dibuang:{" "}
                <span className="font-mono text-[11px]">{scan.unread.slice(0, 3).join(" · ")}</span>
                {scan.unread.length > 3 && " …"}
              </p>
            )}

            {scan.is_timber && (
              <>
                <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                  <table className="w-full border-collapse text-[12px]">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/70 text-[10px] uppercase tracking-wide text-slate-500">
                        <th className="px-3 py-1.5 text-left">Baris di nota</th>
                        <th className="px-3 py-1.5 text-left">Dibaca sebagai</th>
                        <th className="px-3 py-1.5 text-right">Jml</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scan.lines.map((l, i) => (
                        <tr key={i} className="border-b border-slate-100">
                          <td className="px-3 py-1 font-mono text-[11px] text-slate-500">{l.raw}</td>
                          <td className="px-3 py-1 text-slate-800">
                            {l.kind === "board"
                              ? `Papan ${l.thickness_mm! / 10} × ${l.width_mm! / 10} × ${l.length_mm! / 10} cm`
                              : `Log Ø${l.diameter_cm} × ${l.length_cm} cm`}
                          </td>
                          <td className="px-3 py-1 text-right tabular-nums text-slate-700">{l.qty}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="text-[11px] text-slate-500">
                    Vendor
                    <select
                      value={vendorId} onChange={(e) => setVendorId(e.target.value)}
                      className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                    >
                      <option value="">— pilih —</option>
                      {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </label>
                  <label className="text-[11px] text-slate-500">
                    Tanggal terima
                    <input
                      type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)}
                      className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                    />
                  </label>
                  <label className="text-[11px] text-slate-500">
                    Nilai nota
                    <MoneyInput value={total} onChange={setTotal} />
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" disabled={busy || !vendorId || total <= 0} onClick={file}>
                    {busy ? "Menyimpan…" : `Catat ${scan.lines.length} baris sebagai kayu`}
                  </Button>
                  <span className="text-[11px] text-slate-500">
                    {total > 0 && boards.length > 0 && (
                      <>
                        {formatIDR(total)} untuk{" "}
                        {formatNumber(boards.reduce((a, l) =>
                          a + (l.thickness_mm! / 1000) * (l.width_mm! / 1000) * (l.length_mm! / 1000) * l.qty, 0))} m³ papan
                      </>
                    )}
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
