"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Check, FileSignature, Hammer, History, ListTree, Package, Pencil, Plus, Save, Trash2, UserPlus, X,
} from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import { Badge, Button } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { MoneyInput } from "@/components/ui/money-input";
import { NumberInput } from "@/components/ui/number-input";
import { UomOptions } from "@/components/ui/uom-options";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { procurement, production, quotation } from "@/demo/api";
import { QUOTATION_STATUSES } from "@/services/quotation/contracts";
import {
  PROJECT_STATUSES, PROJECT_STATUS_LABEL,
  type ClientView, type ProjectLineView, type ProjectStatus, type ProjectView,
} from "@/services/procurement/contracts";
import { ClientDrawer } from "../../master-data/clients/ClientDrawer";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";

/** One customer's order: who ordered, where it stands, what they ordered and
 *  when it ships — and, per line, the item code the BOM is written against
 *  (owner's brief, 2026-09-23).
 *
 *  An order line is typed in the client's words the day it is signed. It
 *  becomes an **item code** with one click — or is linked to one that already
 *  exists, because the same lounge chair ordered by two hotels is one code
 *  with one BOM — and from there its production cost is one click away.
 */
export function ProjectDrawer({
  code, onClose, onChanged,
}: {
  code: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  if (!code) return <NewProject onClose={onClose} onChanged={onChanged} />;
  return <ExistingProject code={code} onClose={onClose} onChanged={onChanged} />;
}

const inputCls = "h-9 w-full rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-400 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500";

/* ── the project's own facts, shared by new and existing ──────────────────── */

interface Facts {
  code: string; name: string; client_code: string; location: string; pic: string;
  started_on: string; target_date: string; contract_value: number; note: string;
}

const factsOf = (p: ProjectView | null): Facts => ({
  code: p?.code ?? "", name: p?.name ?? "", client_code: p?.client_code ?? "",
  location: p?.location ?? "", pic: p?.pic ?? "",
  started_on: p?.started_on ?? "", target_date: p?.target_date ?? "",
  contract_value: p?.contract_value ?? 0, note: p?.note ?? "",
});

function FactsForm({
  f, set, isNew, disabled,
}: {
  f: Facts;
  set: (patch: Partial<Facts>) => void;
  isNew: boolean;
  disabled: boolean;
}) {
  const { can } = useSession();
  const [clients, reloadClients] = useLoad(() => procurement.listClients(), []);
  const [adding, setAdding] = useState(false);

  const text = (key: keyof Facts, label: string, placeholder?: string, type = "text") => (
    <label className="block text-xs text-slate-500">{label}
      <input
        type={type} value={String(f[key])} onChange={(e) => set({ [key]: e.target.value } as Partial<Facts>)}
        placeholder={placeholder} disabled={disabled} className={cn(inputCls, "mt-1")}
      />
    </label>
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {isNew ? (
        <label className="block text-xs text-slate-500">Kode proyek
          <input
            value={f.code} onChange={(e) => set({ code: e.target.value })} disabled={disabled}
            placeholder="kosongkan — nomor berikutnya dibuat otomatis"
            className={cn(inputCls, "mt-1 font-mono")}
          />
        </label>
      ) : null}
      {text("name", "Nama proyek", "mis. VILLA BABY ISLAND")}
      <div className="sm:col-span-2">
        <span className="block text-xs text-slate-500">Klien</span>
        <div className="mt-1 flex gap-1.5">
          <select
            value={f.client_code} onChange={(e) => set({ client_code: e.target.value })} disabled={disabled}
            aria-label="Klien" className={cn(inputCls, "bg-white")}
          >
            <option value="">— internal / stok, tanpa klien —</option>
            {(clients.status === "ready" ? clients.data : []).map((c: ClientView) => (
              <option key={c.code} value={c.code}>{c.name} · {c.code}</option>
            ))}
          </select>
          {!disabled && can("project.create") && (
            <Button variant="outline" icon={UserPlus} onClick={() => setAdding(true)}>Klien baru</Button>
          )}
        </div>
      </div>
      {text("location", "Lokasi", "Nusa Dua")}
      {text("pic", "Penanggung jawab", "nama PIC internal")}
      {text("started_on", "Mulai", undefined, "date")}
      {text("target_date", "Jadwal kirim", undefined, "date")}
      <label className="block text-xs text-slate-500">Nilai kontrak
        <MoneyInput value={f.contract_value} onChange={(v) => set({ contract_value: v })} disabled={disabled} className="mt-1" />
      </label>
      {text("note", "Catatan", "mis. termin 3 kali, DP sudah masuk")}
      {adding && (
        <ClientDrawer
          client={null}
          onClose={() => setAdding(false)}
          onSaved={(c) => { setAdding(false); reloadClients(); set({ client_code: c.code }); }}
        />
      )}
    </div>
  );
}

function NewProject({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { can } = useSession();
  const { toast } = useToast();
  const [f, setF] = useState<Facts>(factsOf(null));
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    const res = await procurement.saveProject({
      code: f.code.trim() || null, name: f.name, client_code: f.client_code || null,
      location: f.location || null, pic: f.pic || null,
      started_on: f.started_on || null, target_date: f.target_date || null,
      contract_value: f.contract_value > 0 ? f.contract_value : null, note: f.note || null,
    });
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", "Tidak tersimpan", res.error.message); return; }
    toast("success", "Proyek dibuat", `${res.data.code} · ${res.data.name} — status Inquiry`);
    onChanged();
    onClose();
  }

  return (
    <Drawer
      open onClose={onClose} width="max-w-xl" title="Proyek baru"
      subtitle="Kodenya dipakai di PR, Job Order dan ledger — sekali dibuat, tidak pernah diubah."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Batal</Button>
          <Button icon={Save} onClick={create} disabled={busy || !f.name.trim() || !can("project.create")}>Simpan</Button>
        </div>
      }
    >
      <FactsForm f={f} set={(patch) => setF((x) => ({ ...x, ...patch }))} isNew disabled={!can("project.create")} />
      <p className="mt-3 text-[11px] text-slate-500">
        Item yang dipesan ditambahkan setelah proyek tersimpan. Status awalnya <strong>Inquiry</strong>.
      </p>
    </Drawer>
  );
}

