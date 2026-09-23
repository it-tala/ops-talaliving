"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ClipboardList, Factory, LineChart, Warehouse } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/status-pill";
import { formatIDR, formatNumber } from "@/lib/format";
import { inventory, procurement } from "@/demo/api";
import type { ItemPurchase, PrLineView } from "@/services/procurement/contracts";
import type { StockItemDetail } from "@/services/inventory/contracts";

/** Everything else the catalogue knows about one item (Master Data phase 5):
 *  what it has cost over time, who asked for it, how much of it is on the
 *  rack, and which products are built from it. Each half is fetched when the
 *  drawer opens and each fails on its own — a reader without production's
 *  grants still sees the requests. */

const sectionTitle = "mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500";

export function PriceTrend({ purchases }: { purchases: ItemPurchase[] }) {
  const points = useMemo(
    () => purchases
      .filter((p) => p.unit_price != null && p.unit_price > 0)
      .map((p) => ({ date: p.trx_date, price: p.unit_price as number, vendor: p.vendor_name, trx: p.trx_no }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.trx.localeCompare(b.trx)),
    [purchases],
  );
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return null;

  /* One series, so no legend: the section title names it. One y-scale. The
     x position is by time, not by index, so a gap of six months looks like
     one. */
  const W = 480, H = 132, L = 8, R = 8, T = 12, B = 22;
  const t0 = Date.parse(points[0].date), t1 = Date.parse(points[points.length - 1].date);
  const span = Math.max(t1 - t0, 1);
  const min = Math.min(...points.map((p) => p.price));
  const max = Math.max(...points.map((p) => p.price));
  const pad = max === min ? max * 0.1 || 1 : (max - min) * 0.12;
  const lo = Math.max(0, min - pad), hi = max + pad;
  /* By time — except when every purchase is on one day, where time says
     nothing and the points are spread evenly instead of stacked on a line. */
  const sameDay = t1 === t0;
  const x = (d: string, i: number) => (sameDay
    ? L + (i / (points.length - 1)) * (W - L - R)
    : L + ((Date.parse(d) - t0) / span) * (W - L - R));
  const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.date, i).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
  const first = points[0].price, last = points[points.length - 1].price;
  const change = Math.round(((last - first) / first) * 100);
  const h = hover == null ? null : points[hover];

  return (
    <section data-testid="item-price-trend">
      <p className={sectionTitle}><LineChart className="h-3.5 w-3.5" /> Unit price over time</p>
      <div className="relative rounded-lg border border-slate-200 px-2 pt-2">
        <svg
          viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full text-brand-600" role="img"
          aria-label={`Unit price from ${formatIDR(first)} on ${points[0].date} to ${formatIDR(last)} on ${points[points.length - 1].date}`}
          onMouseLeave={() => setHover(null)}
        >
          {[min, max].map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-slate-200" strokeWidth={1} />
            </g>
          ))}
          <path d={path} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) => (
            <g key={`${p.trx}-${i}`}>
              <circle cx={x(p.date, i)} cy={y(p.price)} r={4} fill="currentColor" className="stroke-white" strokeWidth={2} />
              {/* The hit target is bigger than the mark. */}
              <circle
                cx={x(p.date, i)} cy={y(p.price)} r={12} fill="transparent"
                onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0}
                aria-label={`${p.date}: ${formatIDR(p.price)}${p.vendor ? `, ${p.vendor}` : ""}`}
              />
            </g>
          ))}
          <text x={L} y={H - 6} className="fill-slate-400 text-[10px]">{points[0].date}</text>
          <text x={W - R} y={H - 6} textAnchor="end" className="fill-slate-400 text-[10px]">{points[points.length - 1].date}</text>
        </svg>
        {h && (
          <div
            className="pointer-events-none absolute -translate-x-1/2 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] shadow-sm"
            style={{ left: `${(x(h.date, hover ?? 0) / W) * 100}%`, top: 0 }}
          >
            <span className="block font-medium tabular-nums text-slate-800">{formatIDR(h.price)}</span>
            <span className="block text-slate-500">{h.date}{h.vendor ? ` · ${h.vendor}` : ""}</span>
          </div>
        )}
      </div>
      <p className="mt-1.5 text-[12px] text-slate-500">
        Lowest {formatIDR(min)} · highest {formatIDR(max)} · last {formatIDR(last)}
        {change !== 0 && <> · {change > 0 ? "+" : ""}{change}% since the first purchase</>}
      </p>
    </section>
  );
}

