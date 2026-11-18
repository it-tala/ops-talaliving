"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, SearchX } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui/primitives";
import { Modal } from "@/components/ui/drawer";
import { SegmentedControl } from "@/components/ui/tabs";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { inventory } from "@/demo/api";
import { cn } from "@/lib/cn";
import { pick, useLang, useTr } from "@/lib/i18n";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import {
  ASSET_CONDITION_LABELS, VERIFY_FIELDS, VERIFY_FIELD_LABELS, verificationResultOf,
  type AssetCondition, type AssetVerificationRow, type FieldCheck, type StockLocation,
  type VerificationChecks, type VerificationStatus, type VerifyField,
} from "@/services/inventory/contracts";
import { decodeLegacyCode } from "@/services/inventory/legacy";
import { LegacyPanel, NO_ZONE, PhotoSlots, RecordPhoto, StatusBadge, differentFields, uploadSlotPhotos, usePhotoSlots, zoneOf } from "../shared";

/** Asset verification — one asset, checked against the real thing (D447).
 *
 *  Built for the under-thirty-seconds case on a tablet: open it, tick four
 *  fields, take one photo, *Save & next*. Each field is *Match* or
 *  *Different*; *Different* opens *Should be*, prefilled with what the record
 *  says so a one-letter correction is one letter. The whole-machine photo is
 *  required, as the database holds (`verify_asset`); name plate and two
 *  others are optional.
 *
 *  Saving never touches the asset: it records a verification. Corrections
 *  are applied from the summary (`apply_verification`), on purpose.
 *
 *  The list the checker came from (`?zone=…&status=…`) is carried along, so
 *  *Item 13 of 40*, previous/next and *Save & next* walk that same list.
 */
type Checks = Partial<Record<VerifyField, { ok: boolean; found: string }>>;


export default function VerifyAssetPage({ params }: { params: Promise<{ asset_no: string }> }) {
  const { asset_no } = use(params);
  const assetNo = decodeURIComponent(asset_no);
  const [row, reloadRow] = useLoad(() => inventory.getAssetVerification(assetNo), [assetNo]);
  const [list] = useLoad(() => inventory.listAssetVerification(), []);
  const [locs] = useLoad(() => inventory.listStockLocations(), []);
  return (
    <Loaded state={row} onRetry={reloadRow}>
      {(r) => (
        <VerifyForm
          key={`${r.asset_no}:${r.verification_no ?? "-"}`}
          row={r}
          list={list.status === "ready" ? list.data : null}
          locations={locs.status === "ready" ? locs.data : []}
          onSaved={reloadRow}
        />
      )}
    </Loaded>
  );
}