/* ── an existing project ─────────────────────────────────────────────────── */

function ExistingProject({ code, onClose, onChanged }: { code: string; onClose: () => void; onChanged: () => void }) {
  const { can } = useSession();
  const { toast } = useToast();
  const [project, reloadProject] = useLoad(() => procurement.getProject(code), [code]);
  const [lines, reloadLines] = useLoad(() => procurement.listProjectLines(code), [code]);
  const [history, reloadHistory] = useLoad(() => procurement.listProjectHistory(code), [code]);
  const mayEdit = can("project.update");
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState<Facts>(factsOf(null));
  const [busy, setBusy] = useState(false);

  const reloadAll = () => { reloadProject(); reloadLines(); reloadHistory(); onChanged(); };

  async function saveFacts() {
    setBusy(true);
    const res = await procurement.saveProject({
      code, name: f.name, client_code: f.client_code || null,
      location: f.location || null, pic: f.pic || null,
      started_on: f.started_on || null, target_date: f.target_date || null,
      contract_value: f.contract_value > 0 ? f.contract_value : null, note: f.note || null,
    });
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", "Tidak tersimpan", res.error.message); return; }
    toast("success", "Proyek diperbarui", res.data.name);
    setEditing(false);
    reloadAll();
  }

  return (
    <Drawer
      open onClose={onClose} width="max-w-5xl"
      title={project.status === "ready" ? project.data.name : code}
      subtitle={project.status === "ready"
        ? `${code}${project.data.client_display ? ` · ${project.data.client_display}` : " · internal"}`
        : code}
    >
      <Loaded state={project} onRetry={reloadProject}>
        {(p) => (
          <div className="space-y-5">
            <StatusBar p={p} mayEdit={mayEdit} onChanged={reloadAll} />

            <div className="rounded-xl border border-slate-200 px-4 py-3">
              {editing ? (
                <>
                  <FactsForm f={f} set={(patch) => setF((x) => ({ ...x, ...patch }))} isNew={false} disabled={busy} />
                  <div className="mt-3 flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>Batal</Button>
                    <Button size="sm" icon={Save} onClick={saveFacts} disabled={busy || !f.name.trim()}>Simpan</Button>
                  </div>
                </>
              ) : (
                <div className="flex flex-wrap items-start gap-x-8 gap-y-2 text-[13px]">
                  {([
                    ["Klien", p.client_display ?? "internal / stok"],
                    ["Kontak", [p.client_contact, p.client_phone].filter(Boolean).join(" · ") || "—"],
                    ["Lokasi", p.location ?? "—"],
                    ["PIC", p.pic ?? "—"],
                    ["Mulai", p.started_on ?? "—"],
                    ["Jadwal kirim", p.target_date ?? "—"],
                    ["Nilai kontrak", p.contract_value == null ? "—" : formatIDR(p.contract_value)],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k}>
                      <span className="block text-[11px] uppercase tracking-wide text-slate-400">{k}</span>
                      <span className="text-slate-800">{v}</span>
                    </div>
                  ))}
                  {mayEdit && (
                    <Button size="sm" variant="ghost" icon={Pencil} className="ml-auto"
                      onClick={() => { setF(factsOf(p)); setEditing(true); }}>
                      Ubah
                    </Button>
                  )}
                  {p.note && <p className="w-full text-[12px] text-slate-500">{p.note}</p>}
                </div>
              )}
            </div>

            <Quotations code={code} />

            <Loaded state={lines} onRetry={reloadLines} skeletonRows={3}>
              {(rows) => <OrderLines p={p} rows={rows} mayEdit={mayEdit} onChanged={() => { reloadLines(); reloadProject(); onChanged(); }} />}
            </Loaded>

            <Loaded state={history} skeletonRows={1}>
              {(h) => h.length === 0 ? null : (
                <details className="rounded-xl border border-slate-200 px-4 py-2.5 text-[12px] text-slate-600">
                  <summary className="flex cursor-pointer select-none items-center gap-1.5 text-slate-700">
                    <History className="h-3.5 w-3.5 text-slate-400" /> Riwayat status ({h.length})
                  </summary>
                  <ul className="mt-2 space-y-1">
                    {h.map((c, i) => (
                      <li key={i}>
                        <span className="text-slate-400">{c.changed_at.slice(0, 16).replace("T", " ")}</span>{" · "}
                        {c.from_status ? `${PROJECT_STATUS_LABEL(c.from_status)} → ` : ""}
                        <strong className="font-medium text-slate-800">{PROJECT_STATUS_LABEL(c.to_status)}</strong>
                        {c.changed_by && <span className="text-slate-400"> · {c.changed_by}</span>}
                        {c.reason && <span className="block pl-4 text-slate-500">“{c.reason}”</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Loaded>
          </div>
        )}
      </Loaded>
    </Drawer>
  );
}

/* ── what was offered ────────────────────────────────────────────────────── */

/** The project's quotations, and the way to start one: a quotation is priced
 *  from the released BOMs and, once the client accepts, becomes the lines
 *  below (0133). */
function Quotations({ code }: { code: string }) {
  const { can } = useSession();
  const [rows] = useLoad(() => quotation.listQuotations({ project_code: code }), [code]);
  const list = rows.status === "ready" ? rows.data : [];
  const draft = list.find((x) => x.status === "DRAFT");
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-[13px]">
      <FileSignature className="h-4 w-4 text-slate-400" />
      <span className="font-semibold text-slate-800">Quotation</span>
      {list.length === 0 && <span className="text-[12px] text-slate-400">belum ada</span>}
      {list.map((x) => {
        const st = QUOTATION_STATUSES.find((s) => s.code === x.status)!;
        return (
          <Link key={x.quote_no} href={`/proyek/quotation/${encodeURIComponent(x.quote_no)}`}
            className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 ring-1 ring-inset ring-slate-200 hover:bg-slate-50",
              !x.is_current && x.status !== "ACCEPTED" && "opacity-60")}>
            <span className="font-mono text-[11px]">{x.quote_no}</span>
            <Badge tone={st.tone}>{st.label}</Badge>
            {x.grand_total != null && <span className="tabular-nums text-[12px] text-slate-600">{formatIDR(x.grand_total)}</span>}
          </Link>
        );
      })}
      {can("project.create") && (
        <Link href={draft ? `/proyek/quotation/${encodeURIComponent(draft.quote_no)}` : `/proyek/quotation?project=${encodeURIComponent(code)}`}
          className="ml-auto">
          <Button size="sm" variant="outline" icon={draft ? Pencil : Plus}>{draft ? "Lanjutkan draft" : "Buat quotation"}</Button>
        </Link>
      )}
    </div>
  );
}

/* ── where the order stands ──────────────────────────────────────────────── */

function StatusBar({ p, mayEdit, onChanged }: { p: ProjectView; mayEdit: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const current = p.status ?? "INQUIRY";

  async function move(status: ProjectStatus, why?: string) {
    setBusy(true);
    const res = await procurement.setProjectStatus({ code: p.code, status, reason: why ?? null });
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", "Status tidak berubah", res.error.message); return; }
    toast("success", "Status diperbarui", PROJECT_STATUS_LABEL(status));
    setCancelling(false); setReason("");
    onChanged();
  }

  const flow = PROJECT_STATUSES.filter((s) => s.code !== "CANCELLED");
  const at = flow.findIndex((s) => s.code === current);

  return (
    <div className={cn("rounded-xl border px-4 py-3", current === "CANCELLED" ? "border-rose-200 bg-rose-50/50" : "border-slate-200")}>
      <div className="flex flex-wrap items-center gap-1.5">
        {flow.map((s, i) => (
          <button
            key={s.code} disabled={!mayEdit || busy || s.code === current}
            onClick={() => move(s.code)}
            title={mayEdit ? `Pindah ke ${s.label}` : undefined}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] font-medium ring-1 ring-inset transition-colors",
              s.code === current ? "bg-brand-600 text-white ring-brand-600"
                : current !== "CANCELLED" && i < at ? "bg-brand-50 text-brand-700 ring-brand-200"
                  : "bg-white text-slate-500 ring-slate-200",
              mayEdit && s.code !== current && "hover:bg-slate-50",
            )}
          >
            {current !== "CANCELLED" && i < at && <Check className="h-3 w-3" />}
            {s.label}
          </button>
        ))}
        <span className="flex-1" />
        {current === "CANCELLED" ? (
          <Badge tone="red">Batal</Badge>
        ) : mayEdit && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setCancelling((v) => !v)}>Batalkan…</Button>
        )}
      </div>
      {cancelling && (
        <div className="mt-2 flex gap-1.5">
          <input
            autoFocus value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Kenapa dibatalkan? — dibaca orang yang nanti bertanya"
            aria-label="Alasan pembatalan" className={inputCls}
          />
          <Button size="sm" variant="danger" disabled={busy || !reason.trim()} onClick={() => move("CANCELLED", reason)}>
            Batalkan proyek
          </Button>
        </div>
      )}
      <p className="mt-1.5 text-[11px] text-slate-500">
        Klik status untuk memindahkan — maju atau mundur. Setiap perpindahan tercatat di riwayat.
      </p>
    </div>
  );
}

