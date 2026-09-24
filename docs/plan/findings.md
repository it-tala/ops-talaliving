# Findings — what building the workflow taught us

**This file is the deliverable of Phase 1, as much as the app is.**

The premise of the whole plan is that the business rules were never specified
up front, and that you find them by walking a working screen rather than by
designing a schema. This is where what we find gets written down. On D14 it
is consolidated, and `02-database.md` is rewritten against it.

Append one entry per session. Never edit an old entry — if a finding turns out
to be wrong, add a new entry saying so.

## Entry format

```
## D4 · 2026-09-13 · M4 PR list and create

**What the screen could not answer.**
…a question a real user asked that the data does not hold.

**What we assumed.**
…the default taken, and from where (06-decisions Qn, or new).

**What this implies for the schema.**
…the field, table, state or rule that turns out to be needed.

**What surprised us.**
…anything that contradicts a document or an assumption.
```

Keep entries short. Four lines each is fine. What matters is that they exist
and that nothing gets remembered only in a chat log.

---

<!-- entries below, newest last -->

## F1 · 2026-09-10 · before any code — the direction of evidence

**What the owner said.** Today: upload to Google Chat, then review on the
web. "That's really hard to trace between the existing data because it's
unordered." Instead: accounting attaches documents **directly from the PR, or
from the ledger**. A context-free upload is only for the case where there is
no PR — bought first, approved later. Google Chat becomes notification,
confirmation, and the interface for people outside web access. A reader bot
already exists; integration is later.

**Why "unordered" is the right word.** In the current model every document is
an orphan looking for a parent. The extraction guesses a vendor and an amount,
and a person reconstructs the linkage afterwards from name similarity and
amount proximity. Nothing records *who decided* that this receipt belongs to
that line — only that someone once picked it off a list. That is what makes
it untraceable, and it is not fixed by improving the guess.

**What this implies for the schema.**

- `core.attachment_links` moves from a convenience to **the main road**, and
  many-to-many stops being a workaround for unnameable files.
- Every link row must carry **who declared it and when**. That single column
  is the answer to the tracing problem.
- The review queue shrinks to `acct.evidence_inbox` and loses everything that
  existed to support the guess: slot naming, the capped candidate picker, the
  always-offer-the-selected-line rule, `duplicate_of_event`.
- It gains `origin` (`chat` | `web`) and a health view, because the size of
  the exception road is now a signal about the health of the normal one.
- A new resolution appears that the old model had no name for: **a retroactive
  PR line**. Purchase-first-approval-later has a legitimate shape, and giving
  it one keeps it out of the off-PR bucket.

**Two of the four questions dissolve; two are real.** "Which PR?" and "is this
supporting an existing transaction?" are answered by construction once the
person attaches from the parent. "One document, many transactions" and "one PR
line, many transactions" survive — the first becomes an explicit *also
covers…* action, the second was already the allocation model.

**What surprised us.** The AI's job gets smaller and safer. On the main road
the vendor, the expected amount and the parent are already known, so
extraction stops classifying and starts **verifying** — and a disagreement
becomes an advisory warning rather than something a human has to adjudicate
before anything can be recorded.

**Assumptions taken** (see `06-decisions.md`): the exception upload arrives
from Chat *and* the web and lands in the same inbox (Q-none, inferred — the
buyer without web access is precisely the exception case); Chat approvals
cover goods and receiving but not fund decisions (Q16); attaching a payment
proof to a line with no transaction offers to post one in the same panel
(Q14).


## F2 · 2026-09-11 · before any code — five answers, and what they moved

**Answered.** PR approval is the CEO's alone (Q2). The ledger is visible to
whoever has accounting-module access, and a user holds several accesses at
once (Q3). The IT gate is gone and there is no urgency field — every requested
line stays in the queue until it is approved, rejected or withdrawn (Q4).
Service lines complete on payment proof, and auto-complete stays manual for
now (Q9). The Vercel URL is enough (Q12).

**What moved beyond the questions asked.**

Q3 is not really about the ledger. "A user can have multiple access like
procurement + Accounting + HRD" replaces a single-role session with a set of
grants, which changes `src/store/session.tsx`, the topbar control, and how
`can()` resolves. The demo gets better for it: a grant picker demonstrates
permissions far more convincingly than a dropdown.

Q2 and Q3 together forced a split we had not made: **module access and
authority are different things**. Access says which screens open; authority
says which decisions you may take. Keeping them fused is exactly the bug
`john-lau` has — the confirm button showed for three roles and the bridge then
refused it from an environment variable the screen could not read. Four
authorities now: `approve_goods`, `approve_funds`, `post_ledger`,
`resolve_inbox`.

**A tension that resolved itself.** `john-lau` fused accounting and
procurement into one role on purpose, so nobody could approve a purchase
without seeing the cash. Composable grants would have reopened that — except
CEO-only approval takes purchase approval out of the module system entirely.
The safeguard is no longer needed in that shape.

**A word that needed a definition.** Q4 says a line stays until "removed or
approved". *Removed* had no meaning in the model, so it now has one: the
requester withdraws their own line before any decision, softly, with a name
and a timestamp. After a decision the only exit is a rejection (Q17).

**What surprised us.** Dropping urgency makes the queue simpler, not poorer.
A queue that shows every outstanding line at once needs no priority column —
the CEO is reading the whole list either way. The rekap's whole apparatus of
daily digests, 48-hour re-pings and 72-hour escalations existed to work around
a queue nobody could see in full.

**Three new questions**, each with a default so nothing blocks: who may
withdraw and until when (Q17), what happens when the CEO is away (Q18), and
whether `HOLD` survives without a digest to reappear in (Q19). Q18 is the one
worth a real answer before somebody is on a plane.

## F3 · 2026-09-11 · before any code — approval becomes a checkbox

**Answered.** No substitute for the CEO; a co-CEO grant can come later (Q18).
A line is removed because it is no longer needed — no deadline, nothing ages
out (Q17). **Approval is a checkbox: approved or not, no other status** (Q19).
Attaching a payment proof to a line with no transaction offers to post one
(Q14). Chat approvals cover goods and receiving, not money (Q16).

**Q19 is the structural one.** The line status ladder drops from nine values
to eight, and two of the old ones disappear together: `HELD` and `REJECTED`.

What is striking is that **nothing is lost**. `HELD` meant "seen, not decided,
comes back" — an unchecked line does exactly that, because the queue is now a
standing list of everything outstanding (D21). `REJECTED` meant "can never be
paid" — a removed line carries the same guarantee. The middle state existed
because the spreadsheet had *both* a checkbox and a status column, and someone
had to reconcile them. With one surface there is one fact.

**Where the nuance went.** Into the audit trail rather than the vocabulary.
Every toggle writes an append-only row with time, name, email and channel, so
"approved at 14:02, un-approved at 14:09, approved again at 16:30" is fully
legible — which the old three-value column could not express at all. The
screen gets simpler and the record gets richer, which is the right direction.

**A word that needed a guard.** "Removed because we no longer need it" is
open-ended by design, and mostly that is fine. But it cannot stay open-ended
once money has moved: a line with an allocation against it is not something
you stop needing, it is something you return, credit, or void. So removal is
refused past that point (D29) — the one place the owner's "no deadline" needs
a boundary that is not a deadline.

**One fork we defaulted rather than decided** (Q20): the checkbox is the
*status*, but the approved *amount* is a separate field. We kept the ability
to reduce it before checking, because that is how "approve two of the five"
works and it is what A8 exists to protect. Removing it would mean the CEO can
only accept in full or remove — a real business change, and one worth making
deliberately if that is what "no other status" was meant to imply.

**What surprised us.** Three of the five answers this round simplify the model
rather than extend it. The system being replaced accumulated states because
several surfaces each needed their own; with one surface, most of them turn
out to be the same two facts wearing different names.

## F4 · 2026-09-11 · M1 — what building the demo layer taught us

**What the screen could not answer.** Nothing yet; M1 has no product screens.
But writing `derive.ts` forced five rules to become precise that had been
prose, and precision found problems.

**1. A PR line that funds a PO deposit can never be COMPLETED on its own.**
It reaches PAID and stops. Delivery arrives against the purchase order, whose
two axes carry it — and folding that back into the PR line would be exactly
the collapse A1 forbids. The fixture originally pointed such a line at a
`po_line_id`, which made it complete as soon as that one PO row was delivered:
wrong, and only visible once the status was computed rather than described.

**2. Coverage has to exclude voided transactions, or a voided payment leaves
its line looking paid.** "A stamp pointing at nothing is not paid" turns out
to be a join condition, not a slogan.

**3. The coverage fallback is load-bearing.** An unapproved line has no
approved amount, so it must be measured against what was *asked* — otherwise
its approved total is zero, zero is covered, and the line reads as settled.
The old system has the same fallback and the same comment about it.

**4. PARTIAL sits above PAID in the ladder, deliberately.** A line that is
fully paid but only half received reads PARTIAL. Money is the less interesting
fact once goods are in question, and the reader needs the goods answer first.

**5. The fixtures caught a modelling truth by being wrong.** BNI 325 went
negative, because payroll leaves that account and nothing ever funded it. The
fix was not a bigger opening balance but the missing transfers — money has to
reach an account before it can leave. The recap treats a negative balance as a
row in the wrong place; here it was a row that did not exist.

**What surprised us.** The refusals were the easiest part to get right and the
most valuable to have. Six of them are now exercised on page load — approving
above what was requested, approving without the authority, removing a line
money has reached, over-allocating a transaction, replaying an idempotency
key, allocating to a PR line that does not exist — and each one is a rule from
`00-context.md` proved rather than asserted. Building them first means no
screen can be written optimistic.

**One concept with no Phase 2 equivalent:** `identity.actAs()`. It exists only
so permissions can be demonstrated, and it is a clean marker of exactly what
gets deleted when the demo layer goes.

**Still open.** Q20 — whether the CEO may still approve part of a line — is
implemented as "yes, the amount may be reduced before checking", because that
is the default we recorded. If the answer is no, `approveLine` loses its
`approved_amount` argument and the change is small; it gets larger once the
approval screen is built on D5.

## F5 · 2026-09-11 · English by default — and what counts as data

**Decided.** The interface is English. Multi-language is a later question.

**The line that had to be drawn.** Not everything Indonesian in the app is
*language*. Three kinds of string live here and only one of them translates:

| Kind | Example | Translated? |
|---|---|---|
| Interface copy | "Approve", "No data.", "Balance per account" | yes |
| Stored vocabulary | `BCA 271`, `RECCURING - UTILITIES`, `WAITING FOR APPROVAL`, `lembar`, `Receipt / Invoice / Nota` | **never** — translating a stored value does not translate it, it stops it matching |
| Real-world names | `KAYU JATI SORTIMEN A`, `CV SUMBER KAYU JATI`, `BABY ISLAND` | **never** — they are what the things are called |

Unit codes got a small compromise: the code stays `lembar`, and only the
human-facing name gained a gloss — "Lembar (sheet)". The dropdown still writes
`lembar` to the record.

**Number formatting turned out to be a money question, not a style one.** In
`en-US`, `Rp 18.900.000` reads as eighteen point nine — an English interface
with Indonesian digit grouping is the one combination that can be misread as a
number a thousand times smaller. So grouping follows the interface language,
set once as `LOCALE` in `src/lib/format.ts`. If the team would rather read
local grouping, that is one line.

**A related trap the switch exposed.** `formatIDRCompact` used `M` for
*miliar* — Indonesian for billion. In English `M` is million. Left alone, every
compact figure on every chart would have been wrong by a factor of a thousand,
silently, and would have looked plausible. Now it is K / M / B in the English
sense.

**Two bugs the screenshots caught that the build did not.** A `\u2019` escape
written into a JSX attribute renders literally, because a JSX attribute is not
a JavaScript string. And English compact labels are wider than the Indonesian
ones they replaced, so chart axis ticks wrapped onto two lines — fixed by
dropping the `Rp` prefix from axis ticks entirely, which is better anyway: the
card title already says what the axis measures.

**What surprised us.** Almost none of the work was in the components. The
design system carried the language change without a single layout change,
because nothing had been sized to a particular string. The work was in the
copy, and in deciding which strings were copy at all.

## F6 · 2026-09-11 · M2 — the access model, and a CSS trap

**What the screen could not answer, and had to.** The old model could not
express the owner's answer to Q3 at all: `src/store/session.tsx` held a single
`RoleId`, and a user holds several module grants. Replacing it was not a
refactor, it was the model changing shape.

**1. The permission catalogue contradicted D24 and nobody had noticed.**
`PERMISSION_CATALOG` carried `procurement.approve`, `accounting.post` and
`accounting.close` — decision verbs sitting inside module levels. Left there,
a procurement *admin* would gain `approve` for free, which is precisely the
fusion the authority split exists to prevent. They are gone from the catalogue
entirely: **module levels grant access verbs; authorities grant decisions.**
That sentence was already written in `02-database.md`; this is what it means
in code.

**2. The nav was already the real module list.** The module union had six
entries; the navigation has ten sections and `PERMISSION_CATALOG` had eleven
keys — and those eleven were exactly right. The screens had known the answer
since before any of this was designed. The union now matches, and TypeScript
keeps them together.

**3. Grant descriptions are derived, not written.** The picker explains what a
level unlocks by running `expandPermissions` and turning the verbs into
English, rather than describing it in prose beside the list. The first draft
did it in prose and immediately said "Create, edit, update" for Procurement —
one hand-written sentence, already disagreeing with itself. Small instance of
the rule that makes the whole plan work.

**4. The shell must wait for the session.** The original skeleton left a note
saying so and it was right: rendering a menu and then taking half of it away
looks broken. `AppLayout` shows a spinner until `ready`, which also removes any
hydration mismatch, since the server has no per-visitor state to render.

**5. A CSS trap worth remembering, because it will recur.** The grant picker
opened as a drawer that rendered its header and nothing else. The cause was not
the drawer: the topbar has `backdrop-blur-md`, and **a `backdrop-filter` makes
an element a containing block for `position: fixed` descendants**. The overlay
was being clipped to the header's 64px box instead of covering the viewport.
The fix is placement — the drawer is a sibling of `<header>`, never a child.
Any future overlay mounted from the topbar hits this.

**What surprised us.** Turning a module off does not merely hide a menu entry;
the section disappears, and there are **zero** `/accounting/*` links left in the
DOM. That was already the design (`nav.ts` filters before rendering), but
seeing it verified — count the links, get nought — is a different kind of
confidence from reading the component.

**Still open.** `no-access` currently offers "grant myself read access", which
no real system should. It is a demo affordance and goes with the demo layer;
in Phase 2 granting access is somebody else's decision and rightly not
self-serve.

## F7 · 2026-09-11 · M3 — curation, and a question merging asked

**1. Merging a vendor asked a schema question the plan had anticipated but not
answered.** `02-database.md` gave vendors a real foreign key (D4) and noted, in
passing, that history sometimes needs a `*_name_at_time` snapshot. Building the
merge is what made that concrete: with a real FK there are only two options,
and both cost something.

- *Repoint* every reference to the winner — and a transaction from August now
  says a name nobody used in August.
- *Keep* the absorbed row and mark it — history stays put, but the row lingers.

We keep the row (D41). It is the option that does not rewrite the past, and the
recap is explicit that vendor text in the ledger is never changed. What it
still cannot answer is **which spelling the document actually showed** — that
needs the snapshot column, and it is now a real question rather than a
footnote.

**2. Two prices had to be visibly two things.** `standard_price` and
`last_price` were already separate columns, and separate columns are invisible.
Side by side, each with its own caption — "Curated. Never written
automatically" against "CV SUMBER KAYU JATI, 2026-08-24" — the distinction
finally reads. The drawer then says out loud what a form would prefill and
why. That sentence is doing more work than the schema comment ever did.

**3. Half of the curation rule cannot be proved yet.** "Uncurated things are
shown and marked" is demonstrable here and verified: 12 vendors, 3 marked, and
a newly typed vendor arrives uncurated. "…and absent from dropdowns" needs a
dropdown, which arrives with the PR form at M4. Asserted here, proved there —
worth noting so nobody assumes it was checked.

**4. A vendor with no transactions is not missing data.** CV SUMBER KAYU JATI
shows zero spend, because its PR lines are approved and sitting in an open
payment round — nothing has been paid yet. Correct, and it looked like a bug
for a moment. A screen that reports money will keep producing this shape, and
"no money yet" and "no data" need to stay distinguishable.

**5. `<Loaded>` earned its place a milestone early.** Both screens needed to
answer "could not load" on the day they were written, and `useLoad` means
neither invented its own convention. The failure state shows the service's own
message plus its status and code — a refusal nobody can read is one that gets
reported as a mystery.

**What surprised us.** The most useful thing on either screen is a sentence,
not a control: the amber panel explaining *why* something is uncurated. The
rule was already in the code and in three documents; it had never been said to
the person looking at the row.

## F8 · 2026-09-11 · vendor contacts, and the question behind the fields

**What the owner asked for.** PIC name, PIC phone, address, a second bank
account, and a "common purchased item category" on the vendor record — stated
with its reason: *"ini untuk menjawab kalau kita butuh thinner belinya
dimana."*

**The reason did not match the shape of the request, and that mattered.** A
category field on the vendor answers "what does this vendor sell" — the
question you ask once you are already looking at the vendor. "We need thinner,
where do we buy it" starts from the *item* and has no vendor in hand. Answering
it with vendor fields means opening twelve records and reading each one.

So the fields exist, and two other things do:

1. **Search reaches past the vendor's own name** into the categories it
   supplies and the items we have actually bought from it. Typing `thinner` on
   the supplier list returns PT PROPAN RAYA ICC. Verified.
2. **The item drawer answers it directly** — "Where we buy this", listing each
   vendor with the contact, the phone as a tap-to-call link, the last price and
   the date. Thinner shows PROPAN, Bagus Nugroho, 0811-9004-2213, Rp 33,500 per
   ltr, 2026-09-04.

**A declared field and a derived one are not the same thing, so both exist.**
`supplied_categories` is what somebody typed on the record; it can go stale the
day a vendor stops carrying something. `bought_categories` is computed from
purchase history and cannot. The list shows the derived one where there is
history and falls back to the declared one where there is none — which is
exactly where a declaration earns its keep: **a vendor we have not ordered from
yet**. Neither alone would do.

**One derivation, asked from both ends.** `purchaseFacts()` gathers every
"we bought this from them" from requested lines and itemised ledger rows, and
both directions read from it. The vendor page and the catalogue page cannot
disagree about what was bought from whom, because there is nothing for them to
disagree with.

**What this implies for the schema.** `item_purchases` in the old system was
exactly this fact table and was described as best-effort. It is not
best-effort: it is the only thing that answers a sourcing question, and it
should be a first-class write on every posting rather than a backfill.

**A gap the screen now names instead of hiding.** Three vendors have no contact
at all, and one of them has money against it. The empty state says so —
"No contact on record — and we have bought from them 1 time(s)" — rather than
printing a dash. A blank field is a fact nobody acts on; a sentence is a task.

**What surprised us.** The second bank account turned out to need a sentence,
not just a row. Two accounts on a vendor is not extra detail, it is a trap —
so the drawer says which one to check and why. That line came from the request
itself; nobody would have written it from the schema.

## F9 · 2026-09-11 · a field with no way to fill it

**Caught by the owner, and worth recording rather than quietly fixing.** The
previous session added `pic_name`, `pic_phone`, `bank_account_secondary` and
`supplied_categories` to the vendor model, seeded them in the fixtures, and
wrote `updateVendorContact` in the service. There was no edit form. Every one
of those fields was readable and none of them was fillable — the demo looked
complete because the fixtures were already populated.

**Why the fixtures hid it.** Seeded data is the enemy of noticing a missing
write path: nine of twelve vendors already had a contact, so the screen looked
finished from every angle except the one that mattered. The three uncurated
vendors with no contact were the honest signal, and they read as "data we do
not have" rather than "data you cannot enter".

**The rule this suggests for the rest of Phase 1.** A milestone is not done
when the data is visible; it is done when the data is *reachable* — created,
edited and refused. From here, any field added to a model gets its write path
in the same change, or it does not get added.

**What the edit form itself taught us.** Empty has to mean "not on record",
not an empty string. The panel says so out loud — *leave anything blank that is
genuinely unknown* — because the alternative is somebody typing a dash or "n/a"
to fill the gap, and then no screen can ever ask the question again. The save
converts blanks to null deliberately.

**Verified**: UD SINAR ABADI starts with no contact, the form fills PIC, phone,
address and both accounts, the second-account warning appears once there are
two, and it survives a reload.

## F10 · 2026-09-11 · the audit question, answered by counting

**The owner asked** whether change/login/activity logging for the IT module
needs to be in the schema and API from the start, or can be skipped for now.

**Counted rather than guessed.** Of 23 mutating functions across the four
services, 21 already wrote an audit row in the same `apply()` as the change.
The two that did not were `identity.actAs` — the demo's sign-in, so precisely
the login event in question — and `syncRound`, a sweep that creates rows with
no person behind it. Both now do.

**Why that settles it.** The expensive half of auditing was never the table.
A table can be added by a migration on any Tuesday. The expensive half is the
*seam*: the guarantee that a business row cannot be written without its audit
row. Retrofitting that means finding every write path and hoping none was
missed — and the number of write paths only grows. That seam exists, and it is
in the definition of done, so it keeps existing.

**What genuinely can wait, and why it is cheap later:**

- **The IT screens.** They read the trail; they do not produce it.
- **Hash chaining.** A property of the table, addable in place.
- **Read-access logging** — who looked at a salary, who opened the ledger. This
  is the one with a real cost: it grows without bound, it fires on every
  request rather than every change, and its retention is a policy the owner has
  to set. It is middleware, not schema, so deferring it costs a middleware and
  a table later, not a rewrite.

**One thing we did not default** (Q22): how long the access log is kept and who
may read it. Every other open question in this plan carries a default so work
never blocks. This one does not, deliberately — a log of who read what is a
surveillance decision, and picking a default quietly is how such a decision
gets made by accident rather than chosen.

**What surprised us.** The answer was already in the code and nobody had asked
it that way. "Is auditing built?" is unanswerable in the abstract; "how many of
our writes are audited?" takes one script and returns 21 of 23.

## F11 · 2026-09-11 · M4 — the half of the curation rule that was owed

**Paid off from F7.** M3 could show that uncurated things are "shown and
marked" but not that they are "absent from dropdowns", because there was no
dropdown. There is now, and it was verified by counting options rather than by
looking:

- uncurated item `BAUT L 8MM` — **not offered**
- curated item `THINNER ND SUPER` — offered
- uncurated vendor `UD SINAR ABADI` — **not offered**
- a vendor name nobody has ever recorded — **still enterable**, and created
  uncurated on the spot

That last one needed a change to `Combobox`: an optional `onCreate`. Fields
that are genuinely closed lists — a unit, an account code — pass nothing and
stay closed. A vendor is not a closed list, and a form that refuses a name the
buyer is standing in front of would be lying about what a workshop does.

**A real bug the test caught by accident.** Adding a second line produced key
`l7`, not `l2`. The cause was a module-level counter feeding React keys: React
may run a `useState` initialiser for a render it then discards, so the count
depended on how many times React changed its mind. Harmless in this instance —
the keys were still unique — but identity should not rest on that, and two
module instances would hand out the same keys. Now a `useRef` scoped to the
form. **Module-scoped mutable state is not a safe source of identity**, and the
symptom is invisible until it isn't.

**A document has no honest single status.** The list shows *lines by status* as
a set of pills rather than one status column, because a request with one line
paid and one line still waiting cannot be summarised without lying about one of
them. The document is a container; the line is the unit that carries status,
approval and money. Every screen after this one inherits that shape.

**Choosing a catalogue item is a hint being offered, not a value being set.**
It fills description, unit, suggested price and last vendor — and every one
stays editable. The rule "a hint, not a price list" stops being a sentence in
`02-database.md` and becomes what the form does: the person standing in front
of the vendor knows more than the record does.

**What surprised us.** The most useful thing on the create page turned out to be
the sentence under the total — *a draft is in nobody's queue; submitting is
what puts these lines in front of the CEO*. Saving and asking are different
acts, and nothing in the data model was going to tell anyone that.

## F12 · 2026-09-11 · the request was redefined, and the model got smaller

**The owner restated what a purchase request is.** A collection of items
somebody wants to buy, possibly from several suppliers in one request. Items
not yet approved, not yet paid, not yet received must be visible on one page.
Rather than issuing requests document by document, treat the line as the thing
that persists and reappears at the next leadership meeting. And leadership must
be able to see which items are approved, and which were **paid without being
approved**.

**M4 had already walked into the same conclusion from the other direction**
(F11: "the document is a container; the line is the unit"). Building the screen
found the shape; the owner named it. That is the frontend-first bet paying out
in the way it was supposed to.

**The redefinition made the model smaller, not larger.** Three things went
away:

1. **`pr_documents.purpose` is gone.** A request holding items for three jobs
   cannot have one purpose without lying about two of them. Moved to the line,
   where it is the most useful field on the row — "2 pail lem putih" is a cost;
   "2 pail lem putih — laminating meja HOTEL UBUD" is a decision.
2. **Carry-forward will never be built.** The recap describes MOVE TO NEW PR,
   CARRY and RETRO — machinery for making an unpaid line reappear in a later
   document. It existed because the surface was a spreadsheet with one tab per
   submission, so a line that was not in this month's tab was invisible. On a
   line-first board a line simply stays until it is settled or removed. It
   reappears at the next meeting by never having left. An entire subsystem
   deleted by changing where the list starts.
3. **The meeting board arrived seven milestones early**, because once the board
   is line-first, the four states are just a grouping of what is already there.

**The state that mattered had no example.** "Paid, not approved" read zero,
because nothing in the fixtures had money against an unapproved line. A demo
whose most important corner is always empty teaches that the corner cannot
happen — and it is exactly what does happen. One seeded line (petty cash, bench
repair, bought the same afternoon) and the board now says what it is for.

**Two gaps the owner named, both real:** a draft could not be edited, and a
line waiting for payment could not receive its evidence. Both were "designed
and unreachable", the same shape as F9. The definition-of-done clause added
then would have caught them — it is now being applied to lines as well as
fields.

**A layout bug worth remembering.** `max-width` on a `<td>` is advisory under
auto table layout: the purpose text ran straight through the Vendor column.
The constraint has to sit on an element *inside* the cell. Fits exactly at
1280 now.

## F13 — "Why is the paid amount not the approved amount?" is a question about patterns, not events

The owner asked what the application should say when leadership sees that a
request for Rp 10.080.000 was paid as Rp 9.500.000: why, how much, whose
mistake, and what the balance is.

Three of those four the application can answer exactly. **How much** is
arithmetic it already had. **Why** is a sentence a human writes, and the app's
only job is to refuse to let the line close without one. **The balance** is
the same subtraction, stated in the direction that matters: money paid beyond
a yes is owed back, money not paid is either still owed or was never spent.

**Whose mistake it was, it cannot answer, and a field claiming to would be
believed.** No system can see from the outside whether Rp 225.000 was a typo,
a vendor raising a price, or somebody paying without looking. So the model
does not carry blame. It carries a closed list of seven kinds, so the kinds
can be counted — and counting is where the owner's real question gets
answered. One Rp 200.000 gap is noise. Twelve tagged *vendor price differed*
against one supplier is a supplier who quotes badly. Six tagged *entered
wrongly* by one person is a training problem. The application cannot judge one
event; it can make a pattern impossible to miss.

Two consequences fell out of building it:

1. **The explanation is also the settlement.** A shortfall explained as
   anything other than "paid in parts" is a decision that the line is done
   cheaper — which is the `line_settlements` row A12 already asked for. One
   act, not two, and no line sits at "Rp 580.000 still owed" forever because
   nobody knew where the button was.
2. **A COMPLETED line can still owe an answer.** The status ladder said the
   sandpaper line was finished: approved, paid, received. It had also paid
   Rp 225.000 more than was approved. The board now keeps such a line visible
   until somebody explains it — the ladder describes the goods, not the money.

**A process note, and a wasted twenty minutes.** The first browser check
showed no variances at all. Nothing was wrong with the code: a `next start`
from an earlier session still held port 3100 and was serving a build made
before the change. Checking `ps` before believing a screen costs five seconds;
believing it cost twenty minutes of reading correct code.

## F14 — the standing queue turns "paid, not approved" back into a decision

M5 is one screen and a checkbox, and the interesting part was what the queue
contained on the first render: **items somebody had already bought and paid
for, sitting in the CEO's approval list.** Nothing engineered that. The queue
is "every submitted line nobody has decided", and money reaching a line is not
a decision — so the bench-repair screws that were bought the same afternoon
are still waiting for a yes.

That is the difference between a flag and a queue. The requests board shows
*paid, not approved* as a red state, which is information. The approval queue
shows the same line as a **thing to decide**: approve it after the fact and
say so, or leave it unapproved and let it stay visible. Neither the old
spreadsheet nor a status column could offer that, because both treated "paid"
as the end of the story.

Three smaller things the build taught:

1. **Module access could not hide this screen.** Everyone in procurement holds
   `procurement.read`, and the queue is the CEO's alone — so `NavItem` gained
   an `authority` field (D60). The page stays readable without the controls,
   which is the honest version: the team can see what is waiting, they just
   cannot decide it.
2. **A checkbox that springs back reads as "it did not take".** The tick has
   to stay down while the write is in flight and only revert on a refusal.
   Half a second is long enough to make somebody click twice.
3. **`<input type="number">` cannot group thousands**, so the field reads
   `4275000` under a label that reads `Rp 4,275,000`. On the one screen whose
   entire job is reading amounts this is a real cost. Deliberately not fixed
   here: it is one component used by every money field in the app, and
   swapping it for a formatted text input is a change to make once, on
   purpose, not inside a milestone about approvals.

## F15 — the approval queue was a column, not a screen

M5 built a separate approval queue. The owner's answer, the same day: make it
one screen with the requests board.

He is right, and the reason is worth keeping. Approving is not a second
subject. It is one more thing that is true about a line — like what it is for,
what it cost, and whether it has been paid — and every one of those already
lives on the board. Two screens meant two lists that could disagree about what
is outstanding, and a CEO reading a list the requester could no longer see.

What that merge deleted: a page, a navigation entry, a `NavItem.authority`
field invented one milestone earlier to hide that page (D60, superseded within
hours), a second grouping of the same rows, and a "decided recently" section
that existed only because the queue could not show a decided line. The
un-approve control moved to the drawer, where the rest of the line's story
already was.

Two things the merged board needed that neither screen had:

1. **The bank balance.** Approving without knowing what is in BCA 271 is
   approving in the abstract. The useful number is not what was approved — it
   is *how much has to be put into the account before any of it can move*, so
   the board states the balance, the approved-and-unpaid total and the
   difference (D68).
2. **A money field you can read.** `<input type="number">` cannot group
   thousands: `4275000` under a label reading `Rp 4,275,000`. Noted as a rough
   edge in F14 and deliberately deferred; putting the amount on every row of
   the main board made it the first thing to fix. `MoneyInput` is now a text
   input that groups while you type.

## F16 — the approval was recording the wrong person, and no code was wrong

The owner described how a meeting actually runs: the web app is open on one
laptop, on whoever's account, and the CEO says yes out loud. Every approval
recorded that way carries the wrong name — not through a bug, but because the
application had no way of knowing that the person who spoke is not the person
who clicked.

**A trail that names the wrong person is worse than no trail**, because it
looks authoritative. And nothing inside the app can fix it: whatever the
screen asks, the answer arrives through a session belonging to somebody else.

So the yes leaves the room. The line is sent to the approver in Google Chat,
they answer from their own account, and the identity on the record comes from
Google's authentication of that person (D69). The metadata then reads
`chat · evin@talaliving.com · 14:00` — which is what happened.

Three details that make it more than a notification:

- **Asking and answering are different acts.** Anyone in procurement may ask;
  only the addressee may answer. Sending is chasing, answering is deciding.
- **The token identifies the request, never the person.** Identity comes from
  the signed webhook. A token carrying an identity would be a password that
  anybody who saw the card could replay.
- **An answer from the wrong account is refused**, and the demo screen exists
  largely to make that refusal visible: `answer from putri@… is not that
  person's decision`.

The route is already event-shaped: `procurement.approval.requested` goes to
the outbox, a worker turns it into a card, and the answer comes back through
one endpoint. Phase 2 changes the worker, not procurement.

## F17 — two bugs that only a second batch could reveal

Grouping the board and batching the chat card were the owner's asks. Building
them surfaced two defects that had been sitting in the demo layer since M1,
both invisible until a second row of the same kind existed.

**Timestamps were being sorted as text.** The fixtures carry `+08:00` — the
office is in WITA — and everything written while the app runs carries `Z`.
Compared as strings, `09:05:00+08:00` sorts *after* `06:45:00Z`, though it
happened three hours earlier. That mattered far beyond the chat list: "the
current decision is the latest row" is how approval, notes, variance
explanations and pending requests all work, so on any day where a fixture row
and a live row met, the screen would confidently show the older answer as the
current one. One `byTime` comparator, applied at every place a timestamp was
ordered.

**A token derived from a document number is not a token.** The batch token was
built from the batch number, so the second send of the day produced the same
token as a seeded one and answers landed on the wrong list. The fix is the
rule, not the patch: a token is a capability the card carries back, so it must
be random and unique. Deriving it from anything guessable would let somebody
who can count document numbers answer a list addressed to the CEO.

Neither bug was reachable with one batch in the data. Both appeared the moment
a second one existed — which is the argument for fixtures that contain two of
everything interesting, not one.

**And the reason the batch card earns its place.** A card per line asks the
approver to hold a running total in their head; by the fifteenth they have
stopped. The list states what a single line cannot: *asked for*, *approved so
far*, *has to be paid* — that last one being approved minus what already
reached those lines, because approving something already paid for commits no
new money. Beside it sits the BCA 271 balance, so "yes" and "we can afford
it" stop being the same click. The board answers the same question from the
other side: what is still to decide, and what the decisions already taken will
cost.

## F18 — the same list, read twice, is not the same screen

F15 recorded that the approval queue was a column, not a screen, and the two
boards became one. This is the correction to that correction, and both are
right — which is the finding.

**What was wrong with two screens** was that each held its own list of what is
outstanding, and two lists can disagree. That has not changed and is not
coming back.

**What was wrong with one screen** is subtler: a board carrying approval
controls asks everybody to read leadership's questions all day. The person
attaching a receipt does not care what is waiting for a decision; the person
in the meeting does not care which invoice is missing a photo. The controls
were not in the wrong place because approving is a different subject — it is
not — but because it is a different **moment**.

So the split is by question, not by data:

- **`/procurement/pr` — the working surface.** Asked for, corrected,
  documented, paid. One row per item, one table, and the whole story in the
  drawer.
