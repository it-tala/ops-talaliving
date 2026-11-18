"use client";

import { useState } from "react";
import { ClipboardPlus, PackagePlus, Boxes } from "lucide-react";
import { Button, Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { inventory } from "@/demo/api";
import { formatNumber } from "@/lib/format";
import { useTr } from "@/lib/i18n";
import { useSession } from "@/store/session";
import type { StockItemView } from "@/services/inventory/contracts";
import { RegisterItem } from "../material/RegisterItem";
import { StockInput } from "../material/StockInput";

/** Counting what is counted, not checked one by one — materials, consumables,
 *  hand tools in bulk — in the zone being walked (D448).
 *
 *  Nothing new underneath: an entry is *Input stock* (`input_stock`, an
 *  `adjust` move at the zone, D348) and a name the catalogue lacks is
 *  *Register an item* (`register_item`, with its photos, 0168). Both forms are
 *  the ones `/inventory/material` uses, opened on this zone. The table is what
 *  the zone now holds, read from the moves; an entry is corrected in the
 *  item's history on *Materials & hardware*, as anywhere else.
 */
export function CountStock({ zone, zoneLabel }: { zone: string; zoneLabel: string }) {
  const tr = useTr();
  const { can } = useSession();
  const mayEnter = can("inventory.adjust");
  const mayRegister = can("inventory.create");
  const [catalogue, reload] = useLoad(() => inventory.listStock(), []);
  const [entering, setEntering] = useState(false);
  const [registering, setRegistering] = useState<{ name?: string } | false>(false);

  const columns: Column<StockItemView>[] = [
    {
      key: "item", header: tr("Item", "Barang"),
      render: (r) => (
        <div>
          <p className="font-medium text-slate-800">{r.item_name}</p>
          <p className="font-mono text-[11px] text-slate-400">{r.item_code}{r.item_name_local ? ` · ${r.item_name_local}` : ""}</p>
        </div>
      ),
    },
    { key: "cat", header: tr("Category", "Kategori"), render: (r) => <span className="text-slate-600">{r.category_name}</span> },
    {
      key: "qty", header: tr(`In ${zone}`, `Di ${zone}`), align: "right",
      render: (r) => (
        <span className="tabular-nums font-medium text-slate-800">
          {formatNumber(r.by_location.find((l) => l.location === zone)?.qty ?? 0)} {r.uom}
        </span>
      ),
    },
    {
      key: "total", header: tr("All locations", "Semua lokasi"), align: "right",
      render: (r) => <span className="tabular-nums text-slate-500">{formatNumber(r.on_hand)} {r.uom}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      {registering && (
        <RegisterItem
          key={registering.name ?? ""}
          mayCount={mayEnter}
          initialName={registering.name}
          defaultLocation={zone}
          onCancel={() => setRegistering(false)}
          onCreated={() => { setRegistering(false); reload(); }}
        />
      )}
      {entering && catalogue.status === "ready" && (
        <StockInput
          catalogue={catalogue.data}
          defaultLocation={zone}
          onSaved={() => reload()}
          onNewItem={(name) => setRegistering({ name })}
          onClose={() => setEntering(false)}
        />
      )}

      <Card>
        <CardHeader
          title={tr(`Counted in ${zoneLabel}`, `Terhitung di ${zoneLabel}`)}
          subtitle={tr(
            "Materials, consumables and hand tools in bulk are counted, not checked one by one. Each entry adds to the zone; correct one in the item's history.",
            "Bahan, consumable, dan alat tangan dalam jumlah banyak dihitung, tidak dicek satu per satu. Setiap input menambah jumlah di zona; koreksi di riwayat barangnya.",
          )}
          icon={Boxes}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <SourceBadge state={catalogue} />
              {mayRegister && !registering && (
                <Button size="sm" variant="secondary" icon={PackagePlus} onClick={() => setRegistering({})}>
                  {tr("Register an item", "Daftarkan barang")}
                </Button>
              )}
              {mayEnter && !entering && (
                <Button size="sm" icon={ClipboardPlus} onClick={() => setEntering(true)}>{tr("Input stock", "Input stok")}</Button>
              )}
            </div>
          }
        />
        {!mayEnter && (
          <p className="px-5 pb-2 text-xs text-slate-500">{tr("Entering a count needs the stock adjustment permission.", "Input hitungan butuh izin penyesuaian stok.")}</p>
        )}
        <Loaded state={catalogue} onRetry={reload}>
          {(rows) => {
            const here = rows.filter((r) => r.by_location.some((l) => l.location === zone && l.qty !== 0));
            return here.length === 0 ? (
              <div className="px-5 pb-5">
                <EmptyState icon={Boxes} title={tr("Nothing counted here yet", "Belum ada yang dihitung di sini")}
                  description={tr("Use Input stock to enter what is on the shelves in this zone.", "Pakai Input stok untuk mencatat apa yang ada di rak zona ini.")} />
              </div>
            ) : (
              <DataTable columns={columns} rows={here} rowKey={(r) => r.item_code} exportName={tr(`Counted in ${zone}`, `Terhitung di ${zone}`)} />
            );
          }}
        </Loaded>
      </Card>
    </div>
  );
}
