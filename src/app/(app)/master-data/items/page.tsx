"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Boxes, Plus, Check, Tag, TrendingUp, Store, Pencil, Archive, ArchiveRestore, GitMerge,
  Receipt, FolderInput, X, Sparkles,
} from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader, StatCard } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Drawer, Modal } from "@/components/ui/drawer";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { formatIDR, formatNumber } from "@/lib/format";
import { procurement } from "@/demo/api";
import { type ItemPurchase, type ItemView, type UomCode } from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";
import { UomOptions } from "@/components/ui/uom-options";
import { CategoryOptions } from "@/components/ui/category-options";
import { ItemRelations, PriceTrend } from "./ItemRelations";
import { SuggestPanel } from "./SuggestPanel";

/** The purchasing catalogue — the third level of **Category → Item type →
 *  Item** (owner, 2026-09-23). An item is the thing bought with its
 *  specification in its name: *Foam Sheet 2mm* under *Packing › Foam Sheet*.
 *
 *  Two prices live here and they are not the same thing:
 *
 *    standard_price  what we say this costs. Curated, only ever set by a person.
 *    last_price      what we actually paid last time. A trace, never edited.
 *
 *  Duplicates are merged rather than deleted — the loser's purchases then read
 *  as the survivor's — and an item no longer bought is archived, which takes
 *  it out of every picker and leaves its history where it is.
 */
const inputClass =
  "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none";

type EditForm = {
  name: string; category_code: string; base_uom: string;
  kind: "goods" | "service"; standard_price: string;
};

