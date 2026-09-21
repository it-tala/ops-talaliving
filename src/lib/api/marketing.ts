/** Implements `/api/v1/marketing` against the database — the **Package**
 *  programme (D183).
 *
 *  The same rules as the other real clients: nothing derived is computed here,
 *  no permission is checked here, and no refusal is reworded here. What this
 *  file does is **assembly** — the contracts hand the screens nested shapes
 *  (`PropertyView` carries its market and its agents; `RepView` carries its
 *  referrals) and PostgREST hands back flat rows, so three reads become one
 *  object. Collecting rows into a shape is not deriving a figure, and the line
 *  between them is worth keeping: every number below came out of a view or a
 *  function, and the only arithmetic in this file is `undefined ?? null`.
 *
 *  ## Where this disagrees with the contract, and why it still type-checks
 *
 *  The seams address a row by **public reference** — `TL-0001` slot 2, a
 *  scraped name in a market — because every other seam in this system does and
 *  because that is how the team says it out loud (C17). The contracts still
 *  pass uuids, which are the demo's fixture ids leaking into a signature. Until
 *  the contract catches up, the **signatures here match the demo exactly** and
 *  this file resolves the uuid to the reference itself: one extra read before
 *  the write. It costs a round trip and buys the property that matters most
 *  about the swap — that a screen cannot tell which implementation it got
 *  (ADR-009).
 *
 *  `setReferralStatus` takes a `contract_value` and **does not send it**. That
 *  is C15: the value is the project's, read through the project code, and a
 *  second copy typed in beside it is the one that goes stale the first time a
 *  contract is revised. The parameter stays in the signature so the swap is
 *  clean; the database ignores what it should never have been told.
 */
import type {
  Market, MarketView, MarketLevel, Property, PropertyView, PropertyAgentView,
  PipelineMetrics, OutreachStage, SalesRep, RepView, Referral, ReferralStatus,
  ScrapeRow,
} from "@/services/marketing/contracts";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fromSeam, fromRows, notFound, ok, type Result } from "./_kit";

const SERVICE = "marketing" as const;

/** Every object this module touches lives in `ops_mkt`, and PostgREST has to be
 *  told so on every request — see the long note in `accounting.ts` for what
 *  happens when it is not. */
const db = () => supabaseBrowser().schema("ops_mkt");

/** A scope is a **prefix of the market code**: `AU` is a country,
 *  `AU-QLD-GOLDCOAST` a city, the whole code one district (D187).
 *
 *  Expressed as PostgREST's `or` rather than a `like` alone, because
 *  `AU-QLD-GOLDCOAST` must match itself as well as everything beneath it, and
 *  `like 'AU-QLD-GOLDCOAST%'` would also match a market called
 *  `AU-QLD-GOLDCOASTHINTERLAND` that is a different place.
 */
function scoped<T extends { or: (f: string) => T; }>(q: T, column: string, scope?: string): T {
  if (!scope) return q;
  return q.or(`${column}.eq.${scope},${column}.like.${scope}-*`);
}

/* ------------------------------------------------------------------ */
/* Markets                                                             */
/* ------------------------------------------------------------------ */

/** Every market the scrape has touched, resolved once so no screen has to join
 *  a code to a city. */
export async function listMarkets(): Promise<Result<MarketView[]>> {
  const { data, error } = await db()
    .from("v_market").select("*")
    .order("country_name").order("city").order("area_label");
  return fromRows<MarketView[]>(SERVICE, data as MarketView[], error);
}

/* ------------------------------------------------------------------ */
/* Properties                                                          */
/* ------------------------------------------------------------------ */

/** The three reads a `PropertyView` is made of, done once for a whole list.
 *
 *  One query per **table**, not per property: a page of forty properties is
 *  three round trips, not a hundred and twenty. The joins that stitch them are
 *  in memory because the shape is nested and SQL rows are not.
 */
