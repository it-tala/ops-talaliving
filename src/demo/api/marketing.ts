/** Implements `/api/v1/marketing` — the **Package** programme (D183).
 *
 *  Two funnels joined at one point. Reaching an agent is the first: message,
 *  wait, chase, and after seven silent days move to the next of the three.
 *  Working with the agent who agreed is the second: they introduce owners, the
 *  introductions become projects, and the projects owe commission.
 *
 *  The scraping and enrichment stay outside — Google Maps and the enrichment
 *  run are not this system's job. What crosses the boundary is a file, imported
 *  the same way every other outside file is: nothing is created for a row it
 *  cannot place, and re-importing changes nothing (D143's shape, again).
 */
import { ok, invalid, notFound, type Result } from "@/services/_shared/envelope";
import type {
  Property, PropertyView, PipelineMetrics, OutreachStage, MarketLevel, MarketView,
  SalesRep, RepView, Referral, ReferralStatus, ScrapeRow,
} from "@/services/marketing/contracts";
import { getState, apply, newId, nextDocNumber, writeAudit, writeOutbox } from "../store";
import {
  propertyView, propertyViews, pipelineMetrics, followUpQueue, repViews, marketViews,
} from "../derive";
import { latency, actingUser, requireModule, conflict, replayed, remember } from "./_kit";
import { officeToday as sharedOfficeToday } from "@/lib/office";

const SERVICE = "marketing" as const;

/** The office day, WITA. The follow-up rule counts days, so which day it is
 *  has to be the office's (F17); one definition for the whole system (F63). */
function officeToday(): string {
  return sharedOfficeToday();
}

/** Every market the scrape has touched — country, city, district (D187). */
export async function listMarkets(): Promise<Result<MarketView[]>> {
  await latency();
  const denied = requireModule(SERVICE, "marketing");
  if (denied) return denied;
  return ok(SERVICE, marketViews(getState()));
}

/** `scope` is a **prefix of the market code**: `AU` is a country,
 *  `AU-QLD-GOLDCOAST` a city, the whole code one district. One filter, three
 *  altitudes, and no screen has to know which is which. */
export async function listProperties(opts: { scope?: string } = {}): Promise<Result<PropertyView[]>> {
  await latency();
  const denied = requireModule(SERVICE, "marketing");
  if (denied) return denied;
  const rows = propertyViews(getState(), officeToday());
  return ok(SERVICE, opts.scope
    ? rows.filter((p) => p.market_code === opts.scope || p.market_code.startsWith(`${opts.scope}-`))
    : rows);
}

export async function getProperty(ref: string): Promise<Result<PropertyView>> {
  await latency();
  const denied = requireModule(SERVICE, "marketing");
  if (denied) return denied;
  const state = getState();
  const p = state.properties.find((x) => x.ref === ref);
  if (!p) return notFound(SERVICE, "property_not_found", `No property ${ref}.`);
  return ok(SERVICE, propertyView(state, p, officeToday()));
}

export async function getMetrics(
  opts: { scope?: string; level?: MarketLevel } = {},
): Promise<Result<PipelineMetrics>> {
  await latency();
  const denied = requireModule(SERVICE, "marketing");
  if (denied) return denied;
  return ok(SERVICE, pipelineMetrics(getState(), officeToday(), opts.scope, opts.level ?? "area"));
}

export async function getQueue(opts: { scope?: string } = {}): Promise<Result<{
  property_ref: string; property_name: string; market_label: string; timezone: string;
  agent_id: string; agent_name: string; slot: number; stage: OutreachStage;
  kind: "move_on" | "due"; waiting_days: number | null; next_action_on: string | null;
}[]>> {
  await latency();
  const denied = requireModule(SERVICE, "marketing");
  if (denied) return denied;
  return ok(SERVICE, followUpQueue(getState(), officeToday(), opts.scope).map(({ property, agent, kind }) => ({
    property_ref: property.ref, property_name: property.name,
    market_label: property.market.label, timezone: property.market.timezone,
    agent_id: agent.id, agent_name: agent.name, slot: agent.slot, stage: agent.stage,
    kind, waiting_days: agent.waiting_days, next_action_on: agent.next_action_on,
  })));
}

/** Moving one agent along the ladder.
 *
 *  Three things happen here that a spreadsheet cannot do for itself: the first
 *  message stamps the date the clock runs from, a reply **stops** the clock,
 *  and a DEAL is refused unless somebody says who the representative is — an
 *  agent at DEAL with no rep behind them is the row that quietly stops the
 *  programme working (D185).
 */
