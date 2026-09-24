/** John Lau, against the database.
 *
 *  The twin of `src/demo/api/assistant.ts` — same names, same signatures, same
 *  envelope — and a different division of labour inside, for a reason worth
 *  stating before anything else in this file makes sense.
 *
 *  ## What the database decides, and what this file does
 *
 *  **The database owns the catalogue and the gate.** `ops_asst.tools` is the
 *  security boundary (0038): sixteen capabilities, five of them refusals the
 *  owner wrote, and `reach = 'blocked'` is a property of the tool that no grant
 *  lifts (D218). It used to be a TypeScript file in this bundle, which is to
 *  say a security boundary in the reader's own browser.
 *
 *  **The database owns the router** (0039), because the owner's answer was
 *  *kata kunci dulu, LLM nanti* and that only pays off if the sentences people
 *  type are kept where they can be read back.
 *
 *  **This file runs the tool** — and that is deliberate rather than lazy. An
 *  `ask()` inside the database would have to be `security definer` to write its
 *  audit rows, a definer function runs as `postgres`, and `postgres` has
 *  `bypassrls`. Reading `v_account_balance` in there would hand every account
 *  in the company to anybody who could reach the prompt, with a module check as
 *  the only thing in front of it — which is exactly what `0037` found
 *  `v_po_detail` to be.
 *
 *  So a tool call here is **the same call the screen makes**: `queue()`,
 *  `listVendorJourneys()`, `listAccounts()`, through the same client, as the
 *  signed-in person, with RLS applying as it does on those screens. John Lau
 *  cannot see one row more than the person asking. That is D219 satisfied by
 *  construction rather than by a second implementation of the rules.
 *
 *  ## The rule that shapes the rest
 *
 *  **No figure is composed here.** Every number in an answer comes back from a
 *  named call, carries that call's name, and goes into `facts` unformatted with
 *  its unit — so the dock renders it with `formatIDR`, the same helper the
 *  screen renders it with, and the two strings can be compared by eye (D217).
 *  The prose in `text` never contains a number.
 *
 *  ## Two tools still have no data, and say so
 *
 *  `production.late_orders` and `delivery.fulfilment` are in the catalogue and
 *  reachable, and `ops_prod` has no tables in it. They answer *this is not
 *  built yet, here is the screen* — named, one by one, rather than through a
 *  silent default. A default here would mean the next tool somebody adds and
 *  forgets to wire answers something reassuring.
 *
 *  `inventory.low_stock` was the third until `ops_inv` (`0070`/`0071`) landed
 *  — it now reads `inventory.listStock({ low_only: true })`, the same call
 *  `/inventory/material` makes with its "di bawah minimum" filter on.
 */
import type {
  AssistantReply, AssistantTurn, AssistantTool, AnswerFact, AssistantDraft,
  UnmatchedPrompt, RouterHealth, RouterRule, AskContext,
} from "@/services/assistant/contracts";
import { supabaseBrowser } from "@/lib/supabase/client";
import { fail, fromSeam, fromRows, invalid, ok, refused, type Result } from "./_kit";
import { getActiveLang } from "@/lib/i18n";
import { GUIDES, resolveGuide, draftShape, resolvePoDraft, confirmPoDraft, resolveLeaveDraft, confirmLeaveDraft } from "@/lib/john-lau";
import { officeToday } from "@/lib/office";
import * as procurement from "./procurement";
import * as hr from "./hr";
import * as accounting from "./accounting";
import * as inventory from "./inventory";
import { isOk } from "@/services/_shared/envelope";

/** John Lau stamps his envelopes `procurement`, as the demo does. Inventing an
 *  `assistant` service name to make this line read nicely would put a name in
 *  the audit trail that no envelope anywhere else uses. */
const SERVICE = "procurement" as const;

const db = () => supabaseBrowser().schema("ops_asst");

/* ── the catalogue ─────────────────────────────────────────────────────── */

