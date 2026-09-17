/** Marketing contracts — the **Package** programme (D166, D183).
 *
 *  Not a CRM and not a sales pipeline in the ordinary sense. The business pays
 *  a commission to agents who introduce condo owners wanting an interior
 *  renovation, so the funnel recruits **agents**, and the deals arrive
 *  afterwards, through them. Two halves, and the second is the one an ordinary
 *  CRM has no shape for:
 *
 *  1. **Reaching an agent.** A property is scraped from the map, enriched, and
 *     scored; up to three agents are found for it; the first is approached, and
 *     if seven days pass with no reply the next one is, and so on until one
 *     agrees or the property is recycled.
 *  2. **Working with the agent.** An agent who agrees becomes a sales
 *     representative: they introduce owners, those introductions become
 *     projects, and each one earns a commission the business owes.
 *
 *  The vocabulary here is the owner's own, carried verbatim from the tracker
 *  the team already runs — `MSG SENT`, `FORM BACK`, `MOVE ON`, `SP NORTH`.
 *  Translating it would be the one change guaranteed to make the screen unusable
 *  by the people who use the sheet today.
 */

/* ── Where in the world ───────────────────────────────────────────────────
 *
 *  `SP NORTH` is a district of one city on one coast, and it only reads as a
 *  location because everybody in the room shares a country. Once the scrape
 *  runs anywhere else, a flat `area` column becomes a list of strings nobody
 *  can group, compare or spell consistently — *Seminyak* beside *SP MIDDLE*
 *  beside *Downtown Dubai* (D187).
 *
 *  So geography is a **market**: country → region → city → the local district
 *  label, which stays exactly as the team writes it. Everything above that
 *  label exists so a figure can roll up — this city, this country, everywhere.
 *
 *  Two things ride on the market rather than on the property, because they are
 *  properties of the *place* and getting them per-row wrong is expensive:
 *
 *  - **Currency.** An ADR of 106 is not a number until you know whether it is
 *    dollars, rupiah or dirhams. Nothing in this module ever adds two of them
 *    together, and no rate is invented to make it possible (the same rule the
 *    bank statement follows, D181).
 *  - **Time zone.** Whether to ring an agent now depends on what time it is
 *    *there*, and that is the one question a list of names cannot answer.
 */
export interface Market {
  id: string;
  /** `AU-QLD-GOLDCOAST-SPNORTH`. Stable, and what a property references. */
  code: string;
  /** ISO-3166 alpha-2. */
  country_code: string;
  country_name: string;
  /** State, province, prefecture — whatever the country calls the level
   *  between a country and a city. Null where a country has none worth
   *  carrying. */
  region: string | null;
  city: string;
  /** The local label, verbatim: `SP NORTH`, `Seminyak`, `Downtown`. */
  area_label: string;
  /** ISO-4217, for the ADR quoted in this market. */
  currency: string;
  /** IANA, for "what time is it there". */
  timezone: string;
  /** The language outreach is written in here. Carried as data because the
   *  message templates will need it, not because anything reads it yet. */
  language: string;
  active: boolean;
}

export interface MarketView extends Market {
  /** `Gold Coast · SP NORTH`, for a row that has one line to say where. */
  label: string;
  /** `Australia · Queensland · Gold Coast · SP NORTH`, for a drawer. */
  full_path: string;
  properties: number;
  scraped: number;
}

/** How far up to group a figure. The same metrics, at three altitudes. */
export type MarketLevel = "country" | "city" | "area";

/** Where an approach to one agent has got to.
 *
 *  Ordered, and the order is load-bearing: the funnel, the *furthest agent per
 *  property*, and "has this one been messaged" are all comparisons on this
 *  list. `SKIP` and `RECYCLED` sit outside the ladder — they are exits. */
export const OUTREACH_STAGES = [
  "QUEUED", "MSG SENT", "REPLIED", "CALL SET", "FORM BACK", "PRESENTATION", "DEAL",
] as const;
export type OutreachStage = (typeof OUTREACH_STAGES)[number] | "RECYCLED" | "SKIP";

export const STAGE_LABEL: Record<OutreachStage, string> = {
  QUEUED: "Antre",
  "MSG SENT": "Pesan terkirim",
  REPLIED: "Sudah balas",
  "CALL SET": "Janji telepon",
  "FORM BACK": "Formulir kembali",
  PRESENTATION: "Presentasi",
  DEAL: "Deal",
  RECYCLED: "Dilepas",
  SKIP: "Dilewati",
};

/** Whether the property is worth approaching at all. A disqualification keeps
 *  its reason in the string, exactly as the tracker writes it — *DISQUALIFIED —
 *  NOT CONDO* is more useful than a boolean and a separate note. */
export type PropertyStatus = string;

/** One scraped property: a hotel or condo whose owners might renovate.
 *
 *  Everything up to and including `score` comes from outside — Google Maps,
 *  then the enrichment run. What the system adds is what happened next.
 */
export interface Property {
  id: string;
  /** `TL-0001`. The tracker's own numbering, kept because it is what people
   *  say to each other. */
  ref: string;
  /** The market this sits in, by code (D187). The country, city and local
   *  label all hang off it — the property does not repeat them. */
  market_code: string;
  name: string;
  maps_url: string | null;
  address: string | null;
  status: PropertyStatus;
  /** Is it strata / condo-titled — which is what makes individual owners the
   *  customer rather than a hotel group. */
  is_condo: boolean | null;
  rooms: number | null;
  /** Average daily rate, in the currency the listing quotes. */
  adr: number | null;
  /** `CHECK` when the ADR looked implausible and nobody has confirmed it. */
  adr_flag: string | null;
  chain: string | null;
  /** A renovation signal found during enrichment, and where it came from. */
  reno_signal: string | null;
  reno_source: string | null;
  review_note: string | null;
  rating: number | null;
  /** 0–5, from the enrichment. Zero means unscored, not bad. */
  score: number;
  /** Somebody checked the enrichment by hand. Until then the score is a
   *  machine's opinion (D184). */
  validated: boolean;
  notes: string | null;
  /** The import that brought it in, so a re-import is a no-op. */
  import_id: string | null;
  created_at: string;
}

