"use client";

import { useState } from "react";
import { Tags, Plus, Pencil, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/drawer";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { forgetTypes } from "@/components/ui/type-options";
import { accounting } from "@/demo/api";
import type { TransactionType } from "@/services/accounting/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";

/** The ledger's transaction types (`0105`).
 *
 *  The code is what every ledger row carries, spelled the way the data
 *  spells it — `RECCURING` keeps its doubled C — so it is fixed at creation.
 *  A type in use is retired rather than deleted: it stays on its rows and
 *  leaves the pickers.
 *
 *  The flags are what the ledger does with a row of this type:
 *    purchase          the row is expected to name a request or order (D83)
 *    creates items     its lines feed the item catalogue (D86)
 *    auto-complete     rows complete by themselves (D26 — shipped inert)
 */
const inputClass =
  "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none";

type Form = {
  mode: "create" | "edit"; code: string; description: string;
  is_purchase: boolean; creates_catalog_item: boolean; auto_complete: boolean; is_active: boolean;
};

export default function TransactionTypesPage() {
  const { can } = useSession();
  const { toast } = useToast();
  const mayEdit = can("accounting.update");
  const [state, reload] = useLoad(() => accounting.listTypeRows(), []);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form) return;
    setSaving(true);
    const flags = {
      is_purchase: form.is_purchase, creates_catalog_item: form.creates_catalog_item,
      auto_complete: form.auto_complete, description: form.description,
    };
    const res = form.mode === "create"
      ? await accounting.createTransactionType({ code: form.code, ...flags })
      : await accounting.updateTransactionType(form.code, { ...flags, is_active: form.is_active });
    setSaving(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Not saved", res.error.message);
      return;
    }
    toast("success", form.mode === "create" ? "Type added" : "Type saved", res.data.code);
    forgetTypes();
    setForm(null);
    reload();
  }

  async function remove() {
    if (!form) return;
    setSaving(true);
    const res = await accounting.deleteTransactionType(form.code);
    setSaving(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Not deleted", res.error.message);
      return;
    }
    toast("success", "Type deleted", `${form.code} is gone. No row carried it.`);
    forgetTypes();
    setForm(null);
    reload();
  }

  const flag = (on: boolean) => (on ? <Badge tone="green" dot>Yes</Badge> : <span className="text-slate-400">No</span>);

  const columns: Column<TransactionType>[] = [
    {
      key: "code",
      header: "Type",
      render: (t) => (
        <div>
          <p className="font-medium text-slate-800">
            {t.code}
            {t.is_active === false && <Badge tone="slate" className="ml-2">Retired</Badge>}
          </p>
          {t.description && <p className="text-[11px] text-slate-500">{t.description}</p>}
        </div>
      ),
    },
    { key: "purchase", header: "Purchase", render: (t) => flag(t.is_purchase) },
    { key: "items", header: "Creates items", render: (t) => flag(t.creates_catalog_item) },
    { key: "auto", header: "Auto-complete", render: (t) => flag(t.auto_complete) },
    {
      key: "edit",
      header: "",
      render: (t) => mayEdit ? (
        <Button
          variant="ghost" size="sm" icon={Pencil} aria-label={`Edit ${t.code}`}
          onClick={() => setForm({
            mode: "edit", code: t.code, description: t.description ?? "",
            is_purchase: t.is_purchase, creates_catalog_item: t.creates_catalog_item,
            auto_complete: t.auto_complete, is_active: t.is_active !== false,
          })}
        >
          <span className="sr-only">Edit</span>
        </Button>
      ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb="Master Data"
        title="Transaction types"
        description="What a ledger row is. The code is fixed once created; a type in use is retired, not deleted."
        actions={mayEdit && (
          <Button icon={Plus} onClick={() => setForm({
            mode: "create", code: "", description: "", is_purchase: true,
            creates_catalog_item: false, auto_complete: false, is_active: true,
          })}>
            Add type
          </Button>
        )}
      />

      <Card>
        <CardHeader
          title="All types"
          subtitle="Purchase: the row is expected to name a request or order. Creates items: its lines feed the item catalogue."
          icon={Tags}
          action={<SourceBadge state={state} />}
        />
        <Loaded state={state} onRetry={reload}>
          {(rows) => <DataTable columns={columns} rows={rows} rowKey={(t) => t.code} dense empty="No types." />}
        </Loaded>
      </Card>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.mode === "create" ? "Add transaction type" : `Edit ${form?.code ?? ""}`}>
        {form && (
          <div className="space-y-3">
            <div>
              <label htmlFor="tt-code" className="block text-sm text-slate-600">Code</label>
              <input
                id="tt-code"
                value={form.code}
                disabled={form.mode === "edit"}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="e.g. TRANSPORT"
                className={inputClass + " font-mono disabled:bg-slate-50 disabled:text-slate-500"}
              />
              {form.mode === "create" && (
                <p className="mt-1 text-xs text-slate-500">Written in capitals, as the ledger spells them. It cannot be renamed later.</p>
              )}
            </div>
            <div>
              <label htmlFor="tt-desc" className="block text-sm text-slate-600">What it is for</label>
              <input
                id="tt-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="e.g. Fuel, tolls and courier fees"
                className={inputClass}
              />
            </div>
            <div className="space-y-2 rounded-lg border border-slate-200 px-3 py-3 text-sm text-slate-700">
              <label className="flex items-start gap-2">
                <input id="tt-purchase" type="checkbox" className="mt-1" checked={form.is_purchase}
                  onChange={(e) => setForm({ ...form, is_purchase: e.target.checked })} />
                <span>Purchase <span className="block text-xs text-slate-500">A row of this type is expected to name the request or order it paid.</span></span>
              </label>
              <label className="flex items-start gap-2">
                <input id="tt-items" type="checkbox" className="mt-1" checked={form.creates_catalog_item}
                  onChange={(e) => setForm({ ...form, creates_catalog_item: e.target.checked })} />
                <span>Creates items <span className="block text-xs text-slate-500">Its itemised lines feed the item catalogue.</span></span>
              </label>
              <label className="flex items-start gap-2">
                <input id="tt-auto" type="checkbox" className="mt-1" checked={form.auto_complete}
                  onChange={(e) => setForm({ ...form, auto_complete: e.target.checked })} />
                <span>Auto-complete <span className="block text-xs text-slate-500">Reserved — not acted on yet.</span></span>
              </label>
              {form.mode === "edit" && (
                <label className="flex items-start gap-2 border-t border-slate-100 pt-2">
                  <input id="tt-active" type="checkbox" className="mt-1" checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                  <span>Active <span className="block text-xs text-slate-500">Untick to retire it: it stays on its rows and leaves the pickers.</span></span>
                </label>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              {form.mode === "edit" && (
                <Button variant="ghost" icon={Trash2} className="mr-auto text-rose-700" disabled={saving} onClick={remove}>
                  Delete
                </Button>
              )}
              <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
              <Button onClick={save} disabled={saving || form.code.trim().length < 2}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
