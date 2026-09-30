"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { MonitorSmartphone, Plus, Pencil, Trash2, History, ShieldAlert, Wrench, Package, FileClock, Tags } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader, StatCard, type Tone } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Drawer, Modal } from "@/components/ui/drawer";
import { Loaded, SourceBadge, useDebounced, useLoad } from "@/components/ui/loaded";
import { MoneyInput } from "@/components/ui/money-input";
import { EvidenceStrip, type EvidenceSlot } from "@/components/ui/evidence-strip";
import { formatIDR } from "@/lib/format";
import { hr, inventory } from "@/demo/api";
import {
  ASSET_GONE, ASSET_OWNERSHIP_LABEL, ASSET_STATUS_LABEL, RENT_PERIOD_LABEL,
  type AssetInput, type AssetOwnership, type AssetStatus, type AssetView, type RentPeriod,
} from "@/services/inventory/contracts";
import { RentSchedule } from "./RentSchedule";
import { ServiceLog } from "./ServiceLog";
import type { AuditRow } from "@/demo/state";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";
import { useTr, type Message } from "@/lib/i18n";

/** The non-production asset register (`0107`): what the company owns and
 *  uses rather than sells or builds from — CCTV, PCs, vehicles, tools.
 *
 *  Each asset has a tag (`AST-0001`) for a sticker on the thing itself, a
 *  category, where it is, who holds it, and a status. What it cost and the
 *  ledger row that paid for it are optional. Photos, the purchase nota and
 *  the warranty card are attached from the drawer, and every change is in the
 *  asset's history.
 *
 *  Not everything used is owned (`0116`): a rented generator or a leased car
 *  carries its rent and contract dates, is flagged as the contract runs out,
 *  ends by being *returned*, and accounting can put its rent on the payment
 *  calendar from here.
 */
const inputClass =
  "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none";

const STATUS_TONE: Record<AssetStatus, Tone> = {
  in_use: "green", in_storage: "slate", under_repair: "amber", disposed: "slate", lost: "red", returned: "slate",
};

const OWNERSHIP_TONE: Record<AssetOwnership, Tone> = { owned: "slate", rented: "brand", leased: "violet", borrowed: "amber" };

const SLOTS: (Omit<EvidenceSlot, "label"> & { label: Message })[] = [
  { kind: "Foto", label: { en: "Photo", id: "Foto" } },
  { kind: "Receipt / Invoice / Nota", label: { en: "Purchase nota / invoice", id: "Nota pembelian / invoice" }, optional: true },
  { kind: "Sertifikat", label: { en: "Warranty card", id: "Kartu garansi" }, optional: true },
];

type Form = {
  mode: "create" | "edit"; asset_no: string;
  name: string; category_code: string; brand: string; model: string; identifier: string;
  location: string; holder: string; acquired_on: string; purchase_cost: number;
  vendor_code: string; trx_no: string; warranty_until: string; notes: string;
  ownership: AssetOwnership; rent_amount: number; rent_period: "" | RentPeriod; rent_due_day: string;
  contract_start: string; contract_end: string;
};

const emptyForm: Form = {
  mode: "create", asset_no: "", name: "", category_code: "", brand: "", model: "", identifier: "",
  location: "", holder: "", acquired_on: "", purchase_cost: 0, vendor_code: "", trx_no: "",
  warranty_until: "", notes: "",
  ownership: "owned", rent_amount: 0, rent_period: "", rent_due_day: "", contract_start: "", contract_end: "",
};