/** One agent found for one property. Up to three, approached in order. */
export interface PropertyAgent {
  id: string;
  property_id: string;
  /** 1, 2, 3 — the order they are approached in. */
  slot: number;
  name: string;
  agency: string | null;
  phone: string | null;
  email: string | null;
  profile_url: string | null;
  suburb: string | null;
  stage: OutreachStage;
  /** When the first message went out, and when they answered. */
  sent_on: string | null;
  replied_on: string | null;
  /** When to chase. Null once they have replied — a reply ends the chase. */
  next_action_on: string | null;
  remark: string | null;
  /** Set when this agent said yes and became a representative (D185). */
  rep_id: string | null;
  updated_at: string;
}

/** An agent who agreed: now a sales representative, with a commission rate. */
export interface SalesRep {
  id: string;
  rep_no: string;
  name: string;
  agency: string | null;
  phone: string | null;
  email: string | null;
  /** The market they were recruited in. Null for a rep who works across
   *  several — which happens, and is not an error. */
  market_code: string | null;
  /** Per cent of the project value. Per person, because it is negotiated
   *  per person. */
  commission_percent: number;
  onboarded_on: string;
  active: boolean;
  note: string | null;
}

/** Where an introduction has got to. Deliberately shorter than the outreach
 *  ladder: an owner either is talking to us, has signed, or has not. */
export type ReferralStatus = "LEAD" | "SURVEYED" | "QUOTED" | "WON" | "LOST";

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  LEAD: "Kontak masuk",
  SURVEYED: "Sudah disurvei",
  QUOTED: "Sudah ditawar",
  WON: "Jadi proyek",
  LOST: "Batal",
};

/** An owner the representative introduced. */
export interface Referral {
  id: string;
  referral_no: string;
  rep_id: string;
  owner_name: string;
  unit: string | null;
  /** The property it sits in, by **ref**, across the seam (ADR-004). */
  property_ref: string | null;
  phone: string | null;
  status: ReferralStatus;
  introduced_on: string;
  /** What the job was worth once it existed. Null until it does — a projected
   *  value is a number somebody would quote (D186). */
  project_code: string | null;
  contract_value: number | null;
  /** Commission is computed from the value and the rate, and **paid** through
   *  the ledger like any other money — this only records which row paid it. */
  commission_trx_no: string | null;
  note: string | null;
  updated_at: string;
}

/** One row of the scrape, before it becomes a property. */
export interface ScrapeRow {
  id: string;
  market_code: string;
  name: string;
  maps_url: string | null;
  /** The enrichment run has been through it. */
  enriched: boolean;
  /** Became a property, by ref. Null while it is still just a name on a list. */
  property_ref: string | null;
  scraped_on: string;
}

/* ── Views ──────────────────────────────────────────────────────────────── */

export interface PropertyAgentView extends PropertyAgent {
  /** Days since the message went out with no reply. Null once they replied. */
  waiting_days: number | null;
  /** Seven days of silence is the tracker's own rule for moving on (D183). */
  move_on: boolean;
  /** Due today or overdue. */
  due: boolean;
}

export interface PropertyView extends Property {
  /** Resolved once, here, so no screen has to join a code to a city. */
  market: MarketView;
  agents: PropertyAgentView[];
  /** The furthest any of its agents has got — what the funnel counts, because
   *  a property with one agent at DEAL is not also a property at QUEUED. */
  best_stage: OutreachStage;
  /** The agent to chase next: the first one not finished and not recycled. */
  next_agent: PropertyAgentView | null;
  /** Nobody left to approach, and no deal. The property goes back on the pile. */
  exhausted: boolean;
}

export interface PipelineMetrics {
  properties: number;
  qualified: number;
  validated: number;
  messaged: number;
  replied: number;
  /** Replied ÷ messaged. Null when nothing has been messaged — a rate over
   *  nothing is not zero per cent, it is no rate at all. */
  reply_rate: number | null;
  forms_back: number;
  deals: number;
  /** Stage → how many properties are furthest at it. */
  funnel: { stage: OutreachStage; properties: number }[];
  /** Grouped at whatever level was asked for — country, city or local area
   *  (D187). `key` is the grouping value, `label` is what to print. */
  level: MarketLevel;
  scrape: {
    key: string; label: string;
    scraped: number; enriched: number; converted: number;
    /** What the ADRs in this group are quoted in. More than one means the
     *  group spans currencies and **no average is offered** — a mean across
     *  dollars and rupiah is not a number. */
    currencies: string[];
  }[];
}

export interface RepView extends SalesRep {
  market: MarketView | null;
  referrals: Referral[];
  leads: number;
  won: number;
  /** Σ contract value of the projects that came from them. */
  won_value: number;
  /** What the business owes on those, at this rep's rate — and what is still
   *  unpaid, which is the number that matters (D186). */
  commission_earned: number;
  commission_unpaid: number;
  /** Which properties they were recruited through. */
  from_properties: string[];
}