function VerifyForm({ row, list, locations, onSaved }: {
  row: AssetVerificationRow; list: AssetVerificationRow[] | null; locations: StockLocation[]; onSaved: () => void;
}) {
  const tr = useTr();
  const lang = useLang();
  const router = useRouter();
  const params = useSearchParams();
  const { can } = useSession();
  const { toast } = useToast();
  const mayVerify = can("inventory.update");
  const query = params.toString();
  const zone = params.get("zone");
  const statusFilter = params.get("status") as VerificationStatus | null;

  /* The list this asset was opened from, in the order the cards showed it. */
  const walk = useMemo(() => {
    if (!list) return null;
    return list.filter((r) => (!zone || zoneOf(r) === zone) && (!statusFilter || r.status === statusFilter));
  }, [list, zone, statusFilter]);
  const at = walk ? walk.findIndex((r) => r.asset_no === row.asset_no) : -1;
  /* How many machines share this 2013 family (`unit 3 of 8`). */
  const family = decodeLegacyCode(row.legacy_code)?.family;
  const familySize = family && list ? list.filter((r) => decodeLegacyCode(r.legacy_code)?.family === family).length : undefined;
  const prev = walk && at > 0 ? walk[at - 1] : null;
  const next = walk && at >= 0 && at < walk.length - 1 ? walk[at + 1] : null;
  const href = (no: string) => `/inventory/verify/${encodeURIComponent(no)}${query ? `?${query}` : ""}`;
  const backHref = `/inventory/verify${query ? `?${query}` : ""}`;

  const recordValue: Record<VerifyField, string> = {
    name: row.name, brand: row.brand ?? "", model: row.model ?? "", qty: "1",
  };

  const [checks, setChecks] = useState<Checks>({});
  const [condition, setCondition] = useState<AssetCondition | "">("");
  /* Where the checker is standing: the zone being worked, else where it was
     found last time, else where the record puts it. */
  const zoneDefault = zone && zone !== NO_ZONE ? zone : row.verified_location ?? row.asset_location ?? "";
  const [location, setLocation] = useState(locations.some((l) => l.code === zoneDefault) ? zoneDefault : "");
  useEffect(() => {
    if (!location && zoneDefault && locations.some((l) => l.code === zoneDefault)) setLocation(zoneDefault);
  }, [locations, zoneDefault, location]);
  const [note, setNote] = useState("");
  const { photos, setPhoto, hasWhole, taken } = usePhotoSlots();
  const [busy, setBusy] = useState<string | null>(null);
  const [notFoundOpen, setNotFoundOpen] = useState(false);
  const [notFoundNote, setNotFoundNote] = useState("");
  const [key] = useState(() => `verify-${row.asset_no}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);


  function mark(field: VerifyField, ok: boolean) {
    setChecks((c) => ({ ...c, [field]: { ok, found: c[field]?.found ?? recordValue[field] } }));
  }

  const asChecks = (): VerificationChecks => Object.fromEntries(
    VERIFY_FIELDS.filter((f) => checks[f]).map((f) => {
      const c = checks[f]!;
      const v: FieldCheck = c.ok ? { ok: true } : { ok: false, found: c.found.trim() };
      return [f, v];
    }),
  );
  const derived = verificationResultOf(asChecks());
  const unchecked = VERIFY_FIELDS.filter((f) => !checks[f]).length;
  const emptyFound = VERIFY_FIELDS.some((f) => checks[f] && !checks[f]!.ok && !checks[f]!.found.trim());
  const ready = mayVerify && derived != null && !emptyFound && hasWhole && !!condition && !!location && !busy;

  async function upload(): Promise<string[] | null> {
    return uploadSlotPhotos(taken, { entity: "asset_verification", entity_no: row.asset_no }, tr,
      (m) => setBusy(m), (title, msg) => { setBusy(null); toast("warning", title, msg); });
  }

  async function save(thenNext: boolean) {
    if (!ready || !derived) return;
    const ids = await upload();
    if (!ids) return;
    setBusy(tr("Saving…", "Menyimpan…"));
    const res = await inventory.verifyAsset({
      asset_no: row.asset_no, result: derived, condition: condition || null, location,
      checks: asChecks(), note: note.trim() || null, photo_ids: ids,
    }, key);
    setBusy(null);
    if (res.error) {
      toast(res.error.status === 403 ? "critical" : "warning", tr("Not saved", "Tidak tersimpan"), res.error.message);
      return;
    }
    toast("success", tr(`${row.asset_no} saved`, `${row.asset_no} tersimpan`),
      derived === "match" ? tr("Everything matches.", "Semua sesuai.")
        : tr(`Mismatch: ${differentFields(asChecks(), "en").join(", ")}.`, `Tidak sesuai: ${differentFields(asChecks(), "id").join(", ")}.`));
    if (thenNext && next) router.push(href(next.asset_no));
    else if (thenNext) router.push(backHref);
    else onSaved();
  }

  async function saveNotFound() {
    if (!notFoundNote.trim()) return;
    setBusy(tr("Saving…", "Menyimpan…"));
    const res = await inventory.verifyAsset({
      asset_no: row.asset_no, result: "not_found", condition: null, location: null,
      checks: {}, note: notFoundNote.trim(), photo_ids: [],
    }, `${key}-nf`);
    setBusy(null);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    setNotFoundOpen(false);
    toast("success", tr(`${row.asset_no} marked not found`, `${row.asset_no} ditandai tidak ditemukan`),
      tr("It is in the summary for follow-up. The asset itself is unchanged.", "Masuk ringkasan untuk ditindaklanjuti. Asetnya sendiri tidak berubah."));
    if (next) router.push(href(next.asset_no)); else router.push(backHref);
  }

  const pill = derived === "match"
    ? <Badge tone="green" dot>{tr("Match", "Sesuai")}</Badge>
    : derived === "mismatch"
      ? <Badge tone="amber" dot>{tr(`Mismatch: ${differentFields(asChecks(), "en").join(", ")}`, `Tidak sesuai: ${differentFields(asChecks(), "id").join(", ")}`)}</Badge>
      : <Badge tone="slate" dot>{tr(`${unchecked} fields unchecked`, `${unchecked} kolom belum dicek`)}</Badge>;

  const segBtn = (active: boolean, tone: "green" | "amber") => cn(
    "min-w-[5.5rem] rounded-md px-3 py-2 text-sm font-medium transition-colors",
    active
      ? tone === "green" ? "bg-emerald-600 text-white shadow-sm" : "bg-amber-500 text-white shadow-sm"
      : "text-slate-600 hover:bg-white",
  );

  return (
    <div>
      {/* Header: back to the zone, where we are in it, previous/next. */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href={backHref} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
            <ArrowLeft className="h-4 w-4" />
            {zone === NO_ZONE ? tr("No location", "Tanpa lokasi") : zone ? zone : tr("All zones", "Semua zona")}
          </Link>
          <span className="font-mono text-base font-semibold text-slate-800">{row.asset_no}</span>
          {walk && at >= 0 && (
            <span className="text-sm text-slate-500">{tr(`Item ${at + 1} of ${walk.length}`, `Item ${at + 1} dari ${walk.length}`)}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" icon={ChevronLeft} disabled={!prev} onClick={() => prev && router.push(href(prev.asset_no))}>
            {tr("Previous", "Sebelumnya")}
          </Button>
          <Button variant="outline" size="sm" disabled={!next} onClick={() => next && router.push(href(next.asset_no))}>
            {tr("Next", "Berikutnya")}<ChevronRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Left: what is on record, and the photos of this check. */}
        <div className="space-y-4">
          <Card className="overflow-hidden">
            <RecordPhoto attachmentId={row.record_photo_id} alt={row.name} width={900} className="aspect-[4/3] w-full" />
            <p className="px-4 py-2 text-xs text-slate-500">{tr("Photo on record", "Foto tercatat")}</p>
          </Card>
          {row.legacy_notes && (
            <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p><span className="font-semibold">{tr("Known from 2013:", "Catatan 2013:")}</span> {row.legacy_notes}</p>
            </div>
          )}
          <Card className="p-4">
            <p className="mb-2 text-sm font-semibold text-slate-700">{tr("Verification photos", "Foto verifikasi")}</p>
            <PhotoSlots photos={photos} setPhoto={setPhoto} disabled={!mayVerify} />
          </Card>
        </div>

        {/* Right: the checks. */}
        <div className="space-y-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h1 className="text-lg font-bold text-slate-800">{row.name}</h1>
              </div>
              {pill}
            </div>
            {/* The 2013 record, each part decoded (D450). */}
            {row.legacy_code && (
              <div className="mt-2">
                <LegacyPanel row={row} familySize={familySize} />
              </div>
            )}
            {row.status !== "unverified" && (
              <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                {tr("Last check:", "Cek terakhir:")} <StatusBadge status={row.status} />
                {row.verified_by_name && <span>{row.verified_by_name}</span>}
                {row.verified_at && <span>{new Date(row.verified_at).toLocaleString(lang === "id" ? "id-ID" : "en-GB")}</span>}
                <span>{tr("A new save records a recheck.", "Simpan lagi berarti pengecekan ulang.")}</span>
              </p>
            )}

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="py-2 pr-3 font-semibold">{tr("Field", "Kolom")}</th>
                    <th className="py-2 pr-3 font-semibold">{tr("On record", "Data tercatat")}</th>
                    <th className="py-2 font-semibold">{tr("On site", "Di lapangan")}</th>
                  </tr>
                </thead>
                <tbody>
                  {VERIFY_FIELDS.map((f) => {
                    const c = checks[f];
                    return (
                      <tr key={f} className="border-b border-slate-100 align-top last:border-0">
                        <td className="py-3 pr-3 font-medium text-slate-700">{pick(VERIFY_FIELD_LABELS[f], lang)}</td>
                        <td className="py-3 pr-3 text-slate-700">{recordValue[f] || <span className="text-slate-300">—</span>}</td>
                        <td className="py-2">
                          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                            <button type="button" disabled={!mayVerify} onClick={() => mark(f, true)} className={segBtn(c?.ok === true, "green")}>
                              {tr("Match", "Sesuai")}
                            </button>
                            <button type="button" disabled={!mayVerify} onClick={() => mark(f, false)} className={segBtn(c?.ok === false, "amber")}>
                              {tr("Different", "Beda")}
                            </button>
                          </div>
                          {c && !c.ok && (
                            <label className="mt-2 block">
                              <span className="text-[11px] font-medium text-slate-500">{tr("Should be", "Seharusnya")}</span>
                              <input
                                value={c.found} autoFocus inputMode={f === "qty" ? "numeric" : undefined}
                                onChange={(e) => setChecks((cur) => ({ ...cur, [f]: { ok: false, found: e.target.value } }))}
                                className={cn(
                                  "mt-0.5 h-9 w-full rounded-lg border px-2 text-sm focus:outline-none",
                                  c.found.trim() ? "border-slate-200 focus:border-brand-400" : "border-rose-300",
                                )}
                              />
                            </label>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="space-y-4 p-4">
            <div>
              <p className="mb-1.5 text-sm font-medium text-slate-700">{tr("Condition", "Kondisi")}</p>
              <SegmentedControl<AssetCondition | "">
                value={condition} onChange={setCondition}
                options={(["working", "broken", "untested"] as AssetCondition[]).map((c) => ({ value: c, label: pick(ASSET_CONDITION_LABELS[c], lang) }))}
              />
            </div>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{tr("Current location", "Lokasi sekarang")}</span>
              <select
                value={location} onChange={(e) => setLocation(e.target.value)} disabled={!mayVerify}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm focus:border-brand-400 focus:outline-none"
              >
                <option value="">{tr("Pick a location", "Pilih lokasi")}</option>
                {locations.map((l) => <option key={l.code} value={l.code}>{l.code} · {l.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700">{tr("Note", "Catatan")}</span>
              <textarea
                value={note} onChange={(e) => setNote(e.target.value)} rows={2} disabled={!mayVerify}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
              />
            </label>
          </Card>
        </div>
      </div>

      {/* Footer, always in reach of a thumb. */}
      <div className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="outline" icon={SearchX} disabled={!mayVerify || !!busy}
            className="border-rose-300 text-rose-700 hover:bg-rose-50"
            onClick={() => setNotFoundOpen(true)}
          >
            {tr("Not found", "Tidak ditemukan")}
          </Button>
          <div className="flex items-center gap-2">
            {busy && <span className="text-xs text-slate-500">{busy}</span>}
            {!mayVerify && <span className="text-xs text-slate-500">{tr("Verifying needs inventory write access.", "Verifikasi butuh akses tulis inventory.")}</span>}
            <Button variant="outline" disabled={!ready} onClick={() => save(false)}>{tr("Save", "Simpan")}</Button>
            <Button disabled={!ready} onClick={() => save(true)}>{tr("Save & next", "Simpan & berikutnya")}</Button>
          </div>
        </div>
      </div>

      <Modal
        open={notFoundOpen} onClose={() => setNotFoundOpen(false)}
        title={tr(`${row.asset_no} not found`, `${row.asset_no} tidak ditemukan`)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setNotFoundOpen(false)}>{tr("Cancel", "Batal")}</Button>
            <Button variant="danger" disabled={!notFoundNote.trim() || !!busy} onClick={saveNotFound}>{tr("Not found", "Tidak ditemukan")}</Button>
          </div>
        }
      >
        <label className="block">
          <span className="text-sm text-slate-600">
            {tr("Say where you looked, so the next person does not look there again.", "Tulis di mana saja sudah dicari, supaya orang berikutnya tidak mencari di sana lagi.")}
          </span>
          <textarea
            value={notFoundNote} onChange={(e) => setNotFoundNote(e.target.value)} rows={3} autoFocus
            className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
          />
        </label>
      </Modal>
    </div>
  );
}
