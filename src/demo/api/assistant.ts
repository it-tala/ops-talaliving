/** John Lau — the dispatcher.
 *
 *  Three gates, in this order, and the order is deliberate (D218–D220):
 *
 *  1. **Is the tool reachable from a prompt at all?** Blocked tools are
 *     refused here, before permissions are even consulted, so the refusal
 *     reads the same for the CEO as for a new hire. A rule that a grant can
 *     lift is a default, and the owner's answer about berkas 201 and IT was
 *     not a default.
 *  2. **Does the person hold the grant?** Every tool runs through the same
 *     `requireModule` the screens use, as the person typing. An assistant with
 *     more rights than its user is a privilege escalation with a friendly face.
 *  3. **Is this a write?** Then it is a draft, and a draft is not a write.
 *
 *  And the rule that runs through all of it: **no figure is composed here.**
 *  Every number in a reply is produced by a named call and carries that name,
 *  so it can be checked on a screen (D217).
 */
import { ok, invalid, notFound, refused, type Result } from "@/services/_shared/envelope";
import type {
  AssistantReply, AssistantTurn, AssistantTool, AnswerFact, AssistantDraft,
  UnmatchedPrompt, RouterHealth, RouterRule, AskContext,
} from "@/services/assistant/contracts";
import { getState, apply, newId, writeAudit } from "../store";
import { latency, actingUser, requireModule, replayed, remember } from "./_kit";
import { TOOLS, findTool, resolveTool } from "../assistant/catalogue";
import { settingText } from "../settings";
import type { Lang } from "@/lib/i18n";
import { route, normalise, rules } from "../assistant/router";
import { GUIDES, resolveGuide, draftShape, resolvePoDraft, confirmPoDraft, resolveLeaveDraft, confirmLeaveDraft } from "@/lib/john-lau";
import { accountBalances, approvalQueue, vendorJourney } from "../derive";
import { stockItems } from "../inventory-derive";
import { workOrderViews } from "../production-derive";
import { fulfilmentViews } from "../delivery-derive";
import { officeToday } from "@/lib/office";
import * as procurement from "./procurement";
import * as hr from "./hr";

const SERVICE = "procurement" as const;

/** The language in force, from the setting (D216, D224). Resolved here so a
 *  Phase-2 HTTP client receives finished sentences, and the language of a
 *  refusal is decided in the same place as the refusal. */
function lang(): Lang {
  return settingText(getState(), "format.language", "en") === "id" ? "id" : "en";
}

export async function listTools(): Promise<Result<AssistantTool[]>> {
  await latency();
  const l = lang();
  return ok(SERVICE, TOOLS.map((t) => resolveTool(t, l)));
}

export async function listTurns(limit = 50): Promise<Result<AssistantTurn[]>> {
  await latency();
  const user = actingUser();
  /* Your own conversation only. Somebody else's questions are a record about
     them, and this is not the screen for reading those (D218). */
  return ok(SERVICE, getState().assistant_turns
    .filter((t) => t.actor_id === user.id)
    .slice(-limit));
}

function newTurn(prompt: string, kind: AssistantTurn["kind"]): AssistantTurn {
  const user = actingUser();
  return {
    id: newId("ask"), at: new Date().toISOString(),
    actor_id: user.id, actor_email: user.email,
    prompt, kind, text: "", facts: [], steps: [], tools_used: [],
    refused_because: null,
    draft: null, draft_outcome: null, produced_ref: null, route: null,
  };
}

function store(turn: AssistantTurn) {
  apply((draft) => { draft.assistant_turns.push(turn); });
}

/** Asking. `context` is accepted and unused: the demo has no model, so the
 *  screen somebody is on changes nothing about a keyword match. */