interface CatalogueRow {
  name: string;
  module: string | null;
  level: "read" | "write";
  effect: "read" | "guide" | "write";
  reach: "open" | "blocked";
  label_en: string;
  label_id: string;
  blocked_reason_en: string | null;
  blocked_reason_id: string | null;
  instead_at: string | null;
  sort_order: number;
  may: "blocked" | "no_grant" | "yes";
}

/** Both languages come down and one is chosen here.
 *
 *  The list is a menu, and a menu is rendering — unlike a refusal, which the
 *  database resolves itself because it is a sentence the service is answerable
 *  for (D224). The split is deliberate and stated in `0038`.
 */
export async function listTools(): Promise<Result<AssistantTool[]>> {
  const { data, error } = await db()
    .from("v_tool_catalogue").select("*").order("sort_order");
  if (error) return fail(SERVICE, error);
  const lang = getActiveLang();
  return ok(SERVICE, (data ?? []).map((r: CatalogueRow): AssistantTool => ({
    name: r.name,
    module: r.module,
    level: r.level,
    effect: r.effect,
    reach: r.reach,
    label: lang === "id" ? r.label_id : r.label_en,
    blocked_reason: lang === "id" ? r.blocked_reason_id : r.blocked_reason_en,
    instead_at: r.instead_at,
  })));
}

/* ── the conversation ──────────────────────────────────────────────────── */

interface TurnRow {
  id: string;
  at: string;
  actor_id: string;
  prompt: string;
  lang: "en" | "id";
  kind: AssistantTurn["kind"];
  understood_as: string | null;
  text: string;
  facts: AnswerFact[];
  steps: AssistantTurn["steps"];
  tools_used: string[];
  refused_because: "closed" | "permission" | null;
  route: string | null;
  matched_rule: number | null;
}

interface DraftRow {
  id: string;
  turn_id: string;
  tool: string;
  args: Record<string, string>;
  idempotency_key: string;
  created_at: string;
  outcome: "confirmed" | "abandoned" | null;
  produced_ref: string | null;
}

/** The signed-in person's address, for the turn's `actor_email`.
 *
 *  Read off the session rather than joined in the database: `ops_asst.turns`
 *  holds `actor_id` and nothing about who that is, on purpose, because the one
 *  reader of a turn is the person who had it and they know their own name. */
async function myEmail(): Promise<string> {
  const { data } = await supabaseBrowser().auth.getSession();
  return data.session?.user?.email ?? "";
}

function toTurn(row: TurnRow, email: string, draft: AssistantDraft | null = null): AssistantTurn {
  return {
    id: row.id,
    at: row.at,
    actor_id: row.actor_id,
    actor_email: email,
    prompt: row.prompt,
    kind: row.kind,
    text: row.text,
    facts: row.facts ?? [],
    steps: row.steps ?? [],
    tools_used: row.tools_used ?? [],
    draft,
    draft_outcome: null,
    produced_ref: null,
    refused_because: row.refused_because,
    route: row.route,
  };
}

function toDraft(row: DraftRow, tool: string, args: Record<string, string>): AssistantDraft {
  return {
    id: row.id,
    tool,
    ...draftShape(tool, args, getActiveLang()),
    args: row.args ?? args,
    idempotency_key: row.idempotency_key,
    created_at: row.created_at,
  };
}

export async function listTurns(limit = 50): Promise<Result<AssistantTurn[]>> {
  /* Your own conversation only, and that is the policy rather than this
     filter: `turns` is own-rows-only under RLS (0039). No `.eq("actor_id", …)`
     here, because a client-side filter over a table that already refuses would
     be a second, weaker statement of the same rule. */
  const { data, error } = await db()
    .from("turns").select("*").order("at", { ascending: false }).limit(limit);
  if (error) return fail(SERVICE, error);
  const email = await myEmail();
  const rows = (data ?? []) as TurnRow[];
  /* Oldest first, because a conversation reads downwards. */
  return ok(SERVICE, rows.reverse().map((r) => toTurn(r, email)));
}