export function ItemRelations({ itemId, itemCode }: { itemId: string; itemCode: string }) {
  const [lines, setLines] = useState<PrLineView[] | null>(null);
  const [stock, setStock] = useState<StockItemDetail | null | undefined>(undefined);
  const [usedIn, setUsedIn] = useState<StockItemDetail["used_in"] | null>(null);

  useEffect(() => {
    let live = true;
    setLines(null); setStock(undefined); setUsedIn(null);
    void procurement.itemRequestLines(itemId).then((r) => { if (live) setLines(r.data ?? []); });
    /* Not every item is counted on a rack — a category bought and used the
       same day is not — and that answer is `null`, not an error. */
    void inventory.getStockItem(itemCode).then((r) => { if (live) setStock(r.data ?? null); });
    void inventory.itemUsedIn(itemCode).then((r) => { if (live) setUsedIn(r.data ?? []); });
    return () => { live = false; };
  }, [itemId, itemCode]);

  return (
    <>
      <section data-testid="item-requests">
        <p className={sectionTitle}><ClipboardList className="h-3.5 w-3.5" /> Requests for it</p>
        {lines === null ? (
          <p className="text-[13px] text-slate-400">Loading…</p>
        ) : lines.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-3 text-slate-500">
            Nobody has asked for this item on a request yet.
          </p>
        ) : (
          <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {lines.map((l) => (
              <li key={l.id} className="flex items-baseline justify-between gap-3 px-3 py-2 text-[13px]">
                <span className="min-w-0">
                  <span className="block truncate text-slate-700">{l.description}</span>
                  <span className="block font-mono text-[10px] text-slate-400">
                    {l.line_no_full} · {l.requested_by_name}{l.submitted_at ? ` · ${l.submitted_at.slice(0, 10)}` : ""}
                    {l.vendor_name ? ` · ${l.vendor_name}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <StatusPill kind="line" status={l.status} />
                  <span className="text-[11px] tabular-nums text-slate-500">
                    {l.qty ?? "—"} {l.uom ?? ""}{l.item_total ? ` · ${formatIDR(l.item_total)}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {stock && (
        <section data-testid="item-stock">
          <p className={sectionTitle}><Warehouse className="h-3.5 w-3.5" /> On the rack</p>
          <div className="rounded-lg border border-slate-200 px-3 py-2.5 text-[13px]">
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold tabular-nums text-slate-800">{formatNumber(stock.on_hand)} {stock.uom}</span>
              {stock.below_min && <Badge tone="amber">below minimum{stock.min_qty != null ? ` (${formatNumber(stock.min_qty)})` : ""}</Badge>}
              {stock.on_order.length > 0 && (
                <Badge tone="brand">{formatNumber(stock.on_order.reduce((s, o) => s + o.qty, 0))} on order</Badge>
              )}
            </p>
            {stock.by_location.length > 0 && (
              <p className="mt-0.5 text-[11px] text-slate-500">
                {stock.by_location.map((b) => `${b.location_name} ${formatNumber(b.qty)}`).join(" · ")}
              </p>
            )}
            {stock.moves.length > 0 && (
              <ul className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                {stock.moves.slice(0, 5).map((m) => (
                  <li key={m.id} className="flex justify-between gap-3 text-[12px]">
                    <span className="min-w-0 truncate text-slate-600">
                      <span className="font-mono text-[10px] text-slate-400">{m.moved_at.slice(0, 10)}</span>{" "}
                      {m.kind.toLowerCase()} · {m.location_name}{m.ref_no ? ` · ${m.ref_no}` : ""}
                    </span>
                    <span className={m.qty < 0 ? "tabular-nums text-rose-700" : "tabular-nums text-emerald-700"}>
                      {m.qty > 0 ? "+" : ""}{formatNumber(m.qty)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/inventory/material" className="mt-2 inline-block text-[12px] text-brand-700 hover:underline">
              Open in Materials &amp; hardware
            </Link>
          </div>
        </section>
      )}

      <section data-testid="item-used-in">
        <p className={sectionTitle}><Factory className="h-3.5 w-3.5" /> Used in products</p>
        {usedIn === null ? (
          <p className="text-[13px] text-slate-400">Loading…</p>
        ) : usedIn.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50/60 px-3 py-3 text-slate-500">
            No product&apos;s current BOM calls for this item.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {usedIn.map((u) => (
              <li key={u.product_code} className="flex items-baseline justify-between gap-3 px-3 py-2 text-[13px]">
                <span className="min-w-0 truncate text-slate-700">
                  {u.product_name} <span className="font-mono text-[10px] text-slate-400">{u.product_code}</span>
                </span>
                <span className="shrink-0 tabular-nums text-slate-600">{formatNumber(u.qty_per_unit)} per unit</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
