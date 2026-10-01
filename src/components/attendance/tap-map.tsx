"use client";

import { useEffect, useMemo, useRef } from "react";
import { Fingerprint, MapPin, MapPinOff, PencilLine, Smartphone } from "lucide-react";
import "leaflet/dist/leaflet.css";
import type { TimesheetDay, WorkSite } from "@/services/hr/contracts";
import type { TapWhere } from "@/services/hr/tap-where";
import { officeClock } from "@/lib/office";
import { useTr } from "@/lib/i18n";
import { mapLink, metres } from "./located-tap";

/** Where everybody tapped on one day, on a map (D361).
 *
 *  Owner: *di timesheet attendance, tambahkan maps di bawahnya untuk melihat
 *  hari ini karyawan absen dari mana saja.* Nothing new is read: every tap on
 *  the timesheet already says where it was made (D344) — the reader's site
 *  for a fingerprint, the phone's own reading for a phone tap. This draws
 *  them:
 *
 *   - each work site as its circle (the radius a phone tap is judged by);
 *   - the fingerprint reader as one point on its site, with how many people
 *     tapped there — a hundred dots on the same spot say less than a number;
 *   - each phone tap where the phone said it was: green inside a site, amber
 *     outside it or too loose to tell, with the person, the time, the
 *     distance and the selfie in its popup;
 *   - beside it, the same in words, so a tap with no location — which has no
 *     place on a map — is still counted and named.
 *
 *  Leaflet with OpenStreetMap tiles: no key, and the tiles are fetched by the
 *  viewer's browser only. Leaflet touches `window`, so it is imported inside
 *  the effect and never on the server. */

export interface PhoneTap {
  employee_no: string;
  full_name: string;
  at: string;
  where: TapWhere;
}

export interface DayPlaces {
  /** Fingerprint taps, by the site the reader stands in. */
  machine: { site_code: string | null; site_name: string | null; lat: number | null; lng: number | null; people: { full_name: string; first: string }[] }[];
  /** Phone taps that carry a point. */
  phone: PhoneTap[];
  /** Phone taps the phone could not place. */
  noLocation: PhoneTap[];
  /** Taps HRD typed in. */
  typed: PhoneTap[];
}

/** One day's taps, grouped by where they were made. Pure. */
export function placesOf(days: TimesheetDay[]): DayPlaces {
  const machine = new Map<string, DayPlaces["machine"][number]>();
  const phone: PhoneTap[] = [];
  const noLocation: PhoneTap[] = [];
  const typed: PhoneTap[] = [];
  for (const d of days) {
    for (const s of d.scans) {
      const w = s.where;
      if (!w) continue;
      const tap = { employee_no: d.employee_no, full_name: d.full_name, at: s.at, where: w };
      if (w.kind === "machine") {
        const key = w.site_code ?? "?";
        const g = machine.get(key)
          ?? { site_code: w.site_code, site_name: w.site_name, lat: w.lat, lng: w.lng, people: [] };
        /* One row per person, at their first tap: the reader is a place, and
           how many people were at it is the question. */
        if (!g.people.some((p) => p.full_name === d.full_name)) g.people.push({ full_name: d.full_name, first: s.at });
        machine.set(key, g);
      } else if (w.kind === "manual") {
        typed.push(tap);
      } else if (w.lat != null && w.lng != null) {
        phone.push(tap);
      } else {
        noLocation.push(tap);
      }
    }
  }
  return { machine: [...machine.values()], phone, noLocation, typed };
}

const INSIDE = "#059669";
const AWAY = "#d97706";
const SITE = "#2563eb";