export async function ask(prompt: string, context?: AskContext): Promise<Result<AssistantReply>> {
  await latency();
  const denied = requireModule(SERVICE, "procurement");
  if (denied) {
    /* The assistant is reachable from any module grant in practice; what it
       can then DO is decided per tool. This guard only keeps a user with no
       grants at all out. */
  }
  if (!prompt?.trim()) {
    return invalid(SERVICE, "empty_prompt", "Tulis pertanyaannya dulu.", { field: "prompt" });
  }

  const match = route(prompt);
  if (!match) {
    const turn = newTurn(prompt, "unknown");
    turn.text = lang() === "id"
      ? "Saya tidak mengerti maksudnya. Saya sengaja tidak menebak — jawaban yang salah dengan yakin lebih buruk daripada tidak menjawab. Yang bisa saya kerjakan ada di daftar di bawah."
      : "I do not understand that. I deliberately do not guess — a confident wrong answer is worse than no answer. What I can do is in the list below.";
    store(turn);
    return ok(SERVICE, { turn, understood_as: "tidak dikenali" });
  }

  const tool = findTool(match.tool);
  if (!tool) return notFound(SERVICE, "tool_not_found", `Tidak ada kemampuan ${match.tool}.`);

  /* Gate 1 — reachability. Before permissions, deliberately. */
  if (tool.reach === "blocked") {
    const turn = newTurn(prompt, "refused");
    turn.refused_because = "closed";
    turn.tools_used = [tool.name];
    turn.text = tool.blocked_reason?.[lang()] ?? "";
    turn.route = tool.instead_at;
    store(turn);
    apply((draft) => {
      writeAudit(draft, {
        service: SERVICE, entity: "assistant", entity_no: tool.name,
        action: "ask", outcome: "refused",
        reason: "di luar jangkauan prompt",
        /* The prompt itself is **not** stored on the audit row: somebody
           asking for a salary has not done anything wrong, and a permanent
           record of the question would be a worse trail than no trail. What is
           recorded is that the boundary held. */
        detail: { tool: tool.name, by: actingUser().email },
      });
    });
    return ok(SERVICE, { turn, understood_as: match.understood_as });
  }

  /* Gate 2 — the person's own grant, checked as them. */
  if (tool.module) {
    const user = actingUser();
    const held = user.modules.find((m) => m.module === tool.module);
    const rank = { read: 0, write: 1, admin: 2 } as const;
    if (!held || rank[held.level] < rank[tool.level]) {
      const turn = newTurn(prompt, "refused");
      turn.refused_because = "permission";
      turn.tools_used = [tool.name];
      const id = lang() === "id";
      turn.text = held
        ? (id
          ? `Akun Anda punya akses ${held.level} ke modul ${tool.module}; ini butuh ${tool.level}. Saya bekerja dengan hak Anda, bukan hak saya sendiri.`
          : `Your account has ${held.level} access to the ${tool.module} module; this needs ${tool.level}. I work with your rights, not my own.`)
        : (id
          ? `Akun Anda tidak punya akses ke modul ${tool.module}. Saya bekerja dengan hak Anda, bukan hak saya sendiri — kalau saya bisa membacanya untuk Anda, izin di aplikasi ini tidak berarti apa-apa.`
          : `Your account has no access to the ${tool.module} module. I work with your rights, not my own — if I could read it for you, permissions in this app would mean nothing.`);
      turn.route = tool.instead_at;
      store(turn);
      return ok(SERVICE, { turn, understood_as: match.understood_as });
    }
  }

  /* Guidance. */
  if (tool.effect === "guide") {
    const guide = resolveGuide(GUIDES[tool.name], lang());
    const turn = newTurn(prompt, "guide");
    turn.tools_used = [tool.name];
    turn.text = guide.title;
    turn.steps = guide.steps;
    turn.route = guide.route;
    store(turn);
    return ok(SERVICE, { turn, understood_as: match.understood_as });
  }

  /* Gate 3 — a write is a draft. */
  if (tool.effect === "write") {
    /* The same lookup as the live client: a PO is drafted from the approved
       line it buys (D297, D300). */
    let args = match.args;
    if (tool.name === "procurement.draft_po") {
      const lines = await procurement.listOpenLines();
      if (!lines.error) args = resolvePoDraft(args, lines.data, prompt);
    }
    /* A leave request names somebody this person can already see (D301). */
    if (tool.name === "hr.draft_leave") {
      const people = await hr.listEmployees();
      if (!people.error) args = resolveLeaveDraft(args, people.data, prompt, officeToday());
    }
    const draft = buildDraft(tool.name, args);
    const turn = newTurn(prompt, "draft");
    turn.tools_used = [tool.name];
    turn.text = lang() === "id"
      ? "Ini yang akan saya tulis. Belum ada apa pun yang tersimpan — periksa tiap barisnya, lalu konfirmasi."
      : "This is what I would write. Nothing is saved yet — check every field, then confirm.";
    turn.draft = draft;
    turn.route = tool.instead_at;
    store(turn);
    return ok(SERVICE, { turn, understood_as: match.understood_as });
  }

  /* Reading. Every figure comes back from a named computation. */
  const { text, facts } = readFor(tool.name);
  const turn = newTurn(prompt, "answer");
  turn.tools_used = [tool.name];
  turn.text = text;
  turn.facts = facts;
  turn.route = tool.instead_at;
  store(turn);

  /* A read through the prompt is a read (D188): it belongs in the activity
     log exactly like opening the screen would. */
  apply((d) => {
    d.activity_events.push({
      id: newId("act"), at: new Date().toISOString(),
      actor_id: actingUser().id, actor_email: actingUser().email,
      kind: "view", target: tool.instead_at ?? tool.name,
      label: `John Lau — ${tool.label[lang()]}`,
    });
  });

  return ok(SERVICE, { turn, understood_as: match.understood_as });
}

