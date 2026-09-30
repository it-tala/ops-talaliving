"use client";

import { useMemo, useState } from "react";
import { Boxes, History, Pencil, Trash2 } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { Combobox } from "@/components/ui/combobox";
import { NumberInput } from "@/components/ui/number-input";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { inventory } from "@/demo/api";
import {
  EDITABLE_MOVE_KINDS, MOVE_LABEL,
  type StockItemDetail, type StockItemView, type StockMoveView, type StockEntryChange,
} from "@/services/inventory/contracts";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** An item's movement history, every entry correctable (`0198`, D348).
 *
 *  The owner: *pastikan kita bisa edit setiap data yang diinput.* An entry,
 *  an issue or a return is changed where it stands — item, location,
 *  quantity, note, Job Order — and deleted with a reason. What it was is kept
 *  and shown under *Changes*. A receipt is procurement's (its receiving
 *  report), and a transfer is a pair: it is deleted and entered again. */
export function MoveHistory({ d, mayAdjust, catalogue, onChanged }: {
  d: StockItemDetail;
  mayAdjust: boolean;
  catalogue: StockItemView[];
  onChanged: () => void;
}) {
  const tr = useTr();
  const [changes, reloadChanges] = useLoad(() => inventory.stockEntryHistory(d.item_code), [d.item_code, d.moves_count, d.last_move_at]);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const after = () => { setEditing(null); setDeleting(null); reloadChanges(); onChanged(); };

  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-slate-700">
          <Boxes className="h-3.5 w-3.5 text-slate-400" /> {tr("Movement history", "Riwayat pergerakan")}
        </p>
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {d.moves.length === 0 && (
            <li className="px-4 py-6 text-[12px] text-slate-500">
              {tr(
                "Nothing entered for this item yet. Enter it with Input stock on the list — until then it is a name in the catalogue, not stock on a rack.",
                "Belum ada input untuk barang ini. Input lewat Input stok di daftar — sampai itu, ini baru nama di katalog, belum stok di rak.",
              )}
            </li>
          )}
          {d.moves.map((m) => (
            <li key={m.id} className="px-4 py-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="w-[74px] shrink-0 font-mono text-[10px] text-slate-400">{m.moved_at.slice(5, 10)}</span>
                <Badge tone={m.kind === "adjust" ? "amber" : m.qty > 0 ? "green" : "slate"}>{MOVE_LABEL[m.kind]}</Badge>
                <span className={cn("w-[80px] text-right font-semibold tabular-nums", m.qty > 0 ? "text-emerald-700" : "text-slate-800")}>
                  {m.qty > 0 ? "+" : ""}{formatNumber(m.qty)}
                </span>
                <span className="text-[11px] text-slate-500">{m.location_name}</span>
                {m.ref_no && (
                  <span className={cn("font-mono text-[10px]", m.ref_missing ? "text-amber-700" : "text-slate-400")}>
                    {m.ref_no}
                    {m.ref_missing && <span className="ml-1">· {tr("this Job Order does not exist", "Job Order ini tidak ada")}</span>}
                  </span>
                )}
                <span className="min-w-[160px] flex-1 text-[11px] text-slate-500">
                  {m.reason ?? (m.unit_cost != null ? `${formatIDR(m.unit_cost)} / ${m.uom}` : "—")}
                </span>
                <span className="text-[11px] text-slate-400">
                  {m.by_name}
                  {m.edited_at && (
                    <span className="ml-1 text-amber-700">
                      · {tr("edited", "diubah")} {m.edited_at.slice(5, 10)}{m.edited_by_name ? ` ${tr("by", "oleh")} ${m.edited_by_name}` : ""}
                    </span>
                  )}
                </span>
                {mayAdjust && editing !== m.move_no && deleting !== m.move_no && (
                  <span className="flex gap-1">
                    {EDITABLE_MOVE_KINDS.includes(m.kind) && (
                      <Button size="sm" variant="ghost" icon={Pencil} onClick={() => { setDeleting(null); setEditing(m.move_no); }}>
                        {tr("Change", "Ubah")}
                      </Button>
                    )}
                    {m.kind !== "receipt" && (
                      <Button size="sm" variant="ghost" icon={Trash2} onClick={() => { setEditing(null); setDeleting(m.move_no); }}>
                        {tr("Delete", "Hapus")}
                      </Button>
                    )}
                    {m.kind === "receipt" && (
                      <span className="text-[10px] text-slate-400">{tr("corrected at its receiving report", "koreksi di penerimaannya")}</span>
                    )}
                  </span>
                )}
              </div>
              {editing === m.move_no && (
                <EditMove m={m} catalogue={catalogue} onDone={after} onCancel={() => setEditing(null)} />
              )}
              {deleting === m.move_no && (
                <DeleteMove m={m} onDone={after} onCancel={() => setDeleting(null)} />
              )}
            </li>
          ))}
        </ul>
      </div>

      <Loaded state={changes} skeletonRows={1}>
        {(rows) => rows.length === 0 ? null : (
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-slate-700">
              <History className="h-3.5 w-3.5 text-slate-400" /> {tr("Changes to entries", "Perubahan input")}
            </p>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {rows.map((c, i) => <ChangeRow key={`${c.move_no}-${c.at}-${i}`} c={c} />)}
            </ul>
          </div>
        )}
      </Loaded>
    </div>
  );
}

