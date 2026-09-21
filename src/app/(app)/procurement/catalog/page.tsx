"use client";

import { useEffect, useRef, useState } from "react";
import { Boxes, Plus, Check, Tag, TrendingUp, Store } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader, StatCard } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Drawer, Modal } from "@/components/ui/drawer";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { formatIDR, formatNumber } from "@/lib/format";
import { procurement } from "@/demo/api";
import { UNITS, type ItemView, type UomCode } from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";

/** The purchasing catalogue.
 *
 *  Two prices live here and they are not the same thing, which is the point of
 *  the screen:
 *
 *    standard_price  what we say this costs. Curated, only ever set by a person.
 *    last_price      what we actually paid last time. A trace, never edited.
 *
 *  A form prefills with `standard_price ?? last_price` — a hint, not a price
 *  list. Conflating them is how one panic purchase at a bad price quietly
 *  becomes the official number.
 */
export default function CatalogPage() {
  const { can } = useSession();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<ItemView | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ name: string; uom: UomCode }>({ name: "", uom: "pcs" });
  const [saving, setSaving] = useState(false);

  const [state, reload] = useLoad(() => procurement.listItemViews({ q, category: category || undefined }), [q, category]);
  const [cats] = useLoad(() => procurement.listCategories(), []);

  /* `sourced_from` is left out of the list for the same reason the supplier
     screen leaves out its history: a subquery per row over every purchase,
     and 1.020 items. The drawer is the only thing that reads it, so it is
     fetched when the drawer opens. See `VENDOR_LIST_COLUMNS` in
     `src/lib/api/procurement.ts`. */
  const detailFor = useRef<string | null>(null);
  useEffect(() => {
    const id = selected?.id;
    if (!id || detailFor.current === id) return;
    detailFor.current = id;
    let live = true;
    void procurement.getItem(id).then((res) => {
      if (live && res.data) setSelected((cur) => (cur?.id === id ? res.data : cur));
    });
    return () => { live = false; };
  }, [selected?.id]);
  const mayEdit = can("procurement.update");

  async function addItem() {
    if (!form.name.trim()) return;
    setSaving(true);
    const res = await procurement.createItem({ name: form.name, base_uom: form.uom }, `item-${form.name}`);
    setSaving(false);
    if (res.error) { toast(res.error.status === 409 ? "warning" : "critical", "Not added", res.error.message); return; }
    toast("success", "Item added", `"${res.data.name}" is on record as not yet curated, with no standard price.`);
    setForm({ name: "", uom: "pcs" });
    setAdding(false);
    reload();
  }

  async function curate(i: ItemView, curated: boolean) {
    const res = await procurement.curateItem(i.id, { curated });
    if (res.error) { toast("warning", "Nothing changed", res.error.message); return; }
    toast("success", curated ? "Curated" : "Moved back to uncurated", `"${i.name}"`);
    reload();
    setSelected(null);
  }

  const columns: Column<ItemView>[] = [
    {
      key: "name",
      header: "Item",
      className: "max-w-[300px]",
      render: (i) => (
        <div>
          <p className="font-medium text-slate-800">{i.name}</p>
          <p className="font-mono text-[11px] text-slate-400">{i.code} · {i.base_uom}</p>
        </div>
      ),
    },
    { key: "cat", header: "Category", render: (i) => <span className="text-slate-600">{i.category_name}</span> },
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
      key: "curated",
      header: "Catalogue",
      render: (i) =>
        i.is_curated ? <Badge tone="green" dot>Curated</Badge> : <Badge tone="amber" dot>Not yet curated</Badge>,
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb="Procurement"
        title="Catalogue"
        description="What we buy. The catalogue grows by itself as things are purchased; deciding what is a real entry stays a human job."
        actions={mayEdit && <Button icon={Plus} onClick={() => setAdding(true)}>Add item</Button>}
      />

      <Loaded state={state} onRetry={reload}>
        {(items) => {
          const curated = items.filter((i) => i.is_curated);
          const priced = items.filter((i) => i.standard_price != null);
          return (
            <>
              <div className="mb-6 grid gap-4 sm:grid-cols-3">
                <StatCard label="Items on record" value={items.length} icon={Boxes} hint={`${curated.length} curated`} />
                <StatCard
                  label="With a standard price"
                  value={`${priced.length} of ${items.length}`}
                  icon={Tag}
                  tone="violet"
                  hint="The rest fall back to what was last paid"
                />
                <StatCard
                  label="Not yet curated"
                  value={items.length - curated.length}
                  icon={TrendingUp}
                  tone="amber"
                  hint="On record, absent from dropdowns"
                />
              </div>

              <Card>
                <CardHeader
                  title="All items"
                  subtitle="Standard price is curated and set by a person; last paid is a trace of what actually happened. They are never the same column."
                  icon={Boxes}
                  action={
                    <div className="flex flex-wrap items-center gap-2">
                      <SourceBadge state={state} />
                      <select
                        id="cat-filter"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none"
                      >
                        <option value="">All categories</option>
                        {cats.status === "ready" && cats.data.map((c) => (
                          <option key={c.code} value={c.code}>{c.name}</option>
                        ))}
                      </select>
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
                <DataTable
                  columns={columns}
                  rows={items}
                  rowKey={(i) => i.id}
                  onRowClick={setSelected}
                  dense
                  empty={q || category ? "Nothing matches those filters." : "No items yet."}
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
        subtitle={selected ? `${selected.code} · per ${selected.base_uom}` : undefined}
        footer={
          selected && mayEdit ? (
            <div className="flex justify-end">
              <Button
                size="sm"
                icon={Check}
                variant={selected.is_curated ? "outline" : "primary"}
                onClick={() => curate(selected, !selected.is_curated)}
              >
                {selected.is_curated ? "Move back to uncurated" : "Curate"}
              </Button>
            </div>
          ) : null
        }
      >
        {selected && (
          <div className="space-y-5 text-sm">
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
                            {s.uom ? `per ${s.uom} · ` : ""}{s.last_date}
                          </span>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-3 text-slate-500">
                  Never bought. Nothing on record says where this comes from.
                </p>
              )}
              {selected.sourced_from.length > 1 && (
                <p className="mt-2 text-xs text-slate-500">
                  Bought from {selected.sourced_from.length} vendors — the most recent is first.
                </p>
              )}
            </section>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-200 px-3 py-3">
                <p className="text-xs text-slate-400">Standard price</p>
                <p className="mt-1 text-base font-semibold tabular-nums text-slate-800">
                  {selected.standard_price != null ? formatIDR(selected.standard_price) : "—"}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">Curated. Never written automatically.</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-3">
                <p className="text-xs text-slate-400">Last paid</p>
                <p className="mt-1 text-base font-semibold tabular-nums text-slate-700">
                  {selected.last_price != null ? formatIDR(selected.last_price) : "—"}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {selected.last_vendor_name ? `${selected.last_vendor_name}, ${selected.last_purchased_at}` : "No purchase on record"}
                </p>
              </div>
            </div>

            <div className="rounded-lg bg-brand-50/60 px-3 py-2.5 text-[13px] text-brand-900">
              A form would prefill{" "}
              <strong>{selected.suggested_price != null ? formatIDR(selected.suggested_price) : "nothing"}</strong>
              {selected.standard_price != null ? " from the standard price" : selected.last_price != null ? " from the last price paid" : ""}
              . A hint, not a price list &mdash; it stays editable.
            </div>

            <dl className="space-y-3">
              {([
                ["Category", selected.category_name],
                ["Unit", selected.base_uom],
                ["Kind", selected.kind],
                ["Times purchased", formatNumber(selected.purchase_count)],
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
                  It arrived because something was bought, which is how the catalogue
                  grows. Until someone curates it, it stays out of dropdowns and out of
                  the list of names the extractor treats as canonical.
                </p>
              </div>
            )}
          </div>
        )}
      </Drawer>

      <Modal open={adding} onClose={() => setAdding(false)} title="Add item">
        <div className="space-y-3">
          <div>
            <label htmlFor="new-item" className="block text-sm text-slate-600">Item name</label>
            <input
              id="new-item"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. SEKRUP DRYWALL 1.5 INCH"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="new-item-uom" className="block text-sm text-slate-600">Base unit</label>
            <select
              id="new-item-uom"
              value={form.uom}
              onChange={(e) => setForm({ ...form, uom: e.target.value as UomCode })}
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
            >
              {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Stock is always held in the base unit. Pack sizes convert to it rather than replacing it.
            </p>
          </div>
          <p className="text-xs text-slate-500">
            Saved as <strong>not yet curated</strong> with no standard price. Prices arrive
            from what is actually paid; a standard price is set deliberately, later.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            <Button onClick={addItem} disabled={saving || !form.name.trim()}>
              {saving ? "Saving…" : "Add item"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
