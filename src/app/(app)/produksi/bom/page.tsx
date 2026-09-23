"use client";

import { useState } from "react";
import { AlertTriangle, ListTree, Plus, Search } from "lucide-react";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { Paged } from "@/components/ui/pager";
import { formatIDR } from "@/lib/format";
import { cn } from "@/lib/cn";
import { production } from "@/demo/api";
import { useSession } from "@/store/session";
import { ProductDrawer } from "./ProductDrawer";

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
  const { can } = useSession();
  const [products, reload] = useLoad(() => production.listProducts({ include_inactive: true }), []);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const mayEdit = can("production.update");

  return (
    <div>
      <PageHeader
        breadcrumb="Production"
        title="Produk &amp; Bill of Materials"
        description="Per item code: gambar kerja, komponen per unit (bahan, sub-rakitan, tenaga kerja) dengan rate masing-masing, dan biaya produksinya. Bukan harga jual."
        actions={mayEdit ? (
          <Button icon={Plus} onClick={() => { setCreating(true); setOpen(null); }}>Produk baru</Button>
        ) : undefined}
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
                    ["Produk", String(all.length), "yang dijual dan dibuat sendiri"],
                    ["Punya BOM", String(withBom.length), "komponennya sudah tercatat"],
                    ["Belum ada BOM", String(noBom.length), noBom.length > 0 ? "kebutuhan bahannya belum bisa dihitung" : "semua sudah punya"],
                    ["Data belum lengkap", String(incomplete.length), "ukuran, gambar kerja atau gambar jadi"],
                  ] as [string, string, string][]).map(([k, v, note]) => (
                    <div key={k} className="px-4 py-3.5">
                      <dt className="text-[11px] uppercase tracking-wide text-slate-400">{k}</dt>
                      <dd className={cn(
                        "mt-0.5 text-xl font-bold tabular-nums tracking-tight",
                        (k === "Belum ada BOM" && noBom.length > 0)
                          || (k === "Data belum lengkap" && incomplete.length > 0)
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
                  title="Katalog produk"
                  subtitle="Klik untuk melihat komponennya, mengubah jumlah, dan menghitung kebutuhan bahan untuk sekian unit."
                  icon={ListTree}
                  action={<SourceBadge state={products} />}
                />
                <div className="border-b border-slate-100 px-4 py-2">
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-2">
                    <Search className="h-4 w-4 text-slate-400" />
                    <input
                      value={q} onChange={(e) => setQ(e.target.value)}
                      placeholder="Cari nama, kode atau kategori…"
                      className="h-8 w-full text-sm focus:outline-none"
                    />
                  </label>
                </div>
                {/* Katalog produk tumbuh terus; tabelnya dipaginasi (D157). */}
                <Paged rows={rows} pageSize={20} unit="produk">
                  {(shown) => (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] border-collapse text-[13px]">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] uppercase tracking-wide text-slate-500">
                          <th className="px-4 py-2 text-left">Produk</th>
                          <th className="px-4 py-2 text-left">Kategori</th>
                          <th className="px-4 py-2 text-right">Komponen</th>
                          <th className="px-4 py-2 text-right">Biaya produksi / unit</th>
                          <th className="px-4 py-2 text-left">Kelengkapan</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((p) => (
                          <tr
                            key={p.id}
                            onClick={() => { setOpen(p.product_code); setCreating(false); }}
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
                              {!p.active && <Badge tone="slate" className="ml-2">nonaktif</Badge>}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                              {p.components.length || "—"}
                            </td>
                            <td className="px-4 py-2 text-right">
                              {p.components.length === 0 ? (
                                <span className="text-slate-300">—</span>
                              ) : p.production_cost == null ? (
                                <span className="text-[12px] text-amber-700">
                                  belum lengkap · {p.unpriced} tanpa rate
                                </span>
                              ) : (
                                <>
                                  <span className="tabular-nums text-slate-800">{formatIDR(p.production_cost)}</span>
                                  <span className="block text-[11px] text-slate-400">
                                    rev {p.viewing_rev}{p.draft_rev != null ? " · draft" : ""}
                                    {p.labour_cost == null && " · tanpa tenaga kerja"}
                                  </span>
                                </>
                              )}
                            </td>
                            {/* Ukuran, gambar kerja, gambar jadi, BOM — named when
                                missing, because asking is the expensive part
                                (D150). */}
                            <td className="px-4 py-2 text-[12px]">
                              {p.missing.length === 0 ? (
                                <span className="text-emerald-700">lengkap</span>
                              ) : (
                                <span className="text-amber-700">belum ada {p.missing.join(", ")}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                        {rows.length === 0 && (
                          <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Tidak ada yang cocok.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  )}
                </Paged>
                <p className="flex items-start gap-2 border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-500">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                  Biaya produksi = bahan + sub-rakitan + tenaga kerja, ditambah persentase
                  miskalkulasi. Rate yang tidak diisi mengikuti harga standar katalog, atau harga
                  beli terakhir; saat BOM dirilis, rate-nya dikunci. Komponen tanpa rate tidak
                  dihitung nol — totalnya ditandai belum lengkap. <strong>Bukan harga jual.</strong>
                </p>
              </Card>
            </>
          );
        }}
      </Loaded>

      {(open || creating) && (
        <ProductDrawer
          productCode={open}
          onClose={() => { setOpen(null); setCreating(false); }}
          onChanged={reload}
        />
      )}
    </div>
  );
}
