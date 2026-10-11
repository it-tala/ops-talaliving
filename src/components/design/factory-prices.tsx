"use client";

import { useMemo, useRef, useState } from "react";
import { Ban, Check, Factory, Paperclip, Plus, Save, Trash2, X } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { design, documents, procurement } from "@/demo/api";
import { formatMoney, formatNumber } from "@/lib/format";
import { officeToday } from "@/lib/office";
import { cn } from "@/lib/cn";
import type { DesignItemView, FactoryQuoteLine } from "@/services/design/contracts";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Factory prices (0256, O2, kajian F255 §5.3).
 *
 *  TALA finds the order and a partner factory makes it, so before a quotation
 *  can be priced the factory is asked: the drawings and the BOM go out, a
 *  price per item comes back. Procurement records the answer (Q90) as one
 *  offer — one factory, one project, one currency, the factory's own paper —
 *  with a price for each item it covers. The first offer for an item is the
 *  one it is priced from until somebody chooses another; a newer offer from the
 *  same factory takes over on its own. A wrong offer is voided with a reason,
 *  never edited.
 *
 *  Shown to procurement and to whoever sees a quotation's cost (project
 *  update, D375) — `canSeeFactoryPrices`. */

const inputCls = "h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[13px] focus:border-brand-400 focus:outline-none";
/* Without `w-full`: `cn` does not merge classes, so a width given beside
   `w-full` loses to it. For the cells of an offer line, side by side. */
const cellCls = "h-8 rounded-lg border border-slate-200 bg-white px-2 text-[13px] focus:border-brand-400 focus:outline-none";

/** `may_price_factory`: procurement at the level asked, or project update. */
export function useFactoryAccess() {
  const { can } = useSession();
  return {
    see: can("procurement.read") || can("project.update"),
    write: can("procurement.create") || can("project.update"),
  };
}

interface DraftLine { item_no: string; price: string; lead: string; moq: string }

const blankLine = (item_no = ""): DraftLine => ({ item_no, price: "", lead: "", moq: "" });
const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));

/** Record one factory's offer: the factory, the currency, the day, the paper,
 *  and a price for each item it covers. `projectCode` fixed when opened from an
 *  item; `itemNos` the items to start with. */