/* ── asking ────────────────────────────────────────────────────────────── */

interface Match {
  tool: string;
  /** The router rule that fired — null when a model picked the tool (D300). */
  seq: number | null;
  understood_en: string;
  understood_id: string;
  args: Record<string, string>;
  normalised: string;
}

interface Gate {
  name: string;
  effect: "read" | "guide" | "write";
  module: string | null;
  level: "read" | "write";
  instead_at: string | null;
  label: string;
}

/** What `record_turn` was given, kept together so the three call sites cannot
 *  disagree about the argument order. */
interface TurnDraft {
  kind: AssistantTurn["kind"];
  understood_as?: string | null;
  text?: string;
  facts?: AnswerFact[];
  steps?: AssistantTurn["steps"];
  tools_used?: string[];
  refused_because?: "closed" | "permission" | null;
  route?: string | null;
  matched_rule?: number | null;
}

async function record(prompt: string, t: TurnDraft): Promise<Result<TurnRow>> {
  const { data, error } = await db().rpc("record_turn", {
    p_prompt: prompt,
    p_kind: t.kind,
    p_lang: getActiveLang(),
    p_understood_as: t.understood_as ?? null,
    p_text: t.text ?? "",
    p_facts: t.facts ?? [],
    p_steps: t.steps ?? [],
    p_tools_used: t.tools_used ?? [],
    p_refused_because: t.refused_because ?? null,
    p_route: t.route ?? null,
    p_matched_rule: t.matched_rule ?? null,
  });
  return fromSeam<TurnRow>(SERVICE, data, error);
}

