"use client";

import { useState } from "react";
import { Tags, Plus, Pencil, Trash2 } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/drawer";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { forgetTypes } from "@/components/ui/type-options";
import { accounting } from "@/demo/api";
import type { Category, TransactionType } from "@/services/accounting/contracts";
import { CategoryBadge, CategoryOptions } from "@/components/accounting/category";
import { CATEGORY_NOTES } from "@/services/accounting/categories";
import { useToast } from "@/store/toast";
import { useSession } from "@/store/session";
import { useTr } from "@/lib/i18n";

/** The ledger's transaction types (`0105`).
 *
 *  The code is what every ledger row carries, spelled the way the data
 *  spells it — `RECCURING` keeps its doubled C — so it is fixed at creation.
 *  A type in use is retired rather than deleted: it stays on its rows and
 *  leaves the pickers.
 *
 *  The flags are what the ledger does with a row of this type:
 *    purchase          the row is expected to name a request or order (D83)
 *    creates items     its lines feed the item catalogue (D86)
 *    auto-complete     rows complete by themselves (D26 — shipped inert)
 */
const inputClass =
  "mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none";

type Form = {
  mode: "create" | "edit"; code: string; description: string; category: Category;
  is_purchase: boolean; creates_catalog_item: boolean; auto_complete: boolean; is_active: boolean;
};