async function assemble(refs: string[] | null, scope?: string): Promise<Result<PropertyView[]>> {
  let pq = db().from("v_property").select("*");
  if (refs) pq = pq.in("ref", refs);
  else pq = scoped(pq, "market_code", scope);
  /* Trouble first, then the best prospects — the order the board is read in.
     `agents_past_the_line` descending puts anything past the move-on line at
     the top; the demo sorts on the boolean *any*, which is the same grouping
     with the worst cases no longer buried inside it. */
  const { data: props, error: pe } = await pq
    .order("agents_past_the_line", { ascending: false })
    .order("score", { ascending: false })
    .order("ref");
  if (pe) return fromRows<PropertyView[]>(SERVICE, null, pe);

  const rows = (props ?? []) as (Property & {
    market_code: string; agents: number; best_stage: OutreachStage;
    next_slot: number | null; exhausted: boolean;
  })[];
  if (rows.length === 0) return ok(SERVICE, []);

  const [{ data: markets, error: me }, { data: agents, error: ae }] = await Promise.all([
    db().from("v_market").select("*")
      .in("code", [...new Set(rows.map((r) => r.market_code))]),
    db().from("v_property_agent").select("*")
      .in("property_ref", rows.map((r) => r.ref)).order("slot"),
  ]);
  if (me) return fromRows<PropertyView[]>(SERVICE, null, me);
  if (ae) return fromRows<PropertyView[]>(SERVICE, null, ae);

  const byCode = new Map((markets as MarketView[] ?? []).map((m) => [m.code, m]));
  const byRef = new Map<string, (PropertyAgentView & { property_ref: string })[]>();
  for (const a of (agents ?? []) as (PropertyAgentView & { property_ref: string })[]) {
    const list = byRef.get(a.property_ref) ?? [];
    list.push(a);
    byRef.set(a.property_ref, list);
  }

  return ok(SERVICE, rows.map((r) => {
    const mine = byRef.get(r.ref) ?? [];
    return {
      ...(r as Property),
      market: byCode.get(r.market_code) as MarketView,
      agents: mine,
      best_stage: r.best_stage,
      /* Who to chase, by the slot the view already picked. Looked up rather
         than recomputed: two answers to *which agent is next* is one too many,
         and the view's is the one the follow-up queue is built on. */
      next_agent: mine.find((a) => a.slot === r.next_slot) ?? null,
      exhausted: r.exhausted,
    };
  }));
}

export async function listProperties(opts: { scope?: string } = {}): Promise<Result<PropertyView[]>> {
  return assemble(null, opts.scope);
}

export async function getProperty(ref: string): Promise<Result<PropertyView>> {
  const res = await assemble([ref]);
  if (res.error) return res as unknown as Result<PropertyView>;
  const one = res.data?.[0];
  if (!one) return notFound(SERVICE, "property_not_found", `No property ${ref}.`);
  return ok(SERVICE, one);
}

/* ------------------------------------------------------------------ */
/* The numbers                                                         */
/* ------------------------------------------------------------------ */

/** The pipeline, the funnel and the scrape, at whichever altitude.
 *
 *  Three calls because they are three shapes — a row, a list per stage, a list
 *  per group — and not because anything here adds them up. `reply_rate` is null
 *  over nought messages and that null is the database's, carried across
 *  untouched: a `?? 0` on this line would put *nought per cent* on a tile that
 *  means *nobody has been messaged yet*.
 */
export async function getMetrics(
  opts: { scope?: string; level?: MarketLevel } = {},
): Promise<Result<PipelineMetrics>> {
  const level = opts.level ?? "area";
  const [pipe, funnel, scrape] = await Promise.all([
    db().rpc("pipeline", { p_scope: opts.scope ?? null }),
    db().rpc("funnel", { p_scope: opts.scope ?? null }),
    db().rpc("scrape_rollup", { p_scope: opts.scope ?? null, p_level: level }),
  ]);
  if (pipe.error) return fromRows<PipelineMetrics>(SERVICE, null, pipe.error);
  if (funnel.error) return fromRows<PipelineMetrics>(SERVICE, null, funnel.error);
  if (scrape.error) return fromRows<PipelineMetrics>(SERVICE, null, scrape.error);

  const p = (pipe.data ?? {}) as Omit<PipelineMetrics, "funnel" | "level" | "scrape">;
  return ok(SERVICE, {
    ...p,
    funnel: ((funnel.data ?? []) as { stage: OutreachStage; properties: number }[])
      .map((f) => ({ stage: f.stage, properties: f.properties })),
    level,
    scrape: (scrape.data ?? []) as PipelineMetrics["scrape"],
  });
}

/** What to do today: every agent past the move-on line first, then anything
 *  due. Ordered by the view, which is where the rule lives. */