export async function setAgentStage(
  input: { property_ref: string; agent_id: string; stage: OutreachStage; remark?: string | null; next_action_on?: string | null },
): Promise<Result<PropertyView>> {
  await latency();
  const denied = requireModule(SERVICE, "marketing");
  if (denied) return denied;

  const state = getState();
  const property = state.properties.find((p) => p.ref === input.property_ref);
  if (!property) return notFound(SERVICE, "property_not_found", `No property ${input.property_ref}.`);
  const agent = state.property_agents.find((a) => a.id === input.agent_id);
  if (!agent) return notFound(SERVICE, "agent_not_found", "Agen itu tidak ada.");
  if (input.stage === "DEAL" && !agent.rep_id) {
    return invalid(
      SERVICE, "rep_required",
      "Agen yang deal harus di-onboarding dulu sebagai sales representative — beserta persentase komisinya. Tanpa itu tidak ada yang tahu berapa yang harus dibayar.",
      { field: "rep_id" },
    );
  }

  const user = actingUser();
  const today = officeToday();
  apply((draft) => {
    const row = draft.property_agents.find((a) => a.id === input.agent_id);
    if (!row) return;
    const before = row.stage;
    row.stage = input.stage;
    if (input.remark !== undefined) row.remark = input.remark?.trim() || null;

    /* The clock starts when the message goes out and stops when they answer.
       Both are stamped here rather than typed, because a date somebody has to
       remember to fill in is the column that is wrong by Friday (D183). */
    if (input.stage === "MSG SENT" && !row.sent_on) {
      row.sent_on = today;
      row.next_action_on = addDays(today, 7);
    }
    if (rankOf(input.stage) >= rankOf("REPLIED") && !row.replied_on) {
      row.replied_on = today;
    }
    if (input.next_action_on !== undefined) row.next_action_on = input.next_action_on || null;
    if (input.stage === "RECYCLED" || input.stage === "SKIP") row.next_action_on = null;
    row.updated_at = new Date().toISOString();

    writeAudit(draft, {
      service: SERVICE, entity: "property_agent", entity_no: property.ref,
      action: "set_stage", outcome: "ok", reason: row.remark,
      detail: { agent: row.name, slot: row.slot, before, after: row.stage, by: user.email },
    });
    if (input.stage === "DEAL") {
      writeOutbox(draft, {
        service: SERVICE, event_type: "marketing.agent.deal",
        payload: { property_ref: property.ref, agent: row.name, rep_id: row.rep_id },
      });
    }
  });
  return getProperty(input.property_ref);
}

const LADDER: OutreachStage[] = ["QUEUED", "MSG SENT", "REPLIED", "CALL SET", "FORM BACK", "PRESENTATION", "DEAL"];
const rankOf = (s: OutreachStage) => LADDER.indexOf(s);

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Giving up on one agent and starting on the next — the move the tracker's
 *  seven-day rule exists to prompt. Both acts in one call, because doing only
 *  half of it is how a property stalls with nobody chasing anybody (D183). */
export async function moveToNextAgent(
  input: { property_ref: string; agent_id: string; reason: string },
): Promise<Result<PropertyView & { next_agent_name: string | null }>> {
  await latency();
  const denied = requireModule(SERVICE, "marketing");
  if (denied) return denied;
  if (!input.reason.trim()) {
    return invalid(SERVICE, "reason_required", "Tulis alasannya — ini yang dibaca kalau agen ini didekati lagi tahun depan.", { field: "reason" });
  }

  const state = getState();
  const property = state.properties.find((p) => p.ref === input.property_ref);
  if (!property) return notFound(SERVICE, "property_not_found", `No property ${input.property_ref}.`);
  const agent = state.property_agents.find((a) => a.id === input.agent_id);
  if (!agent) return notFound(SERVICE, "agent_not_found", "Agen itu tidak ada.");

  const user = actingUser();
  const today = officeToday();
  let nextName: string | null = null;
  apply((draft) => {
    const row = draft.property_agents.find((a) => a.id === input.agent_id);
    if (!row) return;
    row.stage = "RECYCLED";
    row.remark = input.reason.trim();
    row.next_action_on = null;
    row.updated_at = new Date().toISOString();

    const next = draft.property_agents
      .filter((a) => a.property_id === property.id && a.slot > row.slot && a.stage === "QUEUED")
      .sort((a, b) => a.slot - b.slot)[0];
    if (next) {
      next.stage = "MSG SENT";
      next.sent_on = today;
      next.next_action_on = addDays(today, 7);
      next.updated_at = new Date().toISOString();
      nextName = next.name;
    }

    writeAudit(draft, {
      service: SERVICE, entity: "property_agent", entity_no: property.ref,
      action: "move_on", outcome: "ok", reason: input.reason.trim(),
      detail: { from: row.name, to: nextName, by: user.email },
    });
  });

  const view = await getProperty(input.property_ref);
  if (view.error) return view;
  return ok(SERVICE, { ...view.data, next_agent_name: nextName });
}

