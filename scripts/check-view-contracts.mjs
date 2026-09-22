#!/usr/bin/env node
/** Refuse a client that casts a view into a contract it does not satisfy.
 *
 *  ## The two bugs this exists for
 *
 *  `check-api-parity.mjs` compares the two clients' **signatures**. It is
 *  satisfied the moment `listItemViews` says it returns `Result<ItemView[]>`.
 *  What it cannot see is whether the rows the database actually sends carry the
 *  fields `ItemView` promises — because the client says so with a cast:
 *
 *      return fromRows<ItemView[]>(SERVICE, data as ItemView[], error);
 *                                                ^^^^^^^^^^^^
 *
 *  `as` does not check anything. It is the instruction to stop checking. So a
 *  view missing half its columns compiles, passes parity, passes lint, and
 *  fails on the first render that touches one of them.
 *
 *  It happened twice in two days, and the second one had shipped:
 *
 *  - **`v_vendor_view` / `v_item_view`** were missing six columns between them
 *    (`0032`). Both routes were dark, so nobody met it.
 *  - **`v_po_detail`** was missing `status_view`, `self_confirmed` and
 *    `approval_sent_to` (`0033`) — while `/procurement/po/[po]/print` was **in
 *    `LIVE_ROUTES`** and rendered `d.status_view.contract_value`. A route the
 *    guards declared safe, reading a column that had never existed anywhere.
 *
 *  Neither guard was wrong. `check-live-routes.mjs` asks whether the functions
 *  a route reaches are implemented; they were. Nothing asked the database.
 *
 *  ## What it checks
 *
 *  For every view the live client reads, `VIEW_CONTRACTS` names the interface
 *  that view is cast into. This script resolves that interface's fields —
 *  following `extends` — and compares them against the view's real columns,
 *  read from a database with the ladder applied.
 *
 *  A field the view does not return is a finding. So is a view read by the
 *  client and missing from the map, which is what keeps the map from rotting
 *  the way a hand-kept list always does.
 *
 *  Extra columns are fine and deliberately not reported: a view may carry
 *  `fully_delivered` for a `case` expression without any contract naming it.
 *
 *    supabase/local/rebuild.sh && node scripts/check-view-contracts.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const API = join(ROOT, "src/lib/api");

/** view → the interface the client casts its rows into.
 *
 *  Written by hand on purpose. Pairing a `.from()` with the type on a `return`
 *  several lines away is exactly the kind of inference that is right until it
 *  is quietly wrong, and being wrong here is the bug this file exists to catch.
 *  Stating it costs one line and cannot be misread.
 *
 *  A view whose rows are never cast into a named contract — read for one column,
 *  or shaped by hand — maps to `null`, which says *checked, and there is
 *  nothing to check*.
 */
