/** Implements `/api/v1/identity` from `03-api.md`. */
import { ok, noop, invalid, notFound, refused, type Result } from "@/services/_shared/envelope";
import type {
  Session, Authority, ModuleName, ModuleLevel,
  ActivityEvent, ActivityDaily, RetentionStatus, AuditRowView, AppSetting,
} from "@/services/identity/contracts";
import { expandPermissions } from "@/lib/roles";
import { getState, apply, newId, writeAudit } from "../store";
import type { DemoUser } from "../state";
import { latency, actingUser, requireModule, requireLevel } from "./_kit";
import { officeDay as sharedOfficeDay } from "@/lib/office";

const SERVICE = "identity" as const;

function toSession(user: DemoUser): Session {
  return {
    user: { id: user.id, email: user.email, full_name: user.full_name, is_active: user.is_active },
    modules: user.modules,
    authorities: user.authorities,
    permissions: expandPermissions(user.modules),
  };
}

/** `GET /identity/me`. The frontend `can()` is fed from `permissions`, which is
 *  the union of the module grants — derived here, never stored (D23, D24). */
export async function me(): Promise<Result<Session>> {
  await latency();
  return ok(SERVICE, toSession(actingUser()));
}

export async function listUsers(): Promise<Result<Session[]>> {
  await latency();
  return ok(SERVICE, getState().users.map(toSession));
}

/** Demo only: switch which person is acting, so permissions can be shown
 *  working rather than described. Deleted in Phase 2 along with this layer. */
export async function actAs(userId: string): Promise<Result<Session>> {
  await latency();
  const user = getState().users.find((u) => u.id === userId);
  if (!user) return notFound(SERVICE, "user_not_found", "User not found.");
  apply((draft) => {
    /* In Phase 1 this is "act as"; in Phase 2 it is a sign-in. Either way it is
     * a recorded fact: an access trail with no session events cannot answer
     * "who was in the system at the time", which is usually the first question
     * anyone asks it. */
    draft.session_user_id = userId;
    writeAudit(draft, {
      service: SERVICE, entity: "session", entity_no: user.email,
      action: "sign_in", outcome: "ok", reason: "demo act-as",
    });
  });
  return ok(SERVICE, toSession(user));
}

/** Demo only: toggle a grant, so a reviewer can watch the ledger leave the
 *  menu when accounting is switched off (D22). */
export async function setModules(
  userId: string,
  modules: { module: ModuleName; level: ModuleLevel }[],
): Promise<Result<Session>> {
  await latency();
  const denied = requireLevel(SERVICE, "it", "admin");
  if (denied) return denied;
  let updated: DemoUser | undefined;
  apply((draft) => {
    const user = draft.users.find((u) => u.id === userId);
    if (!user) return;
    user.modules = modules;
    updated = user;
    writeAudit(draft, {
      service: SERVICE, entity: "user", entity_no: user.email,
      action: "modules.set", outcome: "ok", reason: null,
    });
  });
  if (!updated) return notFound(SERVICE, "user_not_found", "User not found.");
  return ok(SERVICE, toSession(updated));
}

export async function setAuthorities(
  userId: string,
  authorities: Authority[],
): Promise<Result<Session>> {
  await latency();
  const denied = requireLevel(SERVICE, "it", "admin");
  if (denied) return denied;
  let updated: DemoUser | undefined;
  apply((draft) => {
    const user = draft.users.find((u) => u.id === userId);
    if (!user) return;
    user.authorities = authorities;
    updated = user;
    writeAudit(draft, {
      service: SERVICE, entity: "user", entity_no: user.email,
      action: "authorities.set", outcome: "ok", reason: null,
    });
  });
  if (!updated) return notFound(SERVICE, "user_not_found", "User not found.");
  return ok(SERVICE, toSession(updated));
}

/* ── Audit, activity, and the two retention rules ─────────────────────────
 *
 *  The owner's answer to Q22, as code (D188): **detail for 30 days, a daily
 *  recap per person kept 6 months.** Everything here follows from those two
 *  numbers, including the one thing this system otherwise never does — delete.
 */
export const RETENTION = { DETAIL_DAYS: 30, RECAP_MONTHS: 6 } as const;

/** The office day, WITA. A log that rolls over at UTC midnight cuts the
 *  workshop's afternoon in half (F17); one definition for the whole system
 *  (F63). */
function officeDay(at: Date = new Date()): string {
  return sharedOfficeDay(at);
}

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
}

/** What changed, with who and why. Never deleted (A5) — this is evidence about
 *  **records**, and it is the opposite case from activity below. */