export default function TransactionTypesPage() {
  const tr = useTr();
  const { can } = useSession();
  const { toast } = useToast();
  const mayEdit = can("accounting.update");
  const [state, reload] = useLoad(() => accounting.listTypeRows(), []);
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form) return;
    setSaving(true);
    const flags = {
      is_purchase: form.is_purchase, creates_catalog_item: form.creates_catalog_item,
      auto_complete: form.auto_complete, description: form.description,
    };
    let res = form.mode === "create"
      ? await accounting.createTransactionType({ code: form.code, ...flags })
      : await accounting.updateTransactionType(form.code, { ...flags, is_active: form.is_active });
    /* The category is its own seam (0274): a new type is born overhead and
       told its category right after; an edit sends it only when it moved. */
    if (!res.error && res.data.category !== form.category) {
      res = await accounting.setTypeCategory(res.data.code, form.category);
    }
    setSaving(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not saved", "Tidak tersimpan"), res.error.message);
      return;
    }
    toast("success", form.mode === "create" ? tr("Type added", "Jenis ditambahkan") : tr("Type saved", "Jenis tersimpan"), res.data.code);
    forgetTypes();
    setForm(null);
    reload();
  }

  async function remove() {
    if (!form) return;
    setSaving(true);
    const res = await accounting.deleteTransactionType(form.code);
    setSaving(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not deleted", "Tidak terhapus"), res.error.message);
      return;
    }
    toast("success", tr("Type deleted", "Jenis dihapus"), tr(`${form.code} is gone. No row carried it.`, `${form.code} sudah dihapus. Tidak ada baris yang memakainya.`));
    forgetTypes();
    setForm(null);
    reload();
  }

  const flag = (on: boolean) => (on ? <Badge tone="green" dot>{tr("Yes", "Ya")}</Badge> : <span className="text-slate-400">{tr("No", "Tidak")}</span>);

  const columns: Column<TransactionType>[] = [
    {
      key: "code",
      header: tr("Type", "Jenis"),
      render: (t) => (
        <div>
          <p className="font-medium text-slate-800">
            {t.code}
            {t.is_active === false && <Badge tone="slate" className="ml-2">{tr("Retired", "Dipensiunkan")}</Badge>}
          </p>
          {t.description && <p className="text-[11px] text-slate-500">{t.description}</p>}
        </div>
      ),
    },
    { key: "category", header: tr("Category", "Kategori"), render: (t) => <CategoryBadge category={t.category} /> },
    { key: "purchase", header: tr("Purchase", "Pembelian"), render: (t) => flag(t.is_purchase) },
    { key: "items", header: tr("Creates items", "Membuat barang"), render: (t) => flag(t.creates_catalog_item) },
    { key: "auto", header: tr("Auto-complete", "Selesai otomatis"), render: (t) => flag(t.auto_complete) },
    {
      key: "edit",
      header: "",
      render: (t) => mayEdit ? (
        <Button
          variant="ghost" size="sm" icon={Pencil} aria-label={tr(`Edit ${t.code}`, `Ubah ${t.code}`)}
          onClick={() => setForm({
            mode: "edit", code: t.code, description: t.description ?? "", category: t.category,
            is_purchase: t.is_purchase, creates_catalog_item: t.creates_catalog_item,
            auto_complete: t.auto_complete, is_active: t.is_active !== false,
          })}
        >
          <span className="sr-only">{tr("Edit", "Ubah")}</span>
        </Button>
      ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Master Data", "Data Master")}
        title={tr("Transaction types", "Jenis transaksi")}
        description={tr("What a ledger row is. The code is fixed once created; a type in use is retired, not deleted.", "Apa arti sebuah baris buku besar. Kode tidak bisa diubah setelah dibuat; jenis yang sedang dipakai dipensiunkan, bukan dihapus.")}
        actions={mayEdit && (
          <Button icon={Plus} onClick={() => setForm({
            mode: "create", code: "", description: "", category: "overhead", is_purchase: true,
            creates_catalog_item: false, auto_complete: false, is_active: true,
          })}>
            {tr("Add type", "Tambah jenis")}
          </Button>
        )}
      />

      <Card>
        <CardHeader
          title={tr("All types", "Semua jenis")}
          subtitle={tr("Category: what the summary counts its rows as. Purchase: the row is expected to name a request or order. Creates items: its lines feed the item catalogue.", "Kategori: sebagai apa ringkasan menghitung barisnya. Pembelian: baris diharapkan menyebut PR atau PO. Membuat barang: baris-barisnya mengisi katalog barang.")}
          icon={Tags}
          action={<SourceBadge state={state} />}
        />
        <Loaded state={state} onRetry={reload}>
          {(rows) => <DataTable columns={columns} rows={rows} rowKey={(t) => t.code} dense empty={tr("No types.", "Belum ada jenis.")} />}
        </Loaded>
      </Card>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.mode === "create" ? tr("Add transaction type", "Tambah jenis transaksi") : tr(`Edit ${form?.code ?? ""}`, `Ubah ${form?.code ?? ""}`)}>
        {form && (
          <div className="space-y-3">
            <div>
              <label htmlFor="tt-code" className="block text-sm text-slate-600">{tr("Code", "Kode")}</label>
              <input
                id="tt-code"
                value={form.code}
                disabled={form.mode === "edit"}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder={tr("e.g. TRANSPORT", "mis. TRANSPORT")}
                className={inputClass + " font-mono disabled:bg-slate-50 disabled:text-slate-500"}
              />
              {form.mode === "create" && (
                <p className="mt-1 text-xs text-slate-500">{tr("Written in capitals, as the ledger spells them. It cannot be renamed later.", "Ditulis dengan huruf kapital, sesuai ejaan di buku besar. Tidak bisa diganti namanya nanti.")}</p>
              )}
            </div>
            <div>
              <label htmlFor="tt-desc" className="block text-sm text-slate-600">{tr("What it is for", "Kegunaannya")}</label>
              <input
                id="tt-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder={tr("e.g. Fuel, tolls and courier fees", "mis. Bensin, tol, dan ongkos kurir")}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="tt-category" className="block text-sm text-slate-600">{tr("Category", "Kategori")}</label>
              <select
                id="tt-category"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as Category })}
                className={inputClass + " bg-white"}
              >
                <CategoryOptions />
              </select>
              <p className="mt-1 text-xs text-slate-500">
                {tr(CATEGORY_NOTES[form.category].en, CATEGORY_NOTES[form.category].id)}
                {" — "}
                {tr("every row of this type counts here in the summary unless the row says otherwise.", "setiap baris dengan jenis ini dihitung di sini pada ringkasan, kecuali barisnya berkata lain.")}
              </p>
            </div>
            <div className="space-y-2 rounded-lg border border-slate-200 px-3 py-3 text-sm text-slate-700">
              <label className="flex items-start gap-2">
                <input id="tt-purchase" type="checkbox" className="mt-1" checked={form.is_purchase}
                  onChange={(e) => setForm({ ...form, is_purchase: e.target.checked })} />
                <span>{tr("Purchase", "Pembelian")} <span className="block text-xs text-slate-500">{tr("A row of this type is expected to name the request or order it paid.", "Baris dengan jenis ini diharapkan menyebut PR atau PO yang dibayarnya.")}</span></span>
              </label>
              <label className="flex items-start gap-2">
                <input id="tt-items" type="checkbox" className="mt-1" checked={form.creates_catalog_item}
                  onChange={(e) => setForm({ ...form, creates_catalog_item: e.target.checked })} />
                <span>{tr("Creates items", "Membuat barang")} <span className="block text-xs text-slate-500">{tr("Its itemised lines feed the item catalogue.", "Baris-baris rinciannya mengisi katalog barang.")}</span></span>
              </label>
              <label className="flex items-start gap-2">
                <input id="tt-auto" type="checkbox" className="mt-1" checked={form.auto_complete}
                  onChange={(e) => setForm({ ...form, auto_complete: e.target.checked })} />
                <span>{tr("Auto-complete", "Selesai otomatis")} <span className="block text-xs text-slate-500">{tr("Reserved — not acted on yet.", "Dicadangkan — belum dijalankan.")}</span></span>
              </label>
              {form.mode === "edit" && (
                <label className="flex items-start gap-2 border-t border-slate-100 pt-2">
                  <input id="tt-active" type="checkbox" className="mt-1" checked={form.is_active}
                    onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />
                  <span>{tr("Active", "Aktif")} <span className="block text-xs text-slate-500">{tr("Untick to retire it: it stays on its rows and leaves the pickers.", "Hapus centang untuk memensiunkannya: tetap ada di baris-barisnya dan hilang dari pilihan.")}</span></span>
                </label>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              {form.mode === "edit" && (
                <Button variant="ghost" icon={Trash2} className="mr-auto text-rose-700" disabled={saving} onClick={remove}>
                  {tr("Delete", "Hapus")}
                </Button>
              )}
              <Button variant="outline" onClick={() => setForm(null)}>{tr("Cancel", "Batal")}</Button>
              <Button onClick={save} disabled={saving || form.code.trim().length < 2}>
                {saving ? tr("Saving…", "Menyimpan…") : tr("Save", "Simpan")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