const VIEW_CONTRACTS = {
  /* ── procurement ─────────────────────────────────────────────────────── */
  v_po_board:        "PoView",
  v_po_detail:       "PoDetail",
  v_vendor_view:     "VendorView",
  v_item_view:       "ItemView",
  v_vendor_journey:  { type: "VendorJourney", composed: ["headline"] },
  v_round_summary:   "RoundSummary",
  /* Read for one column, `line_id` — which lines belong to a round, so
     `getRoundView()` can fetch them from `v_pr_line` the same way every other
     line list does. No row here is ever handed to a screen, so there is
     nothing to cast. */
  v_line_round:      null,
  /* Read into `LineRow`, a private flat shape this client reshapes into
     `PrLineView` by hand. The reshaping is checked by `tsc`, because nothing
     is cast: `toLineView` names every field it moves. */
  v_pr_line:         "LineRow",
  v_open_lines:      "LineRow",
  v_approval_queue:  "LineRow",
  v_pr_document:     "PrDocumentRow",
  v_approval_batch:  "ApprovalBatchView",
  v_round_eligible:  null,   // one column, counted
  /* Read by `accounting.coverageLines()` for five columns and shaped into
     `CoverageLine` by hand. Not a cast: `CoverageLine` also carries
     `description` and `payments`, which come from `v_pr_line` and
     `v_allocation` — naming it here would assert a shape this view does not
     have, which is the exact mistake this file exists to catch. */
  v_line_coverage:   null,

  /* ── core ────────────────────────────────────────────────────────────── */
  v_user_access:     "AccessRow",
  v_attachment:      "AttachmentRow",
  v_attachment_link: "LinkRow",
  v_activity_log_retention: "RetentionStatus",
  v_my_access:       null,   // shaped by hand into a Session
  v_activity_event:  null,
  v_activity_recap:  null,
  v_audit:           null,

  /* ── accounting ──────────────────────────────────────────────────────── */
  v_transaction:        "TransactionView",
  v_transaction_detail: "TransactionDetail",
  /* `suggestions` is a second read — `v_statement_suggestion`, keyed by line —
     stitched on before the result is returned. The intermediate cast is
     genuinely incomplete and the returned value is not. */
  v_statement_line:     { type: "StatementLineView", composed: ["suggestions"] },
  v_inbox_health:       "InboxHealth",
  /* `fromRows<unknown[]>` — the client hands these straight to a screen that
     reads them structurally, so there is no named contract to compare against.
     Each is a candidate for one; none is a cast that can lie today. */
  v_account_balance:      null,
  v_allocation:           null,
  v_bank_statement:       null,
  v_cash_cell:            null,
  v_cash_position:        null,
  v_cash_row:             null,
  v_cash_unplanned:       null,
  v_statement_suggestion: null,
  v_vendor_payment:       null,

  /* ── marketing ───────────────────────────────────────────────────────── */
  v_market:          "MarketView",
  v_property_agent:  "PropertyAgentView",
  v_referral:        "Referral",
  /* The nested halves are three more reads, stitched on after the flat rows
     arrive: PostgREST returns rows and the contract wants a tree. */
  v_property:        { type: "PropertyView", composed: ["market", "agents", "next_agent"] },
  /* `referrals` is a **count** on the view and an **array** on the contract,
     which this check compares by name and would not catch — so it is listed as
     composed, with `leads`, which the client fills from that same count.
     `from_properties` is a join `v_rep` cannot make: it lives in 0080 and
     `property_agents` arrives in 0081. */
  v_rep:             { type: "RepView", composed: ["market", "referrals", "leads", "from_properties"] },
  /* Mapped field by field into an anonymous row type, so `tsc` checks every
     one of them and there is no cast to lie. */
  v_followup_queue:  null,

  /* ── john lau ────────────────────────────────────────────────────────── */
  /* The catalogue, read into a private row shape and mapped field by field
     into `AssistantTool` — both languages come down and one is chosen in the
     client, because the list is a menu and a menu is rendering (0038). The
     mapping names every field it moves, so `tsc` checks it; what `tsc` cannot
     see, and this can, is whether the view still returns `blocked_reason_id`. */
  v_tool_catalogue: "CatalogueRow",
};

/** Views that do **not** satisfy their contract, with what is missing and why
 *  nobody has met it.
 *
 *  The same discipline as `src/lib/api/_pending.ts`: named, counted, and
 *  checked in both directions — a gap listed here that has been closed fails
 *  this script as loudly as a gap that is not listed. **It only ever shrinks.**
 *
 *  Each of these is a real cast that lies today. Each is also behind a route
 *  `LIVE_ROUTES` keeps dark for other reasons, which is the only thing making
 *  it a scheduled repair rather than an outage — and exactly the situation
 *  `v_po_detail` was in until `/procurement/po/[po]/print` went live ahead of
 *  it.
 */
const KNOWN_GAPS = {
  /* `0087` added `paying_balance`, `to_transfer` and `remaining_after_payment`
     to the view. `transfers` stays a known gap on purpose: it was never meant
     to live on this view — `getRoundView()` in `src/lib/api/procurement.ts`
     reads it from `round_transfers` directly, the same table the demo's
     `roundSummary()` filters in memory. A funded round still pays nobody
     (A10), so it is not decoration: without it the screen cannot tell funded
     from paid. */
  v_round_summary: ["transfers"],
  /* `/accounting/verifikasi` — also waiting on five. */
  v_inbox_health:  ["by_origin"],
};

/* ── the interfaces, from the contracts and from the client ───────────── */

/** Every `interface` in the repo's contract files and in the live client,
 *  as name → {fields, extends}. Parsed rather than compiled: `tsc` would give
 *  a perfect answer and require a program to be built for a question this
 *  shallow. The shapes here are plain — no generics, no mapped types — and the
 *  script fails loudly on a name it cannot resolve rather than guessing. */
function interfaces() {
  const files = [
    ...readdirSync(join(ROOT, "src/services"), { recursive: true })
      .filter((f) => String(f).endsWith("contracts.ts"))
      .map((f) => join(ROOT, "src/services", String(f))),
    ...readdirSync(API).filter((f) => f.endsWith(".ts")).map((f) => join(API, f)),
  ];

  const out = new Map();
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const DECL = /(?:export\s+)?interface\s+([A-Z]\w*)(?:\s+extends\s+([A-Z]\w*))?\s*\{/g;
    for (const m of src.matchAll(DECL)) {
      const body = balanced(src, src.indexOf("{", m.index + m[0].length - 1));
      if (body === null) continue;
      /* Only top-level members: a nested object literal's keys belong to that
         field, not to the interface. Two-space indent is this repo's shape. */
      const fields = [...body.matchAll(/^ {2}([a-z_]\w*)\??\s*:/gm)].map((f) => f[1]);
      out.set(m[1], { fields, parent: m[2] ?? null, file });
    }
  }
  return out;
}

