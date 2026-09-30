"use client";

import { useState } from "react";
import { Camera, ChevronLeft, Crosshair, MapPin, MapPinned, Pencil, Plus, Save, Trash2, Warehouse } from "lucide-react";
import Link from "next/link";
import { Badge, Button, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Loaded, useLoad } from "@/components/ui/loaded";
import { mapLink, metres, useWhereLine } from "@/components/attendance/located-tap";
import { hr } from "@/demo/api";
import {
  DEFAULT_SITE_RADIUS_M, type LocatedTapView, type LocationJudgement, type LocationVerdict, type WorkSite,
} from "@/services/hr/contracts";
import { OFFICE_TZ, officeClock, officeToday, shiftDay } from "@/lib/office";
import { useSession } from "@/store/session";
import { useToast } from "@/store/toast";
import { useLang, useTr } from "@/lib/i18n";
import { cn } from "@/lib/cn";

/** Presensi berlokasi (D332) — where the warehouse is, and the phone taps
 *  that were not made inside it.
 *
 *  Two halves on one page because they answer one question. The **site** is
 *  what "inside" is measured against: set by HRD or IT standing in the
 *  warehouse, since nobody knows its coordinates from a desk. The **review**
 *  is every phone tap that was outside, had no location, or was too loose to
 *  judge — each already written and carrying the person's note, never refused
 *  (D326, answer 1). Nothing here changes what a day is worth: taps stay facts,
 *  and HRD's day marks on `/hrd/absensi` decide the day (D142).
 */
const ZONE = OFFICE_TZ.short;

const VERDICT_TONE: Record<LocationVerdict, "green" | "amber" | "red" | "slate"> = {
  inside: "green", outside: "red", uncertain: "amber", no_location: "amber", no_site: "slate",
};

export default function LocatedTapsPage() {
  const tr = useTr();
  const { can } = useSession();
  const today = officeToday();
  const [from, setFrom] = useState(() => shiftDay(today, -13));
  const [to, setTo] = useState(today);
  const [flaggedOnly, setFlaggedOnly] = useState(true);
  const [sites, reloadSites] = useLoad(() => hr.listWorkSites(), []);
  const [taps] = useLoad(() => hr.listLocatedTaps({ from, to, flagged_only: flaggedOnly }), [from, to, flaggedOnly]);
  const [unjudged] = useLoad(() => hr.listLocatedTaps({ from, to }), [from, to]);
  const mayEdit = can("hrd.update") || can("it.update");
  const siteSet = sites.status === "ready" && sites.data.some((w) => w.active && w.lat !== null);

  return (
    <div>
      <PageHeader
        breadcrumb="HRD"
        title={tr("Attendance by location", "Presensi berlokasi")}
        description={tr(
          "A phone tap reads the location once, at the tap, and is judged against the nearest active work location. Taps outside are recorded with a note and flagged here — never refused.",
          "Tap dari HP membaca lokasi sekali, saat tap, dan dinilai terhadap lokasi kerja aktif terdekat. Tap di luar area tetap tercatat beserta keterangan dan ditandai di sini — tidak pernah ditolak.",
        )}
        actions={<Link href="/hrd/absensi"><Button variant="outline" icon={ChevronLeft}>{tr("Timesheet", "Absensi")}</Button></Link>}
      />

      <Loaded state={sites} onRetry={reloadSites}>
        {(list) => <SitesCard sites={list} mayEdit={mayEdit} onSaved={reloadSites} />}
      </Loaded>

      {sites.status === "ready" && !siteSet && unjudged.status === "ready" && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900" data-testid="no-site-banner">
          {tr(
            `No active location has a point, so phone taps are recorded but not judged (${unjudged.data.filter((t) => t.verdict === "no_site").length} in this period).`,
            `Belum ada lokasi aktif yang titiknya diatur, jadi tap dari HP tercatat tetapi tidak dinilai (${unjudged.data.filter((t) => t.verdict === "no_site").length} pada periode ini).`,
          )}
        </p>
      )}

      <Card className="mt-4">
        <CardHeader
          title={tr("Taps to look at", "Tap yang perlu dilihat")}
          subtitle={tr(
            `Outside the area, no location, or a location too loose to tell. Times in ${OFFICE_TZ.short}.`,
            `Di luar area, tanpa lokasi, atau lokasi kurang tepat. Jam dalam ${OFFICE_TZ.short}.`,
          )}
          icon={MapPinned}
        />
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-3 text-[13px]">
          <label className="flex items-center gap-1.5">
            {tr("From", "Dari")}
            <input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1" />
          </label>
          <label className="flex items-center gap-1.5">
            {tr("to", "s.d.")}
            <input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1" />
          </label>
          <label className="ml-auto flex items-center gap-1.5">
            <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} />
            {tr("Flagged only", "Hanya yang ditandai")}
          </label>
        </div>
        <Loaded state={taps}>
          {(rows) => rows.length === 0 ? (
            <p className="px-5 py-8 text-center text-[13px] text-slate-500">
              {flaggedOnly
                ? tr("No flagged phone taps in this period.", "Tidak ada tap HP yang ditandai pada periode ini.")
                : tr("No phone taps in this period.", "Tidak ada tap dari HP pada periode ini.")}
            </p>
          ) : (
            <ul className="divide-y divide-slate-100" data-testid="located-taps">
              {rows.map((r) => <TapRow key={r.tap_no} r={r} />)}
            </ul>
          )}
        </Loaded>
      </Card>
    </div>
  );
}