export async function ask(prompt: string, context?: AskContext): Promise<Result<AssistantReply>> {
  const lang = getActiveLang();
  const id = lang === "id";

  if (!prompt?.trim()) {
    return invalid(SERVICE, "empty_prompt",
      id ? "Tulis pertanyaannya dulu." : "Write the question first.", { field: "prompt" });
  }

  const { data: routed, error: routeErr } = await db().rpc("route", { p_prompt: prompt });
  if (routeErr) return fail(SERVICE, routeErr);
  let match = routed as Match | null;
  /** Who read the sentence, when it was not the keyword router: the model's
   *  provider, recorded beside the tool so a turn says how it was understood. */
  let via: string | null = null;

  const email = await myEmail();

  /* **Not understanding is a real answer, and the most important one here.**
     A router that always finds something answers the wrong question with
     confidence. The turn is stored anyway — the unmatched ones are the list of
     things people expected John Lau to understand, and the evidence for
     deciding whether a model is worth it (0039). */
  if (!match) {
    /* **A model, when this deployment has one** (D296). The keyword router
       stays first and stays the only road to a figure: a sentence it
       recognises is answered exactly as before. What a model changes is this
       branch — *how do I…* in words nobody wrote a rule for — and it answers
       from the process knowledge (0126), never from business data. A
       deployment with no model answers 501 and falls through to the honest
       *I do not understand* below, which is still John Lau as he was. */
    const explained = await explain(prompt, context, lang);
    if (explained) {
      if (!isOk(explained)) return explained;
      if ("turn" in explained.data) {
        return ok(SERVICE, {
          turn: toTurn(explained.data.turn, email),
          understood_as: explained.data.turn.understood_as ?? "",
        });
      }
      /* **The model picked a tool** (D300). From here it is exactly as if a
         keyword rule had matched: the gate below decides whether the prompt
         may reach it and whether this person may, the read runs the screen's
         own call as the person, and a write is only ever a draft. The model
         chose *which* door; it never walks through one. */
      const pick = explained.data.pick;
      match = {
        tool: pick.tool, seq: null, args: pick.args, normalised: prompt,
        understood_en: pick.understood, understood_id: pick.understood,
      };
      via = `ai.${pick.provider}`;
    }
  }

  if (!match) {
    const res = await record(prompt, {
      kind: "unknown",
      text: id
        ? "Saya tidak mengerti maksudnya. Saya sengaja tidak menebak — jawaban yang salah dengan yakin lebih buruk daripada tidak menjawab. Yang bisa saya kerjakan ada di daftar di bawah."
        : "I do not understand that. I deliberately do not guess — a confident wrong answer is worse than no answer. What I can do is in the list below.",
    });
    if (!isOk(res)) return res;
    return ok(SERVICE, {
      turn: toTurn(res.data, email),
      understood_as: id ? "tidak dikenali" : "not recognised",
    });
  }

  const understood = id ? match.understood_id : match.understood_en;

  /* **The gate, in the database, in its own order**: does the tool exist, is
     it reachable from a prompt at all, and only then does this person hold the
     grant. Nothing about that order is re-implemented here — this call is the
     whole of it (0038). */
  const { data: gateData, error: gateErr } = await db()
    .rpc("may_run", { p_name: match.tool, p_lang: lang });
  if (gateErr) return fail(SERVICE, gateErr);
  const gate = fromSeam<Gate>(SERVICE, gateData, null);

  if (!isOk(gate)) {
    /* The database already chose the sentence and already said which of the
       two refusals it is. Both are relayed whole: *nobody, ever* and *not you*
       have different fixes, and a screen that renders them alike sends
       somebody to argue with the wrong person (F64). */
    const detail = gate.error.detail as { refused_because?: "closed" | "permission"; instead_at?: string } | undefined;
    const res = await record(prompt, {
      kind: "refused",
      understood_as: understood,
      text: gate.error.message,
      tools_used: via ? [match.tool, via] : [match.tool],
      refused_because: detail?.refused_because ?? null,
      route: detail?.instead_at ?? null,
      matched_rule: match.seq,
    });
    if (!isOk(res)) return res;
    return ok(SERVICE, { turn: toTurn(res.data, email), understood_as: understood });
  }

  const tool = gate.data;

  /* Guidance. Touches nothing, needs no grant, and explains a screen the
     person may not be able to open — which the guide says, rather than
     pretending otherwise. */
  if (tool.effect === "guide") {
    const guide = resolveGuide(GUIDES[tool.name], lang);
    const res = await record(prompt, {
      kind: "guide",
      understood_as: understood,
      text: guide.title,
      steps: guide.steps,
      tools_used: via ? [tool.name, via] : [tool.name],
      route: guide.route,
      matched_rule: match.seq,
    });
    if (!isOk(res)) return res;
    return ok(SERVICE, { turn: toTurn(res.data, email), understood_as: understood });
  }

  /* A write is a draft, and a draft is not a write (D220). Nothing is queued,
     nothing is reserved, and abandoning one costs nothing — because nothing
     had started. */
  if (tool.effect === "write") {
    /* A purchase order is drafted from the approved line it buys (D297,
       D300): look for it now, as this person, so the fields the draft shows
       are what was approved rather than what a sentence suggested. */
    if (tool.name === "procurement.draft_po") {
      const lines = await procurement.listOpenLines();
      if (isOk(lines)) match = { ...match, args: resolvePoDraft(match.args ?? {}, lines.data, prompt) };
    }
    /* A leave request names somebody this person can already see (D301):
       looked up as them, so a name they cannot read stays blank. */
    if (tool.name === "hr.draft_leave") {
      const people = await hr.listEmployees();
      if (isOk(people)) match = { ...match, args: resolveLeaveDraft(match.args ?? {}, people.data, prompt, officeToday()) };
    }
    const res = await record(prompt, {
      kind: "draft",
      understood_as: understood,
      text: id
        ? "Ini yang akan saya tulis. Belum ada apa pun yang tersimpan — periksa tiap barisnya, lalu konfirmasi."
        : "This is what I would write. Nothing is saved yet — check every field, then confirm.",
      tools_used: via ? [tool.name, via] : [tool.name],
      route: tool.instead_at,
      matched_rule: match.seq,
    });
    if (!isOk(res)) return res;

    const { data: dData, error: dErr } = await db().rpc("open_draft", {
      p_turn_id: res.data.id,
      p_tool: tool.name,
      p_args: match.args ?? {},
      p_key: crypto.randomUUID(),
    });
    const opened = fromSeam<DraftRow>(SERVICE, dData, dErr);
    if (!isOk(opened)) return opened;

    return ok(SERVICE, {
      turn: toTurn(res.data, email, toDraft(opened.data, tool.name, match.args ?? {})),
      understood_as: understood,
    });
  }

  /* Reading. Every figure comes back from a named call, made as this person. */
  const answer = await readFor(tool, lang);
  const res = await record(prompt, {
    kind: "answer",
    understood_as: understood,
    text: answer.text,
    facts: answer.facts,
    tools_used: via ? [tool.name, via] : [tool.name],
    route: tool.instead_at,
    matched_rule: match.seq,
  });
  if (!isOk(res)) return res;
  return ok(SERVICE, { turn: toTurn(res.data, email), understood_as: understood });
}

