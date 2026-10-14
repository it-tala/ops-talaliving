"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, Fingerprint, MapPin, MapPinOff, ShieldCheck, Smartphone, Wifi, X } from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
import { documents, hr } from "@/demo/api";
import {
  TAP_KIND_LABEL,
  type LocationJudgement, type LocationVerdict, type TapKind, type TapReading, type TapSelfResult,
} from "@/services/hr/contracts";
import type { TapTrace, TapWhere } from "@/services/hr/tap-where";
import { OFFICE_TZ, officeClock } from "@/lib/office";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { tapClientContext } from "@/lib/device";

/** A presensi tap from the phone that says where it was made (D332).
 *
 *  The location is read **once, when the button is pressed**, with the
 *  browser's own Geolocation API, and never again: no watch, no timer, no
 *  background (W8; UU PDP). The database judges the reading against the
 *  warehouse (`ops_hr.judge_location`, 0188); this component decides nothing
 *  about it. Inside the site the tap goes through in one press. Outside it,
 *  with location refused, or with a fix too loose to judge, the database
 *  answers `off_site_needs_note` and this component shows the form: the
 *  location it has, an optional photo, and a required note. The same tap is
 *  then written with those attached, and flagged for HRD. Never refused.
 *
 *  Every tap also carries what the phone can say about itself
 *  (`tapClientContext`, D431): a per-install device id, its own clock, the
 *  build. The address and user agent are read by the database, not sent.
 *
 *  Self-contained so it can sit in `/profil` and `/saya` (D331). The parent
 *  names the button and hears about a written tap. Since D369 the parent may
 *  instead hand it **actions** — the taps that make sense next, each saying
 *  what it is (masuk, mulai istirahat, keluar kantor, …): one large primary
 *  button and smaller ones under it, sharing the one location read and the
 *  one note form. *Keluar kantor* always asks for the note (where to and
 *  why): the database answers `away_needs_note` the way it answers an
 *  off-site tap, and the same form takes it. */

const ZONE = OFFICE_TZ.short;

type Reading = TapReading & { denied: boolean };

type Phase =
  | { at: "idle" }
  | { at: "reading"; kind: TapKind | null }
  | { at: "sending"; kind: TapKind | null }
  | { at: "form"; reading: Reading; where: LocationJudgement; kind: TapKind | null }
  | { at: "done"; where: LocationJudgement; at_: string; denied: boolean; kind: TapKind | null };

/** One button the parent offers: what the tap is, and how loud. */
export interface TapAction {
  kind: TapKind;
  /** Defaults to the kind's own words (`TAP_KIND_LABELS`). */
  label?: string;
  tone?: "brand" | "amber" | "slate";
}

const TONE_CLASS: Record<NonNullable<TapAction["tone"]>, string> = {
  brand: "bg-brand-600 active:bg-brand-700 text-white",
  amber: "bg-amber-600 active:bg-amber-700 text-white",
  slate: "bg-slate-700 active:bg-slate-800 text-white",
};

/** One reading, at the tap. High accuracy, nothing cached, and a timeout a
 *  person standing at the warehouse door will tolerate. */
