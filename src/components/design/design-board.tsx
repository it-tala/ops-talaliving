"use client";

import { useState } from "react";
import { Layers, Plus, Save } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { NumberInput } from "@/components/ui/number-input";
import { cn } from "@/lib/cn";
import { design } from "@/demo/api";
import {
  DESIGN_ITEM_STATUSES, DESIGN_ORIGINS,
  type DesignCollection, type DesignItemView, type DesignOrigin, type DesignRoom, type ProjectDesign,
} from "@/services/design/contracts";
import { useToast } from "@/store/toast";
import { useLang, useTr } from "@/lib/i18n";
import { ItemDrawer } from "./item-drawer";

const inputCls = "h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[13px] focus:border-brand-400 focus:outline-none";

/** A project's design, in the order the drafters work (D379): collection →
 *  room → item. Every item carries its own files and the client's approval;
 *  its status is read from them (0222). */
export function DesignBoard({ projectCode, canEdit }: { projectCode: string; canEdit: boolean }) {
  const tr = useTr();
  const [state, reload] = useLoad(() => design.getProjectDesign(projectCode), [projectCode]);
  const [open, setOpen] = useState<string | null>(null);
  const [addingCollection, setAddingCollection] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-slate-500">
          {tr("Collection → room → item, the order the drafters work in. An item becomes a product with a BOM once it is ordered.",
            "Koleksi → ruangan → item, urutan kerja drafter. Item menjadi produk dengan BOM setelah dipesan.")}
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
            {tr("No design yet. Start with a collection — a unit type, a catalogue, a floor — then its rooms and the items in them.",
              "Belum ada desain. Mulai dengan koleksi — tipe unit, katalog, atau lantai — lalu ruangannya dan item di dalamnya.")}
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

function CollectionCard({
  c, d, projectCode, canEdit, onOpen, onChanged,
}: {
  c: DesignCollection; d: ProjectDesign; projectCode: string; canEdit: boolean;
  onOpen: (itemNo: string) => void; onChanged: () => void;
}) {
  const tr = useTr();
  const [addingRoom, setAddingRoom] = useState(false);
  const rooms = d.rooms.filter((r) => r.collection_code === c.code);
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <Layers className="h-4 w-4 text-slate-400" />
        <h3 className="text-[14px] font-semibold text-slate-800">{tr("Collection", "Koleksi")} {c.code} · {c.name}</h3>
        <span className="text-[12px] text-slate-500">
          {c.note ? `${c.note} · ` : ""}{tr(`${c.room_count} rooms · ${c.item_count} items · ${c.approved_count} approved`,
            `${c.room_count} ruangan · ${c.item_count} item · ${c.approved_count} disetujui`)}
        </span>
        {canEdit && !addingRoom && (
          <Button size="sm" variant="outline" icon={Plus} className="ml-auto" onClick={() => setAddingRoom(true)}>{tr("Room", "Ruangan")}</Button>
        )}
      </header>
      {addingRoom && (
        <div className="border-b border-slate-100 px-4 py-2.5">
          <RoomForm projectCode={projectCode} collectionCode={c.code}
            onDone={() => { setAddingRoom(false); onChanged(); }} onCancel={() => setAddingRoom(false)} />
        </div>
      )}
      {rooms.length === 0 && (
        <p className="px-4 py-4 text-[12px] text-slate-500">{tr("No rooms yet.", "Belum ada ruangan.")}</p>
      )}
      {rooms.map((r) => (
        <RoomBlock key={r.code} r={r} items={d.items.filter((i) => i.collection_code === c.code && i.room_code === r.code)}
          projectCode={projectCode} collectionCode={c.code} canEdit={canEdit} onOpen={onOpen} onChanged={onChanged} />
      ))}
    </section>
  );
}

