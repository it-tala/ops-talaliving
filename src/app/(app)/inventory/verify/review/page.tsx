"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Boxes, CheckCircle2, ClipboardCheck, ListChecks, SearchX, Sparkles, TriangleAlert } from "lucide-react";
import { Button, Card, CardHeader, PageHeader, StatCard } from "@/components/ui/primitives";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/drawer";
import { Loaded, SourceBadge, useLoad } from "@/components/ui/loaded";
import { inventory } from "@/demo/api";
import { formatNumber } from "@/lib/format";
import { pick, useLang, useTr } from "@/lib/i18n";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import {
  ASSET_CONDITION_LABELS, VERIFY_FIELDS, VERIFY_FIELD_LABELS, type AssetVerificationRow,
} from "@/services/inventory/contracts";
import { NO_ZONE, RecordPhoto, StatusBadge, zoneOf } from "../shared";

/** Asset verification — the mismatch summary (D447).
 *
 *  Everything a check found wrong, in one list: the fields that differ
 *  (*Brand: ~~MAS~~ → HUA HUA*), the condition and where it was found, who
 *  checked it and when. From here, and only here, a correction reaches the
 *  asset: *Apply correction* writes what was found (`apply_verification`),
 *  and *Follow up* on a not-found asset marks it lost — both after a confirm,
 *  both on the asset's own history. A quantity found is reported, never
 *  written: an asset is one unit.
 *
 *  A `DataTable`, so the Excel download comes with it (D427).
 */
type ResultFilter = "problems" | "all" | "match" | "mismatch" | "not_found" | "new";

/** One counted item at one location, for the counted-stock table (D448). */
type CountedRow = { key: string; location: string; location_name: string; item_code: string; item_name: string; category_name: string; qty: number; uom: string };