- **`/procurement/meeting` — the room.** What is waiting for a decision and
  what it would cost; what is already approved and unpaid; the BCA 271
  balance; **the transfer needed before any of it can go out** — and what that
  transfer becomes if everything still waiting is approved today.

Both read `listOpenLines()`. Neither holds state the other cannot see.

**And a demo lesson repeated.** The transfer figure read "nothing needed",
because BCA 271 was seeded with more than the board could spend — the same
mistake as the "paid, not approved" tile that always read zero (F14). The
account is now seeded lean, as it really is: funded per payment round rather
than held full. The number the screen exists for is a number the screen
actually shows.

## F19 — a cap that assumed the wrong direction, and a total that assumed a quantity

Three small corrections from one round of use, each of the same shape: a rule
that was true of the common case and wrong about the rest.

**"Approval can only reduce" assumed the request was always the higher
number.** It usually is — but a vendor raises a price between the request and
the meeting, and a leader approving Rp 1.200.000 for something asked at
Rp 870.000 is deciding, not erring. The cap turned that decision into a 422.
Removed (D76): the field now says *Rp 330.000 more than asked* in words, and
the difference between requested and approved is reported the way every other
difference on the line is.

**The amount was always quantity × price.** For a service line — no quantity,
no unit price, just a figure the vendor quoted — that meant the price could
not be edited at all, and saving the line recomputed its amount from a missing
quantity and zeroed it. The edit form now carries all three fields: changing
quantity or price recomputes the amount, and typing the amount leaves them
alone and says which figure will be used (D75).

**Ticking wrote immediately.** On a board where a meeting reads down a list of
fifteen items, every tick was a committed approval, and the total only existed
after the fact. Now a tick picks; the count and the total sit in a bar above
the lists; one confirm commits — *Approve* if you hold the authority, *Send to
the approver on Chat* if you do not (D77). The same list, the same button
position, two different acts depending on who is in the chair — which is
exactly the distinction the chat route was built to keep.

And the small one: the "to pay" total moved from the foot of the table to the
top of it. It is the answer; the rows are the working.

## F20 — the round screen's whole job is one sentence the old system could not say

M6 needed almost no new machinery: `syncRound`, `approveRound`, `transferRound`
and `closeRound` were written in M1 against the contracts. What the screen adds
is the vocabulary, and one sentence in particular:

> **The money is in BCA 271, and nothing is paid yet.**

In the sheet, "transferred" and "paid" were the same tick. A funded round
therefore looked like a set of settled invoices, and the suppliers who had not
been paid out of it stayed invisible until they called. Here the round reaches
TRANSFERRED and every line under it still reads `WAITING FOR PAYMENT`, on the
same screen, three centimetres apart. That is the demonstration the milestone
asked for, and it costs one banner because the model already refused to
conflate them.

Three things the build settled:

1. **A transfer is two ledger legs, not one.** Out of the leadership account,
   into BCA 271. The screen writes both through accounting and then tells
   procurement the round is funded (D79) — composing two services rather than
   letting either reach into the other. The out leg goes first on purpose: if
   the second fails, the books show money that left and has not landed, which
   somebody can see and fix. The reverse would show money appearing from
   nowhere.
2. **Recording the transfer is `post_ledger`, not `approve_funds`** (D78). The
   funds decision was approving the round; writing down that the money moved
   is bookkeeping, and it is literally the same act as writing the legs.
3. **There can be two live rounds**, one being funded and one already
   collecting behind it. The first draft rendered `.find()` — the first
   non-closed round — and would have hidden whichever one somebody was waiting
   on. The fixtures had both from day one, which is the only reason it showed
   up before deployment.

Closing still answers with what it released: two items, Rp 13.430.000, back in
the queue rather than quietly settled.

## F21 — "transferred" was still a tick somebody typed