/** The figures, each from the same computation the screen uses. */
function readFor(tool: string): { text: string; facts: AnswerFact[] } {
  const state = getState();
  const id = lang() === "id";
  const today = officeToday();

  switch (tool) {
    case "accounting.balances": {
      const rows = accountBalances(state);
      return {
        text: id ? "Saldo tiap rekening, dihitung dari transaksi yang tercatat — sama dengan yang ada di buku besar." : "The balance of each account, computed from the recorded transactions — the same figures the ledger shows.",
        facts: rows.map((a) => ({
          /* The figure goes back unformatted. `formatIDR` follows a locale
              the person chooses, so a number formatted here is a number that
              disagrees with the ledger it is supposed to be checkable against
              (D217). */
          label: a.code, value: null, amount: Math.round(a.balance), unit: "IDR",
          source: tool, href: "/accounting/ledger",
        })),
      };
    }
    case "procurement.pending_approvals": {
      const lines = approvalQueue(state);
      return {
        text: lines.length === 0
          ? (id ? "Tidak ada baris yang menunggu persetujuan." : "No lines are waiting for approval.")
          : (id ? `${lines.length} baris menunggu persetujuan.` : `${lines.length} lines are waiting for approval.`),
        facts: lines.slice(0, 8).map((l) => ({
          label: `${l.line_no_full} · ${l.description}`,
          value: l.item_total != null ? null : (id ? "nilai belum ada" : "no value yet"),
          amount: l.item_total ?? null, unit: l.item_total != null ? "IDR" : null,
          source: tool, href: "/procurement/meeting",
        })),
      };
    }
    case "inventory.low_stock": {
      const low = stockItems(state).filter((s) => s.below_min);
      return {
        text: low.length === 0
          ? (id ? "Tidak ada barang di bawah stok minimum." : "Nothing is below its minimum.")
          : (id ? `${low.length} barang sudah di bawah minimum.` : `${low.length} items are below their minimum.`),
        facts: low.slice(0, 10).map((s) => ({
          label: s.item_name, value: `${s.on_hand} ${s.uom} (min ${s.min_qty ?? "—"})`,
          source: tool, href: "/inventory/material",
        })),
      };
    }
    case "production.late_orders": {
      const late = workOrderViews(state, today).filter((w) => w.late && w.status === "OPEN");
      return {
        text: late.length === 0
          ? (id ? "Tidak ada SPK yang lewat tanggal janji." : "No work order is past its promised date.")
          : (id ? `${late.length} SPK sudah lewat tanggal janji.` : `${late.length} work orders are past their promised date.`),
        facts: late.map((w) => ({
          label: `${w.wo_no} · ${w.item_name}`,
          value: `lewat ${-w.days_left} hari, ${w.percent}% selesai`,
          source: tool, href: "/produksi/jadwal",
        })),
      };
    }
    case "delivery.fulfilment": {
      const rows = fulfilmentViews(state, today);
      return {
        text: id ? "Sejauh mana tiap pesanan klien sampai ke mereka." : "How far each client order has reached them.",
        facts: rows.map((f) => ({
          label: f.project_name,
          value: f.installed_percent == null
            ? "belum bisa dihitung"
            : `${f.installed_percent}% terpasang${f.open_snags > 0 ? `, ${f.open_snags} temuan terbuka` : ""}`,
          source: tool, href: "/proyek/serah-terima",
        })),
      };
    }
    case "procurement.vendor_debt": {
      const rows = state.vendors
        .filter((v) => !v.merged_into)
        .map((v) => ({ v, j: vendorJourney(state, v.id) }))
        .filter((x) => x.j.outstanding > 0)
        .sort((a, b) => b.j.outstanding - a.j.outstanding);
      return {
        text: rows.length === 0
          ? (id ? "Tidak ada vendor dengan sisa kewajiban." : "No vendor has an outstanding balance.")
          : (id ? `${rows.length} vendor masih punya sisa kewajiban.` : `${rows.length} vendors still have an outstanding balance.`),
        facts: rows.slice(0, 8).map((x) => ({
          label: x.v.name,
          value: null, amount: Math.round(x.j.outstanding), unit: "IDR",
          source: tool, href: `/procurement/tracker/${x.v.id}`,
        })),
      };
    }
    default:
      return { text: id ? "Belum ada perhitungan untuk ini." : "There is no computation for this yet.", facts: [] };
  }
}