/** The model's answer, recorded as a turn — or null when this deployment
 *  has no model, which is the caller's cue to say *I do not understand*.
 *
 *  Any other failure is returned rather than swallowed: a model that is
 *  configured and broken is IT's problem to see, and folding it into *I do not
 *  understand* would hide a wrong key behind a sentence about the question. */
interface ModelPick {
  tool: string;
  args: Record<string, string>;
  understood: string;
  provider: string;
}

async function explain(
  prompt: string, context: AskContext | undefined, lang: "en" | "id",
): Promise<Result<{ turn: TurnRow } | { pick: ModelPick }> | null> {
  let res: Response;
  try {
    res = await fetch("/api/assistant/explain", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, pathname: context?.pathname ?? null, lang }),
    });
  } catch {
    return null;
  }
  if (res.status === 501 || res.status === 404) return null;
  const body = await res.json().catch(() => null) as
    { data?: TurnRow & { pick?: ModelPick }; error?: { code: string; message: string } } | null;
  if (!res.ok || !body?.data) {
    return refused(SERVICE, body?.error?.code ?? "llm_failed",
      body?.error?.message ?? (lang === "id" ? "John Lau tidak bisa menjawab sekarang." : "John Lau cannot answer right now."),
      { status: res.status });
  }
  /* Either a recorded how-to answer, or the tool the model picked — which the
     caller runs through the gate like any keyword match. */
  if (body.data.pick) return ok(SERVICE, { pick: body.data.pick });
  return ok(SERVICE, { turn: body.data });
}

/** The figures, each from the same call the screen makes.
 *
 *  Every branch here is one `await` against a service client this application
 *  already had. Nothing queries a view directly and nothing computes: a number
 *  John Lau says and the number on the screen it points at come from the same
 *  function, so a disagreement between them is impossible rather than
 *  unlikely.
 */
