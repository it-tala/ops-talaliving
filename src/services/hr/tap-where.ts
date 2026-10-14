/** Where a tap was made, as the attendance screen says it (D344).
 *
 *  Owner (HRD evaluation): *tidak ada keterangan absensi di kantor apa dimana —
 *  tambahkan serta sisipkan link lokasi gmaps dimana dia absen dan foto selfie
 *  (jika absen biometric default lokasi di warehouse).* Three kinds of tap, three
 *  answers:
 *
 *   - **machine** — the fingerprint reader stands in the warehouse, so its taps
 *     are at the warehouse: the site coded `MACHINE_SITE_CODE`, or the first
 *     active site when there is none by that code. The point shown is the
 *     site's, not a reading — the reader reports none.
 *   - **phone** — the reading taken at the tap (0188): the point itself, the
 *     nearest site it was judged against, the verdict, the note and the selfie.
 *   - **manual** — typed by HRD; the reason is what there is to say.
 *
 *  A phone tap also carries its **trace** (0270, D431/D432): the address the
 *  server saw, the office-network reading and the phone's own device id, so
 *  the timesheet shows it under the place, for every tap and not only the
 *  flagged ones on `/hrd/absensi/lokasi`.
 *
 *  A pure function so both clients answer the same (ADR-009). It imports
 *  nothing but types.
 */
import type { LocationVerdict, ScanSource, WorkSite } from "./contracts";

/** The site the fingerprint reader stands in. */
export const MACHINE_SITE_CODE = "GUDANG";

export interface TapWhere {
  kind: "machine" | "phone" | "manual";
  site_code: string | null;
  site_name: string | null;
  /** Where the tap was made (phone), or the site's point (machine). */
  lat: number | null;
  lng: number | null;
  /** Phone only. */
  verdict: LocationVerdict | null;
  distance_m: number | null;
  accuracy_m: number | null;
  note: string | null;
  photo_id: string | null;
  photo_link: string | null;
  photo_filename: string | null;
  /** Manual only: why it was typed in. */
  reason: string | null;
  /** Phone only, and only for a tap made after `0270`: null before it. */
  trace: TapTrace | null;
}

/** The trace columns of `v_located_tap` (0270): the server's reading of the
 *  network, and the phone's word about itself. */
export interface TapTrace {
  ip: string | null;
  user_agent: string | null;
  device_id: string | null;
  device_at: string | null;
  app_build: string | null;
  on_site_network: boolean | null;
  network_site_code: string | null;
  device_people: number | null;
  device_new: boolean | null;
}

/** The phone's own reading of a tap, as `v_located_tap` carries it. */
export interface TapReadingRow {
  lat: number | null;
  lng: number | null;
  verdict: LocationVerdict;
  distance_m: number | null;
  accuracy_m: number | null;
  site_code: string | null;
  site_name: string | null;
  note: string | null;
  photo_id: string | null;
  photo_link: string | null;
  photo_filename: string | null;
}

/** A reading with its trace, as `v_located_tap` carries both. */
export type TapReadingWithTrace = TapReadingRow & Partial<TapTrace>;

/** The trace of a reading, or null when the tap has none (made before 0270). */
export function traceOf(r: Partial<TapTrace> | null): TapTrace | null {
  if (!r || (r.ip == null && r.device_id == null && r.user_agent == null)) return null;
  return {
    ip: r.ip ?? null, user_agent: r.user_agent ?? null, device_id: r.device_id ?? null,
    device_at: r.device_at ?? null, app_build: r.app_build ?? null,
    on_site_network: r.on_site_network ?? null, network_site_code: r.network_site_code ?? null,
    device_people: r.device_people ?? null, device_new: r.device_new ?? null,
  };
}

export function machineSite(sites: WorkSite[]): WorkSite | null {
  return sites.find((w) => w.code === MACHINE_SITE_CODE)
    ?? sites.filter((w) => w.active).sort((a, b) => a.code.localeCompare(b.code))[0]
    ?? null;
}

export function tapWhere(
  source: ScanSource,
  reason: string | null,
  reading: TapReadingWithTrace | null,
  sites: WorkSite[],
): TapWhere {
  const blank = {
    verdict: null, distance_m: null, accuracy_m: null, note: null,
    photo_id: null, photo_link: null, photo_filename: null, reason: null, trace: null,
  };
  if (source === "self") {
    return {
      kind: "phone",
      site_code: reading?.site_code ?? null,
      site_name: reading?.site_name ?? null,
      lat: reading?.lat ?? null,
      lng: reading?.lng ?? null,
      verdict: reading?.verdict ?? "no_location",
      distance_m: reading?.distance_m ?? null,
      accuracy_m: reading?.accuracy_m ?? null,
      note: reading?.note ?? null,
      photo_id: reading?.photo_id ?? null,
      photo_link: reading?.photo_link ?? null,
      photo_filename: reading?.photo_filename ?? null,
      reason: null,
      trace: traceOf(reading),
    };
  }
  if (source === "manual") {
    return { kind: "manual", site_code: null, site_name: null, lat: null, lng: null, ...blank, reason };
  }
  const w = machineSite(sites);
  return {
    kind: "machine",
    site_code: w?.code ?? null,
    site_name: w?.name ?? null,
    lat: w?.lat ?? null,
    lng: w?.lng ?? null,
    ...blank,
  };
}