export function TapMap({ days, sites, date }: { days: TimesheetDay[]; sites: WorkSite[]; date: string }) {
  const tr = useTr();
  const lang = tr("en", "id") as "en" | "id";
  const places = useMemo(() => placesOf(days.filter((d) => d.work_date === date)), [days, date]);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    /* `useTr` hands back a new function every render; keyed on the language
       instead, so the map is built once per day shown, not once per render. */
    const t = (en: string, id: string) => (lang === "id" ? id : en);
    let disposed = false;
    let map: import("leaflet").Map | null = null;
    (async () => {
      const L = (await import("leaflet")).default;
      if (disposed || !box.current) return;
      map = L.map(box.current, { scrollWheelZoom: false, attributionControl: true });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap",
      }).addTo(map);

      const bounds: [number, number][] = [];
      const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

      for (const w of sites.filter((x) => x.active && x.lat != null && x.lng != null)) {
        L.circle([w.lat!, w.lng!], { radius: w.radius_m, color: SITE, weight: 1, fillOpacity: 0.08 })
          .bindTooltip(esc(w.name))
          .addTo(map);
        bounds.push([w.lat!, w.lng!]);
      }
      for (const g of places.machine.filter((x) => x.lat != null && x.lng != null)) {
        const list = g.people
          .sort((a, b) => a.first.localeCompare(b.first))
          .map((p) => `${esc(p.full_name)} · ${officeClock(new Date(p.first))}`)
          .join("<br>");
        L.circleMarker([g.lat!, g.lng!], { radius: 11, color: SITE, weight: 2, fillColor: SITE, fillOpacity: 0.85 })
          .bindTooltip(String(g.people.length), { permanent: true, direction: "center", className: "tap-map-count" })
          .bindPopup(`<strong>${esc(g.site_name ?? "")}</strong> — ${t("fingerprint reader", "mesin sidik jari")}<br>${list}`)
          .addTo(map);
        bounds.push([g.lat!, g.lng!]);
      }
      for (const tap of places.phone) {
        const inside = tap.where.verdict === "inside";
        const what = inside
          ? t(`at ${tap.where.site_name ?? "the site"}`, `di ${tap.where.site_name ?? "lokasi"}`)
          : tap.where.verdict === "outside"
            ? t(`outside · ${metres(tap.where.distance_m ?? 0, lang)} from ${tap.where.site_name ?? "the site"}`,
                 `di luar · ${metres(tap.where.distance_m ?? 0, lang)} dari ${tap.where.site_name ?? "lokasi"}`)
            : t("location too loose to tell", "lokasi kurang tepat");
        const links = [
          `<a href="${mapLink(tap.where.lat!, tap.where.lng!)}" target="_blank" rel="noreferrer">${t("Google Maps", "Google Maps")}</a>`,
          tap.where.photo_link ? `<a href="${esc(tap.where.photo_link)}" target="_blank" rel="noreferrer">${t("selfie", "foto selfie")}</a>` : "",
        ].filter(Boolean).join(" · ");
        L.circleMarker([tap.where.lat!, tap.where.lng!], {
          radius: 7, color: "#fff", weight: 2, fillColor: inside ? INSIDE : AWAY, fillOpacity: 1,
        })
          .bindPopup(
            `<strong>${esc(tap.full_name)}</strong> · ${officeClock(new Date(tap.at))}<br>`
            + `${t("Phone", "HP")} · ${esc(what)}`
            + (tap.where.note ? `<br>“${esc(tap.where.note)}”` : "")
            + `<br>${links}`,
          )
          .addTo(map);
        bounds.push([tap.where.lat!, tap.where.lng!]);
      }

      if (bounds.length === 1) map.setView(bounds[0], 16);
      else if (bounds.length > 1) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 });
      else map.setView([-6.6, 110.68], 11);
    })();
    return () => { disposed = true; map?.remove(); };
  }, [places, sites, lang]);

  const outside = places.phone.filter((t) => t.where.verdict !== "inside");
  const insidePhone = places.phone.filter((t) => t.where.verdict === "inside");
  const people = (xs: PhoneTap[]) => new Set(xs.map((x) => x.employee_no)).size;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
      {/* `isolate` keeps Leaflet's panes (z-index 400+) under the app's
          drawers and sticky headers. */}
      <div ref={box} className="isolate h-[380px] w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100" data-testid="tap-map" />
      <div className="space-y-3 text-[12px]">
        {places.machine.map((g) => (
          <div key={g.site_code ?? "?"}>
            <p className="flex items-center gap-1.5 font-medium text-slate-800">
              <Fingerprint className="h-3.5 w-3.5 text-blue-600" />
              {tr(`${g.site_name ?? "Reader"} · fingerprint`, `${g.site_name ?? "Mesin"} · sidik jari`)}
              <span className="ml-auto tabular-nums text-slate-500">{tr(`${g.people.length} ${(g.people.length) === 1 ? "person" : "people"}`, `${g.people.length} orang`)}</span>
            </p>
          </div>
        ))}
        <p className="flex items-center gap-1.5 font-medium text-slate-800">
          <Smartphone className="h-3.5 w-3.5 text-emerald-600" />
          {tr("Phone, inside a site", "HP, di dalam area")}
          <span className="ml-auto tabular-nums text-slate-500">{tr(`${people(insidePhone)} ${(people(insidePhone)) === 1 ? "person" : "people"}`, `${people(insidePhone)} orang`)}</span>
        </p>
        <div>
          <p className="flex items-center gap-1.5 font-medium text-slate-800">
            <MapPin className="h-3.5 w-3.5 text-amber-600" />
            {tr("Phone, outside or unclear", "HP, di luar area / kurang tepat")}
            <span className="ml-auto tabular-nums text-slate-500">{tr(`${people(outside)} ${(people(outside)) === 1 ? "person" : "people"}`, `${people(outside)} orang`)}</span>
          </p>
          {outside.length > 0 && (
            <ul className="mt-1 space-y-0.5 pl-5 text-slate-600">
              {outside.map((t) => (
                <li key={`${t.employee_no}-${t.at}`}>
                  {t.full_name} · {officeClock(new Date(t.at))}
                  {t.where.verdict === "outside" && ` · ${metres(t.where.distance_m ?? 0, lang)}`}
                  {" "}
                  <a href={mapLink(t.where.lat!, t.where.lng!)} target="_blank" rel="noreferrer" className="text-brand-700 underline">{tr("map", "peta")}</a>
                </li>
              ))}
            </ul>
          )}
        </div>
        {places.noLocation.length > 0 && (
          <div>
            <p className="flex items-center gap-1.5 font-medium text-slate-800">
              <MapPinOff className="h-3.5 w-3.5 text-amber-600" />
              {tr("Phone, no location", "HP, tanpa lokasi")}
              <span className="ml-auto tabular-nums text-slate-500">{tr(`${people(places.noLocation)} ${(people(places.noLocation)) === 1 ? "person" : "people"}`, `${people(places.noLocation)} orang`)}</span>
            </p>
            <ul className="mt-1 space-y-0.5 pl-5 text-slate-600">
              {places.noLocation.map((t) => (
                <li key={`${t.employee_no}-${t.at}`}>{t.full_name} · {officeClock(new Date(t.at))}{t.where.note ? ` — “${t.where.note}”` : ""}</li>
              ))}
            </ul>
          </div>
        )}
        {places.typed.length > 0 && (
          <p className="flex items-center gap-1.5 font-medium text-slate-800">
            <PencilLine className="h-3.5 w-3.5 text-slate-500" />
            {tr("Typed by HRD", "Diketik HRD")}
            <span className="ml-auto tabular-nums text-slate-500">{tr(`${people(places.typed)} ${(people(places.typed)) === 1 ? "person" : "people"}`, `${people(places.typed)} orang`)}</span>
          </p>
        )}
        <p className="text-[11px] text-slate-400">
          {tr(
            "Blue: work sites and the fingerprint reader (the number is people). Green: phone inside a site. Amber: phone outside or unclear. Click a point for the person, time and selfie.",
            "Biru: lokasi kerja dan mesin sidik jari (angkanya jumlah orang). Hijau: HP di dalam area. Kuning: HP di luar area atau kurang tepat. Klik titik untuk nama, jam dan foto selfie.",
          )}
        </p>
      </div>
    </div>
  );
}