export async function listAudit(
  opts: { entity_no?: string; actor?: string; outcome?: string; action?: string; service?: string; limit?: number } = {},
): Promise<Result<AuditRowView[]>> {
  await latency();
  const denied = requireModule(SERVICE, "it");
  if (denied) return denied;

  let rows = [...getState().audit_log];
  if (opts.entity_no) rows = rows.filter((r) => r.entity_no?.toLowerCase().includes(opts.entity_no!.toLowerCase()));
  if (opts.actor) rows = rows.filter((r) => r.actor_email.toLowerCase().includes(opts.actor!.toLowerCase()));
  if (opts.outcome) rows = rows.filter((r) => r.outcome === opts.outcome);
  if (opts.action) rows = rows.filter((r) => r.action === opts.action);
  if (opts.service) rows = rows.filter((r) => r.service === opts.service);

  return ok(SERVICE, rows
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, opts.limit ?? 300)
    .map((r) => ({
      id: r.id, at: r.at, actor_email: r.actor_email,
      service: r.service, entity: r.entity, entity_no: r.entity_no,
      action: r.action, outcome: r.outcome, reason: r.reason,
      detail: (r.detail ?? null) as Record<string, unknown> | null,
    })));
}

/** The detail: who opened what, inside the thirty-day window.
 *
 *  Deliberately coarse — a screen, a print, an export. Keystroke-level
 *  watching is surveillance nobody asked for, and the question this answers is
 *  *what was this person doing*, not *what did they type*.
 */
export async function listActivity(
  opts: { actor?: string; day?: string; limit?: number } = {},
): Promise<Result<ActivityEvent[]>> {
  await latency();
  const denied = requireModule(SERVICE, "it");
  if (denied) return denied;

  let rows = [...getState().activity_events];
  if (opts.actor) rows = rows.filter((r) => r.actor_id === opts.actor || r.actor_email === opts.actor);
  if (opts.day) rows = rows.filter((r) => officeDay(new Date(r.at)) === opts.day);
  return ok(SERVICE, rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, opts.limit ?? 200));
}

/** The recaps: one row per person per day, kept six months. */
export async function listActivityDaily(
  opts: { actor?: string; limit?: number } = {},
): Promise<Result<ActivityDaily[]>> {
  await latency();
  const denied = requireModule(SERVICE, "it");
  if (denied) return denied;

  let rows = [...getState().activity_daily];
  if (opts.actor) rows = rows.filter((r) => r.actor_id === opts.actor || r.actor_email === opts.actor);
  return ok(SERVICE, rows
    .sort((a, b) => b.day.localeCompare(a.day) || a.full_name.localeCompare(b.full_name))
    .slice(0, opts.limit ?? 200));
}

export async function getRetention(): Promise<Result<RetentionStatus>> {
  await latency();
  const denied = requireModule(SERVICE, "it");
  if (denied) return denied;

  const state = getState();
  const events = state.activity_events;
  const recaps = state.activity_daily;
  const recapDays = new Set(recaps.map((r) => `${r.day}|${r.actor_id}`));
  const eventDays = new Set(events.map((e) => `${officeDay(new Date(e.at))}|${e.actor_id}`));

  return ok(SERVICE, {
    detail_days: RETENTION.DETAIL_DAYS,
    recap_months: RETENTION.RECAP_MONTHS,
    events_total: events.length,
    events_expiring: events.filter((e) => daysAgo(e.at) >= RETENTION.DETAIL_DAYS).length,
    oldest_event: [...events].sort((a, b) => a.at.localeCompare(b.at))[0]?.at ?? null,
    recaps_total: recaps.length,
    recaps_expiring: recaps.filter((r) => daysAgo(`${r.day}T12:00:00+08:00`) >= RETENTION.RECAP_MONTHS * 30).length,
    oldest_recap: [...recaps].sort((a, b) => a.day.localeCompare(b.day))[0]?.day ?? null,
    /* A day whose events will expire with no recap behind them is the one
       failure this design can have: the detail goes and nothing is left. */
    days_unrolled: [...eventDays].filter((k) => !recapDays.has(k)).length,
  });
}

/** Rolling a day up.
 *
 *  This is the one place in the system where a derived figure is **stored**,
 *  and the reason is the retention rule itself: the recap has to outlive the
 *  events it was computed from (D188). Everything else is computed on read
 *  precisely because it can be.
 */
