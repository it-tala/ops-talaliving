"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Container, FileText, Paperclip, Pencil, Save, Ship, X } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { Drawer } from "@/components/ui/drawer";
import { useLoad } from "@/components/ui/loaded";
import { NumberInput } from "@/components/ui/number-input";
import { delivery, documents, procurement } from "@/demo/api";
import { cn } from "@/lib/cn";
import { officeToday } from "@/lib/office";
import {
  CONTAINER_SIZES, type ContainerSize, type DeliveryView, type FulfilmentView,
} from "@/services/delivery/contracts";
import { checkDigitWarning, cleanContainerNo, containerNoShapeOk } from "@/services/delivery/container";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";

/** Containers (0259, O5, kajian §5.6).
 *
 *  A container is a delivery of its own kind: what is in it per order line —
 *  the same lines a lorry carries — plus its number, seal and size, the
 *  factory order it was loaded from, the ship's dates and the bill of lading.
 *  It is loaded here, corrected while it is at sea, and marked arrived the way
 *  a lorry is. Its packing list and B/L are filed with it. */

const inputCls = "h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none";
const label = "block text-[11px] text-slate-500";

/** Load a container for one of the projects on the delivery board. */
export function ContainerDrawer({
  projects, onClose, onDone,
}: { projects: FulfilmentView[]; onClose: () => void; onDone: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const key = useRef(typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID() : `ct-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [code, setCode] = useState(projects[0]?.project_code ?? "");
  const project = projects.find((p) => p.project_code === code) ?? null;
  const [orderLines] = useLoad(() => (code ? procurement.listProjectLines(code) : Promise.resolve({ data: null })), [code]);
  const [po, setPo] = useState("");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [no, setNo] = useState("");
  const [seal, setSeal] = useState("");
  const [size, setSize] = useState<ContainerSize | "">("40HC");
  const [loadedOn, setLoadedOn] = useState(officeToday());
  const [etd, setEtd] = useState("");
  const [eta, setEta] = useState("");
  const [bl, setBl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  /* The factory orders this project's lines are on (O3). Choosing one narrows
     the lines to that order's — a container from a factory carries its order. */
  const lineRows = useMemo(() => (orderLines.status === "ready" ? orderLines.data ?? [] : []), [orderLines]);
  const orders = [...new Map(lineRows.filter((l) => l.factory_po_no)
    .map((l) => [l.factory_po_no!, l.factory_vendor_name])).entries()];
  const onPo = new Set(lineRows.filter((l) => po && l.factory_po_no === po).map((l) => l.id));
  const lines = (project?.lines ?? []).filter((l) => !po || onPo.has(l.project_line_id));

  const clean = cleanContainerNo(no);
  const shapeOk = !!clean && containerNoShapeOk(clean);
  const digitWarning = shapeOk ? checkDigitWarning(clean!) : null;
  const picked = Object.entries(qty).filter(([id, n]) => n > 0 && lines.some((l) => l.project_line_id === id));
  const total = picked.reduce((t, [, n]) => t + n, 0);
  const datesBad = !!etd && !!eta && eta < etd;
  const ready = !!project && shapeOk && total > 0 && !datesBad && !!loadedOn;

  function pickProject(c: string) { setCode(c); setPo(""); setQty({}); }

  async function submit() {
    setBusy(true);
    const res = await delivery.createContainer({
      project_code: code, loaded_on: loadedOn, container_no: clean!, seal_no: seal || null,
      container_size: size || null, po_no: po || null, etd: etd || null, eta: eta || null,
      bl_no: bl || null, note: note || null,
      lines: picked.map(([project_line_id, n]) => ({ project_line_id, qty: n })),
    }, key.current);
    setBusy(false);
    if (res.error) { toast(res.error.status === 409 ? "critical" : "warning", tr("Container not recorded", "Kontainer tidak dicatat"), res.error.message); return; }
    toast(res.data.load_warnings.length ? "warning" : "success",
      tr(`Container ${res.data.container_no} loaded`, `Kontainer ${res.data.container_no} dimuat`),
      [tr(`${res.data.delivery_no} · ${res.data.total_qty} pieces`, `${res.data.delivery_no} · ${res.data.total_qty} barang`), ...res.data.load_warnings].join(" "));
    onDone();
  }

  return (
    <Drawer open onClose={onClose} width="max-w-2xl"
      title={tr("Load a container", "Muat kontainer")}
      subtitle={tr("What is in it per order line, its number and seal, and the ship's dates. It counts as shipped the way a lorry does.",
        "Isinya per baris order, nomor dan segelnya, dan jadwal kapal. Terhitung dikirim seperti truk.")}>
      <div className="space-y-3 text-[13px]">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={label}>{tr("Project", "Proyek")}
            <select value={code} onChange={(e) => pickProject(e.target.value)} className={cn(inputCls, "mt-1")}>
              {projects.map((p) => <option key={p.project_code} value={p.project_code}>{p.project_code} · {p.project_name}</option>)}
            </select>
          </label>
          <label className={label}>{tr("From factory order (optional)", "Dari order pabrik (opsional)")}
            <select value={po} onChange={(e) => { setPo(e.target.value); setQty({}); }} className={cn(inputCls, "mt-1")}>
              <option value="">{tr("— not from one order —", "— bukan dari satu order —")}</option>
              {orders.map(([n, v]) => <option key={n} value={n}>{n}{v ? ` · ${v}` : ""}</option>)}
            </select>
          </label>
        </div>

        <ul className="space-y-1.5">
          {lines.map((l) => (
            <li key={l.project_line_id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
              <span className="min-w-[180px] flex-1">
                <span className="block text-slate-800">{l.line_no}. {l.description}</span>
                <span className="block text-[11px] text-slate-500">
                  {tr("ordered", "dipesan")} {l.ordered} {l.uom} · {tr("shipped", "terkirim")} {l.delivered}
                  {l.ready_to_ship != null && <> · {tr("ready", "siap")} {l.ready_to_ship}</>}
                </span>
              </span>
              <span className="w-28">
                <NumberInput value={qty[l.project_line_id] ?? 0} onChange={(n) => setQty({ ...qty, [l.project_line_id]: n })}
                  max={l.ready_to_ship ?? undefined} />
              </span>
            </li>
          ))}
          {lines.length === 0 && <li className="text-slate-500">{tr("No order lines here.", "Tidak ada baris order di sini.")}</li>}
        </ul>

        <div className="grid gap-2 sm:grid-cols-3">
          <label className={cn(label, "sm:col-span-2")}>{tr("Container number", "Nomor kontainer")}
            <input value={no} onChange={(e) => setNo(e.target.value)} placeholder="MSKU 123456 5"
              className={cn(inputCls, "mt-1 font-mono uppercase")} />
            {no && !shapeOk && <span className="mt-0.5 block text-[11px] text-amber-700">{tr("Four letters (the fourth U, J or Z), then seven digits.", "Empat huruf (yang keempat U, J atau Z), lalu tujuh angka.")}</span>}
            {digitWarning && <span className="mt-0.5 block text-[11px] text-amber-700">{digitWarning}</span>}
          </label>
          <label className={label}>{tr("Size", "Ukuran")}
            <select value={size} onChange={(e) => setSize(e.target.value as ContainerSize | "")} className={cn(inputCls, "mt-1")}>
              <option value="">—</option>
              {CONTAINER_SIZES.map((s) => <option key={s} value={s}>{s === "40HC" ? "40' HC" : `${s}'`}</option>)}
            </select>
          </label>
          <label className={label}>{tr("Seal", "Segel")}
            <input value={seal} onChange={(e) => setSeal(e.target.value)} className={cn(inputCls, "mt-1 font-mono uppercase")} />
          </label>
          <label className={label}>{tr("Loaded on", "Dimuat tanggal")}
            <input type="date" value={loadedOn} onChange={(e) => setLoadedOn(e.target.value)} className={cn(inputCls, "mt-1")} />
          </label>
          <label className={label}>{tr("B/L number", "Nomor B/L")}
            <input value={bl} onChange={(e) => setBl(e.target.value)} className={cn(inputCls, "mt-1 font-mono uppercase")} />
          </label>
          <label className={label}>ETD
            <input type="date" value={etd} onChange={(e) => setEtd(e.target.value)} className={cn(inputCls, "mt-1")} />
          </label>
          <label className={label}>ETA
            <input type="date" value={eta} onChange={(e) => setEta(e.target.value)} className={cn(inputCls, "mt-1")} />
            {datesBad && <span className="mt-0.5 block text-[11px] text-rose-700">{tr("ETA is before ETD.", "ETA sebelum ETD.")}</span>}
          </label>
          <label className={label}>{tr("Note", "Catatan")}
            <input value={note} onChange={(e) => setNote(e.target.value)} className={cn(inputCls, "mt-1")} />
          </label>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[12px] text-slate-500">{tr(`${total} piece(s)`, `${total} barang`)}</span>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Cancel", "Batal")}</Button>
            <Button icon={Ship} onClick={submit} disabled={busy || !ready}>{tr("Record container", "Catat kontainer")}</Button>
          </div>
        </div>
      </div>
    </Drawer>
  );
}