M6 shipped with the round's own claim unproved: `Rp 60.000.000 transferred ·
trx-26-09-10_004`, and behind it nothing. The owner caught it immediately, and
he is right — that is the sheet's mistake wearing a new font. Every other
claim in this system already has to show its evidence: no photo, no receipt;
no document, no ledger row. Funding a round was the one place left where a
number could assert itself.

So a round cannot reach TRANSFERRED without an attachment (D80). The refusal
is a 422 with a sentence rather than a red field: *a round is funded when
there is proof it was funded*.

**And the proof arrives two ways, because the money does** (D81):

1. **We transferred it.** Somebody in accounting makes the transfer and
   uploads the receipt on the round. Both ledger legs are written, the file is
   filed against the receiving row, and the round points at it.
2. **Leadership transferred it from a phone** and dropped the photo in the
   chat thread — which is what actually happens most weeks. The file lands in
   the review queue as *money coming in*, waits there, and is booked by
   whoever writes the ledger. The round then funds itself from a transaction
   that is already in the books rather than from a second, invented copy of
   the same money.

The second road needed one new field and no new concept: `money_direction` on
the inbox row. Everything in that queue used to be somebody who bought first —
money going OUT, matched to a purchase. A transfer proof is the other
direction and is resolved by a different person for a different reason, and
without the field the two would have sat in one undifferentiated pile.

What did **not** change is the rule underneath: the reading is a proposal,
never a posting. The chat upload carries an amount, and booking it is still a
person agreeing with that amount (A13). The demo makes that visible by showing
the extraction's confidence next to the button.

One consequence worth stating: the round now points at the same file the
ledger row does, not a copy. The proof lives on the transaction that received
the money, where it can be read on its own; the round keeps only the id, and
asks the documents service what the file is called.

## F22 — funding comes in instalments, and "unallocated" was crying wolf

Two corrections, both from the same instinct: a screen that is wrong about the
ordinary case teaches people to ignore it.

**A round is funded more than once.** The model held one
`transferred_amount` and one proof, so the second instalment had nowhere to go
— it would have overwritten the first or been left out of the books. Leadership
sends part on Monday and the rest when a client pays; that is the ordinary
week, not an exception. The record is now a list (D82): each instalment with
its own amount, its own ledger row and its own proof, and the round showing
what has come in against what is still short. The transfer form stays open
while a shortfall remains and defaults to exactly that shortfall, so the second
transfer is for the part the first one did not cover.

Two small guards came with it: one `source_ref` per instalment, so a retry of
the first transfer is still a duplicate while a genuine second transfer is
allowed; and the same `trx_no` cannot be counted twice against one round —
two instalments are two transactions, and one transaction counted twice is
money invented.

**The ledger flagged two thirds of a normal month.** The first draft marked
every OUT row with unspent allocation as "money pointing at nothing" — 24 of
34 rows, which included payroll, the electricity bill and the bank charges.
Nobody raises a purchase request for payroll. Flagged only on types that are
purchases (`is_purchase`, already in the type table), the count drops to 10 and
every one of them is a row worth asking about (D83). A flag that fires on the
normal case is worse than no flag, because it trains the reader to skip it.

**M8 itself was mostly assembly.** The ledger screen needed one new API shape
— the whole row in one call, lines and allocations included, because a drawer
that needs three calls renders in three stages — and one new derived field.
Everything else was already in the service: void with a reason, mark
completed, allocate against a request line validated at the seam, attach from
the row. The screen's own contribution is what it puts side by side: what the
money bought, what it settled, and what proves it, in one place, on the row
where somebody is already standing.

## F23 — the ledger was still letting a number exist on its own

Six corrections to M8, and five of them are the same correction: a row of
money has to carry what makes it checkable, at the moment it is written, not
afterwards.

**No document, no row** (D85). The screen could attach evidence to a row that
already existed, which means a row could exist without evidence — and the ones
that stay that way are exactly the ones somebody will ask about. Posting now
takes its documents with it: uploaded first, linked in the same act, refused
without at least one nota, transfer proof or photo. A delivery note and the PO
are welcome and are not enough; *supporting is not proof*.

**A purchase says what it bought** (D86). Quantity, unit price, vendor. An
amount alone cannot be compared to the last time we bought the same thing,
which is the only way a price is ever discovered to be wrong. Payroll and the
electricity bill are exempt, because they are not purchases and nobody raises
a request for them — the same `is_purchase` flag that fixed the flag that
cried wolf (F22).

**No "allocated"** (D88). The word came from the procurement side, where a
payment covers a request line, and on a ledger screen it read as a budget:
part of the money spent, part still available. It is all spent. What the row
actually needs to say is whether a purchase names a request at all — four
words instead of two numbers.

**Void goes behind a sentence** (D89). It was a button beside "mark completed",
one accidental click from a row somebody was reading. Hiding it entirely would
be worse: an action nobody can find gets done in the database instead. So it
is one deliberate step away — *Something wrong with this row?* — and the panel
behind it says what void is for before it says how.

**The trail needed to say what changed** (D84). Who and when were already
recorded on every mutation. The owner asked for anomaly and fraud detection,
and that question is never "who touched the ledger this month" — it is "what
happened to *this* row", asked while looking at it. So the audit entry now
carries the fields: amount before and after a void, the account, the vendor,
the documents that arrived with a posting. The trail is read in the drawer,
on the row, not in a screen nobody opens.

And one that is not a correction but a fact of the business: **there are five
accounts, not four**, and one of them is leadership's. JAGO joined the list;
BCA 064's balance is shown only to whoever holds `approve_funds`, and marked
*leadership only* rather than left blank — a blank where an account should be
reads as a bug, and people file bugs about rules.

## F24 — the code had the account; the browser did not

"JAGO belum kelihatan." It was in the fixtures, in the contract, in the build —
and absent from the screen, because the sandbox lives in `localStorage` and a
snapshot saved before the account existed quietly won.

`hydrate()` merged the saved state over the fixtures table by table
(`{...initialState(), ...saved}`), so any table present in the snapshot
replaced the new one wholesale. Every visitor who had ever clicked anything
was carrying an `accounts` array from before, and would keep carrying it
forever — the demo would drift further from the code with every change to
reference data.

The fix is not to bump a version by hand, which is a thing to forget. The
stored snapshot now carries a **signature** of the shape and the reference
data — table names, account codes, user emails, transaction types — and is
discarded when it no longer matches. Anything that changes those invalidates
it automatically.

And the reset says so: *"the fixtures changed since your last visit, so the
sandbox started over."* Silently losing somebody's demo edits makes the app
look broken; naming the reason makes it look updated.

The general lesson is bigger than the demo. **Any client-held copy of
server-shaped data needs a way to know it is stale.** In Phase 2 the same
class of bug is a cached response, a service worker, or a stale local
database — and the same answer applies: store what shape the data was, and
throw it away when the shape moves.

## F25 — the same road, built twice, had already drifted

M9's brief was "one component used twice, because it is the same road". By the
time it was written, both copies existed — one in the request line drawer, one
in the ledger drawer — and they had already diverged: the ledger's had the
duplicate-bytes warning, the line's had the payment-proof handoff into the
posting form. Neither difference was a decision. That is what copies do while
nobody is looking.

One `<EvidenceStrip>` now serves both, and building it forced two things that
neither copy had:

**One document, several records.** A single invoice covers three deliveries; a
transfer receipt pays two lines. The strip offers the plausible targets — the
sibling lines of the same submission, the lines a payment settled — and
attaches the *same file* to each, with every link recording who said so.
Uploading the photograph three times would leave three files that nobody can
tell apart in a year, which is what the old shared drive is full of.

**The money-to-document path, read from the other end.** A ledger row now
shows the documents that live on the request lines it paid for: the photo
taken at the workshop door is visible from the bank row that funded it,
without either record holding a copy. It is displayed as *through
pr-26-08-18_01-L01* and cannot be edited from that end — the document belongs
to the line, and the ledger row is only looking along the link.

**And the browse screen found its real job.** `/accounting/documents` was
specced as "browse by entity, month, type", which is a filing cabinet nobody
opens. The number that earns the screen is the other one: **six files attached
to nothing**. Those are the chat uploads that arrived and were never claimed —
already visible, already counted, and now findable in one place.

Camera capture is one attribute (`capture="environment"`) and its own button,
because on a phone the difference between "open the camera" and "browse a file
tree" is the difference between the photograph being taken and the paperwork
following later, which is where the unexplained rows come from.

## F26 — "does the inbox put rejected files in the ledger?" — no, and that is the point

The question came in as a guess at what M10 was for: files uploaded to chat,
rejected in the review queue, recorded in the ledger. Half right, and the half
that is wrong is the interesting one.

**Reject is the road that never reaches the ledger.** Five roads leave this
queue, and only three of them produce a ledger row:

- *make a transaction* — money left, nobody raised a request; the file becomes
  its evidence
- *retro request line* — the request nobody wrote, written after the fact, then
  paid and allocated (D95). It is written **unapproved on purpose**: the board
  then shows it as *paid, not approved*, which is what happened. Writing it
  pre-approved would launder an unauthorised purchase into an ordinary one.
- *link to a row* — the money was already booked and this is its missing proof

The other two are the opposite of a ledger row. *Note* says "this is not a
company transaction". *Reject* says "no money of ours moved here". Both demand
a sentence, both keep the file, and neither writes anything to the books
(D94) — because the question that arrives months later is not "where is that
photo" but "what did we decide about it".

Two things the build settled:

**The duplicate warning has to point somewhere.** `nota-sinar-abadi.jpg` looks
like `trx-26-09-03_001`, already in the ledger. Saying so is not enough: the
warning names the row and offers the *link* road, prefilled. Posting it again
would invent money, and the difference between a warning and a trap is whether
it tells you what to do instead.

**The extraction's vendor is offered, not assumed** (D96). The first version
left the field empty, and posting was refused for a missing vendor whose name
was on the screen two inches above. It is now pre-selected on an exact name
match only — a near-miss quietly picking the wrong supplier would be worse
than the empty field, and the posting is still a person agreeing with the
reading rather than the reading being believed (A13).

The weekly count sits at the top for a reason worth restating: **it measures
the main road, not this screen.** A queue that grows means people are going
around the front door.

## F27 — a hand-drawn screen found two real errors in the model

M11 came in as a picture rather than a paragraph: a vendor block with orders,
payments and deliveries in one place. Building it to match found two things
the model had wrong, both invisible until the numbers sat next to each other.

**An over-delivery was being counted as value received.** HADI GLASS shipped
47 sheets against an order of 45, and the journey said Rp 425.000 was billable
— for goods nobody had asked for. The sketch's own note is the rule: *the two
extra sheets are a small vendor credit, not applied to any order here.*
`value_received` is now capped at what was ordered, and the excess is priced,
named and shown apart (D98). Without the cap, any supplier could raise an
invoice by shipping more than the order.

**A draft PO was billing its deposit.** CV SUMBER KAYU JATI had a Rp 111 juta
order still in draft, and the screen offered Rp 33,3 juta as billable, because
the deposit was 30% of a contract that nobody had issued. A deposit is earned
*on issue* — that is what a deposit is (D99). One flag on the formula, and the
line now reads "still contracted, and nothing is billable until more arrives".

Neither error existed in the old sheet, because the old sheet could not
compute either number. That is the argument for building the screen the owner
drew rather than the one the schema suggested: the layout put contract, paid,
received and billable in the same eye-line, and two of them disagreed.

**The vendor is the unit** (D97). One transfer on 19 August closed three
orders — Rp 12.680.000 to one, Rp 850.000 to another, Rp 280.000 rounding off
a third. Read order by order, each looks like a payment that never completed.
Recorded as three allocations against one transaction, and displayed as one
payment row naming all three, both facts survive: the bank moved money once,
the vendor closed three orders.

And the smallest thing on the screen is the one that will be used most: each
delivery says whether its *tanda terima* is on file. Half the shipments in the
demo are missing one half of their evidence — which is exactly the state a
real month is in, and the first thing anybody will chase.

## F28 — below or beside: the wrong question, asked usefully

Asked directly whether the supplier's detail should appear *below* the list or
*beside* it. Both were tried against the thing being shown, and both lose to a
third answer.

Beside: the detail is three stacked tables — an order with six columns,
deliveries with seven facts each, payments naming what they apply to. Half the
width is roughly 700px on the laptops this is read on, so every one of them
becomes a horizontal scroll, and the list next to it is reduced to a vendor
name and one number, which is not enough to choose from.

Below: the block is about 1,200px tall for a supplier with one order. The list
scrolls off, so switching supplier means scrolling up, and the list's own
purpose — comparing suppliers — is gone the moment one is open.

So: **a page of its own** (D103). The list stays a list, the detail gets the
full width it needs, and the vendor gets a URL. That last one was not part of
the question and is probably the biggest of the three: *"kenapa HADI GLASS
masih ada tagihan?"* arrives in chat, and the answer to it should be a link.

The general shape of this: when both offered options are about *where to put
it*, the constraint being fought is usually **how much room it needs**, and a
third option that changes the room is worth a minute before answering.


## F29 — the demo was quietly teaching the wrong business

Building the liquidation report meant asking what "money in" is, and the
answer turned the screen around. There is no client money in this business's
accounts at all: projects are billed elsewhere, and what reaches the operating
accounts is the owner moving operating funds in. The demo had a row saying
*"Client payment, HOTEL UBUD instalment 2"* — invented in an early fixture,
never questioned, and it would have shaped a schema.

Which is the finding. **A fixture is a claim about the business**, and one
nobody has read aloud can survive for weeks. The catch was not a bug report;
it was a sentence in passing while a report was being specified.

The report that came out of it is per transfer, not per month, because that is
the shape of the question — *sudah transfer 100 juta, kok sudah habis?* And
the demo answers it plainly: of seven transfers, three were spent through
before the next one arrived, one of them in a single day, and two went on
spending Rp 2,7 juta and Rp 16,3 juta past what was sent.

Two things the data cannot do, both for Phase 2:

- **Nothing marks a transfer as internal.** The pair — money leaving BCA 064,
  money arriving in BCA 271 — is two independent rows with the same amount on
  the same day. The screen matches them to name the source, and a match is not
  a fact. A `transfer_group_id` settles it.
- **No lineage between money in and money out.** Which is fine, and the report
  says so rather than inventing FIFO: it measures spending in the window
  against the transfer, and calls the excess what it is.

And one hole worth naming: an unclassified transaction type was skipping the
*did anybody decide this?* check entirely, because the flag read
`is_purchase ?? false`. Unknown types are normal here (Q10 keeps `EJO` as-is),
so the default was an exemption nobody asked for — Rp 2,48 juta of PACKING sat
outside the check. Now unknown means expected (D107).

## F30 — the plan cannot hold the obligations we already know about

The payment calendar works, and the first thing it printed was uncomfortable:
on the estimates the business itself supplied, the money runs out in **December
2026**, Rp 21 juta short, and every month after that is worse. Rp 150 juta in,
about Rp 173 juta out. That is the whole point of the screen — nobody could
see it before, because the bills lived in one person's head and the ledger
only looks backwards.

But it holds less than it should, and the reason is a schema gap.

**`po_schedule` has no expected date.** Its terms fire on an event —
`on_issue`, `on_delivery` — which is correct as a *rule* and useless as a
*date*. Of eight terms in the demo, exactly one carries a real date. So Rp
156.892.000 of supplier obligations cannot be placed in any month, and the
calendar states that under the verdict rather than spreading it evenly to make
the chart tidy. Phase 2 adds `expected_date` beside the rule: what we think
lands when, distinct from what makes it due.

Two smaller things the build settled:

**A part-paid bill is not a finished bill.** The first version of the forecast
counted only rows that had not been paid at all this month, so payroll — half
paid on the 9th — fell out of September entirely and the month looked Rp 17
juta cheaper than it is. Now the current month carries `planned − actual`,
floored at zero. The general form: *partly done* is a state, and code that
branches on *done / not done* will get it wrong in whichever direction is
worse.

**Category matching is a guess and has to look like one.** The plan finds
actuals by transaction type, which is right often enough to be useful and
wrong often enough to be dangerous. So a matched figure shows as `≈ Rp 8,5 M`,
a linked one shows plainly, and one ledger row can only ever be claimed by one
line (D110). Two lines on `RECCURING - PAYROLL` would have shown the same Rp
61 juta twice, in a number somebody was about to make a decision on.

## F31 — counting the paydays moved the year's failure forward a month

The calendar was built on one figure per line per month. Payroll went in as
Rp 120 juta on the 25th, and at month level that is harmless — the total is
the total.

It was not harmless. **Payroll goes out every Friday**, so a month with five
Fridays costs Rp 150 juta, not Rp 120 juta. Four of the next twelve months
have five. Adding that, plus two bills that happen once and were previously
impossible to write down at all, moved the month the money runs out from
**December to November** — and November is close enough that the answer
changes from *plan for it* to *do something now*.

The general shape: **a simplification that is correct at one altitude can be
wrong at another, and the way you find out is by trying to draw the lower
one.** Nothing was wrong with "one component per month" as a budget. It only
became a lie when somebody asked to see a month day by day.

So a line now has three shapes (D113), and `amount` is **per occurrence**
rather than per month:

- **weekly** — payroll. Four or five runs, counted rather than assumed.
- **monthly** — the electricity bill, the same day every month.
- **once** — certain, but only then: settling a vendor in October, paying the
  card off in November instead of carrying it. Written as a monthly line these
  would have been planned for in twelve months instead of one.

The one-off shape forced a rule to bend, correctly. D110 said two lines may
not claim one ledger category. But *pelunasan kartu kredit* shares `CREDIT
CARD` with the monthly card bill by its nature. So the rule is now about
**standing** lines only: claims resolve most-specific-first — a dated one-off,
then a line naming a vendor, then a plain category — and a ledger row is still
only ever claimed once.

And what the day view was built for showed up immediately. December's month
figure says it ends Rp 89,7 juta down. The day view says it **breaks on the
18th**, five days before that number, on a payroll run. Same month, two
different problems: one is *the month is too expensive*, the other is *the
money is in the wrong order*. Only the second one is fixed by moving a
transfer.

## F32 — the landing page was the last place that could lie

M13 was meant to be polish: phone widths, empty states, a guided walk. The
phone audit came back clean on every screen — no horizontal scroll at 390px,
drawers already full-screen with their action bar pinned — which was a relief
and not a finding.

The finding was on the page nobody had looked at since D1. The dashboard was
still the shell's sample page: invented sales orders for customers that do not
exist, a timber-yield chart for a business that has no timber yield **in this
system**, and a production trend in rupiah that came from nowhere. Every other
screen had been rebuilt on real derivations. That one had not, and it is the
first thing anybody sees — including anybody being walked through the demo.

The general shape: **the pages nobody argues about are the pages nobody
checks.** Every screen in this app got attention because somebody had a
question it could not answer. The dashboard was never wrong about anything,
because nobody ever asked it anything.

Rebuilt on the same store as the rest (D118), it now says: cash today, the
month the money runs out, what waits on a decision, what suppliers could
invoice, the twelve-month cash line, what falls due next, and the last rows
out. Its first sentence is *nothing on this page is invented* — which was
worth writing down precisely because it had not been true.

One small thing the tour found on its way past: the walk's **Next** button
collided with the ledger's own pagination **Next**. Two controls with the same
name on one screen is a real defect for anybody reading by keyboard or screen
reader, not a test artifact. Renamed to *Next step* / *Previous step*.

---

## D14 — what thirty-two findings add up to

Read end to end, the findings sort into four kinds, and the proportions are
the argument for having built the frontend first.

**Six were about the business, not the software.** An approval attributed to
whoever opened the laptop (F16). Over-delivery counted as value received
(F27). A deposit billed on an order nobody had sent (F27). A fixture claiming
client money in a business funded by its owner (F29). Payroll written as
monthly when it is weekly, hiding four runs a year (F31). Rp 156,9 juta of
obligations with no date on them (F30). None of these was a bug. Every one of
them would have been a migration.

**Nine were rules nobody had written down** until a screen had to display
something: what makes a line PAID, what a round marked TRANSFERRED does and
does not mean, when a variance needs an explanation, which document proves
what, what happens to a rejected file.

**Eleven were ordinary defects** — a cap in the wrong direction, timestamps
sorted as text, a stale snapshot beating the fixtures, two copies of one
component drifting apart. Cheap here, expensive after a migration.

**Six were about how the work is read** rather than what it does: a list read
twice is not the same screen (F18), below-or-beside was the wrong question
(F28), the pages nobody argues about are the pages nobody checks (F32).

### The three that would have hurt most

1. **F29 — the business model in a fixture.** A demo row said *"client
   payment"*. This business receives no client money into these accounts; it
   is funded by its owner. A schema built on the other assumption is wrong at
   the root, and it survived three weeks because nobody read the fixture
   aloud.
2. **F16 — the approval identity.** Every approval was being attributed to the
   wrong person, and no line of code was wrong. Only a real meeting, on a real
   laptop that was not the CEO's, could produce it.
3. **F27 — two errors found by a hand-drawn picture.** The owner sketched a
   screen; building the sketch exposed that value-received and billable-now
   were both computed wrongly. The drawing was the specification and the test
   at once.

### The method, stated once

Build the screen that has to show a number somebody can check against
reality. The purchase tracker and the payment calendar produced four of the
six business findings; the screens that mostly list and filter produced almost
none. **A screen that cannot be wrong cannot teach you anything.**

## F33 — three questions about one screen, and a self-test stuck in the past

The owner read the meeting board and asked three things. All three were right,
and the third one found a defect nobody was looking for.

**"An item already paid should not count toward *to pay if this goes
through*."** It was counting. The board's picked-total summed what each line
asked for, and some picked lines are *paid, not approved* — bought first,
approved later. Approving those commits no new money. The fix is one rule:
the total counts `amount − already paid`, floored at zero. But the approval
figure is still the real figure for the decision, so both are shown when they
differ, with the already-paid part named (D124).

**"What is the difference between APPROVED *Approved, not paid* and WAITING
FOR PAYMENT *Approved, not paid*? Aren't they the same?"** For the decision in
the room — yes, identical. The ladder separates them by whether the line sits
in a funding round that has been approved or transferred: *approved* versus
*approved and the cash is already in the paying account*. A real distinction,
and one the screen was not showing, so it printed two different words for what
read as one meaning. Fixed by saying the thing that differs — *waiting on
funding* or *cash is in the account* — rather than repeating the caption
(D123).

Worth noting what building that fix exposed: the first attempt showed *"in
round X"* versus *"not in a payment round"*, which was also wrong. Every line
in the list was in a round. Only looking at the running screen showed that the
difference is the round's **state**, not its existence.

**"What does *worth knowing before the yes, rather than on Friday* mean?"**
It meant: if you approve everything still waiting, the transfer needed goes up
to X, and it is better to see that while deciding than to have the person
making the payments discover it days later. "On Friday" assumed a weekly
payment run this business has never described. The sentence now says the thing
instead of gesturing at it.

### And the defect nobody asked about

The demo's own refusal probes — the page whose whole point is *proof that the
refusals are real* — led with:

> A8 — approving above the amount requested · expect `422
> approved_above_requested`

**That rule was deleted in D76**, because prices move between the request and
the meeting. The probe had been failing ever since, on a page nobody opens
unless they are already suspicious.

A self-test that asserts a deleted rule is worse than no test: it produces a
red row that everybody learns to ignore, and it occupies the slot where a live
rule's test should be. The slot now holds the rule that replaced it — a
request with no document behind it is refused (D125) — and it passes, with the
five probes beside it.

**The general shape: a test is a claim with an expiry date.** When a decision
is reversed, the thing asserting the old decision has to be found and changed
in the same act, or it becomes furniture.

## F34 — a status that promised something the system cannot deliver

One day after the meeting board was corrected to explain the difference
between `APPROVED` and `WAITING FOR PAYMENT`, the owner removed the
difference — and gave a reason that was better than the fix:

> *uang yang sudah dianggarkan bisa jadi dipakai untuk item approval yang baru,
> sehingga item approved lama tidak ada anggarannya jadi nominal uangnya harus
> diajukan kembali*

**Cash is fungible.** Money transferred into the paying account for last
week's approvals is spent by whichever payment is actually made first. So an
approval from last week can find its funding gone — spent on something
approved today — and the amount has to be asked for again.

Which makes `WAITING FOR PAYMENT` a lie in a single word. It meant *approved,
and the cash for it is in the account*, and the cash was never **for** it. The
ladder is now seven values, and approved-and-unpaid is one of them.

What is worth keeping is the shape of the error. The status was not invented
here — it is the running system's own vocabulary, carried over verbatim under
a standing rule not to tidy the business's words. That rule is right, and it
does not extend to a word that encodes a claim about money that is not true.
**Carrying vocabulary faithfully is not the same as carrying a model
faithfully**, and the difference only shows up when somebody asks what a word
promises.

The correction that preceded it is instructive too. Asked *"aren't these the
same?"*, the honest answer was "for the decision in the room, yes" — and the
fix made the screen explain the distinction more clearly. A better answer
would have been to ask what the distinction was *for*, which is the question
the owner answered a day later. **Explaining a distinction is not the same as
justifying it.**

So the board now states the thing the status used to hide: Rp 15.771.000 of
what is already approved has no money behind it, nothing is reserved, and an
older approval can lose its funding to a newer one and have to be asked for
again.

## F35 — an instruction is said once, and only a column catches it

The instruction field existed from D64, and it was reachable in two places:
the line drawer on the requests board, and the approver's chat card. Neither
is where an instruction is actually produced. It is produced in the room,
out loud, while the item is on the screen being argued about — *"only if they
deliver before the 20th"* — and by the time anybody has opened a drawer to
record it, the meeting has moved to the next item.

So it needed to be a column, which the owner asked for in one line. What
building it clarified is the attribution question underneath.

An instruction is leadership's word (D64) and only an approver may record one.
But the laptop in the room is usually a staffer's — the same fact that
produced F16, where approvals were being attributed to whoever opened the
session. If a staffer types what the CEO just said, whose instruction is it?

Three answers, and only one of them is honest:

- **record it as leadership's** — the same lie F16 was about, in a smaller font
- **refuse it** — the instruction is lost, which is the problem we started with
- **carry it as the meeting's words, and let the approver make it theirs** —
  it travels with the question, prefills their instruction field, and becomes
  an instruction the moment they send it back, from a field they can edit

The third one is built (D127). A `meeting_note` on the request is not a
`LineNote`: one is context attached to a question, the other is an instruction
attached to a decision, and keeping them separate is what lets a staffer type
without anybody's name ending up on words they did not choose.

The small print worth keeping: the instruction used to be rendered inside the
item column as well. With a column of its own, that copy became a duplicate —
the same text twice on one row, which reads as two instructions. Removed. A
new column is not additive; it takes ownership of the thing it shows.

## F36 — the PO module was the last placeholder, and the terms were the reason to build it

`/procurement/po` had been an eleven-line placeholder since D1, through a
fortnight in which the tracker, the calendar and the liquidation report were
all built. It survived because the tracker answers most of the same question
from the other end — *what do we owe HADI GLASS* rather than *what did we
agree on po-26-08-14_01* — and one of those two is enough to get through a
week.

What only the order-first view has is the **schedule**, and that is where the
finding is. A payment term is not a bill. It is a **trigger plus a share**:
30% on issue, the rest on delivery. Which means a term has two independent
questions — has the trigger fired, and has the money that reached this order
already covered the terms before it — and the second one is a guard nobody
had written down:

> **po-26-09-02_01-M02 · PROGRESS · goods have started arriving ·
> BLOCKED — po-26-09-02_01-M01 has not been paid**

An overhaul delivered, the progress payment's trigger fired, and the 50%
deposit never sent. Without the ordering rule, that order reads as *Rp 14,5
juta payable* and somebody pays the wrong half. With it, Rp 7.250.000 is
payable and the rest says why it is not.

The ordering itself is forced rather than chosen: **nothing in a bank transfer
says which term it was for.** Oldest-first is the only defensible reading, and
writing that down is more useful than the code implementing it.

Two smaller things the build settled:

**Amendment is supersession, and receipts have to follow the live line.** The
first version left a delivery pointing at the superseded row, so amending a
line made the goods that had arrived against it disappear from the order. The
fix is one line; the lesson is that supersession is not finished when the new
row exists — everything that pointed at the old one has to be told.

**A close that refuses has to say what it is refusing about.** Listing *Rp
14,5 juta unpaid · nothing filed against it* and then offering to close it
anyway with a written reason is the shape that works, because real orders end
untidily and a rule with no exit gets worked around outside the system.

And one regression, caught by the owner within a day of shipping it: the new
instruction column on the meeting board opened the line drawer on the first
keystroke, because the row's click handler was still underneath. **A control
placed inside a clickable row inherits the row's job unless it is told not
to** — the same fix already existed twenty lines below, on the cell holding
the quantity and amount inputs, which is exactly the kind of precedent worth
reading before adding the next cell.

## F37 — a rule that was right about evidence and wrong about time

D101 required both halves before a delivery could be recorded: the photograph
of the goods, and the signed tanda terima. The reasoning held — they answer
different questions, and a dispute three weeks later needs both.

Then the owner said what actually happens:

> *item yang dikirim dari luar biasanya datang di luar jam kerja jadi mereka
> harus lapor, sementara tanda terimanya bisa menyusul*

The truck comes at 23:40. The rule does not produce a tanda terima at 23:40;
it produces **nothing recorded at all**, and the arrival is reconstructed from
memory the next afternoon. A rule that cannot be followed at the moment it
applies is not a strict rule, it is an absent one.

So receiving became two acts (D131):

- **Report** — anyone who was there, with a photograph. Recorded, numbered,
  visible on the order and in the tracker.
- **Confirm** — procurement, with the signed tanda terima, the QC name, and
  the count somebody did in daylight.

And the part that keeps the original rule intact: **only a confirmed receipt
counts as value received.** The 80 sheets that arrived last night are on the
screen and in no total. The order still says *150 of 400 received*, because
150 is what has been acknowledged in writing.

Two things worth keeping from how this was answered.

**The question I asked was not the question that mattered.** Q28 asked who is
accountable if the person filing cannot open a PO, and assumed the answer
needed a Chat bot and a new inbox. The real answer was that accountability was
never in doubt — there *is* a procurement team with access — and the only
problem was the clock. The feature that looked necessary (a chat road into the
exception inbox) turned out to be optional; the thing that mattered was
splitting one act into two.

**The audit row carries how long the paper took.** `hours_after_arrival` on
the confirmation is the only way to tell the difference between this road
working as intended and this road being used to skip the paperwork
permanently. A concession without a measure becomes a habit.

## F38 — the order had no way to become a promise

The PO module could create an order, amend it, pay it and close it. What it
could not do was the thing an order is *for*: tell a supplier.

Three gaps, and the owner named all three in one sentence — confirmation, a
PDF for WhatsApp, an expected delivery date.

**Confirmation.** A purchase request is a request to spend. A purchase order
is a promise made to a supplier in the company's name. The demo had treated
them as the same decision, so `createPo` issued by default (D100) and nobody
in leadership ever saw the order the vendor would receive. Now: DRAFT → *asked
leadership* → *confirmed* → issued, with issuing refused until the confirmation
exists (D132). *Waiting on leadership* is its own visible state, because that
is where orders actually stall.

**The PDF.** The temptation was a PDF library. What that buys is a second
description of the same order, free to drift from the first — and the vendor's
copy is exactly the one you cannot afford to have disagree. So the vendor's
document is the app's own print view, A4, printed to PDF by the browser, and
sent through a prefilled `wa.me` link (D133). One renderer.

Building it exposed something wider: printing any page carried the sidebar and
the topbar. Fixed in the shell rather than on this page, because the next
thing somebody prints will be a ledger extract for an auditor.

**The date.** Without a promised date, nothing is late — it is merely absent,
and *absent* does not start a conversation with a supplier. With it, the demo
immediately said something nobody had asked it: **po-26-08-14_01 is 3 days
late.** That is a fact that existed all week and had nowhere to appear.

The general lesson in all three: **a module is finished when it can do the
thing outside the building.** Create, amend, pay and close are all internal.
An order that never reaches a vendor is a spreadsheet with better manners.

## F39 — payroll is where every small carelessness becomes somebody's wages

HRD was built in one pass: employees, biometric attendance, overtime, payroll,
payslips. Three things it taught, and a bug that is worth more than the three.

**The machine produces times, not days.** A fingerprint reader records
whatever it records. In a fortnight of demo data — shaped like a real export,
not a clean one — two people have no check-out and one day is missing
entirely. The tempting fix is to assume: *nobody works past six, call it
17:00*. That assumption pays for a day nobody can account for, and it does it
silently, every time. So a day with one stamp is **open**, worth nothing, and
closed only by a person who types the time and says why (D137).

**The machine cannot tell work from presence.** It knows somebody was in the
building at 19:40. It does not know whether they were finishing a table or
waiting for a lift. Deriving overtime from attendance would pay for all three,
so overtime is claimed and approved, and only approved hours reach a payslip
(D138).

**A payroll over open days is a number that looks exact and is not** — and the
people it is wrong about are the ones paid by the day, who are least able to
argue. So approving a run is refused while any day in its period is open, with
the count and a link to clear them (D139).

### The bug

The period walk built each date with `d.toISOString().slice(0, 10)`. That
converts back through UTC, and 2026-09-07 00:00 in WITA is 2026-09-06 16:00Z —
so every day came out one early and **the last day of every period was
silently dropped**.

On a monthly salary nobody would ever notice. On a daily rate it is a day's
wages, every run, for every workshop employee. It surfaced only because one
line said *4 day(s)* where the fixture plainly had five.

This is the same fault as F17, where timestamps were compared as text: **an
office day is not a UTC day, and any code that goes near a timezone to produce
a date will eventually be wrong by one.** The fix is to never go near one —
walk the dates as strings.

Which is the general lesson worth keeping from this module. Everywhere else in
this system a wrong number is an argument. Here it is somebody's pay, they
find out by counting their money, and they are the person with the least power
to get it corrected. Payroll earns its refusals.

### And what is deliberately not built

BPJS Kesehatan, BPJS Ketenagakerjaan and PPh 21 all apply and none has been
described to us. Payroll computes **gross** and the payslip says so in
Indonesian (D140). A deductions block full of zeroes would read as *nothing
was deducted*; a payslip that states it computes bruto reads as *this part is
not done yet*. Q30–Q32 hold the questions — which deductions, what an overtime
hour is worth here, and whether payroll is weekly, monthly or both.

---

## F40 — the file the machine actually produces

The owner sent the real export: *ALL DAILY WORKER PAYROLL — WEEK 1 SEPTEMBER
(31–04 SEPTEMBER 2026) — PASTE HERE BIOMETRIC ORIGIN DATA*. Eight columns,
981 rows, 35 people, eight working dates. It is worth reading before designing
anything, because it disagrees with every assumption a clean model makes.

### What is in it

```
Department,Name,No.,Date/Time,Location ID,ID Number,VerifyCode,CardNo
OUR COMPANY,Sumiati,6,29/08/2026 07:54:23,104,,FACE,
```

One row per **tap**. Not a check-in and a check-out — a tap. The person is the
machine's own `No.` (6 to 138, with gaps); the name is whatever was typed into
the device; `VerifyCode` is `FACE` or `FP` depending on which reader worked
that morning; `Date/Time` is local, `DD/MM/YYYY`, with the hour sometimes
unpadded (`01/09/2026 7:26:40`).

### What is wrong with it, counted

| | |
|---|---|
| Taps | 981 |
| People | 35 |
| Person-days | 227 |
| Double taps inside two minutes | 29 |
| Days with exactly 4 or 6 taps (a clean day) | 179 |
| **Days with 1, 2, 3, 5 or 7 taps** | **48** |

The distribution: 8 days with one tap, 2 with two, 26 with three, 138 with
four, 10 with five, 41 with six, 2 with seven.

Read the awkward ones directly:

- **Karjo, 31/08**: 07:21, 12:02, 12:33, **12:48**, 17:32, 17:58, 19:59. Six
  of those are a long day with lembur. The seventh is 12:48, twenty-six
  minutes after he came back from lunch, and nothing in the file says why.
- **Roni, 30/08**: 07:29, 12:04, 16:00. He went to lunch and came back without
  scanning, or he left at noon and the 16:00 is somebody else's finger.
- **Trisno, 30/08**: 07:43, **07:54**, 12:07, 13:02, 16:01. A second tap eleven
  minutes after the first — too far apart to be a finger that did not take.

### What this decided

**One row per tap, and the day is computed** (D141). A schema with
`check_in`/`check_out` columns cannot hold this file without discarding rows,
and the rows it discards are exactly the ones somebody needs to look at. The
six slots — *masuk, istirahat keluar, istirahat masuk, pulang, lembur mulai,
lembur selesai* — are a reading, applied on read, and a wrong reading is then
a one-line change rather than a re-import.

**Two minutes is the dedupe window.** Long enough to swallow a finger that did
not take on the first try (29 of those), short enough that Trisno's eleven
minutes stays visible as the unexplained event it is.

**Anything the reading cannot place leaves the day in `review`.** Not a
best guess, not an average of the others — 48 of 227 days, each one somebody's
wages. The timesheet exists to show which they are, and a payroll run over the
period is refused while any remain (D139).

**A number nobody is registered under is reported, never created** (D143). The
file's `No.` is the machine's numbering; the names in it are inconsistent
spellings typed at a keypad. Importing a stranger would put somebody on a
payroll who was never hired.

### The thing the file taught that the interview did not

Everyone describes attendance as *masuk dan pulang*. The device describes it
as a stream of moments, and the gap between those two descriptions is where a
payroll goes wrong. Twenty-one per cent of the days in a single ordinary week
could not be described by the rule everybody agrees on. That is not a data
quality problem to clean up before go-live; it is the steady state, and the
system's job is to make it **visible and cheap to resolve** rather than to
pretend it away.

---

## F41 — the two rules that decide whether a day is paid

The owner answered Q33 and Q34 in two sentences: *sakit* is paid with a
doctor's letter, *cuti* is paid only against what that person is owed — and
every person's number is different; overtime needs HRD, and leadership with
the overtime letter. Building them changed how the payroll is shaped more than
the sentences suggest.

### A letter is evidence, not a checkbox

The obvious build is a `has_doctor_note boolean` on the mark. It is wrong in a
way that shows up in month two: somebody ticks it, the letter never arrives,
and nothing in the system can tell the difference between *we saw the letter*
and *we meant to ask for it*.

So the letter goes where every other document in this system goes — uploaded
once, linked to the mark, with the name of whoever linked it and the minute
they did (ADR-010). `Surat Dokter` and `Surat Lembur` became document kinds
like a nota or a receiving photo, and `day_mark` and `overtime` became things
a document can hang from.

The payoff was not planned and is the best part of it: because the day's value
is **derived**, a letter handed in three days late makes that day paid the
moment it is attached. No recalculation, no correction entry, no re-running a
payroll. The screen showed it directly — Utami's 1 September went from *nilai
hari 0* to *nilai hari 1* on the upload, with the sentence under it changing
from "Sakit tanpa surat dokter — tidak dibayar" to "Sakit dengan surat dokter
— dibayar penuh".

### A leave balance must never be stored

*Cuti hanya jika punya nilai cuti berbayar* invites a `remaining_leave_days`
column that each approved day decrements. Every system that does this is
eventually wrong: a mark gets removed, a day gets re-dated, an import is
replayed, and the counter drifts. The person it drifts against is the one who
loses a paid day, and they find out at the worst moment.

So the entitlement is stored — per person, because the owner was explicit that
it differs — and what has been *used* is counted from the marks in that
calendar year, in date order. The first days of the entitlement are the paid
ones; past it, the day is still recorded and simply not paid. Roni, with five
days and five already taken in March, shows exactly that: "Cuti di luar hak —
jatah 5 hari tahun ini sudah habis." Nothing refused his cuti. It just is not
paid, and the reason is on the screen rather than in somebody's head.

### Two signatures check two different things

The temptation with *HRD dan pimpinan* is to treat it as one approval needing
a second click. It is not. HRD checks a **fact** — was he here, are these the
hours the taps show. Leadership takes a **decision** — was this work worth
paying for. That is why `approve_overtime` is a fifth authority rather than a
reuse of `approve_goods` (D24's whole point): approving that a table arrived
and approving that a man is paid for four extra hours are not the same
judgement, and the owner may not always want them in the same pair of hands.

The letter is what makes the second step real. Leadership's approval is
**refused** while no `Surat Lembur` is attached, and the button on the screen
is disabled with the reason on it — because approving without the letter is
approving a number somebody typed. HRD's step is *not* gated that way: the
hours can be checked while the paperwork is still being written, which is how
it actually happens in a workshop.

And the claim is never hidden while it waits. `waiting_hrd` ·
`waiting_surat` · `waiting_leader` are separate stages on the list precisely so
that a claim stuck at *menunggu surat lembur* for a week is visible as the
thing somebody has to chase.

### What it cost

One column (`paid_leave_days`), two document kinds, two link entities, one
authority, and two extra timestamps on a claim. No stored balances, no status
columns beside the signatures, no recalculation job. Everything that decides
money is read from what somebody actually did, each time it is asked.

---

## F42 — the sheet was the design

The owner corrected the overtime rule with one sentence about paper: leadership
signs **production** overtime, which is *satu lembar penuh isi banyak nama
karyawan lembur beserta tugas dan item yang dikerjakan*; staff have a sheet per
session with a screenshot of the work, and HRD decides — default yes.

Three things fell out of that, in order.

### One form with an optional field would have been wrong

The first instinct is one overtime record with a "needs leadership?" flag. But
the two documents are not variants. A production night is a **batch**: forty
names on one page, signed once, because that is how a supervisor actually
works — he does not sign forty things. A staff session is a **person and an
evening**, and its evidence is not a signature at all, it is the work: a
screenshot of what was on the screen.

Modelled as a sheet with lines, both are natural. Modelled as a claim with a
flag, the production case needs a grouping that does not exist and the staff
case needs an approval that should not.

### The default is the decision

*HRD memutuskan dibayar atau tidak (default ya)* is not a UI nicety. Read
literally, it inverts the burden: the person already stayed, their report is
attached, and what is left to decide is whether to **take the payment away**.
So a staff sheet ships `paid = true`, and HRD's act is either "I looked, still
paid" or "not paid, because —", which writes a reason.

The alternative — undecided means unpaid — would have quietly punished every
session nobody got around to reviewing, and the people it would punish are the
ones who worked late on something nobody was waiting for.

### The payroll document was carrying production data all along

The production sheet's lines say *item apa, proses sampai mana, berapa*. That
is not payroll. It is a production report that happens to travel on a payroll
document, and the moment somebody copies it onto a whiteboard, the workshop's
version of Thursday night and HRD's version begin to disagree.

So the line carries the work order number, the stage and the quantity, and
**leadership's signature posts them to the production board** — keyed by sheet
number, so signing twice adds nothing. Typed once, moved by the act that was
already happening.

Which is what made a seventh service necessary (D148). The board it posts to
answers a question the business could not answer before: not *what are we
building* — a workshop always knows that — but **which of the eleven things on
the floor is the one that is late**. The fixtures are deliberately not tidy:
three orders past their date, one not started with four days left, and one
where finishing is reported on seven doors while only four were sanded. That
last one is physically impossible, and the board says so in a sentence instead
of averaging it away.

### The permission that the flow forced

The Direktur may sign a production sheet. He does not hold `production.update`
— he is not the workshop. But his signature *causes* a production posting, and
a rule that refused it would leave one act half-done: hours paid, work not
recorded, and nobody told.

So `recordProgress` accepts `approve_overtime` for entries whose source is
`overtime_sheet`, and nothing else. The authority for the posting is the
signature that caused it. Writing that rule at the point it is enforced, with
the reason beside it, is cheaper than discovering it as a 403 in a demo three
weeks from now — which is exactly how it was discovered here, on the first
end-to-end run.

---

## F43 — master data is where the honest gaps live

Adding projects, products and bills of material was mostly straightforward
typing. Three decisions in it were not, and all three are about what to do with
what the data does **not** know.

### A product is not a catalogue item

The tempting shortcut is one `items` table with a flag. It is wrong in a way
that shows up immediately: `procure.items` is **half uncurated by design** —
a purchase can name something nobody has catalogued, and the system records it
rather than refusing the purchase (D26). A product is the opposite. It is
quoted, drawn, put on a work order and made; it exists before anything
references it and is always curated.

Two tables, joined by code at the seam. The bill of material is the join, and
it is the only place the two ideas touch.

### Waste is not part of the quantity

`qty` is what the drawing says. `qty × (1 + susut)` is what has to be bought.
Six boards of jati at 12% waste is 6,72 — and the workshop that ordered six
finds out on a Saturday. Keeping them in one column would have been simpler to
type and would have quietly produced the wrong purchase requisition forever.

### The cost must be allowed to be incomplete

The display rack's BOM has a steel frame that the catalogue cannot price: it is
bought as a fabrication from a vendor, not as a stock item. There were three
options — refuse the component, price it at zero, or show the total as
incomplete.

Refusing it means the BOM stays in somebody's head. Pricing it at zero produces
a number that **reads as finished** and is wrong by whatever the frame costs,
which is the worst of the three because nothing on the screen says so.

So the material cost is computed on read, components without a price are
counted and named, and the total carries *belum lengkap* wherever they exist.
The same rule the payroll screen already follows: a figure is allowed to be
missing, never allowed to be quietly wrong.

One more thing fell out of it. The price comes from the catalogue's **standard
price** where there is one and from the **last price paid** otherwise — and the
line says which it used. A last price is a hint, not a price list (D33), and a
cost built partly out of hints should admit it.

### What is deliberately still missing

Labour. The BOM prices materials and stops, and says so on the screen. An
invented hourly rate would flow straight into a quoted price, which is the
furthest possible place for a made-up number to end up (Q38). Versioning is the
other gap: a BOM is current-state, every change audited, and pinning a revision
to the work order that used it is a table nobody needs until the first dispute
about what a chair was supposed to contain (Q36).

---

## F44 — "harus ada" is a statement about what the system must notice

The owner's instruction was one line: every item must have a working drawing,
a finished picture and a size. The naive reading is three fields. The useful
reading is different, and it changed the shape of the screen more than the
shape of the table.

**If something must be there, the system has to be able to say it is not.**
That is the whole value: nobody is going to forget the drawing for the table
they are building this week — they will forget it for the product somebody
quotes in March. So the catalogue now carries a completeness column that names
what each product lacks, in words: *belum ada gambar kerja, gambar jadi*.
Six of the seven demo products are incomplete, which is what a real catalogue
looks like in month one.

**Which is why the size is three numbers.** It was free text —
`"2200 × 1000 × 750 mm"` — and free text cannot be checked. A product with
`dimension: "menunggu dari vendor"` reads as filled in. With
`length_mm`/`width_mm`/`height_mm` the question *does this product have a size*
has an answer, and anything that is not an axis (a diameter, a thickness) went
to `dimension_note` rather than being lost. The demo keeps one product — the
steel-framed rack — with no numbers and a note saying the vendor has not sent
them, because that is the honest state and the screen should show it as a gap
rather than as a size.

**Two drawings, not one.** *Gambar kerja* is what the workshop builds from;
*gambar jadi* is what the client was shown and what QC checks against. A single
"drawing" field would have silently lost whichever was filed second, and the
two are asked for by different people at different moments. Both travel the
same road as every other document here (ADR-010): uploaded once, linked to the
product by code, carrying who filed it and when — which is what makes *is this
the current drawing* answerable. A revision is a **new file against the same
product**; the older one stays, because a piece built last month was built from
it (A5).

### The order lines were the quiet half

*Di orders harus ada item dan jumlahnya* looks like a smaller request. It is
the one that made the project a real record. Before it, a project was something
spending got tagged with; now it says what was sold, and the production board
already knew what was being made — so the two can be read side by side, matched
on the product code.

The three demo projects show why that column is worth having:

| | Ordered | In production | Finished |
|---|---|---|---|
| BABY ISLAND — meja | 4 set | 4 | 3 |
| VILLA SEMINYAK — pintu | 10 daun | **12** | 0 |
| HOTEL UBUD — everything | 102 items | **0** | 0 |

The middle row is a real thing that happens — two spares were added to the work
order and nobody wrote it down against the order. The last row is a job signed
three weeks ago that nobody has started. Neither was visible anywhere in this
system, or in the spreadsheets it replaces, until these two tables sat next to
each other.

---

## F45 — one column closes the loop

The owner's question was two sentences: can a BOM line become a PR, so that at
the end of a project we can compare actual production cost against the
projection. Both halves were nearly there already — the BOM knows what a unit
needs, procurement knows what was bought — and the thing missing between them
was a single column.

### Why matching afterwards does not work

Without a link, reconciling means matching by item code and date: *this
plywood bought on 3 September was probably for the BABY ISLAND tables*.
Probably. The moment two orders run at once — which is the normal state of this
workshop, six open work orders on a Friday — the same plywood is plausibly for
either, and any split is invented. Worse, it is invented **afterwards**, by
whoever is preparing the report, which is exactly when the answer is least
checkable.

`pr_lines.source_wo_no` costs one column and removes the guesswork entirely:
projected and actual become two sums over the same set of rows.

### Draft, not submitted

The button creates a **draft** purchase request. That is deliberate and it is
the difference between a useful tool and a dangerous one: a bill of material
says what a piece *should* need. It does not know that half the plywood is
already in the rack, that the client changed the finish, or that the last
delivery was short. A list that went straight into the approval queue would
put the workshop's assumptions in front of the CEO with somebody else's name
on them.

So it lands where a person has to read it, price it and ask for it — the same
place any other request starts.

### The comparison has to compare like with like

The tempting screen subtracts *everything booked to this project* from *the
material projection* and prints the difference. It would be wrong every single
time: the ledger total includes installation, delivery, subcontracted metalwork
and whatever else the project touched, none of which is in a bill of material.

So the report puts **materials against materials** — projection against what
was asked, approved and paid on lines traceable to this project's work orders —
and shows the ledger's whole project spend **separately**, saying in words what
it contains. Two honest numbers beside each other beat one dishonest
subtraction.

The same restraint applies to labour: it is in **neither** side. The BOM does
not price hours (Q38), so putting overtime into the actual column would make
every project look like it beat its projection by exactly the amount of work
nobody costed.

### What the demo shows about its own numbers

Raise a PR from a BOM and the asked total matches the projection **exactly** —
because both read the same catalogue price. That is not a bug and the screen
says so: divergence appears later, when a quantity is edited, a vendor quotes
differently, or a second request goes in because something ran out. Which is
the honest description of where an overrun actually comes from, and a system
that showed a variance at draft time would be inventing one.

---

## F46 — the cheapest invoice was the most expensive wood

The owner asked for timber to be counted from log to board, with total cubic
metres set against what each purchase cost, per vendor. Building it produced a
number that is worth the whole module.

### The arithmetic

Two suppliers, same species, same sawyer:

| | Rp / m³ log | Rendemen | **Rp / m³ papan** |
|---|---|---|---|
| CV KAYU MANIS SELATAN | **15.507.497** | 44,8% | 34.630.228 |
| CV SUMBER KAYU JATI | 18.181.818 | 61,4% | **29.554.050** |

Kayu Manis is **Rp 2,7 juta cheaper** per cubic metre of log and **Rp 5,1 juta
dearer** per cubic metre of wood that can actually go into a table. Every
figure in the left column is on an invoice. Every figure in the right column
requires measuring what came out of the saw, and without it the business would
keep buying the wrong logs while believing it was saving money.

That is the entire justification for an eighth service.

### Three rules the numbers forced

**A partly-sawn load must not set a price.** `kyu-26-08-26_01` has three of its
five logs cut. Dividing its boards by all five logs reads as 39% yield when the
sawyer is getting 61%; dividing the whole invoice by those boards prices the
wood half again too high. So yield and cost-per-board-metre are computed over
**the logs actually sawn and their share of the invoice**, and the load says in
words how much is still in the yard.

**Vendors compare within one species.** The first version summed each vendor's
timber into one row and Kayu Manis came out at Rp 12,9 juta per log metre —
because their mahoni, at a third of the price of jati, was averaged in with it.
That made the cheaper *species* look like a cheaper *supplier*. Splitting by
vendor **and** species fixed it, and it is the same category error the project
cost report avoids by never subtracting the ledger's project total from a
materials projection.

**The seller's number is kept, not corrected.** Our measurement of the July
load came out 0,16 m³ *below* what was invoiced. The instinct is to overwrite
one with the other. But the difference is the conversation with the vendor, and
a system that stores a single figure has already lost that argument. Both are
recorded and the gap is stated.

### And the one that is deliberately not built

The board list is what came **off the saw**, not what is left in the rack.
Nothing draws it down as production consumes it (Q40), and the screen says so
in as many words. A stock figure that is never decremented is a lie; one
decremented by guesswork is a worse lie, because it looks maintained. What is
missing is not a table — the BOM already knows what a run should take — it is
somebody in the workshop writing down what was actually pulled off the pile.

## F47 — one comma, and a man was paid Rp 105

The company's overtime form was exported from a spreadsheet and read straight
in. The first row came back as **Rp 105 for 0 jam**.

The file said `"105,000"`. A spreadsheet quotes any field containing a comma,
and `line.split(",")` does not know that: the cell became two, every column
after it shifted one to the left, the hours landed in the signature column and
the rupiah lost its thousands. Nothing threw. The number was simply wrong, on
a screen whose whole job is to be trusted with wages.

The fix is fifteen lines that respect quotes (`src/lib/csv.ts`), used by the
overtime form and by the biometric import beside it — a name or a location with
a comma in it would have done exactly the same thing there. What is deliberately
**not** handled: newlines inside cells, other separators, encodings. Those have
not happened, and inventing for them would hide the day they do.

The lesson is not "use a CSV library". It is that a parsing bug in this domain
does not look like a parsing bug. It looks like a payslip.

## F48 — the payroll run that covered a week nobody worked

Building the weekly recap turned up a demo that had been quietly wrong for
several sessions: the payroll run covered 24–28 August, and the attendance file
started on the 29th. Every daily worker read **0 hari**, every payslip printed
an empty grid, and the screen was perfectly honest about it — *No day counted
in this period* — on forty rows at once.

Two things came out of it.

The first is that the run's period must be the week the timesheet actually
covers, which is a fixture fix and was one line. The second is the real one:
even on the corrected week, Karjo's slip showed **five days of hours and paid
1,5 of them**. Nothing was wrong — three of his days are in `review` because
the reader missed an *istirahat* tap, and a day nobody has read is worth
nothing until they do (D141). But a payslip that prints the hours and then
pays a third of them, with no sentence in between, is the payslip somebody
brings to HRD angry, and they would be right to.

So the slip marks those days `?`, names them in words, and says the same about
overtime the machine saw and nobody approved: *10,27 jam catatan mesin, 2 jam
dibayar*. The figures did not change. What changed is that the paper now
answers the question it was provoking.

## F49 — the delivery that nobody could find afterwards

Building stock turned up the gap it was built to close, and it is worth naming
precisely because it had been invisible for twenty-six milestones.

A request was raised, approved, ordered, delivered, confirmed with a photo and
a signed tanda terima, and paid. Every one of those steps had a screen and a
document. And then **the goods stopped existing.** Nothing in the system knew
that sixty sheets of plywood were in the gudang, so the next person to need
plywood had exactly two ways to find out whether there was any: walk to the
rack, or raise another request.

The fix is one call — confirming a receipt writes a stock movement — but the
shape matters more than the call:

**On-hand is never stored.** It is the sum of the movements, computed on read.
The spreadsheet version of this module stores the number, and it has been wrong
since the day somebody forgot a row: a stored quantity disagrees with its own
history, and the disagreement is discovered by a man standing in front of an
empty rack.

**Issuing more than the record shows is recorded, not refused.** This one is
counter-intuitive until you stand in the workshop. The wood is either on the
rack or it is not; a screen that refuses to record what a storeman just carried
out does not prevent the issue, it prevents the *record* of it — and it teaches
him to stop typing. What the system owes him instead is to say the figure has
gone negative and needs counting, which it does.

**An unpriced delivery is counted and left out of the value.** Eight sheets
arrived on a lump-sum line with no unit price. Valuing them at nought would
have shown the rack as Rp 2,3 juta cheaper than it is, with nothing on screen
to say why. So the value is over the priced part and says *belum lengkap* — the
same rule as the BOM's material cost (D149) and timber's unsawn logs (F46).
Three modules, one principle: **a figure is allowed to be missing, never
allowed to be quietly wrong.**

### And the category list that was a word list

The first filing had nine flat headings, one of which was "Production" — which
is every item in the workshop. A category earns its place by separating two
questions somebody actually asks: *how much wood is on the rack*, *which
finishing is running out*. Filing is now two levels, and **whether an item is
counted at all is a property of its category**, not a checkbox somebody has to
remember: a service is never on a rack, and neither is the electricity bill.

## F50 — the multiplier that moved a monthly salary by seventy per cent

Making the pay rules configurable was supposed to be plumbing. It changed a
number instead, and the change is worth writing down because it had been wrong
in plain sight for four milestones.

Overtime for a salaried person was priced at `base_rate / 21 / daily_hours` —
a month divided by twenty-one working days divided by eight hours. It is a
reasonable-looking guess. The regulation's own figure is **173** hours a month
(40 × 52 ÷ 12), and the difference is not small:

| | Rp / hour | 2 hours of overtime |
|---|---|---|
| `/ 21 / 8` with no multiplier | 38.690 | **77.380** |
| `/ 173`, national ladder (1,5× then 2×) | 37.572 | **131.502** |

The hourly rate barely moved. The **pay** moved by 70%, because the ladder was
missing entirely: this system had been paying overtime at the ordinary rate and
saying so on the screen (Q31), which was honest and also not what the business
does. One sentence from the owner — *lembur normal sesuai peraturan nasional* —
replaced a guess that had been visible, marked, and unchallenged since M17.

### Three rules that came out of building it

**A rule change cannot be backdated.** Days already worked were worked under a
rule somebody could have read at the time. The first version of the guard only
checked that the new version came after the previous one, which let a change
dated 1 August through on 11 September — and the test caught it saving happily.

**A version dated inside an existing run is refused, not ignored.** Payroll
picks the rule in force when the period *opened*, so a version dated mid-period
would look applied and do nothing. Silently doing nothing is worse than
refusing: the setting reads as changed, and the payslip disagrees.

**Undertime ships off.** The owner named it as a scheme that exists here, but
not what a short hour costs — and the demo had no short day in it at all, which
is how the first preview came back saying *nothing changes*. The fixture now
has one (Sumiati leaves at 14:47 on the third), and turning the rule on moves
her week by Rp 23.963. That is the number the decision needs, and it did not
exist until somebody had to look at it.

## F51 — a finished project made a finished drawing look ten weeks late

The drafting queue is sorted by the date the job actually needs each drawing,
which means it has to work out what "needed by" is. The first version took the
soonest of: the open work orders' due dates, the task's own due date, and the
target dates of every project that ordered the product.

It read, against a drawing released three weeks ago with nothing outstanding:

> **Lemari pakaian 3 pintu — lewat 74 hari**

Seventy-four days before today is 29 June. Nothing live is due then. The date
came from **OFFICE FITOUT**, a project handed over in June, closed, inactive —
which happens to have a line for the same wardrobe. A target date on a finished
job is not a deadline, and treating it as one did the specific damage this
project keeps finding: it did not just show a wrong number, it **moved a real
deadline down the queue**, because the rak display genuinely due in three days
sorted below it.

Two fixes, and the second is the more interesting one:

- Only **active** projects contribute a date. A closed job's target date is
  history.
- A released, current, unblocked task shows **selesai**, not a countdown. Its
  deadline passed because the work was done; painting that red teaches the
  drafter to ignore red.

The general rule this is the third instance of: a derived date is as capable of
being quietly wrong as a derived figure, and a wrong date is worse, because
sorting by it hides the right one.

## F52 — the column that is wrong by Friday

The Package tracker came to us as a working Google Sheet with a read-only
dashboard on top, and the sheet is good: three agents per property, a stage
ladder, and a **MOVE ON** column somebody ticks when an agent has gone quiet for
seven days.

That column is the whole reason the module was worth rebuilding rather than
mirroring. It encodes a rule — *seven days of silence, go to the next agent* —
as a piece of data a person has to maintain. Which means:

- it is only as current as the last time somebody swept the sheet;
- it disagrees with the date beside it the moment anybody forgets;
- and nothing anywhere can tell the difference between "not yet seven days" and
  "nobody has looked".

Rebuilt, the flag is derived from `sent_on` and today, and cannot be forgotten.
The demo carries the case: K. Webb was messaged on 2 September and has not
replied, so the queue says **10 hari tanpa balasan** and offers the move. The
same row in the sheet still reads `MSG SENT`, because the sweep has not
happened this week.

### Two more things the rebuild had to change

**The funnel counts properties, not agents.** A building where one agent is at
DEAL is not also a building at QUEUED; counting it in both is how a funnel stops
adding up to the number of buildings. So each property enters the funnel once,
at its **furthest** agent.

**Moving on is one act, not two.** Recycling the silent agent and messaging the
next one are the same decision, and doing half of it is how a property stalls
with nobody chasing anybody — the state the sheet produces most often. One
button does both, and it asks for the sentence that explains it, because that
sentence is what somebody reads a year later when the same agent comes up again.

## F53 — the prefix that was rebuilt from the label

Making the pipeline worldwide meant one filter had to work at three altitudes:
all countries, one country's cities, one city's districts. The market code
already encodes exactly that — `AU-QLD-GOLDCOAST-SPNORTH` — so the filter is a
prefix match and nothing else is needed.

The first version built the city prefix **from the labels** instead:
country code, then an abbreviation of the region, then the city name with the
spaces removed. For Queensland that produced `AU-QUE-GOLDCOAST`, against seeds
that say `AU-QLD-GOLDCOAST`.

Nothing threw. The chip rendered, the click registered, and the screen showed
**0 properti** — which is a legitimate answer for a city with no properties in
it, and therefore indistinguishable from the truth. It was caught only because
the Gold Coast obviously has six.

The fix is one line — the city prefix is the market code minus its last
segment — and the rule behind it is worth more than the fix: **never
reconstruct a key from the words it was rendered from.** `QLD` and
`Queensland` are the same fact in two vocabularies, and the moment code
translates between them it owns a mapping that nobody maintains.

The same shape has now appeared three times in this project: a document kind
stored as a display string (C1), a category rebuilt from a name, and this. Each
time the honest version is to carry the key and show the label.

---

## F54 — the four screens that were finished because they existed

The question was *"Yang IT sudah lengkap?"* and the honest answer took ten
minutes to establish: no. The module had five entries on the menu, one of them
real. `/it/aturan-gaji` had been built two milestones earlier and worked.
`/it/audit`, `/it/aktivitas`, `/it/pengguna` and `/it/peran` were placeholder
pages — a heading, a sentence, and no data path at all.

None of them looked broken. They routed, they rendered, they sat in the nav
beside the real one, and `npx next build` reported all five as static pages of
roughly the same size. Nothing in the build, the type check or the lint could
have told the difference, because a page that renders a paragraph is a valid
page. The only signal was the menu: a module whose screens are all one click
deep and none of them ask the store a question.

Two things follow from this.

The first is about the audit trail specifically. D45 decided, back in M2, that
**the audit seam ships before the audit module** — every write records its row
from the first milestone, and the screens come later. That was the right call
and it held: when the screens were finally written, twenty-three write paths
already had rows waiting, including refusals, and nothing had to be
back-filled. But the cost of the call is exactly this finding — a module that
reads as done for thirty-one milestones because the expensive half of it was
finished first and the cheap half was never noticed missing.

The second is about the board. Every milestone row in `README.md` is written as
prose about what was built, which makes it very good at recording work and
useless at recording absence. There is no row that says *IT has five screens
and one of them is real*, because nobody writes a milestone about a screen they
did not build. The placeholder list at the bottom of `backlog.md` exists for
this and these four were not on it.

So: **a placeholder is a finding, not a file.** When a route is created to hold
a place, the same commit adds it to the backlog's placeholder list — otherwise
the menu is the only record that it is empty, and the menu is the one artefact
that makes it look full.

---

## F55 — the guard that only knew whether the door was open

The owner's answer was one sentence — *yang boleh baca module IT hanya IT dan
pimpinan* — and the work it implied looked like one line: give the Direktur an
`it` grant. Writing that line is what exposed the hole.

`requireModule(service, module)` had been the gate on every IT endpoint since
the module was built, and it asks exactly one question: does this person hold a
grant on this module. Not how far it goes. So the moment leadership holds
`it: read`, they can also call `purgeActivity` — the one call in this system
that genuinely deletes — because the guard never looked at the level. Reading a
log and ending it were the same permission.

Worse was next door. `setModules` and `setAuthorities` had **no guard at all**.
They were written in M2 as the demo's act-as machinery, marked *demo only*, and
they stayed that way through thirty-three milestones while the module around
them became real. Anybody acting could have granted themselves every module and
every authority, and the audit row would have recorded it going through.

Both are the same mistake in two sizes: **a permission model is only as good as
the narrowest question its guard can ask.** The catalogue had three levels from
day one and the guard could not see them, so every endpoint that needed a level
either over-granted silently or was written without a gate because the gate
available would not have said anything useful.

`requireLevel(service, module, level)` is the fix, and its refusal message is
half of it: *this needs admin access to it; your account has read* tells a
person what to ask for. `module_required` told them a door existed.

What made this findable was the owner drawing a line. The permission had been
wrong since it was written; nothing surfaced it, because everyone who held the
IT module held it at `admin` and the two questions gave the same answer for
every person in the seed. **A guard is untested while exactly one kind of
person passes it.**

---

## F56 — the test that proved nothing, twice over

The change was small: the pay-rule book becomes readable by HRD and writable
only by IT. The screen behaved immediately — twelve controls rendered and all
twelve disabled for HRD, enabled for IT — and that was the moment to be
careful, because F55 had just finished saying the UI gate is not the gate.

So the guard was probed directly: open the editor as IT, fill the note, run
the preview, then flip `session_user_id` in `localStorage` to HRD and press
Simpan. It saved. **Versi 3 tersimpan.**

For about a minute that looked like the guard not working. It was the test not
working. The demo store is an in-memory singleton hydrated from `localStorage`
exactly once, on load — writing to storage afterwards changes a copy nobody
reads. The acting user never changed; IT saved their own rule set, correctly.

The second failure was the shape of the test, not its plumbing. Every route to
the save button goes through a screen that hides it, so no click can ever reach
the endpoint as the wrong person. Driving the UI can only ever confirm the UI.

What worked was exposing the demo API on `window` behind a probe, calling the
four guarded endpoints as each person in turn, and reverting the probe
afterwards:

```
HRD (Wulan)        403 module_required: no access to the it module
LEADERSHIP (Evin)  403 level_required: needs write access to it; your account has read
                   403 level_required: needs admin access to it; your account has read   (purge)