function RoomBlock({
  r, items, projectCode, collectionCode, canEdit, onOpen, onChanged,
}: {
  r: DesignRoom; items: DesignItemView[]; projectCode: string; collectionCode: string; canEdit: boolean;
  onOpen: (itemNo: string) => void; onChanged: () => void;
}) {
  const tr = useTr();
  const lang = useLang();
  const [adding, setAdding] = useState(false);
  return (
    <div className="px-4 py-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{r.code} · {r.name}</h4>
        {canEdit && !adding && (
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-brand-700 hover:bg-brand-50">
            <Plus className="h-3 w-3" /> {tr("Item", "Item")}
          </button>
        )}
      </div>
      {adding && (
        <ItemForm projectCode={projectCode} collectionCode={collectionCode} roomCode={r.code}
          onDone={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} />
      )}
      {items.length === 0 ? (
        !adding && <p className="text-[12px] text-slate-400">{tr("No items in this room yet.", "Belum ada item di ruangan ini.")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] table-fixed border-collapse text-[13px]">
            {/* Fixed widths, so every room's table lines up under the one above. */}
            <colgroup>
              <col /><col className="w-14" /><col className="w-40" /><col className="w-28" />
              <col className="w-36" /><col className="w-32" /><col className="w-44" />
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
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const st = DESIGN_ITEM_STATUSES.find((s) => s.code === i.status)!;
                const og = DESIGN_ORIGINS.find((o) => o.code === i.origin)!;
                return (
                  <tr key={i.item_no} onClick={() => onOpen(i.item_no)}
                    className={cn("cursor-pointer border-b border-slate-100 hover:bg-slate-50", i.status === "DROPPED" && "opacity-60")}>
                    <td className="px-2 py-1.5">
                      <span className="block font-mono text-[11px] text-slate-400">{i.item_no}</span>
                      <span className="text-slate-800">{i.name}</span>
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CollectionForm({ projectCode, onDone, onCancel }: { projectCode: string; onDone: () => void; onCancel: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const r = await design.saveDesignCollection({ project_code: projectCode, code, name, note: note || null });
    setBusy(false);
    if (r.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), r.error.message); return; }
    onDone();
  }
  return (
    <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:grid-cols-[110px_1fr_1fr_auto]">
      <label className="text-xs text-slate-500">{tr("Code", "Kode")}
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="A" className={cn(inputCls, "mt-1 font-mono")} />
      </label>
      <label className="text-xs text-slate-500">{tr("Name", "Nama")}
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("e.g. TYPE 2BR", "mis. TYPE 2BR")} className={cn(inputCls, "mt-1")} />
      </label>
      <label className="text-xs text-slate-500">{tr("Note", "Catatan")}
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={tr("e.g. 24 units", "mis. 24 unit")} className={cn(inputCls, "mt-1")} />
      </label>
      <div className="flex items-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>{tr("Cancel", "Batal")}</Button>
        <Button size="sm" icon={Save} onClick={save} disabled={busy}>{tr("Save", "Simpan")}</Button>
      </div>
    </div>
  );
}

function RoomForm({
  projectCode, collectionCode, onDone, onCancel,
}: { projectCode: string; collectionCode: string; onDone: () => void; onCancel: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const r = await design.saveDesignRoom({ project_code: projectCode, collection_code: collectionCode, code, name });
    setBusy(false);
    if (r.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), r.error.message); return; }
    onDone();
  }
  return (
    <div className="grid gap-2 sm:grid-cols-[110px_1fr_auto]">
      <label className="text-xs text-slate-500">{tr("Code", "Kode")}
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="LR" className={cn(inputCls, "mt-1 font-mono")} />
      </label>
      <label className="text-xs text-slate-500">{tr("Room", "Ruangan")}
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("e.g. Living room", "mis. Living room")} className={cn(inputCls, "mt-1")} />
      </label>
      <div className="flex items-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>{tr("Cancel", "Batal")}</Button>
        <Button size="sm" icon={Save} onClick={save} disabled={busy}>{tr("Save", "Simpan")}</Button>
      </div>
    </div>
  );
}

export function ItemForm({
  projectCode, collectionCode, roomCode, item, onDone, onCancel,
}: {
  projectCode: string; collectionCode: string; roomCode: string; item?: DesignItemView;
  onDone: (i: DesignItemView) => void; onCancel: () => void;
}) {
  const tr = useTr();
  const lang = useLang();
  const { toast } = useToast();
  const [name, setName] = useState(item?.name ?? "");
  const [qty, setQty] = useState(item?.qty ?? 1);
  const [origin, setOrigin] = useState<DesignOrigin>(item?.origin ?? "tala");
  const [l, setL] = useState(item?.length_mm ?? 0);
  const [w, setW] = useState(item?.width_mm ?? 0);
  const [h, setH] = useState(item?.height_mm ?? 0);
  const [note, setNote] = useState(item?.note ?? "");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const r = await design.saveDesignItem({
      project_code: projectCode, collection_code: collectionCode, room_code: roomCode,
      name, qty, origin, length_mm: l || null, width_mm: w || null, height_mm: h || null,
      note: note || null, item_no: item?.item_no ?? null,
    });
    setBusy(false);
    if (r.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), r.error.message); return; }
    toast("success", item ? tr("Item updated", "Item diperbarui") : tr("Item added", "Item ditambahkan"), r.data.item_no);
    onDone(r.data);
  }
  return (
    <div className="mb-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
      <div className="grid gap-2 sm:grid-cols-[1fr_90px_150px]">
        <label className="text-xs text-slate-500">{tr("Item", "Item")}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("e.g. Sofa 3 seater", "mis. Sofa 3 seater")} className={cn(inputCls, "mt-1")} />
        </label>
        <label className="text-xs text-slate-500">{tr("Qty", "Qty")}
          <NumberInput value={qty} onChange={setQty} min={0} size="sm" className="mt-1" />
        </label>
        <label className="text-xs text-slate-500">{tr("Designed by", "Desain dari")}
          <select value={origin} onChange={(e) => setOrigin(e.target.value as DesignOrigin)} className={cn(inputCls, "mt-1")}>
            {DESIGN_ORIGINS.map((o) => <option key={o.code} value={o.code}>{lang === "id" ? o.label_id : o.label}</option>)}
          </select>
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
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>{tr("Cancel", "Batal")}</Button>
        <Button size="sm" icon={Save} onClick={save} disabled={busy}>{item ? tr("Save", "Simpan") : tr("Add item", "Tambah item")}</Button>
      </div>
    </div>
  );
}