async function readFor(
  tool: Gate,
  lang: "en" | "id",
): Promise<{ text: string; facts: AnswerFact[] }> {
  const id = lang === "id";
  const src = tool.name;

  /** A tool in the catalogue with nothing behind it yet. Named per tool rather
   *  than defaulted, so the next one somebody adds and forgets to wire says so
   *  instead of answering something reassuring. */
  const notBuilt = (what: string, where: string) => ({
    text: id
      ? `${what} belum bisa saya jawab — modulnya belum ada isinya di sistem baru. Layarnya sudah ada di ${where}.`
      : `I cannot answer ${what} yet — that module has nothing in it in the new system. The screen is at ${where}.`,
    facts: [] as AnswerFact[],
  });

  switch (src) {
    case "accounting.balances": {
      const res = await accounting.listAccounts();
      if (!isOk(res)) return { text: res.error.message, facts: [] };
      return {
        text: id
          ? "Saldo tiap rekening, dihitung dari transaksi yang tercatat — sama dengan yang ada di buku besar."
          : "The balance of each account, computed from the recorded transactions — the same figures the ledger shows.",
        facts: res.data.map((a): AnswerFact => ({
          label: `${a.code} · ${a.name}`,
          value: null, amount: Math.round(a.balance), unit: "IDR",
          source: src, href: "/accounting/ledger",
        })),
      };
    }

    case "procurement.pending_approvals": {
      const res = await procurement.queue();
      if (!isOk(res)) return { text: res.error.message, facts: [] };
      const lines = res.data;
      return {
        text: lines.length === 0
          ? (id ? "Tidak ada baris yang menunggu persetujuan." : "No lines are waiting for approval.")
          : (id ? `${lines.length} baris menunggu persetujuan.` : `${lines.length} lines are waiting for approval.`),
        facts: lines.slice(0, 8).map((l): AnswerFact => ({
          label: `${l.line_no_full} · ${l.description}`,
          value: l.item_total != null ? null : (id ? "nilai belum ada" : "no value yet"),
          amount: l.item_total ?? null,
          unit: l.item_total != null ? "IDR" : null,
          source: src, href: "/procurement/meeting",
        })),
      };
    }

    case "procurement.vendor_debt": {
      const res = await procurement.listVendorJourneys();
      if (!isOk(res)) return { text: res.error.message, facts: [] };
      const owing = res.data
        .filter((j) => j.outstanding > 0)
        .sort((a, b) => b.outstanding - a.outstanding);
      return {
        text: owing.length === 0
          ? (id ? "Tidak ada vendor dengan sisa kewajiban." : "No vendor has an outstanding balance.")
          : (id ? `${owing.length} vendor masih punya sisa kewajiban.` : `${owing.length} vendors still have an outstanding balance.`),
        facts: owing.slice(0, 8).map((j): AnswerFact => ({
          label: j.vendor_name,
          value: null, amount: Math.round(j.outstanding), unit: "IDR",
          source: src, href: `/procurement/tracker/${j.vendor_id}`,
        })),
      };
    }

    case "inventory.low_stock": {
      const res = await inventory.listStock({ low_only: true });
      if (!isOk(res)) return { text: res.error.message, facts: [] };
      const rows = res.data;
      return {
        text: rows.length === 0
          ? (id ? "Tidak ada item di bawah stok minimum." : "No item is below its minimum stock.")
          : (id ? `${rows.length} item di bawah stok minimum.` : `${rows.length} items are below their minimum stock.`),
        facts: rows.slice(0, 8).map((r): AnswerFact => ({
          label: r.item_name,
          /* A quantity, not a currency (D217's `amount`/`unit` carry `IDR`
             today, nothing else) — "a count with its unit" is what `value` is
             for, per its own doc comment. */
          value: `${r.on_hand} ${r.uom}${r.min_qty != null ? ` (min ${r.min_qty})` : ""}`,
          source: src, href: "/inventory/material",
        })),
      };
    }

    /* `ops_prod` has no tables in it at all, so there is nothing to read and
       nothing to be wrong about — which is a better answer than a zero. */
    case "production.late_orders":
      return notBuilt(id ? "SPK yang lewat tanggal" : "work orders past their date", "/produksi/jadwal");
    case "delivery.fulfilment":
      return notBuilt(id ? "progres pengiriman" : "delivery progress", "/proyek/serah-terima");

    default:
      /* A tool that is `effect: 'read'` in the catalogue and has no branch
         here. It cannot happen without somebody adding a row and not adding
         code, and if it does the honest answer is that it does not work. */
      return {
        text: id
          ? `Saya belum punya cara menjawab ${src}. Layarnya ada di ${tool.instead_at ?? "—"}.`
          : `I have no way to answer ${src} yet. The screen is at ${tool.instead_at ?? "—"}.`,
        facts: [],
      };
  }
}

/* ── the second yes ────────────────────────────────────────────────────── */

