# 07 — How we work

You are away from a computer this week. The whole method is built around
that: everything ships to a URL you can open on a phone, every review is a
link, and every session leaves the plan updated so the next one can start
from a sentence.

## The loop

```
   you, on a phone                    Claude, in the cloud
   ──────────────                     ───────────────────
   send the day's prompt   ────────▶  reads docs/plan/README.md
                                      does the milestone
                                      updates the board
                                      appends to findings.md
                                      commits and pushes
                           ◀────────  Vercel preview link
   open the link, tap around
   reply with what is wrong  ───────▶ fixes, pushes again
   "merge"                  ───────▶  merges to the branch
```

No PC in that loop anywhere. Claude runs in the cloud
(`claude.ai/code`, or the Claude app on Android — which you have already
confirmed keeps working when the laptop is shut). A session that started on
one device is continued from another; the plan file, not the chat history, is
what carries the state.

## The prompt for any day

Every day's exact prompt is in `05-workplan.md`. They all share a shape, and
if you ever lose the file, this shape is enough:

> Read `docs/plan/README.md`. Do M6. Update the milestone board, append what
> it taught us to `docs/plan/findings.md`, and commit.

Three things make it work:

1. **`docs/plan/README.md` is the entry point.** Never re-explain the project.
2. **Name one milestone.** Not two, and not "continue" — a named milestone is
   a reviewable diff.
3. **The tail is fixed.** Board updated, findings appended, committed. A
   session that skips the tail loses everything the next one needs.

## Other prompts worth keeping

| When | Prompt |
|---|---|
| Something is wrong on the deployed demo | *"On `/procurement/pr/baru`, the running total does not include the last line until I blur the field. Fix it, push, and tell me when the preview is up."* |
| You want to answer an open question | *"Q18: grant approve_goods to the operations director as well, so lines do not wait when the CEO travels. Move it to Decisions and change the code."* |
| You want to see a choice rather than decide it in the abstract | *"Build both versions of the approval screen behind `?v=1` and `?v=2` and send me the links."* |
| You lost the thread | *"Read `docs/plan/README.md` and tell me where we are, what is next, and what is blocked."* |
| Something feels wrong but you cannot say why | *"Walk Flow B on the demo yourself and tell me the three worst things about it."* |
| End of a day | *"Update the board, append today's findings, and give me one paragraph I can read on the way home."* |

## Reviewing from a phone

- **The preview link is the review.** Tap through it. Reading a diff on a
  phone is miserable and mostly unnecessary for UI work.
- **Read the board and the findings**, not the code. Those two files are
  written for you.
- **One milestone per pull request**, so a link is one thing to judge.
- If it looks right, say "merge". If it does not, say what is wrong in plain
  words — screen name and what you expected. No need to be precise about the
  file.

## What a session must always do

1. Read `docs/plan/README.md` first.
2. Do the one named milestone and nothing else. Something noticed on the way
   becomes a new row on the board, not extra scope today.
3. Never invent a business rule silently. Take the default from
   `06-decisions.md`, or add a new open question with a default, and say so.
4. Append to `findings.md` — what the screen revealed, what it could not
   answer, what the rule turns out to be.
5. Update the board **in the same commit** as the work.
6. **Run the checks, and report what they said rather than that you ran them.**
   `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run check:api`, and
   `npm run check:refusals` against a running app. They are also a CI workflow
   now (`.github/workflows/checks.yml`), because for sixty-three milestones every
   one of these was manual, typed once, and gone (F96).
7. Push. Report the preview link.

## What a session must never do

- Redesign the design system.
- Restructure the plan documents without being asked.
- Add a dependency to solve something the existing components already solve.
- Widen scope to a module that is not procurement or accounting.
- Report a milestone DONE with a refusal path untested — the happy path
  working is half of it.
- Store derived state. Coverage, status and balances are computed, always.

## Branch and commits

Work goes on `claude/serene-euler-eq2qef`. One milestone per commit, with the
milestone id first:

```
M4: PR list, multi-line create, and the line drawer

...

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

## If something goes wrong while you are away

Phase 1 cannot break anything real. There is no database, no production data,
no money. `john-lau` and `ops.talaliving.com` are untouched and keep running.
The worst case is a broken preview link, which is fixed by the next push or
by reverting one commit.

That is the other reason to do the frontend first: for two weeks, being wrong
is free.
