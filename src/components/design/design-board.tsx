"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, FolderOpen, Layers, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { NumberInput } from "@/components/ui/number-input";
import { SaleFiles } from "@/components/files/sale-files";
import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";
import { design } from "@/demo/api";
import {
  DESIGN_ITEM_STATUSES, DESIGN_ORIGINS, itemCode,
  type DesignCollection, type DesignItemView, type DesignOrigin, type ProjectDesign,
} from "@/services/design/contracts";
import { useToast } from "@/store/toast";
import { useLang, useTr } from "@/lib/i18n";
import { ItemDrawer } from "./item-drawer";
import { CollectionGallery } from "./collection-gallery";
import { ExcelTable } from "@/components/ui/excel-export";

const inputCls = "h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[13px] focus:border-brand-400 focus:outline-none";

/** A project's design: collection → item (D379, D419 — rooms left the
 *  screens). Every item carries its own files and the client's approval; its
 *  status is read from them (0222). A client's item is named by the client's
 *  own code, typed, never generated (0262). */
export function DesignBoard({ projectCode, canEdit }: { projectCode: string; canEdit: boolean }) {
  const tr = useTr();
  const [state, reload] = useLoad(() => design.getProjectDesign(projectCode), [projectCode]);
  const [open, setOpen] = useState<string | null>(null);
  const [addingCollection, setAddingCollection] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-slate-500">
          {tr("Collection → item. A client's item keeps the client's own code. An item becomes a product with a BOM once it is ordered.",
            "Koleksi → item. Item dari desain klien memakai kode klien sendiri. Item menjadi produk dengan BOM setelah dipesan.")}
        </p>
        {canEdit && !addingCollection && (
          <Button size="sm" icon={Plus} onClick={() => setAddingCollection(true)}>{tr("Collection", "Koleksi")}</Button>
        )}
      </div>
      {addingCollection && (
        <CollectionForm projectCode={projectCode} onDone={() => { setAddingCollection(false); reload(); }} onCancel={() => setAddingCollection(false)} />
      )}
      <Loaded state={state} onRetry={reload}>
        {(d) => d.collections.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-[13px] text-slate-500">
            {tr("No design yet. Start with a collection — a catalogue, a unit type — then the items in it.",
              "Belum ada desain. Mulai dengan koleksi — katalog atau tipe unit — lalu item di dalamnya.")}
          </div>
        ) : (
          <div className="space-y-3">
            {d.collections.map((c) => (
              <CollectionCard key={c.code} c={c} d={d} projectCode={projectCode} canEdit={canEdit}
                onOpen={setOpen} onChanged={reload} />
            ))}
          </div>
        )}
      </Loaded>
      {open && (
        <ItemDrawer itemNo={open} canEdit={canEdit} onClose={() => setOpen(null)} onChanged={reload} />
      )}
    </div>
  );
}

/** A collection's items in the order they were added (older items keep the
 *  order of the rooms they came from). */
export function collectionItems(d: ProjectDesign, collectionCode: string): DesignItemView[] {
  return d.items
    .filter((i) => i.collection_code === collectionCode)
    .sort((a, b) => a.room_sort - b.room_sort || a.seq - b.seq || a.item_no.localeCompare(b.item_no));
}