/** A container's line on the delivery list: its number, seal, size, order,
 *  dates and papers, corrected in place while it is at sea. */
export function ContainerPanel({ d, mayEdit, onChanged }: { d: DeliveryView; mayEdit: boolean; onChanged: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({
    no: d.container_no ?? "", seal: d.seal_no ?? "", size: (d.container_size ?? "") as ContainerSize | "",
    etd: d.etd ?? "", eta: d.eta ?? "", bl: d.bl_no ?? "",
  });
  const [busy, setBusy] = useState(false);
  const open = d.status === "IN_TRANSIT" || d.status === "DRAFT";

  async function save() {
    setBusy(true);
    const res = await delivery.updateContainer({
      delivery_no: d.delivery_no, container_no: f.no, seal_no: f.seal || null, container_size: f.size || null,
      etd: f.etd || null, eta: f.eta || null, bl_no: f.bl || null,
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", tr("Container updated", "Kontainer diperbarui"), d.delivery_no);
    setEditing(false);
    onChanged();
  }

  const docs = (k: "packing_list" | "bill_of_lading") => d.container_docs.filter((x) => x.kind === k);

  return (
    <div className="mt-1.5 rounded-lg border border-sky-200 bg-sky-50/50 px-3 py-2 text-[12px]">
      {editing ? (
        <div className="grid gap-1.5 sm:grid-cols-3">
          {([
            ["no", tr("Container number", "Nomor kontainer"), "text"],
            ["seal", tr("Seal", "Segel"), "text"],
            ["bl", tr("B/L number", "Nomor B/L"), "text"],
            ["etd", "ETD", "date"],
            ["eta", "ETA", "date"],
          ] as const).map(([k, l, t]) => (
            <label key={k} className={label}>{l}
              <input type={t} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}
                className={cn("mt-0.5 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[13px] focus:border-brand-400 focus:outline-none", t === "text" && "font-mono uppercase")} />
            </label>
          ))}
          <label className={label}>{tr("Size", "Ukuran")}
            <select value={f.size} onChange={(e) => setF({ ...f, size: e.target.value as ContainerSize | "" })}
              className="mt-0.5 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[13px]">
              <option value="">—</option>
              {CONTAINER_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <div className="flex items-end gap-1.5 sm:col-span-3">
            <Button size="sm" icon={Save} disabled={busy} onClick={save}>{tr("Save", "Simpan")}</Button>
            <Button size="sm" variant="ghost" icon={X} onClick={() => setEditing(false)}>{tr("Cancel", "Batal")}</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-700">
          <span className="inline-flex items-center gap-1 font-mono font-medium"><Container className="h-3.5 w-3.5 text-sky-600" />{d.container_no}</span>
          {d.container_size && <Badge tone="slate">{d.container_size === "40HC" ? "40' HC" : `${d.container_size}'`}</Badge>}
          {d.seal_no && <span>{tr("seal", "segel")} <span className="font-mono">{d.seal_no}</span></span>}
          {d.po_no && <span>{tr("from", "dari")} <span className="font-mono">{d.po_no}</span></span>}
          <span>ETD {d.etd ?? "—"} · ETA {d.eta ?? "—"}</span>
          {d.bl_no ? <span>B/L <span className="font-mono">{d.bl_no}</span></span> : <span className="text-amber-700">{tr("no B/L yet", "B/L belum ada")}</span>}
          {d.days_past_eta != null && (
            <span className="inline-flex items-center gap-1 text-rose-700"><AlertTriangle className="h-3 w-3" />
              {tr(`${d.days_past_eta} day(s) past ETA`, `lewat ETA ${d.days_past_eta} hari`)}</span>
          )}
          {mayEdit && open && (
            <button type="button" onClick={() => setEditing(true)} className="ml-auto inline-flex items-center gap-1 text-slate-500 hover:text-brand-700">
              <Pencil className="h-3 w-3" /> {tr("Edit", "Ubah")}
            </button>
          )}
        </div>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {(["packing_list", "bill_of_lading"] as const).map((k) => (
          <span key={k} className="inline-flex flex-wrap items-center gap-1.5">
            {docs(k).map((x) => (
              x.url
                ? <a key={x.attachment_id} href={x.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline"><FileText className="h-3 w-3" />{x.filename}</a>
                : <span key={x.attachment_id} className="inline-flex items-center gap-1 text-slate-600"><FileText className="h-3 w-3" />{x.filename}</span>
            ))}
            {mayEdit && <DocUpload deliveryNo={d.delivery_no} kind={k} onDone={onChanged} />}
          </span>
        ))}
      </div>
    </div>
  );
}

/** A packing list or B/L: uploaded against the delivery, so it lands in
 *  PENGIRIMAN/{client}/{project} (D313), then linked to the container. */
function DocUpload({ deliveryNo, kind, onDone }: { deliveryNo: string; kind: "packing_list" | "bill_of_lading"; onDone: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const name = kind === "packing_list" ? tr("Packing list", "Packing list") : "B/L";

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    const up = await documents.upload({
      file, kind: kind === "packing_list" ? "Packing List" : "Bill of Lading", entity: "delivery", entity_no: deliveryNo,
    });
    if (up.error) { setBusy(false); toast("critical", tr(`${file.name} not uploaded`, `${file.name} tidak terunggah`), up.error.message); return; }
    const res = await delivery.fileContainerDoc({ delivery_no: deliveryNo, kind, attachment_id: up.data.id });
    setBusy(false);
    if (ref.current) ref.current.value = "";
    if (res.error) { toast("warning", tr("Not filed", "Tidak tersimpan"), res.error.message); return; }
    toast("success", tr(`${name} filed`, `${name} tersimpan`), file.name);
    onDone();
  }

  return (
    <>
      <input ref={ref} type="file" accept="image/*,application/pdf" className="hidden" aria-label={name}
        onChange={(e) => pick(e.target.files?.[0])} />
      <button type="button" disabled={busy} onClick={() => ref.current?.click()}
        className="inline-flex items-center gap-1 rounded-md border border-dashed border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:border-brand-400 hover:text-brand-700 disabled:opacity-50">
        <Paperclip className="h-3 w-3" />{busy ? tr("Uploading…", "Mengunggah…") : name}
      </button>
    </>
  );
}
