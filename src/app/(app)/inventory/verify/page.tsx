"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ClipboardCheck, ListChecks, Search } from "lucide-react";
import { Button, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Loaded, useDebounced, useLoad } from "@/components/ui/loaded";
import { inventory } from "@/demo/api";
import { cn } from "@/lib/cn";
import { pick, useLang, useTr } from "@/lib/i18n";
import {
  VERIFICATION_STATUS_LABELS, type AssetVerificationRow, type VerificationStatus,
} from "@/services/inventory/contracts";
import { NO_ZONE, RecordPhoto, STATUS_ORDER, StatusBadge, zoneOf } from "./shared";

/** Asset verification — the list by zone (D447).
 *
 *  Production has stopped and the company is recapping what it owns. A
 *  checker picks a zone on the left, sees its assets as cards with their
 *  status, and opens one to check it. Imported machines start with no
 *  location, so *No location* is where most of the work begins.
 *
 *  Tablet landscape first (about 1180×820): the rail and three cards a row;
 *  on a phone the rail becomes a row of chips above the cards.
 *
 *  Zone and tab live in the address (`?zone=PRD&status=mismatch`), so *back*
 *  from the verify screen lands on the same zone, and *Save & next* walks the
 *  same list.
 */
type Tab = "all" | VerificationStatus;

export default function VerifyListPage() {
  const tr = useTr();
  const lang = useLang();
  const router = useRouter();
  const params = useSearchParams();
  const zone = params.get("zone") ?? "all";
  const tab = (params.get("status") ?? "all") as Tab;
  const [q, setQ] = useState(params.get("q") ?? "");
  const searched = useDebounced(q);

  const [state, reload] = useLoad(() => inventory.listAssetVerification(), []);
  const [locs] = useLoad(() => inventory.listStockLocations({ all: true }), []);

  function go(next: { zone?: string; status?: Tab }) {
    const sp = new URLSearchParams(params.toString());
    if (next.zone !== undefined) { if (next.zone === "all") sp.delete("zone"); else sp.set("zone", next.zone); }
    if (next.status !== undefined) { if (next.status === "all") sp.delete("status"); else sp.set("status", next.status); }
    router.replace(`/inventory/verify${sp.size ? `?${sp}` : ""}`, { scroll: false });
  }

  const locName = (code: string) =>
    (locs.status === "ready" ? locs.data.find((l) => l.code === code)?.name : undefined) ?? code;

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Inventory", "Persediaan")}
        title={tr("Asset verification", "Verifikasi aset")}
        description={tr(
          "Go to a zone, open an asset, check it against the real thing, photograph it, save, next.",
          "Datangi zona, buka aset, cocokkan dengan barang aslinya, foto, simpan, lanjut.",
        )}
        actions={
          <Link href="/inventory/verify/review">
            <Button variant="secondary" icon={ListChecks}>{tr("Mismatch summary", "Ringkasan ketidaksesuaian")}</Button>
          </Link>
        }
      />

      <Loaded state={state} onRetry={reload}>
        {(all) => (
          <VerifyBoard
            rows={all} zone={zone} tab={tab} q={searched} setQ={setQ} qValue={q}
            onZone={(z) => go({ zone: z })} onTab={(t) => go({ status: t })}
            locName={locName} lang={lang} tr={tr} query={params.toString()}
          />
        )}
      </Loaded>
    </div>
  );
}