function CollectionCard({
  c, d, projectCode, canEdit, onOpen, onChanged,
}: {
  c: DesignCollection; d: ProjectDesign; projectCode: string; canEdit: boolean;
  onOpen: (itemNo: string) => void; onChanged: () => void;
}) {
  const tr = useTr();
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const items = collectionItems(d, c.code);
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <Layers className="h-4 w-4 text-slate-400" />
        <h3 className="text-[14px] font-semibold text-slate-800">{tr("Collection", "Koleksi")} {c.code} · {c.name}</h3>
        <span className="text-[12px] text-slate-500">
          {c.note ? `${c.note} · ` : ""}{tr(`${c.item_count} items · ${c.approved_count} approved`,
            `${c.item_count} item · ${c.approved_count} disetujui`)}
        </span>
        {canEdit && !renaming && (
          <button onClick={() => setRenaming(true)} aria-label={tr("Edit collection", "Ubah koleksi")}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        {canEdit && !adding && (
          <Button size="sm" variant="outline" icon={Plus} className="ml-auto" onClick={() => setAdding(true)}>{tr("Item", "Item")}</Button>
        )}
        <CollectionGallery projectCode={projectCode} collection={c} canEdit={canEdit} onChanged={onChanged} className="w-full" />
        <button onClick={() => setFilesOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-[12px] text-slate-500 hover:text-slate-800">
          {filesOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <FolderOpen className="h-3.5 w-3.5" /> {tr("Catalogue & collection files", "Katalog & file koleksi")}
        </button>
      </header>
      {renaming && (
        <div className="border-b border-slate-100 px-4 py-2.5">
          <CollectionForm projectCode={projectCode} collection={c}
            onDone={() => { setRenaming(false); onChanged(); }} onCancel={() => setRenaming(false)} />
        </div>
      )}
      {filesOpen && (
        <div className="border-b border-slate-100 px-4 py-2.5">
          <SaleFiles targets={[{ entity: "design_collection", entity_no: `${projectCode}-${c.code}`, label: `${c.code} · ${c.name}` }]}
            canEdit={canEdit} onChanged={onChanged} />
        </div>
      )}
      <div className="px-4 py-2.5">
        {adding && (
          <ItemForm projectCode={projectCode} collectionCode={c.code}
            onDone={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} />
        )}
        {items.length === 0 ? (
          !adding && <p className="py-1.5 text-[12px] text-slate-500">{tr("No items yet. Add the first with + Item.", "Belum ada item. Tambahkan dengan + Item.")}</p>
        ) : (
          <ItemTable items={items} projectCode={projectCode} collectionCode={c.code} canEdit={canEdit}
            editing={editing} onEdit={setEditing} onOpen={onOpen} onChanged={onChanged} />
        )}
      </div>
    </section>
  );
}

function ItemTable({
  items, projectCode, collectionCode, canEdit, editing, onEdit, onOpen, onChanged,
}: {
  items: DesignItemView[]; projectCode: string; collectionCode: string; canEdit: boolean;
  editing: string | null; onEdit: (itemNo: string | null) => void;
  onOpen: (itemNo: string) => void; onChanged: () => void;
}) {
  const tr = useTr();
  const lang = useLang();
  return (
    <div className="overflow-x-auto">
      <ExcelTable className="w-full min-w-[900px] table-fixed border-collapse text-[13px]">
        {/* Fixed widths, so every collection's table lines up under the one
            above; the item column keeps the rest, and on a phone the table
            scrolls rather than squeezing it. */}
        <colgroup>
          <col /><col className="w-12" /><col className="w-36" /><col className="w-24" />
          <col className="w-32" /><col className="w-28" /><col className="w-40" /><col className="w-9" />
        </colgroup>
        <thead>
          <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-500">
            <th className="px-2 py-1.5 text-left">{tr("Item", "Item")}</th>
            <th className="px-2 py-1.5 text-right">{tr("Qty", "Qty")}</th>
            <th className="px-2 py-1.5 text-left">{tr("Size (mm)", "Ukuran (mm)")}</th>
            <th className="px-2 py-1.5 text-left">{tr("Designed by", "Desain dari")}</th>
            <th className="px-2 py-1.5 text-left">{tr("Status", "Status")}</th>
            <th className="px-2 py-1.5 text-left">{tr("Files", "File")}</th>
            <th className="px-2 py-1.5 text-left">{tr("Client approval", "Persetujuan klien")}</th>
            <th className="px-1 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const st = DESIGN_ITEM_STATUSES.find((s) => s.code === i.status)!;
            const og = DESIGN_ORIGINS.find((o) => o.code === i.origin)!;
            if (editing === i.item_no) {
              return (
                <tr key={i.item_no} className="border-b border-slate-100">
                  <td colSpan={8} className="px-0 py-1.5">
                    <ItemForm projectCode={projectCode} collectionCode={collectionCode} item={i}
                      onDone={() => { onEdit(null); onChanged(); }} onCancel={() => onEdit(null)}
                      onRemoved={() => { onEdit(null); onChanged(); }} />
                  </td>
                </tr>
              );
            }
            return (
              <Fragment key={i.item_no}>
                <tr onClick={() => onOpen(i.item_no)}
                  className={cn("cursor-pointer border-b border-slate-100 hover:bg-slate-50", i.status === "DROPPED" && "opacity-60")}>
                  <td className="px-2 py-1.5">
                    <span className="block font-mono text-[11px] text-slate-500">{itemCode(i)}</span>
                    <span className="text-slate-800">{i.name}</span>
                    {/* The factory price it is costed from (0256), for whoever may see it. */}
                    {i.factory_unit_price != null && (
                      <span className="block truncate text-[11px] text-slate-500">
                        {tr("Factory", "Pabrik")} · {formatMoney(i.factory_unit_price, i.factory_currency)}
                        {i.factory_vendor_name && ` · ${i.factory_vendor_name}`}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{i.qty}</td>
                  <td className="px-2 py-1.5 tabular-nums text-slate-600">
                    {i.length_mm || i.width_mm || i.height_mm
                      ? [i.length_mm, i.width_mm, i.height_mm].map((v) => v ?? "—").join(" × ") : "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    <Badge tone={i.origin === "tala" ? "brand" : i.origin === "client" ? "amber" : "violet"}>{lang === "id" ? og.label_id : og.label}</Badge>
                  </td>
                  <td className="px-2 py-1.5"><Badge tone={st.tone}>{st.label}</Badge></td>
                  <td className="px-2 py-1.5 text-[12px] text-slate-600">
                    {tr(`${i.design_files} ours · ${i.client_files} client's`, `${i.design_files} kita · ${i.client_files} klien`)}
                  </td>
                  <td className="px-2 py-1.5 text-[12px]">
                    {i.approval_decision === "approved"
                      ? <span className="text-emerald-700">✓ {i.approval_on} · {i.approval_by}</span>
                      : <span className="text-slate-400">{tr("not yet", "belum ada")}</span>}
                  </td>
                  <td className="px-1 py-1.5 text-right">
                    {canEdit && i.status !== "DROPPED" && (
                      <button onClick={(e) => { e.stopPropagation(); onEdit(i.item_no); }}
                        aria-label={tr(`Edit ${itemCode(i)}`, `Ubah ${itemCode(i)}`)} title={tr("Edit", "Ubah")}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </ExcelTable>
    </div>
  );
}

/** A new collection, or an existing one renamed (its code is fixed: it is in
 *  every item number). `compact` stacks the fields, for a narrow column such
 *  as the Design tree, where four across would spill out of it. */
export function CollectionForm({
  projectCode, collection, onDone, onCancel, compact,
}: { projectCode: string; collection?: DesignCollection; onDone: () => void; onCancel: () => void; compact?: boolean }) {
  const tr = useTr();
  const { toast } = useToast();
  const [code, setCode] = useState(collection?.code ?? "");
  const [name, setName] = useState(collection?.name ?? "");
  const [note, setNote] = useState(collection?.note ?? "");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const r = await design.saveDesignCollection({ project_code: projectCode, code, name, note: note || null });
    setBusy(false);
    if (r.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), r.error.message); return; }
    if (collection) toast("success", tr("Collection updated", "Koleksi diperbarui"), `${collection.code} · ${name.trim()}`);
    onDone();
  }
  return (
    <div className={cn("grid min-w-0 gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3",
      !compact && "sm:grid-cols-[110px_1fr_1fr_auto]")}>
      <label className="text-xs text-slate-500">{tr("Code", "Kode")}
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="LV232" disabled={!!collection}
          className={cn(inputCls, "mt-1 font-mono disabled:bg-slate-100 disabled:text-slate-500")} />
      </label>
      <label className="text-xs text-slate-500">{tr("Name", "Nama")}
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("e.g. LEXI COLLECTION", "mis. LEXI COLLECTION")} className={cn(inputCls, "mt-1")} />
      </label>
      <label className="text-xs text-slate-500">{tr("Note", "Catatan")}
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr("e.g. finish LCO046 Burnt Amber", "mis. finishing LCO046 Burnt Amber")} className={cn(inputCls, "mt-1")} />
      </label>
      <div className={cn("flex items-end gap-1.5", compact && "justify-end")}>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>{tr("Cancel", "Batal")}</Button>
        <Button size="sm" icon={Save} onClick={save} disabled={busy}>{tr("Save", "Simpan")}</Button>
      </div>
      {collection && (
        <p className={cn("text-[11px] text-slate-500", !compact && "sm:col-span-4")}>
          {tr("The code stays: it is in every item number of this collection.", "Kode tetap: kode ini ada di nomor setiap item koleksi ini.")}
        </p>
      )}
    </div>
  );
}

/** A new item in a collection, or an existing one corrected. A client's item
 *  needs the client's code; ours may carry one too (an adapted reference). */
export function ItemForm({
  projectCode, collectionCode, item, onDone, onCancel, onRemoved,
}: {
  projectCode: string; collectionCode: string; item?: DesignItemView;
  onDone: (i: DesignItemView) => void; onCancel: () => void;
  /** Given: the form offers *Remove* for an item typed by mistake. */
  onRemoved?: () => void;
}) {
  const tr = useTr();
  const lang = useLang();
  const { toast } = useToast();
  const [origin, setOrigin] = useState<DesignOrigin>(item?.origin ?? "tala");
  const [clientCode, setClientCode] = useState(item?.client_item_code ?? "");
  const [name, setName] = useState(item?.name ?? "");
  const [qty, setQty] = useState(item?.qty ?? 1);
  const [l, setL] = useState(item?.length_mm ?? 0);
  const [w, setW] = useState(item?.width_mm ?? 0);
  const [h, setH] = useState(item?.height_mm ?? 0);
  const [note, setNote] = useState(item?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const needsCode = origin === "client";

  async function save() {
    setBusy(true);
    const r = await design.saveDesignItem({
      project_code: projectCode, collection_code: collectionCode,
      name, qty, origin, client_item_code: clientCode.trim() || null,
      length_mm: l || null, width_mm: w || null, height_mm: h || null,
      note: note || null, item_no: item?.item_no ?? null,
    });
    setBusy(false);
    if (r.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), r.error.message); return; }
    toast("success", item ? tr("Item updated", "Item diperbarui") : tr("Item added", "Item ditambahkan"), itemCode(r.data));
    onDone(r.data);
  }

  async function remove() {
    if (!item) return;
    setBusy(true);
    const r = await design.removeDesignItem(item.item_no);
    setBusy(false);
    setConfirmRemove(false);
    if (r.error) { toast("warning", tr("Not removed", "Tidak dihapus"), r.error.message); return; }
    toast("success", tr("Item removed", "Item dihapus"), itemCode(item));
    onRemoved?.();
  }

  return (
    <div className="mb-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
      <div className="grid gap-2 sm:grid-cols-[150px_180px_1fr_90px]">
        <label className="text-xs text-slate-500">{tr("Designed by", "Desain dari")}
          <select value={origin} onChange={(e) => setOrigin(e.target.value as DesignOrigin)} className={cn(inputCls, "mt-1")}>
            {DESIGN_ORIGINS.map((o) => <option key={o.code} value={o.code}>{lang === "id" ? o.label_id : o.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-500">
          {needsCode ? tr("Client's item code", "Kode item klien") : tr("Client's code (optional)", "Kode klien (opsional)")}
          <input value={clientCode} onChange={(e) => setClientCode(e.target.value)} placeholder="LV232-B01"
            className={cn(inputCls, "mt-1 font-mono", needsCode && !clientCode.trim() && "border-amber-300")} />
        </label>
        <label className="text-xs text-slate-500">{tr("Item", "Item")}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("e.g. Queen Bed", "mis. Queen Bed")} className={cn(inputCls, "mt-1")} />
        </label>
        <label className="text-xs text-slate-500">{tr("Qty", "Qty")}
          <NumberInput value={qty} onChange={setQty} min={0} size="sm" className="mt-1" />
        </label>
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-[repeat(3,110px)_1fr]">
        <label className="text-xs text-slate-500">L (mm)<NumberInput value={l} onChange={setL} min={0} size="sm" className="mt-1" /></label>
        <label className="text-xs text-slate-500">W (mm)<NumberInput value={w} onChange={setW} min={0} size="sm" className="mt-1" /></label>
        <label className="text-xs text-slate-500">H (mm)<NumberInput value={h} onChange={setH} min={0} size="sm" className="mt-1" /></label>
        <label className="col-span-3 text-xs text-slate-500 sm:col-span-1">{tr("Note", "Catatan")}
          <input value={note} onChange={(e) => setNote(e.target.value)} className={cn(inputCls, "mt-1")} />
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {item && (
          <span className="mr-auto text-[11px] text-slate-400">
            {tr("Internal number", "Nomor internal")} <span className="font-mono">{item.item_no}</span>
          </span>
        )}
        {item && onRemoved && !confirmRemove && (
          <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setConfirmRemove(true)} disabled={busy}>
            {tr("Remove", "Hapus")}
          </Button>
        )}
        {confirmRemove && (
          <>
            <span className="text-[12px] text-rose-700">{tr("Remove this item, typed by mistake?", "Hapus item salah input ini?")}</span>
            <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)} disabled={busy}>{tr("No", "Tidak")}</Button>
            <Button size="sm" icon={Trash2} onClick={remove} disabled={busy}>{tr("Yes, remove", "Ya, hapus")}</Button>
          </>
        )}
        {!confirmRemove && (
          <>
            <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>{tr("Cancel", "Batal")}</Button>
            <Button size="sm" icon={Save} onClick={save} disabled={busy}>{item ? tr("Save", "Simpan") : tr("Add item", "Tambah item")}</Button>
          </>
        )}
      </div>
    </div>
  );
}