export default function CatalogPage() {
  const { can } = useSession();
  const { toast } = useToast();
  const mayEdit = can("procurement.update");

  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [curated, setCurated] = useState<"" | "yes" | "no">("");
  const [showArchived, setShowArchived] = useState(false);
  /* A link from the category tree lands here already filtered. Read once from
     the address rather than through `useSearchParams`, which would make this
     page wait on a suspense boundary for one string. */
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("category");
    if (c) setCategory(c);
  }, []);

  const [state, reload] = useLoad(() => procurement.listItemViews({
    q: q || undefined,
    category: category || undefined,
    curated: curated === "" ? undefined : curated === "yes",
    include_archived: showArchived,
  }), [q, category, curated, showArchived]);
  const [cats, reloadCats] = useLoad(() => procurement.listCategories(), []);
  const [suggesting, setSuggesting] = useState(false);
  const catList = cats.status === "ready" ? cats.data : [];

  const [selected, setSelected] = useState<ItemView | null>(null);
  const [purchases, setPurchases] = useState<ItemPurchase[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ name: string; uom: UomCode; category_code: string }>({
    name: "", uom: "pcs", category_code: "uncurated",
  });
  const [editing, setEditing] = useState<EditForm | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeQ, setMergeQ] = useState("");
  const [mergeTarget, setMergeTarget] = useState<ItemView | null>(null);
  const [saving, setSaving] = useState(false);

  /* Bulk filing: the uncurated pile is not opened one drawer at a time. */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkCurate, setBulkCurate] = useState(true);
  useEffect(() => { setPicked(new Set()); }, [q, category, curated, showArchived]);

  /* `sourced_from` and the purchase history are fetched when the drawer
     opens, not per row: 1.045 items times one scan of the history each is
     what took the supplier page to a statement timeout. */
  const detailFor = useRef<string | null>(null);
  useEffect(() => {
    const id = selected?.id;
    if (!id) { detailFor.current = null; setPurchases(null); return; }
    if (detailFor.current === id) return;
    detailFor.current = id;
    setPurchases(null);
    let live = true;
    void procurement.getItem(id).then((res) => {
      if (live && res.data) setSelected((cur) => (cur?.id === id ? res.data : cur));
    });
    void procurement.itemPurchases(id).then((res) => {
      if (live) setPurchases(res.data ?? []);
    });
    return () => { live = false; };
  }, [selected?.id]);

  function afterWrite(updated?: ItemView | null) {
    reload();
    if (updated) {
      detailFor.current = null;
      setSelected(updated);
    }
  }

  async function addItem() {
    if (!form.name.trim()) return;
    setSaving(true);
    const res = await procurement.createItem(
      { name: form.name, base_uom: form.uom, category_code: form.category_code },
      `item-${form.name}`,
    );
    setSaving(false);
    if (res.error) { toast(res.error.status === 409 ? "warning" : "critical", "Not added", res.error.message); return; }
    toast("success", "Item added", `"${res.data.name}" is on record as not yet curated, with no standard price.`);
    setForm({ name: "", uom: "pcs", category_code: form.category_code });
    setAdding(false);
    reload();
  }

  async function curate(i: ItemView, next: boolean) {
    const res = await procurement.curateItem(i.id, { curated: next });
    if (res.error) { toast("warning", "Nothing changed", res.error.message); return; }
    toast("success", next ? "Curated" : "Moved back to uncurated", `"${i.name}"`);
    afterWrite(res.data);
  }

  function openEdit(i: ItemView) {
    setEditing({
      name: i.name, category_code: i.category_code, base_uom: i.base_uom ?? "",
      kind: i.kind, standard_price: i.standard_price != null ? String(i.standard_price) : "",
    });
  }

  async function saveEdit() {
    if (!selected || !editing) return;
    const price = editing.standard_price.trim();
    if (price && !(Number(price) >= 0)) {
      toast("warning", "Not saved", "The standard price must be a number, zero or more.");
      return;
    }
    setSaving(true);
    const res = await procurement.updateItem(selected.id, {
      name: editing.name,
      category_code: editing.category_code,
      ...(editing.base_uom ? { base_uom: editing.base_uom as UomCode } : {}),
      kind: editing.kind,
      standard_price: price ? Number(price) : null,
    });
    setSaving(false);
    if (res.error) { toast(res.error.status === 409 ? "warning" : "critical", "Not saved", res.error.message); return; }
    toast("success", "Item updated", `"${res.data.name}"`);
    setEditing(null);
    afterWrite(res.data);
  }

  async function archive(i: ItemView, next: boolean) {
    const res = await procurement.archiveItem(i.id, next);
    if (res.error) { toast("warning", "Nothing changed", res.error.message); return; }
    toast("success", next ? "Archived" : "Restored",
      next ? `"${i.name}" is out of every picker. Its history stays.` : `"${i.name}" is back in the pickers.`);
    afterWrite(res.data);
  }

  async function merge() {
    if (!selected || !mergeTarget) return;
    setSaving(true);
    const res = await procurement.mergeItem(selected.id, mergeTarget.id);
    setSaving(false);
    if (res.error) { toast(res.error.status === 409 ? "warning" : "critical", "Not merged", res.error.message); return; }
    toast("success", "Merged", `"${selected.name}" now reads as "${res.data.name}". Its purchases moved with it.`);
    setMerging(false);
    setMergeTarget(null);
    setMergeQ("");
    afterWrite(res.data);
  }

  async function fileBulk() {
    if (!bulkCategory || picked.size === 0) return;
    setSaving(true);
    const res = await procurement.setItemsCategory([...picked], bulkCategory, bulkCurate ? true : undefined);
    setSaving(false);
    if (res.error) { toast("warning", "Not filed", res.error.message); return; }
    const where = catList.find((c) => c.code === bulkCategory)?.name ?? bulkCategory;
    toast("success", "Filed", `${res.data.updated} item(s) → ${where}${bulkCurate ? ", curated" : ""}.`);
    setPicked(new Set());
    reload();
  }

  const rows = useMemo(() => (state.status === "ready" ? state.data : []), [state]);
  const allPicked = rows.length > 0 && rows.every((i) => picked.has(i.id));
  function toggle(id: string) {
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const columns: Column<ItemView>[] = [
    ...(mayEdit ? [{
      key: "pick",
      header: (
        <input
          type="checkbox" aria-label="Select all shown"
          checked={allPicked}
          onChange={() => setPicked(allPicked ? new Set() : new Set(rows.map((i) => i.id)))}
        />
      ),
      className: "w-8",
      render: (i: ItemView) => (
        <input
          type="checkbox" aria-label={`Select ${i.name}`}
          checked={picked.has(i.id)}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggle(i.id)}
        />
      ),
    }] : []),
    {
      key: "name",
      header: "Item",
      className: "max-w-[300px]",
      render: (i) => (
        <div>
          <p className="font-medium text-slate-800">
            {i.name}
            {i.archived_at && <Badge tone="slate" className="ml-2">Archived</Badge>}
          </p>
          <p className="font-mono text-[11px] text-slate-400">{i.code} · {i.base_uom ?? "no unit"}</p>
        </div>
      ),
    },
    {
      key: "cat",
      header: "Category",
      render: (i) => <span className="text-slate-600">{i.category_path ?? i.category_name}</span>,
    },
    {
      key: "std",
      header: "Standard price",
      align: "right",
      render: (i) =>
        i.standard_price != null
          ? <span className="tabular-nums font-medium text-slate-800">{formatIDR(i.standard_price)}</span>
          : <span className="text-slate-300">&mdash;</span>,
    },
    {
      key: "last",
      header: "Last paid",
      align: "right",
      render: (i) =>
        i.last_price != null
          ? <span className="tabular-nums text-slate-500">{formatIDR(i.last_price)}</span>
          : <span className="text-slate-300">&mdash;</span>,
    },
    {
      key: "bought",
      header: "Bought",
      align: "right",
      render: (i) => <span className="tabular-nums text-slate-500">{i.purchase_count > 0 ? `${i.purchase_count}×` : "—"}</span>,
    },
    {
      key: "curated",
      header: "Catalogue",
      render: (i) =>
        i.is_curated ? <Badge tone="green" dot>Curated</Badge> : <Badge tone="amber" dot>Not yet curated</Badge>,
    },
  ];

  /* The survivor is searched across the whole catalogue, not just the rows
     the table happens to show — with a filter on, the item to keep is
     usually one the table is hiding. */
  const [mergeFound, setMergeFound] = useState<ItemView[]>([]);
  useEffect(() => {
    if (!merging) return;
    let live = true;
    void procurement.listItemViews({ q: mergeQ.trim() || undefined }).then((res) => {
      if (live) setMergeFound(res.data ?? []);
    });
    return () => { live = false; };
  }, [merging, mergeQ]);
  const mergeOptions = useMemo(
    () => mergeFound.filter((i) => i.id !== selected?.id).slice(0, 12),
    [mergeFound, selected],
  );

  /* The price story in one line: what it has cost, at the extremes and last. */
  const priceRange = useMemo(() => {
    const prices = (purchases ?? []).map((p) => p.unit_price).filter((x): x is number => x != null && x > 0);
    if (prices.length === 0) return null;
    return { min: Math.min(...prices), max: Math.max(...prices), n: prices.length };
  }, [purchases]);

  return (
    <div>
      <PageHeader
        breadcrumb="Master Data"
        title="Items"
        description="What we buy — the bottom of Category → Item type → Item. A different size, colour or unit is a different item."
        actions={mayEdit && (
          <div className="flex gap-2">
            <Button variant="outline" icon={Sparkles} onClick={() => setSuggesting(true)}>Suggest filing</Button>
            <Button icon={Plus} onClick={() => setAdding(true)}>Add item</Button>
          </div>
        )}
      />

      <SuggestPanel
        open={suggesting} onClose={() => setSuggesting(false)} categories={catList}
        onChanged={() => { reload(); reloadCats(); }}
      />

      <Loaded state={state} onRetry={reload}>
        {(items) => {
          const curatedN = items.filter((i) => i.is_curated).length;
          const priced = items.filter((i) => i.standard_price != null).length;
          return (
            <>
              <div className="mb-6 grid gap-4 sm:grid-cols-3">
                <StatCard label="Items shown" value={items.length} icon={Boxes} hint={`${curatedN} curated`} />
                <StatCard
                  label="With a standard price"
                  value={`${priced} of ${items.length}`}
                  icon={Tag}
                  tone="violet"
                  hint="The rest fall back to what was last paid"
                />
                <StatCard
                  label="Not yet curated"
                  value={items.length - curatedN}
                  icon={TrendingUp}
                  tone="amber"
                  hint="Select them below and file them in one go"
                />
              </div>

              <Card>
                <CardHeader
                  title="All items"
                  subtitle="Standard price is set by a person; last paid is what actually happened. Click a row for its purchase history."
                  icon={Boxes}
                  action={
                    <div className="flex flex-wrap items-center gap-2">
                      <SourceBadge state={state} />
                      <select
                        id="cat-filter"
                        aria-label="Category"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="h-9 max-w-[220px] rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none"
                      >
                        <option value="">All categories</option>
                        <CategoryOptions categories={catList} />
                      </select>
                      <select
                        id="curated-filter"
                        aria-label="Catalogue status"
                        value={curated}
                        onChange={(e) => setCurated(e.target.value as "" | "yes" | "no")}
                        className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none"
                      >
                        <option value="">Curated and not</option>
                        <option value="yes">Curated</option>
                        <option value="no">Not yet curated</option>
                      </select>
                      <label className="flex items-center gap-1.5 text-[13px] text-slate-600">
                        <input
                          id="item-show-archived" type="checkbox"
                          checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)}
                        />
                        Show archived
                      </label>
                      <input
                        id="item-search"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Search item&hellip;"
                        className="h-9 w-40 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none"
                      />
                    </div>
                  }
                />

                {mayEdit && picked.size > 0 && (
                  <div
                    className="flex flex-wrap items-center gap-2 border-b border-brand-100 bg-brand-50/60 px-4 py-2.5 text-[13px]"
                    data-testid="bulk-bar"
                  >
                    <FolderInput className="h-4 w-4 text-brand-700" />
                    <span className="font-medium text-brand-900">{picked.size} selected</span>
                    <span className="text-slate-500">→ file under</span>
                    <select
                      id="bulk-category"
                      aria-label="File selected under"
                      value={bulkCategory}
                      onChange={(e) => setBulkCategory(e.target.value)}
                      className="h-8 max-w-[240px] rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
                    >
                      <option value="">Pick a category or type…</option>
                      <CategoryOptions categories={catList} typesOnlyWhereAvailable />
                    </select>
                    <label className="flex items-center gap-1.5 text-slate-600">
                      <input type="checkbox" checked={bulkCurate} onChange={(e) => setBulkCurate(e.target.checked)} />
                      and mark curated
                    </label>
                    <Button size="sm" disabled={saving || !bulkCategory} onClick={fileBulk}>File them</Button>
                    <Button variant="ghost" size="sm" icon={X} onClick={() => setPicked(new Set())}>Clear</Button>
                  </div>
                )}

                <DataTable
                  columns={columns}
                  rows={items}
                  rowKey={(i) => i.id}
                  onRowClick={setSelected}
                  dense
                  empty={q || category || curated ? "Nothing matches those filters." : "No items yet."}
                />
              </Card>
            </>
          );
        }}
      </Loaded>

      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ""}
        subtitle={selected ? `${selected.code} · ${selected.category_path ?? selected.category_name} · per ${selected.base_uom ?? "—"}` : undefined}
        width="max-w-xl"
        footer={
          selected && mayEdit ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                size="sm" variant="ghost"
                icon={selected.archived_at ? ArchiveRestore : Archive}
                className="mr-auto"
                onClick={() => archive(selected, !selected.archived_at)}
              >
                {selected.archived_at ? "Restore" : "Archive"}
              </Button>
              <Button size="sm" variant="outline" icon={GitMerge} onClick={() => setMerging(true)}>
                Merge into…
              </Button>
              <Button size="sm" variant="outline" icon={Pencil} onClick={() => openEdit(selected)}>
                Edit
              </Button>
              <Button
                size="sm"
                icon={Check}
                variant={selected.is_curated ? "outline" : "primary"}
                onClick={() => curate(selected, !selected.is_curated)}
              >
                {selected.is_curated ? "Uncurate" : "Curate"}
              </Button>
            </div>
          ) : null
        }
      >
        {selected && (
          <div className="space-y-5 text-sm">
            {selected.archived_at && (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-[13px] text-slate-600">
                Archived — out of every picker. Its purchases stay on record.
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-200 px-3 py-3">
                <p className="text-xs text-slate-400">Standard price</p>
                <p className="mt-1 text-base font-semibold tabular-nums text-slate-800">
                  {selected.standard_price != null ? formatIDR(selected.standard_price) : "—"}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">Set by a person. Never written automatically.</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-3">
                <p className="text-xs text-slate-400">Last paid</p>
                <p className="mt-1 text-base font-semibold tabular-nums text-slate-700">
                  {selected.last_price != null ? formatIDR(selected.last_price) : "—"}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {selected.last_vendor_name ? `${selected.last_vendor_name}, ${selected.last_purchased_at?.slice(0, 10)}` : "No purchase on record"}
                </p>
              </div>
            </div>

            {purchases && <PriceTrend purchases={purchases} />}

            {/* Every ledger line it was bought on — the item's relation to the
                transactions, including lines written against duplicates that
                were merged into it. */}
            <section>
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Receipt className="h-3.5 w-3.5" /> Ledger purchases
              </p>
              {purchases === null ? (
                <p className="text-[13px] text-slate-400">Loading…</p>
              ) : purchases.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-3 text-slate-500">
                  No ledger line names this item yet.
                </p>
              ) : (
                <>
                  {priceRange && (
                    <p className="mb-2 text-[12px] text-slate-500">
                      {purchases.length} purchase{purchases.length === 1 ? "" : "s"} · unit price{" "}
                      {priceRange.min === priceRange.max
                        ? formatIDR(priceRange.min)
                        : `${formatIDR(priceRange.min)} – ${formatIDR(priceRange.max)}`}
                    </p>
                  )}
                  <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200" data-testid="item-purchases">
                    {purchases.map((p) => (
                      <li key={`${p.trx_no}-${p.description}-${p.amount}`} className="px-3 py-2 text-[13px]">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block truncate text-slate-700">{p.vendor_name ?? "No vendor"}</span>
                            <span className="block font-mono text-[10px] text-slate-400">
                              <Link href={`/accounting/ledger?trx=${encodeURIComponent(p.trx_no)}`} className="hover:text-brand-700 hover:underline">
                                {p.trx_no}
                              </Link>
                              {" · "}{p.trx_date} · {p.account_code}
                              {p.item_code !== selected.code && ` · as ${p.item_name}`}
                            </span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block tabular-nums font-medium text-slate-800">{formatIDR(p.amount)}</span>
                            <span className="block text-[11px] text-slate-400">
                              {p.qty ?? "—"} {p.uom ?? ""} × {p.unit_price != null ? formatIDR(p.unit_price) : "—"}
                            </span>
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section>
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Store className="h-3.5 w-3.5" /> Where we buy this
              </p>
              {selected.sourced_from.length > 0 ? (
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {selected.sourced_from.map((s) => (
                    <li key={s.vendor_id} className="px-3 py-2.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-slate-800">{s.vendor_name}</span>
                          {s.pic_name ? (
                            <span className="block text-[11px] text-slate-500">
                              {s.pic_name}
                              {s.pic_phone && (
                                <>
                                  {" · "}
                                  <a href={`tel:${s.pic_phone.replace(/[^0-9+]/g, "")}`} className="font-mono text-brand-700 hover:underline">
                                    {s.pic_phone}
                                  </a>
                                </>
                              )}
                            </span>
                          ) : (
                            <span className="block text-[11px] text-slate-400">No contact on record</span>
                          )}
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block tabular-nums text-[13px] font-medium text-slate-800">
                            {s.last_price != null ? formatIDR(s.last_price) : "—"}
                          </span>
                          <span className="block text-[11px] text-slate-400">
                            {s.uom ? `per ${s.uom} · ` : ""}{String(s.last_date).slice(0, 10)}
                          </span>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-3 text-slate-500">
                  No vendor on record for this item.
                </p>
              )}
            </section>

            <ItemRelations itemId={selected.id} itemCode={selected.code} />

            <dl className="space-y-3">
              {([
                ["Category", selected.category_path ?? selected.category_name],
                ["Unit", selected.base_uom ?? "—"],
                ["Kind", selected.kind],
                ["Times bought (requests + ledger)", formatNumber(selected.purchase_count)],
                ...(selected.aka.length > 0 ? [["Also known as", selected.aka.join(", ")]] : []),
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-slate-100 pb-2.5">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="text-right font-medium text-slate-800">{v}</dd>
                </div>
              ))}
            </dl>

            {!selected.is_curated && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
                <p className="font-medium">Not yet curated</p>
                <p className="mt-1">
                  It arrived because something was bought. Until someone curates it, it stays out of
                  request dropdowns and out of the names the extractor treats as canonical.
                </p>
              </div>
            )}
          </div>
        )}
      </Drawer>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add item">
        <div className="space-y-3">
          <div>
            <label htmlFor="new-item" className="block text-sm text-slate-600">Item name, with its specification</label>
            <input
              id="new-item"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Foam Sheet 2mm"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="new-item-cat" className="block text-sm text-slate-600">Category › item type</label>
            <select
              id="new-item-cat"
              value={form.category_code}
              onChange={(e) => setForm({ ...form, category_code: e.target.value })}
              className={inputClass + " bg-white"}
            >
              <CategoryOptions categories={catList} typesOnlyWhereAvailable current={form.category_code} />
            </select>
          </div>
          <div>
            <label htmlFor="new-item-uom" className="block text-sm text-slate-600">Base unit</label>
            <select
              id="new-item-uom"
              value={form.uom}
              onChange={(e) => setForm({ ...form, uom: e.target.value as UomCode })}
              className={inputClass + " bg-white"}
            >
              <UomOptions current={form.uom} />
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Stock is always held in the base unit. Pack sizes convert to it rather than replacing it.
            </p>
          </div>
          <p className="text-xs text-slate-500">
            Saved as <strong>not yet curated</strong> with no standard price.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            <Button onClick={addItem} disabled={saving || !form.name.trim()}>
              {saving ? "Saving…" : "Add item"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!editing} onClose={() => setEditing(null)} title="Edit item">
        {editing && (
          <div className="space-y-3">
            <div>
              <label htmlFor="edit-item-name" className="block text-sm text-slate-600">Name, with its specification</label>
              <input
                id="edit-item-name"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                className={inputClass}
              />
              <p className="mt-1 text-xs text-slate-500">The old name is kept as an alias, so search still finds it.</p>
            </div>
            <div>
              <label htmlFor="edit-item-cat" className="block text-sm text-slate-600">Category › item type</label>
              <select
                id="edit-item-cat"
                value={editing.category_code}
                onChange={(e) => setEditing({ ...editing, category_code: e.target.value })}
                className={inputClass + " bg-white"}
              >
                <CategoryOptions categories={catList} typesOnlyWhereAvailable current={editing.category_code} />
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="edit-item-uom" className="block text-sm text-slate-600">Base unit</label>
                <select
                  id="edit-item-uom"
                  value={editing.base_uom}
                  onChange={(e) => setEditing({ ...editing, base_uom: e.target.value })}
                  className={inputClass + " bg-white"}
                >
                  {!editing.base_uom && <option value="">— not set —</option>}
                  <UomOptions current={editing.base_uom || undefined} />
                </select>
              </div>
              <div>
                <label htmlFor="edit-item-kind" className="block text-sm text-slate-600">Kind</label>
                <select
                  id="edit-item-kind"
                  value={editing.kind}
                  onChange={(e) => setEditing({ ...editing, kind: e.target.value as "goods" | "service" })}
                  className={inputClass + " bg-white"}
                >
                  <option value="goods">Goods</option>
                  <option value="service">Service</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="edit-item-price" className="block text-sm text-slate-600">Standard price (IDR)</label>
              <input
                id="edit-item-price"
                inputMode="numeric"
                value={editing.standard_price}
                onChange={(e) => setEditing({ ...editing, standard_price: e.target.value.replace(/[^0-9.]/g, "") })}
                placeholder="Leave empty for none"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-slate-500">Empty clears it. The last paid price is never changed here.</p>
            </div>
            <p className="text-xs text-slate-500">
              Minimum stock is set on the item&apos;s page in Inventory.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
              <Button onClick={saveEdit} disabled={saving || !editing.name.trim()}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={merging} onClose={() => { setMerging(false); setMergeTarget(null); }} title="Merge into another item">
        {selected && (
          <div className="space-y-3">
            <p className="text-[13px] text-slate-600">
              <strong>{selected.name}</strong> will point at the item you pick. Its purchases then read as
              that item&apos;s, and its name becomes an alias there. Nothing is deleted.
            </p>
            <div>
              <label htmlFor="merge-search" className="block text-sm text-slate-600">Find the item to keep</label>
              <input
                id="merge-search"
                value={mergeQ}
                onChange={(e) => { setMergeQ(e.target.value); setMergeTarget(null); }}
                placeholder="Search by name or code"
                className={inputClass}
              />
            </div>
            <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {mergeOptions.length === 0 ? (
                <li className="px-3 py-2 text-[13px] text-slate-400">No item matches.</li>
              ) : mergeOptions.map((i) => (
                <li key={i.id}>
                  <button
                    onClick={() => setMergeTarget(i)}
                    className={
                      "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] "
                      + (mergeTarget?.id === i.id ? "bg-brand-50 text-brand-900" : "hover:bg-slate-50")
                    }
                  >
                    <span className="min-w-0 truncate">{i.name}</span>
                    <span className="shrink-0 font-mono text-[10px] text-slate-400">{i.code} · {i.purchase_count}×</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => { setMerging(false); setMergeTarget(null); }}>Cancel</Button>
              <Button icon={GitMerge} onClick={merge} disabled={saving || !mergeTarget}>
                {mergeTarget ? `Merge into ${mergeTarget.name}` : "Pick an item"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
