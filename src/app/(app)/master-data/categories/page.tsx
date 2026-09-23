"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { FolderTree, Plus, Pencil, Trash2, CornerDownRight } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/drawer";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { categoryTree } from "@/components/ui/category-options";
import { procurement } from "@/demo/api";
import type { ItemCategory } from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";

/** The item category tree: **Category → Item type → Item** (owner,
 *  2026-09-23). *Packing → Foam Sheet → Foam Sheet 2mm*.
 *
 *  Two levels live here; the third is the item itself, whose name carries its
 *  specification — a different size, colour or unit is a different item, and
 *  is added on the Items page. A category or type is deleted only when
 *  nothing is filed under it.
 */
const inputClass =
  "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none";

type Form = { mode: "create" | "edit"; code: string; name: string; parent_code: string };

export default function CategoriesPage() {
  const { can } = useSession();
  const { toast } = useToast();
  const mayEdit = can("procurement.update");
  const [cats, reloadCats] = useLoad(() => procurement.listCategories(), []);
  const [items] = useLoad(() => procurement.listItemViews({ include_archived: true }), []);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);

  /** Items filed directly under each code. */
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    if (items.status === "ready") {
      for (const i of items.data) m.set(i.category_code, (m.get(i.category_code) ?? 0) + 1);
    }
    return m;
  }, [items]);

  const list = cats.status === "ready" ? cats.data : [];
  const tops = list.filter((c) => !c.parent_code && c.code !== "uncurated");

  async function save() {
    if (!form) return;
    setSaving(true);
    const input = { name: form.name, parent_code: form.parent_code || null };
    const res = form.mode === "create"
      ? await procurement.createCategory(input)
      : await procurement.updateCategory(form.code, input);
    setSaving(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", "Not saved", res.error.message);
      return;
    }
    toast("success", form.mode === "create" ? "Added" : "Saved", res.data.name);
    setForm(null);
    reloadCats();
  }

  async function remove(c: ItemCategory) {
    setSaving(true);
    const res = await procurement.deleteCategory(c.code);
    setSaving(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", "Not deleted", res.error.message);
      return;
    }
    toast("success", "Deleted", `"${c.name}" is gone. Nothing was filed under it.`);
    setForm(null);
    reloadCats();
  }

  function row(c: ItemCategory, isType: boolean, typeCount: number) {
    const direct = counts.get(c.code) ?? 0;
    return (
      <li key={c.code} className={isType ? "flex items-center gap-2 py-2 pl-8 pr-3" : "flex items-center gap-2 px-3 py-2.5"}>
        {isType && <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-slate-300" />}
        <span className="min-w-0 flex-1">
          <span className={isType ? "text-[13px] text-slate-700" : "text-sm font-semibold text-slate-800"}>{c.name}</span>
          <span className="ml-2 font-mono text-[10px] text-slate-400">{c.code}</span>
        </span>
        {!isType && typeCount > 0 && <Badge tone="slate">{typeCount} type{typeCount === 1 ? "" : "s"}</Badge>}
        <Link
          href={`/master-data/items?category=${encodeURIComponent(c.code)}`}
          className="shrink-0 text-[12px] tabular-nums text-brand-700 hover:underline"
        >
          {direct} item{direct === 1 ? "" : "s"}
        </Link>
        {mayEdit && c.code !== "uncurated" && (
          <span className="flex shrink-0 gap-1">
            {!isType && (
              <Button
                variant="ghost" size="sm" icon={Plus}
                aria-label={`Add item type under ${c.name}`}
                onClick={() => setForm({ mode: "create", code: "", name: "", parent_code: c.code })}
              >
                Type
              </Button>
            )}
            <Button
              variant="ghost" size="sm" icon={Pencil}
              aria-label={`Edit ${c.name}`}
              onClick={() => setForm({ mode: "edit", code: c.code, name: c.name, parent_code: c.parent_code ?? "" })}
            >
              <span className="sr-only">Edit</span>
            </Button>
          </span>
        )}
      </li>
    );
  }

  const editing = form?.mode === "edit" ? list.find((c) => c.code === form.code) : undefined;
  const editingHasTypes = !!editing && list.some((c) => c.parent_code === editing.code);

  return (
    <div>
      <PageHeader
        breadcrumb="Master Data"
        title="Item categories"
        description="Category → Item type → Item. The item is the thing bought, with its specification in its name."
        actions={mayEdit && (
          <Button icon={Plus} onClick={() => setForm({ mode: "create", code: "", name: "", parent_code: "" })}>
            Add category
          </Button>
        )}
      />

      <Card>
        <CardHeader
          title="Category tree"
          subtitle="e.g. Packing → Foam Sheet → Foam Sheet 2mm. A different size, colour or unit is a different item."
          icon={FolderTree}
          action={<SourceBadge state={cats} />}
        />
        <Loaded state={cats} onRetry={reloadCats}>
          {(all) => (
            <ul className="divide-y divide-slate-100" data-testid="category-tree">
              {categoryTree(all).map(({ top, types }) => (
                <li key={top.code}>
                  <ul className="divide-y divide-slate-50">
                    {row(top, false, types.length)}
                    {types.map((t) => row(t, true, 0))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Loaded>
      </Card>

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.mode === "create" ? (form.parent_code ? "Add item type" : "Add category") : "Edit category"}
      >
        {form && (
          <div className="space-y-3">
            <div>
              <label htmlFor="cat-name" className="block text-sm text-slate-600">Name</label>
              <input
                id="cat-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={form.parent_code ? "e.g. Foam Sheet" : "e.g. Packing"}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="cat-parent" className="block text-sm text-slate-600">Sits under</label>
              <select
                id="cat-parent"
                value={form.parent_code}
                onChange={(e) => setForm({ ...form, parent_code: e.target.value })}
                disabled={editingHasTypes || form.code === "uncurated"}
                className={inputClass + " bg-white"}
              >
                <option value="">— Top level (a category) —</option>
                {tops.filter((t) => t.code !== form.code).map((t) => (
                  <option key={t.code} value={t.code}>{t.name} (an item type under it)</option>
                ))}
              </select>
              {editingHasTypes && (
                <p className="mt-1 text-xs text-slate-500">It has item types of its own, so it stays a top-level category.</p>
              )}
            </div>
            <p className="text-xs text-slate-500">
              Items are the third level and are added on the Items page — e.g. <em>Foam Sheet 2mm</em> under
              <em> Packing › Foam Sheet</em>.
            </p>
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              {form.mode === "edit" && form.code !== "uncurated" && (
                <Button
                  variant="ghost" icon={Trash2} className="mr-auto text-rose-700"
                  disabled={saving}
                  onClick={() => editing && remove(editing)}
                >
                  Delete
                </Button>
              )}
              <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
              <Button onClick={save} disabled={saving || !form.name.trim()}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
