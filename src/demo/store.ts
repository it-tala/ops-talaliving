/** The store.
 *
 *  A singleton holding the whole sandbox, persisted to `localStorage` so a
 *  reload keeps what you did. Every visitor to the deployed URL gets their own
 *  copy: nothing is shared, nothing is real, and `resetDemo()` puts the
 *  fixtures back.
 *
 *  Screens never touch this. They call `src/demo/api/*`, which is the same
 *  surface a `fetch` will present in Phase 2 — the store is what that API
 *  happens to be sitting on today.
 */
import { initialState, stateSignature } from "./fixtures";
import type { DemoState, AuditRow, OutboxRow } from "./state";
import { setActiveLocale } from "@/lib/format";

const STORAGE_KEY = "ops-v2-demo/v2";

/** Set when hydrate threw away a snapshot because the fixtures had moved on.
 *  Read once by the shell, which says so — otherwise somebody's demo edits
 *  vanish with no explanation and the app looks broken rather than updated. */
let resetOnLoad = false;

export function consumeResetNotice(): boolean {
  const was = resetOnLoad;
  resetOnLoad = false;
  return was;
}

let state: DemoState = initialState();
let hydrated = false;
const listeners = new Set<() => void>();

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      sig: stateSignature(state),
      state,
    }));
  } catch {
    /* Private windows, cleared site data, browsers that block storage. The
     * demo still works; it just forgets. Never let this throw. */
  }
}

/** Called once on the client. Server renders always see the fixtures, which is
 *  correct: there is no per-visitor state on the server. */
export function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { sig?: string; state?: DemoState };
      const fresh = initialState();
      /* A snapshot from before the fixtures moved is worse than no snapshot:
       * it looks like the app, and it is missing whatever was just added
       * (F24). Keep it only while the shape and the reference data match. */
      if (saved.state && saved.sig === stateSignature(fresh)) {
        state = { ...fresh, ...saved.state };
      } else {
        state = fresh;
        resetOnLoad = true;
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
  } catch {
    state = initialState();
  }
  emit();
}

/** Settings that live outside the store's own reach — the number formatter is
 *  a pure function nothing passes state to — are pushed into place whenever
 *  the store changes. One direction, so the setting stays the only source
 *  (D216). */
function applySettings() {
  const locale = state.app_settings?.find((x) => x.key === "format.locale")?.value;
  if (locale) setActiveLocale(locale);
}

function emit() {
  applySettings();
  for (const l of listeners) l();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState(): DemoState {
  return state;
}

export function resetDemo() {
  state = initialState();
  persist();
  emit();
}

/** The only way anything changes. Takes a draft, applies it, persists, and
 *  tells every subscriber — so a screen that reads through `useDemo` updates
 *  without a manual refetch. */
export function apply(mutator: (draft: DemoState) => void) {
  const draft = structuredClone(state);
  mutator(draft);
  state = draft;
  persist();
  emit();
}

/* ------------------------------------------------------------------ */
/* Identifiers — minted here, because here is the database (ADR-005)   */
/* ------------------------------------------------------------------ */

/** The office day is WITA (`Asia/Makassar`), as it is today: "trx ids follow
 *  the office day". */
export function officeDay(at: Date = new Date()): string {
  const wita = new Date(at.getTime() + (8 * 60 + at.getTimezoneOffset()) * 60_000);
  return wita.toISOString().slice(0, 10);
}

/** One atomic step, no collision loop: `core.next_doc_number()` in miniature.
 *  In `john-lau` this needed a reservation table and up to 200 attempts,
 *  because a spreadsheet and a database both had a claim on the number. There
 *  is only one candidate now. */
export function nextDocNumber(
  draft: DemoState,
  prefix: "pr" | "fund" | "trx" | "pay" | "po" | "ask" | "pyr" | "spk" | "lbr" | "kyu" | "stk" | "izn" | "dsn" | "rkk" | "agn" | "lead" | "ppn" | "krm" | "pas" | "tmn" | "bast" | "tgs" | "kol",
  at: Date = new Date(),
): string {
  const day = officeDay(at);
  const key = `${prefix}:${day}`;
  const seq = (draft.doc_numbers[key] ?? 0) + 1;
  draft.doc_numbers[key] = seq;
  const short = day.slice(2).replace(/-/g, "-");
  const width = prefix === "trx" ? 3 : 2;
  return `${prefix}-${short}_${String(seq).padStart(width, "0")}`;
}

let rowSeq = 0;
export function newId(prefix: string): string {
  rowSeq += 1;
  return `${prefix}_${Date.now().toString(36)}${rowSeq.toString(36)}`;
}

/* ------------------------------------------------------------------ */
/* Audit and outbox — written with the business rows, never after      */
/* ------------------------------------------------------------------ */

export function writeAudit(
  draft: DemoState,
  row: Omit<AuditRow, "id" | "at" | "actor_id" | "actor_email">,
) {
  const actor = draft.users.find((u) => u.id === draft.session_user_id);
  draft.audit_log.unshift({
    id: newId("aud"),
    at: new Date().toISOString(),
    actor_id: actor?.id ?? "unknown",
    actor_email: actor?.email ?? "unknown",
    ...row,
  });
}

export function writeOutbox(
  draft: DemoState,
  row: Omit<OutboxRow, "id" | "occurred_at" | "delivered_at">,
) {
  draft.outbox.unshift({
    id: newId("evt"),
    occurred_at: new Date().toISOString(),
    delivered_at: null,
    ...row,
  });
}