/** The payload confirmed is the payload written.
 *
 *  `fields` comes from the confirmation form, not from the original sentence:
 *  a person edits the blanks before saying yes, and a confirmation of what was
 *  asked rather than of what was filled in is a confirmation of a summary
 *  (D220).
 *
 *  The order is: **write first, record second.** A settlement row written
 *  before the write is a row claiming a purchase request that may never exist;
 *  a write with no settlement row is a purchase request that is plainly there,
 *  on its own screen, with its own audit trail — the harmless failure. Same
 *  reasoning as the upload route.
 */
export async function confirmDraft(
  input: { turn_id: string; fields: Record<string, string> },
): Promise<Result<AssistantTurn>> {
  const lang = getActiveLang();
  const id = lang === "id";

  const { data: dRows, error: dErr } = await db()
    .from("drafts").select("*").eq("turn_id", input.turn_id).limit(1);
  if (dErr) return fail(SERVICE, dErr);
  const draft = (dRows ?? [])[0] as DraftRow | undefined;
  if (!draft) {
    return fromRows<AssistantTurn>(SERVICE, null, {
      code: "PGRST116",
      message: id ? "Rancangan itu tidak ada lagi." : "That draft is no longer there.",
    });
  }
  if (draft.outcome) {
    return refused(SERVICE, "already_decided",
      id ? `Rancangan ini sudah ${draft.outcome === "confirmed" ? "dikonfirmasi" : "dibatalkan"}.`
         : `This draft was already ${draft.outcome}.`, { outcome: draft.outcome });
  }

  let produced: string | null = null;

  if (draft.tool === "procurement.draft_pr_line") {
    /* Read by key, never by label: `fields` arrives keyed by `key` precisely
       so that what the person filled in survives a language switch between the
       draft and the yes. */
    const qty = input.fields.qty ?? "";
    const res = await procurement.quickAddLine({
      description: input.fields.item ?? "",
      qty: Number(qty.split(" ")[0]) || 1,
      uom: (qty.split(" ")[1] ?? "pcs") as never,
      unit_price: null,
      vendor_id: null,
      purpose: input.fields.purpose
        || (id ? "Diminta lewat John Lau" : "Requested through John Lau"),
    });
    /* The write refused. Nothing is settled, so the draft is still open and
       the person can fix the field the seam named and press yes again. */
    if (!isOk(res)) return res as unknown as Result<AssistantTurn>;
    produced = res.data.line_no_full;
  }
  /* A purchase order is written as a DRAFT through the same seam the screen
     uses, and goes to leadership unless its author is leadership (D299,
     D300). Issuing it stays on the PO screen, where the lines and the deposit
     are in front of the person sending it to a vendor (D220). */
  if (draft.tool === "procurement.draft_po") {
    const res = await confirmPoDraft(procurement, input.fields, draft.args ?? {}, lang);
    if (!isOk(res)) return res as unknown as Result<AssistantTurn>;
    produced = res.data;
  }
  /* A leave request through the seam "Ajukan" on /hrd/cuti uses; it lands
     PENDING and is decided there, by a person (D301). */
  if (draft.tool === "hr.draft_leave") {
    const res = await confirmLeaveDraft(hr, input.fields, draft.args ?? {}, lang);
    if (!isOk(res)) return res as unknown as Result<AssistantTurn>;
    produced = res.data;
  }

  const { data: sData, error: sErr } = await db().rpc("settle_draft", {
    p_draft_id: draft.id,
    p_outcome: "confirmed",
    p_payload: input.fields,
    p_produced_ref: produced,
  });
  const settled = fromSeam<DraftRow>(SERVICE, sData, sErr);
  if (!isOk(settled)) return settled as unknown as Result<AssistantTurn>;

  return reread(input.turn_id, settled.data);
}

