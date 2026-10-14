import type { TapClientContext } from "@/services/hr/contracts";

/** What this phone can say about itself at a tap (0270, D431).
 *
 *  Evidence, not proof: everything here is reported by the browser and could be
 *  anything. The layers that matter more — the address, the user agent the
 *  request really carried, the auth session — are read by the database from
 *  the request itself (`ops_core.request_trace`) and are never sent from here.
 *
 *  **No MAC address.** A browser never exposes one. The per-install device id
 *  below is the stand-in: made once, kept in this browser's storage, and lost
 *  when that storage is cleared — so a "new device" is a lead, not a verdict. */

const DEVICE_KEY = "ops.device_id";

function newDeviceId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** This install's id, made on first use. Null when storage is blocked
 *  (private window, cleared site data): the tap goes on without it. */
export function deviceId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const kept = window.localStorage.getItem(DEVICE_KEY);
    if (kept && /^[A-Za-z0-9_-]{8,64}$/.test(kept)) return kept;
    const made = newDeviceId();
    window.localStorage.setItem(DEVICE_KEY, made);
    return window.localStorage.getItem(DEVICE_KEY) === made ? made : null;
  } catch {
    return null;
  }
}

/** The context sent with a tap. Never throws: a layer it cannot read is null. */
export function tapClientContext(): TapClientContext {
  const nav = typeof navigator === "undefined" ? null : navigator;
  const uaData = (nav as (Navigator & { userAgentData?: { platform?: string } }) | null)?.userAgentData;
  let standalone = false;
  let timezone: string | null = null;
  let screenSize: string | null = null;
  try {
    standalone = typeof window !== "undefined"
      && (window.matchMedia?.("(display-mode: standalone)").matches
          || (nav as (Navigator & { standalone?: boolean }) | null)?.standalone === true);
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
    if (typeof window !== "undefined" && window.screen) {
      screenSize = `${window.screen.width}x${window.screen.height}@${Math.round((window.devicePixelRatio || 1) * 10) / 10}`;
    }
  } catch {
    /* A layer that cannot be read is stored as missing, never a failed tap. */
  }
  return {
    device_id: deviceId(),
    device_at: new Date().toISOString(),
    app_build: process.env.NEXT_PUBLIC_OPS_BUILD_ID ?? null,
    display_mode: standalone ? "standalone" : "browser",
    platform: uaData?.platform ?? nav?.platform ?? null,
    language: nav?.language ?? null,
    timezone,
    screen: screenSize,
  };
}