function VerifyBoard({ rows, zone, tab, q, qValue, setQ, onZone, onTab, locName, lang, tr, query }: {
  rows: AssetVerificationRow[]; zone: string; tab: Tab; q: string; qValue: string; setQ: (v: string) => void;
  onZone: (z: string) => void; onTab: (t: Tab) => void; locName: (code: string) => string;
  lang: "en" | "id"; tr: (en: string, id: string) => string; query: string;
}) {
  const searchedRows = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) => [r.asset_no, r.legacy_code, r.name, r.brand, r.model].some((x) => x?.toLowerCase().includes(term)));
  }, [rows, q]);

  const verified = rows.filter((r) => r.status !== "unverified").length;

  /* The rail: every zone that holds an asset, plus All and No location. */
  const zones = useMemo(() => {
    const by = new Map<string, { total: number; done: number }>();
    for (const r of rows) {
      const z = zoneOf(r);
      const cur = by.get(z) ?? { total: 0, done: 0 };
      cur.total += 1;
      if (r.status !== "unverified") cur.done += 1;
      by.set(z, cur);
    }
    const none = by.get(NO_ZONE) ?? { total: 0, done: 0 };
    by.delete(NO_ZONE);
    return {
      none,
      list: [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, c]) => ({ code, ...c })),
    };
  }, [rows]);

  const inZone = searchedRows.filter((r) => zone === "all" || zoneOf(r) === zone);
  const count = (t: Tab) => (t === "all" ? inZone.length : inZone.filter((r) => r.status === t).length);
  const shown = tab === "all" ? inZone : inZone.filter((r) => r.status === tab);
  const zoneTitle = zone === "all" ? tr("All zones", "Semua zona")
    : zone === NO_ZONE ? tr("No location", "Tanpa lokasi") : `${zone} · ${locName(zone)}`;

  const railItem = (code: string, label: string, done: number, total: number) => (
    <button
      key={code} type="button" onClick={() => onZone(code)}
      className={cn(
        "flex w-full shrink-0 flex-col gap-1 rounded-lg px-2.5 py-2 text-left text-[13px] text-slate-800 transition-colors md:shrink",
        zone === code ? "bg-brand-50 shadow-[inset_2px_0_0] shadow-brand-600" : "hover:bg-slate-50",
        "min-w-[9rem] md:min-w-0",
      )}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium">{label}</span>
        <span className="shrink-0 tabular-nums text-[11px] text-slate-500">{done}/{total}</span>
      </span>
      <span className="block h-1 overflow-hidden rounded-full bg-slate-100">
        <span
          className={cn("block h-full rounded-full", done === total && total > 0 ? "bg-emerald-600" : "bg-brand-600")}
          style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }}
        />
      </span>
    </button>
  );

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block w-full sm:max-w-sm">
          <span className="sr-only">{tr("Search", "Cari")}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={qValue} onChange={(e) => setQ(e.target.value)} type="search"
            placeholder={tr("Asset no, old code, name, brand, model", "No aset, kode lama, nama, merek, model")}
            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm focus:border-brand-400 focus:outline-none"
          />
        </label>
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <span className="font-medium tabular-nums">
            {tr(`${verified} of ${rows.length} verified`, `${verified} dari ${rows.length} terverifikasi`)}
          </span>
          <span className="block h-2 w-32 overflow-hidden rounded-full bg-slate-100">
            <span className="block h-full rounded-full bg-brand-600" style={{ width: `${rows.length ? Math.round((verified / rows.length) * 100) : 0}%` }} />
          </span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[13rem_minmax(0,1fr)] lg:grid-cols-[15rem_minmax(0,1fr)]">
        <Card className="p-2">
          <p className="px-2.5 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{tr("Zones", "Zona")}</p>
          <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible" aria-label={tr("Zones", "Zona")}>
            {railItem("all", tr("All zones", "Semua zona"), verified, rows.length)}
            {zones.none.total > 0 && railItem(NO_ZONE, tr("No location", "Tanpa lokasi"), zones.none.done, zones.none.total)}
            {zones.list.map((z) => railItem(z.code, `${z.code} · ${locName(z.code)}`, z.done, z.total))}
          </nav>
        </Card>

        <div className="min-w-0">
          <div className="mb-3 flex flex-col gap-2 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-800">{zoneTitle}</h2>
              <p className="text-xs text-slate-500">{tr("Click an item to verify it.", "Klik item untuk memverifikasi.")}</p>
            </div>
            <div role="tablist" className="flex flex-wrap gap-1">
              {(["all", ...STATUS_ORDER] as Tab[]).map((t) => (
                <button
                  key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => onTab(t)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    tab === t ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                  )}
                >
                  {t === "all" ? tr("All", "Semua") : pick(VERIFICATION_STATUS_LABELS[t], lang)}
                  <span className="ml-1.5 tabular-nums opacity-75">{count(t)}</span>
                </button>
              ))}
            </div>
          </div>

          {shown.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title={tr("Nothing here", "Tidak ada item")}
              description={tr("No asset in this zone matches the filter.", "Tidak ada aset di zona ini yang cocok dengan filter.")}
            />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((r) => (
                <li key={r.asset_no}>
                  <Link
                    href={`/inventory/verify/${encodeURIComponent(r.asset_no)}${query ? `?${query}` : ""}`}
                    className="group block overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  >
                    <span className="relative block">
                      <RecordPhoto attachmentId={r.record_photo_id} alt={r.name} className="aspect-[4/3] w-full" />
                      <StatusBadge status={r.status} className="absolute left-2 top-2 bg-white" />
                    </span>
                    <span className="block px-3 py-2.5">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="font-mono text-[12px] font-semibold text-slate-800">{r.asset_no}</span>
                        {r.legacy_code && (
                          <span className="text-[11px] text-slate-500">{tr(`Old: ${r.legacy_code}`, `Lama: ${r.legacy_code}`)}</span>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-sm font-medium text-slate-800" title={r.name}>{r.name}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {[r.brand, r.model].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