export default function VerifyReviewPage() {
  const tr = useTr();
  const lang = useLang();
  const { can } = useSession();
  const { toast } = useToast();
  const mayApply = can("inventory.update");
  const [state, reload] = useLoad(() => inventory.listAssetVerification(), []);
  const [locs] = useLoad(() => inventory.listStockLocations({ all: true }), []);
  const [zone, setZone] = useState("all");
  const [result, setResult] = useState<ResultFilter>("problems");
  const [confirm, setConfirm] = useState<AssetVerificationRow | null>(null);
  const [busy, setBusy] = useState(false);

  const locName = (code: string) =>
    (locs.status === "ready" ? locs.data.find((l) => l.code === code)?.name : undefined) ?? code;

  async function apply() {
    if (!confirm?.verification_no) return;
    setBusy(true);
    const res = await inventory.applyVerification(confirm.verification_no);
    setBusy(false);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not applied", "Tidak diterapkan"), res.error.message);
      return;
    }
    const skipped = res.data.not_applied.length
      ? tr(" The quantity found is not written: an asset is one unit.", " Jumlah yang ditemukan tidak ditulis: satu aset adalah satu unit.")
      : "";
    toast("success",
      confirm.status === "not_found"
        ? tr(`${confirm.asset_no} marked lost`, `${confirm.asset_no} ditandai hilang`)
        : tr(`${confirm.asset_no} corrected`, `${confirm.asset_no} dikoreksi`),
      tr(`From ${confirm.verification_no}; it is on the asset's history.`, `Dari ${confirm.verification_no}; tercatat di riwayat aset.`) + skipped);
    setConfirm(null);
    reload();
  }

  const columns: Column<AssetVerificationRow>[] = [
    {
      key: "item", header: tr("Item", "Item"),
      render: (r) => (
        <div className="flex items-center gap-3">
          <RecordPhoto attachmentId={r.record_photo_id} alt={r.name} width={120} className="h-12 w-12 shrink-0 rounded-lg" />
          <div className="min-w-0">
            <Link href={`/inventory/verify/${encodeURIComponent(r.asset_no)}`} className="font-mono text-[12px] font-semibold text-brand-700 hover:underline">
              {r.asset_no}
            </Link>
            <p className="truncate font-medium text-slate-800">{r.name}</p>
            {r.legacy_code && <p className="text-[11px] text-slate-500">{tr(`Old: ${r.legacy_code}`, `Lama: ${r.legacy_code}`)}</p>}
          </div>
        </div>
      ),
    },
    { key: "result", header: tr("Result", "Hasil"), render: (r) => <StatusBadge status={r.status} /> },
    {
      key: "diff", header: tr("Differences", "Perbedaan"),
      render: (r) => {
        const rows = VERIFY_FIELDS.filter((f) => r.checks?.[f]?.ok === false);
        if (r.status === "not_found") return <span className="text-[13px] text-slate-600">{r.note}</span>;
        if (!rows.length) return <span className="text-slate-300">—</span>;
        const before = (f: (typeof VERIFY_FIELDS)[number]) => (f === "qty" ? "1" : f === "name" ? r.name : (f === "brand" ? r.brand : r.model) ?? "—");
        return (
          <ul className="space-y-0.5 text-[13px]">
            {rows.map((f) => (
              <li key={f}>
                <span className="text-slate-500">{pick(VERIFY_FIELD_LABELS[f], lang)}: </span>
                {/* Once applied, the record already says the new value. */}
                {!r.applied_at && <><s className="text-slate-400">{before(f)}</s>{" → "}</>}
                <span className="font-medium text-slate-800">{r.checks?.[f]?.found}</span>
              </li>
            ))}
          </ul>
        );
      },
    },
    {
      key: "where", header: tr("Condition · location", "Kondisi · lokasi"),
      render: (r) => (
        <span className="text-[13px] text-slate-700">
          {[r.condition && pick(ASSET_CONDITION_LABELS[r.condition], lang), r.verified_location && `${r.verified_location} · ${locName(r.verified_location)}`]
            .filter(Boolean).join(" · ") || "—"}
        </span>
      ),
    },
    {
      key: "by", header: tr("Verified by · time", "Diverifikasi oleh · waktu"),
      render: (r) => (
        <span className="text-[13px] text-slate-700">
          {r.verified_by_name ?? "—"}
          {r.verified_at && (
            <span className="block text-[11px] text-slate-500">{new Date(r.verified_at).toLocaleString(lang === "id" ? "id-ID" : "en-GB")}</span>
          )}
        </span>
      ),
    },
    {
      key: "action", header: "", align: "right", export: false,
      render: (r) => {
        if (r.applied_at) {
          return (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {r.status === "not_found" ? tr("Marked lost", "Ditandai hilang") : tr("Applied", "Diterapkan")}
            </span>
          );
        }
        if (r.status === "match" || r.status === "unverified" || r.status === "new" || !mayApply) return null;
        return (
          <Button size="sm" variant={r.status === "not_found" ? "outline" : "secondary"} onClick={() => setConfirm(r)}>
            {r.status === "not_found" ? tr("Follow up", "Tindak lanjut") : tr("Apply correction", "Terapkan koreksi")}
          </Button>
        );
      },
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumb={tr("Inventory · Asset verification", "Persediaan · Verifikasi aset")}
        title={tr("Mismatch summary", "Ringkasan ketidaksesuaian")}
        description={tr(
          "What the checks found wrong. A correction reaches the asset only from here, and only when someone applies it.",
          "Apa saja yang ditemukan tidak sesuai. Koreksi hanya sampai ke aset dari sini, dan hanya bila seseorang menerapkannya.",
        )}
        actions={
          <Link href="/inventory/verify">
            <Button variant="outline" icon={ArrowLeft}>{tr("Asset verification", "Verifikasi aset")}</Button>
          </Link>
        }
      />
      <Loaded state={state} onRetry={reload}>
        {(all) => (
          <ReviewBody
            all={all} zone={zone} setZone={setZone} result={result} setResult={setResult}
            columns={columns} locName={locName} tr={tr} state={state}
          />
        )}
      </Loaded>

      <Modal
        open={!!confirm} onClose={() => setConfirm(null)}
        title={confirm?.status === "not_found"
          ? tr(`Mark ${confirm?.asset_no} as lost?`, `Tandai ${confirm?.asset_no} hilang?`)
          : tr(`Apply the correction to ${confirm?.asset_no}?`, `Terapkan koreksi ke ${confirm?.asset_no}?`)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>{tr("Cancel", "Batal")}</Button>
            <Button variant={confirm?.status === "not_found" ? "danger" : "primary"} disabled={busy} onClick={apply}>
              {confirm?.status === "not_found" ? tr("Mark lost", "Tandai hilang") : tr("Apply correction", "Terapkan koreksi")}
            </Button>
          </div>
        }
      >
        {confirm && (confirm.status === "not_found" ? (
          <p className="text-sm text-slate-600">
            {tr(
              `${confirm.asset_no} (${confirm.name}) leaves the register as lost, dated the day it was looked for. It can be brought back from Assets if it turns up.`,
              `${confirm.asset_no} (${confirm.name}) keluar dari daftar sebagai hilang, bertanggal hari pencariannya. Bisa dikembalikan dari Aset bila ditemukan.`,
            )}
          </p>
        ) : (
          <div className="space-y-2 text-sm text-slate-600">
            <p>{tr("The asset record will say:", "Data aset akan menjadi:")}</p>
            <ul className="space-y-1">
              {VERIFY_FIELDS.filter((f) => f !== "qty" && confirm.checks?.[f]?.ok === false).map((f) => (
                <li key={f}><span className="text-slate-500">{pick(VERIFY_FIELD_LABELS[f], lang)}:</span> <span className="font-medium text-slate-800">{confirm.checks?.[f]?.found}</span></li>
              ))}
              {confirm.verified_location && confirm.verified_location !== confirm.asset_location && (
                <li><span className="text-slate-500">{tr("Location", "Lokasi")}:</span> <span className="font-medium text-slate-800">{confirm.verified_location} · {locName(confirm.verified_location)}</span></li>
              )}
            </ul>
            {confirm.checks?.qty?.ok === false && (
              <p className="text-xs text-amber-700">{tr(
                `Quantity found (${confirm.checks.qty.found}) is not written: one asset is one unit. Register the others separately.`,
                `Jumlah ditemukan (${confirm.checks.qty.found}) tidak ditulis: satu aset satu unit. Daftarkan sisanya terpisah.`,
              )}</p>
            )}
          </div>
        ))}
      </Modal>
    </div>
  );
}