function TapRow({ r }: { r: LocatedTapView }) {
  const tr = useTr();
  const lang = useLang();
  const verdictLabel: Record<LocationVerdict, string> = {
    inside: tr("Inside", "Di area"),
    outside: tr("Outside", "Di luar area"),
    uncertain: tr("Too loose", "Kurang tepat"),
    no_location: tr("No location", "Tanpa lokasi"),
    no_site: tr("Not judged", "Tidak dinilai"),
  };
  return (
    <li className="flex gap-3 px-5 py-3 text-[13px]">
      {r.photo_id ? (
        <a
          href={r.photo_link ?? undefined} target="_blank" rel="noreferrer"
          title={r.photo_filename ?? undefined}
          className={cn(
            "flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-[10px] text-slate-500",
            r.photo_link ? "hover:border-brand-400 hover:text-brand-700" : "pointer-events-none",
          )}
        >
          <Camera className="h-5 w-5" />
          {tr("Photo", "Foto")}
        </a>
      ) : (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-slate-200 text-[10px] text-slate-400">
          {tr("no photo", "tanpa foto")}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-slate-800">{r.full_name}</span>
          <span className="font-mono text-[11px] text-slate-400">{r.employee_no}</span>
          <Badge tone={VERDICT_TONE[r.verdict]}>{verdictLabel[r.verdict]}</Badge>
        </div>
        <p className="mt-0.5 text-slate-600">
          {r.work_date} · {officeClock(new Date(r.at))} {ZONE}
          {r.distance_m !== null && <> · {tr(`${metres(r.distance_m, lang)} from ${r.site_name ?? "site"}`, `${metres(r.distance_m, lang)} dari ${r.site_name ?? "lokasi"}`)}</>}
          {r.accuracy_m !== null && <> · ±{Math.round(r.accuracy_m)} m</>}
        </p>
        {r.note && <p className="mt-1 text-slate-800">“{r.note}”</p>}
        {r.lat !== null && r.lng !== null && (
          <a href={mapLink(r.lat, r.lng)} target="_blank" rel="noreferrer"
             className="mt-1 inline-flex items-center gap-1 text-[12px] text-brand-700 underline">
            <MapPin className="h-3.5 w-3.5" /> {tr("Open in maps", "Buka di peta")}
          </a>
        )}
      </div>
    </li>
  );
}

/* ── the sites ──────────────────────────────────────────────────────────── */

/** Every place a phone tap is judged against, and the form that adds or
 *  changes one (D343). A tap is judged against the **nearest active** site
 *  (0188), so a second warehouse or the office is a row here, not a code
 *  change. Removing is refused once a site judged any tap — the tap's reading
 *  names it — and the answer then is to switch it off. */
function SitesCard({ sites, mayEdit, onSaved }: { sites: WorkSite[]; mayEdit: boolean; onSaved: () => void }) {
  const tr = useTr();
  const { toast } = useToast();
  const [editing, setEditing] = useState<WorkSite | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function remove(w: WorkSite) {
    if (!window.confirm(tr(`Remove ${w.name} (${w.code})?`, `Hapus ${w.name} (${w.code})?`))) return;
    setBusy(w.code);
    const res = await hr.removeWorkSite(w.code);
    setBusy(null);
    if (res.error) { toast("warning", tr("Not removed", "Tidak dihapus"), res.error.message); return; }
    toast("success", tr("Location removed", "Lokasi dihapus"), `${res.data.name} (${res.data.code})`);
    if (editing !== "new" && editing?.code === w.code) setEditing(null);
    onSaved();
  }

  return (
    <Card>
      <CardHeader
        title={tr("Work locations", "Lokasi kerja")}
        subtitle={tr(
          "A phone tap is judged against the nearest active location. Set each point standing there, with your current location.",
          "Tap dari HP dinilai terhadap lokasi aktif terdekat. Atur tiap titik sambil berdiri di sana, dengan lokasi Anda sekarang.",
        )}
        icon={Warehouse}
        action={mayEdit && editing === null
          ? <Button size="sm" icon={Plus} onClick={() => setEditing("new")}>{tr("Add location", "Tambah lokasi")}</Button>
          : undefined}
      />
      {sites.length === 0 ? (
        <p className="px-5 py-6 text-[13px] text-slate-500" data-testid="no-sites">
          {tr("No location yet. Add the warehouse first.", "Belum ada lokasi. Tambahkan gudang lebih dulu.")}
        </p>
      ) : (
        <ul className="divide-y divide-slate-100" data-testid="sites">
          {sites.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-[13px]">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-800">{w.name}</span>
                  <span className="font-mono text-[11px] text-slate-400">{w.code}</span>
                  {w.active
                    ? <Badge tone="green">{tr("active", "aktif")}</Badge>
                    : <Badge tone="slate">{tr("inactive", "nonaktif")}</Badge>}
                </div>
                <p className="mt-0.5 text-slate-500">
                  {w.lat != null && w.lng != null
                    ? <>{w.lat.toFixed(5)}, {w.lng.toFixed(5)} · {tr("radius", "radius")} {w.radius_m} m · {" "}
                        <a href={mapLink(w.lat, w.lng)} target="_blank" rel="noreferrer" className="text-brand-700 underline">
                          {tr("map", "peta")}
                        </a></>
                    : tr("point not set", "titik belum diatur")}
                </p>
              </div>
              {mayEdit && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" icon={Pencil} disabled={busy !== null} onClick={() => setEditing(w)}>
                    {tr("Edit", "Ubah")}
                  </Button>
                  <Button size="sm" variant="ghost" icon={Trash2} disabled={busy !== null} onClick={() => remove(w)}>
                    {busy === w.code ? tr("Removing…", "Menghapus…") : tr("Remove", "Hapus")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing !== null && (
        <SiteForm
          key={editing === "new" ? "new" : editing.id}
          site={editing === "new" ? null : editing}
          taken={sites.map((w) => w.code)}
          mayEdit={mayEdit}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onSaved(); }}
        />
      )}
      {editing === null && <WhereAmI />}
      {!mayEdit && (
        <p className="border-t border-slate-100 px-5 py-2 text-[12px] text-slate-500">{tr("Set by HRD or IT.", "Diatur oleh HRD atau IT.")}</p>
      )}
    </Card>
  );
}

/** Reads this device's position once. */
function useReadHere() {
  const tr = useTr();
  const { toast } = useToast();
  const [reading, setReading] = useState(false);
  function readHere(then: (lat: number, lng: number, acc: number) => void) {
    if (!navigator.geolocation) {
      toast("warning", tr("No location on this device", "Perangkat ini tidak punya lokasi"), "");
      return;
    }
    setReading(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setReading(false); then(p.coords.latitude, p.coords.longitude, p.coords.accuracy); },
      (e) => {
        setReading(false);
        toast("warning", tr("Location not read", "Lokasi tidak terbaca"),
          e.code === 1 ? tr("Location is not allowed for this site in the browser.", "Izin lokasi untuk situs ini ditolak di browser.") : e.message);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  }
  return { reading, readHere };
}

/** *Where am I against them?* — the same judgement a phone tap gets. */
function WhereAmI() {
  const tr = useTr();
  const { toast } = useToast();
  const whereLine = useWhereLine();
  const { reading, readHere } = useReadHere();
  const [check, setCheck] = useState<LocationJudgement | null>(null);
  function checkHere() {
    readHere(async (lat, lng, acc) => {
      const res = await hr.judgeLocation({ lat, lng, accuracy_m: acc });
      if (res.error) { toast("warning", tr("Not checked", "Tidak dicek"), res.error.message); return; }
      setCheck(res.data);
    });
  }
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3">
      <Button variant="ghost" icon={MapPin} disabled={reading} onClick={checkHere}>
        {tr("Where am I against them?", "Posisi saya terhadap lokasi?")}
      </Button>
      {check && (() => {
        const line = whereLine(check);
        return (
          <span data-testid="site-check" className={cn("text-[13px] font-medium",
            line.tone === "green" ? "text-emerald-700" : line.tone === "amber" ? "text-amber-700" : "text-slate-500")}>
            {line.text}
          </span>
        );
      })()}
    </div>
  );
}

/** Add a location, or change one. The code is the location's key (0188), so
 *  it is typed once, on adding, and read-only after. */
function SiteForm({
  site, taken, mayEdit, onClose, onSaved,
}: {
  site: WorkSite | null; taken: string[]; mayEdit: boolean; onClose: () => void; onSaved: () => void;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const { reading, readHere } = useReadHere();
  const [draft, setDraft] = useState(() => ({
    code: site?.code ?? (taken.includes("GUDANG") ? "" : "GUDANG"),
    name: site?.name ?? (taken.includes("GUDANG") ? "" : "Gudang"),
    lat: site?.lat?.toString() ?? "",
    lng: site?.lng?.toString() ?? "",
    radius_m: String(site?.radius_m ?? DEFAULT_SITE_RADIUS_M),
    active: site?.active ?? true,
  }));
  const [fix, setFix] = useState<{ accuracy_m: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const code = draft.code.trim().toUpperCase();
  const clash = site === null && taken.includes(code);

  function fillFromHere() {
    readHere((lat, lng, acc) => {
      setDraft((d) => ({ ...d, lat: lat.toFixed(6), lng: lng.toFixed(6) }));
      setFix({ accuracy_m: acc });
    });
  }

  async function save() {
    setBusy(true);
    const res = await hr.saveWorkSite({
      code, name: draft.name,
      lat: draft.lat.trim() === "" ? null : Number(draft.lat),
      lng: draft.lng.trim() === "" ? null : Number(draft.lng),
      radius_m: Number(draft.radius_m), active: draft.active,
    });
    setBusy(false);
    if (res.error) { toast("warning", tr("Not saved", "Tidak tersimpan"), res.error.message); return; }
    toast("success", site ? tr("Location saved", "Lokasi tersimpan") : tr("Location added", "Lokasi ditambahkan"),
      `${res.data.name} · ${res.data.radius_m} m`);
    onSaved();
  }

  const field = "mt-1 w-full rounded-lg border border-slate-300 px-2.5 py-2 text-[14px] disabled:bg-slate-50";

  return (
    <div className="border-t border-slate-100 bg-slate-50/50" data-testid="site-form">
      <p className="px-5 pt-3 text-[13px] font-semibold text-slate-800">
        {site ? tr(`Change ${site.name}`, `Ubah ${site.name}`) : tr("New location", "Lokasi baru")}
      </p>
      <div className="grid gap-3 px-5 py-3 sm:grid-cols-2">
        <label className="text-[13px] font-medium text-slate-700">
          {tr("Code", "Kode")}
          <input className={field} value={draft.code} disabled={!mayEdit || site !== null} placeholder="KANTOR"
            onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} />
          <span className={cn("mt-1 block text-[11px] font-normal", clash ? "text-amber-700" : "text-slate-500")}>
            {clash
              ? tr("That code is already a location — change it from the list.", "Kode itu sudah dipakai — ubah dari daftar.")
              : tr("2–20 capital letters or digits. Fixed once saved.", "2–20 huruf besar atau angka. Tidak bisa diubah setelah disimpan.")}
          </span>
        </label>
        <label className="text-[13px] font-medium text-slate-700">
          {tr("Name", "Nama")}
          <input className={field} value={draft.name} disabled={!mayEdit} placeholder={tr("Office", "Kantor")}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label className="text-[13px] font-medium text-slate-700">
          {tr("Latitude", "Lintang")}
          <input className={field} inputMode="decimal" value={draft.lat} disabled={!mayEdit} placeholder="-6.59"
            onChange={(e) => setDraft({ ...draft, lat: e.target.value })} />
        </label>
        <label className="text-[13px] font-medium text-slate-700">
          {tr("Longitude", "Bujur")}
          <input className={field} inputMode="decimal" value={draft.lng} disabled={!mayEdit} placeholder="110.67"
            onChange={(e) => setDraft({ ...draft, lng: e.target.value })} />
        </label>
        <label className="text-[13px] font-medium text-slate-700">
          {tr("Radius (metres)", "Radius (meter)")}
          <input className={field} inputMode="numeric" value={draft.radius_m} disabled={!mayEdit}
            onChange={(e) => setDraft({ ...draft, radius_m: e.target.value.replace(/[^0-9]/g, "") })} />
          <span className="mt-1 block text-[11px] font-normal text-slate-500">
            {tr(`${DEFAULT_SITE_RADIUS_M} m by default: the compound plus a phone's usual 10–50 m of doubt.`,
                `Bawaan ${DEFAULT_SITE_RADIUS_M} m: area lokasi ditambah meleset HP yang biasa 10–50 m.`)}
          </span>
        </label>
        <div className="flex flex-col justify-center gap-2">
          <label className="flex items-center gap-2 text-[13px] text-slate-700">
            <input type="checkbox" checked={draft.active} disabled={!mayEdit}
              onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
            {tr("Active — phone taps are judged against it", "Aktif — tap HP dinilai terhadapnya")}
          </label>
          {draft.lat && draft.lng && Number.isFinite(Number(draft.lat)) && Number.isFinite(Number(draft.lng)) && (
            <a href={mapLink(Number(draft.lat), Number(draft.lng))} target="_blank" rel="noreferrer"
               className="text-[13px] text-brand-700 underline">
              {tr("Check the point on the map", "Cek titiknya di peta")}
            </a>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3">
        {mayEdit && (
          <>
            <Button variant="outline" icon={Crosshair} disabled={reading} onClick={fillFromHere}>
              {reading ? tr("Reading…", "Membaca…") : tr("Use my current location", "Pakai lokasi saya sekarang")}
            </Button>
            <Button icon={Save} disabled={busy || clash || code === ""} onClick={save}>{tr("Save", "Simpan")}</Button>
          </>
        )}
        <Button variant="ghost" disabled={busy} onClick={onClose}>{tr("Cancel", "Batal")}</Button>
        {fix && (
          <span className={cn("text-[12px]", fix.accuracy_m > 30 ? "text-amber-700" : "text-slate-500")}>
            {tr(`Read to ±${Math.round(fix.accuracy_m)} m.`, `Terbaca ±${Math.round(fix.accuracy_m)} m.`)}
            {fix.accuracy_m > 30 && tr(" Step outside or wait a moment and read again.", " Keluar ke area terbuka atau tunggu sebentar lalu baca lagi.")}
          </span>
        )}
      </div>
    </div>
  );
}