export async function rollUpActivity(
  input: { day?: string } = {},
): Promise<Result<{ day: string; written: number; skipped: number }>> {
  await latency();
  /* Writing, not reading — so leadership's `it: read` does not reach it. In
     Phase 2 this is a nightly job and nobody presses it at all (D190). */
  const denied = requireLevel(SERVICE, "it", "write");
  if (denied) return denied;

  const state = getState();
  const target = input.day ?? officeDay(new Date(Date.now() - 86_400_000));
  const events = state.activity_events.filter((e) => officeDay(new Date(e.at)) === target);
  if (events.length === 0) {
    return invalid(SERVICE, "nothing_to_roll", `Tidak ada aktivitas tercatat pada ${target}.`, { field: "day" });
  }

  const user = actingUser();
  let written = 0;
  let skipped = 0;
  apply((draft) => {
    const byActor = new Map<string, ActivityEvent[]>();
    for (const e of events) {
      const list = byActor.get(e.actor_id) ?? [];
      list.push(e);
      byActor.set(e.actor_id, list);
    }

    for (const [actorId, list] of byActor) {
      if (draft.activity_daily.some((r) => r.day === target && r.actor_id === actorId)) { skipped += 1; continue; }
      const sorted = [...list].sort((a, b) => a.at.localeCompare(b.at));
      const counts = new Map<string, number>();
      for (const e of sorted) counts.set(e.label, (counts.get(e.label) ?? 0) + 1);

      const person = draft.users.find((u) => u.id === actorId);
      const audits = draft.audit_log.filter(
        (a) => a.actor_id === actorId && a.at.slice(0, 10) === target,
      );

      draft.activity_daily.push({
        id: newId("acd"),
        day: target,
        actor_id: actorId,
        actor_email: sorted[0].actor_email,
        full_name: person?.full_name ?? sorted[0].actor_email,
        events: sorted.length,
        first_at: sorted[0].at,
        last_at: sorted[sorted.length - 1].at,
        top_screens: [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([label, count]) => ({ label, count })),
        /* Taken from the audit trail rather than counted here: the difference
           between a day of reading and a day of deciding is what the recap is
           for, and the audit row is the only honest source of it. */
        /* A reveal is an act in the audit trail but it changes nothing, so it
           is counted on its own line rather than inflating this one (D197). */
        changes: audits.filter((a) => a.outcome === "ok" && a.action !== "reveal").length,
        refusals: audits.filter((a) => a.outcome === "refused").length,
        reveals: audits.filter((a) => a.action === "reveal" && a.outcome === "ok").length,
      });
      written += 1;
    }

    writeAudit(draft, {
      service: SERVICE, entity: "activity", entity_no: target,
      action: "roll_up", outcome: written > 0 ? "ok" : "noop", reason: null,
      detail: { written, skipped, by: user.email },
    });
  });
  return ok(SERVICE, { day: target, written, skipped });
}

/** Applying the two rules.
 *
 *  **The only deletion this system performs**, and it is a rule rather than a
 *  correction — which is exactly the distinction A2 draws. A business record is
 *  never deleted because somebody might need it; a log about a *person* is
 *  deleted because keeping it for ever was never agreed to (Q22, D188). The
 *  sweep says what it removed, and refuses to touch a day that has never been
 *  rolled up.
 */
export async function purgeActivity(): Promise<Result<{ events_removed: number; recaps_removed: number; blocked_days: string[] }>> {
  await latency();
  /* The only deletion in the system sits at the top level of the only module
     that has one. Leadership may read this log; nobody outside IT may end it. */
  const denied = requireLevel(SERVICE, "it", "admin");
  if (denied) return denied;

  const state = getState();
  const recapKeys = new Set(state.activity_daily.map((r) => `${r.day}|${r.actor_id}`));
  const expiring = state.activity_events.filter((e) => daysAgo(e.at) >= RETENTION.DETAIL_DAYS);
  /* A day about to lose its detail with no recap behind it would vanish
     entirely. The sweep stops rather than letting that happen. */
  const blocked = [...new Set(expiring
    .filter((e) => !recapKeys.has(`${officeDay(new Date(e.at))}|${e.actor_id}`))
    .map((e) => officeDay(new Date(e.at))))];

  const user = actingUser();
  let eventsRemoved = 0;
  let recapsRemoved = 0;
  apply((draft) => {
    const before = draft.activity_events.length;
    draft.activity_events = draft.activity_events.filter(
      (e) => daysAgo(e.at) < RETENTION.DETAIL_DAYS
        || !recapKeys.has(`${officeDay(new Date(e.at))}|${e.actor_id}`),
    );
    eventsRemoved = before - draft.activity_events.length;

    const beforeRecaps = draft.activity_daily.length;
    draft.activity_daily = draft.activity_daily.filter(
      (r) => daysAgo(`${r.day}T12:00:00+08:00`) < RETENTION.RECAP_MONTHS * 30,
    );
    recapsRemoved = beforeRecaps - draft.activity_daily.length;

    writeAudit(draft, {
      service: SERVICE, entity: "activity", entity_no: officeDay(),
      action: "purge", outcome: eventsRemoved + recapsRemoved > 0 ? "ok" : "noop",
      reason: `Retensi: detail ${RETENTION.DETAIL_DAYS} hari, rekap ${RETENTION.RECAP_MONTHS} bulan.`,
      detail: { events_removed: eventsRemoved, recaps_removed: recapsRemoved, blocked_days: blocked, by: user.email },
    });
  });
  return ok(SERVICE, { events_removed: eventsRemoved, recaps_removed: recapsRemoved, blocked_days: blocked });
}