function readOnce(): Promise<Reading> {
  const none = (denied: boolean): Reading => ({ lat: null, lng: null, accuracy_m: null, denied });
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(none(false));
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: Reading) => { if (!settled) { settled = true; window.clearTimeout(guard); resolve(r); } };
    /* The API's own `timeout` only starts once permission is granted, so a
       permission prompt nobody answers would leave the button spinning for
       ever. After 20 s the tap goes on as "no location" and the form asks
       for a note (F189). */
    const guard = window.setTimeout(() => done(none(false)), 20_000);
    navigator.geolocation.getCurrentPosition(
      (p) => done({
        lat: p.coords.latitude, lng: p.coords.longitude,
        accuracy_m: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : null, denied: false,
      }),
      (e) => done(none(e.code === 1)),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  });
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tap-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function mapLink(lat: number, lng: number): string {
  return `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** `340 m` / `1,2 km`. */
export function metres(m: number, lang: "en" | "id"): string {
  if (m < 1000) return `${Math.round(m)} m`;
  const km = (m / 1000).toFixed(1);
  return `${lang === "id" ? km.replace(".", ",") : km} km`;
}

/** Where a judged reading stands, in one short line. */
export function useWhereLine() {
  const tr = useTr();
  const lang = tr("en", "id") as "en" | "id";
  return (w: LocationJudgement, denied = false): { text: string; tone: "green" | "amber" | "slate" } => {
    const acc = w.accuracy_m !== null ? ` ±${Math.round(w.accuracy_m)} m` : "";
    const site = w.site_name ?? tr("the site", "lokasi");
    switch (w.verdict) {
      case "inside":
        return { text: tr(`At ${site}${acc}`, `Di area ${site.toLowerCase()}${acc}`), tone: "green" };
      case "outside":
        return {
          text: tr(`Outside the area · ${metres(w.distance_m ?? 0, lang)} from ${site}`,
                   `Di luar area · ${metres(w.distance_m ?? 0, lang)} dari ${site.toLowerCase()}`),
          tone: "amber",
        };
      case "uncertain":
        return { text: tr(`Location too loose to tell${acc}`, `Lokasi kurang tepat${acc}`), tone: "amber" };
      case "no_location":
        return denied
          ? { text: tr("Location not allowed", "Lokasi tidak diizinkan"), tone: "amber" }
          : { text: tr("Location could not be read", "Lokasi tidak terbaca"), tone: "amber" };
      case "no_site":
        return { text: tr("Recorded — the warehouse point is not set yet", "Tercatat — titik gudang belum diatur"), tone: "slate" };
    }
  };
}

export function LocatedTap({
  label, tone = "brand", size = "md", disabled = false, onTapped, className,
  primary, secondary = [], more = [], idle,
}: {
  /** What the button says when the tap says only when (no `primary`). */
  label?: string;
  tone?: "brand" | "amber";
  /** D369: the large button, saying what the tap is. */
  primary?: TapAction | null;
  /** Smaller buttons under it, for the other taps that make sense now. */
  secondary?: TapAction[];
  /** Every other kind, behind *Tap lain*, for the tap somebody forgot. */
  more?: TapAction[];
  /** Shown in place of the large button when nothing is due next. */
  idle?: ReactNode;
  /** `lg` is `/saya`'s thumb-sized button. */
  size?: "md" | "lg";
  /** While the parent is still reading the day, so the label is not a guess. */
  disabled?: boolean;
  onTapped?: (r: TapSelfResult) => void;
  className?: string;
}) {
  const tr = useTr();
  const { toast } = useToast();
  const whereLine = useWhereLine();
  const [phase, setPhase] = useState<Phase>({ at: "idle" });
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<{ id: string; name: string; preview: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const selfieRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.preview); }, [photo]);

  function written(r: TapSelfResult, denied: boolean) {
    const clock = `${officeClock(new Date(r.at))} ${ZONE}`;
    const line = whereLine(r.location, denied);
    const what = r.kind ? TAP_KIND_LABEL[r.kind] : tr("Tap", "Tap");
    toast(
      r.location.needs_note ? "warning" : "success",
      tr(`${what} recorded · ${clock}`, `${what} tercatat · ${clock}`),
      r.location.needs_note
        ? tr(`${line.text}. Flagged for HRD with your note.`, `${line.text}. Ditandai untuk HRD beserta keterangan Anda.`)
        : line.text + ".",
    );
    setPhase({ at: "done", where: r.location, at_: r.at, denied, kind: r.kind ?? null });
    setNote("");
    setPhoto(null);
    setShowMore(false);
    onTapped?.(r);
  }

  async function press(kind: TapKind | null = null) {
    setPhase({ at: "reading", kind });
    const reading = await readOnce();
    setPhase({ at: "sending", kind });
    const res = await hr.tapSelf(
      { lat: reading.lat, lng: reading.lng, accuracy_m: reading.accuracy_m, kind, client: tapClientContext() }, newKey());
    if (!res.error) return written(res.data, reading.denied);
    if ((res.error.code === "off_site_needs_note" || res.error.code === "away_needs_note") && res.error.detail) {
      setPhase({ at: "form", reading, where: res.error.detail as unknown as LocationJudgement, kind });
      return;
    }
    setPhase({ at: "idle" });
    toast(res.error.status === 403 ? "critical" : "warning", tr("Not recorded", "Tidak tercatat"), res.error.message);
  }

  async function pick(f: File | undefined) {
    if (!f) return;
    setUploading(true);
    /* Filed by kind (the HRD drive, personal data) and by what it is for
       (PRESENSI LUAR AREA) — CLAUDE.md's storage rule, 0188. */
    const up = await documents.upload({ file: f, kind: "Foto Presensi", entity: "attendance_scan" }, newKey());
    setUploading(false);
    if (selfieRef.current) selfieRef.current.value = "";
    if (backRef.current) backRef.current.value = "";
    if (up.error) { toast("critical", tr("Photo not uploaded", "Foto gagal diunggah"), up.error.message); return; }
    setPhoto({ id: up.data.id, name: f.name, preview: URL.createObjectURL(f) });
  }

  async function submitOffSite() {
    if (phase.at !== "form") return;
    const { reading, kind } = phase;
    setPhase({ at: "sending", kind });
    const res = await hr.tapSelf({
      lat: reading.lat, lng: reading.lng, accuracy_m: reading.accuracy_m,
      note: note.trim(), photo_id: photo?.id ?? null, kind, client: tapClientContext(),
    }, newKey());
    if (!res.error) return written(res.data, reading.denied);
    setPhase({ at: "form", reading, where: phase.where, kind });
    toast(res.error.status === 403 ? "critical" : "warning", tr("Not recorded", "Tidak tercatat"), res.error.message);
  }

  const busy = phase.at === "reading" || phase.at === "sending";

  return (
    <div className={cn("space-y-3", className)} data-testid="located-tap">
      {phase.at !== "form" && (() => {
        const pressed = phase.at === "reading" || phase.at === "sending" ? phase.kind : null;
        const busyText = (phase.at === "reading" ? tr("Reading location…", "Membaca lokasi…") : tr("Recording…", "Mencatat…"))
          + (pressed ? ` ${TAP_KIND_LABEL[pressed]}` : "");
        const big = cn(
          "flex w-full items-center justify-center gap-3 rounded-2xl font-bold tracking-wide shadow-sm transition active:scale-[0.99] disabled:opacity-60",
          size === "lg" ? "h-20 text-[22px]" : "h-16 text-[19px]",
        );
        const icon = <Fingerprint className={size === "lg" ? "h-8 w-8" : "h-7 w-7"} />;
        /* The tap that says only when — `/profil`, and anything before D369. */
        if (primary === undefined && !idle) {
          return (
            <button
              type="button" onClick={() => press(null)} disabled={busy || disabled}
              className={cn(big, tone === "amber" ? TONE_CLASS.amber : TONE_CLASS.brand)}
            >
              {icon}
              {busy ? busyText : label ?? tr("Tap attendance", "Tap presensi")}
            </button>
          );
        }
        const extra = secondary.filter((a) => a.kind !== primary?.kind);
        return (
          <div className="space-y-2">
            {busy ? (
              <div className={cn(big, "bg-slate-200 text-slate-600")} data-testid="tap-busy">{icon}{busyText}</div>
            ) : primary ? (
              <button
                type="button" onClick={() => press(primary.kind)} disabled={disabled}
                data-testid={`tap-${primary.kind}`}
                className={cn(big, TONE_CLASS[primary.tone ?? "brand"])}
              >
                {icon}
                {primary.label ?? TAP_KIND_LABEL[primary.kind]}
              </button>
            ) : idle}
            {extra.length > 0 && (
              <div className={cn("grid gap-2", extra.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
                {extra.map((a) => (
                  <button
                    key={a.kind} type="button" onClick={() => press(a.kind)} disabled={busy || disabled}
                    data-testid={`tap-${a.kind}`}
                    className="h-12 rounded-xl border border-slate-300 bg-white text-[15px] font-semibold text-slate-800 shadow-sm transition active:scale-[0.99] active:bg-slate-50 disabled:opacity-60"
                  >
                    {a.label ?? TAP_KIND_LABEL[a.kind]}
                  </button>
                ))}
              </div>
            )}
            {more.length > 0 && (
              <div className="pt-1">
                <button
                  type="button" onClick={() => setShowMore((v) => !v)} disabled={busy || disabled}
                  className="text-[12px] font-medium text-brand-700 underline disabled:opacity-60"
                  aria-expanded={showMore}
                >
                  {showMore ? tr("Hide other taps", "Sembunyikan tap lain") : tr("Other taps…", "Tap lain…")}
                </button>
                {showMore && (
                  <div className="mt-2 flex flex-wrap justify-center gap-1.5" data-testid="tap-more">
                    {more.map((a) => (
                      <button
                        key={a.kind} type="button" onClick={() => press(a.kind)} disabled={busy || disabled}
                        className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-[13px] text-slate-700 active:bg-slate-50 disabled:opacity-60"
                      >
                        {a.label ?? TAP_KIND_LABEL[a.kind]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {phase.at === "done" && (() => {
        const line = whereLine(phase.where, phase.denied);
        return (
          <p data-testid="where" className={cn(
            "flex items-center justify-center gap-1.5 text-[13px] font-medium",
            line.tone === "green" ? "text-emerald-700" : line.tone === "amber" ? "text-amber-700" : "text-slate-500",
          )}>
            <MapPin className="h-4 w-4" />
            {phase.kind ? `${TAP_KIND_LABEL[phase.kind]} · ` : ""}{line.text} · {officeClock(new Date(phase.at_))} {ZONE}
          </p>
        );
      })()}

      {phase.at === "form" && (() => {
        const line = whereLine(phase.where, phase.reading.denied);
        const { lat, lng, accuracy_m } = phase.reading;
        /* Keluar kantor asks where to and why, wherever the phone is (D369). */
        const away = phase.kind === "away_out";
        return (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-left" data-testid="off-site-form">
            <p data-testid="where" className="flex items-center gap-1.5 text-[14px] font-semibold text-amber-800">
              {lat === null ? <MapPinOff className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
              {line.text}
            </p>
            <p className="mt-1 text-[12px] text-amber-900/80">
              {away
                ? tr(
                    "Leaving the office: say where to and why (required). HRD will see it.",
                    "Keluar kantor: tulis ke mana dan untuk apa (wajib). HRD akan melihatnya.",
                  )
                : tr(
                    "You can still clock in. Add a note (required) and, if you can, a photo. HRD will see it.",
                    "Presensi tetap bisa. Tulis keterangan (wajib) dan, bila bisa, foto. HRD akan melihatnya.",
                  )}
            </p>
            {lat !== null && lng !== null && (
              <a href={mapLink(lat, lng)} target="_blank" rel="noreferrer"
                 className="mt-2 inline-block font-mono text-[12px] text-brand-700 underline">
                {lat.toFixed(5)}, {lng.toFixed(5)}{accuracy_m !== null ? ` ±${Math.round(accuracy_m)} m` : ""}
              </a>
            )}

            <label className="mt-3 block text-[13px] font-medium text-slate-700" htmlFor="off-site-note">
              {away ? tr("Where to, and why", "Keperluan") : tr("Note", "Keterangan")} <span className="text-rose-600">*</span>
            </label>
            <textarea
              id="off-site-note"
              value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              placeholder={away
                ? tr("e.g. to the supplier to collect timber", "mis. ke pemasok ambil kayu")
                : tr("Why here? e.g. collecting timber from the supplier", "Kenapa di sini? mis. ambil kayu di pemasok")}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-[14px] focus:border-brand-400 focus:outline-none"
            />

            <p className="mt-3 text-[13px] font-medium text-slate-700">{tr("Photo (optional)", "Foto (opsional)")}</p>
            <input ref={selfieRef} type="file" accept="image/*" capture="user" className="hidden"
              aria-label={tr("Selfie", "Swafoto")} onChange={(e) => pick(e.target.files?.[0])} />
            <input ref={backRef} type="file" accept="image/*" capture="environment" className="hidden"
              aria-label={tr("Photo of the place", "Foto tempat")} onChange={(e) => pick(e.target.files?.[0])} />
            {photo ? (
              <div className="mt-1 flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimisable asset */}
                <img src={photo.preview} alt="" className="h-16 w-16 rounded-lg object-cover" />
                <span className="flex-1 truncate text-[12px] text-slate-600">{photo.name}</span>
                <button type="button" onClick={() => setPhoto(null)} aria-label={tr("Remove photo", "Hapus foto")}
                  className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <div className="mt-1 flex gap-2">
                <Button type="button" variant="outline" size="sm" icon={Camera} disabled={uploading}
                  onClick={() => selfieRef.current?.click()}>
                  {uploading ? tr("Uploading…", "Mengunggah…") : tr("Selfie", "Swafoto")}
                </Button>
                <Button type="button" variant="outline" size="sm" icon={Camera} disabled={uploading}
                  onClick={() => backRef.current?.click()}>
                  {tr("Photo of the place", "Foto tempat")}
                </Button>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <Button type="button" className="flex-1" size="lg" icon={Fingerprint}
                disabled={!note.trim() || uploading} onClick={submitOffSite}>
                {phase.kind ? TAP_KIND_LABEL[phase.kind] : tr("Record attendance", "Catat presensi")}
              </Button>
              <Button type="button" variant="ghost" size="lg" onClick={() => { setPhase({ at: "idle" }); setPhoto(null); }}>
                {tr("Cancel", "Batal")}
              </Button>
            </div>
          </div>
        );
      })()}

      <p className="flex items-start justify-center gap-1.5 text-[11px] leading-snug text-slate-500" data-testid="privacy-note">
        <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" />
        {tr(
          "Each tap records your location, network address and device — read once, when you press the button, never tracked.",
          "Setiap tap mencatat lokasi, alamat jaringan, dan perangkat Anda — dibaca sekali saat tombol ditekan, tidak dilacak.",
        )}
      </p>
    </div>
  );
}

/** Where one tap was made, in one line (D344): the warehouse for the reader,
 *  the reading and the selfie for a phone, the reason for one typed in. Each
 *  point opens in Google Maps. */
export function TapWhereLine({ where, at }: { where: TapWhere | undefined; at?: string }) {
  const tr = useTr();
  const lang = tr("en", "id") as "en" | "id";
  if (!where) return null;
  const map = where.lat != null && where.lng != null
    ? (
      <a href={mapLink(where.lat, where.lng)} target="_blank" rel="noreferrer"
         className="inline-flex items-center gap-0.5 text-brand-700 underline">
        <MapPin className="h-3 w-3" />{tr("map", "peta")}
      </a>
    ) : null;

  if (where.kind === "machine") {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-1.5 text-slate-500" data-testid="tap-where">
        <Fingerprint className="h-3 w-3" />
        {where.site_name
          ? tr(`${where.site_name} · fingerprint reader`, `${where.site_name} · mesin sidik jari`)
          : tr("Fingerprint reader · no warehouse point set", "Mesin sidik jari · titik gudang belum diatur")}
        {map}
      </span>
    );
  }
  if (where.kind === "manual") {
    return (
      <span className="text-slate-500" data-testid="tap-where">
        {tr("Typed by HRD", "Diketik HRD")}{where.reason ? ` — ${where.reason}` : ""}
      </span>
    );
  }
  const verdict: Record<LocationVerdict, { text: string; cls: string }> = {
    inside: { text: tr(`At ${where.site_name ?? "the site"}`, `Di ${where.site_name ?? "lokasi"}`), cls: "text-emerald-700" },
    outside: {
      text: tr(`Outside · ${metres(where.distance_m ?? 0, lang)} from ${where.site_name ?? "the site"}`,
               `Di luar · ${metres(where.distance_m ?? 0, lang)} dari ${where.site_name ?? "lokasi"}`),
      cls: "text-amber-700",
    },
    uncertain: { text: tr("Location too loose to tell", "Lokasi kurang tepat"), cls: "text-amber-700" },
    no_location: { text: tr("No location", "Tanpa lokasi"), cls: "text-amber-700" },
    no_site: { text: tr("Not judged — no location point set", "Tidak dinilai — titik lokasi belum diatur"), cls: "text-slate-500" },
  };
  const v = verdict[where.verdict ?? "no_location"];
  return (
    <span className="flex flex-col gap-0.5">
    <span className="inline-flex flex-wrap items-center gap-x-1.5" data-testid="tap-where">
      <span className={v.cls}>{tr("Phone", "HP")} · {v.text}</span>
      {where.accuracy_m != null && <span className="text-slate-400">±{Math.round(where.accuracy_m)} m</span>}
      {map}
      {where.photo_id && (where.photo_link
        ? (
          <a href={where.photo_link} target="_blank" rel="noreferrer" title={where.photo_filename ?? undefined}
             className="inline-flex items-center gap-0.5 text-brand-700 underline">
            <Camera className="h-3 w-3" />{tr("selfie", "foto selfie")}
          </a>
        ) : (
          <span className="inline-flex items-center gap-0.5 text-slate-500" title={where.photo_filename ?? undefined}>
            <Camera className="h-3 w-3" />{tr("selfie attached", "foto selfie terlampir")}
          </span>
        ))}
      {where.note && <span className="text-slate-600">“{where.note}”</span>}
    </span>
    {/* The network and device under the place (0270, D432). */}
    {where.trace && <TapTraceLine trace={where.trace} at={at} />}
    </span>
  );
}

/** A tap's trace (0270, D431/D432) in one line, under where it was made: the
 *  network it came from and the device that sent it. The address and the
 *  office-network reading are the server's; the device is the phone's own
 *  word. One device for more than one person is red; the rest is shown, not
 *  flagged. Used by the timesheet's day and by `/hrd/absensi/lokasi`. */
export function TapTraceLine({ trace, at }: { trace: TapTrace; at?: string }) {
  const tr = useTr();
  const skew = trace.device_at && at ? Math.round((Date.parse(trace.device_at) - Date.parse(at)) / 60_000) : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-500" data-testid="trace">
      {(trace.device_people ?? 0) > 1 && (
        <Badge tone="red">{tr(`One phone, ${trace.device_people} people`, `Satu HP, ${trace.device_people} orang`)}</Badge>
      )}
      {trace.on_site_network === true && (
        <Badge tone="green">{tr(`Office network ${trace.network_site_code ?? ""}`, `Jaringan kantor ${trace.network_site_code ?? ""}`)}</Badge>
      )}
      {trace.on_site_network === false && <Badge tone="slate">{tr("Not an office network", "Bukan jaringan kantor")}</Badge>}
      {trace.device_new === true && <Badge tone="slate">{tr("New device", "Perangkat baru")}</Badge>}
      {trace.ip && (
        <span className="inline-flex items-center gap-1"><Wifi className="h-3 w-3" /><span className="font-mono">{trace.ip}</span></span>
      )}
      {(trace.device_id || trace.user_agent) && (
        <span className="inline-flex items-center gap-1" title={trace.user_agent ?? undefined}>
          <Smartphone className="h-3 w-3" />
          {trace.device_id && <span className="font-mono">{trace.device_id.slice(0, 8)}</span>}
          {trace.user_agent && <span className="max-w-[16rem] truncate">{shortAgent(trace.user_agent)}</span>}
        </span>
      )}
      {skew !== null && Math.abs(skew) >= 5 && (
        <span className="text-amber-700">
          {tr(`phone clock ${skew > 0 ? "+" : ""}${skew} min`, `jam HP ${skew > 0 ? "+" : ""}${skew} mnt`)}
        </span>
      )}
    </span>
  );
}

/** `Android 14 · Chrome` from a user agent — enough to tell two phones apart
 *  at a glance; the whole string is on hover. */
export function shortAgent(ua: string): string {
  const ios = /iPhone OS ([\d_]+)/.exec(ua)?.[1];
  const os = /Android [\d.]+/.exec(ua)?.[0]
    ?? (ios ? `iOS ${ios.replace(/_/g, ".")}` : null)
    ?? (/Windows NT/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : null);
  const browser = /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /EdgA?\//.test(ua) ? "Edge" : /CriOS|Chrome\//.test(ua) ? "Chrome"
    : /FxiOS|Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : null;
  return [os, browser].filter(Boolean).join(" · ") || ua.slice(0, 40);
}
