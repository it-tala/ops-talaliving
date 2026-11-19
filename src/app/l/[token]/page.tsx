"use client";

import { use } from "react";
import Link from "next/link";
import { MapPin, CalendarDays, Tag, ArrowRight } from "lucide-react";
import { Badge, Card } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { inventory } from "@/demo/api";
import { useBrand } from "@/lib/brand";
import { formatDate } from "@/lib/format";
import { useTr } from "@/lib/i18n";
import { ASSET_OWNERSHIP_LABELS, type LabelCard } from "@/services/inventory/contracts";

/** What a label's QR opens: a card, for whoever holds the label (D322).
 *
 *  Outside `(app)` on purpose: that layout sends anyone without a session to
 *  sign in, and the owner asked for the QR to open *tanpa login*. The token
 *  in the address is random per record (`0179`), so the page shows only what
 *  the label's holder is meant to see, and the database decides even that:
 *  what the thing is and where it belongs. Nothing priced, nothing counted,
 *  nobody's name. Staff who are signed in go on to the full record.
 */
export default function LabelCardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const tr = useTr();
  const brand = useBrand();
  const [card] = useLoad(() => inventory.labelCard(token), [token]);

  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8">
      <div className="mx-auto max-w-md">
        <p className="mb-3 text-center text-[12px] font-semibold uppercase tracking-wide text-slate-500">{brand.name}</p>
        <Loaded state={card} onRetry={() => location.reload()}>
          {(c) => <CardBody c={c} />}
        </Loaded>
        <p className="mt-4 text-center text-[11px] text-slate-400">
          {tr("Opened from an inventory label.", "Dibuka dari label inventory.")}
        </p>
      </div>
    </div>
  );
}

function CardBody({ c }: { c: LabelCard }) {
  const tr = useTr();
  const own = c.extra.ownership && c.extra.ownership !== "owned" ? c.extra.ownership : null;
  const tag = c.kind === "asset"
    ? (own ? tr(ASSET_OWNERSHIP_LABELS[own].en, ASSET_OWNERSHIP_LABELS[own].id) : tr("Asset", "Aset"))
    : c.kind === "product" ? tr("Finished goods", "Barang jadi") : tr("Material", "Bahan");
  const size = [c.extra.length_mm, c.extra.width_mm, c.extra.height_mm].every((n) => n != null)
    ? `${c.extra.length_mm} × ${c.extra.width_mm} × ${c.extra.height_mm} mm` : c.extra.dimension_note ?? null;
  const detail = c.kind === "asset" ? `/inventory/assets?asset=${encodeURIComponent(c.code)}`
    : c.kind === "product" ? `/inventory/produk?product=${encodeURIComponent(c.code)}`
    : `/inventory/material?item=${encodeURIComponent(c.code)}`;

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[20px] font-bold text-slate-900">
            {c.display_code ?? c.code}
            {c.display_code && <span className="ml-2 text-[12px] font-normal text-slate-400">{c.code}</span>}
          </span>
          <Badge tone={own ? "violet" : "brand"}>{tag}</Badge>
        </div>
        <p className="mt-1 text-[16px] font-semibold text-slate-800">{c.name}</p>
        {c.name_local && <p className="text-[14px] text-slate-600">{c.name_local}</p>}
        {c.description && <p className="mt-1 text-[13px] text-slate-600">{c.description}</p>}
      </div>
      <dl className="space-y-2.5 px-5 py-4 text-[14px]">
        {c.category && (
          <div className="flex items-start gap-2">
            <Tag className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <span className="text-slate-700">{c.category}{size && ` · ${size}`}</span>
          </div>
        )}
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <span className="text-slate-700">
            {c.locations.length ? c.locations.join(" · ") : tr("No location recorded", "Belum ada lokasi tercatat")}
          </span>
        </div>
        <div className="flex items-start gap-2">
          <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <span className="text-slate-700">
            {tr("Registered", "Didaftarkan")} {c.registered_at ? formatDate(new Date(c.registered_at)) : "—"}
          </span>
        </div>
        {own && c.extra.contract_end && (
          <p className="rounded-lg bg-violet-50 px-3 py-2 text-[13px] text-violet-800">
            {tr(`${tag} until ${formatDate(new Date(c.extra.contract_end))}.`, `${tag} sampai ${formatDate(new Date(c.extra.contract_end))}.`)}
          </p>
        )}
      </dl>
      <Link href={detail}
            className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-[13px] font-medium text-brand-700 hover:bg-brand-50/40">
        {tr("Staff: open the full record (sign-in)", "Staf: buka catatan lengkap (perlu login)")}
        <ArrowRight className="h-4 w-4" />
      </Link>
    </Card>
  );
}
