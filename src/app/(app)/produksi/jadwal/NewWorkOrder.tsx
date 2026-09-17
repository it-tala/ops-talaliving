"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { Modal } from "@/components/ui/drawer";
import { Button } from "@/components/ui/primitives";
import { NumberInput } from "@/components/ui/number-input";
import { procurement, production } from "@/demo/api";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { useToast } from "@/store/toast";
import { cn } from "@/lib/cn";
import { ROUTES, STAGE_NAME, type RouteCode } from "@/services/production/contracts";

/** Putting something on the floor.
 *
 *  The date is required and the form says why: a work order with no date
 *  cannot be late, which means nobody can tell when it is — and "which of
 *  these eleven things is late" is the only question this board exists to
 *  answer (D148).
 */
export function NewWorkOrder({
  onClose, onDone,
}: {
  onClose: () => void;
  onDone: (woNo: string) => void;
}) {
  const { toast } = useToast();
  const [products] = useLoad(() => production.listProducts(), []);
  const [projects] = useLoad(() => procurement.listProjects(), []);
  const [productCode, setProductCode] = useState("");
  const [item, setItem] = useState("");
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState(1);
  const [uom, setUom] = useState("unit");
  const [project, setProject] = useState("");
  const [due, setDue] = useState("");
  const [route, setRoute] = useState<RouteCode>("IN_HOUSE");
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const res = await production.createWorkOrder({
      product_code: productCode || null,
      item_name: item, description, qty, uom,
      project_code: project || null, due_date: due, route,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Tidak dibuat", res.error.message);
      return;
    }
    toast("success", "Pesanan kerja dibuat", `${res.data.wo_no} · ${qty} ${uom} · jatuh tempo ${due}`);
    onDone(res.data.wo_no);
  }

  return (
    <Modal
      open onClose={onClose} width="max-w-lg"
      title="Pesanan kerja baru"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button>
          <Button icon={Save} onClick={save} disabled={busy || !item.trim() || qty <= 0 || !due}>
            {busy ? "Menyimpan…" : "Simpan"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {/* Pick from the catalogue where possible: the product code is what
            lets a customer's order line and this order be compared (D150). */}
        <Loaded state={products} skeletonRows={1}>
          {(prods) => (
            <div>
              <label htmlFor="w-prod" className="block text-xs text-slate-500">Item yang dibuat</label>
              <select
                id="w-prod" value={productCode}
                onChange={(e) => {
                  const found = prods.find((x) => x.product_code === e.target.value);
                  setProductCode(e.target.value);
                  if (found) { setItem(found.name); setUom(found.uom); }
                }}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
              >
                <option value="">Di luar katalog — ketik sendiri…</option>
                {prods.map((x) => (
                  <option key={x.product_code} value={x.product_code}>
                    {x.name} · {x.product_code}
                  </option>
                ))}
              </select>
              <input
                value={item} onChange={(e) => setItem(e.target.value)}
                placeholder="Meja makan jati 220×100"
                aria-label="Nama item"
                className="mt-2 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
              />
            </div>
          )}
        </Loaded>
        <div>
          <label htmlFor="w-desc" className="block text-xs text-slate-500">Keterangan</label>
          <input
            id="w-desc" value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Finishing natural matt, sesuai gambar revisi 2."
            className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="w-qty" className="block text-xs text-slate-500">Jumlah</label>
            <NumberInput id="w-qty" value={qty} min={1} max={9999} onChange={setQty} className="mt-1" />
          </div>
          <div>
            <label htmlFor="w-uom" className="block text-xs text-slate-500">Satuan</label>
            <input
              id="w-uom" value={uom} onChange={(e) => setUom(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="w-due" className="block text-xs text-slate-500">Jatuh tempo</label>
            <input
              id="w-due" type="date" value={due} onChange={(e) => setDue(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </div>
        </div>
        {/* Which stages this order goes through. Chosen, never inferred: a
            subcontracted order is a different route, not five skipped stages
            (D254). */}
        <div>
          <span className="block text-xs text-slate-500">Cara dikerjakan</span>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {ROUTES.map((r) => (
              <button
                key={r.code} type="button" onClick={() => setRoute(r.code)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-left",
                  route === r.code
                    ? "border-brand-400 bg-brand-50/60"
                    : "border-slate-200 hover:border-slate-300",
                )}
              >
                <span className="block text-[13px] font-medium text-slate-800">{r.name}</span>
                <span className="block text-[11px] text-slate-500">{r.description}</span>
                <span className="mt-0.5 block text-[11px] text-slate-400">
                  {r.stages.map((c) => STAGE_NAME(c)).join(" → ")}
                </span>
              </button>
            ))}
          </div>
          {route === "SUBCON" && (
            <p className="mt-1 text-[11px] text-slate-500">
              Vendor dan tanggal kirimnya dicatat nanti, di pesanan ini — bukan di sini, karena
              biasanya belum ditentukan saat SPK dibuat.
            </p>
          )}
        </div>

        <Loaded state={projects} skeletonRows={1}>
          {(prjs) => (
            <div>
              <label htmlFor="w-proj" className="block text-xs text-slate-500">Proyek / pelanggan</label>
              <select
                id="w-proj" value={project} onChange={(e) => setProject(e.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
              >
                <option value="">Tanpa proyek</option>
                {prjs.map((x) => (
                  <option key={x.code} value={x.code}>{x.name} · {x.code}</option>
                ))}
              </select>
              {/* The project's CODE, not its name: every cross-service
                  reference is by code (D149). */}
            </div>
          )}
        </Loaded>
        <p className="text-[11px] text-slate-500">
          Tanggal jatuh tempo wajib. Pesanan tanpa tanggal tidak bisa terlambat, artinya tidak ada
          yang tahu kapan ia terlambat.
        </p>
      </div>
    </Modal>
  );
}
