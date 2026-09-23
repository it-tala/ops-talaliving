"use client";

import { useEffect, useState } from "react";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { TypeOptions } from "@/components/ui/type-options";
import { formatIDR } from "@/lib/format";
import { accounting } from "@/demo/api";
import type { AccountBalance } from "@/services/accounting/contracts";
import { RENT_PERIOD_LABEL, type AssetView } from "@/services/inventory/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";

/** A rented or leased asset's rent, onto the payment calendar (`0110`).
 *
 *  Made once, as fixed lines marked with the asset's tag; after that the
 *  calendar is where the rent is changed. Inventory can see whether it has
 *  been done; only accounting can do it, because the calendar is theirs. */
export function RentSchedule({ asset, onDone }: { asset: AssetView; onDone: () => void }) {
  const { can } = useSession();
  const { toast } = useToast();
  const mayPlan = can("accounting.update");
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [account, setAccount] = useState("");
  const [type, setType] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    let live = true;
    void accounting.listAccounts().then((r) => {
      if (!live || r.error) return;
      setAccounts(r.data.filter((a) => a.is_paying && a.is_active !== false));
    });
    return () => { live = false; };
  }, [open]);

  if (!asset.rent_amount || !asset.rent_period) return null;
  const gone = asset.status === "disposed" || asset.status === "lost" || asset.status === "returned";

  async function schedule() {
    setSaving(true);
    const res = await accounting.scheduleAssetRent(asset.asset_no, {
      account_code: account || null, type_code: type || null,
    });
    setSaving(false);
    if (res.error) { toast("warning", "Not scheduled", res.error.message); return; }
    toast("success", "On the payment calendar",
      `${res.data.lines} line${res.data.lines === 1 ? "" : "s"} for ${asset.asset_no}'s rent.`);
    setOpen(false);
    onDone();
  }

  return (
    <section className="rounded-lg border border-slate-200 px-3 py-3">
      <p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <CalendarClock className="h-3.5 w-3.5" /> Rent on the payment calendar
      </p>
      {asset.rent_lines > 0 ? (
        <p className="flex items-center gap-1.5 text-[13px] text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          Scheduled — {asset.rent_lines} line{asset.rent_lines === 1 ? "" : "s"}.{" "}
          <a href="/accounting/calendar" className="text-brand-700 hover:underline">Open the calendar</a>
        </p>
      ) : gone ? (
        <p className="text-[13px] text-slate-500">Not scheduled, and nothing left to pay.</p>
      ) : !open ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex-1 text-[13px] text-slate-600">
            {formatIDR(asset.rent_amount)} {RENT_PERIOD_LABEL[asset.rent_period]} is not on the calendar yet.
          </p>
          {mayPlan ? (
            <Button size="sm" icon={CalendarClock} onClick={() => setOpen(true)}>Create payment schedule</Button>
          ) : (
            <span className="text-[11px] text-slate-400">Accounting puts it there.</span>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[12px] text-slate-500">
            {asset.rent_period === "monthly"
              ? `One monthly line, due on day ${asset.rent_due_day ?? Number(asset.contract_start?.slice(8, 10) ?? 1)}, from ${asset.contract_start?.slice(0, 7)}${asset.contract_end ? ` until the contract ends ${asset.contract_end}` : ", open-ended"}.`
              : asset.rent_period === "yearly"
                ? "A one-off on each contract anniversary from this month until the contract ends."
                : `One payment on ${asset.contract_start}.`}
            {" "}Fixed amounts, changed on the calendar afterwards.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-600">
              Paid from
              <select id="rent-account" value={account} onChange={(e) => setAccount(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
                <option value="">Any account</option>
                {accounts.map((a) => <option key={a.code} value={a.code}>{a.code}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-600">
              Transaction type
              <select id="rent-type" value={type} onChange={(e) => setType(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm">
                <option value="">None</option>
                <TypeOptions />
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={schedule} disabled={saving}>{saving ? "Scheduling…" : "Schedule"}</Button>
          </div>
        </div>
      )}
    </section>
  );
}