export function FactoryQuoteForm({
  projectCode, itemNos = [], onDone, onCancel,
}: {
  projectCode?: string | null; itemNos?: string[]; onDone: () => void; onCancel: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  /* One key per opened form: a double click records one offer, not two. */
  const key = useRef(typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID() : `fq-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [project, setProject] = useState(projectCode ?? "");
  const [projects] = useLoad(() => (projectCode ? Promise.resolve({ data: null }) : design.listDesignProjects()), [projectCode]);
  const [projectDesign] = useLoad(
    () => (project ? design.getProjectDesign(project) : Promise.resolve({ data: null })), [project]);
  const [vendors, reloadVendors] = useLoad(() => procurement.listVendors({}), []);
  const [vendor, setVendor] = useState("");
  const [newVendor, setNewVendor] = useState<string | null>(null);
  const [currency, setCurrency] = useState<"IDR" | "USD">("IDR");
  const [quotedOn, setQuotedOn] = useState(officeToday());
  const [validUntil, setValidUntil] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [lines, setLines] = useState<DraftLine[]>(() => (itemNos.length ? itemNos.map((n) => blankLine(n)) : [blankLine()]));
  const [busy, setBusy] = useState(false);

  const items = useMemo(() => {
    const d = projectDesign.status === "ready" ? projectDesign.data : null;
    return d ? d.items.filter((i) => i.status !== "DROPPED") : [];
  }, [projectDesign]);
  /* Factories first; a supplier can be picked and becomes a factory by being
     given an offer. QC and others are not offered. */
  const vendorList = useMemo(() => {
    const vs = vendors.status === "ready" ? vendors.data : [];
    return vs.filter((v) => (v.kind ?? "supplier") === "factory" || (v.kind ?? "supplier") === "supplier")
      .sort((a, b) => Number((b.kind ?? "") === "factory") - Number((a.kind ?? "") === "factory") || a.name.localeCompare(b.name));
  }, [vendors]);

  const filled = lines.filter((l) => l.item_no && l.price.trim());
  const bad = filled.some((l) => !(Number(l.price) > 0)
    || (l.lead.trim() !== "" && !(Number.isInteger(Number(l.lead)) && Number(l.lead) >= 0))
    || (l.moq.trim() !== "" && !(Number(l.moq) > 0)));
  const twice = new Set(filled.map((l) => l.item_no)).size !== filled.length;
  const ready = !!project && (!!vendor || !!newVendor?.trim()) && filled.length > 0 && !bad && !twice;

  async function save() {
    setBusy(true);
    let vendorCode = vendor;
    if (newVendor?.trim()) {
      const v = await procurement.createVendor({ name: newVendor.trim() });
      if (v.error) { setBusy(false); toast("warning", tr("Factory not added", "Pabrik tidak ditambahkan"), v.error.message); return; }
      vendorCode = v.data.code;
      reloadVendors();
    }
    let attachmentId: string | null = null;
    if (file) {
      const up = await documents.upload({ file, kind: "Factory Quotation", entity: "project", entity_no: project, origin: "third_party" });
      if (up.error) { setBusy(false); toast("critical", tr(`${file.name} not uploaded`, `${file.name} tidak terunggah`), up.error.message); return; }
      attachmentId = up.data.id;
    }
    const res = await design.recordFactoryQuote({
      project_code: project, vendor_code: vendorCode, currency,
      quoted_on: quotedOn || null, valid_until: validUntil || null, note: note.trim() || null,
      attachment_id: attachmentId,
      lines: filled.map((l) => ({
        item_no: l.item_no, unit_price: Number(l.price), lead_time_days: numOrNull(l.lead), moq: numOrNull(l.moq),
      })),
    }, key.current);
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", tr("Not recorded", "Tidak tercatat"), res.error.message); return; }
    toast("success", tr(`Offer ${res.data.fq_no} recorded`, `Penawaran ${res.data.fq_no} tercatat`),
      [
        tr(`${res.data.lines} item(s); ${res.data.chosen} now priced from it.`, `${res.data.lines} item; ${res.data.chosen} sekarang dihargai dari penawaran ini.`),
        res.data.vendor_marked_factory ? tr("The vendor is now marked as a factory.", "Vendornya sekarang ditandai pabrik.") : "",
      ].filter(Boolean).join(" "));
    onDone();
  }

  return (
    <div className="space-y-3 text-[13px]">
      <div className="grid gap-2 sm:grid-cols-2">
        {!projectCode && (
          <label className="block text-xs text-slate-500">{tr("Project", "Proyek")}
            <select value={project} onChange={(e) => { setProject(e.target.value); setLines([blankLine()]); }}
              className={cn(inputCls, "mt-1")}>
              <option value="">{tr("— pick a project —", "— pilih proyek —")}</option>
              {projects.status === "ready" && (projects.data ?? []).map((p) => (
                <option key={p.project_code} value={p.project_code}>
                  {p.project_code} · {p.project_name}{p.client_display ? ` — ${p.client_display}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block text-xs text-slate-500">{tr("Factory", "Pabrik")}
          {newVendor === null ? (
            <div className="mt-1 flex gap-1">
              <select value={vendor} onChange={(e) => setVendor(e.target.value)} className={inputCls}>
                <option value="">{tr("— pick a factory —", "— pilih pabrik —")}</option>
                {vendorList.map((v) => (
                  <option key={v.code} value={v.code}>
                    {v.name}{(v.kind ?? "supplier") === "supplier" ? tr(" (supplier)", " (supplier)") : ""}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => { setNewVendor(""); setVendor(""); }}
                title={tr("A factory not on record yet", "Pabrik yang belum tercatat")}>{tr("New", "Baru")}</Button>
            </div>
          ) : (
            <div className="mt-1 flex gap-1">
              <input value={newVendor} onChange={(e) => setNewVendor(e.target.value)} autoFocus
                placeholder={tr("factory name, as it writes it", "nama pabrik, sesuai tulisannya")} className={inputCls} />
              <Button size="sm" variant="ghost" icon={X} onClick={() => setNewVendor(null)} aria-label={tr("Cancel", "Batal")} />
            </div>
          )}
        </label>
        <div className="text-xs text-slate-500">{tr("Currency", "Mata uang")}
          <div className="mt-1 flex w-fit overflow-hidden rounded-lg border border-slate-200">
            {(["IDR", "USD"] as const).map((c) => (
              <button key={c} type="button" onClick={() => setCurrency(c)}
                className={cn("h-8 px-3", currency === c ? "bg-brand-600 text-white" : "bg-white text-slate-700 hover:bg-slate-50")}>
                {c}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs text-slate-500">{tr("Quoted on", "Tanggal penawaran")}
            <input type="date" value={quotedOn} onChange={(e) => setQuotedOn(e.target.value)} className={cn(inputCls, "mt-1")} />
          </label>
          <label className="block text-xs text-slate-500">{tr("Valid until", "Berlaku sampai")}
            <input type="date" value={validUntil} min={quotedOn || undefined} onChange={(e) => setValidUntil(e.target.value)} className={cn(inputCls, "mt-1")} />
          </label>
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs text-slate-500">
          {tr(`Price per unit, in ${currency}`, `Harga per unit, dalam ${currency}`)}
        </p>
        {!project ? (
          <p className="text-[12px] text-slate-400">{tr("Pick the project first.", "Pilih proyeknya dulu.")}</p>
        ) : (
          <div className="space-y-1.5">
            {lines.map((l, n) => (
              <div key={n} className="flex flex-wrap items-center gap-1.5">
                <select value={l.item_no} onChange={(e) => setLines(lines.map((x, k) => (k === n ? { ...x, item_no: e.target.value } : x)))}
                  aria-label={tr("Design item", "Item desain")} className={cn(cellCls, "min-w-0 flex-1 basis-56")}>
                  <option value="">{tr("— design item —", "— item desain —")}</option>
                  {items.map((i) => (
                    <option key={i.item_no} value={i.item_no}>{i.item_no} · {i.name} ({formatNumber(i.qty)})</option>
                  ))}
                </select>
                <input value={l.price} onChange={(e) => setLines(lines.map((x, k) => (k === n ? { ...x, price: e.target.value.replace(/[^\d.]/g, "") } : x)))}
                  inputMode="decimal" placeholder={currency === "USD" ? "395.00" : "6850000"} aria-label={tr("Unit price", "Harga satuan")}
                  className={cn(cellCls, "w-32 text-right tabular-nums")} />
                <input value={l.lead} onChange={(e) => setLines(lines.map((x, k) => (k === n ? { ...x, lead: e.target.value.replace(/\D/g, "") } : x)))}
                  inputMode="numeric" placeholder={tr("days", "hari")} aria-label={tr("Lead time (days)", "Lead time (hari)")}
                  title={tr("Lead time, days", "Lead time, hari")} className={cn(cellCls, "w-16 text-right")} />
                <input value={l.moq} onChange={(e) => setLines(lines.map((x, k) => (k === n ? { ...x, moq: e.target.value.replace(/[^\d.]/g, "") } : x)))}
                  inputMode="decimal" placeholder="MOQ" aria-label="MOQ" title={tr("Minimum order, optional", "Minimum order, opsional")}
                  className={cn(cellCls, "w-16 text-right")} />
                {lines.length > 1 && (
                  <button type="button" onClick={() => setLines(lines.filter((_, k) => k !== n))} aria-label={tr("Remove", "Hapus")}
                    className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-3.5 w-3.5" /></button>
                )}
              </div>
            ))}
            <Button size="sm" variant="ghost" icon={Plus} onClick={() => setLines([...lines, blankLine()])}>
              {tr("Another item", "Item lain")}
            </Button>
            {twice && <p className="text-[12px] text-amber-700">{tr("An item is listed twice.", "Ada item yang tertulis dua kali.")}</p>}
            {bad && <p className="text-[12px] text-amber-700">{tr("Prices above 0; lead time in whole days; MOQ above 0 or empty.", "Harga di atas 0; lead time dalam hari bulat; MOQ di atas 0 atau kosong.")}</p>}
          </div>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block text-xs text-slate-500">{tr("Note", "Catatan")}
          <input value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={tr("e.g. FOB, excludes export packing", "mis. FOB, belum termasuk packing ekspor")} className={cn(inputCls, "mt-1")} />
        </label>
        <label className="block text-xs text-slate-500">{tr("The factory's offer (PDF, photo, screenshot)", "Penawaran dari pabrik (PDF, foto, tangkapan layar)")}
          <span className="mt-1 flex h-8 items-center gap-2">
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-[12px]" />
          </span>
          <span className="text-[11px] text-slate-400">
            {tr("Filed in PROCUREMENT › ops-talaliving › PENAWARAN PABRIK › client › project.", "Disimpan di PROCUREMENT › ops-talaliving › PENAWARAN PABRIK › klien › proyek.")}
          </span>
        </label>
      </div>

      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>{tr("Cancel", "Batal")}</Button>
        <Button size="sm" icon={Save} onClick={save} disabled={busy || !ready}>{tr("Record offer", "Catat penawaran")}</Button>
      </div>
    </div>
  );
}

/** One price, as a row: the factory, the price, lead time, and whether it is
 *  the one the item is priced from. */
export function FactoryLineRow({
  l, showItem = false, canChoose, onChoose,
}: { l: FactoryQuoteLine; showItem?: boolean; canChoose: boolean; onChoose?: (l: FactoryQuoteLine) => void }) {
  const tr = useTr();
  const dead = !!l.voided_at;
  return (
    <li className={cn("px-3 py-1.5 text-[13px]", dead && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {showItem
          ? <span className="text-slate-800"><span className="font-mono text-[12px] text-slate-500">{l.item_no}</span> · {l.item_name}</span>
          : <span className="font-medium text-slate-800">{l.vendor_name ?? l.vendor_code}</span>}
        {l.is_chosen && <Badge tone="green">{tr("Chosen", "Dipilih")}</Badge>}
        {dead && <Badge tone="red">{tr("Voided", "Dibatalkan")}</Badge>}
        {!dead && !l.is_latest && <Badge tone="slate">{tr("Older price", "Harga lama")}</Badge>}
        {!dead && l.expired && <Badge tone="amber">{tr("Past validity", "Lewat masa berlaku")}</Badge>}
        <span className="ml-auto tabular-nums text-slate-800">{formatMoney(l.unit_price, l.currency)}</span>
        {canChoose && !dead && !l.is_chosen && onChoose && (
          <Button size="sm" variant="ghost" icon={Check} onClick={() => onChoose(l)}>{tr("Choose", "Pilih")}</Button>
        )}
      </div>
      <p className="text-[11px] text-slate-500">
        {[
          l.fq_no,
          `${tr("quoted", "penawaran")} ${l.quoted_on}`,
          l.lead_time_days != null ? tr(`${l.lead_time_days} days`, `${l.lead_time_days} hari`) : null,
          l.moq != null ? `MOQ ${formatNumber(l.moq)}` : null,
          l.valid_until ? tr(`valid to ${l.valid_until}`, `berlaku s.d. ${l.valid_until}`) : null,
        ].filter(Boolean).join(" · ")}
        {l.attachment_filename && (
          <> · {l.attachment_url
            ? <a href={l.attachment_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand-700 hover:underline"><Paperclip className="h-3 w-3" />{l.attachment_filename}</a>
            : <span className="inline-flex items-center gap-0.5"><Paperclip className="h-3 w-3" />{l.attachment_filename}</span>}</>
        )}
      </p>
      {(l.note || l.quote_note) && <p className="text-[11px] text-slate-500">{[l.note, l.quote_note].filter(Boolean).join(" · ")}</p>}
      {dead && l.void_reason && <p className="text-[11px] text-rose-700">{tr("Voided", "Dibatalkan")}: {l.void_reason}</p>}
    </li>
  );
}

/** The design item's offers, on the item drawer: which factory it is priced
 *  from, the others, and a form to record a new one. */
export function ItemFactoryPrices({ i, onChanged }: { i: DesignItemView; onChanged: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const access = useFactoryAccess();
  const [state, reload] = useLoad(() => design.listFactoryQuoteLines({ item_no: i.item_no }), [i.item_no, i.updated_at]);
  const [recording, setRecording] = useState(false);
  if (!access.see) return null;

  async function choose(l: FactoryQuoteLine | null) {
    const res = await design.chooseFactoryLine(i.item_no, l?.id ?? null);
    if (res.error) { toast("warning", tr("Not changed", "Tidak berubah"), res.error.message); return; }
    toast("success", l ? tr("Factory chosen", "Pabrik dipilih") : tr("No factory price", "Tanpa harga pabrik"),
      l ? `${l.vendor_name ?? ""} · ${formatMoney(l.unit_price, l.currency)}` : i.item_no);
    reload();
    onChanged();
  }

  return (
    <section>
      <div className="mb-1.5 flex items-center gap-2">
        <Factory className="h-3.5 w-3.5 text-slate-400" />
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{tr("Factory prices", "Harga pabrik")}</h3>
        {access.write && !recording && i.status !== "DROPPED" && (
          <Button size="sm" variant="ghost" icon={Plus} className="ml-auto" onClick={() => setRecording(true)}>
            {tr("Record a price", "Catat harga")}
          </Button>
        )}
      </div>
      {recording && (
        <div className="mb-2 rounded-lg border border-brand-200 bg-brand-50/30 p-3">
          <FactoryQuoteForm projectCode={i.project_code} itemNos={[i.item_no]}
            onCancel={() => setRecording(false)}
            onDone={() => { setRecording(false); reload(); onChanged(); }} />
        </div>
      )}
      <Loaded state={state} onRetry={reload} skeletonRows={1}>
        {(rows) => rows.length === 0 ? (
          <p className="text-[12px] text-slate-400">
            {tr("No factory has priced this item yet. A quotation line for it is costed from its BOM or a typed cost.",
              "Belum ada pabrik yang memberi harga untuk item ini. Baris quotation-nya dihargai dari BOM atau ongkos yang diketik.")}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              {rows.map((l) => <FactoryLineRow key={l.id} l={l} canChoose={access.write} onChoose={choose} />)}
            </ul>
            {access.write && rows.some((l) => l.is_chosen) && (
              <button type="button" onClick={() => choose(null)}
                className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-800">
                <Ban className="h-3 w-3" /> {tr("Price this item without a factory (BOM or typed cost)", "Hargai item ini tanpa pabrik (BOM atau ongkos diketik)")}
              </button>
            )}
          </>
        )}
      </Loaded>
    </section>
  );
}
