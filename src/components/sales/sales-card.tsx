"use client";

import { useState } from "react";
import { Pencil, Save } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useLoad } from "@/components/ui/loaded";
import { MoneyInput } from "@/components/ui/money-input";
import { formatIDR } from "@/lib/format";
import { procurement } from "@/demo/api";
import type { ProjectView } from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

const inputCls = "mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none";

/** The sale on a project (P2, 0219): who sells it, where it came from, what
 *  it may be worth and when it may close. Saved by its own seam, so editing
 *  the project's facts never blanks it. */
export function SalesCard({ p, canEdit, onChanged }: { p: ProjectView; canEdit: boolean; onChanged: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [people] = useLoad(() => procurement.listSalesPeople(), []);
  const [pic, setPic] = useState(p.sales_pic ?? "");
  const [source, setSource] = useState(p.source_note ?? "");
  const [value, setValue] = useState(p.expected_value ?? 0);
  const [closeOn, setCloseOn] = useState(p.expected_close_on ?? "");
  const [busy, setBusy] = useState(false);

  function start() {
    setPic(p.sales_pic ?? ""); setSource(p.source_note ?? "");
    setValue(p.expected_value ?? 0); setCloseOn(p.expected_close_on ?? "");
    setEditing(true);
  }

  async function save() {
    setBusy(true);
    const res = await procurement.setProjectSales({
      code: p.code, sales_pic: pic || null, source_note: source.trim() || null,
      expected_value: value > 0 ? value : null, expected_close_on: closeOn || null,
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", tr("Sale updated", "Data penjualan diperbarui"), p.code);
    setEditing(false);
    onChanged();
  }

  const quote = p.current_quote_total != null
    ? `${formatIDR(p.current_quote_total)} · ${p.current_quote_no}`
    : null;

  return (
    <div className="rounded-xl border border-slate-200 px-4 py-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{tr("Sale", "Penjualan")}</p>
      {editing ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-slate-500">{tr("Salesperson", "PIC sales")}
              <select value={pic} onChange={(e) => setPic(e.target.value)} className={inputCls}>
                <option value="">{tr("— nobody yet —", "— belum ada —")}</option>
                {(people.status === "ready" ? people.data : []).map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-slate-500">{tr("Where the lead came from", "Sumber lead")}
              <input value={source} onChange={(e) => setSource(e.target.value)} className={inputCls}
                placeholder={tr("e.g. Instagram DM, referral from agent Made", "mis. DM Instagram, referral agen Made")} />
            </label>
            <label className="block text-xs text-slate-500">{tr("Expected value (before a quotation)", "Perkiraan nilai (sebelum ada quotation)")}
              <MoneyInput value={value} onChange={setValue} className="mt-1" />
            </label>
            <label className="block text-xs text-slate-500">{tr("Expected close", "Perkiraan closing")}
              <input type="date" value={closeOn} onChange={(e) => setCloseOn(e.target.value)} className={inputCls} />
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>{tr("Cancel", "Batal")}</Button>
            <Button size="sm" icon={Save} onClick={save} disabled={busy}>{tr("Save", "Simpan")}</Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-start gap-x-8 gap-y-2 text-[13px]">
          {([
            [tr("Salesperson", "PIC sales"), p.sales_pic_name ?? "—"],
            [tr("Source", "Sumber"), p.source_note ?? "—"],
            [tr("Quotation in play", "Quotation berlaku"), quote ?? "—"],
            [tr("Expected value", "Perkiraan nilai"), p.expected_value == null ? "—" : formatIDR(p.expected_value)],
            [tr("Expected close", "Perkiraan closing"), p.expected_close_on ?? "—"],
            [tr("In this status", "Di status ini"), tr(`${p.days_in_status} days`, `${p.days_in_status} hari`)],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k}>
              <span className="block text-[11px] uppercase tracking-wide text-slate-400">{k}</span>
              <span className="text-slate-800">{v}</span>
            </div>
          ))}
          {canEdit && (
            <Button size="sm" variant="ghost" icon={Pencil} className="ml-auto" onClick={start}>{tr("Edit", "Ubah")}</Button>
          )}
        </div>
      )}
    </div>
  );
}
