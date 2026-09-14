"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Factory, GitBranch, Hammer, PackageCheck, Plus, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { Drawer } from "@/components/ui/drawer";
import { Badge, Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { NumberInput } from "@/components/ui/number-input";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { procurement, production, hr, inventory } from "@/demo/api";
import { Combobox } from "@/components/ui/combobox";
import { STAGE_NAME, attributionOf, ATTRIBUTION_LABEL, type WorkOrderView } from "@/services/production/contracts";
import { UNITS, type UomCode } from "@/services/procurement/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { officeToday } from "@/lib/office";

/** One work order: every stage, every entry behind it, and the deadline.
 *
 *  Reporting work is append-only — a wrong number is corrected with a
 *  **negative entry and a reason**, never by editing the first one, because
 *  "how many were finished on Thursday" is a question somebody asks after the
 *  argument has already started (A5).
 *
 *  Entries that came from a signed overtime sheet are marked as such. That is
 *  the same night appearing in both places on purpose: typed once on the
 *  lembur sheet, posted here when leadership signs it (D147).
 */
export function WorkOrderDrawer({
  woNo, onClose, onChanged,
}: {
  woNo: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { can } = useSession();
  const { toast } = useToast();
  const [wo, reload] = useLoad(() => production.getWorkOrder(woNo), [woNo]);
  const [entries, reloadEntries] = useLoad(() => production.listProgress(woNo), [woNo]);
  /* What this run needs in materials, and what has already been asked for
     against it — the two halves of D151. */
  const [needs] = useLoad(
    () => (wo.status === "ready" && wo.data.product_code
      /* **The revision this order was pinned to** (D256), not today's. The
         projection an order is measured against is the list it was written
         from; using the current one would move the comparison every time
         somebody edits the catalogue. */
      ? production.materialsFor({
        product_code: wo.data.product_code, qty: wo.data.qty, rev: wo.data.bom_rev,
      })
      : Promise.resolve({ data: null, meta: null } as never)),
    [woNo, wo.status],
  );
  const [prLines, reloadPr] = useLoad(() => procurement.listLinesForWorkOrder(woNo), [woNo]);
  const [stage, setStage] = useState("");
  const [qty, setQty] = useState(1);
  /* Two pieces of state for one question, because the honest answer has two
     shapes: an employee, or a name that is not one of ours. Picking from the
     list fills both; typing a name fills only the name and leaves the link for
     somebody to make on purpose (D264). */
  const [who, setWho] = useState<{ id: string | null; name: string }>({ id: null, name: "" });
  const [people] = useLoad(() => hr.listEmployees(), []);
  const [note, setNote] = useState("");
  const [date, setDate] = useState(officeToday());
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [prBusy, setPrBusy] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  /* The vendor leg (D254). Vendors come from procurement, by public id, read
     at the screen because it spans two services (ADR-004). */
  const [vendorList] = useLoad(() => procurement.listVendors(), []);
  const vendors = vendorList.status === "ready" ? vendorList.data : [];
  const [vendorId, setVendorId] = useState("");
  const [expectBack, setExpectBack] = useState("");
  const [backOn, setBackOn] = useState(officeToday());
  const [subNote, setSubNote] = useState("");
  const [repinReason, setRepinReason] = useState("");

  /* Moving an open order onto a newer BOM revision. A decision with a reason,
     not a refresh — it changes what this job's real spend is measured against
     (D256). Refused by the API once anything has been built. */
  async function repin(w: WorkOrderView) {
    setBusy(true);
    const res = await production.repinBom({ wo_no: w.wo_no, reason: repinReason });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Tidak dipindahkan", res.error.message);
      return;
    }
    toast("success", `Dipindahkan ke rev ${res.data.bom_rev}`, "Proyeksinya dihitung ulang dari daftar itu.");
    setRepinReason("");
    reload(); onChanged();
  }
  const vendorName = wo.status === "ready" && wo.data.subcon_vendor_id
    ? vendors.find((v) => v.id === wo.data.subcon_vendor_id)?.name ?? null
    : null;
  const mayEdit = can("production.update");

  async function sendOut() {
    setBusy(true);
    const res = await production.sendToSubcon({
      wo_no: woNo, vendor_id: vendorId,
      expected_back: expectBack || null, note: subNote || null,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Tidak tercatat", res.error.message);
      return;
    }
    toast("success", "Dikirim ke vendor", vendors.find((v) => v.id === vendorId)?.name ?? "");
    setSubNote("");
    reload(); onChanged();
  }

  async function receiveBack() {
    setBusy(true);
    const res = await production.receiveFromSubcon({
      wo_no: woNo, returned_on: backOn, note: subNote || null,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Tidak tercatat", res.error.message);
      return;
    }
    toast("success", "Barang kembali", `Tahap finishing dan seterusnya sekarang bisa dicatat.`);
    setSubNote("");
    reload(); onChanged();
  }

  async function report() {
    setBusy(true);
    const res = await production.recordProgress({
      wo_no: woNo, stage, qty, work_date: date,
      worked_by: who.name || null,
      worked_by_employee_id: who.id,
      note: note || null,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Tidak tercatat", res.error.message);
      return;
    }
    toast("success", "Tercatat", `${formatNumber(qty)} unit · ${STAGE_NAME(stage)}`);
    setQty(1); setNote("");
    reload(); reloadEntries(); onChanged();
  }

  /** Turning a bill of material into a purchase request.
   *
   *  Composed at the screen because it spans two services (ADR-004):
   *  production says what the run needs, procurement records what somebody is
   *  asking to buy. Each line carries the SPK number, so the projection and
   *  the actual spend are later two sums over the same rows rather than two
   *  numbers nobody can reconcile (D151).
   *
   *  It creates a **draft**: the list still has to be read, priced and
   *  submitted by a person. A BOM is what a piece should need, not a decision
   *  to spend money.
   */
  async function raisePr(w: WorkOrderView) {
    if (needs.status !== "ready" || !needs.data) return;
    setPrBusy(true);
    const res = await procurement.createPr({
      project_code: w.project_code,
      /* **Every line of the exploded list** (D257). This used to filter to
         `kind === "material"`, which silently dropped the sub-assemblies — a
         wardrobe needing two drawer boxes raised a request with none of the
         plywood or runners inside them, and nothing on the screen said so
         (F78). The list is now already walked down to purchasable things;
         what could not be walked is listed as itself and says so in its
         purpose line, because something that has to be obtained somehow is
         not nothing. */
      lines: needs.data.lines.map((l) => {
        const unexploded = needs.data!.unexploded.includes(l.ref_code);
        const via = l.via[0]?.length ? ` (lewat ${l.via.map((v) => v.join(" → ")).join("; ")})` : "";
        return {
          description: l.ref_name ?? l.ref_code,
          qty: l.qty,
          /* The BOM's unit is free text; a request line's is a closed list.
             Passing it through only where it matches keeps the request's own
             vocabulary intact and leaves the rest for a person to pick. */
          uom: (UNITS as readonly string[]).includes(l.uom) ? (l.uom as UomCode) : null,
          unit_price: l.subtotal != null && l.qty > 0 ? Math.round(l.subtotal / l.qty) : null,
          purpose: `BOM ${w.wo_no} rev ${needs.data!.rev ?? "—"} — ${w.item_name}${
            w.project_code ? ` · proyek ${w.project_code}` : ""}${via}${
            unexploded ? " · sub-rakitan tanpa BOM, periksa apakah dibeli atau dibuat" : ""}`,
          need_by: w.due_date,
          source_wo_no: w.wo_no,
        };
      }),
    });
    setPrBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "PR tidak dibuat", res.error.message);
      return;
    }
    toast(
      "success",
      `PR ${res.data.doc_no} dibuat sebagai draft`,
      `${res.data.lines.length} baris dari BOM · masih harus dibaca dan diajukan orang.`,
    );
    reloadPr();
  }

  async function close() {
    setBusy(true);
    const res = await production.closeWorkOrder({ wo_no: woNo, reason: closeReason || null });
    setBusy(false);
    if (res.error) { toast("warning", "Belum ditutup", res.error.message); return; }
    toast("success", "Pesanan ditutup", woNo);
    setClosing(false);
    reload(); onChanged();
  }

  return (
    <Drawer
      open onClose={onClose} width="max-w-2xl"
      title={wo.status === "ready" ? wo.data.item_name : woNo}
      subtitle={wo.status === "ready"
        ? `${woNo}${wo.data.project_code ? ` · ${wo.data.project_code}` : ""} · jatuh tempo ${wo.data.due_date}`
        : undefined}
    >
      <Loaded state={wo} onRetry={reload}>
        {(w) => (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              {w.status === "DONE"
                ? <Badge tone="slate" dot>selesai</Badge>
                : w.subcon_overdue
                  ? <Badge tone="red" dot>vendor telat</Badge>
                  : w.late
                    ? <Badge tone="red" dot>terlambat {Math.abs(w.days_left)} hari</Badge>
                    : <Badge tone={w.days_left <= 3 ? "amber" : "green"} dot>{w.days_left} hari lagi</Badge>}
              <Badge tone={w.route === "SUBCON" ? "violet" : "slate"}>{w.route_name}</Badge>
              <span className="text-[12px] text-slate-600">
                {formatNumber(w.completed)}/{formatNumber(w.qty)} {w.uom} selesai · {w.percent}% keseluruhan · sekarang di {w.current_stage_name}
              </span>
            </div>
            {w.description && <p className="text-[13px] text-slate-600">{w.description}</p>}

            {w.warnings.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="flex items-center gap-2 text-[13px] font-semibold text-amber-900">
                  <AlertTriangle className="h-4 w-4" /> Perlu diperiksa
                </p>
                <ul className="mt-1 space-y-0.5 text-[12px] text-amber-900">
                  {w.warnings.map((x) => <li key={x}>· {x}</li>)}
                </ul>
              </div>
            )}

            {/* Every stage, with how far it got. */}
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {w.stages.map((s) => (
                <li key={s.stage} className="flex items-center gap-3 px-3 py-2">
                  <span className="w-5 text-[11px] tabular-nums text-slate-400">{s.seq}</span>
                  <span className="flex-1">
                    <span className="block text-[13px] text-slate-700">{s.name}</span>
                    {/* The old seven-stage entries that rolled up here, with
                        their own totals — so the minimum can be checked rather
                        than believed (F74). */}
                    {s.parts.length > 0 ? (
                      <span className="block text-[11px] text-slate-400">
                        {s.parts.map((x) => `${x.name} ${formatNumber(x.done)}`).join(" · ")}
                        {" → yang selesai sepenuhnya "}{formatNumber(s.done)}
                      </span>
                    ) : (
                      <span className="block text-[11px] text-slate-400">{s.covers}</span>
                    )}
                  </span>
                  <span className="w-32">
                    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <span
                        className={cn("block h-full rounded-full", s.done >= w.qty ? "bg-emerald-500" : "bg-amber-400")}
                        style={{ width: `${Math.min(Math.max(s.percent, 0), 100)}%` }}
                      />
                    </span>
                  </span>
                  <span className="w-20 text-right text-[12px] tabular-nums text-slate-700">
                    {formatNumber(s.done)}/{formatNumber(w.qty)}
                  </span>
                </li>
              ))}
            </ul>

            {/* The vendor leg. Present on every SUBCON order, editable while it
                is open — where the goods physically are decides what may be
                reported against them (D255). */}
            {w.route === "SUBCON" && (
              <div className={cn(
                "rounded-xl border px-4 py-3",
                w.subcon_overdue ? "border-rose-200 bg-rose-50/60" : "border-violet-200 bg-violet-50/50",
              )}>
                <p className="flex items-center gap-2 text-[13px] font-medium text-slate-800">
                  <Factory className="h-4 w-4 text-violet-500" /> Dikerjakan vendor
                </p>
                <p className="mt-0.5 text-[12px] text-slate-600">
                  {w.subcon_vendor_id
                    ? vendorName ?? w.subcon_vendor_id
                    : "Vendor belum ditentukan"}
                  {w.subcon_sent_on && <> · dikirim {w.subcon_sent_on}</>}
                  {w.subcon_expected_back && (
                    <> · dijanjikan kembali <span className="text-amber-700">± {w.subcon_expected_back}</span></>
                  )}
                  {w.subcon_returned_on
                    ? <> · <span className="text-emerald-700">kembali {w.subcon_returned_on}</span></>
                    : w.at_vendor && <> · sudah {w.days_at_vendor} hari di sana</>}
                </p>
                {w.subcon_note && <p className="mt-0.5 text-[12px] text-slate-500">{w.subcon_note}</p>}
                {w.at_vendor && (
                  <p className="mt-1 text-[12px] text-violet-900">
                    Barangnya tidak ada di bengkel, jadi tidak ada tahap yang bisa dilaporkan sampai
                    ia kembali.
                  </p>
                )}
                {mayEdit && w.status === "OPEN" && (
                  <div className="mt-2">
                    {w.at_vendor ? (
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="text-[11px] text-slate-500">
                          Tanggal kembali
                          <input
                            type="date" value={backOn} onChange={(e) => setBackOn(e.target.value)}
                            className="mt-0.5 block h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                          />
                        </label>
                        <input
                          value={subNote} onChange={(e) => setSubNote(e.target.value)}
                          placeholder="Catatan penerimaan — kondisi, kekurangan"
                          className="h-9 min-w-[200px] flex-1 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                        />
                        <Button size="sm" icon={PackageCheck} disabled={busy} onClick={receiveBack}>
                          Catat barang kembali
                        </Button>
                      </div>
                    ) : !w.subcon_sent_on && (
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="text-[11px] text-slate-500">
                          Vendor
                          <select
                            value={vendorId} onChange={(e) => setVendorId(e.target.value)}
                            className="mt-0.5 block h-9 min-w-[200px] rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                          >
                            <option value="">Pilih vendor…</option>
                            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                          </select>
                        </label>
                        <label className="text-[11px] text-slate-500">
                          Dijanjikan kembali
                          <input
                            type="date" value={expectBack} onChange={(e) => setExpectBack(e.target.value)}
                            className="mt-0.5 block h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                          />
                        </label>
                        <Button size="sm" icon={Factory} disabled={busy || !vendorId} onClick={sendOut}>
                          Catat dikirim ke vendor
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Gated on the **same predicate the API refuses on** (F75), not on
                a lookalike condition that drifts away from it. */}
            {mayEdit && w.status === "OPEN" && w.goods_on_site && (
              <div className="rounded-xl border border-slate-200 px-4 py-3">
                <p className="flex items-center gap-2 text-[13px] font-medium text-slate-800">
                  <Hammer className="h-4 w-4 text-slate-400" /> Catat hasil kerja
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_90px_140px]">
                  <select
                    value={stage} onChange={(e) => setStage(e.target.value)}
                    aria-label="Tahap"
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  >
                    <option value="">Tahap…</option>
                    {/* Only what this order's route contains. Offering a stage
                        the API will refuse is a trap, not a choice (D254). */}
                    {w.stages.map((s) => (
                      <option key={s.stage} value={s.stage}>{s.seq}. {s.name}</option>
                    ))}
                  </select>
                  <NumberInput value={qty} min={-999} max={9999} onChange={setQty} />
                  <input
                    type="date" value={date} onChange={(e) => setDate(e.target.value)}
                    aria-label="Tanggal"
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  />
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {/* A picker that still accepts a name it does not know:
                      *Tim potong* and a subcontractor's crew are real answers,
                      and a closed list here would make the record lie about who
                      does the work. Choosing a person links the entry; typing a
                      name does not, and `/produksi/penautan` is where that gets
                      resolved later (D264). */}
                  <Combobox
                    value={who.id ?? (who.name ? "free" : "")}
                    onChange={(v) => {
                      if (v === "free") return;
                      const emp = people.status === "ready" ? people.data.find((e) => e.id === v) : undefined;
                      setWho(emp ? { id: emp.id, name: emp.full_name } : { id: null, name: "" });
                    }}
                    onCreate={(name) => setWho({ id: null, name })}
                    createLabel={(q) => `Pakai nama “${q}” — bukan karyawan`}
                    options={[
                      ...(people.status === "ready" ? people.data : []).map((e) => ({
                        value: e.id,
                        label: e.full_name,
                        sublabel: `${e.employee_no} · ${e.unit}`,
                      })),
                      ...(who.id === null && who.name
                        ? [{ value: "free", label: who.name, sublabel: "nama saja — belum tertaut" }]
                        : []),
                    ]}
                    placeholder="Siapa yang mengerjakan"
                  />
                  <input
                    value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="Catatan — wajib kalau jumlahnya negatif (koreksi)"
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  />
                </div>
                <div className="mt-2 flex justify-end gap-2">
                  {w.completed >= w.qty || closing ? null : (
                    <Button size="sm" variant="ghost" onClick={() => setClosing(true)}>Tutup pesanan</Button>
                  )}
                  <Button size="sm" icon={Plus} onClick={report} disabled={busy || !stage || qty === 0}>
                    Catat
                  </Button>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Koreksi ditulis sebagai angka negatif dengan alasan — catatan lama tidak pernah diubah.
                </p>
              </div>
            )}

            {mayEdit && w.status === "OPEN" && (closing || w.completed >= w.qty) && (
              <div className="rounded-xl border border-slate-200 px-4 py-3">
                <p className="flex items-center gap-2 text-[13px] font-medium text-slate-800">
                  <CheckCircle2 className="h-4 w-4 text-slate-400" /> Tutup pesanan
                </p>
                {w.completed < w.qty && (
                  <input
                    value={closeReason} onChange={(e) => setCloseReason(e.target.value)}
                    placeholder={`Baru ${formatNumber(w.completed)} dari ${formatNumber(w.qty)} — kenapa ditutup?`}
                    className="mt-2 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  />
                )}
                <div className="mt-2 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setClosing(false)} disabled={busy}>Batal</Button>
                  <Button size="sm" onClick={close} disabled={busy}>Tutup</Button>
                </div>
              </div>
            )}

            {/* Projected against actual: what the BOM says this run needs, and
                what has been asked for against it (D151). */}
            <Loaded state={needs} skeletonRows={2}>
              {(need) => (
                <Loaded state={prLines} onRetry={reloadPr} skeletonRows={1}>
                  {(raised) => {
                    const live = raised.filter((l) => !l.removed_at);
                    const asked = live.reduce((a, l) => a + l.item_total, 0);
                    /* Only what somebody said yes to — `coverage.approved` falls
                       back to the asked amount when no approval exists (D151). */
                    const approved = live
                      .filter((l) => l.approval?.approved)
                      .reduce((a, l) => a + l.coverage.approved, 0);
                    const paid = live.reduce((a, l) => a + l.coverage.covered, 0);
                    return (
                      <div className="rounded-xl border border-slate-200 px-4 py-3">
                        <p className="flex items-center gap-2 text-[13px] font-medium text-slate-800">
                          <ShoppingCart className="h-4 w-4 text-slate-400" />
                          Bahan: proyeksi dari BOM vs yang benar-benar dibeli
                        </p>
                        {/* Which list this is measured against, and whether the
                            catalogue has moved on since (D256). */}
                        {w.product_code && (
                          <p className="mt-0.5 text-[12px] text-slate-500">
                            {w.bom_rev == null ? (
                              <span className="text-amber-700">
                                Pesanan ini dibuat sebelum BOM diberi versi — versi yang benar-benar
                                dipakai tidak pernah tercatat, jadi tidak ada proyeksi yang jujur
                                untuk ditampilkan.
                              </span>
                            ) : (
                              <>
                                Diukur terhadap <strong className="text-slate-700">rev {w.bom_rev}</strong>
                                {w.bom_drifted && (
                                  <span className="text-amber-700">
                                    {" "}— katalog sekarang sudah di rev {w.product_current_rev}. Angkanya
                                    sengaja tetap memakai rev {w.bom_rev}: itu daftar yang dipakai waktu
                                    pesanan ini ditulis.
                                  </span>
                                )}
                              </>
                            )}
                          </p>
                        )}
                        {/* Gated on the predicate the API refuses on (F75). */}
                        {mayEdit && w.bom_repinnable && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <input
                              value={repinReason} onChange={(e) => setRepinReason(e.target.value)}
                              placeholder={`Kenapa pindah ke rev ${w.product_current_rev}? Angka pembandingnya berubah.`}
                              className="h-9 min-w-[220px] flex-1 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                            />
                            <Button
                              size="sm" variant="outline" icon={GitBranch}
                              disabled={busy || !repinReason.trim()} onClick={() => repin(w)}
                            >
                              Pindahkan ke rev {w.product_current_rev}
                            </Button>
                          </div>
                        )}
                        {!need ? (
                          <p className="mt-1 text-[12px] text-slate-500">
                            Pesanan ini tidak menunjuk produk di katalog, jadi tidak ada BOM untuk
                            diproyeksikan.
                          </p>
                        ) : (
                          <>
                            {/* The walk, said plainly: what it went through and
                                what it could not get into (D257). */}
                            {need.cycle && (
                              <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-900">
                                <strong>BOM ini memuat dirinya sendiri:</strong>{" "}
                                {need.cycle.join(" → ")}. Kebutuhan bahannya tidak terhingga, jadi tidak
                                dihitung — bukan nol. Perbaiki BOM-nya dulu.
                              </p>
                            )}
                            {need.sub_assemblies.length > 0 && (
                              <p className="mt-2 text-[12px] text-slate-600">
                                Lewat {need.sub_assemblies.length} sub-rakitan:{" "}
                                {need.sub_assemblies.map((sa) => (
                                  `${formatNumber(sa.qty)}× ${sa.name ?? sa.product_code}`
                                )).join(" · ")}
                                {" "}— yang di bawah ini sudah bahan yang benar-benar dibeli, bukan
                                nama rakitannya.
                              </p>
                            )}
                            {need.unexploded.length > 0 && (
                              <p className="mt-1 text-[12px] text-amber-800">
                                {need.unexploded.join(", ")} belum punya BOM yang dirilis, jadi tetap
                                tercantum sebagai dirinya sendiri — harus diperiksa apakah dibeli atau
                                dibuat.
                              </p>
                            )}
                            <dl className="mt-2 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3 lg:grid-cols-5">
                              {([
                                ["Proyeksi bahan", need.total == null ? "—" : formatIDR(need.total),
                                  `${formatNumber(w.qty)} ${w.uom}${need.unpriced > 0 ? ` · ${need.unpriced} tanpa harga` : ""}`],
                                ["Tenaga kerja", need.labour_total == null ? "—" : formatIDR(need.labour_total),
                                  need.labour_total == null
                                    ? "belum pernah dihitung orang"
                                    : "diketik, bukan dihitung sistem"],
                                ["Diminta (PR)", live.length === 0 ? "—" : formatIDR(asked), `${live.length} baris`],
                                ["Disetujui", live.length === 0 ? "—" : formatIDR(approved), "dari yang diminta"],
                                ["Terbayar", live.length === 0 ? "—" : formatIDR(paid), "sudah keluar uangnya"],
                              ] as [string, string, string][]).map(([k, v, note]) => (
                                <div key={k}>
                                  <dt className="text-[10px] uppercase tracking-wide text-slate-400">{k}</dt>
                                  <dd className="font-semibold tabular-nums text-slate-800">{v}</dd>
                                  <p className="text-[10px] text-slate-500">{note}</p>
                                </div>
                              ))}
                            </dl>
                            {need.total != null && asked > 0 && (
                              <p className={cn(
                                "mt-2 text-[12px]",
                                asked === need.total ? "text-slate-500"
                                  : asked > need.total ? "text-amber-800" : "text-emerald-700",
                              )}>
                                {asked === need.total
                                  /* At draft they match, because both took the
                                     same catalogue price. The divergence is
                                     what happens next: a quantity edited, a
                                     vendor quoting more, a second PR raised
                                     when something ran out (D151). */
                                  ? "Sama persis dengan proyeksi — harganya memang diambil dari katalog yang sama. Selisih baru muncul saat jumlah diubah, vendor menawar lain, atau ada PR susulan."
                                  : asked > need.total
                                    ? `Permintaan ${formatIDR(asked - need.total)} di atas proyeksi BOM.`
                                    : `Permintaan ${formatIDR(need.total - asked)} di bawah proyeksi BOM.`}
                              </p>
                            )}
                            {live.length > 0 && (
                              <ul className="mt-2 divide-y divide-slate-100 text-[12px]">
                                {live.map((l) => (
                                  <li key={l.id} className="flex flex-wrap items-center gap-2 py-1.5">
                                    <Link href="/procurement/pr" className="font-mono text-[10px] text-brand-700 underline">
                                      {l.line_no_full}
                                    </Link>
                                    <span className="flex-1 text-slate-700">{l.description}</span>
                                    <span className="tabular-nums text-slate-600">{formatIDR(l.item_total)}</span>
                                    <Badge tone={l.coverage.covered > 0 ? "green" : "slate"}>{l.status}</Badge>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {mayEdit && w.status === "OPEN" && (
                              <>
                                <Button
                                  size="sm" variant="outline" icon={ShoppingCart} className="mt-2"
                                  disabled={prBusy || need.lines.length === 0}
                                  onClick={() => raisePr(w)}
                                >
                                  {live.length > 0 ? "Buat PR lagi dari BOM" : "Buat PR dari BOM"}
                                </Button>
                                <p className="mt-1 text-[11px] text-slate-500">
                                  Dibuat sebagai <strong>draft</strong>: daftarnya masih harus dibaca,
                                  dihargai dan diajukan orang. BOM adalah kebutuhan, bukan keputusan
                                  membelanjakan uang.
                                  {live.length > 0 && " Sudah pernah dibuat — periksa dulu supaya tidak dobel."}
                                </p>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    );
                  }}
                </Loaded>
              )}
            </Loaded>

            {/* Work against steps the business no longer has. Shown apart from
                the four rather than inside one of them: the cutting is bought
                in now, and six pieces cut is not six pieces sanded (D275). */}
            {w.retired.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">
                  Tahap lama, sudah tidak dipakai
                </p>
                <p className="mt-1 text-[13px] text-slate-700">
                  {w.retired.map((r) => `${r.name} ${formatNumber(r.done)}`).join(" · ")}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Dicatat waktu bengkel masih memotong dan merakit sendiri. Sekarang barang mentahnya
                  dibeli jadi, jadi langkah-langkah ini tidak ada lagi di papan — angkanya tetap disimpan
                  dan tidak pernah dihitung sebagai bagian dari empat tahap sekarang.
                </p>
              </div>
            )}

            {/* What the run should take against what actually left the rack.
                Nothing here deducts automatically: the BOM proposes and the
                storeman disposes, because he is the one who carried it (D266). */}
            <MaterialPanel woNo={woNo} onChanged={onChanged} />

            {/* The entries themselves — including the ones a signed lembur
                sheet posted. */}
            <Loaded state={entries} onRetry={reloadEntries} skeletonRows={3}>
              {(rows) => (
                <div>
                  <p className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-400">
                    Riwayat ({rows.length})
                  </p>
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {rows.length === 0 && (
                      <li className="px-3 py-3 text-[13px] text-slate-500">Belum ada yang dicatat.</li>
                    )}
                    {rows.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-[12px]">
                        <span className="w-20 tabular-nums text-slate-500">{p.work_date}</span>
                        <span className="w-24 text-slate-700">{STAGE_NAME(p.stage)}</span>
                        <span className={cn("w-12 text-right tabular-nums", p.qty < 0 ? "text-rose-700" : "text-slate-800")}>
                          {p.qty > 0 ? "+" : ""}{formatNumber(p.qty)}
                        </span>
                        <span className="flex-1 text-slate-500">
                          {p.worked_by ?? "—"}
                          {/* The name is what was written down; the state of its
                              link is a separate fact and is shown as one. */}
                          {p.worked_by && attributionOf(p) !== "employee" && (
                            <span className={cn("ml-1.5 text-[10px]",
                              attributionOf(p) === "unknown" ? "text-amber-600" : "text-slate-400")}>
                              ({ATTRIBUTION_LABEL[attributionOf(p)].toLowerCase()})
                            </span>
                          )}
                          {p.note && <span className="text-slate-400"> · {p.note}</span>}
                        </span>
                        {p.source === "overtime_sheet" && (
                          <Badge tone="brand">lembur {p.source_ref}</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Loaded>
          </div>
        )}
      </Loaded>
    </Drawer>
  );
}

/* ── Material against the SPK ─────────────────────────────────────────── */

function MaterialPanel({ woNo, onChanged }: { woNo: string; onChanged: () => void }) {
  const { can } = useSession();
  const { toast } = useToast();
  const mayIssue = can("inventory.update");
  const [plan, reloadPlan] = useLoad(() => inventory.materialForWorkOrder(woNo), [woNo]);
  const [locations] = useLoad(() => inventory.listStockLocations(), []);
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function issue() {
    const lines = Object.entries(qty)
      .filter(([, n]) => n > 0)
      .map(([item_code, n]) => ({ item_code, qty: n }));
    setBusy(true);
    const res = await inventory.issueForWorkOrder({
      wo_no: woNo, location, lines, note: note || null,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 409 ? "critical" : "warning", "Tidak dikeluarkan", res.error.message);
      return;
    }
    if (res.data.negative.length > 0) {
      /* Recorded, and said out loud. The wood is off the rack whatever the
         screen thought; what must not happen is silence (A6). */
      toast("warning", `${res.data.issued} barang keluar — stok tercatat minus`,
        res.data.negative.map((n) => `${n.item_name} ${n.on_hand_after}`).join(" · "));
    } else {
      toast("success", `${res.data.issued} barang keluar`, `Dicatat atas ${woNo}.`);
    }
    setQty({}); setNote(""); setOpen(false);
    reloadPlan(); onChanged();
  }

  return (
    <Loaded state={plan} onRetry={reloadPlan} skeletonRows={3}>
      {(p) => (
        <div>
          <p className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-slate-400">
            {/* Not just "Bahan": the drawer already has a *Bahan* figure a few
                centimetres above it, and that one is the BOM's rupiah. This one
                is stock that physically left the rack. */}
            Bahan yang keluar ke bengkel
            {p.rev !== null && <Badge tone="slate">BOM rev {p.rev}</Badge>}
            {p.variance_readable
              ? <Badge tone="green">selesai — selisih bisa dibaca</Badge>
              : <Badge tone="slate">{p.completed}/{p.ordered} jadi</Badge>}
          </p>

          {p.no_plan_reason ? (
            <p className="rounded-xl border border-slate-200 px-3 py-2.5 text-[13px] text-slate-500">
              {p.no_plan_reason}
              {p.lines.length > 0 && " Yang sudah dikeluarkan tetap tercatat di bawah."}
            </p>
          ) : null}

          {p.lines.length === 0 ? (
            !p.no_plan_reason && (
              <p className="rounded-xl border border-slate-200 px-3 py-2.5 text-[13px] text-slate-500">
                Belum ada bahan yang dikeluarkan atas SPK ini.
              </p>
            )
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {p.lines.map((l) => (
                <li key={l.item_code} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-[12px]">
                  <span className="min-w-[160px] flex-1">
                    <span className="block text-slate-700">{l.item_name}</span>
                    <span className="block text-[10px] text-slate-400">
                      {l.item_code} · rak {formatNumber(l.on_hand)} {l.uom}
                    </span>
                  </span>
                  <span className="w-20 text-right tabular-nums text-slate-500">
                    {/* Missing, never zero: a BOM that does not mention this
                        item has no expectation of it (F60). */}
                    {l.expected === null ? "—" : formatNumber(l.expected)}
                  </span>
                  <span className="w-20 text-right tabular-nums text-slate-800">{formatNumber(l.issued)}</span>
                  <span className={cn("w-20 text-right tabular-nums",
                    l.remaining === null ? "text-slate-400"
                      : l.remaining < 0 ? "text-amber-700" : "text-slate-500")}>
                    {l.remaining === null ? "—" : formatNumber(l.remaining)}
                  </span>
                  {l.off_bom && <Badge tone="amber">di luar BOM</Badge>}
                  {mayIssue && open && (
                    <NumberInput
                      value={qty[l.item_code] ?? 0} min={0} max={99_999}
                      onChange={(n) => setQty((q) => ({ ...q, [l.item_code]: n }))}
                    />
                  )}
                </li>
              ))}
              <li className="flex flex-wrap items-center gap-x-3 px-3 py-1.5 text-[10px] uppercase tracking-wide text-slate-400">
                <span className="min-w-[160px] flex-1" />
                <span className="w-20 text-right">seharusnya</span>
                <span className="w-20 text-right">keluar</span>
                <span className="w-20 text-right">sisa</span>
              </li>
            </ul>
          )}

          {!p.variance_readable && p.lines.some((l) => l.remaining !== null) && (
            <p className="mt-1 text-[11px] text-slate-500">
              Selisihnya belum berarti apa-apa selama pesanan belum selesai — separuh pesanan baru
              mengambil separuh bahannya, dan menyebut itu penghematan mengajarkan orang mengabaikan
              angkanya.
            </p>
          )}

          {mayIssue && (
            <div className="mt-2">
              {!open ? (
                <Button size="sm" variant="outline" icon={PackageCheck} onClick={() => {
                  setOpen(true);
                  /* Pre-filled with what is left, because that is the usual
                     trip — and editable, because the list is a proposal and
                     what actually went to the bench is the record. */
                  setQty(Object.fromEntries(p.lines
                    .filter((l) => (l.remaining ?? 0) > 0)
                    .map((l) => [l.item_code, l.remaining as number])));
                }}>
                  Keluarkan bahan
                </Button>
              ) : (
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={location} onChange={(e) => setLocation(e.target.value)}
                      aria-label="Lokasi"
                      className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                    >
                      <option value="">Dari lokasi…</option>
                      {locations.status === "ready" && locations.data.filter((l) => l.is_active).map((l) => (
                        <option key={l.code} value={l.code}>{l.name}</option>
                      ))}
                    </select>
                    <input
                      value={note} onChange={(e) => setNote(e.target.value)}
                      placeholder="Catatan (opsional)"
                      className="h-9 flex-1 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                    />
                  </div>
                  {/* Said before the confirm, not only after it. The issue is
                      still allowed — the wood is off the rack or it is not, and
                      refusing to record it teaches people to stop recording
                      (A6) — but a storeman about to send the count negative
                      should find that out while he can still change the number. */}
                  {(() => {
                    const short = p.lines.filter((l) => (qty[l.item_code] ?? 0) > l.on_hand);
                    if (short.length === 0) return null;
                    return (
                      <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
                        {short.length} barang akan membuat stok tercatat minus:{" "}
                        {short.map((l) => `${l.item_name} (rak ${formatNumber(l.on_hand)}, diambil ${formatNumber(qty[l.item_code] ?? 0)})`).join(" · ")}.
                        Tetap boleh dicatat — kalau memang barangnya dibawa, catatannya yang harus
                        menyesuaikan, bukan sebaliknya.
                      </p>
                    );
                  })()}
                  <p className="mt-2 text-[11px] text-slate-500">
                    Angkanya sudah diisi dari BOM sebagai <strong>usulan</strong>. Ubah ke jumlah yang
                    benar-benar dibawa ke bengkel — yang dicatat adalah barang yang keluar, bukan barang
                    yang seharusnya keluar. Stok tidak pernah berkurang sendiri dari laporan produksi.
                  </p>
                  <div className="mt-2 flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setQty({}); }}>
                      Batal
                    </Button>
                    <Button size="sm" icon={PackageCheck} onClick={issue} disabled={busy || !location}>
                      Catat keluar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Loaded>
  );
}
