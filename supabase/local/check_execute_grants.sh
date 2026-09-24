#!/usr/bin/env bash
# Refuse an `ops_*` security definer function that PUBLIC may execute.
#
# ── Why a sweep was not enough ────────────────────────────────────────────
#
# `0125_core_execute_grants.sql` found that 278 of 285 `ops_*` functions were
# executable by `service_role` and by `anon` — the publishable key that ships
# inside every browser bundle — and moved execute from `public` to
# `authenticated` for every one of them. Nothing had granted that; it is the
# PostgreSQL default, and Supabase's three roles all inherit `PUBLIC`.
#
# A sweep closes the door once. It ran at 0125, and the very next migration to
# add a definer function — `0136`, eleven files later — created seven more with
# the default intact. Nobody was careless: each of those seven checks
# `has_permission()` before it does anything, and the author reasoned that this
# made them safe. That reasoning is exactly how the hole stays open, because it
# has to be re-made correctly by every person who writes the next function.
#
# So the rule is the whole class, checked here rather than argued each time. A
# definer function runs as its owner and bypasses RLS; whether it also checks a
# permission is a second line of defence and not a reason to skip the first.
#
# ── What it allows ────────────────────────────────────────────────────────
#
# Only `security invoker` functions, which run as the caller and are therefore
# already bounded by that caller's RLS and grants. Those are left alone.
set -euo pipefail

HOST="${PGHOST:-/tmp}"
PORT="${PGPORT:-5433}"
USER="${PGUSER:-postgres}"

LEAKED=$(psql -h "$HOST" -p "$PORT" -U "$USER" -Atc "
  select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname like 'ops\_%'
     and p.prosecdef
     and has_function_privilege('public', p.oid, 'EXECUTE')
   order by 1")

if [ -n "$LEAKED" ]; then
  echo "security definer functions PUBLIC can execute:" >&2
  echo "$LEAKED" | sed 's/^/  - /' >&2
  echo "" >&2
  echo "A new function is executable by PUBLIC by default, and anon inherits it —" >&2
  echo "that key is in the browser bundle. Add, beside the grant:" >&2
  echo "" >&2
  echo "  revoke execute on function <signature> from public;" >&2
  echo "  grant  execute on function <signature> to authenticated;" >&2
  echo "" >&2
  echo "The function checking has_permission() itself is not a reason to skip it." >&2
  exit 1
fi

echo "no security definer function is open to PUBLIC"