/** The body of a `{ … }` starting at `open`, brace-matched, or null. */
function balanced(src, open) {
  if (src[open] !== "{") return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  return null;
}

function fieldsOf(name, all, seen = new Set()) {
  const decl = all.get(name);
  if (!decl) throw new Error(`no interface named ${name}`);
  if (seen.has(name)) return [];
  seen.add(name);
  return decl.parent
    ? [...decl.fields, ...fieldsOf(decl.parent, all, seen)]
    : decl.fields;
}

/* ── the views, from a database ───────────────────────────────────────── */

function columns() {
  const sql =
    "select table_name || ' ' || string_agg(column_name, ',') "
    + "from information_schema.columns where table_schema like 'ops\\_%' "
    + "group by table_name";
  let out;
  try {
    out = execFileSync("psql", ["-tAc", sql], {
      encoding: "utf8",
      env: { ...process.env, PGDATABASE: process.env.PGDATABASE ?? "postgres" },
    });
  } catch (e) {
    console.error(
      "could not read the schema. This check needs a database with the ladder"
      + "\napplied — `supabase/local/rebuild.sh` — and PGHOST/PGPORT/PGUSER set"
      + "\nthe way that script wants them.\n\n" + String(e.message).trim(),
    );
    process.exit(2);
  }
  const map = new Map();
  for (const line of out.trim().split("\n").filter(Boolean)) {
    const [name, cols] = line.split(" ");
    map.set(name, new Set(cols.split(",")));
  }
  return map;
}

/* ── what the client actually reads ───────────────────────────────────── */

function viewsRead() {
  const found = new Set();
  for (const file of readdirSync(API)) {
    if (!file.endsWith(".ts")) continue;
    const src = readFileSync(join(API, file), "utf8");
    for (const m of src.matchAll(/\.from\("(v_[a-z0-9_]+)"\)/g)) found.add(m[1]);
  }
  return found;
}

/* ── the check ────────────────────────────────────────────────────────── */

const all = interfaces();
const cols = columns();
const read = viewsRead();
const problems = [];
let checked = 0;

for (const view of [...read].sort()) {
  if (!(view in VIEW_CONTRACTS)) {
    problems.push(
      `  ${view}  — read by the client and not in VIEW_CONTRACTS.`
      + `\n      Name the interface its rows are cast into, or \`null\` if none.`,
    );
    continue;
  }
  const entry = VIEW_CONTRACTS[view];
  if (entry === null) continue;

  const contract = typeof entry === "string" ? entry : entry.type;
  /* Fields the client assembles after the read — a second query stitched on,
     or a sentence composed for a person to read. Stated per view, because
     "the client fills this in" is a claim somebody should have to write down. */
  const composed = typeof entry === "string" ? [] : (entry.composed ?? []);

  const have = cols.get(view);
  if (!have) {
    problems.push(`  ${view}  — no such view in the applied ladder.`);
    continue;
  }

  const missing = fieldsOf(contract, all)
    .filter((f) => !have.has(f) && !composed.includes(f));
  checked++;

  const known = KNOWN_GAPS[view] ?? [];
  const unexpected = missing.filter((f) => !known.includes(f));
  const closed = known.filter((f) => !missing.includes(f));

  if (unexpected.length) {
    problems.push(
      `  ${view} → ${contract}  — the view does not return: ${unexpected.join(", ")}`,
    );
  }
  if (closed.length) {
    problems.push(
      `  ${view}  — KNOWN_GAPS lists ${closed.join(", ")}, which the view now returns.`
      + `\n      Remove the line: this list only ever shrinks.`,
    );
  }
}

for (const view of Object.keys(KNOWN_GAPS)) {
  if (!read.has(view)) {
    problems.push(`  ${view}  — in KNOWN_GAPS but the client no longer reads it.`);
  }
}

if (problems.length) {
  console.error("a client casts a view into a contract the view does not satisfy.\n");
  console.error(problems.join("\n"));
  console.error(
    "\n`as` does not check — it instructs the compiler to stop checking, so this"
    + "\nfails on the first render that touches a missing field and not before."
    + "\nAdd the column to the view, or correct the contract. Do not widen the cast.",
  );
  process.exit(1);
}

const owed = Object.values(KNOWN_GAPS).reduce((n, f) => n + f.length, 0);
console.log(
  `view contracts                              ok (${checked} views`
  + (owed ? `, ${owed} known gaps` : "") + ")",
);