function ReviewBody({ all, zone, setZone, result, setResult, columns, locName, tr, state }: {
  all: AssetVerificationRow[]; zone: string; setZone: (z: string) => void;
  result: ResultFilter; setResult: (r: ResultFilter) => void;
  columns: Column<AssetVerificationRow>[]; locName: (c: string) => string;
  tr: (en: string, id: string) => string; state: Parameters<typeof SourceBadge>[0]["state"];
}) {
  const zones = useMemo(() => [...new Set(all.map(zoneOf))].sort(), [all]);
  const inZone = all.filter((r) => zone === "all" || zoneOf(r) === zone);
  const verified = inZone.filter((r) => r.status !== "unverified");
  const n = (s: string) => verified.filter((r) => r.status === s).length;
  const rows = verified.filter((r) =>
    result === "all" ? true
      : result === "problems" ? r.status === "mismatch" || r.status === "not_found"
        : r.status === result);
  const select = "h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-700 focus:border-brand-400 focus:outline-none";

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label={tr("Verified", "Terverifikasi")} value={verified.length} icon={ClipboardCheck}
          hint={tr(`of ${inZone.length} assets`, `dari ${inZone.length} aset`)} />
        <StatCard label={tr("Match", "Sesuai")} value={n("match")} icon={CheckCircle2} tone="green" />
        <StatCard label={tr("Mismatch", "Tidak sesuai")} value={n("mismatch")} icon={TriangleAlert} tone="amber" />
        <StatCard label={tr("Not found", "Tidak ditemukan")} value={n("not_found")} icon={SearchX} tone="red" />
        <StatCard label={tr("New", "Baru")} value={n("new")} icon={Sparkles} tone="brand"
          hint={tr("Found, not on record", "Ditemukan, belum tercatat")} />
      </div>
      <Card>
        <CardHeader
          title={tr("Checks", "Hasil cek")}
          subtitle={tr("The latest check per asset. A recheck replaces it here; the older one stays in the record.", "Cek terakhir per aset. Cek ulang menggantikannya di sini; yang lama tetap tercatat.")}
          icon={ListChecks}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <SourceBadge state={state} />
              <select aria-label={tr("Zone", "Zona")} value={zone} onChange={(e) => setZone(e.target.value)} className={select}>
                <option value="all">{tr("All zones", "Semua zona")}</option>
                {zones.map((z) => (
                  <option key={z} value={z}>{z === NO_ZONE ? tr("No location", "Tanpa lokasi") : `${z} · ${locName(z)}`}</option>
                ))}
              </select>
              <select aria-label={tr("Result", "Hasil")} value={result} onChange={(e) => setResult(e.target.value as ResultFilter)} className={select}>
                <option value="problems">{tr("Mismatch + Not found", "Tidak sesuai + Tidak ditemukan")}</option>
                <option value="all">{tr("All verified", "Semua terverifikasi")}</option>
                <option value="match">{tr("Match", "Sesuai")}</option>
                <option value="mismatch">{tr("Mismatch", "Tidak sesuai")}</option>
                <option value="not_found">{tr("Not found", "Tidak ditemukan")}</option>
                <option value="new">{tr("New (found during the recap)", "Baru (ditemukan saat rekap)")}</option>
              </select>
            </div>
          }
        />
        <DataTable
          columns={columns} rows={rows} rowKey={(r) => r.asset_no}
          exportName={tr("Asset verification", "Verifikasi aset")}
          empty={tr("Nothing to follow up under this filter.", "Tidak ada yang perlu ditindaklanjuti dengan filter ini.")}
        />
      </Card>
      <CountedStock zone={zone} tr={tr} />
    </>
  );
}