/* ── what they ordered ───────────────────────────────────────────────────── */

interface LineDraft {
  description: string; product_code: string; qty: number; uom: string;
  unit_price: number; delivery_date: string; note: string;
}

const draftOf = (l: ProjectLineView | null, p: ProjectView): LineDraft => ({
  description: l?.description ?? "", product_code: l?.product_code ?? "",
  qty: l?.qty ?? 1, uom: l?.uom ?? "pcs", unit_price: l?.unit_price ?? 0,
  delivery_date: l?.delivery_date ?? p.target_date ?? "", note: l?.note ?? "",
});

function OrderLines({
  p, rows, mayEdit, onChanged,
}: {
  p: ProjectView;
  rows: ProjectLineView[];
  mayEdit: boolean;
  onChanged: () => void;
}) {
  const { can } = useSession();
  const { toast } = useToast();
  const [products] = useLoad(() => production.listProducts({ include_inactive: true }), []);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [d, setD] = useState<LineDraft>(draftOf(null, p));
  const [busy, setBusy] = useState(false);
  const [coding, setCoding] = useState<string | null>(null);
  const [newCode, setNewCode] = useState("");
  const [jobbing, setJobbing] = useState<string | null>(null);
  const [job, setJob] = useState<{ qty: number; due: string; route: "IN_HOUSE" | "SUBCON" }>({ qty: 0, due: "", route: "IN_HOUSE" });

  function startJob(l: ProjectLineView) {
    setJob({
      qty: Math.max(l.qty - l.job_order_qty, 0) || l.qty,
      due: l.delivery_date ?? p.target_date ?? "",
      route: "IN_HOUSE",
    });
    setJobbing(l.id);
  }

  /* The line fills the Job Order — product, name, unit and project — and the
     first one moves a project still being sold into production (0130). */
  async function makeJob(l: ProjectLineView) {
    setBusy(true);
    const res = await production.createWorkOrder({
      project_line_id: l.id, item_name: "", uom: "", qty: job.qty, due_date: job.due, route: job.route,
    }, `jo:${l.id}:${job.qty}:${job.due}`);
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", "Job Order tidak dibuat", res.error.message); return; }
    toast("success", "Job Order dibuat", `${res.data.wo_no} · ${formatNumber(res.data.qty)} ${res.data.uom} · jatuh tempo ${res.data.due_date}`);
    setJobbing(null);
    onChanged();
  }

  async function save(lineId: string | null) {
    setBusy(true);
    const res = await procurement.saveProjectLine({
      project_code: p.code, line_id: lineId,
      product_code: d.product_code || null, description: d.description, qty: d.qty, uom: d.uom,
      unit_price: d.unit_price > 0 ? d.unit_price : null, delivery_date: d.delivery_date || null,
      note: d.note || null,
    });
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", "Tidak tersimpan", res.error.message); return; }
    toast("success", lineId ? "Item diperbarui" : "Item ditambahkan", `${d.description} · ${formatNumber(d.qty)} ${d.uom}`);
    setEditing(null);
    onChanged();
  }

  async function remove(l: ProjectLineView) {
    if (!window.confirm(`Hapus “${l.description}” dari pesanan?`)) return;
    setBusy(true);
    const res = await procurement.removeProjectLine({ project_code: p.code, line_id: l.id });
    setBusy(false);
    if (res.error) { toast("warning", "Tidak dihapus", res.error.message); return; }
    toast("success", "Item dihapus", l.description);
    onChanged();
  }

  async function makeCode(l: ProjectLineView) {
    setBusy(true);
    const res = await production.createProductFromOrderLine({
      project_code: p.code, line_id: l.id, product_code: newCode,
    });
    setBusy(false);
    if (res.error) { toast(res.error.status === 403 ? "critical" : "warning", "Item code tidak dibuat", res.error.message); return; }
    toast("success", res.data.existing ? "Ditautkan ke item code yang ada" : "Item code dibuat",
      `${res.data.product_code} — BOM-nya bisa disusun sekarang`);
    setCoding(null); setNewCode("");
    onChanged();
  }

  const known = products.status === "ready" ? products.data : [];
  const withCost = rows.filter((l) => l.product_production_cost != null);
  const costTotal = withCost.reduce((a, l) => a + (l.product_production_cost ?? 0) * l.qty, 0);

  const editRow = (lineId: string | null) => (
    <tr className="border-b border-slate-100 bg-brand-50/40 align-top">
      <td className="px-3 py-2">
        <input autoFocus value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })}
          placeholder="Barangnya — sesuai bahasa klien" aria-label="Deskripsi" className={cn(inputCls, "h-8")} />
        <input value={d.product_code} onChange={(e) => setD({ ...d, product_code: e.target.value.toUpperCase() })}
          list="order-products" placeholder="item code (opsional)" aria-label="Item code"
          className={cn(inputCls, "mt-1 h-7 font-mono text-[12px]")} />
        <input value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })}
          placeholder="catatan (opsional)" aria-label="Catatan" className={cn(inputCls, "mt-1 h-7 text-[12px]")} />
      </td>
      <td className="px-3 py-2">
        <div className="flex justify-end gap-1">
          <NumberInput size="sm" value={d.qty} min={0} max={999_999} step={0.01} onChange={(v) => setD({ ...d, qty: v })} className="!w-20" />
          <select value={d.uom} onChange={(e) => setD({ ...d, uom: e.target.value })} aria-label="Satuan"
            className="h-8 rounded-lg border border-slate-200 bg-white px-1 text-[12px]">
            <UomOptions current={d.uom} />
          </select>
        </div>
      </td>
      <td className="px-3 py-2">
        <div className="w-32"><MoneyInput size="sm" value={d.unit_price} onChange={(v) => setD({ ...d, unit_price: v })} /></div>
      </td>
      <td className="px-3 py-2">
        <input type="date" value={d.delivery_date} onChange={(e) => setD({ ...d, delivery_date: e.target.value })}
          aria-label="Tanggal kirim" className="h-8 rounded-lg border border-slate-200 px-1.5 text-[12px]" />
      </td>
      <td />
      <td className="whitespace-nowrap px-2 py-2 text-right">
        <button onClick={() => save(lineId)} disabled={busy || !d.description.trim() || d.qty <= 0}
          aria-label="Simpan" className="rounded p-1 text-emerald-700 hover:bg-emerald-50 disabled:opacity-40">
          <Check className="h-4 w-4" />
        </button>
        <button onClick={() => setEditing(null)} aria-label="Batal" className="rounded p-1 text-slate-400 hover:bg-slate-100">
          <X className="h-4 w-4" />
        </button>
      </td>
    </tr>
  );

  return (
    <div className="rounded-xl border border-slate-200">
      <datalist id="order-products">
        {known.map((x) => <option key={x.product_code} value={x.product_code}>{x.name}</option>)}
      </datalist>
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <Package className="h-4 w-4 text-slate-400" />
        <p className="text-[13px] font-semibold text-slate-800">Item dipesan</p>
        <span className="text-[12px] text-slate-400">
          {rows.length} baris
          {p.lines_without_item_code > 0 && ` · ${p.lines_without_item_code} belum punya item code`}
        </span>
        {mayEdit && editing === null && (
          <Button size="sm" icon={Plus} className="ml-auto" onClick={() => { setD(draftOf(null, p)); setEditing("new"); }}>
            Tambah item
          </Button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 text-left">Item</th>
              <th className="px-3 py-2 text-right">Jumlah</th>
              <th className="px-3 py-2 text-right">Harga jual / unit</th>
              <th className="px-3 py-2 text-left">Kirim</th>
              <th className="px-3 py-2 text-left">Item code &amp; BOM</th>
              {mayEdit && <th className="w-16" />}
            </tr>
          </thead>
          <tbody>
            {editing === "new" && editRow(null)}
            {rows.map((l) => editing === l.id ? <FragmentRow key={l.id}>{editRow(l.id)}</FragmentRow> : (
              <tr key={l.id} className="border-b border-slate-100 last:border-0 align-top">
                <td className="px-3 py-2">
                  <span className="block text-slate-800">{l.description}</span>
                  {l.note && <span className="block text-[11px] text-slate-400">{l.note}</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-700">
                  {formatNumber(l.qty)} {l.uom}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-700">
                  {l.unit_price == null ? <span className="text-slate-300">—</span> : formatIDR(l.unit_price)}
                  {l.unit_price != null && <span className="block text-[11px] text-slate-400">{formatIDR(l.unit_price * l.qty)}</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-600">{l.delivery_date ?? <span className="text-slate-300">—</span>}</td>
                <td className="px-3 py-2">
                  {l.product_code ? (
                    <>
                      <Link href={`/produksi/bom?open=${encodeURIComponent(l.product_code)}`}
                        className="inline-flex items-center gap-1 font-mono text-[12px] font-medium text-brand-700 hover:underline">
                        <ListTree className="h-3.5 w-3.5" />{l.product_code}
                      </Link>
                      <span className="block text-[11px] text-slate-500">
                        {!l.product_exists ? <span className="text-amber-700">belum ada di katalog produk</span>
                          : l.product_current_rev == null && l.product_draft_rev == null ? <span className="text-amber-700">belum ada BOM</span>
                            : l.product_production_cost == null ? <span className="text-amber-700">BOM belum lengkap</span>
                              : <>biaya {formatIDR(l.product_production_cost)} / {l.uom}{l.product_draft_rev != null && " · draft"}</>}
                      </span>
                      {l.job_order_count > 0 && (
                        <Link href={`/produksi/jadwal?project=${encodeURIComponent(p.code)}`}
                          className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-600 hover:underline">
                          <Hammer className="h-3 w-3" />
                          {l.job_order_count} Job Order · {formatNumber(l.job_order_qty)} unit · {formatNumber(l.job_order_completed)} selesai
                        </Link>
                      )}
                      {l.product_exists && can("production.create") && (jobbing === l.id ? (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <NumberInput size="sm" value={job.qty} min={0} max={999_999} step={1}
                            onChange={(v) => setJob({ ...job, qty: v })} className="!w-16" />
                          <input type="date" value={job.due} onChange={(e) => setJob({ ...job, due: e.target.value })}
                            aria-label="Jatuh tempo Job Order" className="h-8 rounded-lg border border-slate-200 px-1.5 text-[12px]" />
                          <select value={job.route} onChange={(e) => setJob({ ...job, route: e.target.value as "IN_HOUSE" | "SUBCON" })}
                            aria-label="Rute" className="h-8 rounded-lg border border-slate-200 bg-white px-1 text-[12px]">
                            <option value="IN_HOUSE">Bengkel sendiri</option>
                            <option value="SUBCON">Lewat vendor</option>
                          </select>
                          <Button size="sm" disabled={busy || job.qty <= 0 || !job.due} onClick={() => makeJob(l)}>Buat</Button>
                          <button onClick={() => setJobbing(null)} aria-label="Batal" className="rounded p-1 text-slate-400"><X className="h-4 w-4" /></button>
                        </div>
                      ) : l.job_order_qty < l.qty ? (
                        <Button size="sm" variant="outline" className="mt-1" disabled={busy} onClick={() => startJob(l)}>
                          {l.job_order_count > 0 ? `Job Order untuk sisa ${formatNumber(l.qty - l.job_order_qty)}` : "Buat Job Order"}
                        </Button>
                      ) : null)}
                    </>
                  ) : coding === l.id ? (
                    <div className="flex gap-1">
                      <input autoFocus value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                        list="order-products" placeholder="mis. SG-01A" aria-label="Item code baru"
                        className={cn(inputCls, "h-8 w-28 font-mono text-[12px]")} />
                      <Button size="sm" disabled={busy || !newCode.trim()} onClick={() => makeCode(l)}>OK</Button>
                      <button onClick={() => setCoding(null)} aria-label="Batal" className="rounded p-1 text-slate-400"><X className="h-4 w-4" /></button>
                    </div>
                  ) : can("production.create") ? (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => { setCoding(l.id); setNewCode(""); }}>
                      Jadikan item code
                    </Button>
                  ) : (
                    <span className="text-[11px] text-slate-400">belum ada item code</span>
                  )}
                </td>
                {mayEdit && (
                  <td className="whitespace-nowrap px-2 py-2 text-right">
                    <button onClick={() => { setD(draftOf(l, p)); setEditing(l.id); }} disabled={busy} aria-label="Ubah"
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => remove(l)} disabled={busy} aria-label="Hapus"
                      className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-3.5 w-3.5" /></button>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && editing !== "new" && (
              <tr><td colSpan={mayEdit ? 6 : 5} className="px-3 py-8 text-center text-[13px] text-slate-500">
                Belum ada item. Tambahkan apa saja yang dipesan klien — tiap baris nanti bisa dijadikan item code untuk BOM.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap justify-end gap-x-8 gap-y-1 border-t border-slate-100 px-4 py-2.5 text-[12px] text-slate-600">
        <span>
          Nilai pesanan{" "}
          <strong className="tabular-nums text-slate-800">{p.order_value == null ? "—" : formatIDR(p.order_value)}</strong>
          {p.unpriced_lines > 0 && <span className="text-amber-700"> · {p.unpriced_lines} tanpa harga</span>}
        </span>
        <span>
          Biaya produksi (dari BOM){" "}
          <strong className="tabular-nums text-slate-800">{withCost.length === 0 ? "—" : formatIDR(costTotal)}</strong>
          {withCost.length > 0 && withCost.length < rows.length && (
            <span className="text-amber-700"> · baru {withCost.length} dari {rows.length} item</span>
          )}
        </span>
      </div>
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