IT (Shared)        OK
```

Three lessons, in the order they cost time.

**A test that goes through the screen tests the screen.** The whole point of a
server-side guard is the request that never came from your own form; a
browser-driven test cannot make that request, so it cannot test that guard.

**A passing result from a mechanism you have not verified is worse than no
result.** The `localStorage` edit looked like it worked — no error, correct
key, correct value — and produced a confident, wrong conclusion in the one
direction that matters: *the guard is broken*. Had it produced a wrong
conclusion the other way, the guard would have been shipped untested with a
green tick beside it.

**Two levels of refusal are two different messages, and both are worth
reading.** HRD is refused at the module (`no access to the it module`) and
leadership at the level (`needs admin; your account has read`). Under the old
`requireModule` both would have been the first message, and leadership's — the
one that actually says what is missing — could not have been written at all.

---

## F57 — seventeen numbers that were read from a file that was not there

Recording where a number came from took one field: `extracted`, `typed`, or
`pending`. Backfilling it across twenty-seven seeded documents took one
regular expression — *has a number, so it was extracted* — and that was the
mistake, written in three seconds and invisible for an hour.

The screen said it out loud the moment it rendered:

```
PKWT/2026/007
terbaca dari berkas
nomor saja, berkas belum dipindai
```

Read from the file. No file. Two lines apart, on the same row.

It looks like a cosmetic slip in demo data and it is not, for a reason that
outlives the seeds: **provenance exists so that somebody later trusts a number
because of where it came from.** A number marked *read from the scan* is one
nobody needs to check against the scan — that is the entire value of the mark.
A system that hands out that mark for free has not recorded provenance, it has
decorated the number with a word.

Two fixes, and the second is the one that matters.

The seeds were corrected: `extracted` only where an attachment is actually
filed, which left three, not seventeen.

Then `saveEmployeeDocument` was taught to refuse `extracted` with no
`attachment_id`. The seeds are not the last thing that will ever write one of
these rows — a Phase-2 import, an OCR job that half-finishes, a fixture written
by whoever comes next. The guard is four lines and it makes the claim
unrepresentable rather than merely currently-untrue.

The same hour produced a smaller one of the same shape, on the audit screen:
*4 nomor identitas dibuka*, counting a **refused** reveal among them. Three
numbers were opened. The fourth was the system working. A count that adds up
what happened and what was stopped describes neither.

Both are the project's oldest rule in a new costume: a figure is allowed to be
missing, never allowed to be quietly wrong. Provenance you did not establish is
missing; provenance you inferred from the presence of a number is wrong.

---

## F58 — the nota's own date, read as a plank twenty metres long

The timber reader worked on the first try, which should have been the warning.
Four notas went through it — a board nota in centimetres, one in millimetres, a
log nota, and a hardware nota that had to be rejected — and all four came back
right. Then the dump of what it had actually read:

```
lines: P 120x90x20260mm x1 | P 30x200x3000mm x8 | P 30x220x2800mm x9 | …
signals: 5 baris berbentuk ukuran papan ; menyebut Jati
```

The first row is `Nota 2209 - 12/09/2026`. Three numbers separated by slashes
is the shape of a board size and it is also the shape of a date, so the header
of the nota was read as a plank 12 cm thick, 9 cm wide and **202 metres**
long — the year, in centimetres.

The answer was still *yes, this is a timber nota*, and it was still the right
answer, which is exactly what made this worth stopping for. The header had
become one of the five lines the decision counted. A nota with two real size
rows and a date would have been pushed over the three-row threshold by its own
letterhead — and the failure would have been a **wrong routing decision, taken
confidently, on evidence displayed to a person who would have had no reason to
doubt it**, because the screen would have said *3 baris berbentuk ukuran papan*
and been counting one that did not exist.

Two guards, and the second matters more than the first.

A date pattern on the line disqualifies the size match. That fixes this case.

Then: a board's dimensions have to be **possible**. Thickness 5–150 mm, width
30–1500 mm, length 300–6500 mm — and anything outside goes to the unread list
where a person looks at it, rather than into the yard. This catches the whole
family the date belongs to: invoice numbers, phone numbers, a misread unit, a
row where the OCR dropped a digit. `12/09/2026` fails it twice over.

The rule underneath: **a parser that only rejects the shapes you thought of
will accept the ones you did not.** The date guard is a list of known enemies.
The plausibility range is a statement of what the domain actually contains, and
it is the one that will still be working when a nota arrives in a format nobody
here has seen.

The same run produced a smaller lesson about honesty in the evidence itself.
The log nota — whole logs, no boards — was reported as timber with *tidak ada
baris berbentuk ukuran papan* listed against it. Both true, and together they
make the reader look like it is arguing with itself. A nota of logs is not
missing its board rows. It is a nota of logs.

---

## F59 — three shapes the data allowed and no screen ever showed

The ask read like a UI job: put a preview on the document. The preview took an
hour. The sentence after it took the rest of the day, and it was not a UI job
at all — *ingat kalau 1 dokumen bisa jadi beberapa transaksi, 1 bukti transfer
bisa cover beberapa pembelian item, bahkan 1 transaksi dibayar 2x tunai dan
transfer itu mungkin terjadi.*

The first instinct was to check whether the model supported those. It does, all
three, and has since M1:

- `attachment_links` is many-to-many, so one document behind four ledger rows
  has always been representable;
- allocations are per transaction per target, so one transfer settling four
  purchases is four rows;
- and the third — one purchase paid part cash, part transfer — is two ledger
  rows on two accounts, both allocating to the same request line, which is
  exactly what a ledger should hold.

**That is the finding, and it is the uncomfortable kind.** A shape the data
permits and no screen displays is not a feature waiting to be used. It is a
mistake waiting to be made twice, because the person deciding cannot see that
it already happened once. The verification queue is the screen where somebody
turns a photograph into money, and it was showing a filename.

Three smaller things fell out of building it, each worth more than the code.

**The check belongs on the other end.** The first version showed the coverage
of the document being verified — and for every pending document that panel is
empty, because a document in the queue is attached to nothing. It rendered
beautifully and decided nothing. What decides whether *link* is the right road
is the state of the **row being linked to**: what paper it already carries,
what it already pays, how much of it points at nothing. Useless to useful was
not more information, it was the same question asked from the other side.

**A split payment shown by halves is worse than not shown.** The first pass
listed only the payments belonging to the document in hand. A line paid Rp 2 m
in cash and Rp 9,5 m by transfer, opened from the transfer's side, read
*Rp 9.500.000 of Rp 11.500.000* — a settled purchase reported as short. The
payment list has to be complete, with the ones from elsewhere marked as such.

**Seeding the case is what proved the case.** Writing the split into the
fixtures meant changing one transaction from Rp 11,5 m to Rp 9,5 m, and the
first attempt did not: the bank row kept the full amount while the cash row
paid Rp 2 m of the same purchase, so Rp 13,5 m had been paid for an Rp 11,5 m
purchase and the screen said so — *Rp 2.000.000 dari baris ini belum diarahkan
ke pembelian mana pun*. The new panel caught the error in its own demo data
within a minute of existing. The same pass found a CONFIRMED inbox row whose
document was attached to nothing at all, which is a posting with no evidence
travelling with it — D85 forbidden, correct in the running flow, and untrue
only in the seed.

---

## F60 — no work order at all, counted as none made

The handover board's job is four numbers per line: ordered, made, delivered,
installed. The first version of `madeFor` ended like this:

```ts
const orders = state.work_orders.filter(/* this project, this product */);
if (orders.length === 0) return 0;
```

Two sentences, and they say different things:

- *the floor has an order for this and has finished none of it* — **zero**;
- *nothing in production has ever heard of this line* — **not zero**.

In a column of numbers they are the same character. The conversations they
require are completely different: the first is "where is it up to", the second
is "who is building this, and does anybody know they are?" HOTEL UBUD, a
fourteen-table restaurant order with no SPK behind it, read `0` — indis-
tinguishable from a job that started yesterday.

It now returns null and the column prints `?`, which is the fourth time this
project has caught the same shape. It is worth naming as a rule rather than a
recurrence: **a lookup that finds nothing must not return the identity element
of whatever the caller was going to do with it.** Zero for a sum, empty string
for a name, `false` for a flag — each is a real answer that happens to be
reachable by accident, and each one reads as knowledge.

The fix carried a second rule with it. A missing SPK on a **handed-over**
project raises no warning: the job is finished, nobody can act on it, and a
permanent alert on a closed record is exactly the mistake F51 made with a
closed project's target date. Missing is worth saying while it can still be
answered.

---

## F61 — three screens nobody could open

The screens were built, the refusals were written, the fixtures were seeded.
Then the first probe of every guarded call came back identically:

```
overShip   403 module_required: Your account has no access to the project module.
overFit    403 module_required: …
noBast     403 module_required: …
```

Not one of the refusals under test had been reached. **Nobody in the seed held
the `project` module at anything but read** — leadership had `project: read`
and that was the entire grant list. The person who actually drives the truck
and reports what was fitted is the warehouse head, who had inventory,
production and procurement and nothing else.

The screens rendered perfectly throughout, because reading was never gated. It
was only the acting that was impossible, and the acting is the part nobody
looks at until they try it.

This is the same shape as F55 in a different costume — *a guard is untested
while exactly one kind of person passes it* — and its converse: **a screen is
untested while nobody has tried to use it as the person whose job it is.**
Rendering as an administrator proves the markup. It proves nothing about
whether the work is possible.

---

## F62 — two set of tables on a lorry, listed as standing in the house

*Di lokasi, belum terpasang* showed two dining tables at BABY ISLAND. The
consignment carrying them had left four days earlier and had never been marked
arrived — it was, as far as anybody knew, still on the road.

One function was doing two jobs. `deliveredFor` counted every consignment that
was not cancelled, and two different figures were being read off it:

- **what has left the yard**, which `ready_to_ship` subtracts — a table on a
  lorry cannot be loaded onto a second lorry;
- **what is at the site**, which `on_site` subtracts from — and a table on a
  lorry is emphatically not there.

Collapsing them put goods in transit onto the installation queue, and the
refusal that is supposed to stop a crew being sent to fit something that has
not arrived would have waved it through, because its own arithmetic agreed.

Two functions now, `deliveredFor` and `arrivedFor`, and the board carries both
columns — *berangkat* and *sampai* — with the gap tinted, because the gap is
the interesting part: goods that left and were never signed for are either on
a road or in a house nobody wrote down.

The general form is worth keeping: **when one number is being used to answer
two questions, it is answering at least one of them wrongly.** The tell here
was that the two usages subtracted it from different things.

---

## F63 — the office day, written down thirteen times

The settings screen's first honest question was which of the system's numbers
it could offer at all. The time zone looked like the easiest entry on the page:
one constant, one dropdown, done.

It was not one constant. `+ 8 * 3_600_000` appeared in **thirteen files** —
five service modules, seven screens, and the fixture builder — each with its
own small comment explaining the office day, each citing F17 and F39, each a
faithful copy of the same idea written out again.

Nothing was broken. Every copy said `8`. That is exactly what makes it worth
recording: **this is the failure mode that does not announce itself.** The day
somebody fixes a daylight-saving edge case, or the day M33's worldwide markets
turn into a second office, twelve of the thirteen keep the old answer — and
the symptom is not a crash. It is the payroll module believing a scan happened
on a different day from the module that files it, which is a week of somebody's
life to find.

The duplication had a cause worth naming, because it will happen again: each
copy was *four lines*. Four lines never feels like it deserves a module, and
the comment above each one — always the same comment — was the tell that it
did. **A constant repeated with the same explanation attached is not a
constant that is small enough to repeat; it is one whose explanation nobody
wanted to have to find.**

It is `src/lib/office.ts` now, one definition, and the settings screen can
point at it and say something true: this is where the office day is decided,
and it is not changed from here — changing it does not alter what happens
next, it alters which day every scan and every payslip already in the system
belongs to.

A smaller lesson from the same hour, and an embarrassing one: three earlier
`FIXTURE_VERSION` bumps in this session were written with `sed -i '49s/…/'`
and silently did nothing, because the file had grown and line 49 was no longer
the version line. `sed` reported success each time. **An edit addressed by line
number is an edit that stops being the edit you wrote the moment anything above
it moves** — and unlike a failed string match, it fails quietly.

---

## F64 — the refusal that accused somebody of the wrong thing

The router checks blocked capabilities first. The reasoning looked sound when
it was written: somebody asking for a salary should be told it is refused, not
quietly matched to something adjacent that happens to be allowed. Refuse
early, fail closed.

Then a production supervisor typed *SPK apa yang terlambat?* and John Lau
answered:

```
⛔ Tertutup lewat prompt — tidak ada izin yang membukanya
   Kehadiran per orang tidak dibaca lewat prompt…