function EditMove({ m, catalogue, onDone, onCancel }: {
  m: StockMoveView;
  catalogue: StockItemView[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const [locations] = useLoad(() => inventory.listStockLocations(), []);
  const signed = m.kind === "adjust";
  const [form, setForm] = useState({
    item_code: m.item_code, location: m.location, qty: signed ? m.qty : Math.abs(m.qty),
    reason: m.reason ?? "", ref_no: m.ref_no ?? "",
  });
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => catalogue.map((r) => ({
    value: r.item_code, label: r.item_name, sublabel: `${r.item_code} · ${r.category_name} · ${r.uom}`,
  })), [catalogue]);

  async function save() {
    setBusy(true);
    const res = await inventory.editStockMove(m.move_no, {
      item_code: form.item_code !== m.item_code ? form.item_code : undefined,
      location: form.location !== m.location ? form.location : undefined,
      qty: form.qty,
      reason: form.reason,
      ref_no: form.ref_no.trim() || undefined,
      clear_ref: !form.ref_no.trim() && !!m.ref_no,
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", tr("Entry changed", "Input diubah"), m.move_no);
    onDone();
  }

  const field = "h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none";
  return (
    <div className="mt-2 space-y-2 rounded-lg border border-brand-200 bg-brand-50/30 p-3">
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr_120px]">
        <div className="text-[11px] text-slate-500">
          {tr("Item", "Barang")}
          <div className="mt-1">
            <Combobox value={form.item_code} onChange={(v) => setForm({ ...form, item_code: v || m.item_code })} options={options} />
          </div>
        </div>
        <label className="text-[11px] text-slate-500">
          {tr("Location", "Lokasi")}
          <Loaded state={locations} skeletonRows={1}>
            {(locs) => (
              <select value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className={`mt-1 ${field}`}>
                {!locs.some((l) => l.code === form.location) && <option value={form.location}>{m.location_name}</option>}
                {locs.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
              </select>
            )}
          </Loaded>
        </label>
        <label className="text-[11px] text-slate-500">
          {signed ? tr("Quantity (±)", "Jumlah (±)") : tr("Quantity", "Jumlah")}
          <div className="mt-1"><NumberInput value={form.qty} onChange={(v) => setForm({ ...form, qty: v })} /></div>
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
        <label className="text-[11px] text-slate-500">
          {signed ? tr("Reason", "Alasan") : tr("What for", "Untuk apa")}
          <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={`mt-1 ${field}`} />
        </label>
        {m.kind !== "adjust" && (
          <label className="text-[11px] text-slate-500">
            {tr("Job Order", "Job Order")}
            <input value={form.ref_no} onChange={(e) => setForm({ ...form, ref_no: e.target.value })}
              placeholder={tr("optional", "opsional")} className={`mt-1 ${field}`} />
          </label>
        )}
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy || form.qty === 0 || (!signed && form.qty < 0) || (signed && !form.reason.trim())} onClick={save}>
          {busy ? tr("Saving…", "Menyimpan…") : tr("Save change", "Simpan perubahan")}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>{tr("Cancel", "Batal")}</Button>
      </div>
    </div>
  );
}

function DeleteMove({ m, onDone, onCancel }: { m: StockMoveView; onDone: () => void; onCancel: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    const res = await inventory.deleteStockMove(m.move_no, reason);
    setBusy(false);
    if (res.error) { toast("warning", tr("Not deleted", "Tidak terhapus"), res.error.message); return; }
    toast("success", tr("Entry deleted", "Input dihapus"),
      res.data.deleted.length > 1 ? tr(`${res.data.deleted.length} rows (both sides of the move)`, `${res.data.deleted.length} baris (kedua sisi perpindahan)`) : m.move_no);
    onDone();
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-rose-200 bg-rose-50/40 p-3">
      <span className="text-[12px] text-rose-800">
        {m.kind === "transfer"
          ? tr("Deletes both sides of this move.", "Menghapus kedua sisi perpindahan ini.")
          : tr("Delete this entry?", "Hapus input ini?")}
      </span>
      <input value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
        placeholder={tr("Why — e.g. entered twice", "Kenapa — mis. terinput dua kali")}
        className="h-8 min-w-[200px] flex-1 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none" />
      <Button size="sm" variant="danger" disabled={busy || !reason.trim()} onClick={remove}>
        {busy ? tr("Deleting…", "Menghapus…") : tr("Delete entry", "Hapus input")}
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>{tr("Cancel", "Batal")}</Button>
    </div>
  );
}

function ChangeRow({ c }: { c: StockEntryChange }) {
  const tr = useTr();
  const describe = (x: Record<string, unknown> | null | undefined) => x
    ? `${x.item_code ?? ""} · ${x.location ?? ""} · ${formatNumber(Number(x.qty ?? 0))} ${x.uom ?? ""}${x.reason ? ` · ${x.reason}` : ""}${x.ref_no ? ` · ${x.ref_no}` : ""}`
    : "—";
  const rows = (c.before?.rows as Record<string, unknown>[] | undefined) ?? null;
  return (
    <li className="px-4 py-2 text-[11px] text-slate-600">
      <span className="font-mono text-[10px] text-slate-400">{c.at.slice(0, 16).replace("T", " ")}</span>{" "}
      <Badge tone={c.action === "delete" ? "red" : "amber"}>{c.action === "delete" ? tr("deleted", "dihapus") : tr("changed", "diubah")}</Badge>{" "}
      <span className="font-mono text-[10px]">{c.move_no}</span>
      {c.by_name && <span className="text-slate-400"> · {c.by_name}</span>}
      {c.action === "edit" ? (
        <p className="mt-0.5">
          <span className="text-slate-400 line-through">{describe(c.before)}</span>{" "}→{" "}
          <span className="text-slate-800">{describe(c.after)}</span>
        </p>
      ) : (
        <p className="mt-0.5">
          <span className="text-slate-400 line-through">{(rows ?? []).map((r) => describe(r)).join(" | ")}</span>
          {c.reason && <span className="text-slate-700"> — {c.reason}</span>}
        </p>
      )}
    </li>
  );
}
