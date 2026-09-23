"use client";

import { useMemo, useRef, useState } from "react";
import {
  Calculator, Check, ExternalLink, FileText, GitBranch, HardHat, ImageIcon, Layers, Link2, Lock,
  Package, Paperclip, Pencil, Plus, RotateCcw, Ruler, Save, Search, Trash2, X,
} from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Badge, Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { NumberInput } from "@/components/ui/number-input";
import { MoneyInput } from "@/components/ui/money-input";
import { CategoryOptions } from "@/components/ui/category-options";
import { UomOptions } from "@/components/ui/uom-options";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { documents, procurement, production } from "@/demo/api";
import type { Item, ItemCategory } from "@/services/procurement/contracts";
import type {
  BomKind, BomLineView, ProductDrawingEntry, ProductView,
} from "@/services/production/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";

/** One product: its gambar kerja on the left, what one unit is made of on the
 *  right, and what that comes to at the bottom (owner's brief, 2026-09-23).
 *
 *  The drawing sits beside the list because it is what the list is read off:
 *  the designer looks at revision C, decides the carcass is 0,1 m³ of jati and
 *  1 liter of PU, and types it. The drawing is revised often, so every
 *  revision stays one click away rather than only the newest.
 *
 *  A line is a material from the item database, a sub-assembly, or labour —
 *  each with a quantity per unit and a rate. The rate follows the catalogue
 *  until somebody types one; releasing freezes it (0106). The answer is the
 *  **production cost per item code — not a selling price.**
 */
export function ProductDrawer({
  productCode, onClose, onChanged,
}: {
  productCode: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  if (!productCode) return <NewProduct onClose={onClose} onChanged={onChanged} />;
  return <ExistingProduct productCode={productCode} onClose={onClose} onChanged={onChanged} />;
}

type Settle = (res: { error?: { status: number; message: string } | null }, done: string, detail?: string) => boolean;

function ExistingProduct({
  productCode, onClose, onChanged,
}: {
  productCode: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { can } = useSession();
  const { toast } = useToast();
  const [product, reload] = useLoad(() => production.getProduct(productCode), [productCode]);
  const mayEdit = can("production.update");
  const [busy, setBusy] = useState(false);

  /* One answer handler for every write on this drawer: say what happened,
     redraw from what was stored, tell the list behind it. */
  const settle: Settle = (res, done, detail) => {
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", "Tidak tersimpan", res.error.message);
      return false;
    }
    toast("success", done, detail);
    reload(); onChanged();
    return true;
  };
  const run = async <T,>(fn: () => Promise<T>): Promise<T> => {
    setBusy(true);
    try { return await fn(); } finally { setBusy(false); }
  };

  return (
    <Drawer
      open onClose={onClose} width="max-w-[1400px]"
      title={product.status === "ready" ? product.data.name : productCode}
      subtitle={product.status === "ready"
        ? `${product.data.product_code} · ${product.data.category} · per ${product.data.uom}${product.data.dimension ? ` · ${product.data.dimension}` : ""}`
        : undefined}
    >
      <Loaded state={product} onRetry={reload}>
        {(p) => (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className="space-y-4 lg:sticky lg:top-0 lg:self-start">
              <DrawingPanel p={p} mayEdit={mayEdit} busy={busy} run={run} settle={settle} />
              <ProductFacts p={p} mayEdit={mayEdit} busy={busy} run={run} settle={settle} />
            </div>
            <div className="min-w-0 space-y-4">
              <RevisionBar p={p} mayEdit={mayEdit} busy={busy} run={run} settle={settle} />
              <BomTable p={p} mayEdit={mayEdit} busy={busy} run={run} settle={settle} />
              <CostSummary p={p} mayEdit={mayEdit} busy={busy} run={run} settle={settle} />
            </div>
          </div>
        )}
      </Loaded>
    </Drawer>
  );
}

interface PartProps {
  p: ProductView;
  mayEdit: boolean;
  busy: boolean;
  run: <T>(fn: () => Promise<T>) => Promise<T>;
  settle: Settle;
}

const inputCls = "h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none";

/* ── the drawing ─────────────────────────────────────────────────────────── */

/** Drive serves a file's pixels from its id; the share page is HTML, not a
 *  picture (see `doc-preview.tsx`). */
function driveId(url: string | null): string | null {
  const m = url ? /\/file\/d\/([a-zA-Z0-9_-]+)/.exec(url) : null;
  return m ? m[1] : null;
}

function DrawingViewer({ d }: { d: ProductDrawingEntry }) {
  const [failed, setFailed] = useState(false);
  const id = driveId(d.url);
  const isImage = (d.mime ?? "").startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(d.filename);

  /* Any Drive file that is not known to be a picture — a PDF, or a pasted
     Drive link whose type we were never told — goes to Drive's own previewer,
     which renders both. */
  if (id && !isImage) {
    return (
      <iframe
        src={`https://drive.google.com/file/d/${id}/preview`} title={d.filename}
        className="h-[460px] w-full rounded-xl border border-slate-200 bg-slate-50"
      />
    );
  }
  if (isImage && d.url && !failed) {
    const src = id ? `https://drive.google.com/thumbnail?id=${id}&sz=w1600` : d.url;
    return (
      <a href={d.url} target="_blank" rel="noreferrer" title="Buka ukuran penuh">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src} alt={d.filename} onError={() => setFailed(true)}
          className="h-[460px] w-full rounded-xl border border-slate-200 bg-slate-50 object-contain"
        />
      </a>
    );
  }
  return (
    <div className="flex h-[260px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 text-center">
      <FileText className="h-6 w-6 text-slate-400" />
      <p className="text-[13px] font-medium text-slate-700">{d.filename}</p>
      {d.url ? (
        <a href={d.url} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:underline">
          Buka di tab baru <ExternalLink className="h-3 w-3" />
        </a>
      ) : (
        <p className="text-[11px] text-slate-400">Pratinjau belum tersedia untuk berkas ini.</p>
      )}
    </div>
  );
}