export async function getQueue(opts: { scope?: string } = {}): Promise<Result<{
  property_ref: string; property_name: string; market_label: string; timezone: string;
  agent_id: string; agent_name: string; slot: number; stage: OutreachStage;
  kind: "move_on" | "due"; waiting_days: number | null; next_action_on: string | null;
}[]>> {
  type QueueRow = {
    property_ref: string; property_name: string; market_label: string; timezone: string;
    agent_id: string; agent_name: string; slot: number; stage: OutreachStage;
    kind: "move_on" | "due"; waiting_days: number | null; next_action_on: string | null;
  };
  const { data, error } = await scoped(db().from("v_followup_queue").select("*"), "market_code", opts.scope);
  if (error) return fromRows<QueueRow[]>(SERVICE, null, error);
  return ok(SERVICE, ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    property_ref: r.property_ref as string,
    property_name: r.property_name as string,
    market_label: r.market_label as string,
    timezone: r.timezone as string,
    agent_id: r.agent_id as string,
    agent_name: r.agent_name as string,
    slot: r.slot as number,
    stage: r.stage as OutreachStage,
    kind: r.kind as "move_on" | "due",
    waiting_days: (r.waiting_days as number | null) ?? null,
    next_action_on: (r.next_action_on as string | null) ?? null,
  })));
}

/* ------------------------------------------------------------------ */
/* The agents                                                          */
/* ------------------------------------------------------------------ */

/** `TL-0001` slot 2, from the uuid the contract still passes (C17). */
async function slotOf(agentId: string): Promise<number | null> {
  const { data } = await db()
    .from("property_agents").select("slot").eq("id", agentId).maybeSingle();
  return (data as { slot: number } | null)?.slot ?? null;
}

export async function setAgentStage(
  input: {
    property_ref: string; agent_id: string; stage: OutreachStage;
    remark?: string | null; next_action_on?: string | null;
  },
): Promise<Result<PropertyView>> {
  const slot = await slotOf(input.agent_id);
  if (slot === null) return notFound(SERVICE, "agent_not_found", "Agen itu tidak ada.");

  const { data, error } = await db().rpc("set_agent_stage", {
    p_property_ref: input.property_ref,
    p_slot: slot,
    p_stage: input.stage,
    p_remark: input.remark ?? null,
    p_next_action_on: input.next_action_on ?? null,
    p_key: null,
  });
  const res = fromSeam<unknown>(SERVICE, data, error);
  if (res.error) return res as unknown as Result<PropertyView>;
  /* The seam answers with what it changed; the screen redraws the property.
     Re-read rather than patched together from the envelope, because the board
     shows the furthest stage across three agents and that is not something a
     single answer can tell you. */
  return getProperty(input.property_ref);
}

export async function moveToNextAgent(
  input: { property_ref: string; agent_id: string; reason: string },
): Promise<Result<PropertyView & { next_agent_name: string | null }>> {
  const slot = await slotOf(input.agent_id);
  if (slot === null) return notFound(SERVICE, "agent_not_found", "Agen itu tidak ada.");

  const { data, error } = await db().rpc("move_to_next_agent", {
    p_property_ref: input.property_ref,
    p_slot: slot,
    p_reason: input.reason,
    p_key: null,
  });
  const res = fromSeam<{ next_agent: string | null }>(SERVICE, data, error);
  if (res.error) return res as unknown as Result<PropertyView & { next_agent_name: string | null }>;

  const view = await getProperty(input.property_ref);
  if (view.error) return view as unknown as Result<PropertyView & { next_agent_name: string | null }>;
  return ok(SERVICE, { ...view.data!, next_agent_name: res.data?.next_agent ?? null });
}

export async function onboardRep(
  input: {
    property_ref: string; agent_id: string;
    commission_percent: number; email?: string | null; note?: string | null;
  },
  idempotencyKey?: string,
): Promise<Result<RepView>> {
  const slot = await slotOf(input.agent_id);
  if (slot === null) return notFound(SERVICE, "agent_not_found", "Agen itu tidak ada.");

  const { data, error } = await db().rpc("onboard_rep", {
    p_property_ref: input.property_ref,
    p_slot: slot,
    p_commission_percent: input.commission_percent,
    p_email: input.email ?? null,
    p_note: input.note ?? null,
    p_key: idempotencyKey ?? null,
  });
  const res = fromSeam<{ rep_no: string }>(SERVICE, data, error);
  if (res.error) return res as unknown as Result<RepView>;

  const reps = await listReps();
  if (reps.error) return reps as unknown as Result<RepView>;
  const mine = reps.data?.find((r) => r.rep_no === res.data?.rep_no);
  if (!mine) return notFound(SERVICE, "rep_not_found", "Representative baru tidak ditemukan.");
  return ok(SERVICE, mine);
}

