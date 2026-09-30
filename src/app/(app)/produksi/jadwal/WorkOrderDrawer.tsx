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
import { STAGE_NAME, attributionOf, ATTRIBUTION_LABEL, VENDOR_PROCESSES, VENDOR_PROCESS_NAME, MATERIAL_STATUS_LABEL, type WorkOrderView } from "@/services/production/contracts";
import { useUnits } from "@/components/ui/uom-options";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { officeStamp, officeToday, OFFICE_TZ } from "@/lib/office";
import { spanLabel } from "@/services/production/progress-view";
import { ProgressOverTime } from "./ProgressPanels";
import { JobProductivity, PositionLine, SlotForm, SlotList, lastFullHour, nextDay } from "./WorkSlots";
import { useTr } from "@/lib/i18n";

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
  const tr = useTr();
  const { can } = useSession();
  const { toast } = useToast();
  const [wo, reload] = useLoad(() => production.getWorkOrder(woNo), [woNo]);
  const [entries, reloadEntries] = useLoad(() => production.listProgress(woNo), [woNo]);
  /* Who worked on what, for how long (D350). */
  const [slots, reloadSlots] = useLoad(() => production.listWorkSlots({ wo_no: woNo }), [woNo]);
  /* The count on its own — a correction, or pieces nobody timed — sits behind
     a toggle: the timeslot is how the floor reports now. */
  const [showCount, setShowCount] = useState(false);
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
  /* When it was worked, on the office clock (D349). Prefilled with the last
     full hour, because the floor reports hour by hour; cleared, the entry is
     filed under its day only — which is honest for a correction or a sheet
     typed at the end of the week. */
  const [span, setSpan] = useState(lastFullHour);
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [prBusy, setPrBusy] = useState(false);
  const [closeReason, setCloseReason] = useState("");
  /* The vendor leg (D254). Vendors come from procurement, by public id, read
     at the screen because it spans two services (ADR-004). */
  const [vendorList] = useLoad(() => procurement.listVendors(), []);
  const units = useUnits();
  const vendors = vendorList.status === "ready" ? vendorList.data : [];
  const [vendorId, setVendorId] = useState("");
  const [expectBack, setExpectBack] = useState("");
  const [backOn, setBackOn] = useState(officeToday());
  const [subNote, setSubNote] = useState("");
  const [process, setProcess] = useState("");
  const [sendQty, setSendQty] = useState(1);
  const [backQty, setBackQty] = useState<Record<string, number>>({});
  const [repinReason, setRepinReason] = useState("");

  /* Moving an open order onto a newer BOM revision. A decision with a reason,
     not a refresh — it changes what this job's real spend is measured against
     (D256). Refused by the API once anything has been built. */
  async function repin(w: WorkOrderView) {
    setBusy(true);
    const res = await production.repinBom({ wo_no: w.wo_no, reason: repinReason });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not moved", "Tidak dipindahkan"), res.error.message);
      return;
    }
    toast("success", tr(`Moved to rev ${res.data.bom_rev}`, `Dipindahkan ke rev ${res.data.bom_rev}`), tr("The projection is recalculated from that list.", "Proyeksinya dihitung ulang dari daftar itu."));
    setRepinReason("");
    reload(); onChanged();
  }
  const mayEdit = can("production.update");

  async function sendOut() {
    setBusy(true);
    const res = await production.sendToVendor({
      wo_no: woNo, vendor_id: vendorId, process, qty: sendQty,
      expected_back: expectBack || null, note: subNote || null,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not recorded", "Tidak tercatat"), res.error.message);
      return;
    }
    toast("success", tr("Sent to the vendor", "Dikirim ke vendor"),
      `${vendors.find((v) => v.id === vendorId)?.name ?? ""} · ${VENDOR_PROCESS_NAME(process)}`);
    setSubNote(""); setProcess(""); setVendorId("");
    reload(); onChanged();
  }

  /** Per leg, because *what came back* is a question about one trip — and the
   *  quantity is part of the answer, not a tick (W6, D280). */
  async function receiveLeg(legNo: string, qtyBack: number) {
    setBusy(true);
    const res = await production.receiveFromVendor({
      leg_no: legNo, returned_qty: qtyBack, returned_on: backOn, note: subNote || null,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not recorded", "Tidak tercatat"), res.error.message);
      return;
    }
    toast("success", tr("Goods returned", "Barang kembali"), tr(`${formatNumber(qtyBack)} recorded as back from the vendor.`, `${formatNumber(qtyBack)} dicatat kembali dari vendor.`));
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
      /* Half a span is passed as half, so the API names it rather than the
         screen quietly dropping the end somebody typed. A finish at or before
         the start is the overnight shift, and belongs to the next morning. */
      started_at: span.from ? officeStamp(date, span.from) : null,
      finished_at: span.until
        ? officeStamp(span.from && span.until <= span.from ? nextDay(date) : date, span.until)
        : null,
    });
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not recorded", "Tidak tercatat"), res.error.message);
      return;
    }
    toast("success", tr("Recorded", "Tercatat"), `${formatNumber(qty)} unit · ${STAGE_NAME(stage)}${span.from && span.until ? ` · ${span.from}–${span.until}` : ""}`);
    setQty(1); setNote("");
    /* The next hour is the likeliest next report. */
    if (span.from && span.until && span.until > span.from) setSpan({ from: span.until, until: addHour(span.until) });
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
          /* The BOM's unit is free text; a request line's is a unit the
             database knows (a foreign key). Passing it through only where it
             matches keeps the request's own vocabulary intact and leaves the
             rest for a person to pick. */
          uom: units?.some((u) => u.code === l.uom) ? l.uom : null,
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
      toast(res.error.status === 403 ? "critical" : "warning", tr("PR not created", "PR tidak dibuat"), res.error.message);
      return;
    }
    toast(
      "success",
      tr(`PR ${res.data.doc_no} created as a draft`, `PR ${res.data.doc_no} dibuat sebagai draft`),
      tr(
        `${res.data.lines.length} lines from the BOM · still has to be read and submitted by a person.`,
        `${res.data.lines.length} baris dari BOM · masih harus dibaca dan diajukan orang.`,
      ),
    );
    reloadPr();
  }

  async function close() {
    setBusy(true);
    const res = await production.closeWorkOrder({ wo_no: woNo, reason: closeReason || null });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not closed yet", "Belum ditutup"), res.error.message); return; }
    toast("success", tr("Job Order closed", "Job Order ditutup"), woNo);
    setClosing(false);
    reload(); onChanged();
  }

  return (
    <Drawer
      open onClose={onClose} width="max-w-2xl"
      title={wo.status === "ready" ? wo.data.item_name : woNo}
      subtitle={wo.status === "ready"
        ? tr(
          `${woNo}${wo.data.project_code ? ` · ${wo.data.project_code}` : ""} · due ${wo.data.due_date}`,
          `${woNo}${wo.data.project_code ? ` · ${wo.data.project_code}` : ""} · jatuh tempo ${wo.data.due_date}`,
        )
        : undefined}
    >
      <Loaded state={wo} onRetry={reload}>
        {(w) => (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              {w.status === "DONE"
                ? <Badge tone="slate" dot>{tr("done", "selesai")}</Badge>
                : w.subcon_overdue
                  ? <Badge tone="red" dot>{tr("vendor late", "vendor telat")}</Badge>
                  : w.late
                    ? <Badge tone="red" dot>{tr(`${Math.abs(w.days_left)} days late`, `terlambat ${Math.abs(w.days_left)} hari`)}</Badge>
                    : <Badge tone={w.days_left <= 3 ? "amber" : "green"} dot>{tr(`${w.days_left} days left`, `${w.days_left} hari lagi`)}</Badge>}
              <Badge tone={w.route === "SUBCON" ? "violet" : "slate"}>{w.route_name}</Badge>
              <span className="text-[12px] text-slate-600">
                {tr(`${w.percent}% overall · now at ${w.current_stage_name}`, `${w.percent}% keseluruhan · sekarang di ${w.current_stage_name}`)}
              </span>
            </div>
            {/* The project manager's line (D350): where the pieces are. */}
            <PositionLine wo={w} className="rounded-lg bg-slate-50 px-3 py-2" />
            {w.description && <p className="text-[13px] text-slate-600">{w.description}</p>}

            {w.warnings.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="flex items-center gap-2 text-[13px] font-semibold text-amber-900">
                  <AlertTriangle className="h-4 w-4" /> {tr("Needs checking", "Perlu diperiksa")}
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
                        {tr(" → fully finished ", " → yang selesai sepenuhnya ")}{formatNumber(s.done)}
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

            {/* Every trip this order has made to a vendor (W6, D280).
                One block per leg, because a piece can go to the upholsterer
                and then to the sander, and *where is my chair* is answerable
                only if each trip has its own dates. */}
            {(w.legs.length > 0 || w.route === "SUBCON") && (
              <div className="rounded-xl border border-violet-200 bg-violet-50/40 px-4 py-3">
                <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium text-slate-800">
                  <Factory className="h-4 w-4 text-violet-500" /> {tr("Done by a vendor", "Dikerjakan vendor")}
                  {w.at_vendor_qty > 0 && (
                    <Badge tone="violet">{tr(`${formatNumber(w.at_vendor_qty)} ${w.uom} out`, `${formatNumber(w.at_vendor_qty)} ${w.uom} di luar`)}</Badge>
                  )}
                </p>

                {w.legs.length === 0 ? (
                  <p className="mt-1 text-[12px] text-slate-600">
                    {tr("Nothing has been sent to a vendor for this Job Order yet.", "Belum ada yang dikirim ke vendor untuk Job Order ini.")}
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {w.legs.map((l) => (
                      <li key={l.id} className={cn(
                        "rounded-lg border px-3 py-2 text-[12px]",
                        l.overdue_days !== null ? "border-rose-200 bg-rose-50/70"
                          : l.returned_on ? "border-slate-200 bg-white"
                            : "border-violet-200 bg-white",
                      )}>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-medium text-slate-800">{l.process_name}</span>
                          <span className="text-slate-500">· {l.vendor_name}</span>
                          <span className="text-slate-500">· {formatNumber(l.qty)} {w.uom}</span>
                          <span className="font-mono text-[10px] text-slate-400">{l.leg_no}</span>
                        </div>
                        <div className="text-slate-600">
                          {tr("sent", "dikirim")} {l.sent_on}
                          {/* A promise, marked as one wherever it is printed (D234). */}
                          {l.expected_back
                            ? <> · {tr("promised back", "dijanjikan kembali")} <span className="text-amber-700">± {l.expected_back}</span></>
                            : <> · <span className="text-slate-400">{tr("no promised return date", "tanpa janji tanggal kembali")}</span></>}
                          {l.returned_on
                            ? <> · <span className="text-emerald-700">{tr(`back ${l.returned_on}, ${formatNumber(l.returned_qty ?? 0)} ${w.uom}`, `kembali ${l.returned_on}, ${formatNumber(l.returned_qty ?? 0)} ${w.uom}`)}</span></>
                            : <> · {tr(`${l.days_out} days there so far`, `sudah ${l.days_out} hari di sana`)}</>}
                        </div>
                        {l.overdue_days !== null && (
                          <p className="text-rose-800">{tr(`${l.overdue_days} days past the promise.`, `Lewat janji ${l.overdue_days} hari.`)}</p>
                        )}
                        {/* Fewer came back than went. A question for the vendor,
                            and a tick-box would have lost it. */}
                        {l.short_by !== null && (
                          <p className="text-amber-800">
                            {tr(`${formatNumber(l.short_by)} ${w.uom} short of what was sent.`, `Kurang ${formatNumber(l.short_by)} ${w.uom} dari yang dikirim.`)}
                          </p>
                        )}
                        {l.note && <p className="text-slate-500">{l.note}</p>}
                        {mayEdit && w.status === "OPEN" && l.returned_on === null && (
                          <div className="mt-1.5 flex flex-wrap items-end gap-2">
                            <label className="text-[11px] text-slate-500">
                              {tr("Back on", "Kembali")}
                              <input
                                type="date" value={backOn} onChange={(e) => setBackOn(e.target.value)}
                                className="mt-0.5 block h-8 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                              />
                            </label>
                            <label className="text-[11px] text-slate-500">
                              {tr("Quantity", "Jumlah")}
                              <NumberInput
                                value={backQty[l.leg_no] ?? l.qty} min={0} max={l.qty}
                                onChange={(n) => setBackQty((q) => ({ ...q, [l.leg_no]: n }))}
                              />
                            </label>
                            <Button
                              size="sm" icon={PackageCheck} disabled={busy}
                              onClick={() => receiveLeg(l.leg_no, backQty[l.leg_no] ?? l.qty)}
                            >
                              {tr("Record return", "Catat kembali")}
                            </Button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {w.at_vendor_qty >= w.qty && (
                  <p className="mt-1.5 text-[12px] text-violet-900">
                    {tr(
                      "Everything is at the vendor, so no stage can be reported until something comes back.",
                      "Semuanya sedang di vendor, jadi tidak ada tahap yang bisa dilaporkan sampai ada yang kembali.",
                    )}
                  </p>
                )}

                {mayEdit && w.status === "OPEN" && (
                  <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-violet-200/70 pt-2">
                    <label className="text-[11px] text-slate-500">
                      {tr("Process", "Proses")}
                      <select
                        value={process} onChange={(e) => setProcess(e.target.value)}
                        className="mt-0.5 block h-9 min-w-[150px] rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                      >
                        <option value="">{tr("Choose…", "Pilih…")}</option>
                        {VENDOR_PROCESSES.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                      </select>
                    </label>
                    <label className="text-[11px] text-slate-500">
                      Vendor
                      <select
                        value={vendorId} onChange={(e) => setVendorId(e.target.value)}
                        className="mt-0.5 block h-9 min-w-[180px] rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                      >
                        <option value="">{tr("Choose vendor…", "Pilih vendor…")}</option>
                        {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </label>
                    <label className="text-[11px] text-slate-500">
                      {tr("Quantity", "Jumlah")}
                      <NumberInput value={sendQty} min={1} max={w.qty} onChange={setSendQty} />
                    </label>
                    <label className="text-[11px] text-slate-500">
                      {tr("Promised back", "Dijanjikan kembali")}
                      <input
                        type="date" value={expectBack} onChange={(e) => setExpectBack(e.target.value)}
                        className="mt-0.5 block h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                      />
                    </label>
                    <Button size="sm" icon={Factory} disabled={busy || !vendorId || !process} onClick={sendOut}>
                      {tr("Record sent", "Catat dikirim")}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* Gated on the **same predicate the API refuses on** (F75), not on
                a lookalike condition that drifts away from it. */}
            {mayEdit && w.status === "OPEN" && w.goods_on_site && (
              <SlotForm
                wo={w}
                activities={slots.status === "ready" ? [...new Set(slots.data.map((x) => x.activity))] : []}
                onDone={() => { reload(); reloadEntries(); reloadSlots(); onChanged(); }}
              />
            )}
            {mayEdit && w.status === "OPEN" && w.goods_on_site && !showCount && (
              <div className="-mt-3 flex flex-wrap justify-end gap-3 text-[11px]">
                <button onClick={() => setShowCount(true)} className="text-slate-500 underline hover:text-slate-700">
                  {tr("Correct a count / record pieces without a timeslot", "Koreksi jumlah / catat jumlah tanpa timeslot")}
                </button>
                {w.completed < w.qty && !closing && (
                  <button onClick={() => setClosing(true)} className="text-slate-500 underline hover:text-slate-700">
                    {tr("Close Job Order", "Tutup Job Order")}
                  </button>
                )}
              </div>
            )}
            {mayEdit && w.status === "OPEN" && w.goods_on_site && showCount && (
              <div className="rounded-xl border border-slate-200 px-4 py-3">
                <p className="flex items-center gap-2 text-[13px] font-medium text-slate-800">
                  <Hammer className="h-4 w-4 text-slate-400" /> {tr("Correct a count / pieces without a timeslot", "Koreksi jumlah / jumlah tanpa timeslot")}
                  <button onClick={() => setShowCount(false)} className="ml-auto text-[11px] font-normal text-slate-500 underline">
                    {tr("hide", "tutup")}
                  </button>
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_90px_140px]">
                  <select
                    value={stage} onChange={(e) => setStage(e.target.value)}
                    aria-label={tr("Stage", "Tahap")}
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  >
                    <option value="">{tr("Stage…", "Tahap…")}</option>
                    {/* Only what this order's route contains. Offering a stage
                        the API will refuse is a trap, not a choice (D254). */}
                    {w.stages.map((s) => (
                      <option key={s.stage} value={s.stage}>{s.seq}. {s.name}</option>
                    ))}
                  </select>
                  <NumberInput value={qty} min={-999} max={9999} onChange={setQty} />
                  <input
                    type="date" value={date} onChange={(e) => setDate(e.target.value)}
                    aria-label={tr("Date", "Tanggal")}
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-slate-600">
                  <span>{tr(`Worked from (${OFFICE_TZ.short})`, `Dikerjakan jam (${OFFICE_TZ.short})`)}</span>
                  <input
                    type="time" value={span.from} onChange={(e) => setSpan({ ...span, from: e.target.value })}
                    aria-label={tr("Start time", "Jam mulai")}
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  />
                  <span>{tr("to", "sampai")}</span>
                  <input
                    type="time" value={span.until} onChange={(e) => setSpan({ ...span, until: e.target.value })}
                    aria-label={tr("Finish time", "Jam selesai")}
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  />
                  {span.from || span.until ? (
                    <button type="button" onClick={() => setSpan({ from: "", until: "" })}
                      className="text-[11px] text-slate-500 underline hover:text-slate-700">
                      {tr("no hours", "tanpa jam")}
                    </button>
                  ) : (
                    <button type="button" onClick={() => setSpan(lastFullHour())}
                      className="text-[11px] text-brand-700 underline">
                      {tr("fill in the hours", "isi jamnya")}
                    </button>
                  )}
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
                    createLabel={(q) => tr(`Use the name “${q}” — not an employee`, `Pakai nama “${q}” — bukan karyawan`)}
                    options={[
                      ...(people.status === "ready" ? people.data : []).map((e) => ({
                        value: e.id,
                        label: e.full_name,
                        sublabel: `${e.employee_no} · ${e.unit}`,
                      })),
                      ...(who.id === null && who.name
                        ? [{ value: "free", label: who.name, sublabel: tr("name only — not linked yet", "nama saja — belum tertaut") }]
                        : []),
                    ]}
                    placeholder={tr("Who did the work", "Siapa yang mengerjakan")}
                  />
                  <input
                    value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder={tr("Note — required if the quantity is negative (a correction)", "Catatan — wajib kalau jumlahnya negatif (koreksi)")}
                    className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  />
                </div>
                <div className="mt-2 flex justify-end gap-2">
                  {w.completed >= w.qty || closing ? null : (
                    <Button size="sm" variant="ghost" onClick={() => setClosing(true)}>{tr("Close Job Order", "Tutup Job Order")}</Button>
                  )}
                  <Button size="sm" icon={Plus} onClick={report} disabled={busy || !stage || qty === 0}>
                    {tr("Record", "Catat")}
                  </Button>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {tr(
                    "A correction is written as a negative number with a reason — an old entry is never edited. The hours are when the pieces were worked; they are what the hourly view files them under.",
                    "Koreksi ditulis sebagai angka negatif dengan alasan — catatan lama tidak pernah diubah. Jamnya adalah kapan barang itu dikerjakan; itulah yang dipakai tampilan per jam.",
                  )}
                </p>
              </div>
            )}

            {mayEdit && w.status === "OPEN" && (closing || w.completed >= w.qty) && (
              <div className="rounded-xl border border-slate-200 px-4 py-3">
                <p className="flex items-center gap-2 text-[13px] font-medium text-slate-800">
                  <CheckCircle2 className="h-4 w-4 text-slate-400" /> {tr("Close Job Order", "Tutup Job Order")}
                </p>
                {w.completed < w.qty && (
                  <input
                    value={closeReason} onChange={(e) => setCloseReason(e.target.value)}
                    placeholder={tr(
                      `Only ${formatNumber(w.completed)} of ${formatNumber(w.qty)} — why close it?`,
                      `Baru ${formatNumber(w.completed)} dari ${formatNumber(w.qty)} — kenapa ditutup?`,
                    )}
                    className="mt-2 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                  />
                )}
                <div className="mt-2 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setClosing(false)} disabled={busy}>{tr("Cancel", "Batal")}</Button>
                  <Button size="sm" onClick={close} disabled={busy}>{tr("Close", "Tutup")}</Button>
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
                          {tr("Materials: BOM projection vs what was actually bought", "Bahan: proyeksi dari BOM vs yang benar-benar dibeli")}
                        </p>
                        {/* Which list this is measured against, and whether the
                            catalogue has moved on since (D256). */}
                        {w.product_code && (
                          <p className="mt-0.5 text-[12px] text-slate-500">
                            {w.bom_rev == null ? (
                              <span className="text-amber-700">
                                {tr(
                                  "This Job Order was created before BOMs had versions — the version actually used was never recorded, so there is no honest projection to show.",
                                  "Job Order ini dibuat sebelum BOM diberi versi — versi yang benar-benar dipakai tidak pernah tercatat, jadi tidak ada proyeksi yang jujur untuk ditampilkan.",
                                )}
                              </span>
                            ) : (
                              <>
                                {tr("Measured against", "Diukur terhadap")} <strong className="text-slate-700">rev {w.bom_rev}</strong>
                                {w.bom_drifted && (
                                  <span className="text-amber-700">
                                    {" "}{tr(
                                      `— the catalogue is now at rev ${w.product_current_rev}. The figures deliberately stay on rev ${w.bom_rev}: that is the list used when this Job Order was written.`,
                                      `— katalog sekarang sudah di rev ${w.product_current_rev}. Angkanya sengaja tetap memakai rev ${w.bom_rev}: itu daftar yang dipakai waktu Job Order ini ditulis.`,
                                    )}
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
                              placeholder={tr(
                                `Why move to rev ${w.product_current_rev}? The comparison figures change.`,
                                `Kenapa pindah ke rev ${w.product_current_rev}? Angka pembandingnya berubah.`,
                              )}
                              className="h-9 min-w-[220px] flex-1 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                            />
                            <Button
                              size="sm" variant="outline" icon={GitBranch}
                              disabled={busy || !repinReason.trim()} onClick={() => repin(w)}
                            >
                              {tr(`Move to rev ${w.product_current_rev}`, `Pindahkan ke rev ${w.product_current_rev}`)}
                            </Button>
                          </div>
                        )}
                        {!need ? (
                          <p className="mt-1 text-[12px] text-slate-500">
                            {tr(
                              "This Job Order does not point to a catalogue product, so there is no BOM to project.",
                              "Job Order ini tidak menunjuk produk di katalog, jadi tidak ada BOM untuk diproyeksikan.",
                            )}
                          </p>
                        ) : (
                          <>
                            {/* The walk, said plainly: what it went through and
                                what it could not get into (D257). */}
                            {need.cycle && (
                              <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-900">
                                <strong>{tr("This BOM contains itself:", "BOM ini memuat dirinya sendiri:")}</strong>{" "}
                                {need.cycle.join(" → ")}.{" "}
                                {tr(
                                  "Its material need is infinite, so it is not calculated — not zero. Fix the BOM first.",
                                  "Kebutuhan bahannya tidak terhingga, jadi tidak dihitung — bukan nol. Perbaiki BOM-nya dulu.",
                                )}
                              </p>
                            )}
                            {need.sub_assemblies.length > 0 && (
                              <p className="mt-2 text-[12px] text-slate-600">
                                {tr(`Through ${need.sub_assemblies.length} sub-assemblies:`, `Lewat ${need.sub_assemblies.length} sub-rakitan:`)}{" "}
                                {need.sub_assemblies.map((sa) => (
                                  `${formatNumber(sa.qty)}× ${sa.name ?? sa.product_code}`
                                )).join(" · ")}
                                {" "}{tr(
                                  "— what is below is already the material actually bought, not the assembly's name.",
                                  "— yang di bawah ini sudah bahan yang benar-benar dibeli, bukan nama rakitannya.",
                                )}
                              </p>
                            )}
                            {need.unexploded.length > 0 && (
                              <p className="mt-1 text-[12px] text-amber-800">
                                {need.unexploded.join(", ")}{" "}
                                {tr(
                                  "has no released BOM yet, so it is listed as itself — check whether it is bought or made.",
                                  "belum punya BOM yang dirilis, jadi tetap tercantum sebagai dirinya sendiri — harus diperiksa apakah dibeli atau dibuat.",
                                )}
                              </p>
                            )}
                            <dl className="mt-2 grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3 lg:grid-cols-5">
                              {([
                                [tr("Material projection", "Proyeksi bahan"), need.total == null ? "—" : formatIDR(need.total),
                                  `${formatNumber(w.qty)} ${w.uom}${need.unpriced > 0 ? tr(` · ${need.unpriced} unpriced`, ` · ${need.unpriced} tanpa harga`) : ""}`],
                                [tr("Labour", "Tenaga kerja"), need.labour_total == null ? "—" : formatIDR(need.labour_total),
                                  need.labour_total == null
                                    ? tr("never worked out by anyone", "belum pernah dihitung orang")
                                    : tr("typed in, not calculated by the system", "diketik, bukan dihitung sistem")],
                                [tr("Requested (PR)", "Diminta (PR)"), live.length === 0 ? "—" : formatIDR(asked), tr(`${live.length} lines`, `${live.length} baris`)],
                                [tr("Approved", "Disetujui"), live.length === 0 ? "—" : formatIDR(approved), tr("of what was requested", "dari yang diminta")],
                                [tr("Paid", "Terbayar"), live.length === 0 ? "—" : formatIDR(paid), tr("money already out", "sudah keluar uangnya")],
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
                                  ? tr(
                                    "Exactly the projection — the prices were taken from the same catalogue. A difference appears only when a quantity is changed, a vendor quotes differently, or a follow-up PR is raised.",
                                    "Sama persis dengan proyeksi — harganya memang diambil dari katalog yang sama. Selisih baru muncul saat jumlah diubah, vendor menawar lain, atau ada PR susulan.",
                                  )
                                  : asked > need.total
                                    ? tr(`Requested ${formatIDR(asked - need.total)} above the BOM projection.`, `Permintaan ${formatIDR(asked - need.total)} di atas proyeksi BOM.`)
                                    : tr(`Requested ${formatIDR(need.total - asked)} below the BOM projection.`, `Permintaan ${formatIDR(need.total - asked)} di bawah proyeksi BOM.`)}
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
                                  {live.length > 0 ? tr("Create another PR from the BOM", "Buat PR lagi dari BOM") : tr("Create PR from the BOM", "Buat PR dari BOM")}
                                </Button>
                                <p className="mt-1 text-[11px] text-slate-500">
                                  {tr("Created as a", "Dibuat sebagai")} <strong>draft</strong>
                                  {tr(
                                    ": the list still has to be read, priced and submitted by a person. A BOM is a need, not a decision to spend money.",
                                    ": daftarnya masih harus dibaca, dihargai dan diajukan orang. BOM adalah kebutuhan, bukan keputusan membelanjakan uang.",
                                  )}
                                  {live.length > 0 && tr(" Already created before — check first so it is not doubled.", " Sudah pernah dibuat — periksa dulu supaya tidak dobel.")}
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
                  {tr("Old stages, no longer used", "Tahap lama, sudah tidak dipakai")}
                </p>
                <p className="mt-1 text-[13px] text-slate-700">
                  {w.retired.map((r) => `${r.name} ${formatNumber(r.done)}`).join(" · ")}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {tr(
                    "Recorded when the workshop still cut and assembled in-house. The raw pieces are now bought ready-made, so these steps are no longer on the board — the figures are kept and never counted as part of the current four stages.",
                    "Dicatat waktu bengkel masih memotong dan merakit sendiri. Sekarang barang mentahnya dibeli jadi, jadi langkah-langkah ini tidak ada lagi di papan — angkanya tetap disimpan dan tidak pernah dihitung sebagai bagian dari empat tahap sekarang.",
                  )}
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
                <div className="space-y-5">
                {/* Who, how many, and when — the three the owner asked the
                    Job Order to answer (D349). */}
                {slots.status === "ready" && (
                  <>
                    <JobProductivity wo={w} slots={slots.data} entries={rows} />
                    <SlotList slots={slots.data} onChanged={() => { reload(); reloadEntries(); reloadSlots(); onChanged(); }} />
                  </>
                )}
                <ProgressOverTime entries={rows} stageOrder={w.stages.map((s) => s.stage)} qty={w.qty} />
                <div>
                  <p className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-400">
                    {tr(`History (${rows.length})`, `Riwayat (${rows.length})`)}
                  </p>
                  <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                    {rows.length === 0 && (
                      <li className="px-3 py-3 text-[13px] text-slate-500">{tr("Nothing recorded yet.", "Belum ada yang dicatat.")}</li>
                    )}
                    {rows.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-[12px]">
                        <span className="w-20 tabular-nums text-slate-500">
                          {p.work_date}
                          {spanLabel(p) && <span className="block text-[10px] text-slate-400">{spanLabel(p)}</span>}
                        </span>
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
                          <Badge tone="brand">{tr("overtime", "lembur")} {p.source_ref}</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                </div>
              )}
            </Loaded>
          </div>
        )}
      </Loaded>
    </Drawer>
  );
}

function addHour(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${String((h + 1) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/* ── Material against the SPK ─────────────────────────────────────────── */

function MaterialPanel({ woNo, onChanged }: { woNo: string; onChanged: () => void }) {
  const tr = useTr();
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
      toast(res.error.status === 409 ? "critical" : "warning", tr("Not issued", "Tidak dikeluarkan"), res.error.message);
      return;
    }
    if (res.data.negative.length > 0) {
      /* Recorded, and said out loud. The wood is off the rack whatever the
         screen thought; what must not happen is silence (A6). */
      toast("warning", tr(`${res.data.issued} items issued — stock recorded negative`, `${res.data.issued} barang keluar — stok tercatat minus`),
        res.data.negative.map((n) => `${n.item_name} ${n.on_hand_after}`).join(" · "));
    } else {
      toast("success", tr(`${res.data.issued} items issued`, `${res.data.issued} barang keluar`), tr(`Recorded against ${woNo}.`, `Dicatat atas ${woNo}.`));
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
            {tr("Material issued to the workshop", "Bahan yang keluar ke bengkel")}
            {p.rev !== null && <Badge tone="slate">BOM rev {p.rev}</Badge>}
            {p.variance_readable
              ? <Badge tone="green">{tr("done — variance is readable", "selesai — selisih bisa dibaca")}</Badge>
              : <Badge tone="slate">{tr(`${p.completed}/${p.ordered} made`, `${p.completed}/${p.ordered} jadi`)}</Badge>}
            {/* Computed from the rack now, never stored — and the rack is
                shared, so two orders can both read ready (D312). */}
            <Badge tone={p.material_status === "ready" ? "green" : p.material_status === "waiting" ? "amber" : "slate"}>
              {MATERIAL_STATUS_LABEL[p.material_status]}
            </Badge>
            <Link href={`/produksi/jejak?no=${encodeURIComponent(woNo)}`}
              className="normal-case tracking-normal text-brand-700 hover:underline">
              {tr("Full trail →", "Jejak lengkap →")}
            </Link>
          </p>

          {p.no_plan_reason ? (
            <p className="rounded-xl border border-slate-200 px-3 py-2.5 text-[13px] text-slate-500">
              {p.no_plan_reason}
              {p.lines.length > 0 && tr(" What was already issued is still recorded below.", " Yang sudah dikeluarkan tetap tercatat di bawah.")}
            </p>
          ) : null}

          {p.lines.length === 0 ? (
            !p.no_plan_reason && (
              <p className="rounded-xl border border-slate-200 px-3 py-2.5 text-[13px] text-slate-500">
                {tr("No material has been issued against this Job Order yet.", "Belum ada bahan yang dikeluarkan atas Job Order ini.")}
              </p>
            )
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {p.lines.map((l) => (
                <li key={l.item_code} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2 text-[12px]">
                  <span className="min-w-[160px] flex-1">
                    <span className="block text-slate-700">{l.item_name}</span>
                    <span className="block text-[10px] text-slate-400">
                      {l.item_code} · {tr("rack", "rak")} {formatNumber(l.on_hand)} {l.uom}
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
                  {l.off_bom && <Badge tone="amber">{tr("off the BOM", "di luar BOM")}</Badge>}
                  {l.short > 0 && <Badge tone="amber">{tr(`rack short ${formatNumber(l.short)}`, `rak kurang ${formatNumber(l.short)}`)}</Badge>}
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
                <span className="w-20 text-right">{tr("expected", "seharusnya")}</span>
                <span className="w-20 text-right">{tr("issued", "keluar")}</span>
                <span className="w-20 text-right">{tr("remaining", "sisa")}</span>
              </li>
            </ul>
          )}

          {!p.variance_readable && p.lines.some((l) => l.remaining !== null) && (
            <p className="mt-1 text-[11px] text-slate-500">
              {tr(
                "The variance means nothing while the Job Order is unfinished — half a Job Order has only taken half its material, and calling that a saving teaches people to ignore the figure.",
                "Selisihnya belum berarti apa-apa selama Job Order belum selesai — separuh Job Order baru mengambil separuh bahannya, dan menyebut itu penghematan mengajarkan orang mengabaikan angkanya.",
              )}
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
                  {tr("Issue material", "Keluarkan bahan")}
                </Button>
              ) : (
                <div className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={location} onChange={(e) => setLocation(e.target.value)}
                      aria-label={tr("Location", "Lokasi")}
                      className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none"
                    >
                      <option value="">{tr("From location…", "Dari lokasi…")}</option>
                      {locations.status === "ready" && locations.data.filter((l) => l.is_active).map((l) => (
                        <option key={l.code} value={l.code}>{l.name}</option>
                      ))}
                    </select>
                    <input
                      value={note} onChange={(e) => setNote(e.target.value)}
                      placeholder={tr("Note (optional)", "Catatan (opsional)")}
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
                        {tr(`${short.length} items will send recorded stock negative:`, `${short.length} barang akan membuat stok tercatat minus:`)}{" "}
                        {short.map((l) => tr(
                          `${l.item_name} (rack ${formatNumber(l.on_hand)}, taken ${formatNumber(qty[l.item_code] ?? 0)})`,
                          `${l.item_name} (rak ${formatNumber(l.on_hand)}, diambil ${formatNumber(qty[l.item_code] ?? 0)})`,
                        )).join(" · ")}.{" "}
                        {tr(
                          "It can still be recorded — if the goods really were taken, the records must follow, not the other way round.",
                          "Tetap boleh dicatat — kalau memang barangnya dibawa, catatannya yang harus menyesuaikan, bukan sebaliknya.",
                        )}
                      </p>
                    );
                  })()}
                  <p className="mt-2 text-[11px] text-slate-500">
                    {tr("The figures are filled in from the BOM as a", "Angkanya sudah diisi dari BOM sebagai")}{" "}
                    <strong>{tr("proposal", "usulan")}</strong>.{" "}
                    {tr(
                      "Change them to what was actually taken to the workshop — what is recorded is what left, not what should have left. Stock never goes down by itself from a production report.",
                      "Ubah ke jumlah yang benar-benar dibawa ke bengkel — yang dicatat adalah barang yang keluar, bukan barang yang seharusnya keluar. Stok tidak pernah berkurang sendiri dari laporan produksi.",
                    )}
                  </p>
                  <div className="mt-2 flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setQty({}); }}>
                      {tr("Cancel", "Batal")}
                    </Button>
                    <Button size="sm" icon={PackageCheck} onClick={issue} disabled={busy || !location}>
                      {tr("Record issue", "Catat keluar")}
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