function DrawingPanel({ p, mayEdit, busy, run, settle }: PartProps) {
  const [kind, setKind] = useState<ProductDrawingEntry["kind"]>("Gambar Kerja");
  const list = p.drawings.filter((d) => d.kind === kind);
  const [pick, setPick] = useState<string | null>(null);
  const shown = list.find((d) => d.attachment_id === pick) ?? list[0] ?? null;
  const fileRef = useRef<HTMLInputElement>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState("");

  async function attachFile(f: File) {
    await run(async () => {
      const up = await documents.upload({ file: f, kind });
      if (up.error) { settle(up, ""); return; }
      const res = await production.attachProductDrawing({
        product_code: p.product_code, attachment_id: up.data.id, kind,
      });
      if (settle(res, `${kind} terlampir`, f.name)) setPick(up.data.id);
    });
  }
  async function attachUrl() {
    await run(async () => {
      const up = await documents.addLink({ url: url.trim(), title: `${kind} ${p.product_code}` });
      if (up.error) { settle(up, ""); return; }
      const res = await production.attachProductDrawing({
        product_code: p.product_code, attachment_id: up.data.id, kind,
      });
      if (settle(res, `${kind} terlampir`, url.trim())) { setPick(up.data.id); setUrl(""); setLinkOpen(false); }
    });
  }

  return (
    <div className="rounded-xl border border-slate-200 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["Gambar Kerja", "Gambar Jadi"] as const).map((k) => (
          <button
            key={k} onClick={() => { setKind(k); setPick(null); }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-medium",
              kind === k ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100",
            )}
          >
            {k === "Gambar Kerja" ? <FileText className="h-3.5 w-3.5" /> : <ImageIcon className="h-3.5 w-3.5" />}
            {k}
            <span className="tabular-nums opacity-70">{p.drawings.filter((d) => d.kind === k).length}</span>
          </button>
        ))}
        {mayEdit && (
          <div className="ml-auto flex gap-1.5">
            <input
              ref={fileRef} type="file" className="hidden" accept="image/*,application/pdf"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachFile(f); e.target.value = ""; }}
            />
            <Button size="sm" variant="outline" icon={Paperclip} disabled={busy}
              onClick={() => fileRef.current?.click()}>
              {list.length ? "Unggah revisi" : "Unggah"}
            </Button>
            <Button size="sm" variant="ghost" icon={Link2} disabled={busy} onClick={() => setLinkOpen((v) => !v)}>
              Link
            </Button>
          </div>
        )}
      </div>

      {linkOpen && (
        <div className="mt-2 flex gap-1.5">
          <input
            value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://drive.google.com/file/d/…"
            aria-label="Link gambar" className={inputCls}
          />
          <Button size="sm" disabled={busy || !/^https?:\/\//.test(url.trim())} onClick={attachUrl}>Tempel</Button>
        </div>
      )}

      <div className="mt-3">
        {shown ? (
          <>
            <DrawingViewer key={shown.attachment_id} d={shown} />
            <p className="mt-1.5 truncate text-[11px] text-slate-500">
              {shown.filename} · {shown.linked_at.slice(0, 10)} · {shown.linked_by}
            </p>
          </>
        ) : (
          <div className="flex h-[200px] flex-col items-center justify-center rounded-xl border border-dashed border-amber-200 bg-amber-50 px-4 text-center text-[12px] text-amber-800">
            Belum ada {kind.toLowerCase()}.
            {kind === "Gambar Kerja" && " BOM disusun dari gambar ini — unggah dulu kalau ada."}
          </div>
        )}
      </div>

      {/* Every revision, newest first. Revised often, so the older ones stay
          one click away: a piece built last month was built from one of them. */}
      {list.length > 1 && (
        <ol className="mt-2 space-y-0.5 border-t border-slate-100 pt-2">
          {list.map((d, i) => (
            <li key={d.attachment_id}>
              <button
                onClick={() => setPick(d.attachment_id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px]",
                  shown?.attachment_id === d.attachment_id ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50",
                )}
              >
                <span className="w-14 shrink-0 font-mono text-[10px] text-slate-400">
                  rev {list.length - i}
                </span>
                <span className="min-w-0 flex-1 truncate">{d.filename}</span>
                <span className="shrink-0 text-[10px] text-slate-400">{d.linked_at.slice(0, 10)}</span>
                {i === 0 && <Badge tone="green">terbaru</Badge>}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ── size and the rest of the product record ─────────────────────────────── */

function ProductFacts({ p, mayEdit, busy, run, settle }: PartProps) {
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({
    name: p.name, category: p.category, uom: p.uom,
    l: p.length_mm ?? 0, w: p.width_mm ?? 0, h: p.height_mm ?? 0, lead: p.lead_time_days ?? 0,
  });

  async function save() {
    const res = await run(() => production.saveProduct({
      product_code: p.product_code, name: f.name, category: f.category, uom: f.uom,
      length_mm: f.l || null, width_mm: f.w || null, height_mm: f.h || null,
      lead_time_days: f.lead || null,
    }));
    if (settle(res, "Produk disimpan", p.product_code)) setEditing(false);
  }

  if (!editing) {
    return (
      <div className="rounded-xl border border-slate-200 px-3 py-2.5 text-[12px] text-slate-600">
        <div className="flex items-center gap-2">
          <Ruler className="h-3.5 w-3.5 text-slate-400" />
          <span className={cn(!p.dimension && "text-amber-700")}>{p.dimension ?? "Ukuran belum diisi"}</span>
          {p.lead_time_days != null && <span className="text-slate-400">· lead time {p.lead_time_days} hari</span>}
          {mayEdit && (
            <Button size="sm" variant="ghost" icon={Pencil} className="ml-auto" onClick={() => setEditing(true)}>
              Ubah
            </Button>
          )}
        </div>
        {p.missing.length > 0 && (
          <p className="mt-1 text-[11px] text-amber-700">Belum ada: {p.missing.join(", ")}.</p>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2 rounded-xl border border-brand-200 bg-brand-50/30 px-3 py-3">
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr]">
        <label className="text-[11px] text-slate-500">Nama
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={cn(inputCls, "mt-0.5")} />
        </label>
        <label className="text-[11px] text-slate-500">Kategori
          <input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className={cn(inputCls, "mt-0.5")} />
        </label>
        <label className="text-[11px] text-slate-500">Satuan
          <input value={f.uom} onChange={(e) => setF({ ...f, uom: e.target.value })} className={cn(inputCls, "mt-0.5")} />
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <span className="block text-[11px] text-slate-500">Ukuran (mm) P × L × T</span>
          <div className="mt-0.5 flex items-center gap-1">
            <NumberInput value={f.l} min={0} max={100_000} onChange={(v) => setF({ ...f, l: v })} className="!w-20" />
            <span className="text-slate-400">×</span>
            <NumberInput value={f.w} min={0} max={100_000} onChange={(v) => setF({ ...f, w: v })} className="!w-20" />
            <span className="text-slate-400">×</span>
            <NumberInput value={f.h} min={0} max={100_000} onChange={(v) => setF({ ...f, h: v })} className="!w-20" />
          </div>
        </div>
        <label className="text-[11px] text-slate-500">Lead time (hari)
          <NumberInput value={f.lead} min={0} max={365} onChange={(v) => setF({ ...f, lead: v })} className="mt-0.5 !w-20" />
        </label>
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>Batal</Button>
          <Button size="sm" icon={Save} onClick={save} disabled={busy || !f.name.trim()}>Simpan</Button>
        </div>
      </div>
    </div>
  );
}

/* ── which revision this is ──────────────────────────────────────────────── */

function RevisionBar({ p, mayEdit, busy, run, settle }: PartProps) {
  const [note, setNote] = useState("");
  const d = p.draft_diff;

  async function release() {
    const res = await run(() => production.releaseBom({ product_code: p.product_code, note }));
    if (settle(res, `rev ${p.draft_rev} dirilis`, "Rate dan biaya produksinya sekarang dikunci.")) setNote("");
  }
  async function discard() {
    if (!window.confirm(`Buang draft rev ${p.draft_rev}? Perubahan yang belum dirilis hilang.`)) return;
    const res = await run(() => production.discardBomDraft({ product_code: p.product_code }));
    settle(res, "Draft dibuang", `kembali ke rev ${p.current_rev ?? "—"}`);
  }

  return (
    <div className={cn(
      "rounded-xl border px-4 py-3",
      p.draft_rev != null ? "border-amber-200 bg-amber-50/60" : "border-slate-200",
    )}>
      <div className="flex flex-wrap items-center gap-2">
        <GitBranch className="h-4 w-4 text-slate-400" />
        {p.viewing_rev == null ? (
          <span className="text-[13px] text-slate-600">
            Belum ada BOM. Klik <strong>+ Tambah komponen</strong> — draft rev 1 terbuka sendiri.
          </span>
        ) : p.draft_rev != null ? (
          <>
            <Badge tone="amber">rev {p.draft_rev} · draft</Badge>
            <span className="text-[12px] text-slate-600">
              Rate yang tidak diisi mengikuti harga katalog hari ini.
              {p.current_rev != null && ` Rev ${p.current_rev} tetap berlaku sampai ini dirilis.`}
            </span>
          </>
        ) : (
          <>
            <Badge tone="green">rev {p.viewing_rev} · dirilis</Badge>
            <span className="text-[12px] text-slate-600">
              Rate dan biayanya terkunci. Mengubah baris mana pun membuka rev {(p.viewing_rev ?? 0) + 1}.
            </span>
          </>
        )}
      </div>

      {d != null && (
        <div className="mt-2">
          {d.identical ? (
            <p className="text-[12px] text-slate-500">Belum ada bedanya dengan rev {d.from_rev ?? "—"}.</p>
          ) : (
            <ul className="space-y-0.5 text-[12px]">
              {d.lines.map((l) => (
                <li key={l.ref_code} className="text-slate-700">
                  <span className={cn(
                    "mr-1.5 font-medium",
                    l.change === "added" ? "text-emerald-700" : l.change === "removed" ? "text-rose-700" : "text-amber-700",
                  )}>
                    {l.change === "added" ? "+" : l.change === "removed" ? "−" : "~"}
                  </span>
                  {l.ref_name ?? l.ref_code}
                  {l.change === "changed" && l.before && l.after && (
                    <span className="text-slate-500">
                      {l.before.qty !== l.after.qty && ` — ${formatNumber(l.before.qty)} → ${formatNumber(l.after.qty)} ${l.after.uom}`}
                      {l.before.waste_percent !== l.after.waste_percent && ` — susut ${l.before.waste_percent}% → ${l.after.waste_percent}%`}
                      {l.before.unit_price !== l.after.unit_price && ` — rate ${l.before.unit_price == null ? "—" : formatIDR(l.before.unit_price)} → ${l.after.unit_price == null ? "—" : formatIDR(l.after.unit_price)}`}
                    </span>
                  )}
                </li>
              ))}
              {d.miscalc && (
                <li className="text-slate-700">
                  <span className="mr-1.5 font-medium text-amber-700">~</span>
                  miskalkulasi {d.miscalc.before}% → {d.miscalc.after}%
                </li>
              )}
            </ul>
          )}
          {mayEdit && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                value={note} onChange={(e) => setNote(e.target.value)}
                placeholder="Kenapa versi ini ada — mis. ‘ikut gambar kerja rev C, kaki diganti’"
                aria-label="Catatan rilis"
                className={cn(inputCls, "min-w-[240px] flex-1")}
              />
              <Button size="sm" icon={Lock} disabled={busy || !note.trim() || d.identical} onClick={release}>
                Rilis rev {p.draft_rev}
              </Button>
              <Button size="sm" variant="ghost" icon={RotateCcw} disabled={busy} onClick={discard}>
                Buang draft
              </Button>
            </div>
          )}
        </div>
      )}

      {p.revisions.filter((r) => !r.is_draft).length > 0 && (
        <details className="mt-2 border-t border-slate-200/70 pt-2 text-[11px] text-slate-500">
          <summary className="cursor-pointer select-none">Riwayat rilis</summary>
          <ul className="mt-1 space-y-0.5">
            {p.revisions.filter((r) => !r.is_draft).map((r) => (
              <li key={r.id}>
                <span className="font-medium text-slate-600">rev {r.rev}</span>
                {" · "}{r.released_at?.slice(0, 10)}
                {r.released_by_name && ` · ${r.released_by_name}`}
                {" · "}{r.component_count} komponen
                {r.used_by > 0 && ` · dipakai ${r.used_by} SPK`}
                {r.note && <span className="block text-slate-400">{r.note}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/* ── the bill of material ────────────────────────────────────────────────── */

const KIND_ICON: Record<BomKind, typeof Package> = { material: Package, product: Layers, labour: HardHat };
const SOURCE_LABEL: Record<string, string> = {
  manual: "rate manual", standard: "harga standar", last: "harga beli terakhir", sub_assembly: "biaya sub-rakitan",
};

function BomTable(props: PartProps) {
  const { p, mayEdit } = props;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const groups: [BomKind, string][] = [["material", "Bahan"], ["product", "Sub-rakitan"], ["labour", "Tenaga kerja"]];

  return (
    <div className="rounded-xl border border-slate-200">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <p className="text-[13px] font-semibold text-slate-800">Komponen per 1 {p.uom}</p>
        <span className="text-[12px] text-slate-400">{p.components.length} baris</span>
        {mayEdit && !adding && (
          <Button size="sm" icon={Plus} className="ml-auto" onClick={() => { setAdding(true); setEditing(null); }}>
            Tambah komponen
          </Button>
        )}
      </div>

      {adding && <AddLine {...props} onDone={() => setAdding(false)} />}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 text-left">Komponen</th>
              <th className="px-3 py-2 text-right">Kebutuhan</th>
              <th className="px-3 py-2 text-right">Rate</th>
              <th className="px-3 py-2 text-right">Subtotal</th>
              {mayEdit && <th className="w-20 px-3 py-2" />}
            </tr>
          </thead>
          {groups.map(([kind, title]) => {
            const rows = p.components.filter((c) => c.kind === kind);
            if (rows.length === 0) return null;
            const Icon = KIND_ICON[kind];
            const sum = rows.reduce((a, c) => a + (c.subtotal ?? 0), 0);
            return (
              <tbody key={kind}>
                <tr className="bg-slate-50/40">
                  <td colSpan={mayEdit ? 5 : 4} className="px-3 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <Icon className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />{title}
                    <span className="float-right font-normal normal-case tabular-nums">{formatIDR(sum)}</span>
                  </td>
                </tr>
                {rows.map((c) => editing === c.id ? (
                  <EditRow key={c.id} {...props} c={c} onDone={() => setEditing(null)} />
                ) : (
                  <LineRow key={c.id} {...props} c={c} onEdit={() => { setEditing(c.id); setAdding(false); }} />
                ))}
              </tbody>
            );
          })}
          {p.components.length === 0 && (
            <tbody>
              <tr><td colSpan={mayEdit ? 5 : 4} className="px-3 py-8 text-center text-[13px] text-slate-500">
                Belum ada komponen. Lihat gambar kerja di kiri, lalu tambahkan apa saja yang dipakai untuk membuat 1 {p.uom}.
              </td></tr>
            </tbody>
          )}
        </table>
      </div>
    </div>
  );
}

function LineRow({ p, c, mayEdit, busy, run, settle, onEdit }: PartProps & { c: BomLineView; onEdit: () => void }) {
  async function remove() {
    const res = await run(() => production.removeBomComponent({ product_code: p.product_code, component_id: c.id }));
    settle(res, "Komponen dihapus", c.ref_name ?? c.ref_code);
  }
  const drift = c.rate_source === "manual" && c.catalogue_price != null && c.unit_price != null
    && Math.abs(c.unit_price - c.catalogue_price) / Math.max(c.catalogue_price, 1) > 0.2;
  return (
    <tr className="group border-b border-slate-100 last:border-0">
      <td className="px-3 py-2">
        <span className={cn("block", c.ref_name ? "text-slate-800" : "text-amber-800")}>
          {c.ref_name ?? `${c.ref_code} — tidak ada di database`}
        </span>
        {c.kind !== "labour" && (
          <span className="block font-mono text-[10px] text-slate-400">
            {c.ref_code}{c.note && <span className="font-sans"> · {c.note}</span>}
          </span>
        )}
        {c.kind === "labour" && c.note && <span className="block text-[10px] text-slate-400">{c.note}</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-700">
        {formatNumber(c.qty)} {c.uom}
        {c.waste_percent > 0 && <span className="block text-[10px] text-slate-400">+{c.waste_percent}% susut</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right">
        {c.unit_price == null ? (
          <span className="text-[11px] text-amber-700">belum ada rate</span>
        ) : (
          <>
            <span className="tabular-nums text-slate-700">{formatIDR(c.unit_price)}</span>
            <span className={cn("block text-[10px]", drift ? "text-amber-700" : "text-slate-400")}>
              {SOURCE_LABEL[c.price_source] ?? ""}
              {drift && ` · katalog ${formatIDR(c.catalogue_price!)}`}
            </span>
          </>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-800">
        {c.subtotal == null ? "—" : formatIDR(c.subtotal)}
      </td>
      {mayEdit && (
        <td className="whitespace-nowrap px-2 py-2 text-right">
          <button onClick={onEdit} disabled={busy} aria-label="Ubah"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={remove} disabled={busy} aria-label="Hapus"
            className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </td>
      )}
    </tr>
  );
}

function EditRow({ p, c, busy, run, settle, onDone }: PartProps & { c: BomLineView; onDone: () => void }) {
  const [qty, setQty] = useState(c.qty);
  const [uom, setUom] = useState(c.uom);
  const [label, setLabel] = useState(c.label ?? "");
  /* Null means *follow the catalogue*. Labour always has a rate. */
  const [rate, setRate] = useState<number | null>(c.rate_source === "manual" || c.kind === "labour" ? c.unit_rate ?? c.unit_price : null);
  const [note, setNote] = useState(c.note ?? "");

  async function save() {
    const res = await run(() => production.saveBomComponent({
      product_code: p.product_code, component_id: c.id, kind: c.kind,
      ref_code: c.ref_code, label: c.kind === "labour" ? label : null,
      qty, uom, unit_rate: rate, waste_percent: c.waste_percent, note: note || null,
    }));
    if (settle(res, "Komponen disimpan", c.ref_name ?? c.ref_code)) onDone();
  }

  return (
    <tr className="border-b border-slate-100 bg-brand-50/40">
      <td className="px-3 py-2">
        {c.kind === "labour" ? (
          <input value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Nama tenaga kerja" className={cn(inputCls, "h-8")} />
        ) : (
          <span className="block text-slate-800">{c.ref_name ?? c.ref_code}</span>
        )}
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="catatan (opsional)"
          aria-label="Catatan" className={cn(inputCls, "mt-1 h-7 text-[12px]")} />
      </td>
      <td className="px-3 py-2">
        <div className="flex justify-end gap-1">
          <NumberInput size="sm" value={qty} min={0} max={99_999} step={0.001} onChange={setQty} className="!w-20" />
          <input value={uom} onChange={(e) => setUom(e.target.value)} aria-label="Satuan" list="bom-uoms"
            className="h-8 w-16 rounded-lg border border-slate-200 px-1.5 text-[12px] focus:border-brand-400 focus:outline-none" />
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center justify-end gap-1">
          {rate == null ? (
            <button onClick={() => setRate(c.unit_price ?? 0)}
              className="rounded-lg border border-dashed border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-white">
              {c.unit_price == null ? "isi rate" : `ikut katalog · ${formatIDR(c.unit_price)}`}
            </button>
          ) : (
            <>
              <div className="w-28"><MoneyInput size="sm" value={rate} onChange={setRate} /></div>
              {c.kind !== "labour" && (
                <button onClick={() => setRate(null)} title="Kembali ikut harga katalog"
                  className="rounded p-1 text-slate-400 hover:text-slate-700"><RotateCcw className="h-3.5 w-3.5" /></button>
              )}
            </>
          )}
        </div>
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-slate-500">
        {rate != null ? formatIDR(Math.round(qty * (1 + c.waste_percent / 100) * rate))
          : c.unit_price != null ? formatIDR(Math.round(qty * (1 + c.waste_percent / 100) * c.unit_price)) : "—"}
      </td>
      <td className="whitespace-nowrap px-2 py-2 text-right">
        <button onClick={save} disabled={busy || qty <= 0 || (c.kind === "labour" && (!label.trim() || rate == null))}
          aria-label="Simpan" className="rounded p-1 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">
          <Check className="h-4 w-4" />
        </button>
        <button onClick={onDone} aria-label="Batal" className="rounded p-1 text-slate-400 hover:bg-slate-100">
          <X className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );
}

/* ── + : a new line ──────────────────────────────────────────────────────── */

function AddLine({ p, busy, run, settle, onDone }: PartProps & { onDone: () => void }) {
  const [mode, setMode] = useState<BomKind>("material");
  const [items, reloadItems] = useLoad(() => procurement.listItems(), []);
  const [cats] = useLoad(() => procurement.listCategories(), []);
  const [products] = useLoad(() => production.listProducts({}), []);

  const [q, setQ] = useState("");
  const [ref, setRef] = useState<{ code: string; name: string; uom: string; price: number | null } | null>(null);
  const [qty, setQty] = useState(1);
  const [uom, setUom] = useState("pcs");
  const [rate, setRate] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);

  const catPath = useMemo(() => {
    const all: ItemCategory[] = cats.status === "ready" ? cats.data : [];
    const byCode = new Map(all.map((c) => [c.code, c]));
    return (code: string) => {
      const c = byCode.get(code);
      if (!c) return code;
      const parent = c.parent_code ? byCode.get(c.parent_code) : null;
      return parent ? `${parent.name} › ${c.name}` : c.name;
    };
  }, [cats]);

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (mode === "material") {
      const all: Item[] = items.status === "ready" ? items.data : [];
      if (!term) return [];
      return all
        .filter((i) => `${i.name} ${i.code} ${i.aka?.join(" ") ?? ""} ${catPath(i.category_code)}`.toLowerCase().includes(term))
        .slice(0, 8)
        .map((i) => ({
          code: i.code, name: i.name, uom: i.base_uom as string,
          price: i.standard_price ?? i.last_price, sub: `${i.code} · ${catPath(i.category_code)}`,
        }));
    }
    if (mode === "product") {
      const all = products.status === "ready" ? products.data : [];
      return all
        .filter((x) => x.product_code !== p.product_code)
        .filter((x) => !term || `${x.name} ${x.product_code}`.toLowerCase().includes(term))
        .slice(0, 8)
        .map((x) => ({
          code: x.product_code, name: x.name, uom: x.uom, price: x.production_cost,
          sub: `${x.product_code} · ${x.current_rev == null ? "belum ada BOM dirilis" : `rev ${x.current_rev}`}`,
        }));
    }
    return [];
  }, [q, mode, items, products, catPath, p.product_code]);

  function choose(m: { code: string; name: string; uom: string; price: number | null }) {
    setRef(m); setUom(m.uom); setQ(""); setRate(null);
  }

  async function add() {
    const res = await run(() => production.saveBomComponent({
      product_code: p.product_code,
      kind: mode,
      ref_code: mode === "labour" ? undefined : ref?.code,
      label: mode === "labour" ? label : null,
      qty, uom, unit_rate: rate,
    }));
    if (settle(res, "Komponen ditambahkan", mode === "labour" ? label : ref?.name)) {
      setRef(null); setQty(1); setRate(null); setLabel(""); setQ("");
    }
  }

  const ready = qty > 0 && (mode === "labour" ? label.trim() !== "" && rate != null && uom.trim() !== "" : ref != null);

  return (
    <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-3">
      <datalist id="bom-uoms">
        {["hari", "jam", "unit", "pcs", "m3", "m2", "meter", "lembar", "ltr", "kg", "set"].map((u) => <option key={u} value={u} />)}
      </datalist>
      <div className="flex flex-wrap items-center gap-1.5">
        {([
          ["material", "Dari database items", Package],
          ["labour", "Tenaga kerja", HardHat],
          ["product", "Sub-rakitan", Layers],
        ] as const).map(([k, t, Icon]) => (
          <button
            key={k}
            onClick={() => {
              setMode(k); setRef(null); setQ(""); setRate(null); setCreating(false);
              setUom(k === "labour" ? "hari" : "pcs");
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium",
              mode === k ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:bg-white/70",
            )}
          >
            <Icon className="h-3.5 w-3.5" /> {t}
          </button>
        ))}
        <button onClick={onDone} aria-label="Tutup" className="ml-auto rounded p-1 text-slate-400 hover:bg-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Step 1 — what. */}
      {mode !== "labour" && !ref && !creating && (
        <div className="mt-2">
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              autoFocus value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={mode === "material" ? "Cari item: nama, kode, kategori — mis. ‘jati’, ‘PU clear’" : "Cari produk lain…"}
              aria-label="Cari komponen"
              className="h-9 w-full bg-transparent text-sm focus:outline-none"
            />
          </label>
          <ul className="mt-1 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white empty:hidden">
            {matches.map((m) => (
              <li key={m.code}>
                <button onClick={() => choose(m)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-brand-50/50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-slate-800">{m.name}</span>
                    <span className="block truncate text-[11px] text-slate-400">{m.sub}</span>
                  </span>
                  <span className="shrink-0 text-right text-[12px] tabular-nums text-slate-600">
                    {m.price == null ? <span className="text-amber-700">belum ada harga</span> : formatIDR(m.price)}
                    <span className="block text-[10px] text-slate-400">per {m.uom}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {mode === "material" && q.trim().length >= 2 && (
            <button
              onClick={() => setCreating(true)}
              className="mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium text-brand-700 hover:underline"
            >
              <Plus className="h-3.5 w-3.5" />
              {matches.length === 0 ? `Belum ada — tambahkan “${q.trim()}” ke database items` : `Bukan salah satunya? Tambahkan “${q.trim()}” sebagai item baru`}
            </button>
          )}
          {mode === "material" && items.status === "loading" && (
            <p className="mt-1 text-[11px] text-slate-400">Memuat database items…</p>
          )}
        </div>
      )}

      {creating && (
        <NewItem
          initialName={q.trim()} categories={cats.status === "ready" ? cats.data : []}
          busy={busy} run={run}
          onCancel={() => setCreating(false)}
          onCreated={(it) => { setCreating(false); reloadItems(); choose(it); if (it.price != null) setRate(null); }}
        />
      )}

      {/* Step 2 — how much, at what rate. */}
      {(ref || mode === "labour") && (
        <div className="mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
          {ref && (
            <div className="mb-2 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-slate-800">{ref.name}</span>
              <span className="font-mono text-[10px] text-slate-400">{ref.code}</span>
              <button onClick={() => setRef(null)} className="text-[11px] text-slate-500 hover:underline">ganti</button>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            {mode === "labour" && (
              <label className="min-w-[180px] flex-1 text-[11px] text-slate-500">Tenaga kerja
                <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)}
                  placeholder="mis. Tukang finishing" className={cn(inputCls, "mt-0.5")} />
              </label>
            )}
            <label className="text-[11px] text-slate-500">Kebutuhan per 1 {p.uom}
              <div className="mt-0.5 flex gap-1">
                <NumberInput value={qty} min={0} max={99_999} step={0.001} onChange={setQty} className="!w-24" />
                <input value={uom} onChange={(e) => setUom(e.target.value)} list="bom-uoms" aria-label="Satuan"
                  className="h-9 w-20 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none" />
              </div>
            </label>
            <label className="text-[11px] text-slate-500">
              Rate per {uom || "satuan"}
              <div className="mt-0.5 flex items-center gap-1">
                {rate == null && mode !== "labour" ? (
                  <button onClick={() => setRate(ref?.price ?? 0)}
                    className="h-9 rounded-lg border border-dashed border-slate-300 px-2 text-[12px] text-slate-600 hover:bg-slate-50">
                    {ref?.price == null ? "isi rate" : `ikut katalog · ${formatIDR(ref.price)}`}
                  </button>
                ) : (
                  <>
                    <div className="w-32"><MoneyInput value={rate ?? 0} onChange={setRate} /></div>
                    {mode !== "labour" && (
                      <button onClick={() => setRate(null)} title="Ikut harga katalog"
                        className="rounded p-1 text-slate-400 hover:text-slate-700"><RotateCcw className="h-3.5 w-3.5" /></button>
                    )}
                  </>
                )}
              </div>
            </label>
            <div className="ml-auto text-right">
              <span className="block text-[11px] text-slate-500">Subtotal</span>
              <span className="text-sm font-semibold tabular-nums text-slate-800">
                {(rate ?? ref?.price) == null ? "—" : formatIDR(Math.round(qty * (rate ?? ref!.price!)))}
              </span>
            </div>
            <Button icon={Plus} onClick={add} disabled={busy || !ready}>Tambah</Button>
          </div>
          {mode === "labour" && (
            <p className="mt-1.5 text-[11px] text-slate-500">
              Contoh: 1,5 hari × Rp 150.000 upah harian. Satuannya bebas — hari, jam, atau per unit borongan.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** A component the item database does not have yet. It is created **in** the
 *  item database, uncurated, for procurement to file and price later — not in
 *  a list of production's own (0106's `create_bom_item`). */
function NewItem({
  initialName, categories, busy, run, onCancel, onCreated,
}: {
  initialName: string;
  categories: ItemCategory[];
  busy: boolean;
  run: <T>(fn: () => Promise<T>) => Promise<T>;
  onCancel: () => void;
  onCreated: (it: { code: string; name: string; uom: string; price: number | null }) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(initialName);
  const [category, setCategory] = useState("uncurated");
  const [uom, setUom] = useState("pcs");
  const [price, setPrice] = useState(0);

  async function create() {
    const res = await run(() => production.createBomItem({
      name, category_code: category, base_uom: uom, standard_price: price > 0 ? price : null,
    }));
    if (res.error) { toast("warning", "Item tidak dibuat", res.error.message); return; }
    toast("success", res.data.existing ? "Sudah ada — dipakai yang itu" : "Item baru di database items", `${res.data.code} · ${res.data.name}`);
    onCreated({ code: res.data.code, name: res.data.name, uom, price: price > 0 ? price : null });
  }

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-brand-200 bg-white px-3 py-2.5">
      <p className="text-[12px] font-medium text-slate-700">Item baru — masuk ke database items (belum dikurasi)</p>
      <div className="grid gap-2 sm:grid-cols-[2fr_2fr_1fr_1fr]">
        <label className="text-[11px] text-slate-500">Nama + spesifikasi
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
            placeholder="mis. Engsel sendok 35mm" className={cn(inputCls, "mt-0.5")} />
        </label>
        <label className="text-[11px] text-slate-500">Kategori › jenis
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={cn(inputCls, "mt-0.5 bg-white")}>
            <CategoryOptions categories={categories} typesOnlyWhereAvailable current={category} />
          </select>
        </label>
        <label className="text-[11px] text-slate-500">Satuan
          <select value={uom} onChange={(e) => setUom(e.target.value)} className={cn(inputCls, "mt-0.5 bg-white")}>
            <UomOptions current={uom} />
          </select>
        </label>
        <label className="text-[11px] text-slate-500">Harga (opsional)
          <MoneyInput value={price} onChange={setPrice} className="mt-0.5" />
        </label>
      </div>
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Batal</Button>
        <Button size="sm" icon={Plus} onClick={create} disabled={busy || name.trim().length < 2}>Buat item</Button>
      </div>
    </div>
  );
}

/* ── what it comes to ────────────────────────────────────────────────────── */

function CostSummary({ p, mayEdit, busy, run, settle }: PartProps) {
  const [pct, setPct] = useState(p.miscalc_percent);
  const [runQty, setRunQty] = useState(1);
  const dirty = pct !== p.miscalc_percent;
  const released = p.draft_rev == null && p.viewing_rev != null;

  async function saveMiscalc() {
    const res = await run(() => production.setBomMiscalc({ product_code: p.product_code, miscalc_percent: pct }));
    settle(res, "Miskalkulasi disimpan", `${pct}%`);
  }

  const row = (k: string, v: React.ReactNode, cls?: string) => (
    <div className={cn("flex items-baseline justify-between gap-3 py-1", cls)}>
      <span>{k}</span><span className="tabular-nums">{v}</span>
    </div>
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 text-[13px] text-slate-700">
      {row("Bahan & sub-rakitan", p.material_cost == null ? "—" : formatIDR(p.material_cost))}
      {row("Tenaga kerja", p.labour_cost == null ? <span className="text-amber-700">belum ada</span> : formatIDR(p.labour_cost))}
      {row("Subtotal", formatIDR(p.subtotal), "border-t border-slate-200 font-medium text-slate-800")}
      <div className="flex items-center justify-between gap-3 py-1">
        <span className="flex items-center gap-1.5">
          Miskalkulasi
          {mayEdit ? (
            <span className="flex items-center gap-1">
              <NumberInput size="sm" value={pct} min={0} max={100} step={0.5} onChange={setPct} className="!w-16" />%
              {dirty && (
                <Button size="sm" variant="outline" disabled={busy} onClick={saveMiscalc}>
                  {released ? `Simpan → rev ${(p.viewing_rev ?? 0) + 1}` : "Simpan"}
                </Button>
              )}
            </span>
          ) : (
            <span>{p.miscalc_percent}%</span>
          )}
        </span>
        <span className="tabular-nums">{formatIDR(dirty ? Math.round(p.subtotal * pct / 100) : p.miscalc_amount)}</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-3 border-t-2 border-slate-300 pt-2">
        <span>
          <span className="block text-[14px] font-semibold text-slate-900">Biaya produksi per {p.uom}</span>
          <span className="block text-[11px] text-slate-500">{p.product_code} · bukan harga jual</span>
        </span>
        <span className="text-right">
          {p.production_cost == null ? (
            <span className="text-[13px] font-medium text-amber-700">
              belum lengkap
              <span className="block text-[11px] font-normal">
                {p.components.length === 0 ? "belum ada komponen" : `${p.unpriced} komponen tanpa rate`}
              </span>
            </span>
          ) : (
            <span className="text-xl font-bold tabular-nums text-slate-900">{formatIDR(p.production_cost)}</span>
          )}
        </span>
      </div>

      {p.production_cost != null && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-2 text-[12px] text-slate-600">
          <Calculator className="h-3.5 w-3.5 text-slate-400" />
          Untuk
          <NumberInput size="sm" value={runQty} min={1} max={9999} onChange={setRunQty} className="!w-16" />
          {p.uom}:
          <strong className="tabular-nums text-slate-800">{formatIDR(p.production_cost * runQty)}</strong>
        </div>
      )}
    </div>
  );
}

/* ── a new product ───────────────────────────────────────────────────────── */

function NewProduct({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [uom, setUom] = useState("unit");
  const [dims, setDims] = useState({ l: 0, w: 0, h: 0 });
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    const res = await production.saveProduct({
      product_code: code, name, category, uom,
      length_mm: dims.l || null, width_mm: dims.w || null, height_mm: dims.h || null,
    });
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", "Tidak tersimpan", res.error.message); return; }
    toast("success", "Produk dibuat", `${res.data.product_code} · ${res.data.name}`);
    onChanged();
    onClose();
  }

  return (
    <Drawer
      open onClose={onClose} width="max-w-lg"
      title="Produk baru"
      subtitle="Item code dipakai di gambar, di SPK dan di setiap BOM yang menunjuknya — dan tidak pernah diubah lagi."
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button>
          <Button icon={Save} onClick={create} disabled={busy || !code.trim() || !name.trim()}>Simpan</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-slate-500">Item code
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="mis. TL-DT-180" className={cn(inputCls, "mt-1 font-mono")} />
          </label>
          <label className="block text-xs text-slate-500">Kategori
            <input value={category} onChange={(e) => setCategory(e.target.value)}
              placeholder="Meja, Kursi, Lemari…" className={cn(inputCls, "mt-1")} />
          </label>
        </div>
        <label className="block text-xs text-slate-500">Nama
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Meja makan jati 180×90" className={cn(inputCls, "mt-1")} />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-xs text-slate-500">Satuan
            <input value={uom} onChange={(e) => setUom(e.target.value)} className={cn(inputCls, "mt-1")} />
          </label>
          <div className="sm:col-span-2">
            <span className="block text-xs text-slate-500">Ukuran (mm) — P × L × T</span>
            <div className="mt-1 flex items-center gap-1">
              <NumberInput value={dims.l} min={0} max={100_000} onChange={(v) => setDims({ ...dims, l: v })} />
              <span className="text-slate-400">×</span>
              <NumberInput value={dims.w} min={0} max={100_000} onChange={(v) => setDims({ ...dims, w: v })} />
              <span className="text-slate-400">×</span>
              <NumberInput value={dims.h} min={0} max={100_000} onChange={(v) => setDims({ ...dims, h: v })} />
            </div>
          </div>
        </div>
        <p className="text-[11px] text-slate-500">
          Gambar kerja dan komponennya ditambahkan setelah produk tersimpan.
        </p>
      </div>
    </Drawer>
  );
}
