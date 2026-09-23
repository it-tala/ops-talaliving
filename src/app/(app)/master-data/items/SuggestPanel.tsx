"use client";

import { useEffect, useState } from "react";
import { Archive, FolderInput, Sparkles } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/drawer";
import { procurement } from "@/demo/api";
import type { ItemCategory, ItemGroupSuggestion } from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";

/** The uncurated pile, grouped by the words the names lead with (Master Data
 *  phase 5). Each group is one proposed item type: accept it and the type is
 *  created under its category and every checked item is filed into it and
 *  curated, in two calls. Groups that read as payment descriptions —
 *  *transfer to …*, *payroll july* — are offered for archiving instead.
 *
 *  A heuristic, and the panel says so: every name is shown before anything
 *  is written, and any one of them can be unticked. */

type Row = ItemGroupSuggestion & {
  name: string; parent: string; into: string; unchecked: Set<string>; open: boolean;
};

const ARCHIVE_REASON = "Not an item — a payment description imported from the ledger (suggestion panel).";

export function SuggestPanel({
  open, onClose, categories, onChanged,
}: {
  open: boolean;
  onClose: () => void;
  categories: ItemCategory[];
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const tops = categories.filter((c) => !c.parent_code && c.code !== "uncurated");
  const types = categories.filter((c) => c.parent_code);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setRows(null);
    void Promise.all([
      procurement.suggestItemGroups(),
      procurement.listItemViews({ curated: false }),
    ]).then(([g, items]) => {
      if (!live) return;
      setNames(new Map((items.data ?? []).map((i) => [i.id, i.name])));
      setRows((g.data ?? []).map((s) => ({
        ...s, name: s.type_name, parent: s.parent_code ?? "", into: s.existing_type_code ?? "",
        unchecked: new Set(), open: false,
      })));
    });
    return () => { live = false; };
  }, [open]);

  const patch = (key: string, p: Partial<Row>) =>
    setRows((rs) => (rs ?? []).map((r) => (r.key === key ? { ...r, ...p } : r)));
  const done = (key: string) => setRows((rs) => (rs ?? []).filter((r) => r.key !== key));
  const chosen = (r: Row) => r.item_ids.filter((id) => !r.unchecked.has(id));

  async function file(r: Row) {
    const ids = chosen(r);
    if (ids.length === 0) return;
    setBusy(r.key);
    let target = r.into;
    if (!target) {
      const created = await procurement.createCategory({ name: r.name.trim(), parent_code: r.parent });
      if (created.error) { setBusy(null); toast("warning", "Type not created", created.error.message); return; }
      target = created.data.code;
    }
    const res = await procurement.setItemsCategory(ids, target, true);
    setBusy(null);
    if (res.error) { toast("warning", "Not filed", res.error.message); return; }
    toast("success", "Filed", `${res.data.updated} item${res.data.updated === 1 ? "" : "s"} into ${r.into ? types.find((t) => t.code === r.into)?.name : r.name}, curated.`);
    done(r.key);
    onChanged();
  }

  async function archive(r: Row) {
    const ids = chosen(r);
    if (ids.length === 0) return;
    setBusy(r.key);
    const res = await procurement.archiveItems(ids, ARCHIVE_REASON);
    setBusy(null);
    if (res.error) { toast("warning", "Not archived", res.error.message); return; }
    toast("success", "Archived", `${res.data.archived} item${res.data.archived === 1 ? "" : "s"} out of every picker. Their ledger lines stay.`);
    done(r.key);
    onChanged();
  }

  const goods = (rows ?? []).filter((r) => !r.not_goods);
  const payments = (rows ?? []).filter((r) => r.not_goods);

  function group(r: Row) {
    const n = chosen(r).length;
    const canFile = n > 0 && (!!r.into || (!!r.name.trim() && !!r.parent));
    return (
      <li key={r.key} className="px-4 py-3" data-testid={`suggest-${r.key}`}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={r.not_goods ? "amber" : "brand"}>{n}/{r.count}</Badge>
          {r.not_goods ? (
            <span className="text-[13px] font-medium text-slate-800">“{r.type_name}…”</span>
          ) : (
            <>
              <input
                aria-label={`Type name for ${r.key}`} value={r.name}
                onChange={(e) => patch(r.key, { name: e.target.value, into: "" })}
                disabled={!!r.into}
                className="h-8 w-40 rounded-lg border border-slate-200 px-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
              />
              <span className="text-[12px] text-slate-400">under</span>
              <select
                aria-label={`Category for ${r.key}`} value={r.parent} disabled={!!r.into}
                onChange={(e) => patch(r.key, { parent: e.target.value })}
                className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm disabled:bg-slate-50"
              >
                <option value="">Pick a category…</option>
                {tops.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
              </select>
              {types.length > 0 && (
                <select
                  aria-label={`Existing type for ${r.key}`} value={r.into}
                  onChange={(e) => patch(r.key, { into: e.target.value })}
                  className="h-8 max-w-[11rem] rounded-lg border border-slate-200 bg-white px-2 text-sm"
                >
                  <option value="">…or an existing type</option>
                  {types.map((t) => (
                    <option key={t.code} value={t.code}>
                      {categories.find((c) => c.code === t.parent_code)?.name} › {t.name}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
          <span className="ml-auto flex gap-1.5">
            {r.not_goods && (
              <Button size="sm" icon={Archive} disabled={busy !== null || n === 0} onClick={() => archive(r)}>
                Archive {n}
              </Button>
            )}
            {!r.not_goods && (
              <Button size="sm" icon={FolderInput} disabled={busy !== null || !canFile} onClick={() => file(r)}>
                {busy === r.key ? "Filing…" : r.into ? `File ${n}` : `Create & file ${n}`}
              </Button>
            )}
          </span>
        </div>
        <button
          type="button" onClick={() => patch(r.key, { open: !r.open })}
          className="mt-1 block text-left text-[12px] text-slate-500 hover:text-slate-700"
        >
          {r.open ? "Hide names" : `${r.sample.slice(0, 3).join(" · ")}${r.count > 3 ? ` · +${r.count - 3} more` : ""}`}
        </button>
        {r.open && (
          <ul className="mt-1.5 max-h-48 space-y-0.5 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/60 px-2 py-1.5">
            {r.item_ids.map((id) => (
              <li key={id}>
                <label className="flex items-center gap-2 text-[12px] text-slate-700">
                  <input
                    type="checkbox" checked={!r.unchecked.has(id)}
                    onChange={(e) => {
                      const next = new Set(r.unchecked);
                      if (e.target.checked) next.delete(id); else next.add(id);
                      patch(r.key, { unchecked: next });
                    }}
                  />
                  {names.get(id) ?? id}
                </label>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <Drawer
      open={open} onClose={onClose} width="max-w-3xl"
      title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-brand-600" /> Suggested filing</span>}
      subtitle="Uncurated items grouped by the words their names start with. A guess — check the names before accepting."
    >
      {rows === null ? (
        <p className="text-sm text-slate-400">Reading the uncurated pile…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-3 text-sm text-slate-500">
          No group of three or more uncurated items shares a name. What is left is filed one at a time.
        </p>
      ) : (
        <div className="space-y-5">
          {goods.length > 0 && (
            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Item types — {goods.length} groups, {goods.reduce((s, r) => s + r.count, 0)} items
              </p>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">{goods.map(group)}</ul>
            </section>
          )}
          {payments.length > 0 && (
            <section>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Not items — {payments.reduce((s, r) => s + r.count, 0)} payment descriptions
              </p>
              <p className="mb-2 text-[12px] text-slate-500">
                These came in from the old ledger as &ldquo;items&rdquo;. Archiving takes them out of every picker;
                the ledger lines written against them stay exactly as they are.
              </p>
              <ul className="divide-y divide-slate-100 rounded-lg border border-amber-200">{payments.map(group)}</ul>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}