export default function AssetsPage() {
  const tr = useTr();
  const { can } = useSession();
  const { toast } = useToast();
  const mayCreate = can("inventory.create");
  const mayEdit = can("inventory.update");

  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<"" | AssetStatus>("");
  const [showGone, setShowGone] = useState(false);
  const searched = useDebounced(q);
  const [state, reload] = useLoad(() => inventory.listAssets({
    q: searched || undefined, category: category || undefined,
    status: status || undefined, include_gone: showGone,
  }), [searched, category, status, showGone], { keepPrevious: true });
  const [cats] = useLoad(() => inventory.listAssetCategories(), []);
  /* An asset's location is a location (`0197`): picked from the same list the
     racks use, and shown by its name. Retired ones too, so an asset still
     standing in one reads by name. */
  const [locs] = useLoad(() => inventory.listStockLocations({ all: true }), []);
  const locName = (code: string | null) =>
    code == null ? null : (locs.status === "ready" ? locs.data.find((l) => l.code === code)?.name : undefined) ?? code;
  const catList = cats.status === "ready" ? cats.data : [];

  const [selected, setSelected] = useState<AssetView | null>(null);
  /* `?asset=AST-0001`: where a label's QR lands (D321), opened on the asset. */
  const params = useSearchParams();
  const linked = params.get("asset");
  useEffect(() => {
    if (!linked) return;
    let live = true;
    void inventory.getAsset(linked).then((r) => { if (live && r.data) setSelected(r.data); });
    return () => { live = false; };
  }, [linked]);
  const [history, setHistory] = useState<AuditRow[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [statusForm, setStatusForm] = useState<{ status: AssetStatus; note: string } | null>(null);
  const [saving, setSaving] = useState(false);
  /* HR's active employees, offered as holders once a form opens. A reader
     without HR access simply gets no suggestions. */
  const [people, setPeople] = useState<{ value: string; label: string }[]>([]);
  const formOpen = !!form;
  useEffect(() => {
    if (!formOpen || people.length > 0) return;
    let live = true;
    void hr.listEmployees().then((r) => {
      if (live && r.data) setPeople(r.data.map((e) => ({ value: e.full_name, label: `${e.employee_no} · ${e.position}` })));
    });
    return () => { live = false; };
  }, [formOpen, people.length]);

  useEffect(() => {
    if (!selected) { setHistory([]); return; }
    let live = true;
    void inventory.assetHistory(selected.asset_no).then((r) => { if (live) setHistory(r.data ?? []); });
    return () => { live = false; };
  }, [selected]);

  async function refreshSelected(no: string) {
    const r = await inventory.getAsset(no);
    if (r.data) setSelected(r.data);
    reload();
  }

  function openEdit(a: AssetView) {
    setForm({
      mode: "edit", asset_no: a.asset_no, name: a.name, category_code: a.category_code,
      brand: a.brand ?? "", model: a.model ?? "", identifier: a.identifier ?? "",
      location: a.location ?? "", holder: a.holder ?? "", acquired_on: a.acquired_on ?? "",
      purchase_cost: a.purchase_cost ?? 0, vendor_code: a.vendor_code ?? "", trx_no: a.trx_no ?? "",
      warranty_until: a.warranty_until ?? "", notes: a.notes ?? "",
      ownership: a.ownership, rent_amount: a.rent_amount ?? 0, rent_period: a.rent_period ?? "",
      rent_due_day: a.rent_due_day != null ? String(a.rent_due_day) : "",
      contract_start: a.contract_start ?? "", contract_end: a.contract_end ?? "",
    });
  }

  async function save() {
    if (!form) return;
    const input: AssetInput = {
      name: form.name, category_code: form.category_code, brand: form.brand, model: form.model,
      identifier: form.identifier, location: form.location, holder: form.holder,
      acquired_on: form.acquired_on || null, purchase_cost: form.purchase_cost > 0 ? form.purchase_cost : null,
      vendor_code: form.vendor_code, trx_no: form.trx_no,
      warranty_until: form.warranty_until || null, notes: form.notes,
      /* An owned thing carries no rent or contract; switching to owned clears
         them, which the seam would otherwise refuse (`rent_on_owned`). */
      ownership: form.ownership,
      ...(form.ownership === "owned"
        ? { rent_amount: null, rent_period: null, rent_due_day: null, contract_start: null, contract_end: null }
        : {
            rent_amount: form.rent_amount > 0 ? form.rent_amount : null,
            rent_period: form.rent_period || null,
            rent_due_day: form.rent_period === "monthly" && form.rent_due_day ? Number(form.rent_due_day) : null,
            contract_start: form.contract_start || null,
            contract_end: form.contract_end || null,
          }),
    };
    setSaving(true);
    const res = form.mode === "create"
      ? await inventory.createAsset({ ...input, name: form.name, category_code: form.category_code }, `asset-${form.name}-${Date.now()}`)
      : await inventory.updateAsset(form.asset_no, input);
    setSaving(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not saved", "Tidak tersimpan"), res.error.message);
      return;
    }
    toast("success", form.mode === "create" ? tr("Asset registered", "Aset terdaftar") : tr("Asset saved", "Aset tersimpan"), `${res.data.asset_no} — ${res.data.name}`);
    setForm(null);
    if (form.mode === "edit") void refreshSelected(res.data.asset_no); else reload();
  }

  async function changeStatus() {
    if (!selected || !statusForm) return;
    setSaving(true);
    const res = await inventory.setAssetStatus(selected.asset_no, statusForm.status, statusForm.note || undefined);
    setSaving(false);
    if (res.error) { toast("warning", tr("Not changed", "Tidak berubah"), res.error.message); return; }
    toast("success", tr("Status changed", "Status diubah"), tr(`${res.data.asset_no} is now ${ASSET_STATUS_LABEL[res.data.status].toLowerCase()}.`, `${res.data.asset_no} sekarang ${ASSET_STATUS_LABEL[res.data.status].toLowerCase()}.`));
    setStatusForm(null);
    void refreshSelected(res.data.asset_no);
  }

  async function remove() {
    if (!selected) return;
    setSaving(true);
    const res = await inventory.deleteAsset(selected.asset_no);
    setSaving(false);
    if (res.error) { toast("warning", tr("Not deleted", "Tidak terhapus"), res.error.message); return; }
    toast("success", tr("Deleted", "Terhapus"), tr(`${selected.asset_no} was removed as a mistaken entry.`, `${selected.asset_no} dihapus sebagai entri yang keliru.`));
    setForm(null);
    setSelected(null);
    reload();
  }

  const columns: Column<AssetView>[] = [
    {
      key: "tag",
      header: tr("Asset", "Aset"),
      render: (a) => (
        <div>
          <p className="font-medium text-slate-800">
            {a.name}
            {a.ownership !== "owned" && (
              <Badge tone={OWNERSHIP_TONE[a.ownership]} className="ml-1.5">{ASSET_OWNERSHIP_LABEL[a.ownership].toLowerCase()}</Badge>
            )}
          </p>
          <p className="font-mono text-[11px] text-slate-400">
            {a.asset_no}{a.identifier ? ` · ${a.identifier}` : ""}
          </p>
        </div>
      ),
    },
    { key: "cat", header: tr("Category", "Kategori"), render: (a) => <span className="text-slate-600">{a.category_name}</span> },
    {
      key: "where",
      header: tr("Location / holder", "Lokasi / pemegang"),
      render: (a) => (
        <div className="text-[13px]">
          <p className="text-slate-700">{locName(a.location) ?? "—"}</p>
          {a.holder && <p className="text-[11px] text-slate-500">{a.holder}</p>}
        </div>
      ),
    },
    {
      key: "status",
      header: tr("Status", "Status"),
      render: (a) => (
        <span className="flex flex-wrap items-center gap-1">
          <Badge tone={STATUS_TONE[a.status]} dot>{ASSET_STATUS_LABEL[a.status]}</Badge>
          {a.warranty_expired && <Badge tone="amber">{tr("warranty expired", "garansi habis")}</Badge>}
          {a.contract_ending && <Badge tone="amber">{tr("contract ends", "kontrak berakhir")} {a.contract_end}</Badge>}
          {a.contract_expired && <Badge tone="red">{tr("contract ended", "kontrak sudah berakhir")} {a.contract_end}</Badge>}
          {a.service_due && <Badge tone="amber">{tr("service due", "jatuh tempo servis")} {a.next_service_due}</Badge>}
        </span>
      ),
    },
    {
      key: "cost",
      header: tr("Cost / rent", "Biaya / sewa"),
      align: "right",
      render: (a) => a.purchase_cost != null
        ? <span className="tabular-nums text-slate-700">{formatIDR(a.purchase_cost)}</span>
        : a.rent_amount != null && a.rent_period
          ? (
            <span className="tabular-nums text-slate-700">
              {formatIDR(a.rent_amount)}
              <span className="block text-[10px] text-slate-400">{RENT_PERIOD_LABEL[a.rent_period]}</span>
            </span>
          )
          : <span className="text-slate-300">&mdash;</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Inventory", "Persediaan")}
        title={tr("Assets", "Aset")}
        description={tr("What the company owns and uses rather than sells: CCTV, PCs, vehicles, tools. Each has a tag for a sticker on the thing itself.", "Apa yang dimiliki dan dipakai perusahaan, bukan dijual: CCTV, PC, kendaraan, perkakas. Masing-masing punya tag untuk stiker di barangnya sendiri.")}
        actions={
          <div className="flex items-center gap-2">
            <Link href="/inventory/label?kind=asset">
              <Button variant="secondary" icon={Tags}>{tr("Print labels", "Cetak label")}</Button>
            </Link>
            {mayCreate && (
              <Button icon={Plus} onClick={() => setForm({ ...emptyForm, category_code: catList.find((c) => c.is_active)?.code ?? "" })}>
                {tr("Register asset", "Daftarkan aset")}
              </Button>
            )}
          </div>
        }
      />

      <Loaded state={state} onRetry={reload}>
        {(rows) => {
          const inUse = rows.filter((a) => a.status === "in_use").length;
          const repair = rows.filter((a) => a.status === "under_repair").length;
          const expired = rows.filter((a) => a.warranty_expired).length;
          const cost = rows.reduce((s, a) => s + (a.purchase_cost ?? 0), 0);
          const notOwned = rows.filter((a) => a.ownership !== "owned");
          const contractFlags = rows.filter((a) => a.contract_ending || a.contract_expired).length;
          return (
            <>
              <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <StatCard label={tr("Assets shown", "Aset ditampilkan")} value={rows.length} icon={Package} hint={tr(`${inUse} in use`, `${inUse} dipakai`)} />
                <StatCard label={tr("Under repair", "Sedang diperbaiki")} value={repair} icon={Wrench} tone="amber" hint={tr("Out of action right now", "Tidak bisa dipakai saat ini")} />
                <StatCard label={tr("Warranty expired", "Garansi habis")} value={expired} icon={ShieldAlert} tone="violet" hint={tr("Still in service", "Masih dipakai")} />
                <StatCard label={tr("Rented, leased, borrowed", "Disewa, leasing, dipinjam")} value={notOwned.length} icon={FileClock} tone="brand"
                  hint={contractFlags > 0
                    ? tr(`${contractFlags} contract${contractFlags === 1 ? "" : "s"} ending or ended`, `${contractFlags} kontrak akan atau sudah berakhir`)
                    : tr("No contract running out", "Tidak ada kontrak yang akan habis")} />
                <StatCard label={tr("Recorded cost", "Biaya tercatat")} value={formatIDR(cost)} icon={MonitorSmartphone} hint={tr("Owned assets shown", "Aset milik yang ditampilkan")} />
              </div>

              <Card>
                <CardHeader
                  title={tr("Register", "Daftar")}
                  subtitle={tr("Click an asset for its documents, status and history.", "Klik satu aset untuk dokumen, status, dan riwayatnya.")}
                  icon={MonitorSmartphone}
                  action={
                    <div className="flex flex-wrap items-center gap-2">
                      <SourceBadge state={state} />
                      <select
                        id="asset-cat" aria-label={tr("Category", "Kategori")} value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none"
                      >
                        <option value="">{tr("All categories", "Semua kategori")}</option>
                        {catList.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                      </select>
                      <select
                        id="asset-status" aria-label={tr("Status", "Status")} value={status}
                        onChange={(e) => setStatus(e.target.value as "" | AssetStatus)}
                        className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none"
                      >
                        <option value="">{tr("Any status", "Semua status")}</option>
                        {(Object.keys(ASSET_STATUS_LABEL) as AssetStatus[]).map((s) => (
                          <option key={s} value={s}>{ASSET_STATUS_LABEL[s]}</option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1.5 text-[13px] text-slate-600">
                        <input id="asset-gone" type="checkbox" checked={showGone} onChange={(e) => setShowGone(e.target.checked)} />
                        {tr("Show disposed, lost & returned", "Tampilkan yang dilepas, hilang & dikembalikan")}
                      </label>
                      <input
                        id="asset-search" value={q} onChange={(e) => setQ(e.target.value)}
                        placeholder={tr("Tag, name, serial, plate…", "Tag, nama, serial, pelat…")}
                        className="h-9 w-48 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none"
                      />
                    </div>
                  }
                />
                <DataTable
                  columns={columns} rows={rows} rowKey={(a) => a.id} onRowClick={setSelected} dense
                  empty={q || category || status ? tr("Nothing matches those filters.", "Tidak ada yang cocok dengan filter itu.") : tr("No assets registered yet.", "Belum ada aset terdaftar.")}
                />
              </Card>
            </>
          );
        }}
      </Loaded>

      <Drawer
        open={!!selected}
        onClose={() => { setSelected(null); setStatusForm(null); }}
        title={selected?.name ?? ""}
        subtitle={selected ? `${selected.asset_no} · ${selected.category_name}` : undefined}
        width="max-w-xl"
        footer={selected && mayEdit ? (
          <div className="flex flex-wrap justify-end gap-2">
            <select
              id="asset-new-status" aria-label={tr("Change status", "Ubah status")}
              value=""
              onChange={(e) => e.target.value && setStatusForm({ status: e.target.value as AssetStatus, note: "" })}
              className="mr-auto h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
            >
              <option value="">{tr("Change status…", "Ubah status…")}</option>
              {(Object.keys(ASSET_STATUS_LABEL) as AssetStatus[])
                .filter((s) => s !== selected.status && (s !== "returned" || selected.ownership !== "owned"))
                .map((s) => (
                <option key={s} value={s}>{ASSET_STATUS_LABEL[s]}</option>
              ))}
            </select>
            <Button size="sm" variant="outline" icon={Pencil} onClick={() => openEdit(selected)}>{tr("Edit", "Ubah")}</Button>
          </div>
        ) : null}
      >
        {selected && (
          <div className="space-y-5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[selected.status]} dot>{ASSET_STATUS_LABEL[selected.status]}</Badge>
              {selected.ownership !== "owned" && (
                <Badge tone={OWNERSHIP_TONE[selected.ownership]}>{ASSET_OWNERSHIP_LABEL[selected.ownership]}</Badge>
              )}
              {selected.warranty_expired && <Badge tone="amber">{tr("warranty expired", "garansi habis")}</Badge>}
              {selected.contract_ending && <Badge tone="amber">{tr("contract ends", "kontrak berakhir")} {selected.contract_end}</Badge>}
              {selected.contract_expired && <Badge tone="red">{tr(`contract ended ${selected.contract_end} — still here`, `kontrak sudah berakhir ${selected.contract_end} — masih di sini`)}</Badge>}
              {selected.ended_on && <Badge tone="slate">{tr("since", "sejak")} {selected.ended_on}</Badge>}
            </div>

            {statusForm && (
              <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                <p className="text-[13px] font-medium text-slate-800">
                  {tr("Mark as", "Tandai sebagai")} {ASSET_STATUS_LABEL[statusForm.status].toLowerCase()}
                </p>
                <label htmlFor="asset-status-note" className="block text-xs text-slate-600">
                  {tr("Note", "Catatan")} {statusForm.status === "disposed" || statusForm.status === "lost"
                    ? <span className="text-rose-700">{tr("— required: how it left", "— wajib: bagaimana barangnya keluar")}</span> : tr("(optional)", "(opsional)")}
                </label>
                <input
                  id="asset-status-note" value={statusForm.note}
                  onChange={(e) => setStatusForm({ ...statusForm, note: e.target.value })}
                  placeholder={statusForm.status === "under_repair" ? tr("e.g. sent to the service centre", "mis. dikirim ke service centre")
                    : statusForm.status === "returned" ? tr("e.g. picked up by the lessor", "mis. diambil oleh pihak yang menyewakan") : tr("e.g. sold to staff, scrapped, stolen", "mis. dijual ke staf, dibuang, dicuri")}
                  className={inputClass}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setStatusForm(null)}>{tr("Cancel", "Batal")}</Button>
                  <Button
                    size="sm" onClick={changeStatus}
                    disabled={saving || ((statusForm.status === "disposed" || statusForm.status === "lost") && !statusForm.note.trim())}
                  >
                    {tr("Save status", "Simpan status")}
                  </Button>
                </div>
              </div>
            )}

            <dl className="space-y-2.5">
              {([
                [tr("Brand / model", "Merek / model"), [selected.brand, selected.model].filter(Boolean).join(" ") || "—"],
                [tr("Serial / plate", "Serial / pelat"), selected.identifier ?? "—"],
                [tr("Location", "Lokasi"), locName(selected.location) ?? "—"],
                [tr("Held by", "Dipegang oleh"), selected.holder ?? "—"],
                ...(selected.ownership === "owned" ? [
                  [tr("Acquired", "Diperoleh"), selected.acquired_on ?? "—"],
                  [tr("Cost", "Biaya"), selected.purchase_cost != null ? formatIDR(selected.purchase_cost) : "—"],
                  [tr("Supplier", "Pemasok"), selected.vendor_name ?? selected.vendor_code ?? "—"],
                ] : [
                  [tr("Ownership", "Kepemilikan"), ASSET_OWNERSHIP_LABEL[selected.ownership]],
                  [selected.ownership === "borrowed" ? tr("Lent by", "Dipinjamkan oleh") : tr("Lessor", "Pihak yang menyewakan"), selected.vendor_name ?? selected.vendor_code ?? "—"],
                  [tr("Rent", "Sewa"), selected.rent_amount != null && selected.rent_period
                    ? `${formatIDR(selected.rent_amount)} ${RENT_PERIOD_LABEL[selected.rent_period]}${selected.rent_period === "monthly" && selected.rent_due_day ? tr(`, day ${selected.rent_due_day}`, `, tanggal ${selected.rent_due_day}`) : ""}`
                    : "—"],
                  [tr("Contract", "Kontrak"), selected.contract_start || selected.contract_end
                    ? `${selected.contract_start ?? "?"} → ${selected.contract_end ?? tr("open-ended", "tanpa batas")}` : "—"],
                ]),
                [tr("Ledger row", "Baris buku besar"), selected.trx_no ?? "—"],
                [tr("Warranty until", "Garansi sampai"), selected.warranty_until ?? "—"],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-slate-100 pb-2">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="text-right font-medium text-slate-800">
                    {k === tr("Ledger row", "Baris buku besar") && selected.trx_no ? (
                      <a href={`/accounting/ledger?trx=${encodeURIComponent(selected.trx_no)}`} className="font-mono text-brand-700 hover:underline">{v}</a>
                    ) : v}
                  </dd>
                </div>
              ))}
            </dl>
            {selected.notes && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-[13px] text-slate-600">{selected.notes}</p>
            )}

            {selected.ownership !== "owned" && (
              <RentSchedule asset={selected} onDone={() => void refreshSelected(selected.asset_no)} />
            )}

            <ServiceLog asset={selected} canEdit={mayEdit} onChanged={() => void refreshSelected(selected.asset_no)} />

            <EvidenceStrip
              entity="asset"
              entityNo={selected.asset_no}
              canEdit={mayEdit}
              defaultKind="Foto"
              slots={SLOTS.map((s) => ({ ...s, label: tr(s.label.en, s.label.id) }))}
              onChanged={() => void refreshSelected(selected.asset_no)}
              note={tr("Attached to this asset — a photo of the thing, its purchase nota, its warranty card.", "Terlampir pada aset ini — foto barangnya, nota pembeliannya, kartu garansinya.")}
            />

            <section>
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <History className="h-3.5 w-3.5" /> {tr("History", "Riwayat")}
              </p>
              {history.length === 0 ? (
                <p className="text-[13px] text-slate-500">{tr("Nothing recorded yet.", "Belum ada yang tercatat.")}</p>
              ) : (
                <ol className="space-y-2">
                  {history.map((h) => (
                    <li key={h.id} className="rounded-lg border border-slate-200 px-3 py-2 text-[12px]">
                      <p className="text-slate-700">
                        <span className="font-medium">{h.action}</span>
                        <span className="text-slate-400"> · {h.actor_email} · {new Date(h.at).toLocaleString()}</span>
                      </p>
                      {h.reason && <p className="mt-0.5 text-slate-600">{h.reason}</p>}
                      {h.detail && (
                        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-500">
                          {Object.entries(h.detail).map(([k, v]) => (
                            <li key={k}>
                              <span className="text-slate-400">{k}:</span>{" "}
                              {typeof v === "object" && v !== null
                                ? Object.values(v as Record<string, unknown>).map((x) => (x == null ? "—" : String(x))).join(" → ")
                                : String(v)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        )}
      </Drawer>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.mode === "create" ? tr("Register asset", "Daftarkan aset") : tr(`Edit ${form?.asset_no ?? ""}`, `Ubah ${form?.asset_no ?? ""}`)}>
        {form && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label htmlFor="as-name" className="block text-sm text-slate-600">{tr("Name", "Nama")}</label>
                <input id="as-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={tr("e.g. Camera — workshop gate", "mis. Kamera — gerbang workshop")} className={inputClass} />
              </div>
              <div>
                <label htmlFor="as-cat" className="block text-sm text-slate-600">{tr("Category", "Kategori")}</label>
                <select id="as-cat" value={form.category_code} onChange={(e) => setForm({ ...form, category_code: e.target.value })}
                  className={inputClass + " bg-white"}>
                  <option value="">{tr("Pick…", "Pilih…")}</option>
                  {catList.filter((c) => c.is_active || c.code === form.category_code).map((c) => (
                    <option key={c.code} value={c.code}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="as-own" className="block text-sm text-slate-600">{tr("Ownership", "Kepemilikan")}</label>
                <select id="as-own" value={form.ownership}
                  onChange={(e) => setForm({ ...form, ownership: e.target.value as AssetOwnership })}
                  className={inputClass + " bg-white"}>
                  {(Object.keys(ASSET_OWNERSHIP_LABEL) as AssetOwnership[]).map((o) => (
                    <option key={o} value={o}>{ASSET_OWNERSHIP_LABEL[o]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="as-ident" className="block text-sm text-slate-600">{tr("Serial no. / plate", "No. serial / pelat")}</label>
                <input id="as-ident" value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })}
                  placeholder={tr("e.g. DK 8123 ZA", "mis. DK 8123 ZA")} className={inputClass} />
              </div>
              <div>
                <label htmlFor="as-brand" className="block text-sm text-slate-600">{tr("Brand", "Merek")}</label>
                <input id="as-brand" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label htmlFor="as-model" className="block text-sm text-slate-600">{tr("Model", "Model")}</label>
                <input id="as-model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label htmlFor="as-loc" className="block text-sm text-slate-600">{tr("Location", "Lokasi")}</label>
                <select id="as-loc" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })}
                  className={inputClass}>
                  <option value="">{tr("— not set —", "— belum diisi —")}</option>
                  {(locs.status === "ready" ? locs.data : [])
                    .filter((l) => l.is_active || l.code === form.location)
                    .map((l) => <option key={l.code} value={l.code}>{l.name}{l.is_active ? "" : tr(" (inactive)", " (nonaktif)")}</option>)}
                  {/* A place no longer on the list still shows, rather than
                      reading as blank and being cleared on save. */}
                  {form.location && locs.status === "ready" && !locs.data.some((l) => l.code === form.location) && (
                    <option value={form.location}>{form.location}</option>
                  )}
                </select>
                <p className="mt-1 text-[11px] text-slate-500">
                  {tr("Not on the list? ", "Tidak ada di daftar? ")}
                  <Link href="/inventory/penyesuaian" className="text-brand-700 hover:underline">
                    {tr("Add it under Manage locations", "Tambahkan di Kelola lokasi")}
                  </Link>
                </p>
              </div>
              <div>
                <label htmlFor="as-holder" className="block text-sm text-slate-600">{tr("Held by", "Dipegang oleh")}</label>
                <input id="as-holder" value={form.holder} onChange={(e) => setForm({ ...form, holder: e.target.value })}
                  list="asset-holders" placeholder={tr("e.g. Made (driver)", "mis. Made (sopir)")} className={inputClass} />
                {/* Suggestions from HR's list; the field stays free text,
                    because the driver of a rented pickup may not be on it. */}
                <datalist id="asset-holders">
                  {people.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </datalist>
              </div>
              {form.ownership !== "owned" && (
                <fieldset className="col-span-2 grid grid-cols-2 gap-3 rounded-lg border border-sky-100 bg-sky-50/40 px-3 py-3">
                  <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-sky-800">{tr("Rent & contract", "Sewa & kontrak")}</legend>
                  <div>
                    <label htmlFor="as-rent" className="block text-sm text-slate-600">
                      {tr("Rent", "Sewa")} {form.ownership === "borrowed" && <span className="text-slate-400">{tr("(if any)", "(jika ada)")}</span>}
                    </label>
                    <MoneyInput id="as-rent" value={form.rent_amount} onChange={(v) => setForm({ ...form, rent_amount: v })} className="mt-1" />
                  </div>
                  <div>
                    <label htmlFor="as-period" className="block text-sm text-slate-600">{tr("Paid", "Dibayar")}</label>
                    <select id="as-period" value={form.rent_period}
                      onChange={(e) => setForm({ ...form, rent_period: e.target.value as "" | RentPeriod })}
                      className={inputClass + " bg-white"}>
                      <option value="">—</option>
                      {(Object.keys(RENT_PERIOD_LABEL) as RentPeriod[]).map((p) => (
                        <option key={p} value={p}>{RENT_PERIOD_LABEL[p]}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="as-cstart" className="block text-sm text-slate-600">{tr("Contract start", "Awal kontrak")}</label>
                    <input id="as-cstart" type="date" value={form.contract_start}
                      onChange={(e) => setForm({ ...form, contract_start: e.target.value })} className={inputClass} />
                  </div>
                  <div>
                    <label htmlFor="as-cend" className="block text-sm text-slate-600">{tr("Contract end", "Akhir kontrak")}</label>
                    <input id="as-cend" type="date" value={form.contract_end}
                      onChange={(e) => setForm({ ...form, contract_end: e.target.value })} className={inputClass} />
                  </div>
                  {form.rent_period === "monthly" && (
                    <div>
                      <label htmlFor="as-dueday" className="block text-sm text-slate-600">{tr("Due on day", "Jatuh tempo tanggal")}</label>
                      <input id="as-dueday" type="number" min={1} max={31} value={form.rent_due_day}
                        onChange={(e) => setForm({ ...form, rent_due_day: e.target.value })}
                        placeholder={tr("contract start day", "tanggal awal kontrak")} className={inputClass} />
                    </div>
                  )}
                  <p className="col-span-2 text-[11px] text-slate-500">
                    {tr("The supplier code below is the lessor. Accounting puts the rent on the payment calendar from the asset.", "Kode pemasok di bawah adalah pihak yang menyewakan. Accounting memasukkan sewanya ke kalender pembayaran dari aset ini.")}
                  </p>
                </fieldset>
              )}
              <div>
                <label htmlFor="as-acq" className="block text-sm text-slate-600">
                  {form.ownership === "owned" ? tr("Acquired on", "Diperoleh pada") : tr("Arrived on", "Tiba pada")}
                </label>
                <input id="as-acq" type="date" value={form.acquired_on} onChange={(e) => setForm({ ...form, acquired_on: e.target.value })} className={inputClass} />
              </div>
              {form.ownership === "owned" && (
                <div>
                  <label htmlFor="as-cost" className="block text-sm text-slate-600">{tr("Purchase cost", "Harga beli")}</label>
                  <MoneyInput id="as-cost" value={form.purchase_cost} onChange={(v) => setForm({ ...form, purchase_cost: v })} className="mt-1" />
                </div>
              )}
              <div>
                <label htmlFor="as-vendor" className="block text-sm text-slate-600">
                  {form.ownership === "owned" ? tr("Supplier code", "Kode pemasok") : form.ownership === "borrowed" ? tr("Lent by (supplier code)", "Dipinjamkan oleh (kode pemasok)") : tr("Lessor (supplier code)", "Pihak yang menyewakan (kode pemasok)")}
                </label>
                <input id="as-vendor" value={form.vendor_code} onChange={(e) => setForm({ ...form, vendor_code: e.target.value })}
                  placeholder={tr("optional", "opsional")} className={inputClass + " font-mono"} />
              </div>
              <div>
                <label htmlFor="as-trx" className="block text-sm text-slate-600">{tr("Ledger row", "Baris buku besar")}</label>
                <input id="as-trx" value={form.trx_no} onChange={(e) => setForm({ ...form, trx_no: e.target.value })}
                  placeholder={tr("trx-… (optional)", "trx-… (opsional)")} className={inputClass + " font-mono"} />
              </div>
              <div>
                <label htmlFor="as-warranty" className="block text-sm text-slate-600">{tr("Warranty until", "Garansi sampai")}</label>
                <input id="as-warranty" type="date" value={form.warranty_until} onChange={(e) => setForm({ ...form, warranty_until: e.target.value })} className={inputClass} />
              </div>
              <div className="col-span-2">
                <label htmlFor="as-notes" className="block text-sm text-slate-600">{tr("Notes", "Catatan")}</label>
                <textarea id="as-notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputClass} />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              {form.mode === "edit" && mayEdit && (
                <Button variant="ghost" icon={Trash2} className="mr-auto text-rose-700" disabled={saving} onClick={remove}>
                  {tr("Delete", "Hapus")}
                </Button>
              )}
              <Button variant="outline" onClick={() => setForm(null)}>{tr("Cancel", "Batal")}</Button>
              <Button onClick={save} disabled={saving || !form.name.trim() || !form.category_code}>
                {saving ? tr("Saving…", "Menyimpan…") : tr("Save", "Simpan")}
              </Button>
            </div>
            {form.mode === "edit" && (
              <p className="text-[11px] text-slate-500">
                {tr("Delete is only for an entry made by mistake. An asset that left is marked disposed, lost or returned, so its record stays.", "Hapus hanya untuk entri yang dibuat keliru. Aset yang sudah keluar ditandai dilepas, hilang, atau dikembalikan, supaya catatannya tetap ada.")}
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