/* ------------------------------------------------------------------ */
/* The representatives and what they introduced                        */
/* ------------------------------------------------------------------ */

/** Four reads: the reps, their referrals, the markets they were recruited in,
 *  and the properties they came through.
 *
 *  That last one is a join the database cannot make for us — `v_rep` lives in
 *  `0080` and `property_agents` arrives in `0081`, and a view cannot reach
 *  forward down the ladder. Collecting refs is assembly, so it happens here.
 */
export async function listReps(): Promise<Result<RepView[]>> {
  const { data: reps, error: re } = await db()
    .from("v_rep").select("*").order("commission_unpaid", { ascending: false });
  if (re) return fromRows<RepView[]>(SERVICE, null, re);

  const rows = (reps ?? []) as (SalesRep & {
    referrals: number; won: number; won_value: number | null;
    commission_earned: number; commission_unpaid: number;
  })[];
  if (rows.length === 0) return ok(SERVICE, []);

  const [{ data: refs, error: fe }, { data: markets, error: me }, { data: agents, error: ae }] =
    await Promise.all([
      db().from("v_referral").select("*")
        .in("rep_id", rows.map((r) => r.id)).order("introduced_on", { ascending: false }),
      db().from("v_market").select("*"),
      db().from("v_property_agent").select("rep_id,property_ref")
        .in("rep_id", rows.map((r) => r.id)),
    ]);
  if (fe) return fromRows<RepView[]>(SERVICE, null, fe);
  if (me) return fromRows<RepView[]>(SERVICE, null, me);
  if (ae) return fromRows<RepView[]>(SERVICE, null, ae);

  const byCode = new Map((markets as MarketView[] ?? []).map((m) => [m.code, m]));
  const byRep = new Map<string, Referral[]>();
  for (const r of (refs ?? []) as (Referral & { rep_id: string })[]) {
    byRep.set(r.rep_id, [...(byRep.get(r.rep_id) ?? []), r]);
  }
  const propsByRep = new Map<string, Set<string>>();
  for (const a of (agents ?? []) as { rep_id: string; property_ref: string }[]) {
    propsByRep.set(a.rep_id, (propsByRep.get(a.rep_id) ?? new Set()).add(a.property_ref));
  }

  return ok(SERVICE, rows.map((r) => ({
    ...(r as SalesRep),
    market: r.market_code ? byCode.get(r.market_code) ?? null : null,
    referrals: byRep.get(r.id) ?? [],
    /* `leads` is how many they have introduced, which `v_rep` already counted
       under its own name. Not recounted from the array: two counts of one thing
       is how a screen ends up disagreeing with itself when a filter is added. */
    leads: r.referrals,
    won: r.won,
    /* Null where they have won nothing — *no contracts at all* is not a value
       of nought — and the contract wants a number, so the null is named here
       rather than silently added to. */
    won_value: r.won_value ?? 0,
    commission_earned: r.commission_earned,
    commission_unpaid: r.commission_unpaid,
    from_properties: [...(propsByRep.get(r.id) ?? [])].sort(),
  })));
}

export async function addReferral(
  input: {
    rep_no: string; owner_name: string; unit?: string | null;
    property_ref?: string | null; phone?: string | null; note?: string | null;
  },
): Promise<Result<Referral>> {
  const { data, error } = await db().rpc("add_referral", {
    p_rep_no: input.rep_no,
    p_owner_name: input.owner_name,
    p_unit: input.unit ?? null,
    p_property_ref: input.property_ref ?? null,
    p_phone: input.phone ?? null,
    p_note: input.note ?? null,
    p_key: null,
  });
  const res = fromSeam<{ referral_no: string }>(SERVICE, data, error);
  if (res.error) return res as unknown as Result<Referral>;
  return readReferral(res.data!.referral_no);
}

