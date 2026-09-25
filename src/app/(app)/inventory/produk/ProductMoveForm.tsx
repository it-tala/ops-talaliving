"use client";

import { useMemo, useState } from "react";
import { PackagePlus } from "lucide-react";
import { Button, Card, CardHeader } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { NumberInput } from "@/components/ui/number-input";
import { inventory } from "@/demo/api";
import type { ProductMoveInputKind, ProductStockRow } from "@/services/inventory/contracts";
import { useToast } from "@/store/toast";
import { batchKey, batchLabel } from "./batch";

type Mode = ProductMoveInputKind | "allocate" | "count" | "home";

const MODES: { mode: Mode; label: string; hint: string; adjust?: boolean }[] = [
  { mode: "produced", label: "Hasil produksi", hint: "Barang selesai dari Job Order masuk gudang. Pesanan kliennya ikut dari JO." },
  { mode: "transfer", label: "Pindah lokasi", hint: "Dari satu rak ke rak lain — dua catatan yang saling menutup." },
  { mode: "allocate", label: "Pakai untuk pesanan lain", hint: "Surplus satu batch dipakai untuk pesanan klien lain. Hanya surplus — yang masih harus dikirim ke pesanan asal tetap di sana." },
  { mode: "sold", label: "Dijual lepas", hint: "Surplus dijual di luar proyek. Tulis pembelinya." },
  { mode: "scrap", label: "Rusak / afkir", hint: "Tidak bisa dikirim lagi. Tulis kenapa.", adjust: true },
  { mode: "return", label: "Retur dari klien", hint: "Barang kembali dari lokasi proyek. Tulis alasannya." },
  { mode: "count", label: "Hitung (opname)", hint: "Isi jumlah yang ada di rak. Selisihnya yang disimpan, dengan alasan.", adjust: true },
  { mode: "home", label: "Lokasi rumah", hint: "Rak tempat produk ini biasanya disimpan — surat jalan mengambil dari sini." },
];

/** One form for every write on the finished-goods rack (`0170`). Pengiriman
 *  is not here on purpose: a delivery note already says it (D53). */
