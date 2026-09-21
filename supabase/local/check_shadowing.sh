#!/usr/bin/env bash
# Find PL/pgSQL locals that share a name with a column somewhere in the schema.
#
# Written after the fifth instance. `declare covered numeric;` in a function
# that later says `select covered from ops_procure.v_line_coverage` is ambiguous,
# and Postgres refuses the query rather than guessing — correctly, and **at run
# time**. The migration applies, the function is created, and the failure waits
# until the one branch that happens to reach that line.
#
# Five of those in one session is not five mistakes, it is a missing check. So:
#
#   supabase/local/check_shadowing.sh
#   PGHOST=/tmp PGPORT=5433 supabase/local/check_shadowing.sh
#
# The convention it enforces is the cheap one — **prefix every local with
# `v_`** (and every argument with `p_`, which the seams already do). Parameters
# are exempt because `p_` already puts them out of reach of any column name.
#
# It reads the migration files rather than the catalogue, because what it needs
# is the `declare` block as written, and `pg_get_functiondef` gives that back
# only after the parser has already accepted it.
set -euo pipefail

HOST="${PGHOST:-/tmp}"
PORT="${PGPORT:-5433}"
USER="${PGUSER:-postgres}"
HERE="$(cd "$(dirname "$0")" && pwd)"

# Every column name in the application's own schemas, one per line.
psql -h "$HOST" -p "$PORT" -U "$USER" -Atc "
  select distinct column_name
    from information_schema.columns
   where table_schema in ('ops_core','ops_procure','ops_acct','ops_hr','ops_prod','ops_inv','ops_mkt','ops_asst')
" > /tmp/_columns.txt

python3 - "$HERE/../migrations" /tmp/_columns.txt <<'PY'
import re, sys, pathlib

migrations, colfile = sys.argv[1], sys.argv[2]
columns = {c.strip() for c in open(colfile) if c.strip()}

# A `declare` block runs from the keyword to the `begin` that opens the body.
DECLARE = re.compile(r'\bdeclare\b(.*?)\bbegin\b', re.S | re.I)
# `name type;` or `name type := expr;` — the name is the first identifier of
# each semicolon-separated clause.
NAME = re.compile(r'^\s*([a-z_][a-z0-9_]*)\s+', re.I)

bad = []
for path in sorted(pathlib.Path(migrations).glob('*.sql')):
    text = path.read_text()
    for block in DECLARE.findall(text):
        # Strip comments so a column name inside prose is not a finding.
        block = re.sub(r'--[^\n]*', '', block)
        for clause in block.split(';'):
            m = NAME.match(clause)
            if not m:
                continue
            name = m.group(1).lower()
            if name in ('begin', 'declare'):
                continue
            # `p_` is an argument and `v_` is the convention. Anything else that
            # collides with a column is the bug this script exists for.
            if name.startswith(('p_', 'v_')):
                continue
            if name in columns:
                bad.append((path.name, name))

if bad:
    print("PL/pgSQL locals shadowing column names:")
    for f, n in sorted(set(bad)):
        print(f"    {f}: {n}  ->  rename to v_{n}")
    print()
    print("Postgres refuses an ambiguous reference at RUN time, so these apply")
    print("cleanly and fail only on the branch that reaches them.")
    raise SystemExit(1)

print("no shadowed locals")
PY
