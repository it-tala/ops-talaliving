"use client";

import { useEffect, useRef, useState } from "react";
import {
  Truck, Plus, Check, Merge, Search, UserRound, Phone, MapPin, Landmark, Boxes, Pencil, Save,
  Archive, ArchiveRestore, Trash2, Type,
} from "lucide-react";
import {
  Badge, Button, Card, CardHeader, PageHeader, StatCard,
} from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Drawer, Modal } from "@/components/ui/drawer";
import { Loaded, SourceBadge, useDebounced, useLoad } from "@/components/ui/loaded";
import { formatIDR, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";
import { procurement } from "@/demo/api";
import { VENDOR_KINDS, type VendorKind, type VendorView } from "@/services/procurement/contracts";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";
import { useLang, useTr } from "@/lib/i18n";

/** Vendors.
 *
 *  The rule this screen exists to make visible: **a vendor name a person types
 *  is always accepted, and is born uncurated.** Uncurated does not mean
 *  rejected and does not mean hidden — it means recorded, shown, marked, and
 *  kept out of dropdowns until somebody says it is the real name. Auto-curating
 *  would feed every spelling variant into the catalogue as if it were canonical.
 */
interface VendorDraft {
  pic_name: string;
  pic_phone: string;
  phone: string;
  address: string;
  bank_account: string;
  bank_account_secondary: string;
  npwp: string;
  supplied_categories: string[];
}

const emptyDraft: VendorDraft = {
  pic_name: "", pic_phone: "", phone: "", address: "",
  bank_account: "", bank_account_secondary: "", npwp: "", supplied_categories: [],
};

function Field({
  id, label, value, onChange, placeholder, mono,
}: {
  id: string; label: string; value: string;
  onChange: (v: string) => void; placeholder?: string; mono?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-slate-500">{label}</label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none",
          mono && "font-mono text-[13px]",
        )}
      />
    </div>
  );
}