export async function abandonDraft(turnId: string): Promise<Result<AssistantTurn>> {
  const { data: dRows, error: dErr } = await db()
    .from("drafts").select("*").eq("turn_id", turnId).limit(1);
  if (dErr) return fail(SERVICE, dErr);
  const draft = (dRows ?? [])[0] as DraftRow | undefined;
  if (!draft) {
    return fromRows<AssistantTurn>(SERVICE, null, {
      code: "PGRST116", message: "That draft is no longer there.",
    });
  }

  const { data, error } = await db().rpc("settle_draft", {
    p_draft_id: draft.id, p_outcome: "abandoned", p_payload: null, p_produced_ref: null,
  });
  const settled = fromSeam<DraftRow>(SERVICE, data, error);
  if (!isOk(settled)) return settled as unknown as Result<AssistantTurn>;
  return reread(turnId, settled.data);
}

/** The turn as it stands after a draft was settled.
 *
 *  Re-read rather than patched in memory: the screen is about to redraw from
 *  this, and a turn assembled from what this client *believes* happened is a
 *  turn that can disagree with the row. `draft_outcome` and `produced_ref`
 *  come off the settled draft, which is where they are recorded.
 */
async function reread(turnId: string, settled: DraftRow): Promise<Result<AssistantTurn>> {
  const { data, error } = await db().from("turns").select("*").eq("id", turnId).limit(1);
  if (error) return fail(SERVICE, error);
  const row = (data ?? [])[0] as TurnRow | undefined;
  if (!row) {
    return fromRows<AssistantTurn>(SERVICE, null, {
      code: "PGRST116", message: "That turn is no longer there.",
    });
  }
  const email = await myEmail();
  const turn = toTurn(row, email, toDraft(settled, settled.tool, settled.args ?? {}));
  turn.draft_outcome = settled.outcome;
  turn.produced_ref = settled.produced_ref;
  return ok(SERVICE, turn);
}

/* ── the tuning list ───────────────────────────────────────────────────── */

/** The questions John Lau did not understand, grouped and without names.
 *
 *  `it.read`, and the refusal comes from the function rather than from a check
 *  here: it is everybody's prompts in one place, so it is IT's. A client-side
 *  guard would be a second, weaker statement of a rule the database already
 *  makes.
 */
export async function unmatched(limit = 200): Promise<Result<UnmatchedPrompt[]>> {
  const { data, error } = await db().rpc("unmatched", { p_limit: limit });
  return fromRows<UnmatchedPrompt[]>(SERVICE, (data ?? []) as UnmatchedPrompt[], error);
}

export async function routerHealth(): Promise<Result<RouterHealth>> {
  const { data, error } = await db().rpc("router_health");
  if (error) return fail(SERVICE, error);
  /* A set-returning function comes back as an array of one. An empty one means
     nobody has asked anything yet, which is a real state and not an error —
     the screen says *nothing has been asked yet* rather than failing to load. */
  const row = ((data ?? []) as RouterHealth[])[0];
  return ok(SERVICE, row ?? {
    turns: 0, answered: 0, guided: 0, drafted: 0, unknown: 0,
    refused_closed: 0, refused_permission: 0, since: null,
  });
}

interface RuleRow {
  seq: number;
  tool: string;
  stage: "how" | "main";
  all_words: string[];
  any_words: string[];
  not_words: string[];
  understood_en: string;
  understood_id: string;
  note: string | null;
}

/** The rules as they stand. Read-only everywhere, including here: they are
 *  rows a migration wrote, and the one screen that shows them says who can
 *  change them (A7). */
export async function listRules(): Promise<Result<RouterRule[]>> {
  const { data, error } = await db().from("rules").select("*").order("seq");
  if (error) return fail(SERVICE, error);
  const lang = getActiveLang();
  return ok(SERVICE, (data ?? []).map((r: RuleRow): RouterRule => ({
    seq: r.seq,
    tool: r.tool,
    stage: r.stage,
    all_words: r.all_words ?? [],
    any_words: r.any_words ?? [],
    not_words: r.not_words ?? [],
    understood: lang === "id" ? r.understood_id : r.understood_en,
    note: r.note,
  })));
}