export async function setReferralStatus(
  input: {
    referral_no: string; status: ReferralStatus; project_code?: string | null;
    contract_value?: number | null; note?: string | null;
  },
): Promise<Result<Referral>> {
  const { data, error } = await db().rpc("set_referral_status", {
    p_referral_no: input.referral_no,
    p_status: input.status,
    p_project_code: input.project_code ?? null,
    /* The demo's `note` is what a person types when an introduction is lost,
       and the column that must not be empty is `lost_reason`. Sent as both:
       the note is the note wherever it lands, and on `LOST` it is also the
       reason somebody reads next year. */
    p_lost_reason: input.status === "LOST" ? input.note ?? null : null,
    p_note: input.note ?? null,
    /* `input.contract_value` is deliberately not forwarded — C15. */
    p_key: null,
  });
  const res = fromSeam<unknown>(SERVICE, data, error);
  if (res.error) return res as unknown as Result<Referral>;
  return readReferral(input.referral_no);
}

async function readReferral(no: string): Promise<Result<Referral>> {
  const { data, error } = await db()
    .from("v_referral").select("*").eq("referral_no", no).maybeSingle();
  if (error) return fromRows<Referral>(SERVICE, null, error);
  if (!data) return notFound(SERVICE, "referral_not_found", `No referral ${no}.`);
  return ok(SERVICE, data as Referral);
}

/* ------------------------------------------------------------------ */
/* The scrape                                                          */
/* ------------------------------------------------------------------ */

export async function listScrape(): Promise<Result<ScrapeRow[]>> {
  const { data, error } = await db()
    .from("scrape_rows").select("*").order("scraped_on", { ascending: false }).order("name");
  return fromRows<ScrapeRow[]>(SERVICE, data as ScrapeRow[], error);
}

/** What the scrape found. The seam counts the three kinds of skip apart;
 *  the contract asks for one number and gets their sum, which is what `skipped`
 *  has always meant. The breakdown is on the envelope for whoever wants it. */
export async function importScrape(
  input: {
    filename: string;
    rows: { market_code: string; name: string; maps_url?: string | null; enriched?: boolean }[];
  },
  idempotencyKey?: string,
): Promise<Result<{ added: number; skipped: number }>> {
  const { data, error } = await db().rpc("import_scrape", {
    p_filename: input.filename,
    p_rows: input.rows,
    p_key: idempotencyKey ?? null,
  });
  const res = fromSeam<{ added: number; skipped: number }>(SERVICE, data, error);
  if (res.error) return res;
  return ok(SERVICE, { added: res.data!.added, skipped: res.data!.skipped });
}

export async function promoteScrapeRow(
  input: {
    scrape_id: string; status?: string; rooms?: number | null;
    adr?: number | null; score?: number; notes?: string | null;
  },
): Promise<Result<PropertyView>> {
  /* The scraped row's own key is `(market_code, name)`, which is what the seam
     takes and what the person reading the list has in front of them. The uuid
     is resolved here until the contract catches up (C17). */
  const { data: row } = await db()
    .from("scrape_rows").select("market_code,name").eq("id", input.scrape_id).maybeSingle();
  const found = row as { market_code: string; name: string } | null;
  if (!found) return notFound(SERVICE, "scrape_not_found", "Baris itu tidak ada.");

  const { data, error } = await db().rpc("promote_scrape_row", {
    p_market_code: found.market_code,
    p_name: found.name,
    p_status: input.status ?? "QUALIFIED",
    p_rooms: input.rooms ?? null,
    p_adr: input.adr ?? null,
    p_score: input.score ?? 0,
    p_notes: input.notes ?? null,
    p_key: null,
  });
  const res = fromSeam<{ ref: string }>(SERVICE, data, error);
  if (res.error) return res as unknown as Result<PropertyView>;
  return getProperty(res.data!.ref);
}

export async function validateProperty(
  input: { property_ref: string; validated: boolean; notes?: string | null },
): Promise<Result<PropertyView>> {
  const { data, error } = await db().rpc("validate_property", {
    p_ref: input.property_ref,
    p_validated: input.validated,
    p_notes: input.notes ?? null,
    p_key: null,
  });
  const res = fromSeam<unknown>(SERVICE, data, error);
  if (res.error) return res as unknown as Result<PropertyView>;
  return getProperty(input.property_ref);
}