/** Recording that somebody looked at something. Called by the screens that
 *  matter — payroll, the ledger, somebody's file — not by every render. */
export async function recordActivity(
  input: { kind: string; target: string; label: string },
): Promise<Result<{ id: string }>> {
  const user = actingUser();
  let id = "";
  apply((draft) => {
    id = newId("act");
    draft.activity_events.unshift({
      id, at: new Date().toISOString(),
      actor_id: user.id, actor_email: user.email,
      kind: input.kind, target: input.target, label: input.label,
    });
  });
  return ok(SERVICE, { id });
}

/* ── Settings ─────────────────────────────────────────────────────────────
 *
 *  The inventory of every number somebody might think is theirs to change,
 *  with what each does to figures that already exist (D214).
 */

export async function listSettings(): Promise<Result<AppSetting[]>> {
  await latency();
  const denied = requireModule(SERVICE, "settings");
  if (denied) return denied;
  return ok(SERVICE, [...getState().app_settings]);
}

/** Changing one.
 *
 *  The refusal is the point of this endpoint. A locked setting is refused
 *  **at the API**, not merely greyed out on the screen — a disabled input is a
 *  suggestion, and the whole reason these are locked is that the change would
 *  quietly rewrite figures somebody has already acted on (D215).
 */
export async function updateSetting(
  input: { key: string; value: string; reason?: string | null },
): Promise<Result<AppSetting>> {
  await latency();
  const denied = requireModule(SERVICE, "settings");
  if (denied) return denied;

  const state = getState();
  const setting = state.app_settings.find((s) => s.key === input.key);
  if (!setting) return notFound(SERVICE, "setting_not_found", `Tidak ada pengaturan ${input.key}.`);

  if (setting.locked_reason) {
    return refused(
      SERVICE, "setting_locked",
      setting.managed_at
        ? `${setting.locked_reason} Diubah di ${setting.managed_at}.`
        : setting.locked_reason,
      { key: setting.key, managed_at: setting.managed_at, affects: setting.affects },
    );
  }

  const value = input.value?.trim() ?? "";
  if (!value) {
    return invalid(SERVICE, "value_required", "Kosong bukan nilai. Kembalikan ke bawaan kalau memang tidak dipakai.", { field: "value" });
  }
  if (setting.kind === "number" && !/^\d+(\.\d+)?$/.test(value)) {
    return invalid(SERVICE, "not_a_number", `${setting.label} diisi angka${setting.unit ? ` dalam ${setting.unit}` : ""}.`, { field: "value" });
  }
  if (setting.kind === "choice" && setting.choices && !setting.choices.includes(value)) {
    return invalid(SERVICE, "not_a_choice", `Pilihannya: ${setting.choices.join(", ")}.`, { field: "value" });
  }
  if (value === setting.value) {
    return noop(SERVICE, setting);
  }

  const user = actingUser();
  apply((draft) => {
    const row = draft.app_settings.find((s) => s.key === input.key)!;
    const before = row.value;
    row.value = value;
    row.updated_by = user.email;
    row.updated_at = new Date().toISOString();
    writeAudit(draft, {
      service: SERVICE, entity: "setting", entity_no: row.key,
      action: "update", outcome: "ok", reason: input.reason?.trim() || null,
      /* Before and after, always. A settings change is the kind of thing
         nobody remembers making and everybody notices the effect of. */
      detail: { before, after: value, by: user.email },
    });
  });

  return ok(SERVICE, getState().app_settings.find((s) => s.key === input.key)!);
}
