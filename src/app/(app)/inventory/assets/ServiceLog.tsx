"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Trash2, Wrench } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { MoneyInput } from "@/components/ui/money-input";
import { formatIDR } from "@/lib/format";
import { officeToday } from "@/lib/office";
import { inventory } from "@/demo/api";
import {
  ASSET_SERVICE_KIND_LABEL, type AssetService, type AssetServiceKind, type AssetView,
} from "@/services/inventory/contracts";
import { useToast } from "@/store/toast";

/** What has been done to an asset, and when the next one is due (`0121`).
 *  The audit trail below it records edits to the record; this records work
 *  done on the thing — the oil change, the fuser, the AC wash. */

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none";

type Form = {
  service_date: string; kind: AssetServiceKind; description: string; cost: number;
  vendor_code: string; trx_no: string; next_due: string;
};

export function ServiceLog({ asset, canEdit, onChanged }: { asset: AssetView; canEdit: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<AssetService[] | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);

  const [tick, setTick] = useState(0);
  const load = () => setTick((t) => t + 1);
  useEffect(() => { setForm(null); }, [asset.asset_no]);
  useEffect(() => {
    let live = true;
    void inventory.listAssetServices(asset.asset_no).then((r) => { if (live) setRows(r.data ?? []); });
    return () => { live = false; };
  }, [asset.asset_no, tick]);

  async function save() {
    if (!form) return;
    setSaving(true);
    const res = await inventory.addAssetService(asset.asset_no, {
      service_date: form.service_date, kind: form.kind, description: form.description,
      cost: form.cost > 0 ? form.cost : null, vendor_code: form.vendor_code, trx_no: form.trx_no,
      next_due: form.next_due || null,
    });
    setSaving(false);
    if (res.error) { toast("warning", "Not logged", res.error.message); return; }
    toast("success", "Logged", `${ASSET_SERVICE_KIND_LABEL[res.data.kind]} on ${res.data.service_date}.`);
    setForm(null);
    load();
    onChanged();
  }

  async function remove(s: AssetService) {
    if (!window.confirm(`Delete "${s.description}" (${s.service_date})? Only for an entry made by mistake.`)) return;
    const res = await inventory.deleteAssetService(s.id, "Entered by mistake");
    if (res.error) { toast("warning", "Not deleted", res.error.message); return; }
    load();
    onChanged();
  }

  return (
    <section data-testid="asset-service-log">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <Wrench className="h-3.5 w-3.5" /> Service &amp; repairs
          {asset.next_service_due && (
            <Badge tone={asset.service_due ? "amber" : "slate"}>next due {asset.next_service_due}</Badge>
          )}
        </p>
        {canEdit && !form && (
          <Button
            size="sm" variant="ghost" icon={Plus}
            onClick={() => setForm({
              service_date: officeToday(), kind: asset.status === "under_repair" ? "repair" : "service",
              description: "", cost: 0, vendor_code: "", trx_no: "", next_due: "",
            })}
          >
            Log a service
          </Button>
        )}
      </div>

      {form && (
        <div className="mb-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-600">
              Done on
              <input id="sv-date" type="date" value={form.service_date} max={officeToday()}
                onChange={(e) => setForm({ ...form, service_date: e.target.value })} className={inputClass} />
            </label>
            <label className="text-xs text-slate-600">
              Kind
              <select id="sv-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as AssetServiceKind })}
                className={inputClass + " bg-white"}>
                {(Object.keys(ASSET_SERVICE_KIND_LABEL) as AssetServiceKind[]).map((k) => (
                  <option key={k} value={k}>{ASSET_SERVICE_KIND_LABEL[k]}</option>
                ))}
              </select>
            </label>
            <label className="col-span-2 text-xs text-slate-600">
              What was done
              <input id="sv-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="e.g. Ganti oli + filter" className={inputClass} />
            </label>
            <label className="text-xs text-slate-600">
              Cost
              <MoneyInput id="sv-cost" value={form.cost} onChange={(v) => setForm({ ...form, cost: v })} className="mt-1" />
            </label>
            <label className="text-xs text-slate-600">
              Next due <span className="text-slate-400">(if it recurs)</span>
              <input id="sv-next" type="date" value={form.next_due} min={form.service_date}
                onChange={(e) => setForm({ ...form, next_due: e.target.value })} className={inputClass} />
            </label>
            <label className="text-xs text-slate-600">
              Done by (supplier code)
              <input id="sv-vendor" value={form.vendor_code} onChange={(e) => setForm({ ...form, vendor_code: e.target.value })}
                placeholder="optional" className={inputClass + " font-mono"} />
            </label>
            <label className="text-xs text-slate-600">
              Ledger row
              <input id="sv-trx" value={form.trx_no} onChange={(e) => setForm({ ...form, trx_no: e.target.value })}
                placeholder="trx-… (optional)" className={inputClass + " font-mono"} />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving || !form.description.trim() || !form.service_date}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}

      {rows === null ? (
        <p className="text-[13px] text-slate-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-slate-500">No service or repair logged yet.</p>
      ) : (
        <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {rows.map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-3 px-3 py-2 text-[13px]">
              <span className="min-w-0">
                <span className="block text-slate-800">
                  <Badge tone={s.kind === "repair" ? "amber" : "slate"} className="mr-1.5">{ASSET_SERVICE_KIND_LABEL[s.kind]}</Badge>
                  {s.description}
                </span>
                <span className="block font-mono text-[10px] text-slate-400">
                  {s.service_date}
                  {s.vendor_name || s.vendor_code ? ` · ${s.vendor_name ?? s.vendor_code}` : ""}
                  {s.trx_no && (
                    <> · <Link href={`/accounting/ledger?trx=${encodeURIComponent(s.trx_no)}`} className="text-brand-700 hover:underline">{s.trx_no}</Link></>
                  )}
                  {s.next_due ? ` · next ${s.next_due}` : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <span className="tabular-nums text-slate-700">{s.cost != null ? formatIDR(s.cost) : "—"}</span>
                {canEdit && (
                  <button type="button" aria-label={`Delete ${s.description}`} onClick={() => remove(s)}
                    className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
      {rows && rows.length > 0 && (
        <p className="mt-1 text-[11px] text-slate-500">
          {rows.length} job{rows.length === 1 ? "" : "s"} · {formatIDR(rows.reduce((t, s) => t + (s.cost ?? 0), 0))} in total
        </p>
      )}
    </section>
  );
}