export default function SuppliersPage() {
  const tr = useTr();
  const { can } = useSession();
  const { toast } = useToast();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<VendorView | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [merging, setMerging] = useState<VendorView | null>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<VendorDraft>(emptyDraft);
  const [showArchived, setShowArchived] = useState(false);
  const [renaming, setRenaming] = useState<VendorView | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [deleting, setDeleting] = useState<VendorView | null>(null);
  /* Supplier, partner factory, outsourced QC (0256, O2). */
  const [kindFilter, setKindFilter] = useState<VendorKind | "all">("all");
  const lang = useLang();
  const kindLabel = (k: VendorKind) => {
    const x = VENDOR_KINDS.find((v) => v.code === k)!;
    return lang === "id" ? x.label_id : x.label;
  };

  const searched = useDebounced(q);
  const [state, reload] = useLoad(
    () => procurement.listVendorViews({ q: searched, include_archived: showArchived }),
    [searched, showArchived],
    { keepPrevious: true },
  );
  const [cats] = useLoad(() => procurement.listCategories(), []);

  /* The list leaves out `items_bought` and `absorbed`: each costs a subquery
     per row over the purchase history, and no row in the table draws them.
     With 296 vendors that was a statement timeout, so the drawer opens
     immediately on what the list already has and the history arrives a moment
     later — which is also the only place either field is read.

     Keyed by id in a ref rather than by "is it empty": a vendor we have never
     bought from has an empty history legitimately, and testing the field would
     refetch it on every render. */
  const detailFor = useRef<string | null>(null);
  useEffect(() => {
    const id = selected?.id;
    if (!id || detailFor.current === id) return;
    detailFor.current = id;
    let live = true;
    void procurement.getVendor(id).then((res) => {
      if (live && res.data) setSelected((cur) => (cur?.id === id ? res.data : cur));
    });
    return () => { live = false; };
  }, [selected?.id]);
  const mayEdit = can("procurement.update");

  const refresh = () => { reload(); setSelected(null); setEditing(false); };

  /** Opening a vendor always lands in read mode. Details are read far more
   *  often than they are changed, and a form that opens by default invites
   *  edits nobody meant to make. */
  function open(v: VendorView) {
    setSelected(v);
    setEditing(false);
  }

  function startEditing(v: VendorView) {
    setDraft({
      pic_name: v.pic_name ?? "",
      pic_phone: v.pic_phone ?? "",
      phone: v.phone ?? "",
      address: v.address ?? "",
      bank_account: v.bank_account ?? "",
      bank_account_secondary: v.bank_account_secondary ?? "",
      npwp: v.npwp ?? "",
      supplied_categories: [...v.supplied_categories],
    });
    setEditing(true);
  }

  async function saveContact() {
    if (!selected) return;
    setSaving(true);
    /* Empty means "not on record", not an empty string — a blank that reads as
     * a value is how a field stops being answerable. */
    const blankToNull = (s: string) => (s.trim() === "" ? null : s.trim());
    const res = await procurement.updateVendorContact(selected.id, {
      pic_name: blankToNull(draft.pic_name),
      pic_phone: blankToNull(draft.pic_phone),
      phone: blankToNull(draft.phone),
      address: blankToNull(draft.address),
      bank_account: blankToNull(draft.bank_account),
      bank_account_secondary: blankToNull(draft.bank_account_secondary),
      npwp: blankToNull(draft.npwp),
      supplied_categories: draft.supplied_categories,
    });
    setSaving(false);
    if (res.error) { toast("critical", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", tr("Vendor updated", "Vendor diperbarui"), tr(`Contact details for "${res.data.name}" are on record.`, `Detail kontak untuk "${res.data.name}" sudah tercatat.`));
    setSelected(res.data);
    setEditing(false);
    reload();
  }

  async function addVendor() {
    if (!newName.trim()) return;
    setSaving(true);
    const res = await procurement.createVendor({ name: newName }, `vendor-${newName}`);
    setSaving(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", tr("Not added", "Tidak ditambahkan"), res.error.message);
      return;
    }
    toast("success", tr("Vendor added", "Vendor ditambahkan"), tr(`"${res.data.name}" is recorded and not yet curated. Open it to add a contact and bank details.`, `"${res.data.name}" tercatat dan belum dikurasi. Buka untuk menambahkan kontak dan detail bank.`));
    setNewName("");
    setAdding(false);
    reload();
  }

  async function setKind(v: VendorView, kind: VendorKind) {
    const res = await procurement.setVendorKind(v.id, kind);
    if (res.error) { toast("warning", tr("Nothing changed", "Tidak ada yang berubah"), res.error.message); return; }
    toast("success", tr("Kind saved", "Jenis disimpan"), `${v.name} · ${kindLabel(kind)}`);
    setSelected(res.data);
    reload();
  }

  async function curate(v: VendorView, curated: boolean) {
    const res = await procurement.curateVendor(v.id, curated);
    if (res.error) { toast("warning", tr("Nothing changed", "Tidak ada yang berubah"), res.error.message); return; }
    toast("success", curated ? tr("Curated", "Dikurasi") : tr("Moved back to uncurated", "Dikembalikan ke belum dikurasi"),
      curated ? tr(`"${v.name}" will now appear in dropdowns.`, `"${v.name}" sekarang akan muncul di dropdown.`) : tr(`"${v.name}" is still recorded, just not offered.`, `"${v.name}" tetap tercatat, hanya tidak ditawarkan.`));
    refresh();
  }

  async function merge(loser: VendorView, winnerId: string) {
    const res = await procurement.mergeVendor(loser.id, winnerId);
    if (res.error) { toast("warning", tr("Not merged", "Tidak digabung"), res.error.message); return; }
    toast("success", tr("Merged", "Digabung"), tr(`"${loser.name}" is kept as an alternative spelling. Its history stays where it is.`, `"${loser.name}" disimpan sebagai ejaan alternatif. Riwayatnya tetap di tempatnya.`));
    setMerging(null);
    refresh();
  }

  function startRename(v: VendorView) {
    setRenameTo(v.name);
    setRenaming(v);
  }

  async function rename() {
    if (!renaming || !renameTo.trim()) return;
    setSaving(true);
    const res = await procurement.renameVendor(renaming.id, renameTo);
    setSaving(false);
    if (res.error) {
      toast(res.error.status === 409 ? "warning" : "critical", tr("Not renamed", "Nama tidak diganti"), res.error.message);
      return;
    }
    toast("success", tr("Display name changed", "Nama tampilan diganti"),
      tr(`Now shown as "${res.data.name}". "${renaming.name}" is kept as another spelling, so searching for it still works.`, `Sekarang ditampilkan sebagai "${res.data.name}". "${renaming.name}" disimpan sebagai ejaan lain, jadi pencarian dengan nama itu tetap berfungsi.`));
    setRenaming(null);
    setSelected(res.data);
    reload();
  }

  async function archive(v: VendorView, archived: boolean) {
    const res = await procurement.archiveVendor(v.id, archived);
    if (res.error) { toast("warning", tr("Nothing changed", "Tidak ada yang berubah"), res.error.message); return; }
    toast("success", archived ? tr("Archived", "Diarsipkan") : tr("Restored", "Dipulihkan"),
      archived
        ? tr(`"${v.name}" no longer appears in any dropdown. Its transactions and orders are unchanged.`, `"${v.name}" tidak lagi muncul di dropdown mana pun. Transaksi dan PO-nya tidak berubah.`)
        : tr(`"${v.name}" is back in the dropdowns.`, `"${v.name}" kembali ada di dropdown.`));
    setDeleting(null);
    refresh();
  }

  async function remove(v: VendorView) {
    setSaving(true);
    const res = await procurement.deleteVendor(v.id);
    setSaving(false);
    if (res.error) {
      /* 409 is the expected answer for nearly every vendor: something still
         names it. The modal stays open and offers archive instead. */
      toast(res.error.status === 409 ? "warning" : "critical", tr("Not deleted", "Tidak terhapus"), res.error.message);
      return;
    }
    toast("success", tr("Deleted", "Dihapus"), tr(`"${v.name}" is gone. Nothing referred to it.`, `"${v.name}" sudah dihapus. Tidak ada yang merujuk padanya.`));
    setDeleting(null);
    refresh();
  }

  const columns: Column<VendorView>[] = [
    {
      key: "name",
      header: tr("Vendor", "Vendor"),
      className: "max-w-[280px]",
      render: (v) => (
        <div>
          <p className="font-medium text-slate-800">{v.name}</p>
          <p className="font-mono text-[11px] text-slate-400">{v.code}</p>
          {v.aka.length > 0 && (
            <p className="mt-0.5 text-[11px] text-slate-400">{tr("also written:", "juga ditulis:")} {v.aka.join(" · ")}</p>
          )}
        </div>
      ),
    },
    {
      key: "kind",
      header: tr("Kind", "Jenis"),
      render: (v) => v.kind === "supplier"
        ? <span className="text-[12px] text-slate-500">{kindLabel("supplier")}</span>
        : <Badge tone={v.kind === "factory" ? "brand" : v.kind === "qc" ? "violet" : "slate"}>{kindLabel(v.kind)}</Badge>,
    },
    {
      key: "curated",
      header: tr("Catalogue", "Katalog"),
      render: (v) =>
        v.archived_at
          ? <Badge tone="slate" dot>{tr("Archived", "Diarsipkan")}</Badge>
          : v.is_curated
            ? <Badge tone="green" dot>{tr("Curated", "Dikurasi")}</Badge>
            : <Badge tone="amber" dot>{tr("Not yet curated", "Belum dikurasi")}</Badge>,
    },
    {
      key: "supplies",
      header: tr("Supplies", "Memasok"),
      className: "max-w-[220px] whitespace-normal",
      render: (v) => {
        /* What we have actually bought wins over what the record claims: the
         * first is history, the second is a note somebody typed once. */
        const shown = v.bought_categories.length
          ? v.bought_categories.map((c) => c.name)
          : v.supplied_category_names;
        if (!shown.length) return <span className="text-slate-300">&mdash;</span>;
        return (
          <span className="flex flex-wrap gap-1">
            {shown.slice(0, 3).map((c) => (
              <span key={c} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{c}</span>
            ))}
            {shown.length > 3 && <span className="text-[11px] text-slate-400">+{shown.length - 3}</span>}
          </span>
        );
      },
    },
    { key: "trx", header: tr("Transactions", "Transaksi"), align: "right", render: (v) => formatNumber(v.transaction_count) },
    { key: "spend", header: tr("Total spend", "Total belanja"), align: "right", render: (v) => <span className="tabular-nums">{formatIDR(v.total_spend)}</span> },
    { key: "last", header: tr("Last purchase", "Pembelian terakhir"), render: (v) => v.last_purchase ?? <span className="text-slate-300">—</span> },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Master Data", "Data Master")}
        title={tr("Suppliers", "Pemasok")}
        description={tr("Everyone we buy from, curated or not. A name somebody types is always accepted — it is recorded first and judged later.", "Semua tempat kita membeli, sudah dikurasi atau belum. Nama yang diketik seseorang selalu diterima — dicatat dulu, dinilai kemudian.")}
        actions={
          mayEdit && <Button icon={Plus} onClick={() => setAdding(true)}>{tr("Add vendor", "Tambah vendor")}</Button>
        }
      />

      <Loaded state={state} onRetry={reload}>
        {(vendors) => {
          const curated = vendors.filter((v) => v.is_curated);
          const uncurated = vendors.filter((v) => !v.is_curated);
          return (
            <>
              <div className="mb-6 grid gap-4 sm:grid-cols-3">
                <StatCard label={tr("Vendors on record", "Vendor tercatat")} value={vendors.length} icon={Truck} hint={tr(`${curated.length} curated`, `${curated.length} dikurasi`)} />
                <StatCard
                  label={tr("Not yet curated", "Belum dikurasi")}
                  value={uncurated.length}
                  icon={Search}
                  tone="amber"
                  hint={tr("Recorded and visible — absent from dropdowns", "Tercatat dan terlihat — tidak ada di dropdown")}
                />
                <StatCard
                  label={tr("Spend on record", "Belanja tercatat")}
                  value={formatIDR(vendors.reduce((s, v) => s + v.total_spend, 0))}
                  icon={Truck}
                  tone="green"
                />
              </div>

              <Card>
                <CardHeader
                  title={tr("All vendors", "Semua vendor")}
                  subtitle={tr("Search reaches into what each vendor supplies — type an item like “thinner” and the vendor comes back, not the other way round.", "Pencarian menjangkau apa yang dipasok setiap vendor — ketik barang seperti “thinner” dan vendornya yang muncul, bukan sebaliknya.")}
                  icon={Truck}
                  action={
                    <div className="flex items-center gap-2">
                      <SourceBadge state={state} />
                      <label className="flex items-center gap-1.5 text-xs text-slate-500">
                        <input
                          id="vendor-show-archived"
                          type="checkbox"
                          checked={showArchived}
                          onChange={(e) => setShowArchived(e.target.checked)}
                          className="h-3.5 w-3.5 rounded border-slate-300"
                        />
                        {tr("Show archived", "Tampilkan yang diarsipkan")}
                      </label>
                      <input
                        id="vendor-search"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder={tr("Vendor, contact, or item…", "Vendor, kontak, atau barang…")}
                        className="h-9 w-44 rounded-lg border border-slate-200 px-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none"
                      />
                    </div>
                  }
                />
                <div className="flex flex-wrap gap-1.5 border-b border-slate-100 px-4 py-2">
                  {(["all", ...VENDOR_KINDS.map((k) => k.code)] as (VendorKind | "all")[]).map((k) => {
                    const n = k === "all" ? vendors.length : vendors.filter((v) => v.kind === k).length;
                    return (
                      <button key={k} type="button" onClick={() => setKindFilter(k)}
                        className={cn("rounded-full px-2.5 py-0.5 text-[12px] ring-1 ring-inset",
                          kindFilter === k ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50")}>
                        {k === "all" ? tr("All", "Semua") : kindLabel(k)} · {n}
                      </button>
                    );
                  })}
                </div>
                <DataTable
                  columns={columns}
                  rows={kindFilter === "all" ? vendors : vendors.filter((v) => v.kind === kindFilter)}
                  rowKey={(v) => v.id}
                  onRowClick={open}
                  empty={q ? tr(`Nothing matches “${q}”.`, `Tidak ada yang cocok dengan “${q}”.`) : tr("No vendors yet.", "Belum ada vendor.")}
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
        subtitle={editing ? tr(`${selected?.code} · editing`, `${selected?.code} · sedang diubah`) : selected?.code}
        footer={
          selected && mayEdit ? (
            editing ? (
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={saving}>
                  {tr("Cancel", "Batal")}
                </Button>
                <Button size="sm" icon={Save} onClick={saveContact} disabled={saving}>
                  {saving ? tr("Saving…", "Menyimpan…") : tr("Save details", "Simpan detail")}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" size="sm" icon={Trash2} onClick={() => setDeleting(selected)}>
                  {tr("Delete", "Hapus")}
                </Button>
                {selected.archived_at ? (
                  <Button variant="outline" size="sm" icon={ArchiveRestore} onClick={() => archive(selected, false)}>
                    {tr("Restore", "Pulihkan")}
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" icon={Archive} onClick={() => archive(selected, true)}>
                    {tr("Archive", "Arsipkan")}
                  </Button>
                )}
                <Button variant="outline" size="sm" icon={Merge} onClick={() => setMerging(selected)}>
                  {tr("Merge", "Gabungkan")}
                </Button>
                <Button variant="outline" size="sm" icon={Type} onClick={() => startRename(selected)}>
                  {tr("Rename", "Ganti nama")}
                </Button>
                <Button variant="outline" size="sm" icon={Pencil} onClick={() => startEditing(selected)}>
                  {tr("Edit details", "Ubah detail")}
                </Button>
                <Button
                  size="sm"
                  icon={Check}
                  variant={selected.is_curated ? "outline" : "primary"}
                  onClick={() => curate(selected, !selected.is_curated)}
                >
                  {selected.is_curated ? tr("Uncurate", "Batalkan kurasi") : tr("Curate", "Kurasi")}
                </Button>
              </div>
            )
          ) : null
        }
      >
        {selected && editing && (
          <div className="space-y-6 text-sm">
            <p className="rounded-lg bg-slate-50 px-3 py-2.5 text-[13px] text-slate-600">
              {tr("Leave anything blank that is genuinely unknown. A blank field reads as “not on record” and the screen will say so; a placeholder typed in to fill the gap reads as an answer.", "Kosongkan apa pun yang memang tidak diketahui. Kolom kosong terbaca sebagai “belum tercatat” dan layar akan menyebutnya begitu; isian asal untuk menutup celah terbaca sebagai jawaban.")}
            </p>

            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{tr("Contact", "Kontak")}</p>
              <Field id="v-pic" label={tr("PIC name", "Nama PIC")} value={draft.pic_name}
                     onChange={(v) => setDraft({ ...draft, pic_name: v })}
                     placeholder={tr("e.g. Hendra Wijaya", "mis. Hendra Wijaya")} />
              <Field id="v-picphone" label={tr("PIC phone", "Telepon PIC")} value={draft.pic_phone}
                     onChange={(v) => setDraft({ ...draft, pic_phone: v })}
                     placeholder={tr("e.g. 0812-3811-4402", "mis. 0812-3811-4402")} mono />
              <Field id="v-phone" label={tr("Office phone", "Telepon kantor")} value={draft.phone}
                     onChange={(v) => setDraft({ ...draft, phone: v })}
                     placeholder={tr("e.g. 0361-812445", "mis. 0361-812445")} mono />
              <div>
                <label htmlFor="v-address" className="block text-xs text-slate-500">{tr("Address", "Alamat")}</label>
                <textarea
                  id="v-address"
                  value={draft.address}
                  onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                  rows={2}
                  placeholder={tr("Street, city", "Jalan, kota")}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none"
                />
              </div>
            </section>

            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{tr("Payment details", "Detail pembayaran")}</p>
              <Field id="v-bank" label={tr("Bank account", "Rekening bank")} value={draft.bank_account}
                     onChange={(v) => setDraft({ ...draft, bank_account: v })}
                     placeholder={tr("e.g. BCA 145-0882-771", "mis. BCA 145-0882-771")} mono />
              <Field id="v-bank2" label={tr("Second account", "Rekening kedua")} value={draft.bank_account_secondary}
                     onChange={(v) => setDraft({ ...draft, bank_account_secondary: v })}
                     placeholder={tr("Only if they really have two", "Hanya bila memang punya dua")} mono />
              <Field id="v-npwp" label="NPWP" value={draft.npwp}
                     onChange={(v) => setDraft({ ...draft, npwp: v })}
                     placeholder="00.000.000.0-000.000" mono />
            </section>

            <section>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {tr("What they supply", "Yang mereka pasok")}
              </p>
              <p className="mb-2 text-xs text-slate-500">
                {tr("A claim on the record, useful before we have bought anything. Once we have, the screen shows what we actually bought instead — that one cannot go stale.", "Klaim di catatan, berguna sebelum kita membeli apa pun. Setelah membeli, layar menampilkan apa yang benar-benar kita beli — yang itu tidak bisa usang.")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {cats.status === "ready" && cats.data
                  .filter((c) => c.code !== "uncurated")
                  .map((c) => {
                    const on = draft.supplied_categories.includes(c.code);
                    return (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => setDraft({
                          ...draft,
                          supplied_categories: on
                            ? draft.supplied_categories.filter((x) => x !== c.code)
                            : [...draft.supplied_categories, c.code],
                        })}
                        className={cn(
                          "rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
                          on
                            ? "border-brand-300 bg-brand-50 font-medium text-brand-800"
                            : "border-slate-200 text-slate-600 hover:bg-slate-50",
                        )}
                      >
                        {c.name}
                      </button>
                    );
                  })}
              </div>
            </section>
          </div>
        )}

        {selected && !editing && (
          <div className="space-y-6 text-sm">
            {selected.archived_at && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-[13px] text-slate-600">
                <p className="font-medium text-slate-700">{tr(`Archived ${selected.archived_at.slice(0, 10)}`, `Diarsipkan ${selected.archived_at.slice(0, 10)}`)}</p>
                <p className="mt-1">
                  {tr("Not offered in any dropdown. Every transaction, request and order that names this vendor still does. Restore it if you buy from them again.", "Tidak ditawarkan di dropdown mana pun. Setiap transaksi, PR, dan PO yang menyebut vendor ini tetap menyebutnya. Pulihkan bila Anda membeli dari mereka lagi.")}
                </p>
              </div>
            )}
            <section className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{tr("Kind", "Jenis")}</span>
              {mayEdit && !selected.merged_into ? (
                <select value={selected.kind} onChange={(e) => setKind(selected, e.target.value as VendorKind)}
                  aria-label={tr("Kind", "Jenis")}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-[13px]">
                  {VENDOR_KINDS.map((k) => <option key={k.code} value={k.code}>{kindLabel(k.code)}</option>)}
                </select>
              ) : (
                <Badge tone={selected.kind === "factory" ? "brand" : "slate"}>{kindLabel(selected.kind)}</Badge>
              )}
              <span className="text-[12px] text-slate-500">
                {selected.kind === "factory"
                  ? tr("A partner factory: its price offers are recorded on Procurement › Factory prices.", "Pabrik mitra: penawaran harganya dicatat di Procurement › Harga pabrik.")
                  : selected.kind === "qc"
                    ? tr("Outsourced QC.", "QC outsource.")
                    : tr("Recording a factory price for a supplier makes it a factory.", "Mencatat harga pabrik untuk supplier menjadikannya pabrik.")}
              </span>
            </section>
            {!selected.is_curated && !selected.archived_at && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
                <p className="font-medium">{tr("Not yet curated", "Belum dikurasi")}</p>
                <p className="mt-1">
                  {tr("Recorded, and it will not be offered in a dropdown or treated as a canonical name until someone curates it. That is deliberate: promoting every new spelling automatically is how a vendor ends up in the books under four different names.", "Tercatat, dan tidak akan ditawarkan di dropdown atau dianggap nama baku sampai ada yang mengkurasinya. Itu disengaja: menaikkan setiap ejaan baru secara otomatis adalah cara satu vendor berakhir di pembukuan dengan empat nama berbeda.")}
                </p>
              </div>
            )}

            <section>
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <UserRound className="h-3.5 w-3.5" /> {tr("Who to contact", "Siapa yang dihubungi")}
              </p>
              {selected.pic_name || selected.pic_phone ? (
                <div className="rounded-lg border border-slate-200 px-4 py-3">
                  <p className="font-medium text-slate-800">{selected.pic_name ?? "—"}</p>
                  {selected.pic_phone && (
                    <a href={`tel:${selected.pic_phone.replace(/[^0-9+]/g, "")}`}
                       className="mt-0.5 inline-flex items-center gap-1.5 font-mono text-[13px] text-brand-700 hover:underline">
                      <Phone className="h-3.5 w-3.5" /> {selected.pic_phone}
                    </a>
                  )}
                  {selected.phone && (
                    <p className="mt-1 text-xs text-slate-500">{tr("Office:", "Kantor:")} {selected.phone}</p>
                  )}
                </div>
              ) : (
                /* An empty contact on a vendor we keep buying from is a question,
                   not a blank. Say so rather than showing a dash. */
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-4 py-3 text-slate-500">
                  {tr("No contact on record", "Belum ada kontak tercatat")}{selected.transaction_count > 0 && tr(` — and we have bought from them ${selected.transaction_count} time(s)`, ` — padahal kita sudah membeli dari mereka ${selected.transaction_count} kali`)}.
                </div>
              )}
              {selected.address && (
                <p className="mt-2 flex items-start gap-1.5 text-[13px] text-slate-600">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" /> {selected.address}
                </p>
              )}
            </section>

            <section>
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Landmark className="h-3.5 w-3.5" /> {tr("Payment details", "Detail pembayaran")}
              </p>
              <dl className="space-y-2.5">
                {([
                  [tr("Bank account", "Rekening bank"), selected.bank_account],
                  [tr("Second account", "Rekening kedua"), selected.bank_account_secondary],
                  ["NPWP", selected.npwp],
                ] as [string, string | null][]).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b border-slate-100 pb-2">
                    <dt className="text-slate-500">{k}</dt>
                    <dd className={cn("text-right font-mono text-[13px]", v ? "text-slate-800" : "text-slate-300")}>
                      {v ?? "—"}
                    </dd>
                  </div>
                ))}
              </dl>
              {selected.bank_account_secondary && (
                <p className="mt-2 text-xs text-slate-500">
                  {tr("Two accounts on record. Check the invoice for which one to use — paying into the wrong one is a week of chasing.", "Ada dua rekening tercatat. Periksa invoice untuk rekening yang dipakai — salah transfer berarti seminggu mengejar.")}
                </p>
              )}
            </section>

            <section>
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Boxes className="h-3.5 w-3.5" /> {tr("What we buy here", "Yang kita beli di sini")}
              </p>
              {selected.bought_categories.length > 0 ? (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {selected.bought_categories.map((c) => (
                    <Badge key={c.code} tone="brand">{c.name} · {c.count}</Badge>
                  ))}
                </div>
              ) : (
                <p className="mb-3 text-slate-500">{tr("Nothing bought from them yet.", "Belum ada yang dibeli dari mereka.")}</p>
              )}

              {selected.items_bought.length > 0 && (
                <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                  {selected.items_bought.slice(0, 8).map((i) => (
                    <li key={i.item_id} className="flex items-baseline justify-between gap-3 px-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] text-slate-700">{i.item_name}</span>
                        <span className="block text-[11px] text-slate-400">{i.last_date}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block tabular-nums text-[13px] text-slate-700">
                          {i.last_price != null ? formatIDR(i.last_price) : "—"}
                        </span>
                        {i.uom && <span className="block text-[11px] text-slate-400">per {i.uom}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {selected.supplied_categories.length > 0 && (
                <p className="mt-2 text-xs text-slate-500">
                  {tr(`Also listed as supplying ${selected.supplied_category_names.join(", ")} — a note on the record rather than something we have bought.`, `Juga tercatat memasok ${selected.supplied_category_names.join(", ")} — catatan di data, bukan sesuatu yang sudah kita beli.`)}
                </p>
              )}
            </section>

            <section>
              <dl className="space-y-2.5">
                {([
                  [tr("Transactions", "Transaksi"), formatNumber(selected.transaction_count)],
                  [tr("Total spend", "Total belanja"), formatIDR(selected.total_spend)],
                  [tr("Last purchase", "Pembelian terakhir"), selected.last_purchase ?? "—"],
                  [tr("Open PR lines", "Baris PR terbuka"), formatNumber(selected.open_pr_lines)],
                ] as [string, string][]).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b border-slate-100 pb-2">
                    <dt className="text-slate-500">{k}</dt>
                    <dd className="text-right font-medium text-slate-800">{v}</dd>
                  </div>
                ))}
              </dl>
            </section>

            {(selected.aka.length > 0 || selected.absorbed.length > 0) && (
              <section>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {tr("Other spellings", "Ejaan lain")}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {selected.aka.map((a) => <Badge key={a} tone="slate">{a}</Badge>)}
                </div>
                {selected.absorbed.length > 0 && (
                  <p className="mt-2 text-xs text-slate-500">
                    {tr(`${selected.absorbed.length} merged record(s) still carry their own history — nothing was rewritten.`, `${selected.absorbed.length} catatan yang digabung tetap membawa riwayatnya sendiri — tidak ada yang ditulis ulang.`)}
                  </p>
                )}
              </section>
            )}
          </div>
        )}
      </Drawer>

      <Modal open={adding} onClose={() => setAdding(false)} title={tr("Add vendor", "Tambah vendor")}>
        <div className="space-y-3">
          <label htmlFor="new-vendor" className="block text-sm text-slate-600">
            {tr("Vendor name", "Nama vendor")}
          </label>
          <input
            id="new-vendor"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={tr("e.g. UD SUMBER MAKMUR", "mis. UD SUMBER MAKMUR")}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
          />
          <p className="text-xs text-slate-500">
            {tr("Whatever you type is accepted. It is saved as", "Apa pun yang Anda ketik diterima. Disimpan sebagai")} <strong>{tr("not yet curated", "belum dikurasi")}</strong>{tr(
              ", which means it is on record and searchable but will not be offered in dropdowns until someone confirms it is the real name. Contact and bank details are added afterwards, from the vendor’s own panel.",
              ", artinya tercatat dan bisa dicari tetapi tidak ditawarkan di dropdown sampai ada yang memastikan itu nama sebenarnya. Kontak dan detail bank ditambahkan sesudahnya, dari panel vendor itu sendiri.",
            )}
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setAdding(false)}>{tr("Cancel", "Batal")}</Button>
            <Button onClick={addVendor} disabled={saving || !newName.trim()}>
              {saving ? tr("Saving…", "Menyimpan…") : tr("Add vendor", "Tambah vendor")}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!renaming} onClose={() => setRenaming(null)} title={tr("Change display name", "Ganti nama tampilan")}>
        {renaming && (
          <div className="space-y-3">
            <label htmlFor="rename-vendor" className="block text-sm text-slate-600">
              {tr("The name shown in every dropdown, list and printed order", "Nama yang ditampilkan di setiap dropdown, daftar, dan PO cetak")}
            </label>
            <input
              id="rename-vendor"
              value={renameTo}
              onChange={(e) => setRenameTo(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
            />
            {renaming.aka.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs text-slate-500">{tr("Or pick one of its other spellings:", "Atau pilih salah satu ejaan lainnya:")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {renaming.aka.map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setRenameTo(a)}
                      className={cn(
                        "rounded-lg border px-2.5 py-1 text-xs transition-colors",
                        renameTo === a
                          ? "border-brand-300 bg-brand-50 font-medium text-brand-800"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50",
                      )}
                    >
                      {a}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className="text-xs text-slate-500">
              {tr("The current name,", "Nama saat ini,")} <strong>{renaming.name}</strong>{tr(
                ", is kept as another spelling, so searching for it — and reading it off an old nota — still finds this vendor.",
                ", disimpan sebagai ejaan lain, jadi mencarinya — dan membacanya dari nota lama — tetap menemukan vendor ini.",
              )}
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setRenaming(null)}>{tr("Cancel", "Batal")}</Button>
              <Button onClick={rename} disabled={saving || !renameTo.trim() || renameTo.trim() === renaming.name}>
                {saving ? tr("Saving…", "Menyimpan…") : tr("Save name", "Simpan nama")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title={tr("Delete vendor", "Hapus vendor")}>
        {deleting && (
          <div className="space-y-3 text-sm text-slate-600">
            <p>
              {tr("Delete", "Hapus")} <strong>{deleting.name}</strong> {tr(
                "permanently? This only works for a vendor nothing refers to — no transaction, request, order, planned payment or item.",
                "secara permanen? Ini hanya berlaku untuk vendor yang tidak dirujuk apa pun — tidak ada transaksi, PR, PO, rencana pembayaran, atau barang.",
              )}
            </p>
            {deleting.transaction_count > 0 ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
                {tr(
                  `We have ${formatNumber(deleting.transaction_count)} transaction(s) with this vendor, so it cannot be deleted. Archive it instead: it disappears from every dropdown and its history keeps its name.`,
                  `Ada ${formatNumber(deleting.transaction_count)} transaksi dengan vendor ini, jadi tidak bisa dihapus. Arsipkan saja: vendor hilang dari setiap dropdown dan riwayatnya tetap memakai namanya.`,
                )}
              </p>
            ) : (
              <p className="text-xs text-slate-500">
                {tr("If something does still refer to it, you will be told what, and can archive it instead.", "Bila masih ada yang merujuk padanya, Anda akan diberi tahu apa, dan bisa mengarsipkannya saja.")}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDeleting(null)}>{tr("Cancel", "Batal")}</Button>
              {!deleting.archived_at && (
                <Button variant="outline" icon={Archive} onClick={() => archive(deleting, true)}>
                  {tr("Archive instead", "Arsipkan saja")}
                </Button>
              )}
              <Button
                icon={Trash2}
                onClick={() => remove(deleting)}
                disabled={saving || deleting.transaction_count > 0}
              >
                {saving ? tr("Deleting…", "Menghapus…") : tr("Delete", "Hapus")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!merging} onClose={() => setMerging(null)} title={tr("Merge into another vendor", "Gabungkan ke vendor lain")} width="max-w-lg">
        {merging && state.status === "ready" && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {tr("Pick the vendor", "Pilih vendor yang sebenarnya sama dengan")} <strong>{merging.name}</strong>{tr(
                " is really the same as. Its spelling is kept as an alternative, and its existing transactions stay pointed where they are — history does not move because a name was corrected later.",
                ". Ejaannya disimpan sebagai alternatif, dan transaksi yang ada tetap menunjuk ke tempatnya — riwayat tidak berpindah karena nama dikoreksi belakangan.",
              )}
            </p>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {state.data.filter((v) => v.id !== merging.id).map((v) => (
                <button
                  key={v.id}
                  onClick={() => merge(merging, v.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-left text-sm transition-colors hover:border-brand-300 hover:bg-brand-50/40"
                >
                  <span className="font-medium text-slate-700">{v.name}</span>
                  {v.is_curated && <Badge tone="green">{tr("Curated", "Dikurasi")}</Badge>}
                </button>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
