"use client";

import { useState } from "react";
import { MonitorSmartphone, Plus, Pencil, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/drawer";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { inventory } from "@/demo/api";
import type { AssetCategory } from "@/services/inventory/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";

/** What kind of thing an asset is — CCTV, computers, vehicles (`0107`).
 *  The code is fixed once made; a category in use is retired, not deleted. */
const inputClass =
  "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none";

type Form = { mode: "create" | "edit"; code: string; name: string; description: string; is_active: boolean };

export default function AssetCategoriesPage() {
  const { can } = useSession();
  const { toast } = useToast();
  const mayEdit = can("inventory.update");
  const [state, reload] = useLoad(() => inventory.listAssetCategories(), []);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form) return;
    setSaving(true);
    const res = await inventory.saveAssetCategory({
      code: form.code, name: form.name, description: form.description, is_active: form.is_active,
    });
    setSaving(false);
    if (res.error) { toast("warning", "Not saved", res.error.message); return; }
    toast("success", form.mode === "create" ? "Category added" : "Category saved", res.data.name);
    setForm(null);
    reload();
  }

  async function remove() {
    if (!form) return;
    setSaving(true);
    const res = await inventory.deleteAssetCategory(form.code);
    setSaving(false);
    if (res.error) { toast("warning", "Not deleted", res.error.message); return; }
    toast("success", "Deleted", `"${form.name}" is gone. No asset was in it.`);
    setForm(null);
    reload();
  }

  const columns: Column<AssetCategory>[] = [
    {
      key: "name",
      header: "Category",
      render: (c) => (
        <div>
          <p className="font-medium text-slate-800">
            {c.name}
            {!c.is_active && <Badge tone="slate" className="ml-2">Retired</Badge>}
          </p>
          <p className="font-mono text-[10px] text-slate-400">{c.code}</p>
        </div>
      ),
    },
    { key: "desc", header: "What goes in it", render: (c) => <span className="text-slate-600">{c.description ?? "—"}</span> },
    {
      key: "edit",
      header: "",
      render: (c) => mayEdit ? (
        <Button
          variant="ghost" size="sm" icon={Pencil} aria-label={`Edit ${c.name}`}
          onClick={() => setForm({ mode: "edit", code: c.code, name: c.name, description: c.description ?? "", is_active: c.is_active })}
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
        title="Asset categories"
        description="What kind of thing an asset is. Used by Inventory › Assets."
        actions={mayEdit && (
          <Button icon={Plus} onClick={() => setForm({ mode: "create", code: "", name: "", description: "", is_active: true })}>
            Add category
          </Button>
        )}
      />
      <Card>
        <CardHeader title="All categories" subtitle="A category in use is retired, not deleted." icon={MonitorSmartphone} action={<SourceBadge state={state} />} />
        <Loaded state={state} onRetry={reload}>
          {(rows) => <DataTable columns={columns} rows={rows} rowKey={(c) => c.code} dense empty="No categories." />}
        </Loaded>
      </Card>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.mode === "create" ? "Add asset category" : `Edit ${form?.name ?? ""}`}>
        {form && (
          <div className="space-y-3">
            <div>
              <label htmlFor="ac-name" className="block text-sm text-slate-600">Name</label>
              <input id="ac-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Air conditioners" className={inputClass} />
            </div>
            <div>
              <label htmlFor="ac-code" className="block text-sm text-slate-600">Code</label>
              <input id="ac-code" value={form.code} disabled={form.mode === "edit"}
                onChange={(e) => setForm({ ...form, code: e.target.value.toLowerCase().replace(/\s+/g, "-") })}
                placeholder="e.g. ac" className={inputClass + " font-mono disabled:bg-slate-50 disabled:text-slate-500"} />
            </div>
            <div>
              <label htmlFor="ac-desc" className="block text-sm text-slate-600">What goes in it</label>
              <input id="ac-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} />
            </div>
            {form.mode === "edit" && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input id="ac-active" type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                Active — offered when registering an asset
              </label>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              {form.mode === "edit" && (
                <Button variant="ghost" icon={Trash2} className="mr-auto text-rose-700" disabled={saving} onClick={remove}>Delete</Button>
              )}
              <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
              <Button onClick={save} disabled={saving || !form.name.trim() || form.code.trim().length < 2}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
