"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Fingerprint, MapPin, MapPinOff, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { documents, hr } from "@/demo/api";
import type { LocationJudgement, LocationVerdict, TapReading, TapSelfResult } from "@/services/hr/contracts";
import type { TapWhere } from "@/services/hr/tap-where";
import { OFFICE_TZ, officeClock } from "@/lib/office";
import { useToast } from "@/store/toast";
import { useTr } from "@/lib/i18n";
import { cn } from "@/lib/cn";

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
 *  Self-contained so it can sit in `/profil` today and replace `/saya`'s tap
 *  button when that lands (D331). The parent names the button (MASUK /
 *  PULANG, read from the day, D307) and hears about a written tap. */

const ZONE = OFFICE_TZ.short;

type Reading = TapReading & { denied: boolean };

type Phase =
  | { at: "idle" }
  | { at: "reading" }
  | { at: "sending" }
  | { at: "form"; reading: Reading; where: LocationJudgement }
  | { at: "done"; where: LocationJudgement; at_: string; denied: boolean };

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
}: {
  /** What the button says. The parent reads the day to decide it (D307). */
  label?: string;
  tone?: "brand" | "amber";
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
  const selfieRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.preview); }, [photo]);

  function written(r: TapSelfResult, denied: boolean) {
    const clock = `${officeClock(new Date(r.at))} ${ZONE}`;
    const line = whereLine(r.location, denied);
    toast(
      r.location.needs_note ? "warning" : "success",
      tr(`Tap recorded · ${clock}`, `Tap tercatat · ${clock}`),
      r.location.needs_note
        ? tr(`${line.text}. Flagged for HRD with your note.`, `${line.text}. Ditandai untuk HRD beserta keterangan Anda.`)
        : line.text + ".",
    );
    setPhase({ at: "done", where: r.location, at_: r.at, denied });
    setNote("");
    setPhoto(null);
    onTapped?.(r);
  }

  async function press() {
    setPhase({ at: "reading" });
    const reading = await readOnce();
    setPhase({ at: "sending" });
    const res = await hr.tapSelf({ lat: reading.lat, lng: reading.lng, accuracy_m: reading.accuracy_m }, newKey());
    if (!res.error) return written(res.data, reading.denied);
    if (res.error.code === "off_site_needs_note" && res.error.detail) {
      setPhase({ at: "form", reading, where: res.error.detail as unknown as LocationJudgement });
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
    const { reading } = phase;
    setPhase({ at: "sending" });
    const res = await hr.tapSelf({
      lat: reading.lat, lng: reading.lng, accuracy_m: reading.accuracy_m,
      note: note.trim(), photo_id: photo?.id ?? null,
    }, newKey());
    if (!res.error) return written(res.data, reading.denied);
    setPhase({ at: "form", reading, where: phase.where });
    toast(res.error.status === 403 ? "critical" : "warning", tr("Not recorded", "Tidak tercatat"), res.error.message);
  }

  const busy = phase.at === "reading" || phase.at === "sending";

  return (
    <div className={cn("space-y-3", className)} data-testid="located-tap">
      {phase.at !== "form" && (
        <button
          type="button"
          onClick={press}
          disabled={busy || disabled}
          className={cn(
            "flex w-full items-center justify-center gap-3 rounded-2xl font-bold tracking-wide text-white shadow-sm transition active:scale-[0.99] disabled:opacity-60",
            size === "lg" ? "h-20 text-[22px]" : "h-16 text-[19px]",
            tone === "amber" ? "bg-amber-600 active:bg-amber-700" : "bg-brand-600 active:bg-brand-700",
          )}
        >
          <Fingerprint className={size === "lg" ? "h-8 w-8" : "h-7 w-7"} />
          {phase.at === "reading" ? tr("Reading location…", "Membaca lokasi…")
            : phase.at === "sending" ? tr("Recording…", "Mencatat…")
            : label ?? tr("Tap attendance", "Tap presensi")}
        </button>
      )}

      {phase.at === "done" && (() => {
        const line = whereLine(phase.where, phase.denied);
        return (
          <p data-testid="where" className={cn(
            "flex items-center justify-center gap-1.5 text-[13px] font-medium",
            line.tone === "green" ? "text-emerald-700" : line.tone === "amber" ? "text-amber-700" : "text-slate-500",
          )}>
            <MapPin className="h-4 w-4" />
            {line.text} · {officeClock(new Date(phase.at_))} {ZONE}
          </p>
        );
      })()}

      {phase.at === "form" && (() => {
        const line = whereLine(phase.where, phase.reading.denied);
        const { lat, lng, accuracy_m } = phase.reading;
        return (
          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 text-left" data-testid="off-site-form">
            <p data-testid="where" className="flex items-center gap-1.5 text-[14px] font-semibold text-amber-800">
              {lat === null ? <MapPinOff className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
              {line.text}
            </p>
            <p className="mt-1 text-[12px] text-amber-900/80">
              {tr(
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
              {tr("Note", "Keterangan")} <span className="text-rose-600">*</span>
            </label>
            <textarea
              id="off-site-note"
              value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              placeholder={tr("Why here? e.g. collecting timber from the supplier", "Kenapa di sini? mis. ambil kayu di pemasok")}
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
                {tr("Record attendance", "Catat presensi")}
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
          "Your location is read once, when you press the button — never tracked.",
          "Lokasi dibaca sekali, saat tombol ditekan — tidak dilacak.",
        )}
      </p>
    </div>
  );
}

/** Where one tap was made, in one line (D344): the warehouse for the reader,
 *  the reading and the selfie for a phone, the reason for one typed in. Each
 *  point opens in Google Maps. */
export function TapWhereLine({ where }: { where: TapWhere | undefined }) {
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
  );
}