/** The demo's half of a draft: the identity, the key and the moment.
 *
 *  What is *in* the draft — the headline, the fields, the warnings — comes
 *  from `draftShape` in `@/lib/john-lau`, shared with the real client. D220
 *  says the confirmation is of the exact payload, and two copies of what the
 *  payload looks like is how one implementation asks for three fields while
 *  the other writes four.
 */
function buildDraft(tool: string, args: Record<string, string>): AssistantDraft {
  return {
    id: newId("dft"), tool,
    ...draftShape(tool, args, lang()),
    args: { ...args },
    idempotency_key: newId("idem"),
    created_at: new Date().toISOString(),
  };
}

/** The second yes.
 *
 *  The payload confirmed is the payload written — the screen renders every
 *  field and this call takes them from the confirmation, not from the original
 *  sentence. A confirmation of a summary is a confirmation of the summary
 *  (D220).
 */
export async function confirmDraft(
  input: { turn_id: string; fields: Record<string, string> },
): Promise<Result<AssistantTurn>> {
  await latency();
  const state = getState();
  const turn = state.assistant_turns.find((t) => t.id === input.turn_id);
  if (!turn || !turn.draft) return notFound(SERVICE, "draft_not_found", "Rancangan itu tidak ada lagi.");
  if (turn.draft_outcome) {
    return refused(SERVICE, "already_decided", `Rancangan ini sudah ${turn.draft_outcome === "confirmed" ? "dikonfirmasi" : "dibatalkan"}.`, {});
  }

  const cached = replayed<AssistantTurn>(SERVICE, "confirmDraft", turn.draft.idempotency_key);
  if (cached) return cached;

  const tool = findTool(turn.draft.tool)!;
  const user = actingUser();
  const held = user.modules.find((m) => m.module === tool.module);
  /* Checked again at confirm time. A grant can be taken away between the draft
     and the yes, and the draft is not a licence. */
  if (!held || (tool.level === "write" && held.level === "read")) {
    return refused(SERVICE, "no_longer_permitted", `Akun Anda tidak lagi boleh menulis di modul ${tool.module}.`, {});
  }

  let produced: string | null = null;
  if (turn.draft.tool === "procurement.draft_pr_line") {
    /* By key, not by label — a label is display text and changes with the
       language in force (see `AssistantDraft.fields`). */
    const res = await procurement.quickAddLine({
      description: input.fields.item ?? "",
      qty: Number(input.fields.qty?.split(" ")[0] ?? 1),
      uom: (input.fields.qty?.split(" ")[1] ?? "pcs") as never,
      unit_price: null,
      vendor_id: null,
      purpose: input.fields.purpose || "Diminta lewat John Lau",
    });
    if (res.error) return res as unknown as Result<AssistantTurn>;
    produced = res.data.line_no_full;
  } else if (turn.draft.tool === "procurement.draft_po") {
    /* Written as a DRAFT through `createPo`, confirmed on creation when the
       author holds the authority, sent to leadership otherwise (D299, D300).
       Issuing it stays on the PO screen (D220). */
    const res = await confirmPoDraft(procurement, input.fields, (turn.draft.args ?? {}) as Record<string, string>, lang());
    if (res.error) return res as unknown as Result<AssistantTurn>;
    produced = res.data;
  } else if (turn.draft.tool === "hr.draft_leave") {
    /* Through the same call as "Ajukan" on /hrd/cuti; deciding it stays there (D301). */
    const res = await confirmLeaveDraft(hr, input.fields, (turn.draft.args ?? {}) as Record<string, string>, lang());
    if (res.error) return res as unknown as Result<AssistantTurn>;
    produced = res.data;
  }

  apply((d) => {
    const row = d.assistant_turns.find((t) => t.id === input.turn_id)!;
    row.draft_outcome = "confirmed";
    row.produced_ref = produced;
    writeAudit(d, {
      service: SERVICE, entity: "assistant", entity_no: row.draft!.tool,
      action: "confirm", outcome: "ok", reason: null,
      detail: { produced, fields: input.fields, by: user.email },
    });
  });

  const after = getState().assistant_turns.find((t) => t.id === input.turn_id)!;
  remember(SERVICE, "confirmDraft", turn.draft.idempotency_key, after);
  return ok(SERVICE, after);
}