/** What was counted, per zone — materials, consumables, hand tools in bulk
 *  (D448). Read from the stock moves (`listStock`), one row per item and
 *  location, under the same zone filter as the checks above. */
function CountedStock({ zone, tr }: { zone: string; tr: (en: string, id: string) => string }) {
  const [stock, reload] = useLoad(() => inventory.listStock(), []);
  const columns: Column<CountedRow>[] = [
    { key: "loc", header: tr("Zone", "Zona"), render: (r) => <span className="text-slate-700">{r.location} · {r.location_name}</span> },
    {
      key: "item", header: tr("Item", "Barang"),
      render: (r) => (
        <div>
          <p className="font-medium text-slate-800">{r.item_name}</p>
          <p className="font-mono text-[11px] text-slate-400">{r.item_code}</p>
        </div>
      ),
    },
    { key: "cat", header: tr("Category", "Kategori"), render: (r) => <span className="text-slate-600">{r.category_name}</span> },
    { key: "qty", header: tr("Quantity", "Jumlah"), align: "right", render: (r) => <span className="tabular-nums font-medium">{formatNumber(r.qty)} {r.uom}</span> },
  ];
  return (
    <Card className="mt-6">
      <CardHeader
        title={tr("Counted stock", "Stok terhitung")}
        subtitle={tr("What each zone holds of the things that are counted rather than checked one by one.", "Isi tiap zona untuk barang yang dihitung, bukan dicek satu per satu.")}
        icon={Boxes}
        action={<SourceBadge state={stock} />}
      />
      <Loaded state={stock} onRetry={reload}>
        {(items) => {
          const rows: CountedRow[] = items.flatMap((i) => i.by_location
            .filter((l) => l.qty !== 0 && (zone === "all" || l.location === zone))
            .map((l) => ({
              key: `${l.location}:${i.item_code}`, location: l.location, location_name: l.location_name,
              item_code: i.item_code, item_name: i.item_name, category_name: i.category_name, qty: l.qty, uom: i.uom,
            })))
            .sort((a, b) => a.location.localeCompare(b.location) || a.item_name.localeCompare(b.item_name));
          return (
            <DataTable columns={columns} rows={rows} rowKey={(r) => r.key}
              exportName={tr("Counted stock", "Stok terhitung")}
              empty={tr("Nothing counted in this zone yet.", "Belum ada yang dihitung di zona ini.")} />
          );
        }}
      </Loaded>
    </Card>
  );
}