export function ProductMoveForm({ rows, mayAdjust, onDone, onCancel }: {
  rows: ProductStockRow[];
  mayAdjust: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [options] = useLoad(() => inventory.productMoveOptions(), []);
  const [locations] = useLoad(() => inventory.listStockLocations(), []);
  const [mode, setMode] = useState<Mode>("produced");
  const [form, setForm] = useState({
    wo_no: "", product_code: "", batch: "", location: "GUDANG", to_location: "", to_line: "", qty: 0, reason: "", ref_no: "",
  });
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => newKey());
  const field = "h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none";

  const batches = useMemo(() => {
    const own = rows.filter((r) => r.product_code === form.product_code);
    return own.some((r) => !r.project_line_id)
      ? own
      : [...own, { product_code: form.product_code, project_line_id: null } as ProductStockRow];
  }, [rows, form.product_code]);
  const batch = batches.find((b) => batchKey(b) === form.batch) ?? null;
  const lineId = batch?.project_line_id ?? null;

  const shown = MODES.filter((m) => !m.adjust || mayAdjust);
  const hint = MODES.find((m) => m.mode === mode)!.hint;
  const needsReason = mode === "sold" || mode === "scrap" || mode === "return" || mode === "allocate";
  const ready = !busy && (
    mode === "produced" ? !!form.wo_no && form.qty > 0 && !!form.location
    : mode === "home" ? !!form.product_code
    : mode === "count" ? !!form.product_code && !!form.location && !!form.batch
    : mode === "allocate" ? !!form.product_code && !!form.batch && !!form.to_line && form.qty > 0
      && !!form.location && form.reason.trim().length > 0
    : !!form.product_code && !!form.batch && form.qty > 0 && !!form.location
      && (mode !== "transfer" || (!!form.to_location && form.to_location !== form.location))
      && (!needsReason || form.reason.trim().length > 0));

  async function submit() {
    setBusy(true);
    const res =
      mode === "home"
        ? await inventory.setProductHome(form.product_code, form.location || null)
        : mode === "allocate"
          ? await inventory.allocateProduct({
              product_code: form.product_code, from_line_id: lineId, to_line_id: form.to_line,
              location: form.location, qty: form.qty, reason: form.reason,
            }, key)
        : mode === "count"
          ? await inventory.countProduct({
              product_code: form.product_code, location: form.location, counted: form.qty,
              reason: form.reason || null, project_line_id: lineId,
            }, key)
          : await inventory.moveProduct({
              product_code: mode === "produced"
                ? (options.status === "ready" ? options.data.work_orders.find((w) => w.wo_no === form.wo_no)?.product_code ?? "" : "")
                : form.product_code,
              kind: mode,
              qty: form.qty,
              location: form.location,
              to_location: mode === "transfer" ? form.to_location : null,
              wo_no: mode === "produced" ? form.wo_no : null,
              project_line_id: mode === "produced" ? null : lineId,
              ref_no: form.ref_no || null,
              reason: form.reason || null,
            }, key);
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", "Tidak tercatat", res.error.message);
      /* A refused write may be corrected and sent again — it is a new decision. */
      setKey(newKey());
      return;
    }
    toast("success", "Tercatat", MODES.find((m) => m.mode === mode)!.label);
    onDone();
  }

  return (
    <Card className="mb-4">
      <CardHeader title="Catat gerak barang jadi" subtitle={hint} icon={PackagePlus} />
      <div className="space-y-3 px-5 py-4">
        <div className="flex flex-wrap gap-1.5">
          {shown.map((m) => (
            <Button key={m.mode} size="sm" variant={mode === m.mode ? "primary" : "outline"}
              onClick={() => { setMode(m.mode); setKey(newKey()); }}>
              {m.label}
            </Button>
          ))}
        </div>

        <Loaded state={options} skeletonRows={2}>
          {(opts) => (
            <div className="grid gap-2 sm:grid-cols-2">
              {mode === "produced" ? (
                <label className="text-[11px] text-slate-500 sm:col-span-2">
                  Job Order
                  <select value={form.wo_no} onChange={(e) => setForm({ ...form, wo_no: e.target.value })}
                    aria-label="Job Order" className={`mt-1 ${field}`}>
                    <option value="">Pilih Job Order…</option>
                    {opts.work_orders.map((w) => (
                      <option key={w.wo_no} value={w.wo_no}>
                        {w.wo_no} — {w.item_name} ({w.product_code}, {w.qty}){w.project_code ? ` · ${w.project_code}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  <label className="text-[11px] text-slate-500">
                    Produk
                    <select value={form.product_code}
                      onChange={(e) => setForm({ ...form, product_code: e.target.value, batch: "" })}
                      aria-label="Produk" className={`mt-1 ${field}`}>
                      <option value="">Pilih produk…</option>
                      {opts.products.map((p) => (
                        <option key={p.product_code} value={p.product_code}>{p.product_code} — {p.name}</option>
                      ))}
                    </select>
                  </label>
                  {mode !== "home" && (
                    <label className="text-[11px] text-slate-500">
                      Batch / pesanan
                      <select value={form.batch} onChange={(e) => setForm({ ...form, batch: e.target.value })}
                        aria-label="Batch" disabled={!form.product_code} className={`mt-1 ${field}`}>
                        <option value="">Pilih batch…</option>
                        {batches.map((b) => (
                          <option key={batchKey(b)} value={batchKey(b)}>
                            {batchLabel(b)}{b.on_hand != null ? ` — di gudang ${b.on_hand}` : ""}
                            {mode === "allocate" && b.surplus != null ? ` · surplus ${b.surplus}` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {mode === "allocate" && (
                    <label className="text-[11px] text-slate-500 sm:col-span-2">
                      Untuk pesanan
                      <select value={form.to_line} onChange={(e) => setForm({ ...form, to_line: e.target.value })}
                        aria-label="Untuk pesanan" disabled={!form.product_code} className={`mt-1 ${field}`}>
                        <option value="">Pilih baris pesanan…</option>
                        {opts.order_lines
                          .filter((l) => l.product_code === form.product_code && l.id !== lineId)
                          .map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.project_code} · baris {l.line_no} — {l.description} ({l.qty})
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                </>
              )}

              <Loaded state={locations} skeletonRows={1}>
                {(locs) => (
                  <>
                    <label className="text-[11px] text-slate-500">
                      {mode === "transfer" ? "Dari lokasi" : mode === "home" ? "Lokasi rumah" : "Lokasi"}
                      <select value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
                        aria-label="Lokasi" className={`mt-1 ${field}`}>
                        {mode === "home" && <option value="">(GUDANG)</option>}
                        {locs.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
                      </select>
                    </label>
                    {mode === "transfer" && (
                      <label className="text-[11px] text-slate-500">
                        Ke lokasi
                        <select value={form.to_location} onChange={(e) => setForm({ ...form, to_location: e.target.value })}
                          aria-label="Ke lokasi" className={`mt-1 ${field}`}>
                          <option value="">Pilih…</option>
                          {locs.filter((l) => l.code !== form.location).map((l) => (
                            <option key={l.code} value={l.code}>{l.name}</option>
                          ))}
                        </select>
                      </label>
                    )}
                  </>
                )}
              </Loaded>

              {mode !== "home" && (
                <label className="text-[11px] text-slate-500">
                  {mode === "count" ? "Jumlah di rak (hasil hitung)" : "Jumlah"}
                  <div className="mt-1"><NumberInput value={form.qty} onChange={(v) => setForm({ ...form, qty: v })} /></div>
                </label>
              )}
              {mode !== "home" && mode !== "produced" && (
                <label className="text-[11px] text-slate-500 sm:col-span-2">
                  {needsReason ? "Alasan (wajib)" : mode === "count" ? "Alasan selisih" : "Catatan"}
                  <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
                    aria-label="Alasan" className={`mt-1 ${field}`}
                    placeholder={mode === "sold" ? "Dijual ke …" : mode === "scrap" ? "Kaki patah saat …" : ""} />
                </label>
              )}
            </div>
          )}
        </Loaded>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" icon={PackagePlus} disabled={!ready} onClick={submit}>{busy ? "Menyimpan…" : "Simpan"}</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>Batal</Button>
        </div>
      </div>
    </Card>
  );
}

function newKey() {
  return `fg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
