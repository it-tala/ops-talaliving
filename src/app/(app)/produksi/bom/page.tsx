"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Coins, ListTree, Plus, Search } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { production } from "@/demo/api";
import { useSession } from "@/store/session";
import { ProductDrawer } from "./ProductDrawer";
import { useTr } from "@/lib/i18n";
import { ExcelTable } from "@/components/ui/excel-export";

/** Master data: what we sell and make, what each one is made of, and what
 *  one unit costs us to make.
 *
 *  Two tables, one screen, because they are read together: a product nobody
 *  can price is a bill of material with a hole in it, and the hole is the
 *  thing worth seeing.
 *
 *  The production cost is **computed every time this page is read** from the
 *  lines — materials, sub-assemblies, labour — plus the revision's
 *  miskalkulasi (A3, 0109). A draft follows today's catalogue prices; a
 *  released revision keeps the rates it was released with. A line with no rate
 *  leaves the cost marked incomplete rather than quietly counting as zero
 *  (D149). It is a cost, never a selling price.
 */
export default function BomPage() {
  const tr = useTr();
  const { can } = useSession();
  const [products, reload] = useLoad(() => production.listProducts({ include_inactive: true }), []);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /* Set when the drawer was opened by *New product* with a drawing: the BOM
     opens and the AI reads the drawing at once (D324). */
  const [autoSuggest, setAutoSuggest] = useState(false);
  const mayEdit = can("production.update");

  /* `?open=CODE` — an order line's item code links straight to its BOM. Read
     once on mount rather than through `useSearchParams`, which would need a
     Suspense boundary around a page that renders fine without one. */
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("open");
    if (code) setOpen(code);
  }, []);

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Production", "Produksi")}
        title={tr("Products & Bill of Materials", "Produk & Bill of Materials")}
        description={tr(
          "Per item code: working drawing, components per unit — component, material, need, unit, rate — and the production cost. The AI can read the working drawing and propose the lines, with rates from the BOM rate list. Not a selling price.",
          "Per item code: gambar kerja, komponen per unit — komponen, material, kebutuhan, satuan, rate — dan biaya produksinya. AI bisa membaca gambar kerja dan mengusulkan barisnya, dengan rate dari daftar rate BOM. Bukan harga jual.",
        )}
        actions={
          <div className="flex gap-2">
            <Link href="/produksi/rate">
              <Button variant="outline" icon={Coins}>{tr("BOM rates", "Daftar rate")}</Button>
            </Link>
            {mayEdit && (
              <Button icon={Plus} onClick={() => { setCreating(true); setOpen(null); setAutoSuggest(false); }}>{tr("New product", "Produk baru")}</Button>
            )}
          </div>
        }
      />

      <Loaded state={products} onRetry={reload}>
        {(all) => {
          const rows = all.filter((p) =>
            `${p.product_code} ${p.name} ${p.category}`.toLowerCase().includes(q.toLowerCase()));
          const withBom = all.filter((p) => p.components.length > 0);
          const noBom = all.filter((p) => p.components.length === 0);
          const incomplete = all.filter((p) => p.missing.length > 0);

          return (
            <>
              <div className="mb-4 rounded-xl border border-slate-200 bg-white shadow-card">
                <dl className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
                  {([
                    [tr("Products", "Produk"), String(all.length), tr("sold and made in-house", "yang dijual dan dibuat sendiri")],
                    [tr("Has a BOM", "Punya BOM"), String(withBom.length), tr("components recorded", "komponennya sudah tercatat")],
                    [tr("No BOM yet", "Belum ada BOM"), String(noBom.length), noBom.length > 0 ? tr("material needs cannot be calculated yet", "kebutuhan bahannya belum bisa dihitung") : tr("all have one", "semua sudah punya")],
                    [tr("Data incomplete", "Data belum lengkap"), String(incomplete.length), tr("size, working drawing or finished photo", "ukuran, gambar kerja atau gambar jadi")],
                  ] as [string, string, string][]).map(([k, v, note]) => (
                    <div key={k} className="px-4 py-3.5">
                      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
                      <dd className={cn(
                        "mt-0.5 text-xl font-bold tabular-nums tracking-tight",
                        (k === tr("No BOM yet", "Belum ada BOM") && noBom.length > 0)
                          || (k === tr("Data incomplete", "Data belum lengkap") && incomplete.length > 0)
                          ? "text-amber-700" : "text-slate-800",
                      )}>
                        {v}
                      </dd>
                      <p className="text-[11px] text-slate-500">{note}</p>
                    </div>
                  ))}
                </dl>
              </div>

              <Card>
                <CardHeader
                  title={tr("Product catalogue", "Katalog produk")}
                  subtitle={tr(
                    "Click to see its components, change quantities, and work out the material needed for a number of units.",
                    "Klik untuk melihat komponennya, mengubah jumlah, dan menghitung kebutuhan bahan untuk sekian unit.",
                  )}
                  icon={ListTree}
                  action={<SourceBadge state={products} />}
                />
                <div className="border-b border-slate-100 px-4 py-2">
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-2">
                    <Search className="h-4 w-4 text-slate-400" />
                    <input
                      value={q} onChange={(e) => setQ(e.target.value)}
                      placeholder={tr("Search name, code or category…", "Cari nama, kode atau kategori…")}
                      className="h-8 w-full text-sm focus:outline-none"
                    />
                  </label>
                </div>
                {/* Katalog produk tumbuh terus; tabelnya dipaginasi (D157). */}
                <Paged rows={rows} pageSize={20} unit={tr("products", "produk")}>
                  {(shown, _offset, showAll) => (
                  <div className="overflow-x-auto">
                    <ExcelTable showAll={showAll} className="w-full min-w-[760px] border-collapse text-[13px]">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                          <th className="px-4 py-2 text-left">{tr("Product", "Produk")}</th>
                          <th className="px-4 py-2 text-left">{tr("Category", "Kategori")}</th>
                          <th className="px-4 py-2 text-right">{tr("Components", "Komponen")}</th>
                          <th className="px-4 py-2 text-right">{tr("Production cost / unit", "Biaya produksi / unit")}</th>
                          <th className="px-4 py-2 text-left">{tr("Completeness", "Kelengkapan")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((p) => (
                          <tr
                            key={p.id}
                            onClick={() => { setOpen(p.product_code); setCreating(false); setAutoSuggest(false); }}
                            className="cursor-pointer border-b border-slate-100 hover:bg-slate-50"
                          >
                            <td className="px-4 py-2">
                              <span className="block font-medium text-slate-800">{p.name}</span>
                              <span className="block font-mono text-[10px] text-slate-400">
                                {p.product_code} · per {p.uom}
                                {p.dimension && ` · ${p.dimension}`}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-slate-600">
                              {p.category}
                              {!p.active && <Badge tone="slate" className="ml-2">{tr("inactive", "nonaktif")}</Badge>}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                              {p.components.length || "—"}
                            </td>
                            <td className="px-4 py-2 text-right">
                              {p.components.length === 0 ? (
                                <span className="text-slate-300">—</span>
                              ) : p.production_cost == null ? (
                                <span className="text-[12px] text-amber-700">
                                  {tr(`incomplete · ${p.unpriced} without a rate`, `belum lengkap · ${p.unpriced} tanpa rate`)}
                                </span>
                              ) : (
                                <>
                                  <span className="tabular-nums text-slate-800">{formatIDR(p.production_cost)}</span>
                                  <span className="block text-[11px] text-slate-400">
                                    rev {p.viewing_rev}{p.draft_rev != null ? " · draft" : ""}
                                    {p.labour_cost == null && tr(" · no labour", " · tanpa tenaga kerja")}
                                  </span>
                                </>
                              )}
                            </td>
                            {/* Ukuran, gambar kerja, gambar jadi, BOM — named when
                                missing, because asking is the expensive part
                                (D150). */}
                            <td className="px-4 py-2 text-[12px]">
                              {p.missing.length === 0 ? (
                                <span className="text-emerald-700">{tr("complete", "lengkap")}</span>
                              ) : (
                                <span className="text-amber-700">{tr("missing", "belum ada")} {p.missing.join(", ")}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                        {rows.length === 0 && (
                          <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">{tr("Nothing matches.", "Tidak ada yang cocok.")}</td></tr>
                        )}
                      </tbody>
                    </ExcelTable>
                  </div>
                  )}
                </Paged>
                <p className="flex items-start gap-2 border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span>
                    {tr(
                      "Production cost = materials + sub-assemblies + labour, plus the miscalculation percentage. A rate left empty follows the BOM rate list where the line was taken from it, otherwise the catalogue standard price or the last purchase price; when the BOM is released, its rates are locked. A component with no rate is not counted as zero — the total is marked incomplete.",
                      "Biaya produksi = bahan + sub-rakitan + tenaga kerja, ditambah persentase miskalkulasi. Rate yang tidak diisi mengikuti daftar rate BOM bila barisnya diambil dari sana, selain itu harga standar katalog atau harga beli terakhir; saat BOM dirilis, rate-nya dikunci. Komponen tanpa rate tidak dihitung nol — totalnya ditandai belum lengkap.",
                    )}{" "}
                    <strong>{tr("Not a selling price.", "Bukan harga jual.")}</strong>
                  </span>
                </p>
              </Card>
            </>
          );
        }}
      </Loaded>

      {(open || creating) && (
        <ProductDrawer
          key={open ?? "new"}
          productCode={open}
          autoSuggest={autoSuggest}
          onClose={() => { setOpen(null); setCreating(false); setAutoSuggest(false); }}
          onChanged={reload}
          onCreated={(code, o) => { setCreating(false); setOpen(code); setAutoSuggest(o.autoSuggest); }}
        />
      )}
    </div>
  );
}