/** The agent said yes. From here they are a representative with a rate, and
 *  everything they introduce is counted against it (D185). */
export async function onboardRep(
  input: {
    property_ref: string; agent_id: string;
    commission_percent: number; email?: string | null; note?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<RepView>> {
  await latency();
  const cached = replayed<RepView>(SERVICE, "onboardRep", idempotencyKey);
  if (cached) return cached;

  const denied = requireModule(SERVICE, "marketing");
  if (denied) return denied;
  if (input.commission_percent <= 0 || input.commission_percent > 20) {
    return invalid(
      SERVICE, "commission_out_of_range",
      "Persentase komisi harus antara 0 dan 20. Angka di luar itu hampir pasti salah ketik, dan ini angka yang akan dibayar berkali-kali.",
      { field: "commission_percent" },
    );
  }

  const state = getState();
  const property = state.properties.find((p) => p.ref === input.property_ref);
  if (!property) return notFound(SERVICE, "property_not_found", `No property ${input.property_ref}.`);
  const agent = state.property_agents.find((a) => a.id === input.agent_id);
  if (!agent) return notFound(SERVICE, "agent_not_found", "Agen itu tidak ada.");
  if (agent.rep_id) {
    return conflict(SERVICE, "already_onboarded", `${agent.name} sudah terdaftar sebagai representative.`);
  }

  const user = actingUser();
  let repId = "";
  apply((draft) => {
    const row = draft.property_agents.find((a) => a.id === input.agent_id);
    if (!row) return;
    repId = newId("rep");
    const no = nextDocNumber(draft, "agn");
    draft.sales_reps.push({
      id: repId, rep_no: no, name: row.name, agency: row.agency,
      phone: row.phone, email: input.email?.trim() || row.email,
      market_code: property.market_code,
      commission_percent: input.commission_percent,
      onboarded_on: officeToday(), active: true,
      note: input.note?.trim() || `Dari ${property.ref} ${property.name}.`,
    });
    row.rep_id = repId;
    row.updated_at = new Date().toISOString();
    writeAudit(draft, {
      service: SERVICE, entity: "sales_rep", entity_no: no,
      action: "onboard", outcome: "ok", reason: input.note?.trim() || null,
      detail: { agent: row.name, property: property.ref, commission_percent: input.commission_percent, by: user.email },
    });
    writeOutbox(draft, {
      service: SERVICE, event_type: "marketing.rep.onboarded",
      payload: { rep_no: no, name: row.name, commission_percent: input.commission_percent },
    });
  });

  const view = (await listReps()).data?.find((r) => r.id === repId);
  if (!view) return notFound(SERVICE, "rep_not_found", "Representative baru tidak ditemukan.");
  remember(SERVICE, "onboardRep", idempotencyKey, view);
  return ok(SERVICE, view);
}

export async function listReps(): Promise<Result<RepView[]>> {
  await latency();
  const denied = requireModule(SERVICE, "marketing");
  if (denied) return denied;
  return ok(SERVICE, repViews(getState()).sort((a, b) => b.commission_unpaid - a.commission_unpaid));
}

/** An owner the representative introduced. */
export async function addReferral(
  input: { rep_no: string; owner_name: string; unit?: string | null; property_ref?: string | null; phone?: string | null; note?: string | null },
): Promise<Result<Referral>> {
  await latency();
  const denied = requireModule(SERVICE, "marketing");
  if (denied) return denied;
  if (!input.owner_name.trim()) {
    return invalid(SERVICE, "owner_required", "Tulis nama pemiliknya.", { field: "owner_name" });
  }

  const state = getState();
  const rep = state.sales_reps.find((r) => r.rep_no === input.rep_no);
  if (!rep) return notFound(SERVICE, "rep_not_found", `No representative ${input.rep_no}.`);

  const user = actingUser();
  let created: Referral | null = null;
  apply((draft) => {
    const no = nextDocNumber(draft, "lead");
    const row: Referral = {
      id: newId("ref"), referral_no: no, rep_id: rep.id,
      owner_name: input.owner_name.trim(),
      unit: input.unit?.trim() || null,
      property_ref: input.property_ref || null,
      phone: input.phone?.trim() || null,
      status: "LEAD",
      introduced_on: officeToday(),
      project_code: null, contract_value: null, commission_trx_no: null,
      note: input.note?.trim() || null,
      updated_at: new Date().toISOString(),
    };
    draft.referrals.push(row);
    created = row;
    writeAudit(draft, {
      service: SERVICE, entity: "referral", entity_no: no,
      action: "create", outcome: "ok", reason: null,
      detail: { rep: rep.rep_no, owner: row.owner_name, by: user.email },
    });
  });
  return ok(SERVICE, created as unknown as Referral);
}

/** Moving an introduction along. `WON` is the one that needs a figure: the
 *  commission is a percentage of a **contract that exists**, and a project code
 *  with no value behind it would produce a number nobody can check (D186). */
export async function setReferralStatus(
  input: { referral_no: string; status: ReferralStatus; project_code?: string | null; contract_value?: number | null; note?: string | null },
): Promise<Result<Referral>> {
  await latency();
  const denied = requireModule(SERVICE, "marketing");
  if (denied) return denied;

  const state = getState();
  const referral = state.referrals.find((r) => r.referral_no === input.referral_no);
  if (!referral) return notFound(SERVICE, "referral_not_found", `No referral ${input.referral_no}.`);
  if (input.status === "WON") {
    if (!input.project_code?.trim()) {
      return invalid(SERVICE, "project_required", "Proyek yang jadi harus punya kode proyek — komisinya dihitung dari kontrak yang benar-benar ada.", { field: "project_code" });
    }
    if (!input.contract_value || input.contract_value <= 0) {
      return invalid(SERVICE, "value_required", "Isi nilai kontraknya. Komisi dari nilai yang belum ada adalah angka yang tidak bisa dicek.", { field: "contract_value" });
    }
  }

  const user = actingUser();
  let updated: Referral | null = null;
  apply((draft) => {
    const row = draft.referrals.find((r) => r.referral_no === input.referral_no);
    if (!row) return;
    const before = row.status;
    row.status = input.status;
    if (input.project_code !== undefined) row.project_code = input.project_code?.trim() || null;
    if (input.contract_value !== undefined) row.contract_value = input.contract_value ?? null;
    if (input.note !== undefined) row.note = input.note?.trim() || null;
    row.updated_at = new Date().toISOString();
    updated = row;
    writeAudit(draft, {
      service: SERVICE, entity: "referral", entity_no: row.referral_no,
      action: "set_status", outcome: "ok", reason: row.note,
      detail: { before, after: row.status, project: row.project_code, value: row.contract_value, by: user.email },
    });
  });
  return ok(SERVICE, updated as unknown as Referral);
}

export async function listScrape(): Promise<Result<ScrapeRow[]>> {
  await latency();
  const denied = requireModule(SERVICE, "marketing");
  if (denied) return denied;
  return ok(SERVICE, [...getState().scrape_rows]
    .sort((a, b) => a.market_code.localeCompare(b.market_code) || a.name.localeCompare(b.name)));
}

/** Importing what the scrape found.
 *
 *  The same shape as every other import in this system (D143, D154): a row that
 *  is already here is skipped rather than duplicated, and nothing is invented
 *  for a row that cannot be placed. The enrichment happens outside; this only
 *  records whether it has been through.
 */
export async function importScrape(
  input: { filename: string; rows: { market_code: string; name: string; maps_url?: string | null; enriched?: boolean }[] },
  idempotencyKey?: string,
): Promise<Result<{ added: number; skipped: number }>> {
  await latency();
  const cached = replayed<{ added: number; skipped: number }>(SERVICE, "importScrape", idempotencyKey);
  if (cached) return cached;

  const denied = requireModule(SERVICE, "marketing");
  if (denied) return denied;
  if (input.rows.length === 0) {
    return invalid(SERVICE, "no_rows", "Tidak ada baris yang terbaca.", { field: "rows" });
  }

  const user = actingUser();
  let added = 0;
  let skipped = 0;
  apply((draft) => {
    for (const r of input.rows) {
      const name = r.name.trim();
      const code = r.market_code.trim();
      /* A row whose market nobody has defined is reported, not invented: a
         scrape into a city we have not set up is a decision for a person
         (D187, the same rule as an unknown machine number in D143). */
      if (!name || !code || !draft.markets.some((m) => m.code === code)) { skipped += 1; continue; }
      const exists = draft.scrape_rows.some(
        (x) => x.market_code === code && x.name.trim().toLowerCase() === name.toLowerCase(),
      );
      if (exists) { skipped += 1; continue; }
      draft.scrape_rows.push({
        id: newId("scr"), market_code: code, name,
        maps_url: r.maps_url ?? null,
        enriched: !!r.enriched,
        property_ref: null,
        scraped_on: officeToday(),
      });
      added += 1;
    }
    writeAudit(draft, {
      service: SERVICE, entity: "scrape", entity_no: input.filename,
      action: "import", outcome: "ok", reason: null,
      detail: { added, skipped, by: user.email },
    });
  });

  const result = { added, skipped };
  remember(SERVICE, "importScrape", idempotencyKey, result);
  return ok(SERVICE, result);
}

/** A scraped row becomes a property once somebody decides it is worth
 *  approaching. The score and the enrichment come from outside; **validated**
 *  is ours, and it stays false until a person says otherwise (D184). */
export async function promoteScrapeRow(
  input: { scrape_id: string; status?: string; rooms?: number | null; adr?: number | null; score?: number; notes?: string | null },
): Promise<Result<PropertyView>> {
  await latency();
  const denied = requireModule(SERVICE, "marketing");
  if (denied) return denied;

  const state = getState();
  const row = state.scrape_rows.find((r) => r.id === input.scrape_id);
  if (!row) return notFound(SERVICE, "scrape_not_found", "Baris itu tidak ada.");
  if (row.property_ref) {
    return conflict(SERVICE, "already_promoted", `${row.name} sudah jadi ${row.property_ref}.`);
  }

  const user = actingUser();
  let ref = "";
  apply((draft) => {
    const seq = draft.properties.length + 1;
    ref = `TL-${String(seq).padStart(4, "0")}`;
    draft.properties.push({
      id: newId("prp"), ref, market_code: row.market_code, name: row.name,
      maps_url: row.maps_url, address: null,
      status: input.status?.trim() || "QUALIFIED",
      is_condo: null, rooms: input.rooms ?? null, adr: input.adr ?? null, adr_flag: null,
      chain: null, reno_signal: null, reno_source: null, review_note: null, rating: null,
      score: input.score ?? 0,
      validated: false,
      notes: input.notes?.trim() || null,
      import_id: null,
      created_at: new Date().toISOString(),
    });
    const scrapeRow = draft.scrape_rows.find((r) => r.id === input.scrape_id);
    if (scrapeRow) scrapeRow.property_ref = ref;
    writeAudit(draft, {
      service: SERVICE, entity: "property", entity_no: ref,
      action: "promote", outcome: "ok", reason: null,
      detail: { from_scrape: row.name, market: row.market_code, by: user.email },
    });
  });
  return getProperty(ref);
}

/** Somebody read the enrichment and agrees with it. Until this, the score is a
 *  machine's opinion — and the screen says so (D184). */
export async function validateProperty(
  input: { property_ref: string; validated: boolean; notes?: string | null },
): Promise<Result<PropertyView>> {
  await latency();
  const denied = requireModule(SERVICE, "marketing");
  if (denied) return denied;

  const state = getState();
  const property = state.properties.find((p) => p.ref === input.property_ref);
  if (!property) return notFound(SERVICE, "property_not_found", `No property ${input.property_ref}.`);

  const user = actingUser();
  apply((draft) => {
    const row = draft.properties.find((p) => p.ref === input.property_ref);
    if (!row) return;
    row.validated = input.validated;
    if (input.notes !== undefined) row.notes = input.notes?.trim() || null;
    writeAudit(draft, {
      service: SERVICE, entity: "property", entity_no: row.ref,
      action: input.validated ? "validate" : "unvalidate",
      outcome: "ok", reason: input.notes?.trim() || null,
      detail: { by: user.email },
    });
  });
  return getProperty(input.property_ref);
}