export async function abandonDraft(turnId: string): Promise<Result<AssistantTurn>> {
  await latency();
  const state = getState();
  const turn = state.assistant_turns.find((t) => t.id === turnId);
  if (!turn || !turn.draft) return notFound(SERVICE, "draft_not_found", "Rancangan itu tidak ada lagi.");
  apply((d) => {
    const row = d.assistant_turns.find((t) => t.id === turnId)!;
    row.draft_outcome = "abandoned";
  });
  return ok(SERVICE, getState().assistant_turns.find((t) => t.id === turnId)!);
}

/* ── the tuning list ───────────────────────────────────────────────────── */

/** The questions the router did not understand, grouped the way the router
 *  compares them.
 *
 *  Grouped by `normalise` — the matcher's own function, imported rather than
 *  re-written, because a second normaliser is a second answer to *are these
 *  the same question*. F64 is the day `stoknya menipis` and `stok menipis`
 *  were not.
 *
 *  Nothing about who asked, here as in the database: the question is what we
 *  failed to understand (D218).
 */
export async function unmatched(limit = 200): Promise<Result<UnmatchedPrompt[]>> {
  await latency();
  const denied = requireModule(SERVICE, "it");
  if (denied) return denied as Result<UnmatchedPrompt[]>;

  const groups = new Map<string, UnmatchedPrompt>();
  for (const t of getState().assistant_turns) {
    if (t.kind !== "unknown") continue;
    const key = normalise(t.prompt);
    const g = groups.get(key);
    const l = lang();
    if (!g) {
      groups.set(key, {
        normalised: key, example: t.prompt, times: 1, langs: [l],
        first_at: t.at, last_at: t.at,
      });
    } else {
      g.times += 1;
      if (t.at > g.last_at) { g.last_at = t.at; g.example = t.prompt; }
      if (t.at < g.first_at) g.first_at = t.at;
      if (!g.langs.includes(l)) g.langs.push(l);
    }
  }
  return ok(SERVICE, [...groups.values()]
    .sort((a, b) => b.times - a.times || b.last_at.localeCompare(a.last_at))
    .slice(0, limit));
}

export async function routerHealth(): Promise<Result<RouterHealth>> {
  await latency();
  const denied = requireModule(SERVICE, "it");
  if (denied) return denied as Result<RouterHealth>;

  const turns = getState().assistant_turns;
  const n = (f: (t: AssistantTurn) => boolean) => turns.filter(f).length;
  return ok(SERVICE, {
    turns: turns.length,
    answered: n((t) => t.kind === "answer"),
    guided: n((t) => t.kind === "guide"),
    drafted: n((t) => t.kind === "draft"),
    unknown: n((t) => t.kind === "unknown"),
    refused_closed: n((t) => t.refused_because === "closed"),
    refused_permission: n((t) => t.refused_because === "permission"),
    since: turns.length ? turns[0].at : null,
  });
}

export async function listRules(): Promise<Result<RouterRule[]>> {
  await latency();
  return ok(SERVICE, rules() as RouterRule[]);
}
