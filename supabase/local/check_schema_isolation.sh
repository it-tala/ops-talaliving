#!/usr/bin/env bash
# Refuse any migration that names a schema belonging to somebody else.
#
# ── Why this exists ───────────────────────────────────────────────────────
#
# `docs/plan/phase-2/README.md` said the ladder could never be applied to the
# only Supabase project on the account, because `core` and `hr` would collide
# with the running legacy system. D265 removed that collision by renaming every
# schema `ops_*`, which is what makes it safe to put the new system **in the
# same database** as the old one — no second project, and an import that is a
# join rather than a network transfer.
#
# The whole safety of that arrangement rests on one sentence: **our migrations
# touch nothing outside `ops_*`.** That sentence is easy to agree with, free to
# hold today, and one careless `alter table public.vendors` away from being
# false — against a database holding 3.235 real transactions, 296 vendors and a
# live Google Chat pipeline that received an event this morning.
#
# A rule nobody checks is a rule that has already drifted; F81 in
# `findings.md` is this project discovering that a rule written in a comment
# does not protect the code under it, two days after writing the comment. So it
# is checked here, and `smoke.sh` runs it before anything else.
#
# ── What it will and will not catch ───────────────────────────────────────
#
# It reads schema-qualified names out of the migrations after stripping
# comments and one-word string literals, so the prose in this repository —
# which discusses `core.users` and `public` at length, on purpose — never trips
# it, and neither does a migration that *stores* a dotted name as data. What it
# cannot see is a name assembled at run time inside `execute format(...)`; there
# is none today, and if one ever appears it belongs in review, not in a grep.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS="$HERE/../migrations"

# Ours, plus the schemas Supabase itself owns and every project legitimately
# reads. `auth` is GoTrue's: `auth.uid()` is how RLS learns who is asking, so a
# migration that never mentions it would be a migration with no policies.
ALLOWED='ops_core|ops_procure|ops_acct|ops_hr|ops_prod|ops_inv|ops_asst|auth|storage|extensions|graphql|graphql_public|realtime|vault|cron|pg_catalog|pg_temp|information_schema'

# The legacy system's own schemas, named explicitly rather than inferred, so the
# failure message can say which system the migration was about to reach into.
LEGACY='core|hr|ops|po_import|public'

fail=0

blank_comments() {
  # Comments are blanked, never deleted: every newline survives, so `grep -n`
  # on the result reports the line number in the original file. Deleting them
  # instead costs the line numbers, and the first version of this script did
  # exactly that — it reported a real violation on line 3 as being on line 1,
  # which is a comment that is entirely fine. A guard that points at innocent
  # code is one people learn to argue with rather than fix.
  perl -0777 -pe 's{/\*.*?\*/}{ $& =~ tr/\n//cdr }ges' "$1" | sed 's/--.*$//' | blank_atoms
}

blank_atoms() {
  # A quoted word is data, never a schema reference.
  #
  # `0038` stores John Lau's catalogue as rows, and two of the tool names it
  # writes down are `hr.payroll` and `hr.attendance` — the names of *refusals*,
  # transcribed from the owner's own answers. This guard read them as a
  # migration reaching into the legacy `hr` schema and refused the file.
  #
  # That is the failure mode the comment in `blank_comments` warns about: a
  # guard pointing at innocent code is one people learn to argue with rather
  # than fix, and the argument ends with somebody widening `LEGACY` or deleting
  # the check.
  #
  # So a single-quoted run containing **no whitespace and no quote** is
  # blanked. The carve-out is deliberately that narrow, because the thing this
  # guard exists to catch is a *statement* — `alter table public.vendors`,
  # `drop schema ops cascade` — and a statement cannot fit in a token with no
  # spaces in it. `'public.vendors'` on its own does nothing to anybody.
  #
  # No SQL string state is tracked and none is needed: an apostrophe in the
  # English prose inside a `$r$ … $r$` block (*that person's name*) has
  # whitespace before the next quote, so it never pairs.
  sed -E "s/'[^'[:space:]]*'/''/g"
}

for f in "$MIGRATIONS"/*.sql; do
  [ -e "$f" ] || continue

  # One pattern, two shapes of the same mistake: a qualified name
  # (`public.vendors`), and a bare schema under DDL that would act on the whole
  # thing (`drop schema ops cascade`) — which the dot pattern cannot see and is
  # the more destructive of the two.
  #
  # `-i` is not tidiness. The first cut spelled the optional `if exists` as
  # `if not exists`, so `drop schema if exists ops cascade` — the single most
  # destructive line this guard exists to stop — walked straight past it while
  # the two harmless qualified names were caught. The guard was blind in
  # exactly the case that justifies it, which is F85's shape again.
  hits=$(blank_comments "$f" | grep -inE \
    -e "(^|[^A-Za-z0-9_.])($LEGACY)\.[A-Za-z_]" \
    -e "(drop|alter|create)[[:space:]]+schema[[:space:]]+(if[[:space:]]+(not[[:space:]]+)?exists[[:space:]]+)?($LEGACY)([^A-Za-z0-9_]|$)" \
    || true)

  if [ -n "$hits" ]; then
    fail=1
    echo "── $(basename "$f")" >&2
    # The line as written, trimmed — quoting the statement is what tells
    # somebody whether they meant it, and a line number alone does not.
    while IFS= read -r hit; do
      n=${hit%%:*}
      text=$(sed -n "${n}p" "$f" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')
      echo "   line $n: $text" >&2
    done <<< "$hits"
  fi
done

if [ "$fail" = "1" ]; then
  cat >&2 <<'MSG'

refusing: a migration names a schema belonging to the legacy system.

The new system shares one Supabase project with `john-lau`, which is still
running and still receiving Google Chat events. Our half is `ops_*` and nothing
else. If this reference is deliberate — an import reading the old tables — it
belongs in `supabase/import/`, which runs as a reviewed one-off, never in the
ladder that `rebuild.sh` replays from nothing.
MSG
  exit 1
fi

echo "schema isolation                            ok"