```

`terlambat` is a person arriving late and a work order past its date. The
attendance rule owned the word, the attendance rule ran first, and a
legitimate question about the workshop came back as a refusal implying the
asker had been trying to read staff records.

**A false refusal is the most expensive mistake this router can make**, and
worse than a false answer in one specific way: a wrong number is a mistake, a
wrong refusal is an accusation. The person is told, in a red box, that they
asked for something they did not ask for.

So the rule inverts the intuition that produced the bug: **the blocked rules
must be more precise than the open ones, not less.** Failing closed is right
about the *consequence* of a match and wrong about the *threshold* for one.
The attendance rule now carries the guards — `not: [spk, produksi, order,
proyek, kirim, bayar, vendor]` — and the production rule requires its own noun
rather than hoping to win a race it had already lost.

Two smaller things surfaced in the same hour, both from the demo contradicting
itself:

**The suggestion chips did not work.** The opening panel offers *Barang apa
yang stoknya menipis?* and the rule was written *stok menipis*. Substring
matching, and Indonesian glues its possessive on: `stoknya` is not `stok`. The
app's own worked example failing is the cheapest possible way to discover that
a matcher is too literal — and the fix (strip a trailing `-nya`, lowercase,
drop punctuation) is the sort of thing a language model makes irrelevant,
which is precisely why the matcher lives in one file by itself.

**Two different refusals rendered identically.** *Closed to everybody* and
*your account lacks the grant* both came back under the same red header. The
second is fixed by asking IT; the first never is. One shared header sends
somebody to argue with the wrong person, so the turn now records **why** it
refused and the panel says the two differently — red for the boundary, amber
for the grant.

---

## F65 — three responsive faults that measured clean

The first pass was a script: every screen at 390, 768 and 1280, reporting any
element whose right edge crossed the viewport, ignoring anything inside a
deliberate horizontal scroller. Twenty-one routes, three widths, sixty-three
measurements.

Nothing. Not one overflow.

Then the screenshots, and three real faults, none of which a measurement of
horizontal overflow could ever have caught:

**The floating launcher sat on the last row of every list.** John Lau's button
is fixed to the bottom-right corner, the page's content ends where the content
ends, and on a 390-wide screen the two overlap permanently. Nothing overflowed;
a row was simply unreachable, on every list in the app. Fixed with bottom
padding on the shell that only exists below `sm` — the launcher's own space,
reserved by the layout rather than negotiated with each page.

**Badges broke mid-phrase.** *Di jalan* rendered as *Di* over *jalan* inside
one rounded pill, which reads as two broken pills. `whitespace-nowrap` on the
badge, and the rule behind it: a badge is a short label, and if it does not fit
on a line the layout around it is wrong, not the badge.

**And the one that mattered.** The handover board is five columns — ordered,
made, despatched, arrived, installed — and the whole screen exists for the
**gaps between them**. On a phone the table sat in a horizontal scroller, which
my script correctly skipped as intentional, and which showed exactly one
column. The screen was not broken. It was *technically usable* and had lost its
entire argument: you could read *4 set ordered* and nothing else, and the
comparison the module was built to make was three swipes away and invisible.

Narrow screens now get a stacked card with all five numbers in one row of
their own — `4 · 3 · 2 · 0 · 0` — which is smaller than the table and says the
thing the table was for.

**The lesson is about the test, not the CSS.** An overflow check asks *does
this fit*. Every one of these three fitted. What none of them did was **still
mean what the screen means**, and that is not a property you can measure with a
bounding box. The horizontal scroller is the sharpest case: it is the standard
answer to a wide table on a phone, it is what my own checker was written to
forgive, and on a comparison table it is the wrong answer — because a
comparison you can only see one column of is not a comparison.

---

## F66 — the language switch that broke the assistant's own examples

Switching the interface to English worked on the first try: the menu turned
over, John Lau's opening paragraph turned over, his suggestion chips turned
over into English. Then clicking one of them:

```
"How do I create a PO?"  →  I do not understand that.
```

All five. The router's keywords were Indonesian, every one of them, and the
English interface offered five English prompts that could not possibly match.

It is F64 again in a new costume — *the app's own worked example failing* — and
the second time is the useful one, because it says something about the shape of
the mistake rather than about the instance. Both times the failure was at the
**seam between a thing that was translated and a thing that was not**. The
labels moved and the matcher did not. The chips moved and the rules did not.

So the fix is not *add English keywords*, though that is what the diff does.
The fix is the rule: **the router understands both languages at all times,
regardless of which one the interface is showing.** Not because of tidiness —
because in this office somebody will type Indonesian into an English screen on
the first afternoon, and a matcher keyed to the interface language would refuse
them for having the wrong menu setting.

That also resolves where the resolution belongs. John Lau's catalogue holds
both languages and the **dispatcher** picks one, so the language of a refusal
is decided in the same place as the refusal, and understanding is decided
nowhere near either.

## F67 — the largest payments in the system had no date anybody could plan around

Q26 read like a permissions question — *who puts the expected date on a payment
term, procurement or accounting?* — and the answer, *biarkan yang punya akses
procurement*, was already how the code worked. One line of documentation, no
diff.

The sentence in front of it was the finding: **jatuh tempo adalah tanggal
ekspektasi pengiriman.**

A PO term fires on one of three rules — `on_issue`, `on_delivery`, `date` — and
only the third carries a date. For the other two, `poTerms` computed whether the
trigger had *fired* and wrote a sentence explaining it:

```
"not until everything has arrived"
```

True, useful, and undated. Which means the final payment on every order in the
system — the largest single figures the business owes — appeared on no calendar,
because nothing anywhere held an opinion about when it would fall due. The
expected delivery date was sitting on the PO the whole time, one field away,
recorded by procurement, already shown on the order screen. It just never
reached the term that depends on it.

Two things are worth keeping from this.

The first is that **a status and a date are different answers and the screen had
only ever been asked for one.** *Has it fired* is a yes or no about today. *When
will it fire* is a date about the future. The term view answered the first
perfectly and was never asked the second, so nobody noticed it could not.

The second is how the fix has to render. `expected_on` now carries
`expected_basis` beside it: `fired` when the date is the day goods actually
landed, `expected` when it is still what the vendor promised. The screen prints
the promise with a `±` in front of it. Without that pair the field would be
worse than the gap it filled — a promise and a fact in the same column, same
font, and the one that can still move indistinguishable from the one that
cannot. This is F62's rule arriving from the other direction: there, one number
was answering two questions; here, one column would have been holding two kinds
of truth.

A third thing fell out on the way. Fixing it meant reading `poTerms`, which
opened with:

```ts
const today = new Date().toISOString().slice(0, 10);
```

UTC. F63 consolidated the office day into `src/lib/office.ts` after finding the
offset copied into thirteen files, and two stragglers in `derive.ts` — `poTerms`
and `poDetail`, the function that decides whether a delivery is **late** —
survived it, because the sweep looked for the offset string `+08:00` and these
two never spelled it. Between midnight and 08:00 WITA they read yesterday.
Which is to say: a consolidation that searches for the *symptom* misses every
copy that has the bug without the symptom.

## F68 — a comparison column that could not work, and then compared the wrong things

The monthly bills screen (D228) carries one column that is not a restatement of
the cash calendar: **what this line cost last month**, and the percentage
between the two. It took four tries to make that column true, and each wrong
version rendered without complaint.

**One — the column was structurally dead.** `cashPlan()` runs twelve months
*forward* from today, so the previous month is never in it. `monthlyBills` went
looking for last month's cell among those twelve, found nothing, every time,
for every row. Every cell printed `—`. The anomaly banner never appeared. The
rule I had been careful about — *a line that did not exist last month reads —,
never +100%* — was doing all the work, because every line looked like it did
not exist last month.

It is the most comfortable kind of bug: the output was **exactly what the
careful case is supposed to look like.** Nothing was red. A screenshot of it
would have passed review. What caught it was reading the seed and knowing that
August payroll certainly existed.

**Two — the comparison was one week against one month.** Fixed by anchoring a
second plan run at the previous month, the column filled in — with nonsense.
Payroll runs weekly: five rows a month at Rp 30.000.000. Last month's figure
was the whole component's month, Rp 150.000.000. So every payroll row in the
system read **−80%**, five times a month, for ever, and the anomaly banner
counted five anomalies where there was not one.

The rule underneath: **a percentage is a claim that two numbers are the same
kind of number.** One payday and one month are not. So the comparison moved to
where the question actually lives — *did this line move this month* is a
monthly question — and the row now shows `total bulan` beside the figure
wherever the line runs more than once, because a number sitting next to a
single Rp 30 juta payday will otherwise be read as that payday's own history.

**Three — `actual || planned`, in both directions.** Taking a month's `actual`
where the month is still running compared a half-paid September against a
finished August and reported the materials bill as −82% when nothing had
changed. Falling back to `planned` where a finished month had no payments read
*we spent this* when the truth was *we spent nothing*. One rule replaced both:
**a month that has ended is worth what it cost; a month still running is worth
what it is expected to cost** — applied to both sides, so the two halves of
every percentage are always measured the same way.

**Four — and this is the one worth the entry.** Anchoring a plan at a past
month worked, and re-dated the world. August opened with four unpaid paydays
reading *belum jatuh tempo* and *jatuh tempo minggu ini*. The plan believed it
was the first of August, because `cashPlan(state, now)` had always used its one
argument for two different questions:

- **when does the window start** — which month is at the left edge
- **what is *now*** — which bills are overdue, due, still to come

Those had never needed to differ, so nothing said they were two things. The fix
is one extra parameter and a comment that will now outlive me: a month that has
gone by has no bills that are *not yet due*.

There is a general shape here. Three of these four are the same mistake at
different sizes — **a parameter, a fallback, or a window doing double duty**,
where the two duties agreed right up until the day something asked for the past.
It is F62 again (`deliveredFor` answering two questions) and F60 again (a lookup
returning the identity element). The tell is always the same: a value that is
*usually* correct because the two meanings usually coincide.

## F69 — the same bill in two lists

The bills screen splits a month into *lewat tempo · belum dibayar · sudah
dibayar*. A partly-paid bill satisfied two of those filters and appeared in
both — the September payroll of Rp 30.000.000 sat under *belum dibayar* with
Rp 200.000 still owing, and again under *sudah dibayar* with Rp 29.800.000
against it.

Both rows were true. Neither was wrong on its own. The screen was still lying,
because a list of *what do I have to pay this month* that shows one obligation
twice is a list somebody pays twice.

Three lists over one month must **partition** it. The rule that settles which
side a partial falls on is what the screen is for: it is a worklist, so
anything with money still owing belongs to the work, and what has already gone
out against it shows in its own column with `sisa` underneath. *Sudah dibayar*
means finished.

Worth pairing with F65: there the overflow test measured every screen and
missed three faults because it asked *does this fit* rather than *does this
still mean what the screen means*. Here a filter test would pass on both rows
for the same reason. Neither list is wrong; the **set** of lists is.

## F70 — one field called `late_after_minutes`, holding 480

The owner's answer to Q41 set a fifteen-minute grace period. Writing it down
meant finding where it goes, and the rule book already had a field that looked
like exactly the right one:

```ts
late_after_minutes: 8 * 60,   // 480
```

Read as English, that field says *somebody is late after 480 minutes*. Read
against the code, it says *somebody is late after 08:00* — `mins` on the other
side of the comparison is minutes since midnight, not minutes since the day
started.

```ts
return s + Math.max(mins - rules.late_after_minutes, 0);
```

So the field had never been a grace period at all. It was a start time wearing
a grace period's name, and the owner's fifteen minutes had **nowhere to live**:
setting it to 15 would have made everybody late from 00:15.

The fix is two fields, `day_starts_minutes` and `late_grace_minutes`, and the
general rule is the one this project keeps rediscovering: **when one number
answers two questions it is answering at least one of them wrongly** (F62).
What is new here is the tell. The name was a *description of the arithmetic*
(`after_minutes`) rather than of the thing (`day_starts`), and a name like that
cannot be wrong, which is precisely why it hid a conflation for thirty
milestones. `late_after_minutes` is true of both meanings. `day_starts_minutes`
is true of only one.

There is a second finding sitting behind it, unresolved and written down rather
than guessed at. With the day starting at 08:00 and the grace at 15 minutes,
**nobody in the system is late.** The workshop taps in at 06:49, 06:55, 07:02 —
they are an hour early against an office rule, because the fingerprint reader is
a workshop device and 08:00 is when the office starts. One business, two
schedules, one start time. That is a question for the owner, not a number to
invent, and it is in the backlog as such.

## F71 — the worked example that stopped running the rules

The rule-book screen carries worked examples, on the principle that a multiplier
is an abstraction until it is rupiah. The overtime one opened:

```ts
const hourly = 17_500; // upah harian Rp 140.000 ÷ 8 jam
```

Correct on the day it was written, and correct for thirty milestones, because
Rp 140.000 a day was a real seeded rate. Then the pay split (D250) turned that
rate into a pokok of Rp 125.000 plus a tunjangan of Rp 15.000 — the same money,
now in two parts — and the example silently became a claim about a person who
no longer exists, computed from a constant that no rule on the screen can move.

Nobody would have noticed. The number was still Rp 17.500. It is *still*
Rp 17.500 today, because the allowance is included by default and 125 + 15 is
140. The example was right by coincidence, and it would have stayed right until
the day somebody unticked *tunjangan ikut dihitung* and watched the example not
move.

**A worked example that does not run the rules is a screenshot.** It now derives
its hourly from `rules.hourly_includes_allowance` like everything else, and
prints which composition it used. This is the third time the app's own worked
example has been the thing that was wrong — F64 (John Lau refusing his own
subject), F66 (his English chips failing his Indonesian router), and now this —
and the pattern across all three is worth stating: **the examples are written
once and the rules keep moving**, so an example that holds its own copy of a
figure is a copy that will drift. Derive, or delete.

## F72 — the pay split that quietly cut five salaries

The tunjangan is earned per day present. Presence comes from the timesheet. So
the first version counted the days the timesheet says somebody was here, for
everybody, which is what the owner described and what the code already had a
helper for.

The payroll run came out with five office staff on **Rp 0 tunjangan, 0 hari
hadir** — Evin, Putri, Anggun, Andi, Made — every one of them Rp 600.000 a month
worse off than the day before, from a change whose stated property was that it
moved nobody's money.

The fingerprint reader is a workshop device. The office does not use it. **No
taps is not evidence of absence**, and treating it as such is the same class of
error as F60's lookup returning zero: the absence of a record is not a record of
absence.

What is satisfying about the fix is that the system already contained it. Twenty
lines above, `base_pay` makes exactly this split, with exactly this reasoning
already written in a comment:

> Monthly staff are paid the month whatever the machine says; a daily or hourly
> person is paid for what they were here for. That difference is the only place
> `pay_basis` is used, and it is why it exists.

The allowance follows the same rule for the same reason — a monthly person earns
it on the days the business works, a daily one on the days the timesheet
counted — and loses it the way the owner said anybody loses it: HRD deciding,
with a reason. So the comment is no longer the only place `pay_basis` is used,
and the sentence it contains turns out to have been a general rule about this
business rather than a note about one variable.

## F73 — bruto and diterima, computed twice

```ts
gross: base_pay + allowance_pay + overtime_pay - under.amount - late_deduction,
net:   base_pay + overtime_pay - under.amount + adjustment_total,
```

Two longhand sums of the same components, four lines apart, in one object
literal. Adding the tunjangan to the first left the second behind, and the
payroll run rendered a line with **no adjustments at all** showing a bruto of
Rp 24.525.000 and a *diterima* of Rp 24.400.000.

Net is gross plus what a person decided. It was never anything else. Written as
`gross + adjustment_total`, the two cannot disagree; written out twice, they
disagreed the first time anything was added to either.

This is the cheapest finding in the file and the one most likely to recur,
because the duplication is invisible at the point of editing: the two lines do
not look like the same formula, they look like two correct formulas. The tell is
that every component of the shorter one appears in the longer one. Where that is
true, one of them is a definition and the other should be a reference.

## F74 — a stage that is also one of the things collapsed into it

Collapsing seven stages into four meant deciding what happens to the progress
already recorded against the seven. The answer was easy and the arithmetic was
not.

**First mistake: summing.** Four chairs cut, four planed and four assembled
became twelve chairs made, against an order for four. Obvious once seen, and
the fix is obvious too — a piece has finished *Pembuatan* when it has finished
every step inside it, so the count is the **minimum** of the steps, not their
sum.

**Second mistake, and the one worth the entry.** `FINISHING` is the name of one
of the four new stages *and* the name of one of the seven old ones that
collapsed into it. So the code tried to be careful:

```ts
const rolled = min(legacy sub-steps);          // AMPLAS
const done   = total("FINISHING") + rolled;    // direct + rolled
```

Which reads as *the entries written against the new stage, plus the old ones
rolled up* — and there is no such distinction. An entry reading `FINISHING` is
the same string whether it was typed last year under the seven or last week
under the four. The board printed **Finishing 7 of 4**: four sanded plus three
finished, the same three pieces counted twice.

It produced a second, quieter lie on top. The over-count tripped the existing
*a stage cannot be ahead of the one before it* warning, so every order with any
finishing on it carried a red sentence about a mis-keyed number that nobody had
mis-keyed. A bug that manufactures warnings is worse than one that stays quiet:
it teaches people that the warnings are noise.

The fix removes the distinction instead of trying to guess it. Every stage has
a list of **sources** — every code that counts towards it, its own included —
and `done` is the minimum over the sources that actually carried a figure.
`QC` has one source and is therefore itself. The rule generalises: **when a
collapsed thing keeps one of its parts' names, the name is no longer a
discriminator**, and any code that treats it as one is counting something
twice.

**Third, after the numbers were right.** The minimum silently *resolved* a
disagreement the seed had deliberately planted — eleven doors reported finished
where four had been sanded. The count 4 is the honest one; hiding the other 7 is
not. So a later step overtaking an earlier one inside a stage now says so, in
the units of the order, and says which number it used. But only overtaking:
six cut and two assembled is four units on the bench, which is what a workshop
looks like on a Tuesday, and warning about it would bury the real one.

## F75 — the same rule, written twice, in two places that drifted

The API refuses progress on a subcontracted order in two situations: the goods
are at the vendor, or they were never sent. The drawer hid its reporting form
when `at_vendor` — the first of those.

So an order created and not yet given to the vendor showed a full reporting
form, complete with a stage picker, that the API rejected on submit. The probe
found it on the first order it created, which is the only kind of order that
exhibits it: the seeded ones were all either already sent or in-house.

Two conditions describing one rule will drift, and the drift is invisible
because neither side is wrong on its own — `at_vendor` is a perfectly good flag,
and the API's pair of refusals is right. What is wrong is that the screen asked
a *similar* question instead of the *same* one.

It is now one exported predicate, `goodsOnSite(wo)`, read by the API and by the
screen. The general form is the rule this codebase already applies to figures
and had not applied to conditions: **derive it once and reference it**, because
the second hand-written copy is the one that will be a version behind. F73 was
this with two sums; this is the same mistake with two booleans, found four
hours apart.

Worth noting what *found* it: not a test of the rule, but building a work order
through the interface like a person would. The seeded data could not express
the failing state, so nothing that read the seed could have caught it.

## F76 — a sub-assembly priced at twice its cost, for one afternoon

Adding revisions to the BOM meant every read of `bom_components` had to say
*which revision*. Most of them were obvious. One was not:

```ts
function subAssemblyCost(state, product) {
  const rows = state.bom_components.filter((b) => b.product_id === product.id);
```

That function prices a drawer box so a wardrobe's BOM can cost the drawer boxes
inside it. Before revisions it was right: one product, one component list. After
revisions it sums **every line ever written for that product** — rev 1 and the
draft rev 2 that was copied from it — and a drawer box with a draft open costs
roughly twice what it costs.

Caught by reading rather than by running, because nothing in the seed had a
draft on a sub-assembly. It would have appeared the first time somebody edited
one, in a figure nobody would have questioned: a wardrobe is expensive, and
being 40% more expensive than it should be does not look like a bug.

The rule it teaches is about the shape of the change rather than the bug.
**Adding a dimension to a table makes every existing query on that table
ambiguous**, and the compiler cannot see it — `filter(b => b.product_id === id)`
type-checks perfectly before and after. The only defence is to enumerate the
readers: `grep` for the table, not for the error. Two readers, one already
right, one silently wrong.

## F77 — a diff that was one edit behind

The BOM drawer showed what an open draft changes against the released revision.
It fetched that diff through its own call:

```ts
const [diff, reloadDiff] = useLoad(() => production.getBomDiff({ product_code }), [productCode]);
```

Adding a component reloaded the product. It did not reload the diff. So the
panel went on rendering the answer to a question about a state that no longer
existed — and because the first edit is also what *opens* the draft, the stale
answer was the diff from **before there was a draft at all**: `to` fell back to
rev 1 and `from` to null, so the panel confidently listed all four of rev 1's
components as newly added, and did not list the one component that had actually
just been added.

Every number on it was wrong and none of it looked wrong. It is exactly the
shape of thing this project spends its refusals on, arriving through the back
door — not an invented figure, but a **correct figure about the wrong moment**.

The fix is not `reloadDiff()` in two more handlers. It is that a diff over a
list should be derived from the list, not fetched alongside it: `draft_diff` is
now computed inside `productView`, from the same components the table below it
renders, so the two cannot describe different states. The separate endpoint
stays for callers that want an arbitrary pair of revisions.

Three findings in two days now share one sentence — F73 (two sums), F75 (two
booleans), this (two reads of one state). **If two things must agree, one of
them has to be derived from the other.** Keeping them in step by remembering to
is not a design, it is a promise nobody can keep.

## F78 — the purchase request that quietly left out half the wardrobe

`Buat PR dari BOM` has existed since M23. It turns a work order's material
projection into a draft purchase request, one line per thing to buy. It built
those lines like this:

```ts
lines: needs.data.lines
  .filter((l) => l.kind === "material")
```

Sensible-looking: a BOM line is either a purchased material or another product,
and you cannot buy another product, so filter to the ones you can buy.

Six wardrobes need twelve drawer boxes. A drawer box is 0,5 sheets of plywood
and a set of runners. The request raised for those six wardrobes contained
**none of that** — no plywood, no runners, no screws — and nothing anywhere
said a line had been dropped. The workshop would have discovered it at the
bench.

The filter was not wrong when it was written. The BOM was flat in practice, and
one level was a deliberate decision with a comment explaining it. What changed
is the owner's answer to Q5 — *bom berlapis* — and the filter went on doing
exactly what it always did.

Two things worth keeping.

**A filter that excludes a kind is a decision about that kind**, and it needs to
say what happens to it. `filter(x => x.kind === "material")` says nothing about
the products; `.map(explode)` would have. A dropped row and a handled row look
identical downstream, which is why this survived.

**The screen showed the total, not the lines.** *Proyeksi BOM Rp 3.338.600* was
right — `material_cost` costed the drawer box through `subAssemblyCost`, one
level down — so the summary agreed with the BOM while the request built from it
did not. **A correct total is not evidence that the list behind it is
complete**, and the summary is the thing everybody looks at.

## F79 — the self-check that raced itself

`/demo` proves the refusals are real by exercising them against the demo API:
approve without the authority, allocate more than the transfer moved, and so
on. Twelve checks, and one of them started failing about one run in four:

```
D125 — approving a request with no document behind it
expected 422 support_required   got 403 authority_required
```

403 means *you are not the CEO*. The probe becomes the CEO on the line before.

Polling the acting user through a run showed it:

```
run 1  putri → made → putri → evin → andi → …          12/12
run 2  putri → made → putri → evin → putri → andi → …  FAIL
```

An extra `putri` between `evin` and `andi`. The only code that sets Putri is a
run's own `actAs(original)` at the end — so **a second run was finishing while
the first was still going**. `reactStrictMode` invokes the mount effect twice in
development, and the probes mutate a single global acting user, so the two runs
interleaved their `actAs` calls and stole the identity out from under each
other.

The guard has to be a **ref**, not the existing `running` state: a state update
lands on the next render, and by then the second caller is already past the
check.

What makes this worth writing down is not the race. It is which thing broke.
The failing check was **the mechanism that demonstrates the rules are
enforced**, and it failed *intermittently* and *convincingly* — with a real
status code, a real error code, and a message that reads like a genuine
regression. Someone would reasonably have spent an hour looking for a bug in
`approveLine`.

That is F74's lesson arriving somewhere more expensive. There, a counting bug
manufactured warnings about mis-keys nobody had made, and the risk was that
people learn to ignore warnings. Here a test manufactures a failure, and the
risk is that people learn to ignore the test — or worse, "fix" the thing it
accuses. **A check that can be wrong about the system is worse than no check,
because it spends the credibility of every check beside it.**

## F80 — four red rows describing one healthy payment

The contribution audit compares what the roll of names says a scheme should
cost against what actually went out. Built per scheme, it read:

```
BPJS Kesehatan     3 orang   seharusnya Rp 1.225.000   dibayar Rp 1.525.000  +300.000
Jaminan Hari Tua   5 orang   seharusnya Rp 2.671.020   dibayar Rp 3.310.689  +639.669
Jaminan Pensiun    2 orang   seharusnya Rp   526.269   dibayar Rp 0          belum ada baris kas
Jaminan Kecelakaan 2 orang   seharusnya Rp    72.900   dibayar Rp 0          belum ada baris kas
Jaminan Kematian   2 orang   seharusnya Rp    40.500   dibayar Rp 0          belum ada baris kas
```

Five rows, four of them wrong, and the money was fine. **One BPJS
Ketenagakerjaan invoice pays all four TK schemes.** Tying the cash line to a
single scheme meant JHT claimed the whole payment and looked like an overcharge,
while JP, JKK and JKM looked unpaid.

The model was wrong in a specific and repeatable way: `scheme_code` was
singular because each scheme has one rate, one roll and one expected figure —
all true — and none of that is the unit the **money** moves in. The invoice is.

So the audit groups by the cash line and the field became a list. What falls
out of the regrouping is worth more than the fix: the unknowns had to be made
to dominate. If any scheme on an invoice has no rate for the month, the
invoice's expected total is **unknown**, not the sum of the ones that do have
rates — because that sum is a confident figure missing a part of itself, and it
would be compared against a payment that includes the missing part.

The lesson generalises past this screen. **Group a comparison by the thing being
compared, not by the thing being computed.** Contributions are computed per
scheme; they are paid per invoice; the audit is about payment. Getting that
backwards produces rows that are individually defensible and collectively a
lie — the same shape as F69, where three lists each correct made one bill
appear twice.

## F81 — the module built to avoid scoring people on missing data did it twice, in opposite directions

The KPI analyzer exists to measure people, so it was written defensively from
the first line: *unmeasured is not zero*, in a comment, at the top. It then got
the same question wrong twice on the way to the first screenshot.

**First run: every office worker rated 4% present.** Attendance divided present
days by scheduled working days. Present comes from the timesheet; the timesheet
comes from taps; the office does not use the fingerprint reader. So Andi, who
had worked every day of the month, was rated 4% — one day in twenty-five.

This is F72 exactly. Two days earlier, the pay split cut five office salaries by
Rp 600.000 for the same reason, and the finding was written up with the sentence
*no taps is not evidence of absence*. Knowing the rule, and having written it
down, was not enough to stop writing the code that violates it — because the
violation does not look like the rule. It looks like a division.

**Second run: everybody rated 100%.** The fix measured attendance over *days the
system has a record for*:

```ts
const recorded = days.filter((d) => d.slots.in !== null || d.mark !== null);
```

`slots` is a `Partial<Record<ScanSlot, string>>`. An absent tap is `undefined`,
not `null`. `undefined !== null` is true, so every calendar day counted as
recorded, and all forty people scored 100% on a measure that had just been
rated 4%. The same missing-data question, answered wrongly in the opposite
direction, by a comparison operator.

**Third pass: a figure over two days is not a figure.** With the operator fixed,
office staff read *100%, 2 dari 2 hari yang tercatat* — true, and carrying a
full 25% of a performance score on a two-day sample. A floor now marks a thin
basis as unmeasured.

Three things worth keeping.

**A rule in a comment does not protect the code under it.** The file opens with
*unmeasured is not zero* and then contains two ways of treating unmeasured as
something. What would have caught it is not more care, it is the habit of
looking at the output for a person the data does not cover — which is one probe.

**`undefined` and `null` are the same fact and different values.** Everywhere
missing data matters, `!= null` is the comparison that means *has a value*, and
`!== null` is a trap that type-checks. This codebase has now been bitten by the
missing/zero distinction in F60, F62, F72 and here.

**And the seed could not demonstrate the module.** With a five-day floor, no
calendar month in the data has enough taps — the real export covers ten days
across a month boundary. The honest fix was not to lower the floor to flatter
the seed; it was that **a calendar month is the wrong period for performance**.
Attendance arrives in fortnights, and the payroll run already carries the period
somebody was actually paid for. The screen now takes a date range and defaults
to the last run's, and 24 of 40 people score over the window the data covers.
A rule that makes a screen look broken is sometimes telling you the screen was
asking the wrong question.

---

## F82 — half of "the QR work" was never waiting on a backend

The QR work had sat in the backlog since Q29 as one item, filed under Phase 2
with a clear reason: a QR is only useful if somebody can scan it and land
somewhere, and landing somewhere needs a public read route and a token, which
needs a backend.

That is true of exactly half of it, and the half it is true of is the smaller
half.

The reason it needs a public route is that **a vendor has no account here**.
Print a QR on the PO PDF, the supplier scans it, and they must reach a page
that shows them the status of their own order without logging in — a public
route, a token per order, scoped so one supplier cannot read another's. All of
that is real, and all of it waits.

But the other QR in the backlog is on a **packing box**, and the person who
scans a packing box is our own installer. They have an account. They are
already signed in on the phone in their hand. The scan opens a page inside the
application, behind the ordinary login, exactly like every other page they use.
There is nothing public about it and nothing to wait for.

The two had been filed together because they are both "QR", which is a fact
about the technology and not about the problem. **The question that separates
them is not what the label is made of, it is who is holding it** — and that
question was never asked, because the two items looked alike on the shelf.

So the box half was built in this phase, and the vendor half is still Phase 2:
the PO screen renders its QR with a note saying what it does and does not do,
and it is deliberately **not** printed on the PDF the vendor receives. A QR
that fails for the person holding it is worse than no QR — they photograph it
three times before deciding the company is careless.

---

## F83 — the well-argued decision that never asked who was holding the phone

The QR encoded the box code, `kol-26-09-02_01`, and the file said why at
length: a label is glued to a wooden crate and travels for months, a URL
printed on it is a promise about a hostname we would have to keep for ever, and
the code is the thing that is true whatever the address turns out to be.

Every sentence of that is correct. The conclusion was still wrong, and it took
building the print sheet to see why.

**The scanner is a stock phone camera.** Not our app — the camera the installer
already has open, the way anybody scans anything. A camera that reads a URL
opens the box's page. A camera that reads `kol-26-09-02_01` shows a line of
text, and the person retypes it into a search box. The QR has then saved them
nothing at all.

The code-only design only pays off if we ship a camera scanner *inside* the
app, and that is where it collapses: `BarcodeDetector` does not exist on iOS
Safari, so an in-app scanner means a WASM decoder in the bundle. The simple
design needed the complicated dependency to work, and the complicated design
needed nothing.

The hostname objection survives and is answered **by the label rather than by
the QR**: the code is printed under it in mono, large enough to type. A moved
domain degrades a label to exactly what the code-only design would have given
us on its best day. And because the URL is built from whatever host the label
is printed from, it is right for as long as that host is.

Then it was measured rather than argued. At the 31.7 mm the label gives it, a
URL on our own domain is 33 modules — 0.86 mm each, against the ~0.5 mm a phone
needs at arm's length. Even an 84-character Vercel preview hostname stays at
0.58 mm. **The thing the whole argument was protecting the label from costs it
nothing.**

Two things worth keeping. A decision can be internally sound and still wrong,
because soundness is about the argument and correctness is about the world —
and the way to tell is to name the person and the object in their hand. And
when a trade-off is about a physical quantity, **measure it before writing the
paragraph**: one script that prints millimetres per module would have settled
this before the first doc comment was written.

---

## F84 — two seeded rows sharing a primary key, found by the feature that needed one

The production seed had two rows with `id: "prg_23"` and two with
`id: "prg_24"`: one pair on the pintu work order, another pair added later for
the four-stage order, written by copying the block above and not renumbering.

It had been there since M47 and nothing had gone wrong, because **nothing in
the system had ever looked a progress entry up by its id.** Every reader of
that table filters by work order, sums by stage, or groups by date. A duplicate
id is invisible to all of them.

W5 is the first feature that needs one: linking a name to a person writes to
entries individually, and `draft.production_progress.find(p => p.id === t.id)`
would have found the wrong row half the time — silently, and only on those
four.

Two things worth keeping.

**An unused key is an unchecked key.** A primary key that nothing dereferences
is not being validated by anything, and duplicates accumulate in it quietly. It
had survived a typecheck, a build, and every probe run in six milestones.

**And the thing that found it was reading the file, not running it.** It was
spotted while working out what to attach the link to — the ids were on screen,
next to each other, and the pattern was obvious once anybody was looking at ids
rather than through them.

---

## F85 — the matcher was blind in the exact case it existed to protect

The name-linking screen offers a suggestion when one active employee's name
matches, and offers nothing when several do — because there is an *Andi* in the
workshop (B-036) and an *Andi Prasetyo* in the office (K-011), and offering
either one is worse than offering neither.

The first version compared full names for equality. Run against the seed, the
row for *Andi* came back with **one confident suggestion: B-036 · Andi**.

Equality is exactly the wrong test here. *Andi* equals *Andi* and does not
equal *Andi Prasetyo*, so the one name in the register with a genuine collision
was the one name the code was certain about — and certainty is what gets
clicked. The ambiguity guard was there, was correct, and never fired.

A candidate is now somebody whose full name **is** the name or **begins with it
as a whole word**: *Andi Prasetyo* is a candidate for *Andi*, and *Sumi* is not
one for *Sumiati*. More than one candidate and there is no suggestion at all,
exact match or not.

The lesson is not about string matching. **A guard that never fires on the
data it was written for has not been tested, it has been assumed** — and the
way to find out is to look at what the screen actually says about the row you
wrote the guard for, which took one probe and no reasoning at all.

---

## F86 — nine stock issues pointing at two work orders that never existed

Every `issue` move in the seed carried `ref_no: "spk-26-08-05_01"` or
`"spk-26-08-12_01"`. Neither is a work order. The seven that exist are
`spk-26-08-10_01`, `-24_01`, `-24_02`, `-28_01`, `-30_01`, `spk-26-09-01_01`
and `-09-02_01`.

Nine issues and one return, written in M27, pointing at nothing for six
milestones — and **no screen could have said so**, because until D266 nothing
in the system ever joined a stock move to a work order. The column was
displayed, never dereferenced. The stock drawer printed `spk-26-08-12_01` in
grey mono next to the move and had no reason to ask whether it resolved.

This is F84 again, two commits later and in a different table: a **key nothing
follows is a key nothing checks.** F84 was two rows sharing a primary key,
invisible because nothing looked entries up by id. This is a foreign key with
no referent, invisible because nothing looked the referent up. Both survived
typechecking, builds and every probe run, and both were found by the first
feature that actually needed the reference to work.

The seed is repointed — the lemari issues to `spk-26-08-28_01`, the meja
finishing issues to `spk-26-08-24_01` — and **the quantities are deliberately
unchanged.** They were written as plausible workshop activity with no BOM to
check them against, and now that there is one the comparison says they do not
match: 85 sheets of amplas against a list calling for 32, engsel at 96 against
36. That is not a defect of the seed. It is exactly what this business will see
on its first day with a BOM behind the rack, and the panel is careful to call
it *in progress* rather than *overrun* until the run is actually finished.

The cheap guard that comes with it: `StockMoveView.ref_missing` follows any
`spk-` reference and the stock drawer marks it in amber. It has nothing to show
in the demo now that the seed is clean, which is the point — a guard earns its
place by what it would catch, not by what it currently displays.

---

## F87 — the message that described a road the order had not taken

Creating a purchase order ended with a toast: *`po-26-09-13_01` drafted —
HADI GLASS · Rp 6.000.000 — ask leadership to confirm it before it goes to the
supplier.*

Every word of it was correct until W2 shipped, and then it was wrong for
exactly the orders W2 was built for. Leadership writing their own order now has
it confirmed in the same act — the API says so, `self_confirmed` is true on the
row, and the banner on the order itself says so. The toast, three lines away,
still told them to go and ask.

One fact — *has this been confirmed* — written in two places, and only one of
them updated. That is F73 and F75 again in a third costume: there the two
places were two sums and two booleans; here they are an API result and a
sentence. The fix is the same shape it has been every time: **read the answer
instead of assuming it.** The toast now branches on `res.data.self_confirmed`
rather than on what the form knows about the world.

What is worth noticing is how it was found. Not by reading the diff — the toast
is in a different file from everything W2 touched, and nothing about it looked
stale. It was found by **driving the feature end to end and reading what the
screen actually said**, which is the same way F81 and F85 were found. A probe
that stops at *the API returned 200* would have passed.

---

## F88 — a label nobody could open is a label nobody could check

The vendor page carried a chip reading *photo of the goods* next to every
delivery. B2 asked for it to be openable. Within a minute of it opening, the
first one tried showed a file called **`tanda-terima-hadi-0708.jpg`** — a
receipt acknowledgement, filed as the photo of the goods, on two seeded
receipts.

The link kind said `Receiving Item`, the filename said tanda terima, and the
screen had been confidently printing *photo of the goods* over the top of it
for however long. Nothing could have caught it: a boolean `has_photo` is true
whether the file behind it is a photograph, a receipt, or a blank page.

This is the same shape as F84 and F86 one level up. Those were keys nothing
dereferenced; this is a **claim nothing opened**. In all three cases the data
was displayed and never followed, and in all three the first feature that
followed it found the error immediately.

The corollary is worth stating as a rule, because it keeps recurring in this
codebase: **anything a screen asserts about a file should be one tap from the
file.** Not because users want to click, but because a claim that can be
checked is a claim that gets checked — by whoever is reading the screen, for
free, every day.

---

## F89 — a rule that changed mid-window was applied to the whole window

The KPI screen takes a date range. Punctuality was computed like this:

```ts
const rules = activePayRules(state, from).rules;   // the book on the FIRST day
```

— and then every day in the range was judged against it. Correct for every
window that sits inside one version of the rule book, which is every window
anybody had tried, and wrong the moment one spans a change.

It surfaced the same day Q44 was answered, because Q44 *is* a rule change: with
the workshop's start time corrected from 1 September, a window of 29 August to
7 September holds days under two different books. The screen read the September
days against August's 08.00 and reported a workshop that was never late — which
is the exact illusion F70 was raised about, arriving a second time through a
different door.

Each day is now judged by `activePayRules(state, d.work_date)`, and the basis
line names **every** threshold it used rather than one: *5 dari 5 hari tepat
waktu (masuk 08.00+0m dan 07.30+15m)*. A window spanning a change says so
instead of averaging it invisibly.

Two things came out of it.

**This is F68's shape again.** There, `cashPlan(state, now)` used one argument
for *where the window starts* and *what counts as today*; here one date decided
*which window* and *which rule book*. Both were correct until something asked a
question the second job had never been asked. When one value is doing two jobs,
the bug is not in the value — it is in the day somebody needs the two to
differ.

**And the tie-break was undefined.** `activePayRules` sorted by
`effective_from` alone and took the last: with two versions sharing a date —
which happens the moment a correction is dated to the version it corrects — the
winner depended on the order the rows happened to be written in. A dated rule
book whose answer depends on array order is not a dated rule book. It now sorts
by date **and version**.

---

## F90 — a note that stopped a day being paid

The 45-minute break allowance was added to `issues`, which is the list a day
carries when the reader could not describe it. An entry there sends the day to
`review`, and a day in review cannot be paid until a person opens it.

So a break that ran five minutes long stopped somebody's wages.

`issues` and the new `notes` do different work and the difference is the whole
point: *the rule could not fit the taps* is a blocker, *something here is worth
a second look* is not. They had never needed separating because everything that
had ever been written to `issues` genuinely was a reading failure — a missing
pulang, a tap the rule could not place. The break is the first thing this
system has wanted to say about a day it understood perfectly well.

Worth noticing: **the count was the only symptom.** The screen's *days to read*
went from 32 to 50 and nothing else looked different — no error, no wrong
figure, just more amber. The number was the thing that asked the question, and
it was worth chasing rather than accepting, which is also how the 50 turned out
to be a mid-edit artifact once it was measured properly against the baseline.

---

## F91 — the answer that broke yesterday's answer

Q44 was answered on 13 September as *produksi 07.30, kantor 08.00, istirahat 45
menit*, and built the same day: `day_start_by_unit`, a start time per unit, in
the dated rule book. It was right for the sentence it was given.

The next day the same question came back with the rest of it. Production is
**07.30–16.30** with 45 minutes. The office is **08.00–17.15** with an hour.
**Friday has a longer break** than the other days. There is a guard on a
**twelve-hour shift**. There is a house assistant who **starts at two in the
afternoon**.

A map of one number per unit cannot hold a single one of those beyond the first
— not an end time, not a Friday, not a shift with no stated start, and not a
person whose hours are their own rather than their unit's.

What is worth keeping is not "ask better questions". The first answer was a
true answer to the question asked, and the question was a reasonable one. What
the second answer shows is that **the shape of a rule is a claim about the
world, and a narrow shape asserts the world is simple.** `Record<string,
number>` said: every unit has exactly one number, and that number is a start
time. Nobody wrote that assertion down and nobody checked it, because it was
carried in a type rather than a sentence.

The replacement says less. A schedule may have no start time, no end time and
no break, and each absence means *nobody has stated this* rather than zero. The
guard's twelve hours begin at a time nobody has fixed, and a person on that
pattern reads **tidak terukur** on punctuality — never *never late*, which is
the exact illusion Q44 was raised about in the first place (F70).

---

## F92 — a stage nobody uses is not a stage at zero

Adopting the owner's four stages put *Machinery / instalasi* third. Almost
nothing in the seed has anything to install — a dining table has no lamps in it
— so the column reads empty on nearly every order.

The board then warned, on nearly every order, that **Packing had overtaken
Machinery**: work that had jumped a step, a mis-keyed number, somebody should
look. All of it manufactured, from one reading: `done: 0`.

`done: 0` answers two different questions. *Nothing has passed this stage yet*
and *this order does not go through this stage* are different facts, and the
comparison that produces the warning is only meaningful against the first. An
unknown cannot be overtaken.

This is F74 one level out. There the error was adding a stage's direct entries
to its rolled-up ones because the two could not be told apart; here it is
comparing against a number that was never reported. Both times the fix is the
same shape: **stop inferring the fact from the figure, and carry the fact.**
`StageProgress.recorded` says whether anybody reported anything at all, and the
overtaking check skips any comparison whose earlier stage nobody has written
against.

The thing to keep is that **a warning that fires on almost everything is a
warning nobody reads**, and the cost is not the noise — it is the one real
overtaking in the seed, which was sitting in the same list as thirty invented
ones and would have been scrolled past with them.

---

## F93 — the guard that refused a migration for writing down a refusal

`0038` moves John Lau's catalogue into the database. Sixteen tool names go in
as rows, and five of them are the names of things the owner said may never be
asked through a prompt: `hr.payroll`, `hr.attendance`, `hr.employee_files`,
`it.audit`, `it.settings_write`.

`check_schema_isolation.sh` refused the file. It had found `hr.` at the start
of a qualified name, and `hr` is one of the legacy system's own schemas — the
whole reason that script exists is that our half of this shared database is
`ops_*` and nothing else.

It was reading a **string literal**. `'hr.payroll'` is data: the name of a
capability, in a column, about to be inserted. It reaches into nothing.

The interesting part is not the regex. It is what a false positive costs a
guard. This one had been right every time it fired, which is exactly the
standing it needs to stop a real `alter table public.vendors` at 7pm on a
Friday. The first time it is wrong, the cheapest way past it is to widen
`LEGACY`, or to rename the tool, or to add a `# shellcheck`-shaped exemption
— and each of those leaves the guard a little less able to do the thing it is
for. `blank_comments` already says this in its own comment: *a guard that
points at innocent code is one people learn to argue with rather than fix.* It
said it about line numbers, and then the same script did it about literals.

The fix is a carve-out narrow enough to state in one sentence: **a
single-quoted run with no whitespace in it is blanked**, because the thing this
guard exists to catch is a *statement* and a statement does not fit inside one
token. `'public.vendors'` on its own does nothing to anybody; `execute 'drop
schema public cascade'` has spaces in it and is still caught. All three shapes
— a bare qualified name, a bare `drop schema`, and a DDL string inside
`execute` — were re-run against the patched guard and all three still fail the
file.

What generalises: **when a guard fires on something innocent, the fix belongs
in the guard's precision, not in its scope.** Widening what it permits and
narrowing what it inspects look similar in a diff and are opposites.

---

## F94 — the guard whose scope was typed out by hand

`scripts/check-api-parity.mjs` is the only thing that stops the demo client and
the real one drifting apart. ADR-009 says a screen cannot tell which of the two
it got, and that claim is worth exactly as much as this check.

It opened with:

```js
const SERVICES = ["identity", "procurement", "accounting", "documents"];
```

`src/lib/api/assistant.ts` was written, exported from `src/lib/api/index.ts`,
and swapped in for the demo — five functions, one of which confirms a write —
and the check said `ok (82 of 104 match)`. It was not wrong about the
hundred and four. It had simply never opened the file.

Derived from `src/lib/api/index.ts` instead, the same line reads `ok (87 of 109
match)`. The five that appeared were the five it had been blind to, and they
happened to be fine. The next five might not be.

What makes this worth writing down is not the missing name. It is **which**
name was missing: the newest one. A hand-kept scope is always complete for the
code that existed when somebody last thought about it, so the thing it stops
covering first is always the thing most likely to be wrong. The failure mode is
not a guard that breaks — it is a guard that keeps saying `ok`, in a smaller
and smaller voice, while the surface it was written for grows past it.

`check-live-routes.mjs` already read that file for its own list, three metres
away, and the reason given there is the same one: *adding a service to the live
set means writing it, not editing a list.*

The rule: **a guard's scope is read, never typed.** If a check needs to know
what exists, it asks the thing that knows.

---

## F97 — the tab that said `undefined`, on every screen we have

*(F95–F96 are reserved: they exist on `claude/serene-euler-eq2qef`, which is
not merged. Numbering around them costs nothing and keeps that branch
harvestable without a renumber.)*

Adding a 404 page meant giving it a `<title>`, which meant reading `BRAND`
from a server component. It came back `undefined`. So did the one in
`app/layout.tsx`, which has read it the same way since the layout was written:
**every tab in this application has been titled `undefined`** — sign-in,
dashboard, all fifty-nine routes — and nobody noticed, because nobody reads a
tab title twice. The comment on `BRAND.documentTitle` says exactly that, and it
was right for the wrong reason: the title was never being read at all.

The cause is one line. `src/lib/brand.ts` opened with `"use client"`, and the
module holds two unlike things behind it — `BRAND`, a plain constant, and
`useBrand`, a hook over `DemoProvider`. The directive was there for the hook,
but it applies to the module: across the boundary the constant stops being a
constant and becomes a client reference, so a server component reading
`BRAND.documentTitle` gets `undefined` rather than an error. The build stays
green. Nothing anywhere says the value did not arrive.

The directive was never needed. A hook does not require `"use client"` — the
components that *call* it do, and all five already declare it. Removing the
line fixes the constant on the server and changes nothing on the client.

Two things to keep from this.

**A value that degrades to `undefined` instead of throwing will not be caught
by a build.** `metadata.title` accepts `undefined` and renders no tag at all,
so the failure mode is an *absent* element — and every check we have looks at
things that are present. The 404 only exposed it because it was the first
server component written since the layout, and the first time anyone diffed
rendered HTML against what the source said should be in it.

**`"use client"` is a property of a module, not of the export you had in
mind.** A file mixing a constant and a hook will hand the constant to the
client graph on the strength of the hook alone. The split we now rely on is
implicit; if `brand.ts` grows anything that genuinely needs the directive, the
constant has to move to its own file rather than the directive coming back.

---

## F98 — the plan counts a system that has since doubled

Picking up Phase 2 meant reading `03-estimate.md` to see what was left, and two
of the figures it reasons from no longer describe this repository.

**Services: the documents say eight, `src/lib/live.ts` implies eleven, and
there are ten.** `phase-2/README.md` opens with "52 screens, 8 services"; the
comment in `live.ts` says `src/lib/api` implements "three of the eleven" and
calls the remainder "the eight unimplemented services". `src/demo/api/index.ts`
exports ten, and it is the list by construction — it is what screens import.
Three are built, so **seven** are outstanding, not eight.

**Service functions: the estimate says 154, and there are 280.** That figure
was measured at the end of Phase 1, at M26. M27–M64 added the pay split, the
schedules, the KPI board, vendor legs, the BOM revisions and the rest, and
nobody re-counted. B2 is sized as "2.583 lines of TS logic" and B3 as "~25
functions" — both anchored to the smaller surface.

The consequence is not that the estimate is wrong. It is that **20–33 sessions
is a floor rather than a range**, and the two items that grow are the two the
document already calls the largest and the most load-bearing. Anybody planning
against 3–5 weeks should know the denominator moved under it.

The thing worth keeping: **a number in a planning document is a measurement
with a date on it, and this one had neither.** The counts above are one command
each against the code (`grep -c '^export \* as' src/demo/api/index.ts`,
`grep -c '^export \(async \)\?function' src/demo/api/*.ts`). A figure that can
be re-derived in a second and is quoted from memory for thirty milestones is a
figure that will be wrong by the time it decides anything.

---

## F99 — the one mark that can be worth money was the one that could carry no evidence

`hr.day_marks` transcribed almost mechanically from `02-database.md`, and then
stopped on *sakit*. The rule is that a sick day is paid when a `Surat Dokter`
is linked to the mark, on the same evidence road as every nota and receiving
photo (D144, ADR-010). The road is `core.attachment_links`, and its
`entity_no` is **a public code, never a uuid** (ADR-004).

`day_marks` had no public code. The design's diagram gives it `id` and nothing
else, so the single mark that can reach a payslip was the single one that could
not be attached to.

It survived design review because in the demo the distinction does not exist.
There a mark's id *is* `dmk_03` — readable, stable, quotable — so
`entity_no: mark.id` is both a uuid-shaped key and a public code at once, and
the fixture and the derivation agree with each other. Against a database they
come apart: `id` becomes `gen_random_uuid()`, and an `entity_no` holding it
breaks the one rule that makes the evidence road survive a service being split
out.

The fix is `mark_no`, from `next_doc_number('dmk')`, and the precedent was
already written down: `rcv` was added to `doc_prefixes` during procurement for
this same reason, with the comment *a prefix nobody has registered is a number
nobody recognises*.

Two things to keep.

**A fixture id that reads like a public code hides whether the code exists.**
Every demo id in this project is human-readable, which is what makes fixtures
reviewable — and it means no screen, no derivation and no review can tell a
public code from a primary key. The places that will bite are exactly the ones
where the two are different columns in Postgres, and there is no way to find
them by reading the demo. They are found by writing the table.

**The audit trail was right to disagree.** `writeAudit` records a mark as
`work_date/employee_no` — `2026-09-03/B-009` — while the link records the
mark's id. That looked like a drift worth reconciling and it is not: one is a
key a person reads in a trail, the other is a key a row points at. Making them
the same string would have been the tidy answer and the wrong one.

---

## F100 — "pending" defined as *not the other things* counted a decision as a queue

`v_payroll_run` reports how many overtime hours in a period are still waiting
on somebody. The first version said what waiting was **not**:

```sql
sum(c.hours) filter (where not c.payable and c.stage <> 'declined')
```

which reads perfectly and is wrong. `overtime_stage_t` has eight values, and
two of them mean *decided against*: `declined` for a production sheet
leadership refused, and `unpaid` for a staff sheet HRD turned off. The filter
excluded the first and swept the second in, so a night HRD had already ruled on
— with a written reason, on screen — came back to payroll as outstanding work.

It was found by an assertion that was written before the view was run, and
failed with `not pending, it is decided, got 2`. The two hours were Rina's
tutup-buku session from the smoke's own staff branch, three blocks earlier.

The fix is to name the waiting states instead:

```sql
filter (where c.stage in ('waiting_hrd','waiting_surat','waiting_leader'))
```

Same answer today, different behaviour tomorrow. **A negative filter over an
enum grants membership by default**: the ninth stage anybody adds is pending
unless they remember this line, and nothing will fail when they do not — the
figure just quietly grows. A positive one refuses by default, and a stage that
belongs in the queue has to be put there on purpose.

The general form is the one this project keeps arriving at from different
directions. F92 was a `done: 0` that answered two questions at once; C11 was a
demo id that was a primary key and a public code at once. Here it is a filter
that means *waiting* and computes *not yet resolved*. Each time the fix is the
same: **stop inferring the category from the absence of the others, and state
the category.**

---

## F101 — a rule nobody had to decide until `ORDER BY` demanded it

`day_marks` allows two marks on one date for one person: their own, and the
office-wide one whose `employee_id` is null. The constraint permits it
deliberately — a public holiday is declared once for everybody, and somebody
may already have been marked *sakit* on that date.

The demo reads the mark with `.find()`:

```ts
const mark = state.day_marks.find(
  (m) => m.work_date === workDate
    && (m.employee_id === null || m.employee_id === employee.id),
) ?? null;
```

Whichever the array holds first wins. In the fixtures that is stable, so the
screens have always agreed with each other, and the question has never been
asked: **when somebody is marked sick on a day the whole office is closed,
which mark decides what the day is worth?**

They give different answers. `sakit` with a letter is `day_value = 1`;
`holiday` is `0`, and its hours become overtime instead. So the two readings
differ by a day's pay and by whether the hours are claimable.

SQL cannot punt. A query without `ORDER BY` returns rows in whatever order the
plan produces, and the same function would answer differently after a vacuum.
`read_day` orders the personal mark first — specific over general, which is the
ordinary reading — and this entry exists because **that is a decision I made,
not one the design records.** It is worth putting to the owner: the argument
for the other direction is real, since nobody works on a tanggal merah and a
sick day spent on a closed day arguably should not be drawn from the person's
entitlement at all.

What to keep: **an ambiguity survives in a language that lets you not choose.**
`.find()` on an array, `LIMIT 1` without `ORDER BY`, the first row of an
unordered read — all of them answer a question nobody knew they were asking,
and they answer it consistently enough that it never surfaces. Transcribing to
a database is where they surface, because the database refuses to pretend the
order was ever meaningful.

---

## F102 — `::date` on a timestamptz is the office-day bug wearing a third face

The gross smoke seeded a person's attendance and asserted three counted days.
It got one. The fixture was:

```sql
select employee_id, t::date, t, ... from unnest(array['2026-08-24 07:30+08', …])
```

`2026-08-24 07:30+08` is `2026-08-23 23:30` in UTC, and the cluster runs in
UTC, so `t::date` is **the day before** for every morning tap in the fixture.
Three days of scans landed on four dates, and only one of them lined up with a
mark. `ops_core.office_day(t)` is the function that exists for exactly this,
and using it fixed the fixture.

This is F17 and F39 again, and the third time is the finding. The rule *the
office day is `Asia/Makassar`, not UTC and not the browser's* is written down,
is rule 8 of the build session's inherited rules, and has a function to enforce
it — and it still went wrong, in a test, written by somebody who had read all
three. Because `::date` is not where anybody looks for a timezone. It reads as
a cast, not as a conversion, and the wrong answer is a plausible date rather
than an error.

Two things worth keeping.

**The failure was silent in the direction that matters.** No constraint was
violated, no row was rejected, and the scans were all there. What moved was
which day they belonged to, and the only reason it surfaced is that an
assertion had a hand-computed number in it. Had the test asserted *whatever the
view returns*, three days on four dates would have been the expected result
from then on.

**A rule with a function is not a rule that is followed.** `office_day()` was
one call away and the fixture did not use it, because the fixture was not
thinking about office days — it was building a list of timestamps. The place to
catch this is not more discipline; it is `attendance_scans` refusing a
`work_date` that disagrees with `ops_core.office_day(at)`, which is a constraint
the table does not have and should. Raised here rather than added in passing:
it would reject rows the demo's own fixtures may rely on, and that is a
migration with a question in it rather than a line in this one.

---

## F103 — a linter that got stricter because a column was added somewhere else

`check_shadowing.sh` went red on `0048`, and the two files it named were
`0016_procure_seams.sql` and `0017_procure_create_seams.sql` — procurement,
merged weeks earlier, green on every run since.

Nothing in them had changed. What changed is the set they are checked against.
The script asks Postgres for **every column name in all six `ops_*` schemas**
and flags any PL/pgSQL local that matches one. `0048` created
`ops_hr.contribution_rates.confirmed` and a `total` column on
`contribution_lines()`, and two locals that had been unremarkable since the day
they were written — `declare … total numeric` and `declare … confirmed
boolean` — became findings.

**Neither was actually ambiguous.** Postgres resolves an unqualified name
against the tables in *that query*, and those functions never touch `ops_hr`.
The script is deliberately broader than the hazard: its own comment says the
convention it enforces is *prefix every local with `v_`*, and by that rule the
two locals were always wrong and simply had not been caught.

So the fix was theirs, not a workaround in mine: `total` → `v_total`,
`confirmed` → `v_confirmed`, which is what the script prints. Two things made
it worth doing carefully rather than with a global replace. `'requested_total'`
and `'transferred_total'` are jsonb keys a screen reads, and survive `\btotal\b`
only because `_` is a word character — luck, verified rather than assumed. And
`format('%s is already confirmed.', …)` is a sentence somebody reads, which a
blind rename turns into *is already v_confirmed*. Their own smokes
(`04_procure_seams`, `05_procure_lifecycle`) prove the rename changed no
behaviour.

The thing to keep is about the shape of the check rather than the bug.
**A global linter makes every schema addition a change to everybody else's
code.** That is the cost of the broad version, and it is worth paying here —
the narrow version would need to know which tables each function's queries can
reach, which is most of a query planner. But it means a session adding an
ordinary column can be handed a red build in a module it has never opened, and
the right response is to fix what the tool names rather than to rename the
column. A convention is only cheap while everybody is actually following it;
the arrears fall due the first time somebody grows the namespace.

---

## F104 — a view that priced nothing, because the reader could not see the other schema

`v_product_bom` resolves each BOM line to a name and a price out of
`ops_procure.items`. Its smoke asserted a plank at Rp 150.000 and got null.

Not a fixture bug. The view carries `security_invoker`, so it reads
`ops_procure.items` as whoever is looking, and `items_read` in `0006` requires
`procurement.read`. A workshop user holds `production`. Every line of every
bill of material came back **unnamed and unpriced** — no error, no refusal, a
table of plausible nulls that reads as *nobody has priced any of this*.

That is the same failure as F97's `undefined` title and F100's swept-in
`unpaid`: the wrong answer is a well-formed value, so nothing downstream has
anything to complain about.

The fix is an additive policy on their table, `items_read_production`, scoped
to `production.read`. Policies are OR'd, so procurement's own is untouched.
The argument for it is procurement's own, written in `0006` about projects —
*read by everybody who can open any module that spends against them; hiding the
list would make every "which job is this for?" unanswerable*. A BOM line whose
item cannot be named makes *what is this component* unanswerable in the same
way. It is scoped rather than `true` on purpose: vendors, orders and what was
paid stay where they were.

Three things worth keeping.

**`security_invoker` turns an access question into a data question.** Without
it the view would have priced everything for everybody, which is worse; with
it, a missing grant looks exactly like missing data. The cost is real and the
alternative is not better — it just moves the failure somewhere nobody checks.

**A cross-schema join is a permission the design never wrote down.** Nothing in
`02-database.md` says *production reads the item catalogue*, and the view it
specifies cannot work without that. The permission was implied by a view
definition, three documents away from the policy that decides it.

**The assertion that caught it printed nothing.** `'got ' || b.unit_price` is
null when the value is, so the failure read `assertion failed` with no detail —
at the exact moment the detail was the whole point. Every message in that smoke
is `coalesce`d now, and the one for the price says what to suspect.

---

## F105 — `02-database.md` has been wrong four times in a row, and always the same way

Transcribing HR and production has now found four places where the design
document says something the contracts stopped saying:

| | `02-database.md` | the contracts | found by |
|---|---|---|---|
| `day_marks` | no public code | the evidence road needs one | F99 |
| `employees` | no `schedule_code` | there since M58 (D279) | 0045 |
| `bom_components` | unique `(product_id, ref_code)` | revisions exist (D256) | 0060 |
| `process_stages` | seven, `POTONG SERUT RAKIT` | four (D275), per product (D278) | 0061 |

None is a mistake anybody made. Every one is a **decision that landed in
`06-decisions.md` and in `src/services/*/contracts.ts` and not in the schema
chapter** — which is exactly what should happen while a design session is
moving fast, and exactly what makes the chapter unsafe to build from a month
later. Each was caught because building the table meant reading the contract
beside it; none would have been caught by reading the document alone.

The pattern matters more than the four. `02-database.md` is 2.200 lines and
reads as the specification, so the honest thing is to stop treating it as one.
It is a **record of the reasoning**, and the contracts are the specification —
they are what the screens compile against, so they cannot drift without
something failing.

There is a precedent for the fix and it is in this repository.
`check-permissions.mjs` exists because `src/lib/roles.ts` and
`ops_core.permission_catalog` were the same list written twice and had already
drifted by two entries. The same shape applies here: a script could compare
the ER diagrams' field lists against the interfaces in
`src/services/*/contracts.ts` and fail on a difference, the same way parity
does for the two API clients. It is not written here because it wants a mermaid
parser and a TypeScript one, and because **the right first question is whether
the diagrams should exist at all** rather than how to keep them true — a
duplicate kept correct by a script is still a duplicate.

Until somebody answers that: **read the contract, not the chapter, and update
the chapter in the same commit.** That is what these four did.

---

## F106 — the test passed, the mutation passed, and only one of those was good news

`62_prod_progress` asserts that `POTONG` is never folded into Sanding: the
business buys barang mentah now, so pieces that were *cut* are not pieces that
were *sanded*, and the two counts must stay apart (D275).

The test passed. Then the mutation that adds `POTONG → AMPLAS` to
`stage_sources` — the exact bug the assertion is about — **also passed.**

The fixture recorded `POTONG 4` and `AMPLAS 4`. The roll-up is a minimum over
the sources that carried a figure (F74), and `min(4, 4)` is 4 either way. The
assertion was reading a number that two different rules produce, so it could
not tell them apart. Changing the fixture to `POTONG 2` makes the folded answer
2 and the correct one 4, and the mutation now fails by name.

Two things worth keeping.

**A passing assertion proves nothing about a rule whose inputs coincide.** The
figures in a fixture are usually chosen for realism or convenience, and
`4` twice looked like both. Every number in a fixture is also a choice about
which wrong answers remain visible, and that is not a property anybody checks
when writing it.

**This is the argument for mutation-testing stated precisely.** F95 says a
check that has never failed for the right reason has not been checked, and
every derivation in this branch has been mutated since. That practice is what
found this: not a review, not a second reader, but deliberately breaking the
rule and noticing that nothing complained. The cost is a few minutes per view;
this one bought back an assertion that would have gone on passing while the
behaviour it names quietly regressed.

---

## F107 — four of six came back, and the other two are counted nowhere

A leg closes with `returned_qty` less than `qty`, which is a **legitimate,
closed answer** — six chairs to the upholsterer and four back is the ordinary
case, and the two that stayed are the question somebody has to ask the vendor
(D280). The schema says this well. The arithmetic over it does not.

`at_vendor_qty` sums the **open** legs, and `goods_on_site` is
`qty − at_vendor_qty`. So after leg A closes at four of six:

```
order 12 · at vendor 6 · believed on the bench 6 · never came back 2
```

Six and six is twelve, and there are ten. The board will offer work on six
pieces that are not in the building, and the refusal D255 exists for — *every
piece is still at a vendor* — will not fire until the count is off by all of
them rather than by two.

This is faithful to the demo, which computes the same way, and it is not a
transcription slip: **the model has no place to put a piece that is neither
here nor at a vendor.** A closed leg says the trip ended; nothing says what
happened to what did not come back. Three answers are possible and they are
different facts — the vendor still has them and will send them later, the
vendor scrapped them, or the order is short and somebody has to remake them.

Not fixed here, deliberately. Every fix invents something: a fourth date, a
shrinking order quantity, or a scrap record. The one that looks smallest —
treating the shortfall as still at the vendor — is the one that is wrong most
often, because the commonest reason four of six come back is that two were
ruined.

What the database can do meanwhile is stop the figure from reading as
certainty. `v_work_order` should carry the shortfall as its own number beside
`at_vendor_qty`, so *believed on the bench* is visibly a difference rather than
a count, in the same way `unpriced` sits beside a material cost in
`v_product_cost` (F104's sibling). That is a one-line view change and a
question for the owner in the same breath: **kalau dari enam yang dikirim cuma
empat yang kembali, dua itu masih di vendor, hilang, atau harus dibuat ulang?**

---

## F108 — two rules that were each right, and could not both be obeyed

`check_shadowing` compares every PL/pgSQL local against **every column name in
all six `ops_*` schemas**. Its convention is *prefix every local with `v_`*, and
it is deliberately broader than the hazard (F103).

`0028` added a second rule, and a stronger one: **the ladder was applied to
`john-lau-v01` on 2026-09-18, so a mistake in an applied migration is fixed by
a new migration and never by editing the old one.** A file somebody has run is
a record of what their database actually did.

`0048` walked into both at once. Two of its columns — `contribution_rates
.confirmed` and a roll-up's `total` — collided with locals in
`0016_procure_seams` and `0017_procure_create_seams`, which are applied. The
three ways out were each blocked:

- **Rename their locals.** What the tool prints, and what F103 did. Now
  forbidden: those files are the record.
- **Fix them in a new migration.** What `0028` prescribes. Does not work here —
  the checker reads *files*, so the old `declare` blocks stay flagged however
  many later migrations redefine the functions.
- **Leave it.** CI is red.

So the fourth: **rename the columns in the unapplied migration.** It is the
opposite of what F103 concluded a fortnight of commits earlier — *fix what the
tool names rather than bend the schema around a linter* — and the reversal is
correct, because the cost changed. When both files were unapplied, theirs was
in arrears and cheap to fix. Once one side is a record of a real database, the
side that has never run anywhere is always the cheaper one to move.

Two things to keep.

**A file-based checker cannot express "fixed in a later migration".** That is
not a flaw to work around today; it is the thing to know before the next
collision, because the obvious response — editing the old file — is now the one
that must not happen, and nothing in the tool says so. The check's own message
still reads `rename to v_total`, which is now advice that breaks a rule.

**The rules did not conflict until the ladder shipped.** Both were right when
written and neither anticipated the other. That is ordinary, and the useful
habit is not to look for a rule that cannot be outgrown — it is to notice which
of two rules is protecting something that already exists.

---

## F109 — the comment says a guard must not score 100%, and the code gives him 100%

`kpiView`'s punctuality measure reads, in the demo:

```ts
const judgeable = tapped.filter((d) => startOn(d) !== null);
const lateDays  = judgeable.filter(lateOn).length;
value: Math.round(((tapped.length - lateDays) / tapped.length) * 100)
```

with a comment two lines above it saying exactly the right thing: *days whose
schedule has no start time cannot be judged, so they leave the arithmetic
entirely rather than counting as punctual (D261's rule, in a new place): a
guard on an unstated shift must not score 100%.*

They do not leave the arithmetic. `lateDays` is counted over the judgeable
days and then divided by **all** the tapped ones, so a person with no start
time has `lateDays = 0` over a non-zero denominator and scores exactly the
100% the comment forbids. The rule was written down, argued for, and then not
implemented in the same function.

It survives because `dayStartFor` falls back to `rules.day_starts_minutes`,
and the seed sets one — so in the demo almost nobody is unjudgeable and the
divergence never shows. It shows the moment a rule book omits the company-wide
start, which is the honest state for a business whose guard and house
assistant have hours nobody has fixed (Q44, D274, D279).

`0064` implements the **comment**, not the code: the denominator is the
judgeable days, and a person with none of them is `null` with a reason —
*belum ada jam masuk yang ditetapkan untuk orang ini* — rather than a
compliment. A mutation restoring the demo's arithmetic scores the guard 100%,
which is how the divergence was confirmed rather than assumed.

Two things worth keeping.

**A comment that states a rule is a specification, and it can be tested.**
This one was precise enough to implement directly, which is why the
disagreement was visible at all: a vaguer comment would have been satisfied by
either version. Prose that names the failure it prevents — *must not score
100%* — is prose that can be turned into an assertion.

**Transcription is not translation.** The instruction for this phase is to move
the demo's logic into the database, and the obvious reading is *do what the
code does*. Where the code and its own stated intent disagree, doing what the
code does would carry the bug across and make it a database's answer instead
of a screen's — harder to see and quoted more widely. The demo's screens should
be corrected to match; that is the design session's file, not this one's.

---

## F110 — the demo's stock list and the database's catalogue are two vocabularies

`stockItems` filters the catalogue by `STOCKED_CATEGORIES`, a hard-coded set in
`src/demo/fixtures/reference.ts`:

```
kayu · panel · engsel-rel · handle · pengikat · cat · pelarut
lem · abrasif · mesin · kemasan · kantor
```

`0006` seeded `ops_procure.item_categories` with a different list entirely:

```
production · sanding · finishing · packing · machining
office · service · uncurated · raw-wood · hardware
```

Not one code appears in both. They are two answers to the same question,
written months apart, and neither is wrong on its own — the demo's are the
workshop's words, the ladder's are the ones the seed actually carries.

**It is a swap hazard rather than a bug today.** Nothing is broken while the
screens read fixtures; the moment `src/demo/api/inventory` re-exports from
`src/lib/api`, the stock list filters live categories through a set that
matches none of them and comes back **empty** — a rack with nothing on it,
no error, and the same shape as F104's unpriced BOM.

So the list is a table here, `ops_inv.stocked_categories`, seeded against the
codes that exist. Two things follow.

**A constant in the demo is a decision with no home in the database.** Every
`Set` and `Record` in `src/demo/fixtures` that the logic branches on is a
candidate for this, and the stock list is unlikely to be the only one. Worth a
sweep before the swap rather than after.

**Which of the two vocabularies is right is the owner's question, not this
migration's.** The table is seeded from the ladder's codes because those are
what items actually carry; if the workshop's words are the better list, that is
a change to `0006`'s seed and to the demo together, in one commit, with
somebody deciding — not a schema quietly preferring one.

---

## F111 — the fourth additive policy is the signal, not the fix

`v_stock_item` returned no rows at all to somebody holding `inventory`. Same
cause as F104 for the fourth time: the view reads a procurement table, carries
`security_invoker`, and `items_read` in `0006` asks for `procurement.read`.

The running count across this branch:

| table | policy | for | migration |
|---|---|---|---|
| `items` | `items_read_production` | the BOM's names and prices | 0060 |
| `vendors` | `vendors_read_production` | the vendor leg's name | 0063 |
| `vendors` | `vendors_read_inventory` | the timber load's vendor | 0070 |
| `items` | `items_read_inventory` | every name on the stock list | 0071 |

Each one is defensible on its own and the argument is always procurement's own,
from `0006`: *hiding the list would make every "which job is this for?"
unanswerable.* Four of them is no longer a series of exceptions; it is a rule
that has outgrown where it lives.

It cannot be fixed from this branch. `items_read` and `vendors_read` are in
`0006`, which has been applied (0028), so editing them is exactly what that
migration forbids — and an additive policy is the only door left open.

What the procurement session should write, in a migration they own: one
`items_read` and one `vendors_read` that name every module which **references**
the catalogue without owning it, then drop the four above. The predicate is one
line — `has_permission('procurement.read') or has_permission('production.read')
or has_permission('inventory.read')` — and having it in one place is the whole
point, because the fifth module to need it will otherwise add a fifth policy
and nobody will be counting.

The general shape, which is worth more than the fix: **reference data owned by
one module and read by three is not that module's private table, and a policy
written as though it were will be patched from the outside until somebody
notices.** The patches are cheap, which is why four of them accumulated without
an argument.

## F112 · 2026-09-18 · 0065 — the explosion hides prices, not structure

**What we assumed.** Writing the smoke for `explode_bom`, the refusal half was
going to be the obvious one: somebody from HRD asks for the explosion of a
kabinet and gets nothing. The assertion said `0 lines`. It got five.

**What surprised us.** `products_read`, `bomrev_read` and `bomcomp_read` are all
`using (true)`, and `0060` says why in a sentence: *the catalogue is read by
everybody who has to name a thing.* The workshop's structure is not a secret.
What **is** gated is the other side of the seam — `items_read_production` hands
procurement's item list to `production.read` and nobody else — so the HRD
reader gets the whole tree with every name and every rupiah stripped out of it.

**What this implies.** The boundary a BOM explosion carries is *what things
cost*, not *what things are made of*, and the two were worth separating in a
test rather than leaving to whoever reads the policies next. The smoke now
pins both halves: five lines, and not one price among them.

It is also F104's shape seen from the other end. The additive policy that was
written to stop a production user seeing plausible nulls is the same policy
that produces them, correctly, for everybody else. A null price is the right
answer often enough that it can never be read as a fault on its own — which is
the argument for asserting the *reason* a figure is missing, not just that it
is.

## F113 · 2026-09-18 · 0066 — `v_line_coverage.approved` is not what was approved

**What we assumed.** Building `v_wo_materials`, the *actual* half of D151's
comparison wanted three sums over a work order's request lines: asked, approved,
paid. Procurement already has a per-line view with an `approved` column and a
`covered` column, so the first draft read both straight off it.

**What surprised us.** A brand-new draft request, approved by nobody, reported
`approved = 7.311.000` — exactly what it asked. The column means *the amount
still to be covered*:

```sql
case when ap.approved is true then coalesce(ap.approved_amount, l.item_total, 0)
     else coalesce(l.item_total, 0) end as approved
```

Inside `v_line_coverage` that is right and useful — it is the funding target,
and the fallback to `item_total` is what lets an unapproved line still be
matched against a payment. Read from outside as *how much has been approved*,
it is silently the opposite of the truth, and it fails in the worst direction:
a project that nobody has approved a rupiah of reads as fully approved.

**What this implies.** The figure has to come from the approval itself —
`v_line_approval.approved is true`, summing `coalesce(approved_amount,
item_total)` over those lines only, and nought over the rest. That is what the
view does now, with the reason written above it and a mutation that puts the
old column back.

**The general shape.** A column name that is a verb in the past tense reads as
a fact and may be a target. `approved`, `received`, `settled` — each one is
somebody's shorthand inside the view that owns it, and the borrowing service
cannot see the shorthand. This is F104's lesson in a different register: there
the wrong answer was a plausible null, here it is a plausible number, and the
number is worse because nothing about it looks unset.

## F114 · 2026-09-18 · 0080 — one project, four modules, four visibility flags

**What we assumed.** `v_project_cost` answers one question — what is this job
costing — so it should read as one row. 0066 gave it two visibility flags,
which felt like a detail of that migration. Adding marketing's commission made
it four, and four is not a detail.

**What the row now says.** `cost_visible` — may you be told what making it
costs, which is really *may you read `procure.items`*, and the predicate
mirrors the three `items_read*` policies exactly (F111 again, from the inside
this time). `procurement_visible` — the request side. `ledger_visible` — what
has actually gone out. `marketing_visible` — what the introduction owes. No
role in the business holds all four, so no reader ever sees the whole row.

**What surprised us.** Every one of the four is *necessary*, and each was found
the same way: a figure summed over rows the reader could not see came back as
nought, and nought is a sentence. *Nobody is owed anything on this job* is not
*you may not see what is owed*. Writing the flag is the only honest fix
available from inside a view, and it is why a fifth additive policy was not
added (F111).

**What this implies, and it is not a small thing.** A view whose completeness
depends on who is asking is a view that will be screenshotted and passed
around, and the four booleans will not survive the screenshot. The shape this
probably wants is the opposite: **one gated question** — a per-project figure
that only somebody who may see all four quarters can ask at all, refused rather
than partially answered for everybody else. That is a change to a contract
0066's smoke already pins, so it is not something to do mid-session on a
judgement call; it is the owner's, or the next session's, and it is written
here so the fifth flag does not get added quietly instead.

**A second thing this migration decided on its own.** `sales_reps` carries one
`commission_percent`, as the tracker does. That holds until a rate is
renegotiated, at which point every commission already computed restates —
including the ones the ledger has paid, so the module stops agreeing with the
bank. The rate is therefore frozen once anything has been paid against it, and
ordinary editing before that. If rates really do move mid-relationship, the
answer is the dated shape `ops_hr.pay_rule_sets` already has, and one rate per
rep is the wrong table.

## F115 · 2026-09-18 · 0081 — an enum's order is a rule nobody wrote down

**What we assumed.** `OUTREACH_STAGES` is a ladder — `QUEUED`, `MSG SENT`,
`REPLIED`, `CALL SET`, `FORM BACK`, `PRESENTATION`, `DEAL` — and the contract
says the order is load-bearing: the funnel, the furthest agent per property and
*has this one been messaged* are all comparisons on it. A Postgres enum orders
by declaration, so an enum looked like the ladder, for free.

**What surprised us.** The type has two more values, and neither is a rung.
`RECYCLED` is *we gave up on this agent* and `SKIP` is *we never approached
them*. Declared after `DEAL`, as the contract lists them, they sort **above**
every real stage — so `stage >= 'REPLIED'` counts an agent we gave up on as one
who answered, and `stage >= 'FORM BACK'` puts them past the form. Nothing
raises. The reply rate simply climbs every time somebody is dropped, which is
the direction that flatters the team.

Declaring them first would have fixed those two comparisons and broken
`messaged`, which is `rank >= 'MSG SENT' **or** RECYCLED` — an agent you gave up
on *was* messaged. There is no declaration order that makes all three right,
because the values are not on one line.

**What this implies.** The rank is its own function and answers **null** for an
exit, so every `>=` answers false and each comparison has to say what it means
about the exits explicitly. The enum still types the column — it is a closed
vocabulary and belongs there — but its order stops being load-bearing, and the
smoke asserts `stage_rank('RECYCLED') is null` beside the counts.

**The general shape.** An enum whose values are not all on the same scale has a
sort order that reads as a rule and was never written as one. Where an order
matters, it is a function or a seeded table with a number in it — the same
reason `process_stages` is rows rather than a `case` (D275), reached from the
opposite direction.

**A smaller thing, noted in passing.** `ops_core.settings` has a
`settings_write` policy and no UPDATE **grant**, so the policy can never apply:
a setting is changed by a migration, not by a user. That may well be what was
meant — settings here are deploy-time — but the policy says otherwise, and one
of the two is wrong. `0003` is applied, so this is a note rather than a fix.

## F116 · 2026-09-18 · 0081 — two things the harness knew and we did not

**A settings key that reads as a schema.** `0081` seeded
`ops.agent_move_on_days`, the key the demo already uses, and
`check_schema_isolation.sh` refused the whole migration. It was right to.
`ops` is the **legacy system's own schema**, the guard reads schema-qualified
names out of the file, and a string literal beginning `ops.` is
indistinguishable from a reference to it without parsing SQL properly. The
guard exists because the new system shares one Supabase project with the
running legacy one and that arrangement is only safe while every migration
stays inside `ops_*` — which is far too much to risk on making a blunt check
cleverer. The key moved to `mkt.` instead (C16), following `kpi.`.

Worth keeping because the near-miss is the interesting part: had the guard been
a little smarter it would have passed this, and the next file with `ops.`
inside a string would have been a real one.

**A test that leaves rows behind.** Running `supabase/import/test.sh` before
`smoke.sh` makes `71_inv_stock` fail — it counts items, and the import commits
some. Every smoke file wraps itself in `begin/rollback` so the order they run in
cannot matter; the import test is not a smoke file and does not. CI runs
rebuild → smoke → import, so CI is correct and this only bites somebody running
them by hand in the other order. Noted rather than changed: the file belongs to
the session that wrote it, and the fix is theirs to pick — a rollback, or a
line in its header saying it must run last.

## F117 · 2026-09-21 · 0082 — the trigger wrote what the constraint forbade

**What happened.** The first run of `0082`'s smoke died on
`replied_after_sent`. An agent sitting at `QUEUED` was onboarded and then moved
straight to `DEAL`; `0081`'s trigger stamps `replied_on` for anything at or past
`REPLIED`, the row had no `sent_on`, and the constraint on the same table
refused the write the trigger had just composed. Two guards written a day apart,
in the same file, disagreeing.

**Which one was right.** The constraint. You cannot answer a message that was
never sent, and the case is real rather than a fixture artefact: an agent met at
an event and signed the same week never sat in silence. The trigger was
inventing a reply to a message that did not exist.

Neither *invent the missing `sent_on`* nor *refuse the deal* was acceptable —
the first fills in what is missing, which D150 forbids, and the second refuses
something that happens. So the trigger now stamps a reply **only when there was
a message to answer**, and the row says a deal happened and says nobody recorded
messaging them. Both true, neither invented.

**What that then broke, which is the more interesting half.** Once `sent_on`
could legitimately be null for an agent well up the ladder, `pipeline()` was
wrong. It counted `messaged` and `replied` by **rung** — `rank >= 'MSG SENT'`,
`rank >= 'REPLIED'` — copied from the demo, where every advanced agent happened
to have been messaged. The event agent is in the numerator and not the
denominator, so a market can report a reply rate **above a hundred per cent**.

The fix is smaller than the bug: `messaged` is `sent_on is not null` and
`replied` is `replied_on is not null`. Both are what the words mean, both are
events rather than positions, and the `or stage = 'RECYCLED'` special case
disappears — an agent you gave up on keeps their `sent_on`, so they keep
counting, and one dropped before any message was sent correctly does not.

**The general shape.** A rate whose numerator and denominator are read off
different things will eventually exceed one. `replied ÷ messaged` is only a rate
if both count the same kind of fact about the same population — here, things
that **happened**, not rungs a row has climbed past.

**And a third thing, from the same smoke.** Asserting one audit row for a
`move_on` found two: the successful one, and the attempt a read-grant user had
been refused earlier. That is right and worth pinning — a trail that records
only what succeeded cannot answer *who has been trying to do this*, which is the
question it gets asked.

## F118 · 2026-09-21 · 0084 — half a multiplication was frozen

**What `0080` did.** A commission is the project's contract value times the
representative's rate, derived on every read and stored nowhere (A3, C15). One
rate per rep holds until somebody renegotiates, at which point every commission
already computed silently restates — including the ones the ledger has paid — so
the rate freezes once anything has been paid against it. That was written up as
its own small decision and felt complete.

**What it missed.** The contract value is the *other factor*. Nothing stopped a
settled referral being re-pointed at a different project: the rate stays put,
`commission_amount` recomputes off the new contract, and a commission the bank
sent 12.500.000 for reads as 22.500.000 with no column anywhere disagreeing.
Exactly the failure the rate freeze exists to prevent, reached by the other
side of the `×`.

**How it was found.** Not by re-reading `0080`. Writing `set_referral_status`
in `0084` meant asking *what may a settled referral still do*, and the answer
listed three things — move backwards, change project, change the trx — of which
only the first was covered. A seam is a good place to find this because a seam
has to enumerate the acts; a constraint only has to be true about one of them.

**The rule now.** `paid_referral_is_pinned`: once `commission_trx_no` is set,
neither it nor `project_code` may change. A trigger rather than a check in the
seam, for the reason every invariant here is — it has to hold for a correction
typed straight into the table. The status is separately refused from going back
behind a payment, in the seam, because that one wants a sentence.

**The general shape, and it is worth carrying.** **A derived figure is pinned
only when every input to it is pinned.** Freezing one factor of a product reads
as protection and is not. Where a stored fact (a ledger payment) is the shadow
of a derived one (a commission), every term in the derivation joins the freeze,
and the way to find them is to write out the arithmetic and go along it.

## F119 · 2026-09-21 · B4 — a sequence is the one thing the smoke cannot roll back

**The contract every smoke file keeps.** `begin` at the top, `rollback` at the
bottom, so the cluster is unchanged afterwards and the order the files run in
cannot matter. `smoke.sh` says exactly that in its header, and it has been true
of thirty-five files.

**Where it stopped being true.** `0083` mints `TL-0004` from a sequence, and
`nextval` is deliberately **not transactional** — a sequence that is advanced
inside a transaction that then rolls back stays advanced, because two sessions
must never be handed the same number and a rollback cannot know whether anybody
else has taken one since. So the smoke passed on a freshly rebuilt database and
failed on the second run of the suite, asserting `TL-0003` against a `TL-0006`
that was correct.

The failure is the good kind — loud, and on a re-run rather than in production
— but it was found by accident, while running the suite twice for an unrelated
reason. A file that only passes on a fresh database is a file that will
eventually pass for the wrong reason.

**The fix, and why it is not a smaller assertion.** The smoke places the
sequence itself: `setval('ops_mkt.property_ref_seq', 1, false)` before it takes
the role that may not, with a sentence saying why. Weakening the assertion to
*some `TL-nnnn` that is not one the tracker used* was the alternative and is
worse — it stops testing the one behaviour worth testing, which is that the
mint **steps over** `TL-0001` and `TL-0002` and lands exactly on `TL-0003`.

**The general shape.** Sequences, `setval`, advisory locks and anything written
through `dblink` are outside the transaction that appears to contain them. Where
a test asserts a value one of those produces, the test has to **set the starting
point**, not assume it. The whole suite now passes twice in a row without a
rebuild, which is the property that was silently lost and is worth checking for
directly rather than noticing again by accident.

## F120 · 2026-09-21 · 0090 — a guard the grant already refuses is a guard nobody tested

**What the mutation found.** `turn_is_evidence` freezes everything about a turn
but the draft's outcome. The smoke tested it by updating a prompt and expecting
a refusal, and got one — from the **missing UPDATE grant**, which fires first
and never reaches the trigger. Removing the trigger's entire condition changed
nothing the suite could see. Twenty-one mutations caught; that one survived.

**Why it matters more than a missing test.** The grant and the trigger stop
different roads. The grant stops an ordinary client, and the trigger stops the
roads that have the rights anyway: a `security definer` seam, a migration,
somebody at a psql prompt. Those are exactly the roads a rule like this exists
for — nobody writes an evidence trigger to stop a caller who was already going
to be refused — and they were the ones nothing exercised.

**The fix is in the test, not the code.** The smoke now steps out of the role
for that assertion, `reset role`, and updates as the owner, where the trigger is
the only thing left. Two assertions instead of one: the grant refuses the
ordinary road, and the trigger refuses the privileged one, each for its own
reason and each provable on its own.

**The general shape, which is F95 one layer up.** Layered guards hide each
other from tests. When two mechanisms refuse the same act, the outer one
answers first and the inner one is never asked — so a test that only shows *the
act was refused* has proved the outer one and said nothing about the inner. The
way to know is to ask each of them from a place the other cannot answer from,
and the way to find out you have not is a mutation that removes the inner one
and watches the suite stay green.

## F121 · 2026-09-21 · validating John Lau — the permission check is a message, not an authority

**What the validation was.** Three capabilities were put to the code: does it
explain the system interactively, does it answer from the database according to
the asker's rights, and does it write on confirmation instead of a form. All
three are built. The second one is built in a way that will not survive the
swap, and it is better to say so now than to port it.

**What the demo does.** `ask()` reads `user.modules`, compares the held level
against the tool's with a rank table, and refuses in TypeScript. That is a
guard reimplemented outside the database, which is the thing `accounting.ts`
opens by forbidding: *a guard reimplemented in TypeScript is a guard that can
disagree with the one in front of the money.* Against fixtures it is the only
guard there is, so it is right for Phase 1 and wrong the moment the tools call
real views.

**The distinction to keep, because the check is not simply deletable.** F64
found that rendering *closed* and *permission* the same way sends somebody to
argue with the wrong person — the first is never granted away and the second is
fixed by asking IT. Telling them apart needs the tool's declared module and
level *before* the call. So:

- **whether** a person may read something is the database's answer, and only
  the database's: the tool runs as them and RLS refuses;
- **which sentence** they get when it is refused is the catalogue's, decided
  from the tool's declared reach and module.

Written down because the obvious port is to keep the rank comparison and call
it the gate, which would put a second copy of every module's rules in a file
nobody thinks of as security. The catalogue may say *this tool is for hrd
write*; it may not be what stops anybody.

**And the ceiling worth stating plainly.** *According to role and permission*
has a floor the owner set: all three HR tools and both IT tools are
`reach: "blocked"` — closed to the prompt at every level, by nobody's grant
(D218). Five of sixteen. A person with full HR access still cannot ask John Lau
about a payslip, and the screen says so rather than pretending the tool is not
there.

## F122 · 2026-09-21 · 0050 — our own service names are the legacy system's schemas

**What happened.** `0050` emitted `hr.attendance.imported`, following the
convention four other services use — `procurement.pr.created`,
`marketing.rep.onboarded`. `check_schema_isolation.sh` refused the whole
migration, because `hr` is one of the **legacy system's own schema names** and
a dotted string beginning with it is indistinguishable from a reference to that
schema without parsing SQL properly.

This is F116 again — a settings key beginning `ops.` — and the second time is
what makes it a shape rather than an accident. The legacy list is
`core|hr|ops|po_import|public`, and **three of those five are also our own
domain names**: `core` is our first schema, `hr` is a `ServiceName`, `ops` is
the prefix on all eight of our schemas. Any dotted string starting with one of
them trips a guard that exists for a very good reason and should stay blunt.

**The answer was already in the ladder.** `identity` emits `access.changed` —
no service prefix at all — and has done since `0007`. The `service` is its own
column on the outbox row, so the prefix was decoration, and the one service
that skipped it was right by accident. `0050` emits `attendance.imported`.

**What to do about it, which is not to fix the guard.** The next `hr.` or
`core.` inside a string may be a real reference, and a guard that reasons about
quotes would pass it. What is worth doing is knowing the collision exists
before choosing a name: the check is the thing that tells you, and being
refused by it is the system working.

## F123 · 2026-09-21 · 0050 — a flag on a widely-read table is N places, found once

**The change.** `day_marks` needed a way to take a mark back. The demo deletes
the row; the database has no DELETE grant and should not — *why was the
fourteenth marked sick and then not* is what somebody asks when they query a
payslip, and a deleted mark answers with silence. So: `withdrawn_at`, and
`mark_once` unique over the live marks only.

**What it actually cost.** Four things read a day mark, all defined in `0046`:
`office_closed`, `read_day`, `v_leave_used` and `v_day_mark_value`. Every one
of them asks for the row and would have found the withdrawn one — a day taken
back would still have spent somebody's leave entitlement and still shown on
their timesheet. Three of the four are long enough that restating them by hand
would have been a transcription risk, so they were sliced out of `0046`
programmatically and patched with one predicate each.

**The alternative, and why it lost.** A second table for withdrawn marks costs
nothing today: no reader changes at all. It costs for ever instead — *was this
day ever marked* becomes a two-place question, and the second place is one
somebody will forget. One table, four predicates, paid once.

**The general shape.** A nullable flag on a table with N readers is N places
that have to learn about it, and **the moment the flag is added is the only
moment all N can be found**. After that they are found one at a time, by
somebody noticing a figure that looks slightly wrong. Adding the column and the
readers in one migration is not tidiness; it is the difference between a change
and a slow leak. The way to know N is to grep for the table before writing the
`alter`, not after.

## F124 · 2026-09-21 · 0090, corrected by 0037 — the privacy line was in the wrong place

**What `0090` shipped, hours before main's guard caught it.**
`v_turn_provenance` was a `security_invoker = off` view: it read past the
table's policy on purpose, and a `has_permission('it.read')` inside its `where`
clause was the only thing stopping every signed-in account from reading every
draft anybody had confirmed. It was written deliberately and documented as the
one view in the ladder that runs as its owner.

**`0037`'s check refused it**, and the refusal was the useful part. That
migration had just measured what `0014` got backwards — a view runs with its
**owner's** rights unless told otherwise — and enforced `security_invoker = on`
over every view in the ladder, with two named exceptions and an assertion that
there are exactly two. Adding a third means editing the count as well as the
list, which is friction on purpose, and the friction worked: it made the
question *does this have to be an exception* unavoidable.

**It did not.** The reasoning that produced the definer view was *the prompt is
private, so IT must see a subset without it*. That is the wrong line. A prompt
that produced a purchase request line is **the provenance of that line** — the
sentence somebody typed instead of filling in the form, as much a record of the
order as the fields are. A prompt that asked about a salary and was refused
produced nothing and belongs to the asker alone.

So the rule is not *the prompt is private*; it is **a turn that wrote something
is readable by whoever audits writes, and a turn that did not is not**. Said
that way it is a second RLS policy — `draft is not null and
has_permission('it.read')` — policies being OR'd, and the view goes back to
carrying the reader's rights like every other one.

**Two things worth keeping.** A guard inside a view is a guard in a place
nobody looks for one; the same rule as a policy sits where every reader of that
table already looks. And a privacy boundary that needs a special mechanism is
usually a boundary drawn in the wrong place — the right line here needed no
mechanism at all, only a predicate in the place predicates go.

## F125 · 2026-09-21 · 0051 — the idempotency key that was never sent

**What the mutation found.** `import_overtime_form` opens the way every seam
in this codebase opens — read the key, hand back the remembered answer if it is
there:

```sql
v_replayed := ops_core.idem_replay('hr','import_overtime_form', p_key);
if v_replayed is not null then return v_replayed; end if;
```

Deleting those two lines broke nothing. Twenty-four of the twenty-five
mutations on `0051` were caught; that one survived.

**Why.** The smoke *did* send the form twice, and asserted the second reading
added nothing — but the second call passed **no key**. It was testing the
function's own arithmetic (every row on the paper is already a line, so nothing
to add), which is a different promise from the one the key makes. The two look
identical from the outside: both answer *nothing was added*. Only one of them
is still true when the rows differ.

**The distinguishing case is a key with different rows behind it.** A third
call, carrying the first call's key and a single row, must answer with the
**first call's tally** — `added = 2` — because a replay hands back the stored
envelope without doing the work. A fresh execution of that one row would say
`added = 0`. Now the mutation dies.

**A wider question this opens, measured rather than guessed at.** Sixty-six
seams in the ladder take an idempotency key. Counting call sites where the same
literal is passed as the last argument twice, **twenty-seven** have the replay
path exercised; the rest reach it only through the one-key-one-call shape that
just proved insufficient here. The mechanism itself is well tested — `04`'s
`approve_line` block sends `tap-0001` twice, asserts `outcome = 'duplicate'`,
status 200, `data` byte-identical to the first answer, and two approval rows
rather than three; `tap-0002` proves a 422 releases the claim. What is untested
is each seam's own **two lines**: that this particular function asks before it
works, and asks with the right service and endpoint. A copied-in `'hr'` where
`'acct'` belongs would make two seams share one key space, and nothing in the
suite would notice.

**The lesson is F95's, with a sharper edge on it.** *A check that has never
failed for the right reason has not been checked* — and a test can fail for the
right-looking reason while exercising the wrong code. The second reading of
that form always passed, and always would have, with the replay deleted.

## F126 · 2026-09-21 · 0052 — a unique key blind to the case it was written for, and a flag whose cost is not the number of readers

Two things came out of putting seams on the payroll, and neither is about
payroll.

**`period_once` cannot see the week either side.** `0044` put
`unique (period_start, period_end)` on `payroll_runs` with the comment *the same
week is not run twice by accident*, which is true and is not the failure. 1–7
September and 5–11 September are two different pairs of dates, so the key
admits both, and the fifth, sixth and seventh are paid over again — the exact
thing the key exists to prevent, arriving through the gap in it.

The fix is a gist exclusion over `daterange(period_start, period_end, '[]')`,
which needs no extension because a range carries its own opclass. The unique key
stays: the exact repeat is the common mistake and deserves the clearer error.

The general shape is worth more than the fix. **A unique key over the endpoints
of an interval constrains the endpoints, not the interval.** Anywhere a table
holds a span — a period, a tenancy, a rate that is in force between two dates,
a vendor leg — the key that looks like it stops overlap stops only exact
repetition, and the two are easy to read as the same promise because the comment
above the key usually says the second one.

**A nullable flag's cost is the size of its readers, not their number.** F123
said *a flag on a table with N readers is N places that must learn about it, and
the moment the flag is added is the only moment all N can be found*. Withdrawing
an adjustment has N = 2, which by that arithmetic is cheap. One of the two is
`payroll_line`, two hundred lines of PL/pgSQL in `0047`, and a function has no
ALTER — so the whole thing is restated in `0052` for a single added predicate,
sliced out of the earlier file programmatically rather than retyped.

So the count is the wrong measure. What a flag actually costs is **how much
code has to be re-emitted to carry it**, and a long function is a worse reader
to have than three short ones. Two consequences, both cheap to act on next time:
a derivation that reads a table it does not own should read it through a **view**
that holds the predicate, so the predicate has one home; and where that is not
possible, the restatement should be mechanical — a slice with one substitution,
verified by a mutation that checks the copy still has the rule — rather than a
retyping nobody can diff.

The mutation that proves the second reader learned is worth keeping in mind as a
shape: it withdraws an adjustment and then reads **the same figure from both
sides**, the run's total and the person's payslip. A test that checked only the
first would have passed with the payslip still paying money somebody took back.

## F127 · 2026-09-22 · 0048 — a mask over a column the reader can select is a decoration

**What `0048` does.** `enrolments.member_no` holds a BPJS membership number,
typed off the card because the card is the only place it exists. `v_enrolment`
returns `member_no_masked` and never the number, with a comment citing D196.

**What the table does.** `enrol_read` is `for select to authenticated using
(has_permission('hrd.read') or has_permission('payroll.read'))`, over every
column, and `0040` granted `select on all tables in schema ops_hr`. So:

```sql
select member_no from ops_hr.enrolments;
```

answers in full to anybody who can open the screen the mask is on. The masking
is real in the view and buys nothing, because the view is not the only road to
the row — it is one projection of a table the same reader may select directly
through PostgREST.

**Why a view cannot fix it.** Every view in this ladder is `security_invoker =
on` and `0037` asserts there are exactly two exceptions. An invoker view reads
with the caller's privileges, so a column the view can read is a column the
caller can read. The mask can only be enforced where the caller's privileges
stop, which means one of: a column privilege (`revoke select (col)`), a definer
function, or a separate table with no policy.

**What `0053` does instead**, for the same rule over a worse secret. The table
has **no read policy and no select grant at all**, and the only road to a row
is `employee_documents_of()` — a definer function that asks
`has_permission('hrd.read')` itself and blanks the number before it leaves the
database for the five kinds that identify a person. The screen gets the mask,
the length, and whether the length is what the kind wants, which is enough to
say *this reading is wrong* without showing a digit. A mutation proves the
table itself cannot be selected, because without that assertion the whole
arrangement reduces to `0048`'s.

**The general shape.** *Where a secret is masked decides whether it is masked.*
A projection that removes a column protects the people who read that
projection; it protects nothing when the reader can also name the table. With
PostgREST every table is an endpoint, so "the screen only calls the view" is
not a property of the system — it is a hope about the client.

**`0048` is not fixed here.** Its enrolment seams are not written yet, and the
fix is the same shape: no select grant, one definer read. It belongs with those
seams rather than as a drive-by change to a table whose write road does not
exist. Until then the exposure is a membership number readable by HR and
payroll, who are the two roles allowed to see it on the screen anyway — which
is why this is a finding and not an incident.

## F128 · 2026-09-22 · the parity check was scoped to the export list, so the two clients most likely to have drifted were the two nobody compared

**What it read.** `check-api-parity.mjs` builds a TypeScript probe that assigns
every real client function to the demo's type of the same name. Which services
it opens came from `liveServices()` — a regex over the `export * as …` lines in
`src/lib/api/index.ts`.

That was itself a fix. The list had been four names typed out, and `assistant`
was written, exported and swapped in without appearing in it, so the one check
that exists to stop the two clients drifting said `ok` about a module it had
never opened. Reading a file rather than keeping a list was the right move.

**The wrong file.** `index.ts` is the list of services whose **routes are
live**, which is a different question from whether their shapes agree. A
service is exported when there is a database behind it; it is written long
before. Two modules were in that gap — `marketing`, written and held back
because `ops_mkt` has no tables in the project, and now `hr`, written and held
back for the same reason plus an unfinished payroll half.

So the check covered every module that had already been proved in production
and skipped both of the ones that had never been compared to anything. The day
either is exported is the day its drift arrives, all at once, on the screens.

**It now reads the directory**: every `src/lib/api/*.ts` with a demo twin. That
immediately put `hr`'s twenty-one functions under the probe, which found
exactly one disagreement — `unmarkDay`, where the demo deletes a mark and the
database withdraws it, so the signature had to grow a reason (C18). One real
finding on the first run of a widened guard is the usual return.

**The shape worth keeping.** *A guard's scope is a claim about what is at
risk.* Scoping it to what is already live inverts the claim: the newest,
least-exercised code is the code most likely to be wrong and the least likely
to be covered. This is the second time that has happened to this same check —
the hand-kept list had the same property for the same reason — and both times
the fix was to widen the scope to *everything of this kind that exists* rather
than to *everything of this kind that is switched on*.

## F129 · 2026-09-22 · 0058 — a CHECK constraint over a predicate that can return NULL is a constraint that passes

**What was written.** `clause_value_ok(kind, value)` decides whether a clause's
structured reading has the shape its kind requires — a `gaji_pokok` must carry
an amount and a unit, a `keterlambatan` must name a mode the rule book also
uses. It is enforced twice: as a CHECK on `contract_clauses`, and as a refusal
in the two seams so the caller gets a sentence rather than an exception.

```sql
select case p_kind
  when 'gaji_pokok' then
    (p_value ->> 'amount') ~ '^[0-9]+$' and p_value ->> 'per' in ('month','day','hour')
  ...
  else true end
```

**What it did.** `'{"amount":"180000"}' ->> 'per'` is NULL. `NULL in ('month',
…)` is NULL. `true and NULL` is NULL. So the function returned NULL, and both
enforcement points let the row through:

- a CHECK constraint **passes** on NULL — only `false` rejects;
- `if not ops_hr.clause_value_ok(...) then` never fires, because `not NULL` is
  NULL and a plpgsql `if` over NULL takes the else branch.

A clause with an amount and no unit was accepted by a function whose entire job
was to refuse exactly that. The smoke caught it on the first run — the assertion
read `satuannya belum disebut, got (null)`, and `(null)` was the error code that
never came.

**The fix is one word**: `coalesce(case … end, false)`. Unknown is not
permission.

**Why this shape is worth remembering.** SQL's three-valued logic turns a
missing field into *unknown* rather than *false*, and every enforcement point in
Postgres treats unknown as permission: CHECK passes, RLS `using` passes the row
through as invisible rather than refused, `WHERE` drops it. So **the more fields
a validator reads, the more likely it is that a partly-filled input makes it
answer NULL** — and a validator whose job is to reject half-filled input is
precisely the one most exposed to it.

Two habits follow, both cheap. A boolean function used as a guard should be
total: wrap the body in `coalesce(…, false)` so there is no third answer. And
the mutation that proves it exists is not *does the rule work* but **does the
rule still work when the field it reads is absent** — the version of this
finding's mutation is `coalesce(…, true)`, which is the bug restated, and it is
now in the suite.

## F130 · 2026-09-22 · the only way to answer a contract clause was to type its JSON, and the two statements of the rule could not see each other

**The screen shipped with a developer's input.** `0058` gives every clause a
shaped answer — `{"amount":"180000","per":"day"}` for a wage, `{"mode":
"pro_rata"}` for lateness — and `ops_hr.clause_value_ok` refuses anything else.
Tahap B built the screen around that, and the field it built was a one-line box
with the JSON as its placeholder.

That is defensible while a machine is going to fill it in: the reader (tahap C)
proposes the value, a person reads the sentence beside it and presses
*Konfirmasi*, and nobody types a brace. Tahap C is now deferred — *sementara
biar diisi manual saja dulu* — and **the fallback path became the only path**.
It was never designed to be one. An HRD clerk cannot be asked to know that
`per` takes `month` and not `bulan`, and the refusal they would get names a
`check` constraint.

**The deferral is what exposed it, not a bug report.** Nothing was broken. Every
guard was green, and the screen worked exactly as written for the person who
wrote it. What changed was which of two paths carries the traffic, and the
quality of a fallback is invisible until it stops being one.

**Two statements of one rule.** Replacing the box with real fields creates the
actual risk: the option list now lives in `CLAUSE_FIELDS` (TypeScript) *and* in
`clause_value_ok` (SQL), and neither can see the other. Both drifts are silent
and neither is caught by `tsc` — the `Record<ClauseKind, …>` makes the *kinds*
exhaustive and says nothing about the inside:

- **SQL grows a choice the form lacks.** The choice cannot be picked by anyone,
  ever. The only symptom is a value that never appears in the data, which reads
  as *nobody chose it*.
- **The form offers a choice SQL refuses.** Worse, because it looks like it
  worked right up to the button.

`scripts/check-clause-fields.mjs` parses both and refuses any disagreement. It
does not re-implement the rule — the constraint still decides — it only refuses
the drift. Six mutations, three from each side, all caught naming the kind and
printing both sides.

**Its first run failed for the wrong reason,** which was worth the ten minutes:
the parser sliced each field on brace boundaries, and an options list is itself
made of `{ value, label }` objects, so it read a one-choice field and reported
six disagreements that did not exist. *A guard that fails on its first run has
not proved it works — it has proved it fails.* Mutating it afterwards is what
separated the two.

**The second gap the deferral opened.** `registerContract` existed in both
clients, passed parity, and **no screen called it**. With a machine in the loop
that is a gap; with manual entry it means contracts cannot be created at all.
The chain HRD was promised — register, answer the points, activate — was broken
at its first link, and nothing could have found that but walking it, because
every guard in this repo asks whether a function is *correct*, not whether
anybody can *reach* it.

## F131 · 2026-09-23 · the HR ladder reaches production, and the only tool available made transcription the risk

**What was applied.** `0043`–`0058`, sixteen migrations, 6.058 lines, into the
live project. `ops_hr` went from **zero tables** to 17 tables, 13 views, 61
functions and 15 seeded checklist rows. `0064_hr_kpi` was deliberately left
out: it references `ops_prod.progress_entries`, and `ops_prod` has no tables in
that project — applying it would have failed, and forcing it would have put a
broken reference in front of a screen nobody can use yet anyway.

**The environment made the method.** There is no Supabase CLI here and no
database password, so the only road in was `apply_migration`, which takes SQL
as a parameter — meaning every one of those 6.058 lines passed through the
model. **That is not a transcription anybody should trust on assertion.** One
character changed inside `payroll_line` is a wage that is wrong for somebody
who cannot argue about it, and it would pass every test in this repo, because
the tests run against the local cluster and not against production.

So the check was structural rather than hopeful: dump `ops_hr` from both
databases — every function's `pg_get_functiondef` hashed, every column with its
type, default and nullability, every view definition, policy expression, index
definition, enum with its ordering, and every grant to `authenticated` — sort,
hash the whole thing, compare. **`669dd7fb…` on both sides** once `0064`'s five
objects are excluded from the local side. Not "it applied without error":
byte-identical.

**Two checks fired before the real one.** A mid-way comparison at 10 of 16 files
reported three functions differing — `office_closed`, `read_day`,
`payroll_line` — and all three are restated by migrations not yet applied at
that point. A guard that cannot tell *not yet applied* from *transcribed wrong*
would have stopped the work for nothing. And a query asking which views lacked
`security_invoker` named all thirteen, because the option stores `on` and the
query compared against `true`. **Both were my own instruments, not the data**,
and both would have been reported as findings by anybody who ran them once.

**What the advisors say, characterised rather than repeated.** Neither ERROR
class touches `ops_hr`. Two warnings do, and both are the project's standing
posture rather than anything HR introduced:

- **`anon` can execute 26 definer functions** — true of 130 functions across the
  project, because Postgres grants EXECUTE to PUBLIC. It is **not reachable**:
  `anon` has no `usage` on the schema, and a call as `anon` is refused by
  Postgres before any function body runs. Verified, not reasoned.
- **10 functions with a mutable `search_path`** — all ten are plain invoker
  helpers (`wita_minutes`, `clause_value_ok`, `doc_kind_of`, …). **Every one of
  the 26 SECURITY DEFINER functions has its `search_path` pinned**, which is
  where it would have mattered.

Called as `authenticated` with no rights, `mark_day`, `register_contract`,
`open_payroll_run` and `reveal_employee_doc_no` all answer `refused`, and both
reads return nothing. The guards fire in production, not only in smoke.

**The one thing that could not be checked from here, and it is the one with
precedent.** Whether PostgREST exposes `ops_hr` — Supabase's *Exposed schemas*
setting — could not be tested: the proxy in this environment refuses HTTPS to
the project host. That is exactly the failure class of the schema-cache bug that
hit ~100 client calls at once, and it is why **no route was switched live in
this session**. Turning screens on before that setting is confirmed is how the
same bug ships twice.

## F132 · 2026-09-23 · the route flip had a second gate, and the six screens open onto an empty roster

**What I told the owner it would take.** *Export `hr` from `src/lib/api/index.ts`,
run `check-live-routes --write`, and the six screens open.* Both halves of that
were done and **`LIVE_ROUTES` did not change by one line**.

**The gate I had not read.** `check-live-routes.mjs` decides with
`missing.length === 0 && unimplemented.length === 0 && LIVE_MODULES.includes(mod)`.
The function scan is the half everybody talks about; `LIVE_MODULES` is a second,
coarser gate with its own reason written beside it — *a screen that happens to
call no service at all is not therefore live*. `/inventory/papan` calls nothing
and is still an inventory screen. Being live has to mean **this module is open
for business**, not *this file compiled*.

So the export was necessary and not sufficient, and the guard's answer to a
half-done job was to keep all six dark rather than open them. That is the guard
working. What was wrong was my description of the work, stated confidently to
the owner one message earlier — and the thing that made it cheap was that the
list is **generated and diffed** rather than hand-edited: the mistake showed up
as *nothing changed*, which is unmissable, instead of as six routes I had typed
in myself and would have believed.

**What opened, and what the scan held back on its own.** Six of fourteen:
`/hrd/karyawan`, `/hrd/berkas-201`, `/hrd/absensi`, `/hrd/jadwal`,
`/hrd/kontrak`, `/hrd/kontrak/[no]`. Payroll's four, `/hrd/lembur`,
`/hrd/iuran`, `/hrd/kinerja`, `/hrd/cuti` and `/it/aturan-gaji` stayed dark
because 33 functions are unwritten — no list of mine decided that, and adding
`hrd` to `LIVE_MODULES` could not have forced them open.

**And now the part nothing in the repo guards.** `ops_hr.employees` has **zero
rows**, and `supabase/import/` has no HR stage — grep it for `ops_hr` and there
is nothing. So the screens that just went live read empty tables, which is
precisely the failure `live.ts`'s own header names:

> it throws, or worse, renders an empty table that reads as *this business has
> no employees*.

Two things keep that from being a live incident rather than a note. Only
`shared` and `superadmin` hold the `hrd` module, so no HRD clerk can open the
screens yet; and these screens are themselves the way data gets in —
`saveEmployee`, `file_employee_document`, `register_contract` are all reachable
from them. An empty roster on the first day of a cutover is the expected state.

**The data is there to import.** The legacy `hr` schema in the same project has
**8 employees and 7 salary rows**. That is an `04_hr.sql` in `supabase/import/`
with the idempotence the other three stages have — not a large job, and the
right one to do before anybody is given the `hrd` module.

**The shape worth keeping.** *A guard with two gates needs both named wherever
the work is described.* I had read the function scan, quoted it accurately, and
never looked at the line below it. The generated list is what turned an
incorrect plan into a five-minute correction instead of a wrong claim shipped.

## F133 · 2026-09-23 · the first day works on an empty rule book, and the one thing it cannot do is name a working pattern

**The owner chose the app over an import** — eight people, typed in rather than
carried across, so HRD reads each record instead of inheriting whatever the
legacy system held. That makes *can somebody actually do this on day one* the
question, and it was worth walking rather than assuming.

**Walked against a copy of production's state** — `ops_hr.pay_rule_sets` empty,
so `rules_on()` returns null and there are no schedules anywhere:

| | |
|---|---|
| Add an employee, as the form actually posts | **ok** |
| Add one naming a working pattern | refused, `schedule_unknown` |
| Set a pattern afterwards | refused, `schedule_unknown` |
| Mark a day (sakit, tanggal merah) | **ok** |
| Register a contract, confirm all ten required clauses, activate | **ok** |

**So it is not the blocker I first called it.** `EmployeeDrawer` posts
`schedule_code: schedule || null` with an empty dropdown, and `save_employee`
only validates the code when one is given — the roster, the berkas, the marks
and the contracts all go in. What is empty is the dropdown itself and
`/hrd/jadwal`. I said it blocked the path the owner had just chosen; it blocks
one field of it, and the difference matters because the first version would
have had somebody waiting on work they did not need.

**The one visible consequence, and it is correct.** A contract whose `jam_kerja`
clause says `KANTOR` against an employee with no pattern reports
`jam_kerja (kertas: KANTOR / sistem: ∅)` — one conflict on every contract that
answers that clause. That is the screen doing its job: the paper promises a
pattern the system does not have. It will read as noise until the rule book
exists, and the honest response is to create the rule book rather than to
soften the comparison.

**Why the rule book cannot be filled in through the app yet.**
`/it/aturan-gaji` is dark on three functions, and they are not the same size.
`listPayRules` is a read. `savePayRules` is an ordinary insert seam behind
`it.update`. **`previewPayRules` is not a client function at all**: it costs a
whole payroll computed under a rule set *that has not been saved*, and
`payroll_line_for` calls `rules_on(p_from)` inside itself with no way to inject
a candidate. Opening that screen means giving the payroll body an optional rule
book — a fourth touch of the two-hundred-line function — not writing three
wrappers. Estimating it as three wrappers is the mistake this entry exists to
stop the next person making.

The numbers are not missing: Produksi 07.30–16.30 with 45 minutes' break and 90
on Friday, Kantor 08.00–17.15 with 60 and 90, and two patterns nobody has
finished describing (Satpam's twelve hours, ART from 14.00) sit in
`src/demo/fixtures/payrules.ts`, from the owner's own Q44/Q53 answers. What is
missing is a road for them into the live project that is not a hand-written
insert into a table D173 says is written once and never updated.

## F134 · 2026-09-23 · three guards in the ladder were each refusing a decision the log had already taken

**The ask.** Open `/it/aturan-gaji` so the business can publish its own pay
scheme — *kita mungkin punya skema baru bulan ini tapi menunggu skema baru
rilis itu bodoh*. Conditional on one thing: that it can then be **changed
easily** from the app.

**The first thing to say back is that a version is never edited.** `pay_rule_sets`
is written once (D173), so "changing" the scheme means publishing the next
version. That is better than what was asked for — last month stays computable
under last month's book — but it makes one question load-bearing: *can a
version that turns out wrong be corrected?*

**Three guards said no, and a recorded decision said yes.** D270, from
2026-09-13, is explicit: *the new version is dated to the day v3 began, not to
today*, because the workshop always started at 07.30 and dating the fix from
today *would have the system assert something false about September*. Against
that:

- `pay_rule_sets.effective_from` was **`unique`** (`0043`) — the second version
  on a date could never be written at all;
- `pay_rules_not_backdated` refused any date before today (`0043`, tightened in
  `0047`);
- and the demo seam refused `effective_from <= latest`.

So `rules_on`'s `order by effective_from desc, version desc` — a tie-break
whose own comment cites D270 — **was a branch that could not fire**, and the
demo's fixture carrying v3 and v4 on `2026-09-01` was data no seam could have
produced. Three independent guards, each individually reasonable, collectively
refusing something the log had settled ten days earlier.

**What D270 actually conditions on is money, and money is checkable.** The
decision names it: *what makes the backdating safe is `late_mode: "manual"` —
not one rupiah has ever been computed from this rule*. That is not a statement
about the calendar, and the calendar was the wrong thing to guard. The rule now
is: a version may take effect on or before today only while **no run that has
left DRAFT covers any day from that date onward**. APPROVED is somebody's
signature; PAID is money that moved. A DRAFT run has paid nobody. The
mid-period refusal from `0047` is untouched and keeps its own separate reason.

**Two gaps found only by walking the screen's actual caller.** `/it/aturan-gaji`
is reached with `it.update` (`src/lib/nav.ts`), and `0043`'s read policy admits
only `hrd.read` or `payroll.read` — **the one role D173 puts in charge of the
rule book could not read it**. And a preview walks every employee's timesheet
under RLS, so an IT user would have previewed an empty company; it is
`security definer` and asks for `it.update` itself.

**The preview, and the copy that was not made.** A preview is the whole payroll
computed twice, the second time under a book that has not been saved, and
`payroll_line_for` calls `rules_on(p_from)` inside itself. The obvious answer
is a fourth copy of that two-hundred-line body taking an extra argument. F126's
rule — what a field costs is how much code must be re-emitted to carry it —
pointed the other way: restate `rules_on`, which is nine lines, and let it read
a transaction-local setting that exactly one function sets. Action at a
distance is a real cost and it is named in one place; two hundred lines copied
a fourth time is a cost that never stops being paid. The smoke asserts the
setting is gone afterwards, because a preview that forgets to clear it turns
every later read in that transaction into a lie nobody would see.

Ten mutations, ten caught — including the two that matter most here: restoring
the unique constraint (the D270 correction stops working) and dropping the
`version` tie-break (`rules_on` picks the version being corrected).

## F135 · 2026-09-23 · a trigger that reads a table under the caller's RLS cannot guard against what the caller cannot see

**Found by a test failing for the wrong reason, twice.** `40_hr` was updated to
assert the new rule — a version may reach back only while no signed run covers
those days — and it kept reporting *should be refused*. The guard was right;
a probe inside the file showed why:

    PROBE runs non-draft: 0, current_role: authenticated

Zero. The row was there. **`pay_rules_not_backdated` is a plain trigger
function**, so its `select … from ops_hr.payroll_runs` runs under the writer's
RLS — and the writer is IT, who holds `it.update` and none of payroll's
permissions. The guard looked at an empty table and waved the insert through.

**The seam never noticed, which is why it survived review.** `save_pay_rules`
is `security definer` and reads every run, so every path through the screen is
protected and every test through the seam passes. What is unguarded is the
**direct write**: `0043` grants `insert` on `pay_rule_sets` to `authenticated`
under an `it.update` policy, so the same person can `POST /rest/v1/pay_rule_sets`
and put a back-dated version under a signed payroll run with nothing in the way.

**And it is older than today's work.** `0047`'s mid-period check — *a version
lands between periods, never inside one* — reads `payroll_runs` from the same
trigger and has been blind in the same way since it was written. It has never
refused anything for anybody without `payroll.read`, and nothing said so,
because the only tests that exercise it come through a definer seam.

The fix is one word, `security definer` on the trigger, and it is worth the
paragraph beside it: a trigger is the last line, reached when the seam is
bypassed, and a last line that inherits the bypasser's blindness is decoration.

**What made it visible.** Not review — the code reads correctly, and it passed
ten mutations through the seam. It was a test written against a *different
caller* than the seam uses. The shape to keep: **a guard is only proved by the
weakest caller that can reach the thing it guards**, and for a table with a
direct grant that is never the seam.

Eleven mutations now, eleven caught — the eleventh reverts the trigger to an
invoker and `40_hr` goes red.

## F136 · 2026-09-23 · the chain HRD was promised works; what was missing was the sentence at the end of the row

**The ask narrowed to what matters**: HRD enters a name, a working pattern and
attendance, and the system says **how many hours and how many days**. Payroll
later.

**Walked it as the real roles before building anything**, against an empty rule
book and an empty roster — IT publishes the book through `0059`, HRD adds
Karjo on the PRODUKSI pattern, a biometric file imports eight taps:

    1 IT terbitkan buku aturan     : ok
    2 HRD tambah karyawan+jadwal   : ok
    3 jadwal di /hrd/jadwal        : 2 pola, 0 orang belum tertaut
    4 impor absensi                : ok · masuk 8 · tak dikenal []
    5 TOTAL                        : 16.58 jam · 2 hari · 2 hari lengkap

So the chain was already whole and the data was already there. `/hrd/absensi`
drew every cell and totalled nothing — the question a person asks *first* was
the one the screen could not answer, and no amount of looking at the migration
list would have shown that. Walking it did.

**Where the sum belongs.** Adding up rows the client already holds looks like
assembly, and `0057` had already refused that reasoning for payroll totals in
words that apply unchanged: *two implementations doing that arithmetic are two
chances to round it differently*. Hours are a number people carry into a
conversation about wages. `ops_hr.timesheet_totals` counts once.

**What makes a total honest is the counter beside it.** A period with four
unread days has a total that is certainly too small, and a number that is too
small with nothing next to it is a number people believe. So the function does
not return one figure: it returns days complete, unread, marked and empty, and
the screen prints *16,58 jam · 2 hari · 4 belum dibaca* in the row itself.

**Two things the mutations found.** A fixture bug that looks exactly like a
product bug: `generate_series` over two `date`s yields **timestamptz**, so
`at time zone 'Asia/Makassar'` ran the other way — reading the wall clock
instead of setting it — and every tap moved eight hours, making clean days read
as unread. The code was right; my test was lying, and it was lying in the
direction that would have had me "fixing" `read_day`.

And one mutation **survived**: deleting `round(sum(...), 2)` changed nothing.
It was right to survive — every day already leaves `span_hours` at two decimals
and `day_value` is only ever 0, 0.5 or 1, so a `numeric` sum is exact and the
rounding never moved a digit. It was removed rather than left: a guard that
cannot fail is one nobody has tested, and dead code that looks like care is
worse than none.

---

## F137 · 2026-09-23 · 0105 — adding a parameter does not break a positional call, it changes what it means

`0101` gave `edit_transaction` five arguments, the fourth being `p_reason`.
`0105` had to add vendor, project and type, and they went where they read best:

```sql
edit_transaction(p_trx_no, p_amount, p_description,
                 p_vendor_code, p_project_code, p_type_code,  -- new
                 p_reason, p_key)
```

`92_acct_edit_transaction.sql` failed on the next run:

```
expected ok, got refused / There is no vendor nota says 600.
```

Thirteen call sites inside the database pass their arguments **positionally**.
Position 4 had meant *the remark* since `0101`. It now means *the vendor code*,
so every one of them handed its remark to a lookup.

**Nothing broke. Everything kept working and started meaning something else.**
The only reason it was loud is that `nota says 600` does not resemble a vendor
code. A remark reading `V-9001` would have set a vendor, returned `ok`, and
written an audit row saying the vendor changed — which is the same failure with
no error attached to it.

PostgREST calls by name, so the web app could not have shown this. Everything
inside the database calls by position.

This is the sibling of the trap `00_no_overloads.sql` guards. There, adding an
optional parameter creates a *second* function and every call becomes
ambiguous — loud, immediate, unmissable. Here it replaces the one function and
every call silently re-aims. The louder failure is the safer one.

The fix is not clever: **a seam's parameters are only ever appended.**

```sql
edit_transaction(p_trx_no, p_amount, p_description, p_reason, p_key,
                 p_vendor_code, p_project_code, p_type_code)  -- new, on the end
```

`p_key` last is a convention across this ladder and it reads better. It loses,
because a convention about where an argument sits is worth less than a
guarantee about what an existing call means.

### The second one, found in the same hour

The first draft of `0105` was written from `0101`'s body — and `0102` had
already replaced that function the day before, removing the `below_allocated`
refusal on the owner's instruction. Extending the older body silently
reinstated a refusal that had been deliberately taken out, one day after the
decision. `92_` caught it too.

**When a seam has been replaced, the body to extend is the last one, not the
one whose file you happen to be reading.** `0101` is where the function was
introduced and is the natural file to open; it has not been the truth since
`0102`. Nothing about opening it says so.

---

## F138 · 2026-09-23 · a default carried from the demo is an assertion about the business, and nobody checked this one

The first real pay rule book went into production yesterday with
`week_pattern: "6day"` and `effective_days_per_year: 288`. The owner read the
screen and asked one question: *bukankah jam kerja itu harusnya senin-jumat?*

Neither number was ever his. Both were copied out of
`src/demo/fixtures/payrules.ts` along with the numbers that **were** his — the
07.30 start, the 45-minute break, the overtime ladder — and the copy did not
distinguish between them. Reading the record back afterwards is unambiguous:
Q44 (D270, D274) answered the **hours**; Q53 (D279) answered **who is on which
pattern**; and Q45 asked *what is this business's own hari kerja efektif* and
was closed on 13 September with an answer about **who types the figure**, not
what the figure is. So Q45 was marked answered while the number it asked for
had never been spoken. 288 filled the hole, and it looked like a fact because
it was sitting in a field beside four real ones.

**The book contradicted itself, and the contradiction was readable.**
`monthly_divisor` was 173, which is 40 × 52 ÷ 12 and means nothing except on a
forty-hour week. The same object said 48,75 hours a week in its schedules. Two
fields that must agree, disagreeing — F73's shape exactly, the one this project
has now hit often enough that it should be the first thing checked when a
config object is assembled rather than the thing found later.

**What 6day was actually doing.** Not display. `ops_hr.is_rest_day()` reads it,
and under `6day` only Sunday is a rest day — so Saturday overtime would have
paid the workday ladder (1,5× then 2×) instead of the rest-day ladder. And the
rest-day tiers themselves were the six-day rungs of Kepmenaker 102/2004 pasal
11 (2× to hour 7, then 3×, then 4×); a five-day week runs to hour 8, then 9.
Switching the pattern without switching the rungs would have left a second,
quieter contradiction behind the first.

**The expensive one was 288.** `ops_hr.hourly_rate()` computes
`company = setahun ÷ hari_efektif ÷ jam_sehari`. A denominator 20% too large
makes the hourly rate 17% too small, and every overtime rupiah rides on it. On
a five-million pokok with a 25.000 daily allowance the real functions give
Rp 28.283 under v1 and Rp 33.333 under v2 — three hours of weekday overtime
moves from Rp 155.557 to Rp 183.332, for one person, once.

**Why it was still cheap to fix.** Zero employees, zero attendance scans, zero
payroll runs. Not one rupiah had been computed from v1, which is the same
condition that made D270's backdating safe, so v2 is dated to v1's own date as
a correction rather than to today as a policy change — the business did not
move from six days to five this morning, our record of it was wrong. v1 is
untouched and still in the book (A5).

**The lesson is not "check the config".** It is that seeding production from a
fixture silently promotes every demo default into a claim about a real company,
and the defaults are indistinguishable from the answers once they are in the
same JSON object. What would have caught this is the thing D173 already exists
for: a rule book is a set of assertions somebody has to sign, so the fields
nobody has answered should have been **absent or null**, and the screen should
have said *belum ditetapkan* — the same treatment D274 gives the guard's start
time. A field that has never been answered should not be able to look like one
that has.

**Still open**: Q45 is reopened for the number it actually asked for, and 240 is
a convention (20 days × 12) standing in until the owner names his. The demo
fixture still asserts six days for the same business.

---

## F139 · 2026-09-23 · a shape that can only express the new fact by lying about an old one

Half a day after F138, the same rule book produced a second finding by the
same route, and this one is about the **shape** rather than the numbers.

D288 set Friday at seven hours because the owner said the week is forty. The
only Friday lever the schedule row had was `friday_break_minutes`, so seven
hours for the office had to be bought with a **135-minute break** — 08.00 to
17.15 less 2¼ hours. Nobody has ever taken a 135-minute break. It was reverse-
engineered from the total, and it went into production looking exactly like a
fact somebody had decided.

The owner's correction was one sentence: *jumat pulang lebih awal, bukan 17.15
tapi 16.30, jam kerjanya 7 jam istirahatnya yang 90 menit.* Not a longer
break — an **earlier finish**, with D270's original 90 minutes intact all
along. The number I had written over was the right one.

**This is F91's shape again and it should have been recognised.** F91: Q44 was
answered a second time and *broke the answer built for it the day before*,
because `day_start_by_unit` could not hold a Friday, an end time, or a shift
with no fixed start. Here `friday_break_minutes` could not hold *Friday
finishes early* — and instead of refusing, it produced a plausible wrong
number. A shape that cannot express something usually says so by needing a
value nobody recognises. **135 was that signal, and I read it as arithmetic.**
The tell was there in the same table: produksi came out at 120 minutes exactly
and kantor at 135, and two patterns needing two different invented breaks to
reach the same total is the shape complaining, not the business speaking.

**What the fix is not.** `friday_end_minutes` is nullable, and null here does
**not** mean D274's *nobody has said*. It means *Friday finishes when every
other day does*, which is a real answer and the common one. The two Friday
fields fall back independently, so a pattern that differs only in its finish
keeps the ordinary break and the other way round — getting that wrong would
blank a Friday the business has actually decided.

**And the half hour that was left alone.** Produksi comes out at 7,5 hours on
Friday and 40,5 in the week, not 40. It already stops at 16.30 every day, so
its Friday is only the longer break. The owner said *40* while correcting the
**office's** finishing time; whether the workshop also leaves early on Friday
has never been said. Rounding it to 16.00 to make the table tidy would be F138
happening a third time in one day — filling an unanswered field with a number
that looks like a fact. It is left at 40,5 and Q54 says why.

**Cheap for the same reason both times**: zero employees, zero attendance, zero
payroll runs. Three versions of the rule book now share one date — the demo
copy, my guess, and the owner's answer — and that is the dated book working,
not a mess. Reading them in order is the honest record of how the number was
arrived at.

**Verified, not asserted.** Four mutations of the Friday arithmetic — dropping
either fallback, treating only the break as making Friday differ, and ignoring
the finish entirely — each failed the new smoke file for its own reason, the
last of them reproducing exactly the 7,75 the owner spotted. The TypeScript
derivation was compiled and run against the same four patterns and returned the
same four answers as the SQL, which is the only way ADR-009 is a claim rather
than a hope: there is no unit-test runner in this repo, so demo and live agree
only where somebody has actually made them agree in front of witnesses.

**Addendum, same day.** The half hour was not left open for long: asked, and
answered — *jumat produksi pulang 16.00* (D290). 07.30 to 16.00 less the 90
minutes is 420, which is seven hours exactly, and produksi's week closes at
40,00 alongside kantor's. Worth recording *why* that is reassuring rather than
suspicious: the two patterns reach the same total by **different** arithmetic —
the office leaves 45 minutes early, the workshop 30 — because their ordinary
days are different lengths against different breaks. Both also land on 173,33
hours a month, which is `monthly_divisor` 173, the field that was quietly
telling the truth about this week all along while the schedules contradicted it
(F138). Two independent routes arriving at the same number is the book being
right; one number copied into two rows would have looked identical and proved
nothing. The rule book ends the day with four versions sharing one date, and
reading them in order is the record of how the figure was arrived at.

---

## F140 · 2026-09-23 · the fixtures had been saying something the business never said, and only a guard could hear it

Making the working patterns editable meant the database had to start refusing
what a person can type, because `employees.schedule_code` is a **text key into
versioned jsonb** and there is no foreign key that can catch a typo. The first
rule written was the shape of a code.

It failed six smoke files on the first run. All six carried `"code":"produksi"`
in lower case while the real rule book, the demo fixture and every screen used
`PRODUKSI`. Nothing was broken by it — the comparison is exact and each fixture
was internally consistent — so it had sat there since M57 as a second spelling
of a key that has no spelling rules.

**That is the interesting part.** A key with two spellings is not a bug until
somebody types the other one, and the moment the screen lets them, it is one:
`produksi` and `PRODUKSI` are two patterns that look identical in a list and
match nothing of each other's. The fixtures were the early symptom of a rule
that had never been written down, and the only thing that could hear them was
the rule itself, on the day it was written.

The rule was also **wrong on its first run, in the other direction**. It
refused `shift-malam` — a hyphen — and a hyphen threatens nothing. Two of this
repo's own code families allow one (`0099`, `0107`). The refusal had to relax,
and the relaxation is pinned by two cases, one accepting `SHIFT-MALAM` and one
still refusing `shift-malam`, so *the hyphen was allowed* cannot quietly become
*the case rule was dropped*.

The lesson is about which way a guard is allowed to be wrong on its first run:
too strict is cheap and shows itself immediately, and too loose looks exactly
like working.

---

## F141 · 2026-09-23 · doing nothing is a grant, and the mutation found it

`ops_hr.schedules_in_use_lost()` answers *who would lose their pattern* with
employee **names**, and it is `security definer` so that IT — who publishes the
rule book and has no `hrd.read` — is guarded rather than waved through. Both
properties are correct. Together they are a hole.

Postgres grants `EXECUTE` to `PUBLIC` on a new function by default. Writing
nothing about privileges is therefore not *leaving it alone*; it is publishing
it. A definer function that reads the roster and is executable by PUBLIC means
**anybody holding any account at all** could ask for the roster, one pattern at
a time. The check was tested and correct; its reachability was never considered.

It was not found by review. The mutation run said something better: removing
`security definer` from that function **did not fail the smoke file**, because
it is only ever called from inside `save_pay_rules` and `preview_pay_rules`,
which are definer themselves — a function called from a definer already runs
with the definer's rights. So the flag was carrying no weight on the path the
test exercised. Asking *why does this mutation survive* is what surfaced the
one path where the flag does carry weight: a direct call. And a direct call was
exactly what nothing had revoked.

Closed with the idiom this repo already has for internal guards — `revoke
execute … from public`, as `ops_core.bootstrap_admin`, `ops_acct.account_guard`
and `ops_inv.asset_refs_invalid` each do — and the smoke file now asserts the
denial, so the grant cannot come back quietly.

**A second thing this cost, worth writing down.** The first attempt to prove
the fix reported that the leak was still open. It was not: `create or replace
function` does not reset privileges, so the grant written by an earlier run of
the same file was still sitting on the function in the scratch database. Only a
clean `rebuild.sh` answers a question about privileges. An iterated database is
not the database the ladder describes, and on grants specifically it will lie
in the safe-looking direction.

---

## F142 · 2026-09-23 · the screen was already telling people something that had stopped being true

`/it/aturan-gaji`'s divisor example ended with a sentence explaining why the
two hourly rates differ: *173 mengandaikan minggu 40 jam, dan kantor ini tidak
bekerja 40 jam seminggu.*

Since version 4 of the rule book, written the same morning, this office works
exactly 40 hours a week — both patterns, by different arithmetic (D290). The
sentence had been true when somebody wrote it under a six-day book, and it
became a confident, specific, wrong statement the moment the book changed,
sitting directly under a correct calculation.

Nothing could have caught it. It is prose, and prose that restates a fact the
data now owns is a second copy of that fact — F73's shape again, in a paragraph
rather than a column. It was found only because the same screen was open for
another reason. Rewritten to explain the *relationship* (the two agree when the
effective-days figure and the divisor are consistent) rather than to assert the
number, because the relationship stays true when the number moves.

---

## F143 · 2026-09-23 · the parity gate could not see this, because its two databases both agreed with the wrong side

`ops_hr.schedule_problem()` and the TypeScript module both report the **first**
problem, so anything that decides *which is first* is part of the rule. Two
dangling unit mappings are ordered before being reported: the SQL said
`order by key`, the TypeScript said `.sort()`.

`.sort()` is UTF-16 code-unit order. `order by key` is the database's
collation. They are not the same, and the disagreement is ordinary rather than
exotic — with units named `Workshop` and `office`, JavaScript reports
`Workshop` first and a database collating `en_US.UTF-8` reports `office`, since
that collation sorts case-insensitively at the first level. Two seams, same
input, different sentence: precisely what `check-schedule-rules.mjs` exists to
refuse.

**And it would have refused nothing.** The scratch cluster this was built on
collates `C`, and so, as far as this could be told, does the container CI runs
against. Both agree with JavaScript. The gate would have stayed green through
every run while production — `en_US.UTF-8`, checked rather than assumed —
answered differently on the one machine that matters.

That is the failure mode worth naming: a parity check inherits the environment
it runs in, and an environment that happens to agree with one of the two sides
turns the check into a rehearsal of that side. It was found by reading the diff
for what could differ **between here and production**, not by running anything;
nothing that could be run would have said it.

Fixed by pinning rather than by matching a locale: `collate "C"` on all three
orderings in `0125` (the unit loop, the names inside a lost pattern, and the
patterns themselves), and plain code-unit comparison on the demo side in place
of `localeCompare`, which has the same disagreement with `C` that `en_US` has.
The rule now orders the same way on any database, which is what a rule stated
twice needs. A case with two dangling units named in different cases is in the
battery, so the pin cannot be removed quietly — though, and this is the part to
remember, that case would pass on a `C` database even without the pin. The case
guards the intent; only reading the collation guarded the fact.

---

## F144 · 2026-09-23 · a read whose answer depends on who is asking, cached on what is being asked about

The new calendar note on `/it/aturan-gaji` rendered nothing. Not an error, not
a blank figure — the component simply was not there, and every gate was green.

`ops_hr.effective_days_calendar()` answers **null** to anybody without
`payroll.read` or `it.update`, because it is evidence beside a field and a
screen opened without the right does not want a number it should not show.
That makes it a read whose answer depends on the reader. Its `useLoad` deps
were `[rules.week_pattern, year]` — what is being asked *about*, and nothing
about who is asking.

So the first fetch ran as the demo's default user, who has no IT access, got
null, and cached it. Switching to the IT account changed nothing that the deps
watched, so nothing re-ran, and the evidence stayed invisible for the one
person it was built for.

**The demo is where it showed, not where it lives.** In production nobody
switches identity from the header — they get promoted, and the first person
granted `it.update` while the tab was open would have seen exactly this: a
screen that stays empty until it is reloaded, for no stated reason. A stale
permission-shaped read looks identical to a permission correctly denied, which
is why it would have been reported as *the button does nothing* rather than as
a bug with a shape.

Fixed by putting the acting user in the deps. The general rule, worth keeping:
**if a seam can answer differently for two people, the reader's identity is
part of the question, and caching keyed only on the subject is caching the
wrong thing.**

Found by driving the screen in a browser rather than by reading it. Nothing in
`tsc`, lint, the smoke suite or any of the eight checkers can see a `useEffect`
dependency list that is merely incomplete — it is valid code that does less
than it looks like it does.

---

## F145 · 2026-09-23 · six mutations survived, and every one of them was the harness

The widened payroll line got the usual treatment: break it six ways and check
the smoke file complains. All six survived.

That is not a result, it is an alarm — six independent breakages cannot all be
invisible to a test that asserts each of them by name. The cause was the
harness, not the code. Each mutation re-applied the whole migration file, and
that file now **opens with `alter type … add attribute`**, which fails on a
second run with *column already exists*. Under `ON_ERROR_STOP` the file aborted
at its first statement, the mutated function never replaced the good one, and
the smoke file passed against code nobody had touched.

Every earlier migration this session was `create or replace` all the way down,
so re-applying it was idempotent and the harness had always worked. The first
migration with a one-shot statement in it broke the technique silently, and
silently in the **reassuring** direction: a surviving mutation reads as *the
guard is redundant*, not as *the experiment did not run*.

Fixed by applying only the function half. Then six of seven were caught at
once, which is what the first run should have looked like.

**The seventh was real, and worth more than the other six.** Shifting the
contributions read to the wrong month changed nothing, because the fixture had
a single rate version with no end date — every month resolves to the same
percentage, so *which month* could not matter. The test was asserting a figure
it had no way to get wrong. A second rate version, effective from June at a
different percentage, makes March's answer a choice; the mutation now fails.

Two lessons, and the second is the one that generalises. A mutation that
survives is a question, never a clearance — and the first question is always
*did the change actually reach the database*. And a fixture with one of
something cannot test a rule about **choosing** between them: one rate, one
schedule, one version is the shape in which a selection bug is invisible.

---

## F146 · 2026-09-23 · `now()` is the transaction's clock, so "the latest audit row" was a coin toss

Merging `main` brought three new smoke files in, and the suite failed one of
them — once. Run again, it passed. Run alone, five times, it passed. Two fresh
rebuilds with a full suite each, both green. That is the worst shape a failure
comes in, because every instinct after the second green run is to call it
noise.

`ops_core.audit_log.at` defaults to `now()`, and `now()` in Postgres is the
**transaction** timestamp — `select now() = now()` is true, and every row a
transaction writes carries the same instant. Three smoke files read back *the
latest* audit row with `order by at desc limit 1`, and one of them,
`99_inv_asset_services`, calls `delete_asset_service` twice on purpose: once
successfully, once more to prove the thing is gone. Two rows, one action, one
identical timestamp, and which one `limit 1` returns is the planner's choice.

Proved rather than argued: two rows inserted in one transaction, then the same
query with and without a tiebreak — `count(distinct at)` is 1, and the two
orderings return **different rows**.

Adding `id desc` made it deterministic and immediately turned the file red
0/5, which is the part worth keeping. The tiebreak had not broken the test; it
had revealed that the test was reading the **refusal** and had been passing on
the accident that an untied sort usually returned the other row. The
assertion's actual subject is the successful delete, and its two sibling files
say so in their own queries — `and outcome = 'ok'` — while this one did not.
Both clauses are needed and neither alone is enough: the filter says which row
is meant, the tiebreak says which of the remaining ones is last.

The general rule this leaves: **a timestamp written by `now()` cannot order
rows within one transaction**, so any "most recent" read over an audit trail
needs the sequence as a tiebreak. All three files have it now; two of them
were already correct on the filter and only needed the hardening.

Not my file, and fixed anyway: an intermittent failure in the shared suite is
a red CI for whoever pushes next, and the diagnosis was already in hand.

---

## F147 · 2026-09-23 · a grant copied from six migrations re-opened the one table that had been closed

The new leave table needed a table-level grant — RLS narrows what a role may
see, but a role with no grant meets `permission denied` before any policy is
consulted. Every HR migration from `0043` to `0052` says the same line, so I
said it too:

    grant select on all tables in schema ops_hr to authenticated;

`53_hr_people_seams` failed immediately, on an assertion written a fortnight
earlier: *a number nobody may read is a table nobody may select*.

`0056` revokes select on `ops_hr.employee_documents`, because the document
numbers in it are readable only through a view that masks them (D196). Every
blanket grant in the ladder is numbered **below** that revoke, so the revoke
had always run last and always won. `0123` is the first one above it. The
idiom had been safe for exactly as long as no table in the schema had been
closed again, and nothing about the line says so.

**What makes this worth writing down is how it presented.** Nothing in the
migration looked wrong; it was copied verbatim from six places that are all
correct. The failure was not in the statement but in its **position in the
ladder**, which is the one property a copied line does not carry with it. A
reviewer reading the diff would have seen a familiar line in a familiar place.

Narrowed to `grant select on ops_hr.leave_requests`, and proved both ways
afterwards rather than assumed: `has_table_privilege` now answers false for
`employee_documents` and true for `leave_requests`.

The general rule: **`on all tables in schema` is not idempotent with respect to
a later revoke — it is a reversal of it.** In a ladder that only ever grows,
any blanket grant is a statement about every table added *before* it and every
decision taken *after* it, and the second half is invisible at the point of
writing. The six earlier copies should probably be narrowed too, but they are
correct where they stand and rewriting applied migrations is its own hazard; a
seventh would not have been.

Caught by a smoke assertion about a completely different feature. That is what
those two hundred lines of refusals are for.

---

## F148 · 2026-09-23 · the ledger was shut by a runtime check where the design said a privilege, and `anon` could call every seam

Found while reading `0038_acct_file_evidence.sql` to build J5's Chat ingest
door, because the whole safety case for handing a worker a `service_role` key
rests on one sentence in that file:

> `service_role` gets **usage on the schema and execute on this function, and
> nothing else.** No table grants. … A compromised worker key can file
> evidence. It cannot read the ledger, and it cannot resolve anything.

Half of that was measured and half was assumed, and the half that was assumed
was the half doing the work in the argument.

**The table half was true and had stayed true.** `service_role` held zero
privileges on all 189 tables across the seven `ops_*` schemas — not one
SELECT, not one INSERT. Worth saying because that is the part people expect to
have rotted.

**The execute half was false.** `service_role` could execute 278 of 285
`ops_*` functions, and so could `anon` — the publishable key that ships inside
every browser bundle. Among them `post_transaction`, `void_transaction`,
`edit_transaction`, `set_authorities`, `approve_payroll_run`,
`reveal_employee_doc_no`, and `resolve_inbox`, which that comment names by
name as the thing the worker cannot do.

Nothing granted this. It is the PostgreSQL default — a new function is
executable by `PUBLIC`, and Supabase's three roles inherit `PUBLIC`. The
ladder revokes it in exactly seven places, which is the interesting part: the
authors knew about the default and closed it each time they were thinking
about it. Ninety-odd functions later, nobody was thinking about it.

### What was actually holding the door

Not the grant. Every money seam opens with `ops_core.has_authority(...)`,
which is `select exists (… where ua.user_id = auth.uid() …)`. For `anon`,
`auth.uid()` is null, the `exists` is false, the seam refuses. **So the ledger
was never open** — and saying that plainly matters, because the temptation on
finding this is to describe it as a breach and it was not one.

It was weaker than what was written down, in a specific way. A privilege is
checked before the function body runs and cannot be talked around; an
authority check is a runtime comparison against a claim. Mint a `service_role`
JWT carrying a `sub` and `auth.uid()` returns it, and every authority check in
the database passes for whoever that is. Two guards where the design assumed
one is fine. **One guard where the design assumed two is how a system ends up
one mistake from open**, and nobody knows it because the document says there
are two.

### The fix, and the two mistakes it took to get right

`0125` revokes execute from `PUBLIC` on every `security definer` function in
`ops_*` and grants it to `authenticated`; `service_role` keeps the one verb.
`authenticated` deliberately keeps everything, because a signed-in person
reaching a seam is the design — what may then be *done* is decided inside, by
`has_authority`, `has_permission` and the catalogue (D218). Narrowing it would
move the boundary somewhere nobody reads and leave two places to keep in step.

**The first draft opened six holes while closing one.** A blanket `grant
execute … to authenticated` handed back every function an earlier migration
had deliberately revoked — `bootstrap_admin`, `idem_replay`, `idem_remember`,
`account_guard`, `asset_refs_invalid`, `asset_rent_invalid`. It was caught by
the count moving the wrong way: 168 before, 175 after, on a change that was
supposed to leave `authenticated` untouched. Reading the diff would not have
caught it; measuring before and after did.

The fix is not a list of six names to skip, which is the same staleness in a
new place. It is to **read the privilege before changing it** — a function
`public` can execute today was left on the default and is moved; one it cannot
was shut on purpose and is left alone. That reads identically on production
and on a ladder replayed from nothing.

**The second mistake was the list of deliberate revokes, derived by grepping
`revoke execute`.** There are seven, not six: `0109` shuts
`ops_prod.open_draft` with `revoke all`. The guard caught it on the next run
by naming the one function `authenticated` could no longer reach. A scope
typed from a grep of one spelling is the same failure as a scope typed from
memory (F94, F93) — and it happened here inside the very change written to fix
an instance of it.

### Why the guard is the deliverable and the migration is not

A migration cannot fix the future. A function created by `0124` is executable
by `PUBLIC` the moment it exists, and `0125` has already run. This was not
hypothetical: the migration was first numbered `0111`, five functions created
by `0114`–`0116` came after it, and the guard failed naming all five before
anything was committed.

So the thing that keeps this shut is
`supabase/local/smoke/A2_core_execute_grants.sql`, which derives its set from
`pg_proc` at the moment it runs and asserts four things: `anon` reaches
nothing, the seven shut stay shut, everything else stays reachable by
`authenticated`, and `service_role` reaches exactly one verb. Then a fifth,
which is the one that matters: it calls a money seam **as `anon`** and asserts
the error is `42501`, insufficient privilege. Anything else — including this
system's own worded refusal — means the call got far enough to run the
function body, which is exactly the runtime check `0125` exists to stop
relying on.

**A privilege that is right in the catalogue and wrong at the call site is
worth nothing**, and the only way to know which you have is to make the call.

## F149 · 2026-09-23 · walking the week as three people found four doors that do not open

Every seam in procurement had a smoke file, and every smoke file was green.
The simulation (`supabase/local/smoke/99_sim_procure_to_ledger.sql`) asked a
different question: not *does this seam work* but *can Andi, Evin and Rina get
from an empty database to a matched bank line using only what the screens
send*. Thirty-five steps. Four of them could not be taken as the SOP would
describe them (backlog B5–B8).

**The one that matters most is B5, and it hid in plain sight.** `05_procure_lifecycle`
calls `create_receipt` with `'kind','goods_photo'` — the code — and passes.
The live screen sends `'Receiving Item'` — the label — because every other
evidence road in the application accepts labels through `doc_kind_of`. This
one does not. So the smoke file proved the seam against an input no screen
produces, and the screen was never put against the seam. The simulation
passes exactly what `ReceiveForm.tsx` passes, and gets `photo_required` with a
photo attached. **A test that calls a seam the way its author thinks it is
called proves the author, not the seam.**

B6 is the same shape from the other side: `/procurement/pr/new` is the only
road to a PR, and `check-live-routes` correctly keeps it shut because one
optional dropdown reads `production`. Nothing is broken; the rule is right and
the page is dark. A derived gate is only as fine-grained as the thing it walks.

B7 and B8 are not bugs but a missing join: the PO never learnt which request
line it buys, so a payment can be allocated to the line or to the order and
never both, and the order's deposit reads UNPAID after it is paid.

The walk is kept as a smoke file rather than a document. It logs `TEMUAN`
instead of asserting, so it stays green while the findings are open — and when
B5 is fixed, the step's own `case` turns it to `OK` without anybody editing the
simulation.

## F150 · 2026-09-23 · the second walk went all the way to COMPLETED, and found the fifth door on the way

With B5–B8 fixed, the simulation was rewritten to walk the road as it now
works: the PO is built from the approved line, the deposit is paid from the
order's page, the balance from the line. L01 now goes WAITING FOR APPROVAL →
APPROVED → PARTIAL (arrived, not settled) → COMPLETED, and its order DRAFT →
ISSUED → PARTIAL → SETTLED, every rupiah counted once on each side. The first
walk never got a line past PAID.

**Going further is what found B9.** The first walk paid only L01, a line with
a quantity. The second paid the delivery charge too — the lump-sum line D75
exists to protect — and `post_from_line` handed the ledger a detail line with
no quantity under SUPPLIERS, a purchase type that insists on one. Refused
`line_detail_required`. The requests board offers that button on every
approved line. Nothing had ever pressed it on a lump sum.

Two smaller things worth keeping:

- **The shape assertion in `14_procure_po_board` earned its place.** Adding
  `pr_line_no` to the drawer's lines and not the tracker's failed there
  within one run — exactly the drift it was written for.
- **A procurement-only reader sees no payments at all.** `v_po_status` is
  `security_invoker` and the allocations are accounting's, so Andi's PO page
  says *Rp 0 paid* on an order Rina paid in full. Correct by the policies, and
  probably surprising on a screen; noted, not changed.

B9 was closed the same day by the owner's choice (D298, `0141`): the ledger
detail of a lump-sum payment is *1 lot × the amount paid*. The walk now runs
37 steps from an empty database to a matched bank line with **no findings**,
and L02 — the delivery charge — ends PAID beside L01's COMPLETED.

## F151 · 2026-09-23 · the approval rule was complete in the demo and half-built in the database

The owner restated the rule for orders — leadership confirms every one,
either by writing it themselves or by answering a card in Google Chat — and
checking the ladder against that sentence, rather than against the demo,
found three gaps the demo had been hiding:

- `create_po` never self-confirmed. D267 was built in `src/demo` only, so a
  CEO's own order in the live system waited for the CEO to ask himself.
- There was **no seam for the chat answer** to an order. `answer_request`
  exists for request lines; for orders the token was minted and nothing could
  ever redeem it.
- **No worker delivers the card.** The outbox holds the event; nothing reads
  it. `/demo/chat` stands in for the whole road, convincingly enough that the
  absence did not show.

The first two are `0143`. The third needs an answer about infrastructure the
repository cannot see (B10). The general lesson is the one the parity check
cannot catch: **a function that exists only in the demo is not a pending
function, it is an unbuilt one**, and nothing lists it. `answerPoFromChat`
and `listPoApprovals` are demo-only by design — a browser must not answer
for the CEO — and that is exactly why their live counterparts had to be
looked for by hand.

Two smaller things the smoke file pinned: the token never travels in the
outbox (it is readable by signed-in users), and the worker reads a card
through one function rather than a table grant, the shape `0038` chose for
the capture worker.

## F152 · 2026-09-23 · the first walk through the live screens, and what only a browser could find

`scripts/e2e/walk-procurement.mjs` walks the procurement week in a real
browser, in live mode, against the ladder: PostgREST as a static binary and a
three-endpoint auth stub (`scripts/e2e/local-stack.mjs`), because the Supabase
images cannot be pulled from here. The only thing not real is the Drive hop of
an upload; the walk intercepts it and does the route's database half as the
signed-in person. 22 steps, three people, from an empty request to a matched
bank line. Both approval roads are walked: staff ask and Evin confirms;
Evin writes his own and it is confirmed on creation.

What it found, none of which the SQL walk could have:

- **B11** — *New request* lets a line leave its vendor *not decided yet*, and
  the order decides it. `post_from_line` read only the line's vendor, so the
  delivery charge could not be paid from its row. The SQL fixture put a vendor
  on every line, so it never met the case the form invites.
- **B12** — every live draft order said *Changed since it was sent*. The
  ladder starts a draft at revision 1 with nothing sent; the demo at 0/0. The
  demo is where every screen was built, so nobody had ever seen a live draft.
- **`config.toml` did not expose `ops_asst` or `ops_mkt`**, both read by the
  app through PostgREST. The harness exposes every `ops_*` schema and so did
  not trip on it; reading the file to write the harness is what found it. The
  hosted project's *Exposed schemas* setting needs the same check.
- **The guide named a button that does not exist.** *Approve this* is the
  checkbox column's header; the button is *Approve N · Rp…*. And attaching a
  price said *dari laci baris* where the drawer asks for a type and a button.
  `scripts/sop/check-knowledge.mjs` compares the walk's buttons to the guide
  and refused both on its first run (`0146`).

And one that was not the walk's to find but surfaced while running it:
`86_acct_cash_plan` compared `office_day()` with `current_date`, so it failed
every evening between 16:00 and 24:00 UTC, when Makassar is already on the
next day. The test now uses the office's day, as the system does — the same
shape as F146, a test asserting against a clock the code does not use.

The walk is recorded where a browser runs and checked where it lands: CI has
no browser, but it reads the committed `walk.json` against the knowledge the
migrations write, so a guide that drifts from the screens fails the build.

## F153 · 2026-09-23 · the sentence the owner used was the one the router half-understood

*buat PO untuk KSA binder 5 liter* — the owner's own example — is matched by
the keyword router (rule 60, `procurement.draft_po`) with **no arguments**:
the router knows it is an order and not what for. A model would have been
bypassed, because the router reads first. So the item is taken from the
person's own sentence with the asking words removed, and the approved line
it names is looked up; nothing is composed.

Two more things the dock walk (`scripts/e2e/walk-john-lau.mjs`, 15 checks,
against `scripts/e2e/mock-llm.mjs`) pinned down:

- **Confirming `draft_po` wrote nothing, on purpose, since D220.** The comment
  said so; the dock said *Tersimpan*. It now writes a DRAFT order.
- **A line approved without a price drafted a PO at Rp 0**, and `create_po`
  refused it — correctly — as `price_required`. The draft now leaves an
  unknown price blank, which is the same rule as D217 read the other way: a
  zero is a figure, and nobody said it.

The mock model proves the road, not the reading. How well a real model picks
tools from Indonesian shop-floor sentences is the next measurement, with a
key and the turns people actually type.


## F154 · 2026-09-24 · HR, walked the same way: every seam was right and six doors were shut

HR had a smoke file for every seam, and they were all green. The walk asked
the procurement question again — *can Sari, Evin and Rina get from an empty
database to a paid week using only what the screens send* — first in SQL
(`99_sim_hr_to_ledger.sql`, four people, 33 steps), then pressing the buttons
(`scripts/e2e/walk-hr.mjs`, 18 steps). The answer was no, six times over, and
not one of them was a seam that did the wrong thing:

1. **A contract registered on screen could never go live.** `activate_contract`
   refuses `paper_required` — rightly — and the only way to link the paper was
   an argument of `register_contract` the form has no field for. The rule was
   right and there was no door to satisfy it. B13, `0148`.
2. **The 201 file could hold numbers but never scans.** The drawer shows
   *berkas di Drive* for a document with an attachment, and had no way to give
   one. B14.
3. **An approved payroll run stopped at APPROVED for ever.** `record_payroll_paid`
   wanted a ledger number typed elsewhere and nothing called it; the approval
   event has no consumer. The same missing join as B8, so the same shape of
   fix: pay it from its own page, one call, one ledger row per run (D302). B15.
4. **The live timesheet showed the demo's fortnight.** `PERIOD` was a constant,
   29 Aug – 7 Sep 2026. In live mode the grid could never show a day anybody
   could still read, so *open days* could only be closed through somebody
   else's screen — and approval refuses while any are open. B16.
5. **The John Lau launcher covered the only *Pasang* button** on `/hrd/jadwal`.
   F65 had added room under the page on small screens only; the last row of a
   short page sits under the corner on a laptop too. Found because Playwright
   refuses to click what a person could not either. B17.
6. **Everybody entered on screen joined today.** The drawer had no start
   date, so go-live would have made every tenure start that morning. B18.

One more thing the SQL walk taught rather than found: **a day is read from
four taps** (in, out to break, back, home). Two taps a day — what a
simulation writes without thinking — leaves every day *belum dibaca* and the
run unapprovable. It is now in the FAQ John Lau reads, because it is the first
thing a new HR person will ask.

The walk also ran into the limit of screenshots as specification: the
knowledge said `Import N tap(s)` and the walk pressed `Import 27 tap(s)`.
The walk records the button's shape, not its count.

John Lau stage 4 (D301) rides on the same walk: *ajukan cuti untuk Wulan 2
sampai 3 Oktober, acara keluarga* is a draft with the person, both dates and
the reason read from the sentence; nothing is filed before *Ya, tulis*; a
reader of HR is refused by the same gate as the screen; and the model's
invented salary field and its *minggu depan* in a date field are dropped
(`walk-john-lau.mjs`, 19 checks).
